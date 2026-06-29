#!/usr/bin/env node
/**
 * hotpath-scan — deterministic AST scan for per-call/per-iteration cost patterns.
 *
 * This is the capability the council's method lesson asked for and that it could
 * NOT do itself (it can't introspect the codebase): a precise, no-model scanner
 * that finds the class of issue we fixed by hand in deterministic-facts-router
 * (a fresh `new RegExp` compiled per loop iteration, ~572/turn).
 *
 * It uses the TypeScript compiler AST — NOT regex over source — so a finding means
 * the pattern is *syntactically* inside a loop/function, not merely near the word
 * "for". Precision is the whole point: a scanner that cries wolf is worse than none.
 * Every finding is meant to be human-verified before action.
 *
 * Detectors (all conservative — favor missing a case over a false alarm):
 *   1. regex-in-loop    — `new RegExp(...)` lexically inside a for/while/do or an
 *                         iterator callback (.map/.filter/.forEach/.some/.find/...).
 *                         The argument is non-constant-foldable (built from a var),
 *                         so it genuinely recompiles each iteration.
 *   2. regex-per-call   — `new RegExp(...)` inside a named function body (not module
 *                         scope, not memoized) → recompiles on every call.
 *   3. nested-loop      — a loop whose body contains another loop over a collection
 *                         (an O(n*m) candidate worth a look).
 *
 * Usage:
 *   node scripts/hotpath-scan.mjs                       # scan default hot-path globs
 *   node scripts/hotpath-scan.mjs packages/core/src     # scan a dir
 *   node scripts/hotpath-scan.mjs --json                # machine-readable
 *   node scripts/hotpath-scan.mjs --detector regex-in-loop
 */
import ts from 'typescript';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const detIdx = args.indexOf('--detector');
const onlyDetector = detIdx >= 0 ? args[detIdx + 1] : null;
const roots = args.filter((a) => !a.startsWith('--') && a !== onlyDetector);

const DEFAULT_ROOTS = [
  'packages/core/src/chat',
  'packages/core/src/consensus',
  'packages/core/src/routing',
  'packages/core/src/synthesis',
];

const ITER_METHODS = new Set(['map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'reduce', 'flatMap']);

/** Recursively collect .ts files (skip tests, dist, node_modules, .d.ts). */
function collectFiles(root) {
  const out = [];
  let st;
  try { st = statSync(root); } catch { return []; } // missing path → skip
  if (st.isFile()) return root.endsWith('.ts') ? [root] : [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '__tests__', '.git'].includes(e.name)) continue;
      out.push(...collectFiles(p));
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !e.name.includes('.test.')) {
      out.push(p);
    }
  }
  return out;
}

/** Is this node lexically inside a loop or an iterator callback (before reaching fn boundary)? */
function loopContext(node) {
  let cur = node.parent;
  let crossedFunction = false;
  while (cur) {
    if (ts.isForStatement(cur) || ts.isForOfStatement(cur) || ts.isForInStatement(cur)
      || ts.isWhileStatement(cur) || ts.isDoStatement(cur)) {
      return crossedFunction ? null : 'loop';
    }
    // Iterator callback: arg of x.map(() => ...). The fn we're inside IS the callback.
    if ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur))
      && ts.isCallExpression(cur.parent)
      && ts.isPropertyAccessExpression(cur.parent.expression)
      && ITER_METHODS.has(cur.parent.expression.name.text)
      && cur.parent.arguments.includes(cur)) {
      return 'iterator-callback';
    }
    // A regular function boundary means "not in a loop" for detector #1.
    if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)
      || ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) && !isIteratorCallback(cur))) {
      crossedFunction = true;
    }
    cur = cur.parent;
  }
  return null;
}

function isIteratorCallback(fn) {
  return ts.isCallExpression(fn.parent)
    && ts.isPropertyAccessExpression(fn.parent.expression)
    && ITER_METHODS.has(fn.parent.expression.name.text)
    && fn.parent.arguments.includes(fn);
}

