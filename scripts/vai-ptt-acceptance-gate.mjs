#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  buildPttTargetAudit,
  canonicalPttPathKey,
  currentSourceFingerprint,
  PTT_TARGET_CHECK_IDS,
} from './vai-ptt-target-audit.mjs';

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function verifyEvidenceFiles(report, buffers) {
  if (!Array.isArray(report.evidenceFiles) || report.evidenceFiles.length !== 4) return false;
  const resolved = report.evidenceFiles.map((item) => path.resolve(item.path ?? ''));
  if (new Set(resolved).size !== resolved.length) return false;
  return report.evidenceFiles.every((item, index) => {
    const bytes = buffers?.[index] ?? (existsSync(resolved[index]) ? readFileSync(resolved[index]) : null);
    return (
    /^[a-f0-9]{64}$/.test(item.sha256 ?? '')
      && bytes
      && createHash('sha256').update(bytes).digest('hex') === item.sha256
    );
  });
}

function verifiedBinaryManifest(report, suppliedBytes) {
  const manifestPath = path.resolve(report.binaryManifestPath ?? '');
  const manifestBytes = suppliedBytes ?? (existsSync(manifestPath) ? readFileSync(manifestPath) : null);
  if (!manifestBytes
    || !/^[a-f0-9]{64}$/.test(report.binaryManifestSha256 ?? '')
    || createHash('sha256').update(manifestBytes).digest('hex') !== report.binaryManifestSha256) return null;
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest?.schemaVersion !== 1
    || manifest?.sourceFingerprint !== report.sourceFingerprint
    || manifest?.buildContract?.cargoProfile !== 'release'
    || manifest?.buildContract?.dangerousPttFixture !== true
    || manifest?.buildContract?.renderer !== 'embedded-release-assets') return null;
  const expectedNames = ['veggaai.exe', 'vai_ptt_target.exe', 'vai_ptt_fixture_driver.exe'];
  const entries = ['vai', 'target', 'driver'].map((name) => manifest?.binaries?.[name]);
  if (!entries.every((entry, index) => {
    const binaryPath = path.resolve(entry?.path ?? '');
    return path.isAbsolute(entry?.path ?? '')
      && path.basename(binaryPath).toLowerCase() === expectedNames[index]
      && canonicalPttPathKey(binaryPath).includes('\\target\\release\\')
      && Number.isInteger(entry?.size)
      && entry.size > 0
      && /^[a-f0-9]{64}$/.test(entry?.sha256 ?? '')
      && existsSync(binaryPath)
      && statSync(binaryPath).isFile()
      && (() => {
        const bytes = readFileSync(binaryPath);
        return bytes.length === entry.size
          && createHash('sha256').update(bytes).digest('hex') === entry.sha256;
      })();
  })) return null;
  return manifest;
}

function verifiedAttemptPlan(report, suppliedBytes) {
  const planPath = path.resolve(report.attemptPlanPath ?? '');
  const planBytes = suppliedBytes ?? (existsSync(planPath) ? readFileSync(planPath) : null);
  if (!planBytes
    || !/^[a-f0-9]{64}$/.test(report.attemptPlanSha256 ?? '')
    || createHash('sha256').update(planBytes).digest('hex') !== report.attemptPlanSha256) return null;
  const plan = JSON.parse(planBytes.toString('utf8'));
  const attempt = plan?.attempts?.[report.attemptNumber - 1];
  if (plan?.schemaVersion !== 1
    || plan?.sourceFingerprint !== report.sourceFingerprint
    || canonicalPttPathKey(plan?.binaryManifestPath) !== canonicalPttPathKey(report.binaryManifestPath)
    || plan?.binaryManifestSha256 !== report.binaryManifestSha256
    || !Number.isFinite(plan?.createdAtMs)
    || plan.createdAtMs > Number(report.evidenceStartedAtMs)
    || plan?.attempts?.length !== 10
    || !plan.attempts.every((item, index) => item?.attemptNumber === index + 1)
    || new Set(plan.attempts.map((item) => item.runId)).size !== 10
    || new Set(plan.attempts.map((item) => item.nonce)).size !== 10
    || attempt?.runId !== report.runId
    || attempt?.nonce !== report.expected
    || attempt?.workflow !== report.workflow
    || attempt?.mode !== report.mode
    || attempt?.shortcut !== report.shortcut
    || canonicalPttPathKey(attempt?.claimPath) !== canonicalPttPathKey(report.attemptClaimPath)) return null;
  return plan;
}

