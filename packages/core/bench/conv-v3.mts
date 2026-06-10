/**
 * Conv-v3 bench — ~2000 generated conversations with strict grading
 *                  + failure-network classification.
 *
 * Cases are built combinatorially from seed facts × phrasing templates × turn
 * shapes (one-shot, multi-clause, follow-up, negation, recovery). Every case
 * declares the exact pass / mustNot / terse contract, so a "pass" really
 * means the answer satisfied a real user.
 *
 * Each FAIL is tagged with one or more failure classes so we can see the
 * failure network: which root causes co-occur, which categories cluster.
 *
 * Run:
 *   cd packages/core
 *   pnpm exec tsx ./bench/conv-v3.mts
 *
 * Writes:
 *   _conv_v3.jsonl
 *   _conv_v3.report.md
 */
import { VaiEngine } from '../src/models/vai-engine.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type Msg = { role: 'user' | 'assistant'; content: string };
type Pass = string | RegExp;

interface Case {
  id: string;
  category: string;
  template: string;          // template tag e.g. 'capital.one-shot'
  turns: string[];
  pass: Pass[];              // any one must match in last reply
  mustNot?: Pass[];          // any present in last reply -> fail
  terse?: number;            // last reply must be ≤ N chars
}

// ──────────────────────────────────────────────────────────────────────
// Seed facts
// ──────────────────────────────────────────────────────────────────────
const CAPITALS: Record<string, string> = {
  Norway: 'Oslo', Sweden: 'Stockholm', Denmark: 'Copenhagen', Finland: 'Helsinki',
  Iceland: 'Reykjavik', France: 'Paris', Germany: 'Berlin', Italy: 'Rome',
  Spain: 'Madrid', Portugal: 'Lisbon', Greece: 'Athens', Austria: 'Vienna',
  Belgium: 'Brussels', Netherlands: 'Amsterdam', Switzerland: 'Bern',
  Poland: 'Warsaw', Hungary: 'Budapest', Ireland: 'Dublin', Russia: 'Moscow',
  Japan: 'Tokyo', China: 'Beijing', India: 'New Delhi', Canada: 'Ottawa',
  Mexico: 'Mexico City', Brazil: 'Brasilia', Australia: 'Canberra',
  Egypt: 'Cairo', Turkey: 'Ankara', Argentina: 'Buenos Aires',
  Thailand: 'Bangkok',
};

const CURRENCY_SYMBOL: Record<string, string> = {
  Norway: 'kr', Sweden: 'kr', Denmark: 'kr', Iceland: 'kr',
  France: '€', Germany: '€', Italy: '€', Spain: '€', Portugal: '€',
  Greece: '€', Austria: '€', Belgium: '€', Netherlands: '€', Finland: '€',
  Ireland: '€',
  Japan: '¥', China: '¥', UK: '£', USA: '$', Canada: '$', Australia: '$',
  Switzerland: 'CHF', Poland: 'zł', Hungary: 'Ft', Russia: '₽',
  India: '₹', Turkey: '₺', Brazil: 'R$', Mexico: '$',
};

const CURRENCY_CODE: Record<string, string> = {
  Norway: 'NOK', Sweden: 'SEK', Denmark: 'DKK', Iceland: 'ISK',
  France: 'EUR', Germany: 'EUR', Italy: 'EUR', Spain: 'EUR',
  Japan: 'JPY', UK: 'GBP', USA: 'USD',
};

const PLANETS = ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune'];
const PLANET_COLOUR: Record<string,string> = {
  Mercury:'gray', Venus:'yellow', Earth:'blue', Mars:'red',
  Jupiter:'orange', Saturn:'gold', Uranus:'blue', Neptune:'blue',
};
const PLANET_MOONS: Record<string,number> = {
  Mercury:0, Venus:0, Earth:1, Mars:2,
  Jupiter:95, Saturn:146, Uranus:27, Neptune:14,
};
const LARGEST_PLANET = 'Jupiter';
const CLOSEST_TO_SUN = 'Mercury';

