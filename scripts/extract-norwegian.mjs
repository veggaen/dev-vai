#!/usr/bin/env node
/**
 * extract-norwegian — Slice 5. Move tryNorwegianLanguage (1,077 lines) + its only
 * dependency findOptionLetter (11 lines, pure) into norwegian-language.ts.
 *
 * tryNorwegianLanguage uses exactly one this.member: this.findOptionLetter (9 calls).
 * We co-extract that helper, so inside the new module the call becomes a bare
 * findOptionLetter(...) — no deps-as-params needed. VaiEngine keeps thin wrappers
 * for BOTH (so any other call sites still work). AST-based; behavior-preserving.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const ENGINE = 'packages/core/src/models/vai-engine.ts';
const OUT = 'packages/core/src/models/norwegian-language.ts';
const ALIAS = 'norwegianMod';
if (existsSync(OUT)) { console.error(`REFUSING: ${OUT} exists.`); process.exit(1); }

const src = readFileSync(ENGINE, 'utf8');
const sf = ts.createSourceFile(ENGINE, src, ts.ScriptTarget.Latest, true);
let cls = null;
sf.forEachChild((n) => { if (ts.isClassDeclaration(n) && n.name?.text === 'VaiEngine') cls = n; });

const byName = {};
for (const m of cls.members) {
  if (ts.isMethodDeclaration(m) && m.name && ts.isIdentifier(m.name)) byName[m.name.text] = m;
}
const main = byName['tryNorwegianLanguage'];
const helper = byName['findOptionLetter'];
if (!main || !helper) { console.error('methods not found'); process.exit(1); }

// Build a free function from a method node, optionally rewriting `this.findOptionLetter(`
// -> `findOptionLetter(` within its text (only the helper call, nothing else).
function toFreeFn(m, rewriteHelper) {
  const fromName = src.slice(m.name.getStart(sf), m.end);
  const asyncMod = m.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
  let text = `export ${asyncMod}function ${fromName}`;
  if (rewriteHelper) {
    text = text.replace(/this\.findOptionLetter\(/g, 'findOptionLetter(');
  }
  return text;
}

const freeMain = toFreeFn(main, true);
const freeHelper = toFreeFn(helper, false);

// Carry imports the extracted code references (e.g. types). Name-based; tsc is the gate.
const blob = freeMain + '\n' + freeHelper;
const usedIdents = new Set((blob.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) || []));
const neededImports = [];
for (const s of sf.statements) {
  if (!ts.isImportDeclaration(s) || !s.importClause) continue;
  const spec = s.moduleSpecifier.getText(sf);
  const nb = s.importClause.namedBindings;
  if (nb && ts.isNamedImports(nb)) {
    const keep = nb.elements.filter((el) => usedIdents.has(el.name.text));
    if (keep.length) {
      const typeOnly = s.importClause.isTypeOnly ? 'type ' : '';
      neededImports.push(`import ${typeOnly}{ ${keep.map((el) => el.getText(sf)).join(', ')} } from ${spec};`);
    }
  }
}
const importBlock = neededImports.length ? neededImports.join('\n') + '\n\n' : '';

const header = `/**
 * norwegian-language — Norwegian grammar tutor (verb conjugation, word classes,
 * formal email + academic writing help) extracted from VaiEngine (vai-engine.ts).
 * tryNorwegianLanguage + its sole helper findOptionLetter, moved verbatim (the one
 * this.findOptionLetter call became a bare sibling call). Behavior-preserving;
 * proven by scripts/capture-norwegian-golden.mjs.
 */
/* eslint-disable */

`;
writeFileSync(OUT, header + importBlock + freeMain + '\n\n' + freeHelper + '\n');

// Replace BOTH methods in the engine with thin delegating wrappers.
const edits = [];
for (const [m, name] of [[main, 'tryNorwegianLanguage'], [helper, 'findOptionLetter']]) {
  const params = m.parameters.map((p) => p.name.getText(sf)).join(', ');
  const sigText = src.slice(m.getStart(sf), m.body.getStart(sf) + 1);
  edits.push({ start: m.getStart(sf), end: m.end, text: `${sigText}\n    return ${ALIAS}.${name}(${params});\n  }` });
}
edits.sort((a, b) => b.start - a.start);
let engineOut = src;
for (const e of edits) engineOut = engineOut.slice(0, e.start) + e.text + engineOut.slice(e.end);

const importEnd = (() => { let last = 0; sf.statements.forEach((s) => { if (ts.isImportDeclaration(s)) last = Math.max(last, s.end); }); return last; })();
engineOut = engineOut.slice(0, importEnd) + `\nimport * as ${ALIAS} from './norwegian-language.js';` + engineOut.slice(importEnd);
writeFileSync(ENGINE, engineOut);

console.log(`Extracted tryNorwegianLanguage + findOptionLetter -> ${OUT}`);
console.log(`carried imports: ${neededImports.length}`);
