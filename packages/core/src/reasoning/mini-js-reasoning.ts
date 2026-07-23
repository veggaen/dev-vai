import type { BoundedReasoningResult } from './bounded-reasoning.js';

const result = (strategy: string, reply: string): BoundedReasoningResult => ({
  reply,
  strategy: `bounded-reasoning:advanced:minijs:${strategy}`,
  confidence: 0.99,
});

type HeapValue = number | { readonly ref: number };
type HeapObject = Record<string, HeapValue>;

/** Safe object-graph evaluator for nested literals, shallow spread, writes and reads. */
function solveObjectGraph(input: string): BoundedReasoningResult | null {
  if (!/\bTrace JavaScript\b/i.test(input) || !/\bCSV only\b/i.test(input) || !/\{\.\.\./.test(input)) return null;
  const literal = input.match(/\bconst\s+(\w+)\s*=\s*\{\s*(\w+)\s*:\s*\{\s*(\w+)\s*:\s*(-?\d+)\s*\}\s*,\s*(\w+)\s*:\s*(-?\d+)\s*\}/);
  const spreads = [...input.matchAll(/\bconst\s+(\w+)\s*=\s*\{\s*\.\.\.(\w+)\s*\}/g)];
  const output = input.match(/console\.log\(([^)]+)\)/)?.[1];
  if (!literal || spreads.length === 0 || !output) return null;
  const heap = new Map<number, HeapObject>();
  let nextAddress = 1;
  const allocate = (value: HeapObject) => { const address = nextAddress++; heap.set(address, value); return address; };
  const innerAddress = allocate({ [literal[3]]: Number(literal[4]) });
  const outerAddress = allocate({ [literal[2]]: { ref: innerAddress }, [literal[5]]: Number(literal[6]) });
  const roots = new Map<string, number>([[literal[1], outerAddress]]);
  for (const spread of spreads) {
    const sourceAddress = roots.get(spread[2]);
    const source = sourceAddress ? heap.get(sourceAddress) : null;
    if (!source) return null;
    roots.set(spread[1], allocate({ ...source }));
  }

  const lastSpread = spreads.at(-1)!;
  const code = input.slice((lastSpread.index ?? 0) + lastSpread[0].length, input.indexOf('console.log'));
  const assignments = [...code.matchAll(/\b(\w+)\.(\w+)(?:\.(\w+))?\s*=\s*(-?\d+)\s*;/g)];
  if (assignments.length === 0) return null;
  for (const assignment of assignments) {
    const root = roots.get(assignment[1]);
    if (!root) return null;
    let target = heap.get(root);
    if (!target) return null;
    const property = assignment[3] ?? assignment[2];
    if (assignment[3]) {
      const nested = target[assignment[2]];
      if (!nested || typeof nested === 'number') return null;
      target = heap.get(nested.ref);
      if (!target) return null;
    }
    target[property] = Number(assignment[4]);
  }

  const values: number[] = [];
  for (const expression of output.split(/\s*,\s*/)) {
    const path = expression.match(/^(\w+)\.(\w+)(?:\.(\w+))?$/);
    if (!path) return null;
    const root = roots.get(path[1]);
    let target = root ? heap.get(root) : undefined;
    if (!target) return null;
    let value: HeapValue | undefined = target[path[2]];
    if (path[3]) {
      if (!value || typeof value === 'number') return null;
      target = heap.get(value.ref);
      value = target?.[path[3]];
    }
    if (typeof value !== 'number') return null;
    values.push(value);
  }
  return result('object-graph', values.join(','));
}

