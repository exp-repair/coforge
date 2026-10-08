import type { PrismaClient } from "#src/generated/prisma/client";
import { prepareDaemonApiKey } from "#src/server/auth/daemon-api-key.server";
import type {
  CloudComputerRegistrar,
  HostJobRecord,
  HostJobStore,
} from "#src/server/hosts/host-jobs.server";

export class PrismaCloudComputerRegistrar implements CloudComputerRegistrar {
  constructor(private readonly db: PrismaClient) {}

  async register(input: {
    userId: string;
    workspaceId: string;
    name: string;
    machineId: string;
    kind: "cloud";
  }): Promise<{ computerId: string; daemonApiKey: string }> {
    return this.db.$transaction(async (tx) => {
      const computer = await tx.computer.create({
        data: {
          ownerId: input.userId,
          machineId: input.machineId,
          name: input.name,
          displayName: input.name,
          kind: input.kind,
        },
      });
      const daemonApiKey = prepareDaemonApiKey({
        principal: { userId: input.userId },
        workspaceId: input.workspaceId,
        computerId: computer.id,
      });
      await tx.workspaceComputer.create({
        data: { workspaceId: input.workspaceId, computerId: computer.id },
      });
      await tx.daemonApiKey.create({ data: daemonApiKey.record });
      return { computerId: computer.id, daemonApiKey: daemonApiKey.apiKey };
    });
  }
}

export class PrismaHostJobStore implements HostJobStore {
  constructor(private readonly db: PrismaClient) {}

  async findByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<HostJobRecord | undefined> {
    return (
      (await this.db.hostJob.findUnique({
        where: { requestedByUserId_idempotencyKey: { requestedByUserId: userId, idempotencyKey } },
      })) ?? undefined
    );
  }

  async findById(id: string): Promise<HostJobRecord | undefined> {
    return (await this.db.hostJob.findUnique({ where: { id } })) ?? undefined;
  }

  async insert(record: HostJobRecord): Promise<void> {
    await this.db.hostJob.create({ data: record });
  }

  async nextOpenForHost(hostId: string): Promise<HostJobRecord | undefined> {
    return (
      (await this.db.hostJob.findFirst({
        where: { hostId, reportedAt: null },
        orderBy: { createdAt: "asc" },
      })) ?? undefined
    );
  }

  async save(record: HostJobRecord): Promise<void> {
    await this.db.hostJob.update({
      where: { id: record.id },
      data: {
        containerId: record.containerId,
        reportedAt: record.reportedAt,
        daemonApiKey: record.daemonApiKey,
      },
    });
  }
}
