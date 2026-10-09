import { describe, expect, test } from "bun:test";

import { collapsedMessageHeightPx, overflowsCollapsedMessage } from "./collapsed-message-height";

describe("collapsed message height", () => {
  test("is four lines of the body's line height at the default message font size", () => {
    expect(collapsedMessageHeightPx(21)).toBe(84);
  });

  test("grows with the line height so a larger Message font size or Text size keeps four lines", () => {
    expect(collapsedMessageHeightPx(24)).toBe(96);
  });

  test("a body collapses only when it is taller than four of its own lines", () => {
    expect(overflowsCollapsedMessage(90, 21)).toBe(true);
    expect(overflowsCollapsedMessage(90, 24)).toBe(false);
    expect(overflowsCollapsedMessage(85, 21)).toBe(false);
  });
});
