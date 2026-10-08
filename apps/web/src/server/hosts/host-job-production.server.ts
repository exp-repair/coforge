import { optionalBrowserUser } from "#src/server/auth/require-user.server";
import { requireDatabaseClient } from "#src/server/db/client.server";
import { PrismaHostStore } from "#src/server/db/repositories/host-directory.repositories.server";
import {
  PrismaCloudComputerRegistrar,
  PrismaHostJobStore,
} from "#src/server/db/repositories/host-job.repositories.server";
import { PrismaWorkspaceAccess } from "#src/server/db/repositories/setup.repositories.server";
import { HostDirectory } from "./host-directory.server";
import { createHostJobHttpHandler } from "./host-job-http.server";
import { HostJobs } from "./host-jobs.server";

export function productionHostJobs() {
  const db = requireDatabaseClient();
  const hosts = new HostDirectory(new PrismaHostStore(db));
  const membership = new PrismaWorkspaceAccess(db);
  return createHostJobHttpHandler({
    jobs: new HostJobs({
      membership: {
        findAccessibleBySlug: async (slug, userId) => {
          const workspace = await membership.findAccessibleBySlug(slug, { userId });
          return workspace ? { id: workspace.id, slug: workspace.slug } : undefined;
        },
      },
      hosts,
      computers: new PrismaCloudComputerRegistrar(db),
      jobs: new PrismaHostJobStore(db),
    }),
    authenticateUser: async (request) => {
      const user = await optionalBrowserUser(request.headers.get("cookie") ?? undefined);
      return user ? { userId: user.id } : null;
    },
    now: () => new Date(),
  });
}
