# Vai bench — iteration loop

**Goal:** turn factual coverage from "patch what comes up in chat" into a measurable
validate → iterate → test loop driven by one command.

## Run it

```sh
cd packages/core
pnpm bench                      # frontier corpus, full
pnpm bench -- --max=20          # smoke test
pnpm bench -- --corpus=other    # different corpus
```

Outputs:
- `bench/reports/<corpus>-<stamp>.json` — full structured results
- `bench/reports/<corpus>-latest.md` — human-readable summary with Δ vs prev run

Exit code is `1` if any **FALLBACK** rows are present (regression gate for CI).

## Verdicts

| Verdict | Meaning |
|---|---|
| `PASS` | No fallback, no low-quality leak, ≥ `MIN_LEN`, every `mustMatch` regex matched. |
| `SOFT` | Curated answer present, length OK, but at least one `mustMatch` keyword missing. The answer might be wrong or about the wrong subject. |
| `LOWQ` | Wikipedia disambiguation / "additional citations" / raw-scrape phrasing leaked. |
| `FALLBACK` | Honest-gap fallback fired — no curated coverage at all. **Hard regression.** |
| `SHORT` | Answer shorter than `MIN_LEN` chars (likely a stub). |

Network is disabled during the run so any answer that depended on a wikipedia
fetch will fail — we measure what's actually baked into the engine.

## The loop

1. `pnpm bench` → read `frontier-latest.md`.
2. Pick the worst category (most `FALLBACK` / `SOFT`).
3. Add curated entries in `vai-engine.ts` (and matching test rows in
   `chat-hygiene.test.ts`) for that category only.
4. `pnpm test` → green.
5. `pnpm bench` → confirm category goes greener and tally improves vs prev.
6. `pnpm build:bundle` → deploy → commit → push.

## Add a corpus

Each row in `bench/corpus/<name>.jsonl` is one JSON object per line:

```json
{"id":"sci-001","category":"science","q":"what is dark matter?","mustMatch":["dark matter","gravitational"]}
```

`mustMatch` items are case-insensitive regex strings. Use `|` for alternates.

## Future iterations (deferred)

- DeepEval-style LLM-as-judge as a second scoring lane (HIGH).
- RAGAS for any future RAG path (HIGH).
- Needle-in-a-Haystack memory test (MEDIUM).
- LongBench (MEDIUM).
- Skip MMLU/GPQA/HumanEval (LOW — not what Vai is for).
