/**
 * Unit tests for the file-extractor utility.
 *
 * Tests the AI-response parsing pipeline that extracts code file blocks
 * from markdown responses (used by useAutoSandbox to write files).
 */
import { describe, it, expect } from 'vitest';
import {
  extractFilesFromMarkdown,
  hasFileBlocks,
  hasPackageJson,
  extractProjectName,
} from '../../../apps/desktop/src/lib/file-extractor.js';

describe('extractFilesFromMarkdown', () => {
  it('extracts a single file block with double-quote title', () => {
    const md = '```tsx title="src/App.tsx"\nexport function App() { return <div>Hi</div>; }\n```';
    const files = extractFilesFromMarkdown(md);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/App.tsx');
    expect(files[0].language).toBe('tsx');
    expect(files[0].content).toContain('App');
  });

  it('extracts a single file block with single-quote title', () => {
    const md = "```ts title='src/index.ts'\nconsole.log('hello');\n```";
    const files = extractFilesFromMarkdown(md);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/index.ts');
  });

  it('extracts multiple file blocks', () => {
    const md = [
      '```json title="package.json"',
      '{ "name": "my-app" }',
      '```',
      '',
      'Some explanation text...',
      '',
      '```tsx title="src/App.tsx"',
      'export function App() { return <div />; }',
      '```',
      '',
      '```css title="src/index.css"',
      'body { margin: 0; }',
      '```',
    ].join('\n');

    const files = extractFilesFromMarkdown(md);
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.path)).toEqual([
      'package.json',
      'src/App.tsx',
      'src/index.css',
    ]);
  });

  it('deduplicates files — later definition wins', () => {
    const md = [
      '```tsx title="src/App.tsx"',
      'export function App() { return <div>v1</div>; }',
      '```',
      '',
      '```tsx title="src/App.tsx"',
      'export function App() { return <div>v2</div>; }',
      '```',
    ].join('\n');

    const files = extractFilesFromMarkdown(md);
    expect(files).toHaveLength(1);
    expect(files[0].content).toContain('v2');
  });

  it('returns empty array when no file blocks exist', () => {
    const md = '```ts\nconsole.log("no title")\n```';
    expect(extractFilesFromMarkdown(md)).toEqual([]);
  });

  it('extracts code blocks without a language identifier', () => {
    const md = '``` title="README.md"\n# Hello\n```';
    const files = extractFilesFromMarkdown(md);

    expect(files).toEqual([
      { path: 'README.md', content: '# Hello', language: 'text' },
    ]);
  });

  it('supports alternate path attributes and normalizes common path variants', () => {
    const md = [
      '```tsx path="./src/App.tsx"',
      'export function App() { return <div />; }',
      '```',
      '',
      '```css filename="\\src\\index.css"',
      'body { margin: 0; }',
      '```',
      '',
      '```json file="/package.json"',
      '{ "name": "my-app" }',
      '```',
    ].join('\n');

    const files = extractFilesFromMarkdown(md);

    expect(files.map((f) => f.path)).toEqual([
      'src/App.tsx',
      'src/index.css',
      'package.json',
    ]);
  });

  it('extracts file blocks when title appears after other fence attributes', () => {
    const md = '```tsx theme="night" title="src/App.tsx"\nexport const App = () => null;\n```';
    const files = extractFilesFromMarkdown(md);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/App.tsx');
    expect(files[0].language).toBe('tsx');
  });

  it('ignores code blocks that only have language (no title)', () => {
    const md = '```typescript\nconst x = 1;\n```';
    expect(extractFilesFromMarkdown(md)).toEqual([]);
  });
});

describe('hasFileBlocks', () => {
  it('returns true when file blocks exist', () => {
    expect(hasFileBlocks('```tsx title="src/App.tsx"\ncode\n```')).toBe(true);
  });

  it('returns true for alternate path attributes', () => {
    expect(hasFileBlocks('``` path="README.md"\n# Hello\n```')).toBe(true);
  });

  it('returns false for plain code blocks', () => {
    expect(hasFileBlocks('```tsx\ncode\n```')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasFileBlocks('')).toBe(false);
  });
});

describe('hasPackageJson', () => {
  it('returns true when package.json is in the file list', () => {
    const files = [
      { path: 'package.json', content: '{}', language: 'json' },
      { path: 'src/App.tsx', content: '', language: 'tsx' },
    ];
    expect(hasPackageJson(files)).toBe(true);
  });

  it('returns true for nested package.json', () => {
    const files = [
      { path: 'packages/web/package.json', content: '{}', language: 'json' },
    ];
    expect(hasPackageJson(files)).toBe(true);
  });

  it('returns true for normalized root package.json paths', () => {
    const files = [
      { path: './package.json', content: '{}', language: 'json' },
    ];
    expect(hasPackageJson(files)).toBe(true);
  });

  it('returns false when no package.json', () => {
    const files = [
      { path: 'src/index.ts', content: '', language: 'ts' },
    ];
    expect(hasPackageJson(files)).toBe(false);
  });
});

describe('extractProjectName', () => {
  it('extracts name from package.json content', () => {
    const files = [
      { path: 'package.json', content: '{"name": "my-cool-app", "version": "1.0.0"}', language: 'json' },
    ];
    expect(extractProjectName(files)).toBe('my-cool-app');
  });

  it('extracts name from normalized package.json paths', () => {
    const files = [
      { path: '/package.json', content: '{"name": "normalized-app"}', language: 'json' },
    ];
    expect(extractProjectName(files)).toBe('normalized-app');
  });

  it('returns null when no package.json', () => {
    const files = [{ path: 'index.ts', content: '', language: 'ts' }];
    expect(extractProjectName(files)).toBeNull();
  });

  it('returns null when package.json has no name field', () => {
    const files = [
      { path: 'package.json', content: '{"version": "1.0.0"}', language: 'json' },
    ];
    expect(extractProjectName(files)).toBeNull();
  });

  it('returns null when package.json has invalid JSON', () => {
    const files = [
      { path: 'package.json', content: 'not valid json', language: 'json' },
    ];
    expect(extractProjectName(files)).toBeNull();
  });
});
