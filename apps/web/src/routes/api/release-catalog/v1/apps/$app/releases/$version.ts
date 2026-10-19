import { createFileRoute } from "@tanstack/react-router";

import { productionReleaseCatalogHttp } from "#src/server/release-catalog/release-catalog-production.server";

/** One app release's notes in the release catalog: GET reads them, PUT (publish token) writes them. */
export const Route = createFileRoute("/api/release-catalog/v1/apps/$app/releases/$version")({
  server: {
    handlers: {
      GET: ({ params }) => productionReleaseCatalogHttp().read(params.app, params.version),
      PUT: ({ request, params }) =>
        productionReleaseCatalogHttp().publish(request, params.app, params.version),
    },
  },
});
