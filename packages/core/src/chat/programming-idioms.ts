/**
 * Programming-idiom resolver.
 *
 * The old CODE_SNIPPETS table matched one exact phrasing per snippet (a
 * "template matcher"), and the broader code path answered in the wrong language
 * (asked Python, replied TypeScript). This resolver fixes both honestly:
 *
 *   1. Concept detection is synonym-based, so many natural phrasings of the
 *      same request resolve to the same idiom ("dedupe an array", "remove
 *      duplicate values", "unique values from a list").
 *   2. Language is detected from the prompt and the answer is emitted in THAT
 *      language. If the requested language has no canonical form for the
 *      concept, the resolver declines (returns null) rather than misleading the
 *      reader with the wrong language.
 *
 * These are canonical idioms — the answer a competent engineer gives without
 * thinking (the accepted Stack Overflow answer). This is NOT general-purpose
 * code generation; it is a curated knowledge layer for well-known tasks.
 */

export type IdiomLang =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'rust'
  | 'go'
  | 'sql'
  | 'bash';

const FENCE: Record<IdiomLang, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  rust: 'rust',
  go: 'go',
  sql: 'sql',
  bash: 'bash',
};

type Impl = { code: string; why: string };

type Idiom = {
  id: string;
  /** Concept synonyms; ANY match selects this idiom. */
  match: RegExp;
  /** Language used when the prompt names none. */
  defaultLang: IdiomLang;
  /** Per-language canonical implementations. */
  impls: Partial<Record<IdiomLang, Impl>>;
};

/**
 * Detect an explicitly requested language. Returns null when the prompt does
 * not name one, so the caller can fall back to the idiom's default.
 */
export function detectRequestedLang(content: string): IdiomLang | null {
  const c = content.toLowerCase();
  // Order matters: check the more specific token first (typescript before ts,
  // and before the generic javascript fallback).
  if (/\btypescript\b|\bts\b|\.ts\b/.test(c)) return 'typescript';
  if (/\bjavascript\b|\bjs\b|\bnode(?:\.js)?\b|\.js\b/.test(c)) return 'javascript';
  if (/\bpython\b|\bpy\b|\.py\b/.test(c)) return 'python';
  if (/\brust\b/.test(c)) return 'rust';
  if (/\bgolang\b|\bgo\b/.test(c)) return 'go';
  if (/\bsql\b|\bquery\b|\btable\b|\bselect\b/.test(c)) return 'sql';
  if (/\bbash\b|\bshell\b|\bsh\b|\bcommand line\b|\bterminal\b/.test(c)) return 'bash';
  return null;
}

