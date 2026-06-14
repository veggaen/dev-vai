import type { AgentSession } from '@vai/core/browser';

export type SessionSourceFilter =
  | 'all'
  | 'vai'
  | 'cursor'
  | 'vs-chat'
  | 'vs-claude'
  | 'vs-augment'
  | 'vs-codex'
  | 'audit';

export const SOURCE_LABELS: Record<Exclude<SessionSourceFilter, 'all'>, string> = {
  vai: 'Vai chat',
  cursor: 'Cursor',
  'vs-chat': 'VS Chat',
  'vs-claude': 'VS Claude',
  'vs-augment': 'VS Augment',
  'vs-codex': 'Codex',
  audit: 'Audit',
};

const VS_CHAT_TAGS = new Set([
  'vscode-chat',
  'vscode-copilot',
  'vscode-agent',
  'vscode-extension',
]);

const HIDDEN_TAGS = new Set([
  'vscode-agent',
  'vscode-extension',
  'vscode-chat',
  'vscode-copilot',
  'vscode-claude',
  'vscode-augment',
  'vscode-codex',
  'auto-capture',
  'cursor-agent',
  'cursor-composer',
  'playwright-audit',
  'workspace:dev-vai',
]);

/** Classify a Dev Logs session for source filter chips. */
export function sessionSourceKey(session: AgentSession): Exclude<SessionSourceFilter, 'all'> {
  const tags = session.tags ?? [];
  const model = session.modelId ?? '';

  if (tags.includes('playwright-audit')) return 'audit';
  if (tags.includes('cursor-agent') || tags.includes('cursor-composer')) return 'cursor';

  if (tags.includes('vscode-claude') || model === 'vscode-claude') return 'vs-claude';
  if (tags.includes('vscode-augment') || model === 'vscode-augment') return 'vs-augment';
  if (tags.includes('vscode-codex') || model === 'vscode-codex') return 'vs-codex';

  if ([...VS_CHAT_TAGS].some((t) => tags.includes(t))) return 'vs-chat';
  if (model === 'vscode-chat' || model === 'vscode-copilot') return 'vs-chat';

  return 'vai';
}

export function sourceBadge(session: AgentSession): { label: string; tone: string } | null {
  switch (sessionSourceKey(session)) {
    case 'cursor':
      return { label: 'Cursor', tone: 'bg-sky-500/15 text-sky-400' };
    case 'vs-claude':
      return { label: 'VS Claude', tone: 'bg-orange-500/15 text-orange-300' };
    case 'vs-augment':
      return { label: 'VS Augment', tone: 'bg-fuchsia-500/15 text-fuchsia-300' };
    case 'vs-codex':
      return { label: 'Codex', tone: 'bg-emerald-500/15 text-emerald-300' };
    case 'vs-chat':
      return { label: 'VS Chat', tone: 'bg-violet-500/15 text-violet-400' };
    case 'audit':
      return { label: 'Audit', tone: 'bg-orange-500/15 text-orange-400' };
    case 'vai':
      if (session.tags?.includes('auto-capture')) {
        return { label: 'Vai chat', tone: 'bg-blue-500/15 text-blue-400' };
      }
      return null;
    default:
      return null;
  }
}

/** Tags worth showing on the card (hide internal routing tags). */
export function visibleSessionTags(tags: string[]): string[] {
  return tags.filter((t) => !HIDDEN_TAGS.has(t) && !t.startsWith('workspace:'));
}
