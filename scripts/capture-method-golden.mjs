#!/usr/bin/env node
/**
 * capture-method-golden — snapshot the output of a set of pure (input:string)=>string|null
 * VaiEngine methods across a battery of probe inputs. Run BEFORE and AFTER extraction;
 * outputs must be byte-identical.
 *
 * Usage: capture-method-golden.mjs <out.json> <method1> <method2> ...
 */
import { writeFileSync } from 'fs';
import { VaiEngine } from '../packages/core/src/models/vai-engine.ts';

const [, , dest, ...methods] = process.argv;
if (!dest || methods.length === 0) { console.error('usage: <out.json> <method...>'); process.exit(1); }

const engine = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });

// Broad probe set: hits many knowledge/fact/code domains so each method's branches fire.
const probes = [
  '', 'hello', 'what is react', 'explain next.js app router', 'how do I use prisma with postgres',
  'tailwind css setup', 'what is the capital of france', 'who invented the telephone',
  'tell me about binary search', 'explain big o notation', 'what is a hash map',
  'difference between tcp and udp', 'how does https work', 'what is recursion',
  'write a function to reverse a string', 'fix this error: cannot read property of undefined',
  'review my code', 'what is the population of japan', 'when did world war 2 end',
  'explain rest vs graphql', 'how to center a div', 'what is docker',
  'vue 3 composition api', 'express middleware example', 'mongodb vs postgres',
  'what is the speed of light', 'who wrote hamlet', 'explain closures in javascript',
  'what is the largest planet', 'how do promises work', 'svelte vs react',
];

const out = {};
for (const name of methods) {
  const fn = (engine)[name];
  if (typeof fn !== 'function') { out[`${name}::__missing__`] = '__MISSING_METHOD__'; continue; }
  for (const p of probes) {
    let v;
    try { v = fn.call(engine, p); } catch (e) { v = `__THREW__: ${e.message}`; }
    out[`${name}::${JSON.stringify(p)}`] = v === null || v === undefined ? '__NULL__' : v;
  }
}

writeFileSync(dest, JSON.stringify(out, null, 2));
const nonNull = Object.values(out).filter((v) => v !== '__NULL__' && typeof v === 'string' && !v.startsWith('__')).length;
const total = Object.values(out).reduce((a, v) => a + (typeof v === 'string' ? v.length : 0), 0);
console.log(`captured ${Object.keys(out).length} outputs (${nonNull} non-null) -> ${dest}, ${total} chars`);
