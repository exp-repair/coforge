#!/usr/bin/env bun
/**
 * Checks that a production publication names exactly what staging already published
 * (docs/release/staging-to-production.md): a full source commit and a staging version published
 * from that commit. Production rebuilds the commit against its own feed, so the staging feed is
 * the evidence that this commit passed the release gates and was published; the staging workflows
 * publish only from `main` and only after those gates.
 *
 *   computer   staging's `latest` names `stagingVersion`, a dev build `X.Y.Z-dev.N`; the
 *              production version is its `X.Y.Z` (release-line.ts), newer than production's
 *              `latest`
 *   installer  the version `crates/installer/Cargo.toml` holds at the commit; the installer
 *              pointer moves on its own (`pointer_only`), so it is not compared
 *
 * `withoutStaging` skips the staging comparison and checks the commit and version for shape
 * alone (and the installer's Cargo.toml version, or that a Computer version is newer than
 * production's `latest`). It exists for a production release Frank approved without a staging
 * publication; the workflows expose it as an explicit input that the run title names.
 *
 * Reads only the public staging and production feeds; it holds no credential.
 */
import { readFile } from "node:fs/promises";

import { manifestObjectKey, LATEST_OBJECT_KEY } from "./publish";
import { installerManifestKey, installerVersionFromCargoToml } from "./installer-feed";
import { readFeedObject, type FeedFetch } from "./public-feed";
import { assertProductionPromotion, requireStable, stableVersionOf } from "./release-line";

export type ReleaseTrack = "computer" | "installer";

export interface ProductionCandidate {
  track: ReleaseTrack;
  version: string;
  commit: string;
  stagingFeedUrl: string;
  /** The staging dev build a Computer candidate promotes; required unless `withoutStaging`. */
  stagingVersion?: string;
  /** The production feed whose `latest` a Computer candidate must be newer than. */
  productionFeedUrl?: string;
  /** The installer track's `crates/installer/Cargo.toml` at `commit`. */
  cargoToml?: string;
  /** Check shape only: the release was approved without a staging publication. */
  withoutStaging?: boolean;
}

export interface CandidateDependencies {
  fetch?: FeedFetch;
}

const FULL_COMMIT = /^[0-9a-f]{40}$/;

export async function verifyProductionCandidate(
  candidate: ProductionCandidate,
  deps: CandidateDependencies = {},
): Promise<void> {
  const fetch = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const { track, version, commit, stagingFeedUrl, stagingVersion, withoutStaging } = candidate;
  if (!FULL_COMMIT.test(commit)) {
    throw new Error(`commit must be a full commit, 40 lowercase hex characters: ${commit}`);
  }
  requireStable(version, "version");
  if (withoutStaging && stagingVersion !== undefined) {
    throw new Error("cannot combine a staging version with without-staging");
  }

  // Every shape check comes before any feed is read.
  let productionFeedUrl: string | undefined;
  let manifestKey: string | undefined;
  if (track === "computer") {
    if (stagingVersion === undefined) {
      if (!withoutStaging) {
        throw new Error("a Computer candidate names the staging version it promotes");
      }
    } else {
      const promoted = stableVersionOf(stagingVersion);
      if (promoted !== version) {
        throw new Error(`staging ${stagingVersion} promotes to ${promoted}, not ${version}`);
      }
      manifestKey = manifestObjectKey(stagingVersion);
    }
    productionFeedUrl = candidate.productionFeedUrl;
    if (productionFeedUrl === undefined) {
      throw new Error("a Computer candidate needs the production feed to compare against");
    }
  } else {
    if (stagingVersion !== undefined) {
      throw new Error("a separate staging version is only supported for Computer candidates");
    }
    const crateVersion = installerVersionFromCargoToml(candidate.cargoToml ?? "");
    if (crateVersion !== version) {
      throw new Error(
        `crates/installer/Cargo.toml at ${commit} holds ${crateVersion}, not the candidate ${version}`,
      );
    }
    if (!withoutStaging) manifestKey = installerManifestKey(version);
  }

  // The installer's staging pointer moves on its own (`pointer_only`), so it is not compared.
  const [productionLatest, stagingLatest, manifestText] = await Promise.all([
    productionFeedUrl ? readFeedObject(productionFeedUrl, LATEST_OBJECT_KEY, fetch) : undefined,
    stagingVersion ? readFeedObject(stagingFeedUrl, LATEST_OBJECT_KEY, fetch) : undefined,
    manifestKey ? readFeedObject(stagingFeedUrl, manifestKey, fetch) : undefined,
  ]);
  if (productionLatest !== undefined) {
    assertProductionPromotion({ version, productionLatest: productionLatest.trim() });
  }
  if (stagingLatest !== undefined && stagingLatest.trim() !== stagingVersion) {
    throw new Error(
      `staging latest is ${stagingLatest.trim()}, not the candidate ${stagingVersion}`,
    );
  }
  if (manifestText === undefined) return;
  const evidence = stagingVersion ?? version;
  const manifest = JSON.parse(manifestText) as { version?: unknown; commit?: unknown };
  if (manifest.version !== evidence || manifest.commit !== commit) {
    throw new Error(
      `staging ${manifestKey} was published as ${String(manifest.version)} from ${String(manifest.commit)}, not ${evidence} from ${commit}`,
    );
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const withoutStaging = args.includes("--without-staging");
  const options = ["--staging-version=", "--production-feed-url="];
  const option = (prefix: string) =>
    args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const stagingVersion = option("--staging-version=");
  const productionFeedUrl = option("--production-feed-url=");
  const [track, version, commit, stagingFeedUrl, cargoTomlPath] = args.filter(
    (arg) => arg !== "--without-staging" && !options.some((prefix) => arg.startsWith(prefix)),
  );
  if ((track !== "computer" && track !== "installer") || !version || !commit || !stagingFeedUrl) {
    console.error(
      "usage: production-candidate.ts [--without-staging] [--staging-version=<version>] [--production-feed-url=<url>] <computer|installer> <version> <commit> <staging-feed-url> [cargo-toml]",
    );
    process.exit(2);
  }
  try {
    await verifyProductionCandidate({
      track,
      version,
      commit,
      stagingFeedUrl,
      stagingVersion,
      productionFeedUrl,
      cargoToml: cargoTomlPath ? await readFile(cargoTomlPath, "utf8") : undefined,
      withoutStaging,
    });
    console.log(
      withoutStaging
        ? `${track} ${version} from ${commit}: approved without a staging publication`
        : `staging published ${track} ${stagingVersion ?? version} from ${commit}` +
            (stagingVersion ? `; production version ${version}` : ""),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
