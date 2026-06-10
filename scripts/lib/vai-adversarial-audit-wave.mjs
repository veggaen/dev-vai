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

const CASUAL_OPENERS = [
  '',
  'quick one: ',
  'hey, ',
  'small thing - ',
  'pls be practical: ',
  'i might be wording this badly, but ',
];

function casual(random, prompt) {
  return `${pick(random, CASUAL_OPENERS)}${prompt}`;
}

const LANGUAGES = [
  { name: 'TypeScript', fences: ['ts', 'typescript'], forbidden: ['```python', '```rust', '```go'] },
  { name: 'Python', fences: ['py', 'python'], forbidden: ['```ts', '```typescript', '```rust', '```go'] },
  { name: 'Rust', fences: ['rust'], forbidden: ['```ts', '```typescript', '```python', '```go'] },
  { name: 'Go', fences: ['go'], forbidden: ['```ts', '```typescript', '```python', '```rust'] },
];

function buildCasualConstraintCorrection(random, index) {
  const canary = marker(random, 'TULIP', index);
  const first = pick(random, LANGUAGES);
  const corrected = pick(random, LANGUAGES.filter((language) => language.name !== first.name));
  return {
    id: `adversarial-casual-constraint-${index + 1}`,
    label: 'Casual typo-tolerant language correction and delayed code request',
    canary,
    dimensions: ['constraint-memory', 'correction-memory', 'typo-tolerance', 'paraphrase'],
    generated: { firstLanguage: first.name, correctedLanguage: corrected.name },
    turns: [
      {
        prompt: casual(random, `${canary}: from now on if i ask for code pls keep the snippets in ${first.name}. just say u got it.`),
        rubric: {
          id: 'casual-language-rule-ack',
          checks: [
            { type: 'max-words', value: 45 },
            { type: 'contains-values', values: [first.name] },
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: tiny detour - whats idempotency? one sentence is enough.`),
        dimensions: ['context-switching', 'typo-tolerance'],
        rubric: {
          id: 'casual-idempotency-detour',
          checks: [
            { type: 'max-words', value: 55 },
            semanticGroups(['idempotency', ['same', 'repeat', 'multiple', 'effect', 'once', 'result']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: small update, use ${corrected.name} for code from here on, not ${first.name}. pls confirm.`),
        rubric: {
          id: 'casual-language-correction-ack',
          checks: [
            { type: 'max-words', value: 50 },
            { type: 'contains-values', values: [corrected.name] },
          ],
        },
      },
      {
        prompt: casual(random, `back to ${canary}. could u make a validator that turns text into a positive whole number and errors when it isnt above zero? use my newest rule.`),
        dimensions: ['code-generation', 'paraphrase'],
        rubric: {
          id: 'casual-corrected-language-code',
          forbiddenStrategies: ['factual-curated', 'web-stack', 'error-diagnosis'],
          checks: [
            { type: 'code-fence-language', values: corrected.fences },
            semanticGroups(['positive-number', ['parse', 'integer', 'number', 'error', 'above zero', '> 0', '<= 0']]),
            { type: 'not-contains-any', values: corrected.forbidden },
          ],
        },
      },
    ],
  };
}

function buildRephrasedExposure(random, index) {
  const canary = marker(random, 'HARBOR', index);
  const safe = pick(random, ['127.0.0.1', '::1']);
  const exposed = pick(random, ['0.0.0.0', '::']);
  const keys = pick(random, [
    ['may_start', 'blocker', 'remedy'],
    ['ok_to_boot', 'why_blocked', 'next_step'],
    ['continue_launch', 'risk', 'mitigation'],
  ]);
  return {
    id: `adversarial-rephrased-exposure-${index + 1}`,
    label: 'Rephrased multi-turn runtime exposure with casual JSON contract',
    canary,
    dimensions: ['security-reasoning', 'paraphrase', 'output-contract'],
    generated: { safe, exposed, keys },
    turns: [
      {
        prompt: casual(random, `${canary}: its listening on ${safe} today. ops wants ${exposed}. compare the local safety with the wider exposure in 2 bullets.`),
        rubric: {
          id: 'rephrased-exposure-review',
          checks: [
            { type: 'max-words', value: 150 },
            semanticGroups(['safe-host', [safe, 'loopback']], ['exposed-host', [exposed, 'network', 'interface', 'expos']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: now assume the auth token wasnt configured. can we bring it up on ${exposed}? lead with yes or no and tell me whats stopping us.`),
        dimensions: ['typo-tolerance'],
        rubric: {
          id: 'rephrased-exposure-block',
          checks: [
            { type: 'starts-with-any', values: ['no', 'should not', 'must not', 'refuse'] },
            semanticGroups(['credential', ['credential', 'token', 'auth']], ['block', ['block', 'refuse', 'reject', 'stop', 'must not']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: say that last call again as a bare JSON object, no fences. fields are ${keys.join(', ')}.`),
        rubric: {
          id: 'rephrased-exposure-json',
          checks: [
            { type: 'json-object', keys, expectedValues: { [keys[0]]: false } },
          ],
        },
      },
    ],
  };
}

function buildSemanticDecisionCorrection(random, index) {
  const canary = marker(random, 'CEDAR', index);
  const decision = pick(random, [
    { first: 'local disk', corrected: 'S3', role: 'test snapshots', roleTerms: ['snapshot', 'test'] },
    { first: 'SQLite', corrected: 'Postgres', role: 'local fixtures', roleTerms: ['fixture', 'local'] },
    { first: 'in-memory Map', corrected: 'Redis', role: 'unit tests', roleTerms: ['unit', 'test'] },
  ]);
  return {
    id: `adversarial-semantic-decision-${index + 1}`,
    label: 'Natural decision correction with delayed colloquial recall',
    canary,
    dimensions: ['decision-memory', 'correction-memory', 'paraphrase'],
    generated: decision,
    turns: [
      {
        prompt: casual(random, `${canary}: lets ship ${decision.first} in prod. keep ${decision.corrected} around only while we evaluate the migration. confirm where we landed.`),
        rubric: {
          id: 'semantic-decision-initial',
          checks: [
            { type: 'contains-values', values: [decision.first, decision.corrected] },
            semanticGroups(['production', ['prod', 'production']], ['evaluation', ['evaluat', 'migration']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: actually reverse that. prod should run on ${decision.corrected}; ${decision.first} is just for ${decision.role}. confirm the new landing point.`),
        rubric: {
          id: 'semantic-decision-correction',
          checks: [
            { type: 'contains-values', values: [decision.corrected, decision.first] },
            semanticGroups(['production', ['prod', 'production']], ['limited-role', decision.roleTerms]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: unrelated for a sec - whats back pressure in a worker queue? one line.`),
        dimensions: ['context-switching', 'typo-tolerance'],
        rubric: {
          id: 'semantic-decision-detour',
          checks: [
            { type: 'max-words', value: 55 },
            semanticGroups(['backpressure', ['slow', 'producer', 'consumer', 'queue', 'load']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: where did we land for prod, and whats the old options only remaining job?`),
        rubric: {
          id: 'semantic-decision-recall',
          checks: [
            { type: 'contains-values', values: [decision.corrected, decision.first] },
            semanticGroups(['limited-role', decision.roleTerms]),
          ],
        },
      },
    ],
  };
}

function buildNaturalIncident(random, index) {
  const canary = marker(random, 'SIGNAL', index);
  const incident = pick(random, [
    {
      symptoms: 'p95 doubled after the rollout, rss keeps climbing, and errors look normal',
      evidence: 'it starts only when the new build gets traffic, stays inside the API process, and settles after rollback',
      groups: [
        ['memory', ['memory', 'rss', 'heap', 'leak', 'retain', 'allocation']],
        ['deploy', ['deploy', 'rollout', 'rollback', 'version', 'release']],
        ['verification', ['profile', 'heap', 'metric', 'trace', 'check']],
      ],
    },
    {
      symptoms: 'the backlog grows after rollout, worker cpu stays low, and request failures are flat',
      evidence: 'it starts with the new consumer build, clears after rollback, and only one consumer group is affected',
      groups: [
        ['queue', ['queue', 'backlog', 'consumer', 'worker']],
        ['deploy', ['deploy', 'rollout', 'rollback', 'version', 'release']],
        ['verification', ['metric', 'trace', 'profile', 'check']],
      ],
    },
  ]);
  return {
    id: `adversarial-natural-incident-${index + 1}`,
    label: 'Natural-language incident calibration and diagnosis',
    canary,
    dimensions: ['incident-reasoning', 'paraphrase', 'calibration'],
    generated: incident,
    turns: [
      {
        prompt: casual(random, `${canary}: ${incident.symptoms}. before diagnosing, ask the single question that would cut uncertainty the most.`),
        rubric: {
          id: 'natural-incident-question',
          checks: [
            { type: 'question-count', value: 1 },
            { type: 'max-words', value: 60 },
            { type: 'not-contains-any', values: ['1.', '2.', '3.', 'diagnosis:', 'fix:'] },
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: ${incident.evidence}. rank the likely cause and list 3 checks in order.`),
        rubric: {
          id: 'natural-incident-diagnosis',
          checks: [
            { type: 'min-chars', value: 100 },
            { type: 'semantic-groups', groups: incident.groups.map(([id, values]) => ({ id, values })) },
          ],
        },
      },
    ],
  };
}

function buildReorderedSystemsAudit(random, index) {
  const canary = marker(random, 'ATLAS', index);
  const lint = integer(random, 24, 96);
  const files = integer(random, 10, 42);
  const artifacts = integer(random, 20, 88);
  const oversized = integer(random, 2, 7);
  const routes = integer(random, 80, 190);
  return {
    id: `adversarial-reordered-systems-${index + 1}`,
    label: 'Reordered systems inventory and colloquial follow-ups',
    canary,
    dimensions: ['systems-prioritization', 'paraphrase'],
    generated: { lint, files, artifacts, oversized, routes },
    turns: [
      {
        prompt: casual(random, `${canary}: routes=${routes}; root has ${artifacts} scratch files; ${lint} lint issues touch ${files} files; and ${oversized} authored files are over 5000 LOC. prioritize shared causes, not one-off fixes.`),
        rubric: {
          id: 'reordered-systems-priority',
          checks: [
            { type: 'contains-values', values: [String(lint), String(artifacts), String(routes)] },
            semanticGroups(['oversized', ['5000', '5,000', 'oversized', 'module', 'file']], ['shared-cause', ['cluster', 'systemic', 'shared', 'baseline', 'root cause']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: what one number should we trend to prove failures are disappearing instead of getting shuffled around?`),
        rubric: {
          id: 'reordered-systems-metric',
          checks: [
            semanticGroups(['metric', ['metric', 'measure', 'count', 'trend', 'rate']], ['failure', ['failure', 'regression', 'baseline', 'cluster']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: when do we stop patching locally and call for an architecture change? give me a concrete tripwire.`),
        rubric: {
          id: 'reordered-systems-threshold',
          checks: [
            semanticGroups(['threshold', ['threshold', 'trigger', 'when', 'if', 'third', 'tripwire']], ['architecture', ['architect', 'module', 'repeat', 'cluster', 'failure']]),
          ],
        },
      },
    ],
  };
}

function buildParaphrasedPathReview(random, index) {
  const canary = marker(random, 'ROOT', index);
  const leaf = pick(random, ['jobs', 'tenant', 'uploads', 'workspace']);
  const suffix = integer(random, 10, 99);
  const windows = random() < 0.5;
  const root = windows ? `C:\\srv\\${leaf}-${suffix}` : `/srv/${leaf}-${suffix}`;
  const sibling = `${root}-cache`;
  const target = windows ? `${sibling}\\settings.json` : `${sibling}/settings.json`;
  return {
    id: `adversarial-paraphrased-path-${index + 1}`,
    label: 'Paraphrased sibling-prefix path review',
    canary,
    dimensions: ['security-code-review', 'paraphrase'],
    generated: { root, sibling, target },
    turns: [
      {
        prompt: casual(random, `${canary}: rootDir = ${root}. code is const full = path.resolve(rootDir, requested); if (!full.startsWith(rootDir)) throw Error('blocked'). can ${target} slip through? explain the bug and safer node check.`),
        rubric: {
          id: 'paraphrased-path-review',
          checks: [
            { type: 'max-words', value: 190 },
            { type: 'contains-values', values: [target] },
            semanticGroups(['sibling-prefix', ['sibling', 'prefix', sibling]], ['relative-primitive', ['path.relative', 'relative(', 'relative path']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: does normalizing with path.resolve by itself mean the result stayed below the root? lead with yes or no, then explain twice.`),
        rubric: {
          id: 'paraphrased-path-followup',
          checks: [
            { type: 'starts-with-any', values: ['no'] },
            semanticGroups(['containment', ['contain', 'prefix', 'sibling', 'root', 'relative']]),
          ],
        },
      },
    ],
  };
}

function buildCombinedIntent(random, index) {
  const canary = marker(random, 'BRAID', index);
  const language = pick(random, LANGUAGES);
  return {
    id: `adversarial-combined-intent-${index + 1}`,
    label: 'Combined concept request and durable code rule',
    canary,
    dimensions: ['multi-intent', 'constraint-memory', 'typo-tolerance'],
    generated: { language: language.name },
    turns: [
      {
        prompt: casual(random, `${canary}: i need 2 things. explain idempotency in one line, and remember that future code snippets should be ${language.name}. acknowledge both.`),
        rubric: {
          id: 'combined-concept-and-rule',
          checks: [
            { type: 'max-words', value: 80 },
            { type: 'contains-values', values: [language.name] },
            semanticGroups(['idempotency', ['same', 'repeat', 'multiple', 'effect', 'once', 'result']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: ok now make me a function that parses a JSON string into an object and errors for anything else. keep the rule from before.`),
        dimensions: ['code-generation'],
        rubric: {
          id: 'combined-rule-code',
          checks: [
            { type: 'code-fence-language', values: language.fences },
            semanticGroups(['json-object', ['json', 'parse', 'object', 'error']]),
            { type: 'not-contains-any', values: language.forbidden },
          ],
        },
      },
    ],
  };
}

function buildTypoConcepts(random, index) {
  const canary = marker(random, 'SMUDGE', index);
  return {
    id: `adversarial-typo-concepts-${index + 1}`,
    label: 'Casual typo-tolerant concept questions',
    canary,
    dimensions: ['typo-tolerance', 'paraphrase'],
    generated: null,
    turns: [
      {
        prompt: casual(random, `${canary}: whats back pressure in a queue? keep it to one sentence pls.`),
        rubric: {
          id: 'typo-backpressure',
          checks: [
            { type: 'max-words', value: 55 },
            semanticGroups(['backpressure', ['slow', 'producer', 'consumer', 'queue', 'load']]),
          ],
        },
      },
      {
        prompt: casual(random, `${canary}: and whats dns rebindng? why can an ssrf check miss it?`),
        rubric: {
          id: 'typo-dns-rebinding',
          checks: [
            { type: 'max-words', value: 120 },
            semanticGroups(['dns', ['dns', 'hostname', 'resolve']], ['private-address', ['private', 'internal', 'ip', 'address']]),
          ],
        },
      },
    ],
  };
}

const FACTORIES = [
  buildCasualConstraintCorrection,
  buildRephrasedExposure,
  buildSemanticDecisionCorrection,
  buildNaturalIncident,
  buildReorderedSystemsAudit,
  buildParaphrasedPathReview,
  buildCombinedIntent,
  buildTypoConcepts,
];

export function buildAdversarialAuditWave(count, seed) {
  const random = randomFromSeed(seed);
  const factories = shuffled(random, FACTORIES);
  const scenarios = [];
  for (let index = 0; index < count; index += 1) {
    const factory = factories[index % factories.length];
    scenarios.push(factory(random, index));
  }
  return {
    version: 3,
    description: 'Adversarial out-of-distribution conversation wave with paraphrases, typos, reordered facts, corrections, and combined intents.',
    generation: {
      mode: 'adversarial-held-out',
      seed,
      conversations: scenarios.length,
      turns: scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0),
      families: new Set(scenarios.map((scenario) => scenario.id.replace(/-\d+$/, ''))).size,
    },
    scenarios,
  };
}
