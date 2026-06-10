import { randomFromSeed } from './vai-generated-audit-wave.mjs';

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

function semanticGroups(...groups) {
  return {
    type: 'semantic-groups',
    groups: groups.map(([id, values]) => ({ id, values })),
  };
}

const OPENERS = ['', 'hey - ', 'quick q: ', 'sorry for the messy wording: ', 'one sec, '];

function casual(random, prompt) {
  return `${pick(random, OPENERS)}${prompt}`;
}

const LANGUAGES = [
  { name: 'TypeScript', fences: ['ts', 'typescript'], forbidden: ['```python', '```rust', '```go'] },
  { name: 'Python', fences: ['py', 'python'], forbidden: ['```ts', '```typescript', '```rust', '```go'] },
  { name: 'Rust', fences: ['rust'], forbidden: ['```ts', '```typescript', '```python', '```go'] },
  { name: 'Go', fences: ['go'], forbidden: ['```ts', '```typescript', '```python', '```rust'] },
];

function buildIndirectCodePreference(random, index) {
  const canary = marker(random, 'THREAD', index);
  const first = pick(random, LANGUAGES);
  const corrected = pick(random, LANGUAGES.filter((language) => language.name !== first.name));
  return {
    id: `holdout-indirect-code-preference-${index + 1}`,
    label: 'Indirect code preference with conversational supersession',
    canary,
    dimensions: ['holdout', 'constraint-memory', 'correction-memory', 'paraphrase'],
    generated: { first: first.name, corrected: corrected.name },
    turns: [
      {
        prompt: casual(random, `${canary}: anything code-ish u send me needs to be ${first.name}. dont forget that. tell me you understand.`),
        rubric: {
          id: 'holdout-indirect-code-ack',
          checks: [{ type: 'contains-values', values: [first.name] }],
        },
      },
      {
        prompt: casual(random, `${canary}: change of plan - drop ${first.name}. future examples need ${corrected.name}. got it?`),
        rubric: {
          id: 'holdout-indirect-code-correction',
          checks: [{ type: 'contains-values', values: [corrected.name] }],
        },
      },
      {
        prompt: casual(random, `${canary}: make a parser for a stringified JSON object; arrays should error. stick to my updated preference.`),
        rubric: {
          id: 'holdout-indirect-code-output',
          checks: [
            { type: 'code-fence-language', values: corrected.fences },
            semanticGroups(['json-object', ['json', 'parse', 'object', 'array', 'error']]),
            { type: 'not-contains-any', values: corrected.forbidden },
          ],
        },
      },
    ],
  };
}

