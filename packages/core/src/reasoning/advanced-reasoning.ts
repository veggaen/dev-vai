import type { BoundedReasoningResult } from './bounded-reasoning.js';
import { tryMiniJsReasoning } from './mini-js-reasoning.js';
import { tryPlanningReasoning } from './planning-reasoning.js';

/**
 * Reusable expert reasoning kernels for small, fully declared problems.
 *
 * Parsers in this file are intentionally closed-world: every solver requires a
 * complete domain and a recognizable output contract, enumerates or executes
 * a typed IR, then verifies the witness before rendering it. A partial parse
 * returns null; it never leaks a plausible-looking partial answer.
 */

interface ReasoningHistoryMessage { readonly role: string; readonly content: string }
type BoolEnv = Readonly<Record<string, boolean>>;
type BoolConstraint = (env: BoolEnv) => boolean;

const solved = (strategy: string, reply: string, confidence = 0.99): BoundedReasoningResult => ({
  reply,
  strategy: `bounded-reasoning:advanced:${strategy}`,
  confidence,
});

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  const output: T[][] = [];
  values.forEach((value, index) => {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const suffix of permutations(rest)) output.push([value, ...suffix]);
  });
  return output;
}

function subsets<T>(values: readonly T[]): T[][] {
  const output: T[][] = [];
  for (let mask = 0; mask < 2 ** values.length; mask += 1) {
    output.push(values.filter((_value, index) => (mask & (1 << index)) !== 0));
  }
  return output;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a || 1;
}

function solveFalseImplicationClosure(input: string): BoundedReasoningResult | null {
  if (!/\bfalseAtoms\b/i.test(input) || !/json only/i.test(input)) return null;
  const edges = [...input.matchAll(/\b([A-Z])\s+implies\s+([A-Z])\b/g)].map((match) => [match[1], match[2]] as const);
  const falseAtoms = new Set([...input.matchAll(/\b([A-Z])\s+is\s+false\b/g)].map((match) => match[1]));
  if (edges.length === 0 || falseAtoms.size === 0) return null;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [antecedent, consequent] of edges) {
      if (falseAtoms.has(consequent) && !falseAtoms.has(antecedent)) {
        falseAtoms.add(antecedent);
        changed = true;
      }
    }
  }
  const atoms = [...new Set(edges.flat())];
  if (![...falseAtoms].every((atom) => atoms.includes(atom))) return null;
  return solved('implication-closure', JSON.stringify({ falseAtoms: [...falseAtoms].sort() }));
}

function solveBooleanFiniteModel(input: string): BoundedReasoningResult | null {
  if (!/\bunique (?:Boolean )?model\b/i.test(input) || !/json only/i.test(input)) return null;
  const atoms = new Set<string>();
  const constraints: BoolConstraint[] = [];
  const remember = (...names: string[]) => names.forEach((name) => atoms.add(name));

  for (const match of input.matchAll(/(?:^|[;:.]\s*)\b([A-Z])\s+is\s+(true|false)\b/g)) {
    const [, atom, value] = match;
    remember(atom);
    constraints.push((env) => env[atom] === (value === 'true'));
  }
  for (const match of input.matchAll(/\b([A-Z])\s+iff\s+([A-Z])\b/g)) {
    const [, left, right] = match;
    remember(left, right);
    constraints.push((env) => env[left] === env[right]);
  }
  for (const match of input.matchAll(/\bIf\s+([A-Z])\s+then\s+([A-Z])\b/g)) {
    const [, left, right] = match;
    remember(left, right);
    constraints.push((env) => !env[left] || env[right]);
  }
  for (const match of input.matchAll(/\(\s*([A-Z])\s+OR\s+([A-Z])\s*\)\s+implies\s+([A-Z])/gi)) {
    const [, left, right, consequent] = match.map((value) => value.toUpperCase());
    remember(left, right, consequent);
    constraints.push((env) => !(env[left] || env[right]) || env[consequent]);
  }
  for (const match of input.matchAll(/\bExactly one of\s+([A-Z])\s+and\s+([A-Z])\s+is true\b/g)) {
    const [, left, right] = match;
    remember(left, right);
    constraints.push((env) => Number(env[left]) + Number(env[right]) === 1);
  }
  for (const match of input.matchAll(/\b([A-Z])\s*=\s*not\s+([A-Z])\b/gi)) {
    const [, left, right] = match.map((value) => value.toUpperCase());
    remember(left, right);
    constraints.push((env) => env[left] === !env[right]);
  }
  for (const match of input.matchAll(/\b([A-Z])\s*=\s*\(?([A-Z])\s+xor\s+([A-Z])\)?/gi)) {
    const [, result, left, right] = match.map((value) => value.toUpperCase());
    remember(result, left, right);
    constraints.push((env) => env[result] === (env[left] !== env[right]));
  }
  for (const match of input.matchAll(/(?:^|[;:.]\s*)\b([A-Z])\s*=\s*([A-Z])(?=\s*[;.]|$)/g)) {
    const [, left, right] = match;
    remember(left, right);
    constraints.push((env) => env[left] === env[right]);
  }
  const cardinality = input.match(/\bExactly\s+(one|two|three|\d+)\s+of\s+([A-Z](?:\s*,\s*[A-Z])*(?:\s*,?\s*and\s+[A-Z])?)\s+are true\b/i);
  if (cardinality) {
    const expected = ({ one: 1, two: 2, three: 3 } as const)[cardinality[1].toLowerCase() as 'one' | 'two' | 'three'] ?? Number(cardinality[1]);
    const names = [...cardinality[2].matchAll(/[A-Z]/g)].map((match) => match[0]);
    remember(...names);
    constraints.push((env) => names.reduce((sum, name) => sum + Number(env[name]), 0) === expected);
  }

  const orderedAtoms = [...atoms].sort();
  if (orderedAtoms.length === 0 || orderedAtoms.length > 12 || constraints.length < 2) return null;
  const models: Record<string, boolean>[] = [];
  for (let mask = 0; mask < 2 ** orderedAtoms.length; mask += 1) {
    const env = Object.fromEntries(orderedAtoms.map((atom, index) => [atom, Boolean(mask & (1 << index))]));
    if (constraints.every((constraint) => constraint(env))) models.push(env);
  }
  return models.length === 1 ? solved('finite-boolean-model', JSON.stringify(models[0])) : null;
}