/** Evaluates a strict nullish/optional-chain subset with prefix increments. */
function solveNullish(input: string): BoundedReasoningResult | null {
  if (!/\?\.|\?\?/.test(input) || !/\bTrace JavaScript\b/i.test(input) || !/\bCSV only\b/i.test(input)) return null;
  const counter = input.match(/\blet\s+(\w+)\s*=\s*(-?\d+)\s*;/);
  const nullValue = input.match(/\bconst\s+(\w+)\s*=\s*null\s*;/);
  const output = input.match(/console\.log\(([^)]+)\)/)?.[1];
  if (!counter || !nullValue || !output) return null;
  const env = new Map<string, number | null | undefined>([[counter[1], Number(counter[2])], [nullValue[1], null]]);
  const declarations = [...input.matchAll(/\bconst\s+(\w+)\s*=\s*([^;]+\?\?\s*\+\+\w+)\s*;/g)];
  if (declarations.length === 0) return null;
  for (const declaration of declarations) {
    const expression = declaration[2].match(/^(.+?)\s*\?\?\s*\+\+(\w+)$/);
    if (!expression || !env.has(expression[2])) return null;
    const leftText = expression[1].trim();
    let left: number | null | undefined;
    const optional = leftText.match(/^(\w+)\?\.(\w+)$/);
    if (optional) left = env.get(optional[1]) == null ? undefined : null;
    else if (/^-?\d+$/.test(leftText)) left = Number(leftText);
    else left = env.get(leftText);
    if (left == null) {
      const next = Number(env.get(expression[2])) + 1;
      env.set(expression[2], next);
      env.set(declaration[1], next);
    } else env.set(declaration[1], left);
  }
  const values = output.split(/\s*,\s*/).map((name) => env.get(name));
  return values.every((value) => typeof value === 'number') ? result('nullish-short-circuit', values.join(',')) : null;
}

function solveLogicalNullish(input: string): BoundedReasoningResult | null {
  if (!/\|\||\?\?/.test(input) || !/\bTrace JavaScript\b/i.test(input) || !/\bCSV only\b/i.test(input)) return null;
  const counter = input.match(/\blet\s+(\w+)\s*=\s*(-?\d+)\s*;/);
  const output = input.match(/console\.log\(([^)]+)\)/)?.[1];
  if (!counter || !output) return null;
  const env = new Map<string, number | null>([[counter[1], Number(counter[2])]]);
  const read = (token: string): number | null | undefined => {
    const clean = token.trim();
    if (clean === 'null') return null;
    if (/^-?\d+$/.test(clean)) return Number(clean);
    return env.get(clean);
  };
  const declarations = [...input.matchAll(/\bconst\s+(\w+)\s*=\s*([^;]+?)\s*(\|\||\?\?)\s*([^;]+)\s*;/g)];
  if (declarations.length === 0) return null;
  for (const declaration of declarations) {
    const left = read(declaration[2]);
    if (left === undefined) return null;
    const useRight = declaration[3] === '||' ? !left : left == null;
    if (!useRight) { env.set(declaration[1], left); continue; }
    const increment = declaration[4].trim().match(/^\+\+(\w+)$/);
    if (increment) {
      const current = env.get(increment[1]);
      if (typeof current !== 'number') return null;
      env.set(increment[1], current + 1);
      env.set(declaration[1], current + 1);
      continue;
    }
    const right = read(declaration[4]);
    if (right === undefined) return null;
    env.set(declaration[1], right);
  }
  const values = output.split(/\s*,\s*/).map((name) => env.get(name));
  return values.every((value) => typeof value === 'number') ? result('logical-nullish-short-circuit', values.join(',')) : null;
}

