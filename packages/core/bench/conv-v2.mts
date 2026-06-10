/**
 * Conv-v2 bench — HONEST grading of real conversations.
 *
 * 100+ diverse conversations. Each case declares:
 *   - pass:    any one of these substrings (case-insensitive) must appear in the
 *              final assistant response for the case to count as passing.
 *   - mustNot: any of these substrings present in the final response is an
 *              automatic FAIL, even if `pass` would have matched.
 *
 * The grader is intentionally strict. The point is to stop pretending the
 * engine is good when it produces wrong, half-wrong, or off-topic output.
 *
 * Run:
 *   cd packages/core
 *   pnpm exec tsx ./bench/conv-v2.mts
 *
 * Writes:
 *   _conv_v2.jsonl       (one line per case)
 *   _conv_v2.report.md   (bulk failure breakdown)
 */
import { VaiEngine } from '../src/models/vai-engine.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type Msg = { role: 'user' | 'assistant'; content: string };
type Pass = string | RegExp;

interface Case {
  id: string;
  category: string;
  turns: string[];
  // Final-turn expectations
  pass: Pass[];        // any one substring/regex match in last reply -> ok
  mustNot?: Pass[];    // any of these in last reply -> fail
  // When true, the answer must be VERY short (<= maxChars). Catches encyclopedia
  // dumps on "only the name / one word" prompts.
  terse?: number;
}

const C: Case[] = [];

// ────────────────────────────────────────────────────────────────────────
// A. Basic factual one-shot
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'A01', category: 'basic-fact', turns: ['What is the capital of France?'],
    pass: [/\bParis\b/i] },
  { id: 'A02', category: 'basic-fact', turns: ['What is the capital of Japan?'],
    pass: [/\bTokyo\b/i] },
  { id: 'A03', category: 'basic-fact', turns: ['What is the capital of Norway?'],
    pass: [/\bOslo\b/i] },
  { id: 'A04', category: 'basic-fact', turns: ['What is the capital of Spain?'],
    pass: [/\bMadrid\b/i] },
  { id: 'A05', category: 'basic-fact', turns: ['What is the largest planet?'],
    pass: [/\bJupiter\b/i] },
  { id: 'A06', category: 'basic-fact', turns: ['Which planet is closest to the Sun?'],
    pass: [/\bMercury\b/i] },
  { id: 'A07', category: 'basic-fact', turns: ['What colour is the sky on a clear day?'],
    pass: [/\bblue\b/i] },
  { id: 'A08', category: 'basic-fact', turns: ['What colour is Mars?'],
    pass: [/\bred\b/i] },
  { id: 'A09', category: 'basic-fact', turns: ['How many continents are there?'],
    pass: [/\bseven\b|\b7\b/i] },
  { id: 'A10', category: 'basic-fact', turns: ['Who wrote Romeo and Juliet?'],
    pass: [/\bShakespeare\b/i] },
  { id: 'A11', category: 'basic-fact', turns: ['Who painted the Mona Lisa?'],
    pass: [/\b(Leonardo|da Vinci)\b/i] },
  { id: 'A12', category: 'basic-fact', turns: ['Who is the king of Norway?'],
    pass: [/\bHarald\b/i] },
  { id: 'A13', category: 'basic-fact', turns: ['Who invented the telephone?'],
    pass: [/\bBell\b/i] },
  { id: 'A14', category: 'basic-fact', turns: ['What year did the Berlin Wall fall?'],
    pass: [/\b1989\b/] },
  { id: 'A15', category: 'basic-fact', turns: ['What year did the Soviet Union dissolve?'],
    pass: [/\b1991\b/] },
  { id: 'A16', category: 'basic-fact', turns: ['What is H2O?'],
    pass: [/\bwater\b/i] },
  { id: 'A17', category: 'basic-fact', turns: ['Which company designs the M-series chips in MacBooks?'],
    pass: [/\bApple\b/i] },
  { id: 'A18', category: 'basic-fact', turns: ['What is the speed of light in m/s, roughly?'],
    pass: [/3\s*[×x*]?\s*10\s*\^?\s*8|299[, ]?792|300[, ]?000[, ]?000/i] },
  { id: 'A19', category: 'basic-fact', turns: ['Who created Python the programming language?'],
    pass: [/\bGuido\b/i] },
  { id: 'A20', category: 'basic-fact', turns: ['What is the chemical symbol for gold?'],
    pass: [/\bAu\b/] },
);