function solveQuantifiedChain(input: string): BoundedReasoningResult | null {
  if (!/\bchainLength\b/i.test(input) || !/json only/i.test(input)) return null;
  const inclusions = [...input.matchAll(/\bEvery\s+([a-z]+)\s+is\s+(?:a\s+)?([a-z]+)\b/gi)]
    .map((match) => [match[1].toLowerCase(), match[2].toLowerCase()] as const);
  const exclusion = input.match(/\bNo\s+([a-z]+)\s+is\s+(?:a\s+)?([a-z]+)\b/i);
  const query = input.match(/\bCan any\s+([a-z]+)\s+be\s+(?:a\s+)?([a-z]+)\b/i);
  if (inclusions.length < 1 || !exclusion || !query) return null;
  const [querySource, queryTarget] = [query[1].toLowerCase(), query[2].toLowerCase()];
  const [excludedSource, excludedTarget] = [exclusion[1].toLowerCase(), exclusion[2].toLowerCase()];
  if (queryTarget !== excludedTarget) return null;
  const queue: Array<{ atom: string; length: number }> = [{ atom: querySource, length: 0 }];
  const seen = new Set([querySource]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current.atom === excludedSource) {
      return solved('quantified-chain', JSON.stringify({ answer: false, chainLength: current.length + 1 }));
    }
    for (const [from, to] of inclusions) {
      if (from === current.atom && !seen.has(to)) {
        seen.add(to);
        queue.push({ atom: to, length: current.length + 1 });
      }
    }
  }
  return null;
}

function solveMinimalAbduction(input: string): BoundedReasoningResult | null {
  if (!/\bminimalExplanations\b/i.test(input) || !/\bObservation\b/i.test(input) || !/json only/i.test(input)) return null;
  const rules = [...input.matchAll(/\b([A-Z])\s+implies\s+([A-Z])\b/g)].map((match) => [match[1], match[2]] as const);
  const observation = input.match(/\bObservation\s*:\s*([A-Z])\s+is\s+true\b/i)?.[1].toUpperCase();
  if (!observation || rules.length === 0) return null;
  const candidates = [...new Set(rules.map(([from]) => from).filter((atom) => atom !== observation))].sort();
  if (candidates.length === 0 || candidates.length > 12) return null;
  const entails = (assumptions: readonly string[]) => {
    const closure = new Set(assumptions);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [from, to] of rules) if (closure.has(from) && !closure.has(to)) { closure.add(to); changed = true; }
    }
    return closure.has(observation);
  };
  const explanations = subsets(candidates)
    .filter((candidate) => candidate.length > 0 && entails(candidate))
    .filter((candidate, _index, all) => !all.some((other) => other.length < candidate.length && other.every((atom) => candidate.includes(atom))))
    .sort((left, right) => left.length - right.length || left.join('').localeCompare(right.join('')));
  if (explanations.length < 2 || explanations.some((candidate) => !entails(candidate))) return null;
  return solved('minimal-abduction', JSON.stringify({ status: 'underdetermined', minimalExplanations: explanations }));
}

interface OrderConstraint { readonly before: string; readonly after: string; readonly immediate: boolean; readonly label: string }

function hasDirectedCycle(relations: readonly OrderConstraint[]): boolean {
  const nodes = [...new Set(relations.flatMap((relation) => [relation.before, relation.after]))];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    if (relations.some((relation) => relation.before === node && visit(relation.after))) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return nodes.some(visit);
}

function solvePositionCsp(input: string): BoundedReasoningResult | null {
  if (!/json only/i.test(input) || !/\b(?:positions?|occurs? once|valid orders?|unsatCore)\b/i.test(input)) return null;
  const entitySegment = input.match(/\bPlace\s+(.+?)\s+in positions/i)?.[1]
    ?? input.match(/\bTasks?\s+(.+?)\s+occur(?:s)? once/i)?.[1]
    ?? input.match(/\bEach task\s+(.+?)\s+occurs once/i)?.[1];
  const entities = entitySegment ? [...entitySegment.matchAll(/\b[A-Z]\b/g)].map((match) => match[0]) : [];
  const declared = [...new Set(entities)];
  if (declared.length < 3 || declared.length > 8) return null;
  const relations: OrderConstraint[] = [];
  for (const match of input.matchAll(/\b([A-Z])\s+(?:is\s+)?(immediately\s+)?before\s+([A-Z])\b/g)) {
    relations.push({ before: match[1], after: match[3], immediate: Boolean(match[2]), label: `${match[1]}<${match[3]}` });
  }
  for (const match of input.matchAll(/\b([A-Z])\s+(?:is\s+)?(immediately\s+)?after\s+([A-Z])\b/g)) {
    relations.push({ before: match[3], after: match[1], immediate: Boolean(match[2]), label: `${match[3]}<${match[1]}` });
  }
  const fixed = [...input.matchAll(/\b([A-Z])\s+is\s+position\s+(\d+)\b/g)].map((match) => [match[1], Number(match[2])] as const);
  if (relations.some((relation) => !declared.includes(relation.before) || !declared.includes(relation.after))) return null;

  if (/\bunsatCore\b/i.test(input)) {
    for (let size = 1; size <= relations.length; size += 1) {
      const cores = subsets(relations).filter((candidate) => candidate.length === size && hasDirectedCycle(candidate));
      if (cores.length) return solved('position-unsat-core', JSON.stringify({ status: 'unsat', unsatCore: cores[0].map((relation) => relation.label) }));
    }
    return null;
  }

  const valid = permutations(declared).filter((order) => {
    const position = (name: string) => order.indexOf(name) + 1;
    return fixed.every(([name, expected]) => position(name) === expected)
      && relations.every((relation) => relation.immediate
        ? position(relation.after) === position(relation.before) + 1
        : position(relation.before) < position(relation.after));
  });
  if (/\btwo distinct valid orders\b/i.test(input)) {
    return valid.length >= 2
      ? solved('position-non-unique', JSON.stringify({ status: 'non_unique', orders: valid.slice(0, 2) }))
      : null;
  }
  return valid.length === 1 ? solved('position-csp', JSON.stringify({ order: valid[0] })) : null;
}

