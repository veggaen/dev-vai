#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createConv, querySingle } from './lib/parallel-query.mjs';

const DEFAULT_BASE_URL = process.env.VAI_API?.trim() || 'http://localhost:3006';
const DEFAULT_MODEL_ID = process.env.VAI_SMOKE_MODEL?.trim() || 'vai:v0';

const sharedForbidden = [
  /I couldn't find a strong match/i,
  /I don't have enough to go on/i,
  /cookie preferences/i,
  /pattern matching and n-grams/i,
  /Right now I can/i,
];

const cases = [
  {
    id: 'programming-short-topic',
    title: 'Programming short-topic floor',
    steps: [
      {
        label: 'programming',
        prompt: 'programming',
        referenceFloor: 'A solid answer defines programming as writing instructions or code for computers to build software or automate tasks, not a random language blurb.',
        required: [/programming/i, /computer|software/i, /instructions?|code|logic|problem/i],
        forbidden: [/\*\*Rust\*\* is a systems programming language/i],
        minWords: 24,
        minSources: 1,
        minFollowUps: 1,
      },
    ],
  },
  {
    id: 'meaning-short-topic',
    title: 'Meaning short-topic floor',
    steps: [
      {
        label: 'meaning',
        prompt: 'meaning',
        referenceFloor: 'A solid answer explains that meaning is what something signifies, communicates, or stands for, and can mention intent, interpretation, or purpose.',
        required: [/meaning|signif|definition|interpret|purpose/i],
        minWords: 28,
        minSources: 1,
        minFollowUps: 1,
      },
    ],
  },
  {
    id: 'single-short-topic',
    title: 'Single short-topic floor',
    steps: [
      {
        label: 'single',
        prompt: 'single',
        referenceFloor: 'A solid answer acknowledges the word is ambiguous and gives at least two everyday senses, such as unmarried, one item, or a music release.',
        required: [/single/i, /can mean|depending on context|could mean/i, /relationship|unmarried|music|song|one item|alone/i],
        minWords: 30,
        minSources: 1,
        minFollowUps: 1,
      },
    ],
  },
  {
    id: 'docker-short-topic',
    title: 'Docker short-topic floor',
    steps: [
      {
        label: 'docker',
        prompt: 'docker',
        referenceFloor: 'A solid answer says Docker packages apps into containers, distinguishes images or environments, and explains why developers use it for consistency.',
        required: [/docker/i, /container/i, /image|environment|consistent|ship/i],
        minWords: 28,
        minSources: 1,
        minFollowUps: 1,
      },
    ],
  },
  {
    id: 'build-something-general-store',
    title: 'Build something -> general storefront floor',
    steps: [
      {
        label: 'chooser',
        prompt: 'Build something:',
        referenceFloor: 'The vague opener should become a chooser or product lane, not retrieval sludge or refusal.',
        required: [/build|something|app|tool|direction|product/i],
        minWords: 12,
      },
      {
        label: 'general-store-follow-up',
        prompt: 'general store like firma for selling anything',
        referenceFloor: 'A solid answer turns this into a real storefront plan with categories or catalog, product detail, and cart or checkout flow.',
        required: [/storefront|online store|ecommerce|general store/i, /category|catalog|product/i, /cart|checkout/i],
        minWords: 70,
      },
    ],
  },
  {
    id: 'commerce-store-direct',
    title: 'Direct commerce store floor',
    steps: [
      {
        label: 'commerce-store',
        prompt: 'commerce store',
        referenceFloor: 'A solid answer treats this as a storefront direction request and immediately lays out landing, catalog, product, and cart or checkout structure.',
        required: [/online storefront|ecommerce|storefront|store landing/i, /catalog|product|category/i, /cart|checkout/i],
        forbidden: [/angular e-commerce framework/i],
        minWords: 80,
      },
    ],
  },
  {
    id: 'commerce-store-own-build-chain',
    title: 'Commerce store continuation floor',
    steps: [
      {
        label: 'commerce-store',
        prompt: 'commerce store',
        referenceFloor: 'The first answer should stay on a storefront plan, not a research blob.',
        required: [/online storefront|ecommerce|storefront|store landing/i, /catalog|product|category/i, /cart|checkout/i],
        forbidden: [/angular e-commerce framework/i],
        minWords: 80,
      },
      {
        label: 'own-build',
        prompt: 'can we use something of our own?',
        referenceFloor: 'A solid continuation says yes and commits to a custom storefront structure or product model instead of replying with a bare yes.',
        required: [/yes|custom/i, /our own storefront structure|custom storefront|our own product model|brand language/i],
        forbidden: [/^\s*yes\.?\s*$/i],
        minWords: 22,
      },
      {
        label: 'build-now',
        prompt: 'can you make it for me now?',
        referenceFloor: 'A solid continuation says it is ready for a first build pass or builder target and keeps talking about the storefront, not generic capability blurbs.',
        required: [/ready for the first build pass|builder target|builder mode|write the runnable files/i, /custom storefront|store landing|featured categories|catalog/i],
        minWords: 28,
      },
    ],
  },
];

