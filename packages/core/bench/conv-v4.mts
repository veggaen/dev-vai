/**
 * Conv-v4 bench — multi-thousand generated conversations across many
 * topics and stylistic variants, strict grading + failure-network
 * classification + a sampled real-user review.
 *
 * Run:
 *   cd packages/core
 *   pnpm exec tsx ./bench/conv-v4.mts
 *
 * Writes:
 *   _conv_v4.jsonl         — every (prompt, response, pass, tags)
 *   _conv_v4.report.md     — category/template tables, tag network
 *   _conv_v4.review.md     — sampled responses for human inspection
 */
import { VaiEngine } from '../src/models/vai-engine.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type Msg = { role: 'user' | 'assistant'; content: string };
type Pass = string | RegExp;

interface Case {
  id: string;
  category: string;
  template: string;
  style: string;            // phrasing style: 'plain' | 'polite' | 'terse' | 'slang' | 'caps' | 'typo' | 'norsk'
  turns: string[];
  pass: Pass[];
  mustNot?: Pass[];
  terse?: number;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function rx(s: string, flags = 'i'): RegExp {
  return new RegExp(`\\b${escapeForRegex(s).replace(/ /g, '\\s+')}\\b`, flags);
}

// ───────────────────────────────────────────────────────────────────────
// Seed knowledge
// ───────────────────────────────────────────────────────────────────────

const CAPITALS: Record<string, string> = {
  Norway:'Oslo', Sweden:'Stockholm', Denmark:'Copenhagen', Finland:'Helsinki',
  Iceland:'Reykjavik', France:'Paris', Germany:'Berlin', Italy:'Rome',
  Spain:'Madrid', Portugal:'Lisbon', Greece:'Athens', Austria:'Vienna',
  Belgium:'Brussels', Netherlands:'Amsterdam', Switzerland:'Bern',
  Poland:'Warsaw', Hungary:'Budapest', Ireland:'Dublin', Russia:'Moscow',
  Japan:'Tokyo', China:'Beijing', India:'New Delhi', Canada:'Ottawa',
  Mexico:'Mexico City', Brazil:'Brasilia', Australia:'Canberra',
  Egypt:'Cairo', Turkey:'Ankara', Argentina:'Buenos Aires', Thailand:'Bangkok',
  'South Korea':'Seoul', Vietnam:'Hanoi', Indonesia:'Jakarta',
  Pakistan:'Islamabad', 'New Zealand':'Wellington', Kenya:'Nairobi',
  'South Africa':'Pretoria', Nigeria:'Abuja', Chile:'Santiago',
  Colombia:'Bogota', Peru:'Lima',
};
const COUNTRIES = Object.keys(CAPITALS);

const CURRENCY_SYMBOL: Record<string, string> = {
  Norway:'kr', Sweden:'kr', Denmark:'kr', Iceland:'kr',
  France:'€', Germany:'€', Italy:'€', Spain:'€', Portugal:'€',
  Greece:'€', Austria:'€', Belgium:'€', Netherlands:'€', Finland:'€',
  Ireland:'€', Japan:'¥', China:'¥', UK:'£', USA:'$', Canada:'$',
  Australia:'$', Switzerland:'CHF', Poland:'zł', Hungary:'Ft',
  Russia:'₽', India:'₹', Turkey:'₺', Brazil:'R$', Mexico:'$',
  'South Korea':'₩', Vietnam:'₫', Thailand:'฿',
};

const CURRENCY_CODE: Record<string, string> = {
  Norway:'NOK', Sweden:'SEK', Denmark:'DKK', Iceland:'ISK',
  France:'EUR', Germany:'EUR', Italy:'EUR', Spain:'EUR',
  Japan:'JPY', UK:'GBP', USA:'USD', Switzerland:'CHF', Australia:'AUD',
  Canada:'CAD', India:'INR', China:'CNY', Brazil:'BRL', Mexico:'MXN',
  'South Korea':'KRW',
};

const PLANETS = ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune'];
const PLANET_COLOUR: Record<string,string> = {
  Mercury:'gray', Venus:'yellow', Earth:'blue', Mars:'red',
  Jupiter:'orange', Saturn:'gold', Uranus:'blue', Neptune:'blue',
};
const PLANET_MOONS: Record<string,number> = {
  Mercury:0, Venus:0, Earth:1, Mars:2, Jupiter:95, Saturn:146, Uranus:27, Neptune:14,
};

const PEOPLE = [
  { q:'general relativity',     first:'Albert',     last:'Einstein',      year:1915 },
  { q:'the theory of evolution',first:'Charles',    last:'Darwin',        year:1859 },
  { q:'Bitcoin',                first:'Satoshi',    last:'Nakamoto',      year:2008 },
  { q:'Python the programming language', first:'Guido', last:'van Rossum', year:1991 },
  { q:'JavaScript',             first:'Brendan',    last:'Eich',          year:1995 },
  { q:'Linux',                  first:'Linus',      last:'Torvalds',      year:1991 },
  { q:'Romeo and Juliet',       first:'William',    last:'Shakespeare' },
  { q:'1984 the novel',         first:'George',     last:'Orwell',        year:1949 },
  { q:'the Mona Lisa',          first:'Leonardo',   last:'da Vinci' },
  { q:'the telephone',          first:'Alexander',  last:'Bell',          year:1876 },
  { q:'the light bulb',         first:'Thomas',     last:'Edison',        year:1879 },
  { q:'the theory of gravity',  first:'Isaac',      last:'Newton',        year:1687 },
  { q:'the periodic table',     first:'Dmitri',     last:'Mendeleev',     year:1869 },
  { q:'penicillin',             first:'Alexander',  last:'Fleming',       year:1928 },
  { q:'the polio vaccine',      first:'Jonas',      last:'Salk',          year:1955 },
  { q:'the World Wide Web',     first:'Tim',        last:'Berners-Lee',   year:1989 },
  { q:'Star Wars',              first:'George',     last:'Lucas',         year:1977 },
  { q:'the Harry Potter books', first:'J. K.',      last:'Rowling',       year:1997 },
];

const COMPANIES = [
  { q:'the iPhone',        ans:'Apple' },
  { q:'the MacBook',       ans:'Apple' },
  { q:'Windows',           ans:'Microsoft' },
  { q:'Xbox',              ans:'Microsoft' },
  { q:'Android',           ans:'Google' },
  { q:'Gmail',             ans:'Google' },
  { q:'YouTube',           ans:'Google' },
  { q:'the Tesla Model S', ans:'Tesla' },
  { q:'AWS',               ans:'Amazon' },
  { q:'Kindle',            ans:'Amazon' },
  { q:'PlayStation',       ans:'Sony' },
  { q:'Photoshop',         ans:'Adobe' },
  { q:'Premiere Pro',      ans:'Adobe' },
  { q:'Switch the console',ans:'Nintendo' },
  { q:'Galaxy phones',     ans:'Samsung' },
];

const CHEM_SYMBOL: Record<string,string> = {
  gold:'Au', silver:'Ag', iron:'Fe', oxygen:'O', hydrogen:'H',
  carbon:'C', sodium:'Na', chlorine:'Cl', helium:'He', copper:'Cu',
  nitrogen:'N', sulfur:'S', potassium:'K', calcium:'Ca', mercury:'Hg',
  lead:'Pb', tin:'Sn', zinc:'Zn', neon:'Ne', argon:'Ar',
};

const RIVER_COUNTRY: Record<string,string> = {
  Nile:'Egypt', Amazon:'Brazil', Yangtze:'China', Mississippi:'USA',
  Volga:'Russia', Danube:'Germany', Rhine:'Germany', Seine:'France',
  Thames:'UK', Ganges:'India',
};

const MOUNTAIN_COUNTRY: Record<string,string> = {
  Everest:'Nepal', K2:'Pakistan', Kilimanjaro:'Tanzania',
  Fuji:'Japan', Matterhorn:'Switzerland', Denali:'USA',
  Aconcagua:'Argentina', Olympus:'Greece',
};

const OCEAN_LIST = ['Pacific','Atlantic','Indian','Arctic','Southern'];

const LANG_COUNTRY: Record<string,string> = {
  French:'France', German:'Germany', Italian:'Italy', Spanish:'Spain',
  Portuguese:'Portugal', Japanese:'Japan', Mandarin:'China',
  Russian:'Russia', Arabic:'Egypt', Hindi:'India', Norwegian:'Norway',
  Swedish:'Sweden', Danish:'Denmark', Finnish:'Finland',
};

const FAMOUS_PAINTING: Record<string,string> = {
  'the Mona Lisa':'Leonardo da Vinci',
  'the Starry Night':'Vincent van Gogh',
  'the Scream':'Edvard Munch',
  'the Last Supper':'Leonardo da Vinci',
  'Guernica':'Pablo Picasso',
  'Girl with a Pearl Earring':'Johannes Vermeer',
};

const COMPOSERS: Record<string,string> = {
  'the Ninth Symphony':'Beethoven',
  'the Four Seasons':'Vivaldi',
  'The Magic Flute':'Mozart',
  'Swan Lake':'Tchaikovsky',
  'the Brandenburg Concertos':'Bach',
};

const PROG_LANG_CREATOR: Record<string,string> = {
  Python:'Guido van Rossum', JavaScript:'Brendan Eich', Ruby:'Matsumoto',
  C:'Ritchie', 'C++':'Stroustrup', Go:'Pike', Rust:'Hoare',
  Java:'Gosling', PHP:'Lerdorf', Swift:'Lattner',
};

const ANIMAL_GROUP: Record<string,string> = {
  lions:'pride', wolves:'pack', fish:'school', sheep:'flock',
  crows:'murder', geese:'gaggle', ants:'colony', bees:'swarm',
  whales:'pod', dolphins:'pod',
};

const ANIMAL_SOUND: Record<string,string> = {
  dog:'bark', cat:'meow', cow:'moo', sheep:'baa',
  duck:'quack', frog:'croak', horse:'neigh', pig:'oink',
  lion:'roar', owl:'hoot',
};

const SPEED_OF_LIGHT_KMS = 299792;
const PI_DIGITS = '3.14159';
const E_DIGITS = '2.71828';

const KINGS: Record<string,string> = {
  Norway:'Harald', Sweden:'Carl', Denmark:'Frederik', UK:'Charles', Netherlands:'Willem',
};

const HOLIDAY_MONTH: Record<string,string> = {
  Christmas:'December', Halloween:'October', Easter:'(March|April)',
  'Valentine\'s Day':'February', 'New Year':'January',
  Thanksgiving:'November', 'Independence Day in the US':'July',
};

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ───────────────────────────────────────────────────────────────────────
// Style transforms
// ───────────────────────────────────────────────────────────────────────
function asPolite(q: string) { return `Hi! Could you please ${q.replace(/\?$/,'').replace(/^./, c => c.toLowerCase())}? Thanks!`; }
function asSlang(q: string)  { return `yo so ${q.replace(/\?$/,'').replace(/^./, c => c.toLowerCase())} lol`; }
function asCaps(q: string)   { return q.toUpperCase(); }
function asTypo(q: string)   {
  // simple typo: swap two random middle letters of the first long word
  return q.replace(/\b([A-Za-z]{6,})\b/, (m) => {
    if (m.length < 6) return m;
    const i = 2, j = 3;
    const arr = m.split('');
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return arr.join('');
  });
}

// ───────────────────────────────────────────────────────────────────────
const C: Case[] = [];
let _seq = 0;
const nextId = (tag: string) => `${tag}-${(_seq++).toString(36)}`;

function add(c: Omit<Case,'id'>) { C.push({ ...c, id: nextId(c.category.toUpperCase().replace(/-/g,'')) }); }

// Phrasing matrix per fact (style × shape)
function capPhrasings(country: string): Array<{style:string;text:string}> {
  return [
    { style:'plain',  text:`What is the capital of ${country}?` },
    { style:'plain',  text:`Capital of ${country}?` },
    { style:'plain',  text:`Tell me the capital of ${country}.` },
    { style:'plain',  text:`${country}'s capital?` },
    { style:'polite', text:asPolite(`tell me the capital of ${country}?`) },
    { style:'slang',  text:asSlang(`whats the capital of ${country}`) },
    { style:'caps',   text:asCaps(`capital of ${country}?`) },
    { style:'typo',   text:asTypo(`What is the capital of ${country}?`) },
  ];
}

function symPhrasings(country: string): Array<{style:string;text:string}> {
  return [
    { style:'plain',  text:`What is the currency symbol of ${country}?` },
    { style:'plain',  text:`Currency symbol of ${country}?` },
    { style:'terse',  text:`Currency symbol of ${country}. Just the symbol character.` },
    { style:'terse',  text:`Only the currency symbol of ${country}.` },
    { style:'polite', text:asPolite(`give me the currency symbol of ${country}`) },
  ];
}

// ── Capitals (40 countries × 8 styles = 320) ──────────────────────────
for (const country of COUNTRIES) {
  const cap = CAPITALS[country];
  for (const p of capPhrasings(country)) {
    add({ category:'capital', template:'capital.one-shot', style:p.style,
      turns:[p.text], pass:[rx(cap)] });
  }
}
// ── Terse capital ─────────────────────────────────────────────────────
for (const country of COUNTRIES) {
  const cap = CAPITALS[country];
  for (const t of [
    `Capital of ${country}, one word.`,
    `Capital of ${country}. Just the name.`,
    `Only the capital city of ${country}.`,
    `${country} capital. Single word.`,
  ]) add({ category:'capital-terse', template:'capital.terse', style:'terse',
      turns:[t], pass:[rx(cap)], terse:60 });
}

// ── Currency symbol (32 × 5 = 160) ────────────────────────────────────
for (const country of Object.keys(CURRENCY_SYMBOL)) {
  const sym = CURRENCY_SYMBOL[country];
  for (const p of symPhrasings(country)) {
    const terse = p.style === 'terse' ? 30 : undefined;
    const mustNot = p.style === 'terse' ? [new RegExp(`\\b${country}\\b`,'i')] : undefined;
    add({ category: p.style === 'terse' ? 'currency-symbol-terse' : 'currency-symbol',
      template: p.style === 'terse' ? 'symbol.terse' : 'symbol.one-shot', style:p.style,
      turns:[p.text], pass:[sym], terse, mustNot });
  }
}

// ── Currency codes ────────────────────────────────────────────────────
for (const country of Object.keys(CURRENCY_CODE)) {
  const code = CURRENCY_CODE[country];
  for (const t of [
    `What is the ISO currency code of ${country}?`,
    `Currency code of ${country}?`,
    `ISO code for ${country}'s currency.`,
  ]) add({ category:'currency-code', template:'code.one-shot', style:'plain',
      turns:[t], pass:[new RegExp(`\\b${code}\\b`)] });
}

// ── Kings ─────────────────────────────────────────────────────────────
for (const country of Object.keys(KINGS)) {
  for (const t of [
    `Who is the king of ${country}?`,
    `Name the current king of ${country}.`,
    `Who is the reigning monarch of ${country}?`,
    asPolite(`tell me the current king of ${country}`),
  ]) add({ category:'monarch', template:'king.one-shot', style:'plain',
      turns:[t], pass:[new RegExp(`\\b${KINGS[country]}\\b`)] });
}

// ── Planets ───────────────────────────────────────────────────────────
for (const p of PLANETS) {
  for (const t of [
    `What colour is ${p}?`,
    `${p} is what colour?`,
    `Tell me the dominant colour of ${p}.`,
  ]) add({ category:'planet-colour', template:'planet.colour', style:'plain',
      turns:[t], pass:[new RegExp(`\\b${PLANET_COLOUR[p]}\\b`,'i')] });
  for (const t of [
    `How many moons does ${p} have?`,
    `Number of moons of ${p}?`,
    `${p} moon count?`,
  ]) add({ category:'planet-moons', template:'planet.moons', style:'plain',
      turns:[t], pass:[new RegExp(`\\b${PLANET_MOONS[p]}\\b`)] });
}
add({ category:'planet-fact', template:'planet.largest', style:'plain',
  turns:[`What is the largest planet?`], pass:[/\bJupiter\b/] });
add({ category:'planet-fact', template:'planet.closest', style:'plain',
  turns:[`Which planet is closest to the Sun?`], pass:[/\bMercury\b/] });

// ── People (18 × 4 = 72) ──────────────────────────────────────────────
for (const p of PEOPLE) {
  add({ category:'person-full', template:'person.full', style:'plain',
    turns:[`Who is associated with ${p.q}?`], pass:[rx(p.last)] });
  add({ category:'person-last-terse', template:'person.last.terse', style:'terse',
    turns:[`Who came up with ${p.q}? Last name only.`], pass:[rx(p.last)], terse:40 });
  add({ category:'person-first-terse', template:'person.first.terse', style:'terse',
    turns:[`What was the first name of the person behind ${p.q}? One word only.`],
    pass:[rx(p.first)], terse:30 });
  if (p.year !== undefined) {
    add({ category:'person-year', template:'person.year', style:'terse',
      turns:[`In what year was ${p.q} introduced or published? Year only.`],
      pass:[new RegExp(`\\b${p.year}\\b`)], terse:30 });
  }
}

// ── Companies ─────────────────────────────────────────────────────────
for (const c of COMPANIES) {
  for (const t of [
    `Which company makes ${c.q}?`,
    `Who makes ${c.q}?`,
    `Manufacturer of ${c.q}?`,
  ]) add({ category:'company', template:'company.one-shot', style:'plain',
      turns:[t], pass:[new RegExp(`\\b${escapeForRegex(c.ans)}\\b`,'i')] });
}

// ── Arithmetic — much bigger (a,b in 2..15, +,-,*,/, 4 templates = ~780)
for (let a = 2; a <= 15; a++) for (let b = 2; b <= 15; b++) {
  add({ category:'arithmetic', template:'arith.add', style:'plain',
    turns:[`What is ${a}+${b}?`], pass:[new RegExp(`(^|\\D)${a+b}(\\D|$)`)], terse:80 });
  add({ category:'arithmetic', template:'arith.sub', style:'plain',
    turns:[`What is ${a+b} minus ${b}?`], pass:[new RegExp(`(^|\\D)${a}(\\D|$)`)], terse:80 });
  add({ category:'arithmetic', template:'arith.mul', style:'plain',
    turns:[`What is ${a}*${b}?`], pass:[new RegExp(`(^|\\D)${a*b}(\\D|$)`)], terse:80 });
  add({ category:'arithmetic', template:'arith.div', style:'plain',
    turns:[`What is ${a*b} divided by ${b}?`], pass:[new RegExp(`(^|\\D)${a}(\\D|$)`)], terse:80 });
}

// ── Unit math ─────────────────────────────────────────────────────────
const UNIT_MATH: Array<{q:string; ans:number}> = [
  { q:'days in a leap year', ans:366 }, { q:'days in a regular year', ans:365 },
  { q:'hours in a day', ans:24 }, { q:'minutes in an hour', ans:60 },
  { q:'seconds in a minute', ans:60 }, { q:'hours in three days', ans:72 },
  { q:'minutes in two hours', ans:120 }, { q:'days in a fortnight', ans:14 },
  { q:'weeks in a year', ans:52 }, { q:'months in five years', ans:60 },
  { q:'sides in a hexagon', ans:6 }, { q:'sides in an octagon', ans:8 },
  { q:'players on a soccer team', ans:11 }, { q:'cards in a standard deck', ans:52 },
  { q:'feet in a yard', ans:3 }, { q:'inches in a foot', ans:12 },
];
for (const u of UNIT_MATH) {
  add({ category:'unit-math', template:'unit.basic', style:'plain',
    turns:[`How many ${u.q}?`], pass:[new RegExp(`\\b${u.ans}\\b`)], terse:80 });
}

// ── Chemistry symbols ─────────────────────────────────────────────────
for (const el of Object.keys(CHEM_SYMBOL)) {
  for (const t of [
    `What is the chemical symbol for ${el}?`,
    `Chemical symbol of ${el}?`,
    `Element symbol: ${el}.`,
  ]) add({ category:'chem-symbol', template:'chem.symbol', style:'plain',
      turns:[t], pass:[new RegExp(`\\b${CHEM_SYMBOL[el]}\\b`)] });
}

// ── Geography: rivers / mountains / oceans / language ─────────────────
for (const r of Object.keys(RIVER_COUNTRY)) {
  add({ category:'river-country', template:'river.country', style:'plain',
    turns:[`In which country is the ${r} river primarily located?`],
    pass:[rx(RIVER_COUNTRY[r])] });
}
for (const m of Object.keys(MOUNTAIN_COUNTRY)) {
  add({ category:'mountain-country', template:'mountain.country', style:'plain',
    turns:[`In which country is Mount ${m} located?`],
    pass:[rx(MOUNTAIN_COUNTRY[m])] });
}
for (const o of OCEAN_LIST) {
  add({ category:'ocean', template:'ocean.exists', style:'plain',
    turns:[`Is the ${o} an ocean?`], pass:[/\byes|indeed|correct|that['']s right\b/i] });
}
for (const lang of Object.keys(LANG_COUNTRY)) {
  add({ category:'language-country', template:'language.country', style:'plain',
    turns:[`In which country is ${lang} primarily spoken?`],
    pass:[rx(LANG_COUNTRY[lang])] });
}

// ── Arts / culture ────────────────────────────────────────────────────
for (const p of Object.keys(FAMOUS_PAINTING)) {
  add({ category:'painting-artist', template:'painting.artist', style:'plain',
    turns:[`Who painted ${p}?`], pass:[rx(FAMOUS_PAINTING[p].split(' ').slice(-1)[0])] });
}
for (const work of Object.keys(COMPOSERS)) {
  add({ category:'composer', template:'composer.work', style:'plain',
    turns:[`Who composed ${work}?`], pass:[rx(COMPOSERS[work])] });
}

// ── Programming creators ──────────────────────────────────────────────
for (const lang of Object.keys(PROG_LANG_CREATOR)) {
  add({ category:'prog-creator', template:'prog.creator', style:'plain',
    turns:[`Who created the ${lang} programming language?`],
    pass:[rx(PROG_LANG_CREATOR[lang])] });
}

// ── Animals ───────────────────────────────────────────────────────────
for (const a of Object.keys(ANIMAL_GROUP)) {
  add({ category:'animal-group', template:'animal.group', style:'plain',
    turns:[`What do you call a group of ${a}?`], pass:[rx(ANIMAL_GROUP[a])] });
}
for (const a of Object.keys(ANIMAL_SOUND)) {
  add({ category:'animal-sound', template:'animal.sound', style:'plain',
    turns:[`What sound does a ${a} make?`], pass:[rx(ANIMAL_SOUND[a])] });
}

// ── Constants ─────────────────────────────────────────────────────────
add({ category:'constant', template:'const.pi', style:'plain',
  turns:[`What are the first few digits of pi?`], pass:[new RegExp(escapeForRegex(PI_DIGITS))] });
add({ category:'constant', template:'const.e', style:'plain',
  turns:[`What are the first few digits of Euler's number e?`], pass:[new RegExp(escapeForRegex(E_DIGITS))] });
add({ category:'constant', template:'const.c', style:'plain',
  turns:[`What is the approximate speed of light in kilometres per second?`],
  pass:[/299[, ]?792|300[, ]?000/] });

// ── Holidays ──────────────────────────────────────────────────────────
for (const h of Object.keys(HOLIDAY_MONTH)) {
  add({ category:'holiday-month', template:'holiday.month', style:'plain',
    turns:[`In which month is ${h}?`], pass:[new RegExp(`\\b${HOLIDAY_MONTH[h]}\\b`,'i')] });
}

// ── Lists ─────────────────────────────────────────────────────────────
const CONTINENTS = ['Africa','Antarctica','Asia','Australia','Europe','North America','South America'];
const NORDIC = ['Denmark','Finland','Iceland','Norway','Sweden'];
const PRIMARY = ['red','blue','yellow'];
add({ category:'list', template:'list.continents-csv', style:'plain',
  turns:[`List all seven continents, comma-separated, alphabetical order.`],
  pass:[new RegExp(CONTINENTS.join('.+'),'is')] });
add({ category:'list', template:'list.nordic-csv', style:'plain',
  turns:[`List the five Nordic countries, comma-separated, alphabetical order.`],
  pass:[new RegExp(NORDIC.join('.+'),'is')] });
add({ category:'list', template:'list.days-csv', style:'plain',
  turns:[`List the days of the week, comma separated.`],
  pass:[new RegExp(DAYS.join('.+'),'is')] });
add({ category:'list', template:'list.months-csv', style:'plain',
  turns:[`List the months of the year in order.`],
  pass:[new RegExp(MONTHS.join('.+'),'is')] });
add({ category:'list', template:'list.primaries', style:'plain',
  turns:[`List the three primary colours.`],
  pass:[new RegExp(`\\b${PRIMARY[0]}\\b[\\s\\S]*\\b${PRIMARY[1]}\\b[\\s\\S]*\\b${PRIMARY[2]}\\b|\\b${PRIMARY[0]}\\b[\\s\\S]*\\b${PRIMARY[2]}\\b[\\s\\S]*\\b${PRIMARY[1]}\\b`,'i')] });
add({ category:'list', template:'list.oceans', style:'plain',
  turns:[`List the world's oceans, comma separated.`],
  pass:[new RegExp(OCEAN_LIST.join('.+'),'is')] });

// ── Multi-clause (2-part, 3-part, mixed) ──────────────────────────────
for (let i = 0; i < 60; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i + 7) % COUNTRIES.length];
  if (a === b) continue;
  add({ category:'multi-2', template:'multi.capital2', style:'plain',
    turns:[`Capital of ${a} and capital of ${b}?`],
    pass:[new RegExp(`\\b${CAPITALS[a]}\\b[\\s\\S]*\\b${CAPITALS[b]}\\b|\\b${CAPITALS[b]}\\b[\\s\\S]*\\b${CAPITALS[a]}\\b`,'i')] });
}
for (let i = 0; i < 60; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i + 5) % COUNTRIES.length];
  const c = COUNTRIES[(i + 11) % COUNTRIES.length];
  if (a === b || b === c || a === c) continue;
  add({ category:'multi-3', template:'multi.capital3', style:'plain',
    turns:[`Capitals of ${a}, ${b}, and ${c}?`],
    pass:[new RegExp(`(?=[\\s\\S]*\\b${CAPITALS[a]}\\b)(?=[\\s\\S]*\\b${CAPITALS[b]}\\b)(?=[\\s\\S]*\\b${CAPITALS[c]}\\b)`,'i')] });
}
for (const country of COUNTRIES.slice(0, 25)) {
  if (!CURRENCY_SYMBOL[country]) continue;
  add({ category:'multi-mixed', template:'multi.cap+sym', style:'plain',
    turns:[`Capital of ${country} and its currency symbol?`],
    pass:[new RegExp(`(?=[\\s\\S]*\\b${CAPITALS[country]}\\b)(?=[\\s\\S]*${escapeForRegex(CURRENCY_SYMBOL[country])})`,'i')] });
}
// Multi: country + language
for (const lang of Object.keys(LANG_COUNTRY).slice(0, 10)) {
  add({ category:'multi-mixed', template:'multi.lang+cap', style:'plain',
    turns:[`Where is ${lang} spoken and what is the capital of that country?`],
    pass:[new RegExp(`(?=[\\s\\S]*\\b${LANG_COUNTRY[lang]}\\b)(?=[\\s\\S]*\\b${CAPITALS[LANG_COUNTRY[lang]] ?? '___'}\\b)`,'i')] });
}

