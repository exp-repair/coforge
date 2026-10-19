/**
 * Picks the reference Computer's bundles out of its SEA resources and splits a bundle into a
 * source tree. Bundle text is untrusted data: it is read as text and never evaluated.
 */

export function bannerFor(version: string): string {
  return `/* raft-computer SEA bundle v${version} */`;
}

/**
 * The resources that start with the resolved version's banner. Requiring the banner at the head,
 * not anywhere, keeps a quoted banner inside another script from counting. None means the wrong
 * artifact.
 */
export function selectBundles<T extends { name: string; content: Uint8Array }>(
  resources: T[],
  version: string,
): T[] {
  const banner = new TextEncoder().encode(bannerFor(version));
  const bundles = resources.filter(({ content }) => banner.every((byte, i) => content[i] === byte));
  if (bundles.length === 0) {
    throw new Error(`wrong artifact: no SEA resource starts with the v${version} banner`);
  }
  return bundles;
}

/** esbuild's module path comments, e.g. `// packages/computer/src/cli.ts`. */
const MARKER = /^\/\/ ((?:packages|node_modules)\/\S+)$/;

/**
 * Splits a bundle at its module path comments. Each file holds the lines after its marker up to
 * the next marker; a repeated marker appends to the same file. Lines before the first marker
 * belong to no file. Any other `//` line, including an indented or spaced path, is ordinary
 * content. A minified bundle has no markers and yields no files.
 */
export function splitBundle(text: string): Map<string, string> {
  const files = new Map<string, string[]>();
  let current: string[] = [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const path = MARKER.exec(line)?.[1];
    if (path === undefined) {
      current.push(line);
      continue;
    }
    assertSafePath(path);
    current = files.get(path) ?? [];
    files.set(path, current);
  }
  const joined = (part: string[]) => (part.length ? `${part.join("\n")}\n` : "");
  return new Map([...files].map(([path, part]) => [path, joined(part)]));
}

/** A relative path from the untrusted artifact must stay below the directory it is written to. */
export function assertSafePath(path: string): void {
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`unsafe path in artifact: ${JSON.stringify(path)}`);
  }
}
