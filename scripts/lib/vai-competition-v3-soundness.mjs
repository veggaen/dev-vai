const exactContract = (value) => ({ kind: 'exact', value: String(value) });
const jsonContract = (value) => ({ kind: 'json', value });
const referenceFor = (contract) => contract.kind === 'json' ? JSON.stringify(contract.value) : String(contract.value);
const turn = (prompt, contract, expectedRoute = 'bounded') => ({ prompt, contract, expectedRoute, referenceAnswer: referenceFor(contract) });

const NAME_SETS = [
  ['Arlo', 'Bex', 'Cato', 'Dune'], ['Eira', 'Fenn', 'Gail', 'Hale'], ['Ivo', 'Juno', 'Kira', 'Lars'],
  ['Mira', 'Niko', 'Orla', 'Pax'], ['Quin', 'Rhea', 'Soren', 'Tala'], ['Uma', 'Voss', 'Wren', 'Xara'],
  ['Yale', 'Zora', 'Ames', 'Brin'], ['Cleo', 'Dara', 'Enzo', 'Fara'], ['Glen', 'Hope', 'Isla', 'Jace'],
  ['Kato', 'Lumi', 'Moss', 'Nell'],
];

function scenario({ id, category, capability, representations, turns, expectedRoute = 'bounded', tier = 'near-miss' }) {
  return {
    id: `v3-soundness-${id}`,
    split: 'soundness',
    tier,
    category,
    capability,
    familyId: id.replace(/-\d+$/, ''),
    metamorphicGroup: id.replace(/-\d+$/, ''),
    requiredRepresentations: representations,
    expectedRoute,
    turns,
  };
}

function orderingCases() {
  return NAME_SETS.map((names, index) => scenario({
    id: `ordering-disconnected-${index}`,
    category: 'constraint-soundness', capability: 'entity-universe-and-ambiguity',
    representations: ['explicit entity universe', 'topological model counting', 'ambiguity certificate'],
    turns: [turn(
      `Tasks ${names.join(', ')} each occur once. ${names[0]} is before ${names[1]}. ${names[1]} is before ${names[2]}. No relation involving ${names[3]} is supplied. Classify the order as unique, ambiguous, or inconsistent. JSON only with key status.`,
      jsonContract({ status: 'ambiguous' }),
    )],
  }));
}

function aliasCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const initial = 8 + index;
    const subtract = 2 + (index % 4);
    const add = 3 + (index % 5);
    return scenario({
      id: `alias-subtract-${index}`,
      category: 'code-soundness', capability: 'total-statement-consumption',
      representations: ['supported JavaScript AST', 'alias identity graph', 'total input consumption'],
      turns: [turn(
        `Trace JavaScript without running it: const p={x:${initial}}; const q=p; const r={...p}; q.x-=${subtract}; r.x+=${add}; console.log(p.x,q.x,r.x). Return only comma-separated values.`,
        exactContract(`${initial - subtract},${initial - subtract},${initial + add}`),
      )],
    });
  });
}

function incompleteProbabilityCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const gainProbability = 35 + index;
    const lossProbability = 20;
    return scenario({
      id: `probability-mass-${index}`,
      category: 'uncertainty-soundness', capability: 'probability-mass-validation',
      representations: ['exact rational probabilities', 'probability mass invariant', 'invalid-input disposition'],
      turns: [turn(
        `Choose by expected value. Option A: ${gainProbability}% chance to gain ${10 + index} credits and ${lossProbability}% chance to lose 4 credits. Option B: guaranteed gain of 2 credits. The listed outcomes may be incomplete. If probability mass is not 100%, return INSUFFICIENT exactly.`,
        exactContract('INSUFFICIENT'),
      )],
    });
  });
}

function expectedTieCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const payoff = 6 + index * 2;
    const expected = payoff / 2;
    return scenario({
      id: `expected-value-tie-${index}`,
      category: 'decision-soundness', capability: 'verified-decision-rendering',
      representations: ['exact expected values', 'three-way comparison', 'renderer invariant'],
      turns: [turn(
        `Option A has a 50% chance to gain ${payoff} credits and a 50% chance to gain 0. Option B guarantees ${expected} credits. Choose by expected value. Return JSON only with keys decision, a, b; decision must be A, B, or tie.`,
        jsonContract({ decision: 'tie', a: expected, b: expected }),
      )],
    });
  });
}

function closureExpressionCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const multiplier = 2 + (index % 4);
    const count = 4 + (index % 3);
    const firstIndex = index % 2;
    const secondIndex = count - 1;
    return scenario({
      id: `closure-expression-${index}`,
      category: 'code-soundness', capability: 'closure-body-execution',
      representations: ['supported JavaScript AST', 'per-iteration lexical environment', 'expression evaluation'],
      turns: [turn(
        `Trace JavaScript without running it: const f=[]; for(let i=0;i<${count};i++){f.push(()=>i*${multiplier});} console.log(f[${firstIndex}](),f[${secondIndex}]()). Return only comma-separated values.`,
        exactContract(`${firstIndex * multiplier},${secondIndex * multiplier}`),
      )],
    });
  });
}

function spatialContradictionCases() {
  return NAME_SETS.map((names, index) => scenario({
    id: `spatial-contradiction-${index}`,
    category: 'graph-soundness', capability: 'spatial-consistency',
    representations: ['bidirectional coordinate constraints', 'contradiction detection', 'consistency certificate'],
    turns: [turn(
      `${names[0]} is north of ${names[1]}. ${names[0]} is south of ${names[1]}. Where is ${names[0]} relative to ${names[1]}? If the constraints conflict, return JSON only as {"status":"inconsistent"}.`,
      jsonContract({ status: 'inconsistent' }),
    )],
  }));
}

function recurrenceDomainCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const seed = 2 + index;
    return scenario({
      id: `recurrence-domain-${index}`,
      category: 'symbolic-soundness', capability: 'recurrence-domain-validation',
      representations: ['indexed domain', 'recurrence preconditions', 'undefined-value disposition'],
      turns: [turn(
        `Sequence x is defined by x1=${seed} and x(n+1)=2*x(n)+n for n>=1. Compute x0. If x0 is not determined by the definition, return INSUFFICIENT exactly.`,
        exactContract('INSUFFICIENT'),
      )],
    });
  });
}

function aggregationBindingCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const a1 = 100 + index; const a2 = 200 + index;
    const b1 = 300 + index; const b2 = 400 + index;
    const c1 = 2 + index; const c2 = 5 + index;
    const d1 = 3 + index; const d2 = 7 + index;
    const records = [
      { team: 'red', amount: a1, cost: c1 }, { team: 'blue', amount: b1, cost: d1 },
      { team: 'red', amount: a2, cost: c2 }, { team: 'blue', amount: b2, cost: d2 },
    ];
    return scenario({
      id: `aggregation-field-binding-${index}`,
      category: 'data-soundness', capability: 'semantic-field-binding',
      representations: ['schema roles', 'requested measure binding', 'grouped aggregation'],
      turns: [turn(
        `Sum cost, not amount, by team from ${JSON.stringify(records)}. Return JSON only with alphabetic team keys and no extras.`,
        jsonContract({ blue: d1 + d2, red: c1 + c2 }),
      )],
    });
  });
}

function randomizedOutcomeCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const onFailures = 55 + index;
    const offFailures = 35 + index;
    return scenario({
      id: `randomized-equal-size-${index}`,
      category: 'causal-soundness', capability: 'outcome-versus-sample-size-binding',
      representations: ['trial-arm schema', 'outcome-rate comparison', 'causal conclusion certificate'],
      turns: [turn(
        `Observationally feature F was assigned to high-risk users. A randomized trial then used equal sample sizes of 100 per arm: F on had ${onFailures} failures and F off had ${offFailures} failures. Equal refers only to sample size. Return JSON only with keys conclusion and riskDifferencePoints.`,
        jsonContract({ conclusion: 'higher-failure-rate-with-F', riskDifferencePoints: onFailures - offFailures }),
      )],
    });
  });
}

function impossibleCoverCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const missing = `z${index}`;
    return scenario({
      id: `set-cover-uncovered-${index}`,
      category: 'optimization-soundness', capability: 'explicit-target-universe',
      representations: ['explicit optimization universe', 'coverage certificate', 'infeasibility proof'],
      turns: [turn(
        `Choose the fewest modules covering p, q, r, and ${missing}. A covers p+q. B covers q+r. C covers p+r. No module covers ${missing}. Return JSON only; if impossible use {"status":"impossible"}.`,
        jsonContract({ status: 'impossible' }),
      )],
    });
  });
}

function finiteIntegerEquationCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const total = 4 + index;
    const solutions = Array.from({ length: total + 1 }, (_, first) => [first, total - first]);
    return scenario({
      id: `integer-domain-equation-${index}`,
      category: 'constraint-soundness', capability: 'domain-aware-linear-reasoning',
      representations: ['variable domains', 'finite solution enumeration', 'cardinality certificate'],
      turns: [turn(
        `The only equation is x + y = ${total}, with x and y restricted to nonnegative integers. Do not assume equality. Return JSON only with keys count and solutions, listing pairs in ascending x order.`,
        jsonContract({ count: total + 1, solutions }),
      )],
    });
  });
}

function bayesDistractorCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const prevalence = 2 + index;
    const sensitivity = 80;
    const falsePositive = 10;
    const posterior = (prevalence * sensitivity) / (prevalence * sensitivity + (100 - prevalence) * falsePositive) * 100;
    return scenario({
      id: `bayes-distractor-${index}`,
      category: 'uncertainty-soundness', capability: 'probability-role-binding',
      representations: ['named probability roles', 'irrelevant-number rejection', 'Bayes certificate'],
      turns: [turn(
        `A dashboard unrelatedly reports 99% uptime. Defect prevalence is ${prevalence}%. The test catches ${sensitivity}% of defects and falsely flags ${falsePositive}% of good units. For a positive unit, return only the posterior defect percentage rounded to one decimal.`,
        exactContract(`${posterior.toFixed(1)}%`),
      )],
    });
  });
}

function ledgerTopicCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const start = 20 + index;
    const add = 4 + (index % 3);
    const remove = 2 + (index % 2);
    const total = start + add - remove;
    return scenario({
      id: `ledger-topic-switch-${index}`,
      category: 'state-soundness', capability: 'topic-scoped-state-routing',
      representations: ['conversation problem frame', 'topic boundary', 'safe abstention'],
      turns: [
        turn(
          `Start inventory at ${start}. Event A adds ${add}. Event B removes ${remove}. Compute and preserve the named events.`,
          exactContract(`${total}. A=+${add} and B=-${remove}, so ${start}+${add}-${remove}=${total}.`),
        ),
        turn(
          'Topic change: what does the word inventory mean in accounting? This is not a ledger recomputation. The bounded ledger route must abstain; output INSUFFICIENT exactly.',
          exactContract('INSUFFICIENT'),
          'abstain',
        ),
      ],
    });
  });
}

function ledgerThirdCorrectionCases() {
  return Array.from({ length: 10 }, (_, index) => {
    const start = 50 + index;
    const add = 6 + (index % 3);
    const remove = 9 + (index % 2);
    const correctedRemove = remove - 2;
    const correctedAdd = add + 3;
    const firstTotal = start + add - remove;
    const secondTotal = start + add - correctedRemove;
    const thirdTotal = start + correctedAdd - correctedRemove;
    return scenario({
      id: `ledger-third-correction-${index}`,
      category: 'state-soundness', capability: 'event-sourced-correction-history',
      representations: ['event-sourced state', 'correction versions', 'history replay certificate'],
      turns: [
        turn(`Start inventory at ${start}. Event A adds ${add}. Event B removes ${remove}. Compute and preserve events.`, exactContract(`${firstTotal}. A=+${add} and B=-${remove}, so ${start}+${add}-${remove}=${firstTotal}.`)),
        turn(`Correction: B removed ${correctedRemove}, not ${remove}. Recompute.`, exactContract(`${secondTotal}. Corrected B to -${correctedRemove}: ${start}+${add}-${correctedRemove}=${secondTotal}.`)),
        turn(`Second correction: A added ${correctedAdd}, not ${add}. Preserve the prior B correction and recompute from the original inventory.`, exactContract(`${thirdTotal}. Corrected A to +${correctedAdd}: ${start}+${correctedAdd}-${correctedRemove}=${thirdTotal}.`)),
      ],
    });
  });
}

export const V3_SOUNDNESS_SCENARIOS = [
  ...orderingCases(), ...aliasCases(), ...incompleteProbabilityCases(), ...expectedTieCases(),
  ...closureExpressionCases(), ...spatialContradictionCases(), ...recurrenceDomainCases(),
  ...aggregationBindingCases(), ...randomizedOutcomeCases(), ...impossibleCoverCases(),
  ...finiteIntegerEquationCases(), ...bayesDistractorCases(), ...ledgerTopicCases(),
  ...ledgerThirdCorrectionCases(),
];