// ── Follow-up pronoun ─────────────────────────────────────────────────
for (const country of COUNTRIES.slice(0, 20)) {
  if (!CURRENCY_SYMBOL[country]) continue;
  add({ category:'followup', template:'followup.symbol', style:'plain',
    turns:[`What is the capital of ${country}?`, `And its currency symbol, only the symbol character.`],
    pass:[CURRENCY_SYMBOL[country]], terse:40,
    mustNot:[new RegExp(`\\b${CAPITALS[country]}\\b`,'i')] });
}
for (const country of Object.keys(KINGS)) {
  if (!CURRENCY_SYMBOL[country]) continue;
  add({ category:'followup', template:'followup.king-currency', style:'plain',
    turns:[`Who is the king of ${country}?`, `And the currency symbol of his country?`],
    pass:[CURRENCY_SYMBOL[country]], terse:80 });
}
// follow-up: composer → era
for (const work of Object.keys(COMPOSERS).slice(0, 5)) {
  add({ category:'followup', template:'followup.composer-era', style:'plain',
    turns:[`Who composed ${work}?`, `What era did he live in?`],
    pass:[/\b(baroque|classical|romantic|18th|19th|17th|20th)\b/i] });
}
// follow-up: planet → moons
for (const p of PLANETS) {
  add({ category:'followup', template:'followup.planet-moons', style:'plain',
    turns:[`Tell me about ${p}.`, `How many moons does it have?`],
    pass:[new RegExp(`\\b${PLANET_MOONS[p]}\\b`)], terse:120 });
}

