import { describe, expect, it } from 'vitest';
import { resolveAutoSandboxIntent, resolveSendTimeWorkIntent } from './auto-sandbox-intent.js';

describe('resolveAutoSandboxIntent', () => {
  it('treats explicit chat build requests as actionable file output', () => {
    const result = resolveAutoSandboxIntent({
      userPrompt: 'Build me a dashboard app I can preview.',
      mode: 'chat',
      hasActiveProject: false,
      hasPackageJsonOutput: true,
    });

    expect(result.explicitChatBuildRequest).toBe(true);
    expect(result.canAutoApplyFiles).toBe(true);
    expect(result.canAutoApplyDeploy).toBe(true);
  });

  it('treats active-project upgrade prompts in chat as in-place edit requests', () => {
    const result = resolveAutoSandboxIntent({
      userPrompt: 'Upgrade the current app with a new analytics rail and keep the existing preview working.',
      mode: 'chat',
      hasActiveProject: true,
      hasPackageJsonOutput: true,
    });

    expect(result.explicitChatEditRequest).toBe(true);
    expect(result.canAutoApplyFiles).toBe(true);
    expect(result.forceFreshProject).toBe(false);
  });

  it('does not treat ordinary chat as a build action', () => {
    const result = resolveAutoSandboxIntent({
      userPrompt: 'Explain what changed in React 19.',
      mode: 'chat',
      hasActiveProject: false,
      hasPackageJsonOutput: false,
    });

    expect(result.explicitChatBuildRequest).toBe(false);
    expect(result.explicitChatEditRequest).toBe(false);
    expect(result.canAutoApplyFiles).toBe(false);
    expect(result.shouldReportMissingAction).toBe(false);
  });

  it('keeps starter-template detection explicit in chat mode', () => {
    const result = resolveAutoSandboxIntent({
      userPrompt: 'Set up a fresh Next.js app for me.',
      mode: 'chat',
      hasActiveProject: false,
      hasPackageJsonOutput: false,
    });

    expect(result.explicitStarterRequest).toBe(true);
  });

  it('keeps builder mode on fresh rebuilds when package output changes', () => {
    const result = resolveAutoSandboxIntent({
      userPrompt: 'Build a fresh app from scratch.',
      mode: 'builder',
      hasActiveProject: true,
      hasPackageJsonOutput: true,
    });

    expect(result.isBuildMode).toBe(true);
    expect(result.forceFreshProject).toBe(true);
  });

  it('primes builder UX for active-project chat edits before the response finishes', () => {
    const result = resolveSendTimeWorkIntent({
      userPrompt: 'Improve the current app and add a cleaner analytics rail.',
      mode: 'chat',
      hasActiveProject: true,
    });

    expect(result.intent).toBe('edit');
    expect(result.shouldPrimeBuilder).toBe(true);
    expect(result.buildStatusMessage).toContain('targeted updates');
    expect(result.requestSystemPrompt).toContain('changed files');
  });

  it('keeps ordinary chat replies in text-only mode at send time', () => {
    const result = resolveSendTimeWorkIntent({
      userPrompt: 'What changed in TypeScript 5.7?',
      mode: 'chat',
      hasActiveProject: false,
    });

    expect(result.intent).toBe('none');
    expect(result.shouldPrimeBuilder).toBe(false);
    expect(result.requestSystemPrompt).toBeUndefined();
  });

  it('treats clean starter requests as send-time app work', () => {
    const result = resolveSendTimeWorkIntent({
      userPrompt: 'Set up a fresh Next.js app for me.',
      mode: 'chat',
      hasActiveProject: false,
    });

    expect(result.intent).toBe('build');
    expect(result.shouldPrimeBuilder).toBe(true);
    expect(result.buildStatusMessage).toContain('starter preview');
    expect(result.requestSystemPrompt).toContain('template markers');
  });

  it('keeps follow-up turns sticky in builder mode when a live project is already attached', () => {
    const result = resolveSendTimeWorkIntent({
      userPrompt: 'Make the spacing tighter and improve the hero copy.',
      mode: 'builder',
      hasActiveProject: true,
    });

    expect(result.intent).toBe('edit');
    expect(result.shouldPrimeBuilder).toBe(true);
    expect(result.requestSystemPrompt).toContain('continues an active builder session');
    expect(result.requestSystemPrompt).toContain('changed files');
  });
});