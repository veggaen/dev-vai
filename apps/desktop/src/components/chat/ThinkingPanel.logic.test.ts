import { describe, expect, it } from 'vitest';
import { buildThinkingPanelModel, buildReasoningNarrative, prettyModelName, humanizeStage, explainStage, formatDuration, summarizeProcessTrace, buildTurnEvidence, buildAdvisorLessons, buildPipelinePhases } from './ThinkingPanel.logic.js';
import type { TurnThinkingUI } from '../../stores/chatStore.js';

const base: TurnThinkingUI = {
  intent: 'definition',
  strategy: 'research-cited',
  strategyChain: ['research-cited'],
  trustBadge: 'official-docs',
  confidence: 0.82,
  topic: 'docker',
  knowledgeDepth: 'deep',
  durationMs: 140,
};

describe('buildPipelinePhases', () => {
  it('folds checkpoints into ordered macro-phases with proportional shares', () => {
    const view = summarizeProcessTrace([
      { stage: 'chat:start', durationMs: 5 },
      { stage: 'chat:preflight-complete', durationMs: 30 },
      { stage: 'generate:research-routing-complete', durationMs: 60 },
      { stage: 'generate:synthesis-complete', durationMs: 160 },
      { stage: 'tracked:conversational', durationMs: 200 },
    ]);
    const phases = buildPipelinePhases(view);
    expect(phases.map((p) => p.id)).toEqual(['read', 'route', 'evidence', 'compose', 'verify']);
    const compose = phases.find((p) => p.id === 'compose')!;
    expect(compose.ms).toBe(100);
    expect(compose.share).toBeCloseTo(0.5, 1);
  });

  it('returns an empty list for an empty trace', () => {
    expect(buildPipelinePhases(summarizeProcessTrace([]))).toEqual([]);
  });
});

describe('buildThinkingPanelModel', () => {
  it('humanizes intent, strategy chain, trust, and confidence', () => {
    const m = buildThinkingPanelModel(base);
    expect(m.intentLabel).toBe('Definition');
    expect(m.steps.map((s) => s.label)).toEqual(['Research Cited']);
    expect(m.trustLabel).toBe('Official docs');
    expect(m.confidencePct).toBe(82);
    expect(m.headerLabel).toBe('Definition · 1 step');
  });

  it('splits a teacher-loop chain into steps', () => {
    const m = buildThinkingPanelModel({ ...base, strategy: 'yesno->teacher->refine', strategyChain: [] });
    expect(m.steps.map((s) => s.label)).toEqual(['Yesno', 'Teacher', 'Refine']);
    expect(m.headerLabel).toContain('3 steps');
  });

  it('does NOT flag a misroute when intent and strategy agree', () => {
    const m = buildThinkingPanelModel(base);
    expect(m.misrouteSuspected).toBe(false);
    expect(m.defaultExpanded).toBe(false);
  });

  it('flags + auto-expands an action yes/no answered by a definition handler', () => {
    const m = buildThinkingPanelModel({ ...base, intent: 'action-yesno', strategy: 'fact-brand' });
    expect(m.misrouteSuspected).toBe(true);
    expect(m.misrouteHint).toMatch(/yes\/no.*definition/i);
    expect(m.defaultExpanded).toBe(true);
  });

  it('flags a factual question routed to the builder', () => {
    const m = buildThinkingPanelModel({ ...base, intent: 'factual-lookup', strategy: 'creative-code' });
    expect(m.misrouteSuspected).toBe(true);
    expect(m.misrouteHint).toMatch(/builder/i);
  });
});

describe('prettyModelName', () => {
  it('maps model ids to friendly names', () => {
    expect(prettyModelName('vai:v0')).toBe('Vai');
    expect(prettyModelName('local:qwen2.5:7b')).toBe('qwen2.5:7b');
    expect(prettyModelName('anthropic:claude-sonnet-4-20250514')).toBe('claude-sonnet-4-20250514');
    expect(prettyModelName(undefined)).toBe('Vai');
  });
});