// ── Topic switch ──────────────────────────────────────────────────────
for (let i = 0; i < 30; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i + 13) % COUNTRIES.length];
  if (a === b) continue;
  add({ category:'switch', template:'switch.country', style:'plain',
    turns:[`Capital of ${a}?`, `Forget that. Capital of ${b}?`],
    pass:[new RegExp(`\\b${CAPITALS[b]}\\b`,'i')],
    mustNot:[new RegExp(`^[^\\n]*\\b${CAPITALS[a]}\\b[^\\n]*$`)] });
}

// ── Negation / exclusion ──────────────────────────────────────────────
const EU_CAPITALS = ['Paris','Berlin','Madrid','Rome','Lisbon','Oslo','Stockholm','Helsinki','Athens','Vienna','Warsaw','Dublin','Amsterdam','Brussels','Copenhagen','Bern','Budapest','Reykjavik'];
for (let i = 0; i < 40; i++) {
  const exclude = EU_CAPITALS[i % EU_CAPITALS.length];
  const others = EU_CAPITALS.filter(x => x !== exclude);
  add({ category:'negation', template:'negation.capital', style:'plain',
    turns:[`A European capital that is not ${exclude}. One name only.`],
    pass:[new RegExp(`\\b(${others.join('|')})\\b`)],
    mustNot:[new RegExp(`^\\s*\\*?\\*?${exclude}\\b`,'i')], terse:60 });
}
const EU_COUNTRIES = ['France','Germany','Italy','Spain','Portugal','Norway','Sweden','Denmark','Finland','Iceland','Greece','Poland','Austria','Belgium','Netherlands','Ireland','Switzerland'];
for (let i = 0; i < 30; i++) {
  const a = EU_COUNTRIES[i % EU_COUNTRIES.length];
  const b = EU_COUNTRIES[(i + 4) % EU_COUNTRIES.length];
  if (a === b) continue;
  const others = EU_COUNTRIES.filter(x => x !== a && x !== b);
  add({ category:'negation-2', template:'negation.country2', style:'plain',
    turns:[`Name a European country that is NOT ${a} or ${b}.`],
    pass:[new RegExp(`\\b(${others.join('|')})\\b`)],
    mustNot:[new RegExp(`^\\s*\\*?\\*?(${a}|${b})\\b`,'i')] });
}

