import type { ReleaseNotes } from "@lrm/coforge-sdk/internal";
import type { Prisma, PrismaClient } from "#src/generated/prisma/client";
import type { ReleaseCatalogStore, ReleaseNotesRecord } from "./release-catalog.server";

const SELECT = {
  app: true,
  version: true,
  notesEn: true,
  notesZhCn: true,
  updatedAt: true,
} satisfies Prisma.ReleaseCatalogReleaseSelect;

/** The catalog's rows in `release_catalog_releases`. Kept inside this module, not
 * `server/db/repositories/`, so the catalog leaves the Web together with its persistence. */
export class PrismaReleaseCatalogStore implements ReleaseCatalogStore {
  constructor(private readonly db: PrismaClient) {}

  async find(app: string, version: string): Promise<ReleaseNotesRecord | undefined> {
    const row = await this.db.releaseCatalogRelease.findUnique({
      where: { app_version: { app, version } },
      select: SELECT,
    });
    return row ? record(row) : undefined;
  }

  async upsert(app: string, version: string, notes: ReleaseNotes): Promise<ReleaseNotesRecord> {
    const text = { notesEn: notes.en, notesZhCn: notes["zh-CN"] };
    const row = await this.db.releaseCatalogRelease.upsert({
      where: { app_version: { app, version } },
      create: { app, version, ...text },
      update: text,
      select: SELECT,
    });
    return record(row);
  }
}

function record(
  row: Prisma.ReleaseCatalogReleaseGetPayload<{ select: typeof SELECT }>,
): ReleaseNotesRecord {
  return {
    app: row.app,
    version: row.version,
    notes: { en: row.notesEn, "zh-CN": row.notesZhCn },
    updatedAt: row.updatedAt,
  };
}
