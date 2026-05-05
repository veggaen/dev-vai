#!/usr/bin/env node
/**
 * Corpus build pipeline.
 *
 *   node scripts/build-corpus.mjs lint    — validate MD files, fail loud
 *   node scripts/build-corpus.mjs build   — lint then emit eval/generated/corpus.ts
 *   node scripts/build-corpus.mjs         — same as build
 *
 * MD files live under eval/corpus-md/<category>/<id>.md.
 * Generated TS goes to eval/generated/corpus.ts (DO NOT EDIT).
 *
 * Schema (frontmatter):
 *   id, title, version, pattern (H↔M | M↔M | AI↔AI),
 *   category (cognitive | creative | project | multi-turn | audience | regression),
 *   tags: [], weight: number, expected_status: active | pending-feature,
 *   budget: { max_ms, max_chars },
 *   turns: [{ role, say, must, must_not, min_len, max_len }]
 *   expected_behavior, pass_criteria, fail_criteria
 *
 * Regex shape (explicit):
 *   must: [{ pattern: 'box\\s*a\\b', flags: 'i' }]
 *
 * Every regex is compiled at lint time so build-time parse errors surface early.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const MD_ROOT = join(ROOT, 'eval', 'corpus-md');
const OUT_FILE = join(ROOT, 'eval', 'generated', 'corpus.ts');

const VALID_PATTERNS = new Set(['H↔M', 'M↔M', 'AI↔AI']);
const VALID_CATEGORIES = new Set(['cognitive', 'creative', 'project', 'multi-turn', 'audience', 'regression']);
const VALID_STATUSES = new Set(['active', 'pending-feature']);
const VALID_ROLES = new Set(['user', 'assistant']);
const REQUIRED_TOP = ['id', 'title', 'version', 'pattern', 'category', 'expected_status', 'turns'];

function walkMd(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkMd(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

function parseFrontmatter(raw, file) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing YAML frontmatter (--- delimiters)`);
  let data;
  try {
    data = yaml.parse(m[1]);
  } catch (e) {
    throw new Error(`${file}: YAML parse error — ${e.message}`);
  }
  return { data, body: m[2] };
}

function gitLastCommit(file) {
  try {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    return execSync(`git log -1 --format=%cI -- "${rel}"`, { cwd: ROOT, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function lintRegexEntry(r, file, where) {
  if (typeof r === 'string') {
    throw new Error(`${file}: ${where}: regex must be { pattern, flags } object, not bare string "${r}"`);
  }
  if (!r || typeof r.pattern !== 'string') {
    throw new Error(`${file}: ${where}: missing string "pattern" field`);
  }
  const flags = r.flags ?? '';
  if (typeof flags !== 'string') {
    throw new Error(`${file}: ${where}: "flags" must be a string`);
  }
  try {
    new RegExp(r.pattern, flags);
  } catch (e) {
    throw new Error(`${file}: ${where}: regex compile error — ${e.message}  (pattern=${JSON.stringify(r.pattern)}, flags=${JSON.stringify(flags)})`);
  }
}

function lintCase(data, file) {
  for (const k of REQUIRED_TOP) {
    if (data[k] === undefined || data[k] === null) {
      throw new Error(`${file}: missing required field "${k}"`);
    }
  }
  if (typeof data.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(data.id)) {
    throw new Error(`${file}: id "${data.id}" must be kebab-case (lowercase, hyphenated)`);
  }
  if (!VALID_PATTERNS.has(data.pattern)) {
    throw new Error(`${file}: pattern "${data.pattern}" must be one of ${[...VALID_PATTERNS].join(', ')}`);
  }
  if (!VALID_CATEGORIES.has(data.category)) {
    throw new Error(`${file}: category "${data.category}" must be one of ${[...VALID_CATEGORIES].join(', ')}`);
  }
  if (!VALID_STATUSES.has(data.expected_status)) {
    throw new Error(`${file}: expected_status "${data.expected_status}" must be one of ${[...VALID_STATUSES].join(', ')}`);
  }
  if (!Number.isInteger(data.version) || data.version < 1) {
    throw new Error(`${file}: version must be a positive integer`);
  }
  if (!Array.isArray(data.turns) || data.turns.length === 0) {
    throw new Error(`${file}: turns must be a non-empty list`);
  }
  data.tags = Array.isArray(data.tags) ? data.tags : [];
  data.weight = typeof data.weight === 'number' ? data.weight : 1.0;
  data.budget = data.budget ?? {};
  data.budget.max_ms = data.budget.max_ms ?? 5000;
  data.budget.max_chars = data.budget.max_chars ?? 4000;

  data.turns.forEach((t, i) => {
    const where = `turn[${i}]`;
    if (!VALID_ROLES.has(t.role)) {
      throw new Error(`${file}: ${where}.role "${t.role}" must be one of ${[...VALID_ROLES].join(', ')}`);
    }
    if (typeof t.say !== 'string' || !t.say.trim()) {
      throw new Error(`${file}: ${where}.say must be a non-empty string`);
    }
    for (const r of t.must ?? []) lintRegexEntry(r, file, `${where}.must`);
    for (const r of t.must_not ?? []) lintRegexEntry(r, file, `${where}.must_not`);
    if (t.min_len != null && (!Number.isInteger(t.min_len) || t.min_len < 0)) {
      throw new Error(`${file}: ${where}.min_len must be a non-negative integer`);
    }
    if (t.max_len != null && (!Number.isInteger(t.max_len) || t.max_len < 1)) {
      throw new Error(`${file}: ${where}.max_len must be a positive integer`);
    }
  });
}

function lintAll() {
  const files = walkMd(MD_ROOT);
  if (!files.length) {
    console.error(`[corpus:lint] no MD files under ${MD_ROOT}`);
    process.exit(1);
  }
  const ids = new Map();
  const errors = [];
  const cases = [];
  for (const file of files) {
    try {
      const { data } = parseFrontmatter(readFileSync(file, 'utf8'), file);
      lintCase(data, file);
      if (ids.has(data.id)) {
        errors.push(`${file}: duplicate id "${data.id}" (also in ${ids.get(data.id)})`);
        continue;
      }
      ids.set(data.id, file);
      cases.push({ data, file });
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (errors.length) {
    console.error(`[corpus:lint] ${errors.length} error(s):`);
    for (const e of errors) console.error('  ✗ ' + e);
    process.exit(1);
  }
  console.log(`[corpus:lint] ${cases.length} case(s) validated, ${[...ids].length} unique ids.`);
  return cases;
}

function build(cases) {
  const sorted = [...cases].sort((a, b) => a.data.id.localeCompare(b.data.id));
  const lines = [
    '// AUTO-GENERATED — DO NOT EDIT.',
    '// Edit MD files under eval/corpus-md/, then run `pnpm corpus:build`.',
    '// Source: build via scripts/build-corpus.mjs',
    '',
    'export interface CorpusRegex { pattern: string; flags: string }',
    'export interface CorpusTurn {',
    "  role: 'user' | 'assistant';",
    '  say: string;',
    '  must: CorpusRegex[];',
    '  must_not: CorpusRegex[];',
    '  min_len?: number;',
    '  max_len?: number;',
    '}',
    'export interface CorpusCase {',
    '  id: string;',
    '  title: string;',
    '  version: number;',
    '  updatedAt: string | null;',
    "  pattern: 'H↔M' | 'M↔M' | 'AI↔AI';",
    "  category: 'cognitive' | 'creative' | 'project' | 'multi-turn' | 'audience' | 'regression';",
    '  tags: string[];',
    '  weight: number;',
    "  expectedStatus: 'active' | 'pending-feature';",
    '  budget: { maxMs: number; maxChars: number };',
    '  turns: CorpusTurn[];',
    '  expectedBehavior: string;',
    '  passCriteria: string;',
    '  failCriteria: string;',
    '  sourceFile: string;',
    '}',
    '',
    'export const CORPUS: CorpusCase[] = [',
  ];
  for (const { data, file } of sorted) {
    const updatedAt = gitLastCommit(file);
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    lines.push('  {');
    lines.push(`    id: ${JSON.stringify(data.id)},`);
    lines.push(`    title: ${JSON.stringify(data.title)},`);
    lines.push(`    version: ${data.version},`);
    lines.push(`    updatedAt: ${JSON.stringify(updatedAt)},`);
    lines.push(`    pattern: ${JSON.stringify(data.pattern)},`);
    lines.push(`    category: ${JSON.stringify(data.category)},`);
    lines.push(`    tags: ${JSON.stringify(data.tags)},`);
    lines.push(`    weight: ${data.weight},`);
    lines.push(`    expectedStatus: ${JSON.stringify(data.expected_status)},`);
    lines.push(`    budget: { maxMs: ${data.budget.max_ms}, maxChars: ${data.budget.max_chars} },`);
    lines.push('    turns: [');
    for (const t of data.turns) {
      lines.push('      {');
      lines.push(`        role: ${JSON.stringify(t.role)},`);
      lines.push(`        say: ${JSON.stringify(t.say)},`);
      lines.push(`        must: ${JSON.stringify(t.must ?? [])},`);
      lines.push(`        must_not: ${JSON.stringify(t.must_not ?? [])},`);
      if (t.min_len != null) lines.push(`        min_len: ${t.min_len},`);
      if (t.max_len != null) lines.push(`        max_len: ${t.max_len},`);
      lines.push('      },');
    }
    lines.push('    ],');
    lines.push(`    expectedBehavior: ${JSON.stringify(data.expected_behavior ?? '')},`);
    lines.push(`    passCriteria: ${JSON.stringify(data.pass_criteria ?? '')},`);
    lines.push(`    failCriteria: ${JSON.stringify(data.fail_criteria ?? '')},`);
    lines.push(`    sourceFile: ${JSON.stringify(rel)},`);
    lines.push('  },');
  }
  lines.push('];', '');

  if (!existsSync(dirname(OUT_FILE))) mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');
  console.log(`[corpus:build] wrote ${sorted.length} case(s) to ${relative(ROOT, OUT_FILE).replace(/\\/g, '/')}`);
}

const mode = process.argv[2] ?? 'build';
if (mode === 'lint') {
  lintAll();
} else if (mode === 'build') {
  const cases = lintAll();
  build(cases);
} else {
  console.error(`unknown mode "${mode}" — use lint or build`);
  process.exit(1);
}
