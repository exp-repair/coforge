/**
 * Recovers the reference Computer's source from its latest shipped binary, following
 * docs/agents/reference-cli-research/recovering-the-binary.md: resolve the release through the
 * Hands `updates/check` API, download and verify the gzip artifact, cut the SEA blob out of the
 * executable, decode it into the SEA main script and assets, require the version's bundle banner,
 * split each script that carries module path comments into a tree, and record the provenance a
 * research note must cite.
 *
 * The downloaded executable is untrusted data. It is written without an execute bit and only ever
 * read as bytes. Run `bun scripts/reference-computer/extract.ts --help` for usage.
 */
import { mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
// Bun has no argument parser of its own; its documentation points to node:util parseArgs.
import { parseArgs } from "node:util";

import { selectBundles, splitBundle } from "./bundle";
import { findSeaBlob } from "./sea-blob";
import { parseSeaResource } from "./sea-resource";

const UPDATES_CHECK = "https://hands.build/public/v2/apps/raft-computer-cli/updates/check";
const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const CONTAINERS = { "mach-o": "section __NODE_SEA_BLOB", elf: "PT_NOTE note NODE_SEA_BLOB" };

const USAGE = `Usage: bun scripts/reference-computer/extract.ts --out <dir> [options]

Recover the reference Computer's source tree from its shipped binary.

Options:
  --out <dir>        New or empty directory outside this repository (required)
  --platform <p>     Artifact platform: darwin or linux (default: darwin)
  --arch <a>         Artifact architecture: arm64 or x64 (default: arm64)
  --version <x.y.z>  Re-check this release instead of the latest one
  -h, --help         Show this help

Writes to <dir>:
  release.json       the updates/check response
  raft-computer      the verified binary, without an execute bit
  sea/main/<name>    the SEA main script
  sea/assets/<key>   each SEA asset
  tree/<name>/...    a script split at its module path comments (only scripts
                     that have them; a minified bundle has none)
  provenance.json    version, target, release id, hashes, blob location, and
                     observation date, as research notes must cite them`;

export type Release = {
  version: string;
  releaseId: string;
  target: string;
  binarySha256: string;
  gzipSha256: string;
  gzipUrl: string;
};

type Request = { platform: string; arch: string; version?: string };

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/** Returns the digest when it matches; throws otherwise, so nothing unverified is used. */
export function verifySha256(bytes: Uint8Array, expected: string, label: string): string {
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`${label} sha256 mismatch: expected ${expected}, got ${actual}`);
  }
  return actual;
}

export function isWithin(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Validates the untrusted `updates/check` response against what was asked for. */
export function parseRelease(metadata: unknown, request: Request): Release {
  const body = metadata as {
    release?: { id?: unknown; version?: unknown };
    artifact?: {
      id?: unknown;
      platform?: unknown;
      arch?: unknown;
      sha256?: unknown;
      gzip?: { sha256?: unknown; download_url?: unknown };
    };
  };
  const { release, artifact } = body ?? {};
  const version = release?.version;
  if (typeof version !== "string" || !VERSION.test(version)) {
    throw new Error("release metadata has no valid release.version");
  }
  if (request.version !== undefined && version !== request.version) {
    throw new Error(`requested version ${request.version}, but the API returned ${version}`);
  }
  if (typeof release?.id !== "string" || release.id === "") {
    throw new Error("release metadata has no release.id");
  }
  if (artifact?.platform !== request.platform || artifact?.arch !== request.arch) {
    const target = `${request.platform}-${request.arch}`;
    throw new Error(`release metadata names another target than ${target}`);
  }
  for (const [name, value] of [
    ["artifact.sha256", artifact.sha256],
    ["artifact.gzip.sha256", artifact.gzip?.sha256],
  ] as const) {
    if (typeof value !== "string" || !SHA256.test(value)) {
      throw new Error(`release metadata has no valid ${name}`);
    }
  }
  const url = artifact.gzip?.download_url;
  if (typeof url !== "string" || !URL.canParse(url) || new URL(url).protocol !== "https:") {
    throw new Error("release metadata has no https artifact.gzip.download_url");
  }
  return {
    version,
    releaseId: release.id,
    target: `${request.platform}-${request.arch}`,
    binarySha256: artifact.sha256 as string,
    gzipSha256: artifact.gzip?.sha256 as string,
    gzipUrl: url,
  };
}

/** The nearest existing ancestor's real path, so /tmp and /private/tmp compare equal. */
async function realLocation(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await realLocation(parent), relative(parent, path));
  }
}

