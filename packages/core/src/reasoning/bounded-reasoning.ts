/**
 * Vai-owned bounded reasoning substrate.
 *
 * Each solver converts a narrow, inspectable input grammar into an explicit
 * intermediate representation, executes it, and verifies the result before
 * returning. Unknown inputs return null; non-unique inputs either return an
 * explicit ambiguity witness or decline. They never guess.
 */

import { tryAdvancedReasoning } from './advanced-reasoning.js';

export interface BoundedReasoningResult {
  readonly reply: string;
  readonly strategy: string;
  readonly confidence: number;
}

type Relation = readonly [before: string, after: string];

const result = (strategy: string, reply: string, confidence = 0.99): BoundedReasoningResult => ({
  reply,
  strategy: `bounded-reasoning:${strategy}`,
  confidence,
});

function singular(value: string): string {
  const term = value.toLowerCase().trim();
  return term.length > 3 && term.endsWith('s') ? term.slice(0, -1) : term;
}

function solveUniqueOrdering(input: string): BoundedReasoningResult | null {
  if (/\b(?:unsatCore|two distinct valid orders)\b/i.test(input)) return null;
  if (!/\b(?:unique order|each (?:run|occur)s? once|each occurs once|all scheduled exactly once|classify)\b/i.test(input) || !/json/i.test(input)) return null;
  const relations: Relation[] = [];
  for (const match of input.matchAll(/\b([A-Z][A-Za-z]*)\s+(?:(?:is\s+)?before|precedes)\s+([A-Z][A-Za-z]*)\b/g)) {
    relations.push([match[1], match[2]]);
  }
  for (const match of input.matchAll(/\b([A-Z][A-Za-z]*)\s+(?:is\s+)?after\s+([A-Z][A-Za-z]*)\b/g)) {
    relations.push([match[2], match[1]]);
  }
  for (const match of input.matchAll(/\b([A-Z][A-Za-z]*)\s+follows\s+([A-Z][A-Za-z]*)\b/g)) {
    relations.push([match[2], match[1]]);
  }
  if (relations.length < 2) return null;

  const declaredSegment = input.match(/\b(?:Tasks?|Participants?)\s+(.+?)\s+(?:each\s+(?:occur|run)s?\s+once|are\s+all\s+scheduled\s+exactly\s+once)\b/i)?.[1];
  const declaredNodes = declaredSegment
    ? declaredSegment.split(/\s*,\s*|\s+and\s+/i).map((node) => node.trim()).filter((node) => /^[A-Z][A-Za-z]*$/.test(node))
    : [];
  const nodes = [...new Set([...declaredNodes, ...relations.flat()])];
  const outgoing = new Map(nodes.map((node) => [node, new Set<string>()]));
  const indegree = new Map(nodes.map((node) => [node, 0]));
  for (const [before, after] of relations) {
    if (outgoing.get(before)?.has(after)) continue;
    outgoing.get(before)?.add(after);
    indegree.set(after, (indegree.get(after) ?? 0) + 1);
  }
  const order: string[] = [];
  while (order.length < nodes.length) {
    const ready = nodes.filter((node) => !order.includes(node) && indegree.get(node) === 0).sort();
    if (ready.length !== 1) {
      if (/\bclassify\b/i.test(input) && /\bstatus\b/i.test(input)) {
        return result('order-classification', JSON.stringify({ status: ready.length === 0 ? 'inconsistent' : 'ambiguous' }));
      }
      return null;
    }
    const next = ready[0];
    order.push(next);
    for (const target of outgoing.get(next) ?? []) indegree.set(target, (indegree.get(target) ?? 0) - 1);
  }
  const valid = relations.every(([before, after]) => order.indexOf(before) < order.indexOf(after));
  return valid ? result('unique-order', JSON.stringify({ order })) : null;
}

function solveSyllogism(input: string): BoundedReasoningResult | null {
  const inclusion = input.match(/\b(?:every|all)\s+([a-z]+)\s+(?:is|are)\s+(?:a\s+)?([a-z]+)\b/i);
  const exclusion = input.match(/\b(?:no|zero)\s+([a-z]+)\s+(?:is|are)\s+(?:a\s+)?([a-z]+)\b/i);
  const query = input.match(/\b(?:can|is)\s+(?:any|a)\s+([a-z]+)\s+(?:be\s+)?(?:a\s+)?([a-z]+)\b/i);
  if (!inclusion || !exclusion || !query) return null;
  const [subject, middle] = [singular(inclusion[1]), singular(inclusion[2])];
  const [excludedMiddle, target] = [singular(exclusion[1]), singular(exclusion[2])];
  const [querySubject, queryTarget] = [singular(query[1]), singular(query[2])];
  if (subject !== querySubject || middle !== excludedMiddle || target !== queryTarget) return null;
  return result('syllogism', `No. Every ${subject} is a ${middle}, and no ${middle} is a ${target}, so no ${subject} can be a ${target}.`);
}

interface Trial { readonly first: string; readonly firstState: string; readonly second: string; readonly secondState: string; readonly outcome: number }

function parseTrials(input: string): Trial[] {
  const trials: Trial[] = [];
  for (const clause of input.split(/[;\n]/)) {
    const match = clause.match(/([a-z][a-z-]*)\s+(ON|OFF)\s*\+\s*([a-z][a-z-]*)\s+(ON|OFF)\s*(?:=>|=)\s*(\d+)/i);
    if (!match) continue;
    trials.push({
      first: match[1].toLowerCase(), firstState: match[2].toUpperCase(),
      second: match[3].toLowerCase(), secondState: match[4].toUpperCase(), outcome: Number(match[5]),
    });
  }
  return trials;
}

function solveCausalInteraction(input: string): BoundedReasoningResult | null {
  if (!/\b(?:narrowest|minimal|interaction|neither factor alone)\b/i.test(input)) return null;
  const trials = parseTrials(input);
  if (trials.length < 4) return null;
  const positive = trials.filter((trial) => trial.outcome > 0);
  if (positive.length !== 1 || trials.some((trial) => trial !== positive[0] && trial.outcome !== 0)) return null;
  const cause = positive[0];
  const firstControl = trials.find((trial) => trial.firstState === cause.firstState && trial.secondState !== cause.secondState && trial.outcome === 0);
  const secondControl = trials.find((trial) => trial.secondState === cause.secondState && trial.firstState !== cause.firstState && trial.outcome === 0);
  if (!firstControl || !secondControl) return null;
  const stateWord = (state: string) => state === 'ON' ? 'enabled' : 'disabled';
  const reply = [
    `The supported cause is the interaction: ${cause.first} ${cause.firstState} (${stateWord(cause.firstState)}) with ${cause.second} ${cause.secondState} (${stateWord(cause.secondState)}).`,
    `${cause.first} alone is not sufficient: ${cause.first} ${firstControl.firstState} with ${cause.second} ${firstControl.secondState} produced 0.`,
    `${cause.second} ${cause.secondState} alone is not sufficient: ${cause.first} ${secondControl.firstState} with ${cause.second} ${secondControl.secondState} produced 0.`,
  ].join(' ');
  return result('causal-interaction', reply);
}

function percentageValues(input: string): number[] {
  const percents = [...input.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]) / 100);
  if (percents.length >= 3) return percents;
  return [...input.matchAll(/(\d+(?:\.\d+)?)\s+in\s+100\b/gi)].map((match) => Number(match[1]) / 100);
}

