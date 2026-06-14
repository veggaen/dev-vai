# Plan — Council Cross-Check Re-Architecture + Visual Grounding

Status: **PLAN (awaiting approval before code)**
Author: Vai/Claude session, 2026-06-14
Branch target: feature fork off `main`, merge back only on proven net-positive.

---

## 0. The failure we are fixing (ground truth from the live screenshot)

User asked "what is the price of eth" and attached a Google screenshot showing **1 680,15 USD**.

What happened:
1. Vai answered **"$3,200.00 USD"** — a fabricated number (real price ~1,680).
2. The council voted **needs-work / web-search** (correct instinct).
3. The fact cross-check ran a search, found *some* number within 5% of 3,200 in a
   reddit/medium snippet, **false-confirmed**, flipped `web-search → ship`, and stamped
   the answer **"web-confirmed"** citing reddit.com/medium.com — irrelevant blog posts.
4. On the follow-up "look at my screenshot what is the price?", Vai said **"The price in
   your screenshot is $3,200.00"** — a confident lie about visual content it never saw.
   The image is reduced to `[Image: <human description>]`; **the pixels never reach a model.**

### Root causes (each fixed by a named stage below)
- **RC1 — string-presence ≠ verification.** `assessClaimAgreement` confirms if *any*
  number anywhere in 5 snippets is within 5% of the claim. With a page full of numbers
  (years, comment counts, prices) a coincidental match is near-guaranteed. → Stage B.
- **RC2 — verification ignores the user's actual intent.** `extractCheckableClaim` looks
  only at Vai's *draft*, never at what the user *asked* (price = "today/now", subject = ETH).
  → Stage A.
- **RC3 — Vai is blind to images but claims to read them.** Pixels are in the DB
  (`images.data`, base64) but only the human description string is passed downstream.
  No vision/OCR path exists; all three local models (qwen3:8b, qwen2.5:7b, qwen2.5:3b)
  are **text-only**. → Stage C.
- **RC4 — a weak/coincidental confirm is allowed to ship a `web-search` verdict.**
  `applyCrossCheck` clears `web-search → ship` on *any* `verified`, regardless of evidence
  quality or quantity. → Stage B + D.

---

## 1. Design principle

The cross-check today asks the wrong question — *"does this number appear in a blob?"*.
It must ask, in order:

> **A. What does the user actually want?** → **B. Can Vai ground it, and does grounded,
> subject-anchored, corroborated evidence support the specific claim?** → **C. If the ask
> is about an image, can Vai actually see it — and if not, what honest grounded answer can
> it give instead?**

Plus two cross-cutting commitments you asked for:
- **D. Council gets tools** — vision + grounded-lookup tools the members can call to
  *independently verify*, with a feedback/correction loop (multi-hybrid meta).
- **E. Long-term learning** — Vai improves over time at *inspecting* and (later) *creating*
  visual content, by harvesting labeled outcomes from every run.

### Folded in from Grok's review (2026-06-14)
- **B-temporal**: fabricated timestamps ("as of 10:00 AM UTC") are claims too. Stage B also
  extracts temporal claims and fails them if they can't be grounded — same policy as numbers.
- **Multi-turn persistence (RC5)**: Vai repeated the SAME wrong number after correction.
  Add a turn-level guard: a value the user has explicitly disputed in this conversation is
  flagged; re-asserting it without fresh grounding is blocked (see Stage F).
- **E-taxonomy**: the learning log gets an `errorType` enum:
  `price_hallucination | image_claim_without_vision | fabricated_timestamp |
   weak_source_confirmation | persistent_error_after_correction`.
- (Deferred, noted not built now: richer conversational repair phrasing, price-freshness
  "as of <source timestamp>" surfacing — cheap follow-ups once accuracy is fixed.)

---

## 2. Stages

### Stage A — Intent resolution (`consensus/intent-resolver.ts`, new, pure)
A typed resolver run on `(prompt, draft, hasImage)` → `ResolvedIntent`:
```ts
interface ResolvedIntent {
  wantsCurrentValue: boolean;   // price/cost/worth/"now"/"today" + no explicit past date
  valueKind: 'price' | 'count' | 'date' | 'entity' | 'none';
  subject: string | null;       // "ETH"/"Ethereum" — anchors search + number matching
  subjectAliases: string[];     // ["eth","ethereum","ether"]
  referencesImage: boolean;     // "my screenshot", "this image", "the picture"
  asksToReadImage: boolean;     // referencesImage && a question that needs pixel content
}
```
- "guess the user wants today's price": `wantsCurrentValue = valueKind==='price' && !explicitPastDate`.
- Subject extraction: entity from prompt first, fall back to draft. Drives Stage B anchoring.
- Pure, fully unit-tested. **No model call** (deterministic, fast, testable).