const IDIOMS: Idiom[] = [
  {
    id: 'dedupe-array',
    match: /\b(dedup\w*|remove\s+duplicat\w*|unique\s+(?:values|items|elements)|distinct\s+values)\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: 'const unique = [...new Set(arr)];',
        why: 'A `Set` keeps only distinct values; spreading it back gives an array.',
      },
      typescript: {
        code: 'const unique = <T>(arr: T[]): T[] => [...new Set(arr)];',
        why: 'A `Set` keeps only distinct values; spreading it back gives an array.',
      },
      python: {
        code: 'unique = list(dict.fromkeys(items))  # preserves order\n# or, if order does not matter:\nunique = list(set(items))',
        why: '`dict.fromkeys` dedupes while preserving insertion order; `set` is unordered.',
      },
      rust: {
        code: 'use std::collections::HashSet;\n\nlet unique: Vec<_> = items.into_iter().collect::<HashSet<_>>().into_iter().collect();',
        why: 'Collecting into a `HashSet` drops duplicates; collect back into a `Vec`.',
      },
    },
  },
  {
    id: 'merge-dicts',
    match: /\b(merge|combine|union)\b.*\b(dict\w*|map\w*|object\w*|hash\w*)\b/i,
    defaultLang: 'python',
    impls: {
      python: {
        code: 'merged = a | b           # Python 3.9+\n# older versions:\nmerged = {**a, **b}',
        why: 'The `|` operator (3.9+) returns a new merged dict; `b` wins on key clashes.',
      },
      javascript: {
        code: 'const merged = { ...a, ...b };',
        why: 'Object spread copies both into a new object; `b` overrides `a` on clashes.',
      },
      typescript: {
        code: 'const merged: Record<string, unknown> = { ...a, ...b };',
        why: 'Object spread copies both into a new object; `b` overrides `a` on clashes.',
      },
    },
  },
  {
    id: 'reverse-string',
    match: /\breverse\b.*\bstring\b|\bstring\b.*\breverse\b/i,
    defaultLang: 'python',
    impls: {
      python: { code: 'reversed_str = s[::-1]', why: 'A slice with step -1 walks the string backwards.' },
      javascript: { code: 'const reversed = [...s].reverse().join("");', why: 'Spread to an array (handles surrogate pairs), reverse, join back.' },
      typescript: { code: 'const reversed: string = [...s].reverse().join("");', why: 'Spread to an array (handles surrogate pairs), reverse, join back.' },
      rust: { code: 'let reversed: String = s.chars().rev().collect();', why: '`chars().rev()` reverses by Unicode scalar, then collect into a String.' },
    },
  },
  {
    id: 'read-file',
    match: /\bread\b.*\b(file|text file)\b|\b(file|text file)\b.*\bread\b/i,
    defaultLang: 'python',
    impls: {
      python: {
        code: 'from pathlib import Path\n\ntext = Path(path).read_text(encoding="utf-8")',
        why: '`Path.read_text` opens, reads, and closes in one call — the modern pathlib idiom. For streaming large files, fall back to `with open(path, encoding="utf-8") as f:`.',
      },
      javascript: {
        code: 'import { readFile } from "node:fs/promises";\n\nconst text = await readFile(path, "utf8");',
        why: 'The promises API reads the whole file and resolves with its contents.',
      },
      rust: {
        code: 'let text = std::fs::read_to_string(path)?;',
        why: '`read_to_string` reads the whole file and closes it when the handle drops.',
      },
    },
  },
  {
    id: 'flatten-list',
    match: /\bflatten\b.*\b(list|array|nested)\b|\b(list of lists|nested (?:list|array))\b/i,
    defaultLang: 'python',
    impls: {
      python: {
        code: 'flat = [x for sub in nested for x in sub]\n# or:\nfrom itertools import chain\nflat = list(chain.from_iterable(nested))',
        why: 'A nested comprehension (or `itertools.chain`) concatenates the sublists.',
      },
      javascript: {
        code: 'const flat = nested.flat();        // one level\nconst deep = nested.flat(Infinity); // all levels',
        why: '`Array.prototype.flat` flattens to the requested depth.',
      },
      typescript: {
        code: 'const flat = nested.flat();',
        why: '`Array.prototype.flat` flattens one level by default.',
      },
    },
  },
  {
    id: 'count-words',
    match: /\bcount\b.*\bword\b|\bword\s+(?:frequency|count|freq)\b/i,
    defaultLang: 'python',
    impls: {
      python: {
        code: 'from collections import Counter\n\ncounts = Counter(text.split())',
        why: '`Counter` tallies each token in one pass and supports `.most_common()`.',
      },
      javascript: {
        code: 'const counts = new Map();\nfor (const w of text.split(/\\s+/)) counts.set(w, (counts.get(w) ?? 0) + 1);',
        why: 'Walk the tokens once, incrementing a `Map` keyed by word.',
      },
    },
  },
  {
    id: 'sort-numbers',
    match: /\bsort\b.*\b(numbers?|numeric|integers?)\b|\b\[?\s*10\s*,\s*2\s*,\s*1\s*\]?\b.*\bsort\b|\bsort\b.*\bwrong\s+order\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: 'const sorted = nums.toSorted((a, b) => a - b);\n// in-place (mutates nums):\nnums.sort((a, b) => a - b);',
        why: 'Default `sort` compares as strings ("10" < "2"); a numeric comparator fixes it. `toSorted` (ES2023) returns a new array instead of mutating.',
      },
      typescript: {
        code: 'const sorted = nums.toSorted((a, b) => a - b);\n// in-place (mutates nums):\nnums.sort((a, b) => a - b);',
        why: 'Default `sort` compares as strings ("10" < "2"); a numeric comparator fixes it. `toSorted` (ES2023) returns a new array instead of mutating.',
      },
    },
  },
  {
    id: 'deep-clone',
    match: /\bdeep[\s-]?(?:clone|copy)\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: 'const copy = structuredClone(original);',
        why: '`structuredClone` recursively copies nested objects, arrays, Maps, Sets and cycles (Node 17+).',
      },
      typescript: {
        code: 'const copy = structuredClone(original);',
        why: '`structuredClone` recursively copies nested objects, arrays, Maps, Sets and cycles (Node 17+).',
      },
      python: {
        code: 'from copy import deepcopy\n\ncopy_ = deepcopy(original)',
        why: '`copy.deepcopy` recursively copies every nested object and handles cycles.',
      },
      rust: {
        code: 'let copy = original.clone();',
        why: '`#[derive(Clone)]` makes `.clone()` recurse through every owned field.',
      },
    },
  },
  {
    id: 'fetch-json',
    match: /\bfetch\b.*\bjson\b|\bjson\b.*\b(from|url|api|endpoint)\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: 'async function getJson(url) {\n  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });\n  if (!res.ok) throw new Error(`HTTP ${res.status}`);\n  return res.json();\n}',
        why: 'Await `fetch`, check `res.ok` before parsing, then `res.json()`. `AbortSignal.timeout` aborts a hung request instead of waiting forever (built into browsers and Node 18+).',
      },
      typescript: {
        code: 'async function getJson<T>(url: string): Promise<T> {\n  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });\n  if (!res.ok) throw new Error(`HTTP ${res.status}`);\n  return res.json() as Promise<T>;\n}',
        why: 'Await `fetch`, check `res.ok` before parsing, then `res.json()`. `AbortSignal.timeout` aborts a hung request instead of waiting forever (built into browsers and Node 18+).',
      },
    },
  },
  {
    id: 'parallel-async',
    match: /\b(parallel|at the same time|concurrent\w*)\b.*\b(async|calls?|requests?|promises?|await)\b|\bwait for all\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: 'const [a, b, c] = await Promise.all([callA(), callB(), callC()]);',
        why: 'Start all promises first, then `Promise.all` waits for them together (use `allSettled` to keep partial results).',
      },
      typescript: {
        code: 'const [a, b, c] = await Promise.all([callA(), callB(), callC()]);',
        why: 'Start all promises first, then `Promise.all` waits for them together (use `allSettled` to keep partial results).',
      },
    },
  },
  {
    id: 'group-by',
    match: /\bgroups?\b.*\bby\b\s+(?:a\s+)?(?:key|property|field)\b|\bgroups?\b\s+(?:an?\s+)?array\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: 'const grouped = Object.groupBy(items, (item) => item.key);\n// pre-ES2024 runtimes:\nconst legacy = items.reduce((acc, item) => {\n  (acc[item.key] ??= []).push(item);\n  return acc;\n}, {});',
        why: '`Object.groupBy` (ES2024, Node 21+) groups natively; the `reduce` form is the fallback for older runtimes. Use `Map.groupBy` when keys are not strings.',
      },
      typescript: {
        code: 'const grouped = Object.groupBy(items, (item) => item.key);\n// pre-ES2024 runtimes:\nconst legacy = items.reduce<Record<string, Item[]>>((acc, item) => {\n  (acc[item.key] ??= []).push(item);\n  return acc;\n}, {});',
        why: '`Object.groupBy` (ES2024, Node 21+) groups natively and types as `Partial<Record<K, T[]>>`; the `reduce` form is the fallback for older runtimes.',
      },
    },
  },
  {
    id: 'pick-type',
    match: /\b(type|interface)\b.*\b(only\s+some|subset|pick|few)\b.*\bkeys?\b|\bpick\b.*\bkeys?\b.*\btype\b/i,
    defaultLang: 'typescript',
    impls: {
      typescript: {
        code: 'type Subset = Pick<Original, "id" | "name">;\n// inverse — everything except some keys:\ntype Rest = Omit<Original, "secret">;',
        why: '`Pick` keeps the named keys; `Omit` removes them.',
      },
    },
  },
  {
    id: 'path-containment',
    match: /\bpath\b.*\b(contain\w*|inside|within|traversal|escape)\b|\bcontain\w*\b.*\bbase\s*dir\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: 'import path from "node:path";\n\nfunction isContained(baseDir, target) {\n  const rel = path.relative(path.resolve(baseDir), path.resolve(target));\n  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);\n}',
        why: 'Resolve both, then `path.relative`; reject results that are `..`-prefixed or absolute. A bare `startsWith(base)` is unsafe — `/base-old` shares the prefix.',
      },
      typescript: {
        code: 'import path from "node:path";\n\nfunction isContained(baseDir: string, target: string): boolean {\n  const rel = path.relative(path.resolve(baseDir), path.resolve(target));\n  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);\n}',
        why: 'Resolve both, then `path.relative`; reject `..`-prefixed or absolute results. A bare `startsWith(base)` is unsafe — `/base-old` shares the prefix.',
      },
    },
  },
  {
    id: 'second-highest-salary',
    match: /\bsecond\s+(?:highest|largest|max\w*)\b|\bnth\s+highest\b/i,
    defaultLang: 'sql',
    impls: {
      sql: {
        code: 'SELECT salary\nFROM employees\nORDER BY salary DESC\nLIMIT 1 OFFSET 1;\n\n-- handles ties correctly:\nSELECT salary FROM (\n  SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS rnk\n  FROM employees\n) t WHERE rnk = 2;',
        why: '`LIMIT 1 OFFSET 1` skips the top row; `DENSE_RANK` is safer when salaries tie.',
      },
    },
  },
  {
    id: 'largest-files',
    match: /\b(largest|biggest)\b.*\bfiles?\b|\bfiles?\b.*\b(by size|largest|biggest)\b/i,
    defaultLang: 'bash',
    impls: {
      bash: {
        code: 'du -ah . | sort -rh | head -n 5',
        why: '`du -ah` lists sizes, `sort -rh` orders by human-readable size descending, `head` keeps the top 5.',
      },
    },
  },
  {
    id: 'debounce',
    match: /\bdebounce\b|\bsearch\s+input\b.{0,60}\b(?:janky|laggy|slow|fires?\s+too\s+often|every\s+keystroke)\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: 'function debounce(fn, delayMs) {\n  let timer;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), delayMs);\n  };\n}',
        why: 'Each call clears the pending timer and restarts it, so `fn` runs only after calls stop.',
      },
      typescript: {
        code: 'function debounce<A extends unknown[]>(fn: (...a: A) => void, delayMs: number) {\n  let timer: ReturnType<typeof setTimeout> | undefined;\n  return (...args: A) => {\n    if (timer) clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), delayMs);\n  };\n}',
        why: 'Each call clears the pending timer and restarts it, so `fn` runs only after calls stop.',
      },
    },
  },
  {
    id: 'throttle',
    match: /\bthrottle\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: 'function throttle(fn, limitMs) {\n  let last = 0;\n  let timer;\n  return (...args) => {\n    const now = Date.now();\n    const remaining = limitMs - (now - last);\n    if (remaining <= 0) {\n      if (timer) { clearTimeout(timer); timer = undefined; }\n      last = now;\n      fn(...args);\n    } else if (!timer) {\n      timer = setTimeout(() => {\n        last = Date.now();\n        timer = undefined;\n        fn(...args);\n      }, remaining);\n    }\n  };\n}',
        why: 'Runs immediately, then at most once per `limitMs`; the trailing timer guarantees the last call in a burst still fires.',
      },
      typescript: {
        code: 'function throttle<A extends unknown[]>(fn: (...a: A) => void, limitMs: number) {\n  let last = 0;\n  let timer: ReturnType<typeof setTimeout> | undefined;\n  return (...args: A) => {\n    const now = Date.now();\n    const remaining = limitMs - (now - last);\n    if (remaining <= 0) {\n      if (timer) { clearTimeout(timer); timer = undefined; }\n      last = now;\n      fn(...args);\n    } else if (!timer) {\n      timer = setTimeout(() => {\n        last = Date.now();\n        timer = undefined;\n        fn(...args);\n      }, remaining);\n    }\n  };\n}',
        why: 'Runs immediately, then at most once per `limitMs`; the trailing timer guarantees the last call in a burst still fires.',
      },
    },
  },
  {
    id: 'last-element',
    match: /\blast\s+(?:element|item|value|entry)\b|\b(?:element|item)\b.{0,30}\bfrom\s+the\s+end\b|\bnegative\s+index\w*\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: 'const last = arr.at(-1);',
        why: '`Array.prototype.at` (ES2022) accepts negative indexes; `arr[arr.length - 1]` is the legacy spelling.',
      },
      typescript: {
        code: 'const last = arr.at(-1); // T | undefined',
        why: '`Array.prototype.at` (ES2022) accepts negative indexes and types the result as `T | undefined`, which forces an honest empty-array check.',
      },
      python: {
        code: 'last = items[-1]',
        why: 'Python sequences support negative indexing natively; `items[-1]` is the last element (raises `IndexError` when empty).',
      },
      rust: {
        code: 'let last = items.last(); // Option<&T>',
        why: '`slice::last` returns an `Option`, so the empty case is handled explicitly.',
      },
    },
  },
  {
    id: 'fetch-timeout',
    match: /\b(?:timeout|time\s+out)\b.{0,40}\b(?:fetch|request)s?\b|\b(?:fetch|request)s?\b.{0,40}\b(?:timeout|time\s+out)\b|\b(?:cancel|abort)\w*\b.{0,40}\b(?:fetch|request)s?\b|\babort\s*controller\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: '// timeout:\nconst res = await fetch(url, { signal: AbortSignal.timeout(5_000) });\n\n// manual cancellation:\nconst controller = new AbortController();\nconst promise = fetch(url, { signal: controller.signal });\ncontroller.abort(); // rejects the fetch with an AbortError',
        why: '`AbortSignal.timeout` covers the common deadline case in one line; an `AbortController` gives you a handle to cancel on demand. Both are built into browsers and Node 18+.',
      },
      typescript: {
        code: '// timeout:\nconst res = await fetch(url, { signal: AbortSignal.timeout(5_000) });\n\n// manual cancellation:\nconst controller = new AbortController();\nconst promise = fetch(url, { signal: controller.signal });\ncontroller.abort(); // rejects the fetch with an AbortError',
        why: '`AbortSignal.timeout` covers the common deadline case in one line; an `AbortController` gives you a handle to cancel on demand. Both are built into browsers and Node 18+.',
      },
    },
  },
  {
    id: 'sleep',
    match: /\bsleep\b|\bwait\s+(?:for\s+)?\d+\s*(?:ms\b|millisecond|second)|\bpause\s+(?:execution|the\s+(?:script|program))\b/i,
    defaultLang: 'javascript',
    impls: {
      javascript: {
        code: 'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));\nawait sleep(2_000);\n\n// Node only — built in:\nimport { setTimeout as delay } from "node:timers/promises";\nawait delay(2_000);',
        why: 'Wrap `setTimeout` in a promise so it composes with `await`; Node ships this ready-made in `node:timers/promises`.',
      },
      typescript: {
        code: 'const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));\nawait sleep(2_000);',
        why: 'Wrap `setTimeout` in a promise so it composes with `await`; Node ships this ready-made in `node:timers/promises`.',
      },
      python: {
        code: 'import time\ntime.sleep(2)\n\n# inside async code — never block the event loop:\nimport asyncio\nawait asyncio.sleep(2)',
        why: '`time.sleep` blocks the thread; in async code use `asyncio.sleep` so other tasks keep running.',
      },
      bash: {
        code: 'sleep 2',
        why: '`sleep` takes seconds (suffixes like `2m`/`1h` work on GNU coreutils).',
      },
    },
  },
];

