/**
 * Code-action audit wave.
 *
 * The factual and conversational waves test knowledge and dialogue. This wave
 * tests whether Vai can actually DO the work a developer asks for: generate or
 * edit real code. Each task is a natural request grounded in a well-known,
 * canonical solution (the kind that is the accepted answer on Stack Overflow or
 * the documented idiom), graded on whether the reply uses the correct approach:
 *   - mustUseAny  : at least one canonical API / construct appears (the right
 *                   tool for the job, e.g. `new Set` for dedupe, `path.relative`
 *                   for containment)
 *   - mustAvoid    : known-wrong or footgun approaches are absent
 *   - fence        : code is delivered in a fenced block of the right language
 *
 * Grading is intentionally lenient on style (any correct idiom passes) and
 * strict on correctness, so it measures real capability, not formatting.
 */

import { randomFromSeed } from './vai-generated-audit-wave.mjs';

const TASKS = [
  {
    id: 'js-dedupe-array',
    opening: 'can you write a one-liner to remove duplicate values from a javascript array?',
    fence: ['js', 'javascript'],
    mustUseAny: ['new Set', '[...new Set', 'Array.from(new Set'],
    answerNote: 'Use [...new Set(arr)].',
  },
  {
    id: 'py-merge-dicts',
    opening: 'in python 3.9+, what\u2019s the cleanest way to merge two dicts into a new one?',
    fence: ['py', 'python'],
    mustUseAny: ['a | b', '{**a, **b}', '| b', '**a'],
    answerNote: 'a | b (or {**a, **b}).',
  },
  {
    id: 'js-debounce',
    opening: 'hey can you write a small debounce function in javascript?',
    fence: ['js', 'javascript'],
    mustUseAny: ['setTimeout', 'clearTimeout'],
    mustAvoid: ['setInterval'],
    answerNote: 'Wrap a timer with clearTimeout/setTimeout.',
  },
  {
    id: 'py-read-file',
    opening: 'what\u2019s the idiomatic way to read a whole text file in python without leaking the handle?',
    fence: ['py', 'python'],
    mustUseAny: ['with open', 'with open('],
    answerNote: 'Use a with open(...) context manager.',
  },
  {
    id: 'js-path-containment',
    opening: 'can you write a node function that checks a resolved path is contained within a base dir, safely?',
    fence: ['js', 'javascript', 'ts', 'typescript'],
    mustUseAny: ['path.relative', 'relative('],
    mustAvoid: ['.startsWith(base)', 'startsWith(root)'],
    answerNote: 'Use path.relative and reject results starting with ".." or absolute.',
  },
  {
    id: 'sql-second-highest',
    opening: 'write a sql query to get the second highest salary from an employees table',
    fence: ['sql'],
    mustUseAny: ['LIMIT 1 OFFSET 1', 'OFFSET 1', 'DENSE_RANK', 'MAX(salary) < ', 'distinct salary'],
    answerNote: 'ORDER BY salary DESC LIMIT 1 OFFSET 1, or DENSE_RANK().',
  },
  {
    id: 'js-deep-clone',
    opening: 'cleanest way to deep clone a plain object in modern javascript?',
    fence: ['js', 'javascript'],
    mustUseAny: ['structuredClone'],
    mustAvoid: ['JSON.parse(JSON.stringify'],
    answerNote: 'structuredClone(obj).',
  },
  {
    id: 'py-flatten-list',
    opening: 'how do i flatten a list of lists into one list in python? quick snippet pls',
    fence: ['py', 'python'],
    mustUseAny: ['for sublist in', 'itertools.chain', 'chain.from_iterable', 'for item in'],
    answerNote: 'Comprehension [x for sub in lists for x in sub] or itertools.chain.',
  },
  {
    id: 'js-fetch-json',
    opening: 'write an async function that fetches json from a url and handles a non-ok response',
    fence: ['js', 'javascript'],
    mustUseAny: ['await fetch', 'response.ok', 'res.ok', '.ok'],
    answerNote: 'await fetch, check response.ok, then response.json().',
  },
  {
    id: 'py-count-words',
    opening: 'give me a python snippet that counts word frequency in a string',
    fence: ['py', 'python'],
    mustUseAny: ['Counter', 'collections.Counter', '.get(', 'defaultdict'],
    answerNote: 'collections.Counter(text.split()).',
  },
  {
    id: 'js-sort-numbers',
    opening: 'why does [10, 2, 1].sort() give the wrong order and how do i fix it?',
    fence: ['js', 'javascript'],
    mustUseAny: ['(a, b) => a - b', 'a - b', '(a,b)=>a-b'],
    answerNote: 'Pass a comparator: sort((a, b) => a - b).',
  },
  {
    id: 'ts-pick-type',
    opening: 'in typescript how do i make a type with only some keys of another type?',
    fence: ['ts', 'typescript'],
    mustUseAny: ['Pick<', 'Omit<'],
    answerNote: 'Pick<T, "a" | "b"> (or Omit).',
  },
  {
    id: 'js-promise-all',
    opening: 'i need to run three async calls in parallel and wait for all of them — how?',
    fence: ['js', 'javascript'],
    mustUseAny: ['Promise.all', 'Promise.allSettled'],
    mustAvoid: ['await a;\n  await b'],
    answerNote: 'await Promise.all([a, b, c]).',
  },
  {
    id: 'py-reverse-string',
    opening: 'whats the pythonic one-liner to reverse a string?',
    fence: ['py', 'python'],
    mustUseAny: ['[::-1]'],
    answerNote: 's[::-1].',
  },
  {
    id: 'js-group-by',
    opening: 'write a function that groups an array of objects by a key',
    fence: ['js', 'javascript'],
    mustUseAny: ['reduce', 'Object.groupBy', 'Map'],
    answerNote: 'reduce into an object/Map, or Object.groupBy.',
  },
  {
    id: 'bash-find-large-files',
    opening: 'quick shell one-liner to find the 5 largest files in a directory tree?',
    fence: ['bash', 'sh', 'shell'],
    mustUseAny: ['du -a', 'find', 'sort -', 'head -'],
    answerNote: 'du -ah . | sort -rh | head -5.',
  },
];

