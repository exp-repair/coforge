import { join } from "node:path";
import {
  InstallerReceiptSchema,
  UPGRADE_RECEIPT_MAX_BYTES,
  UpgradeResultSchema,
  type UpgradeResult,
} from "@lrm/coforge-sdk/internal/upgrade-receipt";

/**
 * The single reader of an upgrade operation's receipt file, `<install root>/upgrade-results/
 * <request id>.result.json`. Both the Computer's upgrade runner and the Daemon's receipt watch read
 * through it, so the size cap, the shapes accepted, and the held-to-failed mapping live once.
 */

/** `<install root>/upgrade-results`, where every operation's receipt lives. */
export function upgradeResultsDirectory(installRoot: string): string {
  return join(installRoot, "upgrade-results");
}

/** One operation's receipt file. The request id is not validated here; writers do that. */
export function upgradeReceiptPath(installRoot: string, requestId: string): string {
  return join(upgradeResultsDirectory(installRoot), `${requestId}.result.json`);
}

export type UpgradeReceiptFile = {
  /** The receipt as the operation settles it: a held receipt reads as a failed one, since the
   * wire has no held status. Other fields are the receipt's own, unchanged. */
  result: UpgradeResult;
  /** When the receipt became durable, from the file system. */
  modifiedAt: number;
};

/**
 * Reads one operation's receipt. Resolves to undefined while the file does not exist. A file that
 * exists but cannot be read as a receipt (over `UPGRADE_RECEIPT_MAX_BYTES`, not JSON, no known
 * shape, or naming another request) throws, so each caller decides whether that is evidence.
 */
export async function readUpgradeReceipt(
  installRoot: string,
  requestId: string,
): Promise<UpgradeReceiptFile | undefined> {
  const resultPath = upgradeReceiptPath(installRoot, requestId);
  const file = Bun.file(resultPath);
  if (!(await file.exists())) return undefined;
  if (file.size > UPGRADE_RECEIPT_MAX_BYTES)
    throw new Error(
      `upgrade receipt is larger than ${UPGRADE_RECEIPT_MAX_BYTES} bytes: ${resultPath}`,
    );
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error(`upgrade receipt is not valid JSON: ${resultPath}`);
  }
  const result = parseUpgradeReceipt(value);
  if (!result || result.request_id !== requestId)
    throw new Error(`upgrade receipt matches no known shape: ${resultPath}`);
  return { result, modifiedAt: file.lastModified };
}

function parseUpgradeReceipt(value: unknown): UpgradeResult | undefined {
  const installer = InstallerReceiptSchema.safeParse(value);
  if (installer.success) {
    const status = installer.data.status === "succeeded" ? "succeeded" : "failed";
    return { ...installer.data, status };
  }
  const product = UpgradeResultSchema.safeParse(value);
  return product.success ? product.data : undefined;
}
