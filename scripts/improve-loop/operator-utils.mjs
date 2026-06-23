export const DEFAULT_DB = 'scripts/improve-loop/.corpus.sqlite';
export const DEFAULT_BASE_URL = 'http://localhost:3006';
export const DEFAULT_WATCH_PORT = '4123';

export const COMMANDS = new Set(['help', 'doctor', 'status', 'start', 'watch', 'report', 'handoff', 'visual']);
export const HEARTBEAT_FRESH_MS = 15_000;
export const STALE_RUNNING_MS = 15 * 60_000;

function readFlag(argv, name, fallback = null) {
  const eq = argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

export function parseOperatorArgs(argv, env = process.env) {
  const normalized = argv.filter((arg) => arg !== '--');
  const wantsHelp = hasFlag(normalized, '--help') || hasFlag(normalized, '-h');
  const command = wantsHelp ? 'help' : (normalized[0] && !normalized[0].startsWith('-') ? normalized[0] : 'help');
  if (!COMMANDS.has(command)) {
    throw new Error(`unknown command '${command}'`);
  }
  const optionArgs = command === 'help' ? normalized : normalized.slice(1);
  const mode = readFlag(optionArgs, '--mode', hasFlag(optionArgs, '--apply') ? 'apply' : 'observe');
  if (!['observe', 'apply'].includes(mode)) {
    throw new Error(`invalid --mode '${mode}'. Use observe or apply.`);
  }
  return {
    command,
    mode,
    apply: mode === 'apply' || hasFlag(optionArgs, '--apply'),
    db: readFlag(optionArgs, '--db', env.VAI_IMPROVE_DB ?? DEFAULT_DB),
    baseUrl: readFlag(optionArgs, '--base-url', env.VAI_API ?? DEFAULT_BASE_URL),
    maxCycles: readFlag(optionArgs, '--max-cycles', '0'),
    perClass: readFlag(optionArgs, '--per-class', '4'),
    rest: readFlag(optionArgs, '--rest', '45'),
    port: readFlag(optionArgs, '--port', DEFAULT_WATCH_PORT),
    vramGb: readFlag(optionArgs, '--vram-gb', null),
    cooldown: readFlag(optionArgs, '--cooldown', null),
    qwenFrac: readFlag(optionArgs, '--qwen-frac', null),
    limit: readFlag(optionArgs, '--limit', null),
    appUrl: readFlag(optionArgs, '--app', env.VAI_APP_URL ?? 'http://localhost:5173/?devAuthBypass=1'),
    probeText: readFlag(optionArgs, '--text', 'visual probe: eyes online'),
    chromePath: readFlag(optionArgs, '--chrome', env.VAI_CHROME_PATH ?? null),
    width: readFlag(optionArgs, '--width', '1440'),
    height: readFlag(optionArgs, '--height', '900'),
    stream: readFlag(optionArgs, '--stream', null),
    streamStdout: hasFlag(optionArgs, '--stream-stdout'),
    noVideo: hasFlag(optionArgs, '--no-video'),
    headed: hasFlag(optionArgs, '--headed'),
    // Live stream + drive-a-real-turn so we judge the POPULATED ui (Timeline/ProcessTree).
    live: hasFlag(optionArgs, '--live'),
    send: hasFlag(optionArgs, '--send'),
    turnPrompt: readFlag(optionArgs, '--prompt', null),
    liveFrame: readFlag(optionArgs, '--live-frame', null),
    seedsOnly: hasFlag(optionArgs, '--seeds-only'),
    dryRun: hasFlag(optionArgs, '--dry-run'),
    out: readFlag(optionArgs, '--out', null),
    // Visual cadence: weave a no-video probe in between text cycles (off unless > 0).
    visualEvery: Number(readFlag(optionArgs, '--visual-every', '0')) || 0,
    // Council packet: print the compact latest-visual summary instead of running a probe.
    packet: hasFlag(optionArgs, '--packet'),
  };
}

export function buildSupervisorNodeArgs(opts) {
  const args = [
    '--experimental-sqlite',
    'scripts/improve-loop/supervisor.mjs',
    '--mode', opts.apply ? 'apply' : 'observe',
    '--per-class', String(opts.perClass),
    '--rest', String(opts.rest),
    '--db', opts.db,
    '--base-url', opts.baseUrl,
  ];
  if (opts.maxCycles && String(opts.maxCycles) !== '0') args.push('--max-cycles', String(opts.maxCycles));
  if (opts.seedsOnly) args.push('--seeds-only');
  if (opts.vramGb) args.push('--vram-gb', String(opts.vramGb));
  if (opts.cooldown) args.push('--cooldown', String(opts.cooldown));
  if (opts.qwenFrac) args.push('--qwen-frac', String(opts.qwenFrac));
  if (opts.limit) args.push('--limit', String(opts.limit));
  if (opts.visualEvery && opts.visualEvery > 0) args.push('--visual-every', String(opts.visualEvery));
  return args;
}

export function buildWatchNodeArgs(opts) {
  return [
    '--experimental-sqlite',
    'scripts/improve-loop/watch.mjs',
    '--db', opts.db,
    '--port', String(opts.port),
  ];
}

export function buildReportNodeArgs(opts) {
  return [
    '--experimental-sqlite',
    'scripts/improve-loop/report.mjs',
    '--db', opts.db,
  ];
}

export function buildVisualNodeArgs(opts) {
  const args = [
    'scripts/improve-loop/visual-probe.mjs',
    '--app', opts.appUrl,
    '--out', opts.out ?? 'Temporary_files/improve-loop-visual',
    '--text', opts.probeText,
    '--width', String(opts.width),
    '--height', String(opts.height),
  ];
  if (opts.headed) args.push('--headed');
  if (opts.noVideo) args.push('--no-video');
  if (opts.live) args.push('--live');
  if (opts.liveFrame) args.push('--live-frame', opts.liveFrame);
  if (opts.send) args.push('--send');
  if (opts.turnPrompt) args.push('--prompt', opts.turnPrompt);
  if (opts.stream) args.push('--stream', opts.stream);
  if (opts.streamStdout) args.push('--stream-stdout');
  if (opts.chromePath) args.push('--chrome', opts.chromePath);
  return args;
}

export function quoteArg(arg) {
  const s = String(arg);
  return /[\s"'`]/.test(s) ? JSON.stringify(s) : s;
}

export function formatNodeCommand(nodeArgs) {
  return ['node', ...nodeArgs].map(quoteArg).join(' ');
}

export function classifyLoopLiveness({ run, heartbeat, nowMs = Date.now() }) {
  const heartbeatAt = heartbeat?.updated_at ? new Date(heartbeat.updated_at).getTime() : NaN;
  const heartbeatAgeMs = Number.isFinite(heartbeatAt) ? Math.max(0, nowMs - heartbeatAt) : null;
  const heartbeatFresh = heartbeatAgeMs != null && heartbeatAgeMs < HEARTBEAT_FRESH_MS;
  const runStartedAt = run?.started_at ? new Date(run.started_at).getTime() : NaN;
  const runningAgeMs = Number.isFinite(runStartedAt) ? Math.max(0, nowMs - runStartedAt) : null;
  const staleRunning =
    run?.status === 'running' &&
    !heartbeatFresh &&
    (heartbeatAgeMs == null ? (runningAgeMs ?? 0) > STALE_RUNNING_MS : heartbeatAgeMs > STALE_RUNNING_MS);

  return {
    heartbeatAgeMs,
    heartbeatFresh,
    runningAgeMs,
    staleRunning,
  };
}

export function buildHandoffMarkdown(opts, now = new Date()) {
  const observe = formatNodeCommand(buildSupervisorNodeArgs({ ...opts, apply: false }));
  const apply = formatNodeCommand(buildSupervisorNodeArgs({ ...opts, apply: true }));
  const watch = formatNodeCommand(buildWatchNodeArgs(opts));
  const report = formatNodeCommand(buildReportNodeArgs(opts));
  const visual = formatNodeCommand(buildVisualNodeArgs(opts));
  const visualStream = formatNodeCommand(buildVisualNodeArgs({ ...opts, noVideo: true, streamStdout: true }));
  return `# Vai Perpetual Improvement Loop Handoff

Generated: ${now.toISOString()}

## Current Run Contract

- Mode: ${opts.apply ? 'apply' : 'observe'}
- Runtime: ${opts.baseUrl}
- Corpus DB: ${opts.db}
- Watch page: http://localhost:${opts.port}
- Safety: one cycle at a time, VRAM guarded, cooldown between turns.

## Run Commands

Observe forever, queue fixes only:

\`\`\`powershell
${observe}
\`\`\`

Watch live:

\`\`\`powershell
${watch}
\`\`\`

Read the latest report:

\`\`\`powershell
${report}
\`\`\`

Record one visual eyes-and-hands probe:

\`\`\`powershell
${visual}
\`\`\`

Stream the same eyes-and-hands probe as live NDJSON:

\`\`\`powershell
${visualStream}
\`\`\`

Read the latest visual run as a compact council packet (no screenshots/trace):

\`\`\`powershell
node --experimental-sqlite scripts/improve-loop/operator.mjs visual --packet --db ${opts.db}
\`\`\`

Run the loop so it LOOKS at itself between text cycles (no-video, serial):

\`\`\`powershell
${observe} --visual-every 1
\`\`\`

While the watch page runs, poll \`GET http://localhost:${opts.port}/visual.json\`
for \`{ packet, live }\` without reloading the dashboard.

Verified auto-apply switch:

\`\`\`powershell
git checkout -B council/auto-improve
${apply}
\`\`\`

Auto-apply is still gated: it only uses verified consensus proposals, stages one file,
runs verification, commits only on \`council/auto-improve\`, and reverts failed patches.

## Delegating Compute Or Agents

Give another helper this handoff plus repo access. Have them run observe mode first with
their own DB path, for example \`--db C:/tmp/vai-helper.sqlite\`, then send back the DB
or the report output. They should not run apply mode unless V3gga explicitly designates
them as a reviewer for the \`council/auto-improve\` branch.

Remote runtime: point \`--base-url\` or \`VAI_API\` at the Vai runtime they should test.
Remote/local model host: set \`LOCAL_MODEL_URL\` for Ollama-compatible model compute.
Model choice: set \`IMPROVE_GEN_MODEL\` for prompt generation/warmup.

## Human Review Loop

1. Run \`doctor\` before leaving it unattended.
2. Run observe mode until the watch page has failures and proposed fixes.
3. Review \`report\` and the DB-backed queued fixes.
4. Switch to apply mode only on \`council/auto-improve\`.
5. Merge back manually after tests and visual proof.
`;
}
