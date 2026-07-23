import { describe, expect, test } from 'vitest';
import { tryBoundedReasoning } from './bounded-reasoning.js';

const answer = (prompt: string) => tryBoundedReasoning(prompt)?.reply;

describe('bounded reasoning soundness boundaries', () => {
  test('includes declared disconnected entities and proves ambiguity', () => {
    expect(answer('Tasks Arlo, Bex, Cato, Dune each occur once. Arlo is before Bex. Bex is before Cato. No relation involving Dune is supplied. Classify the order as unique, ambiguous, or inconsistent. JSON only with key status.'))
      .toBe('{"status":"ambiguous"}');
    expect(answer('Participants Pavo, Quill, Rook, Sable are all scheduled exactly once. Pavo precedes Quill; Quill precedes Rook; Sable has no ordering constraint. Classify unique, ambiguous, or inconsistent. JSON only with status.'))
      .toBe('{"status":"ambiguous"}');
  });

  test('consumes supported subtraction mutations instead of silently skipping them', () => {
    expect(answer('Trace JavaScript without running it: const p={x:8}; const q=p; const r={...p}; q.x-=2; r.x+=3; console.log(p.x,q.x,r.x). Return only comma-separated values.'))
      .toBe('6,6,11');
    expect(answer('Trace JavaScript: const p={x:12}; const q=p; const r={...p}; q.x=q.x-4; r.x=r.x+5; console.log(p.x,q.x,r.x). CSV only.'))
      .toBe('8,8,17');
  });

  test('rejects incomplete probability mass and verifies tie rendering', () => {
    expect(answer('Choose by expected value. Option A: 35% chance to gain 10 credits and 20% chance to lose 4 credits. Option B: guaranteed gain of 2 credits. The listed outcomes may be incomplete. If probability mass is not 100%, return INSUFFICIENT exactly.'))
      .toBe('INSUFFICIENT');
    expect(answer('Option A has a 50% chance to gain 6 credits and a 50% chance to gain 0. Option B guarantees 3 credits. Choose by expected value. Return JSON only with keys decision, a, b; decision must be A, B, or tie.'))
      .toBe('{"decision":"tie","a":3,"b":3}');
    expect(answer('Option A has probability 0.40 of gaining 10 and probability 0.30 of losing 5; no other outcomes are specified. Option B guarantees 1. If the distribution is incomplete, output INSUFFICIENT exactly.'))
      .toBe('INSUFFICIENT');
  });

  test('executes the closure body expression', () => {
    expect(answer('Trace JavaScript without running it: const f=[]; for(let i=0;i<4;i++){f.push(()=>i*2);} console.log(f[0](),f[3]()). Return only comma-separated values.'))
      .toBe('0,6');
    expect(answer('Trace JavaScript: const f=[]; for(let i=1;i<=4;i++){f.push(()=>i+3);} console.log(f[0](),f[3]()). CSV only.'))
      .toBe('4,7');
  });

  test('detects contradictory spatial constraints and an undefined recurrence index', () => {
    expect(answer('Arlo is north of Bex. Arlo is south of Bex. Where is Arlo relative to Bex? If constraints conflict, return JSON only as {"status":"inconsistent"}.'))
      .toBe('{"status":"inconsistent"}');
    expect(answer('Sequence x is defined by x1=2 and x(n+1)=2*x(n)+n for n>=1. Compute x0. If x0 is not determined, return INSUFFICIENT exactly.'))
      .toBe('INSUFFICIENT');
    expect(answer('Sequence a starts at index one with a1=3; for n>=1, a(n+1)=2*a(n)+n. Find the value at index zero. If undefined, output INSUFFICIENT exactly.'))
      .toBe('INSUFFICIENT');
  });

  test('binds requested aggregate and probability roles rather than first numeric mentions', () => {
    expect(answer('Sum cost, not amount, by team from [{"team":"red","amount":100,"cost":2},{"team":"blue","amount":300,"cost":3},{"team":"red","amount":200,"cost":5},{"team":"blue","amount":400,"cost":7}]. Return JSON only.'))
      .toBe('{"blue":10,"red":7}');
    expect(answer('A dashboard unrelatedly reports 99% uptime. Defect prevalence is 2%. The test catches 80% of defects and falsely flags 10% of good units. For a positive unit, return only the posterior defect percentage rounded to one decimal.'))
      .toBe('14.0%');
    expect(answer('Using [{"group":"x","amount":90,"cost":4},{"group":"y","amount":70,"cost":6},{"group":"x","amount":30,"cost":8}], total the cost field grouped on group; ignore amount. JSON only with sorted group keys.'))
      .toBe('{"x":12,"y":6}');
    expect(answer('Defect prevalence is 4%; sensitivity is 75%; false-positive rate is 8%. An unrelated SLA is 97%. For a positive item return only P(defect) rounded one decimal percent.'))
      .toBe('28.1%');
  });

  test('distinguishes equal randomized sample sizes from equal outcomes', () => {
    expect(answer('Observationally feature F was assigned to high-risk users. A randomized trial then used equal sample sizes of 100 per arm: F on had 55 failures and F off had 35 failures. Equal refers only to sample size. Return JSON only with keys conclusion and riskDifferencePoints.'))
      .toBe('{"conclusion":"higher-failure-rate-with-F","riskDifferencePoints":20}');
    expect(answer('Randomized trial: F-on arm has 72/120 failures; F-off arm has 32/80. Return JSON only with conclusion and riskDifferencePoints.'))
      .toBe('{"conclusion":"higher-failure-rate-with-F","riskDifferencePoints":20}');
  });

  test('uses explicit cover universes and finite variable domains', () => {
    expect(answer('Choose the fewest modules covering p, q, r, and z0. A covers p+q. B covers q+r. C covers p+r. No module covers z0. Return JSON only; if impossible use {"status":"impossible"}.'))
      .toBe('{"status":"impossible"}');
    expect(answer('The only equation is x + y = 4, with x and y restricted to nonnegative integers. Do not assume equality. Return JSON only with keys count and solutions, listing pairs in ascending x order.'))
      .toBe('{"count":5,"solutions":[[0,4],[1,3],[2,2],[3,1],[4,0]]}');
    expect(answer('Need minimum coverage for target set {alpha,beta,gamma,delta}. Module A={alpha,beta}; B={beta,gamma}; C={alpha,gamma}; nothing covers delta. JSON only; if infeasible return {"status":"impossible"}.'))
      .toBe('{"status":"impossible"}');
    expect(answer('Solve 2x+y=10 over nonnegative integers. Return JSON only with count and solutions in ascending x order. Do not assume equality.'))
      .toBe('{"count":6,"solutions":[[0,10],[1,8],[2,6],[3,4],[4,2],[5,0]]}');
  });

  test('keeps ledger state event-sourced and abstains after an explicit topic switch', () => {
    const first = 'Start inventory at 50. Event A adds 6. Event B removes 9. Compute and preserve events.';
    const correction = 'Correction: B removed 7, not 9. Recompute.';
    const secondCorrection = 'Second correction: A added 9, not 6. Preserve the prior B correction and recompute from the original inventory.';
    expect(tryBoundedReasoning('Topic change: what does the word inventory mean in accounting? This is not a ledger recomputation.', [{ role: 'user', content: first }])).toBeNull();
    expect(tryBoundedReasoning('Define inventory in accounting language. Do not calculate the earlier ledger. The bounded ledger solver must abstain; output INSUFFICIENT exactly.', [{ role: 'user', content: first }])).toBeNull();
    expect(tryBoundedReasoning(secondCorrection, [{ role: 'user', content: first }, { role: 'assistant', content: '47' }, { role: 'user', content: correction }])?.reply)
      .toBe('52. Corrected A to +9: 50+9-7=52.');
  });
});
