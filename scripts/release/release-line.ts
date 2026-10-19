/**
 * The rules that keep release version numbers ordered: the Computer's across the two feeds, and
 * every feed's `latest`, the installer's included
 * (docs/release/github-actions.md states them for operators). Production's `latest` (P) is a
 * stable `X.Y.Z`; staging publishes numbered dev builds `<line>-dev.<N>` of a release line, and a
 * production release is the stable version of the staging build it promotes:
 *
 *   line        staging's line when it is already above P, else P with the patch incremented; an
 *               explicit line (a new minor or major) must be above P and not below staging's
 *   staging     a `<line>-dev.<N>` newer than staging's `latest` (S); automatic numbering starts
 *               above S's dev number on the same line
 *   production  staging's version without `-dev.<N>`, newer than P
 *   any feed    a publication never moves a feed's `latest` to an older version (publish.ts)
 *
 * Every rule is a pure function of the versions it is given; the callers (publish.ts,
 * production-candidate.ts) read the feeds and refuse before anything is uploaded.
 */
import {
  compareReleaseVersions,
  parseReleaseVersion,
} from "@lrm/coforge-sdk/internal/release-version";

const DEV_NUMBER = /^[1-9][0-9]*$/;

/** The `[major, minor, patch]` of a stable `X.Y.Z`, refusing anything else (a pre-release, build
 * metadata, leading zeros, surrounding whitespace). `name` says which version, for the message. */
export function requireStable(version: string, name: string): [number, number, number] {
  const parsed = parseReleaseVersion(version);
  if (!parsed || version !== parsed.core.join(".")) {
    throw new Error(`${name} must be a stable major.minor.patch version: ${version}`);
  }
  return parsed.core;
}

/** The line and number of a numbered dev build `X.Y.Z-dev.N` (N from 1, no build metadata), or
 * undefined for any other version. */
export function parseDevBuild(version: string): { line: string; number: number } | undefined {
  const parsed = parseReleaseVersion(version);
  if (!parsed || version.includes("+") || version !== version.trim()) return undefined;
  const [label, number, ...rest] = parsed.prerelease;
  if (label !== "dev" || number === undefined || !DEV_NUMBER.test(number) || rest.length > 0) {
    return undefined;
  }
  return { line: parsed.core.join("."), number: Number(number) };
}

/** The stable version a staging dev build is promoted as: `0.1.5-dev.3` -> `0.1.5`. */
export function stableVersionOf(devVersion: string): string {
  const build = parseDevBuild(devVersion);
  if (!build) {
    throw new Error(`staging version must be a numbered dev build X.Y.Z-dev.N: ${devVersion}`);
  }
  return build.line;
}

/** Refuses a `version` that would move a feed's `latest` back: older than it, or with `strict`
 * also `latest` itself. `feed` names the feed in the message ("staging's"). An empty feed (no
 * `latest`) refuses nothing. */
export function assertForward(
  version: string,
  options: { latest: string | undefined; feed: string; strict?: boolean },
): void {
  const { latest, feed } = options;
  if (latest === undefined) return;
  if (!parseReleaseVersion(latest)) {
    throw new Error(`${feed} latest is not a release version: ${latest}`);
  }
  if (!parseReleaseVersion(version)) {
    throw new Error(`${version} has no semver order, so it cannot follow ${feed} latest ${latest}`);
  }
  const order = compareReleaseVersions(version, latest);
  if (options.strict && order <= 0) {
    throw new Error(`${version} is not newer than ${feed} latest ${latest}`);
  }
  if (order < 0) {
    throw new Error(
      `${version} is older than ${feed} latest ${latest}: a publication never moves latest back`,
    );
  }
}

/** The release line staging's next build belongs to (see the module comment). */
export function stagingDevLine(feeds: {
  productionLatest: string;
  stagingLatest?: string;
  line?: string;
}): string {
  const production = feeds.productionLatest;
  const [major, minor, patch] = requireStable(production, "production latest");
  const staging =
    feeds.stagingLatest === undefined ? undefined : parseReleaseVersion(feeds.stagingLatest);
  if (feeds.stagingLatest !== undefined && !staging) {
    throw new Error(`staging latest is not a release version: ${feeds.stagingLatest}`);
  }
  const stagingLine = staging?.core.join(".");
  const { line } = feeds;
  if (line !== undefined) {
    requireStable(line, "line");
    if (compareReleaseVersions(line, production) <= 0) {
      throw new Error(`line ${line} must be greater than production's latest ${production}`);
    }
    if (stagingLine !== undefined && compareReleaseVersions(line, stagingLine) < 0) {
      throw new Error(`line ${line} is below staging's line ${stagingLine}`);
    }
    return line;
  }
  if (stagingLine !== undefined && compareReleaseVersions(stagingLine, production) > 0) {
    return stagingLine;
  }
  return `${major}.${minor}.${patch + 1}`;
}

/** The dev number automatic numbering of `line` starts from: one above staging's `latest` when
 * that is a dev build of the same line, else 1. */
export function firstDevNumber(line: string, stagingLatest: string | undefined): number {
  const latest = stagingLatest === undefined ? undefined : parseDevBuild(stagingLatest);
  return latest?.line === line ? latest.number + 1 : 1;
}

/** Refuses a staging version that is not a numbered dev build of `line`, or not newer than
 * staging's `latest`. */
export function assertStagingDevVersion(
  version: string,
  feeds: { line: string; stagingLatest?: string },
): void {
  if (parseDevBuild(version)?.line !== feeds.line) {
    throw new Error(
      `${version} is not a dev build of line ${feeds.line}: staging publishes ${feeds.line}-dev.<N>`,
    );
  }
  assertForward(version, { latest: feeds.stagingLatest, feed: "staging's", strict: true });
}

/** Refuses a production version that is not newer than production's `latest`. */
export function assertProductionPromotion(promotion: {
  version: string;
  productionLatest: string;
}): void {
  requireStable(promotion.productionLatest, "production latest");
  assertForward(promotion.version, {
    latest: promotion.productionLatest,
    feed: "production's",
    strict: true,
  });
}
