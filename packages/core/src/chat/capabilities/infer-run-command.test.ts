import { describe, it, expect } from 'vitest';
import { inferRunCommand, inferKind, type ProjectProbe } from './infer-run-command.js';

const probe = (scripts: Record<string, string> | null): ProjectProbe => ({ scripts, hasPackageJson: scripts !== null });

describe('inferKind', () => {
  it('classifies the verification kind from the question', () => {
    expect(inferKind('do the tests pass?')).toBe('test');
    expect(inferKind('does it typecheck?')).toBe('typecheck');
    expect(inferKind('is the build green?')).toBe('build');
    expect(inferKind('run the lint')).toBe('lint');
  });
  it('defaults to test for a generic "does it pass"', () => {
    expect(inferKind('does it pass')).toBe('test');
  });
});

describe('inferRunCommand', () => {
  it('prefers the project package.json script (npm test)', () => {
    const c = inferRunCommand('do the tests pass?', probe({ test: 'vitest run' }));
    expect(c).toEqual({ command: 'npm', args: ['test'], kind: 'test', reason: expect.stringMatching(/test/) });
  });

  it('uses npm run <script> for non-test scripts', () => {
    const c = inferRunCommand('does it typecheck?', probe({ typecheck: 'tsc --noEmit' }));
    expect(c?.command).toBe('npm');
    expect(c?.args).toEqual(['run', 'typecheck']);
  });

  it('respects the chosen package manager', () => {
    const c = inferRunCommand('run the lint', probe({ lint: 'eslint .' }), 'pnpm');
    expect(c?.command).toBe('pnpm');
    expect(c?.args).toEqual(['run', 'lint']);
  });

  it('falls back to npx tsc for typecheck when there is no script', () => {
    const c = inferRunCommand('does it typecheck?', probe({}));
    expect(c).toEqual({ command: 'npx', args: ['tsc', '--noEmit'], kind: 'typecheck', reason: expect.any(String) });
  });

  it('returns null for tests when there is no test script (does not guess a bare runner)', () => {
    expect(inferRunCommand('do the tests pass?', probe({}))).toBeNull();
    expect(inferRunCommand('do the tests pass?', probe(null))).toBeNull();
  });

  it('returns null when there is no package.json and no direct fallback applies', () => {
    expect(inferRunCommand('is the build green?', probe(null))).toBeNull();
  });
});
