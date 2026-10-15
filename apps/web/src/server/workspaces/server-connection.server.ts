import { isValidWorkspaceSlug } from "#src/features/workspaces/workspace-slug";

/** Host polls every 5 seconds. The light stays on through several missed heartbeats, then goes out. */
const HOST_HEARTBEAT_LEASE_MS = 90_000;

export class ServerConnectionError extends Error {
  constructor(
    readonly status: 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "ServerConnectionError";
  }
}

export type ServerConnectionRow = {
  workspaceId: string;
  installOrigin: string;
  workspaceSlug: string;
  submittedByUserId: string;
  submittedByName: string;
  submittedAt: Date;
};

export interface ServerConnectionPorts {
  /** Inserts the workspace's only row. Throws `ServerConnectionError` 409 when one already exists. */
  insert(row: ServerConnectionRow): Promise<void>;
  find(workspaceId: string): Promise<ServerConnectionRow | undefined>;
  /** When this deployment's Swarm host last registered or heartbeated. */
  hostLastSeen(): Promise<Date | undefined>;
}

export type ServerConnectionSubmit = {
  workspaceId: string;
  userId: string;
  submittedByName: string;
  installOrigin: string;
  workspaceSlug: string;
  now: Date;
};

type ConfiguredView = {
  configured: true;
  installOrigin: string;
  workspaceSlug: string;
  submittedByUserId: string;
  submittedByName: string;
  submittedAt: Date;
  connected: boolean;
  command: string;
};

export type ServerConnectionView = { configured: false; connected: false } | ConfiguredView;

export class WorkspaceServerConnection {
  constructor(private readonly ports: ServerConnectionPorts) {}

  async read(workspaceId: string, now: Date): Promise<ServerConnectionView> {
    const row = await this.ports.find(workspaceId);
    if (!row) return { configured: false, connected: false };
    return {
      configured: true,
      ...viewOf(row),
      connected: await this.#connected(now),
      command: hostConnectionCommand(row.installOrigin),
    };
  }

  async submit(input: ServerConnectionSubmit): Promise<ConfiguredView & { command: string }> {
    const installOrigin = requireInstallOrigin(input.installOrigin);
    if (!isValidWorkspaceSlug(input.workspaceSlug)) {
      throw new ServerConnectionError(422, "invalid workspace slug");
    }
    const row: ServerConnectionRow = {
      workspaceId: input.workspaceId,
      installOrigin,
      workspaceSlug: input.workspaceSlug,
      submittedByUserId: input.userId,
      submittedByName: input.submittedByName,
      submittedAt: input.now,
    };
    await this.ports.insert(row);
    return {
      configured: true,
      ...viewOf(row),
      connected: await this.#connected(input.now),
      command: hostConnectionCommand(installOrigin),
    };
  }

  async #connected(now: Date): Promise<boolean> {
    const lastSeen = await this.ports.hostLastSeen();
    if (!lastSeen) return false;
    const age = now.getTime() - lastSeen.getTime();
    return age >= 0 && age < HOST_HEARTBEAT_LEASE_MS;
  }
}

/** Install the binary, then start the Swarm manager process against this deployment.
 * The token, node key, cluster name, and image stay in that machine's environment. */
export function hostConnectionCommand(origin: string): string {
  return `curl -fsSL '${origin}/computer/install.sh' | sh && "$HOME/.local/bin/coforge-computer" host --server-url '${origin}'`;
}

function viewOf(row: ServerConnectionRow) {
  return {
    installOrigin: row.installOrigin,
    workspaceSlug: row.workspaceSlug,
    submittedByUserId: row.submittedByUserId,
    submittedByName: row.submittedByName,
    submittedAt: row.submittedAt,
  };
}

/** The origin pasted into `curl` must be this deployment's bare origin, with nothing a shell
 * could treat as another command. */
function requireInstallOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServerConnectionError(422, "invalid install origin");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== value ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new ServerConnectionError(422, "invalid install origin");
  }
  return value;
}