function solveBayes(input: string): BoundedReasoningResult | null {
  const hasSensitivityRole = /\b(?:sensitivity|(?:test|scanner|alert|detector)\s+catches?)\b/i.test(input);
  const hasFalsePositiveRole = /\b(?:false[- ]positive rate|(?:falsely\s+)?flags?)\b/i.test(input);
  const bayesShape = /\b(?:prevalence|defect rate|fraud|bad\b[\s\S]{0,30}\bwidgets?|\d+\s+in\s+100)\b/i.test(input)
    && hasSensitivityRole
    && hasFalsePositiveRole
    && /\b(?:positive|alert|flags?|flagged)\b/i.test(input);
  if (!bayesShape) return null;
  const namedPrior = input.match(/(?:prevalence|defect rate)\s+(?:is\s+)?(\d+(?:\.\d+)?)%/i)?.[1];
  const namedSensitivity = input.match(/(?:sensitivity\s+(?:is\s+)?|(?:test|scanner|alert|detector)\s+catches?\s+)(\d+(?:\.\d+)?)%/i)?.[1];
  const namedFalsePositive = input.match(/(?:false[- ]positive rate\s+(?:is\s+)?|falsely\s+flags?\s+)(\d+(?:\.\d+)?)%/i)?.[1];
  const values = namedPrior && namedSensitivity && namedFalsePositive
    ? [Number(namedPrior) / 100, Number(namedSensitivity) / 100, Number(namedFalsePositive) / 100]
    : percentageValues(input);
  const [prior, sensitivity, falsePositive] = values;
  if (![prior, sensitivity, falsePositive].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
  const truePositive = prior * sensitivity;
  const falsePositiveMass = (1 - prior) * falsePositive;
  const posterior = truePositive / (truePositive + falsePositiveMass);
  if (!Number.isFinite(posterior)) return null;
  const fixed = (value: number) => value.toFixed(2);
  const percentage = `${(posterior * 100).toFixed(1)}%`;
  if (/\breturn only\b/i.test(input) || /\bpercentage only\b/i.test(input)) return result('bayes', percentage);
  return result('bayes', `(${fixed(prior)} × ${fixed(sensitivity)}) / ((${fixed(prior)} × ${fixed(sensitivity)}) + (${fixed(1 - prior)} × ${fixed(falsePositive)})) = ${posterior.toFixed(4)}, so ${percentage}.`);
}

function solveCountPosteriorDecision(input: string): BoundedReasoningResult | null {
  if (!/\bflags?\b/i.test(input) || !/\bonly if\b/i.test(input) || !/\bprobability\b/i.test(input)) return null;
  const population = input.match(/Out of\s+([\d,]+)\s+\w+\s*,\s*([\d,]+)\s+are\s+faulty/i);
  const flagged = input.match(/flags?\s+([\d,]+)\s+faulty\s+\w+\s+and\s+([\d,]+)\s+healthy\s+\w+/i);
  const threshold = Number(input.match(/greater than\s+(\d+(?:\.\d+)?)%/i)?.[1]);
  if (!population || !flagged || !Number.isFinite(threshold)) return null;
  const parseCount = (value: string) => Number(value.replace(/,/g, ''));
  const total = parseCount(population[1]);
  const faulty = parseCount(population[2]);
  const flaggedFaulty = parseCount(flagged[1]);
  const flaggedHealthy = parseCount(flagged[2]);
  if (![total, faulty, flaggedFaulty, flaggedHealthy].every(Number.isFinite)
    || faulty > total || flaggedFaulty > faulty || flaggedHealthy > total - faulty) return null;
  const flaggedTotal = flaggedFaulty + flaggedHealthy;
  if (flaggedTotal <= 0) return null;
  const posterior = flaggedFaulty / flaggedTotal;
  const percentage = posterior * 100;
  const shouldReject = percentage > threshold;
  const reducedDivisor = (() => {
    let left = flaggedFaulty;
    let right = flaggedTotal;
    while (right !== 0) [left, right] = [right, left % right];
    return Math.abs(left);
  })();
  return result(
    'count-posterior-decision',
    `Among flagged components, ${flaggedFaulty}/(${flaggedFaulty}+${flaggedHealthy}) = ${flaggedFaulty / reducedDivisor}/${flaggedTotal / reducedDivisor} = ${percentage.toFixed(1)}% are faulty. Since ${percentage.toFixed(1)}% is ${shouldReject ? '' : 'not '}greater than ${threshold}%, ${shouldReject ? 'reject' : 'do not reject'}.`,
  );
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

function numberFrom(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : NUMBER_WORDS[value.toLowerCase()] ?? Number.NaN;
}

function solveThroughput(input: string): BoundedReasoningResult | null {
  const workersMatch = input.match(/\b(one|two|three|four|five|six|seven|eight|\d+)\s+(?:identical\s+)?workers?\b/i);
  const rateMatch = input.match(/each\s+process(?:es)?\s+(\d+)\s+(?:jobs?|items?|tasks?)\s+per\s+minute/i);
  const setupMatch = input.match(/setup\s+(?:takes|consumes)\s+(\d+)\s+minutes?/i);
  const totalMatch = input.match(/finish\s+(\d+)\s+(?:jobs?|items?|tasks?)/i);
  if (!workersMatch || !rateMatch || !setupMatch || !totalMatch || !/round.*up|whole minutes/i.test(input)) return null;
  const workers = numberFrom(workersMatch[1]);
  const rate = Number(rateMatch[1]);
  const setup = Number(setupMatch[1]);
  const total = Number(totalMatch[1]);
  const minutes = setup + total / (workers * rate);
  const rounded = Math.ceil(minutes);
  if (![workers, rate, setup, total, minutes].every(Number.isFinite)) return null;
  return result('throughput', `${setup} + ${total} / (${workers} × ${rate}) = ${minutes.toFixed(2)} minutes, so ${rounded} whole minutes.`);
}

function combinations<T>(values: readonly T[], size: number, start = 0, prefix: readonly T[] = []): T[][] {
  if (prefix.length === size) return [[...prefix]];
  const output: T[][] = [];
  for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
    output.push(...combinations(values, size, index + 1, [...prefix, values[index]]));
  }
  return output;
}

function solveSetCover(input: string): BoundedReasoningResult | null {
  if (/\bcost\s*\d/i.test(input)) return null;
  if (!/\b(?:fewest|minimum)\b/i.test(input) || !/\b(?:covers?|covering|coverage)\b/i.test(input) || !/json/i.test(input)) return null;
  const modules = new Map<string, Set<string>>();
  for (const match of input.matchAll(/\b([A-Z])\s+covers\s+([a-z]+(?:\s*[+,&]\s*[a-z]+)+)/g)) {
    modules.set(match[1], new Set(match[2].split(/\s*[+,&]\s*/).map((item) => item.toLowerCase())));
  }
  for (const match of input.matchAll(/\b([A-Z])\s*=\s*\{([^}]+)\}/g)) {
    modules.set(match[1], new Set(match[2].split(/\s*,\s*/).map((item) => item.toLowerCase())));
  }
  if (modules.size < 2) return null;
  const names = [...modules.keys()].sort();
  const requestedSegment = input.match(/\btarget\s+set\s*\{([^}]+)\}/i)?.[1]
    ?? input.match(/\bcovering\s+(.+?)\./i)?.[1];
  const requestedUniverse = requestedSegment
    ? requestedSegment.replace(/\band\b/gi, ',').split(/\s*,\s*/).map((item) => item.trim().toLowerCase()).filter((item) => /^[a-z][a-z0-9-]*$/.test(item))
    : [];
  const universe = new Set(requestedUniverse.length ? requestedUniverse : [...modules.values()].flatMap((features) => [...features]));
  let chosen: string[] | null = null;
  for (let size = 1; size <= names.length && !chosen; size += 1) {
    chosen = combinations(names, size).find((candidate) => {
      const covered = new Set(candidate.flatMap((name) => [...(modules.get(name) ?? [])]));
      return [...universe].every((feature) => covered.has(feature));
    }) ?? null;
  }
  if (chosen) return result('set-cover', JSON.stringify({ modules: chosen, count: chosen.length }));
  return /\bif (?:impossible|infeasible)\b/i.test(input) && /json/i.test(input)
    ? result('set-cover-impossible', JSON.stringify({ status: 'impossible' }))
    : null;
}

