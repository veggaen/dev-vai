import { describe, expect, it } from 'vitest';
import { pickSandboxContextPaths } from './sandbox-context.js';

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

  it('prioritizes auth-related files for authentication prompts', () => {
    const selected = pickSandboxContextPaths(files, 'Add authentication to this app and keep the current preview working.');

    expect(selected).toEqual([
      'package.json',
      'src/app/layout.tsx',
      'middleware.ts',
      'src/lib/auth.ts',
    ]);
  });
});
