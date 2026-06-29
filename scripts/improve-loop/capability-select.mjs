/**
 * capability-select — the loop CHOOSES its own perpetual feature to build, and chooses WELL.
 *
 * The gap (V3gga: "you must choose, it's perpetual" + "this isn't meaningful yet"): the loop's
 * capability council proposes ~15 items that collapse to ~5 real ideas (4 "voice", 3 "convergence
 * vote", 2 "image"…) — shallow, duplicative, and several duplicate capabilities the app ALREADY has.
 * Picking the top council_overall blindly would build a navel-gazing duplicate. For the loop to
 * autonomously build something MEANINGFUL, "best" must mean: deduped (one per idea-cluster), NOVEL
 * (not already in the app), and ranked by real USER value — not council self-score alone.
 *
 * Pure core (cluster/score/pick) is I/O-free + unit-testable. The novelty check is injected
 * (a `seenInApp(title,capability)=>boolean`) so the live caller greps the real codebase while tests
 * stay deterministic. This is the chooser; the BUILD step (turning the pick into real code) stays a
 * senior/escalation action — an 8B can't safely build a feature, so a chosen feature is QUEUED +
 * escalated with a concrete first-slice, not auto-written.
 */

/** Idea clusters — the semantic key a title/capability belongs to, so near-duplicates collapse to
 *  ONE candidate. Order matters: first match wins. Generalises the observed dup families. */
const CLUSTERS = [
  ['image-vision', /\b(image|vision|visual|screenshot|camera|capture|see|ocr)\b/i],
  ['voice', /\b(voice|speech|stt|tts|barge|spoken|audio)\b/i],
  ['council-vote', /\b(convergence|vote|consensus|council decision|roundtable)\b/i],
  ['streaming', /\b(stream|real-?time|live update|barge)\b/i],
  ['tool-use', /\b(tool|shell|command|api|file operation|invoke|execute task)\b/i],
  ['memory', /\b(context|backlog|retention|memory|recall|history|continuity)\b/i],
  ['escalation', /\b(escalat|missing capabilit|hand-?off|delegat)\b/i],
];

/** USER value weight per cluster — what a person actually FEELS. Heavily favours new capabilities
 *  a user touches (see images, do real work) over internal council mechanics (vote/streaming polish).
 *  This is the "meaningful, not navel-gazing" signal the council_overall score alone misses. */
const USER_VALUE = {
  'image-vision': 1.0, 'tool-use': 0.95, 'memory': 0.85, 'voice': 0.7,
  'escalation': 0.55, 'streaming': 0.4, 'council-vote': 0.3, 'other': 0.5,
};

/** Which cluster a proposal belongs to (by title + capability text). */
export function clusterOf(p) {
  const hay = `${p?.title ?? ''} ${p?.capability ?? ''}`;
  for (const [name, re] of CLUSTERS) if (re.test(hay)) return name;
  return 'other';
}

/**
 * Choose the single best capability to build next from the proposal pool.
 * @param proposals [{ title, capability, council_overall, first_slice, area, ... }]
 * @param opts {
 *   seenInApp?: (p)=>boolean,   // true if the capability already exists in the app → reject as not-novel
 *   minScore?: number,          // council floor (default 7) — don't build a weak idea
 * }
 * @returns { pick, ranked, rejected, headline }
 *   pick = the chosen proposal (with cluster + finalScore) or null when nothing qualifies.
 */
export function chooseCapability(proposals = [], opts = {}) {
  const seenInApp = opts.seenInApp ?? (() => false);
  const minScore = opts.minScore ?? 7;
  const rejected = [];

  // 1) Score + cluster each; reject below-floor and already-in-app (not novel).
  const scored = [];
  for (const p of proposals) {
    const cluster = clusterOf(p);
    const council = Number(p.council_overall ?? 0);
    if (council < minScore) { rejected.push({ title: p.title, why: `below council floor (${council} < ${minScore})` }); continue; }
    // A novelty-check FAILURE must not read as "novel" — a grep/read error would then re-select a
    // capability the app already ships (CodeRabbit #25). On error, treat as non-selectable (skip).
    let already = false; let noveltyCheckFailed = false;
    try { already = !!seenInApp(p); } catch { noveltyCheckFailed = true; }
    if (noveltyCheckFailed) { rejected.push({ title: p.title, why: 'novelty check failed (grep/read error) — not selectable' }); continue; }
    if (already) { rejected.push({ title: p.title, why: 'capability already exists in the app — not novel' }); continue; }
    // finalScore blends council quality with real user value for the cluster.
    const userValue = USER_VALUE[cluster] ?? 0.5;
    scored.push({ ...p, cluster, userValue, finalScore: Math.round((council / 10 * 0.5 + userValue * 0.5) * 100) / 100 });
  }

  // 2) DEDUP to one per cluster — keep the highest finalScore in each idea-family.
  const best = new Map();
  for (const p of scored) {
    const cur = best.get(p.cluster);
    if (!cur || p.finalScore > cur.finalScore) best.set(p.cluster, p);
  }
  const ranked = [...best.values()].sort((a, b) => b.finalScore - a.finalScore);

  const pick = ranked[0] ?? null;
  return {
    pick,
    ranked,
    rejected,
    headline: pick
      ? `build next: "${pick.title}" [${pick.cluster}] — value ${pick.finalScore} (council ${pick.council_overall}, user ${pick.userValue}); ${ranked.length} distinct ideas from ${proposals.length} proposals`
      : `nothing to build: ${proposals.length} proposals, none novel + above floor (${rejected.length} rejected)`,
  };
}

/** Friend-readable render. */
export function formatChoice(choice) {
  if (!choice?.pick) return choice?.headline ?? 'no capability chosen';
  const lines = [choice.headline, `  → first slice: ${choice.pick.first_slice || '(none specified)'}`];
  if (choice.ranked.length > 1) lines.push(`  runners-up: ${choice.ranked.slice(1, 4).map((p) => `${p.title} (${p.finalScore})`).join(' · ')}`);
  return lines.join('\n');
}
