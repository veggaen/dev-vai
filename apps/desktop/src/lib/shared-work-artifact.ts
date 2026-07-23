import { apiFetch } from './api.js';

export interface SharedWorkArtifact {
  readonly id: string;
  readonly projectName: string;
  readonly brief: string;
  readonly status: 'pending' | 'applied' | 'superseded';
  readonly filePaths: readonly string[];
  readonly validation: {
    readonly ok: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
  };
  readonly reviews: readonly {
    readonly memberId: string;
    readonly verdict: 'ship' | 'needs-work';
    readonly mustFixCount: number;
  }[];
  readonly repairsUsed: number;
  readonly memberIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

function isArtifact(value: unknown): value is SharedWorkArtifact {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SharedWorkArtifact>;
  return typeof item.id === 'string'
    && typeof item.projectName === 'string'
    && typeof item.brief === 'string'
    && ['pending', 'applied', 'superseded'].includes(item.status ?? '')
    && Array.isArray(item.filePaths)
    && Array.isArray(item.memberIds)
    && Boolean(item.validation && Array.isArray(item.validation.errors) && Array.isArray(item.validation.warnings));
}

export async function fetchLatestSharedWorkArtifact(
  conversationId: string,
  signal?: AbortSignal,
): Promise<SharedWorkArtifact | null> {
  const response = await apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/work-artifacts?limit=1`, { signal });
  if (!response.ok) return null;
  const payload = await response.json() as { artifacts?: unknown };
  if (!Array.isArray(payload.artifacts)) return null;
  const latest = payload.artifacts[0];
  return isArtifact(latest) ? latest : null;
}

export function sharedWorkBriefPreview(brief: string, limit = 150): string {
  const normalized = brief.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  const boundary = normalized.lastIndexOf(' ', limit);
  return `${normalized.slice(0, boundary > 80 ? boundary : limit).trimEnd()}…`;
}

export function buildSharedWorkContinuationPrompt(artifact: SharedWorkArtifact): string {
  const blockers = artifact.validation.errors.length;
  return [
    artifact.status === 'pending'
      ? `Resume the pending shared task for ${artifact.projectName}.`
      : `Reopen the applied shared task for ${artifact.projectName} because its recorded validation still has gaps.`,
    'Keep its original scope, proposed files, review evidence, and acceptance criteria.',
    blockers > 0
      ? `Fix the ${blockers} remaining validation issue${blockers === 1 ? '' : 's'} without redesigning unrelated work.`
      : 'Revalidate the proposal and continue from the recorded artifact without regenerating it.',
    'Apply only after validation and review pass, then report concise observed proof.',
  ].join(' ');
}