// ────────────────────────────────────────────────────────────────────────
// B. Terse extraction — "only the X" / "one word" / "just the Y"
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'B01', category: 'terse', turns: ['Who painted the Mona Lisa? Just the painter\'s name.'],
    pass: [/\b(Leonardo|da Vinci)\b/i], terse: 80 },
  { id: 'B02', category: 'terse', turns: ['Who came up with general relativity? Only the last name.'],
    pass: [/\bEinstein\b/i], terse: 30 },
  { id: 'B03', category: 'terse', turns: ['What was Einstein\'s first name? One word only.'],
    pass: [/^Albert\.?$/i], terse: 15 },
  { id: 'B04', category: 'terse', turns: ['What colour is Mars — one word.'],
    pass: [/^red\.?$/i], terse: 15 },
  { id: 'B05', category: 'terse', turns: ['When did the Soviet Union dissolve — just the year as a number.'],
    pass: [/^1991\.?$/], terse: 10 },
  { id: 'B06', category: 'terse', turns: ['Who is the pseudonymous creator of Bitcoin? Only the name.'],
    pass: [/\bSatoshi\b/i], terse: 40 },
  { id: 'B07', category: 'terse', turns: ['Currency symbol of Norway. Just the symbol character.'],
    pass: [/^kr\.?$/i], terse: 6, mustNot: [/\bNorway\b/i] },
  { id: 'B08', category: 'terse', turns: ['Currency symbol of Japan. Just the symbol character.'],
    pass: [/¥/], terse: 6 },
  { id: 'B09', category: 'terse', turns: ['Currency symbol of the EU. Just the symbol character.'],
    pass: [/€/], terse: 6 },
  { id: 'B10', category: 'terse', turns: ['How many planets in our solar system? Number only.'],
    pass: [/^8\.?$/], terse: 5 },
  { id: 'B11', category: 'terse', turns: ['Largest ocean? One word.'],
    pass: [/\bPacific\b/i], terse: 20 },
  { id: 'B12', category: 'terse', turns: ['Who wrote 1984? Last name only.'],
    pass: [/^Orwell\.?$/i], terse: 15 },
);

// ────────────────────────────────────────────────────────────────────────
// C. Format-spec (CSV / JSON / numbered)
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'C01', category: 'format', turns: ['List all seven continents as a comma-separated list, alphabetical order.'],
    pass: [/Africa.+Antarctica.+Asia.+Australia.+Europe.+North America.+South America/is] },
  { id: 'C02', category: 'format', turns: ['List the five Nordic countries as a comma-separated array, alphabetically.'],
    pass: [/Denmark.+Finland.+Iceland.+Norway.+Sweden/is] },
  { id: 'C03', category: 'format', turns: ['Give me the first five prime numbers as a numbered list, one per line.'],
    pass: [/1[\.\)]\s*2[\s\S]*2[\.\)]\s*3[\s\S]*3[\.\)]\s*5[\s\S]*4[\.\)]\s*7[\s\S]*5[\.\)]\s*11/] },
  { id: 'C04', category: 'format', turns: ['Give the capital of Norway and its currency symbol as JSON: {"capital":"...","symbol":"..."}'],
    pass: [/"capital"\s*:\s*"Oslo".*"symbol"\s*:\s*"kr"/is] },
  { id: 'C05', category: 'format', turns: ['List three primary colours, one per line.'],
    pass: [/red[\s\S]*(blue|yellow)[\s\S]*(yellow|blue)/i] },
  { id: 'C06', category: 'format', turns: ['List the days of the week as a comma-separated list.'],
    pass: [/Monday.+Tuesday.+Wednesday.+Thursday.+Friday.+Saturday.+Sunday/is] },
  { id: 'C07', category: 'format', turns: ['Give the months of the year, comma separated.'],
    pass: [/January.+February.+March.+April.+May.+June.+July.+August.+September.+October.+November.+December/is] },
);

