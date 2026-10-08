import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDaemonLauncher } from "@lrm/coforge-daemon";
import {
  DAEMON_RUNTIME_READY_METHOD,
  decodeDaemonRuntimeReadyRequest,
  type DaemonRuntimeReadyRequest,
} from "@lrm/coforge-sdk/internal";
import { LifecycleStatusSchema } from "#src/release/installer-contract";
import { SUPERVISOR_PROBLEM_CODE } from "#src/release/supervisor-status";

let root: string;
let executable: string;
let containerName: string;
let centrifugoPort: number;
let proxy: ReturnType<typeof Bun.serve>;
const readyRequests: DaemonRuntimeReadyRequest[] = [];
const waitFor = async (condition: () => boolean | Promise<boolean>, message: string) => {
  const deadline = Date.now() + 30_000;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error(message);
    await Bun.sleep(50);
  }
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "coforge-machine-lifecycle-"));
  executable = join(root, "coforge-computer");
  const suppliedBuild = Bun.env.COFORGE_NATIVE_TEST_BUILD_1;
  if (suppliedBuild) {
    await Bun.write(executable, Bun.file(suppliedBuild));
    await chmod(executable, 0o700);
  } else {
    const compiled = Bun.spawnSync([
      process.execPath,
      "build",
      "--compile",
      new URL("../src/main.ts", import.meta.url).pathname,
      "--outfile",
      executable,
    ]);
    if (compiled.exitCode !== 0) throw new Error(compiled.stderr.toString());
  }

  proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as {
        data?: { daemonApiKey?: string };
        method?: string;
        b64data?: string;
      };
      if (body.method) {
        if (body.method === DAEMON_RUNTIME_READY_METHOD && body.b64data) {
          readyRequests.push(
            decodeDaemonRuntimeReadyRequest(
              Uint8Array.from(atob(body.b64data), (character) => character.charCodeAt(0)),
            ),
          );
        }
        return Response.json({ result: { b64data: "" } });
      }
      const workspaceId =
        body.data?.daemonApiKey === "test-a"
          ? "a"
          : body.data?.daemonApiKey === "test-b"
            ? "b"
            : undefined;
      if (!workspaceId) return Response.json({ error: { code: 101, message: "unauthorized" } });
      return Response.json({
        result: {
          user: `test-${workspaceId}`,
          meta: { workspace_id: workspaceId, computer_id: "machine" },
          subs: { [`daemon:${workspaceId}:machine`]: {} },
        },
      });
    },
  });

  const portProbe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  if (!portProbe.port) throw new Error("Centrifugo port allocation failed");
  centrifugoPort = portProbe.port;
  portProbe.stop(true);
  const configPath = join(root, "centrifugo.yaml");
  await writeFile(
    configPath,
    `http_server:\n  port: ${centrifugoPort}\nhealth:\n  enabled: true\nadmin:\n  enabled: false\nlog:\n  level: error\nclient:\n  proxy:\n    connect:\n      enabled: true\n      endpoint: http://127.0.0.1:${proxy.port}/connect\n      timeout: 5s\nrpc:\n  proxy:\n    endpoint: http://127.0.0.1:${proxy.port}/rpc\n    timeout: 5s\n    binary_encoding: true\n    include_connection_meta: true\n  without_namespace:\n    proxy_enabled: true\n  namespaces:\n    - name: daemon\n      proxy_enabled: true\nchannel:\n  namespaces:\n    - name: daemon\n`,
    { mode: 0o600 },
  );
  containerName = `coforge-machine-lifecycle-${crypto.randomUUID()}`;
  const docker = Bun.spawnSync([
    "docker",
    "run",
    "--detach",
    "--rm",
    "--network",
    "host",
    "--name",
    containerName,
    "--volume",
    `${configPath}:/centrifugo/config.yaml:ro`,
    "centrifugo/centrifugo:v6.9.2",
    "centrifugo",
    "--config",
    "/centrifugo/config.yaml",
  ]);
  if (docker.exitCode !== 0) throw new Error(docker.stderr.toString());
  await waitFor(
    async () =>
      (await fetch(`http://127.0.0.1:${centrifugoPort}/health`).catch(() => null))?.ok === true,
    "Centrifugo did not become healthy",
  );
}, 60_000);

afterAll(async () => {
  if (containerName) Bun.spawnSync(["docker", "rm", "--force", containerName]);
  proxy?.stop(true);
  if (root) await rm(root, { recursive: true, force: true });
});

/** `coforge-computer __lifecycle status` for the supervisor under `home`, parsed with the contract
 * schema the installer's tests read. */
