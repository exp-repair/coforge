import { describe, expect, test } from "bun:test";

import { selectBundles, splitBundle } from "./bundle";
import { isWithin, parseRelease, verifySha256 } from "./extract";
import { findSeaBlob } from "./sea-blob";
import { parseSeaResource } from "./sea-resource";

const encoder = new TextEncoder();

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function fixedName(name: string): Uint8Array {
  const out = new Uint8Array(16);
  out.set(encoder.encode(name));
  return out;
}

/** A thin 64-bit Mach-O: a `__TEXT,__text` segment, then one segment per given section. */
function machO(sections: { segname: string; sectname: string; payload: Uint8Array }[]) {
  const text = { segname: "__TEXT", sectname: "__text", payload: encoder.encode("text") };
  const all = [text, ...sections];
  const commandSize = 72 + 80;
  let dataOffset = 32 + all.length * commandSize;
  const commands: Uint8Array[] = [];
  const offsets: number[] = [];
  for (const { segname, sectname, payload } of all) {
    const command = new Uint8Array(commandSize);
    const view = new DataView(command.buffer);
    view.setUint32(0, 0x19, true); // LC_SEGMENT_64
    view.setUint32(4, commandSize, true);
    command.set(fixedName(segname), 8);
    view.setBigUint64(40, BigInt(dataOffset), true); // fileoff
    view.setBigUint64(48, BigInt(payload.length), true); // filesize
    view.setUint32(64, 1, true); // nsects
    command.set(fixedName(sectname), 72);
    command.set(fixedName(segname), 72 + 16);
    view.setBigUint64(72 + 40, BigInt(payload.length), true); // size
    view.setUint32(72 + 48, dataOffset, true); // offset
    commands.push(command);
    offsets.push(dataOffset);
    dataOffset += payload.length;
  }
  const header = new Uint8Array(32);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0xfeedfacf, true);
  view.setUint32(4, 0x0100000c, true); // CPU_TYPE_ARM64
  view.setUint32(16, all.length, true);
  view.setUint32(20, all.length * commandSize, true);
  return { bytes: concat(header, ...commands, ...all.map((s) => s.payload)), offsets };
}

function note(name: string, type: number, desc: Uint8Array): Uint8Array {
  const nameBytes = encoder.encode(`${name}\0`);
  const pad = (n: number) => (n + 3) & ~3;
  const out = new Uint8Array(12 + pad(nameBytes.length) + pad(desc.length));
  const view = new DataView(out.buffer);
  view.setUint32(0, nameBytes.length, true);
  view.setUint32(4, desc.length, true);
  view.setUint32(8, type, true);
  out.set(nameBytes, 12);
  out.set(desc, 12 + pad(nameBytes.length));
  return out;
}

/** A 64-bit little-endian ELF with a PT_LOAD and one PT_NOTE segment holding the given notes. */
function elf(notes: Uint8Array[]) {
  const segment = concat(...notes);
  const phoff = 64;
  const noteOffset = phoff + 2 * 56;
  const header = new Uint8Array(noteOffset);
  const view = new DataView(header.buffer);
  header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  view.setBigUint64(0x20, BigInt(phoff), true);
  view.setUint16(0x36, 56, true);
  view.setUint16(0x38, 2, true);
  view.setUint32(phoff, 1, true); // PT_LOAD
  view.setUint32(phoff + 56, 4, true); // PT_NOTE
  view.setBigUint64(phoff + 56 + 8, BigInt(noteOffset), true); // p_offset
  view.setBigUint64(phoff + 56 + 32, BigInt(segment.length), true); // p_filesz
  view.setBigUint64(phoff + 56 + 48, 4n, true); // p_align
  return { bytes: concat(header, segment), noteOffset };
}

describe("findSeaBlob", () => {
  test("returns the Mach-O __NODE_SEA_BLOB section's file offset and size", () => {
    const payload = encoder.encode("sea blob payload");
    const { bytes, offsets } = machO([
      { segname: "__DATA", sectname: "__data", payload: encoder.encode("decoy") },
      { segname: "NODE_SEA", sectname: "__NODE_SEA_BLOB", payload },
    ]);
    const blob = findSeaBlob(bytes);
    expect(blob).toMatchObject({ format: "mach-o", offset: offsets[2], size: payload.length });
    expect(bytes.subarray(blob.offset, blob.offset + blob.size)).toEqual(payload);
  });

  test("refuses a Mach-O without the section, or whose section runs past the file", () => {
    const data = { segname: "__DATA", sectname: "__data", payload: encoder.encode("x") };
    const { bytes } = machO([data]);
    expect(() => findSeaBlob(bytes)).toThrow(/__NODE_SEA_BLOB/);
    const truncated = machO([
      { segname: "NODE_SEA", sectname: "__NODE_SEA_BLOB", payload: encoder.encode("payload") },
    ]).bytes;
    expect(() => findSeaBlob(truncated.subarray(0, truncated.length - 1))).toThrow(/past the end/);
  });

  test("refuses a universal (fat) Mach-O and an unknown format", () => {
    expect(() => findSeaBlob(new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]))).toThrow(/thin/);
    expect(() => findSeaBlob(encoder.encode("MZ not a supported executable"))).toThrow(/format/);
  });

  test("returns the ELF NODE_SEA_BLOB note's descriptor, stepping over earlier notes", () => {
    const payload = encoder.encode("sea blob payload");
    const gnu = note("GNU", 3, new Uint8Array([1, 2, 3, 4, 5])); // desc padded from 5 to 8
    const { bytes, noteOffset } = elf([gnu, note("NODE_SEA_BLOB", 0, payload)]);
    const blob = findSeaBlob(bytes);
    const expected = noteOffset + gnu.length + 12 + 16; // header, then "NODE_SEA_BLOB\0" padded
    expect(blob).toMatchObject({ format: "elf", offset: expected, size: payload.length });
    expect(bytes.subarray(blob.offset, blob.offset + blob.size)).toEqual(payload);
  });

  test("refuses an ELF without the NODE_SEA_BLOB note", () => {
    const { bytes } = elf([note("GNU", 3, new Uint8Array(4))]);
    expect(() => findSeaBlob(bytes)).toThrow(/NODE_SEA_BLOB/);
  });
});

