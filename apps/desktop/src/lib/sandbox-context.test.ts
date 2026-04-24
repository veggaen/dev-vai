import { describe, expect, it } from 'vitest';
import { pickSandboxContextPaths, shouldAttachSandboxContext } from './sandbox-context.js';

describe('pickSandboxContextPaths', () => {
  const files = [
    'package.json',
    'src/App.tsx',
    'src/main.tsx',
    'src/styles.css',
    'src/app/layout.tsx',
    'src/app/page.tsx',
    'middleware.ts',
    'src/lib/auth.ts',
    'pnpm-lock.yaml',
  ];

  it('prioritizes visual entry files for landing-page polish prompts', () => {
    const selected = pickSandboxContextPaths(files, 'Polish the landing page spacing and typography.');

    expect(selected).toEqual([
      'src/app/page.tsx',
      'package.json',
      'src/App.tsx',
      'src/styles.css',
    ]);
  });

  it('prioritizes app and style snapshots for motion polish prompts', () => {
    const selected = pickSandboxContextPaths(
      files,
      'Add kinetic text animation to the hero heading and subtle body entrance animations.',
    );

    expect(selected).toEqual([
      'src/app/page.tsx',
      'package.json',
      'src/App.tsx',
      'src/styles.css',
    ]);
  });

  it('prioritizes auth-related files for authentication prompts', () => {
    const selected = pickSandboxContextPaths(files, 'Add authentication to this app and keep the current preview working.');

    expect(selected).toEqual([
      'package.json',
      'src/app/layout.tsx',
      'middleware.ts',
      'src/lib/auth.ts',
    ]);
  });

  it('attaches sandbox context for active-project edit requests', () => {
    expect(shouldAttachSandboxContext('Polish this app layout and tighten the spacing on the landing page.')).toBe(true);
    expect(shouldAttachSandboxContext('Fix the bug in src/App.tsx and keep the live preview working.')).toBe(true);
    expect(shouldAttachSandboxContext('Debug the current preview and explain why localhost:4173 is blank.')).toBe(true);
    expect(shouldAttachSandboxContext('Add kinetic text animation to the hero heading and subtle body entrance animations.')).toBe(true);
  });

  it('does not attach sandbox context for generic knowledge questions', () => {
    expect(shouldAttachSandboxContext('What is Redis and when should I use it?')).toBe(false);
    expect(shouldAttachSandboxContext('Explain the difference between OAuth and session auth.')).toBe(false);
  });
});
