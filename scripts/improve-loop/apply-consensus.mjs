#!/usr/bin/env node
/**
 * apply-consensus — close the audit→fix→verify loop. Reads the council's CONVERGED,
 * grep-verified fix proposals (the `consensus` table, written by consensus-fix.mjs) and runs
 * each through applyVerifiedFix with the REAL fs/verify/git deps: risk-gate → exact apply →
 * tsc(+tests) → commit to council/auto-improve if green, else revert. Risk-tier 'review'
 * proposals are NOT applied — they're left flagged for Vegga.
 *
 * SAFETY: the committer refuses unless HEAD is council/auto-improve (apply-runners.mjs). This
 * script is the only thing that turns a proposal into a commit, and it stays serial + verified.
 *
 * Usage:
 *   node scripts/improve-loop/apply-consensus.mjs                 # apply all unapplied, safe proposals
 *   node scripts/improve-loop/apply-consensus.mjs --dry-run       # classify + report, never write/commit
 *   node scripts/improve-loop/apply-consensus.mjs --db <path> --tsconfig packages/core/tsconfig.json
 */
import { openDb } from './db.mjs';
import { applyVerifiedFix } from './apply-fix.mjs';
import { realApplyDeps, currentBranch, AUTO_IMPROVE_BRANCH } from './apply-runners.mjs';
import { classifyRisk } from './risk-tier.mjs';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const DB_PATH = opt('--db', 'scripts/improve-loop/.corpus.sqlite');
const TSCONFIG = opt('--tsconfig', 'packages/core/tsconfig.json');

const db = openDb(DB_PATH);
// Track which proposals we've acted on so re-runs don't re-apply. Add the column once.
try { db.exec('ALTER TABLE consensus ADD COLUMN applied TEXT'); } catch { /* already exists */ }

const pending = (() => {
  try {
    return db.prepare("SELECT id,class,file,find,replace,why FROM consensus WHERE verified=1 AND (applied IS NULL OR applied='') ORDER BY id").all();
  } catch {
    return []; // no consensus table yet → nothing to apply
  }
})();

if (pending.length === 0) {
  console.log('No unapplied verified consensus proposals. Run consensus-fix.mjs first.');
  process.exit(0);
}

const head = currentBranch();
if (!DRY && head !== AUTO_IMPROVE_BRANCH) {
  console.log(`✋ HEAD is '${head}'. Auto-apply only commits to '${AUTO_IMPROVE_BRANCH}'.`);
  console.log(`   Switch there first:  git checkout -B ${AUTO_IMPROVE_BRANCH}   (or run --dry-run to preview)`);
  process.exit(1);
}

const deps = realApplyDeps({ pkgTsconfig: TSCONFIG, branch: AUTO_IMPROVE_BRANCH });
const summary = { applied: 0, reverted: 0, flagged: 0, skipped: 0 };
const flaggedForVegga = [];

for (const p of pending) {
  const proposal = { file: p.file, find: p.find, replace: p.replace ?? '', why: p.why };
  const risk = classifyRisk(proposal);
  process.stdout.write(`\n▸ [${p.class}] ${p.file}  (${risk.tier})\n`);

  if (DRY) {
    console.log(`   would ${risk.tier === 'safe' ? 'APPLY+verify' : 'FLAG for Vegga'} — ${risk.reasons.join('; ') || 'no risk signals'}`);
    continue;
  }

  const r = await applyVerifiedFix(proposal, deps);
  if (r.committed) {
    summary.applied++;
    db.prepare("UPDATE consensus SET applied='committed' WHERE id=?").run(p.id);
    console.log(`   ✅ applied + committed — ${r.verifyDetail}`);
  } else if (r.tier === 'review') {
    summary.flagged++;
    db.prepare("UPDATE consensus SET applied='flagged-review' WHERE id=?").run(p.id);
    flaggedForVegga.push({ file: p.file, class: p.class, reasons: r.reasons });
    console.log(`   ⚠ propose-only (risk tier) — left for Vegga: ${r.reasons.join('; ')}`);
  } else if (r.verifyDetail && /reverted/i.test(r.verifyDetail)) {
    summary.reverted++;
    db.prepare("UPDATE consensus SET applied='reverted-red' WHERE id=?").run(p.id);
    console.log(`   ↩ reverted — ${r.verifyDetail}`);
  } else {
    summary.skipped++;
    db.prepare("UPDATE consensus SET applied='skipped' WHERE id=?").run(p.id);
    console.log(`   – skipped: ${r.reasons.join('; ')}`);
  }
}

console.log(`\n━━━ apply-consensus ${DRY ? '(dry run) ' : ''}━━━`);
console.log(`applied+committed=${summary.applied}  reverted-red=${summary.reverted}  flagged-for-review=${summary.flagged}  skipped=${summary.skipped}`);
if (flaggedForVegga.length) {
  console.log('\n🫱 As your friend — these need YOUR eyes (risk-tier, not auto-applied):');
  for (const f of flaggedForVegga) console.log(`   • [${f.class}] ${f.file} — ${f.reasons.join('; ')}`);
}
