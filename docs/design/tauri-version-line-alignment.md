# Tauri version-line alignment

Status: shipped 2026-07-23.

Related portfolio missions: M18 dependency hygiene and M19 release/supply-chain.

## Problem

The supported Windows desktop updater completes the runtime sidecar build, then
Tauri refuses to package the desktop because the Rust `tauri` crate is 2.10.3
while the JavaScript `@tauri-apps/api` package resolves to 2.11.1. Bypassing the
version check would create an unverified native/JavaScript boundary.

## Decision

Keep the current Rust line and pin `@tauri-apps/api` to the published 2.10 line.
Do not disable Tauri's version check. Update the frozen lockfile, rerun contracts,
core, and desktop typechecks, then rerun the supported native updater.

The CLI package may remain on its current compatible tool line unless the build
reports a concrete incompatibility; it is build tooling, while
`@tauri-apps/api` is the runtime boundary checked against the Rust crate.

## Acceptance

1. `package.json` and the frozen lockfile select an exact 2.10.x API package.
2. Tauri's native version check passes without an override.
3. CI and dependency automation cannot silently reintroduce a mixed version
   line.
4. The desktop and sidecar build and sync to the installed application folder.
5. The relaunched installed process reports healthy runtime evidence.

## Shipped evidence

- `@tauri-apps/api` is pinned to published version 2.10.1 in both the desktop
  manifest and frozen lockfile; the Rust crate remains 2.10.3.
- `scripts/check-tauri-version-line.mjs` rejects ranges, non-exact pins, and a
  JavaScript/Rust major-minor mismatch. Root verification and CI execute it.
  Dependabot holds the JavaScript API below 2.11 until the Rust line is upgraded
  deliberately.
- CI now includes a Windows native-contract job that installs stable Rust and
  runs `cargo check` against the Tauri manifest.
- Contracts, core, and desktop typechecks pass against the aligned dependency
  graph.
- Tauri's normal compatibility check passed with no override. The release
  desktop and runtime sidecar built, synced to `Documents\veggaAi`, and
  relaunched as exactly one `veggaai` plus one `vai-runtime` process.
- Installed `/health` reports `ok`; packaged operational evidence reports
  `runtime.healthy: true`, engine `vai:v0`, version 0.2.0, branch `main`, the
  source commit used for this dirty acceptance build, and no invented attached
  repository.
- The installed executable passed a WebView2/CDP smoke test: app window
  rendered, top navigation worked, and there were zero page errors (4/4).
  Visual evidence: `screenshots/tauri-drive/06-final.png`.

The final installed-build commit, clean embedded manifest, executable hashes,
process cardinality, and post-build native smoke are recorded in the release
handoff after the committed rebuild.
