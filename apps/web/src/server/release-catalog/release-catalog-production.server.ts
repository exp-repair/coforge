import { requireDatabaseClient } from "#src/server/db/client.server";
import { createReleaseCatalogHttp } from "./release-catalog-http.server";
import { createReleaseCatalog } from "./release-catalog.server";
import { PrismaReleaseCatalogStore } from "./release-catalog.repositories.server";

/** The catalog over this deployment's PostgreSQL: what other Web modules read in-process. */
export function productionReleaseCatalog() {
  return createReleaseCatalog(new PrismaReleaseCatalogStore(requireDatabaseClient()));
}

/** The REST contract, with writes allowed only for the configured publish token's hash. */
export function productionReleaseCatalogHttp() {
  return createReleaseCatalogHttp({
    catalog: productionReleaseCatalog(),
    publishTokenSha256: process.env.COFORGE_RELEASE_CATALOG_PUBLISH_TOKEN_SHA256,
  });
}