function buildGoLiveExposure(random, index) {
  const canary = marker(random, 'GATE', index);
  const safe = pick(random, ['127.0.0.1', '::1']);
  const exposed = pick(random, ['0.0.0.0', '::']);
  const keys = pick(random, [
    ['launch_ok', 'concern', 'repair'],
    ['go_live', 'hazard', 'safeguard'],
  ]);
  return {
    id: `holdout-go-live-exposure-${index + 1}`,
    label: 'Runtime exposure expressed with go-live and login-secret vocabulary',
    canary,
    dimensions: ['holdout', 'security-reasoning', 'output-contract', 'paraphrase'],
    generated: { safe, exposed, keys },
    turns: [
      {
        prompt: casual(random, `${canary}: service is private on ${safe}; someone proposes ${exposed}. in 2 bullets, what changes from a security standpoint?`),
        rubric: {
          id: 'holdout-go-live-review',
          checks: [
            semanticGroups(['safe', [safe, 'loopback']], ['exposure', [exposed, 'network', 'interface', 'expos']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: the login secret is absent. okay to go live on ${exposed}? yes or no first, then why.`),
        rubric: {
          id: 'holdout-go-live-block',
          checks: [
            { type: 'starts-with-any', values: ['no', 'should not', 'must not', 'refuse'] },
            semanticGroups(['auth', ['auth', 'secret', 'credential', 'token']], ['block', ['block', 'stop', 'refuse', 'reject', 'must not']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: reply only with a JSON dictionary. properties: ${keys.join(', ')}.`),
        rubric: {
          id: 'holdout-go-live-json',
          checks: [{ type: 'json-object', keys, expectedValues: { [keys[0]]: false } }],
        },
      },
    ],
  };
}

function buildLiveEnvironmentDecision(random, index) {
  const canary = marker(random, 'LAND', index);
  const decision = pick(random, [
    { first: 'SQLite', corrected: 'Postgres', role: 'local demos', terms: ['local', 'demo'] },
    { first: 'local disk', corrected: 'S3', role: 'snapshot tests', terms: ['snapshot', 'test'] },
    { first: 'in-memory Map', corrected: 'Redis', role: 'unit tests', terms: ['unit', 'test'] },
  ]);
  return {
    id: `holdout-live-environment-decision-${index + 1}`,
    label: 'Decision memory using live-environment vocabulary',
    canary,
    dimensions: ['holdout', 'decision-memory', 'correction-memory', 'paraphrase'],
    generated: decision,
    turns: [
      {
        prompt: casual(random, `${canary}: take ${decision.first} to the live environment. ${decision.corrected} is migration-evaluation only. reflect that back.`),
        rubric: {
          id: 'holdout-live-decision-initial',
          checks: [
            { type: 'contains-values', values: [decision.first, decision.corrected] },
            semanticGroups(['live', ['live', 'production', 'prod']], ['migration', ['migration', 'evaluat']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: scratch that. live uses ${decision.corrected} now and ${decision.first} belongs only in ${decision.role}.`),
        rubric: {
          id: 'holdout-live-decision-corrected',
          checks: [
            { type: 'contains-values', values: [decision.corrected, decision.first] },
            semanticGroups(['live', ['live', 'production', 'prod']], ['limited-role', decision.terms]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: remind me what runs live and where the retired choice is still allowed.`),
        rubric: {
          id: 'holdout-live-decision-recall',
          checks: [
            { type: 'contains-values', values: [decision.corrected, decision.first] },
            semanticGroups(['limited-role', decision.terms]),
          ],
        },
      },
    ],
  };
}

function buildAbsolutePathQuestion(random, index) {
  const canary = marker(random, 'BASE', index);
  const leaf = pick(random, ['jobs', 'uploads', 'tenant']);
  const root = `/srv/${leaf}-${integer(random, 10, 99)}`;
  const sibling = `${root}-old`;
  return {
    id: `holdout-absolute-path-${index + 1}`,
    label: 'Containment question without canonical path.resolve snippet',
    canary,
    dimensions: ['holdout', 'security-code-review', 'paraphrase'],
    generated: { root, sibling },
    turns: [
      {
        prompt: casual(random, `${canary}: base is ${root}. if i convert a requested file to an absolute path and only test that it begins with the base string, could ${sibling}/config.json escape the folder? suggest the safer node check.`),
        rubric: {
          id: 'holdout-absolute-path-review',
          checks: [
            { type: 'contains-values', values: [`${sibling}/config.json`] },
            semanticGroups(['containment', ['contain', 'prefix', 'sibling', 'outside', 'escape']], ['relative', ['path.relative', 'relative path', 'relative(']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: so making it absolute is not enough to establish containment, right?`),
        rubric: {
          id: 'holdout-absolute-path-followup',
          checks: [
            { type: 'starts-with-any', values: ['no', 'correct', 'right'] },
            semanticGroups(['containment', ['contain', 'inside', 'outside', 'root', 'base']]),
          ],
        },
      },
    ],
  };
}

function buildDatabaseIncident(random, index) {
  const canary = marker(random, 'POOL', index);
  return {
    id: `holdout-database-incident-${index + 1}`,
    label: 'Database pool incident with conversational calibration request',
    canary,
    dimensions: ['holdout', 'incident-reasoning', 'calibration', 'paraphrase'],
    generated: null,
    turns: [
      {
        prompt: casual(random, `${canary}: after release, connections pile up, pool wait spikes, p95 rises, but errors stay low. what would u ask first before diagnosing? ask one question.`),
        rubric: {
          id: 'holdout-database-question',
          checks: [
            { type: 'question-count', value: 1 },
            semanticGroups(['database', ['pool', 'query', 'database', 'connection']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: pool wait started with the new query path and vanished after rollback. walk me through the top suspect and three checks.`),
        rubric: {
          id: 'holdout-database-diagnosis',
          checks: [
            { type: 'min-chars', value: 100 },
            semanticGroups(['database', ['pool', 'query', 'database', 'connection']], ['rollback', ['rollback', 'release', 'version']], ['verification', ['check', 'trace', 'metric', 'inspect']]),
          ],
        },
      },
    ],
  };
}

function buildPersonalRecall(random, index) {
  const canary = marker(random, 'HELLO', index);
  const name = pick(random, ['Lise', 'Maren', 'Jonas', 'Aksel']);
  const work = pick(random, ['payments', 'search relevance', 'release tooling', 'support workflows']);
  return {
    id: `holdout-personal-recall-${index + 1}`,
    label: 'Casual lowercase personal-context recall',
    canary,
    dimensions: ['holdout', 'ordinary-conversation', 'typo-tolerance', 'memory'],
    generated: { name, work },
    turns: [
      {
        prompt: casual(random, `${canary}: hey im ${name}. i work on ${work}. keep that in mind pls.`),
        rubric: {
          id: 'holdout-personal-introduction',
          checks: [{ type: 'max-words', value: 100 }],
        },
      },
      {
        prompt: casual(random, `${canary}: btw what was my name again?`),
        rubric: {
          id: 'holdout-personal-name-recall',
          checks: [{ type: 'contains-values', values: [name] }],
        },
      },
    ],
  };
}

function buildProjectSwitch(random, index) {
  const canary = marker(random, 'DUO', index);
  return {
    id: `holdout-project-switch-${index + 1}`,
    label: 'Two-project context switch with code-language association',
    canary,
    dimensions: ['holdout', 'multi-intent', 'project-memory', 'paraphrase'],
    generated: null,
    turns: [
      {
        prompt: casual(random, `${canary}: im juggling Cedar and Quartz. Cedar examples are Rust; Quartz examples are Python. when i name a project later, keep its language straight.`),
        rubric: {
          id: 'holdout-project-switch-ack',
          checks: [{ type: 'contains-values', values: ['Cedar', 'Quartz', 'Rust', 'Python'] }],
        },
      },
      {
        prompt: casual(random, `${canary}: for Quartz, make a JSON object parser that rejects arrays.`),
        rubric: {
          id: 'holdout-project-switch-code',
          checks: [
            { type: 'code-fence-language', values: ['py', 'python'] },
            semanticGroups(['json-object', ['json', 'object', 'array', 'parse', 'error']]),
          ],
        },
      },
    ],
  };
}

function buildAmbiguousDeploy(random, index) {
  const canary = marker(random, 'FOG', index);
  return {
    id: `holdout-ambiguous-deploy-${index + 1}`,
    label: 'Ambiguous deploy request should elicit grounded clarification',
    canary,
    dimensions: ['holdout', 'ordinary-conversation', 'ambiguity', 'calibration'],
    generated: null,
    turns: [
      {
        prompt: casual(random, `${canary}: i need help with the deploy thing. it got worse after the change. what should i do?`),
        rubric: {
          id: 'holdout-ambiguous-deploy-question',
          checks: [
            { type: 'min-question-count', value: 1 },
            semanticGroups(['clarification', ['deploy', 'change', 'rollback', 'symptom', 'metric', 'error', 'latency', 'version']]),
          ],
        },
      },
    ],
  };
}

const FACTORIES = [
  buildIndirectCodePreference,
  buildGoLiveExposure,
  buildLiveEnvironmentDecision,
  buildAbsolutePathQuestion,
  buildDatabaseIncident,
  buildPersonalRecall,
  buildProjectSwitch,
  buildAmbiguousDeploy,
];

export function buildNovelHoldoutWave(count, seed) {
  const random = randomFromSeed(seed);
  const factories = shuffled(random, FACTORIES);
  const scenarios = [];
  for (let index = 0; index < count; index += 1) {
    const factory = factories[index % factories.length];
    scenarios.push(factory(random, index));
  }
  return {
    version: 4,
    description: 'Locked novel holdout wave with vocabulary and meanings not used to tune the structured conversation parser.',
    generation: {
      mode: 'novel-locked-holdout',
      seed,
      conversations: scenarios.length,
      turns: scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0),
      families: new Set(scenarios.map((scenario) => scenario.id.replace(/-\d+$/, ''))).size,
    },
    scenarios,
  };
}
