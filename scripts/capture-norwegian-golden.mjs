#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { VaiEngine } from '../packages/core/src/models/vai-engine.ts';

const e = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });
const probes = [
  // grammar-tutor triggers (these actually fire the method's branches)
  'bøy verbet å gå', 'preteritum av å spise', 'past tense of å være',
  'conjugate å komme', 'bøy også å lese', 'presens av å skrive',
  'er å spise et sterkt eller svakt verb', 'hva er ordstilling på norsk',
  'forklar bestemt og ubestemt form', 'hva er et substantiv',
  'skriv en formell e-post på norsk', 'hva er hankjønn hunkjønn intetkjønn',
  'forklar leddsetning og bisetning', 'hva er modalverb',
  'bøy verbet å jobbe', 'preteritum av å snakke', 'hva er inversjon',
  'forklar passiv på norsk', 'norsk grammatikk regler', 'hva er en preposisjon',
  // negative controls (should stay null)
  'what is gerund in english', 'hello', 'what is 2 plus 2',
];
const out = {};
for (const p of probes) {
  let v; try { v = e.tryNorwegianLanguage(p); } catch (err) { v = '__THREW__:' + err.message; }
  out['tryNorwegianLanguage::' + JSON.stringify(p)] = v == null ? '__NULL__' : v;
}
for (const [a, b] of [['A', 'the answer is A'], ['første', 'alternativ en'], ['2', 'option two here'], ['x', 'no match']]) {
  out['findOptionLetter::' + a] = e.findOptionLetter(a, b);
}
const dest = process.argv[2] || 'c:/tmp/no-golden.json';
writeFileSync(dest, JSON.stringify(out, null, 2));
const nn = Object.values(out).filter((v) => v !== '__NULL__' && !String(v).startsWith('__')).length;
console.log(`captured ${Object.keys(out).length} outputs, ${nn} non-null, ${Object.values(out).reduce((a, v) => a + String(v).length, 0)} chars -> ${dest}`);
