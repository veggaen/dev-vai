const match = (id, pattern, options = {}) => ({ id, kind: 'match', pattern, ...options });
const avoid = (id, pattern, options = {}) => ({ id, kind: 'avoid', pattern, ...options });
const exact = (id, value) => ({ id, kind: 'exact', value, critical: true });
const jsonExact = (id, exactValues) => ({ id, kind: 'json', requiredKeys: Object.keys(exactValues), exactKeys: true, exactValues, critical: true });

/** Frozen 2026-07-19 before its first Vai run. */
export const COMPETITION_V2_FRESH2_SCENARIOS = [
  {
    id: 'v2-fresh2-contraposition-chain', split: 'fresh2', tier: 'complex', category: 'conditional-logic',
    turns: [{ prompt: 'Rules: if the build passes, deployment is allowed. If deployment is allowed, an audit is recorded. The audit was not recorded. What follows about deployment and the build? Use contraposition and do not reverse an implication.', referenceAnswer: 'There is no allowed deployment, and the build did not pass. This follows by contraposition through the two implications.', rubric: { threshold: 1, criteria: [match('deployment', /deployment.*not allowed|deployment was not allowed|no allowed deployment/i, { critical: true }), match('build', /build.*did not pass|build.*not pass/i, { critical: true }), match('method', /contraposition|contrapositive/i), avoid('reverse', /audit.*not recorded.*therefore.*build passed|deployment.*allowed/i, { critical: true })] } }],
  },
  {
    id: 'v2-fresh2-underdetermined', split: 'fresh2', tier: 'advanced', category: 'epistemic-reasoning',
    turns: [{ prompt: 'The only constraint is x + y = 10 over the real numbers. What are the exact values of x and y? Do not assume they are equal.', referenceAnswer: 'They cannot be determined uniquely from one equation. Infinitely many pairs work, such as (0,10) and (4,6); another independent constraint is required.', rubric: { threshold: 1, criteria: [match('underdetermined', /cannot be determined uniquely|underdetermined|not enough information|infinitely many/i, { critical: true }), match('examples', /\(0\s*,\s*10\).*\(4\s*,\s*6\)|\(4\s*,\s*6\).*\(0\s*,\s*10\)/i), match('need-constraint', /another|second|independent.*constraint|one equation/i), avoid('assume-five', /x\s*=\s*5.*y\s*=\s*5/i, { critical: true })] } }],
  },
  {
    id: 'v2-fresh2-expected-value', split: 'fresh2', tier: 'complex', category: 'decision-reasoning',
    turns: [{ prompt: 'Choose by expected monetary value. Option A: 70% chance to gain 10 credits and 30% chance to lose 20 credits. Option B: guaranteed gain of 2 credits. Which option has higher expected value? Show both calculations.', referenceAnswer: 'A: 0.70×10 + 0.30×(-20) = 1 credit. B: 2 credits. Choose B because 2 > 1.', rubric: { threshold: 1, criteria: [match('a-ev', /0\.70\s*(?:×|\*|x)\s*10.*0\.30\s*(?:×|\*|x)\s*\(?-?20\)?.*=\s*1|A.*expected.*1/i, { critical: true }), match('b-ev', /B.*2|guaranteed.*2/i, { critical: true }), match('choose-b', /choose\s+B|option\s+B.*higher/i, { critical: true }), avoid('choose-a', /choose\s+A/i, { critical: true })] } }],
  },
  {
    id: 'v2-fresh2-resource-schedule', split: 'fresh2', tier: 'complex', category: 'planning',
    turns: [{ prompt: 'Independent tasks A=3 minutes, B=2 minutes, C=4 minutes. Exactly two workers are available, tasks cannot split, and each worker runs one task at a time. Give the minimum makespan and one start-end schedule. Break equally good schedules by starting lexicographically earlier tasks first.', referenceAnswer: '5 minutes. A 0-3; C 0-4; B 3-5.', rubric: { threshold: 1, criteria: [match('makespan', /\b5\s+minutes?\b/i, { critical: true }), match('a', /A\s*[:=]?\s*0\s*[-–]\s*3/i), match('c', /C\s*[:=]?\s*0\s*[-–]\s*4/i), match('b', /B\s*[:=]?\s*3\s*[-–]\s*5/i), avoid('six', /\b6\s+minutes?\b/i, { critical: true })] } }],
  },
  {
    id: 'v2-fresh2-closure-trace', split: 'fresh2', tier: 'complex', category: 'code-execution',
    turns: [{ prompt: 'Trace JavaScript without running it: const f=[]; for(let i=0;i<3;i++){f.push(()=>i);} console.log(f[0](),f[2]()). Return only comma-separated values.', referenceAnswer: '0,2', rubric: { threshold: 1, criteria: [exact('closure-values', '0,2')] } }],
  },
  {
    id: 'v2-fresh2-corrected-ledger', split: 'fresh2', tier: 'complex', category: 'state-revision',
    turns: [
      { prompt: 'Start inventory at 20. Event A adds 5. Event B removes 8. What is the resulting inventory? Preserve the named events for a later correction.', referenceAnswer: '17. A=+5 and B=-8, so 20+5-8=17.', rubric: { threshold: 1, criteria: [match('total', /\b17\b/i, { critical: true }), match('a', /A\s*=\s*\+?5|A adds 5/i), match('b', /B\s*=\s*-8|B removes 8/i)] } },
      { prompt: 'Correction: B removed 6, not 8. Then event C adds 4. Recompute from the original inventory without double-applying anything.', referenceAnswer: '23. Corrected B to -6 and applied C=+4: 20+5-6+4=23.', rubric: { threshold: 1, criteria: [match('total', /\b23\b/i, { critical: true }), match('correction', /B.*-6|B.*removed 6/i, { critical: true }), match('c', /C.*\+4|C.*adds 4/i), match('calculation', /20\s*\+\s*5\s*-\s*6\s*\+\s*4\s*=\s*23/i, { critical: true }), avoid('double-apply', /\b15\b|\b19\b/i, { critical: true })] } },
    ],
  },
  {
    id: 'v2-fresh2-confounding', split: 'fresh2', tier: 'complex', category: 'causal-reasoning',
    turns: [{ prompt: 'Observationally, users with feature F have more failures, but F was assigned specifically to already high-risk users. In a randomized trial, failure rates are equal with F on and off. What causal claim is justified?', referenceAnswer: 'The observational association is not causal evidence because baseline risk confounds the assignment. The randomized evidence supports no detected causal effect of F in this trial.', rubric: { threshold: 1, criteria: [match('confounded', /confound|baseline risk|high-risk assignment/i, { critical: true }), match('association-not-cause', /association.*not.*caus|does not show.*caus|cannot infer.*caus/i, { critical: true }), match('randomized', /randomized.*(?:no|equal)|no detected causal effect|equal.*trial/i, { critical: true }), avoid('f-causes', /F causes (?:the )?failures/i, { critical: true })] } }],
  },
  {
    id: 'v2-fresh2-counterexample', split: 'fresh2', tier: 'complex', category: 'constructive-reasoning',
    turns: [{ prompt: 'Claim: every non-empty integer array whose elements sum to 0 must contain the integer 0. Return JSON only with key counterexample containing a shortest array that disproves the claim.', referenceAnswer: '{"counterexample":[-1,1]}', rubric: { threshold: 1, criteria: [jsonExact('counterexample', { counterexample: [-1, 1] })] } }],
  },
];