const CONTINENTS = ['Africa','Antarctica','Asia','Australia','Europe','North America','South America'];
const NORDIC = ['Denmark','Finland','Iceland','Norway','Sweden'];
const PRIMARY_COLOURS = ['red','blue','yellow'];
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const PEOPLE: Array<{ q: string; first: string; last: string; full: string; year?: number }> = [
  { q: 'general relativity', first: 'Albert', last: 'Einstein', full: 'Albert Einstein', year: 1915 },
  { q: 'the theory of evolution', first: 'Charles', last: 'Darwin', full: 'Charles Darwin', year: 1859 },
  { q: 'Bitcoin', first: 'Satoshi', last: 'Nakamoto', full: 'Satoshi Nakamoto', year: 2008 },
  { q: 'Python the programming language', first: 'Guido', last: 'van Rossum', full: 'Guido van Rossum', year: 1991 },
  { q: 'JavaScript', first: 'Brendan', last: 'Eich', full: 'Brendan Eich', year: 1995 },
  { q: 'Linux', first: 'Linus', last: 'Torvalds', full: 'Linus Torvalds', year: 1991 },
  { q: 'Romeo and Juliet', first: 'William', last: 'Shakespeare', full: 'William Shakespeare' },
  { q: '1984', first: 'George', last: 'Orwell', full: 'George Orwell', year: 1949 },
  { q: 'the Mona Lisa', first: 'Leonardo', last: 'da Vinci', full: 'Leonardo da Vinci' },
  { q: 'the telephone', first: 'Alexander', last: 'Bell', full: 'Alexander Graham Bell', year: 1876 },
  { q: 'the light bulb', first: 'Thomas', last: 'Edison', full: 'Thomas Edison', year: 1879 },
];

const COMPANY_FACT: Array<{ q: string; ans: string; aliases?: RegExp }> = [
  { q: 'the M-series chips in MacBooks', ans: 'Apple' },
  { q: 'the iPhone', ans: 'Apple' },
  { q: 'Windows', ans: 'Microsoft' },
  { q: 'Android', ans: 'Google' },
  { q: 'the Tesla Model S', ans: 'Tesla' },
  { q: 'AWS', ans: 'Amazon' },
];

const ARITH: Array<{ q: string; ans: number }> = [];
for (let a = 2; a <= 12; a++) for (let b = 2; b <= 12; b++) ARITH.push({ q: `${a}+${b}`, ans: a + b });
for (let a = 2; a <= 12; a++) for (let b = 2; b <= 12; b++) ARITH.push({ q: `${a}*${b}`, ans: a * b });
for (let a = 2; a <= 12; a++) for (let b = 2; b <= 12; b++) ARITH.push({ q: `${a*b} divided by ${b}`, ans: a });

const UNIT_MATH: Array<{ q: string; ans: number }> = [
  { q: 'days in a leap year', ans: 366 },
  { q: 'days in a regular year', ans: 365 },
  { q: 'hours in a day', ans: 24 },
  { q: 'minutes in an hour', ans: 60 },
  { q: 'seconds in a minute', ans: 60 },
  { q: 'hours in three days', ans: 72 },
  { q: 'minutes in two hours', ans: 120 },
  { q: 'days in a fortnight', ans: 14 },
  { q: 'weeks in a year', ans: 52 },
  { q: 'months in five years', ans: 60 },
];

const CHEM_SYMBOL: Record<string,string> = {
  gold:'Au', silver:'Ag', iron:'Fe', oxygen:'O', hydrogen:'H',
  carbon:'C', sodium:'Na', chlorine:'Cl', helium:'He', copper:'Cu',
};

const KINGS: Record<string,string> = {
  Norway: 'Harald', Sweden: 'Carl', Denmark: 'Frederik', UK: 'Charles',
  Netherlands: 'Willem',
};

const C: Case[] = [];
let _seq = 0;
const nextId = (tag: string) => `${tag}-${(_seq++).toString(36)}`;

