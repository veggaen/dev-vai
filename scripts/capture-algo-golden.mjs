#!/usr/bin/env node
/**
 * capture-algo-golden — snapshot VaiEngine.algoTemplate(algo, lang) across every
 * algorithm key and a set of langs that exercise each lookup branch
 * (python/javascript = direct hit, typescript = fence-rewrite fallback,
 * rust = unknown-lang fallback chain). Run BEFORE and AFTER the data extraction;
 * outputs must be byte-identical.
 */
import { readFileSync, writeFileSync } from 'fs';
import { VaiEngine } from '../packages/core/src/models/vai-engine.ts';

const { algos } = JSON.parse(readFileSync('c:/tmp/algo-manifest.json', 'utf8'));
const langs = ['python', 'javascript', 'typescript', 'rust']; // last = unknown → fallback chain
const engine = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });
const algoTemplate = (engine).algoTemplate.bind(engine);

const out = {};
for (const algo of algos) {
  for (const lang of langs) {
    let v;
    try { v = algoTemplate(algo, lang); } catch (e) { v = `__THREW__: ${e.message}`; }
    // null is a legitimate return (no impl); record it distinctly.
    out[`${algo}::${lang}`] = v === null || v === undefined ? '__NULL__' : v;
  }
}

const dest = process.argv[2] || 'c:/tmp/algo-golden.json';
writeFileSync(dest, JSON.stringify(out, null, 2));
const total = Object.values(out).reduce((a, v) => a + (typeof v === 'string' ? v.length : 0), 0);
const nulls = Object.values(out).filter((v) => v === '__NULL__').length;
console.log(`captured ${Object.keys(out).length} (algo×lang) outputs -> ${dest}`);
console.log(`total chars: ${total}, nulls: ${nulls}, threw: ${Object.values(out).filter((v) => typeof v === 'string' && v.startsWith('__THREW__')).length}`);