const CONCEPT_LABEL: Record<string, string> = {
  'dedupe-array': 'remove duplicate values',
  'merge-dicts': 'merge two dictionaries',
  'reverse-string': 'reverse a string',
  'read-file': 'read a whole file',
  'flatten-list': 'flatten a nested list',
  'count-words': 'count word frequency',
  'sort-numbers': 'sort numbers correctly',
  'deep-clone': 'deep clone',
  'fetch-json': 'fetch JSON from a URL',
  'parallel-async': 'run async calls in parallel',
  'group-by': 'group by a key',
  'pick-type': 'pick a subset of keys',
  'path-containment': 'check path containment safely',
  'second-highest-salary': 'find the second-highest value',
  'largest-files': 'find the largest files',
  'debounce': 'debounce a function',
  'throttle': 'throttle a function',
  'last-element': 'get the last element',
  'fetch-timeout': 'cancel or time out a fetch',
  'sleep': 'pause execution (sleep)',
};

const LANG_NAME: Record<IdiomLang, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  sql: 'SQL',
  bash: 'Bash',
};

/**
 * Resolve a programming-idiom request to a fenced, language-correct answer.
 * Returns null when no idiom matches OR the requested language has no canonical
 * form (declining is better than answering in the wrong language).
 */
/**
 * Prior-turn context carried into a follow-up. `lang` is the language already
 * established earlier in the thread; `idiomId` is the concept the previous
 * idiom answer covered. Both are optional — a standalone turn passes neither.
 */
