import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { InstallerManifestSchema } from "@coforge/computer/src/release/installer-contract";

import {
  ELF_MACHINE,
  MACH_O_CPU,
  PE_MACHINE,
  elfHeader,
  machOHeader,
  peHeader,
  syntheticBinaryWithHeader,
  syntheticInstallerBinary,
} from "./fixtures/installer-binary";
import {
  assembleInstallerManifest,
  assertInstallerBinaryMatchesTarget,
  installerFileNames,
  readInstallerTargetPlatform,
  writeInstallerNotices,
  writeInstallerTargetObjects,
} from "./build-installer-release";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "coforge-installer-release-"));
  temporaryDirectories.push(directory);
  return directory;
}

const VERSION = "9.8.7";
const COMMIT = "b".repeat(40);
const BUILD_DATE = "2026-09-30T08:00:00.000Z";
const golden = JSON.parse(
  await readFile(
    new URL("../../crates/installer/contract/installer-manifest.v1.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

function binaryFor(target: string): Uint8Array {
  return Buffer.from(`native installer for ${target}, ${"x".repeat(2048)}`);
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

test("a Windows installer is a .exe, and every other target's is not", () => {
  expect(installerFileNames("windows-x64")).toEqual({
    binary: "coforge-installer.exe",
    gzip: "coforge-installer.exe.gz",
  });
  expect(installerFileNames("windows-arm64").binary).toBe("coforge-installer.exe");
  for (const target of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]) {
    expect(installerFileNames(target)).toEqual({
      binary: "coforge-installer",
      gzip: "coforge-installer.gz",
    });
  }
});

test("a target's objects are its gzip and a sidecar holding the uncompressed binary's checksum", async () => {
  const directory = await tempDir();
  const binary = binaryFor("linux-x64");

  const keys = await writeInstallerTargetObjects(
    { version: VERSION, target: "linux-x64", binary },
    directory,
  );

  expect(keys).toEqual([
    `installer/${VERSION}/linux-x64/coforge-installer.gz`,
    `installer/${VERSION}/linux-x64/coforge-installer.sha256`,
  ]);
  const gzip = await readFile(join(directory, keys[0]!));
  expect(Buffer.compare(gunzipSync(gzip), Buffer.from(binary))).toBe(0);
  // One line of hex and nothing else, so the bootstrap script can validate it with a shell `case`.
  expect(await readFile(join(directory, keys[1]!), "utf8")).toBe(`${sha256(binary)}\n`);
});

test("a Windows target keeps the .exe in its gzip's name but not in its sidecar's", async () => {
  const directory = await tempDir();

  const keys = await writeInstallerTargetObjects(
    { version: VERSION, target: "windows-arm64", binary: binaryFor("windows-arm64") },
    directory,
  );

  expect(keys).toEqual([
    `installer/${VERSION}/windows-arm64/coforge-installer.exe.gz`,
    `installer/${VERSION}/windows-arm64/coforge-installer.sha256`,
  ]);
});

test("a target or version that could leave its directory is refused before anything is written", async () => {
  const directory = await tempDir();
  await expect(
    writeInstallerTargetObjects(
      { version: VERSION, target: "../linux-x64", binary: binaryFor("x") },
      directory,
    ),
  ).rejects.toThrow(/unsupported release target/);
  await expect(
    writeInstallerTargetObjects(
      { version: "1.0.0/../x", target: "linux-x64", binary: binaryFor("x") },
      directory,
    ),
  ).rejects.toThrow(/valid version string/);
  await expect(
    writeInstallerTargetObjects(
      { version: VERSION, target: "linux-x64", binary: new Uint8Array() },
      directory,
    ),
  ).rejects.toThrow(/empty/);
});

test("the notices are one object beside the target directories", async () => {
  const directory = await tempDir();

  const key = await writeInstallerNotices(VERSION, Buffer.from("licenses\n"), directory);

  expect(key).toBe(`installer/${VERSION}/THIRD_PARTY_NOTICES.txt`);
  expect(await readFile(join(directory, key), "utf8")).toBe("licenses\n");
});

test("a target's identity is derived from the objects on disk: sizes and checksums of the binary and its gzip", async () => {
  const directory = await tempDir();
  const binary = binaryFor("windows-x64");
  const keys = await writeInstallerTargetObjects(
    { version: VERSION, target: "windows-x64", binary },
    directory,
  );
  const gzip = await readFile(join(directory, keys[0]!));

  const platform = await readInstallerTargetPlatform(VERSION, "windows-x64", directory);

  expect(platform).toEqual({
    installer: {
      file: "coforge-installer.exe",
      size: binary.byteLength,
      checksum: sha256(binary),
      gzip: { file: "coforge-installer.exe.gz", size: gzip.byteLength, checksum: sha256(gzip) },
    },
  });
});

test("a sidecar that disagrees with the gzip's contents is refused, because bootstrap trusts the sidecar", async () => {
  const directory = await tempDir();
  const [gzipKey, sidecarKey] = await writeInstallerTargetObjects(
    { version: VERSION, target: "linux-arm64", binary: binaryFor("linux-arm64") },
    directory,
  );
  expect(gzipKey).toBeDefined();
  await writeFile(join(directory, sidecarKey!), `${"0".repeat(64)}\n`);

  await expect(readInstallerTargetPlatform(VERSION, "linux-arm64", directory)).rejects.toThrow(
    /linux-arm64.*sidecar/,
  );
});

test("a target with no objects on disk names the target and the objects it lacks", async () => {
  const directory = await tempDir();
  await mkdir(join(directory, "installer", VERSION), { recursive: true });

  await expect(readInstallerTargetPlatform(VERSION, "darwin-x64", directory)).rejects.toThrow(
    /darwin-x64.*coforge-installer\.gz/,
  );
});

test("a gzip that expands past the cap is refused instead of exhausting memory", async () => {
  const directory = await tempDir();
  const targetDirectory = join(directory, "installer", VERSION, "linux-x64");
  await mkdir(targetDirectory, { recursive: true });
  await writeFile(
    join(targetDirectory, "coforge-installer.gz"),
    Bun.gzipSync(Buffer.alloc(3 * 1024 * 1024)),
  );
  await writeFile(join(targetDirectory, "coforge-installer.sha256"), `${"0".repeat(64)}\n`);

  await expect(
    readInstallerTargetPlatform(VERSION, "linux-x64", directory, { maxExpandedBytes: 1024 * 1024 }),
  ).rejects.toThrow(/linux-x64.*expands/);
});

async function allTargetPlatforms() {
  const directory = await tempDir();
  const platforms: Record<string, Awaited<ReturnType<typeof readInstallerTargetPlatform>>> = {};
  for (const target of [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "windows-arm64",
    "windows-x64",
  ] as const) {
    await writeInstallerTargetObjects(
      { version: VERSION, target, binary: binaryFor(target) },
      directory,
    );
    platforms[target] = await readInstallerTargetPlatform(VERSION, target, directory);
  }
  return platforms;
}

test("the manifest assembled from per-target identities is one InstallerManifestSchema accepts", async () => {
  const platforms = await allTargetPlatforms();

  const manifest = assembleInstallerManifest({
    version: VERSION,
    commit: COMMIT,
    buildDate: BUILD_DATE,
    installerProtocol: 1,
    platforms,
  });

  // The proof that the publisher and the schema the clients read stay one contract: whatever the
  // publisher writes, the product's own zod schema must parse.
  const parsed = InstallerManifestSchema.parse(JSON.parse(JSON.stringify(manifest)));
  expect(parsed.version).toBe(VERSION);
  expect(parsed.commit).toBe(COMMIT);
  expect(parsed.buildDate).toBe(BUILD_DATE);
  expect(parsed.installer_protocol).toBe(1);
  expect(Object.keys(parsed.platforms).sort()).toEqual(Object.keys(platforms).sort());
  expect(parsed.platforms["windows-x64"]?.installer.file).toBe("coforge-installer.exe");
  expect(parsed.platforms["linux-x64"]?.installer.gzip.file).toBe("coforge-installer.gz");
});

test("the manifest carries exactly the fields of the committed golden, no more", async () => {
  const manifest = assembleInstallerManifest({
    version: VERSION,
    commit: COMMIT,
    buildDate: BUILD_DATE,
    installerProtocol: 1,
    platforms: await allTargetPlatforms(),
  });

  // The schema is loose, so it would accept a stray field; the golden is the shape clients expect.
  const keys = (value: object) => Object.keys(value).sort();
  const installerOf = (value: { platforms: Record<string, Record<string, unknown>> }) =>
    value.platforms["darwin-arm64"]!.installer as { gzip: object };
  const goldenManifest = golden as unknown as Parameters<typeof installerOf>[0];
  expect(keys(manifest)).toEqual(keys(golden));
  expect(keys(manifest.platforms["darwin-arm64"]!)).toEqual(
    keys(goldenManifest.platforms["darwin-arm64"]!),
  );
  expect(keys(installerOf(manifest))).toEqual(keys(installerOf(goldenManifest)));
  expect(keys(installerOf(manifest).gzip)).toEqual(keys(installerOf(goldenManifest).gzip));
});

test("a manifest with no platform, or a protocol that is not a positive integer, is never assembled", async () => {
  const platforms = await allTargetPlatforms();
  const base = { version: VERSION, commit: COMMIT, buildDate: BUILD_DATE, installerProtocol: 1 };

  expect(() => assembleInstallerManifest({ ...base, platforms: {} })).toThrow(/at least one/);
  for (const installerProtocol of [0, -1, 1.5, Number.NaN]) {
    expect(() => assembleInstallerManifest({ ...base, installerProtocol, platforms })).toThrow(
      /installer protocol/,
    );
  }
  expect(() => assembleInstallerManifest({ ...base, version: "../x", platforms })).toThrow(
    /valid version string/,
  );
  expect(() => assembleInstallerManifest({ ...base, buildDate: "yesterday", platforms })).toThrow(
    /buildDate/,
  );
});

/* ------------------------------------------------------------------------------------------- */
/* A binary is checked against its target before it is packaged                                  */
/* ------------------------------------------------------------------------------------------- */

const TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "windows-arm64",
  "windows-x64",
] as const;

test("each target accepts the header of its own format and CPU", () => {
  for (const target of TARGETS) {
    expect(() =>
      assertInstallerBinaryMatchesTarget(target, syntheticInstallerBinary(target)),
    ).not.toThrow();
  }
});

test("a binary built for another CPU of the same OS is refused, naming both", () => {
  const cases: Array<[string, Uint8Array, RegExp]> = [
    ["darwin-arm64", machOHeader(MACH_O_CPU.x86_64), /darwin-arm64.*x86_64/],
    ["darwin-x64", machOHeader(MACH_O_CPU.arm64), /darwin-x64.*arm64/],
    ["linux-arm64", elfHeader(ELF_MACHINE.x86_64), /linux-arm64.*x86_64/],
    ["linux-x64", elfHeader(ELF_MACHINE.aarch64), /linux-x64.*aarch64/],
    ["windows-arm64", peHeader(PE_MACHINE.amd64), /windows-arm64.*AMD64/],
    ["windows-x64", peHeader(PE_MACHINE.arm64), /windows-x64.*ARM64/],
  ];
  for (const [target, header, message] of cases) {
    expect(
      () => assertInstallerBinaryMatchesTarget(target, syntheticBinaryWithHeader(header)),
      target,
    ).toThrow(message);
  }
});

test("a binary of another OS's format is refused for every target", () => {
  const formats = {
    "Mach-O": machOHeader(MACH_O_CPU.arm64),
    ELF: elfHeader(ELF_MACHINE.x86_64),
    PE: peHeader(PE_MACHINE.amd64),
  };
  const own = { darwin: "Mach-O", linux: "ELF", windows: "PE" } as const;
  for (const target of TARGETS) {
    for (const [format, header] of Object.entries(formats)) {
      const check = () =>
        assertInstallerBinaryMatchesTarget(target, syntheticBinaryWithHeader(header));
      if (own[target.split("-")[0] as keyof typeof own] === format) continue;
      expect(check, `${target} given ${format}`).toThrow(new RegExp(`${target}.*not`));
    }
  }
});

test("a header that is the right format but not the one the installer needs is refused", () => {
  const damaged: Array<[string, string, Uint8Array]> = [
    ["darwin-arm64", "a fat Mach-O", Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2])],
    [
      "darwin-arm64",
      "a 32-bit Mach-O",
      (() => {
        const header = machOHeader(MACH_O_CPU.arm64);
        new DataView(header.buffer).setUint32(0, 0xfeedface, true);
        return header;
      })(),
    ],
    ["linux-x64", "a 32-bit ELF", elfHeader(ELF_MACHINE.x86_64, { elfClass: 1 })],
    ["linux-x64", "a big-endian ELF", elfHeader(ELF_MACHINE.x86_64, { endianness: 2 })],
    ["windows-x64", "a PE32 image", peHeader(PE_MACHINE.amd64, { optionalMagic: 0x10b })],
    [
      "windows-x64",
      "a PE header at nowhere",
      peHeader(PE_MACHINE.amd64, { declaredOffset: 0x7fffffff }),
    ],
    [
      "windows-x64",
      "a DOS stub with no PE signature",
      (() => {
        const header = peHeader(PE_MACHINE.amd64);
        header[0x80] = 0;
        return header;
      })(),
    ],
  ];
  for (const [target, what, header] of damaged) {
    expect(
      () => assertInstallerBinaryMatchesTarget(target, syntheticBinaryWithHeader(header)),
      `${target} given ${what}`,
    ).toThrow(new RegExp(target));
  }
});

test("a script, an empty file, and a truncated header are not installers", () => {
  for (const target of TARGETS) {
    for (const bytes of [
      Buffer.from("#!/bin/sh\necho installer\n"),
      new Uint8Array(),
      new Uint8Array([0x7f, 0x45]),
      new Uint8Array([0x4d, 0x5a]),
      machOHeader(MACH_O_CPU.arm64).slice(0, 6),
    ]) {
      expect(() => assertInstallerBinaryMatchesTarget(target, bytes), target).toThrow(
        new RegExp(target),
      );
    }
  }
});

test("a target with no known format is refused rather than passed", () => {
  expect(() =>
    assertInstallerBinaryMatchesTarget("freebsd-x64", syntheticInstallerBinary("linux-x64")),
  ).toThrow(/unsupported release target/);
});
