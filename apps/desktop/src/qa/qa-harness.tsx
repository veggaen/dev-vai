/**
 * QA Harness — a DEV-ONLY isolated render surface for Process UI states, so we can VISUALLY audit
 * the ProcessTree (dissent, grounding, clean, etc.) with Playwright WITHOUT a full model turn.
 *
 * Served by Vite in dev at /qa-harness.html (its own entry; never bundled into the production app,
 * which builds from index.html). Pick a scenario with ?scenario=council-dissent. The list of
 * scenarios is exported so the harness can self-document and scripts/visual-qa.mjs can enumerate.
 *
 * It mounts the REAL ProcessTree with the REAL design tokens (qa-harness.html mirrors the app's
 * early theme paint + fonts + styles/index.css), so what you screenshot is what ships.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import { ProcessTree } from '../components/chat/ProcessTree.js';
import type { ChatProgressStep, CouncilThinkingUI } from '../stores/chatStore.js';

const baseSteps: ChatProgressStep[] = [
  { stage: 'council-vai-round-1', label: 'Council reviewed the draft', status: 'done' } as ChatProgressStep,
];

const baseCouncil = (): CouncilThinkingUI => ({
  outcome: 'ship', agreement: 0.8, confidence: 0.84, topic: 'other',
  summary: 'Panel agreed; shipping', realIntent: '', recommendedAction: 'answer-directly',
  missingCapabilities: [], methodLessons: [],
  members: [
    { name: 'local:qwen2.5:7b', topic: 'intent', verdict: 'good', confidence: 0.86, action: 'answer-directly', note: 'on-topic, grounded' },
    { name: 'local:qwen3:8b', topic: 'skeptic', verdict: 'good', confidence: 0.8, action: 'answer-directly', note: 'no fabrication risk' },
  ],
});

type Scenario = { id: string; title: string; council: CouncilThinkingUI; steps?: ChatProgressStep[] };

export const QA_SCENARIOS: Scenario[] = [
  {
    id: 'council-clean',
    title: 'Clean ship — unanimous, no dissent, no grounding',
    council: baseCouncil(),
  },
  {
    id: 'council-dissent',
    title: 'Minority view — a split panel that surfaced a dissent (should read CALM, not error)',
    council: {
      ...baseCouncil(), agreement: 0.72,
      dissent: {
        dissentStrength: 0.28,
        dissentingMembers: [
          { memberName: 'local:qwen2.5:7b', weight: 0.28, confidence: 0.9, concerns: ['unsupported latency claim', 'no source for the 40% figure'] },
        ],
      },
    },
  },
  {
    id: 'council-grounding',
    title: 'Grounding row — panel leaned on fetched context (advisory, calm)',
    council: {
      ...baseCouncil(),
      provenance: { total: 5, groundedness: 0.6, hasDisputed: false, verdict: 'grounded',
        counts: { used: 3, unused: 1, considered: 1, unavailable: 0, disputed: 0 } },
    },
  },
  {
    id: 'council-thin',
    title: 'Thinly grounded — most fetched context went unused (advisory, no alarm)',
    council: {
      ...baseCouncil(),
      provenance: { total: 4, groundedness: 0.25, hasDisputed: false, verdict: 'thin',
        counts: { used: 1, unused: 2, considered: 1, unavailable: 0, disputed: 0 } },
    },
  },
  {
    id: 'council-full',
    title: 'Dissent + grounding together (the dense, real-world case)',
    council: {
      ...baseCouncil(), agreement: 0.7,
      dissent: { dissentStrength: 0.3, dissentingMembers: [
        { memberName: 'local:deepseek-r1:8b', weight: 0.3, confidence: 0.88, concerns: ['wants a second source'] },
      ] },
      provenance: { total: 6, groundedness: 0.5, hasDisputed: false, verdict: 'grounded',
        counts: { used: 3, unused: 2, considered: 1, unavailable: 0, disputed: 0 } },
    },
  },
];

function pickScenario(): Scenario {
  const id = new URLSearchParams(location.search).get('scenario') ?? 'council-full';
  return QA_SCENARIOS.find((s) => s.id === id) ?? QA_SCENARIOS[QA_SCENARIOS.length - 1];
}

function Harness() {
  const sc = pickScenario();
  return (
    <div style={{ minHeight: '100vh', padding: '40px 0', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 'min(680px, 92vw)' }} data-testid="qa-scenario" data-scenario={sc.id}>
        <p
          className="mb-4 text-[11px] uppercase tracking-[0.14em] text-[color:var(--chat-muted)]"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          {sc.id}
        </p>
        <h1 className="mb-6 text-[15px] font-medium text-[color:var(--chat-strong)]">{sc.title}</h1>
        {/* The real component, settled (live=false) so it renders the expanded settled tree. */}
        <ProcessTree steps={sc.steps ?? baseSteps} council={sc.council} live={false} durationMs={4200} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('qa-root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