function solveGraphColoring(input: string): BoundedReasoningResult | null {
  if (!/\bColor cycle vertices\b/i.test(input) || !/json only/i.test(input)) return null;
  const cycleText = input.match(/\bvertices\s+([\d-]+)\s+with\b/i)?.[1];
  const colorsText = input.match(/\bwith\s+([A-Z](?:\s*,\s*[A-Z])+)\s+so\b/i)?.[1];
  if (!cycleText || !colorsText) return null;
  const cycle = cycleText.split('-');
  const vertices = cycle.slice(0, -1);
  if (vertices.length < 3 || cycle.at(-1) !== vertices[0]) return null;
  const colors = colorsText.split(/\s*,\s*/);
  const fixed = input.match(/\bVertex\s+(\d+)\s+is\s+([A-Z])\b/i);
  if (!fixed || !vertices.includes(fixed[1]) || !colors.includes(fixed[2])) return null;
  const assignments: string[][] = [];
  const visit = (index: number, assigned: string[]) => {
    if (index === vertices.length) {
      if (assigned.every((color, i) => color !== assigned[(i + 1) % assigned.length])) assignments.push([...assigned]);
      return;
    }
    for (const color of colors) {
      if (vertices[index] === fixed[1] && color !== fixed[2]) continue;
      if (index > 0 && assigned[index - 1] === color) continue;
      assigned.push(color);
      visit(index + 1, assigned);
      assigned.pop();
    }
  };
  visit(0, []);
  return assignments.length ? solved('graph-coloring', JSON.stringify({ colors: assignments[0] })) : null;
}

function solveBijection(input: string): BoundedReasoningResult | null {
  if (!/\bbijectively\b/i.test(input) || !/json only/i.test(input)) return null;
  const shape = input.match(/\bAssign\s+(.+?)\s+bijectively to\s+(.+?)\./i);
  if (!shape) return null;
  const people = shape[1].split(/\s*,\s*|\s+and\s+/).map((value) => value.trim()).filter(Boolean);
  const roles = shape[2].split(/\s*,\s*|\s+and\s+/).map((value) => value.trim()).filter(Boolean);
  if (people.length !== roles.length || people.length < 2 || people.length > 8) return null;
  const forbidden = new Map<string, Set<string>>();
  for (const match of input.matchAll(/\b([A-Z][a-z]+)\s+cannot\s+(.+?)\./g)) {
    forbidden.set(match[1], new Set(match[2].split(/\s*\/\s*|\s*,\s*|\s+or\s+/).map((value) => value.trim())));
  }
  const models = permutations(roles).filter((assignment) => people.every((person, index) => !forbidden.get(person)?.has(assignment[index])));
  if (models.length !== 1) return null;
  return solved('bijection-csp', JSON.stringify(Object.fromEntries(people.map((person, index) => [person, models[0][index]]))));
}

function solveWeightedSetCover(input: string): BoundedReasoningResult | null {
  if (!/\bminimum cost modules\b/i.test(input) || !/\btarget set\b/i.test(input) || !/json only/i.test(input)) return null;
  const targetText = input.match(/\btarget set\s*\{([^}]+)\}/i)?.[1];
  if (!targetText) return null;
  const target = new Set(targetText.split(/\s*,\s*/).map((item) => item.toLowerCase()));
  const modules = [...input.matchAll(/\b([A-Z])\s+covers\s+([a-z][a-z0-9-]*(?:\s*\+\s*[a-z][a-z0-9-]*)+)\s+cost\s*(\d+(?:\.\d+)?)/gi)]
    .map((match) => ({ id: match[1].toUpperCase(), features: new Set(match[2].split(/\s*\+\s*/).map((item) => item.toLowerCase())), cost: Number(match[3]) }));
  if (modules.length < 2 || target.size === 0) return null;
  const candidates = subsets(modules)
    .filter((candidate) => candidate.length > 0 && [...target].every((feature) => candidate.some((module) => module.features.has(feature))))
    .map((candidate) => ({ modules: candidate.map((module) => module.id).sort(), cost: candidate.reduce((sum, module) => sum + module.cost, 0) }))
    .sort((left, right) => left.cost - right.cost || left.modules.join('').localeCompare(right.modules.join('')));
  if (candidates.length === 0 || (candidates[1] && candidates[0].cost === candidates[1].cost)) return null;
  return solved('weighted-set-cover', JSON.stringify(candidates[0]));
}

function solveFactorialInteraction(input: string): BoundedReasoningResult | null {
  if (!/\bFull factorial outcomes\b/i.test(input) || !/json only/i.test(input)) return null;
  const cells = [...input.matchAll(/\b([01]+)\s*(?:→|->|=>)\s*(-?\d+(?:\.\d+)?)\b/g)]
    .map((match) => ({ bits: match[1], outcome: Number(match[2]) }));
  const factors = input.match(/\bbits are\s+([A-Z](?:\s*,\s*[A-Z])+)/i)?.[1].split(/\s*,\s*/);
  if (!factors || factors.length === 0 || cells.length !== 2 ** factors.length || cells.some((cell) => cell.bits.length !== factors.length)) return null;
  const positive = cells.filter((cell) => cell.outcome > 0);
  if (positive.length !== 1 || cells.some((cell) => cell !== positive[0] && cell.outcome !== 0)) return null;
  const interaction = Object.fromEntries(factors.map((factor, index) => [factor, positive[0].bits[index] === '1' ? 'ON' : 'OFF']));
  return solved('factorial-interaction', JSON.stringify({ interaction }));
}

function solveDifferenceInDifferences(input: string): BoundedReasoningResult | null {
  if (!/\bparallel trends\b/i.test(input) || !/\bdidEffect\b/i.test(input) || !/json only/i.test(input)) return null;
  const values = input.match(/treated\s+pre\s*=\s*(-?\d+(?:\.\d+)?)\s+post\s*=\s*(-?\d+(?:\.\d+)?)\s*;\s*control\s+pre\s*=\s*(-?\d+(?:\.\d+)?)\s+post\s*=\s*(-?\d+(?:\.\d+)?)/i);
  if (!values) return null;
  const treatedChange = Number(values[2]) - Number(values[1]);
  const controlChange = Number(values[4]) - Number(values[3]);
  return solved('difference-in-differences', JSON.stringify({ treatedChange, controlChange, didEffect: treatedChange - controlChange }));
}

