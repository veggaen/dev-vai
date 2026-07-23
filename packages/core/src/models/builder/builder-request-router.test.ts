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

  it('treats an explicitly named project file as a strong edit signal', () => {
    // Live failure: only 1 visual keyword — fell through the visual gate.
    const prompt = 'In components/Navbar.tsx, change the navbar brand text "MPM" to "MPM Pro". Keep everything else in the file exactly the same.';

    expect(routeBuilderRequest({
      input: prompt,
      activeMode: 'builder',
      hasActiveSandboxContext: true,
      snapshotPaths: ['components/Navbar.tsx', 'src/app/page.tsx'],
    })).toMatchObject({
      kind: 'active-sandbox-edit',
      shouldGenerateFreshBuild: false,
      shouldPatchActiveSandbox: true,
    });
  });

  it('asks for context when a named-file edit has no snapshots yet', () => {
    const prompt = 'Update src/lib/api.ts to add a retry helper.';

    expect(routeBuilderRequest({
      input: prompt,
      activeMode: 'builder',
      hasActiveSandboxContext: true,
      snapshotPaths: [],
    })).toMatchObject({
      kind: 'active-sandbox-needs-context',
      shouldPatchActiveSandbox: false,
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

  it('routes runtime repair and modernization language into the active project', () => {
    const prompt = 'Repair this observed Node 22 startup failure and implement the smallest durable modernization.';

    expect(routeBuilderRequest({
      input: prompt,
      activeMode: 'builder',
      hasActiveSandboxContext: true,
      snapshotPaths: ['package.json', 'src/App.js'],
    })).toMatchObject({
      kind: 'active-project-iteration',
      shouldGenerateFreshBuild: false,
      shouldPatchActiveSandbox: true,
    });
  });
});
