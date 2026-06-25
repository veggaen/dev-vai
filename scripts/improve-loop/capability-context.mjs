/**
 * capability-context — assemble a bounded, grounded picture of the project for the
 * Capability-Innovation council, so its proposals are anchored in REAL intent and
 * REAL code instead of one model's imagination.
 *
 * Sources, in priority order (each best-effort, each token-capped):
 *   1. PERPETUAL_GOAL — the locked north-star, distilled from MASTER_PROMPT.md
 *      (voice + interface, "help with any task", honest escalation). The mission.
 *   2. AGENTS.md mission — what Vai is/is not (institution vs. LLM wrapper).
 *   3. Open backlog items — what's already in flight (avoid re-proposing).
 *   4. Distilled user goals — what V3gga keeps ASKING for (message history).
 *   5. Runtime introspect — live models/council/pipeline (best-effort over HTTP).
 *
 * Everything is INJECTABLE (fs/fetch) so the pure distillation/capping/section
 * logic unit-tests without touching disk or network.
 */

/** The north-star, hard-coded as the fallback so the council always has a mission
 *  even when MASTER_PROMPT.md is unreadable. The file, when present, overrides the
 *  human-readable phrasing but NOT this intent. */
export const PERPETUAL_GOAL =
  'Interface + Voice interaction that lets V3gga speak to Vai and get help with ANY task Vai ' +
  'is capable of — completed reliably, without lost details, escalating honestly to V3gga/Opus/' +
  'Codex only when Vai genuinely cannot. Perpetually grow Vai\'s capability, trustworthiness, ' +
  'and the council\'s ability to synthesise tools + thoughts into delegated, verified solutions.';

const cap = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

/** Pull the human intent out of MASTER_PROMPT.md's locked parentheses block. The
 *  file is a single locked sentence; we extract the "My app is …" intent if present. */
export function distillGoal(masterPromptText = '') {
  const m = String(masterPromptText).match(/My app is ([\s\S]*?)(?:\.|but only)/i);
  const fromFile = m ? `My app is ${m[1].trim()}.` : '';
  return cap(fromFile ? `${fromFile}\n\nNorth-star: ${PERPETUAL_GOAL}` : PERPETUAL_GOAL, 700);
}

/** Extract the OPEN backlog items' headlines (the "- **…**" bullets under "## Open")
 *  so the council can see what's already in flight and not re-propose it. */
export function distillBacklog(backlogText = '', max = 8) {
  const open = String(backlogText).split(/^##\s+/m).find((s) => /^Open/i.test(s)) ?? backlogText;
  const heads = [...open.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1].trim());
  return heads.slice(0, max);
}

/** Distill the recurring asks from the user-message dump (the "--- #N (Lc) ---"
 *  blocks). Returns the longest/most-substantive recent messages, capped, as a
 *  proxy for "what V3gga keeps wanting". Cheap + deterministic — no model needed. */
export function distillUserGoals(msgsText = '', { max = 6, minLen = 120 } = {}) {
  const blocks = String(msgsText).split(/^---\s*#\d+.*?---$/m).map((b) => b.trim()).filter(Boolean);
  const scored = blocks
    .filter((b) => b.length >= minLen)
    .map((b) => cap(b.replace(/\s+/g, ' '), 220));
  // De-dup near-identical (the dump has repeated drafts) by first 60 chars.
  const seen = new Set();
  const out = [];
  for (const s of scored) {
    const key = s.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Compose the final, bounded context string the lenses are given. Pure: takes the
 *  already-distilled pieces and renders one capped block. */
export function composeContext({ goal, agents = '', backlog = [], userGoals = [], introspect = null } = {}) {
  const lines = [];
  lines.push('=== PERPETUAL GOAL (north-star) ===', goal ?? PERPETUAL_GOAL, '');
  if (agents) lines.push('=== WHAT VAI IS (AGENTS.md) ===', cap(agents, 600), '');
  if (backlog.length) lines.push('=== ALREADY IN FLIGHT (do not re-propose) ===', ...backlog.map((b) => `- ${b}`), '');
  if (userGoals.length) lines.push('=== WHAT V3GGA KEEPS ASKING FOR ===', ...userGoals.map((g) => `- ${g}`), '');
  if (introspect) {
    const models = (introspect.models ?? introspect.council ?? []).slice?.(0, 8) ?? [];
    lines.push('=== LIVE RUNTIME (introspect) ===',
      `models/council: ${Array.isArray(models) ? models.map((m) => m.name ?? m.id ?? m).join(', ') : 'n/a'}`,
      introspect.pipeline ? `pipeline: ${(introspect.pipeline.stages ?? introspect.pipeline).toString().slice(0, 160)}` : '', '');
  }
  return cap(lines.filter((l) => l !== undefined).join('\n'), 3200);
}

/** Best-effort runtime introspect over HTTP (injectable fetch for tests). */
export async function fetchIntrospect(baseUrl = process.env.VAI_API ?? 'http://localhost:3006', { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/agent/introspect`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * Assemble the full context by reading the real files (injectable fs) + optional
 * live introspect. Each read is guarded so a missing file degrades gracefully.
 */
export async function assembleContext({
  fsImpl,
  baseUrl,
  introspect,
  paths = {},
} = {}) {
  const fs = fsImpl ?? (await import('node:fs')).default ?? (await import('node:fs'));
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const P = {
    master: paths.master ?? 'MASTER_PROMPT.md',
    agents: paths.agents ?? 'AGENTS.md',
    backlog: paths.backlog ?? 'docs/vai-improvement-backlog.md',
    msgs: paths.msgs ?? 'Temporary_files/_vetles_user_msgs.txt',
  };
  const goal = distillGoal(read(P.master));
  const agents = cap(read(P.agents), 600);
  const backlog = distillBacklog(read(P.backlog));
  const userGoals = distillUserGoals(read(P.msgs));
  const live = introspect ?? (baseUrl ? await fetchIntrospect(baseUrl) : null);
  return {
    goal,
    context: composeContext({ goal, agents, backlog, userGoals, introspect: live }),
    parts: { agents, backlog, userGoals, introspect: live },
  };
}
