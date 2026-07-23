import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPttAcceptanceGate, verifyPttCandidateEvidence } from '../vai-ptt-acceptance-gate.mjs';
import {
  buildPttTargetAudit,
  currentSourceFingerprint,
  PTT_TARGET_CHECK_IDS,
} from '../vai-ptt-target-audit.mjs';

function report(index, overrides = {}) {
  return {
    schemaVersion: 2,
    generatedAt: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
    evidenceStartedAtMs: 1_700_000_000_000 + index * 10_000,
    evidenceReleasedAtMs: 1_700_000_001_000 + index * 10_000,
    evidencePasteAtMs: 1_700_000_001_700 + index * 10_000,
    attemptClaimStartedAtMs: 1_700_000_000_100 + index * 10_000,
    attemptClaimTerminalAtMs: 1_700_000_005_000 + index * 10_000,
    runId: `ptt-run-${String(index + 1).padStart(2, '0')}`,
    attemptNumber: index + 1,
    expected: `nonce-${String(index + 1).padStart(4, '0')}`,
    sourceFingerprint: 'a'.repeat(64),
    binaryManifestPath: path.resolve('binary-manifest.json'),
    binaryManifestSha256: 'f'.repeat(64),
    binaryVerified: true,
    attemptPlanPath: path.resolve('attempt-plan.json'),
    attemptPlanSha256: 'e'.repeat(64),
    attemptPlanVerified: true,
    attemptClaimPath: path.resolve(`run-${index + 1}-claim.json`),
    candidateReportPath: `candidate-${index + 1}.json`,
    candidateReportSha256: (500 + index).toString(16).padStart(64, '0'),
    evidenceVerified: true,
    evidenceRecomputed: true,
    evidenceFiles: ['target', 'dictation', 'driver', 'claim'].map((kind, evidenceIndex) => ({
      path: `run-${index + 1}-${kind}.json`,
      sha256: (index * 4 + evidenceIndex + 1).toString(16).padStart(64, '0'),
    })),
    releaseId: index + 1,
    targetPid: 1000 + index,
    targetHwnd: 2000 + index,
    mode: index % 2 === 0 ? 'windowed' : 'borderless',
    churnObserved: index < 3,
    workflow: index === 9 ? 'open-and-paste' : 'canonical-churn',
    shortcut: 'Win+Alt',
    passed: true,
    checks: PTT_TARGET_CHECK_IDS.map((id) => ({
      id,
      passed: true,
      detail: id === 'latency-budget' ? 700 + index : undefined,
    })),
    ...overrides,
  };
}

test('accepts exactly ten passing runs with both modes and at least three churn runs', () => {
  const gate = buildPttAcceptanceGate(Array.from({ length: 10 }, (_, index) => report(index)));
  assert.equal(gate.passed, true);
  assert.equal(gate.runCount, 10);
  assert.equal(gate.churnRunCount, 3);
});

test('accepts release ID reuse across isolated Vai processes when run IDs are unique', () => {
  const reports = Array.from({ length: 10 }, (_, index) => report(index, { releaseId: 1 }));
  const gate = buildPttAcceptanceGate(reports);
  assert.equal(gate.checks.find((item) => item.id === 'unique-release-identities')?.passed, true);
  assert.equal(gate.passed, true);
});

test('rejects duplicated evidence, missing modes, insufficient churn, and one unsafe run', () => {
  const reports = Array.from({ length: 10 }, (_, index) => report(index, {
    mode: 'windowed',
    churnObserved: index < 2,
  }));
  reports[9].releaseId = null;
  reports[7].passed = false;
  reports[7].checks.find((item) => item.id === 'latency-budget').passed = false;
  reports[7].checks.find((item) => item.id === 'target-remained-active').passed = false;
  const gate = buildPttAcceptanceGate(reports);
  assert.equal(gate.passed, false);
  for (const id of [
    'full-schema-every-run',
    'unique-release-identities',
    'borderless-covered',
    'three-churn-runs',
    'latency-pass-every-run',
    'no-focus-theft-every-run',
  ]) {
    assert.equal(gate.checks.find((item) => item.id === id)?.passed, false, id);
  }
});

