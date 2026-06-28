// Run: node --test scripts/improve-loop/process-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defineProcess, createRegistry, scoreProcesses, plan, runCycle, DENSITY_FLOOR,
} from './process-engine.mjs';

test('defineProcess: defaults + validation', () => {
  assert.throws(() => defineProcess({}), /string id/);
  assert.throws(() => defineProcess({ id: 'x' }), /run\(\)/);
  const p = defineProcess({ id: 'x', run: () => {} });
  assert.equal(p.when({}), true);   // default eligible
  assert.equal(p.cost({}), 1);      // default cost
  assert.equal(p.value({}), 0.5);   // default value
});

test('createRegistry: rejects duplicate ids', () => {
  assert.throws(() => createRegistry([{ id: 'a', run() {} }, { id: 'a', run() {} }]), /duplicate/);
});

test('scoreProcesses: eligible-first, density-desc, stable order; ineligible excluded from running', () => {
  const reg = createRegistry([
    { id: 'cheap-big', when: () => true, cost: () => 1, value: () => 0.9, run() {} }, // density 0.9
    { id: 'pricey-small', when: () => true, cost: () => 10, value: () => 0.5, run() {} }, // density 0.05
    { id: 'off', when: () => false, cost: () => 1, value: () => 1, run() {} }, // ineligible
  ]);
  const s = scoreProcesses(reg, {});
  assert.equal(s[0].id, 'cheap-big');     // highest density first
  assert.equal(s[1].id, 'pricey-small');
  assert.equal(s[2].id, 'off');           // ineligible sorts last
  assert.equal(s[2].eligible, false);
});

test('plan: skips below-floor density and respects the compute budget (the anti-waste core)', () => {
  const reg = createRegistry([
    { id: 'high', cost: () => 2, value: () => 1, run() {} },     // density 0.5
    { id: 'low', cost: () => 100, value: () => 0.1, run() {} },  // density 0.001 < floor → skip
    { id: 'mid', cost: () => 3, value: () => 0.6, run() {} },    // density 0.2
  ]);
  // Unlimited budget: runs high + mid, skips the low-density waster.
  const all = plan(reg, {}, { budget: Infinity });
  assert.deepEqual(all.chosen, ['high', 'mid']);
  assert.equal(all.spent, 5);
  // Tight budget of 2: only the densest that fits.
  const tight = plan(reg, {}, { budget: 2 });
  assert.deepEqual(tight.chosen, ['high']);
  assert.equal(tight.spent, 2);
});

test('plan: when no process clears the floor, runs nothing (saves compute, not perpetual-busywork)', () => {
  const reg = createRegistry([{ id: 'waste', cost: () => 100, value: () => 0.01, run() {} }]);
  const out = plan(reg, {}, {});
  assert.deepEqual(out.chosen, []);
  assert.equal(out.spent, 0);
});

test('runCycle: runs chosen serially, records outcomes, survives a crashing process', async () => {
  const calls = [];
  const reg = createRegistry([
    { id: 'a', value: () => 0.9, cost: () => 1, run() { calls.push('a'); return 'ra'; } },
    { id: 'boom', value: () => 0.8, cost: () => 1, run() { throw new Error('kaboom'); } },
    { id: 'b', value: () => 0.7, cost: () => 1, async run() { calls.push('b'); return 'rb'; } },
  ]);
  const { ran, outcomes } = await runCycle(reg, {}, {});
  assert.deepEqual(ran, ['a', 'boom', 'b']);          // all chosen, in density order
  assert.deepEqual(calls, ['a', 'b']);                 // boom threw but didn't stop the cycle
  assert.equal(outcomes.find((o) => o.id === 'boom').ok, false);
  assert.match(outcomes.find((o) => o.id === 'boom').error, /kaboom/);
  assert.equal(outcomes.find((o) => o.id === 'a').result, 'ra');
});

test('runCycle: a process can compose sub-processes via selectAndRun (dynamic depth)', async () => {
  const seen = [];
  const reg = createRegistry([
    {
      id: 'parent', value: () => 1, cost: () => 1,
      async run({ selectAndRun }) {
        seen.push('parent');
        // Only the child is eligible in the sub-context, so the parent composes it on demand.
        await selectAndRun({ phase: 'child' });
        return 'done';
      },
    },
    {
      id: 'child', value: () => 1, cost: () => 1,
      when: (ctx) => ctx.phase === 'child', // eligible ONLY when the parent invokes it
      run() { seen.push('child'); },
    },
  ]);
  // Top-level: child is not eligible (no phase), so only parent runs — then composes child.
  await runCycle(reg, {}, {});
  assert.deepEqual(seen, ['parent', 'child']);
});

test('runCycle: maxDepth halts runaway recursion (perpetual ≠ infinite stack)', async () => {
  let runs = 0;
  const reg = createRegistry([
    { id: 'recur', value: () => 1, cost: () => 1, async run({ selectAndRun }) { runs++; await selectAndRun({}); } },
  ]);
  const r = await runCycle(reg, {}, { maxDepth: 3 });
  assert.ok(runs <= 4); // depth 0..3 then halted
  assert.equal(r.halted, null); // top-level itself completed; deeper calls hit the cap
});

test('emits plan + run events for observability', async () => {
  const events = [];
  const reg = createRegistry([{ id: 'a', value: () => 1, cost: () => 1, run() {} }]);
  await runCycle(reg, {}, { onEvent: (e) => events.push(e.type) });
  assert.ok(events.includes('plan'));
  assert.ok(events.includes('run:start'));
  assert.ok(events.includes('run:done'));
});
