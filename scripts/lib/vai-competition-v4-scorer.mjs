import { scoreV3Answer } from './vai-competition-v3-scorer.mjs';

const normalize = (value) => String(value ?? '').replace(/\r\n/g, '\n').trim();

function parseStrictJson(text) {
  const source = normalize(text);
  let index = 0;
  const skip = () => { while (/\s/.test(source[index] ?? '')) index += 1; };
  const fail = (message) => { throw new Error(`${message} at ${index}`); };
  const string = () => {
    if (source[index] !== '"') fail('expected string');
    const start = index++;
    while (index < source.length) {
      if (source[index] === '\\') { index += 2; continue; }
      if (source[index++] === '"') return JSON.parse(source.slice(start, index));
    }
    fail('unterminated string');
  };
  const value = () => {
    skip();
    if (source[index] === '{') return object();
    if (source[index] === '[') return array();
    if (source[index] === '"') return string();
    for (const [literal, parsed] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(literal, index)) { index += literal.length; return parsed; }
    }
    const numeric = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!numeric) fail('invalid value');
    index += numeric[0].length;
    return Number(numeric[0]);
  };
  const object = () => {
    index += 1; skip();
    const output = {}; const keys = new Set();
    if (source[index] === '}') { index += 1; return output; }
    while (index < source.length) {
      skip(); const key = string();
      if (keys.has(key)) fail(`duplicate key ${key}`);
      keys.add(key); skip();
      if (source[index++] !== ':') fail('expected colon');
      output[key] = value(); skip();
      if (source[index] === '}') { index += 1; return output; }
      if (source[index++] !== ',') fail('expected comma');
    }
    fail('unterminated object');
  };
  const array = () => {
    index += 1; skip();
    const output = [];
    if (source[index] === ']') { index += 1; return output; }
    while (index < source.length) {
      output.push(value()); skip();
      if (source[index] === ']') { index += 1; return output; }
      if (source[index++] !== ',') fail('expected comma');
    }
    fail('unterminated array');
  };
  try {
    const parsed = value(); skip();
    if (index !== source.length) fail('trailing content');
    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function validateSchedule(value, contract) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'root must be an object';
  if (Object.keys(value).sort().join(',') !== 'makespan,schedule') return 'expected only makespan and schedule';
  if (value.makespan !== contract.optimalMakespan || !value.schedule || typeof value.schedule !== 'object' || Array.isArray(value.schedule)) return 'wrong makespan or schedule shape';
  const taskIds = contract.tasks.map((task) => task.id);
  if (Object.keys(value.schedule).sort().join(',') !== [...taskIds].sort().join(',')) return 'schedule task set mismatch';
  const intervals = new Map();
  for (const task of contract.tasks) {
    const slot = value.schedule[task.id];
    if (!Array.isArray(slot) || slot.length !== 2 || !slot.every(Number.isInteger)) return `invalid slot for ${task.id}`;
    const [start, end] = slot;
    if (start < 0 || end - start !== task.duration) return `duration mismatch for ${task.id}`;
    intervals.set(task.id, { start, end });
  }
  for (const task of contract.tasks) {
    const slot = intervals.get(task.id);
    if (task.predecessors.some((id) => intervals.get(id).end > slot.start)) return `precedence violation for ${task.id}`;
  }
  for (let time = 0; time < value.makespan; time += 1) {
    const active = [...intervals.values()].filter((slot) => slot.start <= time && time < slot.end).length;
    if (active > contract.capacity) return `capacity violation at ${time}`;
  }
  if (Math.max(...[...intervals.values()].map((slot) => slot.end)) !== value.makespan) return 'reported makespan does not match schedule';
  return null;
}

export function scoreV4Answer(answer, contract) {
  if (contract.kind !== 'validated-schedule') return scoreV3Answer(answer, contract);
  const parsed = parseStrictJson(answer);
  const error = parsed.ok ? validateSchedule(parsed.value, contract) : `invalid strict JSON: ${parsed.error}`;
  const passed = !error;
  return {
    score: passed ? 1 : 0,
    passed,
    disposition: !parsed.ok ? 'invalid-output' : passed ? 'correct' : 'wrong',
    checks: [{ id: 'schedule-certificate', weight: 1, critical: true, passed, detail: passed ? 'feasible independently verified optimal schedule' : error }],
    failedChecks: passed ? [] : ['schedule-certificate'],
    criticalFailures: passed ? [] : ['schedule-certificate'],
  };
}

export function scoreV4Scenario(scenario, answers) {
  const turns = scenario.turns.map((turn, index) => ({ turn: index + 1, prompt: turn.prompt, answer: answers[index] ?? '', ...scoreV4Answer(answers[index] ?? '', turn.contract) }));
  return {
    scenarioId: scenario.id, split: scenario.split, tier: scenario.tier, category: scenario.category,
    capability: scenario.capability, familyId: scenario.familyId, metamorphicGroup: scenario.metamorphicGroup,
    requiredRepresentations: scenario.requiredRepresentations, expectedRoute: scenario.expectedRoute, subjective: false,
    passed: turns.every((turn) => turn.passed),
    score: turns.length ? turns.reduce((sum, turn) => sum + turn.score, 0) / turns.length : 0,
    turns,
  };
}

export function runV4ScorerAttackBank() {
  const contract = {
    kind: 'validated-schedule', capacity: 1, optimalMakespan: 3,
    tasks: [{ id: 'A', duration: 2, predecessors: [] }, { id: 'B', duration: 1, predecessors: ['A'] }],
  };
  const answers = {
    correct: '{"makespan":3,"schedule":{"A":[0,2],"B":[2,3]}}',
    overlap: '{"makespan":3,"schedule":{"A":[0,2],"B":[1,2]}}',
    wrongDuration: '{"makespan":3,"schedule":{"A":[0,1],"B":[2,3]}}',
    extraKey: '{"makespan":3,"schedule":{"A":[0,2],"B":[2,3]},"note":"ok"}',
    duplicate: '{"makespan":4,"makespan":3,"schedule":{"A":[0,2],"B":[2,3]}}',
  };
  const results = Object.fromEntries(Object.entries(answers).map(([name, answer]) => [name, scoreV4Answer(answer, contract)]));
  return { passed: results.correct.passed && Object.entries(results).filter(([name]) => name !== 'correct').every(([, value]) => !value.passed), attacks: results };
}