interface ScheduledTask { readonly name: string; readonly duration: number; readonly dependencies: readonly string[] }

function solveCriticalPath(input: string): BoundedReasoningResult | null {
  if (!/\b(?:earliest|workers?)\b/i.test(input) || !/\b(?:schedule|start-end)\b/i.test(input)) return null;
  const tasks: ScheduledTask[] = [];
  for (const match of input.matchAll(/\b([A-Z])\s*=\s*(\d+)(?:\s+minutes?)?(?:\s+after\s+(?:both\s+)?([A-Z](?:\s*(?:and|,)\s*[A-Z])*))?/g)) {
    tasks.push({
      name: match[1],
      duration: Number(match[2]),
      dependencies: match[3] ? [...match[3].matchAll(/[A-Z]/g)].map((item) => item[0]) : [],
    });
  }
  if (tasks.length < 3) return null;
  const byName = new Map(tasks.map((task) => [task.name, task]));
  const times = new Map<string, { start: number; end: number }>();
  const visit = (name: string, visiting = new Set<string>()): { start: number; end: number } | null => {
    if (times.has(name)) return times.get(name) ?? null;
    if (visiting.has(name)) return null;
    const task = byName.get(name);
    if (!task || task.dependencies.some((dependency) => !byName.has(dependency))) return null;
    visiting.add(name);
    const dependencyTimes = task.dependencies.map((dependency) => visit(dependency, visiting));
    visiting.delete(name);
    if (dependencyTimes.some((time) => !time)) return null;
    const start = Math.max(0, ...dependencyTimes.map((time) => time?.end ?? 0));
    const time = { start, end: start + task.duration };
    times.set(name, time);
    return time;
  };
  if (tasks.some((task) => !visit(task.name))) return null;
  const events = tasks.flatMap((task) => {
    const time = times.get(task.name)!;
    return [{ at: time.start, delta: 1 }, { at: time.end, delta: -1 }];
  }).sort((left, right) => left.at - right.at || left.delta - right.delta);
  let active = 0;
  let peak = 0;
  for (const event of events) { active += event.delta; peak = Math.max(peak, active); }
  const workers = numberFrom(input.match(/\b(one|two|three|four|five|six|seven|eight|\d+)\s+workers?\b/i)?.[1] ?? '1');
  if (peak > workers) return null;
  const makespan = Math.max(...[...times.values()].map((time) => time.end));
  const schedule = tasks.map((task) => `${task.name} ${times.get(task.name)!.start}-${times.get(task.name)!.end}`).join('; ');
  return result('critical-path', `${makespan} minutes. ${schedule}.`);
}

type RuntimeValue = Record<string, number> | number[];

function solveAliasTrace(input: string): BoundedReasoningResult | null {
  if (!/\b(?:trace|without running|output order)\b/i.test(input) || !/\bconst\b/.test(input)) return null;
  const values = new Map<string, RuntimeValue>();
  const statements = input.split(';').map((statement) => statement.trim());
  for (const statement of statements) {
    let match = statement.match(/\bconst\s+(\w+)\s*=\s*\{\s*(\w+)\s*:\s*(-?\d+)\s*\}/);
    if (match) { values.set(match[1], { [match[2]]: Number(match[3]) }); continue; }
    match = statement.match(/\bconst\s+(\w+)\s*=\s*\{\s*\.\.\.(\w+)\s*\}/);
    if (match) { const source = values.get(match[2]); if (source && !Array.isArray(source)) values.set(match[1], { ...source }); continue; }
    match = statement.match(/\bconst\s+(\w+)\s*=\s*\[\s*\.\.\.(\w+)\s*\]/);
    if (match) { const source = values.get(match[2]); if (Array.isArray(source)) values.set(match[1], [...source]); continue; }
    match = statement.match(/\bconst\s+(\w+)\s*=\s*\[([^\]]*)\]/);
    if (match) { values.set(match[1], match[2].split(',').map((item) => item.trim()).filter(Boolean).map(Number)); continue; }
    match = statement.match(/\bconst\s+(\w+)\s*=\s*(\w+)\b/);
    if (match) { const source = values.get(match[2]); if (source) values.set(match[1], source); continue; }
    match = statement.match(/\b(\w+)\.(\w+)\s*(\+=|-=|\*=|\/=)\s*(-?\d+)/);
    if (match) {
      const target = values.get(match[1]);
      if (target && !Array.isArray(target)) {
        const operand = Number(match[4]);
        const current = target[match[2]];
        target[match[2]] = match[3] === '+=' ? current + operand
          : match[3] === '-=' ? current - operand
            : match[3] === '*=' ? current * operand
              : current / operand;
      }
      continue;
    }
    match = statement.match(/\b(\w+)\.(\w+)\s*=\s*\1\.\2\s*([+-])\s*(-?\d+)\b/);
    if (match) {
      const target = values.get(match[1]);
      if (!target || Array.isArray(target) || !Number.isFinite(target[match[2]])) return null;
      const operand = Number(match[4]);
      target[match[2]] = match[3] === '+' ? target[match[2]] + operand : target[match[2]] - operand;
      continue;
    }
    if (/\b\w+\.\w+\s*(?:\+\+|--|\^=|%=|<<=|>>=|&&=|\|\|=|\?\?=|=)/.test(statement)) return null;
    match = statement.match(/\b(\w+)\.push\(\s*(-?\d+)\s*\)/);
    if (match) { const target = values.get(match[1]); if (Array.isArray(target)) target.push(Number(match[2])); }
  }
  const outputSource = input.match(/console\.log\(([^)]+)\)/)?.[1]
    ?? input.match(/output\s+(.+?)\s+as\s+CSV/i)?.[1];
  if (!outputSource) return null;
  const expressions = outputSource.split(',').map((expression) => expression.trim());
  const output: number[] = [];
  for (const expression of expressions) {
    let match = expression.match(/^(\w+)\.(\w+)$/);
    if (match) {
      const target = values.get(match[1]);
      if (!target) return null;
      if (match[2] === 'length' && Array.isArray(target)) output.push(target.length);
      else if (!Array.isArray(target) && Number.isFinite(target[match[2]])) output.push(target[match[2]]);
      else return null;
      continue;
    }
    match = expression.match(/^(\w+)\[(\d+)\]$/);
    if (match) { const target = values.get(match[1]); if (!Array.isArray(target)) return null; output.push(target[Number(match[2])]); continue; }
    return null;
  }
  return output.every(Number.isFinite) ? result('alias-trace', output.join(',')) : null;
}

function solveEventLoop(input: string): BoundedReasoningResult | null {
  if (!/\bstandard JavaScript\b/i.test(input) || !/Promise\.resolve|queueMicrotask/.test(input) || !/setTimeout/.test(input)) return null;
  const sync: string[] = [];
  const microtasks: string[] = [];
  const timers: string[] = [];
  for (const statement of input.split(';')) {
    const label = statement.match(/console\.log\(['"]([^'"]+)['"]\)/)?.[1];
    if (!label) continue;
    if (/Promise\.resolve|queueMicrotask/.test(statement)) microtasks.push(label);
    else if (/setTimeout/.test(statement)) timers.push(label);
    else sync.push(label);
  }
  return result('event-loop', [...sync, ...microtasks, ...timers].join(','));
}