const PHRASES = {
  capital: (k: string) => [
    `What is the capital of ${k}?`,
    `Capital of ${k}?`,
    `Tell me the capital of ${k}.`,
    `Can you tell me the capital of ${k}?`,
    `${k}'s capital?`,
    `Do you happen to know the capital of ${k}?`,
  ],
  capitalTerse: (k: string) => [
    `Capital of ${k}, one word.`,
    `Capital of ${k}. Just the name.`,
    `Only the capital city of ${k}.`,
  ],
  symbol: (k: string) => [
    `What is the currency symbol of ${k}?`,
    `Currency symbol of ${k}?`,
    `Give me the currency symbol used in ${k}.`,
  ],
  symbolTerse: (k: string) => [
    `Currency symbol of ${k}. Just the symbol character.`,
    `Only the currency symbol of ${k}.`,
    `Currency symbol of ${k}, one character.`,
  ],
  king: (k: string) => [
    `Who is the king of ${k}?`,
    `Name the current king of ${k}.`,
    `Who is the reigning monarch of ${k}?`,
  ],
};

// ── Capitals: one-shot + phrasing variants + terse ────────────────────
for (const country of Object.keys(CAPITALS)) {
  const cap = CAPITALS[country];
  for (const t of PHRASES.capital(country)) {
    C.push({ id: nextId('CAP'), category: 'capital', template: 'capital.one-shot',
      turns: [t], pass: [new RegExp(`\\b${cap.replace(/ /g,'\\s+')}\\b`, 'i')] });
  }
  for (const t of PHRASES.capitalTerse(country)) {
    C.push({ id: nextId('CAPT'), category: 'capital-terse', template: 'capital.terse',
      turns: [t], pass: [new RegExp(`\\b${cap.replace(/ /g,'\\s+')}\\b`, 'i')], terse: 60 });
  }
}

// ── Currency symbols: terse ───────────────────────────────────────────
for (const country of Object.keys(CURRENCY_SYMBOL)) {
  const sym = CURRENCY_SYMBOL[country];
  for (const t of PHRASES.symbol(country)) {
    C.push({ id: nextId('SYM'), category: 'currency-symbol', template: 'symbol.one-shot',
      turns: [t], pass: [escapeForRegex(sym)] });
  }
  for (const t of PHRASES.symbolTerse(country)) {
    C.push({ id: nextId('SYMT'), category: 'currency-symbol-terse', template: 'symbol.terse',
      turns: [t], pass: [escapeForRegex(sym)], terse: 30,
      mustNot: [new RegExp(`\\b${country}\\b`, 'i')] });
  }
}

// ── Currency codes ────────────────────────────────────────────────────
for (const country of Object.keys(CURRENCY_CODE)) {
  const code = CURRENCY_CODE[country];
  C.push({ id: nextId('CODE'), category: 'currency-code', template: 'code.one-shot',
    turns: [`What is the ISO currency code of ${country}?`], pass: [new RegExp(`\\b${code}\\b`)] });
}

// ── Kings ─────────────────────────────────────────────────────────────
for (const country of Object.keys(KINGS)) {
  const king = KINGS[country];
  for (const t of PHRASES.king(country)) {
    C.push({ id: nextId('KING'), category: 'monarch', template: 'king.one-shot',
      turns: [t], pass: [new RegExp(`\\b${king}\\b`)] });
  }
}

// ── Planets ───────────────────────────────────────────────────────────
for (const p of PLANETS) {
  C.push({ id: nextId('PLN'), category: 'planet-colour', template: 'planet.colour',
    turns: [`What colour is ${p}?`], pass: [new RegExp(`\\b${PLANET_COLOUR[p]}\\b`, 'i')] });
  C.push({ id: nextId('PLM'), category: 'planet-moons', template: 'planet.moons',
    turns: [`How many moons does ${p} have?`],
    pass: [new RegExp(`\\b${PLANET_MOONS[p]}\\b`)] });
}
C.push({ id: nextId('PLG'), category: 'planet-fact', template: 'planet.largest',
  turns: [`What is the largest planet?`], pass: [new RegExp(`\\b${LARGEST_PLANET}\\b`)] });
C.push({ id: nextId('PLC'), category: 'planet-fact', template: 'planet.closest',
  turns: [`Which planet is closest to the Sun?`], pass: [new RegExp(`\\b${CLOSEST_TO_SUN}\\b`)] });

