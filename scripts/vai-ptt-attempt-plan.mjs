#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { currentSourceFingerprint } from './vai-ptt-target-audit.mjs';

const SCHEDULE = [
  ['canonical-churn', 'windowed', 'Win+Alt'],
  ['canonical-churn', 'borderless', 'Win+Alt'],
  ['canonical-churn', 'windowed', 'Ctrl+Shift+Space'],
  ['open-and-paste', 'borderless', 'Win+Alt'],
  ['canonical-churn', 'windowed', 'Win+Alt'],
  ['canonical-churn', 'borderless', 'Ctrl+Shift+Space'],
  ['canonical-churn', 'windowed', 'Win+Alt'],
  ['open-and-paste', 'borderless', 'Win+Alt'],
  ['canonical-churn', 'borderless', 'Win+Alt'],
  ['open-and-paste', 'windowed', 'Win+Alt'],
];

export function buildPttAttemptPlan({
  binaryManifestPath,
  evidenceDirectory = path.resolve('ptt-attempt-claims'),
  randomId = randomUUID,
  randomNonce = randomBytes,
}) {
  const manifestPath = path.resolve(binaryManifestPath);
  if (!existsSync(manifestPath)) throw new Error(`Binary manifest does not exist: ${manifestPath}`);
  const binaryManifestBytes = readFileSync(manifestPath);
  const binaryManifest = JSON.parse(binaryManifestBytes.toString('utf8'));
  const sourceFingerprint = currentSourceFingerprint();
  if (binaryManifest?.schemaVersion !== 1 || binaryManifest?.sourceFingerprint !== sourceFingerprint) {
    throw new Error('Binary manifest is not bound to the current PTT source closure');
  }
  const createdAtMs = Date.now();
  return {
    schemaVersion: 1,
    createdAt: new Date(createdAtMs).toISOString(),
    createdAtMs,
    sourceFingerprint,
    binaryManifestPath: manifestPath,
    binaryManifestSha256: createHash('sha256').update(binaryManifestBytes).digest('hex'),
    attempts: SCHEDULE.map(([workflow, mode, shortcut], index) => ({
      attemptNumber: index + 1,
      runId: `ptt-${randomId()}`,
      nonce: `vai-${randomNonce(18).toString('hex')}`,
      workflow,
      mode,
      shortcut,
      claimPath: path.resolve(evidenceDirectory, `attempt-${String(index + 1).padStart(2, '0')}.claim.jsonl`),
    })),
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { binaryManifest: '', evidenceDir: '', out: '' };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--binary-manifest') result.binaryManifest = args[++index] ?? '';
    else if (args[index] === '--evidence-dir') result.evidenceDir = args[++index] ?? '';
    else if (args[index] === '--out') result.out = args[++index] ?? '';
    else if (args[index] === '--help') {
      console.log('Usage: node scripts/vai-ptt-attempt-plan.mjs --binary-manifest binary-manifest.json --evidence-dir acceptance-evidence --out attempt-plan.json');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!result.binaryManifest || !result.evidenceDir || !result.out) throw new Error('--binary-manifest, --evidence-dir, and --out are required');
  return result;
}

function main() {
  const args = parseArgs();
  const output = path.resolve(args.out);
  if (existsSync(output)) throw new Error(`Refusing to overwrite attempt plan: ${output}`);
  mkdirSync(path.dirname(output), { recursive: true });
  const plan = buildPttAttemptPlan({
    binaryManifestPath: args.binaryManifest,
    evidenceDirectory: args.evidenceDir,
  });
  writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(`VAI_PTT_ATTEMPT_PLAN ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    console.error(`VAI_PTT_ATTEMPT_PLAN_ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
