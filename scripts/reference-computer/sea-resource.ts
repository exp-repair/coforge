/**
 * Decodes a Node.js single-executable-application resource (the bytes of the SEA blob) into its
 * main script and assets. The layout follows `SeaSerializer::Write` in Node v24.21.0, the Node the
 * reference Computer embeds:
 * https://github.com/nodejs/node/blob/v24.21.0/src/node_sea.cc
 *
 *   u32 magic, u32 flags, u8 exec-argv extension,
 *   string code path, string main script,
 *   string code cache        (if kUseCodeCache),
 *   u64 count, count × (string key, string content)   (if kIncludeAssets),
 *   u64 count, count × string                          (if kIncludeExecArgv)
 *
 * where a string is a little-endian u64 length followed by that many bytes. Any other shape (an
 * unknown flag, a snapshot, a length past the end, trailing bytes) means the layout changed, and
 * the parse fails rather than guessing.
 */
import { assertSafePath } from "./bundle";

const MAGIC = 0x0143da20;
const USE_SNAPSHOT = 1 << 1;
const USE_CODE_CACHE = 1 << 2;
const INCLUDE_ASSETS = 1 << 3;
const INCLUDE_EXEC_ARGV = 1 << 4;
const KNOWN_FLAGS = 0b11111;

export type SeaResourceEntry = {
  /** The main script's file name, or the asset key. */
  name: string;
  role: "main" | "asset";
  /** Byte offset of the content within the blob. */
  offset: number;
  content: Uint8Array;
};

export type SeaResource = {
  flags: number;
  codePath: string;
  codeCacheBytes?: number;
  execArgv: string[];
  resources: SeaResourceEntry[];
};

export function parseSeaResource(blob: Uint8Array): SeaResource {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const decoder = new TextDecoder();
  let at = 0;
  const need = (bytes: number, what: string) => {
    if (at + bytes > blob.length) throw new Error(`SEA ${what} runs past the end of the blob`);
  };
  const readBytes = (what: string) => {
    need(8, `${what} length`);
    const length = view.getBigUint64(at, true);
    if (length > BigInt(blob.length - at - 8)) {
      throw new Error(`SEA ${what} runs past the end of the blob`);
    }
    const start = at + 8;
    at = start + Number(length);
    return { offset: start, content: blob.subarray(start, at) };
  };
  const readCount = (what: string) => {
    need(8, what);
    const count = view.getBigUint64(at, true);
    at += 8;
    if (count > BigInt(blob.length)) throw new Error(`SEA ${what} runs past the end of the blob`);
    return Number(count);
  };

  need(9, "header");
  if (view.getUint32(0, true) !== MAGIC) throw new Error("SEA blob has the wrong magic");
  const flags = view.getUint32(4, true);
  at = 9;
  if ((flags & ~KNOWN_FLAGS) !== 0) {
    throw new Error(`unknown SEA flags 0x${flags.toString(16)}: the resource layout changed`);
  }
  if (flags & USE_SNAPSHOT) throw new Error("SEA main resource is a V8 snapshot, not a script");

  const codePath = decoder.decode(readBytes("code path").content);
  const name = codePath.split(/[\\/]/).at(-1) ?? "";
  assertSafePath(name);
  const resources: SeaResourceEntry[] = [{ name, role: "main", ...readBytes("main script") }];
  const codeCache = flags & USE_CODE_CACHE ? readBytes("code cache") : undefined;
  const codeCacheBytes = codeCache?.content.length;
  if (flags & INCLUDE_ASSETS) {
    for (let i = readCount("asset count"); i > 0; i--) {
      const key = decoder.decode(readBytes("asset key").content);
      assertSafePath(key);
      resources.push({ name: key, role: "asset", ...readBytes(`asset ${key}`) });
    }
  }
  const execArgv: string[] = [];
  if (flags & INCLUDE_EXEC_ARGV) {
    for (let i = readCount("exec argv count"); i > 0; i--) {
      execArgv.push(decoder.decode(readBytes("exec argv").content));
    }
  }
  if (at !== blob.length) {
    throw new Error(`SEA blob has ${blob.length - at} trailing bytes: the resource layout changed`);
  }
  return { flags, codePath, codeCacheBytes, execArgv, resources };
}