// ── People: full / first / last / year ─────────────────────────────────
for (const p of PEOPLE) {
  C.push({ id: nextId('PFULL'), category: 'person-full', template: 'person.full',
    turns: [`Who is associated with ${p.q}?`], pass: [new RegExp(`\\b${escapeForRegex(p.last)}\\b`)] });
  C.push({ id: nextId('PLAST'), category: 'person-last-terse', template: 'person.last.terse',
    turns: [`Who came up with ${p.q}? Last name only.`],
    pass: [new RegExp(`\\b${escapeForRegex(p.last)}\\b`)], terse: 40 });
  C.push({ id: nextId('PFIRST'), category: 'person-first-terse', template: 'person.first.terse',
    turns: [`What was the first name of the person behind ${p.q}? One word only.`],
    pass: [new RegExp(`\\b${escapeForRegex(p.first)}\\b`)], terse: 30 });
  if (p.year !== undefined) {
    C.push({ id: nextId('PYR'), category: 'person-year', template: 'person.year',
      turns: [`In what year was ${p.q} introduced or published? Year only.`],
      pass: [new RegExp(`\\b${p.year}\\b`)], terse: 30 });
  }
}

// ── Companies ─────────────────────────────────────────────────────────
for (const c of COMPANY_FACT) {
  C.push({ id: nextId('CO'), category: 'company', template: 'company.one-shot',
    turns: [`Which company makes ${c.q}?`], pass: [new RegExp(`\\b${escapeForRegex(c.ans)}\\b`, 'i')] });
}

// ── Arithmetic ────────────────────────────────────────────────────────
for (const a of ARITH) {
  C.push({ id: nextId('AR'), category: 'arithmetic', template: 'arith.basic',
    turns: [`What is ${a.q}?`], pass: [new RegExp(`(^|\\D)${a.ans}(\\D|$)`)], terse: 80 });
}

// ── Unit math ─────────────────────────────────────────────────────────
for (const u of UNIT_MATH) {
  C.push({ id: nextId('UM'), category: 'unit-math', template: 'unit.basic',
    turns: [`How many ${u.q}?`], pass: [new RegExp(`\\b${u.ans}\\b`)], terse: 80 });
}

// ── Chemistry symbols ─────────────────────────────────────────────────
for (const el of Object.keys(CHEM_SYMBOL)) {
  C.push({ id: nextId('CHEM'), category: 'chem-symbol', template: 'chem.symbol',
    turns: [`What is the chemical symbol for ${el}?`], pass: [new RegExp(`\\b${CHEM_SYMBOL[el]}\\b`)] });
}

// ── Lists / format-spec ───────────────────────────────────────────────
C.push({ id: nextId('LIST'), category: 'list', template: 'list.continents-csv',
  turns: [`List all seven continents, comma-separated, alphabetical order.`],
  pass: [new RegExp(CONTINENTS.join('.+'), 'is')] });
C.push({ id: nextId('LIST'), category: 'list', template: 'list.nordic-csv',
  turns: [`List the five Nordic countries, comma-separated, alphabetical order.`],
  pass: [new RegExp(NORDIC.join('.+'), 'is')] });
C.push({ id: nextId('LIST'), category: 'list', template: 'list.days-csv',
  turns: [`List the days of the week, comma separated.`],
  pass: [new RegExp(DAYS.join('.+'), 'is')] });
C.push({ id: nextId('LIST'), category: 'list', template: 'list.months-csv',
  turns: [`List the months of the year in order.`],
  pass: [new RegExp(MONTHS.join('.+'), 'is')] });
C.push({ id: nextId('LIST'), category: 'list', template: 'list.primaries',
  turns: [`List the three primary colours.`],
  pass: [new RegExp(`\\b${PRIMARY_COLOURS[0]}\\b[\\s\\S]*\\b${PRIMARY_COLOURS[1]}\\b[\\s\\S]*\\b${PRIMARY_COLOURS[2]}\\b|\\b${PRIMARY_COLOURS[0]}\\b[\\s\\S]*\\b${PRIMARY_COLOURS[2]}\\b[\\s\\S]*\\b${PRIMARY_COLOURS[1]}\\b`, 'i')] });