function printHelp() {
  console.log(`Usage: node scripts/vai-answer-floor.mjs [options]

Options:
  --base-url <url>       Runtime base URL (default: ${DEFAULT_BASE_URL})
  --model <id>           Model id (default: ${DEFAULT_MODEL_ID})
  --case <id>            Run only one case id (repeatable)
  --json                 Print the full JSON report
  --report-file <path>   Write the JSON report to disk
  --list-cases           Print case ids and exit
  --help                 Show this help
`);
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    modelId: DEFAULT_MODEL_ID,
    caseIds: [],
    json: false,
    listCases: false,
    help: false,
    reportFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--list-cases') {
      args.listCases = true;
      continue;
    }
    if (arg === '--base-url' && next) {
      args.baseUrl = next;
      index += 1;
      continue;
    }
    if (arg === '--model' && next) {
      args.modelId = next;
      index += 1;
      continue;
    }
    if (arg === '--case' && next) {
      args.caseIds.push(next);
      index += 1;
      continue;
    }
    if (arg === '--report-file' && next) {
      args.reportFile = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return args;
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizePreview(text, limit = 220) {
  return text.replace(/\s+/g, ' ').trim().slice(0, limit);
}

function evaluateStep(result, step) {
  const answer = result.answer.trim();
  const failures = [];
  const forbiddenPatterns = [...sharedForbidden, ...(step.forbidden ?? [])];
  const requiredPatterns = step.required ?? [];
  const wordCount = countWords(answer);

  if (result.timeout) {
    failures.push(`timeout:${result.closeReason ?? 'unknown'}`);
  }
  if (!answer) {
    failures.push('empty-answer');
  }
  if (step.minWords && wordCount < step.minWords) {
    failures.push(`minWords:${step.minWords} (got ${wordCount})`);
  }
  if (typeof step.minSources === 'number' && result.sources.length < step.minSources) {
    failures.push(`minSources:${step.minSources} (got ${result.sources.length})`);
  }
  if (typeof step.minFollowUps === 'number' && result.followUps.length < step.minFollowUps) {
    failures.push(`minFollowUps:${step.minFollowUps} (got ${result.followUps.length})`);
  }

  for (const pattern of requiredPatterns) {
    if (!pattern.test(answer)) {
      failures.push(`missing:${pattern}`);
    }
  }
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(answer)) {
      failures.push(`forbidden:${pattern}`);
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    wordCount,
    sources: result.sources.length,
    followUps: result.followUps.length,
    durationMs: result.durationMs,
    preview: normalizePreview(answer),
    answer,
    referenceFloor: step.referenceFloor,
  };
}

async function writeReportFile(path, report) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`reportFile=${absolutePath}`);
}

async function runCase(testCase, args) {
  const conversationId = await createConv({
    title: `answer-floor ${testCase.id}`,
    modelId: args.modelId,
    baseUrl: args.baseUrl,
  });

  const stepReports = [];
  for (const step of testCase.steps) {
    const result = await querySingle(conversationId, step.prompt, {
      wsUrl: `${args.baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}/api/chat`,
      idleTimeoutMs: 30_000,
      totalTimeoutMs: 45_000,
    });
    stepReports.push({
      label: step.label,
      prompt: step.prompt,
      ...evaluateStep(result, step),
    });
  }

  return {
    caseId: testCase.id,
    title: testCase.title,
    passed: stepReports.every((step) => step.passed),
    steps: stepReports,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.listCases) {
    console.log(JSON.stringify({ cases: cases.map(({ id }) => id) }, null, 2));
    return;
  }

  const selectedCases = args.caseIds.length > 0
    ? args.caseIds.map((caseId) => {
      const found = cases.find((entry) => entry.id === caseId);
      if (!found) throw new Error(`Unknown case id: ${caseId}`);
      return found;
    })
    : cases;

  const results = [];
  for (const testCase of selectedCases) {
    const result = await runCase(testCase, args);
    results.push(result);
  }

  const report = {
    ok: results.every((entry) => entry.passed),
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: args.baseUrl,
      modelId: args.modelId,
      caseIds: results.map((entry) => entry.caseId),
    },
    summary: {
      totalCases: results.length,
      passedCases: results.filter((entry) => entry.passed).length,
      failedCases: results.filter((entry) => !entry.passed).length,
      totalSteps: results.reduce((sum, entry) => sum + entry.steps.length, 0),
      failedSteps: results.reduce((sum, entry) => sum + entry.steps.filter((step) => !step.passed).length, 0),
    },
    cases: results,
  };

  console.log(`VAI_ANSWER_FLOOR ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(`model=${report.target.modelId} base=${report.target.baseUrl}`);
  console.log(`cases=${report.summary.totalCases} passed=${report.summary.passedCases} failed=${report.summary.failedCases} failedSteps=${report.summary.failedSteps}`);
  for (const testCase of report.cases) {
    console.log(`- ${testCase.caseId} ${testCase.passed ? 'PASS' : 'FAIL'}`);
    for (const step of testCase.steps) {
      const status = step.passed ? 'PASS' : 'FAIL';
      console.log(`  · ${step.label} ${status} words=${step.wordCount} sources=${step.sources} followUps=${step.followUps}`);
      if (!step.passed) {
        console.log(`    floor: ${step.referenceFloor}`);
        console.log(`    failures: ${step.failures.join(', ')}`);
        console.log(`    preview: ${step.preview}`);
      }
    }
  }

  if (args.reportFile) {
    await writeReportFile(args.reportFile, report);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`VAI_ANSWER_FLOOR_ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});