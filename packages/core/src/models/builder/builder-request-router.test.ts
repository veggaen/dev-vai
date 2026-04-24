import { describe, expect, it } from 'vitest';
import { isFreshBuildRequestForEmptySandbox, routeBuilderRequest } from './builder-request-router.js';

describe('builder request router', () => {
  it('routes first runnable active-sandbox prompts to fresh build when no snapshots exist', () => {
    const prompt = 'Build the first runnable version now. Create a compact shared shopping app. The preview must visibly include Shared Shopping List and seed mock data.';

    expect(isFreshBuildRequestForEmptySandbox(prompt, prompt.toLowerCase(), [])).toBe(true);
    expect(routeBuilderRequest({
      input: prompt,
      activeMode: 'builder',
      hasActiveSandboxContext: true,
      snapshotPaths: [],
    })).toMatchObject({
      kind: 'fresh-build-empty-sandbox',
      shouldGenerateFreshBuild: true,
      shouldPatchActiveSandbox: false,
    });
  });

  it('does not treat true current-app edits as fresh builds', () => {
    const prompt = 'Keep the same active app and change the CTA button to hot pink with kinetic animation.';

    expect(routeBuilderRequest({
      input: prompt,
      activeMode: 'builder',
      hasActiveSandboxContext: true,
      snapshotPaths: ['src/App.tsx', 'src/styles.css'],
    })).toMatchObject({
      kind: 'active-sandbox-edit',
      shouldGenerateFreshBuild: false,
      shouldPatchActiveSandbox: true,
    });
  });

  it('asks for context only for edit-like prompts against an empty active sandbox', () => {
    const prompt = 'Make the hero heading animated and change the background color.';

    expect(routeBuilderRequest({
      input: prompt,
      activeMode: 'builder',
      hasActiveSandboxContext: true,
      snapshotPaths: [],
    })).toMatchObject({
      kind: 'active-sandbox-needs-context',
      shouldGenerateFreshBuild: false,
      shouldPatchActiveSandbox: false,
    });
  });
});
