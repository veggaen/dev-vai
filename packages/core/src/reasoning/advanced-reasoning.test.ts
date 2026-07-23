import { describe, expect, test } from 'vitest';
import { isUnsupportedStructuredReasoning, tryAdvancedReasoning } from './advanced-reasoning.js';

const answer = (prompt: string, history: Array<{ role: string; content: string }> = []) => tryAdvancedReasoning(prompt, history)?.reply;

describe('advanced bounded reasoning kernels', () => {
  test('enumerates Boolean models instead of affirming consequents', () => {
    expect(answer('Constraints: A is true. A iff B. If B then C. Exactly one of C and D is true. Return the unique Boolean model as JSON only with keys A,B,C,D.'))
      .toBe('{"A":true,"B":true,"C":true,"D":false}');
    expect(answer('Rules: A implies C. B implies C. Observation: C is true. No other facts are known. Return JSON only with status and minimalExplanations; do not choose between A and B.'))
      .toBe('{"status":"underdetermined","minimalExplanations":[["A"],["B"]]}');
    expect(answer('Constraints: A is true. (A OR B) implies C. C iff B. Exactly one of B and D is true. Return the unique Boolean model as JSON only with keys A,B,C,D.'))
      .toBe('{"A":true,"B":true,"C":true,"D":false}');
  });

  test('produces verified CSP witnesses and cores', () => {
    expect(answer('Place A,B,C,D,E,F in positions 1..6. C is position 1. D is immediately after B. E is immediately before A. A is before B. F is after D. Return JSON only with the unique order.'))
      .toBe('{"order":["C","E","A","B","D","F"]}');
    expect(answer('Each task A,B,C,D,E occurs once. Constraints: A before B; B before C; C before A; D before E. Return JSON only with status and a minimal unsatCore listing the contradictory constraints in input order.'))
      .toBe('{"status":"unsat","unsatCore":["A<B","B<C","C<A"]}');
    expect(answer('Choose minimum cost modules covering target set {p,q,r,s}. A covers p+q cost3. B covers r+s cost3. C covers p+r cost2. D covers q+s cost2. Return JSON only with modules and cost.'))
      .toBe('{"modules":["C","D"],"cost":4}');
  });

  test('uses causal structure and complete intervention tables', () => {
    expect(answer('Full factorial outcomes: 000→0,001→0,010→0,011→0,100→0,101→7,110→0,111→0 where bits are A,B,C and 1=ON. Return JSON only with the minimal supported cause.'))
      .toBe('{"interaction":{"A":"ON","B":"OFF","C":"ON"}}');
    expect(answer('SCM: U=1; X=U; M=X AND U; Y=M OR U. Intervene do(X=0), replacing only X equation. Return JSON only with X,M,Y.'))
      .toBe('{"X":0,"M":0,"Y":1}');
  });

  test('performs exact probability and table operators', () => {
    expect(answer('Prior odds for H are 1:1. Independent evidence E1 has LR=4 for H; conflicting E2 has LR=2/3 for H. Return JSON only with posteriorFraction and posteriorPercent rounded1.'))
      .toBe('{"posteriorFraction":"8/11","posteriorPercent":72.7}');
    expect(answer('P(A)=0.7 and P(B)=0.6; dependence is unknown. Return the sharp possible range for P(A and B) as JSON only with lower and upper. Do not assume independence.'))
      .toBe('{"lower":0.3,"upper":0.6}');
    expect(answer('Outcomes are [1,0,0]. Forecast F1=[0.9,0.6,0.2]; F2=[0.7,0.3,0.3]. Compute mean Brier scores rounded4 decimals and choose lower. JSON only.'))
      .toBe('{"F1":0.1367,"F2":0.09,"better":"F2"}');
  });

  test('replays trusted event state and isolates hypothetical branches', () => {
    const first = 'State starts100. Apply e1:+10 and e2:-5 exactly once. Return JSON only with value and applied IDs.';
    const second = 'Replay duplicate e1:+10, then apply e3:-20. Preserve idempotency. Return JSON only.';
    expect(answer('Retract event e2. A retraction reverses its effect but keeps audit history. Return JSON only with value and retracted IDs.', [
      { role: 'user', content: first }, { role: 'assistant', content: 'ignored' }, { role: 'user', content: second },
    ])).toBe('{"value":90,"retracted":["e2"]}');
    expect(answer('Now report actual balance only as JSON.', [{ role: 'user', content: 'Actual balance is50. Record it. JSON only.' }]))
      .toBe('{"actual":50}');
    expect(answer('A later packet repeats e1:+12. Same ID but different payload. Do not apply either interpretation silently. Return JSON only with status and eventId.', [
      { role: 'user', content: 'State starts100. Apply e1:+10 exactly once. Return JSON only with value and applied IDs.' },
    ])).toBe('{"status":"conflict","eventId":"e1"}');
    const renamed = 'Entity Atlas has status paused. Atlas is renamed to Orion; preserve Atlas as an alias. Return JSON only with canonical and aliases.';
    const renamedAgain = 'Orion is renamed to Nova. Preserve all prior aliases. Return JSON only with canonical and aliases.';
    expect(answer('Set Nova status active. What is the status of Atlas? Return JSON only with canonical and status.', [{ role: 'user', content: renamed }, { role: 'user', content: renamedAgain }]))
      .toBe('{"canonical":"Nova","status":"active"}');
  });

  test('executes the whitelisted MiniJS object, closure, iterator and queue semantics', () => {
    expect(answer('Trace JavaScript: const a={inner:{x:1},y:2}; const b={...a}; b.inner.x=5; b.y=7; console.log(a.inner.x,a.y,b.inner.x,b.y). Return CSV only.')).toBe('5,2,5,7');
    expect(answer('Trace JavaScript: let n=0; const obj=null; const x=obj?.a ?? ++n; const y=0 ?? ++n; console.log(n,x,y). Return CSV only.')).toBe('1,1,0');
    expect(answer('Trace JavaScript: const f=[]; for(var i=0;i<3;i++){f.push(()=>i);} console.log(f[0](),f[2]()). Return CSV only.')).toBe('3,3');
    expect(answer('Trace JavaScript: const a=[1,2,3,4],out=[]; for(const x of a){if(x===1)a.splice(1,1); out.push(x);} console.log(out.join(",")); Return CSV only.')).toBe('1,3,4');
    expect(answer("Trace standard JavaScript: console.log('S'); async function f(){console.log('A'); await 0; console.log('B'); queueMicrotask(()=>console.log('C'));} f(); Promise.resolve().then(()=>console.log('D')); console.log('E'); Return CSV only.")).toBe('S,A,E,B,D,C');
    expect(answer('Trace JavaScript: let n=0; const x=0 || ++n; const y=5 ?? ++n; const z=null ?? 2; console.log(n,x,y,z). Return CSV only.')).toBe('1,1,5,2');
    expect(answer('Trace JavaScript: const root={node:{value:1},flag:2}; const copy={...root}; const third={...copy}; third.node.value=9; copy.flag=7; console.log(root.node.value,copy.node.value,third.node.value,root.flag,copy.flag,third.flag). Return CSV only.')).toBe('9,9,9,2,7,2');
  });

  test('searches exact bounded schedules and resource-constrained routes', () => {
    expect(answer('Two identical workers. Durations: A4,B4,C3,D3,E5,F1. C,D depend on A; E depends on B; F depends on C,D,E. Tasks cannot split. Return JSON only with minimum makespan and one schedule as task:[start,end].'))
      .toBe('{"makespan":11,"schedule":{"A":[0,4],"B":[0,4],"C":[4,7],"D":[7,10],"E":[4,9],"F":[10,11]}}');
    expect(answer('Paths: S-A-G has time4 energy9; S-B-C-G has time7 energy6; S-D-G has time8 energy4. Energy budget is6. Return JSON only with fastest feasible path, time, energy.'))
      .toBe('{"path":["S","B","C","G"],"time":7,"energy":6}');
    expect(answer('Paths: S-A-G has time4 energy5 risk9; S-B-C-G has time6 energy6 risk4; S-D-G has time7 energy3 risk2. Energy budget is6 and risk budget is5. Return JSON only with fastest feasible path, time, energy, risk.'))
      .toBe('{"path":["S","B","C","G"],"time":6,"energy":6,"risk":4}');
    expect(answer('One machine. Jobs R1,R2 are red duration2; B1,B2 are blue duration2. Switching color costs1; same-color transition costs0. Start red when tied, then lexicographic IDs. Return JSON only with minimum makespan and order.'))
      .toBe('{"makespan":9,"order":["R1","R2","B1","B2"]}');
    expect(answer('Two identical workers. Tasks: A duration2 release0; B duration3 release2; C duration2 release0 after A; D duration1 after B,C. Tasks cannot split. Return JSON only with minimum makespan and schedule.'))
      .toBe('{"makespan":6,"schedule":{"A":[0,2],"B":[2,5],"C":[2,4],"D":[5,6]}}');
  });

  test('simulates transaction schedules, regret, and filter composition', () => {
    expect(answer('Read-committed transaction schedule: balance=10. T1 reads 10; T2 reads 10; T1 writes 15 and commits; T2 writes 17 and commits. Return JSON only with finalBalance and anomaly.'))
      .toBe('{"finalBalance":17,"anomaly":"lost-update"}');
    expect(answer('Utilities by states s1,s2,s3: A=[4,8,6]; B=[5,5,5]; C=[9,3,7]. Choose minimum maximum regret. Return JSON only with maxRegret by action and chosen.'))
      .toBe('{"maxRegret":{"A":5,"B":4,"C":5},"chosen":"B"}');
    expect(answer('Utilities by states s1,s2,s3: A=[7,2,8]; B=[5,5,5]; C=[3,9,4]. Choose minimum maximum regret. Return JSON only with maxRegret by action and chosen.'))
      .toBe('{"maxRegret":{"A":7,"B":4,"C":4},"chosen":["B","C"]}');
    expect(answer('From records [{"keep":true,"faulty":5,"healthy":7},{"keep":false,"faulty":100,"healthy":1},{"keep":true,"faulty":8,"healthy":10}], keep only keep=true, sum faulty and healthy, compute faulty/(faulty+healthy), and reject only if strictly greater than45%. Return JSON only with faulty,healthy,posteriorPercent,reject.'))
      .toBe('{"faulty":13,"healthy":17,"posteriorPercent":43.333333333333336,"reject":false}');
  });

  test('contains recognized but unsupported structured tasks', () => {
    expect(isUnsupportedStructuredReasoning('Trace JavaScript: eval(userInput). Return CSV only.')).toBe(true);
    expect(tryAdvancedReasoning('Trace JavaScript: eval(userInput). Return CSV only.')).toBeNull();
    expect(isUnsupportedStructuredReasoning('Explain JSON to a beginner.')).toBe(false);
  });
});
