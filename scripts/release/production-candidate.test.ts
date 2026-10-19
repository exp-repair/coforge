import { expect, test } from "bun:test";

import { verifyProductionCandidate } from "./production-candidate";

const COMMIT = "426f3d50f9526bb567e5c04a1d42c9b6875f06c3";
const OTHER_COMMIT = "e830e6373744e46f8c2f5f6ede7d4e306ec94b37";
const STAGING = "https://releases-staging.coforge.cn";
const PRODUCTION = "https://releases.coforge.cn";

/** The staging and production feeds holding exactly these objects; every other key answers 404, as
 * the CDN does. `requested` names each read as `staging/<key>` or `production/<key>`. */
function feeds(staging: Record<string, string>, production: Record<string, string> = {}) {
  const requested: string[] = [];
  const fetch = async (url: string | URL) => {
    const text = String(url);
    const [name, objects, base] = text.startsWith(`${STAGING}/`)
      ? ["staging", staging, STAGING]
      : ["production", production, PRODUCTION];
    const key = text.slice(`${base}/`.length);
    requested.push(`${name}/${key}`);
    const body = objects[key];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
  };
  return { fetch, requested };
}

const manifest = (version: string, commit: string) => JSON.stringify({ version, commit });
const cargoToml = (version: string) =>
  `[package]\nname = "coforge-installer"\nversion = "${version}"\n`;

/** A Computer candidate for 0.1.5 that names no staging build yet. */
const unstaged = {
  track: "computer",
  version: "0.1.5",
  commit: COMMIT,
  stagingFeedUrl: STAGING,
  productionFeedUrl: PRODUCTION,
} as const;

/** A Computer candidate promoting staging's 0.1.5-dev.3 over production's 0.1.4. */
const computer = { ...unstaged, stagingVersion: "0.1.5-dev.3" } as const;

const stagedDevBuild = {
  latest: "0.1.5-dev.3\n",
  "0.1.5-dev.3/manifest.json": manifest("0.1.5-dev.3", COMMIT),
};

test("a Computer candidate is the stable version of the dev build staging's latest names, newer than production's latest", async () => {
  const feed = feeds(stagedDevBuild, { latest: "0.1.4\n" });
  await verifyProductionCandidate(computer, { fetch: feed.fetch });
  expect(feed.requested.sort()).toEqual([
    "production/latest",
    "staging/0.1.5-dev.3/manifest.json",
    "staging/latest",
  ]);
});

test("a Computer candidate is refused unless its version is staging's dev build without the dev suffix", async () => {
  // 0.1.3-dev.1 once shipped to production as 0.1.2.
  const feed = feeds(
    { latest: "0.1.3-dev.1", "0.1.3-dev.1/manifest.json": manifest("0.1.3-dev.1", COMMIT) },
    { latest: "0.1.1" },
  );
  await expect(
    verifyProductionCandidate(
      { ...computer, version: "0.1.2", stagingVersion: "0.1.3-dev.1" },
      { fetch: feed.fetch },
    ),
  ).rejects.toThrow(/staging 0\.1\.3-dev\.1 promotes to 0\.1\.3, not 0\.1\.2/);
});

test("a Computer candidate is refused unless it is newer than production's latest", async () => {
  for (const production of ["0.1.5", "0.1.6"]) {
    const feed = feeds(stagedDevBuild, { latest: production });
    await expect(verifyProductionCandidate(computer, { fetch: feed.fetch })).rejects.toThrow(
      new RegExp(
        `0\\.1\\.5 is not newer than production's latest ${production.replaceAll(".", "\\.")}`,
      ),
    );
  }
});

test("a Computer candidate is refused when production's latest cannot be read", async () => {
  const feed = feeds(stagedDevBuild, {});
  await expect(verifyProductionCandidate(computer, { fetch: feed.fetch })).rejects.toThrow(
    /releases\.coforge\.cn\/latest: HTTP 404/,
  );
  await expect(
    verifyProductionCandidate({ ...computer, productionFeedUrl: undefined }, { fetch: feed.fetch }),
  ).rejects.toThrow(/production feed/);
});

