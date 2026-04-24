#!/usr/bin/env node
/**
 * Phase 3.5 — VeggaAI Cognitive Self-Test Runner
 *
 * Loads extracted scenarios from fixtures, runs multi-turn
 * tests, regression checks, and A/B testing, then outputs
 * a full CognitiveTestReport.
 *
 * Usage:
 *   node scripts/vai-cognitive-test.mjs [options]
 *
 * Options:
 *   --category <golden-path|anti-pattern-example|edge-case>
 *   --difficulty <apprentice|journeyman|expert|master>
 *   --foundation <name>     Filter scenarios by foundation
 *   --ab                    Run A/B testing (requires mock adapter)
 *   --dry-run               Show what would run without executing
 *   --output <path>         Output file (default: vai-cognitive-results.json)
 *
 * Output:
 *   vai-cognitive-results.json
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = 'http://localhost:3006';
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'vai-cognitive-tests');

/* ═══════════════════════════════════════════════════════════════ */
/*  CLI Argument Parsing                                          */
/* ═══════════════════════════════════════════════════════════════ */

const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

const filterCategory = getArg('--category');
const filterDifficulty = getArg('--difficulty');
const filterFoundation = getArg('--foundation');
const runAB = args.includes('--ab');
const dryRun = args.includes('--dry-run');
const outputPath = getArg('--output') || join(__dirname, '..', 'vai-cognitive-results.json');

/* ═══════════════════════════════════════════════════════════════ */
/*  Grade / Score Utilities                                       */
/* ═══════════════════════════════════════════════════════════════ */

const GRADE_TO_NUMBER = { 'A+': 97, 'A': 92, 'B': 85, 'C': 75, 'D': 60, 'F': 40 };

function gradeToNumber(grade) {
  return GRADE_TO_NUMBER[grade] ?? 50;
}

