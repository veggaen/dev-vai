import { SearchPipeline } from '../src/search/pipeline.js';
import { createBenchEngine } from './conv-loop-bench-env.js';

const q = process.argv[2] ?? 'what is the capital of Norway';
const pipeline = new SearchPipeline();
const t0 = Date.now();
const r = await pipeline.search(q);
console.log('pipeline', { ms: Date.now() - t0, sources: r.sources.length, preview: r.answer.slice(0, 160) });
console.log('pipeline-plan', { intent: r.plan.intent, entities: r.plan.entities });
console.log('pipeline-sources', r.sources.map((source) => ({ domain: source.domain, title: source.title })));
console.log('pipeline-audit', r.audit.map((entry) => entry.detail));

const engine = createBenchEngine('online');
(engine as { chatSearchBudgetMs: number }).chatSearchBudgetMs = 12_000;
const t1 = Date.now();
const chat = await engine.chat({
  messages: [{ role: 'user', content: q }],
  noLearn: true,
});
const meta = (engine as { _lastMeta?: { strategy?: string } })._lastMeta;
const lastSearch = (engine as { _lastSearchResponse?: { sources: unknown[] } | null })._lastSearchResponse;
console.log('chat', {
  ms: Date.now() - t1,
  strategy: meta?.strategy,
  sources: lastSearch?.sources?.length ?? 0,
  preview: chat.message.content.slice(0, 200),
});
console.log('chat-sources', lastSearch?.sources?.map((source: any) => ({ domain: source.domain, title: source.title })) ?? []);
