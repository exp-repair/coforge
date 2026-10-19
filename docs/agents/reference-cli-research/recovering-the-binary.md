# Recovering the binary and its source

The release authority is the Hands API, not the CDN. Read the official [Hands
Public API Reference](https://app.hands.build/docs/public-api-reference/).
Never commit the binary or anything extracted from it to this repository.

## Run the extractor

`scripts/reference-computer/extract.ts` performs every step below and fails
closed when one does not hold:

```sh
bun scripts/reference-computer/extract.ts --out <new-dir-outside-the-repo>
bun scripts/reference-computer/extract.ts --out <dir> --version <x.y.z>  # re-check an older release
bun scripts/reference-computer/extract.ts --help
```

It defaults to `--platform darwin --arch arm64`; `linux` with `x64` or `arm64`
is also supported. `--out` must be new or empty and outside the repository.
The binary is written without an execute bit and is only ever read as bytes.
It prints `provenance.json`, which holds what every research note must cite:
version, target, release id, binary and resource hashes, blob location, the
embedded Node version, and the observation date. `--help` lists the output
layout. A failure message names the step that failed, never a download URL.

## What it does

A reviewer can re-derive each step by hand:

1. **Resolve the release** with an `updates/check` request that names no
   version, so the answer is the latest release:

   ```sh
   H=https://hands.build/public/v2/apps/raft-computer-cli
   curl -fsSL "$H/updates/check?product_type=cli-binary&platform=darwin&arch=arm64&current_version=0.0.0&current_version_code=0"
   ```

   `release.version` is the version under study; `--version` adds
   `&version=<x.y.z>`. The tool keeps the response as `release.json` and
   refuses an answer whose target or version differs from the request.

2. **Download and verify** the `artifact.gzip.download_url` asset: its hash
   must equal `artifact.gzip.sha256`, and after `gunzip` the binary's hash must
   equal `artifact.sha256`.

3. **Cut the SEA blob.** The binary is a Node.js single-executable application
   (SEA): a stock Node binary with a blob injected by postject.
   - Mach-O: the `__NODE_SEA_BLOB` section of the `NODE_SEA` segment, at the
     section's `offset` for its `size` (`otool -l raft | grep -A8 __NODE_SEA_BLOB`).
   - ELF: postject adds no section, so `readelf -S` does not show it. The blob
     is the descriptor of a note named `NODE_SEA_BLOB` in a `PT_NOTE` program
     header (`readelf -n`).

4. **Decode the blob** as Node's SEA resource, laid out by `SeaSerializer::Write`
   in [`src/node_sea.cc`](https://github.com/nodejs/node/blob/v24.21.0/src/node_sea.cc)
   of the embedded Node (v24.21.0 when this was written): a `u32` magic, `u32`
   flags and `u8` exec-argv extension, then length-prefixed (`u64`
   little-endian) strings for the code path and the main script, a code cache
   if flag `4` is set, `count × (key, content)` assets if flag `8` is set, and
   exec arguments if flag `16` is set. An unknown flag, a snapshot, a length
   past the end, or trailing bytes stops the tool: the layout changed, so
   compare it with the `node_sea.cc` of the Node version in provenance.

   Releases have used both shapes: the whole bundle as the main script, or a
   small loader as the main script with the bundles as named assets. The tool
   writes each resource to `sea/main/` or `sea/assets/` and hashes each one.

5. **Check the banner.** At least one resource must *start* with
   `/* raft-computer SEA bundle v<version> */` for the version resolved in
   step 1; otherwise it is the wrong artifact. Provenance marks those
   resources `bundle: true`.

6. **Split by path** any script that has esbuild path comments: lines matching
   `^// (packages|node_modules)/\S+$`, for example
   `// packages/computer/src/cli.ts`. The text from one marker to the next goes
   to `tree/<resource>/<path>`; a repeated marker appends, other `//` comments
   are content, and a marker with an empty, `.`, or `..` segment stops the
   tool. A minified script has no markers and is not split; see
   [What the extracted tree contains](source-tree.md) for searching it.

The user-facing install path selects the same version with
`curl -fsSL https://cdn.raft.build/computer/install.sh | RAFT_COMPUTER_VERSION=<version> sh`;
read the installer source first and record the exact asset it selects.
