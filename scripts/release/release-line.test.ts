import { expect, test } from "bun:test";

import {
  assertForward,
  firstDevNumber,
  parseDevBuild,
  requireStable,
  stagingDevLine,
} from "./release-line";

// The publish and production-candidate tests cover each refusal at the seam that runs it; this file
// covers the grammar and the line table, which those seams reach only one case at a time.

test("the line is staging's while it is above production's latest, else the patch after production's", () => {
  for (const [stagingLatest, line] of [
    [undefined, "0.1.5"],
    ["0.1.4-dev.7", "0.1.5"],
    // Staging's line just shipped: its base equals production's latest.
    ["0.1.4", "0.1.5"],
    ["0.1.5-dev.11", "0.1.5"],
    ["0.2.0-dev.2", "0.2.0"],
  ] as const) {
    expect(stagingDevLine({ productionLatest: "0.1.4", stagingLatest }), stagingLatest).toBe(line);
  }
});

test("an explicit line must be above production's latest and not below staging's line", () => {
  expect(stagingDevLine({ productionLatest: "0.1.4", line: "0.2.0" })).toBe("0.2.0");
  expect(
    stagingDevLine({ productionLatest: "0.1.4", stagingLatest: "0.2.0-dev.2", line: "0.2.0" }),
  ).toBe("0.2.0");
  expect(() => stagingDevLine({ productionLatest: "0.1.4", line: "0.1.4" })).toThrow(
    /line 0\.1\.4 must be greater than production's latest 0\.1\.4/,
  );
  // A stale line once published 0.1.3-dev.3 after 0.1.4-dev.2.
  expect(() =>
    stagingDevLine({ productionLatest: "0.1.2", stagingLatest: "0.1.4-dev.2", line: "0.1.3" }),
  ).toThrow(/line 0\.1\.3 is below staging's line 0\.1\.4/);
});

test("a stable version is exactly major.minor.patch", () => {
  expect(requireStable("0.1.4", "version")).toEqual([0, 1, 4]);
  for (const version of ["0.1.4-dev.2", "0.1.4+build.1", "00.1.4", "v0.1.4", "0.1", " 0.1.4"]) {
    expect(() => requireStable(version, "line"), version).toThrow(
      /line must be a stable major\.minor\.patch version/,
    );
  }
});

test("a dev build is exactly X.Y.Z-dev.N with N from 1", () => {
  expect(parseDevBuild("0.1.5-dev.3")).toEqual({ line: "0.1.5", number: 3 });
  expect(parseDevBuild("1.0.0-dev.11")).toEqual({ line: "1.0.0", number: 11 });
  for (const version of [
    "0.1.5",
    "0.1.5-dev.0",
    "0.1.5-dev.01",
    "0.1.5-rc.1",
    "0.1.5-dev.1.2",
    "0.1.5-dev.1+build",
    "00.1.5-dev.1",
    "latest",
  ]) {
    expect(parseDevBuild(version), version).toBeUndefined();
  }
});

test("numbering starts above staging's latest dev number on the same line, else at 1", () => {
  expect(firstDevNumber("0.1.5", "0.1.5-dev.4")).toBe(5);
  expect(firstDevNumber("0.1.5", "0.1.5-dev.11")).toBe(12);
  expect(firstDevNumber("0.1.5", "0.1.4-dev.9")).toBe(1);
  expect(firstDevNumber("0.2.0", "0.1.5-dev.2")).toBe(1);
  expect(firstDevNumber("0.1.5", "0.1.4")).toBe(1);
  expect(firstDevNumber("0.1.5", undefined)).toBe(1);
});

test("versions are ordered by semver precedence, and an unreadable latest is not guessed at", () => {
  // Dev numbers compare numerically, not as text.
  assertForward("0.1.5-dev.11", { latest: "0.1.5-dev.2", feed: "staging's", strict: true });
  assertForward("0.1.5", { latest: "0.1.5-dev.11", feed: "the feed's" });
  assertForward("0.1.5", { latest: "0.1.5", feed: "the feed's" });
  expect(() =>
    assertForward("0.1.5", { latest: "0.1.5", feed: "the feed's", strict: true }),
  ).toThrow(/0\.1\.5 is not newer than the feed's latest 0\.1\.5/);
  expect(() => assertForward("0.1.5", { latest: "garbage", feed: "the feed's" })).toThrow(
    /the feed's latest is not a release version: garbage/,
  );
});
