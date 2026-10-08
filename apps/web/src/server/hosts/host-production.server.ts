import { optionalBrowserUser } from "#src/server/auth/require-user.server";
import { requireDatabaseClient } from "#src/server/db/client.server";
import { PrismaHostStore } from "#src/server/db/repositories/host-directory.repositories.server";
import { HostDirectory } from "./host-directory.server";
import { createHostHttpHandler } from "./host-http.server";

export function productionHostHttp() {
  const db = requireDatabaseClient();
  return createHostHttpHandler({
    directory: new HostDirectory(new PrismaHostStore(db)),
    authenticateUser: async (request) => {
      const user = await optionalBrowserUser(request.headers.get("cookie") ?? undefined);
      return user ? { userId: user.id } : null;
    },
    now: () => new Date(),
  });
}
