# Capability: Multi-turn memory detector (prose-introduction surface forms)

> Conforms to `docs/capabilities/_template.md` v1.

**Status:** design — pending V3gga approval.
**Authorization:** Path B (this turn). Constrained-output deferred per `docs/deferred-capabilities.md`.
**Scope tier:** S (surgical). Two edits to existing handlers, no new fields, no new module.

---

## §1. Problem statement

In multi-turn conversations the user often introduces themselves in prose
("I'm Sara", "My name is Mira", "Call me V3gga", "This is Anna speaking"),
then several turns later expects Vai to recall the name ("what's my name?",
"who am I?", "do you remember me?").

Today:

- The introduction turn falls into either `nickname-prelude` (only when paired
  with "I'm going to ask"), `direct-match` (which the relevance gate at line
  3100 was specifically tuned to block — Quisling bio for "Hey, my name is
  Mira"), or `fallback`. None of these acknowledge the name back to the user.
- The recall turn falls into `fallback` or `web-search`. The existing
  `tryLongContextRecallSynthesis` handler only recognises **project name** /
  **framework** recall, not personal-name recall. (Verified at vai-engine.ts
  L6752–L6800.)

This is a real gap. Multi-turn corpus turns probing personal-context recall
currently fail.

## §2. Trip-wires (stop-and-report conditions)

1. The two existing handlers turn out to be the wrong place to edit (e.g.
   `nickname-prelude` cannot be widened without breaking its existing test, or
   `tryLongContextRecallSynthesis` does not have access to enough history).
   → **STOP. Report.** Do not invent a new handler module.
2. Adding the four surface forms widens an existing strategy match into
   territory currently held by another strategy and causes a corpus regression
   on the active baseline (33/57). → **STOP. Report.** Bisect before
   continuing.
3. The implementation requires more than ~30 LOC of code in either handler.
   → **STOP. Report.** That means the assumption "history is the store" was
   wrong and a new store is actually needed; that is a different capability
   and needs re-authorization.

## §3. Existing store path (binding archaeology)

There is **no engine-level personal-context store**. After scanning
`packages/core/src/`:

- `KnowledgeStore` is for facts taught about topics, not personal context.
  Storing `user_name` there would be a category error and would pollute the
  retrieval index.
- `VaiEngine` has session-scoped fields (`_activeMode`,
  `_hasActiveSandboxContext`, `_lastSearchResponse`, `_lastCitedAnswer`,
  `_lastTeacherDecision`) but none for user identity.
- Persistence (`VaiSnapshot` v1) is `learnedEntries` + `strategyStats` +
  `missedTopics`. No user-profile slot.

**Conclusion: the conversation `history` parameter is the store.** Every
strategy already receives `readonly Message[]`. Both edits below operate on
that history. No new field, no new map, no new persistence schema.

## §4. The four prose-introduction surface forms

```regex
1. /\bmy\s+name\s+is\s+([A-Z][a-z'\-]{1,25})\b/
2. /^(?:hi|hey|hello)?[,!\s]*\bi['']?m\s+([A-Z][a-z'\-]{1,25})\b/
3. /\bcall\s+me\s+([A-Z][a-z'\-]{1,25})\b/
4. /\bthis\s+is\s+([A-Z][a-z'\-]{1,25})\s+(?:speaking|here)\b/
```

Constraints on the captured name:

- Must match `^[A-Z][a-z'\-]{1,25}$` (single capitalised token, 2–26 chars,
  apostrophes and hyphens allowed). Multi-word names are out of scope this
  turn (deferred).
- Must not be in a small stop-list of common words that can follow
  "I'm" / "call me" without being a name: `going, gonna, sorry, here,
  trying, asking, looking, wondering, just, not, the, a, an, in, on, at,
  with, from, working, building, making, about` (the last 3 are heavy
  false-positive sources: "I'm working on a project").

If no surface form matches OR the captured token fails validation → handler
returns null and dispatch continues unchanged.

## §5. Code budget (in code-only LOC, non-comment, non-blank)

> **Revised post-pre-write (2026-04-28).** Original §5 below targeted L2987
> (`nickname-prelude` block) plus `tryLongContextRecallSynthesis`. Pre-writing
> the §6 test bodies surfaced a third handler at L41463 inside
> `handleConversational` (already implements forms 1 and 2 of §4 with its own
> stop-list and emits the "Nice to meet you, **X**!" template). Adding a new
> block at L2987 would have silently overridden it for forms 1 and 2 — exactly
> the kind of dispatch-race side effect the audit was meant to catch but
> missed. V3gga re-authorized A (extend L41463 in place) explicitly in the
> reply to the trip-wire-stop. Re-authorization basis: the third site is not
> scope creep — it is where the actual work always was, the audit just didn't
> reach it.

**Revised edit plan (this turn ships):**

| File | Edit | Code-only LOC |
| --- | --- | --- |
| vai-engine.ts (`handleConversational`, L41463 personal-introductions block) | Extend the existing two surface forms (`my name is X` / `i'm X`) with forms 3 and 4 (`call me X` / `this is X speaking`). Mirror the existing stop-list + capitalisation + length checks. Reuse the existing "Nice to meet you, **X**!" response template (no new wording). | ≤ 25 |
| vai-engine.ts (`tryLongContextRecallSynthesis` at L6752) | Add a personal-name recall block that scans `userMessages` joined text with the four §4 regexes and returns "Your name is **X**." when the input matches a recall pattern (`what'?s my name`, `who am i`, `do you remember (?:me\|my name)`, `what did i (?:tell\|say) (?:you )?my name`). | ≤ 15 |
| L2987 `nickname-prelude` block | **No change.** Existing `nickname + ask` prelude path stays verbatim. | 0 |
| **Total code-only** | | **≤ 45** |

Comment density: not separately budgeted at this size; expect ≤ 20 LOC of comments total.

If the actual diff exceeds 50 code-only LOC across the two edits → trip-wire #3
fires. STOP and report.

---

**Original §5 (pre-revision, kept for change-history honesty):**

> | File | Edit | Code-only LOC |
> | --- | --- | --- |
> | vai-engine.ts (`nickname-prelude` handler at L3099) | Widen the regex set to the 4 surface forms; widen the response template to acknowledge a bare introduction; keep the existing prelude path intact as a special case | ≤ 18 |
> | vai-engine.ts (`tryLongContextRecallSynthesis` at L6752) | Same recall block as the revised plan | ≤ 12 |
> | **Total code-only** | | **≤ 30** |
>
> Trip-wire was: `>35` LOC. The revised budget supersedes this — see
> revised plan above and §13 for the audit-completeness follow-up.

## §6. Test surface (added in this turn)

Added to `packages/core/__tests__/vai-engine.test.ts` (existing file, no new
test file):

1. `acknowledges bare introduction` — input `"My name is Sara."`, expect
   response to contain `**Sara**` and not invoke fallback.
2. `acknowledges "I'm X" introduction` — input `"Hi, I'm Mira."`, expect
   response to contain `**Mira**`.
3. `acknowledges "call me X" introduction` — input `"Call me V3gga."`,
   expect response to contain `**V3gga**`.
4. `acknowledges "this is X speaking" introduction` — input
   `"This is Anna speaking."`, expect response to contain `**Anna**`.
5. `recalls name on later turn` — feed history of three turns, last
   user turn `"what's my name?"`, expect response to contain `**Sara**`.
6. `does not capture stop-list false positive` — input
   `"I'm working on a chat app."`, expect handler to return null (not
   "Hello, **Working**").
7. `does not over-match on "i'm going to..."` — input `"I'm going to ask
   you something."`, expect handler to return null and existing dispatch
   to continue.

All 7 tests must pass. None of the existing 23 self-eval tests or any
`vai-engine.test.ts` test must regress.

## §7. Dispatch position

No change to dispatch order. Both edits land inside existing handlers that
already fire at known positions:

- The introduction acknowledgement is folded into the existing
  `nickname-prelude` block at line 3099 (Strategy 0.45 pre-guard).
- The name recall is folded into `tryLongContextRecallSynthesis` (Strategy
  0.0147).

Net new strategy IDs: zero. Net new dispatch arms: zero.

## §8. Bleed prediction (filed pre-implementation)

Active corpus baseline: 33/57 turns pass (commit 583d504 / tag
corpus-baseline-1-rc-2).

Predicted post-build delta: **0 ± 1 turns**. Rationale:

- Both edits are additive inside guard clauses that currently return null on
  the four surface forms. No previously-passing turn loses its current
  handler.
- The recall edit only fires when the user input matches a narrow recall
  regex AND a name was captured from history; otherwise it falls through
  unchanged.
- The introduction edit replaces a `fallback` or unrelated `direct-match`
  rejection with an acknowledgement. If the corpus contains turns that were
  passing *because* of fallback wording on an introduction-shaped input,
  they will fail. Audit before locking the prediction: I have not enumerated
  the 33 passing turns to verify none depend on fallback wording for an
  introduction. **If audit reveals such a turn, this prediction is wrong and
  scope is wider than S.** STOP and report.

The cross-bucket compare against the §10 self-evaluation prediction (0.45
bleed for that capability) is not relevant here — this is a different
capability. Compare only against this §8 prediction (0 ± 1).

## §9. Self-evaluation interaction

The constraint-checking predicates from capability #1 do not apply to either
edit (no format-line-count, word-count, char-ban, or topic-presence
constraint is part of the introduction or recall response shapes). Self-eval
will run, find no applicable predicates, and return undefined verdict —
exactly the common case noted in the self-evaluation §11.

## §10. Confidence calibration

Pre-implementation confidence the design is correct: ~0.7.

Sources of uncertainty:

- I have not exhaustively audited the 33 passing corpus turns for
  introduction-shaped inputs (see §8).
- The validation stop-list in §4 is my best guess and may need one or two
  more entries discovered during dogfooding.
- The four surface forms cover the cases I have seen but English is large.
  Expect a small tail of misses ("the name's Bond, James Bond"; "you can
  call me Mira"). These are deferred. The ones we ship are the four most
  common in everyday chat.

## §11. Known limitations (filed at design time, before code)

1. **Single-conversation scope.** The "store" is `history`, which is per-
   conversation. Names introduced in a previous conversation will not be
   recalled in a new one. This is a deliberate trade for "no architecture
   additions" this turn. A persistent personal-context store is a separate
   capability and a separate authorization.
2. **No name updates.** If the user introduces themselves twice with two
   different names (`"I'm Sara" ... "actually my name is Mira"`), the
   recall handler will return whichever surface form regex matches first
   in the joined history text (typically the earlier one). A correction
   path is out of scope this turn.
3. **No multi-word names.** Capture is `[A-Z][a-z'\-]{1,25}` — single
   token only. "Mary Anne" returns "Mary"; "James Bond" returns "James".
4. ~~**Capitalisation-dependent.** The capture requires a leading capital so
   that "i'm tired" doesn't match. Inputs like "my name is sara" (all
   lower-case) will not be caught.~~
   **Struck post-pre-write (2026-04-28).** Pre-write proved this was fiction:
   the existing L41463 handler already uses `/i` flag and capitalises after
   capture, so "my name is sara" already works today. The revised plan extends
   that handler in place, so this limitation does not apply.
5. **Recall scope is the four §4 surface forms only.** `tryLongContextRecallSynthesis`
   has no prior personal-name recall logic (verified by §6.5 pre-write fail);
   the new recall block only matches names introduced via one of the four
   surface forms in §4. Other ways of stating a name ("the name's Bond",
   "you can address me as", a name appearing in passing inside a longer
   sentence not anchored by §4) are out of scope and the recall block returns
   null on them.
6. **Recall is keyword-gated.** Only the four explicit recall phrasings
   (`what'?s my name`, `who am i`, `do you remember (?:me|my name)`,
   `what did i (?:tell|say) (?:you )?my name`) trigger the recall block.
   "Refer to me by my name" or "say my name" are out of scope.

These limitations are all acceptable for an S-cost surgical addition. They
are recorded here so they don't get rediscovered six weeks from now and
treated as bugs.

## §12. Demo path (used in handoff)

After implementation and dogfood, V3gga should be able to open the app and
verify by typing the following in a fresh chat:

1. `Hi, I'm Sara.` → response should contain `**Sara**` and acknowledge.
2. (one or two unrelated turns about anything)
3. `what's my name?` → response should contain `**Sara**`.

If either step fails in the live app, it does not ship. The handoff
message will name the strategy badge to look for in the telemetry
(`nickname-prelude` for step 1, `long-context-recall` for step 3).

## §13. Audit completeness — known follow-up (filed 2026-04-28 post-pre-write)

The §8 pre-code audit (`artifacts/audits/multi-turn-detector-precheck-2026-04-28T07-35Z.md`)
enumerated only handlers reachable via the L2987 dispatch path in
`generateResponse`. It missed the personal-introductions handler at L41463
inside `handleConversational`, which already implements forms 1 and 2 of §4
and emits the "Nice to meet you, **X**!" template. Pre-writing the §6 test
bodies surfaced this miss when 3 of 7 tests passed before any code change.

This is a real but recoverable failure of the audit's enumeration scope, not
of the audit method itself. Per `docs/handoff-protocol.md` Rule 1, a
**completion audit** ships as a separate artifact after this capability's
dogfood pass clears:

- Path: `artifacts/audits/multi-turn-detector-precheck-completion-<timestamp>.md`
- Method: full handler enumeration matching the four §4 surface forms across
  the entire `vai-engine.ts` file (not just the L2987-reachable subset).
- Expected outcome: confirms the L41463 + `tryLongContextRecallSynthesis`
  edits are correct and no further hidden handlers exist on these surface
  forms. If the completion audit finds another hidden handler, that becomes
  a future-turn capability candidate rather than a regression on this work.
- Why deferred until after dogfood: re-running the audit before code lands
  trades a clean precedent for another half-day of delay; running it after A
  ships costs almost nothing because most of the enumeration work is already
  done.

Until the completion audit is filed, this capability's correctness rests on
pre-write evidence (the §6.1–§6.7 results) plus the §8 audit's confirmation
that the L2987 path is independent. Both are necessary; neither is sufficient
alone.

## §14. Non-goals this turn

- Persistent cross-conversation personal-context store
- Multi-word names
- Lower-case introductions (already covered today by L41463 — not in scope to
  *change*; just noting it works)
- Name corrections / updates
- Other personal context (location, role, preferences)
- Constrained-output capability (deferred per Path B)

---

**V3gga re-authorized Option A (extend L41463 in place) on 2026-04-28 after
the pre-write trip-wire fired. Substrate memo (`docs/substrate-memo.md`) was
drafted in parallel and is non-blocking.**
