import { randomBytes, timingSafeEqual } from "node:crypto";

export const HOST_ONLINE_WINDOW_MS = 90_000;

const HOST_TOKEN = /^chn_[A-Za-z0-9_-]{43}$/;

export class HostDirectoryError extends Error {
  constructor(
    readonly status: 401 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = "HostDirectoryError";
  }
}

export type HostRecord = {
  id: string;
  name: string;
  nodeKey: string | null;
  tokenHash: string;
  registrarUserId: string;
  lastSeenAt: Date | null;
};

export type HostSnapshot = {
  id: string;
  name: string;
  nodeKey: string;
  registrarUserId: string;
  lastSeenAt: string;
};

export interface HostStore {
  insert(record: HostRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<HostRecord | undefined>;
  findByNodeKey(nodeKey: string): Promise<HostRecord | undefined>;
  save(record: HostRecord): Promise<void>;
  listSeenSince(cutoff: Date): Promise<HostRecord[]>;
  findById(id: string): Promise<HostRecord | undefined>;
}

export class HostDirectory {
  constructor(private readonly store: HostStore) {}

  async issue(input: { registrarUserId: string; name: string; now: Date }): Promise<{
    id: string;
    name: string;
    token: string;
  }> {
    const name = requireName(input.name);
    const token = `chn_${randomBytes(32).toString("base64url")}`;
    const id = crypto.randomUUID();
    await this.store.insert({
      id,
      name,
      nodeKey: null,
      tokenHash: hashHostToken(token),
      registrarUserId: input.registrarUserId,
      lastSeenAt: null,
    });
    return { id, name, token };
  }

  async register(input: {
    token: string;
    nodeKey: string;
    name: string;
    now: Date;
  }): Promise<HostSnapshot> {
    const record = await this.authenticate(input.token);
    const nodeKey = requireNodeKey(input.nodeKey);
    const name = requireName(input.name);
    if (record.nodeKey === null) {
      const taken = await this.store.findByNodeKey(nodeKey);
      if (taken && taken.id !== record.id) {
        throw new HostDirectoryError(409, "node key already registered");
      }
      record.nodeKey = nodeKey;
    } else if (record.nodeKey !== nodeKey) {
      throw new HostDirectoryError(409, "node key is already bound");
    }
    record.name = name;
    record.lastSeenAt = input.now;
    await this.store.save(record);
    return snapshot(record);
  }

  async heartbeat(input: { token: string; now: Date }): Promise<HostSnapshot> {
    const record = await this.authenticate(input.token);
    if (record.nodeKey === null) throw new HostDirectoryError(422, "host is not registered");
    record.lastSeenAt = input.now;
    await this.store.save(record);
    return snapshot(record);
  }

  async find(hostId: string): Promise<{ id: string } | undefined> {
    const record = await this.store.findById(hostId);
    return record ? { id: record.id } : undefined;
  }

  async findOnline(hostId: string, now: Date): Promise<{ id: string } | undefined> {
    const record = await this.store.findById(hostId);
    if (!record?.nodeKey || !record.lastSeenAt) return undefined;
    if (record.lastSeenAt.getTime() < now.getTime() - HOST_ONLINE_WINDOW_MS) return undefined;
    return { id: record.id };
  }

  async identify(token: string): Promise<{ id: string } | undefined> {
    if (!HOST_TOKEN.test(token)) return undefined;
    const record = await this.store.findByTokenHash(hashHostToken(token));
    if (!record?.nodeKey) return undefined;
    const expected = Buffer.from(record.tokenHash);
    const actual = Buffer.from(hashHostToken(token));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
    return { id: record.id };
  }

  async listOnline(now: Date): Promise<HostSnapshot[]> {
    const cutoff = new Date(now.getTime() - HOST_ONLINE_WINDOW_MS);
    const records = await this.store.listSeenSince(cutoff);
    return records
      .filter((record) => record.nodeKey !== null && record.lastSeenAt !== null)
      .map(snapshot)
      .sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      );
  }

  private async authenticate(token: string): Promise<HostRecord> {
    if (!HOST_TOKEN.test(token)) throw new HostDirectoryError(401, "invalid host token");
    const tokenHash = hashHostToken(token);
    const record = await this.store.findByTokenHash(tokenHash);
    if (!record) throw new HostDirectoryError(401, "invalid host token");
    const expected = Buffer.from(record.tokenHash);
    const actual = Buffer.from(tokenHash);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new HostDirectoryError(401, "invalid host token");
    }
    return record;
  }
}

function snapshot(record: HostRecord): HostSnapshot {
  if (record.nodeKey === null || record.lastSeenAt === null) {
    throw new HostDirectoryError(422, "host is not registered");
  }
  return {
    id: record.id,
    name: record.name,
    nodeKey: record.nodeKey,
    registrarUserId: record.registrarUserId,
    lastSeenAt: record.lastSeenAt.toISOString(),
  };
}

function requireName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 200) throw new HostDirectoryError(422, "invalid host name");
  return name;
}

function requireNodeKey(value: string): string {
  const nodeKey = value.trim();
  if (!nodeKey || nodeKey.length > 200 || /\s/.test(nodeKey)) {
    throw new HostDirectoryError(422, "invalid node key");
  }
  return nodeKey;
}

function hashHostToken(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}