// ────────────────────────────────────────────────────────────────────────
// D. Multi-clause one-shot
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'D01', category: 'multi', turns: ['Tell me the capital of France and the capital of Germany.'],
    pass: [/Paris[\s\S]*Berlin|Berlin[\s\S]*Paris/i] },
  { id: 'D02', category: 'multi', turns: ['Capital of Norway and currency symbol, as "capital, symbol".'],
    pass: [/Oslo[\s\S]*kr|kr[\s\S]*Oslo/i] },
  { id: 'D03', category: 'multi', turns: ['Largest planet and its number of moons (a rough number is fine).'],
    pass: [/Jupiter[\s\S]*\b(95|79|80|92|97|90)\b|\b(95|79|80|92|97|90)\b[\s\S]*Jupiter/i] },
  { id: 'D04', category: 'multi', turns: ['Who created Bitcoin and what year was the whitepaper?'],
    pass: [/Satoshi[\s\S]*2008|2008[\s\S]*Satoshi/i] },
  { id: 'D05', category: 'multi', turns: ['Name three European capitals.'],
    pass: [/(Paris|Berlin|Madrid|Rome|Lisbon|Oslo|Stockholm|Helsinki|Athens|Vienna|Warsaw|Prague|Dublin)[\s\S]*(Paris|Berlin|Madrid|Rome|Lisbon|Oslo|Stockholm|Helsinki|Athens|Vienna|Warsaw|Prague|Dublin)[\s\S]*(Paris|Berlin|Madrid|Rome|Lisbon|Oslo|Stockholm|Helsinki|Athens|Vienna|Warsaw|Prague|Dublin)/i] },
  { id: 'D06', category: 'multi', turns: ['List the four cardinal directions and the four seasons.'],
    pass: [/north[\s\S]*south[\s\S]*east[\s\S]*west[\s\S]*(spring|summer|autumn|fall|winter)/is] },
);

// ────────────────────────────────────────────────────────────────────────
// E. Follow-up pronoun / context resolution
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'E01', category: 'followup', turns: [
      'What is the capital of Japan?',
      'And its currency symbol, only the symbol character.'],
    pass: [/¥/], terse: 30, mustNot: [/Tokyo/i] },
  { id: 'E02', category: 'followup', turns: [
      'Who is the king of Norway?',
      'And the currency of his country — only the symbol character.'],
    pass: [/^kr/i], terse: 30 },
  { id: 'E03', category: 'followup', turns: [
      'What is the capital of France?',
      'And of Germany?'],
    pass: [/\bBerlin\b/i] },
  { id: 'E04', category: 'followup', turns: [
      'My name is Aurora. Remember that.',
      'What\'s my name?'],
    pass: [/\bAurora\b/] },
  { id: 'E05', category: 'followup', turns: [
      'Tell me about Mars.',
      'How many moons does it have?'],
    pass: [/\btwo\b|\b2\b/i] },
  { id: 'E06', category: 'followup', turns: [
      'Who wrote 1984?',
      'And what was his real first name?'],
    pass: [/\bEric\b/i] },
);

// ────────────────────────────────────────────────────────────────────────
// F. Topic switch — must not leak prior topic
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'F01', category: 'switch', turns: [
      'Tell me about Python the snake.',
      'Now tell me about Python the programming language — who created it, just the name.'],
    pass: [/\bGuido\b/i], mustNot: [/\bsnake\b|\bconstrictor\b|\bPythonidae\b/i] },
  { id: 'F02', category: 'switch', turns: [
      'Tell me about apples the fruit.',
      'Now tell me about Apple the company — when was it founded?'],
    pass: [/\b1976\b/] },
  { id: 'F03', category: 'switch', turns: [
      'What\'s the capital of Italy?',
      'OK forget Italy. What\'s the capital of Portugal?'],
    pass: [/\bLisbon\b/i], mustNot: [/\bRome\b/i] },
);

