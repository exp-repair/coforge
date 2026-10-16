import { expect, test } from "bun:test";

import { collectPlanSubmitBlocked } from "../src/features/records/weekly-report-collect-plan";

const ready = {
  computerId: "computer-1",
  bindingId: "binding-1",
  collectorAgentId: "agent-1",
  ready: true,
};

test("collect plan submit stays blocked without a computer, a check, or a binding", () => {
  expect(collectPlanSubmitBlocked([], [])).toBe(true);
  expect(collectPlanSubmitBlocked([ready], [])).toBe(true);
  expect(
    collectPlanSubmitBlocked(
      [{ computerId: "computer-1", bindingId: null, collectorAgentId: null, ready: false }],
      ["computer-1"],
    ),
  ).toBe(true);
  expect(collectPlanSubmitBlocked([ready], ["computer-1"])).toBe(false);
});
