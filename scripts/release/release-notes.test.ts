import { afterEach, expect, test } from "bun:test";

import { runCli, type ReleaseNotesCliDependencies } from "./release-notes";

const TOKEN = "catalog-token-0f3c9a";
const VERSION = "0.1.3-dev.4";
const NOTES_EN = "## What's new\n\n- Agents restart faster after an upgrade.\n";
const NOTES_ZH_CN = "## 新功能\n\n- 升级后 Agent 重启更快。\n";

const UPDATED_AT = "2026-10-19T00:00:00.000Z";

type StoredNotes = { en: string; "zh-CN": string };

interface FakeCatalogOptions {
  /** Status codes the PUT answers before it starts storing; one entry per request. */
  putFailures?: number[];
  /** Replaces the notes a GET reads back, as a catalog that stored something else would. */
  readBack?: StoredNotes;
  /** Answers every PUT with this status and JSON body instead of storing. */
  putAnswer?: { status: number; body: unknown };
}

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A loopback stand-in for the Web's release catalog
 * (`/api/release-catalog/v1/apps/{app}/releases/{version}`): PUT stores, GET reads back. */
function fakeCatalog(options: FakeCatalogOptions = {}) {
  const stored = new Map<string, { app: string; version: string; notes: StoredNotes }>();
  const requests: { method: string; path: string; authorization: string | null }[] = [];
  const putFailures = [...(options.putFailures ?? [])];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      requests.push({
        method: request.method,
        path: url.pathname,
        authorization: request.headers.get("authorization"),
      });
      const match = /^\/api\/release-catalog\/v1\/apps\/([^/]+)\/releases\/([^/]+)$/.exec(
        url.pathname,
      );
      if (!match) return Response.json({ error: "not_found" }, { status: 404 });
      const [, app, version] = match as unknown as [string, string, string];
      const key = `${app}/${version}`;
      if (request.method === "PUT") {
        if (options.putAnswer)
          return Response.json(options.putAnswer.body, { status: options.putAnswer.status });
        const failure = putFailures.shift();
        if (failure !== undefined) return Response.json({ error: "internal" }, { status: failure });
        if (request.headers.get("authorization") !== `Bearer ${TOKEN}`)
          return Response.json({ error: "unauthorized" }, { status: 401 });
        const body = (await request.json()) as { notes: StoredNotes };
        stored.set(key, { app, version, notes: body.notes });
        return Response.json({ app, version, notes: body.notes, updatedAt: UPDATED_AT });
      }
      if (request.method === "GET") {
        const entry = stored.get(key);
        if (!entry) return Response.json({ error: "not_found" }, { status: 404 });
        return Response.json({
          ...entry,
          notes: options.readBack ?? entry.notes,
          updatedAt: UPDATED_AT,
        });
      }
      return new Response(null, { status: 405 });
    },
  });
  servers.push(server);
  return { origin: `http://127.0.0.1:${server.port}`, stored, requests };
}

/** Runs the CLI with captured output and no real waiting between retries. */
async function run(argv: string[], env: Record<string, string | undefined>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const delays: number[] = [];
  const deps: ReleaseNotesCliDependencies = {
    env,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    delay: async (ms) => {
      delays.push(ms);
    },
  };
  const exitCode = await runCli(argv, deps);
  return { exitCode, stdout: stdout.join("\n"), stderr: stderr.join("\n"), delays };
}

function publishArgs(origin: string, ...extra: string[]): string[] {
  return ["--origin", origin, "--version", VERSION, ...extra];
}

const notesEnv = (overrides: Record<string, string | undefined> = {}) => ({
  RELEASE_NOTES_EN: NOTES_EN,
  RELEASE_NOTES_ZH_CN: NOTES_ZH_CN,
  COFORGE_RELEASE_CATALOG_TOKEN: TOKEN,
  ...overrides,
});

test("publishes both languages and verifies the catalog reads them back", async () => {
  const catalog = fakeCatalog();
  const result = await run(publishArgs(catalog.origin), notesEnv());
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  // Sent trimmed: the catalog measures each language after trimming, and the read-back compares
  // against exactly what was sent.
  expect(catalog.stored.get(`coforge-computer/${VERSION}`)?.notes).toEqual({
    en: NOTES_EN.trim(),
    "zh-CN": NOTES_ZH_CN.trim(),
  });
  expect(catalog.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
    `PUT /api/release-catalog/v1/apps/coforge-computer/releases/${VERSION}`,
    `GET /api/release-catalog/v1/apps/coforge-computer/releases/${VERSION}`,
  ]);
  // Reads are public: the read-back carries no credential.
  expect(catalog.requests[1]?.authorization).toBeNull();
  expect(result.stdout).toContain(`coforge-computer ${VERSION}`);
  expect(result.stdout).toContain("verified");
});

