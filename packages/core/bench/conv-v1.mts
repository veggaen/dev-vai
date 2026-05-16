/**
 * Conv-v1 bench — REAL-WORLD conversational prompts.
 *
 * Unlike v2..v26 which were template-shape probes, every case here is a
 * prompt a user would actually send: multi-clause, format-spec, polite
 * preamble, focused factual extraction, recovery turns, topic switches.
 *
 * This bench has NO pass/fail checks. It exists purely to push real prompts
 * through engine.chat() so the audit wrapper can capture and the audit
 * grader can tag every response. The signal is the report, not a score.
 *
 * Run via the audit wrapper:
 *   CONV_AUDIT_PATH=_conv_v1.jsonl CONV_AUDIT_BENCH=conv-v1 \
 *   CONV_AUDIT_MODULE=./bench/conv-v1.mts \
 *   pnpm exec tsx ./bench/_audit-wrapper.mts
 */
import { VaiEngine } from '../src/models/vai-engine.js';

type Msg = { role: 'user' | 'assistant'; content: string };

interface Case {
  id: string;
  category: string;
  turns: string[]; // user turns; assistant turns are inserted between by the harness
}

const CASES: Case[] = [
  // ── Multi-clause with explicit format spec (Aurora-style) ──────────────
  { id: 'aurora-norway', category: 'multi-format', turns: [
    "Hello, my name is Aurora and I would like today to know if you can tell me: only the name of the king in Norway, all the countries that border Norway, and their currency symbol. In the response I want you to tell me just that — the name, and then, after the period, a response in an array, separated by commas, of the symbol of the country's currency.",
  ] },
  { id: 'multi-king-sweden', category: 'multi-format', turns: [
    "Hi! Three things please: name the current king of Sweden, list every country that shares a land border with Sweden, and give me the ISO currency code of Sweden. Format: name on line 1, borders comma-separated on line 2, code on line 3.",
  ] },
  { id: 'multi-bitcoin', category: 'multi-format', turns: [
    "Two questions in one: who is the pseudonymous creator of Bitcoin (only their name, nothing else), and in what year did the Bitcoin whitepaper appear (only the 4-digit year). Reply with name on one line and year on the next.",
  ] },

  // ── Focused entity extraction (the question buried in chatter) ────────
  { id: 'satoshi-only', category: 'focused-extract', turns: [
    "Okay can you tell me the supposed anonymous creator of Bitcoin? What is that guy's name and tell me only his name please?",
  ] },
  { id: 'mona-lisa-painter', category: 'focused-extract', turns: [
    "I've been wondering about a painting hanging in the Louvre — the one with the lady smiling. Who painted it? Just the painter's name, nothing else.",
  ] },
  { id: 'cpu-creator', category: 'focused-extract', turns: [
    "Quick question — which company designs the M-series chips that ship in MacBooks these days? Just the company name.",
  ] },
  { id: 'theory-relativity', category: 'focused-extract', turns: [
    "Who came up with general relativity? Only the last name.",
  ] },

  // ── Recovery turns (user pushes back after a bad answer) ──────────────
  { id: 'retry-after-greeting', category: 'recovery', turns: [
    "Hello my name is Aurora, please tell me the capital of Norway and the currency symbol, as a comma-separated pair.",
    "I asked a question but you didn't fully answer. Forget the greeting — just give me the two answers: capital, then currency symbol, separated by a comma.",
  ] },
  { id: 'retry-after-encyclo', category: 'recovery', turns: [
    "Tell me about Bitcoin's creator.",
    "I don't need the history of Bitcoin. Only the name of the creator, one line.",
  ] },
  { id: 'retry-after-clarify', category: 'recovery', turns: [
    "What's the symbol?",
    "The currency symbol of Norway. Just the symbol character.",
  ] },

  // ── Polite preamble + nested questions ────────────────────────────────
  { id: 'polite-stack', category: 'polite-preamble', turns: [
    "If you don't mind, could you please tell me the largest planet in our solar system and how many moons it has? Format the moons count as a number only after the planet name.",
  ] },
  { id: 'polite-list', category: 'polite-preamble', turns: [
    "Sorry to bother you — list the five Nordic countries as a comma-separated array, alphabetically.",
  ] },

  // ── Topic-switch follow-ups (must not leak prior topic) ───────────────
  { id: 'switch-france-japan', category: 'topic-switch', turns: [
    "What is the capital of France?",
    "Now the capital of Japan.",
    "And its currency symbol, only the symbol character.",
  ] },
  { id: 'switch-snake-language', category: 'topic-switch', turns: [
    "Tell me about Python the snake.",
    "Now tell me about Python the programming language — who created it, just the name.",
  ] },

  // ── \"Only the X\" / \"just the Y\" extraction ──────────────────────────
  { id: 'only-currency-symbol-norway', category: 'extract-only', turns: [
    "What is the currency of Norway — only the symbol character please.",
  ] },
  { id: 'only-year-soviet', category: 'extract-only', turns: [
    "When did the Soviet Union dissolve — just the year as a number.",
  ] },
  { id: 'only-firstname-einstein', category: 'extract-only', turns: [
    "What was Einstein's first name? One word only.",
  ] },
  { id: 'only-color-mars', category: 'extract-only', turns: [
    "What colour is Mars — one word.",
  ] },

  // ── Format strict (CSV / JSON / numbered) ─────────────────────────────
  { id: 'fmt-csv-continents', category: 'format-strict', turns: [
    "List all seven continents as a comma-separated list on a single line, alphabetical order.",
  ] },
  { id: 'fmt-json-norway', category: 'format-strict', turns: [
    'Give me the capital of Norway and its currency symbol as JSON: {"capital": "...", "symbol": "..."}',
  ] },
  { id: 'fmt-numbered-primes', category: 'format-strict', turns: [
    "Give me the first five prime numbers as a numbered list, one per line.",
  ] },

  // ── Follow-up that requires memory of prior answer ────────────────────
  { id: 'fup-king-then-currency', category: 'followup-memory', turns: [
    "Who is the king of Norway right now?",
    "And the currency of his country — only the symbol character.",
  ] },
  { id: 'fup-name-then-list', category: 'followup-memory', turns: [
    "My name is Aurora. Remember that.",
    "What's my name?",
  ] },

  // ── Refusal-bait (must not stitch user tokens into fallback) ──────────
  { id: 'rare-1', category: 'refusal-bait', turns: [
    "Who won the local pickleball tournament in Drammen last Saturday?",
  ] },
  { id: 'rare-2', category: 'refusal-bait', turns: [
    "Name three European capitals.",
  ] },
  { id: 'rare-3', category: 'refusal-bait', turns: [
    "What's the population of Sandnes?",
  ] },

  // ── Long pseudo-realistic message ─────────────────────────────────────
  { id: 'long-mix', category: 'long-mixed', turns: [
    "Hi, I'm planning a quick Nordic trip and I have three questions: (1) which country has Stockholm as its capital, (2) the currency symbol used in Norway, and (3) the number of countries that border Sweden. Please answer with each item on its own line, prefixed with the question number.",
  ] },

  // ── Trick / negation ──────────────────────────────────────────────────
  { id: 'trick-not-france', category: 'negation', turns: [
    "Name a European country that is NOT France or Germany.",
  ] },
  { id: 'trick-not-paris', category: 'negation', turns: [
    "What's a capital city in Europe that is not Paris, London, or Berlin? One name only.",
  ] },
];

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  const filter = arg('cat', '');
  const cases = filter ? CASES.filter(c => c.category === filter) : CASES;

  console.log(`=== CONV-v1 BENCH (real-world prompts) ===`);
  console.log(`  cases=${cases.length} (filter=${filter || 'all'})`);

  // Disable network — same posture as v2..v26.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled in conv-v1 bench'); }) as typeof fetch;

  let done = 0;
  for (const c of cases) {
    const engine = new VaiEngine();
    (engine as unknown as { _nowMs: () => number })._nowMs = () => new Date('2026-05-16T12:00:00Z').getTime();
    const history: Msg[] = [];
    for (const turn of c.turns) {
      history.push({ role: 'user', content: turn });
      try {
        const r: any = await (engine as any).chat({ messages: history, noLearn: true });
        const answer: string = (r?.message?.content ?? r?.content ?? '').toString();
        history.push({ role: 'assistant', content: answer });
      } catch (e: any) {
        history.push({ role: 'assistant', content: `__ERROR__ ${e?.message ?? e}` });
      }
    }
    done++;
    if (done % 5 === 0) process.stdout.write(`  [${done}/${cases.length}] ${c.id}\n`);
  }

  globalThis.fetch = originalFetch;
  console.log(`done.`);
}

await main();
