import { describe, expect, test } from "bun:test";

import { HostJobError, HostJobs, type HostJobRecord } from "#src/server/hosts/host-jobs.server";
import { createHostJobHttpHandler } from "#src/server/hosts/host-job-http.server";

const now = new Date("2026-09-30T06:00:00.000Z");
const daemonKey = `dk_${"b".repeat(43)}`;

class MemoryJobs {
  readonly records: HostJobRecord[] = [];
  async findByIdempotency(userId: string, idempotencyKey: string) {
    return this.records.find(
      (job) => job.requestedByUserId === userId && job.idempotencyKey === idempotencyKey,
    );
  }
  async findById(id: string) {
    return this.records.find((job) => job.id === id);
  }
  async insert(record: HostJobRecord) {
    this.records.push({ ...record });
  }
  async nextOpenForHost(hostId: string) {
    return this.records
      .filter((job) => job.hostId === hostId && job.reportedAt === null)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
  }
  async save(record: HostJobRecord) {
    const index = this.records.findIndex((job) => job.id === record.id);
    this.records[index] = { ...record };
  }
}

function harness(input?: { member?: boolean; online?: boolean }) {
  const jobs = new MemoryJobs();
  const registered: Array<{
    machineId: string;
    kind: string;
    userId: string;
    workspaceId: string;
  }> = [];
  const hosts = new HostJobs({
    membership: {
      findAccessibleBySlug: async (slug, userId) =>
        input?.member === false || slug !== "alpha" || userId !== "user-a"
          ? undefined
          : { id: "workspace-1", slug },
    },
    hosts: {
      find: async (hostId) => (hostId === "host-1" ? { id: hostId } : undefined),
      findOnline: async (hostId) =>
        hostId === "host-1" && input?.online !== false ? { id: hostId } : undefined,
      identify: async (token) => {
        if (token === "host-token") return { id: "host-1" };
        if (token === "other-token") return { id: "host-2" };
        return undefined;
      },
    },
    computers: {
      register: async (registration) => {
        registered.push({
          machineId: registration.machineId,
          kind: registration.kind,
          userId: registration.userId,
          workspaceId: registration.workspaceId,
        });
        return { computerId: `computer-${registered.length}`, daemonApiKey: daemonKey };
      },
    },
    jobs,
    machineId: () => "cloud-machine-1",
  });
  return { hosts, jobs, registered };
}

