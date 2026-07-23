import { describe, expect, it } from 'vitest';
import {
  isBuildExecutionMode,
  isExplicitBuildExecutionRequest,
  classifyAgentBuildIntent,
  requiresBuildExecution,
  shouldBypassPreliminaryAnswerDraft,
  shouldBlockFreshBuildFallback,
} from './build-execution-intent.js';

describe('build-execution-intent', () => {
  it('treats agent and builder as build execution modes', () => {
    expect(isBuildExecutionMode('agent')).toBe(true);
    expect(isBuildExecutionMode('builder')).toBe(true);
    expect(isBuildExecutionMode('chat')).toBe(false);
  });

  it('detects explicit ship-now build requests like the Tinder clone prompt', () => {
    const prompt = 'Build a 100% accurate Tinder clone — card stack swipe UI. React + Vite. Ship complete runnable files.';
    expect(isExplicitBuildExecutionRequest(prompt)).toBe(true);
  });

  it('does not treat planning-only hardware prompts as build execution', () => {
    const prompt = 'Design a wall-mounted humidity sensor product with enclosure, BOM, and certification path.';
    expect(isExplicitBuildExecutionRequest(prompt)).toBe(false);
  });

  it('executes a targeted active-project edit without requiring new-app wording', () => {
    const prompt = 'change the "Participate in a decentralized ecosystem" text';
    expect(isExplicitBuildExecutionRequest(prompt)).toBe(false);
    expect(requiresBuildExecution(true, prompt, true)).toBe(true);
    expect(requiresBuildExecution(true, prompt, false)).toBe(false);
    expect(requiresBuildExecution(false, prompt, true)).toBe(false);
  });

  it('treats an imperative project repair as execution, not debugging advice', () => {
    const prompt = 'Repair the observed Node 22 startup failure in the attached project.';
    expect(isExplicitBuildExecutionRequest(prompt)).toBe(true);
    expect(requiresBuildExecution(true, prompt, false)).toBe(true);
  });

  it('bypasses an unrelated answer draft for builder execution containing a local URL', () => {
    const prompt = 'Set up a Hardhat local-chain project at http://127.0.0.1:8545 and add the files now.';
    expect(shouldBypassPreliminaryAnswerDraft(true, prompt, true)).toBe(true);
    expect(isExplicitBuildExecutionRequest(prompt)).toBe(true);
    expect(shouldBypassPreliminaryAnswerDraft(true, prompt, false)).toBe(true);
    expect(shouldBypassPreliminaryAnswerDraft(false, prompt, true)).toBe(false);
    expect(shouldBypassPreliminaryAnswerDraft(true, 'What is HTTP?', false)).toBe(false);
  });

  it('blocks a fresh-app fallback when a durable project folder could not be resolved', () => {
    expect(shouldBlockFreshBuildFallback('C:\\Users\\v3gga\\Documents\\DEV_MPM\\mpm-frontend', false)).toBe(true);
    expect(shouldBlockFreshBuildFallback('C:\\Users\\v3gga\\Documents\\DEV_MPM\\mpm-frontend', true)).toBe(false);
    expect(shouldBlockFreshBuildFallback(null, false)).toBe(false);
  });
});

describe('classifyAgentBuildIntent (anti-hijack)', () => {
  it('classifies a clear ship-now request as build', () => {
    expect(classifyAgentBuildIntent('Build a Tinder clone. React + Vite. Ship complete runnable files.')).toBe('build');
    expect(classifyAgentBuildIntent('make me a dashboard app')).toBe('build');
  });

  it('classifies a plain question as answer (never builds)', () => {
    expect(classifyAgentBuildIntent('what is the price of btc right now')).toBe('answer');
    expect(classifyAgentBuildIntent('tell me a story about a dragon')).toBe('answer');
    expect(classifyAgentBuildIntent('explain how the council works')).toBe('answer');
  });

  it('classifies PROSE/discussion turns as answer — regression for the builder-hijack live bug', () => {
    // These exact prompts were hijacked into the codegen arm in agent mode and answered with
    // "I attempted this build but the result did not meet the quality bar (only 3 CSS rules)".
    // They are conversational ("tell me about…"), not interrogative, so the old factual-only
    // guard missed them. The 3-band classifier must call them 'answer'.
    expect(classifyAgentBuildIntent('tell me about your engine')).toBe('answer');
    expect(classifyAgentBuildIntent(
      'try instead to tell me about life before the cloud, and how it might have been more capital intense and in need of good prediction and for experimenting was limited',
    )).toBe('answer');
    expect(classifyAgentBuildIntent('describe how things used to work before computers')).toBe('answer');
    expect(classifyAgentBuildIntent('write me a short reflection on creativity')).toBe('answer');
  });

  it('classifies build-ish-but-unclear asks as ambiguous (so agent mode confirms)', () => {
    // These are the real hijack cases: a verb but no clear app target, or a soft "improve X".
    expect(classifyAgentBuildIntent('can you make this more useful and meaningful')).toBe('ambiguous');
    expect(classifyAgentBuildIntent('improve the timeline ui')).toBe('ambiguous');
    expect(classifyAgentBuildIntent('add more data to help understand')).toBe('ambiguous');
    expect(classifyAgentBuildIntent('Repair the observed Node 22 startup failure in the attached project.')).toBe('build');
  });

  it('does not flag a clearly conversational ask as ambiguous even with a stray verb', () => {
    expect(classifyAgentBuildIntent('explain how I would build a price widget')).toBe('answer');
  });
});
