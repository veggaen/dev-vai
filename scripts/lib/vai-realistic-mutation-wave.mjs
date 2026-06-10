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

function semanticGroups(...groups) {
  return {
    type: 'semantic-groups',
    groups: groups.map(([id, values]) => ({ id, values })),
  };
}

function numberWord(value) {
  const small = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen',
  ];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (value < 20) return small[value];
  if (value < 100) return `${tens[Math.floor(value / 10)]}${value % 10 ? `-${small[value % 10]}` : ''}`;
  if (value < 1000) return `${small[Math.floor(value / 100)]} hundred${value % 100 ? ` ${numberWord(value % 100)}` : ''}`;
  throw new Error(`Unsupported dogfood number-word value: ${value}`);
}

function metadata(index, semanticId, mutation) {
  return {
    canary: `DOGFOOD-${index + 1}`,
    benchmarkLane: 'dogfood-mutation',
    generated: { semanticId, mutation },
  };
}

function buildCompoundKnowledge(random, index) {
  const countries = [
    ['Norway', 'Oslo', 'NOK'],
    ['Sweden', 'Stockholm', 'SEK'],
    ['Denmark', 'Copenhagen', 'DKK'],
    ['Japan', 'Tokyo', 'JPY'],
  ];
  const [country, capital, currency] = countries[index % countries.length];
  const left = 9 + index;
  const right = integer(random, 4, 17);
  const subtract = integer(random, 1, 6);
  const answer = left + right - subtract;
  const templates = [
    `okay then try this, what is ${left} plus ${right} minus ${subtract}, and what is the capital of ${country}? reply with the math result and capital only`,
    `hello quick question: tell me the capital of ${country} and also work out ${left} + ${right} - ${subtract}. just give me both answers pls`,
    `i need 2 things, ${left} plus ${right} minus ${subtract}, and the capital city of ${country}. answer only with the result and the city`,
  ];
  return {
    id: `dogfood-compound-knowledge-${index + 1}`,
    label: 'Conversational compound factual and arithmetic request',
    ...metadata(index, 'compound-knowledge', 'clause-order-and-conversational-prefix'),
    dimensions: ['ordinary-conversation', 'multi-intent', 'paraphrase'],
    turns: [{
      prompt: pick(random, templates),
      rubric: {
        id: 'dogfood-compound-knowledge',
        checks: [{ type: 'contains-values', values: [String(answer), capital] }],
      },
    }, {
      prompt: `and what currency code does ${country} use? only the code this time`,
      rubric: {
        id: 'dogfood-compound-followup',
        checks: [
          { type: 'contains-values', values: [currency] },
          { type: 'max-words', value: 8 },
        ],
      },
    }],
  };
}

function buildProgressiveElaboration(random, index) {
  const concepts = [
    ['CORS', ['browser', 'origin', 'request', 'header']],
    ['back pressure in a worker queue', ['queue', 'producer', 'consumer', 'slow', 'load']],
    ['React hooks', ['react', 'state', 'effect', 'function', 'component']],
  ];
  const [concept, terms] = concepts[index % concepts.length];
  return {
    id: `dogfood-progressive-elaboration-${index + 1}`,
    label: 'Natural progressive elaboration follow-up',
    ...metadata(index, 'progressive-elaboration', 'short-followup-reference'),
    dimensions: ['ordinary-conversation', 'follow-up', 'paraphrase'],
    turns: [{
      prompt: `what is ${concept}?`,
      rubric: {
        id: 'dogfood-concept-intro',
        checks: [semanticGroups(['concept', terms])],
      },
    }, {
      prompt: `okay but tell me more about ${concept}, like when would this actually matter in a real project?`,
      rubric: {
        id: 'dogfood-concept-elaboration',
        checks: [
          { type: 'min-chars', value: 80 },
          semanticGroups(['concept', terms], ['practical', ['project', 'use', 'when', 'example', 'matter']]),
        ],
      },
    }],
  };
}

function buildCorrectionRestart(random, index) {
  const languages = [
    ['JavaScript', ['js', 'javascript']],
    ['TypeScript', ['ts', 'typescript']],
    ['Python', ['py', 'python']],
  ];
  const language = languages[index % languages.length];
  return {
    id: `dogfood-correction-restart-${index + 1}`,
    label: 'Self-corrected practical code request',
    ...metadata(index, 'correction-restart', 'spoken-self-correction'),
    dimensions: ['ordinary-conversation', 'correction-memory', 'code-generation'],
    turns: [{
      prompt: `can you write a ${language[0]} helper that reverses a string, wait actually make it reverse the words in a sentence, not the characters`,
      rubric: {
        id: 'dogfood-corrected-code',
        checks: [
          { type: 'code-fence-language', values: language[1] },
          semanticGroups(['words', ['word', 'split', 'join', 'sentence']], ['reverse', ['reverse']]),
        ],
      },
    }],
  };
}