describe("HostJobs", () => {
  test("a workspace member creates one cloud computer job and the host token claims the daemon key", async () => {
    const { hosts, jobs, registered } = harness();
    const created = await hosts.create({
      userId: "user-a",
      workspaceSlug: "alpha",
      hostId: "host-1",
      name: "lab",
      idempotencyKey: "create-1",
      now,
    });

    expect(created).toEqual({
      jobId: created.jobId,
      hostId: "host-1",
      workspaceId: "workspace-1",
      computerId: "computer-1",
      name: "lab",
      containerId: null,
    });
    expect(JSON.stringify(created)).not.toContain(daemonKey);
    expect(registered).toEqual([
      {
        machineId: "cloud-machine-1",
        kind: "cloud",
        userId: "user-a",
        workspaceId: "workspace-1",
      },
    ]);
    expect(jobs.records[0]?.daemonApiKey).toBe(daemonKey);

    const claimed = await hosts.claim({ token: "host-token", now });
    expect(claimed).toEqual({
      jobId: created.jobId,
      hostId: "host-1",
      computerId: "computer-1",
      workspaceId: "workspace-1",
      workspaceSlug: "alpha",
      name: "lab",
      daemonApiKey: daemonKey,
    });

    const reported = await hosts.report({
      token: "host-token",
      jobId: created.jobId,
      containerId: "container-1",
      now,
    });
    expect(reported.containerId).toBe("container-1");
    expect(jobs.records[0]?.daemonApiKey).toBeNull();
    expect(await hosts.claim({ token: "host-token", now })).toBeUndefined();
  });

  test("the same idempotency key does not register a second computer", async () => {
    const { hosts, registered } = harness();
    const first = await hosts.create({
      userId: "user-a",
      workspaceSlug: "alpha",
      hostId: "host-1",
      name: "lab",
      idempotencyKey: "create-1",
      now,
    });
    const second = await hosts.create({
      userId: "user-a",
      workspaceSlug: "alpha",
      hostId: "host-1",
      name: "lab",
      idempotencyKey: "create-1",
      now,
    });
    expect(second.jobId).toBe(first.jobId);
    expect(registered).toEqual([
      {
        machineId: "cloud-machine-1",
        kind: "cloud",
        userId: "user-a",
        workspaceId: "workspace-1",
      },
    ]);
  });

  test("a non-member and an offline host do not register a computer", async () => {
    const outsider = harness({ member: false });
    await expect(
      outsider.hosts.create({
        userId: "user-a",
        workspaceSlug: "alpha",
        hostId: "host-1",
        name: "lab",
        idempotencyKey: "create-1",
        now,
      }),
    ).rejects.toEqual(new HostJobError(403, "workspace access denied"));
    expect(outsider.registered).toEqual([]);

    const offline = harness({ online: false });
    await expect(
      offline.hosts.create({
        userId: "user-a",
        workspaceSlug: "alpha",
        hostId: "host-1",
        name: "lab",
        idempotencyKey: "create-1",
        now,
      }),
    ).rejects.toEqual(new HostJobError(409, "host is offline"));
    expect(offline.registered).toEqual([]);
  });

  test("another host token cannot report the job", async () => {
    const { hosts } = harness();
    const created = await hosts.create({
      userId: "user-a",
      workspaceSlug: "alpha",
      hostId: "host-1",
      name: "lab",
      idempotencyKey: "create-1",
      now,
    });
    await expect(
      hosts.report({
        token: "other-token",
        jobId: created.jobId,
        containerId: "container-1",
        now,
      }),
    ).rejects.toEqual(new HostJobError(404, "job not found"));
  });
});

describe("host job HTTP", () => {
  test("a user session creates a job and cannot claim it; a host token claims and is not a user", async () => {
    const { hosts } = harness();
    const http = createHostJobHttpHandler({
      jobs: hosts,
      authenticateUser: async (request) =>
        request.headers.get("cookie") === "session=user-a" ? { userId: "user-a" } : null,
      now: () => now,
    });

    const created = await http.create(
      new Request("https://server.example/api/hosts/host-1/jobs", {
        method: "POST",
        headers: { cookie: "session=user-a", "content-type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "alpha", name: "lab", idempotencyKey: "create-1" }),
      }),
      "host-1",
    );
    expect(created.status).toBe(200);
    const body = await created.json();
    expect(body).toMatchObject({ computerId: "computer-1", containerId: null });
    expect(JSON.stringify(body)).not.toContain(daemonKey);

    const claimAsUser = await http.claim(
      new Request("https://server.example/api/hosts/jobs/claim", {
        method: "POST",
        headers: { cookie: "session=user-a" },
      }),
    );
    expect(claimAsUser.status).toBe(401);

    const claimAsHost = await http.claim(
      new Request("https://server.example/api/hosts/jobs/claim", {
        method: "POST",
        headers: { authorization: "Bearer host-token" },
      }),
    );
    expect(await claimAsHost.json()).toMatchObject({ job: { daemonApiKey: daemonKey } });

    const createAsHost = await http.create(
      new Request("https://server.example/api/hosts/host-1/jobs", {
        method: "POST",
        headers: { authorization: "Bearer host-token", "content-type": "application/json" },
        body: JSON.stringify({ workspaceSlug: "alpha", name: "lab", idempotencyKey: "create-2" }),
      }),
      "host-1",
    );
    expect(createAsHost.status).toBe(401);
  });
});
