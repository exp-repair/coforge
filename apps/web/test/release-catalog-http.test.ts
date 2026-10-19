import { expect, test } from "bun:test";

import {
  createReleaseCatalog,
  type ReleaseCatalogStore,
  type ReleaseNotesRecord,
} from "#src/server/release-catalog/release-catalog.server";
import { createReleaseCatalogHttp } from "#src/server/release-catalog/release-catalog-http.server";

const TOKEN = "release-publisher-token";
// `printf %s release-publisher-token | shasum -a 256`
const TOKEN_SHA256 = "691b3be49557269493fc4bef977eea0d355c0aee6f742054526a8a6f4c341216";

/** An in-memory stand-in for the PostgreSQL table, keyed the way its unique index is. */
function memoryStore(clock: { now: Date }): ReleaseCatalogStore {
  const rows = new Map<string, ReleaseNotesRecord>();
  return {
    find: async (app, version) => rows.get(`${app}@${version}`),
    upsert: async (app, version, notes) => {
      const row = { app, version, notes, updatedAt: clock.now };
      rows.set(`${app}@${version}`, row);
      return row;
    },
  };
}

/** The Web as deployed with `publishTokenSha256` configured. Not a default parameter: an explicit
 * `undefined` (the unset deployment) would take the default. */
function setup(publishTokenSha256: string | undefined) {
  const clock = { now: new Date("2026-10-19T08:00:00.000Z") };
  const catalog = createReleaseCatalog(memoryStore(clock));
  return { clock, catalog, http: createReleaseCatalogHttp({ catalog, publishTokenSha256 }) };
}

const notes = { en: "## Fixes\n\n- Faster upgrades", "zh-CN": "## 修复\n\n- 升级更快" };

