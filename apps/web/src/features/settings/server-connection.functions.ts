import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { workspaceUserMiddleware } from "#src/features/auth/function-auth";
import { humanLabel } from "#src/lib/human-label";
import { AppError } from "#src/lib/app-error";
import { publicOrigin } from "#src/server/http/public-origin.server";
import { PrismaServerConnection } from "#src/server/db/repositories/server-connection.repositories.server";
import {
  ServerConnectionError,
  WorkspaceServerConnection,
  type ServerConnectionView,
} from "#src/server/workspaces/server-connection.server";
import type { PrismaClient } from "#src/generated/prisma/client";

function connections(db: PrismaClient) {
  return new WorkspaceServerConnection(new PrismaServerConnection(db));
}

function reject(error: unknown): never {
  if (error instanceof ServerConnectionError) {
    throw new AppError(error.status === 409 ? "CONFLICT" : "INVALID_INPUT");
  }
  throw error;
}

export const loadServerConnection = createServerFn({ method: "GET" })
  .middleware([workspaceUserMiddleware])
  .handler(async ({ context }): Promise<ServerConnectionView> => {
    return connections(context.db).read(context.workspaceId, new Date());
  });

export const submitServerConnection = createServerFn({ method: "POST" })
  .middleware([workspaceUserMiddleware])
  .handler(async ({ context }) => {
    const workspace = await context.db.workspace.findUnique({
      where: { id: context.workspaceId },
      select: { slug: true },
    });
    if (!workspace) throw new AppError("NOT_FOUND");
    const person = await context.db.user.findUnique({
      where: { id: context.user.id },
      select: { displayName: true, username: true },
    });
    if (!person) throw new AppError("NOT_FOUND");
    try {
      return await connections(context.db).submit({
        workspaceId: context.workspaceId,
        userId: context.user.id,
        submittedByName: humanLabel(person),
        installOrigin: publicOrigin(getRequest()),
        workspaceSlug: workspace.slug,
        now: new Date(),
      });
    } catch (error) {
      reject(error);
    }
  });