### Stage B — Subject-anchored, corroborated grounding (rewrite `cross-check.ts`)
Replace `assessClaimAgreement`'s first-within-tolerance scan with:
1. **Candidate extraction**: only numbers from snippets that mention the **subject alias**
   AND carry the **value unit** (currency symbol / "USD" for price). Reddit comment with a
   stray "3,200" and no "eth"+"$" context → discarded.
2. **Consensus over candidates**: need ≥ `MIN_CORROBORATION` (default 2) qualifying
   candidates; compute their **median**. Confirm the draft only if its number is within
   tolerance of the **median**, not of any single hit.
3. **Contradiction**: qualifying candidates exist, cluster tightly, and the draft is
   outside tolerance of their median → `contradicted` (drives redraft).
4. **Inconclusive**: < MIN_CORROBORATION qualifying candidates → advisory only, never a pass,
   never clears `web-search → ship`. (Directly fixes RC1 + RC4.)

Confidence of confirmation scales with corroboration count and source trust tier
(high-trust price sources weigh more than a forum).

### Stage C — Visual grounding (multi-hybrid meta)
Two paths, chosen by Stage A:

**C1 — value/price image questions → live re-grounding (ship first).**
When `referencesImage && wantsCurrentValue`: do NOT trust the (stale) screenshot number.
Answer from Stage B's live grounded search and say so honestly:
*"I can't read your screenshot pixels directly, but the live ETH price is $X (CoinMarketCap,
Binance)."* For a price, the live number is what the user actually wants anyway.

**C2 — read-the-image questions (diagram, error text, non-value) → vision adapter.**
Introduce a typed boundary so this is pluggable and testable without a model:
```ts
interface VisionAdapter {
  id: string;
  describe(input: { dataBase64: string; mime: string; question?: string }):
    Promise<{ text: string; ocrText?: string; confidence: number } | null>;
}
```
- Implementation: a local vision model via Ollama (candidate: `qwen2.5vl` /
  `minicpm-v` / `llava` / `moondream`). **Not yet pulled — none of the 3 installed models
  are vision-capable.** Adapter ships as an interface + a `NullVisionAdapter` stub so the
  whole pipeline is testable now; the real model is pulled in a guarded follow-up
  (respecting the crash-safe VRAM-headroom rule — vision model loaded one-at-a-time).
- **No vision adapter configured** ⇒ honest decline for C2 turns (never fabricate). Fixes RC3.

**Council-with-tools (the "meta" layer).** When a vision describe runs, its `ocrText` +
`describe.text` become a *grounded source the council can review and correct* — passed into
`CouncilInput` as visual evidence (still fact-quarantined: members critique/flag, Vai's
tools own the final fact). A member can vote "vision misread — re-OCR / cross-check against
live search", closing the feedback/correction loop. Members never invent the number; they
point at which tool to re-run. This needs a small `CouncilInput.visualEvidence?` field +
a vision-aware line in the member system prompt.

### Stage D — Ship gate
`applyCrossCheck` only clears `web-search → ship` when the confirm is **corroborated**
(Stage B ≥ MIN_CORROBORATION). Weak/inconclusive confirms stay advisory: the
`web-search` action persists and the redraft loop runs. An image-value turn with no live
corroboration → honest "couldn't verify" rather than a fabricated number.

### Stage C-grok — Grok-CLI as a vision-capable council member (verified available)
The `grok` build TUI is installed at `~/.grok/bin/grok` and supports headless single-turn:
`grok -p '<prompt>' --output-format json [--system-prompt-override <sys>]` → `{ "text": ... }`.
Measured latency ~8.8s (under the 12s council timeout; a slow run is a non-blocking failure).
Grok (hosted) **can see images** — so a Grok-CLI member is a real vision verifier with **no
GB download, no VRAM** cost. This is the preferred Stage C vision path over a local model.
- New `models/grok-cli-adapter.ts`: implements `ModelAdapter.chat` by shelling out to grok
  headless, parsing `.text`, reusing `parseCouncilNote`. Image turns pass the screenshot.