function buildVagueThenSpecific(random, index) {
  const details = [
    ['node cli', 'its a node cli. i need to turn a csv file into json without loading the entire file into memory.', ['node', 'csv', 'json', 'stream', 'memory']],
    ['vite app', 'its a vite app. the screen stays blank after i moved the router setup.', ['vite', 'router', 'blank', 'console', 'route']],
    ['small api', 'its a small api. the upload endpoint should reject large files before they fill memory.', ['api', 'upload', 'file', 'limit', 'memory']],
  ];
  const detail = details[index % details.length];
  return {
    id: `dogfood-vague-specific-${index + 1}`,
    label: 'Vague help request followed by useful project detail',
    ...metadata(index, 'vague-to-specific', 'progressive-disclosure'),
    dimensions: ['ordinary-conversation', 'ambiguity', 'follow-up'],
    turns: [{
      prompt: `i need help with my ${detail[0]} project but im not really sure where to start`,
      rubric: {
        id: 'dogfood-vague-clarification',
        checks: [{ type: 'min-question-count', value: 1 }],
      },
    }, {
      prompt: `${detail[1]} what would you check or do first?`,
      rubric: {
        id: 'dogfood-specific-help',
        checks: [
          { type: 'min-chars', value: 70 },
          semanticGroups(['project-detail', detail[2]]),
        ],
      },
    }],
  };
}

function buildPracticalPreview(random, index) {
  const games = ['top-down arcade game', 'small maze game', 'simple browser puzzle game'];
  const game = games[index % games.length];
  return {
    id: `dogfood-practical-preview-${index + 1}`,
    label: 'Concrete playable preview request and skeptical follow-up',
    ...metadata(index, 'practical-preview', 'goal-oriented-build-request'),
    dimensions: ['ordinary-conversation', 'code-generation', 'practical-goal'],
    turns: [{
      prompt: `can you show me a single page html example of a ${game} so i can play it in the preview?`,
      rubric: {
        id: 'dogfood-preview-build',
        checks: [
          { type: 'code-fence-language', values: ['html'] },
          semanticGroups(['playable', ['canvas', 'game', 'play', 'keyboard', 'control']]),
        ],
      },
    }, {
      prompt: `emm so this ${game} should actually be playable in the preview right? make sure the controls are clear`,
      rubric: {
        id: 'dogfood-preview-followup',
        checks: [semanticGroups(['controls', ['control', 'keyboard', 'arrow', 'wasd', 'key']])],
      },
    }],
  };
}

function buildProjectMemory(random, index) {
  const projects = [
    ['Mica', 'TypeScript', 'SQLite'],
    ['Cedar', 'Rust', 'Postgres'],
    ['Quartz', 'Python', 'Redis'],
  ];
  const project = projects[index % projects.length];
  return {
    id: `dogfood-project-memory-${index + 1}`,
    label: 'Natural project context recall',
    ...metadata(index, 'project-memory', 'delayed-recall'),
    dimensions: ['ordinary-conversation', 'project-memory', 'memory'],
    turns: [{
      prompt: `okay remember this for later, project ${project[0]} uses ${project[1]} and ${project[2]}. i will ask about it again`,
      rubric: {
        id: 'dogfood-project-memory-ack',
        checks: [
          { type: 'contains-values', values: project },
          { type: 'max-words', value: 80 },
        ],
      },
    }, {
      prompt: `quick detour before we go back to ${project[0]}, what does idempotent mean?`,
      rubric: {
        id: 'dogfood-project-memory-detour',
        checks: [semanticGroups(['idempotent', ['same', 'repeat', 'multiple', 'effect', 'result']])],
      },
    }, {
      prompt: `what stack did i say project ${project[0]} uses again?`,
      rubric: {
        id: 'dogfood-project-memory-recall',
        checks: [
          { type: 'contains-values', values: [project[1], project[2]] },
          { type: 'not-contains-any', values: ['JavaScript', 'Go', 'Rust', 'Python', 'TypeScript', 'SQLite', 'Postgres', 'Redis'].filter((value) => !project.includes(value)) },
        ],
      },
    }],
  };
}