/** Nearest enclosing named function/method for reporting + per-call detection. */
function enclosingFunctionName(node) {
  let cur = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && cur.name && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)
      && cur.initializer && (ts.isArrowFunction(cur.initializer) || ts.isFunctionExpression(cur.initializer))) {
      return cur.name.text;
    }
    cur = cur.parent;
  }
  return null;
}

/** Is the node at module top level (not inside any function)? */
function isModuleScope(node) {
  let cur = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)
      || ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) return false;
    cur = cur.parent;
  }
  return true;
}

/** True for an arg that is NOT a compile-time constant string (built from a var/template/call). */
function isConstStringArg(a) {
  return ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a);
}

/** A RegExp construction that can't be a compile-time constant — its PATTERN or its FLAGS arg is
 *  dynamic. The old check ignored the flags arg, so `new RegExp('x', someVar)` read as constant
 *  (CodeRabbit #25). A bare `new RegExp(pattern)` with no args is treated as dynamic. */
function argIsDynamic(call) {
  const pattern = call.arguments[0];
  if (!pattern) return true;                          // new RegExp() with no literal pattern
  if (!isConstStringArg(pattern)) return true;        // dynamic pattern
  const flags = call.arguments[1];
  if (flags && !isConstStringArg(flags)) return true; // constant pattern but DYNAMIC flags
  return false;                                       // both constant → engine/JIT can hoist
}

function isFunctionLike(n) {
  return ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)
    || ts.isArrowFunction(n) || ts.isFunctionExpression(n)
    || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)
    || ts.isConstructorDeclaration(n);
}

function countLoopsInBody(fnOrBlock) {
  let loops = 0;
  const visit = (n) => {
    if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)
      || ts.isWhileStatement(n) || ts.isDoStatement(n)) loops += 1;
    // Do NOT descend into a NESTED function body — a loop inside a callback belongs to that callback,
    // not the outer function (CodeRabbit #25: it was inflating the outer loop count).
    n.forEachChild((c) => { if (!isFunctionLike(c)) visit(c); });
  };
  fnOrBlock.forEachChild((c) => { if (!isFunctionLike(c)) visit(c); });
  return loops;
}

function scanFile(file) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const findings = [];
  const add = (node, detector, detail) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({
      detector,
      file: relative(process.cwd(), file).replace(/\\/g, '/'),
      line: line + 1,
      fn: enclosingFunctionName(node) ?? '(module)',
      detail,
    });
  };

  const visit = (node) => {
    // new RegExp(...)
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'RegExp') {
      const ctx = loopContext(node);
      if (ctx && argIsDynamic(node)) {
        add(node, 'regex-in-loop', `new RegExp built per iteration (${ctx})`);
      } else if (!ctx && !isModuleScope(node) && argIsDynamic(node)) {
        add(node, 'regex-per-call', 'new RegExp recompiled on every call (not hoisted/memoized)');
      }
    }
    // nested loops
    if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)
      || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      if (node.statement && countLoopsInBody(node.statement) > 0) {
        add(node, 'nested-loop', 'loop containing an inner loop (O(n*m) candidate)');
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return findings;
}

// ── run ───────────────────────────────────────────────────────────────────────
const scanRoots = roots.length ? roots : DEFAULT_ROOTS;
const files = scanRoots.flatMap(collectFiles);
let findings = files.flatMap(scanFile);
if (onlyDetector) findings = findings.filter((f) => f.detector === onlyDetector);

if (asJson) {
  console.log(JSON.stringify({ scanned: files.length, findings }, null, 2));
  process.exit(0);
}

const byDetector = {};
for (const f of findings) (byDetector[f.detector] ??= []).push(f);

console.log(`hotpath-scan — ${files.length} files scanned, ${findings.length} findings\n`);
for (const [det, list] of Object.entries(byDetector)) {
  console.log(`■ ${det} (${list.length})`);
  for (const f of list) console.log(`   ${f.file}:${f.line}  ${f.fn}()  — ${f.detail}`);
  console.log('');
}
if (findings.length === 0) console.log('clean ✓');
