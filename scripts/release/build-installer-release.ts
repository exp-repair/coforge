/**
 * Assembles the objects of one `coforge-installer` release: per target a gzip and a checksum
 * sidecar, one shared notices file, and the manifest that names every target's identity.
 * docs/release/installer-feed.md is the layout.
 *
 * The product's `build-release.ts` compiles every target on one host, so it builds the whole tree
 * and its manifest in one call. The installer is native code built on six runners, one target
 * each, so this module is split at the same seam the workflow is: a runner writes its own target's
 * objects (`writeInstallerTargetObjects`); the final job, holding all six, derives each target's
 * identity from the bytes it has (`readInstallerTargetPlatform`) and assembles the manifest
 * (`assembleInstallerManifest`). The manifest is therefore always a hash of what is in the tree,
 * never of what a job claims it built.
 *
 * The local output directory mirrors the bucket: every path returned here is the object's key.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

import { isValidReleaseVersion } from "./build-release";
import { isReleaseTarget } from "./compile-targets";
import { installerObjectKey, type InstallerManifest } from "./installer-feed";

/** One `platforms[target]` entry of the manifest. */
export type InstallerPlatform = InstallerManifest["platforms"][string];

/** The largest installer a gzip may expand to. The installer is a few megabytes; the cap only
 * keeps a corrupt or hostile object from exhausting the final job's memory. */
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;

/** The binary's file name on a target and the name of its gzip. The sidecar is one name for all. */
export function installerFileNames(target: string): {
  binary: "coforge-installer" | "coforge-installer.exe";
  gzip: "coforge-installer.gz" | "coforge-installer.exe.gz";
} {
  return target.startsWith("windows-")
    ? { binary: "coforge-installer.exe", gzip: "coforge-installer.exe.gz" }
    : { binary: "coforge-installer", gzip: "coforge-installer.gz" };
}

const SIDECAR_NAME = "coforge-installer.sha256";

/* -------------------------------------------------------------------------------------------- */
/* What a target's installer must be                                                             */
/* -------------------------------------------------------------------------------------------- */

const MACH_O_64_LE = 0xfeedfacf;
const MACH_O_CPUS: Record<number, string> = { 0x0100000c: "arm64", 0x01000007: "x86_64" };
const ELF_MACHINES: Record<number, string> = { 0xb7: "aarch64", 0x3e: "x86_64" };
const PE_MACHINES: Record<number, string> = { 0xaa64: "ARM64", 0x8664: "AMD64" };
const PE32_PLUS = 0x20b;

/** The format and CPU each release target's installer has. */
const EXPECTED_BINARY: Record<
  string,
  {
    description: string;
    cpu: string;
    describe(bytes: Uint8Array): { format: string; cpu: string } | string;
  }
> = {
  "darwin-arm64": machO("arm64"),
  "darwin-x64": machO("x86_64"),
  "linux-arm64": elf("aarch64"),
  "linux-x64": elf("x86_64"),
  "windows-arm64": pe("ARM64"),
  "windows-x64": pe("AMD64"),
};

type Reading = { format: string; cpu: string } | string;

function machO(cpu: string) {
  return {
    description: "64-bit Mach-O executable",
    cpu,
    describe(bytes: Uint8Array): Reading {
      if (bytes.byteLength < 8) return "its header is shorter than a Mach-O header";
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (header.getUint32(0, true) !== MACH_O_64_LE) {
        return "it does not start with the 64-bit Mach-O magic (a fat or 32-bit binary is not one)";
      }
      const found = MACH_O_CPUS[header.getUint32(4, true)];
      return found
        ? { format: "Mach-O", cpu: found }
        : "its Mach-O CPU type is neither arm64 nor x86_64";
    },
  };
}

