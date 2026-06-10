import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  compareConversationAuditReports,
  renderConversationAuditComparisonMarkdown,
} from './lib/vai-audit-comparison.mjs';

function parseArguments(argv) {
  const positional = [];
  let outDir = null;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') {
      outDir = argv[index + 1];
      index += 1;
    } else {
      positional.push(argv[index]);
    }
  }

  if (positional.length !== 2) {
    throw new Error(
      'Usage: node scripts/compare-conversation-audits.mjs <baseline.json> <candidate.json> [--out <directory>]',
    );
  }

  return {
    baselinePath: resolve(positional[0]),
    candidatePath: resolve(positional[1]),
    outDir: outDir ? resolve(outDir) : null,
  };
}

const options = parseArguments(process.argv.slice(2));
const [baseline, candidate] = await Promise.all([
  readFile(options.baselinePath, 'utf8').then(JSON.parse),
  readFile(options.candidatePath, 'utf8').then(JSON.parse),
]);
const comparison = compareConversationAuditReports(baseline, candidate);
const markdown = renderConversationAuditComparisonMarkdown(comparison);

if (options.outDir) {
  await mkdir(options.outDir, { recursive: true });
  const jsonPath = resolve(options.outDir, 'comparison.json');
  const markdownPath = resolve(options.outDir, 'comparison.md');
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(comparison, null, 2)}\n`),
    writeFile(markdownPath, markdown),
  ]);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${markdownPath}`);
} else {
  console.log(markdown);
}
