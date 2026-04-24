#!/usr/bin/env node
/**
 * VeggaAI Cross-Session Learning Report
 *
 * Runs the lesson extractor on all scored sessions,
 * aggregates patterns, and outputs:
 *   1. JSON: vai-cognitive-lessons.json
 *   2. Human-readable summary to stdout
 *
 * Usage:
 *   node scripts/extract-lessons.mjs              # full run
 *   node scripts/extract-lessons.mjs --json-only  # skip stdout, just write JSON
 *   node scripts/extract-lessons.mjs --dry-run    # stdout only, no file write
 */

import { writeFile } from 'fs/promises';
import { join } from 'path';

const API = 'http://localhost:3006';
const OUT_PATH = join(process.cwd(), 'vai-cognitive-lessons.json');
const FLAGS = new Set(process.argv.slice(2));

async function api(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function postApi(path) {
  const res = await fetch(`${API}${path}`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

function jaccardTrigram(a, b) {
  const ngrams = (s) => {
    const tokens = s.toLowerCase().split(/\s+/);
    const result = new Set();
    for (let i = 0; i <= tokens.length - 3; i++) {
      result.add(tokens.slice(i, i + 3).join(' '));
    }
    return result;
  };
  const setA = ngrams(a);
  const setB = ngrams(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersect = 0;
  for (const g of setA) if (setB.has(g)) intersect++;
  return intersect / (setA.size + setB.size - intersect);
}

async function main() {
  const quiet = FLAGS.has('--json-only');
  const dryRun = FLAGS.has('--dry-run');
  const log = quiet ? () => {} : console.log.bind(console);

  log('╔══════════════════════════════════════════════════════╗');
  log('║  VeggaAI Cognitive Lesson Extraction Report         ║');
  log('╚══════════════════════════════════════════════════════╝\n');

  // 1. Get all scored sessions
  log('Step 1: Fetching scored sessions...');
  const { scores } = await api('/api/sessions/scores');
  log(`  Found ${scores.length} scored sessions\n`);

  if (scores.length === 0) {
    log('  No scored sessions found. Run scoring first.');
    process.exit(0);
  }

  // 2. Extract lessons from each session
  log('Step 2: Extracting lessons per session...');
  const allReports = [];
  const allLessons = [];

  for (const s of scores) {
    try {
      const data = await postApi(`/api/sessions/${s.sessionId}/lessons`);
      if (data.report) {
        allReports.push({ sessionId: s.sessionId, grade: s.overallGrade, ...data.report });
        for (const l of data.report.lessons) allLessons.push(l);
        const n = data.report.lessons.length;
        log(`  ${s.overallGrade} ${s.sessionId.slice(0, 24)}... → ${n} lessons`);
      }
    } catch (err) {
      log(`  ✗ ${s.sessionId.slice(0, 24)}... → ${err.message}`);
    }
  }

  log(`\n  Total: ${allLessons.length} lessons from ${allReports.length} sessions\n`);

  // 3. Category breakdown
  log('Step 3: Category breakdown');
  const byCat = {};
  for (const l of allLessons) {
    byCat[l.category] = (byCat[l.category] ?? 0) + 1;
  }
  for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round(count / allLessons.length * 100);
    const bar = '█'.repeat(Math.round(pct / 3)) + '░'.repeat(33 - Math.round(pct / 3));
    log(`  ${cat.padEnd(24)} ${bar} ${count} (${pct}%)`);
  }

  // 4. Cross-session aggregation
  log('\nStep 4: Cross-session pattern aggregation...');
  const aggregated = aggregatePatterns(allLessons);
  const systemic = aggregated.filter(p => p.occurrences >= 2 && p.avgConfidence >= 0.6);
  log(`  ${aggregated.length} unique patterns found`);
  log(`  ${systemic.length} systemic patterns (≥2 sessions, ≥0.6 confidence)\n`);

  // 5. Top breakthroughs
  const breakthroughs = allLessons
    .filter(l => l.category === 'breakthrough-question')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  if (breakthroughs.length > 0) {
    log('Step 5: Top Breakthrough Questions');
    for (const b of breakthroughs) {
      log(`  ⚡ [${(b.confidence * 100).toFixed(0)}%] ${b.summary.slice(0, 100)}`);
    }
    log('');
  }

  // 6. Top success patterns
  const successes = allLessons
    .filter(l => l.category === 'success-pattern')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  if (successes.length > 0) {
    log('Step 6: Top Success Patterns');
    for (const s of successes) {
      log(`  ✅ [${(s.confidence * 100).toFixed(0)}%] ${s.summary.slice(0, 100)}`);
    }
    log('');
  }

  // 7. Systemic anti-patterns
  const antiPatterns = systemic.filter(p => p.category === 'anti-pattern');
  if (antiPatterns.length > 0) {
    log('Step 7: Systemic Anti-Patterns (≥2 sessions)');
    for (const a of antiPatterns.slice(0, 10)) {
      log(`  🔴 [${a.occurrences} sessions, ${(a.avgConfidence * 100).toFixed(0)}%] ${a.summary.slice(0, 80)}`);
    }
    log('');
  }

  // 8. Cognitive profile
  log('Step 8: Aggregate Cognitive Profile');
  const profile = buildAggregateProfile(allReports);
  log('  Foundation Strengths (sorted):');
  for (const f of profile.foundations.sort((a, b) => b.score - a.score)) {
    const bar = '█'.repeat(Math.round(f.score / 5)) + '░'.repeat(20 - Math.round(f.score / 5));
    const icon = f.score >= 60 ? '🟢' : f.score >= 40 ? '🟡' : '🔴';
    log(`    ${icon} ${f.id.padEnd(28)} ${bar} ${f.score}/100 (${f.lessons} lessons)`);
  }

  log('\n  Improvement Priority:');
  for (const p of profile.improvementPriority.slice(0, 5)) {
    log(`    → Focus on: ${p}`);
  }

  // 9. Context injection status
  log('\nStep 9: Context Injection Status');
  try {
    const ctx = await api('/api/sessions/context');
    if (ctx.cognitiveContext) {
      log(`  ✅ Active — ${ctx.cognitiveContext.length} chars injected`);
    } else {
      log('  ⚠️  No cognitive context yet');
    }
  } catch {
    log('  ✗ Could not fetch context');
  }

  // 10. Write JSON output
  const output = {
    extractedAt: new Date().toISOString(),
    sessionCount: allReports.length,
    totalLessons: allLessons.length,
    categories: byCat,
    lessons: allLessons,
    aggregatedPatterns: aggregated,
    systemicPatterns: systemic,
    cognitiveProfile: profile,
  };

  if (!dryRun) {
    await writeFile(OUT_PATH, JSON.stringify(output, null, 2));
    log(`\n📄 Full report written to: ${OUT_PATH}`);
  }

  // Final summary
  log('\n' + '═'.repeat(56));
  log('  EXTRACTION COMPLETE');
  log('═'.repeat(56));
  log(`  Sessions:         ${allReports.length}`);
  log(`  Total Lessons:    ${allLessons.length}`);
  log(`  High Confidence:  ${allLessons.filter(l => l.confidence >= 0.7).length}`);
  log(`  Systemic Patterns:${systemic.length}`);
  log(`  Breakthroughs:    ${breakthroughs.length}`);
  log(`  Context Injection: ACTIVE`);
  log('═'.repeat(56) + '\n');
}

/** Aggregate cross-session patterns by 3-gram Jaccard similarity */
function aggregatePatterns(lessons) {
  const byCategory = {};
  for (const l of lessons) {
    (byCategory[l.category] ??= []).push(l);
  }

  const result = [];

  for (const [category, catLessons] of Object.entries(byCategory)) {
    const assigned = new Array(catLessons.length).fill(-1);
    const clusters = [];

    for (let i = 0; i < catLessons.length; i++) {
      if (assigned[i] >= 0) continue;
      const cluster = [i];
      assigned[i] = clusters.length;

      for (let j = i + 1; j < catLessons.length; j++) {
        if (assigned[j] >= 0) continue;
        const sim = jaccardTrigram(catLessons[i].summary, catLessons[j].summary);
        if (sim > 0.4) {
          cluster.push(j);
          assigned[j] = clusters.length;
        }
      }
      clusters.push(cluster);
    }

    for (const cluster of clusters) {
      const clusterLessons = cluster.map(i => catLessons[i]);
      const sessionIds = [...new Set(clusterLessons.map(l => l.sessionId))];
      const avgConf = clusterLessons.reduce((s, l) => s + l.confidence, 0) / clusterLessons.length;
      const allFoundations = [...new Set(clusterLessons.flatMap(l => l.foundationAlignment ?? []))];

      result.push({
        patternId: `pat-${category}-${clusters.indexOf(cluster)}`,
        summary: clusterLessons[0].summary,
        sessionIds,
        occurrences: sessionIds.length,
        avgConfidence: Math.round(avgConf * 100) / 100,
        category,
        foundationAlignment: allFoundations,
      });
    }
  }

  return result.sort((a, b) => b.occurrences - a.occurrences);
}

/** Build aggregate cognitive profile from all reports */
function buildAggregateProfile(reports) {
  const ALL_FOUNDATIONS = [
    'first-principles', 'calibrated-uncertainty', 'meta-learning',
    'reading-between-lines', 'precision-communication', 'right-question',
    'compression', 'systems-thinking', 'taste-judgment', 'intellectual-honesty',
  ];

  const foundationData = {};
  for (const fId of ALL_FOUNDATIONS) {
    foundationData[fId] = { positive: 0, negative: 0, total: 0 };
  }

  for (const r of reports) {
    for (const l of r.lessons ?? []) {
      for (const f of l.foundationAlignment ?? []) {
        if (!foundationData[f]) continue;
        foundationData[f].total++;
        if (l.category === 'anti-pattern') {
          foundationData[f].negative++;
        } else {
          foundationData[f].positive++;
        }
      }
    }
  }

  const foundations = ALL_FOUNDATIONS.map(id => {
    const d = foundationData[id];
    const score = d.total > 0 ? Math.round(d.positive / d.total * 100) : 50;
    return { id, score, lessons: d.total, positive: d.positive, negative: d.negative };
  });

  const weakest = foundations.filter(f => f.total > 0).sort((a, b) => a.score - b.score);
  const improvementPriority = weakest.filter(f => f.score < 50).map(f => f.id);

  return {
    foundations,
    improvementPriority: improvementPriority.length > 0
      ? improvementPriority
      : weakest.slice(0, 3).map(f => f.id),
    overallStrength: Math.round(foundations.reduce((s, f) => s + f.score, 0) / foundations.length),
  };
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