describe('buildReasoningNarrative', () => {
  it('frames a low-confidence handoff as a voice speaking up, not a model switch', () => {
    const model = buildThinkingPanelModel({ ...base, confidence: 0.3, trustBadge: 'fallback' });
    const n = buildReasoningNarrative(model, {
      respondingModelId: 'vai:v0',
      fallback: { fromModelId: 'vai:v0', toModelId: 'local:qwen2.5:7b', reason: 'low-confidence' },
      candidateCount: 8,
      belowFloor: false,
      chosenCandidate: 'chat-fact-shim',
    });
    expect(n.summary).toMatch(/answered by qwen2\.5:7b/i);
    expect(n.steps.join(' ')).toMatch(/spoke up/i);
    expect(n.steps.join(' ')).not.toMatch(/switched|no-knowledge|vai:v0/i);
  });

  it('credits Vai when the quality guard replaces two weak fallback drafts', () => {
    const model = buildThinkingPanelModel({
      ...base,
      intent: 'analysis',
      topic: 'I am overwhelmed debugging a blank React page. Where should I start?',
      strategy: 'fallback:no-knowledge->escalate:local:qwen2.5:7b->verify:quality-fallback-pass:pass:ungrounded',
      strategyChain: [
        'fallback:no-knowledge',
        'escalate:local:qwen2.5:7b',
        'verify:quality-fallback-pass:pass:ungrounded',
      ],
      trustBadge: 'fallback',
      durationMs: 17_200,
    });
    const n = buildReasoningNarrative(model, {
      respondingModelId: 'vai:quality-guard',
      fallback: { fromModelId: 'vai:v0', toModelId: 'local:qwen2.5:7b', reason: 'no-knowledge' },
      candidateCount: 9,
      chosenCandidate: 'fallback:no-knowledge',
    });

    expect(n.summary).toMatch(/^Protected by Vai quality guard .* 17\.2s$/);
    expect(n.why).toMatch(/replaced them with a diagnosis-first checklist/i);
    expect(n.steps.join(' ')).toMatch(/rejected two weak drafts/i);
    expect(n.summary).not.toMatch(/answered by qwen/i);
  });

  it('headlines a research turn by source count and appends duration', () => {
    const model = buildThinkingPanelModel({ ...base, durationMs: 1200 });
    const n = buildReasoningNarrative(model, { candidateCount: 3, researchSourceCount: 5 });
    expect(n.summary).toBe('Researched 5 sources · 1.2s');
  });

  it('headlines a clean turn by its intent outcome plus duration', () => {
    const model = buildThinkingPanelModel({ ...base, intent: 'meta', strategy: 'conversational', durationMs: 166 });
    const n = buildReasoningNarrative(model, {});
    expect(n.summary).toBe('Answered conversationally · 166ms');
  });

  it('reads an open-ended chat turn ("hey") as conversational, not generic', () => {
    const model = buildThinkingPanelModel({ ...base, intent: 'other', strategy: 'conversational', durationMs: 166 });
    const n = buildReasoningNarrative(model, {});
    expect(n.summary).toBe('Answered conversationally · 166ms');
  });

  it('says "no confident match" + "none cleared the bar" when below the floor', () => {
    const model = buildThinkingPanelModel({ ...base, confidence: 0.15, trustBadge: 'fallback' });
    const n = buildReasoningNarrative(model, { candidateCount: 8, belowFloor: true });
    expect(n.steps.join(' ')).toMatch(/no confident match/i);
    expect(n.steps.join(' ')).toMatch(/none cleared the confidence bar/i);
  });

  it('opens by stating how Vai read the message, then ends with the decision', () => {
    const model = buildThinkingPanelModel({ ...base, intent: 'other', strategy: 'conversational', topic: '', confidence: 0.9 });
    const n = buildReasoningNarrative(model, {});
    expect(n.steps[0]).toMatch(/read it as an open-ended message/i);
    expect(n.steps[n.steps.length - 1]).toBe('Replied conversationally.');
  });

  it('names the topic in the reading line when present', () => {
    const model = buildThinkingPanelModel({ ...base, intent: 'definition', topic: 'docker' });
    const n = buildReasoningNarrative(model, {});
    expect(n.steps[0]).toBe('Read it as a request to define something about docker.');
  });

  it('explains a fallback handoff in the "why", naming the reason and the model', () => {
    const model = buildThinkingPanelModel({ ...base, intent: 'factual-lookup', topic: 'norway', confidence: 0.5 });
    const n = buildReasoningNarrative(model, {
      respondingModelId: 'vai:v0',
      fallback: { fromModelId: 'vai:v0', toModelId: 'local:qwen2.5:7b', reason: 'low-confidence' },
    });
    expect(n.why).toBe(
      'You sent a factual question about norway. Vai was not confident enough in its own draft, so rather than guess it handed off to qwen2.5:7b and verified the answer before showing it.',
    );
  });

  it('names the winning candidate without a fit-percentage score', () => {
    const model = buildThinkingPanelModel({ ...base, intent: 'factual-lookup', topic: 'norway' });
    const n = buildReasoningNarrative(model, { candidateCount: 6, chosenCandidate: 'chat-facts', chosenScore: 0.72 });
    expect(n.steps.join(' ')).toMatch(/Weighed 6 approaches — fact recall won\./);
  });

  it('describes a clean deterministic answer in plain language (no jargon handler id)', () => {
    const model = buildThinkingPanelModel({ ...base, trustBadge: 'local-curated' });
    const n = buildReasoningNarrative(model, {
      respondingModelId: 'vai:v0',
      candidateCount: 5,
      chosenCandidate: 'chat-facts',
    });
    expect(n.summary).toMatch(/^Explained · /);
    expect(n.steps.join(' ')).toMatch(/knowledge base/i);
    expect(n.steps.join(' ')).not.toContain('chat-facts');
  });
});