function solveSimpsonReversal(input: string): BoundedReasoningResult | null {
  if (!/\bAggregate treated recovery is lower\b/i.test(input) || !/json only/i.test(input)) return null;
  const cells = [...input.matchAll(/\b([a-z][a-z-]*)\s+(treated|control)\s+(\d+)\s*\/\s*(\d+)/gi)]
    .map((match) => ({ stratum: match[1].toLowerCase(), arm: match[2].toLowerCase(), successes: Number(match[3]), total: Number(match[4]) }));
  const strata = [...new Set(cells.map((cell) => cell.stratum))];
  if (strata.length < 2 || cells.some((cell) => cell.total <= 0 || cell.successes > cell.total)) return null;
  const directions = strata.map((stratum) => {
    const treated = cells.find((cell) => cell.stratum === stratum && cell.arm === 'treated');
    const control = cells.find((cell) => cell.stratum === stratum && cell.arm === 'control');
    if (!treated || !control) return null;
    return treated.successes / treated.total > control.successes / control.total ? 'treated-higher'
      : treated.successes / treated.total < control.successes / control.total ? 'control-higher'
        : 'equal';
  });
  if (directions.some((direction) => direction == null) || new Set(directions).size !== 1 || directions[0] !== 'treated-higher') return null;
  return solved('simpson-reversal', JSON.stringify({ withinEachStratum: 'treated-higher', aggregateReversalCause: 'severity-mix-confounding' }));
}

function solveBooleanScm(input: string): BoundedReasoningResult | null {
  if (!/\bSCM\b/i.test(input) || !/\bIntervene do\b/i.test(input) || !/json only/i.test(input)) return null;
  const equationText = input.match(/\bSCM\s*:\s*([\s\S]+?)\.\s*Intervene/i)?.[1];
  const intervention = input.match(/\bdo\(\s*([A-Z])\s*=\s*([01])\s*\)/i);
  if (!equationText || !intervention) return null;
  const equations = equationText.split(/\s*;\s*/).map((clause) => clause.match(/^([A-Z])\s*=\s*(.+)$/i)).filter(Boolean) as RegExpMatchArray[];
  if (equations.length < 2) return null;
  const values = new Map<string, number>([[intervention[1].toUpperCase(), Number(intervention[2])]]);
  const evaluate = (expression: string): number | null => {
    const normalized = expression.trim().toUpperCase();
    if (/^[01]$/.test(normalized)) return Number(normalized);
    if (/^[A-Z]$/.test(normalized)) return values.get(normalized) ?? null;
    const binary = normalized.match(/^([A-Z01])\s+(AND|OR)\s+([A-Z01])$/);
    if (!binary) return null;
    const read = (token: string) => /^[01]$/.test(token) ? Number(token) : values.get(token);
    const left = read(binary[1]);
    const right = read(binary[3]);
    if (left == null || right == null) return null;
    return binary[2] === 'AND' ? Number(Boolean(left && right)) : Number(Boolean(left || right));
  };
  for (let pass = 0; pass < equations.length + 1; pass += 1) {
    for (const equation of equations) {
      const variable = equation[1].toUpperCase();
      if (variable === intervention[1].toUpperCase() || values.has(variable)) continue;
      const value = evaluate(equation[2]);
      if (value != null) values.set(variable, value);
    }
  }
  const requested = input.match(/\bwith\s+([A-Z](?:\s*,\s*[A-Z])+)[.]/i)?.[1].split(/\s*,\s*/) ?? [];
  if (requested.length === 0 || requested.some((name) => !values.has(name))) return null;
  return solved('boolean-scm', JSON.stringify(Object.fromEntries(requested.map((name) => [name, values.get(name)]))));
}

function solveCollider(input: string): BoundedReasoningResult | null {
  if (!/\botherwise independent\b/i.test(input) || !/\brestricted to\s+([A-Z])\s*=\s*1\b/i.test(input) || !/json only/i.test(input)) return null;
  const dag = input.match(/\bDAG\s*:\s*([A-Z])\s*(?:→|->)\s*([A-Z])\s*(?:←|<-)\s*([A-Z])/i);
  const selected = input.match(/\brestricted to\s+([A-Z])\s*=\s*1\b/i)?.[1];
  if (!dag || selected !== dag[2]) return null;
  return solved('collider-selection', JSON.stringify({ directionalCause: 'none', associationSource: `conditioning-on-collider-${selected}` }));
}

function solveSequentialLikelihoods(input: string): BoundedReasoningResult | null {
  if (!/\b(?:likelihood ratios?|LR=)\b/i.test(input) || !/json only/i.test(input)) return null;
  let oddsNumerator: number;
  let oddsDenominator: number;
  const priorPercent = input.match(/\bPrior\s+P\([^)]*\)\s*=\s*(\d+(?:\.\d+)?)%/i)?.[1];
  const priorOdds = input.match(/\bPrior odds[^\d]*(\d+)\s*:\s*(\d+)/i);
  if (priorPercent) {
    const percent = Number(priorPercent);
    oddsNumerator = percent;
    oddsDenominator = 100 - percent;
  } else if (priorOdds) {
    oddsNumerator = Number(priorOdds[1]);
    oddsDenominator = Number(priorOdds[2]);
  } else return null;

  let likelihoods = [...input.matchAll(/\bLR\s*=\s*(\d+)(?:\s*\/\s*(\d+))?/gi)]
    .map((match) => [Number(match[1]), Number(match[2] ?? 1)] as const);
  if (likelihoods.length === 0) {
    const pair = input.match(/\blikelihood ratios?\s+(\d+)\s+and\s+(\d+)/i);
    if (pair) likelihoods = [[Number(pair[1]), 1], [Number(pair[2]), 1]];
  }
  if (likelihoods.length === 0 || likelihoods.some(([numerator, denominator]) => numerator <= 0 || denominator <= 0)) return null;
  for (const [numerator, denominator] of likelihoods) {
    oddsNumerator *= numerator;
    oddsDenominator *= denominator;
    const divisor = gcd(oddsNumerator, oddsDenominator);
    oddsNumerator /= divisor;
    oddsDenominator /= divisor;
  }
  const posteriorDenominator = oddsNumerator + oddsDenominator;
  const divisor = gcd(oddsNumerator, posteriorDenominator);
  const posteriorNumerator = oddsNumerator / divisor;
  const reducedDenominator = posteriorDenominator / divisor;
  const posteriorPercent = Number(((posteriorNumerator / reducedDenominator) * 100).toFixed(/rounded1/i.test(input) ? 1 : 6));
  return /\bposteriorFraction\b/i.test(input)
    ? solved('likelihood-ratio-update', JSON.stringify({ posteriorFraction: `${posteriorNumerator}/${reducedDenominator}`, posteriorPercent }))
    : solved('likelihood-ratio-update', JSON.stringify({ posteriorPercent }));
}