// ────────────────────────────────────────────────────────────────────────
// G. Negation / exclusion
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'G01', category: 'negation', turns: ['Name a European country that is NOT France or Germany.'],
    pass: [/\b(Spain|Italy|Portugal|Norway|Sweden|Denmark|Finland|Iceland|Greece|Poland|Austria|Belgium|Netherlands|Ireland|Switzerland|Czech|Hungary|Romania|Bulgaria|Croatia)\b/i],
    mustNot: [/\b(France|Germany)\b/i] },
  { id: 'G02', category: 'negation', turns: ['A capital city in Europe that is not Paris, London, or Berlin. One name only.'],
    pass: [/\b(Madrid|Rome|Lisbon|Oslo|Stockholm|Helsinki|Athens|Vienna|Warsaw|Prague|Dublin|Amsterdam|Brussels|Copenhagen|Bern|Budapest)\b/i],
    mustNot: [/\b(Paris|London|Berlin)\b/i], terse: 30 },
  { id: 'G03', category: 'negation', turns: ['Give me a planet in our solar system, but not Earth.'],
    pass: [/\b(Mercury|Venus|Mars|Jupiter|Saturn|Uranus|Neptune)\b/i],
    mustNot: [/\bEarth\b/i] },
  { id: 'G04', category: 'negation', turns: ['Name a programming language that is NOT JavaScript or Python.'],
    pass: [/\b(Rust|Go|C\+\+|Java|Kotlin|Swift|Ruby|TypeScript|C#|Lua|Haskell|Elixir)\b/i],
    mustNot: [/\b(JavaScript|^Python$)\b/] },
);

// ────────────────────────────────────────────────────────────────────────
// H. Recovery — user pushes back after partial answer
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'H01', category: 'recovery', turns: [
      'Tell me about Bitcoin\'s creator.',
      'I don\'t need the history of Bitcoin. Only the name of the creator, one line.'],
    pass: [/\bSatoshi\b/i], terse: 40 },
  { id: 'H02', category: 'recovery', turns: [
      'Hello, please tell me the capital of Norway and the currency symbol.',
      'You didn\'t give me the symbol. Just the symbol character please.'],
    pass: [/^kr/i], terse: 15 },
  { id: 'H03', category: 'recovery', turns: [
      'What is general relativity?',
      'Just the name of the person who came up with it.'],
    pass: [/\bEinstein\b/i], terse: 30 },
);

// ────────────────────────────────────────────────────────────────────────
// I. Ambiguity / disambiguation
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'I01', category: 'ambig', turns: ['Tell me about Mercury.'],
    pass: [/\b(planet|element|god|Roman|Freddie|Hg)\b/i] },
  { id: 'I02', category: 'ambig', turns: ['Tell me about Java.'],
    pass: [/\b(programming|island|coffee|Indonesia)\b/i] },
  { id: 'I03', category: 'ambig', turns: ['Tell me about Amazon.'],
    pass: [/\b(river|rainforest|company|Bezos|Brazil)\b/i] },
);

// ────────────────────────────────────────────────────────────────────────
// J. Refusal-appropriate (must NOT confabulate; fallback is fine)
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'J01', category: 'refusal-ok', turns: ['Who won the local pickleball tournament in Drammen last Saturday?'],
    pass: [/don['']t|isn['']t|not sure|no\s+confident|unable|don['']t know/i],
    mustNot: [/Nansen|Drammen\s+won/i] },
  { id: 'J02', category: 'refusal-ok', turns: ['What\'s the population of Sandnes?'],
    pass: [/don['']t|isn['']t|not sure|no\s+confident|unable|don['']t know|knowledge yet/i] },
  { id: 'J03', category: 'refusal-ok', turns: ['Who is my next-door neighbour?'],
    pass: [/don['']t|isn['']t|not sure|no\s+confident|unable|don['']t know|knowledge yet/i] },
);

