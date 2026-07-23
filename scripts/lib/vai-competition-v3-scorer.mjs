const normalize = (value) => String(value ?? '').replace(/\r\n/g, '\n').trim();

function structuralEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structuralEqual(value, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && structuralEqual(left[key], right[key]));
  }
  return false;
}

function parseStrictJson(text) {
  let index = 0;
  const source = normalize(text);
  const skipWhitespace = () => { while (/\s/.test(source[index] ?? '')) index += 1; };
  const fail = (message) => { throw new Error(`${message} at ${index}`); };

  function parseString() {
    if (source[index] !== '"') fail('expected string');
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') { index += 2; continue; }
      if (source[index] === '"') {
        index += 1;
        return JSON.parse(source.slice(start, index));
      }
      index += 1;
    }
    fail('unterminated string');
  }

  function parseValue() {
    skipWhitespace();
    if (source[index] === '{') return parseObject();
    if (source[index] === '[') return parseArray();
    if (source[index] === '"') return parseString();
    for (const [literal, value] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(literal, index)) { index += literal.length; return value; }
    }
    const number = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) { index += number[0].length; return Number(number[0]); }
    fail('invalid value');
  }

  function parseObject() {
    index += 1;
    skipWhitespace();
    const value = {};
    const keys = new Set();
    if (source[index] === '}') { index += 1; return value; }
    while (index < source.length) {
      skipWhitespace();
      const key = parseString();
      if (keys.has(key)) fail(`duplicate key ${JSON.stringify(key)}`);
      keys.add(key);
      skipWhitespace();
      if (source[index] !== ':') fail('expected colon');
      index += 1;
      value[key] = parseValue();
      skipWhitespace();
      if (source[index] === '}') { index += 1; return value; }
      if (source[index] !== ',') fail('expected comma');
      index += 1;
    }
    fail('unterminated object');
  }

  function parseArray() {
    index += 1;
    skipWhitespace();
    const value = [];
    if (source[index] === ']') { index += 1; return value; }
    while (index < source.length) {
      value.push(parseValue());
      skipWhitespace();
      if (source[index] === ']') { index += 1; return value; }
      if (source[index] !== ',') fail('expected comma');
      index += 1;
    }
    fail('unterminated array');
  }

  try {
    const value = parseValue();
    skipWhitespace();
    if (index !== source.length) fail('trailing content');
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function scoreV3Answer(answer, contract) {
  const text = normalize(answer);
  if (contract.kind === 'exact') {
    const passed = text === normalize(contract.value);
    return {
      score: passed ? 1 : 0,
      passed,
      disposition: passed ? 'correct' : 'wrong',
      checks: [{ id: 'typed-exact', weight: 1, critical: true, passed, detail: passed ? 'exact value' : `expected ${JSON.stringify(contract.value)}` }],
      failedChecks: passed ? [] : ['typed-exact'],
      criticalFailures: passed ? [] : ['typed-exact'],
    };
  }
  if (contract.kind === 'number') {
    const parsed = Number(text);
    const tolerance = contract.tolerance ?? 0;
    const passed = Number.isFinite(parsed) && Math.abs(parsed - contract.value) <= tolerance;
    return {
      score: passed ? 1 : 0,
      passed,
      disposition: Number.isFinite(parsed) ? (passed ? 'correct' : 'wrong') : 'invalid-output',
      checks: [{ id: 'typed-number', weight: 1, critical: true, passed, detail: passed ? 'numeric value within tolerance' : `expected ${contract.value} ± ${tolerance}` }],
      failedChecks: passed ? [] : ['typed-number'],
      criticalFailures: passed ? [] : ['typed-number'],
    };
  }
  if (contract.kind === 'json') {
    const parsed = parseStrictJson(text);
    const allowed = contract.oneOf ?? [contract.value];
    const passed = parsed.ok && allowed.some((expected) => structuralEqual(parsed.value, expected));
    return {
      score: passed ? 1 : 0,
      passed,
      disposition: !parsed.ok ? 'invalid-output' : (passed ? 'correct' : 'wrong'),
      checks: [{
        id: 'typed-json', weight: 1, critical: true, passed,
        detail: !parsed.ok ? `invalid strict JSON: ${parsed.error}` : (passed ? 'semantic JSON value' : 'valid JSON with wrong semantic value'),
      }],
      failedChecks: passed ? [] : ['typed-json'],
      criticalFailures: passed ? [] : ['typed-json'],
    };
  }
  return {
    score: 0,
    passed: false,
    disposition: 'invalid-contract',
    checks: [{ id: 'typed-contract', weight: 1, critical: true, passed: false, detail: `unknown contract ${contract.kind}` }],
    failedChecks: ['typed-contract'],
    criticalFailures: ['typed-contract'],
  };
}

export function scoreV3Scenario(scenario, answers) {
  const turns = scenario.turns.map((turn, index) => ({
    turn: index + 1,
    prompt: turn.prompt,
    answer: answers[index] ?? '',
    ...scoreV3Answer(answers[index] ?? '', turn.contract),
  }));
  return {
    scenarioId: scenario.id,
    split: scenario.split,
    tier: scenario.tier,
    category: scenario.category,
    capability: scenario.capability,
    familyId: scenario.familyId,
    metamorphicGroup: scenario.metamorphicGroup ?? null,
    requiredRepresentations: scenario.requiredRepresentations ?? [],
    expectedRoute: scenario.expectedRoute,
    subjective: false,
    passed: turns.every((turn) => turn.passed),
    score: turns.length ? turns.reduce((sum, turn) => sum + turn.score, 0) / turns.length : 0,
    turns,
  };
}

export function runV3ScorerAttackBank() {
  const contract = { kind: 'json', value: { decision: false, count: 2 } };
  const attacks = {
    correct: '{"decision":false,"count":2}',
    wrongPolarity: '{"decision":true,"count":2}',
    extraKey: '{"decision":false,"count":2,"note":"looks right"}',
    duplicateKey: '{"decision":true,"decision":false,"count":2}',
    promptEcho: 'Return {"decision":false,"count":2}',
    malformed: '{"decision":false,"count":2,}',
  };
  const results = Object.fromEntries(Object.entries(attacks).map(([name, answer]) => [name, scoreV3Answer(answer, contract)]));
  const ordered = [attacks.correct, attacks.wrongPolarity].map((answer) => scoreV3Answer(answer, contract).score);
  const swapped = [attacks.wrongPolarity, attacks.correct].map((answer) => scoreV3Answer(answer, contract).score).reverse();
  return {
    passed: results.correct.passed
      && Object.entries(results).filter(([name]) => name !== 'correct').every(([, result]) => !result.passed)
      && structuralEqual(ordered, swapped),
    trueOrderSwapInvariant: structuralEqual(ordered, swapped),
    attacks: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, { passed: result.passed, disposition: result.disposition }])),
  };
}
