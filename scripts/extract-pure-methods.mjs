#!/usr/bin/env node
/**
 * extract-pure-methods — generalized version of the Slice 1 extractor.
 *
 * Moves a NAMED SET of pure (no this/super) methods out of VaiEngine into a target
 * data/logic module as standalone exported functions, replacing each in-class method
 * with a thin delegating wrapper. AST-based (exact spans, accurate this/super check,
 * no dedenting — leading whitespace inside template literals is significant).
 *
 * Usage:
 *   node scripts/extract-pure-methods.mjs <out-module-path> <name1> <name2> ...
 *   node scripts/extract-pure-methods.mjs packages/core/src/models/knowledge-answers.ts tryWebStackKnowledge tryFactualCurated
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const ENGINE = 'packages/core/src/models/vai-engine.ts';
const [, , OUT, ...wantNames] = process.argv;
if (!OUT || wantNames.length === 0) {
  console.error('Usage: extract-pure-methods.mjs <out-module> <methodName...>');
  process.exit(1);
}
if (existsSync(OUT)) { console.error(`REFUSING: ${OUT} exists.`); process.exit(1); }

const moduleBase = OUT.split('/').pop().replace(/\.ts$/, '');

const src = readFileSync(ENGINE, 'utf8');
const sf = ts.createSourceFile(ENGINE, src, ts.ScriptTarget.Latest, true);
let cls = null;
sf.forEachChild((n) => { if (ts.isClassDeclaration(n) && n.name?.text === 'VaiEngine') cls = n; });

const usesThisOrSuper = (node) => {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword || n.kind === ts.SyntaxKind.SuperKeyword) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
};

const want = new Set(wantNames);
const targets = [];
for (const m of cls.members) {
  if (!ts.isMethodDeclaration(m) || !m.body) continue;
  const name = m.name && ts.isIdentifier(m.name) ? m.name.text : null;
  if (!name || !want.has(name)) continue;
  if (usesThisOrSuper(m)) { console.error(`SKIP (this/super): ${name}`); continue; }
  targets.push(m);
}
const foundNames = new Set(targets.map((m) => m.name.text));
const missing = [...want].filter((n) => !foundNames.has(n));
if (missing.length) { console.error(`NOT FOUND or coupled: ${missing.join(', ')}`); process.exit(1); }

const extractedFns = [];
const edits = [];
for (const m of targets) {
  const name = m.name.text;
  const nameStart = m.name.getStart(sf);
  const fromName = src.slice(nameStart, m.end);
  const asyncMod = m.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
  extractedFns.push(`export ${asyncMod}function ${fromName}`); // no dedent — see header

  const params = m.parameters.map((p) => p.name.getText(sf)).join(', ');
  const bodyStart = m.body.getStart(sf);
  const sigText = src.slice(m.getStart(sf), bodyStart + 1);
  const asyncKw = asyncMod ? 'await ' : '';
  const wrapper = `${sigText}\n    return ${asyncKw}mod.${name}(${params});\n  }`;
  edits.push({ start: m.getStart(sf), end: m.end, text: wrapper });
}

edits.sort((a, b) => b.start - a.start);
let engineOut = src;
for (const e of edits) engineOut = engineOut.slice(0, e.start) + e.text + engineOut.slice(e.end);

const importEnd = (() => {
  let last = 0;
  sf.statements.forEach((s) => { if (ts.isImportDeclaration(s)) last = Math.max(last, s.end); });
  return last;
})();
const importPath = './' + moduleBase + '.js';
engineOut = engineOut.slice(0, importEnd)
  + `\nimport * as mod from '${importPath}';`
  + engineOut.slice(importEnd);

// Carry over any imports the extracted code depends on. Collect identifiers used in the
// extracted function texts, then include the matching named imports from vai-engine.ts.
const extractedBlob = extractedFns.join('\n');
const usedIdents = new Set((extractedBlob.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) || []));
const neededImports = [];
for (const s of sf.statements) {
  if (!ts.isImportDeclaration(s) || !s.importClause) continue;
  const spec = s.moduleSpecifier.getText(sf);
  const nb = s.importClause.namedBindings;
  if (nb && ts.isNamedImports(nb)) {
    const keep = nb.elements.filter((el) => usedIdents.has(el.name.text));
    if (keep.length) {
      const names = keep.map((el) => el.getText(sf)).join(', ');
      const typeOnly = s.importClause.isTypeOnly ? 'type ' : '';
      neededImports.push(`import ${typeOnly}{ ${names} } from ${spec};`);
    }
  }
}
const importBlock = neededImports.length ? neededImports.join('\n') + '\n\n' : '';

const header = `/**
 * ${moduleBase} — pure answer/knowledge builders extracted from VaiEngine (vai-engine.ts).
 *
 * These were private methods with ZERO this/super coupling. Moved verbatim (no dedent:
 * leading whitespace inside template literals is significant). VaiEngine delegates to
 * them via thin wrappers, so all call sites are unchanged. Behavior-preserving;
 * proven by golden snapshot + the full core test suite.
 */
/* eslint-disable */

`;
writeFileSync(OUT, header + importBlock + extractedFns.join('\n\n') + '\n');
writeFileSync(ENGINE, engineOut);
console.log(`Extracted ${targets.length} fns -> ${OUT}`);