async function prepareOutDir(out: string): Promise<string> {
  const dir = resolve(out);
  if (isWithin(await realLocation(dir), await realpath(REPOSITORY_ROOT))) {
    throw new Error(`--out must be outside the repository (${REPOSITORY_ROOT})`);
  }
  const existing = await readdir(dir).catch(() => undefined);
  if (existing && existing.length > 0) throw new Error(`--out must be new or empty: ${dir}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Fetches without echoing the URL: a redirect target may carry a signature. */
async function fetchBytes(url: string, what: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${what} download failed: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The Node release the executable was built from, which fixes the SEA resource layout. */
function embeddedNodeVersion(binary: Uint8Array): string | null {
  const marker = "https://nodejs.org/download/release/v";
  const at = Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength).indexOf(marker);
  if (at < 0) return null;
  const start = at + marker.length;
  const tail = new TextDecoder().decode(binary.subarray(start, start + 16));
  return /^\d+\.\d+\.\d+/.exec(tail)?.[0] ?? null;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      out: { type: "string" },
      platform: { type: "string", default: "darwin" },
      arch: { type: "string", default: "arm64" },
      version: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return console.log(USAGE);
  if (!values.out) throw new Error(`--out is required\n\n${USAGE}`);
  if (!["darwin", "linux"].includes(values.platform)) {
    throw new Error("--platform must be darwin or linux (a Windows PE resource is not supported)");
  }
  const { platform, arch, version } = values;
  const request: Request = { platform, arch, version };
  const out = await prepareOutDir(values.out);

  const query = new URLSearchParams({
    product_type: "cli-binary",
    platform: request.platform,
    arch: request.arch,
    current_version: "0.0.0",
    current_version_code: "0",
    ...(request.version ? { version: request.version } : {}),
  });
  const response = await fetch(`${UPDATES_CHECK}?${query}`);
  if (!response.ok) throw new Error(`updates/check failed: HTTP ${response.status}`);
  const metadataText = await response.text();
  await Bun.write(join(out, "release.json"), metadataText);
  const release = parseRelease(JSON.parse(metadataText), request);
  const { version: resolved, target, releaseId } = release;
  console.log(`resolved raft-computer ${resolved} ${target} (release ${releaseId})`);

  const gzip = await fetchBytes(release.gzipUrl, `${release.target} artifact`);
  verifySha256(gzip, release.gzipSha256, "gzip artifact");
  const binary = Bun.gunzipSync(gzip);
  verifySha256(binary, release.binarySha256, "binary");
  await writeFile(join(out, "raft-computer"), binary, { mode: 0o644 });

  const blob = findSeaBlob(binary);
  const sea = parseSeaResource(binary.subarray(blob.offset, blob.offset + blob.size));
  const bundles = new Set(selectBundles(sea.resources, release.version));
  const resources = [];
  for (const resource of sea.resources) {
    const folder = resource.role === "main" ? "main" : "assets";
    await Bun.write(join(out, "sea", folder, resource.name), resource.content);
    const files = /\.[cm]?js$/.test(resource.name)
      ? splitBundle(new TextDecoder().decode(resource.content))
      : new Map<string, string>();
    for (const [path, content] of files) {
      await Bun.write(join(out, "tree", resource.name, path), content);
    }
    resources.push({
      name: resource.name,
      role: resource.role,
      offset_in_blob: resource.offset,
      bytes: resource.content.length,
      sha256: sha256(resource.content),
      bundle: bundles.has(resource),
      module_files: files.size,
    });
  }

  const observedAt = new Date().toISOString();
  const provenance = {
    version: release.version,
    target: release.target,
    release_id: release.releaseId,
    binary_sha256: release.binarySha256,
    gzip_sha256: release.gzipSha256,
    node_version: embeddedNodeVersion(binary),
    blob: {
      format: blob.format,
      container: CONTAINERS[blob.format],
      offset: blob.offset,
      size: blob.size,
      size_hex: `0x${blob.size.toString(16)}`,
    },
    sea: {
      flags: sea.flags,
      code_path: sea.codePath,
      code_cache_bytes: sea.codeCacheBytes ?? null,
      exec_argv: sea.execArgv,
      resources,
    },
    observed_at: observedAt,
    observed_on: observedAt.slice(0, 10),
    source: "hands.build updates/check",
  };
  await Bun.write(join(out, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(JSON.stringify(provenance, null, 2));
  for (const resource of resources) {
    const split = resource.module_files
      ? `${resource.module_files} module files under tree/${resource.name}`
      : "no module path comments, not split";
    console.log(`${resource.role} ${resource.name}: ${split}`);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
