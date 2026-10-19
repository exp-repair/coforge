# What the extracted tree contains

Module counts, package file counts, bundle size, and command lists are
version-specific. Record the values observed during each extraction in
the research note instead of carrying forward counts from an older release.

The extractor writes every SEA script to `sea/main/` and `sea/assets/`, and
`provenance.json` lists them with their role, size, hash, and whether each
starts with the version banner. It builds `tree/<script>/` only for a script
that keeps esbuild's `// packages/...` path comments. Some releases ship
minified scripts that have none; then there is no tree, and the script itself
is the source to search.

Esbuild keeps module labels even in a minified script: wrapper keys such as
`"packages/computer/src/paths.ts"`, `"packages/daemon/src/..."`, and
`"node_modules/..."` survive as string literals. Locate a module by searching
the script for its label (for example `__esm({"packages/computer/src/paths.ts"`),
then read the code that follows it. The first-party
code includes the human-facing Computer client, shared contracts, sync and
tracing code, and the daemon, which may be a pre-bundled `packages/daemon/dist`
module or labelled `packages/daemon/src` modules depending on the release.

## The agent-facing CLI

Find the code that registers the agent-facing CLI by role rather than by a
hard-coded file or asset name: it can be a daemon `dist-*.js` or `chunk-*.js`
file in the tree, or a separate SEA asset. Search for `program.name("raft")`, command
registration functions, and `src/commands/<group>/<name>.ts` labels. Registration
can be indirect, so validate the resulting command list against the bundle
instead of relying on one grep pattern.

When comparing a behavior, record the exact command name and extracted module
path. Do not infer that a command exists in the current release because it existed
in an older one.

## The human-facing commands

Start with `packages/computer/src/cli.ts` and `index.ts`: files in the tree,
or labels in the banner-bearing script, where the entry module `index.ts`
carries no label. The current client
contains the setup, lifecycle, status, diagnosis, logs, runners, and upgrade
surfaces. Search the recovered `cli.ts` for the exact command registration
before comparing it with CoForge; in particular, verify whether a proposed
delete, remove, or detach operation is actually present.

## Where to start in `packages/computer/src`

These are module paths: files in the tree, or labels to search for in a
minified script. Confirm each still exists in the release you examined.

- `cli.ts` registers commands; `index.ts` is the SEA entry.
- `service.ts`, `serviceControl.ts`, `serviceReconcileLoop.ts`, and
  `osSupervisor*.ts` implement the resident-service lifecycle under launchd and
  systemd.
- `externalInstaller.ts`, `lifecycleOperations.ts`,
  `residentLifecycleBridge.ts`, and release modules cover installation,
  upgrade, and lifecycle acknowledgements.
- `lib/runnerStateMachine.ts`, `runners.ts`, and `runnerLockConflict.ts`
  manage agent runner processes.
- `internal/ipc-server.ts`, `internal/ipc-codec.ts`, and `lib/ipc-client.ts`
  form the local IPC seam between CLI invocations and the resident process.
- `doctor.ts` and `health.ts` show recovery and health semantics, including how
  a server-side unlink or revoke is represented locally.

## Vendored dependencies

Record provider and protocol dependencies from the extracted tree when they
matter to the comparison. Treat dependency presence as evidence of bundled
code only; it does not prove that a CLI command or product capability is
enabled.
