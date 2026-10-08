import { createFileRoute } from "@tanstack/react-router";

import { productionHostHttp } from "#src/server/hosts/host-production.server";

export const Route = createFileRoute("/api/hosts/")({
  server: {
    handlers: {
      GET: ({ request }) => productionHostHttp().list(request),
      POST: ({ request }) => productionHostHttp().issue(request),
    },
  },
});