function put(body: unknown, authorization: string | null = `Bearer ${TOKEN}`) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== null) headers.set("authorization", authorization);
  return new Request("https://coforge.test/api/release-catalog/v1/apps/a/releases/v", {
    method: "PUT",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("a publisher writes a release's notes and anyone reads them back", async () => {
  const { http } = setup(TOKEN_SHA256);

  const written = await http.publish(put({ notes }), "coforge-computer", "0.1.4-dev.2");
  expect(written.status).toBe(200);
  const body = {
    app: "coforge-computer",
    version: "0.1.4-dev.2",
    notes,
    updatedAt: "2026-10-19T08:00:00.000Z",
  };
  expect(await written.json()).toEqual(body);

  const read = await http.read("coforge-computer", "0.1.4-dev.2");
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual(body);
});

test("publishing again overwrites the notes and moves updatedAt", async () => {
  const { http, clock } = setup(TOKEN_SHA256);
  await http.publish(put({ notes }), "coforge-computer", "0.1.4");
  clock.now = new Date("2026-10-19T09:30:00.000Z");
  const edited = { en: "Edited", "zh-CN": "已修改" };

  expect((await http.publish(put({ notes: edited }), "coforge-computer", "0.1.4")).status).toBe(
    200,
  );

  expect(await (await http.read("coforge-computer", "0.1.4")).json()).toMatchObject({
    notes: edited,
    updatedAt: "2026-10-19T09:30:00.000Z",
  });
});

test("a release nobody published is a 404", async () => {
  const response = await setup(TOKEN_SHA256).http.read("coforge-computer", "9.9.9");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
});

test("a read is revalidated rather than cached, since notes stay editable", async () => {
  const { http } = setup(TOKEN_SHA256);
  await http.publish(put({ notes }), "coforge-computer", "0.1.4");
  expect((await http.read("coforge-computer", "0.1.4")).headers.get("cache-control")).toBe(
    "no-cache",
  );
});

test.each([
  ["an uppercase app", "Coforge", "0.1.4"],
  ["an app starting with a dash", "-coforge", "0.1.4"],
  ["an app longer than 63 characters", "a".repeat(64), "0.1.4"],
  ["a path-like version", "coforge-computer", "../0.1.4"],
  ["a version with a space", "coforge-computer", "0.1 4"],
])("%s is an invalid request to read and to publish", async (_case, app, version) => {
  const { http } = setup(TOKEN_SHA256);
  const read = await http.read(app, version);
  expect(read.status).toBe(400);
  expect(await read.json()).toEqual({ error: "invalid_request" });
  const written = await http.publish(put({ notes }), app, version);
  expect(written.status).toBe(400);
  expect(await written.json()).toEqual({ error: "invalid_request" });
});

test.each([
  ["no body", ""],
  ["no notes", {}],
  ["missing Chinese", { notes: { en: "Fixes" } }],
  ["blank English", { notes: { en: "   ", "zh-CN": "修复" } }],
  ["an unknown locale", { notes: { ...notes, fr: "Corrections" } }],
  ["notes over 16000 characters", { notes: { en: "a".repeat(16_001), "zh-CN": "修复" } }],
])("a publish with %s is an invalid request", async (_case, body) => {
  const { http } = setup(TOKEN_SHA256);
  const response = await http.publish(put(body), "coforge-computer", "0.1.4");
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_request" });
  expect((await http.read("coforge-computer", "0.1.4")).status).toBe(404);
});

test("notes are stored trimmed, and 16000 characters after trimming still fit", async () => {
  const { http } = setup(TOKEN_SHA256);
  const longest = "a".repeat(16_000);
  await http.publish(
    put({ notes: { en: `\n  ${longest}  \n`, "zh-CN": "  修复\n" } }),
    "coforge-computer",
    "0.1.4",
  );
  expect(await (await http.read("coforge-computer", "0.1.4")).json()).toMatchObject({
    notes: { en: longest, "zh-CN": "修复" },
  });
});

test.each([
  ["no Authorization header", null],
  ["a wrong token", "Bearer someone-else"],
  ["the token without the Bearer scheme", TOKEN],
  ["the configured hash itself as the token", `Bearer ${TOKEN_SHA256}`],
])("a publish with %s is unauthorized and writes nothing", async (_case, authorization) => {
  const { http } = setup(TOKEN_SHA256);
  const response = await http.publish(put({ notes }, authorization), "coforge-computer", "0.1.4");
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthorized" });
  expect((await http.read("coforge-computer", "0.1.4")).status).toBe(404);
});

test.each([
  ["unset", undefined],
  ["empty", ""],
  ["not hex", "z".repeat(64)],
  ["uppercase hex", TOKEN_SHA256.toUpperCase()],
  ["the wrong length", TOKEN_SHA256.slice(1)],
])(
  "with the publish hash %s, publishing is disabled even for the right token",
  async (_case, hash) => {
    const { http } = setup(hash);
    const response = await http.publish(put({ notes }), "coforge-computer", "0.1.4");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "publishing_disabled" });
    expect((await http.read("coforge-computer", "0.1.4")).status).toBe(404);
  },
);

test("an unauthorized publish is refused before its body is judged", async () => {
  const { http } = setup(TOKEN_SHA256);
  const response = await http.publish(put("not json", null), "Bad App", "0.1.4");
  expect(response.status).toBe(401);
});

test("the in-process read returns the release, and null for an unknown or malformed one", async () => {
  const { http, catalog } = setup(TOKEN_SHA256);
  await http.publish(put({ notes }), "coforge-computer", "0.1.4");

  expect(await catalog.getReleaseNotes("coforge-computer", "0.1.4")).toEqual({
    app: "coforge-computer",
    version: "0.1.4",
    notes,
    updatedAt: new Date("2026-10-19T08:00:00.000Z"),
  });
  expect(await catalog.getReleaseNotes("coforge-computer", "0.1.5")).toBeNull();
  expect(await catalog.getReleaseNotes("coforge-computer", "../0.1.4")).toBeNull();
});