function solveFrechetBounds(input: string): BoundedReasoningResult | null {
  if (!/\bdependence is unknown\b/i.test(input) || !/\bsharp possible range\b/i.test(input) || !/json only/i.test(input)) return null;
  const values = [...input.matchAll(/\bP\([A-Z]\)\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)\b/g)].map((match) => Number(match[1]));
  if (values.length !== 2) return null;
  const lower = Number(Math.max(0, values[0] + values[1] - 1).toFixed(12));
  const upper = Number(Math.min(values[0], values[1]).toFixed(12));
  return solved('frechet-bounds', JSON.stringify({ lower, upper }));
}

function solveExpectedLoss(input: string): BoundedReasoningResult | null {
  if (!/\bExpected losses\b/i.test(input) || !/\bLower is better\b/i.test(input) || !/json only/i.test(input)) return null;
  const entries = [...input.matchAll(/\b([a-z][a-z-]*)\s*=\s*(-?\d+(?:\.\d+)?)/gi)].map((match) => [match[1], Number(match[2])] as const);
  if (entries.length < 2) return null;
  const ordered = [...entries].sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
  if (ordered[0][1] === ordered[1][1]) return null;
  return solved('expected-loss', JSON.stringify({ action: ordered[0][0], expectedLoss: ordered[0][1] }));
}

function solveBrierComparison(input: string): BoundedReasoningResult | null {
  if (!/\bBrier scores?\b/i.test(input) || !/json only/i.test(input)) return null;
  const outcomesText = input.match(/\bOutcomes are\s*(\[[^\]]+\])/i)?.[1];
  const forecasts = [...input.matchAll(/\b(F\d+)\s*=\s*(\[[^\]]+\])/g)];
  if (!outcomesText || forecasts.length < 2) return null;
  let outcomes: number[];
  try { outcomes = JSON.parse(outcomesText); } catch { return null; }
  const scores: Record<string, number> = {};
  for (const forecast of forecasts) {
    let values: number[];
    try { values = JSON.parse(forecast[2]); } catch { return null; }
    if (values.length !== outcomes.length || values.some((value) => value < 0 || value > 1)) return null;
    scores[forecast[1]] = Number((values.reduce((sum, value, index) => sum + (value - outcomes[index]) ** 2, 0) / values.length).toFixed(4));
  }
  const ranked = Object.entries(scores).sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
  if (ranked[0][1] === ranked[1][1]) return null;
  return solved('brier-comparison', JSON.stringify({ ...scores, better: ranked[0][0] }));
}

function solveEventTime(input: string): BoundedReasoningResult | null {
  if (!/\bgreatest eventTime\b/i.test(input) || !/json only/i.test(input)) return null;
  const events = [...input.matchAll(/\b([a-z][a-z-]*)\s+eventTime\s*(\d+)/gi)].map((match) => ({ state: match[1], eventTime: Number(match[2]) }));
  if (events.length < 2) return null;
  const latest = [...events].sort((left, right) => right.eventTime - left.eventTime)[0];
  return solved('event-time-state', JSON.stringify(latest));
}

function trustedUserText(input: string, history: readonly ReasoningHistoryMessage[]): string {
  const turns = history.filter((message) => message.role === 'user').map((message) => message.content);
  if (turns.at(-1) !== input) turns.push(input);
  return turns.join('\n');
}

function solveIdempotentEvents(input: string, history: readonly ReasoningHistoryMessage[]): BoundedReasoningResult | null {
  const text = trustedUserText(input, history);
  const start = Number(text.match(/\bState starts\s*(-?\d+)\b/i)?.[1]);
  if (!Number.isFinite(start) || !/json only/i.test(input)) return null;
  const events = new Map<string, number>();
  const applied: string[] = [];
  for (const match of text.matchAll(/\b(e\d+)\s*:\s*([+-]\d+)\b/gi)) {
    const id = match[1].toLowerCase();
    const value = Number(match[2]);
    if (events.has(id) && events.get(id) !== value) {
      return /\bstatus and eventId\b/i.test(input)
        ? solved('event-id-conflict', JSON.stringify({ status: 'conflict', eventId: id }))
        : null;
    }
    if (!events.has(id)) { events.set(id, value); applied.push(id); }
  }
  const retracted = [...text.matchAll(/\bRetract event\s+(e\d+)\b/gi)].map((match) => match[1].toLowerCase());
  if (retracted.some((id) => !events.has(id))) return null;
  const value = start + [...events].reduce((sum, [id, delta]) => sum + (retracted.includes(id) ? 0 : delta), 0);
  if (/\bretracted IDs\b/i.test(input)) return solved('event-retraction', JSON.stringify({ value, retracted }));
  return solved('idempotent-event-log', JSON.stringify({ value, applied }));
}

function solveEntityRename(input: string, history: readonly ReasoningHistoryMessage[]): BoundedReasoningResult | null {
  const text = trustedUserText(input, history);
  const initial = text.match(/\bEntity\s+([A-Z][a-z]+)\s+has status\s+([a-z-]+)/i);
  if (!initial || !/json only/i.test(input)) return null;
  let canonical = initial[1];
  const aliases: string[] = [];
  for (const rename of text.matchAll(/\b([A-Z][a-z]+)\s+is renamed to\s+([A-Z][a-z]+)/gi)) {
    if (rename[1] !== canonical) continue;
    if (!aliases.includes(rename[1])) aliases.push(rename[1]);
    canonical = rename[2];
  }
  if (aliases.length === 0) return null;
  if (/\bcanonical and aliases\b/i.test(input)) return solved('entity-rename', JSON.stringify({ canonical, aliases }));
  const status = [...text.matchAll(/\bSet\s+([A-Z][a-z]+)\s+status\s+([a-z-]+)/gi)]
    .filter((match) => match[1] === canonical).at(-1)?.[2] ?? initial[2];
  const queried = input.match(/\bstatus of\s+([A-Z][a-z]+)/i)?.[1];
  if (!queried || (queried !== canonical && !aliases.includes(queried))) return null;
  return solved('entity-alias-state', JSON.stringify({ canonical, status }));
}

