/** What a cloud image replace drops, and what the named volume keeps. */
export const cloudImageUpdateConsequences = {
  lost: ["in_flight_runs", "volatile_memory", "brief_disconnect"] as const,
  kept: ["volume_files", "workspace_bindings", "agents_after_reconnect"] as const,
};

export function cloudImageUpdateAvailable(
  runningImageId: string | undefined,
  availableImageId: string | undefined,
): boolean {
  return Boolean(runningImageId && availableImageId && runningImageId !== availableImageId);
}
