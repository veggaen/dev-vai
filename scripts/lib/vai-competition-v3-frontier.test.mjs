import test from 'node:test';
import assert from 'node:assert/strict';
import { V3_FRONTIER_SCENARIOS } from './vai-competition-v3-frontier.mjs';
import { scoreV3Scenario } from './vai-competition-v3-scorer.mjs';

const bySuffix = (suffix) => V3_FRONTIER_SCENARIOS.find((scenario) => scenario.id.endsWith(suffix));

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => permutations(values.filter((_item, itemIndex) => itemIndex !== index)).map((rest) => [value, ...rest]));
}

test('every frontier reference passes the strict typed scorer before exposure', () => {
  const rows = V3_FRONTIER_SCENARIOS.map((scenario) => scoreV3Scenario(scenario, scenario.turns.map((turn) => turn.referenceAnswer)));
  assert.equal(V3_FRONTIER_SCENARIOS.length, 41);
  assert.equal(V3_FRONTIER_SCENARIOS.reduce((sum, scenario) => sum + scenario.turns.length, 0), 49);
  assert.deepEqual(rows.filter((row) => !row.passed), []);
});

test('independent enumeration validates unique position, coloring, and fixed-point oracles', () => {
  const orders = permutations(['A', 'B', 'C', 'D', 'E', 'F']).filter((order) => (
    order[0] === 'C'
    && order.indexOf('D') === order.indexOf('B') + 1
    && order.indexOf('A') === order.indexOf('E') + 1
    && order.indexOf('A') < order.indexOf('B')
    && order.indexOf('F') > order.indexOf('D')
  ));
  assert.deepEqual(orders, [['C', 'E', 'A', 'B', 'D', 'F']]);

  const palette = ['R', 'G', 'B'];
  const colorings = palette.flatMap((a) => palette.flatMap((b) => palette.flatMap((c) => palette.flatMap((d) => palette.map((e) => [a, b, c, d, e])))))
    .filter((colors) => colors[0] === 'R' && colors.every((color, index) => color !== colors[(index + 1) % colors.length]));
  assert.deepEqual(colorings[0], ['R', 'G', 'R', 'G', 'B']);

  const models = [];
  for (const A of [false, true]) for (const B of [false, true]) for (const C of [false, true]) {
    if (A === !B && B === C && C === (A !== B) && Number(A) + Number(B) + Number(C) === 2) models.push({ A, B, C });
  }
  assert.deepEqual(models, [{ A: false, B: true, C: true }]);
});

test('independent arithmetic validates causal, uncertainty, and composition references', () => {
  assert.equal((65 - 50) - (48 - 40), 7);
  assert.equal((9 / 10) > (80 / 100), true);
  assert.equal((30 / 100) > (2 / 10), true);
  assert.equal((39 / 110) < (82 / 110), true);
  assert.equal((1 / 9 * 4 * 9) / (1 + (1 / 9 * 4 * 9)), 0.8);
  assert.deepEqual([Math.max(0, 0.7 + 0.6 - 1), Math.min(0.7, 0.6)], [0.2999999999999998, 0.6]);
  const brier1 = ((0.9 - 1) ** 2 + (0.6 - 0) ** 2 + (0.2 - 0) ** 2) / 3;
  const brier2 = ((0.7 - 1) ** 2 + 0.3 ** 2 + 0.3 ** 2) / 3;
  assert.equal(Number(brier1.toFixed(4)), 0.1367);
  assert.equal(Number(brier2.toFixed(4)), 0.09);
  assert.equal(30 / (30 + 50) * 100, 37.5);
});

test('published RCPSP witness satisfies dependencies, durations, capacity, and makespan', () => {
  const scenario = bySuffix('planning-rcpsp');
  assert.ok(scenario);
  const value = scenario.turns[0].contract.value;
  const durations = { A: 4, B: 4, C: 3, D: 3, E: 5, F: 1 };
  const dependencies = { A: [], B: [], C: ['A'], D: ['A'], E: ['B'], F: ['C', 'D', 'E'] };
  for (const [task, [start, end]] of Object.entries(value.schedule)) {
    assert.equal(end - start, durations[task]);
    for (const dependency of dependencies[task]) assert.ok(start >= value.schedule[dependency][1]);
  }
  for (let time = 0; time < value.makespan; time += 0.5) {
    const active = Object.values(value.schedule).filter(([start, end]) => start <= time && time < end).length;
    assert.ok(active <= 2);
  }
  assert.equal(Math.max(...Object.values(value.schedule).map(([, end]) => end)), 11);
});
