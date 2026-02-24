import { describe, it, expect } from 'vitest';
import { extractVideoId, createYouTubeCapture } from '../src/ingest/youtube.js';
import { parseGitHubUrl, createGitHubCapture } from '../src/ingest/github.js';

describe('YouTube helpers', () => {
  describe('extractVideoId', () => {
    it('extracts from standard watch URL', () => {
      expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('extracts from short URL', () => {
      expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('extracts from embed URL', () => {
      expect(extractVideoId('https://youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('extracts from shorts URL', () => {
      expect(extractVideoId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('extracts with extra query params', () => {
      expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ');
    });

    it('returns null for non-YouTube URL', () => {
      expect(extractVideoId('https://example.com/video')).toBeNull();
    });

    it('returns null for invalid URL', () => {
      expect(extractVideoId('not a url')).toBeNull();
    });
  });

  describe('createYouTubeCapture', () => {
    it('creates a RawCapture from extension data', () => {
      const capture = createYouTubeCapture(
        'https://www.youtube.com/watch?v=abc12345678',
        'Test Video',
        'Hello this is the transcript of the video',
      );

      expect(capture.sourceType).toBe('youtube');
      expect(capture.title).toBe('Test Video');
      expect(capture.content).toBe('Hello this is the transcript of the video');
      expect(capture.meta?.videoId).toBe('abc12345678');
      expect(capture.meta?.capturedBy).toBe('extension');
    });

    it('merges extra metadata', () => {
      const capture = createYouTubeCapture(
        'https://youtu.be/abc12345678',
        'Test',
        'Content',
        { duration: 300, channel: 'TestChannel' },
      );

      expect(capture.meta?.duration).toBe(300);
      expect(capture.meta?.channel).toBe('TestChannel');
    });
  });
});

describe('GitHub helpers', () => {
  describe('parseGitHubUrl', () => {
    it('parses a basic repo URL', () => {
      const info = parseGitHubUrl('https://github.com/microsoft/vscode');
      expect(info).toEqual({ owner: 'microsoft', repo: 'vscode', path: undefined });
    });

    it('parses a repo URL with trailing slash', () => {
      const info = parseGitHubUrl('https://github.com/facebook/react/');
      expect(info).toEqual({ owner: 'facebook', repo: 'react', path: undefined });
    });

    it('parses a repo URL with path', () => {
      const info = parseGitHubUrl('https://github.com/owner/repo/blob/main/src/index.ts');
      expect(info?.owner).toBe('owner');
      expect(info?.repo).toBe('repo');
      expect(info?.path).toBe('blob/main/src/index.ts');
    });

    it('strips .git suffix', () => {
      const info = parseGitHubUrl('https://github.com/owner/repo.git');
      expect(info?.repo).toBe('repo');
    });

    it('returns null for non-GitHub URL', () => {
      expect(parseGitHubUrl('https://gitlab.com/owner/repo')).toBeNull();
    });
  });

  describe('createGitHubCapture', () => {
    it('creates a RawCapture from extension data', () => {
      const capture = createGitHubCapture(
        'https://github.com/test/project',
        'test/project',
        '# test/project\nA cool project',
      );

      expect(capture.sourceType).toBe('github');
      expect(capture.language).toBe('code');
      expect(capture.meta?.owner).toBe('test');
      expect(capture.meta?.repo).toBe('project');
      expect(capture.meta?.capturedBy).toBe('extension');
    });

    it('includes file tree in metadata', () => {
      const capture = createGitHubCapture(
        'https://github.com/test/project',
        'test/project',
        'content',
        ['src/', 'README.md', 'package.json'],
      );

      expect(capture.meta?.fileTree).toEqual(['src/', 'README.md', 'package.json']);
    });
  });
});