// ── Multi-clause (2 + 3 part) ─────────────────────────────────────────
const COUNTRIES = Object.keys(CAPITALS);
for (let i = 0; i < 25; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i + 7) % COUNTRIES.length];
  if (a === b) continue;
  C.push({ id: nextId('MULTI2'), category: 'multi-2', template: 'multi.capital2',
    turns: [`Capital of ${a} and capital of ${b}?`],
    pass: [new RegExp(`\\b${CAPITALS[a]}\\b[\\s\\S]*\\b${CAPITALS[b]}\\b|\\b${CAPITALS[b]}\\b[\\s\\S]*\\b${CAPITALS[a]}\\b`, 'i')] });
}
for (let i = 0; i < 25; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i + 5) % COUNTRIES.length];
  const c = COUNTRIES[(i + 11) % COUNTRIES.length];
  if (a === b || b === c || a === c) continue;
  C.push({ id: nextId('MULTI3'), category: 'multi-3', template: 'multi.capital3',
    turns: [`Capitals of ${a}, ${b}, and ${c}?`],
    pass: [new RegExp(`(?=[\\s\\S]*\\b${CAPITALS[a]}\\b)(?=[\\s\\S]*\\b${CAPITALS[b]}\\b)(?=[\\s\\S]*\\b${CAPITALS[c]}\\b)`, 'i')] });
}

// ── Mixed multi (capital + currency) ──────────────────────────────────
for (const country of Object.keys(CAPITALS).slice(0, 15)) {
  if (!CURRENCY_SYMBOL[country]) continue;
  C.push({ id: nextId('MIX'), category: 'multi-mixed', template: 'multi.cap+sym',
    turns: [`Capital of ${country} and its currency symbol?`],
    pass: [new RegExp(`(?=[\\s\\S]*\\b${CAPITALS[country]}\\b)(?=[\\s\\S]*${escapeForRegex(CURRENCY_SYMBOL[country])})`, 'i')] });
}

// ── Follow-up pronoun ─────────────────────────────────────────────────
for (const country of Object.keys(CAPITALS).slice(0, 15)) {
  if (!CURRENCY_SYMBOL[country]) continue;
  C.push({ id: nextId('FUP'), category: 'followup', template: 'followup.symbol',
    turns: [`What is the capital of ${country}?`, `And its currency symbol, only the symbol character.`],
    pass: [escapeForRegex(CURRENCY_SYMBOL[country])], terse: 40,
    mustNot: [new RegExp(`\\b${CAPITALS[country]}\\b`, 'i')] });
}
for (const country of Object.keys(KINGS)) {
  if (!CURRENCY_SYMBOL[country]) continue;
  C.push({ id: nextId('FUP'), category: 'followup', template: 'followup.king-currency',
    turns: [`Who is the king of ${country}?`, `And the currency symbol of his country?`],
    pass: [escapeForRegex(CURRENCY_SYMBOL[country])], terse: 80 });
}

// ── Topic switch ──────────────────────────────────────────────────────
for (let i = 0; i < 15; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i + 13) % COUNTRIES.length];
  if (a === b) continue;
  C.push({ id: nextId('SW'), category: 'switch', template: 'switch.country',
    turns: [`Capital of ${a}?`, `Forget that. Capital of ${b}?`],
    pass: [new RegExp(`\\b${CAPITALS[b]}\\b`, 'i')], mustNot: [new RegExp(`^[^\\n]*\\b${CAPITALS[a]}\\b[^\\n]*$`)] });
}

// ── Negation / exclusion ──────────────────────────────────────────────
const EU_CAPITALS = ['Paris','Berlin','Madrid','Rome','Lisbon','Oslo','Stockholm','Helsinki','Athens','Vienna','Warsaw','Prague','Dublin','Amsterdam','Brussels','Copenhagen','Bern','Budapest','Reykjavik'];
for (let i = 0; i < 20; i++) {
  const exclude = EU_CAPITALS[i % EU_CAPITALS.length];
  const others = EU_CAPITALS.filter(x => x !== exclude).slice(0, 12);
  C.push({ id: nextId('NEG'), category: 'negation', template: 'negation.capital',
    turns: [`A European capital that is not ${exclude}. One name only.`],
    pass: [new RegExp(`\\b(${others.join('|')})\\b`)], mustNot: [new RegExp(`^\\s*\\*?\\*?${exclude}\\b`, 'i')], terse: 60 });
}

