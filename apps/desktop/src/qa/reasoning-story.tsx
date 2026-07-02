import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReasoningFlow } from '../components/chat/ReasoningFlow.js';
import type { ChatProgressStep, CouncilThinkingUI } from '../stores/chatStore.js';
import '../styles/index.css';
import { initOdysseusThemeFromStorage } from '../lib/odysseus-theme.js';

initOdysseusThemeFromStorage();

/**
 * Standalone visual story for ReasoningFlow — renders the spatial reasoning constellation with
 * realistic mock steps so it can be screenshotted and verified as a human would see it, without
 * booting the runtime backend. Not shipped; a QA harness only.
 */

const council: CouncilThinkingUI = {
  outcome: 'act',
  agreement: 0.66,
  confidence: 0.72,
  topic: 'factual',
  summary: 'Panel approved with one dissent on freshness.',
  realIntent: 'Compare the two options and recommend one.',
  recommendedAction: 'ship',
  missingCapabilities: ['No live price feed for fresh-data checks'],
  methodLessons: ['Cite the fetched source inline next time.'],
  members: [
    { name: 'qwen3:8b', role: 'Systems architect', topic: 'review', verdict: 'good', confidence: 0.82, action: 'ship', note: 'Answer is grounded and current.', durationMs: 4200 },
    { name: 'deepseek-r1', role: 'Skeptic', topic: 'review', verdict: 'good', confidence: 0.71, action: 'ship', methodLesson: 'Cite the fetched source inline next time.', durationMs: 6100 },
    { name: 'gemma2', role: 'Scale reviewer', topic: 'review', verdict: 'bad', confidence: 0.44, action: 'redraft', concerns: ['Missed the follow-up intent', 'No fresh-data check'], durationMs: 3800 },
  ],
} as unknown as CouncilThinkingUI;

const steps: ChatProgressStep[] = [
  { stage: 'understand', label: 'Read the intent', status: 'done', detail: 'User is asking for a comparison, not a definition — surface trade-offs.', durationMs: 320 },
  { stage: 'search', label: 'Gather evidence', status: 'done', detail: 'Fetched 3 sources; 2 used, 1 stale.', durationMs: 2100 },
  {
    stage: 'council-vai-round-1',
    label: 'Council deliberates',
    status: 'done',
    detail: 'Panel of 3 reviewed the draft.',
    durationMs: 6100,
    councilMembers: council.members,
  } as unknown as ChatProgressStep,
  { stage: 'vai-draft', label: 'Vai drafts', status: 'done', detail: 'Composed a 4-point comparison with a recommendation.', durationMs: 1400 },
  { stage: 'quality-check', label: 'Approval gate', status: 'done', detail: 'Verification passed', durationMs: 260 },
] as unknown as ChatProgressStep[];

// A long, multi-round turn so the zoom/pan + minimap + semantic tiers are demonstrable.
const longSteps: ChatProgressStep[] = [
  { stage: 'understand', label: 'Read the intent', status: 'done', detail: 'Multi-part build request.', durationMs: 300 },
  { stage: 'search', label: 'Gather evidence', status: 'done', detail: 'Fetched 5 sources.', durationMs: 3100 },
  { stage: 'reason', label: 'Reason', status: 'done', detail: 'Planned a 4-file change.', durationMs: 900 },
  { stage: 'council-vai-round-1', label: 'Council deliberates', status: 'done', detail: 'Round 1.', durationMs: 6100, councilMembers: council.members } as unknown as ChatProgressStep,
  { stage: 'vai-draft', label: 'Vai drafts', status: 'done', detail: 'First draft.', durationMs: 1400 },
  { stage: 'quality-check', label: 'Verify', status: 'done', detail: 'fail: missed a case', durationMs: 400 },
  { stage: 'vai-redraft', label: 'Vai revises', status: 'done', detail: 'Second pass.', durationMs: 1200 },
  { stage: 'council-vai-round-2', label: 'Council deliberates', status: 'done', detail: 'Round 2.', durationMs: 5200, councilMembers: council.members } as unknown as ChatProgressStep,
  { stage: 'build-apply', label: 'Build', status: 'done', detail: 'Applied patch.', durationMs: 2600 },
  { stage: 'preview', label: 'Build', status: 'done', detail: 'Preview rendered.', durationMs: 1800 },
  { stage: 'quality-check', label: 'Verify', status: 'done', detail: 'Verification passed', durationMs: 260 },
] as unknown as ChatProgressStep[];

// 40-step stress fixture — the perf budget: drag/zoom must stay smooth (transform-only work)
// and the fit/minimap must remain usable at this density.
const manySteps: ChatProgressStep[] = Array.from({ length: 40 }, (_, i) => {
  const kinds = [
    { stage: 'search', label: 'Gather evidence' },
    { stage: 'reason', label: 'Reason' },
    { stage: 'vai-draft', label: 'Vai drafts' },
    { stage: 'quality-check', label: 'Verify' },
  ];
  const k = kinds[i % kinds.length];
  return {
    stage: `${k.stage}-${i}`,
    label: `${k.label} ${i + 1}`,
    status: 'done',
    detail: `Step ${i + 1} of a very long turn.`,
    durationMs: 300 + (i % 7) * 250,
  };
}) as unknown as ChatProgressStep[];

function Story() {
  return (
    <div style={{ maxWidth: 760, margin: '3rem auto', padding: '0 1.5rem' }}>
      <h2 style={{ color: 'var(--chat-muted)', fontSize: 12, marginBottom: 24, fontWeight: 500 }}>
        ReasoningFlow — settled turn
      </h2>
      <div style={{ marginBottom: 48 }}>
        <ReasoningFlow steps={steps} council={council} live={false} durationMs={10180} />
      </div>

      <h2 style={{ color: 'var(--chat-muted)', fontSize: 12, marginBottom: 24, fontWeight: 500 }}>
        ReasoningFlow — long, multi-round turn (zoom · pan · minimap)
      </h2>
      <div style={{ marginBottom: 48 }}>
        <ReasoningFlow steps={longSteps} council={council} live={false} durationMs={23460} />
      </div>

      <h2 style={{ color: 'var(--chat-muted)', fontSize: 12, marginBottom: 24, fontWeight: 500 }}>
        ReasoningFlow — 40-step stress fixture (perf budget)
      </h2>
      <div style={{ marginBottom: 48 }} data-testid="many-step-story">
        <ReasoningFlow steps={manySteps} live={false} durationMs={64000} />
      </div>

      <h2 style={{ color: 'var(--chat-muted)', fontSize: 12, marginBottom: 24, fontWeight: 500 }}>
        ReasoningFlow — live turn
      </h2>
      <ReasoningFlow
        steps={[...steps.slice(0, 2), { ...steps[2], status: 'running' } as ChatProgressStep]}
        council={council}
        live
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Story />
  </StrictMode>,
);