export type IdiomContext = { lang?: IdiomLang | null; idiomId?: string | null };

// A follow-up that redoes the previous concept in a new language: "now in
// rust", "same in go", "make it typescript", "do it again", "this time in py".
// Requires an explicit language in the same turn (enforced by the caller), so
// this never hijacks an unrelated message into emitting code.
const CONTINUATION_RE = /\b(now|instead|then|this time|again|same|also|too|make it|do it|how about|what about|in)\b/i;

/**
 * Recover idiom/language context from prior conversation turns so follow-ups
 * carry forward correctly. Walks newest → oldest: the language comes from the
 * most recent idiom answer or user message that named one; the concept comes
 * from the most recent idiom answer ("Here's how to <label> in <Lang>:").
 */
export function extractIdiomContext(
  history: ReadonlyArray<{ role: string; content: string }>,
): IdiomContext {
  let lang: IdiomLang | null = null;
  let idiomId: string | null = null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (lang && idiomId) break;
    const m = history[i];
    if (!m || typeof m.content !== 'string') continue;
    if (m.role === 'assistant') {
      const mm = m.content.match(
        /^Here's how to (.+?) in (JavaScript|TypeScript|Python|Rust|Go|SQL|Bash):/,
      );
      if (mm) {
        if (!idiomId) {
          const found = Object.entries(CONCEPT_LABEL).find(([, v]) => v === mm[1].trim());
          if (found) idiomId = found[0];
        }
        if (!lang) {
          const entry = Object.entries(LANG_NAME).find(([, v]) => v === mm[2]);
          if (entry) lang = entry[0] as IdiomLang;
        }
      }
    } else if (m.role === 'user' && !lang) {
      const l = detectRequestedLang(m.content);
      if (l) lang = l;
    }
  }
  return { lang, idiomId };
}