const EU_COUNTRIES = ['France','Germany','Italy','Spain','Portugal','Norway','Sweden','Denmark','Finland','Iceland','Greece','Poland','Austria','Belgium','Netherlands','Ireland','Switzerland'];
for (let i = 0; i < 15; i++) {
  const a = EU_COUNTRIES[i % EU_COUNTRIES.length];
  const b = EU_COUNTRIES[(i + 4) % EU_COUNTRIES.length];
  if (a === b) continue;
  const others = EU_COUNTRIES.filter(x => x !== a && x !== b);
  C.push({ id: nextId('NEG2'), category: 'negation-2', template: 'negation.country2',
    turns: [`Name a European country that is NOT ${a} or ${b}.`],
    pass: [new RegExp(`\\b(${others.join('|')})\\b`)],
    mustNot: [new RegExp(`^\\s*\\*?\\*?(${a}|${b})\\b`, 'i')] });
}

// ── Recovery turns ────────────────────────────────────────────────────
for (const p of PEOPLE.slice(0, 6)) {
  C.push({ id: nextId('REC'), category: 'recovery', template: 'recovery.after-encyclo',
    turns: [`Tell me about ${p.q}.`, `Only the name of the person, one line.`],
    pass: [new RegExp(`\\b${escapeForRegex(p.last)}\\b`)], terse: 80 });
}
for (const country of Object.keys(CURRENCY_SYMBOL).slice(0, 8)) {
  C.push({ id: nextId('REC'), category: 'recovery', template: 'recovery.after-cap',
    turns: [`Tell me the capital of ${country} and its currency symbol.`, `You missed the symbol. Just the symbol character please.`],
    pass: [escapeForRegex(CURRENCY_SYMBOL[country])], terse: 30 });
}

// ── Casual ────────────────────────────────────────────────────────────
const CASUAL = [
  ['Hi!', /\b(hi|hello|hey)\b/i],
  ['Hello there.', /\b(hi|hello|hey|there)\b/i],
  ['Good morning.', /\b(morning|hi|hello|hey|good)\b/i],
  ['Good evening.', /\b(evening|hi|hello|hey|good)\b/i],
  ['How are you?', /\b(good|fine|well|great|here|doing|operational)\b/i],
  ['Thanks!', /\b(welcome|anytime|sure|glad|happy|pleasure)\b/i],
  ['Thank you so much.', /\b(welcome|anytime|sure|glad|happy|pleasure)\b/i],
  ['What\'s up?', /\b(here|hello|hi|hey|not much|nothing)\b/i],
] as const;
for (const [t, rx] of CASUAL) {
  C.push({ id: nextId('CAS'), category: 'casual', template: 'casual',
    turns: [t], pass: [rx], terse: 300,
    mustNot: [/knowledge yet|don['']t have a confident answer|build me a Next\.js/i] });
}

// ── Refusal-appropriate (must NOT confabulate) ────────────────────────
const REFUSALS = [
  'Who won the local pickleball tournament in Drammen last Saturday?',
  'What\'s the population of Sandnes?',
  'Who is my next-door neighbour?',
  'How many goals did the local under-12 team score yesterday?',
  'What did the mayor of Bergen eat for breakfast?',
];
for (const t of REFUSALS) {
  C.push({ id: nextId('REF'), category: 'refusal-ok', template: 'refusal',
    turns: [t], pass: [/don['']t|isn['']t|not sure|no\s+confident|unable|don['']t know|knowledge yet/i] });
}

