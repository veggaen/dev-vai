# Vai Perpetual Improvement Loop

This is the operator guide for running Vai's self-improvement loop as a durable
workflow. The loop is intentionally not a prompt trick: it observes live Vai
turns, records evidence in SQLite, queues fixes, and only applies verified
consensus patches when a human has switched it into the guarded apply lane.

## The Short Version

Start or verify the runtime:

```powershell
corepack pnpm vai:status
corepack pnpm vai:start
```

Run the safety check:

```powershell
corepack pnpm self-improve:doctor
```

`Doctor: WARN` means the connected services are usable but the operator found
state that needs attention, such as a run marked `running` with a stale
heartbeat. Check that no old loop process is still active, then start a new
cycle; the corpus is resumable. If the warning is a stale run and there is no
live supervisor process, recover the marker explicitly:

```powershell
corepack pnpm self-improve:recover-stale
```

`recover-stale` only marks the latest stale `running` corpus row as
`interrupted`. It refuses to act when the recorded supervisor PID is still alive.

Run forever in observe mode:

```powershell
corepack pnpm self-improve:start -- --mode observe
```

Run forever in observe mode, and let Vai LOOK at itself between text cycles:

```powershell
corepack pnpm self-improve:start -- --mode observe --visual-every 1
```

`--visual-every <n>` weaves one **no-video** eyes/hands probe in after every `n`
text cycles. It is OFF by default. The probe stays strictly serial (it runs after
PROPOSE/APPLY, before the GPU rest) so the one-heavy-task-at-a-time rule holds, and
a probe failure is recorded as operator evidence — it never aborts the loop.

Watch it live:

```powershell
corepack pnpm self-improve:operator -- watch
```

Ask a background loop to stop:

```powershell
corepack pnpm self-improve:stop
```

`stop` targets only the supervisor PID recorded in `scripts/improve-loop/.supervisor.lock`.
It also writes a matching stop request so the supervisor can exit at the next
checkpoint/rest boundary. Use `corepack pnpm self-improve:stop -- --force` only
when the recorded supervisor process does not respond to the graceful request.

Record one visual eyes-and-hands probe:

```powershell
corepack pnpm self-improve:visual
```

Stream the same probe as live NDJSON for a council/helper consumer:

```powershell
corepack pnpm self-improve:visual -- --stream-stdout --no-video
```

Print the latest visual run as a compact **council packet** (no probe, no
screenshots, no pointer trace — just the verdict another agent needs):

```powershell
corepack pnpm self-improve:operator -- visual --packet
```

Read the latest corpus report:

```powershell
corepack pnpm self-improve:status
corepack pnpm self-improve:operator -- report
```

Stop a foreground loop with `Ctrl+C`; stop a background loop with
`corepack pnpm self-improve:stop`. If a previous process died and doctor still
reports a stale `running` row after no supervisor is alive, use
`corepack pnpm self-improve:recover-stale`. The corpus is resumable.

## Modes

`observe` is the default. It is safe for long unattended runs:

- Runs prompts through live Vai.
- Grades interpretation and council outcome.
- Writes the corpus DB.
- Queues fix candidates and proposals.
- Does not edit source code.

`apply` is the explicit switch. It is guarded and should be used from a review
branch only:

```powershell
git checkout -B council/auto-improve
corepack pnpm self-improve:start -- --mode apply
```

Apply mode still refuses unsafe work:

- Only verified consensus proposals are considered.
- Review-tier proposals are left for V3gga.
- One file is staged, never `git add -A`.
- Verification runs before commit.
- Failed verification reverts the patch.
- Commits are refused unless HEAD is `council/auto-improve`.

## Useful Operator Commands

Dry-run the forever command:

```powershell
corepack pnpm self-improve:start -- --mode observe --dry-run
```

Run one quick seed-only cycle:

```powershell
corepack pnpm self-improve:start -- --mode observe --max-cycles 1 --seeds-only --cooldown 3000
```

Run one tiny live probe before a longer campaign:

```powershell
node --experimental-sqlite scripts/improve-loop/run.mjs --seeds-only --limit 1 --cooldown 1000
```

Run one visual probe in a visible browser:

```powershell
corepack pnpm self-improve:visual -- --headed
```

Write a direct eyes/hands event channel to a known file:

```powershell
corepack pnpm self-improve:visual -- --stream C:/tmp/vai-eyes/events.ndjson --no-video
```

Use a separate corpus DB:

```powershell
corepack pnpm self-improve:start -- --db C:/tmp/vai-helper.sqlite
corepack pnpm self-improve:operator -- watch --db C:/tmp/vai-helper.sqlite --port 4200
```

Generate a handoff packet:

```powershell
corepack pnpm self-improve:handoff -- --out docs/handoff/improve-loop-handoff.md
```

## Delegating Helpers, Servers, Or Compute

Another agent or machine can help without touching V3gga's main worktree:

1. Give them this repo and the generated handoff packet.
2. Have them run observe mode first.
3. Give them a separate DB path, such as `--db C:/tmp/vai-helper.sqlite`.
4. If they are testing a remote Vai runtime, pass `--base-url http://host:3006`
   or set `VAI_API=http://host:3006`.
5. If they have model compute, point `LOCAL_MODEL_URL` at their Ollama-compatible
   host and optionally set `IMPROVE_GEN_MODEL`.
6. They send back the report output or the SQLite corpus. V3gga decides what to
   merge or apply.

Do not give helpers apply mode unless they are explicitly trusted to work on
`council/auto-improve` and return reviewable commits.

## Runtime Knobs

These flags are forwarded through the operator and supervisor into `run.mjs`:

- `--base-url`: Vai runtime to test.
- `--db`: corpus DB path.
- `--seeds-only`: skip generated prompt top-up for a quick regression pass.
- `--vram-gb`: loaded VRAM budget before the next model call proceeds.
- `--cooldown`: milliseconds between turns.
- `--qwen-frac`: fraction of generated prompt top-up to ask from qwen.
- `--limit`: cap prepared prompts for a tiny controlled probe.
- `--per-class`: target prompts per failure class.
- `--rest`: seconds between supervisor cycles.
- `--max-cycles`: bounded run; omit or use `0` for forever.

## Visual Eyes And Hands

The first visual lane is `scripts/improve-loop/visual-probe.mjs`. It deliberately
uses Playwright before any OS-level mouse/keyboard driver:

- records video evidence when Playwright ffmpeg is available, and falls back to
  screenshots plus the event stream when it is not;
- takes screenshots before and after interaction;
- moves the pointer on a curved path;
- verifies the composer is the top-layer click target with `elementFromPoint`;
- types quickly into the composer, then clears it without sending a chat turn;
- writes a JSON report under `Temporary_files/improve-loop-visual/`;
- writes `events.ndjson` as the direct live eyes/hands channel.

The event stream is append-only NDJSON. It is designed for the operator, watch
page, and council members to tail without needing screenshots first. Current
event types include `probe.start`, `page.goto`, `vision.dom`,
`vision.snapshot`, `vision.target`, `hand.pointer`, `hand.click`, `hand.type`,
`hand.clear`, `check`, `video.*`, `probe.error`, and `probe.done`.

`operator visual` always runs the probe with stdout event streaming and stores a
sampled copy in the corpus DB:

- `visual_runs`: one row per eyes/hands probe, with pass/fail and report path.
- `visual_events`: sampled append-only events; full pointer traces stay in
  `events.ndjson`.
- `visual_live`: the latest visual event for status/watch surfaces.

`corepack pnpm self-improve:status` reports the latest visual run. The watch
page also shows recent visual events above the text-loop pass-rate section.

### How a council member or helper consumes the eyes/hands lane

Three increasingly cheap surfaces, none of which feed a model raw screenshots or
the full pointer trace:

1. **Tail the live NDJSON channel.** Full per-event detail (`probe.start`,
   `vision.target`, `hand.*`, `check`, `probe.done`) lands append-only in
   `events.ndjson` under the probe's `Temporary_files/improve-loop-visual/<stamp>/`
   directory, or wherever `--stream <path>` points. Tail it for a live trace.
2. **Poll the watch server's `/visual.json`.** While `self-improve:watch` (or
   `operator watch`) is running, `GET http://localhost:4123/visual.json` returns
   `{ packet, live }` as JSON — the compact packet plus the single latest visual
   event — with `cache-control: no-store`. This is the cheapest poll: no HTML, no
   page reload.
