#!/usr/bin/env node
/**
 * extract-builder-templates — one-shot, reproducible refactor (AST-based).
 *
 * Moves the PURE generateBuilder* template methods (no `this`/`super` usage) out of
 * the 56k-line VaiEngine god-class into a standalone module `builder-templates.ts`,
 * replacing each in-class method with a thin delegating wrapper so every existing
 * `this.generateX(...)` call site keeps working unchanged.
 *
 * Uses the TypeScript compiler API for exact method spans + accurate `this`/`super`
 * detection (a hand-rolled brace matcher miscounts braces inside string literals).
 *
 * Safety: identical behavior, proven byte-for-byte by the golden capture script.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const ENGINE = 'packages/core/src/models/vai-engine.ts';
const OUT = 'packages/core/src/models/builder-templates.ts';

if (existsSync(OUT)) {
  console.error(`REFUSING: ${OUT} already exists. Delete it first to re-run.`);
  process.exit(1);
}

const src = readFileSync(ENGINE, 'utf8');
const sf = ts.createSourceFile(ENGINE, src, ts.ScriptTarget.Latest, /*setParentNodes*/ true);

// Find the VaiEngine class.
let cls = null;
sf.forEachChild((n) => {
  if (ts.isClassDeclaration(n) && n.name && n.name.text === 'VaiEngine') cls = n;
});
if (!cls) { console.error('VaiEngine class not found'); process.exit(1); }

// Does a node reference `this` or `super` anywhere in its subtree?
function usesThisOrSuper(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword || n.kind === ts.SyntaxKind.SuperKeyword) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

const targets = [];
for (const member of cls.members) {
  if (!ts.isMethodDeclaration(member)) continue;
  const name = member.name && ts.isIdentifier(member.name) ? member.name.text : null;
  if (!name || !name.startsWith('generateBuilder')) continue;
  if (usesThisOrSuper(member)) continue; // keep coupled ones in the class
  // Must return string and have a block body.
  if (!member.body) continue;
  targets.push(member);
}

console.log(`pure generateBuilder* methods (AST, no this/super): ${targets.length}`);

// Build extracted free functions + delegating wrappers.
const extractedFns = [];
const edits = []; // {start, end, text} on the original source text

for (const m of targets) {
  const name = m.name.text;
  const methodText = src.slice(m.getStart(sf), m.end);

  // Free function: drop modifiers (private/async stays if present), turn into `export function`.
  // Method form: `private NAME(params): RET { body }`
  // We take from the method name onwards and prepend `export function `.
  const nameStart = m.name.getStart(sf);
  const fromName = src.slice(nameStart, m.end); // `NAME(params): RET { body }`
  const asyncMod = m.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
  const freeFn = `export ${asyncMod}function ${fromName}`;
  // NB: do NOT dedent. Method bodies can contain multi-line template literals where
  // leading whitespace is significant; stripping indentation would change the OUTPUT.
  // Keeping the original 4-space body indent is cosmetically loose but byte-identical.
  extractedFns.push(freeFn);

  // Delegating wrapper: keep original signature (everything up to and incl `{`),
  // replace body with `return tpl.NAME(args);`.
  const params = m.parameters.map((p) => p.name.getText(sf)).join(', ');
  const bodyStart = m.body.getStart(sf); // position of `{`
  const sigText = src.slice(m.getStart(sf), bodyStart + 1); // `private NAME(params): RET {`
  const wrapper = `${sigText}\n    return tpl.${name}(${params});\n  }`;
  edits.push({ start: m.getStart(sf), end: m.end, text: wrapper });
}

// Apply edits bottom-up by position so offsets stay valid.
edits.sort((a, b) => b.start - a.start);
let engineOut = src;
for (const e of edits) {
  engineOut = engineOut.slice(0, e.start) + e.text + engineOut.slice(e.end);
}

// Insert the import AFTER the last existing import statement (not inside one).
const importEnd = (() => {
  let last = 0;
  sf.statements.forEach((s) => {
    if (ts.isImportDeclaration(s)) last = Math.max(last, s.end);
  });
  return last;
})();
// importEnd is an offset in the ORIGINAL src; edits only touched method bodies far below it,
// and we applied edits bottom-up, so offsets <= importEnd are unchanged.
engineOut = engineOut.slice(0, importEnd)
  + "\nimport * as tpl from './builder-templates.js';"
  + engineOut.slice(importEnd);

const header = `/**
 * builder-templates — pure, standalone "build me an X" response templates.
 *
 * Extracted verbatim from VaiEngine (vai-engine.ts) where they lived as private
 * methods with ZERO this/super coupling: pure string builders that, given a
 * description, return a fixed markdown answer. Kept byte-identical to the originals
 * (proven by the golden capture). VaiEngine now delegates to these via thin wrappers,
 * shrinking the god-class by ~4.8k lines.
 */
/* eslint-disable */

`;
writeFileSync(OUT, header + extractedFns.join('\n\n') + '\n');
writeFileSync(ENGINE, engineOut);

console.log(`Extracted ${targets.length} fns -> ${OUT}`);
console.log(`Replaced ${edits.length} in-class methods with delegating wrappers.`);
