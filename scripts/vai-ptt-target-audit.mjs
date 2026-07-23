#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    targetLog: '', dictationLog: '', driverReport: '', binaryManifest: '', attemptPlan: '', expected: '', runId: '', attempt: '', out: '',
  };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--target-log') result.targetLog = args[++index] ?? '';
    else if (key === '--dictation-log') result.dictationLog = args[++index] ?? '';
    else if (key === '--driver-report') result.driverReport = args[++index] ?? '';
    else if (key === '--binary-manifest') result.binaryManifest = args[++index] ?? '';
    else if (key === '--attempt-plan') result.attemptPlan = args[++index] ?? '';
    else if (key === '--expected') result.expected = args[++index] ?? '';
    else if (key === '--run-id') result.runId = args[++index] ?? '';
    else if (key === '--attempt') result.attempt = args[++index] ?? '';
    else if (key === '--out') result.out = args[++index] ?? '';
    else if (key === '--help') {
      console.log('Usage: node scripts/vai-ptt-target-audit.mjs --target-log target.jsonl --dictation-log dictation-releases.jsonl --driver-report driver.json --binary-manifest binary-manifest.json --attempt-plan attempt-plan.json --expected nonce --run-id unique-id --attempt 1 --out summary.json');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${key}`);
  }
  for (const [key, value] of Object.entries(result)) {
    if (!value) throw new Error(`Missing --${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`);
  }
  const attempt = Number(result.attempt);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 10) throw new Error('--attempt must be an integer from 1 to 10');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/.test(result.runId)) throw new Error('Invalid --run-id');
  result.attempt = attempt;
  return result;
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalPttPathKey(value) {
  const resolved = path.resolve(value ?? '');
  let normalized = existsSync(resolved) ? realpathSync.native(resolved) : resolved;
  normalized = normalized.replaceAll('/', '\\');
  if (normalized.toLowerCase().startsWith('\\\\?\\unc\\')) normalized = `\\\\${normalized.slice(8)}`;
  else if (normalized.startsWith('\\\\?\\')) normalized = normalized.slice(4);
  return normalized.toLowerCase();
}

export function currentSourceFingerprint() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const entries = readFileSync(path.join(root, 'scripts/vai-ptt-source-files.txt'), 'utf8')
    .split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const hash = createHash('sha256');
  const seen = new Set();
  const expand = (relative) => {
    const absolute = path.join(root, relative);
    if (!statSync(absolute).isDirectory()) return [relative.replaceAll('\\', '/')];
    const files = [];
    const walk = (directory) => {
      const children = readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      for (const child of children) {
        const childPath = path.join(directory, child.name);
        if (child.isDirectory()) walk(childPath);
        else if (child.isFile()) files.push(path.relative(root, childPath).replaceAll('\\', '/'));
      }
    };
    walk(absolute);
    return files.sort();
  };
  for (const relative of entries.flatMap(expand)) {
    if (seen.has(relative)) continue;
    seen.add(relative);
    hash.update(relative);
    hash.update('\0');
    hash.update(readFileSync(path.join(root, relative)));
  }
  return hash.digest('hex');
}

function parseJsonlBytes(file, bytes) {
  return bytes.toString('utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { throw new Error(`${file}:${index + 1}: ${error.message}`); }
    });
}

export function countOccurrences(text, expected) {
  if (!expected) return 0;
  let count = 0;
  for (let index = 0; (index = text.indexOf(expected, index)) >= 0; index += expected.length) count += 1;
  return count;
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

export const PTT_TARGET_CHECK_IDS = [
  'evidence-schema',
  'mode',
  'binary-provenance',
  'attempt-predeclared',
  'attempt-terminal',
  'driver-bound',
  'release-correlated',
  'release-target-identity',
  'release-game-classified',
  'release-field-contract',
  'delivery-route',
  'delivery-inspection-identity',
  'post-open-field-proof',
  'fast-stt',
  'latency-budget',
  'one-paste-message',
  'no-final-enter',
  'no-gameplay-characters',
  'non-target-field-unchanged',
  'target-field-exact',
  'clipboard-restored',
  'target-remained-active',
  'workflow-sequence',
  'driver-foreground-stable',
];

export function buildPttTargetAudit({
  target,
  dictation,
  driver,
  expected,
  targetLog = 'target.jsonl',
  dictationLog = 'dictation-releases.jsonl',
  driverReport = 'driver.json',
  binaryManifest = {},
  binaryManifestPath = 'binary-manifest.json',
  binaryManifestSha256 = '0'.repeat(64),
  attemptPlan = {},
  attemptPlanPath = 'attempt-plan.json',
  attemptPlanSha256 = '0'.repeat(64),
  attemptClaim = [],
  attemptClaimPath = 'attempt.claim.jsonl',
  evidenceFiles = [],
  runId = 'test-run-0001',
  attemptNumber = 1,
  sourceFingerprint = 'test-source-fingerprint',
}) {
  const summaryIndex = target.findLastIndex((row) => row.event === 'summary');
  const readyIndex = target.findLastIndex((row, index) => index < summaryIndex && row.event === 'ready');
  if (readyIndex < 0 || summaryIndex < 0) {
    throw new Error('Target log must contain one completed ready-to-summary session; close the fixture after the run.');
  }
  const targetEvents = target.slice(readyIndex, summaryIndex + 1);
  const ready = targetEvents[0];
  const summary = targetEvents.at(-1);
  const workflow = driver?.workflow ?? 'canonical-churn';
  const openAndPaste = workflow === 'open-and-paste';
  const runDictation = dictation.filter((row) => row.runId === runId);

  const deliveryIndex = dictation.findLastIndex((row) => (
    row.runId === runId
      && row.event === 'delivery'
      && row.report?.targetProcess === 'vai_ptt_target.exe'
  ));
  const delivery = dictation[deliveryIndex];
  const releaseId = delivery?.report?.releaseId;
  const fixtureEnabledIndex = dictation.slice(0, deliveryIndex).findLastIndex((row) => (
    row.runId === runId && row.event === 'acceptance-fixture-enabled'
  ));
  const fixtureEnabled = dictation[fixtureEnabledIndex];
  const adapterReadyIndex = dictation.slice(0, deliveryIndex).findLastIndex((row) => (
    row.runId === runId && row.event === 'acceptance-adapter-ready'
  ));
  const adapterReady = dictation[adapterReadyIndex];
  const releasedIndex = dictation.slice(0, deliveryIndex).findLastIndex((row) => (
    row.runId === runId && row.event === 'released' && row.release?.releaseId === releaseId
  ));
  const released = dictation[releasedIndex];
  const hotkeyReadyIndex = dictation.slice(0, releasedIndex).findLastIndex((row) => (
    row.runId === runId && row.event === 'hotkey-ready'
  ));
  const hotkeyReady = dictation[hotkeyReadyIndex];
  const restoreOffset = dictation.slice(deliveryIndex + 1).findIndex((row) => (
    row.runId === runId && row.event === 'clipboard-restore' && row.releaseId === releaseId
  ));
  const restoreIndex = restoreOffset < 0 ? -1 : deliveryIndex + 1 + restoreOffset;
  const restore = dictation[restoreIndex];
  const pasteEvent = targetEvents.find((row) => row.event === 'field-paste');
  const externalReleaseToPasteMs = Number(pasteEvent?.atMs) - Number(driver?.releasedAtMs);
  const inactiveBeforePaste = Boolean(pasteEvent) && targetEvents.some((row) => (
    row.atMs <= pasteEvent.atMs && row.event === 'activation' && row.detail?.active === false
  ));
  const eventIndex = (predicate) => targetEvents.findIndex(predicate);
  const openA = eventIndex((row) => row.event === 'chat-open' && row.detail?.field === 'A' && row.detail?.via === 'enter');
  const worldClose = eventIndex((row) => row.event === 'chat-closed' && row.detail?.via === 'world-click');
  const openB = eventIndex((row) => row.event === 'chat-open' && row.detail?.field === 'B' && row.detail?.via === 'chat-region-click');
  const pasteA = eventIndex((row) => row.event === 'field-paste' && row.detail?.field === 'A');
  const pasteB = eventIndex((row) => row.event === 'field-paste' && row.detail?.field === 'B');
  const pasteIndex = openAndPaste ? pasteA : pasteB;
  const enterOpenEvents = targetEvents.filter((row) => (
    row.event === 'chat-open' && row.detail?.via === 'enter'
  ));
  const parentEnterCloseEvents = targetEvents.filter((row) => (
    row.event === 'chat-closed' && row.detail?.via === 'enter-toggle-close'
  ));
  const fieldEnterEvents = targetEvents.filter((row) => (
    row.event === 'field-char' && row.detail?.code === 13
  ));
  const controlEnterEvents = targetEvents.filter((row) => (
    row.event === 'control-char' && row.detail?.code === 13
  ));
  const finalEnterAfterPaste = pasteIndex >= 0 && targetEvents.slice(pasteIndex + 1).some((row) => (
    (row.event === 'chat-closed' && row.detail?.via === 'enter-toggle-close')
      || (row.event === 'control-char' && row.detail?.code === 13)
      || (row.event === 'field-char' && row.detail?.code === 13)
  ));
  const canonicalChurn = openA >= 0 && worldClose > openA && openB > worldClose && pasteB > openB;
  const workflowSequence = openAndPaste ? openA >= 0 && pasteA > openA : canonicalChurn;
  const targetField = openAndPaste ? 'A' : 'B';
  const fieldA = String(summary.detail?.fieldA ?? '');
  const fieldB = String(summary.detail?.fieldB ?? '');
  const targetValue = targetField === 'A' ? fieldA : fieldB;
  const otherValue = targetField === 'A' ? fieldB : fieldA;
  const release = released?.release;
  const inspection = delivery?.deliveryInspection;
  const expectedWindowMode = ready.detail?.mode === 'borderless'
    ? 'borderless-or-exclusive'
    : 'windowed';
  const expectedRoute = openAndPaste ? 'open-and-paste-input-accepted' : 'sendinput-accepted';
  const concretePostOpen = !openAndPaste || ['win32-caret', 'focused-text-control'].includes(inspection?.fieldDetection);
  const identity = {
    pid: ready.detail?.pid,
    hwnd: ready.detail?.hwnd,
  };
  const expectedDriverStages = openAndPaste
    ? ['target-manually-verified', 'chat-closed-before-hold', 'hold-active', 'released', 'delivery-settled']
    : ['target-manually-verified', 'field-a-opened', 'hold-active', 'world-clicked', 'field-b-opened', 'released', 'delivery-settled'];
  const actualDriverStages = driver?.stages?.map((stage) => stage.name) ?? [];
  const driverStageTimes = driver?.stages?.map((stage) => Number(stage.atMs)) ?? [];
  const targetTimes = targetEvents.map((row) => Number(row.atMs));
  const releasedStage = driver?.stages?.find((stage) => stage.name === 'released');
  const runReleaseRows = runDictation.filter((row) => row.event === 'released');
  const runDeliveryRows = runDictation.filter((row) => row.event === 'delivery');
  const runRestoreRows = runDictation.filter((row) => row.event === 'clipboard-restore');
  const runFixtureRows = runDictation.filter((row) => row.event === 'acceptance-fixture-enabled');
  const runAdapterReadyRows = runDictation.filter((row) => row.event === 'acceptance-adapter-ready');
  const binaryNames = ['vai', 'target', 'driver'];
  const binaryEntries = binaryNames.map((name) => binaryManifest?.binaries?.[name]);
  const expectedBinaryNames = ['veggaai.exe', 'vai_ptt_target.exe', 'vai_ptt_fixture_driver.exe'];
  const binaryEntryValid = (entry, index) => entry
    && path.isAbsolute(entry.path ?? '')
    && path.basename(entry.path).toLowerCase() === expectedBinaryNames[index]
    && canonicalPttPathKey(entry.path).includes('\\target\\release\\')
    && Number.isInteger(entry.size)
    && entry.size > 0
    && /^[a-f0-9]{64}$/.test(entry.sha256 ?? '');
  const samePath = (left, right) => canonicalPttPathKey(left) === canonicalPttPathKey(right);
  const plannedAttempts = attemptPlan?.attempts ?? [];
  const plannedAttempt = plannedAttempts[attemptNumber - 1];
  const claimStarted = attemptClaim[0];
  const claimTerminal = attemptClaim[1];
  const checks = [
    check('evidence-schema', driver?.schemaVersion === 2
      && driver?.runId === runId
      && readyIndex === 0
      && summaryIndex === target.length - 1
      && target.length === targetEvents.length
      && targetEvents.every((row) => row.runId === runId)
      && dictation.every((row) => row.runId === runId)
      && fixtureEnabled?.textLength === expected.length
      && adapterReady?.textLength === expected.length
      && adapterReady?.sourceFingerprint === sourceFingerprint
      && runFixtureRows.length === 1
      && runAdapterReadyRows.length >= 1
      && runReleaseRows.length === 1
      && runDeliveryRows.length === 1
      && runRestoreRows.length === 1
      && evidenceFiles.length === 4, {
      driver: driver?.schemaVersion,
      runId,
      fixtureTextLength: fixtureEnabled?.textLength,
      evidenceFiles,
      rowCounts: {
        fixture: runFixtureRows.length,
        adapterReady: runAdapterReadyRows.length,
        release: runReleaseRows.length,
        delivery: runDeliveryRows.length,
        restore: runRestoreRows.length,
      },
    }),
    check('mode', ['windowed', 'borderless'].includes(ready.detail?.mode), ready.detail?.mode),
    check('binary-provenance', binaryManifest?.schemaVersion === 1
      && binaryManifest?.sourceFingerprint === sourceFingerprint
      && binaryManifest?.buildContract?.cargoProfile === 'release'
      && binaryManifest?.buildContract?.dangerousPttFixture === true
      && binaryManifest?.buildContract?.renderer === 'embedded-release-assets'
      && /^[a-f0-9]{64}$/.test(binaryManifestSha256)
      && binaryEntries.every(binaryEntryValid)
      && new Set(binaryEntries.map((entry) => canonicalPttPathKey(entry.path))).size === 3
      && samePath(driver?.binaryManifest, binaryManifestPath)
      && samePath(driver?.vaiBinaryPath, binaryManifest?.binaries?.vai?.path)
      && samePath(driver?.targetBinaryPath, binaryManifest?.binaries?.target?.path)
      && samePath(driver?.driverBinaryPath, binaryManifest?.binaries?.driver?.path)
      && driver?.binaryManifestSha256 === binaryManifestSha256
      && driver?.binarySha256?.vai === binaryManifest?.binaries?.vai?.sha256
      && driver?.binarySha256?.target === binaryManifest?.binaries?.target?.sha256
      && driver?.binarySha256?.driver === binaryManifest?.binaries?.driver?.sha256
      && samePath(hotkeyReady?.binaryPath, binaryManifest?.binaries?.vai?.path)
      && samePath(ready.detail?.binaryPath, binaryManifest?.binaries?.target?.path)
      && hotkeyReady?.sourceFingerprint === sourceFingerprint
      && ready.detail?.sourceFingerprint === sourceFingerprint
      && driver?.sourceFingerprint === sourceFingerprint, {
      binaryManifestPath,
      binaryManifestSha256,
      driverBinaryManifest: driver?.binaryManifest,
      readyBinaryPath: ready.detail?.binaryPath,
      hotkeyBinaryPath: hotkeyReady?.binaryPath,
      binaries: binaryManifest?.binaries,
    }),
    check('attempt-predeclared', attemptPlan?.schemaVersion === 1
      && attemptPlan?.sourceFingerprint === sourceFingerprint
      && attemptPlan?.binaryManifestSha256 === binaryManifestSha256
      && samePath(attemptPlan?.binaryManifestPath, binaryManifestPath)
      && /^[a-f0-9]{64}$/.test(attemptPlanSha256)
      && Number.isFinite(attemptPlan?.createdAtMs)
      && attemptPlan.createdAtMs <= Number(ready.detail?.startedAtMs ?? ready.atMs)
      && plannedAttempts.length === 10
      && plannedAttempts.every((item, index) => item?.attemptNumber === index + 1)
      && new Set(plannedAttempts.map((item) => item.runId)).size === 10
      && new Set(plannedAttempts.map((item) => item.nonce)).size === 10
      && plannedAttempt?.runId === runId
      && plannedAttempt?.nonce === expected
      && plannedAttempt?.workflow === workflow
      && plannedAttempt?.mode === ready.detail?.mode
      && plannedAttempt?.shortcut === driver?.shortcut
      && driver?.attemptNumber === attemptNumber
      && driver?.attemptPlanSha256 === attemptPlanSha256
      && samePath(driver?.attemptPlan, attemptPlanPath)
      && samePath(driver?.attemptClaim, plannedAttempt?.claimPath)
      && samePath(attemptClaimPath, plannedAttempt?.claimPath), {
      attemptNumber,
      attemptPlanPath,
      attemptPlanSha256,
      plannedAttempt,
      driverAttemptNumber: driver?.attemptNumber,
      driverAttemptPlan: driver?.attemptPlan,
      driverAttemptClaim: driver?.attemptClaim,
    }),
    check('attempt-terminal', attemptClaim.length === 2
      && claimStarted?.schemaVersion === 1
      && claimStarted?.runId === runId
      && claimStarted?.attemptNumber === attemptNumber
      && claimStarted?.terminal === 'started'
      && claimStarted?.sourceFingerprint === sourceFingerprint
      && claimStarted?.attemptPlanSha256 === attemptPlanSha256
      && claimStarted?.binaryManifestSha256 === binaryManifestSha256
      && claimStarted?.binarySha256?.vai === binaryManifest?.binaries?.vai?.sha256
      && claimStarted?.binarySha256?.target === binaryManifest?.binaries?.target?.sha256
      && claimStarted?.binarySha256?.driver === binaryManifest?.binaries?.driver?.sha256
      && claimTerminal?.schemaVersion === 1
      && claimTerminal?.runId === runId
      && claimTerminal?.attemptNumber === attemptNumber
      && claimTerminal?.terminal === 'succeeded'
      && claimTerminal?.sourceFingerprint === sourceFingerprint
      && claimTerminal?.attemptPlanSha256 === attemptPlanSha256
      && claimTerminal?.binaryManifestSha256 === binaryManifestSha256
      && isDeepStrictEqual(claimTerminal?.binarySha256, claimStarted?.binarySha256)
      && Number.isFinite(claimStarted?.atMs)
      && Number.isFinite(claimTerminal?.atMs)
      && claimStarted.atMs >= Number(attemptPlan?.createdAtMs)
      && claimStarted.atMs >= Number(ready.detail?.startedAtMs ?? ready.atMs)
      && claimStarted.atMs <= Number(driver?.stages?.[0]?.atMs)
      && claimTerminal.atMs >= Number(driver?.stages?.at(-1)?.atMs)
      && claimTerminal.atMs >= Number(summary?.atMs), {
      claimStarted,
      claimTerminal,
      attemptClaimPath,
    }),
    check('driver-bound', driver?.expected === expected
      && driver?.targetPid === identity.pid
      && driver?.targetHwnd === identity.hwnd
      && driver?.workflow === workflow
      && samePath(driver?.vaiLog, dictationLog)
      && ['Win+Alt', 'Ctrl+Shift+Space'].includes(driver?.shortcut)
      && driver?.vaiHotkeyReady === true
      && hotkeyReady?.active === true
      && hotkeyReady?.activeShortcut === driver.shortcut
      && released?.shortcut === driver.shortcut, {
      driver,
      hotkeyReady,
      releasedShortcut: released?.shortcut,
    }),
    check('release-correlated', Number.isSafeInteger(releaseId)
      && releaseId > 0
      && hotkeyReadyIndex >= 0
      && fixtureEnabledIndex >= 0
      && adapterReadyIndex >= 0
      && hotkeyReadyIndex < releasedIndex
      && fixtureEnabledIndex < releasedIndex
      && adapterReadyIndex < releasedIndex
      && deliveryIndex > releasedIndex
      && restoreIndex > deliveryIndex
      && Number.isFinite(externalReleaseToPasteMs)
      && externalReleaseToPasteMs >= 0
      && externalReleaseToPasteMs <= 1_500, {
      releaseId,
      driverReleasedAtMs: driver?.releasedAtMs,
      targetPasteAtMs: pasteEvent?.atMs,
      externalReleaseToPasteMs,
      ordering: { hotkeyReadyIndex, fixtureEnabledIndex, adapterReadyIndex, releasedIndex, deliveryIndex, restoreIndex },
    }),
    check('release-target-identity', release?.processName === 'vai_ptt_target.exe'
      && release?.processId === identity.pid
      && release?.hwnd === identity.hwnd, { release, identity }),
    check('release-game-classified', release?.isGame === true
      && release?.windowMode === expectedWindowMode, {
      isGame: release?.isGame,
      windowMode: release?.windowMode,
      expectedWindowMode,
    }),
    check('release-field-contract', openAndPaste
      ? release?.textFieldPlausible === false
      : release?.textFieldPlausible === true, release?.fieldDetection),
    check('delivery-route', delivery?.report?.route === expectedRoute
      && delivery?.leagueOpenAndPasteEligible === openAndPaste
      && (!openAndPaste || delivery?.leagueOpenAndPasteRequested === true), {
      route: delivery?.report?.route,
      requested: delivery?.leagueOpenAndPasteRequested,
      eligible: delivery?.leagueOpenAndPasteEligible,
    }),
    check('delivery-inspection-identity', inspection?.processId === identity.pid
      && inspection?.hwnd === identity.hwnd
      && release?.processCreatedTicks != null
      && inspection?.processCreatedTicks === release.processCreatedTicks
      && inspection?.windowMode === expectedWindowMode, { inspection, identity, expectedWindowMode }),
    check('post-open-field-proof', concretePostOpen
      && (!openAndPaste || inspection?.textFieldPlausible === true), {
      fieldDetection: inspection?.fieldDetection,
      textFieldPlausible: inspection?.textFieldPlausible,
    }),
    check('fast-stt', delivery?.report?.sttQuality === 'fast', delivery?.report?.sttQuality),
    check('latency-budget', Number.isFinite(delivery?.report?.releaseToPasteMs)
      && delivery.report.releaseToPasteMs >= 0
      && delivery.report.releaseToPasteMs <= 1_500, delivery?.report?.releaseToPasteMs),
    check('one-paste-message', summary.detail?.pasteCount === 1, summary.detail?.pasteCount),
    check('no-final-enter', enterOpenEvents.length === 1
      && parentEnterCloseEvents.length === 0
      && fieldEnterEvents.length === 0
      && controlEnterEvents.length <= 1
      && controlEnterEvents.every((row) => row.atMs < pasteEvent?.atMs)
      && !finalEnterAfterPaste
      && summary.detail?.chatOpen === true, {
      enterOpenCount: enterOpenEvents.length,
      parentEnterCloseCount: parentEnterCloseEvents.length,
      fieldEnterCount: fieldEnterEvents.length,
      controlEnterCount: controlEnterEvents.length,
      finalEnterAfterPaste,
      chatOpen: summary.detail?.chatOpen,
    }),
    check('no-gameplay-characters', summary.detail?.gameplayCharCount === 0, summary.detail?.gameplayCharCount),
    check('non-target-field-unchanged', otherValue === '', { targetField, otherValue }),
    check('target-field-exact', targetValue === expected && countOccurrences(targetValue, expected) === 1, targetValue),
    check('clipboard-restored', restore?.result === 'restored'
      && driver?.clipboardRestored === true, { restore: restore?.result, driver: driver?.clipboardRestored }),
    check('target-remained-active', !inactiveBeforePaste, { inactiveBeforePaste }),
    check('workflow-sequence', workflowSequence, { workflow, openA, worldClose, openB, pasteA, pasteB }),
    check('driver-foreground-stable', driver?.foregroundAfter === identity.hwnd
      && isDeepStrictEqual(actualDriverStages, expectedDriverStages)
      && driver?.stages?.every((stage) => stage.foreground === identity.hwnd)
      && driverStageTimes.every((value, index) => (
        Number.isFinite(value) && (index === 0 || value >= driverStageTimes[index - 1])
      ))
      && Number.isFinite(driver?.releasedAtMs)
      && driver.releasedAtMs >= driverStageTimes[0]
      && driver.releasedAtMs <= Number(releasedStage?.atMs)
      && targetTimes.every((value, index) => (
        Number.isFinite(value) && (index === 0 || value >= targetTimes[index - 1])
      )), {
      foregroundAfter: driver?.foregroundAfter,
      expected: identity.hwnd,
      actualDriverStages,
      expectedDriverStages,
      driverStageTimes,
      targetTimes,
    }),
  ];
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    targetLog,
    dictationLog,
    driverReport,
    binaryManifestPath,
    binaryManifestSha256,
    attemptPlanPath,
    attemptPlanSha256,
    attemptClaimPath,
    evidenceFiles,
    runId,
    attemptNumber,
    sourceFingerprint,
    evidenceStartedAtMs: ready.detail?.startedAtMs ?? ready.atMs ?? null,
    evidenceReleasedAtMs: driver?.releasedAtMs ?? null,
    evidencePasteAtMs: pasteEvent?.atMs ?? null,
    attemptClaimStartedAtMs: claimStarted?.atMs ?? null,
    attemptClaimTerminalAtMs: claimTerminal?.atMs ?? null,
    expected,
    releaseId: releaseId ?? null,
    mode: ready.detail?.mode ?? null,
    workflow,
    shortcut: driver?.shortcut ?? null,
    targetPid: identity.pid ?? null,
    targetHwnd: identity.hwnd ?? null,
    churnObserved: canonicalChurn,
    checks,
    passed: checks.length === PTT_TARGET_CHECK_IDS.length
      && checks.every((row, index) => row.id === PTT_TARGET_CHECK_IDS[index] && row.passed),
  };
}

function main() {
  const args = parseArgs();
  const targetLog = path.resolve(args.targetLog);
  const dictationLog = path.resolve(args.dictationLog);
  const driverReport = path.resolve(args.driverReport);
  const binaryManifestPath = path.resolve(args.binaryManifest);
  const attemptPlanPath = path.resolve(args.attemptPlan);
  if (!existsSync(driverReport)) throw new Error(`Evidence file does not exist: ${driverReport}`);
  if (!existsSync(binaryManifestPath)) throw new Error(`Binary manifest does not exist: ${binaryManifestPath}`);
  if (!existsSync(attemptPlanPath)) throw new Error(`Attempt plan does not exist: ${attemptPlanPath}`);
  const targetBytes = readFileSync(targetLog);
  const dictationBytes = readFileSync(dictationLog);
  const driverBytes = readFileSync(driverReport);
  const binaryManifestBytes = readFileSync(binaryManifestPath);
  const attemptPlanBytes = readFileSync(attemptPlanPath);
  const attemptPlan = JSON.parse(attemptPlanBytes.toString('utf8'));
  const attemptClaimPath = path.resolve(
    attemptPlan?.attempts?.[args.attempt - 1]?.claimPath ?? '',
  );
  if (!existsSync(attemptClaimPath)) throw new Error(`Attempt claim does not exist: ${attemptClaimPath}`);
  const attemptClaimBytes = readFileSync(attemptClaimPath);
  const evidenceFiles = [
    [targetLog, targetBytes],
    [dictationLog, dictationBytes],
    [driverReport, driverBytes],
    [attemptClaimPath, attemptClaimBytes],
  ].map(([file, bytes]) => ({ path: file, sha256: sha256Bytes(bytes) }));
  const report = buildPttTargetAudit({
    target: parseJsonlBytes(targetLog, targetBytes),
    dictation: parseJsonlBytes(dictationLog, dictationBytes),
    driver: JSON.parse(driverBytes.toString('utf8')),
    binaryManifest: JSON.parse(binaryManifestBytes.toString('utf8')),
    attemptPlan,
    attemptClaim: parseJsonlBytes(attemptClaimPath, attemptClaimBytes),
    expected: args.expected,
    targetLog,
    dictationLog,
    driverReport,
    binaryManifestPath,
    binaryManifestSha256: sha256Bytes(binaryManifestBytes),
    attemptPlanPath,
    attemptPlanSha256: sha256Bytes(attemptPlanBytes),
    attemptClaimPath,
    evidenceFiles,
    runId: args.runId,
    attemptNumber: args.attempt,
    sourceFingerprint: currentSourceFingerprint(),
  });
  const output = path.resolve(args.out);
  if (existsSync(output)) throw new Error(`Refusing to overwrite append-only evidence: ${output}`);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`VAI_PTT_TARGET_AUDIT ${report.passed ? 'PASS' : 'FAIL'} checks=${report.checks.filter((row) => row.passed).length}/${report.checks.length}`);
  console.log(`report=${output}`);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    console.error(`VAI_PTT_TARGET_AUDIT_ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
