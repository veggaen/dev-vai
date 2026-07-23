import { describe, expect, it } from 'vitest';
import {
  solveChainedOps,
  solveDependencyOrder,
  solveDeterministicReasoning,
  solveFormatConstraint,
  solveInventory,
  solveJsSnippet,
  solveOddOneOut,
  solveRuleLogic,
  solveSumDiff,
  solveUnknowable,
} from './deterministic-reasoning.js';

describe('deterministic reasoning solvers', () => {
  it('chains arithmetic imperatives', () => {
    expect(solveChainedOps('Start with 17. Double it. Subtract 8. Multiply the result by 5. Finally add 27. What is the final number?'))
      .toContain('**157**');
  });

  it('tracks narrative inventory and ignores distractor ages', () => {
    const out = solveInventory('Maria has 25 stamps and is 60 years old. She buys 18 more stamps and gives none away. How many stamps does she have now?');
    expect(out).toContain('**43**');
  });

  it('solves the sum/difference trap without falling for it', () => {
    const out = solveSumDiff('A notebook and a pencil cost 1.10 dollars in total. The notebook costs exactly 1.00 dollars more than the pencil. How many cents does the pencil cost?');
    expect(out).toContain('**5 cents**');
  });

  it('categorizes the odd one out', () => {
    expect(solveOddOneOut('Which of these does NOT belong with the others: apple, banana, carrot? Answer with the odd one out.'))
      .toContain('**carrot**');
  });

  it('applies modus tollens and only-if inference', () => {
    expect(solveRuleLogic('Rule: if the button is pressed, the light always turns green. This morning the light did NOT turn green. Based only on the rule, did the button get pressed? Answer yes or no, then explain in one sentence.'))
      .toMatch(/^No\./);
    expect(solveRuleLogic('Rule: the alarm rings only if the door opens AND the power is on. Yesterday the power is on, but the alarm did not ring. Based only on the rule, can we conclude that the door opened? Answer yes or no, then explain in one sentence.'))
      .toMatch(/^No\./);
  });

  it('topologically orders dependent tasks and refuses cycles', () => {
    const out = solveDependencyOrder('Four tasks: bravo requires alpha. delta requires bravo. echo has no dependencies but must happen before delta. Give one valid order to run all four tasks, comma-separated.');
    expect(out).toBeTruthy();
    const order = /\*\*([^*]+)\*\*/.exec(out!)![1].split(', ');
    expect(order.indexOf('alpha')).toBeLessThan(order.indexOf('bravo'));
    expect(order.indexOf('bravo')).toBeLessThan(order.indexOf('delta'));
    expect(order.indexOf('echo')).toBeLessThan(order.indexOf('delta'));
    expect(solveDependencyOrder('a requires b. b requires c. c requires a. Give one valid order, comma-separated.')).toBeNull();
  });

  it('predicts small JS snippet output', () => {
    expect(solveJsSnippet('What does this print?\nconsole.log([1, 2, 3].map(x => x * 2).join("-"));')).toContain('2-4-6');
    expect(solveJsSnippet('What number does this print?\nlet s = 0;\nfor (let i = 1; i <= 4; i++) s += i;\nconsole.log(s);')).toContain('10');
    expect(solveJsSnippet('What does this print?\nconsole.log("stack".split("").reverse().join(""));')).toContain('kcats');
  });

  it('refuses to fabricate the unknowable', () => {
    expect(solveUnknowable('What number between 1 and 100 am I thinking of right now? Give me the number.')).toMatch(/can't know/);
    expect(solveUnknowable('What will the exact closing price of Bitcoin be one year from today? Give a number.')).toMatch(/can't know/);
  });

  it('obeys hard output-format constraints exactly', () => {
    expect(solveFormatConstraint('Reply with ONLY the number, nothing else: what is 23 + 41?')).toBe('64');
    expect(solveFormatConstraint('Reply with exactly one word — the word "ready" in uppercase.')).toBe('READY');
  });

  it('returns null on incomplete parses instead of guessing', () => {
    expect(solveDeterministicReasoning('Tell me about queues in computer science.')).toBeNull();
    expect(solveDeterministicReasoning('Start with a clean slate and build me an app.')).toBeNull();
  });
});
