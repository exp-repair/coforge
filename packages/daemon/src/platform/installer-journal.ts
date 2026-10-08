import { existsSync } from "node:fs";
import { join } from "node:path";

import { resolveComputerInstallDirectory } from "./computer-install-directory";

/**
 * The installer's recovery journal, `<install root>/installer-transaction.json`. The installer
 * writes it before it stops the Computer supervisor and clears it once the machine is in a known
 * good state again, so its presence while this daemon shuts down means an upgrade took it down.
 */
export function installerJournalPath(installRoot = resolveComputerInstallDirectory()): string {
  return join(installRoot, "installer-transaction.json");
}

export function installerJournalExists(installRoot = resolveComputerInstallDirectory()): boolean {
  return existsSync(installerJournalPath(installRoot));
}
