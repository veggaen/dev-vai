# Dictation Correction Learning — Design

**Status:** design (build after review)
**Goal:** When Vai pastes a dictated sentence and you fix a word before sending, Vai should *learn the genuine mishearings* — and never mis-learn from a change of mind, a deletion, or an unrelated edit.

---

## 1. What already exists (and is good)

`correction-detection.ts` + `speech-profile.ts` already do a lot right:

- **Word-level LCS diff** of *what we inserted* vs *what you sent*, classified into `replace` / `insert` / `delete`.
- **Only `replace` edits** are treated as candidate mishearings. Deletions and insertions are ignored.
- **Big-rewrite guard:** a correction is dropped if the replacement is > 3 words (you retyped the sentence, not fixed a word).
- **Evidence, not one-shot:** a rule only auto-applies after `PROMOTE_AT = 2` sightings.
- **Self-heal:** if you edit an auto-applied word *back*, the rule earns a `strike`; at `RETIRE_AT = 2` it stops applying.
- **Explicit confirm path** (`confirmCorrection`) and a friendly prompt (`mishearingPrompt`).
- Bounded to 200 rules, persisted in localStorage.

So the skeleton is right. We are **hardening it**, not rewriting it.

## 2. The one real gap + one likely bug

**Gap — no phonetic check.** The system treats *any* word swap as a possible mishearing. It cannot tell:

- `"leech of legends" → "league of legends"` — a **real mishearing** (sounds alike) ✅ learn it
- `"park" → "beach"` — a **change of mind** (sounds nothing alike) ❌ must NOT learn it

Today only *repetition* (2×) guards against this. But a habit ("I often say park then switch to beach") would wrongly become a rule. **This is the core fix.**

**Bug to verify** — in `speech-profile.ts`, `confirmCorrection` builds its rule-map key with what looks like a mojibake arrow (`â†'`) on lines ~151–152, while `learnFromEdit` uses `→`. If that's real in the file (not just an editor display artifact), confirmed corrections use a *different key* and never dedupe/merge with learned ones. Fix: use the exact same separator in both. Add a test that a `confirmCorrection` then a `learnFromEdit` for the same pair collapse to one rule.

## 3. Research — why this is dangerous if done naively

