const exact = (value) => ({ kind: 'exact', value: String(value) });
const json = (value) => ({ kind: 'json', value });
const referenceFor = (contract, value = contract.value) => contract.kind === 'exact' ? String(value) : JSON.stringify(value);
const turn = (prompt, contract, referenceValue = contract.value, expectedRoute = 'bounded') => ({ prompt, contract, expectedRoute, referenceAnswer: referenceFor(contract, referenceValue) });
const scenario = (family, variant, category, capability, representations, turns, expectedRoute = 'bounded') => ({
  id: `v4-sealed-${family}-${variant}`, split: 'sealed-post-improvement', tier: 'expert-transfer', category, capability,
  familyId: family, metamorphicGroup: family, requiredRepresentations: representations, expectedRoute, turns,
});

function permutations(values) {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) => permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest]));
}

function exactSchedule(tasks, capacity) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const total = tasks.reduce((sum, task) => sum + task.duration, 0);
  for (let horizon = Math.max(...tasks.map((task) => task.duration)); horizon <= total; horizon += 1) {
    const slots = new Map();
    const search = (index) => {
      if (index === tasks.length) return true;
      const task = tasks[index];
      const earliest = Math.max(0, ...task.predecessors.map((id) => slots.get(id)?.[1] ?? 0));
      for (let start = earliest; start + task.duration <= horizon; start += 1) {
        const end = start + task.duration;
        let feasible = true;
        for (let time = start; time < end; time += 1) {
          if ([...slots.values()].filter(([left, right]) => left <= time && time < right).length >= capacity) { feasible = false; break; }
        }
        if (!feasible || task.predecessors.some((id) => !byId.has(id))) continue;
        slots.set(task.id, [start, end]);
        if (search(index + 1)) return { makespan: Math.max(...[...slots.values()].map((slot) => slot[1])), schedule: Object.fromEntries(tasks.map((candidate) => [candidate.id, slots.get(candidate.id)])) };
        slots.delete(task.id);
      }
      return null;
    };
    if (search(0)) return {
      makespan: Math.max(...[...slots.values()].map((slot) => slot[1])),
      schedule: Object.fromEntries(tasks.map((candidate) => [candidate.id, slots.get(candidate.id)])),
    };
  }
  throw new Error('sealed schedule oracle found no schedule');
}

const scenarios = [];
const atomSets = [['A', 'B', 'C', 'D'], ['P', 'Q', 'R', 'S'], ['W', 'X', 'Y', 'Z']];
const nounSets = [['vek', 'ral', 'sum', 'tor', 'nex'], ['mip', 'dor', 'kel', 'zan', 'vul'], ['pax', 'lir', 'gom', 'tiv', 'seb']];

