#!/usr/bin/env node
/**
 * capture-builder-golden — snapshot the output of every pure generateBuilder* method
 * from the CURRENT VaiEngine, so we can prove byte-identical behavior after extraction.
 * Run BEFORE and AFTER; the two JSON outputs must be identical.
 */
import { readFileSync, writeFileSync } from 'fs';
import { VaiEngine } from '../packages/core/src/models/vai-engine.ts';

const manifest = JSON.parse(readFileSync('c:/tmp/pure-methods.json', 'utf8'));
const engine = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });

// Representative args per signature shape. Pure methods ignore most of these,
// but we pass realistic values so any accidental arg-use is caught.
const argFor = (name) => {
  if (name === 'generateBuilderSpecializedViteApp') {
    return [{ kind: 'dashboard', title: 'Demo', desc: 'a demo app', accent: 'violet' }];
  }
  if (name === 'generateBuilderSharedShoppingProductApp') return ['a shared shopping app', false];
  if (name === 'generateBuilderNextjsDefaultStarter') return ['Intro line.'];
  return ['build me a sample app'];
};

const out = {};
for (const { name } of manifest) {
  const fn = (engine)[name];
  if (typeof fn !== 'function') { out[name] = `__MISSING__`; continue; }
  try {
    out[name] = fn.apply(engine, argFor(name));
  } catch (e) {
    out[name] = `__THREW__: ${e.message}`;
  }
}

const dest = process.argv[2] || 'c:/tmp/builder-golden.json';
writeFileSync(dest, JSON.stringify(out, null, 2));
const sizes = Object.values(out).map((v) => typeof v === 'string' ? v.length : 0);
console.log(`captured ${Object.keys(out).length} method outputs -> ${dest}`);
console.log(`total chars: ${sizes.reduce((a, b) => a + b, 0)}, missing/threw: ${Object.values(out).filter((v) => typeof v === 'string' && v.startsWith('__')).length}`);
