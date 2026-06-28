#!/usr/bin/env node
/**
 * capture-emitters-golden — snapshot the pure code-emitter methods (Slice 4) across
 * their varied signatures. Run BEFORE and AFTER extraction; must be byte-identical.
 */
import { writeFileSync } from 'fs';
import { VaiEngine } from '../packages/core/src/models/vai-engine.ts';

const engine = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });
const call = (name, ...args) => {
  const fn = (engine)[name];
  if (typeof fn !== 'function') return '__MISSING__';
  try { const v = fn.apply(engine, args); return v === null || v === undefined ? '__NULL__' : v; }
  catch (e) { return `__THREW__: ${e.message}`; }
};

const LANGS = ['python', 'javascript', 'typescript', 'rust', 'go'];
const out = {};

// lang-keyed emitters
for (const name of ['generateLinkedList', 'generateTodoList', 'generateCalculator', 'generateHttpServer',
  'generateFizzBuzz', 'generateCounter', 'generateGuessingGame', 'generateHelloWorld', 'generateSumFunction']) {
  for (const lang of LANGS) out[`${name}::${lang}`] = call(name, lang);
}

// desc-keyed emitters
for (const name of ['generateWebsite', 'generateChatApp', 'generateLoginPage', 'generateBlog', 'generateDashboard']) {
  for (const desc of ['a simple app', 'a portfolio site', 'a dark dashboard for founders']) {
    out[`${name}::${JSON.stringify(desc)}`] = call(name, desc);
  }
}

// multi-arg / special emitters
out['generateAdvancedCalculatorUI'] = call('generateAdvancedCalculatorUI');
for (const lang of LANGS) {
  out[`generateStructCode::${lang}`] = call('generateStructCode', lang, 'User', 'a user struct');
  out[`generateInterfaceCode::${lang}`] = call('generateInterfaceCode', lang, 'User', 'a user interface');
  out[`generateGenericFunction::${lang}`] = call('generateGenericFunction', lang, 'process the data', false);
  out[`generateCProgram::${lang}`] = call('generateCProgram', 'a hello program');
  out[`generateRestApi::${lang}`] = call('generateRestApi', 'an inventory api', lang);
  out[`generateUtilitySnippet::${lang}`] = call('generateUtilitySnippet', 'debounce helper', lang);
}

const dest = process.argv[2] || 'c:/tmp/emitters-golden.json';
writeFileSync(dest, JSON.stringify(out, null, 2));
const nonNull = Object.values(out).filter((v) => v !== '__NULL__' && typeof v === 'string' && !v.startsWith('__')).length;
const total = Object.values(out).reduce((a, v) => a + (typeof v === 'string' ? v.length : 0), 0);
console.log(`captured ${Object.keys(out).length} outputs (${nonNull} non-null) -> ${dest}, ${total} chars`);
