#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { auditWaveRealism } from './lib/vai-benchmark-realism.mjs';
import { buildAdversarialAuditWave } from './lib/vai-adversarial-audit-wave.mjs';
import { buildGeneratedAuditWave } from './lib/vai-generated-audit-wave.mjs';
import { buildNovelHoldoutWave } from './lib/vai-novel-holdout-wave.mjs';
import { buildRealisticMutationWave } from './lib/vai-realistic-mutation-wave.mjs';

const ROOT = process.cwd();
const SEED = process.argv[2] || 'realism-audit-r1';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(ROOT, 'Temporary_files', 'benchmark-realism', STAMP);

const reports = [
  auditWaveRealism(buildGeneratedAuditWave(16, `${SEED}-generated`), 'generated-control'),
  auditWaveRealism(buildAdversarialAuditWave(16, `${SEED}-adversarial`), 'adversarial-control'),
  auditWaveRealism(buildNovelHoldoutWave(16, `${SEED}-holdout`), 'novel-holdout-control'),
  auditWaveRealism(buildRealisticMutationWave(20, `${SEED}-dogfood`), 'realistic-dogfood-mutation'),
];

function markdown(items) {
  const lines = [
    '# Vai Benchmark Realism Audit',
    '',
    `- Created: \`${new Date().toISOString()}\``,
    `- Seed: \`${SEED}\``,
    '- Scope: prompt-naturalness heuristics only; this is a benchmark self-audit, not a claim that a prompt was authored by a human.',
    '',
    '## Lane Summary',
    '',
    '| Lane | Prompts | Avg score | Synthetic flags | Visible markers | Human-style traits |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const item of items) {
    lines.push(`| ${item.lane} | ${item.prompts} | ${item.averageScore} | ${item.syntheticPrompts} | ${item.promptVisibleCanaries} | ${item.humanTraitPrompts} |`);
  }
  lines.push('', '## Flagged Examples', '');
  for (const item of items) {
    lines.push(`### ${item.lane}`, '');
    if (!item.examples.length) {
      lines.push('- None', '');
      continue;
    }
    for (const example of item.examples) {
      lines.push(`- \`${example.scenarioId}\` turn ${example.turn}: \`${example.flags.join(', ')}\``);
      lines.push(`  - ${example.prompt}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'report.json'), `${JSON.stringify({ seed: SEED, reports }, null, 2)}\n`);
await fs.writeFile(path.join(OUT, 'report.md'), markdown(reports));

console.log('Vai benchmark realism audit');
for (const report of reports) {
  console.log(`${report.lane.padEnd(28)} prompts=${String(report.prompts).padStart(3)} score=${String(report.averageScore).padStart(3)} synthetic=${String(report.syntheticPrompts).padStart(3)} visible-markers=${String(report.promptVisibleCanaries).padStart(3)} human-traits=${String(report.humanTraitPrompts).padStart(3)}`);
}
console.log(`Report: ${path.join(OUT, 'report.md')}`);

