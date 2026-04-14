#!/usr/bin/env node
/**
 * Phase 3.1 — Extract Cognitive Test Corpus
 *
 * Reads all scored sessions from the DB, feeds them through
 * extractScenarios(), and writes JSON fixture files.
 *
 * Usage:
 *   node scripts/extract-test-corpus.mjs [--max 20] [--dry-run]
 *
 * Output:
 *   fixtures/vai-cognitive-tests/cog-{id}-{n}.json
 *   fixtures/vai-cognitive-tests/manifest.json
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = 'http://localhost:3006';
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'vai-cognitive-tests');

const args = process.argv.slice(2);
const maxScenarios = parseInt(args.find((_, i, a) => a[i - 1] === '--max') || '20', 10);
const dryRun = args.includes('--dry-run');

/* ═══════════════════════════════════════════════════════════════ */

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function gradeToNumber(grade) {
  return { 'A+': 97, 'A': 92, 'B': 85, 'C': 75, 'D': 60, 'F': 40 }[grade] ?? 50;
}

function sanitizePII(text) {
  return (text || '')
    .replace(/C:\\Users\\[^\\]+/gi, '[REDACTED]')
    .replace(/\/home\/[^/]+/gi, '[REDACTED]')
    .replace(/\/Users\/[^/]+/gi, '[REDACTED]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED]');
}

function truncate(text, max) {
  return text.length <= max ? text : text.slice(0, max - 3) + '...';
}

function extractTechnicalDensity(text) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return 0;
  const matches = text.match(/\b(?:function|const|let|var|class|import|export|async|await|return|throw|catch|try|interface|type|enum|Promise|Array|Object|Map|Set|Error)\b/gi) || [];
  return matches.length / words.length;
}

function classifyDifficulty(avgWordCount, technicalDensity) {
  const complexity = avgWordCount * 0.3 + technicalDensity * 100 * 0.7;
  if (complexity > 50) return 'master';
  if (complexity > 30) return 'expert';
  if (complexity > 15) return 'journeyman';
  return 'apprentice';
}

/* ═══════════════════════════════════════════════════════════════ */