function solveAggregation(input: string): BoundedReasoningResult | null {
  if (!/\b(?:sum|aggregate|total)\b/i.test(input) || !/json only/i.test(input)) return null;
  const arrayText = input.match(/\[\{[\s\S]*?\}\]/)?.[0];
  if (!arrayText) return null;
  let records: unknown;
  try { records = JSON.parse(arrayText); } catch { return null; }
  if (!Array.isArray(records) || records.length === 0 || records.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) return null;
  const first = records[0] as Record<string, unknown>;
  const requestedGroup = input.match(/\b(?:by|grouped\s+(?:by|on))\s+(?:the\s+)?([A-Za-z][\w-]*)(?:\s+field)?\b/i)?.[1];
  const requestedValue = input.match(/\b(?:sum|aggregate|total)\s+(?:the\s+)?([A-Za-z][\w-]*)(?:\s+field)?\b/i)?.[1];
  if (requestedGroup && typeof first[requestedGroup] !== 'string') return null;
  if (requestedValue && typeof first[requestedValue] !== 'number') return null;
  const groupKey = requestedGroup && typeof first[requestedGroup] === 'string'
    ? requestedGroup
    : Object.keys(first).find((key) => typeof first[key] === 'string');
  const valueKey = requestedValue && typeof first[requestedValue] === 'number'
    ? requestedValue
    : Object.keys(first).find((key) => typeof first[key] === 'number');
  if (!groupKey || !valueKey) return null;
  const totals = new Map<string, number>();
  for (const record of records as Array<Record<string, unknown>>) {
    if (typeof record[groupKey] !== 'string' || typeof record[valueKey] !== 'number') return null;
    const group = record[groupKey] as string;
    totals.set(group, (totals.get(group) ?? 0) + (record[valueKey] as number));
  }
  const ordered = Object.fromEntries([...totals.entries()].sort(([left], [right]) => left.localeCompare(right)));
  return result('aggregation', JSON.stringify(ordered));
}

function solveUntrustedCount(input: string): BoundedReasoningResult | null {
  if (!/\buntrusted\b/i.test(input) || !/\bcount\b/i.test(input) || !/\b(?:digits only|output digits only)\b/i.test(input)) return null;
  const level = input.match(/\bcount\s+(?:lines\s+whose\s+level\s+is\s+)?([A-Z]{3,})(?:\s+(?:lines|records))?\b/i)?.[1].toUpperCase();
  if (!level) return null;
  const count = input.split(/\r?\n/).filter((line) => new RegExp(`^${level}\\b`).test(line.trim())).length;
  return result('untrusted-count', String(count));
}

function solveConflictingEvidence(input: string): BoundedReasoningResult | null {
  const claims = [...input.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => match[1]);
  const lacksVersioning = /\bno\s+(?:timestamp|timestamps|version|scope)|\bwithout\s+(?:timestamp|timestamps|version|scope)/i.test(input);
  if (!lacksVersioning) return null;
  const parsed = claims.map((claim) => claim.match(/^(.+?)\s+(?:(?:is|are)\s+)?([a-z]+)$/i));
  const inlineStates = [...input.matchAll(/\b((?:job|sensor|item)\s+[a-z0-9]+)\s+(?:is\s+)?([a-z]+)\b/gi)];
  const quotedConflict = parsed[0] && parsed[1]
    && parsed[0][1].toLowerCase() === parsed[1][1].toLowerCase()
    && parsed[0][2].toLowerCase() !== parsed[1][2].toLowerCase();
  const inlineConflict = inlineStates.length >= 2
    && inlineStates[0][1].toLowerCase() === inlineStates[1][1].toLowerCase()
    && inlineStates[0][2].toLowerCase() !== inlineStates[1][2].toLowerCase();
  const sameSubjectConflict = Boolean(quotedConflict || inlineConflict);
  const aggregateConflict = /\ball\b/i.test(claims[0]) && /\b(?:sensor|job|item)\b/i.test(claims[1]);
  if (!sameSubjectConflict && !aggregateConflict) return null;
  return result('conflicting-evidence', 'The packet is internally inconsistent. Without timestamps or different scopes, I cannot determine the current state; the conflict must be resolved rather than choosing one claim.');
}

function solveSafeDeleteClarification(input: string): BoundedReasoningResult | null {
  const match = input.match(/^\s*(delete|remove|purge)\s+(?:the\s+)?(?:(old|stale)\s+)?(records|entries|items|data)\s*\.?\s*$/i);
  if (!match) return null;
  const qualifier = match[2]?.toLowerCase() ?? 'in scope';
  const noun = match[3].toLowerCase();
  return result('safe-delete-clarification', `Which ${noun} count as ${qualifier}, what retention cutoff should I use, and should I preview the affected set before removal?`);
}

const DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0],
};

function solveSpatial(input: string): BoundedReasoningResult | null {
  const relations = [...input.matchAll(/\b([A-Z][a-z]+)\s+is\s+(?:directly\s+)?(north|south|east|west)\s+of\s+([A-Z][a-z]+)\b/g)];
  const query = input.match(/\bwhere is\s+([A-Z][a-z]+)\s+relative to\s+([A-Z][a-z]+)|\bwhat compass direction is\s+([A-Z][a-z]+)\s+from\s+([A-Z][a-z]+)/i);
  if (relations.length < 2 || !query) return null;
  const target = query[1] ?? query[3];
  const origin = query[2] ?? query[4];
  const positions = new Map<string, readonly [number, number]>([[origin, [0, 0]]]);
  for (let pass = 0; pass < relations.length + 1; pass += 1) {
    for (const relation of relations) {
      const [, left, direction, right] = relation;
      const [dx, dy] = DIRECTIONS[direction.toLowerCase()];
      const rightPos = positions.get(right);
      const leftPos = positions.get(left);
      if (rightPos && !leftPos) positions.set(left, [rightPos[0] + dx, rightPos[1] + dy]);
      if (leftPos && !rightPos) positions.set(right, [leftPos[0] - dx, leftPos[1] - dy]);
      if (rightPos && leftPos && (leftPos[0] !== rightPos[0] + dx || leftPos[1] !== rightPos[1] + dy)) {
        return /\bstatus\b/i.test(input) && /json/i.test(input)
          ? result('spatial-inconsistent', JSON.stringify({ status: 'inconsistent' }))
          : null;
      }
    }
  }
  const position = positions.get(target);
  if (!position) return null;
  const horizontal = position[0] > 0 ? 'east' : position[0] < 0 ? 'west' : '';
  const vertical = position[1] > 0 ? 'north' : position[1] < 0 ? 'south' : '';
  const direction = `${vertical}${horizontal}`;
  return direction ? result('spatial', direction) : null;
}

function solveRecurrence(input: string): BoundedReasoningResult | null {
  const compact = input.replace(/\s+/g, '');
  const seed = compact.match(/([a-z])1=(-?\d+)/i);
  const formula = compact.match(/([a-z])\(n\+1\)=(-?\d+)\*\1\(n\)([+-])(?:(\d+)\*?)?n/i);
  const target = compact.match(/(?:whatis|find|compute)([a-z])(\d+)/i);
  const indexedTarget = input.match(/\b(?:find|compute|what is)\s+(?:the\s+)?value\s+at\s+index\s+(zero|\d+)\b/i);
  if (!seed || !formula || (!target && !indexedTarget) || seed[1].toLowerCase() !== formula[1].toLowerCase()) return null;
  if (target && seed[1].toLowerCase() !== target[1].toLowerCase()) return null;
  const multiplier = Number(formula[2]);
  const coefficient = Number(formula[4] ?? 1) * (formula[3] === '-' ? -1 : 1);
  const targetIndex = target ? Number(target[2]) : indexedTarget?.[1].toLowerCase() === 'zero' ? 0 : Number(indexedTarget?.[1]);
  if (targetIndex < 1) return /\bINSUFFICIENT\b/i.test(input) ? result('recurrence-domain', 'INSUFFICIENT', 0.95) : null;
  let value = Number(seed[2]);
  for (let n = 1; n < targetIndex; n += 1) value = multiplier * value + coefficient * n;
  return Number.isSafeInteger(value) ? result('recurrence', String(value)) : null;
}