function elf(cpu: string) {
  return {
    description: "64-bit little-endian ELF executable",
    cpu,
    describe(bytes: Uint8Array): Reading {
      if (bytes.byteLength < 20) return "its header is shorter than an ELF header";
      if (bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
        return "it does not start with the ELF magic";
      }
      if (bytes[4] !== 2 || bytes[5] !== 1) return "it is not 64-bit little-endian ELF";
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const found = ELF_MACHINES[header.getUint16(18, true)];
      return found
        ? { format: "ELF", cpu: found }
        : "its ELF machine is neither aarch64 nor x86_64";
    },
  };
}

function pe(cpu: string) {
  return {
    description: "PE32+ executable",
    cpu,
    describe(bytes: Uint8Array): Reading {
      if (bytes.byteLength < 0x40) return "its header is shorter than a DOS header";
      if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) return "it does not start with the MZ header";
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const peOffset = header.getUint32(0x3c, true);
      // The optional header's magic is the last field read: 24 bytes past the signature, 2 wide.
      if (peOffset < 0x40 || peOffset > bytes.byteLength - 26) {
        return "its PE header lies outside the file";
      }
      if (header.getUint32(peOffset, true) !== 0x00004550) return "it has no PE signature";
      if (header.getUint16(peOffset + 24, true) !== PE32_PLUS) {
        return "its optional header is not PE32+ (64-bit)";
      }
      const found = PE_MACHINES[header.getUint16(peOffset + 4, true)];
      return found ? { format: "PE", cpu: found } : "its PE machine is neither ARM64 nor AMD64";
    },
  };
}

/**
 * Refuses a binary whose format or CPU is not `target`'s, judged from its header bytes alone;
 * nothing is executed. The build jobs hand their binary on as an artifact, so what arrives is
 * checked against the target it will be published as, before it is packaged and hashed: an
 * installer for the wrong CPU would pass every checksum and fail on the user's machine.
 */
