#!/usr/bin/env node
/**
 * report — read-only summary of the improvement corpus: latest run pass-rates,
 * queued fix candidates, and campaign trend. No model calls; safe to run anytime.
 */
import { openDb, classStats, campaignTrend } from './db.mjs';

const DB_PATH = process.argv.includes('--db')
  ? process.argv[process.argv.indexOf('--db') + 1]
  : 'scripts/improve-loop/.corpus.sqlite';

const db = openDb(DB_PATH);
const lastRun = db.prepare('SELECT id, started_at, status FROM runs ORDER BY id DESC LIMIT 1').get();
if (!lastRun) { console.log('No runs yet. Run: node scripts/improve-loop/run.mjs'); process.exit(0); }

console.log(`\n━━━ Latest run #${lastRun.id} (${lastRun.status}) ━━━`);
for (const s of classStats(db, lastRun.id)) {
  const pct = s.total ? Math.round((s.passed / s.total) * 100) : 0;
  console.log(`  ${s.class.padEnd(34)} ${String(pct).padStart(3)}%  (${s.passed}/${s.total})`);
}

const fixes = db.prepare('SELECT class, failure_count, location, summary, status FROM fixes WHERE run_id = ? ORDER BY failure_count DESC').all(lastRun.id);
if (fixes.length) {
  console.log('\n━━━ Queued fix candidates (human-approve, never auto-applied) ━━━');
  for (const f of fixes) {
    console.log(`\n  • [${f.class}] ${f.failure_count} failures · ${f.status}`);
    console.log(`    where: ${f.location}`);
    console.log(`    ${f.summary}`);
  }
}

console.log('\n━━━ Failing prompts (latest run) ━━━');
const fails = db.prepare(
  `SELECT p.prompt, r.read_as, r.grade_reason
   FROM results r JOIN prompts p ON p.id = r.prompt_id
   WHERE r.run_id = ? AND r.passed = 0 ORDER BY r.class`,
).all(lastRun.id);
for (const f of fails.slice(0, 30)) {
  console.log(`  ✗ "${(f.prompt ?? '').slice(0, 60)}"`);
  console.log(`      read as: ${(f.read_as ?? '?').slice(0, 50)} — ${f.grade_reason ?? ''}`);
}

const trend = campaignTrend(db);
if (trend.length > 1) {
  console.log('\n━━━ Campaign trend (pass-rate per run) ━━━');
  for (const t of trend) {
    const pct = t.total ? Math.round((t.passed / t.total) * 100) : 0;
    console.log(`  run #${t.run_id}: ${String(pct).padStart(3)}%  (${t.passed}/${t.total})`);
  }
}
console.log('');