- **ASR confidence scores are unreliable for error detection** — classifiers "frequently miss errors or generate many false positives." So we must NOT gate learning on the model's own confidence; use the *user's edit* as the signal, gated by phonetics. [ASR confidence for error detection](https://arxiv.org/html/2503.15124v1)
- **Implicit feedback is noisy** — "unobserved interactions are not necessarily negative"; false positives "degrade performance" and "hurt user experience." Translation: one edit ≠ ground truth. Require corroboration (repetition or explicit confirm). [Noisy implicit feedback](https://arxiv.org/pdf/2112.01160)
- **Users miss their own errors** more on complex utterances — their feedback itself has false positives. So keep rules **conservative, visible, and reversible**. [ASR error detection interfaces](https://arxiv.org/html/2503.15124v1)
- **The winning pattern is noisy→clean phrase mapping** learned over time — exactly a promoted-rule dictionary, which is what we have. [Learning from past ASR mistakes](https://www.cambridge.org/core/journals/apsipa-transactions-on-signal-and-information-processing/article/learning-from-past-mistakes-improving-automatic-speech-recognition-output-via-noisyclean-phrase-context-modeling/0025A4B2DF4F33B90FB090A195D304ED)
- From the earlier memory research: users demand **control, transparency, and the ability to edit/delete** what an assistant remembers. A learned correction must never be a silent, unremovable "dossier."

## 4. Edge-case catalog (your questions + the ones you couldn't think of)

| # | Situation | Current behavior | Design decision |
|---|-----------|------------------|-----------------|
| A | **Mishearing** ("leech"→"league") | learned after 2× | ✅ learn — passes phonetic gate |
| B | **Change of mind** ("park"→"beach") | *would* learn after 2× | ❌ reject — fails phonetic gate |
| C | **Just removed a word** | ignored (delete) | ✅ keep ignoring |
| D | **Added a word** | ignored (insert) | ✅ keep ignoring |
| E | **Retyped whole sentence** | dropped (>3 words) | ✅ keep dropping |
| F | **Deleted the whole dictated sentence later** | mostly delete-runs | ❌ add a *span-integrity guard*: if little of the inserted text survives, learn nothing |
| G | **Homophones of common words** ("their"→"there", "to"→"too") | would learn | ❌ reject unless one side is a *rare / proper-noun* token — a global their→there rule is unsafe (context-dependent) |
| H | **Typo in the fix** ("legaue") | would learn a bad target | Mitigated by 2×-repetition + easy undo; optionally require target to be a known/again-seen token |
| I | **Case / punctuation only** ("hello"→"Hello") | ignored (normalized) | ✅ keep ignoring |
| J | **App grooming changed the word, not you** | baseline is post-groom text | ✅ ensure baseline = the text actually inserted (post prettify+profile) |
| K | **Many edits in one utterance** | each becomes a candidate | ❌ if > 2 candidate mishearings, treat as low-confidence (noise) → confirm-only |
| L | **Edit long after, in unrelated context** | compared at send only | ✅ only compare the *last dictation's* baseline vs sent, and only via the span-integrity guard (F) |
| M | **You fix it, then fix it differently next time** | two competing rules | Latest-wins via `lastSeen`; strikes retire the loser |

## 5. The design

Three layers, smallest change first.

### 5.1 Confidence gate (the core fix)
Add `plausibleMishearing(heard, corrected)` and score before a candidate is allowed to become/advance a rule. A candidate must pass ALL of:

1. **Phonetic proximity.** Compute a lightweight phonetic key for each side (Metaphone-lite; see §6). Accept if keys are equal *or* their phonetic edit distance ≤ 1 per ~4 chars. (`park`≠`beach` → reject; `leech`≈`league` → accept.)
2. **Orthographic band.** Normalized Levenshtein similarity in `[0.34, 0.95]` — different enough to be a fix, close enough not to be a swap. (Tunable.)
3. **Rarity/safety.** At least one side contains a token NOT in a small common-word list (function words, top-200 English). Blocks risky common-word rules; keeps the valuable proper-noun/jargon ones.
4. Existing filters: ≤ 3 words, `minWordLen`, not identical after norm.

Output a **confidence** in `{high, medium, none}`:
- **high** = phonetic keys equal AND rarity satisfied AND single edit in the utterance → silently accumulate (`count++`, auto-promote at 2).
- **medium** = passes gate but weaker (phonetic near-miss, or ≥2 edits in utterance) → **do not auto-learn**; surface the confirm prompt; learn only on explicit "yes."
- **none** = fails the gate → ignore entirely (this is case B/G).

### 5.2 Span-integrity guard (scope/timing — cases F, L)
Before diffing, require that the inserted dictation still substantially survives in the sent text: `LCS(insertedTokens, sentTokens) / insertedTokens.length ≥ 0.5`. If less survives, the user deleted/rewrote — **learn nothing** this cycle. Also only ever compare the *most recent* dictation baseline, captured at insert time.

### 5.3 Transparency + undo (trust)
- A **"Learned corrections"** list in Settings → Voice: every rule shown as `heard → corrected`, with count/status, **editable and deletable**, plus a "clear all."
- When a rule **auto-promotes**, show a tiny, dismissable "Learned: leech → League of Legends · Undo" toast. One click removes it. (Directly answers "what if he didn't want that.")
- Keep the existing self-heal strikes as a second safety net.

### 5.4 Synergy with Custom Words
When a correction is **confirmed or promoted** and the target is a proper-noun-ish phrase, auto-add it to the Custom Words vocabulary (from the accuracy work). Now the same fact helps the cleanup LLM *and* the whisper prompt — one correction, three defenses.

## 6. Algorithms (pseudocode)

```ts
// Metaphone-lite: cheap, dependency-free phonetic key.
function phoneticKey(word: string): string {
  return word.toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/[aeiou]+/g, 'a')      // collapse vowels
    .replace(/(.)\1+/g, '$1')       // de-double
    .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/gh/g, 'g')
    .replace(/[sz]/g, 's').replace(/[dt]/g, 't');
}

function phraseKey(p: string): string {
  return p.split(/\s+/).map(phoneticKey).join(' ');
}

function plausibleMishearing(heard: string, corrected: string): 'high'|'medium'|'none' {
  if (tooManyWords(corrected) || tooShort(heard, corrected)) return 'none';
  if (!hasRareToken(heard) && !hasRareToken(corrected)) return 'none';   // case G
  const hk = phraseKey(heard), ck = phraseKey(corrected);
  const orth = levenshteinRatio(norm(heard), norm(corrected));
  if (orth < 0.34 || orth > 0.95) return 'none';                          // case B/I
  if (hk === ck) return 'high';                                           // strong homophone-of-rare
  if (phoneticEditDistance(hk, ck) <= Math.ceil(hk.length / 4)) return 'medium';
  return 'none';
}
```

Gate `result.mishearings` in `learnFromEdit` through `plausibleMishearing`; only `high` auto-accumulates, `medium` routes to the confirm prompt, `none` is dropped. Add the span-integrity guard at the top of `learnFromEdit`.

## 7. Integration points

- `correction-detection.ts` — add `phoneticKey/phraseKey/plausibleMishearing/levenshteinRatio` (+ a small common-word set). Keep it pure + unit-tested.
- `speech-profile.ts` — call the gate inside `learnFromEdit`; add the span-integrity guard; **fix the `→` key bug**; expose `removeRule`, `listRules` for the settings UI; on promote/confirm, optionally push to Custom Words.
- `ChatWindow.tsx` — where `snapshotDictationBaseline` / send happens: ensure the baseline is the inserted (post-groom) text, feed `learnFromEdit`, and show the "Learned … · Undo" toast on a new promotion.
- `VoiceSettingsPanel.tsx` — the "Learned corrections" list (view/edit/delete/clear).

## 8. Build order

1. Phonetic gate + tests (pure, zero risk) — covers cases A/B/G/I.
2. Wire the gate into `learnFromEdit`; fix the `→` bug.
3. Span-integrity guard — covers F/L.
4. "Learned corrections" settings list + undo toast (transparency).
5. Custom-Words synergy.

## 9. Test cases to write (edge catalog → unit tests)

`"leech of legends"→"league of legends"` = high · `"park"→"beach"` = none · `"their"→"there"` = none (both common) · `"github"→"get hub"` reversed = high · deletion/insertion = none · 4-word replacement = none · case-only = none · survives-50%-guard on a mostly-deleted sentence = learn-nothing.

---

**Bottom line:** you were right to worry. The fix is a *phonetic + rarity gate* so only real mishearings of meaningful words are ever learned, a *span-integrity guard* so late/large edits teach nothing, and *visible, one-click-undoable* rules so a mistake is never sticky. Everything else (repetition, self-heal, bounds) you already have.
