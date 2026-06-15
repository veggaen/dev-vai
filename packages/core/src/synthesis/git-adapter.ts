/**
 * git-adapter — turn read-only {@link GitEvidence} into source-agnostic
 * {@link EvidenceItem}s so the deterministic synthesis core can reason over git
 * the same way it will over web-evidence and ingested notes.
 *
 * Each git fact becomes one (subject, attribute, value) triple bound to the git
 * evidence id that produced it — so a synthesized "what's the state of my repo"
 * answer is fully cited, and a synthesized contradiction (e.g. the same file
 * reported added in the index but deleted in the working tree) is detectable
 * without a model.
 */

import type { GitEvidence } from '../tools/git-evidence.js';
import type { EvidenceItem } from './synthesize.js';

/**
 * Flatten git evidence into evidence items. Subjects are stable, low-cardinality
 * keys (the file path, the branch name, `repo`) so claims about the same thing
 * cluster; the `sourceId` is the real git evidence id for citation/binding.
 */
export function gitEvidenceToItems(evidence: GitEvidence): EvidenceItem[] {
  if (!evidence.ok) return [];
  const items: EvidenceItem[] = [];

  for (const f of evidence.changedFiles) {
    items.push({ sourceId: f.id, subject: f.path, attribute: 'change-status', value: f.status, span: f.staged ? 'staged' : 'working-tree' });
    if (f.additions != null) items.push({ sourceId: f.id, subject: f.path, attribute: 'additions', value: String(f.additions) });
    if (f.deletions != null) items.push({ sourceId: f.id, subject: f.path, attribute: 'deletions', value: String(f.deletions) });
  }

  for (const b of evidence.blame) {
    items.push({ sourceId: b.id, subject: `${b.path}:${b.line}`, attribute: 'last-author', value: b.author, span: `commit ${b.sha}` });
  }

  for (const c of evidence.log) {
    items.push({ sourceId: c.id, subject: `commit ${c.sha}`, attribute: 'subject', value: c.subject, span: c.author });
  }

  if (evidence.branch) {
    const b = evidence.branch;
    items.push({ sourceId: b.id, subject: 'branch', attribute: 'current', value: b.current });
    if (b.upstream) items.push({ sourceId: b.id, subject: 'branch', attribute: 'upstream', value: b.upstream });
    if (b.ahead != null) items.push({ sourceId: b.id, subject: 'branch', attribute: 'ahead', value: String(b.ahead) });
    if (b.behind != null) items.push({ sourceId: b.id, subject: 'branch', attribute: 'behind', value: String(b.behind) });
  }

  return items;
}
