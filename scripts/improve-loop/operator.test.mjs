// Run: node --test scripts/improve-loop/operator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHandoffMarkdown,
  buildSupervisorNodeArgs,
  buildVisualNodeArgs,
  buildWatchNodeArgs,
  classifyLoopLiveness,
  classifyStaleRunRecovery,
  formatNodeCommand,
  parseOperatorArgs,
} from './operator-utils.mjs';

test('start defaults to observe mode and the standard corpus/runtime', () => {
  const opts = parseOperatorArgs(['start'], {});
  assert.equal(opts.command, 'start');
  assert.equal(opts.apply, false);
  assert.equal(opts.mode, 'observe');
  assert.equal(opts.db, 'scripts/improve-loop/.corpus.sqlite');
  assert.equal(opts.baseUrl, 'http://localhost:3006');
});

test('apply mode is an explicit switch in supervisor args', () => {
  const opts = parseOperatorArgs([
    'start',
    '--mode', 'apply',
    '--db', 'C:/tmp/helper.sqlite',
    '--base-url', 'http://10.0.0.5:3006',
    '--max-cycles', '2',
    '--seeds-only',
    '--vram-gb', '5',
    '--cooldown', '3000',
    '--qwen-frac', '0',
    '--limit', '1',
  ], {});
  const args = buildSupervisorNodeArgs(opts);
  assert.deepEqual(args, [
    '--experimental-sqlite',
    'scripts/improve-loop/supervisor.mjs',
    '--mode', 'apply',
    '--per-class', '4',
    '--rest', '45',
    '--db', 'C:/tmp/helper.sqlite',
    '--base-url', 'http://10.0.0.5:3006',
    '--max-cycles', '2',
    '--seeds-only',
    '--vram-gb', '5',
    '--cooldown', '3000',
    '--qwen-frac', '0',
    '--limit', '1',
  ]);
});

test('environment can designate runtime and corpus for delegated runs', () => {
  const opts = parseOperatorArgs(['status'], {
    VAI_API: 'http://remote-vai:3006',
    VAI_IMPROVE_DB: 'C:/tmp/delegated.sqlite',
  });
  assert.equal(opts.baseUrl, 'http://remote-vai:3006');
  assert.equal(opts.db, 'C:/tmp/delegated.sqlite');
});

test('stop command parses as a graceful operator action by default', () => {
  const opts = parseOperatorArgs(['stop'], {});
  assert.equal(opts.command, 'stop');
  assert.equal(opts.forceStop, false);
});

test('stop command supports an explicit force switch', () => {
  const opts = parseOperatorArgs(['stop', '--force'], {});
  assert.equal(opts.command, 'stop');
  assert.equal(opts.forceStop, true);
});

test('pnpm argument separator is ignored before the command', () => {
  const opts = parseOperatorArgs(['--', 'watch', '--port', '4200'], {});
  assert.equal(opts.command, 'watch');
  assert.equal(opts.port, '4200');
});

test('watch command follows the same DB path', () => {
  const opts = parseOperatorArgs(['watch', '--db', 'C:/tmp/w.sqlite', '--port', '4200'], {});
  assert.deepEqual(buildWatchNodeArgs(opts), [
    '--experimental-sqlite',
    'scripts/improve-loop/watch.mjs',
    '--db', 'C:/tmp/w.sqlite',
    '--port', '4200',
  ]);
});

test('visual command builds a recording probe with target app and output path', () => {
  const opts = parseOperatorArgs([
    'visual',
    '--app', 'http://localhost:5173/?devAuthBypass=1',
    '--out', 'C:/tmp/vai eyes',
    '--text', 'eyes test',
    '--headed',
  ], {});
  assert.deepEqual(buildVisualNodeArgs(opts), [
    'scripts/improve-loop/visual-probe.mjs',
    '--app', 'http://localhost:5173/?devAuthBypass=1',
    '--out', 'C:/tmp/vai eyes',
    '--text', 'eyes test',
    '--width', '1440',
    '--height', '900',
    '--headed',
  ]);
});

