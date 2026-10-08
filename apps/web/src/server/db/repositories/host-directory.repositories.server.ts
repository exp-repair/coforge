import type { PrismaClient } from "#src/generated/prisma/client";
import type { HostRecord, HostStore } from "#src/server/hosts/host-directory.server";

export class PrismaHostStore implements HostStore {
  constructor(private readonly db: PrismaClient) {}

  async insert(record: HostRecord): Promise<void> {
    await this.db.hostNode.create({ data: record });
  }

  async findByTokenHash(tokenHash: string): Promise<HostRecord | undefined> {
    return (await this.db.hostNode.findUnique({ where: { tokenHash } })) ?? undefined;
  }

  async findByNodeKey(nodeKey: string): Promise<HostRecord | undefined> {
    return (await this.db.hostNode.findUnique({ where: { nodeKey } })) ?? undefined;
  }

  async save(record: HostRecord): Promise<void> {
    await this.db.hostNode.update({
      where: { id: record.id },
      data: {
        name: record.name,
        nodeKey: record.nodeKey,
        lastSeenAt: record.lastSeenAt,
      },
    });
  }

  async listSeenSince(cutoff: Date): Promise<HostRecord[]> {
    return this.db.hostNode.findMany({
      where: { lastSeenAt: { gte: cutoff } },
    });
  }

  async findById(id: string): Promise<HostRecord | undefined> {
    return (await this.db.hostNode.findUnique({ where: { id } })) ?? undefined;
  }
}
