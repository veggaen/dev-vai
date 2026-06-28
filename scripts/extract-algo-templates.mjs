#!/usr/bin/env node
/**
 * extract-algo-templates — move the 224-entry `templates` data object out of
 * VaiEngine.algoTemplate (a 9,279-line method that is ~99% inline code-sample data)
 * into a standalone data module `algo-templates.ts`. The method keeps only its
 * ~14-line lookup logic, referencing the imported ALGO_TEMPLATES.
 *
 * AST-based for exact span boundaries (braces appear inside the code strings).
 * Behavior-preserving: the object text is moved verbatim; proven byte-identical
 * by capture-algo-golden.mjs.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const ENGINE = 'packages/core/src/models/vai-engine.ts';
const OUT = 'packages/core/src/models/algo-templates.ts';

if (existsSync(OUT)) { console.error(`REFUSING: ${OUT} exists.`); process.exit(1); }

const src = readFileSync(ENGINE, 'utf8');
const sf = ts.createSourceFile(ENGINE, src, ts.ScriptTarget.Latest, true);

let cls = null;
sf.forEachChild((n) => { if (ts.isClassDeclaration(n) && n.name?.text === 'VaiEngine') cls = n; });

let method = null;
for (const m of cls.members) {
  if (ts.isMethodDeclaration(m) && m.name?.getText(sf) === 'algoTemplate') method = m;
}
if (!method) { console.error('algoTemplate not found'); process.exit(1); }

// Find `const templates ... = { ... }` declaration inside the method.
let templatesDecl = null;
const findTemplates = (n) => {
  if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'templates' && n.initializer
      && ts.isObjectLiteralExpression(n.initializer)) {
    templatesDecl = n;
  }
  ts.forEachChild(n, findTemplates);
};
findTemplates(method.body);
if (!templatesDecl) { console.error('templates declaration not found'); process.exit(1); }

// The declared type annotation (Record<...>) — reuse it for the exported const.
const typeText = templatesDecl.type ? templatesDecl.type.getText(sf) : null;
const objText = src.slice(templatesDecl.initializer.getStart(sf), templatesDecl.initializer.end);

// Build the data module.
const typeAlias = typeText
  ? `export type AlgoTemplateTable = ${typeText};\n\n`
  : '';
const constType = typeText ? ': AlgoTemplateTable' : '';
const header = `/**
 * algo-templates — algorithm code-sample data, keyed by algorithm name then language.
 *
 * Extracted verbatim from VaiEngine.algoTemplate (vai-engine.ts), where this
 * 224-entry table made the method 9,279 lines (~18% of the whole engine file).
 * Pure data: { [algo]: { [lang]: { title, code, desc } } }. The lookup logic stays
 * in algoTemplate, which now reads from ALGO_TEMPLATES. Kept byte-identical to the
 * original (proven by scripts/capture-algo-golden.mjs).
 */
/* eslint-disable */

`;
writeFileSync(OUT, header + typeAlias + `export const ALGO_TEMPLATES${constType} = ${objText};\n`);

// Replace the initializer in the engine with a reference to ALGO_TEMPLATES.
// Keep the original declaration's name + type; swap only the initializer text.
let engineOut = src.slice(0, templatesDecl.initializer.getStart(sf))
  + 'ALGO_TEMPLATES'
  + src.slice(templatesDecl.initializer.end);

// Add the import after the last import statement.
const importEnd = (() => {
  let last = 0;
  sf.statements.forEach((s) => { if (ts.isImportDeclaration(s)) last = Math.max(last, s.end); });
  return last;
})();
engineOut = engineOut.slice(0, importEnd)
  + "\nimport { ALGO_TEMPLATES } from './algo-templates.js';"
  + engineOut.slice(importEnd);

writeFileSync(ENGINE, engineOut);
console.log(`Extracted templates object (${objText.length} chars) -> ${OUT}`);
console.log('algoTemplate now references imported ALGO_TEMPLATES.');