function readJsonlBytes(file, bytes) {
  return bytes.toString('utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function comparableCandidate(report) {
  const keys = [
    'schemaVersion', 'targetLog', 'dictationLog', 'driverReport', 'binaryManifestPath',
    'binaryManifestSha256', 'attemptPlanPath', 'attemptPlanSha256', 'attemptClaimPath', 'evidenceFiles',
    'runId', 'attemptNumber', 'sourceFingerprint', 'expected', 'releaseId', 'mode',
    'workflow', 'shortcut', 'targetPid', 'targetHwnd', 'churnObserved',
    'evidenceStartedAtMs', 'evidenceReleasedAtMs', 'evidencePasteAtMs',
    'attemptClaimStartedAtMs', 'attemptClaimTerminalAtMs', 'checks', 'passed',
  ];
  return Object.fromEntries(keys.map((key) => [key, report[key]]));
}

export function verifyPttCandidateEvidence(report) {
  try {
    if (!Array.isArray(report.evidenceFiles) || report.evidenceFiles.length !== 4) return false;
    const evidencePaths = report.evidenceFiles.map((item) => path.resolve(item.path ?? ''));
    if (evidencePaths.some((file) => !existsSync(file))) return false;
    const evidenceBytes = evidencePaths.map((file) => readFileSync(file));
    if (!verifyEvidenceFiles(report, evidenceBytes)) return false;
    const manifestPath = path.resolve(report.binaryManifestPath ?? '');
    const planPath = path.resolve(report.attemptPlanPath ?? '');
    if (!existsSync(manifestPath) || !existsSync(planPath)) return false;
    const manifestBytes = readFileSync(manifestPath);
    const planBytes = readFileSync(planPath);
    const binaryManifest = verifiedBinaryManifest(report, manifestBytes);
    if (!binaryManifest) return false;
    const attemptPlan = verifiedAttemptPlan(report, planBytes);
    if (!attemptPlan) return false;
    const declaredPaths = [report.targetLog, report.dictationLog, report.driverReport, report.attemptClaimPath]
      .map((item) => path.resolve(item ?? ''));
    if (!isDeepStrictEqual(
      evidencePaths.map(canonicalPttPathKey),
      declaredPaths.map(canonicalPttPathKey),
    )) return false;
    const sourceFingerprint = currentSourceFingerprint();
    if (report.sourceFingerprint !== sourceFingerprint) return false;
    const recomputed = buildPttTargetAudit({
      target: readJsonlBytes(evidencePaths[0], evidenceBytes[0]),
      dictation: readJsonlBytes(evidencePaths[1], evidenceBytes[1]),
      driver: JSON.parse(evidenceBytes[2].toString('utf8')),
      attemptClaim: readJsonlBytes(evidencePaths[3], evidenceBytes[3]),
      binaryManifest,
      attemptPlan,
      expected: report.expected,
      targetLog: declaredPaths[0],
      dictationLog: declaredPaths[1],
      driverReport: declaredPaths[2],
      binaryManifestPath: path.resolve(report.binaryManifestPath),
      binaryManifestSha256: report.binaryManifestSha256,
      attemptPlanPath: path.resolve(report.attemptPlanPath),
      attemptPlanSha256: report.attemptPlanSha256,
      attemptClaimPath: declaredPaths[3],
      evidenceFiles: report.evidenceFiles,
      runId: report.runId,
      attemptNumber: report.attemptNumber,
      sourceFingerprint,
    });
    return isDeepStrictEqual(comparableCandidate(report), comparableCandidate(recomputed));
  } catch {
    return false;
  }
}

export function buildPttAcceptanceGate(reports) {
  const releaseIds = reports.map((report) => report.releaseId)
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  const releaseIdentities = reports.map((report) => `${report.runId}:${report.releaseId}`);
  const modes = new Set(reports.map((report) => report.mode));
  const churnRuns = reports.filter((report) => report.churnObserved === true);
  const openAndPasteRuns = reports.filter((report) => report.workflow === 'open-and-paste');
  const shortcuts = reports.map((report) => report.shortcut);
  const runIds = reports.map((report) => report.runId);
  const nonces = reports.map((report) => report.expected);
  const sourceFingerprints = new Set(reports.map((report) => report.sourceFingerprint));
  const binaryManifestPaths = reports.map((report) => report.binaryManifestPath);
  const binaryManifestHashes = reports.map((report) => report.binaryManifestSha256);
  const attemptPlanPaths = reports.map((report) => report.attemptPlanPath);
  const attemptPlanHashes = reports.map((report) => report.attemptPlanSha256);
  const allEvidence = reports.flatMap((report) => report.evidenceFiles ?? []);
  const candidateReportPaths = reports.map((report) => report.candidateReportPath);
  const candidateReportHashes = reports.map((report) => report.candidateReportSha256);
  const evidencePaths = allEvidence.map((item) => item.path);
  const evidenceHashes = allEvidence.map((item) => item.sha256);
  const exactChecks = reports.every((report) => {
    const ids = report.checks?.map((item) => item.id) ?? [];
    return report.schemaVersion === 2
      && ids.length === PTT_TARGET_CHECK_IDS.length
      && new Set(ids).size === ids.length
      && ids.every((id, index) => id === PTT_TARGET_CHECK_IDS[index])
      && report.checks.every((item) => item.passed === true)
      && report.passed === true;
  });
  const evidenceStartTimes = reports.map((report) => Number(report.evidenceStartedAtMs));
  const claimStartTimes = reports.map((report) => Number(report.attemptClaimStartedAtMs));
  const claimTerminalTimes = reports.map((report) => Number(report.attemptClaimTerminalAtMs));
  const checks = [
    check('exactly-ten-runs', reports.length === 10, reports.length),
    check('full-schema-every-run', exactChecks, reports.map((report) => ({
      schemaVersion: report.schemaVersion,
      checkCount: report.checks?.length,
      passed: report.passed,
    }))),
    check('all-evidence-files-verified', reports.length > 0
      && reports.every((report) => (
        report.evidenceVerified === true && report.evidenceRecomputed === true
      )), reports.map((report) => ({
      hashes: report.evidenceVerified,
      recomputed: report.evidenceRecomputed,
    }))),
    check('all-binaries-independently-verified', reports.length > 0
      && reports.every((report) => report.binaryVerified === true),
    reports.map((report) => report.binaryVerified)),
    check('all-attempts-predeclared', reports.length > 0
      && reports.every((report) => report.attemptPlanVerified === true),
    reports.map((report) => report.attemptPlanVerified)),
    check('attempts-one-through-ten', reports.every((report, index) => report.attemptNumber === index + 1),
      reports.map((report) => report.attemptNumber)),
    check('chronological-candidates', evidenceStartTimes.every((value, index) => (
      Number.isFinite(value) && (index === 0 || value >= evidenceStartTimes[index - 1])
    )) && claimStartTimes.every((value, index) => (
      Number.isFinite(value)
        && Number.isFinite(claimTerminalTimes[index])
        && value <= claimTerminalTimes[index]
        && (index === 0 || value >= claimTerminalTimes[index - 1])
    )), { evidenceStartTimes, claimStartTimes, claimTerminalTimes }),
    check('unique-run-ids', runIds.length === reports.length
      && runIds.every((value) => typeof value === 'string' && value.length >= 8)
      && new Set(runIds).size === reports.length, runIds),
    check('unique-nonces', nonces.length === reports.length
      && nonces.every((value) => typeof value === 'string' && value.length >= 8)
      && new Set(nonces).size === reports.length, nonces),
    check('unique-release-identities', releaseIds.length === reports.length
      && new Set(releaseIdentities).size === reports.length, releaseIdentities),
    check('single-source-build', sourceFingerprints.size === 1
      && [...sourceFingerprints][0]?.match(/^[a-f0-9]{64}$/), [...sourceFingerprints]),
    check('single-binary-manifest', binaryManifestPaths.every((value) => typeof value === 'string')
      && new Set(binaryManifestPaths.map(canonicalPttPathKey)).size === 1
      && binaryManifestHashes.every((value) => /^[a-f0-9]{64}$/.test(value ?? ''))
      && new Set(binaryManifestHashes).size === 1, {
      paths: binaryManifestPaths,
      hashes: binaryManifestHashes,
    }),
    check('single-attempt-plan', attemptPlanPaths.every((value) => typeof value === 'string')
      && new Set(attemptPlanPaths.map(canonicalPttPathKey)).size === 1
      && attemptPlanHashes.every((value) => /^[a-f0-9]{64}$/.test(value ?? ''))
      && new Set(attemptPlanHashes).size === 1, {
      paths: attemptPlanPaths,
      hashes: attemptPlanHashes,
    }),
    check('unique-evidence-files', allEvidence.length === reports.length * 4
      && new Set(evidencePaths).size === allEvidence.length
      && new Set(evidenceHashes).size === allEvidence.length
      && evidenceHashes.every((value) => /^[a-f0-9]{64}$/.test(value)), {
      paths: evidencePaths,
      hashes: evidenceHashes,
    }),
    check('unique-candidate-reports', candidateReportPaths.every((value) => typeof value === 'string')
      && new Set(candidateReportPaths).size === reports.length
      && candidateReportHashes.every((value) => /^[a-f0-9]{64}$/.test(value ?? ''))
      && new Set(candidateReportHashes).size === reports.length, {
      paths: candidateReportPaths,
      hashes: candidateReportHashes,
    }),
    check('valid-target-identities', reports.every((report) => (
      Number.isInteger(report.targetPid) && report.targetPid > 0
        && Number.isInteger(report.targetHwnd) && report.targetHwnd !== 0
    )), reports.map((report) => ({ pid: report.targetPid, hwnd: report.targetHwnd }))),
    check('windowed-covered', modes.has('windowed'), [...modes]),
    check('borderless-covered', modes.has('borderless'), [...modes]),
    check('three-churn-runs', churnRuns.length >= 3, churnRuns.map((report) => report.releaseId)),
    check('open-and-paste-covered', openAndPasteRuns.length >= 1,
      openAndPasteRuns.map((report) => report.releaseId)),
    check('supported-shortcut-every-run', shortcuts.every((shortcut) => (
      shortcut === 'Win+Alt' || shortcut === 'Ctrl+Shift+Space'
    )), shortcuts),
    check('preferred-shortcut-covered', shortcuts.includes('Win+Alt'), shortcuts),
    check(
      'latency-pass-every-run',
      reports.every((report) => report.checks?.find((item) => item.id === 'latency-budget')?.passed === true),
      reports.map((report) => ({
        releaseId: report.releaseId,
        detail: report.checks?.find((item) => item.id === 'latency-budget')?.detail,
      })),
    ),
    check(
      'no-focus-theft-every-run',
      reports.every((report) => report.checks?.find((item) => item.id === 'target-remained-active')?.passed === true),
      reports.map((report) => report.releaseId),
    ),
  ];
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    runCount: reports.length,
    churnRunCount: churnRuns.length,
    modes: [...modes].sort(),
    releaseIds,
    runIds,
    shortcuts,
    candidateReportHashes,
    sourceFingerprint: sourceFingerprints.size === 1 ? [...sourceFingerprints][0] : null,
    binaryManifestSha256: new Set(binaryManifestHashes).size === 1 ? binaryManifestHashes[0] : null,
    attemptPlanSha256: new Set(attemptPlanHashes).size === 1 ? attemptPlanHashes[0] : null,
    checks,
    passed: checks.every((item) => item.passed),
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const reports = [];
  let out = '';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--report') reports.push(args[++index] ?? '');
    else if (args[index] === '--out') out = args[++index] ?? '';
    else if (args[index] === '--help') {
      console.log('Usage: node scripts/vai-ptt-acceptance-gate.mjs --report run-001.json [... exactly 10] --out gate.json');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (reports.some((report) => !report)) throw new Error('Every --report requires a path');
  if (!out) throw new Error('Missing --out');
  return { reports, out };
}

function main() {
  const args = parseArgs();
  const reports = args.reports.map((reportPath) => {
    const resolved = path.resolve(reportPath);
    if (!existsSync(resolved)) throw new Error(`Report does not exist: ${resolved}`);
    const reportBytes = readFileSync(resolved);
    const report = JSON.parse(reportBytes.toString('utf8'));
    const evidenceRecomputed = verifyPttCandidateEvidence(report);
    return {
      ...report,
      candidateReportPath: resolved,
      candidateReportSha256: createHash('sha256').update(reportBytes).digest('hex'),
      evidenceVerified: evidenceRecomputed,
      binaryVerified: evidenceRecomputed,
      attemptPlanVerified: evidenceRecomputed,
      evidenceRecomputed,
    };
  });
  const gate = buildPttAcceptanceGate(reports);
  const output = path.resolve(args.out);
  if (existsSync(output)) throw new Error(`Refusing to overwrite append-only evidence: ${output}`);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(gate, null, 2)}\n`, 'utf8');
  console.log(`VAI_PTT_ACCEPTANCE_GATE ${gate.passed ? 'PASS' : 'FAIL'} checks=${gate.checks.filter((item) => item.passed).length}/${gate.checks.length}`);
  console.log(`report=${output}`);
  if (!gate.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    console.error(`VAI_PTT_ACCEPTANCE_GATE_ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
