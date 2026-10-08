import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveComputerInstallDirectory } from "#src/platform/computer-install-directory";
import { installerJournalExists, installerJournalPath } from "#src/platform/installer-journal";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "coforge-installer-journal-"));
  homes.push(path);
  return path;
}

async function installRootOf(homeDirectory: string): Promise<string> {
  return resolveComputerInstallDirectory({ platform: process.platform, homeDirectory });
}

test("the journal lives at the installer's install root under the given home", async () => {
  const installRoot = await installRootOf(await home());

  expect(installerJournalPath(installRoot)).toBe(join(installRoot, "installer-transaction.json"));
});

test("an installer journal in the install root means an upgrade is in flight", async () => {
  const installRoot = await installRootOf(await home());
  await mkdir(installRoot, { recursive: true });
  await writeFile(join(installRoot, "installer-transaction.json"), "{}");

  expect(installerJournalExists(installRoot)).toBe(true);
});

test("no installer journal means no upgrade is in flight", async () => {
  expect(installerJournalExists(await installRootOf(await home()))).toBe(false);
});

test("with no install root given, the journal is read from this machine's install root", async () => {
  // os.homedir() reads HOME once, at process start, so the default is checked in a child process
  // whose HOME is the scratch home.
  const homeDirectory = await home();
  const install = resolveComputerInstallDirectory({ platform: process.platform, homeDirectory });
  await mkdir(install, { recursive: true });
  await writeFile(join(install, "installer-transaction.json"), "{}");
  const source = `
    import { installerJournalExists } from ${JSON.stringify(join(import.meta.dir, "../src/platform/installer-journal.ts"))};
    console.log(String(installerJournalExists()));
  `;
  const child = Bun.spawn([process.execPath, "-e", source], {
    env: { ...process.env, HOME: homeDirectory },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  expect({ code, stdout: stdout.trim() }).toEqual({ code: 0, stdout: "true" });
});