// ──────────────────────────────────────────────────────────────────────
// Failure classifier
// ──────────────────────────────────────────────────────────────────────
function classifyFailure(c: Case, response: string, terseExceeded: boolean, forbiddenHit: boolean): string[] {
  const tags: string[] = [];
  const r = response.toLowerCase();
  const fallbackLike = /don['']t (have|know)|knowledge yet|isn['']t in my|no confident answer|not sure|build me a next\.js|build a rust|what i can do|what vai can do/i.test(response);
  if (fallbackLike) tags.push('knowledge-gap');
  if (terseExceeded) tags.push('terse-violated');
  if (forbiddenHit) tags.push('forbidden-substring');

  // Off-topic retrieval drift — recognizable when answer mentions wholly unrelated material
  if (/storting|stortinget|nansen|el salvador|legal tender|clear communication is/i.test(r)) tags.push('retrieval-drift');

  // Splitter / synthesizer bug
  if (/\*\*what is .{0,80}\?\*\*/i.test(response)) tags.push('splitter-bug');

  // Confident wrong (passes are absent but response is short + asserts)
  if (!fallbackLike && response.length < 200 && !/\?$/.test(response.trim())) tags.push('confident-wrong-or-incomplete');

  // Multi-clause drop — when category multi-* and reply is short / single fact
  if (/^multi-/.test(c.category) && response.length < 200) tags.push('multi-clause-drop');

  // Format violation
  if (c.template.startsWith('list.') && !/\,/.test(response)) tags.push('format-missing-csv');

  // Echo of input as code identifier
  if (c.template.startsWith('code.') && /\bjavascript that returns square of number\b/i.test(response)) tags.push('echo-as-identifier');

  // Pronoun-broken
  if (c.template.startsWith('followup.') && fallbackLike) tags.push('pronoun-broken');

  if (tags.length === 0) tags.push('uncategorized');
  return tags;
}

