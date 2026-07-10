import { describe, expect, it } from 'vitest';
import { resolveWorkspaceEditIntent } from './chat-edit-intent.js';

const FILES = new Set([
  'docs/setup.md',
  'src/App.tsx',
  'src/components/Button.tsx',
  'README.md',
  'package.json',
]);

describe('resolveWorkspaceEditIntent', () => {
  it('routes an explicit path + edit verb', () => {
    const r = resolveWorkspaceEditIntent(
      'Open docs/setup.md and change the top heading "# Setup" to "# Welcome to the Setup".',
      FILES,
    );
    expect(r?.rel).toBe('docs/setup.md');
  });

  it('resolves a unique basename ("setup.md")', () => {
    const r = resolveWorkspaceEditIntent('please update setup.md with a welcome heading', FILES);
    expect(r?.rel).toBe('docs/setup.md');
  });

  it('handles backslash paths from Windows-minded users', () => {
    const r = resolveWorkspaceEditIntent('fix the typo in docs\\setup.md', FILES);
    expect(r?.rel).toBe('docs/setup.md');
  });

  it('falls through without an edit verb (questions stay chat)', () => {
    expect(resolveWorkspaceEditIntent('what does docs/setup.md say about env vars?', FILES)).toBeNull();
  });

  it('falls through when no real file is named', () => {
    expect(resolveWorkspaceEditIntent('change the color of the header to blue', FILES)).toBeNull();
  });

  it('falls through on ambiguous basenames', () => {
    const files = new Set(['a/config.ts', 'b/config.ts']);
    expect(resolveWorkspaceEditIntent('update config.ts', files)).toBeNull();
  });

  it('ignores version-like tokens that are not files', () => {
    expect(resolveWorkspaceEditIntent('update react to 18.3.1', FILES)).toBeNull();
  });
});