- Wired via `createCouncilMember({ adapter: grokCli, topic: 'factual' })`, behind env flag
  `VAI_COUNCIL_GROK=1` + a `command -v grok` guard (no-op when absent). Fact-quarantine still
  holds: Grok points/verifies; Vai's tools own the surfaced fact.

### Stage F — Multi-turn correction guard (from Grok review RC5)
Track values the user explicitly disputed this conversation ("you where wrong", "that's
wrong", a different number stated). Before shipping, if the draft re-asserts a disputed value
without fresh corroborated grounding → block + force redraft/decline. Prevents the
"repeat the same $3,200 after being corrected" failure. Logged as
`persistent_error_after_correction`.

### Stage E — Learning loop (data harvest)
Every cross-check + vision run logs a labeled outcome (new table
`visual_grounding_log` or reuse `retrieval_quality_log` shape): `{prompt, subject,
claimNumber, candidates[], median, verdict, contradicted, visionUsed, visionConfidence,
shipped, userFeedback}`. This is the dataset for: (a) tuning tolerance / MIN_CORROBORATION,
(b) measuring new-vs-old, (c) future fine-tuning of both *inspecting* and (later)
*creating* visual content. Feedback (👍/👎 already in `messages.feedback`) joins on turn.

---

## 3. Files

New:
- `packages/core/src/consensus/intent-resolver.ts` (+ test)
- `packages/core/src/vision/adapter.ts` (VisionAdapter, NullVisionAdapter) (+ test)
- `packages/core/src/vision/ollama-vision.ts` (real adapter; guarded, behind env flag)
- migration for `visual_grounding_log` (Stage E)

Changed:
- `consensus/cross-check.ts` — subject-anchored corroborated grounding (Stage B/D)
- `consensus/types.ts` — `CouncilInput.visualEvidence?`, `CheckableClaim` gains subject
- `consensus/member.ts` — vision-aware review line
- `chat/service.ts` — Stage A wiring, C1/C2 branching, vision call, Stage E logging
- existing `__tests__/council-cross-check.test.ts` — rewritten for new semantics

---

## 4. Validation protocol (your spec: static + dynamic, compare vs old, merge only if net+)

1. **Static**: `tsc` gate + full `vitest` on every iteration.
2. **Dynamic / varied**: extend `scripts/live-probe-council-crosscheck.mjs` into a
   scenario matrix — the eth-screenshot case, a *correct* price draft (must still confirm),
   a fabricated price (must NOT confirm), a forum-noise page (must stay inconclusive),
   a non-price image (must decline or OCR), a contradiction case. Run with randomized
   snippet ordering / noise injection (fuzz) so it's dynamic, not a fixed fixture.
3. **Harvest**: record pass/fail + the Stage E log for each scenario; bucket
   good/bad/false-confirm/false-decline.
4. **Compare**: run the SAME matrix against the OLD cross-check (git stash / baseline tag),
   produce a side-by-side scorecard (false-confirm rate ↓, correct-confirm rate ≥,
   honest-decline rate ↑, latency delta).
5. **Gate**: merge to `main` only if the new state is a measured net improvement
   (false-confirm rate strictly down, no regression in correct-confirm, latency acceptable).

---

## 5. Execution order

1. **Sync `main` to GitHub** (push current committed state).
2. Create fork/branch `feat/council-visual-grounding`.
3. Stage A + B + D + rewritten tests (no model dependency) → static + dynamic pass.
4. Stage C1 (live re-grounding, no new model) → tests.
5. Stage C2 boundary + NullVisionAdapter + decline path → tests. (Real Ollama vision
   model = guarded follow-up, VRAM-safe.)
6. Stage E logging.
7. Full compare-vs-old scorecard.
8. If net-positive: merge to `main`, update memory.

---

## 6. Open dependency to flag

- A real C2 (read arbitrary image) needs a vision model **pulled** (~ few GB, GPU).
  Per crash-safe rule, that's a separate, single-heavy-task step. Everything else
  (A, B, C1, D, E, the C2 boundary + decline) ships and is provable **without** it.