// ── Recovery ──────────────────────────────────────────────────────────
for (const p of PEOPLE.slice(0, 10)) {
  add({ category:'recovery', template:'recovery.after-encyclo', style:'plain',
    turns:[`Tell me about ${p.q}.`, `Only the name of the person, one line.`],
    pass:[rx(p.last)], terse:80 });
}
for (const country of Object.keys(CURRENCY_SYMBOL).slice(0, 12)) {
  add({ category:'recovery', template:'recovery.after-cap', style:'plain',
    turns:[`Tell me the capital of ${country} and its currency symbol.`, `You missed the symbol. Just the symbol character please.`],
    pass:[CURRENCY_SYMBOL[country]], terse:30 });
}

// ── Casual ────────────────────────────────────────────────────────────
const CASUAL: Array<[string, RegExp]> = [
  ['Hi!', /\b(hi|hello|hey)\b/i],
  ['Hello there.', /\b(hi|hello|hey|there)\b/i],
  ['Good morning.', /\b(morning|hi|hello|hey|good)\b/i],
  ['Good evening.', /\b(evening|hi|hello|hey|good)\b/i],
  ['How are you?', /\b(good|fine|well|great|here|doing|operational)\b/i],
  ['Thanks!', /\b(welcome|anytime|sure|glad|happy|pleasure)\b/i],
  ['Thank you so much.', /\b(welcome|anytime|sure|glad|happy|pleasure)\b/i],
  ['What\'s up?', /\b(here|hello|hi|hey|not much|nothing)\b/i],
  ['cheers', /\b(cheers|welcome|sure|anytime)\b/i],
  ['ok cool', /\b(ok|cool|sure|alright|got it)\b/i],
];
for (const [t, r] of CASUAL) {
  add({ category:'casual', template:'casual', style:'casual',
    turns:[t], pass:[r], terse:300,
    mustNot:[/knowledge yet|don['']t have a confident answer|build me a Next\.js/i] });
}

// ── Refusal-appropriate ───────────────────────────────────────────────
const REFUSALS = [
  'Who won the local pickleball tournament in Drammen last Saturday?',
  'What\'s the population of Sandnes?',
  'Who is my next-door neighbour?',
  'How many goals did the local under-12 team score yesterday?',
  'What did the mayor of Bergen eat for breakfast?',
  'What is my mother\'s middle name?',
  'How many cars are in my driveway right now?',
];
for (const t of REFUSALS) {
  add({ category:'refusal-ok', template:'refusal', style:'plain',
    turns:[t], pass:[/don['']t|isn['']t|not sure|no\s+confident|unable|don['']t know|knowledge yet/i] });
}

// ═══════════════════════════════════════════════════════════════════════
// SCALE-UP BLOCK — adds new data tables, more permutations, deeper
// multi-clause shapes, noise wrappers, and several new categories
// designed to expose additional failure modes.
// ═══════════════════════════════════════════════════════════════════════