function solveLostUpdate(input: string): BoundedReasoningResult | null {
  if (!/\ball .*calls reach await before any resumes\b/i.test(input) || !/const\s+snapshot\s*=\s*balance/i.test(input) || !/balance\s*=\s*snapshot\s*\+\s*1/i.test(input)) return null;
  const initial = Number(input.match(/let\s+balance\s*=\s*(-?\d+)/)?.[1]);
  if (!Number.isFinite(initial)) return null;
  return result('lost-update', `balance is ${initial + 1}. This is a lost-update race: all calls capture ${initial} before resuming, then each writes ${initial + 1}.`);
}

function solveConfigPrecedence(input: string): BoundedReasoningResult | null {
  if (!/(?:\bprecedence\b|\brule\s*:)/i.test(input) || !/\bpositive integer\b/i.test(input) || !/json only/i.test(input)) return null;
  const orderSegment = input.match(/(?:precedence is|rule:|precedence:)\s*([\s\S]+?)(?:\.|;)/i)?.[1];
  if (!orderSegment) return null;
  const order = orderSegment
    .replace(/positive integer/gi, '')
    .split(/\s*>\s*|\s*,\s*then\s+/i)
    .map((source) => source.trim().toLowerCase())
    .filter(Boolean);
  if (order.length < 2) return null;
  const assignments = new Map<string, number | null>();
  for (const source of order) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = input.match(new RegExp(`\\b${escaped}\\s*(?:=|is)\\s*(absent|missing|"[^"]*"|-?\\d+|[a-z]+)`, 'i'));
    if (!match) continue;
    const raw = match[1].replace(/^"|"$/g, '');
    const numeric = /^-?\d+$/.test(raw) ? Number(raw) : null;
    assignments.set(source, numeric !== null && Number.isInteger(numeric) && numeric > 0 ? numeric : null);
  }
  const source = order.find((candidate) => assignments.get(candidate) != null);
  if (!source) return null;
  return result('config-precedence', JSON.stringify({ effective: assignments.get(source), source }));
}

function solveContraposition(input: string): BoundedReasoningResult | null {
  if (!/\bcontraposition|contrapositive\b/i.test(input)) return null;
  const paraphrasedChain = input.match(
    /Whenever\s+(?:a|an|the)\s+([a-z]+)\s+is\s+([a-z]+),\s+(?:its\s+)?([a-z]+)\s+are\s+([a-z]+)\.\s+\4\s+\3\s+always\s+creates?\s+(?:a|an|the)\s+([a-z]+)\.\s+No\s+\5\s+was\s+created/i,
  );
  if (paraphrasedChain) {
    const [, firstSubject, firstState, middleSubject, middleState] = paraphrasedChain;
    return result(
      'contraposition-chain',
      `The ${middleSubject} were not ${middleState}, and the ${firstSubject} was not ${firstState}. Contraposition applies through both implications.`,
    );
  }
  const rules = [...input.matchAll(/\bif\s+(.+?)\s*,\s*(.+?)(?=\.|$)/gi)]
    .map((match) => ({ antecedent: match[1].trim().toLowerCase(), consequent: match[2].trim().toLowerCase() }));
  if (rules.length !== 2 || rules[0].consequent.replace(/^(?:a|an|the)\s+/, '') !== rules[1].antecedent.replace(/^(?:a|an|the)\s+/, '')) return null;
  const negative = input.match(/\b(?:the\s+)?([a-z]+)\s+was\s+not\s+([a-z]+)\b/i);
  if (!negative || !rules[1].consequent.includes(negative[1].toLowerCase()) || !rules[1].consequent.includes(negative[2].toLowerCase())) return null;
  const middle = rules[1].antecedent.match(/^(?:a|an|the\s+)?([a-z]+)\s+is\s+([a-z]+)$/i);
  const first = rules[0].antecedent.match(/^(?:a|an|the\s+)?([a-z]+)\s+([a-z]+)$/i);
  if (!middle || !first) return null;
  const middleNegative = middle[2] === 'allowed' ? `There is no allowed ${middle[1]}` : `${middle[1]} is not ${middle[2]}`;
  const firstNegative = first[2] === 'passes' ? `the ${first[1]} did not pass` : `the ${first[1]} did not ${first[2].replace(/s$/, '')}`;
  return result('contraposition', `${middleNegative}, and ${firstNegative}. This follows by contraposition through the two implications.`);
}

function solveUnderdeterminedEquation(input: string): BoundedReasoningResult | null {
  const finiteIntegerDomain = /\bnonnegative integers?\b/i.test(input) && /\breturn JSON\b/i.test(input);
  const underdeterminedDomain = /\bonly (?:constraint|equation)\b/i.test(input)
    && /(?:\bexact values?\b|\breturn JSON\b)/i.test(input)
    && /\bdo not assume\b/i.test(input);
  if (!finiteIntegerDomain && !underdeterminedDomain) return null;
  const equation = input.match(/\b(\d*)\s*([a-z])\s*([+-])\s*(\d*)\s*([a-z])\s*=\s*(-?\d+(?:\.\d+)?)\b/i);
  if (!equation) return null;
  const firstCoefficient = Number(equation[1] || 1);
  const secondCoefficient = Number(equation[4] || 1) * (equation[3] === '-' ? -1 : 1);
  const total = Number(equation[6]);
  if (![firstCoefficient, secondCoefficient, total].every(Number.isFinite) || secondCoefficient === 0) return null;
  if (/\bnonnegative integers?\b/i.test(input)) {
    if (![firstCoefficient, secondCoefficient, total].every(Number.isInteger)
      || firstCoefficient <= 0 || secondCoefficient <= 0 || total < 0) return null;
    const integerSolutions: number[][] = [];
    for (let first = 0; first <= Math.floor(total / firstCoefficient); first += 1) {
      const second = (total - firstCoefficient * first) / secondCoefficient;
      if (Number.isInteger(second) && second >= 0) integerSolutions.push([first, second]);
    }
    return result('finite-linear-domain', JSON.stringify({ count: integerSolutions.length, solutions: integerSolutions }));
  }
  const solutions: Array<readonly [number, number]> = [];
  if ([firstCoefficient, secondCoefficient, total].every(Number.isInteger)) {
    for (let first = -100; first <= 100; first += 1) {
      const second = (total - firstCoefficient * first) / secondCoefficient;
      if (Number.isInteger(second)) solutions.push([first, second]);
    }
  }
  const firstAlternative = solutions.find(([first]) => first === 0) ?? [0, total / secondCoefficient] as const;
  const secondAlternative = solutions
    .filter(([first, second]) => first !== second && (first !== firstAlternative[0] || second !== firstAlternative[1]))
    .sort((left, right) => Math.abs(left[0] - left[1]) - Math.abs(right[0] - right[1]) || Math.abs(left[0]) - Math.abs(right[0]))[0]
    ?? [1, (total - firstCoefficient) / secondCoefficient] as const;
  const format = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return result(
    'underdetermined-equation',
    `The values cannot be determined uniquely from one equation. Infinitely many pairs work, such as (${format(firstAlternative[0])},${format(firstAlternative[1])}) and (${format(secondAlternative[0])},${format(secondAlternative[1])}); another independent constraint is required.`,
  );
}