async function main() {
  console.log('╔═════════════════════════════════════════════════════╗');
  console.log('║  COGNITIVE TEST CORPUS EXTRACTION                  ║');
  console.log('║  Extract scenarios from scored sessions → JSON     ║');
  console.log('╚═════════════════════════════════════════════════════╝\n');

  // 1. Fetch all scored sessions
  console.log('1️⃣  Fetching scored sessions...');
  let scores;
  try {
    const data = await fetchJSON(`${API}/api/sessions/scores?limit=100`);
    scores = data.scores || data;
    console.log(`   Found ${scores.length} scored sessions\n`);
  } catch (err) {
    console.error(`   ❌ Failed to fetch scores: ${err.message}`);
    console.error('   Is the runtime server running on port 3006?');
    process.exit(1);
  }

  if (scores.length === 0) {
    console.log('   No scored sessions found. Score some sessions first:');
    console.log('   POST /api/sessions/:id/score');
    process.exit(0);
  }

  // 2. Fetch session details for each scored session
  console.log('2️⃣  Fetching session events & turn pairs...');
  const sessions = [];
  for (const s of scores) {
    const sessionId = s.sessionId || s.session_id;
    try {
      const detail = await fetchJSON(`${API}/api/sessions/${sessionId}`);
      const events = detail.events || [];
      const stats = detail.stats || detail;
      const score = typeof s.scoreData === 'string' ? JSON.parse(s.scoreData) : s.scoreData || s;

      // Build simplified turn pairs from events
      const turnPairs = [];
      let currentUser = null;
      let pairIndex = 0;
      for (const ev of events) {
        const meta = typeof ev.meta === 'string' ? JSON.parse(ev.meta) : ev.meta || {};
        if (meta.role === 'user' || (ev.type === 'message' && meta.eventType === 'message' && meta.role === 'user')) {
          if (currentUser) {
            turnPairs.push({ index: pairIndex++, userMessage: currentUser, assistantResponse: null, toolCalls: [], thinkingBlocks: [], planningEvents: [], durationMs: 0, turnaroundEvents: 0 });
          }
          currentUser = { content: ev.content || '', type: ev.type };
        } else if (meta.role === 'assistant' && currentUser) {
          turnPairs.push({ index: pairIndex++, userMessage: currentUser, assistantResponse: { content: ev.content || '', type: ev.type }, toolCalls: [], thinkingBlocks: [], planningEvents: [], durationMs: 0, turnaroundEvents: 0 });
          currentUser = null;
        }
      }
      if (currentUser) {
        turnPairs.push({ index: pairIndex++, userMessage: currentUser, assistantResponse: null, toolCalls: [], thinkingBlocks: [], planningEvents: [], durationMs: 0, turnaroundEvents: 0 });
      }

      if (turnPairs.length === 0) continue;

      sessions.push({
        sessionId,
        title: detail.title || stats.title || `Session ${sessionId.slice(0, 8)}`,
        score,
        turnPairs,
        events: events.map(e => ({ content: e.content || '', type: e.type })),
      });
      process.stdout.write(`   ✅ ${sessionId.slice(0, 12)}... (${turnPairs.length} turns)\n`);
    } catch (err) {
      process.stdout.write(`   ⚠️  ${sessionId.slice(0, 12)}... skipped: ${err.message}\n`);
    }
  }

  console.log(`\n   Loaded ${sessions.length} sessions with turn pairs\n`);

  if (sessions.length === 0) {
    console.log('   No sessions had extractable turn pairs.');
    process.exit(0);
  }

  // 3. Categorize and build scenarios
  console.log('3️⃣  Extracting scenarios...');
  const scenarios = [];
  let idx = 0;

  // Golden paths: grade >= B, turns >= 3
  const golden = sessions.filter(s => {
    const grade = s.score.overallGrade || s.score.overall_grade;
    const turnCount = s.score.turnPairCount ?? s.turnPairs.length;
    const apScore = s.score.antiPatterns?.score ?? 100;
    return gradeToNumber(grade) >= 85 && turnCount >= 3 && apScore >= 80;
  });
  console.log(`   Golden paths: ${golden.length} sessions qualify`);
  for (const s of golden.slice(0, Math.ceil(maxScenarios * 0.5))) {
    scenarios.push(buildScenario(s, 'golden-path', idx++));
  }

  // Anti-pattern examples: grade <= D OR antiPatterns.score <= 50
  const antiPattern = sessions.filter(s => {
    const grade = s.score.overallGrade || s.score.overall_grade;
    const apScore = s.score.antiPatterns?.score ?? 100;
    return gradeToNumber(grade) <= 60 || apScore <= 50;
  });
  console.log(`   Anti-pattern examples: ${antiPattern.length} sessions qualify`);
  for (const s of antiPattern.slice(0, Math.ceil(maxScenarios * 0.25))) {
    scenarios.push(buildScenario(s, 'anti-pattern-example', idx++));
  }

  // Edge cases: very long (>20 turns) or very short (1-2 turns)
  const edgeCases = sessions.filter(s =>
    s.turnPairs.length > 20 || (s.turnPairs.length <= 2 && s.turnPairs.length > 0)
  );
  console.log(`   Edge cases: ${edgeCases.length} sessions qualify`);
  for (const s of edgeCases.slice(0, Math.ceil(maxScenarios * 0.25))) {
    scenarios.push(buildScenario(s, 'edge-case', idx++));
  }

  const final = scenarios.slice(0, maxScenarios);
  console.log(`\n   Total scenarios: ${final.length}\n`);

  // 4. Output
  if (dryRun) {
    console.log('4️⃣  DRY RUN — would write:');
    for (const s of final) {
      console.log(`   ${s.id}.json (${s.category}, ${s.turns.length} turns, ${s.difficulty})`);
    }
    console.log(`   manifest.json (${final.length} scenarios)`);
    return;
  }

  console.log('4️⃣  Writing fixture files...');
  mkdirSync(FIXTURES_DIR, { recursive: true });

  for (const s of final) {
    const path = join(FIXTURES_DIR, `${s.id}.json`);
    writeFileSync(path, JSON.stringify(s, null, 2));
    console.log(`   📄 ${s.id}.json`);
  }

  // Manifest
  const manifest = {
    generatedAt: new Date().toISOString(),
    totalScenarios: final.length,
    categories: {
      goldenPath: final.filter(s => s.category === 'golden-path').length,
      antiPattern: final.filter(s => s.category === 'anti-pattern-example').length,
      edgeCase: final.filter(s => s.category === 'edge-case').length,
    },
    difficulties: {
      apprentice: final.filter(s => s.difficulty === 'apprentice').length,
      journeyman: final.filter(s => s.difficulty === 'journeyman').length,
      expert: final.filter(s => s.difficulty === 'expert').length,
      master: final.filter(s => s.difficulty === 'master').length,
    },
    scenarios: final.map(s => ({
      id: s.id,
      title: s.title,
      category: s.category,
      difficulty: s.difficulty,
      turns: s.turns.length,
      baselineGrade: s.baselineGrade,
      foundations: s.foundations,
    })),
  };
  writeFileSync(join(FIXTURES_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('   📄 manifest.json');

  // Summary
  console.log('\n' + '═'.repeat(55));
  console.log('  EXTRACTION SUMMARY');
  console.log('═'.repeat(55));
  console.log(`  Scenarios: ${final.length}`);
  console.log(`  Golden paths: ${manifest.categories.goldenPath}`);
  console.log(`  Anti-patterns: ${manifest.categories.antiPattern}`);
  console.log(`  Edge cases: ${manifest.categories.edgeCase}`);
  console.log(`  Output: fixtures/vai-cognitive-tests/`);
  console.log('═'.repeat(55) + '\n');
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Scenario Builder                                              */
/* ═══════════════════════════════════════════════════════════════ */

function buildScenario(session, category, index) {
  const turns = [];

  for (const tp of session.turnPairs.slice(0, 10)) {
    const userText = sanitizePII(tp.userMessage?.content || '');
    const assistantText = sanitizePII(tp.assistantResponse?.content || '');

    if (!userText) continue;

    const antiPatterns = (session.score.antiPatterns?.detections || [])
      .filter(d => d.turnPairIndex === tp.index)
      .map(d => d.pattern);

    const expectedBehavior = category === 'anti-pattern-example'
      ? `Avoid: ${antiPatterns.join(', ') || 'detected anti-patterns'}`
      : truncate(assistantText || 'Provide a relevant, helpful response', 300);

    const gradingChecklist = buildChecklist(assistantText);

    turns.push({
      userMessage: truncate(userText, 2000),
      turnContext: '',
      expectedBehavior,
      antiPatterns,
      gradingChecklist,
    });
  }

  if (turns.length === 0) {
    turns.push({
      userMessage: 'Hello',
      turnContext: '',
      expectedBehavior: 'Acknowledge and offer help',
      antiPatterns: [],
      gradingChecklist: [{ check: 'Responds', strategy: 'checklist', value: 'length>10', weight: 1.0 }],
    });
  }

  const avgWords = turns.reduce((sum, t) => sum + t.userMessage.split(/\s+/).length, 0) / turns.length;
  const avgTech = turns.reduce((sum, t) => sum + extractTechnicalDensity(t.userMessage), 0) / turns.length;
  const grade = session.score.overallGrade || session.score.overall_grade || 'C';

  return {
    id: `cog-${session.sessionId.slice(0, 8)}-${index}`,
    sourceSessionId: session.sessionId,
    title: truncate(session.title || `Session ${session.sessionId.slice(0, 8)}`, 100),
    category,
    turns,
    baselineScore: session.score.overall ?? 70,
    baselineGrade: grade,
    difficulty: classifyDifficulty(avgWords, avgTech),
    foundations: extractFoundations(session.score),
    tags: [category, grade],
  };
}

function extractFoundations(score) {
  const foundations = [];
  // Use §8 foundation names from cognitive alignment factors
  const factors = score.cognitiveAlignment?.factors || [];
  for (const factor of factors) {
    if (factor.raw >= 60) foundations.push(factor.name);
  }
  // Fallback if no strong foundations found
  if (foundations.length === 0) {
    if ((score.efficiency?.value ?? 0) >= 80) foundations.push('first-principles');
    if ((score.teachingQuality?.value ?? 0) >= 80) foundations.push('meta-learning');
    if ((score.cognitiveAlignment?.value ?? 0) >= 80) foundations.push('intellectual-honesty');
  }
  return foundations;
}

function buildChecklist(assistantText) {
  const items = [];
  if (!assistantText) return [{ check: 'Responds', strategy: 'checklist', value: 'length>10', weight: 1.0 }];

  const hasCode = /```/.test(assistantText);
  const hasSteps = /\b[1-9][).:]|\bstep\s+\d/i.test(assistantText);
  const isLong = assistantText.length > 200;

  if (hasCode) items.push({ check: 'Includes code', strategy: 'regex', value: '```', weight: 0.3 });
  if (hasSteps) items.push({ check: 'Uses steps', strategy: 'regex', value: '\\b[1-9][).:]', weight: 0.2 });
  if (isLong) items.push({ check: 'Detailed explanation', strategy: 'checklist', value: 'length>200', weight: 0.3 });

  // Extract key terms
  const terms = [...new Set((assistantText.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g) || []))].slice(0, 3);
  for (const term of terms) {
    items.push({ check: `Mentions ${term}`, strategy: 'contains', value: term, weight: 0.2 / Math.max(terms.length, 1) });
  }

  // Normalize weights
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (total > 0 && Math.abs(total - 1.0) > 0.01) {
    return items.map(i => ({ ...i, weight: Math.round((i.weight / total) * 100) / 100 }));
  }
  return items.length > 0 ? items : [{ check: 'Responds', strategy: 'checklist', value: 'length>10', weight: 1.0 }];
}

main().catch(err => {
  console.error('Extraction failed:', err);
  process.exit(1);
});
