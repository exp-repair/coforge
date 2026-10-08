import { mkdir, writeFile } from "node:fs/promises";
import { upgradeReceiptPath, upgradeResultsDirectory } from "@lrm/coforge-daemon";
import type { UpgradeResult } from "@lrm/coforge-sdk/internal/upgrade-receipt";

import { assertUpgradeRequestId } from "./upgrade-operation";

/** An upgrade that did not succeed. `result` is the receipt the operation left behind. */
export class UpgradeFailedError extends Error {
  constructor(
    message: string,
    readonly result: UpgradeResult,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "UpgradeFailedError";
  }
}

/**
 * Writes a failed receipt for an operation the installer left none for. It is created exclusively:
 * a receipt that already exists is the installer's and is never replaced, so the caller reads it
 * back afterwards instead of trusting this write.
 */
export async function writeFallbackReceipt(
  installRoot: string,
  result: UpgradeResult,
): Promise<void> {
  assertUpgradeRequestId(result.request_id);
  const directory = upgradeResultsDirectory(installRoot);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      upgradeReceiptPath(installRoot, result.request_id),
      `${JSON.stringify(result)}\n`,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
