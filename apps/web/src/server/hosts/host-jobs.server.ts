export class HostJobError extends Error {
  constructor(
    readonly status: 401 | 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "HostJobError";
  }
}

export type HostJobRecord = {
  id: string;
  hostId: string;
  workspaceId: string;
  workspaceSlug: string;
  computerId: string;
  requestedByUserId: string;
  idempotencyKey: string;
  name: string;
  daemonApiKey: string | null;
  containerId: string | null;
  createdAt: Date;
  reportedAt: Date | null;
};

export type HostJobSummary = {
  jobId: string;
  hostId: string;
  workspaceId: string;
  computerId: string;
  name: string;
  containerId: string | null;
};

export type ClaimedHostJob = {
  jobId: string;
  hostId: string;
  computerId: string;
  workspaceId: string;
  workspaceSlug: string;
  name: string;
  daemonApiKey: string;
};

export interface WorkspaceMembership {
  findAccessibleBySlug(
    slug: string,
    userId: string,
  ): Promise<{ id: string; slug: string } | undefined>;
}

export interface HostPresence {
  find(hostId: string): Promise<{ id: string } | undefined>;
  findOnline(hostId: string, now: Date): Promise<{ id: string } | undefined>;
  identify(token: string): Promise<{ id: string } | undefined>;
}

export interface CloudComputerRegistrar {
  register(input: {
    userId: string;
    workspaceId: string;
    name: string;
    machineId: string;
    kind: "cloud";
  }): Promise<{ computerId: string; daemonApiKey: string }>;
}

export interface HostJobStore {
  findByIdempotency(userId: string, idempotencyKey: string): Promise<HostJobRecord | undefined>;
  findById(id: string): Promise<HostJobRecord | undefined>;
  insert(record: HostJobRecord): Promise<void>;
  nextOpenForHost(hostId: string): Promise<HostJobRecord | undefined>;
  save(record: HostJobRecord): Promise<void>;
}

export class HostJobs {
  constructor(
    private readonly deps: {
      membership: WorkspaceMembership;
      hosts: HostPresence;
      computers: CloudComputerRegistrar;
      jobs: HostJobStore;
      machineId?: () => string;
    },
  ) {}

  async create(input: {
    userId: string;
    workspaceSlug: string;
    hostId: string;
    name: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<HostJobSummary> {
    const name = requireText(input.name, "invalid computer name");
    const idempotencyKey = requireText(input.idempotencyKey, "invalid idempotency key");
    const workspace = await this.deps.membership.findAccessibleBySlug(
      input.workspaceSlug.trim(),
      input.userId,
    );
    if (!workspace) throw new HostJobError(403, "workspace access denied");
    const host = await this.deps.hosts.find(input.hostId);
    if (!host) throw new HostJobError(404, "host not found");
    const online = await this.deps.hosts.findOnline(input.hostId, input.now);
    if (!online) throw new HostJobError(409, "host is offline");

    const existing = await this.deps.jobs.findByIdempotency(input.userId, idempotencyKey);
    if (existing) {
      if (existing.hostId !== input.hostId || existing.workspaceId !== workspace.id) {
        throw new HostJobError(409, "idempotency key already used");
      }
      return summary(existing);
    }

    const machineId = this.deps.machineId?.() ?? `cloud-${crypto.randomUUID()}`;
    const computer = await this.deps.computers.register({
      userId: input.userId,
      workspaceId: workspace.id,
      name,
      machineId,
      kind: "cloud",
    });
    const record: HostJobRecord = {
      id: crypto.randomUUID(),
      hostId: input.hostId,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      computerId: computer.computerId,
      requestedByUserId: input.userId,
      idempotencyKey,
      name,
      daemonApiKey: computer.daemonApiKey,
      containerId: null,
      createdAt: input.now,
      reportedAt: null,
    };
    await this.deps.jobs.insert(record);
    return summary(record);
  }

  async claim(input: { token: string; now: Date }): Promise<ClaimedHostJob | undefined> {
    const host = await this.deps.hosts.identify(input.token);
    if (!host) throw new HostJobError(401, "invalid host token");
    const job = await this.deps.jobs.nextOpenForHost(host.id);
    if (!job?.daemonApiKey) return undefined;
    return {
      jobId: job.id,
      hostId: job.hostId,
      computerId: job.computerId,
      workspaceId: job.workspaceId,
      workspaceSlug: job.workspaceSlug,
      name: job.name,
      daemonApiKey: job.daemonApiKey,
    };
  }

  async report(input: {
    token: string;
    jobId: string;
    containerId: string;
    now: Date;
  }): Promise<HostJobSummary> {
    const host = await this.deps.hosts.identify(input.token);
    if (!host) throw new HostJobError(401, "invalid host token");
    const containerId = requireText(input.containerId, "invalid container id");
    const job = await this.deps.jobs.findById(input.jobId);
    if (!job || job.hostId !== host.id) throw new HostJobError(404, "job not found");
    job.containerId = containerId;
    job.reportedAt = input.now;
    job.daemonApiKey = null;
    await this.deps.jobs.save(job);
    return summary(job);
  }
}

function summary(job: HostJobRecord): HostJobSummary {
  return {
    jobId: job.id,
    hostId: job.hostId,
    workspaceId: job.workspaceId,
    computerId: job.computerId,
    name: job.name,
    containerId: job.containerId,
  };
}

function requireText(value: string, message: string): string {
  const text = value.trim();
  if (!text || text.length > 200 || /[\r\n]/.test(text)) throw new HostJobError(422, message);
  return text;
}
