#!/usr/bin/env node
/**
 * bench-format.mjs — format-following + intent-following audit.
 *
 * Each case is a human-style prompt with two intents:
 *   1) a content request ("who founded SpaceX")
 *   2) a format directive ("just the name, one line")
 *
 * We score whether the response satisfies BOTH:
 *   - content (mustHit regex)
 *   - format (per-format heuristic checker)
 *
 * Usage:
 *   node scripts/bench-format.mjs --out _bench_format_R1.json
 *   node scripts/bench-format.mjs --limit 20 --out _bench_format_smoke.json
 *
 * The cases are intentionally varied across:
 *   - format kinds: name-only, single-sentence, bulleted, top-3, date-only,
 *     one-word, number-only, story, comma-list, headline, json-only, dollar-amount,
 *     city/country-only
 *   - content kinds: factual recall, definitions, comparisons, opinions
 *   - phrasing styles: imperative, casual, polite, embedded ("...and just give me...")
 */
import WS from 'ws';
const WebSocket = WS.WebSocket || WS;
import { writeFile } from 'node:fs/promises';
import { argv } from 'node:process';

process.on('uncaughtException', (e) => { console.error('[uncaught]', e?.message ?? e); });
process.on('unhandledRejection', (e) => { console.error('[unhandled]', e?.message ?? e); });

const REST = process.env.VAI_API ?? 'http://localhost:3006';
const WS_URL = REST.replace(/^http/i, 'ws').replace(/\/$/, '') + '/api/chat';

// -------------------- cases (100) --------------------
// format kinds:
//   name-only        → ≤6 words, no bullets, no preamble
//   one-word         → exactly 1 token (allow trailing punctuation)
//   single-sentence  → exactly one terminal punctuation, no lists
//   bulleted         → ≥2 list items (- / • / *)
//   top-3            → exactly 3 list items
//   numbered-3       → 3 items as "1." "2." "3."
//   date-only        → short response containing a date, no prose paragraph
//   number-only      → leading numeric, ≤4 words total
//   dollar-amount    → leading $... or "USD ..." pattern
//   story            → ≥80 words, narrative, no bullets, no headers
//   comma-list       → comma-separated single line
//   headline         → ≤12 words, title-cased / no period
//   json-only        → starts with `{` and ends with `}`; parseable
//   city-only        → single proper noun pair, ≤4 words
//   yes-no           → starts with Yes or No, ≤8 words