// Cues that a prompt is asking to *contrast* concepts rather than to receive
// one canonical snippet ("difference between A and B", "A vs B", "compared to").
const COMPARISON_CUE_RE =
  /\b(vs\.?|versus|compared?\s+to|comparison|differ(?:ence|ences|s)?|trade[\s-]?offs?|pros\s+and\s+cons)\b/i;

/**
 * True when the request can't be answered honestly by a single idiom snippet:
 * it either explicitly asks for a contrast, or it names two or more distinct
 * idiom concepts (e.g. "debounce and throttle"). Emitting one concept's snippet
 * for these silently drops the rest of the question, so the resolver declines
 * and the richer reasoning path takes over.
 *
 * Carry-forward follow-ups ("now in rust") never trip this: they name one
 * concept and carry no comparison cue.
 */
export function isMultiConceptOrComparison(content: string): boolean {
  const text = (content || '').trim();
  if (!text) return false;
  if (COMPARISON_CUE_RE.test(text)) return true;
  let distinct = 0;
  for (const idiom of IDIOMS) {
    if (idiom.match.test(text)) {
      distinct += 1;
      if (distinct >= 2) return true;
    }
  }
  return false;
}

export function resolveProgrammingIdiom(
  content: string,
  prior?: IdiomContext,
): { reply: string; kind: 'code-snippet' } | null {
  const text = (content || '').trim();
  if (!text) return null;

  // A comparison or multi-concept ask can't be served by a single snippet —
  // decline so the reasoning path can cover every part of the question.
  if (isMultiConceptOrComparison(text)) return null;

  const explicit = detectRequestedLang(text);

  let idiom = IDIOMS.find((entry) => entry.match.test(text)) ?? null;
  // Topic carry-forward: a follow-up that names a language but no concept
  // ("now in rust", "make it typescript") reuses the previous idiom. Gated by
  // an explicit language AND a continuation cue so unrelated turns are never
  // pulled into emitting code.
  if (!idiom && prior?.idiomId && explicit && CONTINUATION_RE.test(text)) {
    idiom = IDIOMS.find((entry) => entry.id === prior.idiomId) ?? null;
  }
  if (!idiom) return null;

  // Language resolution, in priority order:
  //   1. an explicit language in THIS turn (decline if unsupported — honest),
  //   2. the language carried forward from earlier in the thread,
  //   3. the idiom's own default.
  let lang: IdiomLang | undefined;
  if (explicit) {
    lang = idiom.impls[explicit] ? explicit : undefined;
  } else if (prior?.lang && idiom.impls[prior.lang]) {
    lang = prior.lang;
  } else {
    lang = idiom.defaultLang;
  }
  if (!lang) return null;

  const impl = idiom.impls[lang];
  if (!impl) return null;

  const label = CONCEPT_LABEL[idiom.id] ?? 'do that';
  const reply = `Here's how to ${label} in ${LANG_NAME[lang]}:\n\n\`\`\`${FENCE[lang]}\n${impl.code}\n\`\`\`\n\n${impl.why}`;
  return { reply, kind: 'code-snippet' };
}