function buildTypoQuestion(_random, index) {
  const prompts = [
    'how do i set up a raect app with tialwind? and what should i check if vite just shows a blank page?',
    'how do i set up a fasapi backend with a svetle frontend? and where should cors be configured?',
    'how do i make a typesript node cli? and what should i check if it cant find my imports?',
  ];
  const groups = [
    [['react', ['react']], ['tailwind', ['tailwind']], ['vite', ['vite', 'console', 'import', 'root', 'render']]],
    [['fastapi', ['fastapi']], ['svelte', ['svelte']], ['cors', ['cors', 'origin', 'middleware']]],
    [['typescript', ['typescript']], ['node', ['node']], ['imports', ['import', 'module', 'path', 'config']]],
  ];
  return {
    id: `dogfood-typo-question-${index + 1}`,
    label: 'Typo-tolerant lowercase technical question',
    ...metadata(index, 'typo-question', 'misspelling-and-lowercase-i'),
    dimensions: ['ordinary-conversation', 'typo-tolerance', 'paraphrase'],
    turns: [{
      prompt: prompts[index % prompts.length],
      rubric: {
        id: 'dogfood-typo-question',
        checks: [
          { type: 'min-chars', value: 90 },
          semanticGroups(...groups[index % groups.length]),
          { type: 'not-contains-any', values: ['pick your stack', 'define the core data model'] },
        ],
      },
    }],
  };
}

function buildOutputConstraint(_random, index) {
  const left = 10 + index;
  const right = 11;
  const result = left + right - 1;
  const expected = numberWord(result);
  return {
    id: `dogfood-output-constraint-${index + 1}`,
    label: 'Simple human output constraint',
    ...metadata(index, 'output-constraint', 'conversational-format-rule'),
    dimensions: ['ordinary-conversation', 'output-contract', 'multi-intent'],
    turns: [{
      prompt: `okay then what is ${left} plus ${right} minus one? reply only with the answer written in letters, dont use numbers`,
      rubric: {
        id: 'dogfood-number-as-word',
        checks: [
          { type: 'matches', id: 'number-word-only', pattern: `^${expected}[.!]?$`, flags: 'i' },
        ],
      },
    }],
  };
}

function buildSystemsQuestion(random, index) {
  const scratch = 24 + index;
  const large = integer(random, 2, 8);
  const lint = integer(random, 20, 96);
  return {
    id: `dogfood-systems-question-${index + 1}`,
    label: 'User-style systems prioritization question',
    ...metadata(index, 'systems-prioritization', 'compound-audit-request'),
    dimensions: ['ordinary-conversation', 'multi-intent', 'systems-prioritization'],
    turns: [{
      prompt: `okay so we have ${scratch} scratch files in root, ${large} files over 5000 lines and ${lint} lint errors. can you look at this like an engineering auditor and tell me the shared causes first so we dont just fix one thing at a time?`,
      rubric: {
        id: 'dogfood-systems-prioritization',
        checks: [
          { type: 'contains-values', values: [String(scratch), String(large), String(lint)] },
          semanticGroups(['shared-cause', ['shared', 'cluster', 'systemic', 'root cause', 'baseline']], ['prioritize', ['priorit', 'first', 'order', 'impact']]),
        ],
      },
    }],
  };
}

function buildNaturalSecurityReview(random, index) {
  const root = `/srv/uploads-${10 + index}`;
  const sibling = `${root}-old/config.json`;
  return {
    id: `dogfood-security-review-${index + 1}`,
    label: 'Natural security review question',
    ...metadata(index, 'security-review', 'practical-code-audit'),
    dimensions: ['ordinary-conversation', 'security-code-review', 'paraphrase'],
    turns: [{
      prompt: `can you audit this node path check? root is ${root} and it only checks full.startsWith(root). could ${sibling} still get through, and what should i use instead?`,
      rubric: {
        id: 'dogfood-security-review',
        checks: [
          { type: 'contains-values', values: [sibling] },
          semanticGroups(['containment', ['prefix', 'sibling', 'contain', 'outside', 'escape']], ['relative', ['path.relative', 'relative path', 'relative(']]),
        ],
      },
    }],
  };
}

const FACTORIES = [
  buildCompoundKnowledge,
  buildProgressiveElaboration,
  buildCorrectionRestart,
  buildVagueThenSpecific,
  buildPracticalPreview,
  buildProjectMemory,
  buildTypoQuestion,
  buildOutputConstraint,
  buildSystemsQuestion,
  buildNaturalSecurityReview,
];

export function buildRealisticMutationWave(count, seed) {
  const random = randomFromSeed(seed);
  const factories = shuffled(random, FACTORIES);
  const scenarios = [];
  for (let index = 0; index < count; index += 1) {
    const factory = factories[index % factories.length];
    scenarios.push(factory(random, index));
  }
  return {
    version: 5,
    description: 'Dogfood mutation wave grounded in real user writing patterns: compound requests, typos, corrections, progressive detail, practical goals, and natural follow-ups.',
    generation: {
      mode: 'realistic-dogfood-mutation',
      seed,
      conversations: scenarios.length,
      turns: scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0),
      families: new Set(scenarios.map((scenario) => scenario.generated.semanticId)).size,
    },
    scenarios,
  };
}