test("a Computer candidate names the staging dev build it promotes", async () => {
  const feed = feeds(stagedDevBuild, { latest: "0.1.4" });
  await expect(verifyProductionCandidate(unstaged, { fetch: feed.fetch })).rejects.toThrow(
    /staging version/,
  );
  // A stable staging version is not a dev build to promote.
  await expect(
    verifyProductionCandidate({ ...computer, stagingVersion: "0.1.5" }, { fetch: feed.fetch }),
  ).rejects.toThrow(/numbered dev build/);
  expect(feed.requested).toEqual([]);
});

test("a Computer candidate is refused when it is a prerelease, even one staging's latest names", async () => {
  const feed = feeds(stagedDevBuild, { latest: "0.1.4" });
  await expect(
    verifyProductionCandidate({ ...computer, version: "0.1.5-dev.3" }, { fetch: feed.fetch }),
  ).rejects.toThrow(/stable/);
});

test("a Computer candidate is refused when staging's latest has moved to another version", async () => {
  const feed = feeds({ ...stagedDevBuild, latest: "0.1.5-dev.4" }, { latest: "0.1.4" });
  await expect(verifyProductionCandidate(computer, { fetch: feed.fetch })).rejects.toThrow(
    /staging latest is 0\.1\.5-dev\.4/,
  );
});

test("a candidate is refused when staging published that version from another commit", async () => {
  const feed = feeds(
    { ...stagedDevBuild, "0.1.5-dev.3/manifest.json": manifest("0.1.5-dev.3", OTHER_COMMIT) },
    { latest: "0.1.4" },
  );
  await expect(verifyProductionCandidate(computer, { fetch: feed.fetch })).rejects.toThrow(
    new RegExp(OTHER_COMMIT),
  );
});

test("a candidate is refused when staging never published that version", async () => {
  const feed = feeds({ latest: "0.1.5-dev.3" }, { latest: "0.1.4" });
  await expect(verifyProductionCandidate(computer, { fetch: feed.fetch })).rejects.toThrow(
    /0\.1\.5-dev\.3\/manifest\.json.*404/,
  );
});

test("a candidate names a full commit, never a branch or an abbreviation", async () => {
  const feed = feeds({});
  for (const commit of ["main", COMMIT.slice(0, 12), COMMIT.toUpperCase()]) {
    await expect(
      verifyProductionCandidate({ ...computer, commit }, { fetch: feed.fetch }),
    ).rejects.toThrow(/40 lowercase hex/);
  }
  expect(feed.requested).toEqual([]);
});

test("an installer candidate is the crate's version at the approved commit, published to staging from it", async () => {
  const feed = feeds({ "installer/0.1.3/manifest.json": manifest("0.1.3", COMMIT) });
  await verifyProductionCandidate(
    {
      track: "installer",
      version: "0.1.3",
      commit: COMMIT,
      stagingFeedUrl: STAGING,
      cargoToml: cargoToml("0.1.3"),
    },
    { fetch: feed.fetch },
  );
  // The installer's pointer moves on its own (rollback by `pointer_only`), so it is not compared,
  // and production's Computer `latest` does not order installer versions.
  expect(feed.requested).toEqual(["staging/installer/0.1.3/manifest.json"]);
});

test("an installer candidate is refused when the approved commit's crate has another version", async () => {
  const feed = feeds({ "installer/0.1.3/manifest.json": manifest("0.1.3", COMMIT) });
  await expect(
    verifyProductionCandidate(
      {
        track: "installer",
        version: "0.1.3",
        commit: COMMIT,
        stagingFeedUrl: STAGING,
        cargoToml: cargoToml("0.1.4"),
      },
      { fetch: feed.fetch },
    ),
  ).rejects.toThrow(/Cargo\.toml.*0\.1\.4/);
});

