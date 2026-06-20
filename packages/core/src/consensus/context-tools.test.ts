import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCouncilContextTools, resolveSandboxed } from './context-tools.js';

/**
 * context-tools — the council pull-model surface. The security boundary (no sandbox escape)
 * and the bounds (no context-window blowups) are the load-bearing guarantees; they get the
 * most scrutiny here.
 */

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'council-ctx-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'a.ts'), 'export const FOO = 1;\nexport const BAR = 2;\n// needle here\n');
  writeFileSync(path.join(root, 'src', 'b.ts'), 'const x = 3;\nconst needle = 4;\n');
  writeFileSync(path.join(root, 'README.md'), '# Title\nsome docs\n');
  writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'needle in node_modules should be ignored\n');
  // A secret file OUTSIDE the sandbox, to prove escape is blocked.
  writeFileSync(path.join(root, '..', 'council-ctx-secret.txt'), 'TOP SECRET\n');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  try { rmSync(path.join(root, '..', 'council-ctx-secret.txt'), { force: true }); } catch { /* ignore */ }
});

describe('resolveSandboxed — the security boundary', () => {
  it('resolves a normal repo-relative path', () => {
    expect(resolveSandboxed(root, 'src/a.ts')).toBe(path.resolve(root, 'src/a.ts'));
  });
  it('rejects ../ traversal that escapes root', () => {
    expect(resolveSandboxed(root, '../council-ctx-secret.txt')).toBeNull();
    expect(resolveSandboxed(root, 'src/../../council-ctx-secret.txt')).toBeNull();
  });
  it('rejects absolute paths', () => {
    expect(resolveSandboxed(root, path.resolve(root, '..', 'council-ctx-secret.txt'))).toBeNull();
    expect(resolveSandboxed(root, '/etc/passwd')).toBeNull();
  });
  it('rejects empty / non-string', () => {
    expect(resolveSandboxed(root, '')).toBeNull();
    // @ts-expect-error — defensive against bad runtime input
    expect(resolveSandboxed(root, undefined)).toBeNull();
  });
});

describe('readFile', () => {
  it('reads a whole small file', () => {
    const tools = createCouncilContextTools(root);
    const r = tools.readFile('src/a.ts');
    expect(r.found).toBe(true);
    expect(r.content).toContain('FOO');
    expect(r.totalLines).toBe(4);
  });

  it('reads a bounded line range', () => {
    const tools = createCouncilContextTools(root);
    const r = tools.readFile('src/a.ts', { start: 2, end: 2 });
    expect(r.found).toBe(true);
    expect(r.content).toBe('export const BAR = 2;');
    expect(r.range).toEqual({ start: 2, end: 2 });
  });

  it('refuses to read outside the sandbox', () => {
    const tools = createCouncilContextTools(root);
    const r = tools.readFile('../council-ctx-secret.txt');
    expect(r.found).toBe(false);
    expect(r.content).not.toContain('SECRET');
  });

  it('refuses node_modules', () => {
    const tools = createCouncilContextTools(root);
    const r = tools.readFile('node_modules/pkg/index.js');
    expect(r.found).toBe(false);
  });

  it('caps the number of lines returned', () => {
    const tools = createCouncilContextTools(root, { maxReadLines: 1 });
    const r = tools.readFile('src/a.ts');
    expect(r.content.split('\n')).toHaveLength(1);
  });

  it('reports not-found for missing files', () => {
    const tools = createCouncilContextTools(root);
    expect(tools.readFile('src/nope.ts').found).toBe(false);
  });
});

describe('grep', () => {
  it('finds matches with file + line, skipping node_modules', () => {
    const tools = createCouncilContextTools(root);
    const r = tools.grep('needle');
    const paths = r.hits.map((h) => h.path);
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.ts');
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('honors the file glob', () => {
    const tools = createCouncilContextTools(root);
    const r = tools.grep('needle', 'src/*.ts');
    expect(r.hits.every((h) => h.path.startsWith('src/'))).toBe(true);
  });

  it('returns nothing for an invalid regex instead of throwing', () => {
    const tools = createCouncilContextTools(root);
    expect(() => tools.grep('([')).not.toThrow();
    expect(tools.grep('([').hits).toEqual([]);
  });

  it('caps and flags truncation', () => {
    const tools = createCouncilContextTools(root, { maxGrepHits: 1 });
    const r = tools.grep('needle');
    expect(r.hits).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });
});

describe('listFiles', () => {
  it('lists matching files, skipping ignored dirs', () => {
    const tools = createCouncilContextTools(root);
    const r = tools.listFiles('**/*.ts');
    expect(r.files).toContain('src/a.ts');
    expect(r.files).toContain('src/b.ts');
    expect(r.files.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('matches a markdown glob', () => {
    const tools = createCouncilContextTools(root);
    const r = tools.listFiles('**/*.md');
    expect(r.files).toEqual(['README.md']);
  });
});
