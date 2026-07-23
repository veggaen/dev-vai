import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { buildPttTargetAudit, canonicalPttPathKey } from '../vai-ptt-target-audit.mjs';

function evidence(overrides = {}) {
  const expected = 'ptt-nonce-7';
  const runId = 'test-run-0001';
  const sourceFingerprint = 'f'.repeat(64);
  const binaryManifestPath = path.resolve('binary-manifest.json');
  const attemptPlanPath = path.resolve('attempt-plan.json');
  const attemptClaimPath = path.resolve('attempt-01.claim.jsonl');
  const vaiBinaryPath = path.resolve('target/release/veggaai.exe');
  const targetBinaryPath = path.resolve('target/release/vai_ptt_target.exe');
  const driverBinaryPath = path.resolve('target/release/vai_ptt_fixture_driver.exe');
  const binaryManifest = {
    schemaVersion: 1,
    sourceFingerprint,
    buildContract: {
      cargoProfile: 'release', dangerousPttFixture: true, renderer: 'embedded-release-assets',
    },
    binaries: {
      vai: { path: vaiBinaryPath, size: 101, sha256: 'a'.repeat(64) },
      target: { path: targetBinaryPath, size: 102, sha256: 'b'.repeat(64) },
      driver: { path: driverBinaryPath, size: 103, sha256: 'c'.repeat(64) },
    },
  };
  const attemptPlan = {
    schemaVersion: 1,
    sourceFingerprint,
    binaryManifestPath,
    binaryManifestSha256: 'd'.repeat(64),
    createdAtMs: 500,
    attempts: Array.from({ length: 10 }, (_, index) => ({
      attemptNumber: index + 1,
      runId: index === 0 ? runId : `planned-run-${String(index + 1).padStart(4, '0')}`,
      nonce: index === 0 ? expected : `planned-nonce-${String(index + 1).padStart(4, '0')}`,
      workflow: 'canonical-churn',
      mode: 'borderless',
      shortcut: 'Win+Alt',
      claimPath: index === 0
        ? attemptClaimPath
        : path.resolve(`attempt-${String(index + 1).padStart(2, '0')}.claim.jsonl`),
    })),
  };
  const target = [
    { atMs: 1_000, event: 'ready', detail: {
      mode: 'borderless', pid: 55, hwnd: 77, binaryPath: targetBinaryPath, sourceFingerprint,
    } },
    { atMs: 1_100, event: 'chat-open', detail: { field: 'A', via: 'enter' } },
    { atMs: 1_200, event: 'chat-closed', detail: { via: 'world-click' } },
    { atMs: 1_300, event: 'chat-open', detail: { field: 'B', via: 'chat-region-click' } },
    { atMs: 1_500, event: 'field-paste', detail: { field: 'B' } },
    { atMs: 2_000, event: 'summary', detail: { fieldA: '', fieldB: expected, pasteCount: 1, gameplayCharCount: 0, chatOpen: true } },
  ].map((row) => ({ ...row, runId }));
  const dictation = [
    { event: 'hotkey-ready', active: true, activeShortcut: 'Win+Alt', binaryPath: vaiBinaryPath, sourceFingerprint },
    { event: 'acceptance-fixture-enabled', textLength: expected.length },
    { event: 'acceptance-adapter-ready', textLength: expected.length, sourceFingerprint },
    { event: 'released', shortcut: 'Win+Alt', release: {
      releaseId: 7,
      processName: 'vai_ptt_target.exe',
      processId: 55,
      processCreatedTicks: 404,
      hwnd: 77,
      isGame: true,
      windowMode: 'borderless-or-exclusive',
      textFieldPlausible: true,
      fieldDetection: 'win32-caret',
    } },
    {
      event: 'delivery',
      report: { releaseId: 7, targetProcess: 'vai_ptt_target.exe', route: 'sendinput-accepted', sttQuality: 'fast', releaseToPasteMs: 740 },
      deliveryInspection: { processId: 55, processCreatedTicks: 404, hwnd: 77, windowMode: 'borderless-or-exclusive', fieldDetection: 'win32-caret', textFieldPlausible: true },
      leagueOpenAndPasteRequested: true,
      leagueOpenAndPasteEligible: false,
    },
    { event: 'clipboard-restore', releaseId: 7, result: 'restored' },
  ].map((row) => ({ ...row, runId }));
  const driver = {
    schemaVersion: 2,
    sourceFingerprint,
    runId,
    workflow: 'canonical-churn',
    shortcut: 'Win+Alt',
    vaiHotkeyReady: true,
    vaiLog: 'dictation-releases.jsonl',
    binaryManifest: binaryManifestPath,
    binaryManifestSha256: 'd'.repeat(64),
    attemptPlan: attemptPlanPath,
    attemptPlanSha256: 'e'.repeat(64),
    attemptClaim: attemptClaimPath,
    attemptNumber: 1,
    vaiBinaryPath,
    targetBinaryPath,
    driverBinaryPath,
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
  const attemptClaim = [
    {
      schemaVersion: 1,
      atMs: 1_050,
      runId,
      attemptNumber: 1,
      sourceFingerprint,
      attemptPlanSha256: 'e'.repeat(64),
      binaryManifestSha256: 'd'.repeat(64),
      binarySha256: {
        vai: binaryManifest.binaries.vai.sha256,
        target: binaryManifest.binaries.target.sha256,
        driver: binaryManifest.binaries.driver.sha256,
      },
      terminal: 'started',
    },
    {
      schemaVersion: 1,
      atMs: 2_100,
      runId,
      attemptNumber: 1,
      sourceFingerprint,
      attemptPlanSha256: 'e'.repeat(64),
      binaryManifestSha256: 'd'.repeat(64),
      binarySha256: {
        vai: binaryManifest.binaries.vai.sha256,
        target: binaryManifest.binaries.target.sha256,
        driver: binaryManifest.binaries.driver.sha256,
      },
      terminal: 'succeeded',
    },
  ];
  const evidenceFiles = ['target', 'dictation', 'driver', 'claim'].map((name) => ({
    path: `${name}.json`,
    sha256: name.repeat(64).slice(0, 64),
  }));
  return {
    target,
    dictation,
    driver,
    binaryManifest,
    binaryManifestPath,
    binaryManifestSha256: 'd'.repeat(64),
    attemptPlan,
    attemptPlanPath,
    attemptPlanSha256: 'e'.repeat(64),
    attemptClaim,
    attemptClaimPath,
    evidenceFiles,
    expected,
    runId,
    sourceFingerprint,
    ...overrides,
  };
}

test('normalizes Windows extended-length paths to the manifest form', () => {
  assert.equal(
    canonicalPttPathKey('C:\\Vai\\target\\release\\veggaai.exe'),
    canonicalPttPathKey('\\\\?\\C:\\Vai\\target\\release\\veggaai.exe'),
  );
});

test('uses canonical Windows paths for the driver log binding', () => {
  const fixture = evidence();
  const normal = path.resolve('dictation-releases.jsonl');
  fixture.dictationLog = normal;
  fixture.driver.vaiLog = `\\\\?\\${normal}`;
  assert.equal(
    buildPttTargetAudit(fixture).checks.find((row) => row.id === 'driver-bound')?.passed,
    true,
  );
});

test('rejects release evidence before the exact fixture adapter is committed', () => {
  const fixture = evidence();
  fixture.dictation = fixture.dictation.filter((row) => row.event !== 'acceptance-adapter-ready');
  const report = buildPttTargetAudit(fixture);
  assert.equal(report.checks.find((row) => row.id === 'evidence-schema')?.passed, false);
  assert.equal(report.checks.find((row) => row.id === 'release-correlated')?.passed, false);
});

test('accepts the canonical field-A to world to field-B release', () => {
  const report = buildPttTargetAudit(evidence());
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 24);
  assert.equal(report.churnObserved, true);
});

