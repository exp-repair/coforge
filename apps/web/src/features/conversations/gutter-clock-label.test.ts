import { describe, expect, test } from "bun:test";

import { gutterClockLabel } from "./gutter-clock-label";

const AT = new Date("2026-09-29T14:50:00Z");

describe("gutter clock label", () => {
  test("is the 12-hour time without its AM/PM marker", () => {
    expect(gutterClockLabel(AT, "en", "12h", "UTC")).toBe("2:50");
  });

  test("is the 24-hour time with a two-digit hour", () => {
    expect(gutterClockLabel(AT, "en", "24h", "UTC")).toBe("14:50");
  });

  test("drops the day period of a language that writes it before the time", () => {
    expect(gutterClockLabel(AT, "zh-CN", "12h", "UTC")).toBe("2:50");
  });

  test("is empty without a locale", () => {
    expect(gutterClockLabel(AT)).toBe("");
  });
});