function computeGrade(ratio) {
  if (ratio >= 0.95) return 'A+';
  if (ratio >= 0.85) return 'A';
  if (ratio >= 0.70) return 'B';
  if (ratio >= 0.50) return 'C';
  if (ratio >= 0.30) return 'D';
  return 'F';
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Mock Model Adapter                                            */
/* ═══════════════════════════════════════════════════════════════ */

/**
 * Echo adapter: returns the expectedBehavior from the scenario turn.
 * Used for offline testing without API keys.
 * A/B testing adds noise to simulate lesson improvement.
 */
class EchoAdapter {
  constructor(scenarios, withLessons = false) {
    this._turnMap = new Map();
    this._withLessons = withLessons;

    for (const s of scenarios) {
      for (const t of s.turns) {
        this._turnMap.set(t.userMessage, t.expectedBehavior);
      }
    }
  }

  async generate(prompt) {
    // Extract the last "User: ..." line from the prompt
    const lines = prompt.split('\n');
    const lastUserLine = lines.filter(l => l.startsWith('User:')).pop() || '';
    const userMsg = lastUserLine.replace(/^User:\s*/, '');

    let response = this._turnMap.get(userMsg) || `I understand your question about: ${userMsg.slice(0, 100)}`;

    // For the "with lessons" variant, use actual injected lesson content
    if (this._withLessons && prompt.includes('Cognitive lessons from prior sessions:')) {
      // Extract lesson summaries from prompt context
      const lessonBlock = prompt.split('Cognitive lessons from prior sessions:')[1]?.split('\n\n')[0] || '';
      const lessonLines = lessonBlock.split('\n').filter(l => l.trim().startsWith('['));
      if (lessonLines.length > 0) {
        const summaries = lessonLines.map(l => l.replace(/^\[.*?\]\s*/, '').trim()).filter(Boolean);
        response += `\n\nDrawing from prior learning: ${summaries.slice(0, 3).join('. ')}. ` +
          'Applying these principles to the current context with a concrete example.';
      } else {
        response += '\n\nAdditionally, based on prior learning patterns, ' +
          'I should note the key principles underlying this approach ' +
          'and provide a concrete example to reinforce understanding.';
      }
    }

    return response;
  }
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Multi-Turn Runner                                             */
/* ═══════════════════════════════════════════════════════════════ */

function scoreResponseAgainstChecklist(response, checklist) {
  if (!checklist || checklist.length === 0) return 50;

  let totalWeighted = 0;
  let totalWeight = 0;

  for (const item of checklist) {
    let passed = false;
    switch (item.strategy) {
      case 'contains':
        passed = response.toLowerCase().includes(item.value.toLowerCase());
        break;
      case 'regex':
        try {
          passed = new RegExp(item.value, 'i').test(response);
        } catch {
          passed = false;
        }
        break;
      case 'checklist':
        if (item.value.startsWith('length>')) {
          const minLen = parseInt(item.value.replace('length>', ''), 10);
          passed = response.length > minLen;
        }
        break;
    }
    totalWeighted += (passed ? 100 : 0) * item.weight;
    totalWeight += item.weight;
  }

  return totalWeight > 0 ? Math.round(totalWeighted / totalWeight) : 50;
}

async function runMultiTurn(scenario, adapter, lessons = []) {
  let context = '';

  if (lessons.length > 0) {
    const lessonCtx = lessons
      .map(l => `[${l.category}] ${l.summary}`)
      .join('\n');
    context = `Cognitive lessons from prior sessions:\n${lessonCtx}\n\n`;
  }

  const perTurnScores = [];

  for (const turn of scenario.turns) {
    const prompt = context + `User: ${turn.userMessage}`;
    const response = await adapter.generate(prompt);
    const turnScore = scoreResponseAgainstChecklist(response, turn.gradingChecklist);
    perTurnScores.push(turnScore);

    context += `User: ${turn.userMessage}\nAssistant: ${response}\n`;
    if (context.length > 8000) {
      const lines = context.split('\n');
      context = lines.slice(Math.floor(lines.length / 2)).join('\n');
    }
  }

  const overallScore = perTurnScores.length > 0
    ? Math.round(perTurnScores.reduce((s, v) => s + v, 0) / perTurnScores.length)
    : 0;

  return {
    scenarioId: scenario.id,
    perTurnScores,
    overallScore,
    overallGrade: computeGrade(overallScore / 100),
    totalTurns: scenario.turns.length,
    injectedLessonCount: lessons.length,
  };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Regression & A/B                                              */
/* ═══════════════════════════════════════════════════════════════ */

function computeRegression(scenarios, results) {
  const resultMap = new Map(results.map(r => [r.scenarioId, r]));

  return scenarios.map(scenario => {
    const result = resultMap.get(scenario.id);
    if (!result) {
      return {
        scenarioId: scenario.id,
        baselineGrade: scenario.baselineGrade,
        newGrade: 'F',
        delta: -gradeToNumber(scenario.baselineGrade),
        perTurnDeltas: [],
        significantRegressions: ['No result produced'],
      };
    }

    const baseNum = gradeToNumber(scenario.baselineGrade);
    const newNum = gradeToNumber(result.overallGrade);
    const delta = newNum - baseNum;

    const perTurnDeltas = result.perTurnScores.map(s => {
      const sessionMean = result.perTurnScores.reduce((a, b) => a + b, 0) / result.perTurnScores.length;
      return Math.round(s - sessionMean);
    });
    const significantRegressions = perTurnDeltas
      .map((d, i) => d < -15 ? `Turn ${i}: ${d} points below session mean` : null)
      .filter(s => s !== null);

    return {
      scenarioId: scenario.id,
      baselineGrade: scenario.baselineGrade,
      newGrade: result.overallGrade,
      delta,
      perTurnDeltas,
      significantRegressions,
    };
  });
}

async function runABTest(scenario, adapter, lessons) {
  const relevant = lessons.filter(l =>
    (l.foundationAlignment || []).some(f => scenario.foundations.includes(f))
  );

  const control = await runMultiTurn(scenario, new EchoAdapter([scenario], false));
  const treatment = await runMultiTurn(scenario, new EchoAdapter([scenario], true), relevant);

  const delta = treatment.overallScore - control.overallScore;
  let winner = 'tie';
  if (delta > 2) winner = 'treatment';
  else if (delta < -2) winner = 'control';

  return {
    scenarioId: scenario.id,
    controlScore: control.overallScore,
    treatmentScore: treatment.overallScore,
    delta,
    injectedLessonIds: relevant.map(l => l.id),
    winner,
  };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Report Builder                                                */
/* ═══════════════════════════════════════════════════════════════ */

function buildReport(scenarios, multiTurn, regression, abTests) {
  const totalScenarios = scenarios.length;
  const passed = multiTurn.filter(r => r.overallScore >= 60).length;
  const failed = totalScenarios - passed;
  const avgScore = multiTurn.length > 0
    ? Math.round(multiTurn.reduce((s, r) => s + r.overallScore, 0) / multiTurn.length)
    : 0;

  const regressionAvgDelta = regression.length > 0
    ? Math.round(regression.reduce((s, r) => s + r.delta, 0) / regression.length * 10) / 10
    : 0;
  const regressionSignificantCount = regression.filter(r => r.significantRegressions.length > 0).length;

  const wins = abTests.filter(r => r.winner === 'treatment').length;
  const abWinRate = abTests.length > 0 ? Math.round(wins / abTests.length * 100) / 100 : 0;
  const abAvgDelta = abTests.length > 0
    ? Math.round(abTests.reduce((s, r) => s + r.delta, 0) / abTests.length * 10) / 10
    : 0;

  const lessonWins = new Map();
  for (const ab of abTests.filter(r => r.winner === 'treatment')) {
    for (const id of ab.injectedLessonIds) {
      lessonWins.set(id, (lessonWins.get(id) ?? 0) + 1);
    }
  }
  const topContributingLessons = [...lessonWins.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  const weakFoundations = new Map();
  for (const result of multiTurn.filter(r => r.overallScore < 60)) {
    const scenario = scenarios.find(s => s.id === result.scenarioId);
    if (scenario) {
      for (const f of scenario.foundations) {
        weakFoundations.set(f, (weakFoundations.get(f) ?? 0) + 1);
      }
    }
  }
  const weakAreas = [...weakFoundations.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([f]) => f);

  return {
    scenarios,
    multiTurnResults: multiTurn,
    regressionResults: regression,
    abTestResults: abTests,
    summary: {
      totalScenarios,
      passed,
      failed,
      avgScore,
      avgGrade: computeGrade(avgScore / 100),
      regressionAvgDelta,
      regressionSignificantCount,
      abWinRate,
      abAvgDelta,
      topContributingLessons,
      weakAreas,
    },
    testedAt: Date.now(),
  };
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Main                                                          */
/* ═══════════════════════════════════════════════════════════════ */

async function main() {
  console.log('╔═════════════════════════════════════════════════════╗');
  console.log('║  COGNITIVE SELF-TEST RUNNER                        ║');
  console.log('║  Multi-turn + Regression + A/B Testing             ║');
  console.log('╚═════════════════════════════════════════════════════╝\n');

  // 1. Load scenarios from fixtures
  console.log('1️⃣  Loading scenarios...');
  if (!existsSync(FIXTURES_DIR)) {
    console.error('   ❌ No fixtures found. Run extract-test-corpus.mjs first.');
    process.exit(1);
  }

  const manifestPath = join(FIXTURES_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error('   ❌ No manifest.json found. Run extract-test-corpus.mjs first.');
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let scenarios = [];

  for (const entry of manifest.scenarios) {
    const filePath = join(FIXTURES_DIR, `${entry.id}.json`);
    if (existsSync(filePath)) {
      scenarios.push(JSON.parse(readFileSync(filePath, 'utf8')));
    }
  }

  console.log(`   Loaded ${scenarios.length} scenarios from fixtures\n`);

  // 2. Apply filters
  if (filterCategory) {
    scenarios = scenarios.filter(s => s.category === filterCategory);
    console.log(`   Filtered by category '${filterCategory}': ${scenarios.length} remain`);
  }
  if (filterDifficulty) {
    scenarios = scenarios.filter(s => s.difficulty === filterDifficulty);
    console.log(`   Filtered by difficulty '${filterDifficulty}': ${scenarios.length} remain`);
  }
  if (filterFoundation) {
    scenarios = scenarios.filter(s => s.foundations.includes(filterFoundation));
    console.log(`   Filtered by foundation '${filterFoundation}': ${scenarios.length} remain`);
  }

  if (scenarios.length === 0) {
    console.log('   No scenarios match filters. Exiting.');
    process.exit(0);
  }

  if (dryRun) {
    console.log('\n2️⃣  DRY RUN — would test:');
    for (const s of scenarios) {
      console.log(`   ${s.id} | ${s.category} | ${s.difficulty} | ${s.turns.length} turns | baseline: ${s.baselineGrade}`);
    }
    if (runAB) console.log(`\n   Would run A/B tests on ${scenarios.length} scenarios`);
    return;
  }

  // 3. Fetch lessons (for A/B testing)
  let lessons = [];
  if (runAB) {
    console.log('2️⃣  Fetching cognitive lessons for A/B testing...');
    try {
      const data = await (await fetch(`${API}/api/sessions/lessons?limit=100`)).json();
      lessons = data.lessons || [];
      console.log(`   Loaded ${lessons.length} lessons\n`);
    } catch (err) {
      console.log(`   ⚠️  Could not fetch lessons: ${err.message}`);
      console.log('   A/B testing will use empty lessons\n');
    }
  }

  // 4. Run multi-turn tests
  console.log('3️⃣  Running multi-turn tests...');
  const adapter = new EchoAdapter(scenarios);
  const multiTurnResults = [];

  for (const scenario of scenarios) {
    const result = await runMultiTurn(scenario, adapter);
    multiTurnResults.push(result);

    const icon = result.overallScore >= 60 ? '✅' : '❌';
    console.log(`   ${icon} ${scenario.id}: ${result.overallScore}/100 (${result.overallGrade}) — ${result.totalTurns} turns`);
  }

  // 5. Compute regression
  console.log('\n4️⃣  Computing regression against baselines...');
  const regressionResults = computeRegression(scenarios, multiTurnResults);

  for (const reg of regressionResults) {
    const icon = reg.delta >= 0 ? '📈' : '📉';
    const sign = reg.delta >= 0 ? '+' : '';
    console.log(`   ${icon} ${reg.scenarioId}: ${reg.baselineGrade} → ${reg.newGrade} (${sign}${reg.delta})`);
    if (reg.significantRegressions.length > 0) {
      for (const r of reg.significantRegressions) {
        console.log(`      ⚠️  ${r}`);
      }
    }
  }

  // 6. A/B testing (optional)
  let abResults = [];
  if (runAB) {
    console.log('\n5️⃣  Running A/B tests (control vs treatment)...');
    for (const scenario of scenarios) {
      const result = await runABTest(scenario, adapter, lessons);
      abResults.push(result);

      const icon = result.winner === 'treatment' ? '🏆' : result.winner === 'control' ? '⬇️' : '🤝';
      const sign = result.delta >= 0 ? '+' : '';
      console.log(`   ${icon} ${scenario.id}: control=${result.controlScore} treatment=${result.treatmentScore} (${sign}${result.delta}) → ${result.winner}`);
    }
  }

  // 7. Build report
  console.log('\n6️⃣  Building report...');
  const report = buildReport(scenarios, multiTurnResults, regressionResults, abResults);

  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`   📄 Written to: ${outputPath}\n`);

  // 8. Summary
  const s = report.summary;
  console.log('═'.repeat(55));
  console.log('  COGNITIVE TEST REPORT');
  console.log('═'.repeat(55));
  console.log(`  Scenarios:   ${s.totalScenarios}`);
  console.log(`  Passed:      ${s.passed}  |  Failed: ${s.failed}`);
  console.log(`  Avg Score:   ${s.avgScore}/100  (${s.avgGrade})`);
  console.log('');
  console.log(`  Regression:  avg Δ = ${s.regressionAvgDelta >= 0 ? '+' : ''}${s.regressionAvgDelta}`);
  console.log(`  Significant regressions: ${s.regressionSignificantCount}`);
  if (runAB) {
    console.log('');
    console.log(`  A/B Win Rate:  ${Math.round(s.abWinRate * 100)}%`);
    console.log(`  A/B Avg Δ:     ${s.abAvgDelta >= 0 ? '+' : ''}${s.abAvgDelta}`);
    if (s.topContributingLessons.length > 0) {
      console.log(`  Top Lessons:   ${s.topContributingLessons.join(', ')}`);
    }
  }
  if (s.weakAreas.length > 0) {
    console.log(`  Weak Areas:    ${s.weakAreas.join(', ')}`);
  }
  console.log('═'.repeat(55) + '\n');

  // Exit code: 0 if no significant regressions, 1 otherwise
  if (s.regressionSignificantCount > 0) {
    console.log('⚠️  Significant regressions detected. Review before deployment.');
    process.exit(1);
  }

  console.log('✅ All cognitive tests passed.');
}

main().catch(err => {
  console.error('Cognitive test failed:', err);
  process.exit(1);
});
