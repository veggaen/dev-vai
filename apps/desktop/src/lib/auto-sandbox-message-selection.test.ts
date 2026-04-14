import { describe, expect, it } from 'vitest';
import { selectNextAutoSandboxMessage } from './auto-sandbox-message-selection.js';
import type { ChatMessage } from '../stores/chatStore.js';

function assistant(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content };
}

describe('selectNextAutoSandboxMessage', () => {
  it('prefers actionable file output over newer project update notes', () => {
    const selection = selectNextAutoSandboxMessage([
      assistant('code', '```tsx title="src/App.tsx"\nexport default function App() { return <div/> }\n```'),
      assistant('artifact', 'Project update: Applied 1 file.\n\n[vai-artifact]\n{"kind":"update"}\n[/vai-artifact]'),
    ], new Set());

    expect(selection.candidate?.id).toBe('code');
    expect(selection.skippedIds).toEqual(['artifact']);
  });

  it('returns the latest assistant message when nothing actionable exists', () => {
    const selection = selectNextAutoSandboxMessage([
      assistant('a', 'Thinking...'),
      assistant('b', 'No runnable update yet.'),
    ], new Set());

    expect(selection.candidate?.id).toBe('b');
    expect(selection.skippedIds).toEqual(['a']);
  });
});