/** A Node.js SEA resource, laid out as Node v24.21.0's SeaSerializer::Write writes it. */
function seaBlob(options: {
  flags: number;
  codePath: string;
  main: string;
  codeCache?: Uint8Array;
  assets?: [string, string][];
  execArgv?: string[];
}) {
  const u64 = (n: number) => {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
    return out;
  };
  const string = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    return concat(u64(bytes.length), bytes);
  };
  const header = new Uint8Array(9);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x0143da20, true);
  view.setUint32(4, options.flags, true);
  header[8] = 1;
  const parts = [header, string(options.codePath), string(options.main)];
  if (options.codeCache) parts.push(string(options.codeCache));
  if (options.assets) {
    parts.push(u64(options.assets.length));
    for (const [key, content] of options.assets) parts.push(string(key), string(content));
  }
  if (options.execArgv) {
    parts.push(u64(options.execArgv.length), ...options.execArgv.map(string));
  }
  return concat(...parts);
}

const banner = (version: string) => `/* raft-computer SEA bundle v${version} */\n`;

describe("parseSeaResource", () => {
  test("reads a blob whose main script is the whole bundle", () => {
    const main = `${banner("1.0.47")}// packages/computer/src/cli.ts\ncli();\n`;
    const parsed = parseSeaResource(
      seaBlob({ flags: 1, codePath: "/var/T/raft-computer-sea/computer-bundle.cjs", main }),
    );
    expect(parsed.codePath).toBe("/var/T/raft-computer-sea/computer-bundle.cjs");
    expect(parsed.resources.map(({ name, role }) => ({ name, role }))).toEqual([
      { name: "computer-bundle.cjs", role: "main" },
    ]);
    const [resource] = parsed.resources;
    expect(new TextDecoder().decode(resource!.content)).toBe(main);
    expect(resource!.offset).toBe(9 + 8 + 44 + 8);
  });

  test("reads a loader main script, a code cache, assets, and exec arguments", () => {
    const parsed = parseSeaResource(
      seaBlob({
        flags: 1 | 4 | 8 | 16,
        codePath: "C:\\T\\sea-loader.cjs",
        main: "loader();",
        codeCache: new Uint8Array([1, 2, 3]),
        assets: [
          ["computer.cjs", `${banner("1.0.50")}computer();`],
          ["cli.cjs", "cli();"],
        ],
        execArgv: ["--no-warnings"],
      }),
    );
    expect(parsed.codeCacheBytes).toBe(3);
    expect(parsed.execArgv).toEqual(["--no-warnings"]);
    expect(parsed.resources.map(({ name, role }) => `${role}:${name}`)).toEqual([
      "main:sea-loader.cjs",
      "asset:computer.cjs",
      "asset:cli.cjs",
    ]);
    expect(new TextDecoder().decode(parsed.resources[2]!.content)).toBe("cli();");
  });

  test("fails closed on a layout it does not recognise", () => {
    const valid = seaBlob({ flags: 1, codePath: "/a.cjs", main: "a();" });
    expect(() => parseSeaResource(valid.subarray(0, valid.length - 1))).toThrow(/past the end/);
    expect(() => parseSeaResource(concat(valid, new Uint8Array([0])))).toThrow(/trailing/);
    const withFlags = (flags: number) => seaBlob({ flags, codePath: "/a.cjs", main: "" });
    expect(() => parseSeaResource(withFlags(1 << 5))).toThrow(/unknown SEA flags/);
    expect(() => parseSeaResource(withFlags(2))).toThrow(/snapshot/);
    const wrongMagic = valid.slice();
    wrongMagic[0] = 0;
    expect(() => parseSeaResource(wrongMagic)).toThrow(/magic/);
    expect(() =>
      parseSeaResource(seaBlob({ flags: 8, codePath: "/a.cjs", main: "", assets: [["../x", ""]] })),
    ).toThrow(/unsafe/);
  });
});

