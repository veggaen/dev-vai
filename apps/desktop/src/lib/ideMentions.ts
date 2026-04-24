import type { CompanionClientSummary } from '../stores/collabStore.js';

const IDE_LABELS: Record<string, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  desktop: 'Desktop',
};

function ideLabel(target: string): string {
  return IDE_LABELS[target.toLowerCase()] ?? target;
}

function slugBase(c: CompanionClientSummary): string {
  const raw = (c.launchTarget || c.clientType || 'ide').toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9-]/g, '');
  return cleaned || 'ide';
}

export interface IdeMentionItem {
  clientId: string | '__all__';
  slug: string;
  label: string;
  hint: string;
  online: boolean;
}

export const IDE_MENTION_ALL_SLUG = 'all';

export function isClientOnline(c: CompanionClientSummary, now = Date.now()): boolean {
  const thirtyMinAgo = now - 30 * 60_000;
  const last = Math.max(
    c.lastPolledAt ? new Date(c.lastPolledAt).getTime() : 0,
    c.lastSeenAt ? new Date(c.lastSeenAt).getTime() : 0,
  );
  return last > thirtyMinAgo;
}

/** Stable mention slugs for each companion; disambiguates duplicate launch targets. */
export function buildIdeMentionItems(clients: CompanionClientSummary[]): IdeMentionItem[] {
  const online = clients.filter(isClientOnline).sort((a, b) => {
    const ta = slugBase(a);
    const tb = slugBase(b);
    if (ta !== tb) return ta.localeCompare(tb);
    return a.id.localeCompare(b.id);
  });
  const byBase = new Map<string, CompanionClientSummary[]>();
  for (const c of online) {
    const base = slugBase(c);
    const arr = byBase.get(base) ?? [];
    arr.push(c);
    byBase.set(base, arr);
  }

  const items: IdeMentionItem[] = [];

  if (online.length > 1) {
    items.push({
      clientId: '__all__',
      slug: IDE_MENTION_ALL_SLUG,
      label: 'All connected IDEs',
      hint: `${online.length} online`,
      online: true,
    });
  }

  for (const [, group] of byBase) {
    group.forEach((c, i) => {
      const base = slugBase(c);
      const slug = group.length === 1 ? base : i === 0 ? base : `${base}-${i + 1}`;
      const on = isClientOnline(c);
      const nameHint = c.clientName?.trim() || c.id.slice(0, 8);
      items.push({
        clientId: c.id,
        slug: on ? slug : `${slug}`,
        label: ideLabel(c.launchTarget || c.clientType),
        hint: on ? nameHint : 'offline',
        online: on,
      });
    });
  }

  return items;
}

function _filterSortedClients(clients: CompanionClientSummary[]): CompanionClientSummary[] {
  return [...clients].sort((a, b) => {
    const ta = slugBase(a);
    const tb = slugBase(b);
    if (ta !== tb) return ta.localeCompare(tb);
    return a.id.localeCompare(b.id);
  });
}

export function filterMentionItems(items: IdeMentionItem[], query: string): IdeMentionItem[] {
  const q = query.toLowerCase().trim();
  const selectable = items.filter((item) => item.online);
  if (!q) return selectable;
  return selectable.filter(
    (item) =>
      item.slug.includes(q) ||
      item.label.toLowerCase().includes(q) ||
      item.hint.toLowerCase().includes(q),
  );
}

/** Remove leading @slug tokens used for IDE routing so the IDE does not see them. */
export function stripLeadingIdeMentions(text: string, validSlugs: Set<string>): string {
  let s = text.trimStart();
  while (s.startsWith('@')) {
    const m = s.match(/^@([a-z0-9-]+)(\s+)/);
    if (!m || !validSlugs.has(m[1])) break;
    s = s.slice(m[0].length).trimStart();
  }
  return s;
}

export function mentionSlugSet(items: IdeMentionItem[]): Set<string> {
  return new Set(items.map((i) => i.slug));
}