// ──────────────────────────────────────────────────────────────────────
function check(text: string, pats: Pass[]): boolean {
  return pats.some((p) => (typeof p === 'string' ? text.toLowerCase().includes(p.toLowerCase()) : p.test(text)));
}
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ──────────────────────────────────────────────────────────────────────
async function main() {
  const outJsonl = path.resolve(process.cwd(), '../../_conv_v3.jsonl');
  const outReport = path.resolve(process.cwd(), '../../_conv_v3.report.md');
  await fs.writeFile(outJsonl, '', 'utf8');

  console.log(`=== CONV-v3 BENCH (generated, strict, classified) ===`);
  console.log(`  cases=${C.length}`);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled'); }) as typeof fetch;

  type Row = { id: string; category: string; template: string; pass: boolean; reason: string; tags: string[]; prompt: string; response: string };
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
    let forbiddenHit = false;
    let terseExceeded = false;
    if (pass && c.mustNot && check(lastAnswer, c.mustNot)) { pass = false; reason = 'forbidden-substring'; forbiddenHit = true; }
    if (pass && c.terse !== undefined && lastAnswer.length > c.terse) { pass = false; reason = `too-long(${lastAnswer.length}>${c.terse})`; terseExceeded = true; }
    if (!pass && c.terse !== undefined && lastAnswer.length > c.terse) terseExceeded = true;
    if (!pass && c.mustNot && check(lastAnswer, c.mustNot)) forbiddenHit = true;

    const tags = pass ? [] : classifyFailure(c, lastAnswer, terseExceeded, forbiddenHit);

    const row: Row = { id: c.id, category: c.category, template: c.template, pass, reason, tags,
                       prompt: c.turns[c.turns.length - 1], response: lastAnswer };
    rows.push(row);
    await fs.appendFile(outJsonl, JSON.stringify(row) + '\n', 'utf8');

    done++;
    if (done % 100 === 0) process.stdout.write(`  [${done}/${C.length}]\n`);
  }

  globalThis.fetch = originalFetch;

  // ──── Build report ───────────────────────────────────────────────
  const total = rows.length;
  const passed = rows.filter(r => r.pass).length;
  const failed = total - passed;

  const byCat = new Map<string, { total: number; pass: number }>();
  for (const r of rows) {
    const b = byCat.get(r.category) ?? { total: 0, pass: 0 };
    b.total++; if (r.pass) b.pass++;
    byCat.set(r.category, b);
  }
  const byTemplate = new Map<string, { total: number; pass: number }>();
  for (const r of rows) {
    const b = byTemplate.get(r.template) ?? { total: 0, pass: 0 };
    b.total++; if (r.pass) b.pass++;
    byTemplate.set(r.template, b);
  }

  // Failure-tag distribution
  const tagCount = new Map<string, number>();
  for (const r of rows) if (!r.pass) for (const t of r.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);

  // Failure-tag co-occurrence
  const cooc = new Map<string, number>();
  for (const r of rows) if (!r.pass) {
    const ts = [...new Set(r.tags)].sort();
    for (let i = 0; i < ts.length; i++) for (let j = i+1; j < ts.length; j++) {
      const key = `${ts[i]} + ${ts[j]}`;
      cooc.set(key, (cooc.get(key) ?? 0) + 1);
    }
  }

  // Per-tag × per-category matrix (failure network)
  const catTagMatrix = new Map<string, Map<string, number>>();
  for (const r of rows) if (!r.pass) {
    const m = catTagMatrix.get(r.category) ?? new Map();
    for (const t of r.tags) m.set(t, (m.get(t) ?? 0) + 1);
    catTagMatrix.set(r.category, m);
  }

  const lines: string[] = [];
  lines.push(`# Conv-v3 generated bench (strict grading, classified)`);
  lines.push(``);
  lines.push(`**Total:** ${total}    **Pass:** ${passed} (${((passed/total)*100).toFixed(1)}%)    **Fail:** ${failed}`);
  lines.push(``);
  lines.push(`## Pass rate by category`);
  lines.push(``);
  lines.push(`| Category | Pass | Total | % |`);
  lines.push(`|---|---|---|---|`);
  for (const [cat, b] of [...byCat.entries()].sort((a,b) => (a[1].pass/a[1].total) - (b[1].pass/b[1].total))) {
    lines.push(`| ${cat} | ${b.pass} | ${b.total} | ${((b.pass/b.total)*100).toFixed(0)}% |`);
  }
  lines.push(``);
  lines.push(`## Pass rate by template`);
  lines.push(``);
  lines.push(`| Template | Pass | Total | % |`);
  lines.push(`|---|---|---|---|`);
  for (const [t, b] of [...byTemplate.entries()].sort((a,b) => (a[1].pass/a[1].total) - (b[1].pass/b[1].total))) {
    lines.push(`| ${t} | ${b.pass} | ${b.total} | ${((b.pass/b.total)*100).toFixed(0)}% |`);
  }
  lines.push(``);
  lines.push(`## Failure-tag totals (the "network")`);
  lines.push(``);
  lines.push(`| Tag | Count |`);
  lines.push(`|---|---|`);
  for (const [t, n] of [...tagCount.entries()].sort((a,b) => b[1] - a[1])) {
    lines.push(`| ${t} | ${n} |`);
  }
  lines.push(``);
  lines.push(`## Top failure-tag co-occurrences`);
  lines.push(``);
  lines.push(`| Pair | Count |`);
  lines.push(`|---|---|`);
  for (const [k, n] of [...cooc.entries()].sort((a,b) => b[1] - a[1]).slice(0, 25)) {
    lines.push(`| ${k} | ${n} |`);
  }
  lines.push(``);
  lines.push(`## Per-category failure-tag breakdown`);
  lines.push(``);
  for (const [cat, m] of [...catTagMatrix.entries()].sort()) {
    const entries = [...m.entries()].sort((a,b) => b[1] - a[1]).map(([t,n]) => `${t}=${n}`).join(', ');
    lines.push(`- **${cat}** — ${entries}`);
  }
  lines.push(``);
  lines.push(`## Sample failures (first 60)`);
  lines.push(``);
  lines.push(`| ID | Cat | Tags | Prompt | Response |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of rows.filter(r => !r.pass).slice(0, 60)) {
    const p = r.prompt.replace(/\|/g,'\\|').replace(/\n/g,' ').slice(0, 70);
    const a = r.response.replace(/\|/g,'\\|').replace(/\n/g,' ').slice(0, 120);
    lines.push(`| ${r.id} | ${r.category} | ${r.tags.join('+')} | ${p} | ${a} |`);
  }
  await fs.writeFile(outReport, lines.join('\n'), 'utf8');

  console.log(`\nTotal=${total} Pass=${passed} (${((passed/total)*100).toFixed(1)}%)`);
  console.log(`Report: ${outReport}`);
}

await main();