test('accepts the canonical opening Enter native control row before paste', () => {
  const fixture = evidence();
  fixture.target.splice(2, 0, {
    runId: fixture.runId,
    atMs: 1_150,
    event: 'control-char',
    detail: { code: 13 },
  });
  assert.equal(buildPttTargetAudit(fixture).passed, true);
});

test('rejects duplicate paste, gameplay input, stale-field delivery, and excess latency', () => {
  const fixture = evidence();
  fixture.target.at(-1).detail = {
    fieldA: fixture.expected,
    fieldB: `${fixture.expected} ${fixture.expected}`,
    pasteCount: 2,
    gameplayCharCount: 3,
  };
  fixture.dictation.find((row) => row.event === 'delivery').report.releaseToPasteMs = 1_501;
  const report = buildPttTargetAudit(fixture);
  assert.equal(report.passed, false);
  for (const id of ['latency-budget', 'one-paste-message', 'no-gameplay-characters', 'non-target-field-unchanged', 'target-field-exact']) {
    assert.equal(report.checks.find((row) => row.id === id)?.passed, false, id);
  }
});

test('rejects target deactivation before the paste', () => {
  const fixture = evidence();
  fixture.target.splice(4, 0, { atMs: 1_400, event: 'activation', detail: { active: false } });
  const report = buildPttTargetAudit(fixture);
  assert.equal(report.checks.find((row) => row.id === 'target-remained-active')?.passed, false);
});

