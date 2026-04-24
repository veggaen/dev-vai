import { describe, it, expect } from 'vitest';
import { ensureViteReactEntrypoint, type ExtractedFile } from './file-extractor.js';

describe('ensureViteReactEntrypoint', () => {
  it('adds a src/main.tsx alias when a generated app only includes src/main.jsx', () => {
    const files: ExtractedFile[] = [
      {
        path: 'src/main.jsx',
        language: 'jsx',
        content: "import React from 'react';\nimport ReactDOM from 'react-dom/client';\n",
      },
      {
        path: 'src/App.jsx',
        language: 'jsx',
        content: 'export function App() { return <div />; }',
      },
    ];

    const normalized = ensureViteReactEntrypoint(files);

    expect(normalized).toHaveLength(3);
    expect(normalized.find((file) => file.path === 'src/main.tsx')).toEqual({
      path: 'src/main.tsx',
      language: 'tsx',
      content: files[0].content,
    });
  });

  it('leaves the file set unchanged when src/main.tsx already exists', () => {
    const files: ExtractedFile[] = [
      {
        path: 'src/main.tsx',
        language: 'tsx',
        content: 'existing',
      },
    ];

    expect(ensureViteReactEntrypoint(files)).toEqual(files);
  });
});