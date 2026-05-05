import { describe, expect, it } from 'vitest';
import { tryEmitContinuation } from '../src/chat/chat-continuation.js';

const PRIOR_CODE = '```tsx\nexport function App() { return <div/>; }\n```';

describe('tryEmitContinuation', () => {
  it('returns null for empty input', () => {
    expect(tryEmitContinuation({ content: '' })).toBeNull();
  });

  it('returns null for non-followup text', () => {
    expect(tryEmitContinuation({ content: 'how do I learn rust?' })).toBeNull();
  });

  it('emits add-button for "now add a button"', () => {
    const r = tryEmitContinuation({ content: 'now add a button', priorAssistantText: PRIOR_CODE });
    expect(r?.kind).toBe('add-button');
    expect(r?.reply).toMatch(/ActionButton/);
    expect(r?.reply).toMatch(/aria/i);
  });

  it('emits add-search-input for "add a search input"', () => {
    const r = tryEmitContinuation({ content: 'also add a search input', priorAssistantText: PRIOR_CODE });
    expect(r?.kind).toBe('add-search-input');
    expect(r?.reply).toMatch(/SearchBox/);
    expect(r?.reply).toMatch(/toLowerCase\(\)\.includes/);
  });

  it('emits add-form for "now add a contact form"', () => {
    const r = tryEmitContinuation({ content: 'now add a contact form', priorAssistantText: PRIOR_CODE });
    expect(r?.kind).toBe('add-form');
    expect(r?.reply).toMatch(/ContactForm/);
    expect(r?.reply).toMatch(/aria-invalid/);
  });

  it('emits add-table for "add a compare table"', () => {
    const r = tryEmitContinuation({ content: 'add a compare table', priorAssistantText: PRIOR_CODE });
    expect(r?.kind).toBe('add-table');
    expect(r?.reply).toMatch(/<table/);
    expect(r?.reply).toMatch(/scope="col"/);
  });

  it('emits add-list for "add a list"', () => {
    const r = tryEmitContinuation({ content: 'now add a list', priorAssistantText: PRIOR_CODE });
    expect(r?.kind).toBe('add-list');
    expect(r?.reply).toMatch(/ItemList/);
  });

  it('emits add-dark-mode for "make it dark"', () => {
    const r = tryEmitContinuation({ content: 'make it dark', priorAssistantText: PRIOR_CODE });
    expect(r?.kind).toBe('add-dark-mode');
    expect(r?.reply).toMatch(/DarkModeToggle/);
    expect(r?.reply).toMatch(/prefers-color-scheme/);
  });

  it('emits add-dark-mode for "add dark mode"', () => {
    const r = tryEmitContinuation({ content: 'now add dark mode', priorAssistantText: PRIOR_CODE });
    expect(r?.kind).toBe('add-dark-mode');
  });

  it('emits explain-prior for "explain it" with prior code', () => {
    const r = tryEmitContinuation({ content: 'explain it', priorAssistantText: PRIOR_CODE });
    expect(r?.kind).toBe('explain-prior');
    expect(r?.reply).toMatch(/code block/);
    expect(r?.reply).toMatch(/specific part/);
  });

  it('emits explain-prior with no-prior summary when priorAssistantText is empty', () => {
    const r = tryEmitContinuation({ content: 'explain it', priorAssistantText: '' });
    expect(r?.kind).toBe('explain-prior');
    expect(r?.reply).toMatch(/no prior reply/i);
  });

  it('emits fix-clarify for "fix it" with prior code', () => {
    const r = tryEmitContinuation({ content: 'fix it', priorAssistantText: PRIOR_CODE });
    expect(r?.kind).toBe('fix-clarify');
    expect(r?.reply).toMatch(/error message/);
  });

  it('does not emit fix-clarify when prior turn had no code fence', () => {
    expect(
      tryEmitContinuation({ content: 'fix it', priorAssistantText: 'just prose, no code' }),
    ).toBeNull();
  });

  it('all emitters return in <10ms', () => {
    const cases = [
      'now add a button',
      'add a search input',
      'now add a form',
      'add a compare table',
      'now add a list',
      'make it dark',
      'explain it',
      'fix it',
    ];
    for (const c of cases) {
      const t0 = Date.now();
      tryEmitContinuation({ content: c, priorAssistantText: PRIOR_CODE });
      expect(Date.now() - t0).toBeLessThan(10);
    }
  });
});
