const match = (id, pattern, options = {}) => ({ id, kind: 'match', pattern, ...options });
const avoid = (id, pattern, options = {}) => ({ id, kind: 'avoid', pattern, ...options });
const exact = (id, value) => ({ id, kind: 'exact', value, critical: true });
const jsonExact = (id, exactValues) => ({ id, kind: 'json', requiredKeys: Object.keys(exactValues), exactKeys: true, exactValues, critical: true });

/** Frozen 2026-07-19 before its first Vai run. */
export const COMPETITION_V2_FRESH3_SCENARIOS = [
  {
    id: 'v2-fresh3-contraposition-paraphrase', split: 'fresh3', tier: 'complex', category: 'conditional-logic',
    turns: [{ prompt: 'Whenever a sensor is calibrated, its measurements are trusted. Trusted measurements always create a certificate. No certificate was created. Using contraposition, what follows about trust and calibration?', referenceAnswer: 'The measurements were not trusted, and the sensor was not calibrated. Contraposition applies through both implications.', rubric: { threshold: 1, criteria: [match('trust', /measurements?.*(?:not trusted|were not trusted)|no trusted measurements/i, { critical: true }), match('calibration', /sensor.*not calibrated|sensor was not calibrated/i, { critical: true }), match('method', /contraposition|contrapositive/i), avoid('reverse', /sensor is calibrated|measurements are trusted/i, { critical: true })] } }],
  },
  {
    id: 'v2-fresh3-linear-underdetermined', split: 'fresh3', tier: 'complex', category: 'epistemic-reasoning',
    turns: [{ prompt: 'The only equation is 2m + n = 14 over the real numbers. Give the exact values of m and n, or explain why that is impossible. Do not assume either is zero or that they are equal.', referenceAnswer: 'The values are underdetermined: one linear equation cannot uniquely determine two real variables. For example, (m,n)=(0,14) and (5,4) both satisfy it; another independent equation is required.', rubric: { threshold: 1, criteria: [match('underdetermined', /underdetermined|cannot.*uniquely|not enough information|infinitely many/i, { critical: true }), match('examples', /\(\s*0\s*,\s*14\s*\).*\(\s*5\s*,\s*4\s*\)|\(\s*5\s*,\s*4\s*\).*\(\s*0\s*,\s*14\s*\)/i, { critical: true }), match('constraint', /another|second|independent.*equation|one.*equation/i), avoid('unique-seven', /m\s*=\s*7.*n\s*=\s*0/i, { critical: true })] } }],
  },
  {
    id: 'v2-fresh3-expected-cost', split: 'fresh3', tier: 'complex', category: 'decision-reasoning',
    turns: [{ prompt: 'Minimize expected cost. Option Red has a 25% chance of costing 40 credits and a 75% chance of costing 0. Option Blue costs 12 credits for certain. Show both expected costs and choose.', referenceAnswer: 'Red: 0.25*40 + 0.75*0 = 10 credits. Blue: 12 credits. Choose Red because 10 < 12.', rubric: { threshold: 1, criteria: [match('red', /Red.*(?:0\.25\s*(?:\*|x|×)\s*40.*=\s*10|expected cost.*10)/i, { critical: true }), match('blue', /Blue.*12/i, { critical: true }), match('choose', /choose\s+Red|Red.*lower/i, { critical: true }), avoid('blue-choice', /choose\s+Blue/i, { critical: true })] } }],
  },
  {
    id: 'v2-fresh3-four-task-partition', split: 'fresh3', tier: 'complex', category: 'planning',
    turns: [{ prompt: 'Independent tasks J=6 minutes, K=5 minutes, L=4 minutes, M=3 minutes. Exactly two workers. Give the minimum makespan and one start-end schedule; tasks cannot split.', referenceAnswer: '9 minutes. J 0-6; M 6-9; K 0-5; L 5-9.', rubric: { threshold: 1, criteria: [match('makespan', /\b9\s+minutes?\b/i, { critical: true }), match('j', /J\s*[:=]?\s*0\s*[-–]\s*6/i), match('m', /M\s*[:=]?\s*6\s*[-–]\s*9/i), match('k', /K\s*[:=]?\s*0\s*[-–]\s*5/i), match('l', /L\s*[:=]?\s*5\s*[-–]\s*9/i)] } }],
  },
  {
    id: 'v2-fresh3-stepped-let-closures', split: 'fresh3', tier: 'complex', category: 'code-execution',
    turns: [{ prompt: 'Trace JavaScript without running it: const g=[]; for(let k=2;k<=6;k+=2){g.push(()=>k);} console.log(g[0](),g[2]()). Return only comma-separated values.', referenceAnswer: '2,6', rubric: { threshold: 1, criteria: [exact('values', '2,6')] } }],
  },
  {
    id: 'v2-fresh3-correct-added-event', split: 'fresh3', tier: 'complex', category: 'state-revision',
    turns: [
      { prompt: 'Start inventory at 40. Event A removes 6. Event B adds 3. Compute the inventory and preserve the named events.', referenceAnswer: '37. A=-6 and B=+3, so 40-6+3=37.', rubric: { threshold: 1, criteria: [match('total', /\b37\b/i, { critical: true }), match('a', /A\s*=\s*-6|A removes 6/i), match('b', /B\s*=\s*\+3|B adds 3/i)] } },
      { prompt: 'Correction: B added 5, not 3. Then event C removes 4. Recompute once from the original inventory.', referenceAnswer: '35. Corrected B to +5 and applied C=-4: 40-6+5-4=35.', rubric: { threshold: 1, criteria: [match('total', /\b35\b/i, { critical: true }), match('b', /B.*\+5|B.*added 5/i, { critical: true }), match('c', /C.*-4|C.*removes 4/i), match('calculation', /40\s*-\s*6\s*\+\s*5\s*-\s*4\s*=\s*35/i, { critical: true })] } },
    ],
  },
  {
    id: 'v2-fresh3-causal-severity', split: 'fresh3', tier: 'complex', category: 'causal-reasoning',
    turns: [{ prompt: 'Clinic records show patients given therapy T recovered less often, but physicians preferentially gave T to the sickest patients. A randomized experiment later found matching recovery rates with T and without it. Is T shown to be harmful, and why?', referenceAnswer: 'No. Treatment assignment was confounded by baseline severity, so the clinic association does not establish harm. The randomized experiment found no detected harmful causal effect.', rubric: { threshold: 1, criteria: [match('no', /\bno\b|not shown|does not establish/i, { critical: true }), match('confound', /confound|baseline severity|sickest.*assignment|selection/i, { critical: true }), match('randomized', /randomized.*(?:matching|same|no)|no detected.*harm/i, { critical: true }), avoid('harmful', /\bT\b\s+(?:is|was|causes).*harmful|\bT\b\s+harms/i, { critical: true })] } }],
  },
  {
    id: 'v2-fresh3-even-product-counterexample', split: 'fresh3', tier: 'complex', category: 'constructive-reasoning',
    turns: [{ prompt: 'Claim: if the product of two integers is even, both integers must be even. Return JSON only with key counterexample containing a shortest ordered pair that disproves the claim.', referenceAnswer: '{"counterexample":[1,2]}', rubric: { threshold: 1, criteria: [jsonExact('counterexample', { counterexample: [1, 2] })] } }],
  },
  {
    id: 'v2-fresh3-bayes-decision', split: 'fresh3', tier: 'complex', category: 'compositional-reasoning',
    turns: [{ prompt: 'Out of 1,000 components, 100 are faulty. A test flags 90 faulty components and 180 healthy components. Reject a flagged component only if its probability of being faulty is greater than 40%. Compute the probability and decide whether to reject.', referenceAnswer: 'Among flagged components, 90/(90+180)=1/3=33.3% are faulty. Since 33.3% is not greater than 40%, do not reject.', rubric: { threshold: 1, criteria: [match('probability', /90\s*\/\s*\(?\s*90\s*\+\s*180\s*\)?.*(?:33\.3|1\s*\/\s*3)|(?:33\.3|1\s*\/\s*3).*90\s*\/\s*270/i, { critical: true }), match('decision', /do not reject|should not reject|keep/i, { critical: true }), match('threshold', /not greater than\s*40|33\.3.*40/i), avoid('reject', /(?:therefore|so|decision:)\s*reject|should reject/i, { critical: true })] } }],
  },
  {
    id: 'v2-fresh3-self-referential-consistency', split: 'fresh3', tier: 'trick', category: 'logical-consistency',
    turns: [{ prompt: 'Exactly one of statements A and B is true. A says: "B is false." B says: "A and B have the same truth value." Determine the consistent truth values. JSON only with boolean keys A and B.', referenceAnswer: '{"A":true,"B":false}', rubric: { threshold: 1, criteria: [jsonExact('truth-values', { A: true, B: false })] } }],
  },
];