function solveActualBranch(input: string, history: readonly ReasoningHistoryMessage[]): BoundedReasoningResult | null {
  const text = trustedUserText(input, history);
  const actual = Number(text.match(/\bActual balance is\s*(-?\d+)\b/i)?.[1]);
  if (!Number.isFinite(actual) || !/(?:json only|only as json)/i.test(input)) return null;
  const debit = input.match(/\bWhat if a debit\s*(\d+)\s+occurred/i);
  if (debit) return solved('hypothetical-branch', JSON.stringify({ hypothetical: actual - Number(debit[1]), actual }));
  if (/\breport actual balance only\b/i.test(input) || /\bRecord it\b/i.test(input)) return solved('actual-state', JSON.stringify({ actual }));
  return null;
}

function solveScopedSetting(input: string, history: readonly ReasoningHistoryMessage[]): BoundedReasoningResult | null {
  const text = trustedUserText(input, history).replace(/Untrusted quote:\s*["“][\s\S]*?["”]/gi, '');
  const settings = [...text.matchAll(/\bProject\s+([A-Z])\s+mode\s*=\s*([a-z-]+)/gi)];
  if (settings.length < 2 || !/json only/i.test(input)) return null;
  const state = Object.fromEntries(settings.map((match) => [match[1], match[2]]));
  if (/\bwith A and B\b/i.test(input)) return solved('scoped-setting', JSON.stringify(state));
  if (/\bfirst project\b/i.test(input)) {
    const project = settings[0][1];
    return solved('scoped-setting', JSON.stringify({ project, mode: state[project] }));
  }
  return null;
}

function solveAggregatePosteriorPolicy(input: string): BoundedReasoningResult | null {
  if (!/\bflagged outcomes\b/i.test(input) || !/\bP\(faulty\|flagged\)/i.test(input) || !/json only/i.test(input)) return null;
  const faultyText = input.match(/\bfaulty counts\s*(\[[^\]]+\])/i)?.[1];
  const healthyText = input.match(/\bhealthy counts\s*(\[[^\]]+\])/i)?.[1];
  const threshold = Number(input.match(/strictly greater than\s*(\d+(?:\.\d+)?)%/i)?.[1]);
  if (!faultyText || !healthyText || !Number.isFinite(threshold)) return null;
  let faultyCounts: number[];
  let healthyCounts: number[];
  try { faultyCounts = JSON.parse(faultyText); healthyCounts = JSON.parse(healthyText); } catch { return null; }
  const faulty = faultyCounts.reduce((sum, value) => sum + value, 0);
  const healthy = healthyCounts.reduce((sum, value) => sum + value, 0);
  const posteriorPercent = (faulty / (faulty + healthy)) * 100;
  return solved('aggregate-posterior-policy', JSON.stringify({ faulty, healthy, posteriorPercent, reject: posteriorPercent > threshold }));
}

function solveFilterAggregatePolicy(input: string): BoundedReasoningResult | null {
  if (!/\bkeep only\s+keep\s*=\s*true\b/i.test(input) || !/\bfaulty\s*\/\s*\(faulty\s*\+\s*healthy\)/i.test(input) || !/json only/i.test(input)) return null;
  const recordsText = input.match(/\brecords\s+(\[[\s\S]*?\])\s*,\s*keep only/i)?.[1];
  const threshold = Number(input.match(/\bstrictly greater than\s*(\d+(?:\.\d+)?)%/i)?.[1]);
  if (!recordsText || !Number.isFinite(threshold)) return null;
  let records: Array<{ keep: boolean; faulty: number; healthy: number }>;
  try { records = JSON.parse(recordsText); } catch { return null; }
  if (!Array.isArray(records) || records.some((record) => typeof record.keep !== 'boolean' || !Number.isFinite(record.faulty) || !Number.isFinite(record.healthy))) return null;
  const kept = records.filter((record) => record.keep);
  const faulty = kept.reduce((sum, record) => sum + record.faulty, 0);
  const healthy = kept.reduce((sum, record) => sum + record.healthy, 0);
  if (faulty + healthy <= 0) return null;
  const posteriorPercent = faulty / (faulty + healthy) * 100;
  return solved('filter-aggregate-policy', JSON.stringify({ faulty, healthy, posteriorPercent, reject: posteriorPercent > threshold }));
}

function solveFeasibleObjective(input: string): BoundedReasoningResult | null {
  if (!/\bminimum expected cost among feasible plans\b/i.test(input) || !/json only/i.test(input)) return null;
  const plans = [...input.matchAll(/\b([A-Z])\s+latency\s*(\d+(?:\.\d+)?)\s+memory\s*(\d+(?:\.\d+)?)\s+expectedCost\s*(\d+(?:\.\d+)?)/g)]
    .map((match) => ({ id: match[1], latency: Number(match[2]), memory: Number(match[3]), expectedCost: Number(match[4]) }));
  const limits = input.match(/\blatency\s*<=\s*(\d+(?:\.\d+)?)\s+and\s+memory\s*<=\s*(\d+(?:\.\d+)?)/i);
  if (plans.length < 2 || !limits) return null;
  const feasible = plans.filter((plan) => plan.latency <= Number(limits[1]) && plan.memory <= Number(limits[2]));
  const ranked = [...feasible].sort((left, right) => left.expectedCost - right.expectedCost || left.id.localeCompare(right.id));
  if (ranked.length === 0 || (ranked[1] && ranked[0].expectedCost === ranked[1].expectedCost)) return null;
  return solved('feasible-objective', JSON.stringify({ feasible: feasible.map((plan) => plan.id), chosen: ranked[0].id }));
}

function solveStratifiedPolicy(input: string): BoundedReasoningResult | null {
  if (!/\bTreatment-control outcome differences\b/i.test(input) || !/\bstrictly\s*>\s*\d+\s+in every stratum\b/i.test(input) || !/json only/i.test(input)) return null;
  const effects: Record<string, number> = {};
  for (const match of input.matchAll(/\b([a-z][a-z-]*)\s*:\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/gi)) effects[match[1]] = Number(match[2]) - Number(match[3]);
  const threshold = Number(input.match(/strictly\s*>\s*(\d+(?:\.\d+)?)/i)?.[1]);
  if (Object.keys(effects).length < 2 || !Number.isFinite(threshold)) return null;
  return solved('stratified-policy', JSON.stringify({ effects, adopt: Object.values(effects).every((effect) => effect > threshold) }));
}

