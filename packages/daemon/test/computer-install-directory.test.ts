import { expect, test } from "bun:test";

import { resolveComputerInstallDirectory } from "#src/platform/computer-install-directory";

test("the install root sits under the user's .coforge directory on POSIX", () => {
  for (const platform of ["linux", "darwin"] as const) {
    expect(resolveComputerInstallDirectory({ platform, homeDirectory: "/home/alice" })).toBe(
      "/home/alice/.coforge/computer/install",
    );
  }
});

test("the install root follows Windows path rules", () => {
  expect(
    resolveComputerInstallDirectory({ platform: "win32", homeDirectory: "C:\\Users\\alice" }),
  ).toBe("C:\\Users\\alice\\.coforge\\computer\\install");
});

test("an unsupported platform has no install root", () => {
  expect(() =>
    resolveComputerInstallDirectory({
      platform: "freebsd" as NodeJS.Platform,
      homeDirectory: "/h",
    }),
  ).toThrow("unsupported platform: freebsd");
});