describe("selectBundles", () => {
  const resource = (name: string, text: string) => ({
    name,
    role: "asset" as const,
    offset: 0,
    content: encoder.encode(text),
  });

  test("selects the resources that start with the resolved version's banner", () => {
    const resources = [
      resource("sea-loader.cjs", "loader();"),
      resource("computer.cjs", `${banner("1.0.50")}computer();`),
      resource("cli.cjs", `cli("${banner("1.0.50")}");`),
    ];
    expect(selectBundles(resources, "1.0.50").map(({ name }) => name)).toEqual(["computer.cjs"]);
  });

  test("fails when no resource starts with that banner", () => {
    const texts = ["const a = 1;", banner("1.0.46"), banner("1.0.470"), `x${banner("1.0.47")}`];
    for (const text of texts) {
      const select = () => selectBundles([resource("main.cjs", text)], "1.0.47");
      expect(select).toThrow(/v1\.0\.47 banner/);
    }
  });
});

describe("splitBundle", () => {
  test("splits at path markers, appends repeats, and keeps other comments as content", () => {
    const text = [
      "/* banner */",
      "// packages/computer/src/cli.ts",
      "const cli = 1;",
      "// a plain comment",
      "// packages/not a marker.ts",
      "  // packages/indented.ts",
      "// node_modules/.pnpm/dep@1/node_modules/dep/index.js",
      "dep();",
      "// packages/computer/src/cli.ts",
      "cli();",
      "",
    ].join("\n");
    const files = splitBundle(text);
    expect([...files.keys()]).toEqual([
      "packages/computer/src/cli.ts",
      "node_modules/.pnpm/dep@1/node_modules/dep/index.js",
    ]);
    expect(files.get("packages/computer/src/cli.ts")).toBe(
      [
        "const cli = 1;",
        "// a plain comment",
        "// packages/not a marker.ts",
        "  // packages/indented.ts",
        "cli();",
        "",
      ].join("\n"),
    );
    expect(files.get("node_modules/.pnpm/dep@1/node_modules/dep/index.js")).toBe("dep();\n");
  });

  test("refuses a marker that would escape the tree", () => {
    expect(() => splitBundle("// packages/../../etc/passwd\nx\n")).toThrow(/unsafe path/);
    expect(() => splitBundle("// node_modules/a//b.js\nx\n")).toThrow(/unsafe path/);
    expect(() => splitBundle("// packages/./a.js\nx\n")).toThrow(/unsafe path/);
  });
});

describe("verifySha256", () => {
  const bytes = encoder.encode("artifact");

  test("accepts the expected digest and fails closed on a mismatch", () => {
    expect(verifySha256(bytes, sha256(bytes), "binary")).toBe(sha256(bytes));
    expect(() => verifySha256(bytes, sha256(encoder.encode("other")), "binary")).toThrow(
      /binary sha256 mismatch/,
    );
  });
});

describe("parseRelease", () => {
  const hex = "a".repeat(64);
  const metadata = (overrides: Record<string, unknown> = {}) => ({
    release: { id: "r-1", version: "1.0.47" },
    artifact: {
      id: "darwin-arm64",
      platform: "darwin",
      arch: "arm64",
      sha256: hex,
      gzip: { sha256: hex, download_url: "https://hands.build/dl/x/darwin-arm64.gz" },
    },
    ...overrides,
  });

  test("returns the release and its gzip artifact when they echo the request", () => {
    expect(parseRelease(metadata(), { platform: "darwin", arch: "arm64" })).toEqual({
      version: "1.0.47",
      releaseId: "r-1",
      target: "darwin-arm64",
      binarySha256: hex,
      gzipSha256: hex,
      gzipUrl: "https://hands.build/dl/x/darwin-arm64.gz",
    });
  });

  test("refuses another target, another version, a malformed digest, or a non-https URL", () => {
    const request = { platform: "darwin", arch: "arm64" };
    expect(() => parseRelease(metadata(), { platform: "linux", arch: "arm64" })).toThrow(/target/);
    expect(() => parseRelease(metadata(), { ...request, version: "1.0.48" })).toThrow(/1\.0\.48/);
    const bad = metadata();
    bad.artifact.sha256 = "zz";
    expect(() => parseRelease(bad, request)).toThrow(/sha256/);
    const http = metadata();
    http.artifact.gzip.download_url = "http://hands.build/dl/x.gz";
    expect(() => parseRelease(http, request)).toThrow(/https/);
  });
});

describe("isWithin", () => {
  test("detects a path at or below a root, but not a sibling sharing its prefix", () => {
    expect(isWithin("/repo", "/repo")).toBe(true);
    expect(isWithin("/repo/out/x", "/repo")).toBe(true);
    expect(isWithin("/repo-out", "/repo")).toBe(false);
    expect(isWithin("/tmp/out", "/repo")).toBe(false);
  });
});
