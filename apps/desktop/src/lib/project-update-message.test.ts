import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../stores/chatStore.js';
import { mergeProjectUpdateMessage } from './project-update-message.js';

describe('mergeProjectUpdateMessage', () => {
  it('preserves builder follow-ups when a project update replaces the raw file message', () => {
    const existing: ChatMessage = {
      id: 'assistant-raw',
      role: 'assistant',
      content: '```jsx title="src/App.jsx"\nexport default function App() { return <h1>Notes Dashboard</h1>; }\n```',
      followUps: [
        'Add search, tags, and filters to this notes dashboard',
        'Persist notes in local storage and restore on reload',
      ],
      confidence: 0.85,
    };

    const replacement: ChatMessage = {
      id: 'assistant-project-update',
      role: 'assistant',
      content: 'Project update: Applied 6 files for notes-dashboard.',
    };

    expect(mergeProjectUpdateMessage(existing, replacement)).toEqual({
      ...existing,
      ...replacement,
    });
  });
});