const CASES = [
  // ----- name-only (12) -----
  { id: 'inv-tx',         prompt: 'who invented the transistor? just give me the name(s), nothing else.',
    format: 'name-only', mustHit: [/bardeen|brattain|shockley/i] },
  { id: 'ceo-spacex',     prompt: 'who is the CEO of SpaceX — only the name please',
    format: 'name-only', mustHit: [/musk/i] },
  { id: 'pres-france',    prompt: 'current president of france. just the name.',
    format: 'name-only', mustHit: [/macron/i] },
  { id: 'wrote-1984',     prompt: 'who wrote 1984 — name only',
    format: 'name-only', mustHit: [/orwell/i] },
  { id: 'directed-inception', prompt: 'who directed inception — just the name, no preamble',
    format: 'name-only', mustHit: [/nolan/i] },
  { id: 'painted-mona',   prompt: 'who painted the mona lisa? answer with only the name.',
    format: 'name-only', mustHit: [/leonardo|vinci/i] },
  { id: 'wrote-republic', prompt: 'who wrote the republic — only the name',
    format: 'name-only', mustHit: [/plato/i] },
  { id: 'first-moon',     prompt: 'first human on the moon — just the name',
    format: 'name-only', mustHit: [/armstrong/i] },
  { id: 'who-relativity', prompt: 'who came up with the theory of relativity? name only.',
    format: 'name-only', mustHit: [/einstein/i] },
  { id: 'company-iphone', prompt: 'which company makes the iphone — only the company name',
    format: 'name-only', mustHit: [/apple/i] },
  { id: 'company-chatgpt', prompt: 'which company built chatgpt — only the company',
    format: 'name-only', mustHit: [/openai/i] },
  { id: 'company-android', prompt: 'who owns android — just the company name',
    format: 'name-only', mustHit: [/google|alphabet/i] },

  // ----- one-word (8) -----
  { id: 'capital-japan',  prompt: 'capital of japan in one word',
    format: 'one-word', mustHit: [/tokyo/i] },
  { id: 'capital-aus',    prompt: 'capital of australia — one word, no extras',
    format: 'one-word', mustHit: [/canberra/i] },
  { id: 'largest-planet', prompt: 'largest planet in our solar system, one word',
    format: 'one-word', mustHit: [/jupiter/i] },
  { id: 'fastest-land',   prompt: 'fastest land animal, one word answer',
    format: 'one-word', mustHit: [/cheetah/i] },
  { id: 'h2o-name',       prompt: 'common name for H2O, one word only',
    format: 'one-word', mustHit: [/water/i] },
  { id: 'tallest-mt',     prompt: 'tallest mountain on earth — one word',
    format: 'one-word', mustHit: [/everest/i] },
  { id: 'lang-brazil',    prompt: 'official language of brazil, one word',
    format: 'one-word', mustHit: [/portuguese/i] },
  { id: 'currency-uk',    prompt: 'currency of the uk — one word',
    format: 'one-word', mustHit: [/pound|sterling|gbp/i] },

  // ----- single-sentence (10) -----
  { id: 'def-photo',      prompt: 'what is photosynthesis? answer in one sentence.',
    format: 'single-sentence', mustHit: [/light|chlorophyll|carbon|glucose|sugar|energy/i] },
  { id: 'def-relativity', prompt: 'explain general relativity in one sentence',
    format: 'single-sentence', mustHit: [/gravity|spacetime|mass|curv/i] },
  { id: 'def-blockchain', prompt: 'what is a blockchain — keep it to one sentence',
    format: 'single-sentence', mustHit: [/ledger|distributed|chain|block|hash/i] },
  { id: 'def-llm',        prompt: 'what is an LLM — single sentence please',
    format: 'single-sentence', mustHit: [/language|model|predict|token|neural/i] },
  { id: 'def-mitosis',    prompt: 'define mitosis in one sentence',
    format: 'single-sentence', mustHit: [/cell|divide|division|chromosome|daughter/i] },
  { id: 'def-cors',       prompt: 'what is CORS? one sentence.',
    format: 'single-sentence', mustHit: [/cross[-\s]?origin|browser|header|http/i] },
  { id: 'def-recursion',  prompt: 'explain recursion in one sentence',
    format: 'single-sentence', mustHit: [/itself|function|call|base|recurs/i] },
  { id: 'def-async',      prompt: 'what does async/await do — one sentence',
    format: 'single-sentence', mustHit: [/promise|async|wait|asynchron|non[-\s]?block/i] },
  { id: 'def-rest',       prompt: 'what is REST in one sentence',
    format: 'single-sentence', mustHit: [/http|resource|stateless|api/i] },
  { id: 'def-tcp',        prompt: 'what is TCP — keep to a single sentence',
    format: 'single-sentence', mustHit: [/connection|reliable|stream|packet|protocol/i] },

  // ----- bulleted (10) -----
  { id: 'bul-py-good',    prompt: 'why is python popular? give me a bulleted list.',
    format: 'bulleted', mustHit: [/readab|libra|ecosyst|simple|community|beginner/i] },
  { id: 'bul-git-basics', prompt: 'list the basic git commands as bullets',
    format: 'bulleted', mustHit: [/commit|push|pull|clone|branch|merge|status|add/i] },
  { id: 'bul-sleep',      prompt: 'how to sleep better — answer as bullets',
    format: 'bulleted', mustHit: [/caffeine|routine|dark|screen|temperature|schedule|exercise/i] },
  { id: 'bul-good-pr',    prompt: 'what makes a good pull request — bullet list',
    format: 'bulleted', mustHit: [/small|focused|test|description|review|scope/i] },
  { id: 'bul-css-grid',   prompt: 'when to use CSS grid vs flexbox — bullets',
    format: 'bulleted', mustHit: [/grid|flex|2d|1d|row|column|layout/i] },
  { id: 'bul-rust-pros',  prompt: 'list the pros of rust as bullet points',
    format: 'bulleted', mustHit: [/safety|memory|performance|borrow|concurren|cargo|ecosystem/i] },
  { id: 'bul-vim-tips',   prompt: 'vim productivity tips — give as bullets',
    format: 'bulleted', mustHit: [/motion|leader|register|macro|plugin|hjkl|search/i] },
  { id: 'bul-resume',     prompt: 'what should a resume include — bullet list',
    format: 'bulleted', mustHit: [/experience|education|skill|project|contact|summary/i] },
  { id: 'bul-typo-tips',  prompt: 'good typography tips for the web — bullets',
    format: 'bulleted', mustHit: [/line[-\s]?height|font|size|contrast|spacing|hierarchy|measure/i] },
  { id: 'bul-debug',      prompt: 'how to debug effectively — bulleted list',
    format: 'bulleted', mustHit: [/reproduce|hypothes|log|isolate|bisect|test|minimal/i] },

  // ----- top-3 (10) -----
  { id: 't3-langs-web',   prompt: 'top 3 programming languages for web dev in 2025',
    format: 'top-3', mustHit: [/(javascript|typescript|python|rust|go|ruby|php)/i] },
  { id: 't3-startup-skills', prompt: 'top 3 skills a startup founder needs — list 3 only',
    format: 'top-3', mustHit: [/(sales|product|hir|focus|resilien|finance|communication|leadership)/i] },
  { id: 't3-prod-apps',   prompt: 'top 3 productivity apps right now — just three',
    format: 'top-3', mustHit: [/(notion|obsidian|todoist|things|linear|asana|trello|raycast)/i] },
  { id: 't3-jpg-libs',    prompt: 'three best image libraries for python — three only',
    format: 'top-3', mustHit: [/(pillow|pil|opencv|imageio|scikit[-\s]?image|wand)/i] },
  { id: 't3-coffee-vary', prompt: 'three best brewing methods for filter coffee — only three',
    format: 'top-3', mustHit: [/(v60|chemex|aeropress|kalita|hario|french\s*press|drip|pour[-\s]?over)/i] },
  { id: 't3-fitness',     prompt: 'three best beginner full-body exercises — just three',
    format: 'top-3', mustHit: [/(squat|deadlift|press|pull[-\s]?up|push[-\s]?up|row|lunge|plank)/i] },
  { id: 't3-jvm-langs',   prompt: 'top 3 jvm languages worth learning — three only',
    format: 'top-3', mustHit: [/(java|kotlin|scala|clojure|groovy)/i] },
  { id: 't3-keyb-switch', prompt: 'three best mechanical keyboard switches for typing — only three',
    format: 'top-3', mustHit: [/(cherry|gateron|kailh|brown|blue|holy\s*pand|alpaca|boba)/i] },
  { id: 't3-rpgs',        prompt: 'top 3 rpgs of all time — three only',
    format: 'top-3', mustHit: [/(skyrim|witcher|fallout|elden|baldur|persona|dragon\s*quest|chrono|final\s*fantasy|mass\s*effect)/i] },
  { id: 't3-podcasts',    prompt: 'three best podcasts about software engineering — just three',
    format: 'top-3', mustHit: [/(lex|changelog|syntax|software\s*engineering|signals|coder|infoq|stackoverflow)/i] },

  // ----- numbered-3 (5) -----
  { id: 'n3-pomodoro',    prompt: 'give me three steps to start a pomodoro session, numbered',
    format: 'numbered-3', mustHit: [/(25|timer|task|break|focus)/i] },
  { id: 'n3-deploy',      prompt: 'three steps to deploy a node app to vercel — numbered list',
    format: 'numbered-3', mustHit: [/(git|push|vercel|deploy|repo|cli|connect)/i] },
  { id: 'n3-onboard',     prompt: 'three steps for onboarding a new engineer — numbered',
    format: 'numbered-3', mustHit: [/(access|setup|mentor|read|repo|intro|tour|env|environment)/i] },
  { id: 'n3-recipe-eggs', prompt: 'three steps to scramble eggs — numbered',
    format: 'numbered-3', mustHit: [/(whisk|beat|pan|butter|low|stir|salt|heat)/i] },
  { id: 'n3-react-app',   prompt: 'three steps to start a new react app — numbered',
    format: 'numbered-3', mustHit: [/(vite|create|npx|pnpm|npm|install|run|dev)/i] },

  // ----- date-only (8) -----
  { id: 'date-moon-landing', prompt: 'when did humans first land on the moon — just the date',
    format: 'date-only', mustHit: [/1969|july/i] },
  { id: 'date-fall-berlin',  prompt: 'when did the berlin wall fall — date only',
    format: 'date-only', mustHit: [/1989|november/i] },
  { id: 'date-www',          prompt: 'when was the world wide web invented — just the year',
    format: 'date-only', mustHit: [/1989|1990|1991/i] },
  { id: 'date-titanic',      prompt: 'when did the titanic sink — date only',
    format: 'date-only', mustHit: [/1912|april/i] },
  { id: 'date-wwii-end',     prompt: 'when did world war 2 end — date only',
    format: 'date-only', mustHit: [/1945|september|august|may/i] },
  { id: 'date-iphone',       prompt: 'when was the first iphone released — date only',
    format: 'date-only', mustHit: [/2007|june/i] },
  { id: 'date-fr-rev',       prompt: 'when did the french revolution begin — just the year',
    format: 'date-only', mustHit: [/1789/] },
  { id: 'date-bitcoin-wp',   prompt: 'when was the bitcoin whitepaper published — date only',
    format: 'date-only', mustHit: [/2008|october|november/i] },

  // ----- number-only (5) -----
  { id: 'num-speed-light',   prompt: 'speed of light in m/s — number only',
    format: 'number-only', mustHit: [/299[\s,]*792[\s,]*458|3\s*x?\s*10\s*\^?8|3e8/i] },
  { id: 'num-pi',            prompt: 'pi to 5 decimal places — number only',
    format: 'number-only', mustHit: [/3\.14159/] },
  { id: 'num-everest-m',     prompt: 'height of mount everest in meters — number only',
    format: 'number-only', mustHit: [/8[\s,]*84[89]|8[\s,]*850/] },
  { id: 'num-pop-tokyo',     prompt: 'approximate population of tokyo metro — number only',
    format: 'number-only', mustHit: [/(3[0-9]|2[0-9])[\s,]*\d{3}[\s,]*\d{3}|3[0-9]\s*million|million/i] },
  { id: 'num-earth-moon',    prompt: 'distance from earth to moon in km — number only',
    format: 'number-only', mustHit: [/38[40][\s,]*000|384[\s,]*400|3\.84/] },

  // ----- dollar-amount (3) -----
  { id: 'dol-nyt-sub',       prompt: 'roughly how much does a NYT digital subscription cost per month in USD — dollar amount only',
    format: 'dollar-amount', mustHit: [/\$\s*\d|usd|dollar/i] },
  { id: 'dol-mb-air',        prompt: 'starting price of macbook air m3 in USD — dollar amount only',
    format: 'dollar-amount', mustHit: [/\$\s*1[01]\d\d|\$\s*99\d|\$\s*1,?099|\$\s*1,?199/] },
  { id: 'dol-tesla-mod3',    prompt: 'starting price of tesla model 3 in USD — dollar amount only',
    format: 'dollar-amount', mustHit: [/\$\s*[34]\d,?\d{3}|\$\s*3[5-9]|\$\s*4[0-9]/] },

  // ----- story (8) -----
  { id: 'story-edison',      prompt: 'tell me how thomas edison invented the light bulb as a short story',
    format: 'story', mustHit: [/(edison|filament|bulb|menlo|carbon|patent)/i] },
  { id: 'story-curies',      prompt: 'tell me the story of marie and pierre curie as a story',
    format: 'story', mustHit: [/(curie|radium|polonium|radioactiv|nobel)/i] },
  { id: 'story-apollo11',    prompt: 'tell apollo 11 like a story',
    format: 'story', mustHit: [/(armstrong|aldrin|collins|eagle|tranquility|moon)/i] },
  { id: 'story-wright',      prompt: 'tell the story of the wright brothers first flight',
    format: 'story', mustHit: [/(wright|kitty\s*hawk|orville|wilbur|flyer)/i] },
  { id: 'story-curiosity',   prompt: 'tell me how the curiosity rover landed on mars as a story',
    format: 'story', mustHit: [/(curiosity|mars|sky\s*crane|gale|landing)/i] },
  { id: 'story-titanic',     prompt: 'tell the titanic sinking as a short narrative',
    format: 'story', mustHit: [/(titanic|iceberg|atlantic|lifeboat|smith)/i] },
  { id: 'story-everest',     prompt: 'tell the story of hillary and norgay climbing everest',
    format: 'story', mustHit: [/(hillary|norgay|tenzing|everest|1953)/i] },
  { id: 'story-internet',    prompt: 'tell me the story of how the internet was born',
    format: 'story', mustHit: [/(arpanet|tcp|cerf|kahn|berners|web)/i] },

  // ----- comma-list (5) -----
  { id: 'cl-primary-col',    prompt: 'name the primary colors — comma separated, single line',
    format: 'comma-list', mustHit: [/red.*blue|blue.*red|yellow/i] },
  { id: 'cl-noble-gases',    prompt: 'list the noble gases — comma separated, one line',
    format: 'comma-list', mustHit: [/helium|neon|argon|krypton|xenon|radon/i] },
  { id: 'cl-planets',        prompt: 'planets in our solar system — comma separated on one line',
    format: 'comma-list', mustHit: [/mercury.*venus|mars.*jupiter|saturn/i] },
  { id: 'cl-vowels',         prompt: 'english vowels comma separated on a single line',
    format: 'comma-list', mustHit: [/a.*e.*i.*o.*u/i] },
  { id: 'cl-oceans',         prompt: 'the five oceans — comma separated, one line',
    format: 'comma-list', mustHit: [/pacific.*atlantic|indian.*arctic|southern/i] },

  // ----- headline (5) -----
  { id: 'hl-jwst',           prompt: 'write a news headline about a recent JWST discovery (no period)',
    format: 'headline', mustHit: [/(webb|jwst|galax|telescope)/i] },
  { id: 'hl-spacex',         prompt: 'write a news headline about a SpaceX starship launch (no period)',
    format: 'headline', mustHit: [/(spacex|starship|launch|rocket)/i] },
  { id: 'hl-elec',           prompt: 'headline about an EV battery breakthrough (no period)',
    format: 'headline', mustHit: [/(ev|battery|breakthrough|solid[-\s]?state|range)/i] },
  { id: 'hl-ai-reg',         prompt: 'headline about new AI regulation in the EU (no period)',
    format: 'headline', mustHit: [/(ai|eu|regulat|law|act)/i] },
  { id: 'hl-fusion',         prompt: 'headline about a fusion energy milestone (no period)',
    format: 'headline', mustHit: [/(fusion|ignition|energy|milestone)/i] },

  // ----- json-only (5) -----
  { id: 'json-person',       prompt: 'give me a JSON object only, no prose, with fields name (string) and age (number) for a fictional person',
    format: 'json-only', mustHit: [/"name"|"age"/i] },
  { id: 'json-recipe',       prompt: 'JSON only, no prose: {title, ingredients[], steps[]} for scrambled eggs',
    format: 'json-only', mustHit: [/"title"|"ingredients"|"steps"/i] },
  { id: 'json-todo',         prompt: 'return JSON only (no prose) with {id, task, done} for a sample todo',
    format: 'json-only', mustHit: [/"task"|"done"|"id"/i] },
  { id: 'json-color',        prompt: 'JSON object only: {name, hex} for the color cornflower blue',
    format: 'json-only', mustHit: [/"hex"|"name"|cornflower|#6495|6495ed/i] },
  { id: 'json-book',         prompt: 'JSON only: {title, author, year} for the book 1984',
    format: 'json-only', mustHit: [/"title"|"author"|orwell|1949/i] },

  // ----- city-only (5) -----
  { id: 'city-eiffel',       prompt: 'where is the eiffel tower — city only, no extras',
    format: 'city-only', mustHit: [/paris/i] },
  { id: 'city-colosseum',    prompt: 'where is the colosseum — city only',
    format: 'city-only', mustHit: [/rome/i] },
  { id: 'city-pyramids',     prompt: 'where are the pyramids of giza — city only',
    format: 'city-only', mustHit: [/giza|cairo/i] },
  { id: 'city-statue',       prompt: 'where is the statue of liberty — city only',
    format: 'city-only', mustHit: [/new\s*york|liberty\s*island/i] },
  { id: 'city-burj',         prompt: 'where is the burj khalifa — city only',
    format: 'city-only', mustHit: [/dubai/i] },

  // ----- yes-no (6) -----
  { id: 'yn-water-wet',      prompt: 'is water wet — yes or no, one short line',
    format: 'yes-no', mustHit: /./ },
  { id: 'yn-tomato-fruit',   prompt: 'is a tomato a fruit — yes or no, short answer',
    format: 'yes-no', mustHit: [/yes/i] },
  { id: 'yn-pluto-planet',   prompt: 'is pluto still a planet — yes or no, one line',
    format: 'yes-no', mustHit: [/no/i] },
  { id: 'yn-py-typed',       prompt: 'is python statically typed — yes or no',
    format: 'yes-no', mustHit: [/no/i] },
  { id: 'yn-silksong-out',   prompt: 'is hollow knight silksong out — yes or no, one line',
    format: 'yes-no', mustHit: [/yes|no/i] },
  { id: 'yn-earth-flat',     prompt: 'is the earth flat — yes or no',
    format: 'yes-no', mustHit: [/no/i] },
];

// -------------------- format checkers --------------------

function stripFences(t) {
  return t.replace(/```[a-zA-Z]*\n?|```/g, '').trim();
}
function bulletCount(t) {
  return (t.match(/^[ \t]*(?:[-*•]|\u2022)\s+\S/gm) ?? []).length;
}
function numberedCount(t) {
  return (t.match(/^[ \t]*\d+[.)]\s+\S/gm) ?? []).length;
}
function sentenceCount(t) {
  const trimmed = t.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 0;
  // count terminal punctuation that ends a sentence (very rough)
  return (trimmed.match(/[.!?](?:\s+[A-Z“"'(]|$)/g) ?? []).length;
}
function wordCount(t) {
  return (t.trim().match(/\S+/g) ?? []).length;
}
function hasPreamble(t) {
  return /^(?:\s*(?:sure|of course|here(?:'s| is)|the answer is|that(?:'s| is)|certainly|happy to|absolutely)\b)/i.test(t.trim());
}
function hasMarkdownHeader(t) {
  return /^\s*#{1,6}\s+\S/m.test(t);
}
function isOnlyShortLine(t, maxWords) {
  const lines = t.trim().split(/\n+/).filter(Boolean);
  if (lines.length !== 1) return false;
  return wordCount(lines[0]) <= maxWords;
}

const CHECKERS = {
  'name-only': (t) => {
    const w = wordCount(t), b = bulletCount(t);
    const ok = w <= 6 && b === 0 && !hasPreamble(t) && !hasMarkdownHeader(t) && sentenceCount(t) <= 1;
    return { ok, why: ok ? '' : `words=${w} bullets=${b} preamble=${hasPreamble(t)} header=${hasMarkdownHeader(t)} sents=${sentenceCount(t)}` };
  },
  'one-word': (t) => {
    const trimmed = t.trim().replace(/^[\s"'*_`-]+|[\s"'*_`.!?,;:]+$/g, '');
    const w = trimmed.split(/\s+/).filter(Boolean).length;
    const ok = w === 1 && bulletCount(t) === 0 && !hasPreamble(t);
    return { ok, why: ok ? '' : `words=${w} preamble=${hasPreamble(t)}` };
  },
  'single-sentence': (t) => {
    const b = bulletCount(t), n = numberedCount(t);
    const s = sentenceCount(t);
    const lines = t.trim().split(/\n+/).filter(Boolean).length;
    const ok = b === 0 && n === 0 && lines <= 2 && s <= 1 && !hasMarkdownHeader(t);
    return { ok, why: ok ? '' : `sents=${s} bullets=${b} numbered=${n} lines=${lines}` };
  },
  bulleted: (t) => {
    const b = bulletCount(t);
    const ok = b >= 2;
    return { ok, why: ok ? '' : `bullets=${b}` };
  },
  'top-3': (t) => {
    const items = bulletCount(t) + numberedCount(t);
    const ok = items === 3;
    return { ok, why: ok ? '' : `items=${items} (expected 3)` };
  },
  'numbered-3': (t) => {
    const n = numberedCount(t);
    const ok = n === 3;
    return { ok, why: ok ? '' : `numbered=${n}` };
  },
  'date-only': (t) => {
    const w = wordCount(t);
    const hasDate = /\b(?:19|20)\d{2}\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/i.test(t);
    const ok = hasDate && w <= 8 && bulletCount(t) === 0 && !hasPreamble(t);
    return { ok, why: ok ? '' : `hasDate=${hasDate} words=${w} preamble=${hasPreamble(t)}` };
  },
  'number-only': (t) => {
    const trimmed = t.trim();
    const hasNum = /\d/.test(trimmed);
    const w = wordCount(trimmed);
    const ok = hasNum && w <= 6 && bulletCount(t) === 0 && !hasPreamble(t);
    return { ok, why: ok ? '' : `hasNum=${hasNum} words=${w}` };
  },
  'dollar-amount': (t) => {
    const ok = /\$\s*\d|\b\d+\s*(?:usd|dollars?)\b/i.test(t) && wordCount(t) <= 8 && bulletCount(t) === 0;
    return { ok, why: ok ? '' : `pattern miss or too long (w=${wordCount(t)})` };
  },
  story: (t) => {
    const w = wordCount(t);
    const b = bulletCount(t) + numberedCount(t);
    const h = hasMarkdownHeader(t);
    const ok = w >= 80 && b === 0 && !h;
    return { ok, why: ok ? '' : `words=${w} bullets+num=${b} headers=${h}` };
  },
  'comma-list': (t) => {
    const lines = t.trim().split(/\n+/).filter(Boolean);
    const isOneLine = lines.length === 1;
    const commas = ((lines[0] ?? '').match(/,/g) ?? []).length;
    const ok = isOneLine && commas >= 2 && bulletCount(t) === 0;
    return { ok, why: ok ? '' : `lines=${lines.length} commas=${commas}` };
  },
  headline: (t) => {
    const trimmed = t.trim().replace(/^["'`*_]+|["'`*_]+$/g, '');
    const w = wordCount(trimmed);
    const endsWithPeriod = /\.\s*$/.test(trimmed);
    const ok = w <= 14 && !endsWithPeriod && bulletCount(t) === 0 && !hasMarkdownHeader(t);
    return { ok, why: ok ? '' : `words=${w} endsWithPeriod=${endsWithPeriod}` };
  },
  'json-only': (t) => {
    const trimmed = stripFences(t).trim();
    let parsed = null;
    try { parsed = JSON.parse(trimmed); } catch {}
    const looksObj = /^\s*\{[\s\S]*\}\s*$/.test(trimmed);
    const ok = !!parsed && typeof parsed === 'object' && looksObj && !/^[A-Za-z]/.test(t.trim());
    return { ok, why: ok ? '' : `parseable=${!!parsed} looksObj=${looksObj} startsWithText=${/^[A-Za-z]/.test(t.trim())}` };
  },
  'city-only': (t) => {
    const w = wordCount(t);
    const ok = w <= 4 && bulletCount(t) === 0 && !hasPreamble(t) && sentenceCount(t) <= 1;
    return { ok, why: ok ? '' : `words=${w} preamble=${hasPreamble(t)} sents=${sentenceCount(t)}` };
  },
  'yes-no': (t) => {
    const first = (t.trim().match(/^\W*(yes|no|nope|yep|yeah)\b/i) ?? [])[1];
    const w = wordCount(t);
    const ok = !!first && w <= 12;
    return { ok, why: ok ? '' : `first=${first ?? '∅'} words=${w}` };
  },
};

// -------------------- runner --------------------

function args() {
  const a = { out: '_bench_format_R1.json', limit: 0, delayMs: 1200, concurrency: 4 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--out') { a.out = v; i++; }
    else if (k === '--limit') { a.limit = parseInt(v, 10) || 0; i++; }
    else if (k === '--delay') { a.delayMs = parseInt(v, 10) || 0; i++; }
    else if (k === '--concurrency') { a.concurrency = Math.max(1, parseInt(v, 10) || 1); i++; }
  }
  return a;
}

async function newConversation() {
  const r = await fetch(`${REST}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'bench-format', modelId: 'vai:v0' }),
  });
  if (!r.ok) throw new Error(`conv create ${r.status}`);
  return (await r.json()).id;
}

function askChat(conversationId, prompt, timeoutMs = 35_000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let text = '';
    let sources = [];
    let done = false;
    const t0 = Date.now();
    const timer = setTimeout(() => { try { ws.close(); } catch {}; finish('timeout'); }, timeoutMs);
    function finish(reason) {
      if (done) return; done = true;
      clearTimeout(timer);
      resolve({ text, sources, wallMs: Date.now() - t0, reason });
    }
    ws.on('open', () => ws.send(JSON.stringify({ conversationId, content: prompt })));
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.type === 'text_delta' && m.textDelta) text += m.textDelta;
      else if (m.type === 'token' && m.token) text += m.token;
      else if (m.type === 'sources' && Array.isArray(m.sources)) sources = m.sources;
      else if (m.type === 'done') { try { ws.close(); } catch {}; finish('done'); }
      else if (m.type === 'error') { try { ws.close(); } catch {}; finish('error:' + (m.error || '?')); }
    });
    ws.on('close', () => finish('close'));
    ws.on('error', (e) => finish('wserror:' + e.message));
  });
}

function score(c, r) {
  const mustHitArr = Array.isArray(c.mustHit) ? c.mustHit : (c.mustHit ? [c.mustHit] : []);
  const mustHit = mustHitArr.map((p) => ({ pat: p.toString(), ok: p.test(r.text) }));
  const contentOk = mustHit.length === 0 ? true : mustHit.every((m) => m.ok);
  const checker = CHECKERS[c.format] ?? (() => ({ ok: false, why: 'no-checker' }));
  const fmt = checker(r.text);
  return {
    id: c.id, prompt: c.prompt, format: c.format, wallMs: r.wallMs, reason: r.reason,
    sourceCount: r.sources?.length ?? 0,
    contentOk, formatOk: fmt.ok, formatWhy: fmt.why,
    mustHit, words: wordCount(r.text), bullets: bulletCount(r.text), numbered: numberedCount(r.text),
    sentences: sentenceCount(r.text), preview: r.text.slice(0, 400), fullText: r.text,
  };
}

async function runPool(items, n, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function pump() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: n }, pump));
  return results;
}

async function main() {
  const a = args();
  let cases = CASES;
  if (a.limit > 0) cases = cases.slice(0, a.limit);
  console.log(`bench-format: ${cases.length} cases, concurrency=${a.concurrency} → ${a.out}`);
  const t0 = Date.now();
  let completed = 0;
  const partial = new Array(cases.length).fill(null);
  const results = await runPool(cases, a.concurrency, async (c, i) => {
    let res;
    try {
      const convId = await newConversation();
      res = await askChat(convId, c.prompt);
    } catch (e) {
      res = { text: '', sources: [], wallMs: 0, reason: 'exc:' + e.message };
    }
    const scored = score(c, res);
    const tag = `[${(i + 1).toString().padStart(3)}/${cases.length}] ${c.format.padEnd(14)} ${c.id.padEnd(18)}`;
    console.log(`${tag} content=${scored.contentOk ? 'Y' : 'N'} fmt=${scored.formatOk ? 'Y' : 'N'} w=${scored.words} ${scored.wallMs}ms  ${scored.preview.slice(0, 80).replace(/\s+/g, ' ')}`);
    partial[i] = scored;
    completed++;
    // checkpoint every 10
    if (completed % 10 === 0) {
      try {
        await writeFile(a.out + '.partial', JSON.stringify({ completed, total: cases.length, cases: partial.filter(Boolean) }, null, 2));
      } catch {}
    }
    if (a.delayMs > 0) await new Promise((r) => setTimeout(r, a.delayMs));
    return scored;
  });

  // Summarize
  const byFormat = {};
  for (const r of results) {
    byFormat[r.format] ??= { n: 0, content: 0, fmt: 0, both: 0 };
    const b = byFormat[r.format]; b.n++;
    if (r.contentOk) b.content++;
    if (r.formatOk) b.fmt++;
    if (r.contentOk && r.formatOk) b.both++;
  }
  const summary = {
    at: new Date().toISOString(),
    totalCases: results.length,
    totalWallMs: Date.now() - t0,
    contentPass: results.filter((r) => r.contentOk).length,
    formatPass: results.filter((r) => r.formatOk).length,
    bothPass: results.filter((r) => r.contentOk && r.formatOk).length,
    byFormat: Object.fromEntries(Object.entries(byFormat).map(([k, b]) => [k, {
      n: b.n,
      content: `${b.content}/${b.n}`,
      format: `${b.fmt}/${b.n}`,
      both: `${b.both}/${b.n}`,
      formatPct: Math.round(100 * b.fmt / b.n),
      bothPct: Math.round(100 * b.both / b.n),
    }])),
    failures: results.filter((r) => !r.formatOk || !r.contentOk).map((r) => ({
      id: r.id, format: r.format, contentOk: r.contentOk, formatOk: r.formatOk,
      why: r.formatWhy, prompt: r.prompt, preview: r.preview,
    })),
    cases: results,
  };
  await writeFile(a.out, JSON.stringify(summary, null, 2));
  console.log('');
  console.log(`total=${results.length}  contentPass=${summary.contentPass}  formatPass=${summary.formatPass}  bothPass=${summary.bothPass}  (${summary.totalWallMs}ms)`);
  for (const [k, b] of Object.entries(summary.byFormat)) {
    console.log(`  ${k.padEnd(16)} fmt=${b.format.padEnd(7)} both=${b.both.padEnd(7)} bothPct=${b.bothPct}%`);
  }
  console.log(`Saved: ${a.out}`);
}

main().catch((e) => { console.error(e); process.exit(2); });