describe('humanizeStage', () => {
  it('maps known internal checkpoints to readable lines', () => {
    expect(humanizeStage('tracked:conversational')).toBe('Answered conversationally');
    expect(humanizeStage('generate:compound-complete')).toBe('Checked for multiple questions');
    expect(humanizeStage('stream:start')).toBe('Started responding');
  });

  it('reads an unknown tracked strategy as "Answered with …"', () => {
    expect(humanizeStage('tracked:research-cited')).toBe('Answered with research cited');
  });

  it('falls back to a cleaned phrase for unknown stages', () => {
    expect(humanizeStage('generate:mystery-step-complete')).toBe('Mystery Step');
  });
});

describe('explainStage', () => {
  it('explains known checkpoints in plain English and flags internal markers', () => {
    expect(explainStage('stream:start')).toMatch(/^Internal marker/);
    expect(explainStage('generate:compound-complete')).toMatch(/bundled into one/i);
  });

  it('explains a tracked strategy, decoding "curated"', () => {
    const e = explainStage('tracked:factual-curated');
    expect(e).toMatch(/answered using its factual curated approach/i);
    expect(e).toMatch(/trusted built-in facts/i);
  });

  it('explains the fallback-verify step and returns undefined for unknowns', () => {
    expect(explainStage('tracked:fallback:verify:x')).toMatch(/backup model/i);
    expect(explainStage('generate:mystery-step')).toBeUndefined();
  });
});

describe('formatDuration', () => {
  it('uses ms under a second and seconds above', () => {
    expect(formatDuration(166)).toBe('166ms');
    expect(formatDuration(1200)).toBe('1.2s');
  });
});

describe('summarizeProcessTrace', () => {
  it('treats stored durations as elapsed-from-start, not per-step (fixes bogus total)', () => {
    const v = summarizeProcessTrace([
      { stage: 'stream:start', durationMs: 0 },
      { stage: 'generate:start', durationMs: 71 },
      { stage: 'generate:compound-complete', durationMs: 76, detail: 'single question' },
      { stage: 'tracked:conversational', durationMs: 176, detail: 'deep knowledge' },
    ]);
    // total is the last elapsed value, NOT the sum (which would be 323).
    expect(v.totalMs).toBe(176);
    expect(v.rows[1].stepMs).toBe(71);
    expect(v.rows[2].stepMs).toBe(5);
    expect(v.rows[2].elapsedMs).toBe(76);
    expect(v.rows.map((r) => r.label)).toEqual([
      'Started responding',
      'Began composing the answer',
      'Checked for multiple questions',
      'Answered conversationally',
    ]);
    // authentic per-step detail rides through to the row.
    expect(v.rows[2].detail).toBe('single question');
    expect(v.rows[3].detail).toBe('deep knowledge');
    expect(v.rows[0].detail).toBeUndefined();
    // plain-English explanation + internal-marker flagging.
    expect(v.rows[0].isMarker).toBe(true); // stream:start
    expect(v.rows[1].isMarker).toBe(true); // generate:start
    expect(v.rows[2].isMarker).toBe(false);
    expect(v.rows[2].explanation).toMatch(/scanned your message for several questions/i);
    expect(v.rows[3].explanation).toMatch(/answered conversationally/i);
  });

  it('is empty-safe', () => {
    expect(summarizeProcessTrace([])).toEqual({ rows: [], totalMs: 0 });
  });
});

