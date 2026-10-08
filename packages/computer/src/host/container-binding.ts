import {
  FileBindingStore,
  FileDaemonCredentialStore,
  workspaceStateDirectory,
} from "@lrm/coforge-daemon";

/** Fixed workspace directory inside the cloud Computer image. */
export const CONTAINER_WORKSPACE_ROOT = "/workspace";

const REQUIRED_ENV = [
  "COFORGE_DAEMON_API_KEY",
  "COFORGE_WORKSPACE_ID",
  "COFORGE_COMPUTER_ID",
  "COFORGE_SERVER_URL",
] as const;

const PRESENT_ENV = [...REQUIRED_ENV, "COFORGE_WORKSPACE_SLUG", "COFORGE_COMPUTER_NAME"] as const;

/**
 * When a container was started for one Computer, write the Daemon credential and
 * one enabled workspace binding. A normal foreground start has none of these
 * variables and leaves the state directory untouched.
 */
export async function prepareContainerBinding(
  env: Record<string, string | undefined>,
  stateDirectory: string,
  expectedServerUrl?: string,
): Promise<boolean> {
  const present = PRESENT_ENV.some((key) => text(env[key]) !== undefined);
  if (!present) return false;
  const daemonApiKey = text(env.COFORGE_DAEMON_API_KEY);
  const workspaceId = text(env.COFORGE_WORKSPACE_ID);
  const computerId = text(env.COFORGE_COMPUTER_ID);
  const serverHttpUrl = text(env.COFORGE_SERVER_URL)?.replace(/\/+$/, "");
  if (!daemonApiKey || !workspaceId || !computerId || !serverHttpUrl)
    throw new Error("container environment is incomplete");
  let server: URL;
  try {
    server = new URL(serverHttpUrl);
  } catch {
    throw new Error("container environment is incomplete");
  }
  if (expectedServerUrl && server.origin !== new URL(expectedServerUrl).origin)
    throw new Error("Binding server does not match this daemon build");
  await new FileBindingStore(stateDirectory, expectedServerUrl).save([
    {
      workspaceId,
      computerId,
      workspaceRoot: CONTAINER_WORKSPACE_ROOT,
      serverHttpUrl,
      enabled: true,
    },
  ]);
  await new FileDaemonCredentialStore(workspaceStateDirectory(stateDirectory, workspaceId)).save(
    workspaceId,
    computerId,
    daemonApiKey,
  );
  return true;
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
