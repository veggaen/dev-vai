/**
 * Conv-loop bench — dynamic multi-turn conversations; **online by default**
 * (live SearchPipeline: clarify → fan-out → rank → read → conclude).
 *
 * Run (from packages/core):
 *   pnpm bench:conv-loop              # online, 1000×4 (slow — uses network)
 *   pnpm bench:conv-loop:smoke        # online smoke 40×3
 *   pnpm exec tsx ./bench/conv-loop.mts --offline --n=200   # local-only baseline
 *
 * Optional env: BRAVE_SEARCH_API_KEY, VAI_SEARXNG_URL
 */
import { gradeConvTurn, type ConvTurnRecord } from './conv-loop-grader.js';
import {
  buildConversationSeeds,
  buildFollowUpMessage,
  variationStats,
} from './conv-loop-generate.js';
import {
  applyBenchMode,
  createBenchEngine,
  describeSearchConfig,
  resolveBenchMode,
} from './conv-loop-bench-env.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type Msg = { role: 'user' | 'assistant'; content: string };

function parseArgs(argv: string[]) {
  let n = 1000;
  let turns = 4;
  let seed = 42;
  let concurrency = 1;
  for (const a of argv) {
    if (a.startsWith('--n=')) n = Math.max(1, parseInt(a.slice(4), 10) || n);
    if (a.startsWith('--turns=')) turns = Math.max(2, parseInt(a.slice(8), 10) || turns);
    if (a.startsWith('--seed=')) seed = parseInt(a.slice(7), 10) || seed;
    if (a.startsWith('--concurrency=')) concurrency = Math.max(1, parseInt(a.slice(14), 10) || 1);
  }
  return { n, turns, seed, concurrency };
}

type TurnRow = ConvTurnRecord & {
  pass: boolean;
  tags: string[];
  relevance: number;
};

