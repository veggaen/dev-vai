import { describe, expect, it } from 'vitest';
import { buildSharedWorkContinuationPrompt, sharedWorkBriefPreview, type SharedWorkArtifact } from './shared-work-artifact.js';

const artifact: SharedWorkArtifact = {
  id: 'work-1',
  projectName: 'book-tracker',
  brief: 'Fix the rounded header and search panel spacing while preserving every existing behavior.',
  status: 'pending',
  filePaths: ['src/styles.css'],
  validation: { ok: false, errors: ['missing margin'], warnings: [] },
  reviews: [{ memberId: 'local:qwen3:8b', verdict: 'needs-work', mustFixCount: 1 }],
  repairsUsed: 2,
  memberIds: ['local:qwen2.5-coder:7b', 'local:qwen3:8b'],
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:01:00.000Z',
};

describe('shared work artifact helpers', () => {
  it('builds a bounded continuation that preserves shared context', () => {
    expect(buildSharedWorkContinuationPrompt(artifact)).toBe(
      'Resume the pending shared task for book-tracker. Keep its original scope, proposed files, review evidence, and acceptance criteria. Fix the 1 remaining validation issue without redesigning unrelated work. Apply only after validation and review pass, then report concise observed proof.',
    );
  });

  it('previews long briefs on a word boundary', () => {
    const preview = sharedWorkBriefPreview('one two three four five six seven eight nine ten', 24);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview).not.toContain('fiv…');
  });

  it('honestly reopens an applied artifact when its recorded validation failed', () => {
    const prompt = buildSharedWorkContinuationPrompt({ ...artifact, status: 'applied' });
    expect(prompt).toContain('Reopen the applied shared task');
    expect(prompt).toContain('Fix the 1 remaining validation issue');
  });
});