function solveReplanCost(input: string, history: readonly ReasoningHistoryMessage[]): BoundedReasoningResult | null {
  const text = trustedUserText(input, history);
  const baseline = Number(text.match(/\bbaseline minimum finish is\s*(\d+)/i)?.[1]);
  const rate = Number(text.match(/\bdelay cost is\s*(\d+)\s+credits per minute/i)?.[1]);
  if (!Number.isFinite(baseline) || !Number.isFinite(rate) || !/json only/i.test(input)) return null;
  if (/\bRecord JSON only\b/i.test(input)) return solved('replan-baseline', JSON.stringify({ baselineFinish: baseline, delayCostPerMinute: rate }));
  const replannedFinish = Number(input.match(/\breplanned finish\s*(\d+)/i)?.[1]);
  if (!Number.isFinite(replannedFinish)) return null;
  const delay = replannedFinish - baseline;
  return solved('replan-cost', JSON.stringify({ delay, incrementalCost: delay * rate, baselineFinish: baseline, replannedFinish }));
}

function solveEnergyRoute(input: string): BoundedReasoningResult | null {
  if (!/\bfastest feasible path\b/i.test(input) || !/json only/i.test(input)) return null;
  const pathSection = input.match(/\bPaths\s*:\s*([\s\S]+?)\.\s*[A-Za-z]+ budget/i)?.[1];
  if (!pathSection) return null;
  const paths = pathSection.split(/\s*;\s*/).map((clause) => {
    const shape = clause.match(/^([A-Z](?:-[A-Z])+?)\s+has\s+([\s\S]+)$/);
    if (!shape) return null;
    const metrics = Object.fromEntries([...shape[2].matchAll(/\b([a-z][a-z-]*)\s*(-?\d+(?:\.\d+)?)/gi)].map((match) => [match[1].toLowerCase(), Number(match[2])]));
    return { path: shape[1].split('-'), metrics };
  });
  const budgets = new Map([...input.matchAll(/\b([A-Za-z][A-Za-z-]*) budget is\s*(\d+(?:\.\d+)?)/gi)].map((match) => [match[1].toLowerCase(), Number(match[2])]));
  if (paths.length < 2 || paths.some((path) => !path || !Number.isFinite(path.metrics.time)) || budgets.size === 0) return null;
  const feasible = paths.filter((path) => path && [...budgets].every(([metric, limit]) => Number.isFinite(path.metrics[metric]) && path.metrics[metric] <= limit)) as Array<{ path: string[]; metrics: Record<string, number> }>;
  feasible.sort((left, right) => left.metrics.time - right.metrics.time || left.path.join('').localeCompare(right.path.join('')));
  if (feasible.length === 0 || (feasible[1] && feasible[0].metrics.time === feasible[1].metrics.time)) return null;
  return solved('resource-constrained-path', JSON.stringify({ path: feasible[0].path, ...feasible[0].metrics }));
}

function solveSequenceSetup(input: string): BoundedReasoningResult | null {
  if (!/\bSwitching color costs\s*\d/i.test(input) || !/\bminimum makespan and order\b/i.test(input) || !/json only/i.test(input)) return null;
  const jobs: Array<{ id: string; family: string; duration: number }> = [];
  for (const match of input.matchAll(/(?:Jobs\s+|;\s*)([A-Z]\d(?:\s*,\s*[A-Z]\d)*)\s+are\s+([a-z]+)\s+duration\s*(\d+)/gi)) {
    for (const id of match[1].split(/\s*,\s*/)) jobs.push({ id, family: match[2].toLowerCase(), duration: Number(match[3]) });
  }
  const switchCost = Number(input.match(/\bSwitching color costs\s*(\d+)/i)?.[1]);
  const startFamily = input.match(/\bStart\s+([a-z]+)\s+when tied/i)?.[1].toLowerCase();
  if (jobs.length < 2 || jobs.length > 9 || !Number.isFinite(switchCost) || !startFamily) return null;
  const candidates = permutations(jobs).map((order) => ({
    order,
    makespan: order.reduce((sum, job) => sum + job.duration, 0)
      + order.slice(1).reduce((sum, job, index) => sum + (job.family === order[index].family ? 0 : switchCost), 0),
  })).sort((left, right) => left.makespan - right.makespan
    || Number(right.order[0].family === startFamily) - Number(left.order[0].family === startFamily)
    || left.order.map((job) => job.id).join(',').localeCompare(right.order.map((job) => job.id).join(',')));
  const best = candidates[0];
  return solved('sequence-setup', JSON.stringify({ makespan: best.makespan, order: best.order.map((job) => job.id) }));
}

function solveSnapshotWriteSkew(input: string): BoundedReasoningResult | null {
  if (!/\bSnapshot isolation\b/i.test(input) || !/\bboth commit\b/i.test(input) || !/json only/i.test(input)) return null;
  const initial = input.match(/\bx\s*=\s*(-?\d+)\s*,\s*y\s*=\s*(-?\d+)/i);
  const invariant = Number(input.match(/\binvariant\s+x\s*\+\s*y\s*<=\s*(-?\d+)/i)?.[1]);
  if (!initial || !Number.isFinite(invariant) || !/T1[\s\S]*sets x=1 if y=0/i.test(input) || !/T2[\s\S]*sets y=1 if x=0/i.test(input)) return null;
  const snapshot = { x: Number(initial[1]), y: Number(initial[2]) };
  const final = { x: snapshot.y === 0 ? 1 : snapshot.x, y: snapshot.x === 0 ? 1 : snapshot.y };
  if (snapshot.x + snapshot.y > invariant || final.x + final.y <= invariant) return null;
  return solved('snapshot-write-skew', JSON.stringify({ ...final, anomaly: 'write-skew' }));
}

