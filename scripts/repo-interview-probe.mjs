#!/usr/bin/env node
/**
 * repo-interview-probe — a professional interviewer for Vai's "look at this repo" turns.
 *
 * Born from the DEV-VEGGASTARE failure: the user pasted a GitHub link, the council correctly
 * said "go read the repo", but Vai never did — it hallucinated Next.js features, then refused
 * ("I cannot access external websites"). This probe drives several real repos through the live
 * chat WS and JUDGES each answer against ground truth pulled from the repo itself:
 *
 *   GOOD  — the answer cites the repo's REAL description/stack (grounded in what was read).
 *   BAD   — the answer REFUSES ("can't access") or HALLUCINATES (invents features absent
 *           from the repo, or speaks only in vague "might be / could be" hedges).
 *
 * It is honest: ground truth is fetched independently (GitHub API), and the judge looks for
 * the real signal tokens in Vai's answer. Run the runtime first (pnpm dev / the desktop
 * binary's server) so localhost:3006 is live.
 *
 *   node scripts/repo-interview-probe.mjs
 *   VAI_API=http://localhost:3006 node scripts/repo-interview-probe.mjs
 */
import { WebSocket } from 'ws';

const BASE = process.env.VAI_API || 'http://localhost:3006';
const wsUrl = `${BASE.replace(/^http/i, 'ws')}/api/chat?devAuthBypass=1`;

/** Repos to interview Vai about. The first is the original failure. */
const REPOS = [
  'https://github.com/veggaen/DEV-VEGGASTARE',
  'https://github.com/colinhacks/zod',
  'https://github.com/honojs/hono',
];

const ASK_TEMPLATES = [
  (url) => `Look at ${url} and tell me what is this app and is it good?`,
  (url) => `What stack does ${url} use?`,
];

/** Pull ground truth straight from GitHub so the judge isn't grading against our own guess. */
async function groundTruth(repoUrl) {
  const m = /github\.com\/([^/]+)\/([^/#?]+)/.exec(repoUrl);
  if (!m) return null;
  const [, owner, repo] = m;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'vai-repo-interview' },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const tokens = [];
    for (const s of [j.description, j.language, ...(j.topics || [])]) {
      if (!s) continue;
      for (const w of String(s).split(/[^A-Za-z0-9.+#-]+/)) {
        if (w.length >= 3) tokens.push(w.toLowerCase());
      }
    }
    return { description: j.description || '', language: j.language || '', tokens: [...new Set(tokens)] };
  } catch {
    return null;
  }
}

const REFUSAL = /\b(?:can(?:not|'t)|unable to|don'?t have the ability to|i'?m not able to)\s+(?:access|browse|fetch|read|analyze|view|reach)\b|no (?:internet|web) access|i cannot access/i;
const HEDGE = /\b(?:might be|could be|appears to be|seems to be|possibly|may be|likely a)\b/gi;

// Stop-words / generic dev tokens that ANY repo answer would mention — matching these is not evidence
// the model actually read THIS repo (CodeRabbit #25: two generic tokens passed a hallucination GOOD).
const GENERIC_TOKEN = new Set([
  'app', 'api', 'web', 'src', 'code', 'test', 'tests', 'main', 'node', 'json', 'http', 'https',
  'data', 'file', 'files', 'repo', 'project', 'server', 'client', 'build', 'config', 'index',
  'javascript', 'typescript', 'python', 'react', 'package', 'library', 'framework', 'application',
]);
const isDistinctive = (t) => t.length >= 4 && !GENERIC_TOKEN.has(t);

function judge(answer, truth) {
  const text = (answer || '').trim();
  if (!text) return { grade: 'BAD', why: 'empty answer' };
  if (REFUSAL.test(text)) return { grade: 'BAD', why: 'refused / claimed it cannot access the repo' };

  // No ground truth (GitHub unreachable / rate-limited) ⇒ we can't judge groundedness. That's an
  // INFRA SKIP, not a BAD answer (CodeRabbit #25) — don't punish the model for our missing data.
  if (!truth) return { grade: 'SKIP', why: 'no GitHub ground truth available — cannot judge (infra skip)' };

  const lower = text.toLowerCase();
  // Only DISTINCTIVE token matches count as real repo signals.
  const hits = truth.tokens.filter((t) => isDistinctive(t) && lower.includes(t));
  const hedges = (text.match(HEDGE) || []).length;

  if (hits.length >= 2) {
    return { grade: 'GOOD', why: `grounded in real repo signals: ${hits.slice(0, 5).join(', ')}` };
  }
  if (hits.length === 1 && hedges <= 1) {
    return { grade: 'OK', why: `one real signal (${hits[0]}) but thin` };
  }
  if (hedges >= 3) return { grade: 'BAD', why: `vague hallucination — ${hedges} hedge phrases, no grounded signals` };
  return { grade: 'BAD', why: 'no distinctive repo signals found in the answer' };
}

function ask(content) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const started = Date.now();
    let text = '';
    let thinking = null;
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve({ text, thinking, ms: Date.now() - started, timedOut: true }); }, 150000);
    ws.on('open', () => ws.send(JSON.stringify({
      conversationId: `interview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      content, mode: 'chat', processDepth: 'balanced', allowLearn: false,
    })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'text_delta' && m.textDelta) text += m.textDelta;
      if (m.type === 'error') { clearTimeout(timer); ws.close(); resolve({ error: m.error, ms: Date.now() - started }); }
      if (m.type === 'done') { thinking = m.thinking || null; clearTimeout(timer); ws.close(); resolve({ text, thinking, ms: Date.now() - started }); }
    });
    ws.on('error', (e) => { clearTimeout(timer); resolve({ error: String(e), ms: Date.now() - started }); });
  });
}

const tally = { GOOD: 0, OK: 0, BAD: 0, SKIP: 0 };
for (const repo of REPOS) {
  const truth = await groundTruth(repo);
  process.stderr.write(`\n# ${repo}\n  truth: ${truth ? `${truth.language} — ${truth.description}` : '(unavailable)'}\n`);
  for (const tmpl of ASK_TEMPLATES) {
    const q = tmpl(repo);
    process.stderr.write(`  asking: ${q}\n`);
    const r = await ask(q);
    console.log('\n' + '='.repeat(80));
    console.log(`Q: ${q}   (${r.ms}ms${r.timedOut ? ' TIMEOUT' : ''})`);
    if (r.error) { console.log('  ERROR:', r.error); tally.BAD++; continue; }
    const t = r.thinking || {};
    const council = t.council ? ` | council=${t.council.outcome} ${Math.round((t.council.agreement || 0) * 100)}%` : '';
    console.log(`  strategy=${t.strategy || '?'} conf=${t.confidence ?? '?'}${council}`);
    const verdict = judge(r.text, truth);
    tally[verdict.grade] = (tally[verdict.grade] || 0) + 1;
    console.log(`  VERDICT: ${verdict.grade} — ${verdict.why}`);
    console.log('  ── answer (first 700 chars) ──');
    console.log((r.text || '(empty)').trim().slice(0, 700).split('\n').map((l) => '  ' + l).join('\n'));
  }
}

console.log('\n' + '#'.repeat(80));
console.log(`INTERVIEW RESULT  GOOD=${tally.GOOD || 0}  OK=${tally.OK || 0}  BAD=${tally.BAD || 0}  SKIP=${tally.SKIP || 0}`);
process.exit((tally.BAD || 0) > 0 ? 1 : 0);