async function lifecycleStatus(home: string) {
  const child = Bun.spawn([executable, "__lifecycle", "status"], {
    env: { PATH: Bun.env.PATH, HOME: home },
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(exitCode).toBe(0);
  return LifecycleStatusSchema.parse(JSON.parse(stdout));
}

test("real compiled machine supervisor preserves Workspace lifecycle and recovery state", async () => {
  // The default state directory under a home of its own, so `__lifecycle` finds this supervisor.
  const home = join(root, "home");
  const stateDirectory = join(home, ".coforge", "daemon");
  const socketPath = join(stateDirectory, "daemon.sock");
  const spawn = () =>
    Bun.spawn(
      [executable, "__daemon", "--socket", socketPath, "--state-directory", stateDirectory],
      {
        env: {
          ...Bun.env,
          COFORGE_DAEMON_CONNECTION_ENDPOINT: `ws://127.0.0.1:${centrifugoPort}/connection/websocket`,
        },
        stdout: "ignore",
        stderr: "pipe",
      },
    );
  let supervisor = spawn();
  const client = new LocalDaemonLauncher({
    executablePath: executable,
    socketPath,
    stateDirectory,
    spawn: () => {},
  });
  try {
    await client.ensureRunning();
    await client.ensureStarted({
      workspaceId: "a",
      computerId: "machine",
      workspaceRoot: root,
      daemonApiKey: "test-a",
    });
    const firstA = (await client.control("snapshot"))[0]!;
    await client.ensureStarted({
      workspaceId: "b",
      computerId: "machine",
      workspaceRoot: root,
      daemonApiKey: "test-b",
    });
    const both = await client.control("snapshot");
    expect(both.find((runtime) => runtime.workspaceId === "a")?.processId).toBe(firstA.processId);
    expect(both.find((runtime) => runtime.workspaceId === "a")?.instanceId).toBe(firstA.instanceId);
    // `__lifecycle status` sees both running Workspaces with the supervisor's own process IDs.
    const running = await lifecycleStatus(home);
    expect(running).toMatchObject({ supervisor: { running: true }, healthy: true, problems: [] });
    expect(running.bindings).toEqual(
      expect.arrayContaining(
        both.map((runtime) => ({
          binding_id: runtime.workspaceId,
          enabled: true,
          running: true,
          process_id: runtime.processId,
        })),
      ),
    );

    await client.control("restart", "a", "stable-restart-a");
    const restarted = await client.control("snapshot");
    expect(restarted.find((runtime) => runtime.workspaceId === "a")?.processId).not.toBe(
      firstA.processId,
    );
    expect(restarted.find((runtime) => runtime.workspaceId === "b")?.processId).toBe(
      both.find((runtime) => runtime.workspaceId === "b")?.processId,
    );
    await client.control("restart", "a", "stable-restart-a");
    expect(await client.control("snapshot")).toEqual(restarted);
    await waitFor(
      () =>
        readyRequests.some(
          (ready) =>
            ready.workspaceId === "a" &&
            ready.recoveredRestartRequestIds?.includes("stable-restart-a"),
        ),
      "ready recovery evidence was not received",
    );

    await client.control("stop", "b");
    await client.control("start", "a");
    const orphanedAProcessId = (await client.control("snapshot")).find(
      (runtime) => runtime.workspaceId === "a",
    )!.processId;
    supervisor.kill("SIGKILL");
    expect(await supervisor.exited).not.toBe(0);
    // Workspace a is enabled and not parked, and nothing supervises it now.
    const orphaned = await lifecycleStatus(home);
    expect(orphaned).toMatchObject({
      supervisor: { running: false },
      healthy: false,
      problems: [{ code: SUPERVISOR_PROBLEM_CODE.SUPERVISOR_NOT_RUNNING }],
    });
    supervisor = spawn();
    await client.ensureRunning();
    const recovered = await client.control("snapshot");
    expect(recovered.find((runtime) => runtime.workspaceId === "a")?.processId).toBeGreaterThan(0);
    expect(recovered.find((runtime) => runtime.workspaceId === "a")?.processId).not.toBe(
      orphanedAProcessId,
    );
    expect(recovered.find((runtime) => runtime.workspaceId === "b")?.processId).toBe(0);
    for (const workspace of ["YQ", "Yg"]) {
      expect(
        await Bun.file(join(stateDirectory, "workspaces", workspace, "config.json")).exists(),
      ).toBe(true);
      expect(
        await Bun.file(
          join(
            stateDirectory,
            "workspaces",
            workspace,
            "credentials",
            `${workspace === "YQ" ? "a" : "b"}-machine.api-key`,
          ),
        ).exists(),
      ).toBe(true);
    }
  } finally {
    supervisor.kill("SIGTERM");
    await supervisor.exited;
  }
}, 120_000);
