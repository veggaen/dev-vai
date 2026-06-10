import { randomBytes } from 'node:crypto';

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function randomFromSeed(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function integer(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function shuffled(random, values) {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

function marker(random, prefix, index) {
  return `${prefix}-${integer(random, 100, 999)}-${index + 1}`;
}

const PROMPT_OPENERS = [
  '',
  'Be precise. ',
  'Production control: ',
  'Lead-engineer check: ',
  'Audit prompt: ',
  'Use an operational answer. ',
];

function varyPrompt(random, prompt) {
  return `${pick(random, PROMPT_OPENERS)}${prompt}`;
}

function semanticGroups(...groups) {
  return {
    type: 'semantic-groups',
    groups: groups.map(([id, values]) => ({ id, values })),
  };
}

function buildRuntimeExposure(random, index) {
  const canary = marker(random, 'LANTERN', index);
  const safe = pick(random, [
    { value: '127.0.0.1', terms: ['127.0.0.1', 'loopback'] },
    { value: '::1', terms: ['::1', 'loopback'] },
  ]);
  const exposed = pick(random, [
    { value: '0.0.0.0', terms: ['0.0.0.0', 'all interfaces', 'network'] },
    { value: '::', terms: ['::', 'all interfaces', 'network'] },
  ]);
  const keyLabel = pick(random, ['API token', 'API key', 'access credential']);
  const jsonKeys = pick(random, [
    ['allow_startup', 'reason', 'required_change'],
    ['permit_boot', 'reason', 'required_fix'],
    ['startup_allowed', 'blocking_reason', 'next_action'],
  ]);
  const prompts = [
    `Control ${canary}: a local-first service binds to ${safe.value}. In exactly two bullets, state the safe default and the main exposure risk if an operator changes it to ${exposed.value}.`,
    `${canary} correction: the deployment request is now ${exposed.value}, and the ${keyLabel} is empty. Should startup continue? Answer no or yes first, then name the blocking control.`,
    `${canary} context switch ${index + 1}: explain idempotency in one sentence. Do not repeat the deployment decision yet.`,
    `Compress the corrected ${canary} decision into JSON only. Use exactly these keys: ${jsonKeys.join(', ')}. No Markdown.`,
  ];
  return {
    id: `generated-runtime-exposure-${index + 1}`,
    label: 'Generated runtime exposure and correction control',
    canary,
    dimensions: ['security-reasoning'],
    generated: { safeHost: safe.value, exposedHost: exposed.value, keyLabel, jsonKeys },
    turns: [
      {
        prompt: prompts[0],
        rubric: {
          id: 'runtime-safe-default',
          checks: [
            { type: 'min-chars', value: 45 },
            { type: 'max-words', value: 140 },
            semanticGroups(['safe-host', safe.terms], ['exposure-risk', exposed.terms]),
          ],
        },
      },
      {
        prompt: prompts[1],
        dimensions: ['correction-memory'],
        rubric: {
          id: 'runtime-refuse-unsafe-startup',
          checks: [
            { type: 'starts-with-any', values: ['no', 'should not', 'must not', 'refuse'] },
            semanticGroups(
              ['credential', ['credential', 'api key', 'api token', 'auth']],
              ['blocking-control', ['block', 'refuse', 'reject', 'stop', 'must not']],
            ),
          ],
        },
      },
      {
        prompt: prompts[2],
        dimensions: ['context-switching'],
        rubric: {
          id: 'runtime-distractor-answer',
          checks: [
            { type: 'max-words', value: 45 },
            semanticGroups(['idempotency', ['same', 'repeat', 'multiple', 'effect', 'once']]),
            { type: 'not-contains-any', values: [safe.value, exposed.value] },
          ],
        },
      },
      {
        prompt: prompts[3],
        dimensions: ['correction-memory', 'output-contract'],
        rubric: {
          id: 'runtime-json-contract',
          forbiddenStrategies: ['web-stack'],
          checks: [
            { type: 'json-object', keys: jsonKeys, expectedValues: { [jsonKeys[0]]: false } },
          ],
        },
      },
    ],
  };
}

function buildPathContainment(random, index) {
  const canary = marker(random, 'QUARTZ', index);
  const leaf = pick(random, ['uploads', 'workspace', 'tenant', 'project']);
  const suffix = integer(random, 10, 99);
  const windows = random() < 0.5;
  const root = windows ? `C:\\srv\\${leaf}-${suffix}` : `/srv/${leaf}-${suffix}`;
  const sibling = `${root}-cache`;
  const target = windows ? `${sibling}\\settings.json` : `${sibling}/settings.json`;
  return {
    id: `generated-path-containment-${index + 1}`,
    label: 'Generated sibling-prefix path containment review',
    canary,
    dimensions: ['security-code-review'],
    generated: { root, sibling, target },
    turns: [
      {
        prompt: `Audit ${canary}: review this Node guard before discussing style: const full = path.resolve(rootDir, requestedPath); if (!full.startsWith(rootDir)) throw new Error('blocked');. rootDir is ${root}. Show how ${target} defeats the prefix test, and name a safer Node primitive. Stay under 170 words.`,
        rubric: {
          id: 'path-sibling-prefix-review',
          forbiddenStrategies: ['error-diagnosis'],
          checks: [
            { type: 'max-words', value: 170 },
            semanticGroups(
              ['sibling-prefix', [sibling, 'sibling', 'prefix']],
              ['relative-primitive', ['path.relative', 'relative(', 'relative path']],
            ),
          ],
        },
      },
      {
        prompt: `${canary} follow-up: would path.resolve() alone prove containment? Start with no or yes, then give exactly two reasons.`,
        rubric: {
          id: 'path-resolve-alone',
          checks: [
            { type: 'starts-with-any', values: ['no'] },
            semanticGroups(['containment', ['contain', 'prefix', 'sibling', 'root']]),
          ],
        },
      },
    ],
  };
}

function buildConstraintMemory(random, index) {
  const canary = marker(random, 'EMBER', index);
  const language = pick(random, [
    { name: 'TypeScript', fences: ['ts', 'typescript'], forbidden: ['```js', '```javascript'] },
    { name: 'Python', fences: ['py', 'python'], forbidden: ['```js', '```javascript', '```ts'] },
    { name: 'Rust', fences: ['rust'], forbidden: ['```js', '```javascript', '```ts', '```python'] },
  ]);
  const task = pick(random, [
    {
      prompt: 'write a small helper that accepts a URL string and rejects non-http protocols',
      groups: [['url-protocol', ['url', 'http:', 'https:', 'protocol']]],
    },
    {
      prompt: 'write a helper that reads an environment string and returns a positive integer or an error',
      groups: [['integer-parse', ['parse', 'integer', 'number', 'error']]],
    },
    {
      prompt: 'write a helper that parses a JSON string and returns an object or an error',
      groups: [['json-parse', ['json', 'parse', 'error']]],
    },
  ]);
  const distractor = pick(random, [
    {
      prompt: 'Briefly explain why DNS rebinding matters for SSRF defenses. No code yet.',
      groups: [
        ['dns-resolution', ['dns', 'hostname', 'resolve']],
        ['private-address', ['private', 'internal', 'ip', 'address']],
      ],
    },
    {
      prompt: 'Explain idempotency in one sentence. No code yet.',
      groups: [['idempotency', ['same', 'repeat', 'multiple', 'effect', 'result']]],
    },
  ]);
  return {
    id: `generated-constraint-memory-${index + 1}`,
    label: 'Generated durable language constraint across a distractor',
    canary,
    dimensions: ['constraint-memory'],
    generated: { language: language.name, task: task.prompt, distractor: distractor.prompt },
    turns: [
      {
        prompt: `Instruction ${canary}: every code answer in this conversation must use ${language.name} only. Acknowledge the rule in one short sentence.`,
        rubric: {
          id: 'language-constraint-ack',
          checks: [
            { type: 'max-words', value: 35 },
            { type: 'contains-values', values: [language.name] },
          ],
        },
      },
      {
        prompt: `${canary} context switch ${index + 1}: ${distractor.prompt}`,
        dimensions: ['context-switching'],
        rubric: {
          id: 'constraint-distractor-answer',
          checks: [
            { type: 'max-words', value: 150 },
            { type: 'semantic-groups', groups: distractor.groups.map(([id, values]) => ({ id, values })) },
            { type: 'not-contains-any', values: language.forbidden },
          ],
        },
      },
      {
        prompt: `Return to ${canary}: ${task.prompt}. Keep the earlier language rule.`,
        dimensions: ['code-generation'],
        rubric: {
          id: 'language-constraint-code',
          forbiddenStrategies: ['factual-curated', 'web-stack'],
          checks: [
            { type: 'code-fence-language', values: language.fences },
            { type: 'semantic-groups', groups: task.groups.map(([id, values]) => ({ id, values })) },
            { type: 'not-contains-any', values: language.forbidden },
          ],
        },
      },
    ],
  };
}

function buildDecisionRecall(random, index) {
  const canary = marker(random, 'SUMMIT', index);
  const decision = pick(random, [
    {
      chosen: 'Postgres',
      alternate: 'SQLite',
      role: 'SQLite remains only for local test fixtures',
      roleTerms: ['fixture', 'local test', 'test'],
    },
    {
      chosen: 'S3',
      alternate: 'local disk',
      role: 'local disk remains only for test snapshots',
      roleTerms: ['snapshot', 'test', 'local'],
    },
    {
      chosen: 'Redis',
      alternate: 'in-memory Map',
      role: 'the in-memory Map remains only for unit-test fixtures',
      roleTerms: ['fixture', 'unit-test', 'test'],
    },
  ]);
  const distractor = pick(random, [
    {
      prompt: 'Distractor: explain idempotency in one sentence.',
      groups: [['idempotency', ['same', 'repeat', 'multiple', 'effect', 'result']]],
    },
    {
      prompt: 'Distractor: define cache invalidation in one sentence.',
      groups: [['cache-invalidation', ['cache', 'stale', 'refresh', 'invalidate']]],
    },
  ]);
  return {
    id: `generated-decision-recall-${index + 1}`,
    label: 'Generated committed-decision recall across a distractor',
    canary,
    dimensions: ['decision-memory'],
    generated: decision,
    turns: [
      {
        prompt: `Project note ${canary}: we considered ${decision.alternate} and ${decision.chosen}. Decision: use ${decision.chosen} for production; ${decision.role}. Acknowledge the committed choice briefly.`,
        rubric: {
          id: 'decision-ack',
          checks: [
            { type: 'max-words', value: 90 },
            { type: 'starts-with-any', values: ['we committed', 'committed'] },
            { type: 'contains-values', values: [decision.chosen, decision.alternate] },
            semanticGroups(['limited-role', decision.roleTerms]),
          ],
        },
      },
      {
        prompt: `${canary} context switch ${index + 1}: ${distractor.prompt}`,
        dimensions: ['context-switching'],
        rubric: {
          id: 'decision-distractor',
          checks: [
            { type: 'max-words', value: 75 },
            { type: 'semantic-groups', groups: distractor.groups.map(([id, values]) => ({ id, values })) },
            { type: 'not-contains-any', values: [decision.chosen, decision.alternate] },
          ],
        },
      },
      {
        prompt: `${canary} recall: which option did we commit to for production, and what limited role remains for the alternative?`,
        rubric: {
          id: 'decision-recall',
          checks: [
            { type: 'max-words', value: 100 },
            { type: 'contains-values', values: [decision.chosen, decision.alternate] },
            semanticGroups(['limited-role', decision.roleTerms]),
          ],
        },
      },
    ],
  };
}

function buildIncidentCalibration(random, index) {
  const canary = marker(random, 'MOSAIC', index);
  const incident = pick(random, [
    {
      symptoms: 'API latency doubled, process memory is climbing, and error rate is still flat',
      evidence: 'the memory increase is isolated to the API process, begins after traffic reaches the new version, and falls after rollback',
      groups: [
        ['memory', ['memory', 'leak', 'retain', 'allocation', 'heap']],
        ['deploy', ['deploy', 'rollback', 'new version', 'release']],
        ['verification', ['profile', 'heap', 'metric', 'verify', 'step']],
      ],
    },
    {
      symptoms: 'queue depth is rising, worker CPU is low, and request errors remain flat',
      evidence: 'the backlog begins on the new worker version, disappears after rollback, and is isolated to one consumer group',
      groups: [
        ['queue', ['queue', 'backlog', 'consumer', 'worker']],
        ['deploy', ['deploy', 'rollback', 'new version', 'release']],
        ['verification', ['metric', 'trace', 'profile', 'verify', 'step']],
      ],
    },
  ]);
  return {
    id: `generated-incident-calibration-${index + 1}`,
    label: 'Generated high-information incident clarification',
    canary,
    dimensions: ['incident-reasoning'],
    generated: incident,
    turns: [
      {
        prompt: `Production incident ${canary}: after a deploy, ${incident.symptoms}. Ask exactly one highest-information clarifying question and stop.`,
        dimensions: ['calibration'],
        rubric: {
          id: 'incident-one-question',
          checks: [
            { type: 'question-count', value: 1 },
            { type: 'max-words', value: 55 },
            { type: 'not-contains-any', values: ['1.', '2.', '3.', 'diagnosis:', 'fix:'] },
          ],
        },
      },
      {
        prompt: `${canary} answer: ${incident.evidence}. Give a ranked diagnosis and the first three verification steps.`,
        rubric: {
          id: 'incident-ranked-diagnosis',
          checks: [
            { type: 'min-chars', value: 100 },
            { type: 'semantic-groups', groups: incident.groups.map(([id, values]) => ({ id, values })) },
          ],
        },
      },
    ],
  };
}

function buildSystemsPrioritization(random, index) {
  const canary = marker(random, 'ORBIT', index);
  const lint = integer(random, 24, 96);
  const files = integer(random, 10, 42);
  const artifacts = integer(random, 20, 88);
  const oversized = integer(random, 2, 7);
  const routes = integer(random, 80, 190);
  return {
    id: `generated-systems-prioritization-${index + 1}`,
    label: 'Generated cluster-first engineering prioritization',
    canary,
    dimensions: ['systems-prioritization'],
    generated: { lint, files, artifacts, oversized, routes },
    turns: [
      {
        prompt: `Engineering audit ${canary}: the repo has ${lint} lint failures across ${files} files, ${artifacts} root scratch artifacts, ${oversized} authored modules above 5,000 lines, and ${routes} runtime routes. Propose a cluster-first order of operations and explain the first leverage point.`,
        rubric: {
          id: 'systems-priority-order',
          checks: [
            { type: 'contains-values', values: [String(lint), String(artifacts), String(routes)] },
            semanticGroups(
              ['oversized', ['5,000', '5000', 'oversized', 'module']],
              ['leverage', ['cluster', 'systemic', 'leverage', 'root cause', 'baseline']],
            ),
          ],
        },
      },
      {
        prompt: `${canary} follow-up: define one trend metric that proves the cleanup loop is reducing failures instead of moving them around.`,
        rubric: {
          id: 'systems-trend-metric',
          checks: [
            semanticGroups(
              ['metric', ['metric', 'measure', 'rate', 'count', 'trend']],
              ['failure', ['failure', 'regression', 'baseline', 'cluster']],
            ),
          ],
        },
      },
      {
        prompt: `${canary} follow-up: give one concrete threshold that should trigger architectural escalation instead of another local patch.`,
        rubric: {
          id: 'systems-escalation-threshold',
          checks: [
            semanticGroups(
              ['threshold', ['threshold', 'trigger', 'when', 'if']],
              ['architecture', ['architect', 'module', 'repeat', 'cluster', 'failure']],
            ),
          ],
        },
      },
    ],
  };
}

function buildConstraintCorrection(random, index) {
  const canary = marker(random, 'NOVA', index);
  const languages = [
    { name: 'TypeScript', fences: ['ts', 'typescript'], forbidden: ['```python', '```rust', '```go'] },
    { name: 'Python', fences: ['py', 'python'], forbidden: ['```ts', '```typescript', '```rust', '```go'] },
    { name: 'Rust', fences: ['rust'], forbidden: ['```ts', '```typescript', '```python', '```go'] },
    { name: 'Go', fences: ['go'], forbidden: ['```ts', '```typescript', '```python', '```rust'] },
  ];
  const first = pick(random, languages);
  const corrected = pick(random, languages.filter((language) => language.name !== first.name));
  const task = pick(random, [
    {
      prompt: 'write a helper that accepts a URL string and rejects non-http protocols',
      groups: [['url-protocol', ['url', 'http:', 'https:', 'protocol']]],
    },
    {
      prompt: 'write a helper that reads a string and returns a positive integer or an error',
      groups: [['integer-parse', ['parse', 'integer', 'number', 'error']]],
    },
    {
      prompt: 'write a helper that parses a JSON string and returns an object or an error',
      groups: [['json-parse', ['json', 'parse', 'error']]],
    },
  ]);
  const distractor = pick(random, [
    {
      prompt: 'define cache invalidation in one sentence. No code.',
      groups: [['cache-invalidation', ['cache', 'stale', 'refresh', 'invalidat']]],
    },
    {
      prompt: 'explain idempotency in one sentence. No code.',
      groups: [['idempotency', ['same', 'repeat', 'multiple', 'effect', 'result']]],
    },
    {
      prompt: 'explain backpressure in one sentence. No code.',
      groups: [['backpressure', ['slow', 'producer', 'consumer', 'queue']]],
    },
    {
      prompt: 'explain why DNS rebinding matters for SSRF defenses. No code.',
      groups: [
        ['dns-resolution', ['dns', 'hostname', 'resolve']],
        ['private-address', ['private', 'internal', 'ip', 'address']],
      ],
    },
  ]);
  return {
    id: `generated-constraint-correction-${index + 1}`,
    label: 'Generated superseded language constraint with delayed code task',
    canary,
    dimensions: ['constraint-memory', 'correction-memory'],
    generated: { firstLanguage: first.name, correctedLanguage: corrected.name, task: task.prompt },
    turns: [
      {
        prompt: `Instruction ${canary}: every code answer in this conversation must use ${first.name} only. Acknowledge the rule briefly.`,
        rubric: {
          id: 'language-initial-ack',
          checks: [
            { type: 'max-words', value: 35 },
            { type: 'contains-values', values: [first.name] },
          ],
        },
      },
      {
        prompt: `${canary} context switch ${index + 1}: ${distractor.prompt}`,
        dimensions: ['context-switching'],
        rubric: {
          id: 'language-correction-distractor',
          checks: [
            { type: 'max-words', value: 45 },
            semanticGroups(...distractor.groups),
          ],
        },
      },
      {
        prompt: `${canary} correction: every code answer must now use ${corrected.name} only, replacing ${first.name}. Acknowledge the updated rule briefly.`,
        rubric: {
          id: 'language-corrected-ack',
          checks: [
            { type: 'max-words', value: 40 },
            { type: 'contains-values', values: [corrected.name] },
          ],
        },
      },
      {
        prompt: `Return to ${canary}: ${task.prompt}. Keep the latest language rule.`,
        dimensions: ['code-generation'],
        rubric: {
          id: 'language-corrected-code',
          forbiddenStrategies: ['factual-curated', 'web-stack', 'error-diagnosis'],
          checks: [
            { type: 'code-fence-language', values: corrected.fences },
            { type: 'semantic-groups', groups: task.groups.map(([id, values]) => ({ id, values })) },
            { type: 'not-contains-any', values: corrected.forbidden },
          ],
        },
      },
    ],
  };
}

function buildDecisionCorrection(random, index) {
  const canary = marker(random, 'VECTOR', index);
  const decision = pick(random, [
    { first: 'SQLite', corrected: 'Postgres', role: 'local test fixtures', roleTerms: ['fixture', 'local test', 'test'] },
    { first: 'local disk', corrected: 'S3', role: 'test snapshots', roleTerms: ['snapshot', 'test'] },
    { first: 'in-memory Map', corrected: 'Redis', role: 'unit-test fixtures', roleTerms: ['fixture', 'unit-test', 'test'] },
  ]);
  return {
    id: `generated-decision-correction-${index + 1}`,
    label: 'Generated superseded production decision with delayed recall',
    canary,
    dimensions: ['decision-memory', 'correction-memory'],
    generated: decision,
    turns: [
      {
        prompt: `Project note ${canary}. Decision: use ${decision.first} for production; ${decision.corrected} remains only for migration evaluation. Acknowledge the committed choice.`,
        rubric: {
          id: 'decision-initial-ack',
          checks: [
            { type: 'starts-with-any', values: ['we committed', 'committed'] },
            { type: 'contains-values', values: [decision.first, decision.corrected] },
            semanticGroups(['limited-role', ['migration', 'evaluation']]),
          ],
        },
      },
      {
        prompt: `${canary} correction: use ${decision.corrected} for production instead; ${decision.first} remains only for ${decision.role}. Acknowledge the corrected choice.`,
        rubric: {
          id: 'decision-corrected-ack',
          checks: [
            { type: 'starts-with-any', values: ['we committed', 'committed'] },
            { type: 'contains-values', values: [decision.corrected, decision.first] },
            semanticGroups(['limited-role', decision.roleTerms]),
          ],
        },
      },
      {
        prompt: `${canary} context switch ${index + 1}: explain backpressure in one sentence.`,
        dimensions: ['context-switching'],
        rubric: {
          id: 'decision-correction-distractor',
          checks: [
            { type: 'max-words', value: 45 },
            semanticGroups(['backpressure', ['slow', 'producer', 'consumer', 'queue']]),
          ],
        },
      },
      {
        prompt: `${canary} recall: which option is now committed for production, and what limited role remains for the alternative?`,
        rubric: {
          id: 'decision-corrected-recall',
          checks: [
            { type: 'max-words', value: 100 },
            { type: 'contains-values', values: [decision.corrected, decision.first] },
            semanticGroups(['limited-role', decision.roleTerms]),
          ],
        },
      },
    ],
  };
}

const FACTORIES = [
  buildRuntimeExposure,
  buildPathContainment,
  buildConstraintMemory,
  buildDecisionRecall,
  buildIncidentCalibration,
  buildSystemsPrioritization,
  buildConstraintCorrection,
  buildDecisionCorrection,
];

export function randomAuditSeed() {
  return `generated-${randomBytes(8).toString('hex')}`;
}

export function buildGeneratedAuditWave(count, seed = randomAuditSeed()) {
  const random = randomFromSeed(seed);
  const factories = shuffled(random, FACTORIES);
  const scenarios = [];
  for (let index = 0; index < count; index += 1) {
    const factory = factories[index % factories.length];
    const scenario = factory(random, index);
    scenarios.push({
      ...scenario,
      turns: scenario.turns.map((turn) => ({
        ...turn,
        prompt: varyPrompt(random, turn.prompt),
      })),
    });
  }
  return {
    version: 2,
    description: 'Generated held-out multi-turn engineering audit wave with hidden deterministic rubrics.',
    generation: {
      mode: 'generated-held-out',
      seed,
      conversations: scenarios.length,
      turns: scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0),
      families: new Set(scenarios.map((scenario) => scenario.id.replace(/-\d+$/, ''))).size,
    },
    scenarios,
  };
}
