/**
 * changelog — the Council's self-improvement CHANGELOG side-note. Every time the loop/council
 * applies (or shelves) a change to Vai, it appends a structured entry to docs/COUNCIL-CHANGELOG.md
 * so a human, GitHub Copilot, or another agent can open ONE file and read the latest changes: WHAT
 * changed, WHY, which files, how it was verified, and the peer-review verdict.
 *
 * V3gga's contract: "a side note that co-pilot and agents and human programmers can open and read
 * the latest changes, why, and what has changed" — marked so agents know where to find it when they
 * trigger similar events.
 *
 * Design:
 *   - APPEND-ONLY. Newest entries first (prepended under the header) so the top of the file is the
 *     freshest — the natural thing an agent/human reads first.
 *   - DUAL FORMAT per entry: a human-readable markdown body AND a fenced machine-readable JSON block
 *     (a stable schema) so tooling can parse the log without scraping prose.
 *   - PURE render + thin append. renderChangelogEntry is I/O-free and unit-tested; append does the
 *     minimal file read/insert. The UI reads the same file (parseChangelog) to surface recent entries.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The one canonical location. Marked (below) so agents discover it; also registered in
// docs/agent-tooling-guide.json under "changelog".
export const CHANGELOG_PATH = 'docs/COUNCIL-CHANGELOG.md';

// Discovery marker + preamble written once at the top of a fresh file. The AGENT-DISCOVERY line is
// the string agents grep for to know "this is the council changelog, append here on a self-change".
export const CHANGELOG_HEADER = `# Council Changelog

<!-- AGENT-DISCOVERY: council-self-improvement-changelog. When the loop/council applies, shelves, or
     reverts a change to Vai, APPEND a new entry at the TOP of the "## Entries" list using
     scripts/improve-loop/changelog.mjs (renderChangelogEntry + appendChangelogEntry). Newest first.
     Each entry carries a human body AND a fenced \`council-change\` JSON block for machine parsing. -->

This file is written **by the Council/self-improvement loop**, not by hand. It is the side-note for
humans, GitHub Copilot, and agents to see what Vai changed about itself, why, and how it was verified.

- **What / Why**: each entry states the change and its rationale.
- **Verification**: tsc / tests / behavioural-acceptance result at the time of the change.
- **Peers**: the multi-member review verdict (accept ratio, modern/scale, dissent) when applicable.
- **Machine-readable**: every entry embeds a \`\`\`council-change JSON block with a stable schema.

## Entries
`;

// The marker between the header/preamble and the entries. New entries are inserted right after it.
const ENTRIES_ANCHOR = '## Entries\n';

/**
 * Render ONE changelog entry to markdown (pure, I/O-free). Shape of `entry`:
 *   {
 *     kind: 'integrated'|'shelved'|'reverted'|'proposed'|'held',
 *     title: string,            // one-line summary of the change
 *     why: string,              // rationale
 *     files: string[],          // files touched (repo-relative)
 *     verification: string,     // e.g. "tsc + colocated test green · acceptance accepted"
 *     peers?: {                 // multi-member review, when a feature was peer-reviewed
 *       accept: boolean, ratio: number, modernScale: number,
 *       accepts?: string[], rejects?: string[], dissent?: string[]
 *     },
 *     commit?: string,          // short sha, if committed
 *     class?: string,           // failure class / feature area
 *     at?: string,              // ISO timestamp (defaults to now)
 *   }
 */
