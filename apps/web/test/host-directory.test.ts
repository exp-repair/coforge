import { describe, expect, test } from "bun:test";

import {
  HOST_ONLINE_WINDOW_MS,
  HostDirectory,
  HostDirectoryError,
  type HostRecord,
  type HostStore,
} from "#src/server/hosts/host-directory.server";
import { createHostHttpHandler } from "#src/server/hosts/host-http.server";

const now = new Date("2026-09-30T06:00:00.000Z");

class MemoryHostStore implements HostStore {
  private readonly records: HostRecord[] = [];

  async insert(record: HostRecord): Promise<void> {
    this.records.push({ ...record });
  }

  async findByTokenHash(tokenHash: string): Promise<HostRecord | undefined> {
    return this.records.find((record) => record.tokenHash === tokenHash);
  }

  async findByNodeKey(nodeKey: string): Promise<HostRecord | undefined> {
    return this.records.find((record) => record.nodeKey === nodeKey);
  }

  async save(record: HostRecord): Promise<void> {
    const index = this.records.findIndex((item) => item.id === record.id);
    this.records[index] = { ...record };
  }

  async listSeenSince(cutoff: Date): Promise<HostRecord[]> {
    return this.records.filter(
      (record) => record.lastSeenAt !== null && record.lastSeenAt.getTime() >= cutoff.getTime(),
    );
  }

  async findById(id: string): Promise<HostRecord | undefined> {
    return this.records.find((record) => record.id === id);
  }
}

function directory() {
  return new HostDirectory(new MemoryHostStore());
}

describe("HostDirectory", () => {
  test("a signed-in user enrolls a host, and any later listing includes every online host", async () => {
    const hosts = directory();
    const first = await hosts.issue({ registrarUserId: "user-a", name: "lab", now });
    const second = await hosts.issue({ registrarUserId: "user-b", name: "other", now });

    expect(first.token).toMatch(/^chn_[A-Za-z0-9_-]{43}$/);
    expect(second.token).not.toBe(first.token);
    expect(first).not.toHaveProperty("tokenHash");

    await hosts.register({ token: first.token, nodeKey: "machine-1", name: "lab", now });
    await hosts.register({ token: second.token, nodeKey: "machine-2", name: "other", now });

    expect(await hosts.listOnline(now)).toEqual([
      {
        id: first.id,
        name: "lab",
        nodeKey: "machine-1",
        registrarUserId: "user-a",
        lastSeenAt: "2026-09-30T06:00:00.000Z",
      },
      {
        id: second.id,
        name: "other",
        nodeKey: "machine-2",
        registrarUserId: "user-b",
        lastSeenAt: "2026-09-30T06:00:00.000Z",
      },
    ]);
  });

  test("a host drops off the list one millisecond after the online window", async () => {
    const hosts = directory();
    const issued = await hosts.issue({ registrarUserId: "user-a", name: "lab", now });
    await hosts.register({ token: issued.token, nodeKey: "machine-1", name: "lab", now });

    const stillOnline = new Date(now.getTime() + HOST_ONLINE_WINDOW_MS);
    const offline = new Date(now.getTime() + HOST_ONLINE_WINDOW_MS + 1);
    expect(await hosts.listOnline(stillOnline)).toHaveLength(1);
    expect(await hosts.listOnline(offline)).toEqual([]);
  });

  test("the same token can register the same node key again and keeps the host id", async () => {
    const hosts = directory();
    const issued = await hosts.issue({ registrarUserId: "user-a", name: "lab", now });
    const registered = await hosts.register({
      token: issued.token,
      nodeKey: "machine-1",
      name: "lab",
      now,
    });
    const later = new Date("2026-09-30T06:00:30.000Z");
    const again = await hosts.register({
      token: issued.token,
      nodeKey: "machine-1",
      name: "lab-renamed",
      now: later,
    });

    expect(again).toEqual({
      id: registered.id,
      name: "lab-renamed",
      nodeKey: "machine-1",
      registrarUserId: "user-a",
      lastSeenAt: "2026-09-30T06:00:30.000Z",
    });
  });

  test("a second token cannot take a node key, and a token cannot change its node key", async () => {
    const hosts = directory();
    const first = await hosts.issue({ registrarUserId: "user-a", name: "lab", now });
    const second = await hosts.issue({ registrarUserId: "user-b", name: "other", now });
    await hosts.register({ token: first.token, nodeKey: "machine-1", name: "lab", now });

    await expect(
      hosts.register({ token: second.token, nodeKey: "machine-1", name: "other", now }),
    ).rejects.toEqual(new HostDirectoryError(409, "node key already registered"));
    await expect(
      hosts.register({ token: first.token, nodeKey: "machine-2", name: "lab", now }),
    ).rejects.toEqual(new HostDirectoryError(409, "node key is already bound"));
  });

  test("register and heartbeat reject a token that was never issued", async () => {
    const hosts = directory();
    const token = `chn_${"a".repeat(43)}`;
    await expect(hosts.register({ token, nodeKey: "machine-1", name: "lab", now })).rejects.toEqual(
      new HostDirectoryError(401, "invalid host token"),
    );
    await expect(hosts.heartbeat({ token, now })).rejects.toEqual(
      new HostDirectoryError(401, "invalid host token"),
    );
  });
});

describe("host HTTP", () => {
  test("any signed-in user lists every online host, and a host token is not a user", async () => {
    const store = new MemoryHostStore();
    const hosts = new HostDirectory(store);
    const issued = await hosts.issue({ registrarUserId: "user-a", name: "lab", now });
    await hosts.register({ token: issued.token, nodeKey: "machine-1", name: "lab", now });
    const http = createHostHttpHandler({
      directory: hosts,
      authenticateUser: async (request) =>
        request.headers.get("cookie") === "session=user-b" ? { userId: "user-b" } : null,
      now: () => now,
    });

    const listed = await http.list(
      new Request("https://server.example/api/hosts", { headers: { cookie: "session=user-b" } }),
    );
    expect(await listed.json()).toEqual({
      hosts: [
        {
          id: issued.id,
          name: "lab",
          nodeKey: "machine-1",
          registrarUserId: "user-a",
          lastSeenAt: "2026-09-30T06:00:00.000Z",
        },
      ],
    });

    const asHost = await http.list(
      new Request("https://server.example/api/hosts", {
        headers: { authorization: `Bearer ${issued.token}` },
      }),
    );
    expect(asHost.status).toBe(401);
    expect(await asHost.json()).toEqual({
      error: { code: 401, message: "authentication required" },
    });
  });

  test("register accepts the host token and ignores a user session", async () => {
    const hosts = new HostDirectory(new MemoryHostStore());
    const issued = await hosts.issue({ registrarUserId: "user-a", name: "lab", now });
    const http = createHostHttpHandler({
      directory: hosts,
      authenticateUser: async () => {
        throw new Error("user session must not authorize a host");
      },
      now: () => now,
    });

    const response = await http.register(
      new Request("https://server.example/api/hosts/register", {
        method: "POST",
        headers: {
          authorization: `Bearer ${issued.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ nodeKey: "machine-1", name: "lab" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: issued.id,
      name: "lab",
      nodeKey: "machine-1",
      registrarUserId: "user-a",
      lastSeenAt: "2026-09-30T06:00:00.000Z",
    });
  });
});