// ── More countries (capital-only, no currency table) ─────────────────
const MORE_CAPITALS: Record<string, string> = {
  Ukraine:'Kyiv', Romania:'Bucharest', Bulgaria:'Sofia', Serbia:'Belgrade',
  Croatia:'Zagreb', Slovenia:'Ljubljana', Slovakia:'Bratislava',
  Czechia:'Prague', Estonia:'Tallinn', Latvia:'Riga', Lithuania:'Vilnius',
  Belarus:'Minsk', Moldova:'Chisinau', Albania:'Tirana', Luxembourg:'Luxembourg',
  Malta:'Valletta', Cyprus:'Nicosia', Iran:'Tehran', Iraq:'Baghdad',
  'Saudi Arabia':'Riyadh', 'United Arab Emirates':'Abu Dhabi',
  Israel:'Jerusalem', Jordan:'Amman', Lebanon:'Beirut', Syria:'Damascus',
  Afghanistan:'Kabul', Bangladesh:'Dhaka', 'Sri Lanka':'Colombo',
  Nepal:'Kathmandu', Myanmar:'Naypyidaw', Cambodia:'Phnom Penh',
  Malaysia:'Kuala Lumpur', Singapore:'Singapore', Philippines:'Manila',
  Mongolia:'Ulaanbaatar', Kazakhstan:'Astana', Uzbekistan:'Tashkent',
  Ethiopia:'Addis Ababa', Ghana:'Accra', Morocco:'Rabat', Algeria:'Algiers',
  Tunisia:'Tunis', Libya:'Tripoli', Sudan:'Khartoum', Tanzania:'Dodoma',
  Uganda:'Kampala', Zimbabwe:'Harare', Zambia:'Lusaka',
  Venezuela:'Caracas', Ecuador:'Quito', Bolivia:'La Paz', Uruguay:'Montevideo',
  Paraguay:'Asuncion', Cuba:'Havana', Jamaica:'Kingston', Panama:'Panama City',
  'Costa Rica':'San Jose', Guatemala:'Guatemala City',
};
const MORE_COUNTRIES = Object.keys(MORE_CAPITALS);
for (const country of MORE_COUNTRIES) {
  const cap = MORE_CAPITALS[country];
  for (const t of [
    `What is the capital of ${country}?`,
    `Capital of ${country}?`,
    `${country}'s capital, one word.`,
    asPolite(`tell me the capital of ${country}?`),
  ]) add({ category:'capital-more', template:'capital.more', style:'plain',
      turns:[t], pass:[rx(cap)] });
}

// ── Noise-wrapped capital prompts (existing 40 countries × 5 wrappers) ─
const NOISE_WRAPPERS: Array<(q: string) => string> = [
  (q) => `hmm wait actually, ${q.toLowerCase()}`,
  (q) => `sorry to bother — quick one: ${q.toLowerCase()}`,
  (q) => `random q, ${q.toLowerCase().replace(/\?$/, '')} plz`,
  (q) => `btw ${q.toLowerCase()} thanks`,
  (q) => `ok so um ${q.toLowerCase()} if you know`,
];
for (const country of COUNTRIES.slice(0, 25)) {
  const cap = CAPITALS[country];
  for (const wrap of NOISE_WRAPPERS) {
    add({ category:'capital-noise', template:'capital.noise', style:'noise',
      turns:[wrap(`Capital of ${country}?`)], pass:[rx(cap)] });
  }
}

// ── Element from symbol (reverse lookup) ─────────────────────────────
const SYMBOL_ELEMENT: Record<string,string> = Object.fromEntries(
  Object.entries(CHEM_SYMBOL).map(([el, sym]) => [sym, el]),
);
for (const sym of Object.keys(SYMBOL_ELEMENT)) {
  for (const t of [
    `What element has the symbol ${sym}?`,
    `Which element is ${sym}?`,
    `Symbol ${sym} — what element?`,
  ]) add({ category:'element-from-symbol', template:'element.from.symbol', style:'plain',
      turns:[t], pass:[rx(SYMBOL_ELEMENT[sym])] });
}

// ── Animal babies ────────────────────────────────────────────────────
const ANIMAL_BABY: Record<string,string> = {
  dog:'puppy', cat:'kitten', cow:'calf', horse:'foal', sheep:'lamb',
  pig:'piglet', lion:'cub', bear:'cub', duck:'duckling', frog:'tadpole',
  goat:'kid', deer:'fawn',
};
for (const a of Object.keys(ANIMAL_BABY)) {
  for (const t of [
    `What is a baby ${a} called?`,
    `What do you call a young ${a}?`,
  ]) add({ category:'animal-baby', template:'animal.baby', style:'plain',
      turns:[t], pass:[rx(ANIMAL_BABY[a])] });
}

// ── More animal sounds ───────────────────────────────────────────────
const MORE_ANIMAL_SOUND: Record<string,string> = {
  rooster:'crow', goat:'bleat', donkey:'bray', bee:'buzz',
  snake:'hiss', mouse:'squeak', elephant:'trumpet', wolf:'howl',
};
for (const a of Object.keys(MORE_ANIMAL_SOUND)) {
  for (const t of [
    `What sound does a ${a} make?`,
    `Sound of a ${a}?`,
  ]) add({ category:'animal-sound', template:'animal.sound.more', style:'plain',
      turns:[t], pass:[rx(MORE_ANIMAL_SOUND[a])] });
}

// ── Country → language ───────────────────────────────────────────────
const COUNTRY_LANG: Record<string,string> = {
  France:'French', Germany:'German', Italy:'Italian', Spain:'Spanish',
  Portugal:'Portuguese', Japan:'Japanese', China:'Mandarin', Russia:'Russian',
  Norway:'Norwegian', Sweden:'Swedish', Denmark:'Danish', Finland:'Finnish',
  Netherlands:'Dutch', Greece:'Greek', Turkey:'Turkish', Poland:'Polish',
  Hungary:'Hungarian', Brazil:'Portuguese', Mexico:'Spanish', Egypt:'Arabic',
  India:'Hindi', Vietnam:'Vietnamese', Thailand:'Thai', Indonesia:'Indonesian',
};
for (const country of Object.keys(COUNTRY_LANG)) {
  for (const t of [
    `What is the primary language spoken in ${country}?`,
    `Main language of ${country}?`,
    `What language do people speak in ${country}?`,
  ]) add({ category:'country-language', template:'country.language', style:'plain',
      turns:[t], pass:[rx(COUNTRY_LANG[country])] });
}

// ── State / province capitals ────────────────────────────────────────
const STATE_CAPITAL: Record<string,string> = {
  Texas:'Austin', California:'Sacramento', Florida:'Tallahassee',
  'New York':'Albany', Illinois:'Springfield', Ohio:'Columbus',
  Georgia:'Atlanta', Pennsylvania:'Harrisburg', Michigan:'Lansing',
  Washington:'Olympia', Massachusetts:'Boston', Virginia:'Richmond',
  Colorado:'Denver', Arizona:'Phoenix', Oregon:'Salem',
  Ontario:'Toronto', Quebec:'Quebec City', 'British Columbia':'Victoria',
  Alberta:'Edmonton', Manitoba:'Winnipeg',
};
for (const state of Object.keys(STATE_CAPITAL)) {
  for (const t of [
    `What is the capital of ${state}?`,
    `Capital of ${state}?`,
    `${state}'s state capital, one word.`,
  ]) add({ category:'state-capital', template:'state.capital', style:'plain',
      turns:[t], pass:[rx(STATE_CAPITAL[state])] });
}

// ── More composers ───────────────────────────────────────────────────
const MORE_COMPOSERS: Record<string,string> = {
  'Eine kleine Nachtmusik':'Mozart',
  'the Moonlight Sonata':'Beethoven',
  'the Nutcracker':'Tchaikovsky',
  'Carmen':'Bizet',
  'Madame Butterfly':'Puccini',
  'the Ride of the Valkyries':'Wagner',
  'the Pictures at an Exhibition':'Mussorgsky',
  'Bolero':'Ravel',
  'Clair de Lune':'Debussy',
  'the Goldberg Variations':'Bach',
  'the Air on the G String':'Bach',
  'the Rite of Spring':'Stravinsky',
  'Peer Gynt':'Grieg',
};
for (const work of Object.keys(MORE_COMPOSERS)) {
  add({ category:'composer', template:'composer.work.more', style:'plain',
    turns:[`Who composed ${work}?`], pass:[rx(MORE_COMPOSERS[work])] });
}

// ── More paintings ───────────────────────────────────────────────────
const MORE_PAINTINGS: Record<string,string> = {
  'the Persistence of Memory':'Salvador Dali',
  'American Gothic':'Grant Wood',
  'the Birth of Venus':'Sandro Botticelli',
  'the Night Watch':'Rembrandt',
  'the Garden of Earthly Delights':'Hieronymus Bosch',
  'Las Meninas':'Diego Velazquez',
  'the Creation of Adam':'Michelangelo',
  'A Sunday on La Grande Jatte':'Georges Seurat',
  'Water Lilies':'Claude Monet',
  'Composition VII':'Wassily Kandinsky',
};
for (const p of Object.keys(MORE_PAINTINGS)) {
  add({ category:'painting-artist', template:'painting.artist.more', style:'plain',
    turns:[`Who painted ${p}?`], pass:[rx(MORE_PAINTINGS[p].split(' ').slice(-1)[0])] });
}

// ── More programming languages ──────────────────────────────────────
const MORE_PROG_LANG: Record<string,string> = {
  Lua:'Roberto', Erlang:'Armstrong', Haskell:'Hudak', Scala:'Odersky',
  Kotlin:'Breslav', TypeScript:'Hejlsberg', Lisp:'McCarthy',
  Pascal:'Wirth', Smalltalk:'Kay', Perl:'Wall', SQL:'Chamberlin',
};
for (const lang of Object.keys(MORE_PROG_LANG)) {
  add({ category:'prog-creator', template:'prog.creator.more', style:'plain',
    turns:[`Who created the ${lang} programming language?`],
    pass:[rx(MORE_PROG_LANG[lang])] });
}

