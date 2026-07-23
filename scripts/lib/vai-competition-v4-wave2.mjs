const exact = (value) => ({ kind: 'exact', value: String(value) });
const json = (value) => ({ kind: 'json', value });
const turn = (prompt, contract, expectedRoute = 'bounded') => ({ prompt, contract, expectedRoute, referenceAnswer: contract.kind === 'exact' ? String(contract.value) : JSON.stringify(contract.value) });
const scenario = (family, variant, category, capability, representations, turns, expectedRoute = 'bounded') => ({
  id: `v4-wave2-${family}-${variant}`, split: 'sealed-wave2', tier: 'frontier-transfer', category, capability,
  familyId: family, metamorphicGroup: family, requiredRepresentations: representations, expectedRoute, turns,
});

const scenarios = [];
const atomSets = [['A', 'B', 'C', 'D'], ['P', 'Q', 'R', 'S'], ['W', 'X', 'Y', 'Z']];

for (let variant = 0; variant < 3; variant += 1) {
  const [a, b, c, d] = atomSets[variant];
  scenarios.push(scenario('or-implication-model', variant, 'formal-logic-v4', 'disjunctive-antecedent-model', ['Boolean OR AST', 'implication', 'unique model certificate'], [
    turn(`Constraints: ${a} is true. (${a} OR ${b}) implies ${c}. ${c} iff ${b}. Exactly one of ${b} and ${d} is true. Return the unique Boolean model as JSON only with keys ${a},${b},${c},${d}.`, json({ [a]: true, [b]: true, [c]: true, [d]: false })),
  ]));

  const features = variant === 0 ? ['p', 'q', 'r', 's'] : variant === 1 ? ['u', 'v', 'w', 'x'] : ['j', 'k', 'l', 'm'];
  const [f0, f1, f2, f3] = features;
  scenarios.push(scenario('weighted-set-cover', variant, 'optimization-v4', 'minimum-cost-cover', ['explicit universe', 'weighted objective', 'optimality certificate'], [
    turn(`Choose minimum cost modules covering target set {${features.join(',')}}. A covers ${f0}+${f1} cost3. B covers ${f2}+${f3} cost3. C covers ${f0}+${f2} cost2. D covers ${f1}+${f3} cost2. Return JSON only with modules and cost.`, json({ modules: ['C', 'D'], cost: 4 })),
  ]));

  const durationA = 2 + variant; const durationB = 3 + variant; const releaseB = 2 + variant;
  const cStart = durationA; const cEnd = cStart + 2; const bEnd = releaseB + durationB; const dStart = Math.max(cEnd, bEnd); const finish = dStart + 1;
  scenarios.push(scenario('release-time-schedule', variant, 'planning-v4', 'release-time-rcpsp', ['release times', 'precedence', 'capacity proof'], [
    turn(`Two identical workers. Tasks: A duration${durationA} release0; B duration${durationB} release${releaseB}; C duration2 release0 after A; D duration1 after B,C. Tasks cannot split. Return JSON only with minimum makespan and schedule.`, json({ makespan: finish, schedule: { A: [0, durationA], B: [releaseB, bEnd], C: [cStart, cEnd], D: [dStart, finish] } })),
  ]));

  const routes = variant === 0
    ? [['S-A-G', 4, 5, 3, 9], ['S-B-C-G', 6, 6, 4, 4], ['S-D-G', 8, 3, 2, 2]]
    : variant === 1
      ? [['S-H-G', 5, 7, 2, 8], ['S-I-J-G', 7, 5, 3, 3], ['S-K-G', 9, 2, 1, 2]]
      : [['S-P-G', 3, 8, 7, 9], ['S-Q-R-G', 8, 6, 5, 4], ['S-T-G', 10, 4, 2, 2]];
  const budgets = { energy: 6, risk: 5, toll: 5 };
  const feasible = routes.filter((row) => row[2] <= budgets.energy && row[3] <= budgets.risk && row[4] <= budgets.toll).sort((left, right) => left[1] - right[1])[0];
  scenarios.push(scenario('three-budget-route', variant, 'planning-v4', 'three-resource-shortest-path', ['metric table', 'three feasibility budgets', 'argmin'], [
    turn(`Paths: ${routes.map(([path, time, energy, risk, toll]) => `${path} has time${time} energy${energy} risk${risk} toll${toll}`).join('; ')}. Energy budget is6 and risk budget is5 and toll budget is5. Return JSON only with fastest feasible path, time, energy, risk, toll.`, json({ path: feasible[0].split('-'), time: feasible[1], energy: feasible[2], risk: feasible[3], toll: feasible[4] })),
  ]));

  const initial = variant; const fallback = 2 + variant; const fixed = 5 + variant;
  scenarios.push(scenario('logical-vs-nullish', variant, 'code-semantics-v4', 'logical-short-circuit-contrast', ['logical OR', 'nullish coalescing', 'side effects'], [
    turn(`Trace JavaScript: let n=${initial}; const x=0 || ++n; const y=${fixed} ?? ++n; const z=null ?? ${fallback}; console.log(n,x,y,z). Return CSV only.`, exact(`${initial + 1},${initial + 1},${fixed},${fallback}`)),
  ]));

  const nested = 1 + variant; const changed = 9 + variant; const flag = 2 + variant; const copyFlag = 7 + variant;
  scenarios.push(scenario('two-spread-alias-chain', variant, 'code-semantics-v4', 'multi-hop-object-graph', ['two shallow spreads', 'shared nested identity', 'independent scalar fields'], [
    turn(`Trace JavaScript: const root={node:{value:${nested}},flag:${flag}}; const copy={...root}; const third={...copy}; third.node.value=${changed}; copy.flag=${copyFlag}; console.log(root.node.value,copy.node.value,third.node.value,root.flag,copy.flag,third.flag). Return CSV only.`, exact(`${changed},${changed},${changed},${flag},${copyFlag},${flag}`)),
  ]));

  const balance = 10 + variant; const firstAdd = 5 + variant; const secondAdd = 7 + variant;
  scenarios.push(scenario('read-committed-lost-update', variant, 'transaction-v4', 'transaction-schedule-simulation', ['read/write schedule', 'last writer', 'anomaly classification'], [
    turn(`Read-committed transaction schedule: balance=${balance}. T1 reads ${balance}; T2 reads ${balance}; T1 writes ${balance + firstAdd} and commits; T2 writes ${balance + secondAdd} and commits. Return JSON only with finalBalance and anomaly.`, json({ finalBalance: balance + secondAdd, anomaly: 'lost-update' })),
  ]));

  const utilities = variant === 0 ? { A: [4, 8, 6], B: [5, 5, 5], C: [9, 3, 7] }
    : variant === 1 ? { A: [7, 2, 8], B: [5, 5, 5], C: [3, 9, 4] }
      : { A: [6, 7, 2], B: [5, 5, 5], C: [8, 3, 9] };
  const actions = Object.keys(utilities); const bestByState = [0, 1, 2].map((index) => Math.max(...actions.map((action) => utilities[action][index])));
  const maxRegret = Object.fromEntries(actions.map((action) => [action, Math.max(...utilities[action].map((value, index) => bestByState[index] - value))]));
  const chosen = actions.sort((left, right) => maxRegret[left] - maxRegret[right] || left.localeCompare(right))[0];
  scenarios.push(scenario('minimax-regret', variant, 'uncertainty-v4', 'robust-decision-regret', ['statewise best', 'regret table', 'minimax objective'], [
    turn(`Utilities by states s1,s2,s3: ${Object.entries(utilities).map(([action, values]) => `${action}=[${values.join(',')}]`).join('; ')}. Choose minimum maximum regret. Return JSON only with maxRegret by action and chosen.`, json({ maxRegret, chosen })),
  ]));

  const start = 100 + variant * 10; const firstDelta = 10 + variant; const conflictDelta = 12 + variant;
  scenarios.push(scenario('conflicting-event-id', variant, 'state-v4', 'event-id-conflict-detection', ['event identity', 'conflicting payload', 'safe state'], [
    turn(`State starts${start}. Apply e1:+${firstDelta} exactly once. Return JSON only with value and applied IDs.`, json({ value: start + firstDelta, applied: ['e1'] })),
    turn(`A later packet repeats e1:+${conflictDelta}. Same ID but different payload. Do not apply either interpretation silently. Return JSON only with status and eventId.`, json({ status: 'conflict', eventId: 'e1' })),
  ]));

  const original = ['Atlas', 'Boreal', 'Cygnus'][variant]; const middle = ['Orion', 'Draco', 'Lyra'][variant]; const final = ['Nova', 'Equinox', 'Vega'][variant];
  scenarios.push(scenario('rename-chain', variant, 'state-v4', 'transitive-entity-aliases', ['canonical identity', 'alias chain', 'state merge'], [
    turn(`Entity ${original} has status paused. ${original} is renamed to ${middle}; preserve ${original} as an alias. Return JSON only with canonical and aliases.`, json({ canonical: middle, aliases: [original] })),
    turn(`${middle} is renamed to ${final}. Preserve all prior aliases. Return JSON only with canonical and aliases.`, json({ canonical: final, aliases: [original, middle] })),
    turn(`Set ${final} status active. What is the status of ${original}? Return JSON only with canonical and status.`, json({ canonical: final, status: 'active' })),
  ]));

  const records = [
    { keep: true, faulty: 5 + variant, healthy: 7 + variant },
    { keep: false, faulty: 100, healthy: 1 },
    { keep: true, faulty: 8 + variant, healthy: 10 + variant },
  ];
  const faulty = 13 + variant * 2; const healthy = 17 + variant * 2; const posteriorPercent = faulty / (faulty + healthy) * 100; const threshold = 45;
  scenarios.push(scenario('filter-aggregate-policy', variant, 'composition-v4', 'filter-aggregate-infer-decide', ['Boolean filter', 'typed sums', 'posterior', 'strict threshold'], [
    turn(`From records ${JSON.stringify(records)}, keep only keep=true, sum faulty and healthy, compute faulty/(faulty+healthy), and reject only if strictly greater than${threshold}%. Return JSON only with faulty,healthy,posteriorPercent,reject.`, json({ faulty, healthy, posteriorPercent, reject: posteriorPercent > threshold })),
  ]));
}

const controls = [
  ['unit-mismatch', 'Two workers and tasks A duration3 credits, B duration4 meters. Units are incompatible. Return JSON only with minimum makespan.'],
  ['incomplete-boolean-domain', 'Constraints: A OR an undeclared external condition is true. Return the unique model as JSON only.'],
  ['nondeterministic-js', 'Trace JavaScript: console.log(Date.now()). Return CSV only.'],
];
controls.forEach(([capability, prompt], variant) => scenarios.push(scenario('matched-unsupported-controls', variant, 'adversarial-control-v4', capability, ['unsupported status', 'low confidence', 'no guessed witness'], [turn(prompt, exact('UNSUPPORTED'), 'abstain')], 'abstain')));

export const V4_WAVE2_SCENARIOS = Object.freeze(scenarios);