/**
 * Extract the two operands of a comparison ("difference between A and B",
 * "compare A and B", "A vs B"), or null. Operands may be multi-word; leading
 * articles and trailing punctuation are stripped. Deliberately conservative so
 * non-comparison prompts pass through untouched.
 */
export function comparisonOperands(content: string): [string, string] | null {
  const s = (content || '').trim();
  if (!s) return null;
  const tail = '(?:[?.!,;:]|$|\\s+(?:in|for|when|with|give|show|explain|using|on)\\b)';
  const m =
    s.match(new RegExp(`\\b(?:difference[s]?|distinction|tradeoffs?|trade-offs?)\\s+between\\s+(.+?)\\s+and\\s+(.+?)${tail}`, 'i'))
    ?? s.match(new RegExp(`\\bcompare\\s+(.+?)\\s+(?:and|to|with|vs\\.?|versus)\\s+(.+?)${tail}`, 'i'))
    ?? s.match(/\b([a-z0-9][a-z0-9.+#_-]*(?:\s+[a-z0-9.+#_-]+){0,2})\s+(?:vs\.?|versus)\s+([a-z0-9][a-z0-9.+#_-]*(?:\s+[a-z0-9.+#_-]+){0,2})\b/i);
  if (!m) return null;
  const clean = (x: string) => x.trim().replace(/^(?:a|an|the)\s+/i, '').replace(/[?.!]+$/, '').trim();
  const a = clean(m[1]);
  const b = clean(m[2]);
  if (a.length < 2 || b.length < 2) return null;
  return [a, b];
}

/**
 * True when the prompt enumerates 3+ comparison subjects ("compare A, B, and C").
 * A two-way curated pair / idiom comparison must NOT hijack these — answering
 * "A vs B" for a four-way question silently drops the rest. Detected by a comma
 * appearing *among the items* (after the compare trigger, before the first
 * joining "and"/"vs"), so "difference between A and B, and which is faster" — a
 * genuine 2-way with a trailing clause — is correctly NOT flagged.
 */
export function isMultiWayComparison(content: string): boolean {
  const s = (content || '').toLowerCase();
  // Only prefix triggers drive this: an infix "A vs B" is inherently binary, and
  // its trailing clause ("A vs B, which is faster?") must not be misread as a
  // 3-item list. The items run from after the trigger to the first joining word.
  const trigger = s.match(/\bcompar(?:e|es|ed|ing|ison)\b|\bdifference[s]?\s+between\b/);
  if (!trigger) return false;
  const after = s.slice((trigger.index ?? 0) + trigger[0].length);
  const firstJoin = after.search(/\b(?:and|vs\.?|versus)\b/);
  const itemsSpan = firstJoin < 0 ? after : after.slice(0, firstJoin);
  return itemsSpan.includes(',');
}

/** Resolve a SINGLE concept (one comparison operand) to its idiom parts. */
export function resolveIdiomExplanation(
  operand: string,
  lang?: IdiomLang | null,
): { label: string; lang: IdiomLang; code: string; why: string } | null {
  const text = (operand || '').trim();
  if (!text) return null;
  const idiom = IDIOMS.find((entry) => entry.match.test(text));
  if (!idiom) return null;
  const l: IdiomLang = lang && idiom.impls[lang] ? lang : idiom.defaultLang;
  const impl = idiom.impls[l];
  if (!impl) return null;
  return { label: CONCEPT_LABEL[idiom.id] ?? idiom.id, lang: l, code: impl.code, why: impl.why };
}

/** A concise, runtime-sourced explanation of one concept (one side of a compare). */
export type ConceptExplanation = { summary: string; code?: string; lang?: IdiomLang };
/** Pluggable concept explainer — lets callers inject live corpus knowledge. */
export type ConceptExplainer = (concept: string) => ConceptExplanation | null;

/**
 * Compose a grounded, two-sided comparison — e.g. "difference between debounce
 * and throttle". Each side is resolved INDEPENDENTLY and dynamically: an injected
 * `explain` (live corpus knowledge) is tried first, then the canonical idiom
 * table. Returns null unless BOTH sides resolve, so it never fabricates a
 * contrast it can't ground. Self-adjusting: as the injected source learns more
 * concepts, more pairs become comparable with no code change.
 */
export function composeIdiomComparison(content: string, explain?: ConceptExplainer): string | null {
  const text = (content || '').trim();
  if (!text) return null;
  // A 3+ way comparison can't be served by a two-sided composer — defer.
  if (isMultiWayComparison(text)) return null;
  const ops = comparisonOperands(text);
  if (!ops) return null;

  const lang = detectRequestedLang(text);
  const resolve = (operand: string): { label: string; summary: string; code?: string; lang?: IdiomLang } | null => {
    const injected = explain?.(operand);
    if (injected && injected.summary && injected.summary.trim().length > 0) {
      return { label: operand, summary: injected.summary.trim(), code: injected.code, lang: injected.lang };
    }
    const parts = resolveIdiomExplanation(operand, lang);
    if (parts) return { label: parts.label, summary: parts.why, code: parts.code, lang: parts.lang };
    return null;
  };

  const a = resolve(ops[0]);
  const b = resolve(ops[1]);
  if (!a || !b) return null;
  const normalizeSummary = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalizeSummary(a.summary) === normalizeSummary(b.summary)) return null;

  const title = (s: string) => s.replace(/\b\w/, (c) => c.toUpperCase());
  const block = (p: { label: string; summary: string; code?: string; lang?: IdiomLang }) => {
    const head = `**${title(p.label)}** — ${p.summary}`;
    return p.code ? `${head}\n\n\`\`\`${FENCE[p.lang ?? 'javascript']}\n${p.code}\n\`\`\`` : head;
  };

  return `**${title(a.label)} vs ${title(b.label)}**\n\n${block(a)}\n\n${block(b)}`;
}

export default {
  resolveProgrammingIdiom,
  detectRequestedLang,
  extractIdiomContext,
  isMultiConceptOrComparison,
  isMultiWayComparison,
  comparisonOperands,
  resolveIdiomExplanation,
  composeIdiomComparison,
};