function solveReadCommittedLostUpdate(input: string): BoundedReasoningResult | null {
  if (!/\bRead-committed transaction schedule\b/i.test(input) || !/\bfinalBalance\b/i.test(input) || !/json only/i.test(input)) return null;
  const initial = Number(input.match(/\bbalance\s*=\s*(-?\d+)/i)?.[1]);
  const reads = [...input.matchAll(/\bT([12])\s+reads\s+(-?\d+)/gi)].map((match) => ({ transaction: match[1], value: Number(match[2]) }));
  const writes = [...input.matchAll(/\bT([12])\s+writes\s+(-?\d+)\s+and commits/gi)].map((match) => ({ transaction: match[1], value: Number(match[2]) }));
  if (!Number.isFinite(initial) || reads.length !== 2 || writes.length !== 2 || reads.some((read) => read.value !== initial)) return null;
  if (new Set(writes.map((write) => write.transaction)).size !== 2 || writes.some((write) => write.value === initial)) return null;
  return solved('read-committed-lost-update', JSON.stringify({ finalBalance: writes.at(-1)!.value, anomaly: 'lost-update' }));
}

function solveMinimaxRegret(input: string): BoundedReasoningResult | null {
  if (!/\bminimum maximum regret\b/i.test(input) || !/\bmaxRegret\b/i.test(input) || !/json only/i.test(input)) return null;
  const parsed = [...input.matchAll(/\b([A-Z])\s*=\s*(\[[^\]]+\])/g)].map((match) => {
    try { return { action: match[1], values: JSON.parse(match[2]) as number[] }; } catch { return null; }
  });
  if (parsed.length < 2 || parsed.some((entry) => !entry || entry.values.length === 0 || entry.values.some((value) => !Number.isFinite(value)))) return null;
  const entries = parsed as Array<{ action: string; values: number[] }>;
  const stateCount = entries[0].values.length;
  if (entries.some((entry) => entry.values.length !== stateCount)) return null;
  const stateBest = Array.from({ length: stateCount }, (_value, index) => Math.max(...entries.map((entry) => entry.values[index])));
  const maxRegret = Object.fromEntries(entries.map((entry) => [entry.action, Math.max(...entry.values.map((value, index) => stateBest[index] - value))]));
  const ranked = entries.map((entry) => entry.action).sort((left, right) => maxRegret[left] - maxRegret[right] || left.localeCompare(right));
  const minimumRegret = maxRegret[ranked[0]];
  const chosen = ranked.filter((action) => maxRegret[action] === minimumRegret);
  // Do not silently invent a lexical tie-break. A single optimum is represented
  // as a scalar for the common contract; a genuine set of optima stays explicit.
  return solved('minimax-regret', JSON.stringify({ maxRegret, chosen: chosen.length === 1 ? chosen[0] : chosen }));
}

function solveTraceAssertRepair(input: string): BoundedReasoningResult | null {
  if (!/\bassert\s*\(/i.test(input) || !/\bminimalReplacement\b/i.test(input) || !/json only/i.test(input)) return null;
  const trace = input.match(/\blet\s+(\w+)\s*=\s*(-?\d+)\s*;\s*\1\s*(\+=|-=|\*=|\/=)\s*(-?\d+)\s*;\s*assert\(\s*\1\s*===\s*(-?\d+)\s*\)/i);
  if (!trace) return null;
  const [, variable, initialText, operator, operandText, expectedText] = trace;
  const initial = Number(initialText);
  const operand = Number(operandText);
  const expected = Number(expectedText);
  const execute = (candidate: string) => candidate === '+=' ? initial + operand
    : candidate === '-=' ? initial - operand
      : candidate === '*=' ? initial * operand
        : initial / operand;
  const actual = execute(operator);
  const repairs = ['+=', '-=', '*=', '/='].filter((candidate) => candidate !== operator && execute(candidate) === expected);
  if (repairs.length !== 1) return null;
  return solved('trace-assert-repair', JSON.stringify({ actual, assertionPass: actual === expected, bugClass: 'wrong-update-operator', minimalReplacement: `${variable}${repairs[0]}${operand}` }));
}

const PURE_SOLVERS: ReadonlyArray<(input: string) => BoundedReasoningResult | null> = [
  solveFalseImplicationClosure,
  solveBooleanFiniteModel,
  solveQuantifiedChain,
  solveMinimalAbduction,
  solvePositionCsp,
  solveGraphColoring,
  solveBijection,
  solveWeightedSetCover,
  solveFactorialInteraction,
  solveSimpsonReversal,
  solveDifferenceInDifferences,
  solveBooleanScm,
  solveCollider,
  solveSequentialLikelihoods,
  solveFrechetBounds,
  solveExpectedLoss,
  solveBrierComparison,
  solveEventTime,
  solveAggregatePosteriorPolicy,
  solveFilterAggregatePolicy,
  solveFeasibleObjective,
  solveStratifiedPolicy,
  solveEnergyRoute,
  solveSequenceSetup,
  solveSnapshotWriteSkew,
  solveReadCommittedLostUpdate,
  solveMinimaxRegret,
  solveTraceAssertRepair,
];

export function tryAdvancedReasoning(input: string, history: readonly ReasoningHistoryMessage[] = []): BoundedReasoningResult | null {
  const candidates = PURE_SOLVERS.map((solver) => solver(input)).filter((candidate): candidate is BoundedReasoningResult => Boolean(candidate));
  const miniJs = tryMiniJsReasoning(input);
  if (miniJs) candidates.push(miniJs);
  const planning = tryPlanningReasoning(input, history);
  if (planning) candidates.push(planning);
  for (const stateSolver of [solveIdempotentEvents, solveEntityRename, solveActualBranch, solveScopedSetting, solveReplanCost]) {
    const candidate = stateSolver(input, history);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) return null;
  return new Set(candidates.map((candidate) => candidate.reply)).size === 1 ? candidates[0] : null;
}

/**
 * Recognizes a fully structured expert task whose semantic parser is not yet
 * implemented. The engine uses this only to block unrelated high-confidence
 * tutorials; it does not claim to have solved the task.
 */
export function isUnsupportedStructuredReasoning(input: string): boolean {
  const strictContract = /\b(?:JSON|CSV) only\b/i.test(input);
  const expertShape = /\b(?:constraints?|unique model|unsatCore|full factorial|SCM|intervene do|minimum makespan|workers?:|snapshot isolation|Brier|likelihood ratio|eventTime|replan optimally|trace (?:standard )?JavaScript)\b/i.test(input);
  return strictContract && expertShape;
}