test('rejects abbreviated, fabricated, or reused evidence and mixed source builds', () => {
  const reports = Array.from({ length: 10 }, (_, index) => report(index));
  reports[0].checks = reports[0].checks.slice(0, 2);
  reports[1].evidenceVerified = false;
  reports[2].evidenceFiles[0] = reports[1].evidenceFiles[0];
  reports[3].sourceFingerprint = 'b'.repeat(64);
  const gate = buildPttAcceptanceGate(reports);
  assert.equal(gate.passed, false);
  for (const id of [
    'full-schema-every-run',
    'all-evidence-files-verified',
    'unique-evidence-files',
    'single-source-build',
  ]) {
    assert.equal(gate.checks.find((item) => item.id === id)?.passed, false, id);
  }
});

test('rejects an unplanned candidate or a batch assembled from different attempt ledgers', () => {
  const reports = Array.from({ length: 10 }, (_, index) => report(index));
  reports[3].attemptPlanVerified = false;
  reports[7].attemptPlanSha256 = 'd'.repeat(64);
  const gate = buildPttAcceptanceGate(reports);
  assert.equal(gate.passed, false);
  assert.equal(gate.checks.find((item) => item.id === 'all-attempts-predeclared')?.passed, false);
  assert.equal(gate.checks.find((item) => item.id === 'single-attempt-plan')?.passed, false);
});

test('rejects nine or eleven runs even when every individual report passes', () => {
  assert.equal(buildPttAcceptanceGate(Array.from({ length: 9 }, (_, index) => report(index))).passed, false);
  assert.equal(buildPttAcceptanceGate(Array.from({ length: 11 }, (_, index) => report(index))).passed, false);
});

test('rejects an unsupported chord or a batch that never proves the preferred Win+Alt chord', () => {
  const unsupported = Array.from({ length: 10 }, (_, index) => report(index));
  unsupported[4].shortcut = 'Alt+F4';
  assert.equal(
    buildPttAcceptanceGate(unsupported).checks.find((item) => item.id === 'supported-shortcut-every-run')?.passed,
    false,
  );

  const fallbackOnly = Array.from({ length: 10 }, (_, index) => report(index, {
    shortcut: 'Ctrl+Shift+Space',
  }));
  assert.equal(
    buildPttAcceptanceGate(fallbackOnly).checks.find((item) => item.id === 'preferred-shortcut-covered')?.passed,
    false,
  );
});

test('rejects a structurally convincing candidate backed only by arbitrary hashed files', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'vai-ptt-fabricated-'));
  const files = ['target.jsonl', 'dictation.jsonl', 'driver.json', 'claim.jsonl'].map((name) => path.join(directory, name));
  for (const file of files) writeFileSync(file, '{}\n', 'utf8');
  const fabricated = report(0, {
    targetLog: files[0],
    dictationLog: files[1],
    driverReport: files[2],
    attemptClaimPath: files[3],
    evidenceFiles: files.map((file) => ({
      path: file,
      sha256: createHash('sha256').update('{}\n').digest('hex'),
    })),
  });
  assert.equal(verifyPttCandidateEvidence(fabricated), false);
});

