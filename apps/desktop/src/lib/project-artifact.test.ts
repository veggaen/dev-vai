import { describe, expect, it } from 'vitest';
import {
  extractProjectUpdateArtifact,
  parseProjectUpdateBody,
  serializeProjectUpdateArtifact,
  stripProjectArtifactMarkup,
  type ProjectUpdateArtifact,
} from './project-artifact.js';

describe('project artifact helpers', () => {
  it('round-trips richer project update artifacts', () => {
    const artifact: ProjectUpdateArtifact = {
      kind: 'update',
      title: 'Current project',
      status: 'failed',
      tone: 'amber',
      badge: 'Preview failed',
      port: 4321,
      liveUrl: 'http://localhost:4321',
      fileCount: 3,
      changedFiles: ['src/App.tsx', 'src/index.css'],
      evidenceTier: 'unverified',
      verificationItems: ['Preview never loaded in the app shell.'],
      recoveryLabel: 'Recovered from a stale sandbox link.',
      packageChanged: true,
      failureClass: 'runtime',
      nextPrompts: ['Polish the UI and spacing'],
    };

    const wrapped = serializeProjectUpdateArtifact(artifact);
    expect(extractProjectUpdateArtifact(wrapped)).toEqual(artifact);
  });

  it('strips artifact markup and keeps the human-readable body', () => {
    const raw = [
      'Project update: Applied 2 files.',
      '',
      serializeProjectUpdateArtifact({
        kind: 'update',
        title: 'Current project',
        status: 'updated',
      }),
      '',
      '- Verified the preview on port 3000.',
      '',
      'Files changed:',
      '- src/App.tsx',
    ].join('\n');

    const stripped = stripProjectArtifactMarkup(raw);
    expect(stripped).toMatch(/Project update: Applied 2 files\./);
    expect(stripped).toMatch(/Verified the preview on port 3000/);
    expect(stripped).not.toMatch(/\[vai-artifact\]/);
  });

  it('parses summary, details, and file list from project updates', () => {
    const parsed = parseProjectUpdateBody([
      'Applied 2 files for Vai.',
      '- Verified the preview on port 3000.',
      '- Reinstalled dependencies after package changes.',
      'Files changed:',
      '- src/App.tsx',
      '- package.json',
    ].join('\n'));

    expect(parsed.summary).toBe('Applied 2 files for Vai.');
    expect(parsed.details).toEqual([
      'Verified the preview on port 3000.',
      'Reinstalled dependencies after package changes.',
    ]);
    expect(parsed.files).toEqual(['src/App.tsx', 'package.json']);
  });
});
