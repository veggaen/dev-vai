const exactContract = (value) => ({ kind: 'exact', value: String(value) });
const jsonContract = (value) => ({ kind: 'json', value });
const referenceFor = (contract) => contract.kind === 'json' ? JSON.stringify(contract.value) : String(contract.value);
const turn = (prompt, contract, expectedRoute = 'bounded') => ({ prompt, contract, expectedRoute, referenceAnswer: referenceFor(contract) });
const scenario = (id, capability, representations, turns) => ({
  id: `v3-fresh-${id}`, split: 'fresh', tier: 'metamorphic', category: 'soundness-transfer',
  capability, familyId: id.replace(/-\d+$/, ''), metamorphicGroup: id.replace(/-\d+$/, ''),
  requiredRepresentations: representations, expectedRoute: 'bounded', turns,
});

const scenarios = [];
for (let variant = 0; variant < 2; variant += 1) {
  const suffix = variant + 1;
  const names = variant === 0 ? ['Pavo', 'Quill', 'Rook', 'Sable'] : ['Tern', 'Ursa', 'Vale', 'Wisp'];
  scenarios.push(scenario(`order-language-${variant}`, 'entity-universe-language-transfer', ['explicit entity universe', 'grammar-independent ambiguity'], [
    turn(`Participants ${names.join(', ')} are all scheduled exactly once. ${names[0]} precedes ${names[1]}; ${names[1]} precedes ${names[2]}; ${names[3]} has no ordering constraint. Classify unique, ambiguous, or inconsistent. JSON only with status.`, jsonContract({ status: 'ambiguous' })),
  ]));

  const initial = 12 + variant * 3; const subtract = 4 + variant; const add = 5 + variant;
  scenarios.push(scenario(`alias-assignment-${variant}`, 'mutation-syntax-transfer', ['JavaScript assignment AST', 'alias identity'], [
    turn(`Trace JavaScript: const p={x:${initial}}; const q=p; const r={...p}; q.x=q.x-${subtract}; r.x=r.x+${add}; console.log(p.x,q.x,r.x). CSV only.`, exactContract(`${initial - subtract},${initial - subtract},${initial + add}`)),
  ]));

  scenarios.push(scenario(`probability-decimal-mass-${variant}`, 'probability-representation-transfer', ['rational probabilities', 'mass invariant'], [
    turn(`Option A has probability ${variant ? '0.45' : '0.40'} of gaining 10 and probability 0.30 of losing 5; no other outcomes are specified. Option B guarantees 1. If the distribution is incomplete, output INSUFFICIENT exactly.`, exactContract('INSUFFICIENT')),
  ]));

  const payoff = 14 + variant * 4;
  scenarios.push(scenario(`expected-tie-labels-${variant}`, 'decision-label-transfer', ['expected values', 'tie verification'], [
    turn(`Option Copper has a 50% chance to gain ${payoff} credits and a 50% chance to gain 0. Option Silver guarantees ${payoff / 2} credits. Choose by expected value. JSON only with decision,a,b.`, jsonContract({ decision: 'tie', a: payoff / 2, b: payoff / 2 })),
  ]));

  const offset = 3 + variant;
  scenarios.push(scenario(`closure-add-expression-${variant}`, 'closure-expression-transfer', ['closure AST', 'expression evaluation'], [
    turn(`Trace JavaScript: const f=[]; for(let i=1;i<=4;i++){f.push(()=>i+${offset});} console.log(f[0](),f[3]()). CSV only.`, exactContract(`${1 + offset},${4 + offset}`)),
  ]));

  const [left, right] = variant === 0 ? ['Nira', 'Oren'] : ['Pia', 'Ravi'];
  scenarios.push(scenario(`spatial-opposites-${variant}`, 'spatial-consistency-transfer', ['coordinate constraints', 'contradiction detection'], [
    turn(`${left} is east of ${right}. ${left} is west of ${right}. Where is ${left} relative to ${right}? JSON only; conflicts must return {"status":"inconsistent"}.`, jsonContract({ status: 'inconsistent' })),
  ]));

  scenarios.push(scenario(`recurrence-index-wording-${variant}`, 'recurrence-domain-transfer', ['indexed domain', 'undefined predecessor'], [
    turn(`Sequence a starts at index one with a1=${3 + variant}; for n>=1, a(n+1)=2*a(n)+n. Find the value at index zero. If undefined, output INSUFFICIENT exactly.`, exactContract('INSUFFICIENT')),
  ]));

  const records = [
    { group: 'x', amount: 90 + variant, cost: 4 + variant },
    { group: 'y', amount: 70 + variant, cost: 6 + variant },
    { group: 'x', amount: 30 + variant, cost: 8 + variant },
  ];
  scenarios.push(scenario(`aggregate-grammar-${variant}`, 'aggregation-language-transfer', ['schema roles', 'measure binding'], [
    turn(`Using ${JSON.stringify(records)}, total the cost field grouped on group; ignore amount. JSON only with sorted group keys.`, jsonContract({ x: 12 + variant * 2, y: 6 + variant })),
  ]));

  const onSize = 120 + variant * 20; const offSize = 80 + variant * 20;
  const onFailures = onSize * 0.6; const offFailures = offSize * 0.4;
  scenarios.push(scenario(`randomized-unequal-arms-${variant}`, 'trial-schema-transfer', ['arm-specific denominators', 'risk difference'], [
    turn(`Randomized trial: F-on arm has ${onFailures}/${onSize} failures; F-off arm has ${offFailures}/${offSize}. Return JSON only with conclusion and riskDifferencePoints.`, jsonContract({ conclusion: 'higher-failure-rate-with-F', riskDifferencePoints: 20 })),
  ]));

  const missing = variant ? 'omega' : 'delta';
  scenarios.push(scenario(`cover-universe-braces-${variant}`, 'optimization-universe-transfer', ['explicit target set', 'infeasibility proof'], [
    turn(`Need minimum coverage for target set {alpha,beta,gamma,${missing}}. Module A={alpha,beta}; B={beta,gamma}; C={alpha,gamma}; nothing covers ${missing}. JSON only; if infeasible return {"status":"impossible"}.`, jsonContract({ status: 'impossible' })),
  ]));

  const total = 10 + variant * 2;
  const solutions = [];
  for (let x = 0; x <= Math.floor(total / 2); x += 1) solutions.push([x, total - 2 * x]);
  scenarios.push(scenario(`integer-coefficient-${variant}`, 'linear-domain-transfer', ['coefficient-bearing equation', 'finite enumeration'], [
    turn(`Solve 2x+y=${total} over nonnegative integers. Return JSON only with count and solutions in ascending x order. Do not assume equality.`, jsonContract({ count: solutions.length, solutions })),
  ]));

  const prevalence = 4 + variant; const posterior = (prevalence * 75) / (prevalence * 75 + (100 - prevalence) * 8) * 100;
  scenarios.push(scenario(`bayes-distractor-position-${variant}`, 'probability-role-order-transfer', ['named probability roles', 'distractor rejection'], [
    turn(`Defect prevalence is ${prevalence}%; sensitivity is 75%; false-positive rate is 8%. An unrelated SLA is ${97 + variant}%. For a positive item return only P(defect) rounded one decimal percent.`, exactContract(`${posterior.toFixed(1)}%`)),
  ]));

  const start = 70 + variant; const addA = 5 + variant; const removeB = 8 + variant;
  const ledgerTotal = start + addA - removeB;
  scenarios.push(scenario(`ledger-topic-language-${variant}`, 'topic-boundary-transfer', ['problem-frame routing', 'safe abstention'], [
    turn(`Start inventory at ${start}. Event A adds ${addA}. Event B removes ${removeB}. Compute and preserve.`, exactContract(`${ledgerTotal}. A=+${addA} and B=-${removeB}, so ${start}+${addA}-${removeB}=${ledgerTotal}.`)),
    turn('Define inventory in accounting language. Do not calculate the earlier ledger. The bounded ledger solver must abstain; output INSUFFICIENT exactly.', exactContract('INSUFFICIENT'), 'abstain'),
  ]));

  const b2 = removeB - 2; const a2 = addA + 2; const b3 = b2 - 1;
  const total1 = start + addA - removeB;
  const total2 = start + addA - b2;
  const total3 = start + a2 - b2;
  const total4 = start + a2 - b3;
  scenarios.push(scenario(`ledger-fourth-correction-${variant}`, 'long-horizon-correction-transfer', ['event-sourced corrections', 'version replay'], [
    turn(`Start inventory at ${start}. Event A adds ${addA}. Event B removes ${removeB}. Compute and preserve events.`, exactContract(`${total1}. A=+${addA} and B=-${removeB}, so ${start}+${addA}-${removeB}=${total1}.`)),
    turn(`Correction: B removed ${b2}, not ${removeB}. Recompute.`, exactContract(`${total2}. Corrected B to -${b2}: ${start}+${addA}-${b2}=${total2}.`)),
    turn(`Third correction: A added ${a2}, not ${addA}. Preserve B. Recompute.`, exactContract(`${total3}. Corrected A to +${a2}: ${start}+${a2}-${b2}=${total3}.`)),
    turn(`Fourth correction: B removed ${b3}, not ${b2}. Preserve A. Recompute.`, exactContract(`${total4}. Corrected B to -${b3}: ${start}+${a2}-${b3}=${total4}.`)),
  ]));
}

export const V3_FRESH_SCENARIOS = scenarios;
