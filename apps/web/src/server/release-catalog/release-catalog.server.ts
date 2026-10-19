import { timingSafeEqual } from "node:crypto";
import {
  isValidReleaseVersion,
  RELEASE_NOTES_MAX_LENGTH,
  type ReleaseNotes,
} from "@lrm/coforge-sdk/internal";
import { z } from "zod";

/**
 * The release catalog: each app release's notes, in English and Simplified Chinese.
 *
 * Self-contained so it can leave the Web for its own service whole (`AGENTS.md` here): it knows
 * apps and versions, never Workspaces, Computers or Users.
 */

export type ReleaseNotesRecord = {
  app: string;
  version: string;
  notes: ReleaseNotes;
  updatedAt: Date;
};

/** Where the catalog keeps its rows; `PrismaReleaseCatalogStore` in production. */
export interface ReleaseCatalogStore {
  find(app: string, version: string): Promise<ReleaseNotesRecord | undefined>;
  /** Creates the release, or overwrites the notes of the one already there. */
  upsert(app: string, version: string, notes: ReleaseNotes): Promise<ReleaseNotesRecord>;
}

type ReleaseKey = { app: string; version: string };

const APP_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The release an `app` and `version` name, or `undefined` when either is malformed. */
export function parseReleaseKey(app: string, version: string): ReleaseKey | undefined {
  return APP_SLUG.test(app) && isValidReleaseVersion(version) ? { app, version } : undefined;
}

const noteText = z.string().trim().min(1).max(RELEASE_NOTES_MAX_LENGTH);
const publishBody = z.strictObject({
  notes: z.strictObject({ en: noteText, "zh-CN": noteText }),
});

/** The notes a publish body carries, trimmed, or `undefined` when the body is not one. */
export function parseReleaseNotes(body: unknown): ReleaseNotes | undefined {
  const parsed = publishBody.safeParse(body);
  return parsed.success ? parsed.data.notes : undefined;
}

export function createReleaseCatalog(store: ReleaseCatalogStore) {
  return {
    /** A release's notes, or `null` when the release is unknown or its name is malformed. */
    async getReleaseNotes(app: string, version: string): Promise<ReleaseNotesRecord | null> {
      const key = parseReleaseKey(app, version);
      if (!key) return null;
      return (await store.find(key.app, key.version)) ?? null;
    },
    /** Writes a release's notes, overwriting earlier ones: notes stay editable after publish. */
    putReleaseNotes(key: ReleaseKey, notes: ReleaseNotes): Promise<ReleaseNotesRecord> {
      return store.upsert(key.app, key.version, notes);
    },
  };
}

export type ReleaseCatalog = ReturnType<typeof createReleaseCatalog>;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Whether a request may publish. The deployment configures only the SHA-256 of the publish token
 * (`COFORGE_RELEASE_CATALOG_PUBLISH_TOKEN_SHA256`), never the token; with no valid hash configured
 * nobody may publish. The bearer's hash is compared in constant time.
 */
export function publishPermission(
  authorization: string | null,
  configuredSha256: string | undefined,
): "disabled" | "denied" | "granted" {
  if (!configuredSha256 || !SHA256_HEX.test(configuredSha256)) return "disabled";
  const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (!token) return "denied";
  const presented = Buffer.from(new Bun.CryptoHasher("sha256").update(token).digest("hex"));
  return timingSafeEqual(presented, Buffer.from(configuredSha256)) ? "granted" : "denied";
}