describe('buildTurnEvidence', () => {
  it('preserves engine step narration as notes (with detail), then file artifacts', () => {
    const items = buildTurnEvidence({
      progressSteps: [
        { stage: 'understand', label: 'Understanding product constraints', detail: 'Hardware, firmware, SaaS scope', status: 'done' },
        { stage: 'structure', label: 'Structuring the memo', status: 'done' },
      ],
      fileChanges: [{ path: 'src/App.tsx', content: 'export const App = () => null;', language: 'tsx' }],
    });
    expect(items).toEqual([
      { kind: 'note', label: 'Understanding product constraints', detail: 'Hardware, firmware, SaaS scope', stage: 'understand' },
      { kind: 'note', label: 'Structuring the memo', detail: undefined, stage: 'structure' },
      { kind: 'file', path: 'src/App.tsx', language: 'tsx', content: 'export const App = () => null;' },
    ]);
  });

  it('dedupes repeated steps and skips empty labels and pathless files', () => {
    const items = buildTurnEvidence({
      progressSteps: [
        { stage: 'a', label: 'Reasoning', detail: 'x', status: 'done' },
        { stage: 'a', label: 'Reasoning', detail: 'x', status: 'running' },
        { stage: 'b', label: '   ', status: 'done' },
      ],
      fileChanges: [{ path: '', content: 'orphan' }],
    });
    expect(items).toEqual([{ kind: 'note', label: 'Reasoning', detail: 'x', stage: 'a' }]);
  });

  it('tags friend-review progress as peer-review notes', () => {
    const items = buildTurnEvidence({
      progressSteps: [{
        stage: 'friend-review',
        label: 'Peer models reviewed the draft',
        detail: 'concerns: missing error handling',
        status: 'done',
      }],
    });
    expect(items).toEqual([{
      kind: 'note',
      label: 'Peer models reviewed the draft',
      detail: 'concerns: missing error handling',
      stage: 'friend-review',
    }]);
  });

  it('preserves structured local-advisor output for inspection and export', () => {
    const items = buildTurnEvidence({
      progressSteps: [{
        stage: 'local-steering',
        label: 'Local model friend returned advice',
        detail: 'debugging | risks: generic-fallback-risk | confidence 81%',
        status: 'done',
        advisor: {
          schemaVersion: 1,
          actorId: 'local:qwen2.5:7b',
          modelId: 'qwen2.5:7b',
          state: 'ready',
          taskShape: 'debugging',
          qualityContract: {
            answerLength: 'structured',
            mustBeGuiding: true,
            mustBeCurrent: false,
            mustUseJson: false,
            shouldAskClarifyingQuestion: false,
          },
          routeGuidance: [{
            signal: 'prefer',
            handler: 'conversation-reasoning',
            reason: 'The user needs a debugging path.',
          }],
          riskFlags: ['generic-fallback-risk'],
          retrievalHints: ['blank React page'],
          confidence: 0.81,
          durationMs: 412,
        },
      }],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'steering',
      advisor: {
        state: 'ready',
        taskShape: 'debugging',
        qualityContract: { mustBeGuiding: true },
        routeGuidance: [{ signal: 'prefer', handler: 'conversation-reasoning' }],
        riskFlags: ['generic-fallback-risk'],
        retrievalHints: ['blank React page'],
      },
    });
  });

  it('is empty-safe', () => {
    expect(buildTurnEvidence()).toEqual([]);
  });
});

describe('buildAdvisorLessons', () => {
  it('turns fresh-evidence and routing advice into bounded reusable lessons', () => {
    const lessons = buildAdvisorLessons({
      schemaVersion: 1,
      actorId: 'local:qwen2.5:7b',
      modelId: 'qwen2.5:7b',
      state: 'ready',
      qualityContract: {
        answerLength: 'structured',
        mustBeGuiding: false,
        mustBeCurrent: true,
        mustUseJson: false,
        shouldAskClarifyingQuestion: false,
      },
      routeGuidance: [{
        signal: 'prefer',
        handler: 'research-cited',
        reason: 'The roster changes between patches.',
      }],
      riskFlags: ['freshness-needed'],
      retrievalHints: ['League of Legends', 'mid lane roster'],
    });

    expect(lessons).toHaveLength(2);
    expect(lessons[0].title).toMatch(/fresh evidence/i);
    expect(lessons[1]).toMatchObject({
      signal: 'prefer',
      handler: 'research-cited',
      matchTokens: ['league', 'legends', 'mid', 'lane', 'roster'],
    });
  });

  it('does not create lessons from unavailable advisor output', () => {
    expect(buildAdvisorLessons({
      schemaVersion: 1,
      actorId: 'local:qwen2.5:7b',
      modelId: 'qwen2.5:7b',
      state: 'unavailable',
      routeGuidance: [],
      riskFlags: [],
      retrievalHints: [],
    })).toEqual([]);
  });
});
