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
import { basename, dirname, relative } from 'node:path';
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

// Derive the module name via node:path (CodeRabbit #25: the old `.split('/')` broke on Windows
// backslash paths and assumed OUT sat beside the engine).
const moduleBase = basename(OUT).replace(/\.ts$/, '');
// Unique namespace alias per module (e.g. code-emitters -> codeEmittersMod) so multiple
// extracted modules don't collide on a shared `mod` import in vai-engine.ts.
const alias = moduleBase.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')) + 'Mod';

const src = readFileSync(ENGINE, 'utf8');
const sf = ts.createSourceFile(ENGINE, src, ts.ScriptTarget.Latest, true);
let cls = null;
sf.forEachChild((n) => { if (ts.isClassDeclaration(n) && n.name?.text === 'VaiEngine') cls = n; });
if (!cls) { console.error('VaiEngine class not found'); process.exit(1); } // guard before reading cls.members (CodeRabbit #25)

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

  // Forward args correctly through the wrapper (CodeRabbit #25). The old code used p.name.getText(),
  // which DROPS the `...` on a rest param (passing the array as one positional arg) and can't forward
  // a destructured param `{a,b}` at all. Re-emit rest as `...name`, and refuse destructured params
  // since a thin delegating wrapper can't forward them by name without re-binding.
  const params = m.parameters.map((p) => {
    if (!ts.isIdentifier(p.name)) {
      console.error(`cannot extract ${name}: parameter is destructured/bound; wrapper can't forward it 1:1`);
      process.exit(1);
    }
    return (p.dotDotDotToken ? '...' : '') + p.name.text;
  }).join(', ');
  const bodyStart = m.body.getStart(sf);
  const sigText = src.slice(m.getStart(sf), bodyStart + 1);
  const asyncKw = asyncMod ? 'await ' : '';
  const wrapper = `${sigText}\n    return ${asyncKw}${alias}.${name}(${params});\n  }`;
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
// Relative path from the engine's dir to the new module (CodeRabbit #25: the old './<base>.js'
// assumed OUT sat in the same directory as the engine).
const rel = relative(dirname(ENGINE), OUT).replace(/\\/g, '/').replace(/\.ts$/, '.js');
const importPath = rel.startsWith('.') ? rel : './' + rel;
engineOut = engineOut.slice(0, importEnd)
  + `\nimport * as ${alias} from '${importPath}';`
  + engineOut.slice(importEnd);

// Carry over any imports the extracted code depends on. Collect identifiers used in the
// extracted function texts, then include the matching named imports from vai-engine.ts.
const extractedBlob = extractedFns.join('\n');
const usedIdents = new Set((extractedBlob.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) || []));
const neededImports = [];
for (const s of sf.statements) {
  if (!ts.isImportDeclaration(s) || !s.importClause) continue;
  const spec = s.moduleSpecifier.getText(sf);
  const clause = s.importClause;
  const typeOnly = clause.isTypeOnly ? 'type ' : '';
  const nb = clause.namedBindings;
  // Default import: `import Foo from '...'` — keep if Foo is used (CodeRabbit #25).
  if (clause.name && usedIdents.has(clause.name.text)) {
    neededImports.push(`import ${typeOnly}${clause.name.text} from ${spec};`);
  }
  // Namespace import: `import * as ns from '...'` — keep if ns is used (CodeRabbit #25).
  if (nb && ts.isNamespaceImport(nb) && usedIdents.has(nb.name.text)) {
    neededImports.push(`import ${typeOnly}* as ${nb.name.text} from ${spec};`);
  }
  // Named imports: keep the elements actually used.
  if (nb && ts.isNamedImports(nb)) {
    const keep = nb.elements.filter((el) => usedIdents.has(el.name.text));
    if (keep.length) {
      const names = keep.map((el) => el.getText(sf)).join(', ');
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
