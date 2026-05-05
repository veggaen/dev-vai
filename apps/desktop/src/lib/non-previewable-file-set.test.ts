import { describe, expect, it } from 'vitest';
import type { ExtractedFile } from './file-extractor.js';
import { isNonPreviewableCodeFileSet } from './non-previewable-file-set.js';

function file(path: string, content = ''): ExtractedFile {
  return { path, content, language: 'text' };
}

describe('isNonPreviewableCodeFileSet', () => {
  it('treats browser logger packages as non-previewable code artifacts', () => {
    const files = [
      file('package.json', JSON.stringify({
        name: 'browser-child-logger',
        type: 'module',
        exports: { '.': './src/index.ts' },
      }, null, 2)),
      file('src/index.ts', 'export function createLogger() {}'),
      file('README.md', '# Browser Child Logger'),
    ];

    expect(isNonPreviewableCodeFileSet(files)).toBe(true);
  });

  it('keeps regular vite app outputs previewable', () => {
    const files = [
      file('package.json', JSON.stringify({
        name: 'previewable-app',
        scripts: { dev: 'vite' },
      }, null, 2)),
      file('index.html', '<div id="root"></div>'),
      file('src/main.tsx', 'import "./styles.css";'),
      file('src/App.tsx', 'export default function App() { return <main>Hello</main>; }'),
    ];

    expect(isNonPreviewableCodeFileSet(files)).toBe(false);
  });

  it('treats vscode theme extensions as non-previewable', () => {
    const files = [
      file('package.json', JSON.stringify({
        name: 'theme-ext',
        contributes: { themes: [{ label: 'Theme', path: './themes/theme.json' }] },
      }, null, 2)),
      file('themes/theme.json', '{"tokenColors": []}'),
    ];

    expect(isNonPreviewableCodeFileSet(files)).toBe(true);
  });
});
