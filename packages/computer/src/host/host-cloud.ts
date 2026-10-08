export type ClaimedContainerJob = {
  jobId: string;
  hostId: string;
  computerId: string;
  workspaceId: string;
  workspaceSlug: string;
  name: string;
  daemonApiKey: string;
};

export class HttpHostCloud {
  constructor(
    private readonly fetchImpl: typeof fetch,
    serverUrl: string,
  ) {
    this.origin = serverUrl.replace(/\/+$/, "");
  }

  private readonly origin: string;

  async register(input: { token: string; nodeKey: string; name: string }): Promise<void> {
    await this.post("/api/hosts/register", input.token, {
      nodeKey: input.nodeKey,
      name: input.name,
    });
  }

  async heartbeat(token: string): Promise<void> {
    await this.post("/api/hosts/heartbeat", token);
  }

  async claim(token: string): Promise<ClaimedContainerJob | null> {
    const body = (await this.post("/api/hosts/jobs/claim", token)) as { job?: unknown };
    if (body.job == null) return null;
    return claimedJob(body.job);
  }

  async report(token: string, jobId: string, containerId: string): Promise<void> {
    await this.post(`/api/hosts/jobs/${encodeURIComponent(jobId)}/report`, token, { containerId });
  }

  private async post(path: string, token: string, body?: Record<string, string>): Promise<unknown> {
    const response = await this.fetchImpl(`${this.origin}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `host request failed (${response.status})`);
    if (!text) return {};
    return JSON.parse(text) as unknown;
  }
}

function claimedJob(value: unknown): ClaimedContainerJob {
  if (!value || typeof value !== "object") throw new Error("invalid claimed job");
  const job = value as Record<string, unknown>;
  return {
    jobId: requiredString(job.jobId),
    hostId: requiredString(job.hostId),
    computerId: requiredString(job.computerId),
    workspaceId: requiredString(job.workspaceId),
    workspaceSlug: requiredString(job.workspaceSlug),
    name: requiredString(job.name),
    daemonApiKey: requiredString(job.daemonApiKey),
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("invalid claimed job");
  return value;
}