export function assertInstallerBinaryMatchesTarget(target: string, binary: Uint8Array): void {
  const expected = Object.hasOwn(EXPECTED_BINARY, target) ? EXPECTED_BINARY[target] : undefined;
  if (!expected || !isReleaseTarget(target))
    throw new Error(`unsupported release target: ${target}`);
  const reading = expected.describe(binary);
  if (typeof reading === "string") {
    throw new Error(
      `the ${target} installer is not a ${expected.description} for ${expected.cpu}: ${reading}`,
    );
  }
  if (reading.cpu !== expected.cpu) {
    throw new Error(
      `the ${target} installer is a ${reading.format} for ${reading.cpu}, not ${expected.cpu}`,
    );
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function assertPublishable(version: string, target?: string): void {
  if (!isValidReleaseVersion(version)) {
    throw new Error(`version must be a valid version string: ${version}`);
  }
  if (target !== undefined && !isReleaseTarget(target)) {
    throw new Error(`unsupported release target: ${target}`);
  }
}

async function writeObject(directory: string, key: string, bytes: Uint8Array): Promise<void> {
  const path = join(directory, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

/**
 * Writes one target's objects into `outputDirectory` and returns their keys. The gzip and the
 * sidecar come from the same bytes in the same call, so the checksum in the sidecar is by
 * construction the one the manifest will carry (docs/release/local-distribution.md: "the two must
 * never be allowed to diverge").
 */
export async function writeInstallerTargetObjects(
  input: { version: string; target: string; binary: Uint8Array },
  outputDirectory: string,
): Promise<string[]> {
  assertPublishable(input.version, input.target);
  if (input.binary.byteLength === 0) {
    throw new Error(`the ${input.target} installer binary is empty; its build did not produce one`);
  }
  const { gzip } = installerFileNames(input.target);
  const gzipKey = installerObjectKey(input.version, `${input.target}/${gzip}`);
  const sidecarKey = installerObjectKey(input.version, `${input.target}/${SIDECAR_NAME}`);
  await writeObject(
    outputDirectory,
    gzipKey,
    Bun.gzipSync(Buffer.from(input.binary), { level: 9 }),
  );
  await writeObject(outputDirectory, sidecarKey, Buffer.from(`${sha256Hex(input.binary)}\n`));
  return [gzipKey, sidecarKey];
}

/** Writes the licence notices, a target-independent object beside the target directories. */
export async function writeInstallerNotices(
  version: string,
  notices: Uint8Array,
  outputDirectory: string,
): Promise<string> {
  assertPublishable(version);
  if (notices.byteLength === 0) throw new Error("THIRD_PARTY_NOTICES.txt is empty");
  const key = installerObjectKey(version, "THIRD_PARTY_NOTICES.txt");
  await writeObject(outputDirectory, key, notices);
  return key;
}

async function readTargetObject(
  directory: string,
  version: string,
  target: string,
  name: string,
): Promise<Uint8Array> {
  const key = installerObjectKey(version, `${target}/${name}`);
  try {
    return await readFile(join(directory, key));
  } catch {
    throw new Error(
      `the ${target} installer is missing ${name} (${key} is not in the release tree)`,
    );
  }
}

/**
 * The manifest entry of one target, derived from its objects in `directory`: the gzip's own size
 * and checksum, and the size and checksum of what it expands to. Refuses a sidecar that does not
 * hold that same checksum, because the bootstrap scripts trust the sidecar and never see the
 * manifest.
 */
export async function readInstallerTargetPlatform(
  version: string,
  target: string,
  directory: string,
  options: { maxExpandedBytes?: number } = {},
): Promise<InstallerPlatform> {
  assertPublishable(version, target);
  const names = installerFileNames(target);
  const gzip = await readTargetObject(directory, version, target, names.gzip);
  const sidecar = await readTargetObject(directory, version, target, SIDECAR_NAME);

  let binary: Uint8Array;
  try {
    binary = gunzipSync(gzip, { maxOutputLength: options.maxExpandedBytes ?? MAX_EXPANDED_BYTES });
  } catch {
    throw new Error(
      `the ${target} installer's ${names.gzip} is not a gzip, or it expands beyond the cap`,
    );
  }
  const checksum = sha256Hex(binary);
  if (new TextDecoder().decode(sidecar) !== `${checksum}\n`) {
    throw new Error(
      `the ${target} installer's ${SIDECAR_NAME} sidecar does not hold the checksum of what its ` +
        `${names.gzip} expands to (${checksum})`,
    );
  }
  return {
    installer: {
      file: names.binary,
      size: binary.byteLength,
      checksum,
      gzip: { file: names.gzip, size: gzip.byteLength, checksum: sha256Hex(gzip) },
    },
  };
}

export type InstallerManifestInputs = {
  version: string;
  commit: string;
  /** ISO 8601, the instant the manifest is written. */
  buildDate: string;
  /** The protocol the installer implements (`INSTALLER_PROTOCOL` in installer-contract.ts). */
  installerProtocol: number;
  /** Every target's entry, by release target. */
  platforms: Record<string, InstallerPlatform>;
};

/** The installer's manifest, schema 1. A pure function of its inputs; the caller writes it. */
export function assembleInstallerManifest(inputs: InstallerManifestInputs): InstallerManifest {
  assertPublishable(inputs.version);
  if (!Number.isInteger(inputs.installerProtocol) || inputs.installerProtocol < 1) {
    throw new Error(`installer protocol must be a positive integer: ${inputs.installerProtocol}`);
  }
  if (Number.isNaN(Date.parse(inputs.buildDate))) {
    throw new Error(`buildDate must be an ISO 8601 instant: ${inputs.buildDate}`);
  }
  const targets = Object.keys(inputs.platforms).sort();
  if (targets.length === 0) throw new Error("a manifest needs at least one platform");
  return {
    schema_version: 1,
    version: inputs.version,
    commit: inputs.commit,
    buildDate: inputs.buildDate,
    installer_protocol: inputs.installerProtocol,
    platforms: Object.fromEntries(
      targets.map((target) => {
        if (!isReleaseTarget(target)) throw new Error(`unsupported release target: ${target}`);
        return [target, inputs.platforms[target]!] as const;
      }),
    ),
  };
}