test('recomputes a candidate from its four raw evidence files', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'vai-ptt-genuine-'));
  const releaseDirectory = path.join(directory, 'target', 'release');
  mkdirSync(releaseDirectory, { recursive: true });
  const paths = {
    target: path.join(directory, 'target.jsonl'),
    dictation: path.join(directory, 'dictation.jsonl'),
    driver: path.join(directory, 'driver.json'),
    claim: path.join(directory, 'attempt-01.claim.jsonl'),
    manifest: path.join(directory, 'binary-manifest.json'),
    plan: path.join(directory, 'attempt-plan.json'),
    vaiExe: path.join(releaseDirectory, 'veggaai.exe'),
    targetExe: path.join(releaseDirectory, 'vai_ptt_target.exe'),
    driverExe: path.join(releaseDirectory, 'vai_ptt_fixture_driver.exe'),
  };
  writeFileSync(paths.vaiExe, 'vai-binary', 'utf8');
  writeFileSync(paths.targetExe, 'target-binary', 'utf8');
  writeFileSync(paths.driverExe, 'driver-binary', 'utf8');
  const sourceFingerprint = currentSourceFingerprint();
  const binaryEntry = (file) => ({
    path: file,
    size: Buffer.byteLength(`${path.basename(file).startsWith('veggaai') ? 'vai' : path.basename(file).startsWith('vai_ptt_target') ? 'target' : 'driver'}-binary`),
    sha256: createHash('sha256').update(
      path.basename(file).startsWith('veggaai') ? 'vai-binary'
        : path.basename(file).startsWith('vai_ptt_target') ? 'target-binary' : 'driver-binary',
    ).digest('hex'),
  });
  const binaryManifest = {
    schemaVersion: 1,
    sourceFingerprint,
    buildContract: {
      cargoProfile: 'release', dangerousPttFixture: true, renderer: 'embedded-release-assets',
    },
    binaries: {
      vai: binaryEntry(paths.vaiExe),
      target: binaryEntry(paths.targetExe),
      driver: binaryEntry(paths.driverExe),
    },
  };
  const binaryManifestText = `${JSON.stringify(binaryManifest)}\n`;
  writeFileSync(paths.manifest, binaryManifestText, 'utf8');
  const binaryManifestSha256 = createHash('sha256').update(binaryManifestText).digest('hex');
  const runId = 'genuine-run-0001';
  const expected = 'genuine-nonce-0001';
  const attemptPlan = {
    schemaVersion: 1,
    sourceFingerprint,
    binaryManifestPath: paths.manifest,
    binaryManifestSha256,
    createdAtMs: 500,
    attempts: Array.from({ length: 10 }, (_, index) => ({
      attemptNumber: index + 1,
      runId: index === 0 ? runId : `unused-run-${String(index + 1).padStart(4, '0')}`,
      nonce: index === 0 ? expected : `unused-nonce-${String(index + 1).padStart(4, '0')}`,
      workflow: 'canonical-churn',
      mode: 'windowed',
      shortcut: 'Win+Alt',
      claimPath: index === 0
        ? paths.claim
        : path.join(directory, `attempt-${String(index + 1).padStart(2, '0')}.claim.jsonl`),
    })),
  };
  const attemptPlanText = `${JSON.stringify(attemptPlan)}\n`;
  writeFileSync(paths.plan, attemptPlanText, 'utf8');
  const attemptPlanSha256 = createHash('sha256').update(attemptPlanText).digest('hex');
  const target = [
    { atMs: 1_000, event: 'ready', detail: {
      mode: 'windowed', pid: 55, hwnd: 77, binaryPath: paths.targetExe, sourceFingerprint,
    } },
    { atMs: 1_100, event: 'chat-open', detail: { field: 'A', via: 'enter' } },
    { atMs: 1_200, event: 'chat-closed', detail: { via: 'world-click' } },
    { atMs: 1_300, event: 'chat-open', detail: { field: 'B', via: 'chat-region-click' } },
    { atMs: 1_500, event: 'field-paste', detail: { field: 'B' } },
    { atMs: 2_000, event: 'summary', detail: {
      fieldA: '', fieldB: expected, pasteCount: 1, gameplayCharCount: 0, chatOpen: true,
    } },
  ].map((row) => ({ ...row, runId }));
  const dictation = [
    {
      event: 'hotkey-ready', active: true, activeShortcut: 'Win+Alt',
      binaryPath: paths.vaiExe, sourceFingerprint,
    },
    { event: 'acceptance-fixture-enabled', textLength: expected.length },
    { event: 'acceptance-adapter-ready', textLength: expected.length, sourceFingerprint },
    { event: 'released', shortcut: 'Win+Alt', release: {
      releaseId: 7,
      processName: 'vai_ptt_target.exe',
      processId: 55,
      processCreatedTicks: 404,
      hwnd: 77,
      isGame: true,
      windowMode: 'windowed',
      textFieldPlausible: true,
      fieldDetection: 'win32-caret',
    } },
    { event: 'delivery', report: {
      releaseId: 7,
      targetProcess: 'vai_ptt_target.exe',
      route: 'sendinput-accepted',
      sttQuality: 'fast',
      releaseToPasteMs: 700,
    }, deliveryInspection: {
      processId: 55,
      processCreatedTicks: 404,
      hwnd: 77,
      windowMode: 'windowed',
      fieldDetection: 'win32-caret',
      textFieldPlausible: true,
    }, leagueOpenAndPasteRequested: true, leagueOpenAndPasteEligible: false },
    { event: 'clipboard-restore', releaseId: 7, result: 'restored' },
  ].map((row) => ({ ...row, runId }));
  const driver = {
    schemaVersion: 2,
    sourceFingerprint,
    runId,
    workflow: 'canonical-churn',
    shortcut: 'Win+Alt',
    vaiHotkeyReady: true,
    vaiLog: paths.dictation,
    binaryManifest: paths.manifest,
    binaryManifestSha256,
    attemptPlan: paths.plan,
    attemptPlanSha256,
    attemptClaim: paths.claim,
    attemptNumber: 1,
    vaiBinaryPath: paths.vaiExe,
    targetBinaryPath: paths.targetExe,
    driverBinaryPath: paths.driverExe,
    binarySha256: {
      vai: binaryManifest.binaries.vai.sha256,
      target: binaryManifest.binaries.target.sha256,
      driver: binaryManifest.binaries.driver.sha256,
    },
    expected,
    targetPid: 55,
    targetHwnd: 77,
    releasedAtMs: 1_300,
    foregroundAfter: 77,
    clipboardRestored: true,
    stages: [
      'target-manually-verified',
      'field-a-opened',
      'hold-active',
      'world-clicked',
      'field-b-opened',
      'released',
      'delivery-settled',
    ].map((name, index) => ({ name, foreground: 77, atMs: 1_100 + index * 100 })),
  };
  writeFileSync(paths.target, `${target.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  writeFileSync(paths.dictation, `${dictation.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  writeFileSync(paths.driver, `${JSON.stringify(driver)}\n`, 'utf8');
  const attemptClaim = [
    {
      schemaVersion: 1, atMs: 1_050, runId, attemptNumber: 1, sourceFingerprint,
      attemptPlanSha256, binaryManifestSha256,
      binarySha256: driver.binarySha256, terminal: 'started',
    },
    {
      schemaVersion: 1, atMs: 2_100, runId, attemptNumber: 1, sourceFingerprint,
      attemptPlanSha256, binaryManifestSha256,
      binarySha256: driver.binarySha256, terminal: 'succeeded',
    },
  ];
  const attemptClaimText = `${attemptClaim.map((row) => JSON.stringify(row)).join('\n')}\n`;
  writeFileSync(paths.claim, attemptClaimText, 'utf8');
  const evidenceFiles = [paths.target, paths.dictation, paths.driver, paths.claim].map((file) => ({
    path: file,
    sha256: createHash('sha256').update(
      file === paths.target
        ? `${target.map((row) => JSON.stringify(row)).join('\n')}\n`
        : file === paths.dictation
          ? `${dictation.map((row) => JSON.stringify(row)).join('\n')}\n`
          : file === paths.driver
            ? `${JSON.stringify(driver)}\n`
            : attemptClaimText,
    ).digest('hex'),
  }));
  const candidate = buildPttTargetAudit({
    target,
    dictation,
    driver,
    expected,
    targetLog: paths.target,
    dictationLog: paths.dictation,
    driverReport: paths.driver,
    binaryManifest,
    binaryManifestPath: paths.manifest,
    binaryManifestSha256,
    attemptPlan,
    attemptPlanPath: paths.plan,
    attemptPlanSha256,
    attemptClaim,
    attemptClaimPath: paths.claim,
    evidenceFiles,
    runId,
    attemptNumber: 1,
    sourceFingerprint,
  });
  assert.equal(candidate.passed, true);
  assert.equal(verifyPttCandidateEvidence(candidate), true);
  writeFileSync(paths.plan, `${JSON.stringify({ ...attemptPlan, createdAtMs: 1_001 })}\n`, 'utf8');
  assert.equal(verifyPttCandidateEvidence(candidate), false);
  writeFileSync(paths.plan, attemptPlanText, 'utf8');
  writeFileSync(paths.driverExe, 'mutated-driver-binary', 'utf8');
  assert.equal(verifyPttCandidateEvidence(candidate), false);
});