test("without staging evidence a candidate is checked for shape, and a Computer against production's latest, and the staging feed is never read", async () => {
  const feed = feeds({}, { latest: "0.1.4" });
  await verifyProductionCandidate({ ...unstaged, withoutStaging: true }, { fetch: feed.fetch });
  await verifyProductionCandidate(
    {
      track: "installer",
      version: "0.1.3",
      commit: COMMIT,
      stagingFeedUrl: STAGING,
      cargoToml: cargoToml("0.1.3"),
      withoutStaging: true,
    },
    { fetch: feed.fetch },
  );
  expect(feed.requested).toEqual(["production/latest"]);
  for (const candidate of [
    { version: "0.1.5-dev.10", commit: COMMIT },
    { version: "0.1.5", commit: "main" },
  ]) {
    await expect(
      verifyProductionCandidate(
        { ...unstaged, withoutStaging: true, ...candidate },
        { fetch: feed.fetch },
      ),
    ).rejects.toThrow(/stable|40 lowercase hex/);
  }
  await expect(
    verifyProductionCandidate(
      { ...unstaged, version: "0.1.4", withoutStaging: true },
      { fetch: feed.fetch },
    ),
  ).rejects.toThrow(/not newer than production's latest 0\.1\.4/);
  await expect(
    verifyProductionCandidate(
      {
        track: "installer",
        version: "0.1.3",
        commit: COMMIT,
        stagingFeedUrl: STAGING,
        cargoToml: cargoToml("0.1.4"),
        withoutStaging: true,
      },
      { fetch: feed.fetch },
    ),
  ).rejects.toThrow(/Cargo\.toml.*0\.1\.4/);
});

test("naming staging evidence cannot be combined with skipping that evidence", async () => {
  const feed = feeds({});
  await expect(
    verifyProductionCandidate({ ...computer, withoutStaging: true }, { fetch: feed.fetch }),
  ).rejects.toThrow(/cannot combine/);
});

test("the separate staging version is only supported for Computer candidates", async () => {
  const feed = feeds({ "installer/0.1.1/manifest.json": manifest("0.1.1", COMMIT) });
  await expect(
    verifyProductionCandidate(
      {
        track: "installer",
        version: "0.1.1",
        stagingVersion: "0.1.1",
        commit: COMMIT,
        stagingFeedUrl: STAGING,
        cargoToml: cargoToml("0.1.1"),
      },
      { fetch: feed.fetch },
    ),
  ).rejects.toThrow(/only supported for Computer/);
});

test("the production CLI checks the named staging dev build against its source and production's latest", async () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/production/latest") return new Response("0.1.4\n");
      if (path === "/staging/latest") return new Response("0.1.5-dev.3\n");
      if (path === "/staging/0.1.5-dev.3/manifest.json") {
        return new Response(manifest("0.1.5-dev.3", COMMIT));
      }
      return new Response("missing", { status: 404 });
    },
  });
  const run = async (...args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, `${import.meta.dir}/production-candidate.ts`, ...args],
      { stdout: "pipe", stderr: "pipe" },
    );
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    } finally {
      child.kill();
    }
  };
  try {
    const staging = new URL("staging", server.url).toString();
    const production = `--production-feed-url=${new URL("production", server.url)}`;
    const promoted = await run(
      "computer",
      "0.1.5",
      COMMIT,
      staging,
      "--staging-version=0.1.5-dev.3",
      production,
    );
    expect({ code: promoted.code, stderr: promoted.stderr }).toEqual({ code: 0, stderr: "" });
    expect(promoted.stdout).toContain(`staging published computer 0.1.5-dev.3 from ${COMMIT}`);
    expect(promoted.stdout).toContain("production version 0.1.5");

    const mismatched = await run(
      "computer",
      "0.1.4",
      COMMIT,
      staging,
      "--staging-version=0.1.5-dev.3",
      production,
    );
    expect(mismatched.code).toBe(1);
    expect(mismatched.stderr).toContain("staging 0.1.5-dev.3 promotes to 0.1.5, not 0.1.4");
  } finally {
    server.stop(true);
  }
});