async function runConversation(
  spec: ReturnType<typeof buildConversationSeeds>[number],
  turns: number,
  mode: ReturnType<typeof resolveBenchMode>,
): Promise<TurnRow[]> {
  const engine = createBenchEngine(mode);
  (engine as unknown as { _nowMs: () => number })._nowMs = () =>
    new Date('2026-05-16T12:00:00Z').getTime();

  const history: Msg[] = [];
  let lastResponse = '';
  const rows: TurnRow[] = [];

  for (let turnIdx = 0; turnIdx < turns; turnIdx++) {
    const prompt =
      turnIdx === 0 ? spec.opener : buildFollowUpMessage(spec, turnIdx, lastResponse);
    history.push({ role: 'user', content: prompt });

    let response = '';
    let error: string | null = null;
    let sources = 0;
    let strategy: string | null = null;
    const t0 = Date.now();

    try {
      const r: any = await (engine as any).chat({ messages: history, noLearn: true });
      response = (r?.message?.content ?? r?.content ?? '').toString();
      const lastSearch = (engine as any)?._lastSearchResponse;
      sources = lastSearch?.sources?.length
        ?? (Array.isArray(r?.sources) ? r.sources.length : 0);
      strategy = (engine as any)?._lastMeta?.strategy ?? null;
      history.push({ role: 'assistant', content: response });
      lastResponse = response;
    } catch (e: any) {
      error = String(e?.message ?? e);
      history.push({ role: 'assistant', content: `__ERROR__ ${error}` });
      lastResponse = history[history.length - 1]!.content;
    }

    const record: ConvTurnRecord = {
      bench: 'conv-loop',
      convId: spec.id,
      turnIdx,
      roundIdx: 0,
      category: spec.category,
      style: spec.style,
      ms: Date.now() - t0,
      prompt,
      response,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      sources,
      strategy,
      error,
    };

    const graded = gradeConvTurn(record);
    rows.push({ ...record, pass: graded.pass, tags: graded.tags, relevance: graded.relevance });
  }

  return rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = resolveBenchMode(argv);
  applyBenchMode(mode);
  const { n, turns, seed, concurrency } = parseArgs(argv);

  const root = path.resolve(process.cwd(), '../..');
  const outJsonl = path.join(root, '_conv_loop.jsonl');
  const outTagged = path.join(root, '_conv_loop.tagged.jsonl');
  const outReport = path.join(root, '_conv_loop.report.md');
  const outFailures = path.join(root, '_conv_loop.failures.json');

  const seeds = buildConversationSeeds(n, seed);
  const vStats = variationStats(seeds);
  await fs.writeFile(outJsonl, '', 'utf8');
  await fs.writeFile(outTagged, '', 'utf8');

  console.log(`=== CONV-LOOP BENCH (${mode}) ===`);
  console.log(`  conversations=${n}  turns/conv=${turns}  seed=${seed}  concurrency=${concurrency}`);
  console.log(`  search providers: ${mode === 'online' ? describeSearchConfig() : 'disabled (offline)'}`);
  console.log(`  variation: topics=${vStats.uniqueTopics} openers=${vStats.uniqueOpeners} (${vStats.generation})`);

  const allTurns: TurnRow[] = [];
  let done = 0;

  for (let i = 0; i < seeds.length; i += concurrency) {
    const batch = seeds.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((spec) => runConversation(spec, turns, mode)),
    );
    for (const rows of batchResults) {
      for (const row of rows) {
        allTurns.push(row);
        await fs.appendFile(outJsonl, JSON.stringify(row) + '\n', 'utf8');
        await fs.appendFile(outTagged, JSON.stringify(row) + '\n', 'utf8');
      }
      done += 1;
      if (done % 25 === 0 || done === n) {
        const passSoFar = allTurns.filter((t) => t.pass).length;
        process.stdout.write(
          `  [${done}/${n} convs] turns=${allTurns.length} pass=${passSoFar} (${((passSoFar / allTurns.length) * 100).toFixed(1)}%)\n`,
        );
      }
    }
  }

  const total = allTurns.length;
  const passed = allTurns.filter((t) => t.pass).length;
  const tagCount = new Map<string, number>();
  const webTurns = allTurns.filter((t) => (t.sources ?? 0) > 0).length;
  for (const t of allTurns) {
    if (!t.pass) for (const tag of t.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
  }

  const byCat = new Map<string, { total: number; pass: number }>();
  const byStyle = new Map<string, { total: number; pass: number }>();
  for (const t of allTurns) {
    const b = byCat.get(t.category) ?? { total: 0, pass: 0 };
    b.total++;
    if (t.pass) b.pass++;
    byCat.set(t.category, b);
    const s = byStyle.get(t.style) ?? { total: 0, pass: 0 };
    s.total++;
    if (t.pass) s.pass++;
    byStyle.set(t.style, s);
  }

  const lines: string[] = [];
  lines.push(`# Conv-loop bench report`);
  lines.push(``);
  lines.push(`**Mode:** ${mode}  **Search:** ${mode === 'online' ? describeSearchConfig() : 'off'}`);
  lines.push(`**Conversations:** ${n}  **Turns/conv:** ${turns}  **Total turns:** ${total}`);
  lines.push(`**Pass:** ${passed} (${((passed / total) * 100).toFixed(1)}%)  **Fail:** ${total - passed}`);
  lines.push(`**Turns with sources:** ${webTurns} (${((webTurns / total) * 100).toFixed(1)}%)`);
  lines.push(`**Avg relevance (pass):** ${(allTurns.filter((t) => t.pass).reduce((s, t) => s + t.relevance, 0) / Math.max(1, passed)).toFixed(3)}`);
  lines.push(``);
  lines.push(`## Conversation variation`);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  for (const [k, v] of Object.entries(vStats)) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push(`- Follow-up order is shuffled per conversation; templates react to prior response length.`);
  lines.push(`- Vai uses **web-conclude policy** (not per-topic snippet tables) when online.`);
  lines.push(``);
  lines.push(`## Pass rate by category`);
  lines.push(`| Category | Pass | Total | % |`);
  lines.push(`|---|---|---|---|`);
  for (const [k, b] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`| ${k} | ${b.pass} | ${b.total} | ${((b.pass / b.total) * 100).toFixed(0)}% |`);
  }
  lines.push(``);
  lines.push(`## Pass rate by speech style`);
  lines.push(`| Style | Pass | Total | % |`);
  lines.push(`|---|---|---|---|`);
  for (const [k, b] of [...byStyle.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`| ${k} | ${b.pass} | ${b.total} | ${((b.pass / b.total) * 100).toFixed(0)}% |`);
  }
  lines.push(``);
  lines.push(`## Failure tags`);
  lines.push(`| Tag | Count |`);
  lines.push(`|---|---|`);
  for (const [t, c] of [...tagCount.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${t} | ${c} |`);
  }
  lines.push(``);

  await fs.writeFile(outReport, lines.join('\n'), 'utf8');

  const failures = allTurns
    .filter((t) => !t.pass)
    .slice(0, 200)
    .map((t) => ({
      convId: t.convId,
      turnIdx: t.turnIdx,
      category: t.category,
      style: t.style,
      tags: t.tags,
      relevance: t.relevance,
      sources: t.sources,
      prompt: t.prompt.slice(0, 300),
      response: t.response.slice(0, 600),
      strategy: t.strategy,
    }));
  await fs.writeFile(outFailures, JSON.stringify(failures, null, 2), 'utf8');

  console.log(`\nDone. Pass=${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)  webSources=${webTurns}`);
  console.log(`  ${outReport}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