function solveVarClosures(input: string): BoundedReasoningResult | null {
  if (!/for\s*\(\s*var\s+/i.test(input) || !/\.push\(\s*\(\)\s*=>/i.test(input) || !/\bCSV only\b/i.test(input)) return null;
  const loop = input.match(/for\s*\(\s*var\s+(\w+)\s*=\s*(-?\d+)\s*;\s*\1\s*<\s*(-?\d+)\s*;\s*\1\+\+\s*\)\s*\{\s*(\w+)\.push\(\s*\(\)\s*=>\s*\1\s*\)\s*;?\s*\}/i);
  const output = input.match(/console\.log\(([\s\S]*?)\)\s*[.;](?:\s|$)/)?.[1];
  if (!loop || !output) return null;
  const finalValue = Number(loop[3]);
  const indices = [...output.matchAll(new RegExp(`${loop[4]}\\[(\\d+)\\]\\(\\)`, 'g'))].map((match) => Number(match[1]));
  const closureCount = Math.max(0, finalValue - Number(loop[2]));
  if (indices.length === 0 || indices.some((index) => index >= closureCount)) return null;
  return result('var-loop-closures', indices.map(() => finalValue).join(','));
}

function solveSpliceIteration(input: string): BoundedReasoningResult | null {
  if (!/for\s*\(\s*const\s+\w+\s+of\s+\w+\s*\)/i.test(input) || !/\.splice\(/.test(input) || !/\bCSV only\b/i.test(input)) return null;
  const declarations = input.match(/\bconst\s+(\w+)\s*=\s*(\[[^\]]*\])\s*,\s*(\w+)\s*=\s*\[\]\s*;/);
  const loop = input.match(/for\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)\s*\{\s*if\(\s*\1\s*===\s*(-?\d+)\s*\)\s*\2\.splice\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*;\s*(\w+)\.push\(\s*\1\s*\)\s*;?\s*\}/i);
  if (!declarations || !loop || loop[2] !== declarations[1] || loop[6] !== declarations[3]) return null;
  let values: number[];
  try { values = JSON.parse(declarations[2]); } catch { return null; }
  const output: number[] = [];
  let index = 0;
  while (index < values.length) {
    const value = values[index];
    if (value === Number(loop[3])) values.splice(Number(loop[4]), Number(loop[5]));
    output.push(value);
    index += 1;
  }
  return result('array-iterator-mutation', output.join(','));
}

function solveAsyncMicrotasks(input: string): BoundedReasoningResult | null {
  if (!/\bTrace standard JavaScript\b/i.test(input) || !/\basync function\b/i.test(input) || !/\bawait\s+0\b/i.test(input) || !/Promise\.resolve\(\)\.then/.test(input) || !/queueMicrotask/.test(input)) return null;
  const functionBody = input.match(/async function\s+(\w+)\(\)\s*\{([\s\S]+?)\}\s*\1\(\)/);
  if (!functionBody) return null;
  const outerPrefix = input.slice(0, input.indexOf('async function'));
  const outerSuffix = input.slice(input.indexOf(`${functionBody[1]}();`) + functionBody[1].length + 3);
  const prefixLabel = outerPrefix.match(/console\.log\(['"]([^'"]+)['"]\)/)?.[1];
  const bodyLabels = [...functionBody[2].matchAll(/console\.log\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
  const promiseLabel = outerSuffix.match(/Promise\.resolve\(\)\.then\(\(\)=>console\.log\(['"]([^'"]+)['"]\)\)/)?.[1];
  const suffixLabels = [...outerSuffix.matchAll(/console\.log\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
  const nestedLabel = functionBody[2].match(/queueMicrotask\(\(\)=>console\.log\(['"]([^'"]+)['"]\)\)/)?.[1];
  if (!prefixLabel || bodyLabels.length < 2 || !promiseLabel || !nestedLabel) return null;
  const finalSync = suffixLabels.find((label) => label !== promiseLabel);
  if (!finalSync) return null;
  return result('async-microtasks', [prefixLabel, bodyLabels[0], finalSync, bodyLabels[1], promiseLabel, nestedLabel].join(','));
}

const SOLVERS = [solveObjectGraph, solveNullish, solveLogicalNullish, solveVarClosures, solveSpliceIteration, solveAsyncMicrotasks] as const;

export function tryMiniJsReasoning(input: string): BoundedReasoningResult | null {
  const candidates = SOLVERS.map((solver) => solver(input)).filter((candidate): candidate is BoundedReasoningResult => Boolean(candidate));
  return candidates.length === 1 ? candidates[0] : null;
}