test("a rejected token fails without retrying and names the status", async () => {
  const catalog = fakeCatalog();
  const result = await run(
    publishArgs(catalog.origin),
    notesEnv({ COFORGE_RELEASE_CATALOG_TOKEN: "wrong-token" }),
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("HTTP 401");
  expect(catalog.requests.map(({ method }) => method)).toEqual(["PUT"]);
  expect(result.delays).toEqual([]);
});

test("a catalog with publishing disabled fails at once, without retrying the 503", async () => {
  const catalog = fakeCatalog({
    putAnswer: { status: 503, body: { error: "publishing_disabled" } },
  });
  const result = await run(publishArgs(catalog.origin), notesEnv());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("publishing_disabled");
  expect(catalog.requests.map(({ method }) => method)).toEqual(["PUT"]);
});

test("a read-back that differs from the notes sent fails the publication", async () => {
  const catalog = fakeCatalog({ readBack: { en: "Something else", "zh-CN": NOTES_ZH_CN.trim() } });
  const result = await run(publishArgs(catalog.origin), notesEnv());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("read-back does not match");
  expect(result.stdout).not.toContain("published and verified");
});

test("a 5xx answer is tried again, and the notes still land once", async () => {
  const catalog = fakeCatalog({ putFailures: [502, 500] });
  const result = await run(publishArgs(catalog.origin), notesEnv());
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(catalog.requests.map(({ method }) => method)).toEqual(["PUT", "PUT", "PUT", "GET"]);
  expect(result.delays).toHaveLength(2);
});

test("retrying 5xx answers is bounded", async () => {
  const catalog = fakeCatalog({ putFailures: [500, 500, 500, 500, 500] });
  const result = await run(publishArgs(catalog.origin), notesEnv());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("HTTP 500");
  expect(catalog.requests).toHaveLength(3);
});

test("a 4xx answer is never tried again", async () => {
  const catalog = fakeCatalog({ putAnswer: { status: 400, body: { error: "invalid_request" } } });
  const result = await run(publishArgs(catalog.origin), notesEnv());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("HTTP 400 (invalid_request)");
  expect(catalog.requests).toHaveLength(1);
  expect(result.delays).toEqual([]);
});

test("a connection failure is tried again within the bound", async () => {
  // A port nothing listens on: every attempt is refused.
  const catalog = fakeCatalog();
  const origin = catalog.origin;
  servers.splice(0).forEach((server) => server.stop(true));
  const result = await run(publishArgs(origin), notesEnv());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("after 3 attempts");
  expect(result.delays).toHaveLength(2);
});

test("invalid inputs are refused before any request is sent", async () => {
  const catalog = fakeCatalog();
  const cases: [string, string[], Record<string, string | undefined>, string][] = [
    ["missing zh-CN", [], { RELEASE_NOTES_ZH_CN: undefined }, "RELEASE_NOTES_ZH_CN"],
    ["blank en", [], { RELEASE_NOTES_EN: " \n\t " }, "RELEASE_NOTES_EN"],
    [
      "oversized en",
      [],
      { RELEASE_NOTES_EN: "a".repeat(16_001) },
      "RELEASE_NOTES_EN is 16001 characters; the limit is 16000",
    ],
    ["missing token", [], { COFORGE_RELEASE_CATALOG_TOKEN: "" }, "COFORGE_RELEASE_CATALOG_TOKEN"],
    ["traversing version", ["--version", "../latest"], {}, "--version"],
    ["flag-like version", ["--version", "-dev.1"], {}, "--version"],
  ];
  for (const [name, argv, overrides, message] of cases) {
    const result = await run(publishArgs(catalog.origin, ...argv), notesEnv(overrides));
    expect(result.exitCode, name).toBe(1);
    expect(result.stderr, name).toContain(message);
  }
  expect(catalog.requests).toEqual([]);
});

test("a note of exactly the limit is accepted, counted after trimming", async () => {
  const catalog = fakeCatalog();
  const result = await run(
    publishArgs(catalog.origin),
    notesEnv({ RELEASE_NOTES_EN: `\n${"a".repeat(16_000)}\n\n` }),
  );
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
});

test("the origin must be https, or http on a loopback host", async () => {
  for (const origin of ["http://staging.coforge.cn", "ftp://coforge.cn", "staging.coforge.cn"]) {
    const result = await run(publishArgs(origin), notesEnv());
    expect(result.exitCode, origin).toBe(1);
    expect(result.stderr, origin).toContain("--origin");
  }
  const missing = await run(["--version", VERSION], notesEnv());
  expect(missing.stderr).toContain("--origin is required");
});

test("--check validates the notes alone, without a token, a version, or a request", async () => {
  const catalog = fakeCatalog();
  const valid = await run(
    ["--check", "--origin", catalog.origin],
    notesEnv({ COFORGE_RELEASE_CATALOG_TOKEN: undefined }),
  );
  expect(valid.stderr).toBe("");
  expect(valid.exitCode).toBe(0);
  expect(valid.stdout).toContain("en=");

  const withVersion = await run(["--check", "--version", "0.1.2"], notesEnv());
  expect(withVersion.exitCode).toBe(0);

  const missing = await run(["--check"], notesEnv({ RELEASE_NOTES_EN: "" }));
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toContain("RELEASE_NOTES_EN");

  const badVersion = await run(["--check", "--version", "../x"], notesEnv());
  expect(badVersion.exitCode).toBe(1);
  expect(catalog.requests).toEqual([]);
});

test("output never carries the token or the notes, on success or failure", async () => {
  const marker = "UNIQUE-NOTE-BODY-7d1e";
  const env = notesEnv({ RELEASE_NOTES_EN: `${marker} en`, RELEASE_NOTES_ZH_CN: `${marker} zh` });
  const ok = fakeCatalog();
  const failing = fakeCatalog({ readBack: { en: `${marker} other`, "zh-CN": `${marker} zh` } });
  for (const origin of [ok.origin, failing.origin]) {
    const result = await run(publishArgs(origin), env);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain(marker);
  }
});