const OPENER_GARNISH = ['', '', '', 'hey ', 'ok so ', 'quick one, '];

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function shuffled(random, values) {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

/**
 * Build a code-action wave.
 * @param {number} count number of code tasks (capped at corpus size)
 * @param {string} seed stable seed for reproducible selection
 */
export function buildCodeActionWave(count, seed) {
  const random = randomFromSeed(`code-action:${seed}`);
  const selected = shuffled(random, TASKS).slice(0, Math.max(1, Math.min(count, TASKS.length)));

  const scenarios = selected.map((task, index) => {
    const checks = [
      { type: 'code-fence-language', values: task.fence },
      { type: 'contains-any', id: `${task.id}-approach`, values: task.mustUseAny },
    ];
    if (task.mustAvoid?.length) {
      checks.push({ type: 'not-contains-any', values: task.mustAvoid });
    }
    const base = task.opening.replace(/^(?:hey,?\s+|ok so,?\s+|quick one,?\s+)+/i, '');
    const opening = `${pick(random, OPENER_GARNISH)}${base}`;
    return {
      id: `code-action-${task.id}-${index + 1}`,
      label: `Code action: ${task.id}`,
      canary: null,
      dimensions: ['code-action', 'generation', 'correctness'],
      generated: { answer: task.answerNote },
      turns: [
        {
          prompt: opening,
          noHumanize: true,
          rubric: { id: `code-action-${task.id}`, checks },
        },
      ],
    };
  });

  return {
    version: 'code-action-1',
    generation: { mode: 'code-action', seed, corpusSize: TASKS.length },
    scenarios,
  };
}

export default { buildCodeActionWave };