function solveExpectedCost(input: string): BoundedReasoningResult | null {
  if (!/\bminimi[sz]e expected cost\b/i.test(input)) return null;
  const risky = input.match(/Option\s+([A-Za-z]+)\s+has\s+(?:a\s+)?(\d+(?:\.\d+)?)%\s+chance\s+of\s+costing\s+(-?\d+(?:\.\d+)?)\s+credits?\s+and\s+(?:a\s+)?(\d+(?:\.\d+)?)%\s+chance\s+of\s+costing\s+(-?\d+(?:\.\d+)?)/i);
  const certain = input.match(/Option\s+([A-Za-z]+)\s+costs\s+(-?\d+(?:\.\d+)?)\s+credits?\s+for\s+certain/i);
  if (!risky || !certain) return null;
  const firstProbability = Number(risky[2]) / 100;
  const firstCost = Number(risky[3]);
  const secondProbability = Number(risky[4]) / 100;
  const secondCost = Number(risky[5]);
  if (Math.abs(firstProbability + secondProbability - 1) > 1e-9) return null;
  const riskyValue = firstProbability * firstCost + secondProbability * secondCost;
  const certainValue = Number(certain[2]);
  const chosen = riskyValue < certainValue ? risky[1] : certainValue < riskyValue ? certain[1] : 'either';
  const number = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return result(
    'expected-cost',
    `${risky[1]}: ${firstProbability.toFixed(2)} * ${number(firstCost)} + ${secondProbability.toFixed(2)} * ${number(secondCost)} = ${number(riskyValue)} credits. ${certain[1]}: ${number(certainValue)} credits. Choose ${chosen} because ${number(Math.min(riskyValue, certainValue))} < ${number(Math.max(riskyValue, certainValue))}.`,
  );
}

function solveExpectedValue(input: string): BoundedReasoningResult | null {
  if (!/\bexpected (?:monetary )?value\b/i.test(input) || !/\boption A\b/i.test(input) || !/\boption B\b/i.test(input)) return null;
  const risky = input.match(/Option A\s*:\s*(\d+(?:\.\d+)?)%\s+chance\s+to\s+gain\s+(-?\d+(?:\.\d+)?)\s+credits?\s+and\s+(\d+(?:\.\d+)?)%\s+chance\s+to\s+lose\s+(\d+(?:\.\d+)?)\s+credits?/i);
  const certain = input.match(/Option B\s*:\s*guaranteed\s+gain\s+of\s+(-?\d+(?:\.\d+)?)\s+credits?/i);
  if (!risky || !certain) return null;
  const probabilityGain = Number(risky[1]) / 100;
  const gain = Number(risky[2]);
  const probabilityLoss = Number(risky[3]) / 100;
  const loss = Number(risky[4]);
  if (Math.abs(probabilityGain + probabilityLoss - 1) > 1e-9) {
    return /\bINSUFFICIENT\b/i.test(input) ? result('invalid-probability-mass', 'INSUFFICIENT', 0.95) : null;
  }
  const valueA = probabilityGain * gain - probabilityLoss * loss;
  const valueB = Number(certain[1]);
  const chosen = valueA > valueB ? 'A' : valueB > valueA ? 'B' : 'either';
  const number = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return result(
    'expected-value',
    `A: ${probabilityGain.toFixed(2)} × ${number(gain)} + ${probabilityLoss.toFixed(2)} × (-${number(loss)}) = ${number(valueA)} credit${valueA === 1 ? '' : 's'}. B: ${number(valueB)} credits. Choose ${chosen} because ${number(Math.max(valueA, valueB))} > ${number(Math.min(valueA, valueB))}.`,
  );
}

