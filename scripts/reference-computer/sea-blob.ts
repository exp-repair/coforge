/**
 * Locates the Node.js single-executable-application (SEA) blob that postject injected into a
 * native executable, by reading the executable's own headers. Nothing here executes the file.
 *
 * - Mach-O (macOS): a `__NODE_SEA_BLOB` section, in a `NODE_SEA` segment. The section's file
 *   `offset` and `size` are what `otool -l` reports.
 * - ELF (Linux): postject does not add a section; it appends a note named `NODE_SEA_BLOB` to a
 *   `PT_NOTE` program header, so `readelf -S` lists no such section. The blob is the note's
 *   descriptor.
 *
 * Only thin 64-bit little-endian files are supported: every shipped macOS and Linux target is one.
 */

export type SeaBlob = {
  format: "mach-o" | "elf";
  /** Byte offset of the blob within the executable. */
  offset: number;
  size: number;
};

const MACHO_SECTION = "__NODE_SEA_BLOB";
const ELF_NOTE = "NODE_SEA_BLOB";

export function findSeaBlob(bytes: Uint8Array): SeaBlob {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4) throw new Error("not an executable: file is shorter than its magic");
  const magic = view.getUint32(0, false);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    throw new Error("universal (fat) Mach-O is not supported; select a thin artifact");
  }
  if (magic === 0xcffaedfe) return checked(bytes, findInMachO(bytes, view));
  if (magic === 0x7f454c46) return checked(bytes, findInElf(bytes, view));
  throw new Error(
    "unsupported executable format: expected a thin 64-bit little-endian Mach-O or ELF",
  );
}

function checked(bytes: Uint8Array, blob: SeaBlob): SeaBlob {
  if (blob.offset + blob.size > bytes.length) {
    throw new Error(
      `${blob.format} SEA blob at ${blob.offset} (+${blob.size}) runs past the end of the file`,
    );
  }
  return blob;
}

function fixedString(bytes: Uint8Array, at: number, length: number): string {
  const raw = bytes.subarray(at, at + length);
  const end = raw.indexOf(0);
  return new TextDecoder().decode(end < 0 ? raw : raw.subarray(0, end));
}

function safeNumber(value: bigint, what: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${what} is out of range`);
  return Number(value);
}

function findInMachO(bytes: Uint8Array, view: DataView): SeaBlob {
  const LC_SEGMENT_64 = 0x19;
  const commandCount = view.getUint32(16, true);
  let at = 32; // mach_header_64
  for (let i = 0; i < commandCount; i++) {
    const command = view.getUint32(at, true);
    const commandSize = view.getUint32(at + 4, true);
    if (commandSize < 8) throw new Error(`Mach-O load command ${i} has an invalid size`);
    if (command === LC_SEGMENT_64) {
      const sectionCount = view.getUint32(at + 64, true);
      for (let s = 0; s < sectionCount; s++) {
        const section = at + 72 + s * 80; // segment_command_64, then section_64 entries
        if (fixedString(bytes, section, 16) !== MACHO_SECTION) continue;
        return {
          format: "mach-o",
          offset: view.getUint32(section + 48, true),
          size: safeNumber(view.getBigUint64(section + 40, true), "Mach-O section size"),
        };
      }
    }
    at += commandSize;
  }
  throw new Error(`Mach-O has no ${MACHO_SECTION} section`);
}

function findInElf(bytes: Uint8Array, view: DataView): SeaBlob {
  if (bytes[4] !== 2 || bytes[5] !== 1) {
    throw new Error("unsupported ELF: expected 64-bit little-endian");
  }
  const PT_NOTE = 4;
  const programHeaders = safeNumber(view.getBigUint64(0x20, true), "ELF e_phoff");
  const entrySize = view.getUint16(0x36, true);
  const entryCount = view.getUint16(0x38, true);
  for (let i = 0; i < entryCount; i++) {
    const header = programHeaders + i * entrySize;
    if (view.getUint32(header, true) !== PT_NOTE) continue;
    const start = safeNumber(view.getBigUint64(header + 8, true), "ELF p_offset");
    const end = start + safeNumber(view.getBigUint64(header + 32, true), "ELF p_filesz");
    const align = view.getBigUint64(header + 48, true) === 8n ? 8 : 4;
    const pad = (n: number) => Math.ceil(n / align) * align;
    for (let at = start; at + 12 <= end;) {
      const nameSize = view.getUint32(at, true);
      const descSize = view.getUint32(at + 4, true);
      const desc = at + 12 + pad(nameSize);
      if (fixedString(bytes, at + 12, nameSize) === ELF_NOTE) {
        return { format: "elf", offset: desc, size: descSize };
      }
      at = desc + pad(descSize);
    }
  }
  throw new Error(`ELF has no ${ELF_NOTE} note in any PT_NOTE segment`);
}
