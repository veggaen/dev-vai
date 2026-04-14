export interface ProjectUpdateArtifact {
  kind: 'starter' | 'preview' | 'update';
  title: string;
  status: 'live' | 'updated' | 'failed';
  tone?: 'violet' | 'blue' | 'emerald' | 'amber';
  badge?: string;
  port?: number;
  liveUrl?: string;
  fileCount?: number;
  changedFiles?: string[];
  evidenceTier?: 'high' | 'medium' | 'low' | 'unverified';
  verificationItems?: string[];
  recoveryLabel?: string;
  packageChanged?: boolean;
  failureClass?: string | null;
  nextPrompts?: string[];
}

export interface ParsedProjectUpdateBody {
  summary: string;
  details: string[];
  files: string[];
}

const PROJECT_ARTIFACT_BLOCK_REGEX = /\n?\[vai-artifact\]\s*([\s\S]*?)\s*\[\/vai-artifact\]\s*/i;

export function serializeProjectUpdateArtifact(artifact: ProjectUpdateArtifact): string {
  return ['[vai-artifact]', JSON.stringify(artifact), '[/vai-artifact]'].join('\n');
}

export function extractProjectUpdateArtifact(content: string): ProjectUpdateArtifact | null {
  const match = content.match(PROJECT_ARTIFACT_BLOCK_REGEX);
  if (!match?.[1]) {
    return null;
  }

  try {
    return JSON.parse(match[1]) as ProjectUpdateArtifact;
  } catch {
    return null;
  }
}

export function stripProjectArtifactMarkup(content: string): string {
  return content.replace(PROJECT_ARTIFACT_BLOCK_REGEX, '\n').trim();
}

export function parseProjectUpdateBody(content: string): ParsedProjectUpdateBody {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let summary = '';
  const details: string[] = [];
  const files: string[] = [];
  let readingFiles = false;

  for (const line of lines) {
    if (!summary) {
      summary = line;
      continue;
    }

    if (/^files changed:?$/i.test(line)) {
      readingFiles = true;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const item = line.replace(/^-\s+/, '').trim();
      if (readingFiles) {
        files.push(item);
      } else {
        details.push(item);
      }
      continue;
    }

    if (readingFiles) {
      files.push(line);
    }
  }

  return { summary, details, files };
}