// ── More chemistry symbols ───────────────────────────────────────────
const MORE_CHEM: Record<string,string> = {
  aluminum:'Al', aluminium:'Al', magnesium:'Mg', phosphorus:'P',
  silicon:'Si', titanium:'Ti', chromium:'Cr', manganese:'Mn',
  nickel:'Ni', uranium:'U', plutonium:'Pu', platinum:'Pt',
  bromine:'Br', iodine:'I', fluorine:'F', radium:'Ra',
};
for (const el of Object.keys(MORE_CHEM)) {
  for (const t of [
    `What is the chemical symbol for ${el}?`,
    `Chemical symbol of ${el}?`,
  ]) add({ category:'chem-symbol', template:'chem.symbol.more', style:'plain',
      turns:[t], pass:[new RegExp(`\\b${MORE_CHEM[el]}\\b`)] });
}

// ── More rivers and mountains ────────────────────────────────────────
const MORE_RIVERS: Record<string,string> = {
  Tigris:'Iraq', Euphrates:'Iraq', Mekong:'Vietnam', Indus:'Pakistan',
  Niger:'Nigeria', Congo:'Congo', Zambezi:'Zambia', Murray:'Australia',
  Po:'Italy', Tagus:'Portugal', Rhone:'France', Ebro:'Spain',
};
for (const r of Object.keys(MORE_RIVERS)) {
  add({ category:'river-country', template:'river.country.more', style:'plain',
    turns:[`In which country is the ${r} river primarily located?`],
    pass:[rx(MORE_RIVERS[r])] });
}
const MORE_MOUNTAINS: Record<string,string> = {
  Elbrus:'Russia', 'Mont Blanc':'France', Vinson:'Antarctica',
  'Cotopaxi':'Ecuador', Etna:'Italy', Vesuvius:'Italy',
  Kosciuszko:'Australia', Logan:'Canada',
};
for (const m of Object.keys(MORE_MOUNTAINS)) {
  add({ category:'mountain-country', template:'mountain.country.more', style:'plain',
    turns:[`In which country is Mount ${m} located?`],
    pass:[rx(MORE_MOUNTAINS[m])] });
}

// ── Bigger multi-2 / multi-3 / multi-4 / multi-5 ─────────────────────
for (let i = 0; i < 150; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i * 3 + 5) % COUNTRIES.length];
  if (a === b) continue;
  add({ category:'multi-2', template:'multi.capital2.more', style:'plain',
    turns:[`Capital of ${a} and capital of ${b}?`],
    pass:[new RegExp(`\\b${CAPITALS[a]}\\b[\\s\\S]*\\b${CAPITALS[b]}\\b|\\b${CAPITALS[b]}\\b[\\s\\S]*\\b${CAPITALS[a]}\\b`,'i')] });
}
for (let i = 0; i < 200; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i * 7 + 3) % COUNTRIES.length];
  const c = COUNTRIES[(i * 11 + 17) % COUNTRIES.length];
  if (a === b || b === c || a === c) continue;
  add({ category:'multi-3', template:'multi.capital3.more', style:'plain',
    turns:[`Capitals of ${a}, ${b}, and ${c}?`],
    pass:[new RegExp(`(?=[\\s\\S]*\\b${CAPITALS[a]}\\b)(?=[\\s\\S]*\\b${CAPITALS[b]}\\b)(?=[\\s\\S]*\\b${CAPITALS[c]}\\b)`,'i')] });
}
for (let i = 0; i < 120; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i * 5 + 2) % COUNTRIES.length];
  const c = COUNTRIES[(i * 9 + 13) % COUNTRIES.length];
  const d = COUNTRIES[(i * 13 + 19) % COUNTRIES.length];
  if (new Set([a,b,c,d]).size < 4) continue;
  add({ category:'multi-4', template:'multi.capital4', style:'plain',
    turns:[`Capitals of ${a}, ${b}, ${c}, and ${d}?`],
    pass:[new RegExp(`(?=[\\s\\S]*\\b${CAPITALS[a]}\\b)(?=[\\s\\S]*\\b${CAPITALS[b]}\\b)(?=[\\s\\S]*\\b${CAPITALS[c]}\\b)(?=[\\s\\S]*\\b${CAPITALS[d]}\\b)`,'i')] });
}
for (let i = 0; i < 60; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i * 3 + 1) % COUNTRIES.length];
  const c = COUNTRIES[(i * 7 + 11) % COUNTRIES.length];
  const d = COUNTRIES[(i * 11 + 5) % COUNTRIES.length];
  const e = COUNTRIES[(i * 13 + 23) % COUNTRIES.length];
  if (new Set([a,b,c,d,e]).size < 5) continue;
  add({ category:'multi-5', template:'multi.capital5', style:'plain',
    turns:[`Capitals of ${a}, ${b}, ${c}, ${d}, and ${e}?`],
    pass:[new RegExp(`(?=[\\s\\S]*\\b${CAPITALS[a]}\\b)(?=[\\s\\S]*\\b${CAPITALS[b]}\\b)(?=[\\s\\S]*\\b${CAPITALS[c]}\\b)(?=[\\s\\S]*\\b${CAPITALS[d]}\\b)(?=[\\s\\S]*\\b${CAPITALS[e]}\\b)`,'i')] });
}

// ── More multi-mixed (cap+sym+code) ──────────────────────────────────
for (const country of Object.keys(CURRENCY_CODE)) {
  if (!CURRENCY_SYMBOL[country] || !CAPITALS[country]) continue;
  add({ category:'multi-mixed', template:'multi.cap+code', style:'plain',
    turns:[`Capital of ${country} and its ISO currency code?`],
    pass:[new RegExp(`(?=[\\s\\S]*\\b${CAPITALS[country]}\\b)(?=[\\s\\S]*\\b${CURRENCY_CODE[country]}\\b)`,'i')] });
}

// ── Deeper follow-up chains (3 turns) ────────────────────────────────
for (const country of COUNTRIES.slice(0, 15)) {
  if (!CURRENCY_SYMBOL[country]) continue;
  add({ category:'followup-chain', template:'chain.cap-sym-code', style:'plain',
    turns:[
      `What is the capital of ${country}?`,
      `And its currency symbol?`,
      `And the ISO currency code?`,
    ], pass:[CURRENCY_CODE[country] ?? CURRENCY_SYMBOL[country]], terse:80 });
}
for (const country of COUNTRIES.slice(0, 10)) {
  add({ category:'followup-chain', template:'chain.cap-then-language', style:'plain',
    turns:[
      `What is the capital of ${country}?`,
      `And what's the primary language spoken there?`,
    ], pass:[new RegExp(`\\b(${(COUNTRY_LANG[country] ?? '___')})\\b`,'i')], terse:100 });
}

// ── Topic-swap chains with pronoun (4 turns) ────────────────────────
for (let i = 0; i < 20; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i * 4 + 5) % COUNTRIES.length];
  if (a === b) continue;
  add({ category:'switch-chain', template:'switch.chain.cap', style:'plain',
    turns:[
      `Capital of ${a}?`,
      `Now ${b}?`,
      `Wait, I meant ${a} again.`,
    ], pass:[rx(CAPITALS[a])], terse:120 });
}

// ── Bare-topic follow-ups ────────────────────────────────────────────
for (const country of COUNTRIES.slice(0, 20)) {
  add({ category:'bare-topic', template:'bare.topic.cap', style:'plain',
    turns:[`What is the capital of France?`, `${country}?`],
    pass:[rx(CAPITALS[country])], terse:80 });
}

// ── Caps-style versions of multi-2 ──────────────────────────────────
for (let i = 0; i < 40; i++) {
  const a = COUNTRIES[i % COUNTRIES.length];
  const b = COUNTRIES[(i + 9) % COUNTRIES.length];
  if (a === b) continue;
  add({ category:'multi-2', template:'multi.capital2.caps', style:'caps',
    turns:[asCaps(`Capital of ${a} and capital of ${b}?`)],
    pass:[new RegExp(`\\b${CAPITALS[a]}\\b[\\s\\S]*\\b${CAPITALS[b]}\\b|\\b${CAPITALS[b]}\\b[\\s\\S]*\\b${CAPITALS[a]}\\b`,'i')] });
}

// ── Typo-style capital prompts (more aggressive) ─────────────────────
for (const country of COUNTRIES.slice(0, 25)) {
  for (const typo of [
    `caiptal of ${country}?`,
    `capitol of ${country}?`,
    `whats the captial of ${country}`,
    `cpaital of ${country} plz`,
  ]) add({ category:'capital-typo', template:'capital.typo', style:'typo',
      turns:[typo], pass:[rx(CAPITALS[country])] });
}

