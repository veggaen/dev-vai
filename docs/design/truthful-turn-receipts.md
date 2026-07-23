# Truthful turn receipts

Status: shipped 2026-07-23.

Portfolio mission: M01 in `staff-company-portfolio-20.md`.

## Problem

The live progress protocol currently has only `running` and `done`. When a trace
is persisted, `progress-trace.ts` converts every remaining `running` step and
tool run into `done`, and converts an unfinished draft race into `decided`.
The desktop also settles an earlier running step when a later stage appears and
uses failure words in labels as a major source of status truth.

This makes a transport lifecycle look like a verified outcome. In particular,
an error frame, disconnect, manual cancellation, or producer that forgets its
terminal frame can later appear to have completed successfully.

## Decision

Keep the existing `running`/`done` lifecycle field for wire compatibility, and
add an orthogonal, explicit outcome:

- `succeeded`
- `failed`
- `interrupted`
- `withheld`
- `not-run`

Progress steps, tool runs, and draft races may carry `outcome` plus a stable
`evidenceId`. `done` without an outcome remains readable as a legacy success,
but new persisted traces must carry outcomes and evidence IDs.

The terminal owner records the turn result at its real boundary:

- core `done` → `succeeded`
- core stream exhaustion/cancellation without `done` → `interrupted`
- desktop WebSocket error frame → `failed`
- connection loss or manual stop → `interrupted`

Trace format version 3 stores the turn outcome. A still-running step is settled
according to the terminal turn outcome; it is never promoted merely because the
trace is being serialized. Tool success/failure remains more specific than the
turn outcome. A synthetic terminal receipt makes the final turn outcome
inspectable whenever the producer emitted a progress trace. Turns with no
process events do not gain a process panel merely to show a receipt.

Version-2 traces remain readable exactly as legacy evidence. They are not
rewritten or retroactively reclassified.

The desktop finalizes the active in-memory trace on normal completion, error,
connection loss, and manual stop so the user sees the same result before and
after reload. Structured outcomes drive attention/error styling. Label regexes
remain only as a compatibility fallback for old traces.

Terminal outcomes are monotonic: a late `running` frame cannot overwrite an
existing failed/interrupted/withheld outcome.

## Scope of this slice

- Schema-only contract and boundary tests.
- Version-3 persistence and version-2 compatibility.
- Chat-service terminal-frame capture.
- Explicit withheld outcomes at the image-decline, council-refusal,
  one-shot-builder quality, and verification-decline boundaries.
- Desktop live finalization and structured status rendering in the process
  tree, software-work summary, and timeline.
- Deterministic trace ownership, bounded nested evidence, and strict version-3
  invariants for concurrent and partial turns.
- Focused deterministic tests and core/desktop/contracts typechecks.

Out of scope:

- Rewriting every optional/legacy producer to emit explicit outcome frames in
  one change.
- Durable reconnect replay; that is portfolio mission M08.
- Full turn-orchestrator extraction; that follows after receipts are stable.

## Failure and rollback policy

- Malformed version-3 traces are ignored rather than rendered as truth.
- Trace persistence remains best-effort and cannot fail the answer.
- No database migration is needed because the trace column already stores JSON.
- Rollback is code-only: version-2 readers continue to ignore version 3, while
  this implementation reads both versions.

## Acceptance

1. Successful, failed, interrupted, withheld, and not-run outcomes validate at
   the contract boundary.
2. Error/disconnect/manual-stop fixtures never produce successful active rows.
3. Persisted unfinished steps and tools inherit failed/interrupted terminal
   outcomes rather than `done` success.
4. Completed tool failure remains failed even on a successful turn.
5. Version-2 traces still load; corrupt or invalid version-3 traces do not.
6. Stale running frames cannot overwrite terminal failure.
7. Structured outcomes, not label wording, drive new UI attention states.
8. Focused tests and typechecks pass; a live interrupted-turn visual proof is
   required before shipping.

## Shipped evidence

- Contract, core persistence, ownership/concurrency, desktop store, process
  tree, timeline, software-work, and turn-section tests pass: 124 focused tests.
- The monorepo TypeScript boundary check passes across all ten participating
  workspaces.
- The repository-wide suite executed 5,459 passing tests with 48 skipped and
  no test failures. Vitest then reported one worker RPC timeout while publishing
  task updates and exited nonzero; mission M18 owns that test-runner reliability
  defect, so this is recorded as a yellow infrastructure gate rather than a
  green full-suite gate.
- A deterministic visual matrix exercised Compact, Open, and Odyssey in both
  light and dark themes at 1440x900. Every variant exposed
  `data-outcome="interrupted"`, `aria-live="polite"`, and
  `aria-atomic="true"`, had no horizontal overflow, and produced zero
  browser/page errors. Evidence and machine-readable results are in
  `docs/evidence/truthful-turn-receipts/`.
- A real Balanced-mode turn was also stopped through the rendered desktop web
  UI.
  The settled row read `Interrupted · work stopped before completion`, used an
  attention icon rather than a success check, kept the unaccepted draft visibly
  `STOPPED · NOT APPLIED`, and produced no browser console errors. Screenshot:
  `Temporary_files/vai-truthful-receipt-live.png`.