test('visual command can expose live NDJSON events for council consumers', () => {
  const opts = parseOperatorArgs([
    'visual',
    '--stream', 'C:/tmp/vai-eyes/events.ndjson',
    '--stream-stdout',
    '--no-video',
    '--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ], {});
  assert.deepEqual(buildVisualNodeArgs(opts), [
    'scripts/improve-loop/visual-probe.mjs',
    '--app', 'http://localhost:5173/?devAuthBypass=1',
    '--out', 'Temporary_files/improve-loop-visual',
    '--text', 'visual probe: eyes online',
    '--width', '1440',
    '--height', '900',
    '--no-video',
    '--stream', 'C:/tmp/vai-eyes/events.ndjson',
    '--stream-stdout',
    '--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ]);
});

test('visual cadence flag threads into supervisor args only when positive', () => {
  const on = parseOperatorArgs(['start', '--visual-every', '3'], {});
  assert.equal(on.visualEvery, 3);
  assert.ok(buildSupervisorNodeArgs(on).join(' ').includes('--visual-every 3'));

  const off = parseOperatorArgs(['start'], {});
  assert.equal(off.visualEvery, 0);
  assert.ok(!buildSupervisorNodeArgs(off).includes('--visual-every'));
});

test('packet flag is parsed for the visual command', () => {
  const opts = parseOperatorArgs(['visual', '--packet'], {});
  assert.equal(opts.command, 'visual');
  assert.equal(opts.packet, true);
});

test('live-stream + drive-a-turn flags thread into the visual probe args', () => {
  const opts = parseOperatorArgs(['visual', '--headed', '--live', '--send', '--prompt', 'show your steps'], {});
  assert.equal(opts.live, true);
  assert.equal(opts.send, true);
  assert.equal(opts.turnPrompt, 'show your steps');
  const args = buildVisualNodeArgs(opts);
  assert.ok(args.includes('--live'));
  assert.ok(args.includes('--send'));
  assert.deepEqual(args.slice(args.indexOf('--prompt'), args.indexOf('--prompt') + 2), ['--prompt', 'show your steps']);
});

test('invalid mode fails closed', () => {
  assert.throws(() => parseOperatorArgs(['start', '--mode', 'chaos'], {}), /invalid --mode/);
});

test('recover-stale is a first-class operator command', () => {
  const opts = parseOperatorArgs(['recover-stale', '--db', 'C:/tmp/vai-helper.sqlite'], {});
  assert.equal(opts.command, 'recover-stale');
  assert.equal(opts.db, 'C:/tmp/vai-helper.sqlite');
});

test('handoff includes observe, watch, report, apply, and delegation guidance', () => {
  const opts = parseOperatorArgs(['handoff', '--db', 'C:/tmp/vai-helper.sqlite', '--base-url', 'http://host:3006'], {});
  const md = buildHandoffMarkdown(opts, new Date('2026-06-22T00:00:00.000Z'));
  assert.match(md, /Observe forever/);
  assert.match(md, /Stop the recorded supervisor/);
  assert.match(md, /Recover a stale crashed run marker/);
  assert.match(md, /council\/auto-improve/);
  assert.match(md, /C:\/tmp\/vai-helper\.sqlite/);
  assert.match(md, /http:\/\/host:3006/);
  assert.match(md, /Delegating Compute Or Agents/);
  assert.match(md, /Stream the same eyes-and-hands probe as live NDJSON/);
  assert.match(md, /--stream-stdout/);
});

test('formatted command quotes paths with spaces', () => {
  const cmd = formatNodeCommand(['script.mjs', '--db', 'C:/tmp/with spaces.sqlite']);
  assert.equal(cmd, 'node script.mjs --db "C:/tmp/with spaces.sqlite"');
});

test('loop liveness treats a fresh heartbeat as active', () => {
  const now = Date.parse('2026-06-22T12:00:00.000Z');
  const liveness = classifyLoopLiveness({
    nowMs: now,
    run: { status: 'running', started_at: '2026-06-22T11:59:00.000Z' },
    heartbeat: { updated_at: '2026-06-22T11:59:55.000Z' },
  });
  assert.equal(liveness.heartbeatFresh, true);
  assert.equal(liveness.staleRunning, false);
});

test('loop liveness warns when running marker has a stale heartbeat', () => {
  const now = Date.parse('2026-06-22T12:00:00.000Z');
  const liveness = classifyLoopLiveness({
    nowMs: now,
    run: { status: 'running', started_at: '2026-06-22T10:00:00.000Z' },
    heartbeat: { updated_at: '2026-06-22T10:05:00.000Z' },
  });
  assert.equal(liveness.heartbeatFresh, false);
  assert.equal(liveness.staleRunning, true);
});

test('loop liveness does not warn for completed stale runs', () => {
  const now = Date.parse('2026-06-22T12:00:00.000Z');
  const liveness = classifyLoopLiveness({
    nowMs: now,
    run: { status: 'done', started_at: '2026-06-22T10:00:00.000Z' },
    heartbeat: { updated_at: '2026-06-22T10:05:00.000Z' },
  });
  assert.equal(liveness.staleRunning, false);
});

test('loop liveness warns when a running marker has no heartbeat and is old', () => {
  const now = Date.parse('2026-06-22T12:00:00.000Z');
  const liveness = classifyLoopLiveness({
    nowMs: now,
    run: { status: 'running', started_at: '2026-06-22T10:00:00.000Z' },
    heartbeat: null,
  });
  assert.equal(liveness.heartbeatAgeMs, null);
  assert.equal(liveness.staleRunning, true);
});

test('stale recovery allows interrupted marking when no supervisor is alive', () => {
  const now = Date.parse('2026-06-22T12:00:00.000Z');
  const recovery = classifyStaleRunRecovery({
    nowMs: now,
    run: { status: 'running', started_at: '2026-06-22T10:00:00.000Z' },
    heartbeat: { updated_at: '2026-06-22T10:05:00.000Z' },
    supervisorLock: null,
    supervisorAlive: false,
  });
  assert.equal(recovery.action, 'recover');
  assert.equal(recovery.ok, true);
  assert.equal(recovery.reason, 'no-supervisor-lock');
});

test('stale recovery refuses while the recorded supervisor is alive', () => {
  const now = Date.parse('2026-06-22T12:00:00.000Z');
  const recovery = classifyStaleRunRecovery({
    nowMs: now,
    run: { status: 'running', started_at: '2026-06-22T10:00:00.000Z' },
    heartbeat: { updated_at: '2026-06-22T10:05:00.000Z' },
    supervisorLock: { pid: 1234 },
    supervisorAlive: true,
  });
  assert.equal(recovery.action, 'refuse');
  assert.equal(recovery.ok, false);
  assert.equal(recovery.reason, 'supervisor-alive');
});

test('stale recovery refuses fresh running heartbeats', () => {
  const now = Date.parse('2026-06-22T12:00:00.000Z');
  const recovery = classifyStaleRunRecovery({
    nowMs: now,
    run: { status: 'running', started_at: '2026-06-22T11:59:00.000Z' },
    heartbeat: { updated_at: '2026-06-22T11:59:55.000Z' },
  });
  assert.equal(recovery.action, 'refuse');
  assert.equal(recovery.ok, false);
  assert.equal(recovery.reason, 'heartbeat-fresh');
});