// ── Negation chained (NOT A, NOT B, NOT C) ───────────────────────────
for (let i = 0; i < 25; i++) {
  const a = EU_COUNTRIES[i % EU_COUNTRIES.length];
  const b = EU_COUNTRIES[(i + 3) % EU_COUNTRIES.length];
  const c = EU_COUNTRIES[(i + 7) % EU_COUNTRIES.length];
  if (new Set([a,b,c]).size < 3) continue;
  const others = EU_COUNTRIES.filter(x => x !== a && x !== b && x !== c);
  add({ category:'negation-3', template:'negation.country3', style:'plain',
    turns:[`Name a European country that is NOT ${a}, ${b}, or ${c}.`],
    pass:[new RegExp(`\\b(${others.join('|')})\\b`)],
    mustNot:[new RegExp(`^\\s*\\*?\\*?(${a}|${b}|${c})\\b`,'i')] });
}

// ── Mixed style: SHOUTING followup ───────────────────────────────────
for (const country of COUNTRIES.slice(0, 15)) {
  if (!CURRENCY_SYMBOL[country]) continue;
  add({ category:'followup', template:'followup.caps', style:'caps',
    turns:[`What is the capital of ${country}?`, asCaps(`AND ITS CURRENCY SYMBOL?`)],
    pass:[CURRENCY_SYMBOL[country]], terse:80 });
}

// ── Animal sound terse ───────────────────────────────────────────────
for (const a of Object.keys(ANIMAL_SOUND)) {
  add({ category:'animal-sound-terse', template:'animal.sound.terse', style:'terse',
    turns:[`Sound of a ${a}, one word.`], pass:[rx(ANIMAL_SOUND[a])], terse:40 });
}

// ── Reverse capital → country ─────────────────────────────────────────
for (const country of COUNTRIES.slice(0, 30)) {
  for (const t of [
    `Which country has ${CAPITALS[country]} as its capital?`,
    `${CAPITALS[country]} is the capital of which country?`,
  ]) add({ category:'reverse-capital', template:'reverse.capital', style:'plain',
      turns:[t], pass:[rx(country)] });
}

// ── Multi-clause with composer/painting (mixed-domain) ───────────────
const COMPOSERS_ALL = { ...COMPOSERS, ...MORE_COMPOSERS };
const PAINTINGS_ALL = { ...FAMOUS_PAINTING, ...MORE_PAINTINGS };
const COMPOSER_KEYS = Object.keys(COMPOSERS_ALL);
const PAINTING_KEYS = Object.keys(PAINTINGS_ALL);
for (let i = 0; i < 30; i++) {
  const w = COMPOSER_KEYS[i % COMPOSER_KEYS.length];
  const p = PAINTING_KEYS[i % PAINTING_KEYS.length];
  add({ category:'multi-mixed', template:'multi.composer+painter', style:'plain',
    turns:[`Who composed ${w} and who painted ${p}?`],
    pass:[new RegExp(`(?=[\\s\\S]*\\b${COMPOSERS_ALL[w]}\\b)(?=[\\s\\S]*\\b${PAINTINGS_ALL[p].split(' ').slice(-1)[0]}\\b)`,'i')] });
}

