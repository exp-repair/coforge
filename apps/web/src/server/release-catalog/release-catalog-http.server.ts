import {
  parseReleaseKey,
  parseReleaseNotes,
  publishPermission,
  type ReleaseCatalog,
  type ReleaseNotesRecord,
} from "./release-catalog.server";

/**
 * The catalog's REST contract, `/api/release-catalog/v1/apps/{app}/releases/{version}`: anyone
 * reads (GET), a holder of the publish token writes (PUT). The route file only forwards here.
 */
export function createReleaseCatalogHttp(dependencies: {
  catalog: ReleaseCatalog;
  /** The configured SHA-256 hex of the publish token; unset or malformed disables writes. */
  publishTokenSha256: string | undefined;
}) {
  const { catalog, publishTokenSha256 } = dependencies;
  return {
    async read(app: string, version: string): Promise<Response> {
      if (!parseReleaseKey(app, version)) return refused(400, "invalid_request");
      const release = await catalog.getReleaseNotes(app, version);
      return release ? releaseResponse(release) : refused(404, "not_found");
    },
    async publish(request: Request, app: string, version: string): Promise<Response> {
      const permission = publishPermission(
        request.headers.get("authorization"),
        publishTokenSha256,
      );
      if (permission === "disabled") return refused(503, "publishing_disabled");
      if (permission === "denied") return refused(401, "unauthorized");
      const key = parseReleaseKey(app, version);
      const notes = parseReleaseNotes(await request.json().catch(() => undefined));
      if (!key || !notes) return refused(400, "invalid_request");
      return releaseResponse(await catalog.putReleaseNotes(key, notes));
    },
  };
}

/** Notes stay editable after publish, so a reader revalidates rather than keeping a copy. */
const CACHE_CONTROL = "no-cache";

function releaseResponse(release: ReleaseNotesRecord): Response {
  return Response.json(
    {
      app: release.app,
      version: release.version,
      notes: release.notes,
      updatedAt: release.updatedAt.toISOString(),
    },
    { headers: { "cache-control": CACHE_CONTROL } },
  );
}

function refused(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}