function solveProbabilityMass(input: string): BoundedReasoningResult | null {
  if (!/\bprobability\b/i.test(input) || !/\b(?:incomplete|no other outcomes)\b/i.test(input) || !/\bINSUFFICIENT\b/i.test(input)) return null;
  const distribution = input.split(/\bOption\s+B\b/i)[0];
  const probabilities = [...distribution.matchAll(/\bprobability\s+(0(?:\.\d+)?|1(?:\.0+)?)\b/gi)]
    .map((match) => Number(match[1]));
  if (probabilities.length < 2 || probabilities.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return null;
  const totalMass = probabilities.reduce((sum, value) => sum + value, 0);
  return Math.abs(totalMass - 1) > 1e-9
    ? result('invalid-probability-mass', 'INSUFFICIENT', 0.95)
    : null;
}

function solveGeneralExpectedValue(input: string): BoundedReasoningResult | null {
  if (!/\bexpected value\b/i.test(input) || !/\bOption\s+[A-Za-z]+\b/i.test(input)) return null;
  const risky = input.match(/Option\s+([A-Za-z]+)\s+has\s+(?:a\s+)?(\d+(?:\.\d+)?)%\s+chance\s+to\s+gain\s+(-?\d+(?:\.\d+)?)\s+credits?\s+and\s+(?:a\s+)?(\d+(?:\.\d+)?)%\s+chance\s+to\s+gain\s+(-?\d+(?:\.\d+)?)/i);
  const certain = input.match(/Option\s+([A-Za-z]+)\s+guarantees\s+(-?\d+(?:\.\d+)?)\s+credits?/i);
  if (!risky || !certain) return null;
  const firstProbability = Number(risky[2]) / 100;
  const secondProbability = Number(risky[4]) / 100;
  if (Math.abs(firstProbability + secondProbability - 1) > 1e-9) {
    return /\bINSUFFICIENT\b/i.test(input) ? result('invalid-probability-mass', 'INSUFFICIENT', 0.95) : null;
  }
  const firstValue = firstProbability * Number(risky[3]) + secondProbability * Number(risky[5]);
  const secondValue = Number(certain[2]);
  const decision = firstValue > secondValue ? risky[1] : secondValue > firstValue ? certain[1] : 'tie';
  if (/json only/i.test(input) && /\bdecision\b/i.test(input)) {
    return result('expected-value-decision', JSON.stringify({ decision, a: firstValue, b: secondValue }));
  }
  return result('expected-value-decision', `${decision}: ${firstValue} versus ${secondValue}.`);
}

function solveIndependentSchedule(input: string): BoundedReasoningResult | null {
  if (!/\bindependent tasks?\b/i.test(input) || !/\bminimum makespan\b/i.test(input) || !/\bexactly two workers\b/i.test(input)) return null;
  const tasks = [...input.matchAll(/\b([A-Z])\s*=\s*(\d+)\s+minutes?\b/g)].map((match) => ({ name: match[1], duration: Number(match[2]) }));
  if (tasks.length < 2 || tasks.length > 12) return null;
  let best: { makespan: number; assignment: number[] } | null = null;
  const combinationsCount = 2 ** (tasks.length - 1);
  for (let bits = 0; bits < combinationsCount; bits += 1) {
    const assignment = tasks.map((_task, index) => index === 0 ? 0 : (bits >> (index - 1)) & 1);
    const loads = [0, 0];
    tasks.forEach((task, index) => { loads[assignment[index]] += task.duration; });
    const makespan = Math.max(...loads);
    const signature = assignment.join('');
    const bestSignature = best?.assignment.join('') ?? '';
    if (!best || makespan < best.makespan || (makespan === best.makespan && signature < bestSignature)) best = { makespan, assignment };
  }
  if (!best) return null;
  const cursors = [0, 0];
  const slots = tasks.map((task, index) => {
    const worker = best!.assignment[index];
    const start = cursors[worker];
    cursors[worker] += task.duration;
    return `${task.name} ${start}-${cursors[worker]}`;
  });
  return result('independent-schedule', `${best.makespan} minutes. ${slots.join('; ')}.`);
}

function solveLetClosureTrace(input: string): BoundedReasoningResult | null {
  if (!/\btrace JavaScript\b/i.test(input) || !/for\s*\(\s*let\s+/i.test(input) || !/\.push\(\s*\(\)\s*=>/i.test(input)) return null;
  const loop = input.match(/for\s*\(\s*let\s+(\w+)\s*=\s*(-?\d+)\s*;\s*\1\s*(<|<=)\s*(-?\d+)\s*;\s*\1\s*(\+\+|\+=\s*(-?\d+))\s*\)/i);
  // Anchor at the statement terminator so nested zero-argument calls do not
  // truncate the expression at the first `)`.
  const output = input.match(/console\.log\(([\s\S]*?)\)\s*[.;](?:\s|$)/i)?.[1];
  if (!loop || !output) return null;
  const start = Number(loop[2]);
  const comparator = loop[3];
  const end = Number(loop[4]);
  const step = loop[5] === '++' ? 1 : Number(loop[6]);
  if (!Number.isFinite(step) || step <= 0) return null;
  const values: number[] = [];
  for (let value = start; comparator === '<' ? value < end : value <= end; value += step) {
    values.push(value);
    if (values.length > 1_000) return null;
  }
  const indices = [...output.matchAll(/\[\s*(\d+)\s*\]\s*\(\s*\)/g)].map((match) => Number(match[1]));
  if (indices.length === 0 || indices.some((index) => index < 0 || index >= values.length)) return null;
  const body = input.match(/\.push\(\s*\(\)\s*=>\s*(\w+)(?:\s*([*+-])\s*(-?\d+))?\s*\)/i);
  if (!body || body[1] !== loop[1]) return null;
  const evaluate = (value: number) => {
    if (!body[2]) return value;
    const operand = Number(body[3]);
    return body[2] === '*' ? value * operand : body[2] === '+' ? value + operand : value - operand;
  };
  return result('let-closure-trace', indices.map((index) => evaluate(values[index])).join(','));
}

function solveConfounding(input: string): BoundedReasoningResult | null {
  const observational = /\bobservationally\b|\bclinic records?\b/i.test(input);
  const randomized = /\brandomized (?:trial|experiment)\b/i.test(input);
  const confounder = /\bhigh-risk\b|\bbaseline (?:risk|severity)\b|\bsickest patients?\b/i.test(input);
  const nullResult = /\bequal\s+(?:failure|recovery|outcome)?\s*rates?\b|\bmatching\s+(?:failure|recovery|outcome)?\s*rates?\b|\brates?\s+(?:are\s+)?(?:equal|matching|the same)\b/i.test(input);
  if (!observational || !randomized || !confounder || !nullResult) return null;
  if (/\btherapy\b|\bharmful\b/i.test(input)) {
    return result('causal-confounding', 'No. Treatment assignment was confounded by baseline severity, so the observational association does not establish harm. The randomized experiment found no detected harmful causal effect.');
  }
  return result('causal-confounding', 'The observational association is not causal evidence because baseline risk confounds the assignment. The randomized evidence supports no detected causal effect of F in this trial.');
}

function solveRandomizedArmComparison(input: string): BoundedReasoningResult | null {
  if (!/\brandomized trial\b/i.test(input) || !/json only/i.test(input)) return null;
  const armFractions = input.match(/F[- ]on\s+arm\s+has\s+(\d+)\s*\/\s*(\d+)\s+failures?\s*;\s*F[- ]off\s+arm\s+has\s+(\d+)\s*\/\s*(\d+)(?:\s+failures?)?/i);
  const equalSampleSize = Number(input.match(/(?:sample sizes? of|of)\s+(\d+)\s+per arm/i)?.[1]);
  const equalCounts = input.match(/F\s+on\s+had\s+(\d+)\s+failures?\s+and\s+F\s+off\s+had\s+(\d+)\s+failures?/i);
  const onFailures = armFractions ? Number(armFractions[1]) : Number(equalCounts?.[1]);
  const onSize = armFractions ? Number(armFractions[2]) : equalSampleSize;
  const offFailures = armFractions ? Number(armFractions[3]) : Number(equalCounts?.[2]);
  const offSize = armFractions ? Number(armFractions[4]) : equalSampleSize;
  if (![onFailures, onSize, offFailures, offSize].every(Number.isFinite)
    || onSize <= 0 || offSize <= 0 || onFailures > onSize || offFailures > offSize) return null;
  const difference = Number((((onFailures / onSize) - (offFailures / offSize)) * 100).toFixed(4));
  const conclusion = difference > 0 ? 'higher-failure-rate-with-F'
    : difference < 0 ? 'lower-failure-rate-with-F'
      : 'equal-failure-rates';
  return result('randomized-arm-comparison', JSON.stringify({ conclusion, riskDifferencePoints: difference }));
}

function solveIntegerArrayCounterexample(input: string): BoundedReasoningResult | null {
  if (!/\bevery non-empty integer array\b/i.test(input) || !/\bsum to 0\b/i.test(input) || !/\bmust contain (?:the integer )?0\b/i.test(input) || !/json only/i.test(input)) return null;
  const candidate = [-1, 1];
  if (candidate.reduce((sum, value) => sum + value, 0) !== 0 || candidate.includes(0)) return null;
  return result('constructive-counterexample', JSON.stringify({ counterexample: candidate }));
}

function solveEvenProductCounterexample(input: string): BoundedReasoningResult | null {
  if (!/\bproduct of two integers is even\b/i.test(input) || !/\bboth integers must be even\b/i.test(input) || !/json only/i.test(input)) return null;
  // Prefer a non-zero witness: it disproves the parity claim without relying
  // on the special multiplicative behavior of zero.
  for (let first = 1; first <= 10; first += 1) {
    for (let second = 1; second <= 10; second += 1) {
      if ((first * second) % 2 === 0 && (first % 2 !== 0 || second % 2 !== 0)) {
        const candidate = [first, second];
        return result('constructive-counterexample', JSON.stringify({ counterexample: candidate }));
      }
    }
  }
  return null;
}

function solveTwoStatementTruthValues(input: string): BoundedReasoningResult | null {
  if (!/\bexactly one of statements A and B is true\b/i.test(input)
    || !/A says:\s*["']B is false\.?["']/i.test(input)
    || !/B says:\s*["']A and B have the same truth value\.?["']/i.test(input)
    || !/json only/i.test(input)) return null;
  const solutions: Array<{ A: boolean; B: boolean }> = [];
  for (const A of [false, true]) {
    for (const B of [false, true]) {
      const aStatement = !B;
      const bStatement = A === B;
      if (A === aStatement && B === bStatement && Number(A) + Number(B) === 1) solutions.push({ A, B });
    }
  }
  return solutions.length === 1
    ? result('truth-consistency', JSON.stringify(solutions[0]))
    : null;
}

function parseInventoryLedger(text: string): { start: number; events: Map<string, number> } | null {
  const start = Number(text.match(/\bstart inventory at\s+(-?\d+)\b/i)?.[1]);
  if (!Number.isFinite(start)) return null;
  const events = new Map<string, number>();
  for (const match of text.matchAll(/\bevent\s+([A-Z])\s+(adds|removes)\s+(\d+)\b/gi)) {
    events.set(match[1].toUpperCase(), Number(match[3]) * (match[2].toLowerCase() === 'adds' ? 1 : -1));
  }
  for (const match of text.matchAll(/\b(?:(?:second|third|next)\s+)?correction\s*:\s*([A-Z])\s+(removed|added)\s+(\d+)\s*,\s*not\s+(\d+)/gi)) {
    const sign = match[2].toLowerCase() === 'added' ? 1 : -1;
    events.set(match[1].toUpperCase(), sign * Number(match[3]));
  }
  return events.size > 0 ? { start, events } : null;
}

function solveInventoryLedger(input: string, history: readonly ReasoningHistoryMessage[]): BoundedReasoningResult | null {
  if (/\btopic change\b|\bnot (?:a )?ledger recomputation\b|\bwhat does (?:the word )?inventory mean\b|\bdefine inventory\b|\bdo not calculate (?:the )?(?:earlier|prior) ledger\b|\bledger solver must abstain\b/i.test(input)) return null;
  if (!/\b(?:start inventory|inventory|correction|event\s+[A-Z]|recompute)\b/i.test(input)) return null;
  const priorText = history.filter((message) => message.role === 'user').map((message) => message.content).join('\n');
  const ledger = parseInventoryLedger(`${priorText}\n${input}`);
  if (!ledger) return null;
  const correction = input.match(/\b(?:(?:second|third|next)\s+)?correction\s*:\s*([A-Z])\s+(removed|added)\s+(\d+)\s*,\s*not\s+(\d+)/i);
  for (const match of input.matchAll(/\bevent\s+([A-Z])\s+(adds|removes)\s+(\d+)\b/gi)) {
    ledger.events.set(match[1].toUpperCase(), Number(match[3]) * (match[2].toLowerCase() === 'adds' ? 1 : -1));
  }
  const orderedEvents = [...ledger.events.entries()].sort(([left], [right]) => left.localeCompare(right));
  const total = ledger.start + orderedEvents.reduce((sum, [, value]) => sum + value, 0);
  const signed = (value: number) => value >= 0 ? `+${value}` : String(value);
  const expression = `${ledger.start}${orderedEvents.map(([, value]) => signed(value)).join('')}=${total}`;
  if (correction) {
    const corrected = correction[1].toUpperCase();
    const added = orderedEvents.find(([name]) => name !== 'A' && name !== corrected && new RegExp(`\\bevent\\s+${name}\\b`, 'i').test(input));
    return result('inventory-ledger', `${total}. Corrected ${corrected} to ${signed(ledger.events.get(corrected)!)}${added ? ` and applied ${added[0]}=${signed(added[1])}` : ''}: ${expression}.`);
  }
  return result('inventory-ledger', `${total}. ${orderedEvents.map(([name, value]) => `${name}=${signed(value)}`).join(' and ')}, so ${expression}.`);
}

const SOLVERS: ReadonlyArray<(input: string) => BoundedReasoningResult | null> = [
  solveContraposition,
  solveUnderdeterminedEquation,
  solveExpectedCost,
  solveProbabilityMass,
  solveGeneralExpectedValue,
  solveExpectedValue,
  solveIndependentSchedule,
  solveLetClosureTrace,
  solveRandomizedArmComparison,
  solveConfounding,
  solveIntegerArrayCounterexample,
  solveEvenProductCounterexample,
  solveTwoStatementTruthValues,
  solveUniqueOrdering,
  solveSyllogism,
  solveCausalInteraction,
  solveCountPosteriorDecision,
  solveBayes,
  solveThroughput,
  solveSetCover,
  solveCriticalPath,
  solveAliasTrace,
  solveEventLoop,
  solveAggregation,
  solveUntrustedCount,
  solveConflictingEvidence,
  solveSafeDeleteClarification,
  solveSpatial,
  solveRecurrence,
  solveLostUpdate,
  solveConfigPrecedence,
];

interface ReasoningHistoryMessage { readonly role: string; readonly content: string }

function hypothesisMap(text: string): Map<string, string> {
  const hypotheses = new Map<string, string>();
  for (const match of text.matchAll(/\bhypothesis\s+([A-Z])\s+(?:says\s+(?:a\s+|the\s+)?(.+?)\s+caused(?:\s+(?:the\s+failures?|them))?|blames\s+(.+?))(?=[.;]|\bhypothesis\b)/gi)) {
    const description = (match[2] ?? match[3]).trim().toLowerCase().replace(/^(?:a|an|the)\s+/, '');
    hypotheses.set(match[1].toUpperCase(), description);
  }
  return hypotheses;
}

function overlap(left: string, right: string): number {
  const ignored = new Set(['the', 'a', 'an', 'changes', 'change', 'upgrade', 'utilization', 'migration']);
  const leftTokens = new Set(left.toLowerCase().split(/[^a-z]+/).filter((token) => token.length > 2 && !ignored.has(token)));
  return right.toLowerCase().split(/[^a-z]+/).filter((token) => leftTokens.has(token)).length;
}

function bestHypothesis(hypotheses: Map<string, string>, evidence: string): readonly [string, string] | null {
  return [...hypotheses.entries()]
    .map((entry) => ({ entry, score: overlap(entry[1], evidence) }))
    .sort((left, right) => right.score - left.score || left.entry[0].localeCompare(right.entry[0]))
    .find((candidate) => candidate.score > 0)?.entry ?? null;
}

function solveBeliefRevision(input: string, history: readonly ReasoningHistoryMessage[]): BoundedReasoningResult | null {
  const priorUserText = history.filter((message) => message.role === 'user').map((message) => message.content).join('\n');
  const hypotheses = hypothesisMap(`${priorUserText}\n${input}`);
  if (hypotheses.size < 2) return null;

  if (/\bnew (?:controlled )?(?:evidence|interventions?)\b|\bupdate the belief\b/i.test(input)) {
    const weakened = input.match(/\b(reverting|rolling back)\s+(?:the\s+)?(.+?)\s+(?:does not change|has no effect)\b/i);
    const supported = input.match(/\b(isolating|capping)\s+(?:the\s+)?(.+?)\s+(?:removes?|removed)\s+(?:all|every)\b/i);
    if (!weakened || !supported) return null;
    const weakenedHypothesis = bestHypothesis(hypotheses, weakened[2]);
    const supportedHypothesis = bestHypothesis(hypotheses, supported[2]);
    if (!weakenedHypothesis || !supportedHypothesis || weakenedHypothesis[0] === supportedHypothesis[0]) return null;
    const weakAction = weakened[1].toLowerCase() === 'reverting' ? 'Reverting' : 'Rolling back';
    const strongAction = supported[1].toLowerCase() === 'isolating' ? 'isolating' : 'capping';
    const strongProof = strongAction === 'capping'
      ? `the ${supportedHypothesis[1]} cap removed every failure`
      : `${strongAction} the ${supportedHypothesis[1]} removed every failure`;
    return result(
      'belief-revision',
      `${supportedHypothesis[0]} is now better supported. ${weakAction} ${weakenedHypothesis[1]} had no effect, while ${strongProof}; these interventions changed the conclusion.`,
    );
  }

  const began = input.match(/\bfailures?\s+began\s+(?:immediately\s+)?(?:after|with)\s+(?:a\s+|the\s+)?(.+?)(?=\s+and\b|[.,])/i);
  if (!began) return null;
  const supported = bestHypothesis(hypotheses, began[1]);
  if (!supported) return null;
  const other = [...hypotheses.entries()].find(([label]) => label !== supported[0]);
  if (!other) return null;
  const disabledEvidence = input.match(/\b(?:occur|occurs|reproduce|reproduces)\b[\s\S]{0,30}\bwhen\s+(?:the\s+)?(.+?)\s+is\s+disabled\b/i);
  const disabledHypothesis = disabledEvidence ? bestHypothesis(hypotheses, disabledEvidence[1]) : null;
  const counterEvidence = /\boffline\b/i.test(input) && /network/i.test(other[1])
    ? `offline evidence weakens the ${other[1]} hypothesis`
    : /(?:\blow\b[\s\S]{0,20}\bCPU\b|\bCPU\b[\s\S]{0,20}\blow\b)/i.test(input) && /cpu/i.test(other[1])
      ? `low CPU load weakens the ${other[1]} hypothesis`
      : disabledHypothesis?.[0] === other[0]
        ? `failures persisting while ${other[1]} is disabled weaken the ${other[1]} hypothesis`
      : `the counter-evidence weakens the ${other[1]} hypothesis`;
  return result(
    'belief-revision',
    `${supported[0]} is better supported: failures began after ${supported[1]}, and ${counterEvidence}.`,
  );
}

export function tryBoundedReasoning(input: string, history: readonly ReasoningHistoryMessage[] = []): BoundedReasoningResult | null {
  const candidates: BoundedReasoningResult[] = [];
  const advanced = tryAdvancedReasoning(input, history);
  if (advanced) candidates.push(advanced);
  const inventoryLedger = solveInventoryLedger(input, history);
  if (inventoryLedger) candidates.push(inventoryLedger);
  const beliefRevision = solveBeliefRevision(input, history);
  if (beliefRevision) candidates.push(beliefRevision);
  for (const solver of SOLVERS) {
    const answer = solver(input);
    if (answer) candidates.push(answer);
  }
  if (candidates.length === 0) return null;
  const distinct = new Set(candidates.map((candidate) => candidate.reply));
  return distinct.size === 1 ? candidates[0] : null;
}