// ── Arithmetic with words (spelled-out) ──────────────────────────────
const NUM_WORDS = ['two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
for (let i = 0; i < NUM_WORDS.length; i++) for (let j = 0; j < NUM_WORDS.length; j++) {
  const a = i + 2, b = j + 2;
  add({ category:'arithmetic-words', template:'arith.add.words', style:'plain',
    turns:[`What is ${NUM_WORDS[i]} plus ${NUM_WORDS[j]}?`],
    pass:[new RegExp(`(^|\\D)${a+b}(\\D|$)`)], terse:80 });
}

// ── More holidays / month-of trivia ─────────────────────────────────
const MORE_HOLIDAYS: Record<string,string> = {
  'St Patrick\'s Day':'March', 'April Fools':'April',
  'Bastille Day':'July', 'Oktoberfest':'(September|October)',
  'Boxing Day':'December', 'Cinco de Mayo':'May',
};
for (const h of Object.keys(MORE_HOLIDAYS)) {
  add({ category:'holiday-month', template:'holiday.month.more', style:'plain',
    turns:[`In which month is ${h}?`], pass:[new RegExp(`\\b${MORE_HOLIDAYS[h]}\\b`,'i')] });
}

// ── Country → continent ─────────────────────────────────────────────
const COUNTRY_CONT: Record<string,string> = {
  France:'Europe', Germany:'Europe', Japan:'Asia', China:'Asia',
  India:'Asia', Brazil:'South America', Argentina:'South America',
  Egypt:'Africa', Nigeria:'Africa', Australia:'Oceania', Canada:'North America',
  Mexico:'North America', Russia:'Europe', Norway:'Europe', Kenya:'Africa',
  Thailand:'Asia', Vietnam:'Asia', Peru:'South America', Chile:'South America',
};
for (const country of Object.keys(COUNTRY_CONT)) {
  add({ category:'country-continent', template:'country.continent', style:'plain',
    turns:[`On which continent is ${country}?`], pass:[rx(COUNTRY_CONT[country])] });
}

// ── More currency codes ─────────────────────────────────────────────
const MORE_CURRENCY_CODE: Record<string,string> = {
  Norway:'NOK', Sweden:'SEK', Denmark:'DKK', Iceland:'ISK',
  Turkey:'TRY', Russia:'RUB', 'South Korea':'KRW', Thailand:'THB',
  Vietnam:'VND', Indonesia:'IDR', 'New Zealand':'NZD', 'South Africa':'ZAR',
  Argentina:'ARS', Chile:'CLP', Israel:'ILS', 'Saudi Arabia':'SAR',
  'United Arab Emirates':'AED', Egypt:'EGP',
};
for (const country of Object.keys(MORE_CURRENCY_CODE)) {
  for (const t of [
    `ISO currency code of ${country}?`,
    `Currency code for ${country}?`,
  ]) add({ category:'currency-code', template:'code.more', style:'plain',
      turns:[t], pass:[new RegExp(`\\b${MORE_CURRENCY_CODE[country]}\\b`)] });
}

// ── Pronoun coreference: he/she/his/her on people ───────────────────
for (const p of PEOPLE.slice(0, 12)) {
  if (p.year === undefined) continue;
  add({ category:'followup-pronoun', template:'followup.person.year', style:'plain',
    turns:[`Who is associated with ${p.q}?`, `In what year was it introduced?`],
    pass:[new RegExp(`\\b${p.year}\\b`)], terse:80 });
}

// ── List variants ───────────────────────────────────────────────────
add({ category:'list', template:'list.nordic-numbered', style:'plain',
  turns:[`List the five Nordic countries as a numbered list.`],
  pass:[new RegExp(NORDIC.join('.+'),'is')] });
add({ category:'list', template:'list.continents-numbered', style:'plain',
  turns:[`Number the seven continents.`],
  pass:[new RegExp(CONTINENTS.join('.+'),'is')] });
add({ category:'list', template:'list.primaries-bullets', style:'plain',
  turns:[`Give me the three primary colours as bullet points.`],
  pass:[new RegExp(`\\b${PRIMARY[0]}\\b[\\s\\S]*\\b${PRIMARY[1]}\\b[\\s\\S]*\\b${PRIMARY[2]}\\b|\\b${PRIMARY[0]}\\b[\\s\\S]*\\b${PRIMARY[2]}\\b[\\s\\S]*\\b${PRIMARY[1]}\\b`,'i')] });

// ═══════════════════════════════════════════════════════════════════════
// END SCALE-UP BLOCK
// ═══════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────
// Failure classifier
// ───────────────────────────────────────────────────────────────────────
function classifyFailure(c: Case, response: string, terseExceeded: boolean, forbiddenHit: boolean): string[] {
  const tags: string[] = [];
  const r = response.toLowerCase();
  const fallbackLike = /don['']t (have|know)|knowledge yet|isn['']t in my|no confident answer|not sure|build me a next\.js|build a rust|what i can do|what vai can do/i.test(response);
  if (fallbackLike) tags.push('knowledge-gap');
  if (terseExceeded) tags.push('terse-violated');
  if (forbiddenHit) tags.push('forbidden-substring');
  if (/storting|stortinget|nansen|el salvador|legal tender|clear communication is/i.test(r)) tags.push('retrieval-drift');
  if (/\*\*what is .{0,80}\?\*\*/i.test(response)) tags.push('splitter-bug');
  if (!fallbackLike && response.length < 200 && !/\?$/.test(response.trim())) tags.push('confident-wrong-or-incomplete');
  if (/^multi-/.test(c.category) && response.length < 200) tags.push('multi-clause-drop');
  if (c.template.startsWith('list.') && !/\,/.test(response)) tags.push('format-missing-csv');
  if (c.template.startsWith('followup.') && fallbackLike) tags.push('pronoun-broken');
  if (tags.length === 0) tags.push('uncategorized');
  return tags;
}

function check(text: string, pats: Pass[]): boolean {
  return pats.some((p) => (typeof p === 'string' ? text.toLowerCase().includes(p.toLowerCase()) : p.test(text)));
}

// ───────────────────────────────────────────────────────────────────────
async function main() {
  const outJsonl  = path.resolve(process.cwd(), '../../_conv_v4.jsonl');
  const outReport = path.resolve(process.cwd(), '../../_conv_v4.report.md');
  const outReview = path.resolve(process.cwd(), '../../_conv_v4.review.md');
  await fs.writeFile(outJsonl, '', 'utf8');

  console.log(`=== CONV-v4 BENCH (multi-thousand, multi-topic, multi-style) ===`);
  console.log(`  cases=${C.length}`);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled'); }) as typeof fetch;

  type Row = { id:string; category:string; template:string; style:string; pass:boolean; reason:string; tags:string[]; prompt:string; response:string; turns:string[] };
  const rows: Row[] = [];

  let done = 0;
  for (const c of C) {
    const engine = new VaiEngine();
    (engine as unknown as { _nowMs: () => number })._nowMs = () => new Date('2026-05-16T12:00:00Z').getTime();
    const history: Msg[] = [];
    let lastAnswer = '';
    for (const turn of c.turns) {
      history.push({ role:'user', content:turn });
      try {
        const r: any = await (engine as any).chat({ messages: history, noLearn: true });
        lastAnswer = (r?.message?.content ?? r?.content ?? '').toString();
        history.push({ role:'assistant', content:lastAnswer });
      } catch (e: any) {
        lastAnswer = `__ERROR__ ${e?.message ?? e}`;
        history.push({ role:'assistant', content:lastAnswer });
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

    const row: Row = { id:c.id, category:c.category, template:c.template, style:c.style,
      pass, reason, tags, prompt:c.turns[c.turns.length-1], response:lastAnswer, turns:c.turns };
    rows.push(row);
    await fs.appendFile(outJsonl, JSON.stringify(row) + '\n', 'utf8');

    done++;
    if (done % 200 === 0) process.stdout.write(`  [${done}/${C.length}]\n`);
  }

  globalThis.fetch = originalFetch;

  // ── Build report ──
  const total = rows.length;
  const passed = rows.filter(r => r.pass).length;
  const failed = total - passed;

  const tally = (key: (r: Row) => string) => {
    const m = new Map<string,{total:number;pass:number}>();
    for (const r of rows) {
      const k = key(r); const b = m.get(k) ?? {total:0,pass:0};
      b.total++; if (r.pass) b.pass++; m.set(k, b);
    }
    return m;
  };
  const byCat = tally(r => r.category);
  const byTpl = tally(r => r.template);
  const bySty = tally(r => r.style);

  const tagCount = new Map<string,number>();
  for (const r of rows) if (!r.pass) for (const t of r.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);

  const cooc = new Map<string,number>();
  for (const r of rows) if (!r.pass) {
    const ts = [...new Set(r.tags)].sort();
    for (let i = 0; i < ts.length; i++) for (let j = i+1; j < ts.length; j++) {
      const key = `${ts[i]} + ${ts[j]}`;
      cooc.set(key, (cooc.get(key) ?? 0) + 1);
    }
  }

  const lines: string[] = [];
  lines.push(`# Conv-v4 multi-thousand bench`);
  lines.push(``);
  lines.push(`**Total:** ${total}    **Pass:** ${passed} (${((passed/total)*100).toFixed(1)}%)    **Fail:** ${failed}`);
  lines.push(``);
  // Non-arithmetic split
  const arithPass = rows.filter(r => r.category === 'arithmetic' && r.pass).length;
  const arithTotal = rows.filter(r => r.category === 'arithmetic').length;
  const nonArithPass = passed - arithPass;
  const nonArithTotal = total - arithTotal;
  lines.push(`**Arithmetic:** ${arithPass}/${arithTotal} (${((arithPass/arithTotal)*100).toFixed(1)}%)    **Non-arithmetic:** ${nonArithPass}/${nonArithTotal} (${((nonArithPass/nonArithTotal)*100).toFixed(1)}%)`);
  lines.push(``);

  const renderTable = (title: string, m: Map<string,{total:number;pass:number}>) => {
    lines.push(`## ${title}`);
    lines.push(``);
    lines.push(`| Key | Pass | Total | % |`);
    lines.push(`|---|---|---|---|`);
    for (const [k, b] of [...m.entries()].sort((a,b) => (a[1].pass/a[1].total) - (b[1].pass/b[1].total))) {
      lines.push(`| ${k} | ${b.pass} | ${b.total} | ${((b.pass/b.total)*100).toFixed(0)}% |`);
    }
    lines.push(``);
  };
  renderTable('Pass rate by category', byCat);
  renderTable('Pass rate by template', byTpl);
  renderTable('Pass rate by style', bySty);

  lines.push(`## Failure-tag totals (the "network")`);
  lines.push(``);
  lines.push(`| Tag | Count |`);
  lines.push(`|---|---|`);
  for (const [t, n] of [...tagCount.entries()].sort((a,b) => b[1]-a[1])) lines.push(`| ${t} | ${n} |`);
  lines.push(``);
  lines.push(`## Top failure-tag co-occurrences`);
  lines.push(``);
  lines.push(`| Pair | Count |`);
  lines.push(`|---|---|`);
  for (const [k, n] of [...cooc.entries()].sort((a,b) => b[1]-a[1]).slice(0, 30)) lines.push(`| ${k} | ${n} |`);
  lines.push(``);

  // Per-category × tag matrix
  const catTag = new Map<string, Map<string,number>>();
  for (const r of rows) if (!r.pass) {
    const m = catTag.get(r.category) ?? new Map();
    for (const t of r.tags) m.set(t, (m.get(t) ?? 0) + 1);
    catTag.set(r.category, m);
  }
  lines.push(`## Per-category failure-tag breakdown`);
  lines.push(``);
  for (const [cat, m] of [...catTag.entries()].sort()) {
    const entries = [...m.entries()].sort((a,b) => b[1]-a[1]).map(([t,n]) => `${t}=${n}`).join(', ');
    lines.push(`- **${cat}** — ${entries}`);
  }
  lines.push(``);

  await fs.writeFile(outReport, lines.join('\n'), 'utf8');

  // ── Build review samples ──
  // 4 categories of samples for human inspection:
  //   1. Random sample of passes (verify they actually look correct)
  //   2. Random sample of failures across all categories
  //   3. 2 failures per failing category (deep coverage)
  //   4. Confident-wrong-or-incomplete examples (most dangerous)
  const sample = <T,>(arr: T[], n: number, seed: number): T[] => {
    const a = arr.slice(); let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 9301 + 49297) % 233280;
      const j = Math.floor((s / 233280) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  };

  const rev: string[] = [];
  rev.push(`# Conv-v4 real-user review — sampled responses`);
  rev.push(``);
  rev.push(`Total ${total} cases, ${passed} pass, ${failed} fail. Below is a curated sample for human inspection.`);
  rev.push(``);

  const renderRows = (title: string, sampleRows: Row[]) => {
    rev.push(`## ${title} (${sampleRows.length})`);
    rev.push(``);
    for (const r of sampleRows) {
      rev.push(`### \`${r.id}\` — ${r.category} / ${r.template} / ${r.style} — ${r.pass ? '✅ PASS' : '❌ FAIL'} ${r.pass ? '' : `(${r.tags.join('+')})`}`);
      rev.push(``);
      for (let i = 0; i < r.turns.length; i++) {
        rev.push(`**User:** ${r.turns[i]}`);
        rev.push(``);
      }
      rev.push(`**Vai:** ${r.response.replace(/\n/g, '\n> ').slice(0, 1200)}`);
      rev.push(``);
      rev.push(`---`);
      rev.push(``);
    }
  };

  renderRows('Random passes (verify they look correct)',
    sample(rows.filter(r => r.pass && r.category !== 'arithmetic'), 40, 11));
  renderRows('Random failures',
    sample(rows.filter(r => !r.pass), 60, 17));
  renderRows('Confident-wrong-or-incomplete (most dangerous)',
    sample(rows.filter(r => !r.pass && r.tags.includes('confident-wrong-or-incomplete')), 40, 23));
  renderRows('Pronoun-broken follow-ups',
    sample(rows.filter(r => !r.pass && r.tags.includes('pronoun-broken')), 20, 29));
  renderRows('Multi-clause drops',
    sample(rows.filter(r => !r.pass && r.tags.includes('multi-clause-drop')), 20, 31));
  renderRows('Retrieval-drift (off-topic content)',
    sample(rows.filter(r => !r.pass && r.tags.includes('retrieval-drift')), 20, 37));

  // 2 failures per failing category
  const perCatFails: Row[] = [];
  const catsWithFail = new Set(rows.filter(r => !r.pass).map(r => r.category));
  for (const cat of [...catsWithFail].sort()) {
    perCatFails.push(...sample(rows.filter(r => !r.pass && r.category === cat), 2, 41));
  }
  renderRows('Two failures per failing category', perCatFails);

  await fs.writeFile(outReview, rev.join('\n'), 'utf8');

  console.log(`\nTotal=${total} Pass=${passed} (${((passed/total)*100).toFixed(1)}%)`);
  console.log(`Report: ${outReport}`);
  console.log(`Review: ${outReview}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
