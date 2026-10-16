type CollectPlanSlot = {
  computerId: string;
  bindingId: string | null;
  collectorAgentId: string | null;
  ready: boolean;
};

/** Submit stays unavailable until a bound, ready Collector is checked. */
export function collectPlanSubmitBlocked(
  slots: readonly CollectPlanSlot[],
  selected: readonly string[],
): boolean {
  if (slots.length === 0 || selected.length === 0) return true;
  return selected.some((id) => {
    const slot = slots.find((row) => row.computerId === id);
    return !slot?.bindingId || !slot.collectorAgentId || !slot.ready;
  });
}
