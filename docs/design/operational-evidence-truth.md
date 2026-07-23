# Operational evidence truth

Status: design opened 2026-07-23, before implementation.

## Problem

Vai's installed runtime starts beside `veggaai.exe`, so `process.cwd()` is the
installation directory rather than the Vai source repository. The current
fallback walks from that directory and eventually invents a repository root.
Consequently `/api/agent/introspect` can report Git, verification, docs, and the
self-improvement corpus as missing even while those artifacts exist in the
developer workspace. The detailed health service also labels the runtime and
indexer healthy without executing their owning probes.

An installed application is not expected to contain a Git checkout. That is a
valid and materially different state from "the repository probe failed."
Packaged build evidence, a developer source workspace, and mutable user data
must therefore be represented separately.

## Decision

Introduce one runtime-owned root resolver with three independent roots:

- `sourceRoot`: an explicit or module-anchored Vai source checkout. Git state,
  source docs, and the live self-improvement corpus may be read only here.
- `buildEvidenceRoot`: immutable evidence shipped with the desktop build. It
  contains the build manifest, verification receipt, agent guide, tooling map,
  and the backlog snapshot used for that build.
- `userDataRoot`: mutable per-user runtime state derived from the configured
  database location.

Explicit environment values win. Source discovery is anchored to the runtime
module path and must prove both `AGENTS.md` and the root `package.json`; there is
no `cwd/../..` guess. The packaged runtime receives its evidence root from the
native launcher. Absolute developer paths are never embedded in the release.

The cross-boundary operational snapshot moves into `@vai/contracts` and is
runtime-validated. It distinguishes:

- immutable build identity and provenance;
- optional source-repository state;
- source or embedded verification receipts;
- an optional live self-improvement corpus.

Unavailable evidence remains a successful introspection response with an exact
reason. It must never be converted into a healthy or passing claim.

Detailed subsystem health uses injected probes. The runtime row is healthy
because the request is executing inside the serving process; the database and
indexer rows execute bounded read probes. Unwired optional subsystems report
`unknown`. Provider and remote-environment checks retain their existing
degraded-state behavior.

## Packaging

The sidecar build creates `resources/runtime/vai-build-evidence/` and writes:

- `vai-build-manifest.json` with commit, branch, dirty state, product version,
  and build timestamp;
- the current verification receipt;
- `AGENTS.md`;
- the agent tooling guide;
- the improvement backlog snapshot.

The Tauri launcher passes only the installed evidence directory and mutable
database path to the sidecar. A packaged build may report its exact commit and
verification receipt while honestly reporting that no source checkout or live
self-improvement corpus is attached.

## Failure policy

- An invalid explicit root is reported; it is not silently replaced by a broad
  filesystem search.
- A malformed manifest or receipt is unavailable evidence, not a server crash.
- A Git failure affects only repository evidence.
- A database or indexer probe failure affects only that health row and changes
  aggregate health without disabling unrelated features.
- Introspection stays bounded and read-only.

## Acceptance

1. Source-root and packaged-root resolver tests use platform-native path
   operations and cover missing roots, invalid explicit roots, and
   module-anchored discovery. Windows is proven in this receipt; the same tests
   remain required in macOS/Linux CI before claiming native proof there.
2. The introspection route validates its response schema and serves source docs
   or packaged snapshots from the selected root.
3. Operational evidence tests prove source Git state, embedded build identity,
   receipt provenance, live-corpus absence, and cache behavior.
4. Health tests inject database, indexer, provider, and remote failures and
   prove only the owning rows change.
5. Runtime/contracts typechecks and focused tests pass.
6. A live source runtime returns real repository, receipt, docs, and corpus
   evidence.
7. A rebuilt installed app returns its embedded commit and receipt without
   claiming that the installation directory is a Git repository.