test('does not hide a focus theft behind later reactivation', () => {
  const fixture = evidence();
  fixture.target.splice(
    4,
    0,
    { atMs: 1_380, event: 'activation', detail: { active: false } },
    { atMs: 1_420, event: 'activation', detail: { active: true } },
  );
  const report = buildPttTargetAudit(fixture);
  assert.equal(report.checks.find((row) => row.id === 'target-remained-active')?.passed, false);
});

test('rejects a run that skips the canonical mid-hold churn sequence', () => {
  const fixture = evidence();
  fixture.target = fixture.target.filter((row) => row.event !== 'chat-closed');
  const report = buildPttTargetAudit(fixture);
  assert.equal(report.checks.find((row) => row.id === 'workflow-sequence')?.passed, false);
});

test('rejects a driver chord that does not match Vai’s active release chord', () => {
  const fixture = evidence();
  fixture.driver.shortcut = 'Ctrl+Shift+Space';
  const report = buildPttTargetAudit(fixture);
  assert.equal(report.checks.find((row) => row.id === 'driver-bound')?.passed, false);
});

test('rejects an automatic final Enter after the paste', () => {
  const fixture = evidence();
  fixture.target.splice(-1, 0,
    { runId: fixture.runId, atMs: 1_600, event: 'chat-closed', detail: { via: 'enter-toggle-close' } },
    { runId: fixture.runId, atMs: 1_601, event: 'control-char', detail: { code: 13 } },
  );
  fixture.target.at(-1).detail.chatOpen = false;
  const report = buildPttTargetAudit(fixture);
  assert.equal(report.checks.find((row) => row.id === 'no-final-enter')?.passed, false);
});

test('rejects an extra Enter before paste and any foreign-run evidence rows', () => {
  const fixture = evidence();
  fixture.target.splice(4, 0, {
    runId: fixture.runId,
    atMs: 1_400,
    event: 'field-char',
    detail: { field: 'B', code: 13 },
  });
  let report = buildPttTargetAudit(fixture);
  assert.equal(report.checks.find((row) => row.id === 'no-final-enter')?.passed, false);

  const mixed = evidence();
  mixed.target.push({ runId: 'foreign-run-0001', atMs: 2_100, event: 'noise', detail: {} });
  mixed.dictation.push({ runId: 'foreign-run-0001', event: 'noise' });
  report = buildPttTargetAudit(mixed);
  assert.equal(report.checks.find((row) => row.id === 'evidence-schema')?.passed, false);
});

test('rejects a failed, aborted, or retried predeclared attempt', () => {
  const failed = evidence();
  failed.attemptClaim[1].terminal = 'failed-or-aborted';
  assert.equal(
    buildPttTargetAudit(failed).checks.find((row) => row.id === 'attempt-terminal')?.passed,
    false,
  );

  const retried = evidence();
  retried.attemptClaim.push({
    schemaVersion: 1,
    atMs: 1_900,
    runId: retried.runId,
    attemptNumber: 1,
    terminal: 'succeeded',
  });
  assert.equal(
    buildPttTargetAudit(retried).checks.find((row) => row.id === 'attempt-terminal')?.passed,
    false,
  );
});