// ────────────────────────────────────────────────────────────────────────
// K. Casual / greeting / small talk
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'K01', category: 'casual', turns: ['Hi there!'],
    pass: [/\b(hi|hello|hey)\b/i], terse: 200,
    mustNot: [/Build projects|knowledge yet/i] },
  { id: 'K02', category: 'casual', turns: ['How are you?'],
    pass: [/\b(good|fine|well|great|here)\b/i], terse: 200 },
  { id: 'K03', category: 'casual', turns: ['Thanks!'],
    pass: [/\b(welcome|anytime|sure|glad|happy)\b/i], terse: 150 },
  { id: 'K04', category: 'casual', turns: ['Tell me a joke.'],
    pass: [/.{20,}/], terse: 400, mustNot: [/knowledge yet|don['']t have/i] },
  { id: 'K05', category: 'casual', turns: ['Good morning.'],
    pass: [/\b(morning|hello|hi|good)\b/i], terse: 200 },
);

// ────────────────────────────────────────────────────────────────────────
// L. Mixed Norwegian / English (user mode)
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'L01', category: 'no-en', turns: ['Hva er hovedstaden i Norge?'],
    pass: [/\bOslo\b/i] },
  { id: 'L02', category: 'no-en', turns: ['Hvem er kongen av Norge?'],
    pass: [/\bHarald\b/i] },
  { id: 'L03', category: 'no-en', turns: ['Hva er 2 pluss 2?'],
    pass: [/\b4\b|\bfire\b/i] },
);

// ────────────────────────────────────────────────────────────────────────
// M. Simple arithmetic / counting
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'M01', category: 'math', turns: ['What is 2+2?'],
    pass: [/\b4\b/], terse: 30 },
  { id: 'M02', category: 'math', turns: ['What is 17 times 6?'],
    pass: [/\b102\b/], terse: 30 },
  { id: 'M03', category: 'math', turns: ['How many days in a leap year?'],
    pass: [/\b366\b/], terse: 30 },
  { id: 'M04', category: 'math', turns: ['How many hours in three days?'],
    pass: [/\b72\b/], terse: 30 },
  { id: 'M05', category: 'math', turns: ['What is 50% of 200?'],
    pass: [/\b100\b/], terse: 30 },
);

