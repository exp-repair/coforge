import { expect, test } from "bun:test";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "#src/generated/prisma/client";
import { PrismaReleaseCatalogStore } from "#src/server/release-catalog/release-catalog.repositories.server";

/** The release catalog's PostgreSQL store against local PostgreSQL with migrations applied. */
test("a release is created once, then its notes are overwritten in place", async () => {
  const connectionString = Bun.env.RELEASE_CATALOG_TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error("RELEASE_CATALOG_TEST_DATABASE_URL must point to local PostgreSQL");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  // A random app per run, so the rows never collide with another run's and cleanup is exact.
  const app = `catalog-test-${crypto.randomUUID().slice(0, 8)}`;
  const store = new PrismaReleaseCatalogStore(db);
  try {
    expect(await store.find(app, "0.1.4-dev.2")).toBeUndefined();

    const created = await store.upsert(app, "0.1.4-dev.2", { en: "First", "zh-CN": "第一版" });
    expect(created).toMatchObject({
      app,
      version: "0.1.4-dev.2",
      notes: { en: "First", "zh-CN": "第一版" },
    });

    // Backdate the row so the overwrite's timestamp is observably later without waiting on a clock.
    const backdated = new Date("2026-01-01T00:00:00.000Z");
    await db.releaseCatalogRelease.update({
      where: { app_version: { app, version: "0.1.4-dev.2" } },
      data: { updatedAt: backdated },
    });
    const edited = await store.upsert(app, "0.1.4-dev.2", { en: "Edited", "zh-CN": "已修改" });
    expect(edited.notes).toEqual({ en: "Edited", "zh-CN": "已修改" });
    expect(edited.updatedAt.getTime()).toBeGreaterThan(backdated.getTime());
    expect(await store.find(app, "0.1.4-dev.2")).toEqual(edited);
    expect(await db.releaseCatalogRelease.count({ where: { app } })).toBe(1);

    // Another version of the same app is its own release.
    expect(await store.find(app, "0.1.4")).toBeUndefined();
  } finally {
    await db.releaseCatalogRelease.deleteMany({ where: { app } });
    await db.$disconnect();
  }
});
