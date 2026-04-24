import { describe, expect, it } from 'vitest';
import { filterStructuredFollowUps } from './message-follow-ups.js';

describe('filterStructuredFollowUps', () => {
  const notesFollowUps = [
    'Add search, tags, and filters to this notes dashboard',
    'Persist notes in local storage and restore on reload',
  ];

  it('keeps structured builder follow-ups on project update messages', () => {
    expect(filterStructuredFollowUps({
      followUps: notesFollowUps,
      content: 'Project update: Applied 6 files for notes-dashboard.',
      isUser: false,
      isProjectUpdate: true,
      hasAppliedFileBlocks: false,
    })).toEqual(notesFollowUps);
  });

  it('keeps structured builder follow-ups on raw file-block messages', () => {
    expect(filterStructuredFollowUps({
      followUps: notesFollowUps,
      content: '```jsx title="src/App.jsx"\nexport default function App() { return <h1>Notes Dashboard</h1>; }\n```',
      isUser: false,
      isProjectUpdate: false,
      hasAppliedFileBlocks: true,
    })).toEqual(notesFollowUps);
  });

  it('filters unrelated follow-ups on ordinary assistant prose', () => {
    expect(filterStructuredFollowUps({
      followUps: ['Add audit log filters and CSV export'],
      content: 'Docker packages apps into containers so they run consistently across environments.',
      isUser: false,
      isProjectUpdate: false,
      hasAppliedFileBlocks: false,
    })).toEqual([]);
  });
});