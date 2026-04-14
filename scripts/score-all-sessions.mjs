#!/usr/bin/env node
/**
 * score-all-sessions.mjs — Batch-score all sessions via the runtime API.
 *
 * Usage:
 *   node scripts/score-all-sessions.mjs [--limit N] [--dry-run] [--extract]
 *
 * Options:
 *   --limit N    Max sessions to score (default: all)
 *   --dry-run    Show what would be scored without calling POST
 *   --extract    Also extract lessons for each scored session
 *
 * Requires runtime server on http://localhost:3006
 */

const BASE = process.env.VAI_API ?? 'http://localhost:3006';

// ── Arg parsing ────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const EXTRACT = args.includes('--extract');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity;

// ── API helpers ────────────────────────────────────────────────

async function api(method, path, body) {
  const url = `${BASE}${path}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Fetching sessions from ${BASE}...\n`);

  const { sessions } = await api('GET', '/api/sessions?limit=1000');
  const total = sessions.length;
  const toScore = sessions.slice(0, Math.min(total, LIMIT));

  console.log(`  Total sessions: ${total}`);
  console.log(`  Will score:     ${toScore.length}${DRY_RUN ? ' (dry-run)' : ''}`);
  if (EXTRACT) console.log('  Will also extract lessons');
  console.log();

  const results = { scored: 0, skipped: 0, failed: 0, extracted: 0 };
  const grades = {};
  const errors = [];

  for (const session of toScore) {
    const id = session.id;
    const label = `${id.slice(0, 30)}…`;

    if (DRY_RUN) {
      console.log(`  [dry-run] Would score: ${label}`);
      results.skipped++;
      continue;
    }

    try {
      const { score } = await api('POST', `/api/sessions/${encodeURIComponent(id)}/score`);
      const grade = score?.overallGrade ?? '?';
      const overall = score?.overall?.toFixed(1) ?? '?';
      grades[grade] = (grades[grade] ?? 0) + 1;
      results.scored++;
      console.log(`  ✅ ${label}  overall=${overall}  grade=${grade}`);

      if (EXTRACT) {
        try {
          await api('POST', `/api/sessions/${encodeURIComponent(id)}/lessons`);
          results.extracted++;
        } catch (e) {
          console.log(`     ⚠️  Lesson extraction failed: ${e.message}`);
        }
      }
    } catch (e) {
      results.failed++;
      errors.push({ id, error: e.message });
      console.log(`  ❌ ${label}  ${e.message}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────

  console.log('\n━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Scored:    ${results.scored}`);
  console.log(`  Skipped:   ${results.skipped}`);
  console.log(`  Failed:    ${results.failed}`);
  if (EXTRACT) console.log(`  Extracted: ${results.extracted}`);
  console.log();

  if (Object.keys(grades).length > 0) {
    console.log('  Grade distribution:');
    for (const g of ['S', 'A', 'B', 'C', 'D', 'F']) {
      if (grades[g]) console.log(`    ${g}: ${grades[g]}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n  Errors (${errors.length}):`);
    for (const { id, error } of errors.slice(0, 5)) {
      console.log(`    - ${id.slice(0, 30)}…: ${error}`);
    }
    if (errors.length > 5) console.log(`    ... and ${errors.length - 5} more`);
  }

  console.log();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(2);
});
