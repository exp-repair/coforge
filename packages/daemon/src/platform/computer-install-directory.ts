import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/**
 * The Computer's install root, `<home>/.coforge/computer/install`: the versioned installation, the
 * upgrade receipts, and the installer's recovery journal. Computer and Daemon both resolve it here,
 * so a platform rule lives in one place. Resolves `os.homedir()` by default; the installer follows
 * the same rule (`crates/installer/contract/paths.json`).
 */
export function resolveComputerInstallDirectory(
  input: { platform: NodeJS.Platform; homeDirectory: string } = {
    platform: process.platform,
    homeDirectory: homedir(),
  },
): string {
  const parts = [".coforge", "computer", "install"];
  if (input.platform === "win32") return win32.join(input.homeDirectory, ...parts);
  if (input.platform === "linux" || input.platform === "darwin")
    return posix.join(input.homeDirectory, ...parts);
  throw new Error(`unsupported platform: ${input.platform}`);
}