export function renderChangelogEntry(entry = {}) {
  const at = entry.at ?? new Date().toISOString();
  const kind = entry.kind ?? 'integrated';
  const icon = KIND_ICON[kind] ?? '•';
  const title = oneLine(entry.title || '(untitled change)');
  const date = at.slice(0, 10);

  const lines = [`### ${icon} ${date} — ${title}`, ''];
  lines.push(`- **Change**: ${oneLine(entry.title || '—')}`);
  if (entry.why) lines.push(`- **Why**: ${oneLine(entry.why)}`);
  if (entry.class) lines.push(`- **Area**: ${oneLine(entry.class)}`);
  if (Array.isArray(entry.files) && entry.files.length) {
    lines.push(`- **Files**: ${entry.files.map((f) => `\`${f}\``).join(', ')}`);
  }
  if (entry.verification) lines.push(`- **Verification**: ${oneLine(entry.verification)}`);
  if (entry.commit) lines.push(`- **Commit**: \`${entry.commit}\``);
  if (entry.peers) {
    const p = entry.peers;
    const verdict = p.accept ? 'accepted' : 'not accepted';
    const dissent = (p.dissent && p.dissent.length) ? ` · dissent: ${p.dissent.map(oneLine).join('; ')}` : '';
    lines.push(`- **Peers**: ${verdict} — ${Math.round((p.ratio ?? 0) * 100)}% accept, modern/scale ${((p.modernScale ?? 0)).toFixed(2)}${dissent}`);
  }
  lines.push('');
  // Machine-readable block — a stable schema so Copilot/agents parse rather than scrape.
  const machine = {
    schema: 'council-change/1',
    at,
    kind,
    title: entry.title ?? null,
    why: entry.why ?? null,
    area: entry.class ?? null,
    files: Array.isArray(entry.files) ? entry.files : [],
    verification: entry.verification ?? null,
    commit: entry.commit ?? null,
    peers: entry.peers ?? null,
  };
  lines.push('```council-change');
  lines.push(JSON.stringify(machine, null, 2));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

/**
 * Append (prepend under the anchor) a rendered entry to the changelog file, creating the file with
 * its header the first time. Returns the entry text written. `fs` is injectable for tests; defaults
 * to node fs. Never throws into the caller's flow — a changelog write must not break an apply.
 */
export function appendChangelogEntry(entry, { path = CHANGELOG_PATH, fs = defaultFs } = {}) {
  const rendered = renderChangelogEntry(entry);
  try {
    let doc = fs.exists(path) ? fs.read(path) : '';
    if (!doc.includes(ENTRIES_ANCHOR)) {
      // Fresh (or header-less) file — lay down the full header, then the entry under the anchor.
      doc = CHANGELOG_HEADER;
    }
    const idx = doc.indexOf(ENTRIES_ANCHOR) + ENTRIES_ANCHOR.length;
    const next = doc.slice(0, idx) + '\n' + rendered + doc.slice(idx);
    fs.ensureDir(dirname(path));
    fs.write(path, next);
    return { ok: true, rendered };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 160), rendered };
  }
}

/**
 * Parse the changelog into structured entries (newest first) by reading the fenced council-change
 * JSON blocks. Used by the UI/API to surface recent self-improvements. Tolerant: a malformed block
 * is skipped, not fatal. Returns [] on a missing/empty file.
 */
export function parseChangelog(text, { limit = 20 } = {}) {
  const s = String(text ?? '');
  const out = [];
  const re = /```council-change\s*\n([\s\S]*?)\n```/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && obj.schema && String(obj.schema).startsWith('council-change/')) out.push(obj);
    } catch { /* skip a malformed block */ }
    if (out.length >= limit) break;
  }
  return out;
}

/** Read + parse the changelog file (newest first). Injectable fs; [] if the file is absent. */
export function readChangelogEntries({ path = CHANGELOG_PATH, fs = defaultFs, limit = 20 } = {}) {
  try {
    if (!fs.exists(path)) return [];
    return parseChangelog(fs.read(path), { limit });
  } catch { return []; }
}

const KIND_ICON = {
  integrated: '✅',
  shelved: '🗄',
  reverted: '↩',
  proposed: '📝',
  held: '⏸',
};

function oneLine(s) { return String(s).replace(/\s+/g, ' ').trim(); }

const defaultFs = {
  exists: (p) => existsSync(p),
  read: (p) => readFileSync(p, 'utf8'),
  write: (p, c) => writeFileSync(p, c),
  ensureDir: (d) => { if (d && !existsSync(d)) mkdirSync(d, { recursive: true }); },
};
