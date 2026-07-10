import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReasoningFlow } from '../components/chat/ReasoningFlow.js';
import { TurnProcessSection } from '../components/chat/TurnProcessSection.js';
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
    label: 'Deliberating',
    status: 'done',
    detail: 'Panel of 3 reviewed the draft.',
    durationMs: 6100,
    councilMembers: council.members,
  } as unknown as ChatProgressStep,
  { stage: 'vai-draft', label: 'Drafting', status: 'done', detail: 'Composed a 4-point comparison with a recommendation.', durationMs: 1400 },
  { stage: 'quality-check', label: 'Approval gate', status: 'done', detail: 'Verification passed', durationMs: 260 },
] as unknown as ChatProgressStep[];

// A long, multi-round turn so the zoom/pan + minimap + semantic tiers are demonstrable.
const longSteps: ChatProgressStep[] = [
  { stage: 'understand', label: 'Read the intent', status: 'done', detail: 'Multi-part build request.', durationMs: 300 },
  { stage: 'search', label: 'Gather evidence', status: 'done', detail: 'Fetched 5 sources.', durationMs: 3100 },
  { stage: 'reason', label: 'Reason', status: 'done', detail: 'Planned a 4-file change.', durationMs: 900 },
  { stage: 'council-vai-round-1', label: 'Deliberating', status: 'done', detail: 'Round 1.', durationMs: 6100, councilMembers: council.members } as unknown as ChatProgressStep,
  { stage: 'vai-draft', label: 'Drafting', status: 'done', detail: 'First draft.', durationMs: 1400 },
  { stage: 'quality-check', label: 'Verify', status: 'done', detail: 'fail: missed a case', durationMs: 400 },
  { stage: 'vai-redraft', label: 'Revising', status: 'done', detail: 'Second pass.', durationMs: 1200 },
  { stage: 'council-vai-round-2', label: 'Deliberating', status: 'done', detail: 'Round 2.', durationMs: 5200, councilMembers: council.members } as unknown as ChatProgressStep,
  { stage: 'build-apply', label: 'Build', status: 'done', detail: 'Applied patch.', durationMs: 2600 },
  { stage: 'preview', label: 'Build', status: 'done', detail: 'Preview rendered.', durationMs: 1800 },
  { stage: 'quality-check', label: 'Verify', status: 'done', detail: 'Verification passed', durationMs: 260 },
] as unknown as ChatProgressStep[];

const softwareSteps: ChatProgressStep[] = [
  {
    stage: 'multi-intent',
    label: 'Separated the request into the product goal and the implementation constraints',
    status: 'done',
    detail: 'The result must be runnable, review-first, and must preserve the existing Next.js app.',
    durationMs: 180,
    processLog: [
      { kind: 'thought', label: 'Success condition', body: 'A local-chain lane can compile, test, and deploy without changing Sepolia or the app UI.' },
      { kind: 'thought', label: 'Safety boundary', body: 'Environment files, lockfiles, deployed addresses, and private keys remain untouched.' },
    ],
  },
  {
    stage: 'workspace',
    label: 'Read the relevant project files in mpm-frontend',
    status: 'done',
    detail: 'Read package.json plus two read-only references: MMM_Unified.sol and DEPLOYMENT_PARAMS.md.',
    durationMs: 420,
    processLog: [
      { kind: 'read', label: 'Opened package.json', body: 'Captured the existing scripts and dependencies so the proposal can preserve every key.' },
      { kind: 'read', label: 'Inspected MMM_Unified.sol', body: 'Located the constructor, public constants, contribution entry point, and premint behavior.' },
      { kind: 'read', label: 'Inspected DEPLOYMENT_PARAMS.md', body: 'Captured the seven development phases and local deployment parameters.' },
    ],
  },
  {
    stage: 'council-architect',
    label: 'Planned an isolated Hardhat workspace under chain/',
    status: 'done',
    detail: 'The root app remains CommonJS-compatible; all chain tooling runs through npm --prefix chain.',
    durationMs: 760,
  },
  {
    stage: 'council-code',
    label: 'Created the six-file review proposal',
    status: 'done',
    detail: 'Added chain config, an import-only Solidity entry, an Ignition module, tests, and root chain scripts.',
    durationMs: 18_200,
    processLog: [
      { kind: 'artifact', label: 'Prepared chain/hardhat.config.ts', body: 'Solidity 0.8.24 and localhost chain id 31337.' },
      { kind: 'artifact', label: 'Prepared chain/test/MMM_Unified.ts', body: 'Constructor constants, premint, minimum contribution, and below-minimum rejection.' },
    ],
  },
  {
    stage: 'council-review',
    label: 'Council reviewed the proposal against the requested scope',
    status: 'done',
    detail: 'Review found five blocking API and constructor issues that required another pass.',
    durationMs: 7_100,
    councilMembers: [
      { name: 'Qwen code reviewer', verdict: 'needs-work', confidence: 0.86, note: 'Correct the Ignition constructor arguments and preserve ev