// ────────────────────────────────────────────────────────────────────────
// N. Code asks — should not refuse simple code
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'N01', category: 'code', turns: ['Write a JavaScript function that returns the square of a number.'],
    pass: [/function\s+\w*\s*\(\s*\w+\s*\)|=>\s*\w+\s*\*\s*\w+|return\s+\w+\s*\*\s*\w+/] },
  { id: 'N02', category: 'code', turns: ['Show me Python code to print "hello world".'],
    pass: [/print\(\s*['"]hello world['"]\s*\)/i] },
  { id: 'N03', category: 'code', turns: ['How do I declare a constant in TypeScript?'],
    pass: [/\bconst\b/] },
);

// ────────────────────────────────────────────────────────────────────────
// O. Aurora-style heavy multi-clause
// ────────────────────────────────────────────────────────────────────────
C.push(
  { id: 'O01', category: 'aurora', turns: [
      'Hello, my name is Aurora. Please tell me: only the name of the king of Norway, the capital of Norway, and the currency symbol used there. Three lines.'],
    pass: [/Harald[\s\S]*Oslo[\s\S]*kr/is] },
  { id: 'O02', category: 'aurora', turns: [
      'Hi! Three things: capital of Sweden, currency symbol of Sweden, and the name of the Swedish king.'],
    pass: [/Stockholm[\s\S]*kr[\s\S]*Carl|Carl[\s\S]*Stockholm[\s\S]*kr/is] },
);

// ────────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────────
function check(text: string, pats: Pass[]): boolean {
  return pats.some((p) => (typeof p === 'string' ? text.toLowerCase().includes(p.toLowerCase()) : p.test(text)));
}

async function main() {
  const outJsonl = path.resolve(process.cwd(), '../../_conv_v2.jsonl');
  const outReport = path.resolve(process.cwd(), '../../_conv_v2.report.md');
  await fs.writeFile(outJsonl, '', 'utf8');

  console.log(`=== CONV-v2 BENCH (honest grading) ===`);
  console.log(`  cases=${C.length}`);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled'); }) as typeof fetch;

  type Row = { id: string; category: string; pass: boolean; reason: string; prompt: string; response: string };
  const rows: Row[] = [];

  let done = 0;
  for (const c of C) {
    const engine = new VaiEngine();
    (engine as unknown as { _nowMs: () => number })._nowMs = () => new Date('2026-05-16T12:00:00Z').getTime();
    const history: Msg[] = [];
    let lastAnswer = '';
    for (const turn of c.turns) {
      history.push({ role: 'user', content: turn });
      try {
        const r: any = await (engine as any).chat({ messages: history, noLearn: true });
        lastAnswer = (r?.message?.content ?? r?.content ?? '').toString();
        history.push({ role: 'assistant', content: lastAnswer });
      } catch (e: any) {
        lastAnswer = `__ERROR__ ${e?.message ?? e}`;
        history.push({ role: 'assistant', content: lastAnswer });
      }
    }

    let pass = check(lastAnswer, c.pass);
    let reason = pass ? 'ok' : 'no-pass-match';
    if (pass && c.mustNot && check(lastAnswer, c.mustNot)) {
      pass = false;
      reason = 'forbidden-substring';
    }
    if (pass && c.terse !== undefined && lastAnswer.length > c.terse) {
      pass = false;
      reason = `too-long(${lastAnswer.length}>${c.terse})`;
    }

    const row: Row = {
      id: c.id, category: c.category, pass, reason,
      prompt: c.turns[c.turns.length - 1],
      response: lastAnswer,
    };
    rows.push(row);
    await fs.appendFile(outJsonl, JSON.stringify(row) + '\n', 'utf8');

    done++;
    if (done % 10 === 0) process.stdout.write(`  [${done}/${C.length}]\n`);
  }

  globalThis.fetch = originalFetch;

  // Build report
  const byCat = new Map<string, { total: number; pass: number }>();
  for (const r of rows) {
    const b = byCat.get(r.category) ?? { total: 0, pass: 0 };
    b.total += 1; if (r.pass) b.pass += 1;
    byCat.set(r.category, b);
  }
  const total = rows.length;
  const passed = rows.filter(r => r.pass).length;
  const failures = rows.filter(r => !r.pass);

  const lines: string[] = [];
  lines.push(`# Conv-v2 honest grading`);
  lines.push(``);
  lines.push(`**Total:** ${total}    **Pass:** ${passed} (${((passed/total)*100).toFixed(1)}%)    **Fail:** ${total - passed}`);
  lines.push(``);
  lines.push(`## By category`);
  lines.push(``);
  lines.push(`| Category | Pass | Total | % |`);
  lines.push(`|---|---|---|---|`);
  for (const [cat, b] of [...byCat.entries()].sort()) {
    lines.push(`| ${cat} | ${b.pass} | ${b.total} | ${((b.pass/b.total)*100).toFixed(0)}% |`);
  }
  lines.push(``);
  lines.push(`## Failures`);
  lines.push(``);
  lines.push(`| ID | Cat | Reason | Prompt | Response |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of failures) {
    const p = r.prompt.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 80);
    const a = r.response.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 140);
    lines.push(`| ${r.id} | ${r.category} | ${r.reason} | ${p} | ${a} |`);
  }
  await fs.writeFile(outReport, lines.join('\n'), 'utf8');

  console.log(`\nTotal=${total} Pass=${passed} (${((passed/total)*100).toFixed(1)}%)`);
  console.log(`Report: ${outReport}`);
}

await main();