test('rejects a terminal claim written before the target summary', () => {
  const fixture = evidence();
  fixture.attemptClaim[1].atMs = 1_999;
  assert.equal(
    buildPttTargetAudit(fixture).checks.find((row) => row.id === 'attempt-terminal')?.passed,
    false,
  );
});

test('rejects impossible non-positive release IDs', () => {
  for (const releaseId of [0, -1]) {
    const fixture = evidence();
    fixture.dictation.find((row) => row.event === 'released').release.releaseId = releaseId;
    fixture.dictation.find((row) => row.event === 'delivery').report.releaseId = releaseId;
    fixture.dictation.find((row) => row.event === 'clipboard-restore').releaseId = releaseId;
    assert.equal(
      buildPttTargetAudit(fixture).checks.find((row) => row.id === 'release-correlated')?.passed,
      false,
    );
  }
});

test('rejects runtime binary or source fingerprints that do not match the manifest', () => {
  const binaryMismatch = evidence();
  binaryMismatch.driver.binarySha256.target = '9'.repeat(64);
  assert.equal(
    buildPttTargetAudit(binaryMismatch).checks.find((row) => row.id === 'binary-provenance')?.passed,
    false,
  );

  const sourceMismatch = evidence();
  sourceMismatch.dictation.find((row) => row.event === 'hotkey-ready').sourceFingerprint = '8'.repeat(64);
  assert.equal(
    buildPttTargetAudit(sourceMismatch).checks.find((row) => row.id === 'binary-provenance')?.passed,
    false,
  );
});

test('accepts League Open & paste only when Enter opens a concretely focused field', () => {
  const fixture = evidence();
  fixture.driver.workflow = 'open-and-paste';
  fixture.attemptPlan.attempts[0].workflow = 'open-and-paste';
  fixture.target = [
    { atMs: 1_000, event: 'ready', detail: {
      mode: 'borderless', pid: 55, hwnd: 77,
      binaryPath: fixture.binaryManifest.binaries.target.path,
      sourceFingerprint: fixture.sourceFingerprint,
    } },
    { atMs: 1_300, event: 'chat-open', detail: { field: 'A', via: 'enter' } },
    { atMs: 1_500, event: 'field-paste', detail: { field: 'A' } },
    { atMs: 2_000, event: 'summary', detail: { fieldA: fixture.expected, fieldB: '', pasteCount: 1, gameplayCharCount: 0, chatOpen: true } },
  ].map((row) => ({ ...row, runId: fixture.runId }));
  const released = fixture.dictation.find((row) => row.event === 'released');
  const delivery = fixture.dictation.find((row) => row.event === 'delivery');
  released.release.textFieldPlausible = false;
  released.release.fieldDetection = 'game-without-text-focus-evidence';
  delivery.report.route = 'open-and-paste-input-accepted';
  delivery.leagueOpenAndPasteEligible = true;
  fixture.driver.stages = [
    'target-manually-verified',
    'chat-closed-before-hold',
    'hold-active',
    'released',
    'delivery-settled',
  ].map((name, index) => ({ name, foreground: 77, atMs: 1_100 + index * 100 }));
  const report = buildPttTargetAudit(fixture);
  assert.equal(report.passed, true);
  assert.equal(report.workflow, 'open-and-paste');
  assert.equal(report.churnObserved, false);
});

test('rejects Open & paste when post-Enter field proof is heuristic only', () => {
  const fixture = evidence();
  fixture.driver.workflow = 'open-and-paste';
  fixture.attemptPlan.attempts[0].workflow = 'open-and-paste';
  const released = fixture.dictation.find((row) => row.event === 'released');
  const delivery = fixture.dictation.find((row) => row.event === 'delivery');
  released.release.textFieldPlausible = false;
  delivery.report.route = 'open-and-paste-input-accepted';
  delivery.leagueOpenAndPasteEligible = true;
  fixture.driver.stages = [
    'target-manually-verified',
    'chat-closed-before-hold',
    'hold-active',
    'released',
    'delivery-settled',
  ].map((name, index) => ({ name, foreground: 77, atMs: 1_100 + index * 100 }));
  delivery.deliveryInspection.fieldDetection = 'recent-enter-chat-arm';
  const report = buildPttTargetAudit(fixture);
  assert.equal(report.checks.find((row) => row.id === 'post-open-field-proof')?.passed, false);
});
