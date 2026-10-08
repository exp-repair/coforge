import { createFileRoute } from "@tanstack/react-router";

import { productionHostJobs } from "#src/server/hosts/host-job-production.server";

export const Route = createFileRoute("/api/hosts/$hostId/jobs")({
  server: {
    handlers: {
      POST: ({ request, params }) => productionHostJobs().create(request, params.hostId),
    },
  },
});