for (let variant = 0; variant < 3; variant += 1) {
  const [a, b, c, d] = atomSets[variant];
  scenarios.push(scenario('implication-closure', variant, 'formal-logic-v4', 'renamed-branching-closure', ['implication graph', 'contrapositive closure', 'distractor rejection'], [
    turn(`Facts: ${a} implies ${b}; ${b} implies ${c}; ${d} implies ${c}; ${a} implies ${c}; ${c} is false. Compute every forced false atom without assuming converses. Return JSON only with key falseAtoms in alphabetic order.`, json({ falseAtoms: [a, b, c, d].sort() })),
  ]));

  scenarios.push(scenario('boolean-mixed-model', variant, 'formal-logic-v4', 'alpha-renamed-boolean-csp', ['Boolean finite model', 'equivalence', 'cardinality'], [
    turn(`Constraints: ${a} is true. ${a} iff ${b}. If ${b} then ${c}. Exactly one of ${c} and ${d} is true. Return the unique Boolean model as JSON only with keys ${a},${b},${c},${d}.`, json({ [a]: true, [b]: true, [c]: true, [d]: false })),
  ]));

  const [n0, n1, n2, n3, n4] = nounSets[variant];
  scenarios.push(scenario('quantified-chain', variant, 'formal-logic-v4', 'longer-unary-chain', ['predicate inclusion graph', 'exclusion proof', 'existence'], [
    turn(`Every ${n0} is a ${n1}. Every ${n1} is a ${n2}. Every ${n2} is a ${n3}. No ${n3} is a ${n4}. At least one ${n0} exists. Can any ${n0} be a ${n4}? Return JSON only with keys answer and chainLength.`, json({ answer: false, chainLength: 4 })),
  ]));

  const names = variant === 0 ? ['A', 'B', 'C', 'D', 'E', 'F', 'G'] : variant === 1 ? ['H', 'I', 'J', 'K', 'L', 'M', 'N'] : ['P', 'Q', 'R', 'S', 'T', 'U', 'V'];
  const [p0, p1, p2, p3, p4, p5, p6] = names;
  const order = [p2, p4, p0, p1, p3, p5, p6];
  scenarios.push(scenario('position-seven', variant, 'constraint-solving-v4', 'seven-variable-position-csp', ['complete entity domain', 'adjacency', 'unique witness'], [
    turn(`Place ${names.join(',')} in positions 1..7. ${p2} is position 1. ${p4} is immediately before ${p0}. ${p0} is before ${p1}. ${p3} is immediately after ${p1}. ${p5} is after ${p3}. ${p6} is immediately after ${p5}. Return JSON only with the unique order.`, json({ order })),
  ]));

  const cycleSize = [5, 7, 6][variant];
  const cycle = [...Array(cycleSize)].map((_value, index) => String(index + 1));
  const colors = cycle.map((_vertex, index) => index % 2 === 0 ? 'R' : 'G');
  if (cycleSize % 2 === 1) colors[cycleSize - 1] = 'B';
  scenarios.push(scenario('cycle-coloring', variant, 'constraint-solving-v4', 'larger-cycle-coloring', ['graph coloring', 'lexicographic objective', 'witness validation'], [
    turn(`Color cycle vertices ${[...cycle, '1'].join('-')} with R,G,B so adjacent vertices differ. Vertex 1 is R. Among valid colorings choose lexicographically smallest under R<G<B. Return JSON only with key colors.`, json({ colors })),
  ]));

  const peopleSets = [
    ['Ana', 'Bo', 'Cy', 'De', 'Eli'], ['Fia', 'Gus', 'Hal', 'Ivo', 'Jia'], ['Kia', 'Leo', 'Mia', 'Noa', 'Oli'],
  ];
  const roleSets = [
    ['audit', 'cache', 'build', 'deploy', 'review'], ['alpha', 'bravo', 'charlie', 'delta', 'echo'], ['north', 'south', 'east', 'west', 'center'],
  ];
  const people = peopleSets[variant]; const roles = roleSets[variant];
  const exclusions = people.slice(0, -1).map((person, index) => `${person} cannot ${roles.filter((_role, roleIndex) => roleIndex !== index).join('/')}.`).join(' ');
  scenarios.push(scenario('bijection-five', variant, 'constraint-solving-v4', 'five-way-bijection', ['all-different', 'forbidden assignment', 'unique mapping'], [
    turn(`Assign ${people.join(', ')} bijectively to ${roles.join(', ')}. ${exclusions} Return JSON only mapping each person.`, json(Object.fromEntries(people.map((person, index) => [person, roles[index]])))),
  ]));

  const durations = variant === 0 ? [4, 3, 2, 3, 4, 1, 2] : variant === 1 ? [3, 5, 4, 2, 3, 2, 1] : [5, 4, 3, 2, 5, 1, 2];
  const taskIds = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const predecessors = { A: [], B: [], C: ['A'], D: ['A'], E: ['B'], F: ['C', 'D', 'E'], G: ['F'] };
  const tasks = taskIds.map((id, index) => ({ id, duration: durations[index], predecessors: predecessors[id] }));
  const oracle = exactSchedule(tasks, 2);
  const scheduleContract = { kind: 'validated-schedule', capacity: 2, optimalMakespan: oracle.makespan, tasks };
  scenarios.push(scenario('rcpsp-seven', variant, 'planning-v4', 'seven-task-exact-scheduling', ['precedence DAG', 'capacity search', 'semantic schedule certificate'], [
    turn(`Two identical workers. Durations: ${tasks.map((task) => `${task.id}${task.duration}`).join(',')}. C,D depend on A; E depends on B; F depends on C,D,E; G depends on F. Tasks cannot split. Return JSON only with minimum makespan and one schedule as task:[start,end].`, scheduleContract, oracle),
  ]));

  const routeRows = variant === 0
    ? [['S-A-G', 4, 5, 9], ['S-B-C-G', 6, 6, 4], ['S-D-G', 7, 3, 2]]
    : variant === 1
      ? [['S-K-G', 5, 7, 8], ['S-L-M-G', 7, 5, 3], ['S-N-G', 9, 2, 1]]
      : [['S-P-G', 3, 8, 7], ['S-Q-R-G', 8, 6, 5], ['S-T-G', 10, 4, 2]];
  const energyBudget = variant === 1 ? 6 : 6; const riskBudget = variant === 2 ? 5 : 5;
  const feasibleRoutes = routeRows.filter((row) => row[2] <= energyBudget && row[3] <= riskBudget).sort((left, right) => left[1] - right[1]);
  const bestRoute = feasibleRoutes[0];
  scenarios.push(scenario('multi-resource-route', variant, 'planning-v4', 'two-resource-shortest-path', ['multi-attribute path', 'two feasibility budgets', 'argmin'], [
    turn(`Paths: ${routeRows.map(([path, time, energy, risk]) => `${path} has time${time} energy${energy} risk${risk}`).join('; ')}. Energy budget is${energyBudget} and risk budget is${riskBudget}. Return JSON only with fastest feasible path, time, energy, risk.`, json({ path: bestRoute[0].split('-'), time: bestRoute[1], energy: bestRoute[2], risk: bestRoute[3] })),
  ]));

  const colorFamilies = variant === 0 ? [['R1', 'R2'], ['B1', 'B2'], ['G1']]
    : variant === 1 ? [['R3', 'R4'], ['B3'], ['G2', 'G3']]
      : [['R5'], ['B4', 'B5'], ['G4', 'G5']];
  const sequenceJobs = colorFamilies.flatMap((ids, familyIndex) => ids.map((id) => ({ id, family: ['red', 'blue', 'green'][familyIndex], duration: 2 + (variant === 2 && id === 'R5' ? 1 : 0) })));
  const sequenceCandidates = permutations(sequenceJobs).map((candidate) => ({ candidate, makespan: candidate.reduce((sum, job) => sum + job.duration, 0) + candidate.slice(1).filter((job, index) => job.family !== candidate[index].family).length }))
    .sort((left, right) => left.makespan - right.makespan || Number(right.candidate[0].family === 'red') - Number(left.candidate[0].family === 'red') || left.candidate.map((job) => job.id).join(',').localeCompare(right.candidate.map((job) => job.id).join(',')))[0];
  scenarios.push(scenario('three-family-setup', variant, 'planning-v4', 'three-family-sequence-setup', ['sequence setup', 'three families', 'lexicographic tie break'], [
    turn(`One machine. Jobs ${colorFamilies[0].join(',')} are red duration${sequenceJobs.find((job) => job.family === 'red').duration}; ${colorFamilies[1].join(',')} are blue duration2; ${colorFamilies[2].join(',')} are green duration2. Switching color costs1; same-color transition costs0. Start red when tied, then lexicographic IDs. Return JSON only with minimum makespan and order.`, json({ makespan: sequenceCandidates.makespan, order: sequenceCandidates.candidate.map((job) => job.id) })),
  ]));

  const base = 2 + variant; const mutation = 7 + variant; const outer = 4 + variant;
  scenarios.push(scenario('minijs-object-graph', variant, 'code-semantics-v4', 'renamed-shallow-object-graph', ['heap identity', 'shallow spread', 'nested mutation'], [
    turn(`Trace JavaScript: const root={node:{value:${base}},flag:${outer}}; const copy={...root}; copy.node.value=${mutation}; copy.flag=${outer + 5}; console.log(root.node.value,root.flag,copy.node.value,copy.flag). Return CSV only.`, exact(`${mutation},${outer},${mutation},${outer + 5}`)),
  ]));

  const counter = 2 + variant; const fallback = counter + 1;
  scenarios.push(scenario('minijs-nullish', variant, 'code-semantics-v4', 'renamed-nullish-side-effects', ['optional chain', 'nullish short circuit', 'side-effect count'], [
    turn(`Trace JavaScript: let n=${counter}; const item=null; const x=item?.value ?? ++n; const y=0 ?? ++n; console.log(n,x,y). Return CSV only.`, exact(`${fallback},${fallback},0`)),
  ]));

  const start = variant; const end = 4 + variant;
  scenarios.push(scenario('minijs-var-closure', variant, 'code-semantics-v4', 'var-closure-range-transfer', ['function-scoped cell', 'closure capture', 'loop final state'], [
    turn(`Trace JavaScript: const f=[]; for(var i=${start};i<${end};i++){f.push(()=>i);} console.log(f[0](),f[${end - start - 1}]()). Return CSV only.`, exact(`${end},${end}`)),
  ]));

  const prior = [10, 20, 25][variant]; const likelihoods = [[2, 3, 4], [3, 2, 2], [2, 5, 1]][variant];
  const priorOdds = prior / (100 - prior); const posteriorOdds = likelihoods.reduce((value, lr) => value * lr, priorOdds);
  const posteriorPercent = Number((posteriorOdds / (1 + posteriorOdds) * 100).toFixed(6));
  scenarios.push(scenario('sequential-bayes-three', variant, 'uncertainty-v4', 'three-evidence-bayes', ['odds form', 'three independent likelihoods', 'exact update'], [
    turn(`Prior P(H)=${prior}%. Three conditionally independent observations have LR=${likelihoods[0]}, LR=${likelihoods[1]}, and LR=${likelihoods[2]} for H. Return JSON only with posteriorPercent.`, json({ posteriorPercent })),
  ]));

  const outcomes = variant === 0 ? [1, 0, 1, 0] : variant === 1 ? [0, 1, 0, 1] : [1, 1, 0, 0];
  const f1 = variant === 0 ? [0.8, 0.4, 0.7, 0.2] : variant === 1 ? [0.3, 0.7, 0.4, 0.8] : [0.7, 0.6, 0.3, 0.4];
  const f2 = variant === 0 ? [0.7, 0.3, 0.6, 0.3] : variant === 1 ? [0.2, 0.8, 0.2, 0.7] : [0.8, 0.7, 0.2, 0.3];
  const brier = (forecast) => Number((forecast.reduce((sum, value, index) => sum + (value - outcomes[index]) ** 2, 0) / outcomes.length).toFixed(4));
  const score1 = brier(f1); const score2 = brier(f2);
  scenarios.push(scenario('brier-four', variant, 'uncertainty-v4', 'longer-calibration-vector', ['Brier mean', 'four outcomes', 'model comparison'], [
    turn(`Outcomes are ${JSON.stringify(outcomes)}. Forecast F1=${JSON.stringify(f1)}; F2=${JSON.stringify(f2)}. Compute mean Brier scores rounded4 decimals and choose lower. JSON only.`, json({ F1: score1, F2: score2, better: score1 < score2 ? 'F1' : 'F2' })),
  ]));

  const stateStart = 120 + variant * 10;
  const firstState = `State starts${stateStart}. Apply e1:+${10 + variant} and e2:-${5 + variant} exactly once. Return JSON only with value and applied IDs.`;
  const secondState = `Replay duplicate e1:+${10 + variant}, then apply e3:-${20 + variant}. Preserve idempotency. Return JSON only.`;
  const thirdState = 'Retract event e2. A retraction reverses its effect but keeps audit history. Return JSON only with value and retracted IDs.';
  scenarios.push(scenario('event-replay-retract', variant, 'state-v4', 'longer-idempotent-event-log', ['event IDs', 'deduplication', 'retraction'], [
    turn(firstState, json({ value: stateStart + 5, applied: ['e1', 'e2'] })),
    turn(secondState, json({ value: stateStart - 15 - variant, applied: ['e1', 'e2', 'e3'] })),
    turn(thirdState, json({ value: stateStart - 10, retracted: ['e2'] })),
  ]));

  const u = variant === 0 ? ['U', 'X', 'M', 'Y'] : variant === 1 ? ['A', 'B', 'C', 'D'] : ['P', 'Q', 'R', 'S'];
  scenarios.push(scenario('scm-renamed', variant, 'causal-v4', 'alpha-renamed-boolean-scm', ['structural equations', 'do intervention', 'equation replacement'], [
    turn(`SCM: ${u[0]}=1; ${u[1]}=${u[0]}; ${u[2]}=${u[1]} AND ${u[0]}; ${u[3]}=${u[2]} OR ${u[0]}. Intervene do(${u[1]}=0), replacing only ${u[1]} equation. Return JSON only with ${u[1]},${u[2]},${u[3]}.`, json({ [u[1]]: 0, [u[2]]: 0, [u[3]]: 1 })),
  ]));

  const mildT = 8 + variant; const mildN = 10 + variant; const mildC = 70 + variant * 5; const mildCN = 100 + variant * 10;
  const severeT = 30 + variant * 10; const severeN = 100 + variant * 10; const severeC = 2 + variant; const severeCN = 10 + variant;
  scenarios.push(scenario('simpson-transfer', variant, 'causal-v4', 'renamed-stratified-reversal', ['stratified rates', 'case mix', 'direction invariant'], [
    turn(`Recovery counts: mild treated ${mildT}/${mildN}, mild control ${mildC}/${mildCN}; severe treated ${severeT}/${severeN}, severe control ${severeC}/${severeCN}. Aggregate treated recovery is lower. Return JSON only stating the within-stratum direction and why aggregate reverses.`, json({ withinEachStratum: 'treated-higher', aggregateReversalCause: 'severity-mix-confounding' })),
  ]));

  const faulty = [12 + variant, 18 + variant]; const healthy = [20 + variant, 30 + variant]; const threshold = 40 + variant;
  const faultyTotal = faulty.reduce((a0, b0) => a0 + b0, 0); const healthyTotal = healthy.reduce((a0, b0) => a0 + b0, 0);
  const posterior = faultyTotal / (faultyTotal + healthyTotal) * 100;
  scenarios.push(scenario('aggregate-policy', variant, 'composition-v4', 'aggregate-infer-strict-decide', ['typed aggregation', 'posterior', 'strict comparator'], [
    turn(`Records summarize flagged outcomes: faulty counts ${JSON.stringify(faulty)}, healthy counts ${JSON.stringify(healthy)}. Aggregate each class, compute P(faulty|flagged), then reject only if strictly greater than${threshold}%. JSON only.`, json({ faulty: faultyTotal, healthy: healthyTotal, posteriorPercent: posterior, reject: posterior > threshold })),
  ]));

  const actual = 80 + variant * 10; const debit = 15 + variant * 5;
  scenarios.push(scenario('hypothetical-isolation', variant, 'state-v4', 'multi-turn-branch-isolation', ['actual state', 'hypothetical branch', 'non-mutation'], [
    turn(`Actual balance is${actual}. Record it. JSON only.`, json({ actual })),
    turn(`What if a debit${debit} occurred? Compute hypothetical but do not mutate actual. JSON only with hypothetical and actual.`, json({ hypothetical: actual - debit, actual })),
    turn('Now report actual balance only as JSON.', json({ actual })),
  ]));
}

const controls = [
  ['unsupported-eval', 'Trace JavaScript: const x=eval(userInput); console.log(x). Return CSV only.'],
  ['unsupported-nand', 'Constraints: A NAND B; exactly one is true. Return the unique model as JSON only.'],
  ['unsupported-preemption', 'Two workers: tasks may split into arbitrary fractions and migrate continuously. Return JSON only with minimum makespan.'],
];
controls.forEach(([id, prompt], variant) => scenarios.push(scenario('unsupported-controls', variant, 'adversarial-control-v4', id, ['recognized unsupported', 'route containment', 'low confidence'], [turn(prompt, exact('UNSUPPORTED'), 'UNSUPPORTED', 'abstain')], 'abstain')));

export const V4_SEALED_SCENARIOS = Object.freeze(scenarios);