3. **Ask for the council packet.** `operator visual --packet` (or the
   `buildVisualCouncilPacket` helper in `db.mjs`) emits one compact object:

   ```json
   {
     "visualRunId": 4,
     "status": "done",
     "passed": true,
     "checks": { "passed": 5, "total": 5, "list": [ ... ] },
     "composerReachable": true,
     "topLayerTarget": "textarea.resize-none...bg-transparent.px-4",
     "screenshots": 3,
     "warnings": [],
     "optionalBlockedResources": 2,
     "reportPath": "Temporary_files/improve-loop-visual/.../report.json",
     "headline": "visual #4 done/pass · 5/5 checks · composer reachable"
   }
   ```

   `warnings` carries only real console/page/request errors; expected optional
   external resources (Google Fonts under a restricted network or blocked by the
   probe's injected dev-auth-bypass header) are counted in
   `optionalBlockedResources`, not flagged as failures. The full report and
   screenshots stay on disk at `reportPath` for a human to open — they are not
   pushed into the packet.

## Visual Taste (Evidence-Bound Rubric)

The probe does more than pass/fail rendering. After it interacts, it **measures**
deterministic DOM facts — distinct font sizes, grid-sampled content density, card
nesting depth, transition duration + easing, input latency, focus-ring presence,
hover-state delta, WCAG contrast of text against its real background, clipped
popovers, offscreen controls, unexpected scrollbars — and feeds them to
`visual-rubric.mjs`, a **pure, unit-tested** scorer.

The rubric is deliberately not a vibe. Every score traces to a measured signal; if a
signal is missing the score stays conservative and says "not measured" rather than
inventing a compliment. It produces:

- **Rubric scores** (0..10): composition, motion, interaction feel, visual identity,
  emotional quality (emotional quality is *derived* from the others, never asserted).
- **Human-appeal prediction**: first impression, modern/premium, interaction, trust/
  clarity, wow, keep-using — plus the main like/dislike reason. Wow is gated hard: a
  single P0 flaw forces it to the floor.
- **Flaw findings** with severity P0..P3, each carrying symptom, measured evidence
  (selector/box/contrast/viewport), likely cause, user impact, and a fix direction.
  Identical repeats collapse into one finding with an `occurrences` count.
- **Generic-AI-aesthetic flags**: purple-gradient slop, overused glassmorphism,
  nested cards, oversized empty hero, weak typographic hierarchy.
- **One reusable taste lesson**, accumulated across runs in the `taste_lessons` table
  (how Vai builds taste through repetition).

Surfaces:

- The probe emits `vision.signals`, `vision.rubric`, and one `vision.flaw` per finding,
  and carries `rubricOverall`/`wow`/`flawCounts` on `probe.done`.
- `operator visual --packet` and `GET /visual.json` include a compact `taste` block
  (scores, human-appeal, top 5 distinct flaws, the taste lesson) — never screenshots
  or the pointer trace.
- `self-improve:status` prints the latest taste verdict, the top flaw, the current
  taste lesson, and the most-repeated accumulated lessons.
- The watch page renders a taste card (score chips, human-appeal chips, top flaws with
  fix directions, the lesson, and an expandable accumulated-lessons list).

Honesty contract: the rubric scorer was hardened the moment it lied. Its first live
run on Vai's own UI reported 9 P0 "invisible text" flaws that were actually a
measurement bug (it couldn't parse the modern `color(srgb …)` function and invented a
white background to compare against). The fix — parse `color(srgb …)`, and refuse to
emit a contrast verdict when the background is indeterminate rather than fabricating
one — is the rule: a false flaw is worse than no flaw, because it trains Vai on noise.

This is the safe stepping stone toward a future OS-level CUA agent. Native
drivers such as `robotjs`, `nut.js`, or desktop-wide `ffmpeg` capture should
come later, after the browser-level evidence loop is reliable and reviewed.

Environment equivalents:

- `VAI_API`: default runtime URL.
- `VAI_IMPROVE_DB`: default corpus DB path for the operator.
- `LOCAL_MODEL_URL`: Ollama-compatible model host.
- `IMPROVE_GEN_MODEL`: generation/warmup model name.

## Evidence Contract

A run is not "better" because it ran longer. Treat these as proof:

- `doctor` passes before unattended runs.
- The watch page shows fresh heartbeat and scored prompts.
- `self-improve:stop` can stop the recorded supervisor without broad process kills.
- `self-improve:recover-stale` turns a stale crashed `running` row into the
  existing resumable `interrupted` state after confirming no supervisor PID is alive.
- `status` or `report` shows pass-rate movement and queued fixes.
- Apply mode creates commits only on `council/auto-improve`.
- Tests/typecheck/visual proof still pass before merge.

If the council path times out or a model host disappears, record it as operator
evidence, do not score it as a Vai logic failure.
