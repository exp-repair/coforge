import { homedir } from "node:os";

import { cleanupComputerUpgradeJob } from "@lrm/coforge-daemon";

import { resolveComputerStateDirectory } from "#src/paths";

import { runUpgradeOperation } from "./upgrade-runner";
import type { UpgradeOperation } from "./upgrade-operation";

/** Runs one server-triggered operation. The Daemon observes it only through its durable
 * receipt, so this entry point produces no terminal output and never throws past the receipt. */
export async function runRemoteUpgrade(operation: UpgradeOperation): Promise<void> {
  try {
    await runUpgradeOperation(operation);
  } finally {
    // The job has no KeepAlive, so leaving it in place cannot make it respawn; this only clears
    // the now-idle `launchctl list` entry and its plist once the result file above is durable, so
    // a retried upgrade never collides with a stale label. Best-effort: `launchctl bootout`
    // targeting your own still-running job is unreliable on some macOS versions, and the
    // Coordinator's startup sweep is the backstop if this does not complete.
    const stateDirectory = resolveComputerStateDirectory({
      platform: process.platform,
      homeDirectory: homedir(),
      environment: Bun.env,
    });
    await cleanupComputerUpgradeJob(operation.requestId, { stateDirectory }).catch(() => {});
  }
}
