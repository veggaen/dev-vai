# Self-improvement adoption control plane

Status: shipped as the M02 control-plane slice on 2026-07-24. The wider M02
mission remains active until three real improvements ship with positive
measurement.

Portfolio mission: M02 in `staff-company-portfolio-20.md`.

## Problem

Vai's self-improvement corpus currently reports 302 queued fixes, 288 model
proposals, 86 qualified capability proposals over 919 compute units, and zero
credited adoptions. Every fix row is still `queued`. Exact duplicates recur up
to 21 times, while the capability generator is still eligible to spend more
compute.

This is not a proposal-quality problem first. It is an adoption and governance
failure: the system can generate work faster than an owner can review, decide,
ship, and measure it.

## Decision

Add a deterministic adoption control plane around the existing corpus without
rewriting or deleting historical rows.

1. Canonicalize queued fixes into stable work-item fingerprints and group
   duplicate observations behind one owner-review item.
2. Rank groups from corpus evidence: affected failure count, observation count,
   executable proposals, rejection burden, recency, and whether a target file
   is known.
3. Persist owner decisions in append-only events plus a current-state row.
   Decisions expose status, assignee, risk, expiry, reason, rollback, evidence,
   commit, compute round, and measured before/after quality.
4. Require a reason for rejection. Require assignee, expiry, risk, and rollback
   before approval. Require commit, evidence, compute attribution, and positive
   measured quality movement before `shipped`.
5. Derive generation policy from realized compute ROI. When qualified work
   exists, nothing has shipped, and the ROI classifier is `wasteful`, proposal,
   innovation, and capability generation pause. Observation, verification,
   visual checks, experiment closure, and explicitly armed prototype/application
   work remain available.
6. Expose a read-only JSON board from the local watch server and summarize it in
   the desktop owner panel. Decisions remain CLI-only in this slice because the
   watch server has no authentication boundary.

The historical `fixes`, `proposals`, `capabilities`, and `compute_log` tables
remain evidence sources. The control plane adds metadata; it never rewrites
history to make the queue look smaller.

## Trust and failure boundaries

- Opening a repository remains untrusted. Board rendering treats corpus text as
  data; it never becomes an instruction or capability grant.
- The local watch endpoint is read-only and emits bounded, schema-shaped JSON.
- Corpus mutations happen only through an explicit local CLI command.
- An unavailable or malformed corpus fails closed: generation is not silently
  marked productive, and the desktop explains that the board is unavailable.
- A rejected or expired item cannot become shipped without a new valid
  transition.
- No source patch is applied by this control-plane slice.

## Acceptance for this slice

1. A fixture containing duplicate fix rows produces one stable board item with
   accurate observation and failure totals.
2. Board ordering is deterministic and bounded.
3. Invalid transitions fail without changing state; rejection without a reason,
   incomplete approval, and unmeasured shipment are rejected.
4. Every accepted decision appends an immutable event and updates one current
   state row transactionally.
5. A wasteful `0 shipped / qualified work` corpus pauses generative loop
   processes without blocking observation or owner-armed adoption work.
6. Credited, positively measured shipments remove the automatic pause only
   after the mission threshold is met.
7. The watch endpoint and desktop panel expose raw versus deduplicated counts,
   generation state and reason, realized/potential ROI, and the highest-ranked
   work items.
8. Focused tests, typechecks, lint, rendered desktop proof, and a native Windows
   build pass before the slice is marked shipped.

## Rollback

Remove the new board/policy consumers. The added tables are additive and can be
left in place; legacy loop readers ignore them. Historical corpus rows and
existing apply gates are untouched.

## Remaining M02 program

This slice creates the governed queue and stops wasteful generation. Full M02
still requires three real proposals to move through review, implementation,
verification, merge, and measured post-ship credit before generation resumes.

## Acceptance evidence

- The live corpus reports 302 raw observations collapsed into 18 stable owner
  work items, with 284 duplicates removed from the review workload.
- Generation is fail-closed and visibly paused at 0/3 positively measured
  shipments while 86 qualified proposals await adoption. Direct capability
  generation and both modern and legacy supervisor paths enforce the policy;
  observation, verification, experiment closure, and explicitly armed
  prototype/application work remain available.
- Five adoption-control tests cover stable deduplication, deterministic
  ordering, the three-shipment threshold, invalid transition atomicity, and
  append-only measured shipment credit, and decisions outside the bounded board
  viewport. The participating loop suite passes 48/48;
  contracts/constants pass 21/21.
- `@vai/contracts`, `@vai/constants`, and `@vai/desktop` typechecks pass. The
  platform-constants policy, supervisor syntax check, lint with zero errors,
  and production desktop web build pass.
- The owner board passed real Chrome verification in Compact, Open, and Odyssey
  modes in both dark and light themes: six captures, no console/page errors,
  no horizontal overflow, and correct live adoption data. Evidence is under
  `Temporary_files/m02-adoption-control/`.
- The watch endpoint is loopback-only and read-only. Its CORS check accepts the
  configured Vite origin and emits no allow-origin header for an attacker
  origin.
