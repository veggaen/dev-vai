import { describe, expect, it } from 'vitest';
import { detectPastedFileExtension, shouldAttachTextPaste } from './composer-paste.js';

describe('composer paste policy', () => {
  it('keeps a long single-line software request in the composer', () => {
    const prompt = 'Repair the observed runtime issue in lib/AppKitProvider.tsx and lib/appkit.ts only. '
      + 'Keep wallet behavior, remove server-only RPC secrets, validate the result, and summarize the proof briefly. '.repeat(8);

    expect(prompt.length).toBeGreaterThan(500);
    expect(detectPastedFileExtension(prompt)).toBe('md');
    expect(shouldAttachTextPaste(prompt)).toBe(false);
  });

  it('attaches large source code even when minified onto one line', () => {
    const source = `export default function App(){return <main>${'content'.repeat(100)}</main>}`;
    expect(shouldAttachTextPaste(source)).toBe(true);
    expect(detectPastedFileExtension(source)).toBe('tsx');
  });

  it('attaches a large multi-line prose document as Markdown', () => {
    const document = Array.from({ length: 20 }, (_, index) => `Section ${index}: ${'detail '.repeat(8)}`).join('\n');
    expect(shouldAttachTextPaste(document)).toBe(true);
    expect(detectPastedFileExtension(document)).toBe('md');
  });
});
