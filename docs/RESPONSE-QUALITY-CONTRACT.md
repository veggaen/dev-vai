# Vai Response Quality Contract

This document defines what "a quality response" means in Vai and how to test it.
`Master.md` remains authoritative if the two conflict.

## The Three Axes

### Human quality

A good response:

- answers the actual question directly
- gives a useful next move when the user is uncertain
- matches depth and structure to the request
- avoids contempt, fake cheerleading, filler, and unnecessary cognitive load
- preserves conversational context and reduces the need for retries

### AI quality

A good response:

- follows explicit instructions and constraints
- stays relevant and specific
- distinguishes evidence, inference, and uncertainty
- does not invent facts, toolchains, files, or project state
- uses current or grounded evidence when freshness or factual correctness matters

### Robot quality

A good turn:

- selects the correct mode and turn kind
- reaches a terminal state within a bounded time
- exposes structured progress, provenance, and failures
- does not take an unrequested action or emit an unrequested artifact
- performs at most one model repair, then uses a deterministic safe fallback
- leaves an auditable trace that matches what the user actually saw

No single aggregate score may hide a hard failure on another axis.

## Evaluation Method

Use both hard gates and preference tests:

1. Hard gates reject empty, off-topic, hostile, fabricated, misrouted, non-terminal, or out-of-scope responses.
2. Multi-dimensional scoring reports human, AI, and robot results separately.
3. Pairwise human or blind-model comparison chooses between two otherwise valid answers.
4. Grounded factual tasks receive a separate consistency check against the supplied evidence.
5. Live Playwright tests verify the rendered answer, mobile layout, process trace, and browser console.

Pairwise preference alone is not a correctness test. A fluent answer can still be wrong, ungrounded, or operationally unsafe.

## Research Basis

- ACUTE-Eval supports pairwise comparison of complete dialogues for qualities such as engagingness and humanness.
- FED evaluates fine-grained turn and dialogue qualities instead of one opaque score.
- USR demonstrates reference-free, interpretable dialogue-quality measures.
- Q2 treats factual consistency in knowledge-grounded dialogue as a separate evaluation problem.
- PARADISE connects user satisfaction with task success and interaction cost.
- LLM judges are useful for scale, but must be calibrated against deterministic checks and humans because position, style, and scoring biases remain.

Primary references:

- https://arxiv.org/abs/1909.03087
- https://arxiv.org/abs/2006.12719
- https://arxiv.org/abs/2005.00456
- https://arxiv.org/abs/2104.08202
- https://arxiv.org/abs/cmp-lg/9704004

## Repo Enforcement

- `packages/core/src/chat/chat-answer-quality.ts`
  - actionable guidance, honest calibration, scope preservation, drift, and tone
- `packages/core/src/chat/service.ts`
  - one bounded repair and deterministic diagnostic fallback
- `packages/core/src/chat/turn-kind.ts`
  - separates stack mentions and debugging questions from explicit build requests
- `scripts/lib/vai-generated-audit-grader.mjs`
  - reports human, AI, and robot axis scores plus trace integrity
- `scripts/lib/vai-conversational-quality-wave.mjs`
  - natural open-ended prompts with hidden quality contracts
- `.codex-run/vai-local-advisor-visual.mjs`
  - real desktop/mobile response and process-trace proof

## Competitor Lesson

Odysseus is useful as a product reference because it makes capabilities legible:
Chat, Agent, Compare, Cookbook, Deep Research, Documents, Memory, and mobile support are explicit surfaces rather than hidden magic.

Vai should borrow the principle, not the skin:

- show which capability acted
- show model and quality-guard provenance
- expose useful details on demand
- keep the default answer readable and compact
- make degraded states and recovery visible

Reference: https://github.com/pewdiepie-archdaemon/odysseus
