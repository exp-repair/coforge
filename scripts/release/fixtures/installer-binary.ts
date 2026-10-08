/**
 * Tiny synthetic executables for the installer release tests: just the header bytes the publisher
 * reads to tell a Mach-O, an ELF and a PE file apart, and to read their CPU, followed by padding
 * that differs per target. Nothing here runs, and nothing here is a valid program.
 */

const HEADER_PADDING = 2048;

/** The little-endian machine values the publisher accepts, by release target. */
export const MACH_O_CPU = { arm64: 0x0100000c, x86_64: 0x01000007 } as const;
export const ELF_MACHINE = { aarch64: 0xb7, x86_64: 0x3e } as const;
export const PE_MACHINE = { arm64: 0xaa64, amd64: 0x8664 } as const;

function withBody(header: Uint8Array, label: string): Uint8Array {
  const body = Buffer.from(`${label}:`.padEnd(HEADER_PADDING, "."));
  const bytes = new Uint8Array(header.byteLength + body.byteLength);
  bytes.set(header);
  bytes.set(body, header.byteLength);
  return bytes;
}

/** A 64-bit little-endian Mach-O header for `cpuType`. */
export function machOHeader(cpuType: number): Uint8Array {
  const header = new DataView(new ArrayBuffer(32));
  header.setUint32(0, 0xfeedfacf, true);
  header.setUint32(4, cpuType, true);
  return new Uint8Array(header.buffer);
}

/** An ELF header: class 2 (64-bit), little-endian, executable, for `machine`. */
export function elfHeader(
  machine: number,
  options: { elfClass?: number; endianness?: number } = {},
): Uint8Array {
  const header = new DataView(new ArrayBuffer(64));
  new Uint8Array(header.buffer).set([
    0x7f,
    0x45,
    0x4c,
    0x46,
    options.elfClass ?? 2,
    options.endianness ?? 1,
    1,
  ]);
  header.setUint16(16, 2, true);
  header.setUint16(18, machine, true);
  return new Uint8Array(header.buffer);
}

/** A DOS header pointing at a PE signature, COFF header and optional-header magic. */
export function peHeader(
  machine: number,
  options: { optionalMagic?: number; peOffset?: number; declaredOffset?: number } = {},
): Uint8Array {
  const peOffset = options.peOffset ?? 0x80;
  const header = new DataView(new ArrayBuffer(peOffset + 26));
  new Uint8Array(header.buffer).set([0x4d, 0x5a]);
  // `declaredOffset` lets a test point the DOS header somewhere the file does not reach.
  header.setUint32(0x3c, options.declaredOffset ?? peOffset, true);
  new Uint8Array(header.buffer).set([0x50, 0x45, 0, 0], peOffset);
  header.setUint16(peOffset + 4, machine, true);
  header.setUint16(peOffset + 24, options.optionalMagic ?? 0x20b, true);
  return new Uint8Array(header.buffer);
}

/** The header the publisher expects of `target`'s installer. */
function headerFor(target: string): Uint8Array {
  switch (target) {
    case "darwin-arm64":
      return machOHeader(MACH_O_CPU.arm64);
    case "darwin-x64":
      return machOHeader(MACH_O_CPU.x86_64);
    case "linux-arm64":
      return elfHeader(ELF_MACHINE.aarch64);
    case "linux-x64":
      return elfHeader(ELF_MACHINE.x86_64);
    case "windows-arm64":
      return peHeader(PE_MACHINE.arm64);
    case "windows-x64":
      return peHeader(PE_MACHINE.amd64);
    default:
      throw new Error(`no synthetic installer for target: ${target}`);
  }
}

/** A stand-in for `target`'s built installer: its real header, then bytes unique to the target. */
export function syntheticInstallerBinary(target: string): Uint8Array {
  return withBody(headerFor(target), `installer for ${target}`);
}

/** A stand-in with `header` in front of it, for a test that wants a wrong or damaged one. */
export function syntheticBinaryWithHeader(header: Uint8Array, label = "other"): Uint8Array {
  return withBody(header, label);
}
