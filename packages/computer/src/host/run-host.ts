import type { ContainerRuntime } from "./docker-containers";
import { createDockerContainers } from "./docker-containers";
import { HttpHostCloud, type ClaimedContainerJob } from "./host-cloud";

export const HOST_POLL_INTERVAL_MS = 5_000;

export type { ClaimedContainerJob };

export type HostProcessConfig = {
  serverUrl: string;
  token: string;
  nodeKey: string;
  name: string;
  image: string;
  pollIntervalMs: number;
};

export interface HostCloud {
  register(input: { token: string; nodeKey: string; name: string }): Promise<void>;
  heartbeat(token: string): Promise<void>;
  claim(token: string): Promise<ClaimedContainerJob | null>;
  report(token: string, jobId: string, containerId: string): Promise<void>;
}

export async function acceptClaimedJob(
  job: ClaimedContainerJob,
  config: Pick<HostProcessConfig, "serverUrl" | "image">,
  ports: {
    containers: ContainerRuntime;
    report: (containerId: string) => Promise<unknown>;
  },
): Promise<string> {
  const existing = await ports.containers.findByComputerId(job.computerId);
  const containerId =
    existing ??
    (await ports.containers.run({
      computerId: job.computerId,
      image: config.image,
      env: {
        COFORGE_DAEMON_API_KEY: job.daemonApiKey,
        COFORGE_WORKSPACE_ID: job.workspaceId,
        COFORGE_WORKSPACE_SLUG: job.workspaceSlug,
        COFORGE_COMPUTER_ID: job.computerId,
        COFORGE_COMPUTER_NAME: job.name,
        COFORGE_SERVER_URL: config.serverUrl.replace(/\/+$/, ""),
      },
    }));
  await ports.report(containerId);
  return containerId;
}

export async function runHost(
  config: HostProcessConfig,
  ports: {
    cloud: HostCloud;
    containers: ContainerRuntime;
    wait: (signal: AbortSignal) => Promise<void>;
  },
  signal: AbortSignal,
): Promise<void> {
  await ports.cloud.register({
    token: config.token,
    nodeKey: config.nodeKey,
    name: config.name,
  });
  while (!signal.aborted) {
    await ports.cloud.heartbeat(config.token);
    const job = await ports.cloud.claim(config.token);
    if (job) {
      await acceptClaimedJob(job, config, {
        containers: ports.containers,
        report: (containerId) => ports.cloud.report(config.token, job.jobId, containerId),
      });
    }
    if (signal.aborted) return;
    await ports.wait(signal);
  }
}

export async function runHostProcess(config: HostProcessConfig): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await runHost(
      config,
      {
        cloud: new HttpHostCloud(fetch, config.serverUrl),
        containers: createDockerContainers(),
        wait: (signal) => delay(config.pollIntervalMs, signal),
      },
      controller.signal,
    );
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
