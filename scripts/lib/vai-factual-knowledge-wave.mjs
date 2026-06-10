/**
 * Factual-knowledge audit wave.
 *
 * Earlier waves tested conversation *mechanics* (memory, isolation, contracts)
 * with task-shaped, canary-prefixed prompts. A real person also just asks
 * things they already know the answer to and checks whether the assistant gets
 * it right — "hey quick one, what port is postgres on?". This wave models that:
 * a curated set of questions with a single verifiable ground truth, asked the
 * natural way a human asks them.
 *
 * Each item carries the human's *own* knowledge, so the simulation is adaptive:
 *   - opening      : how a person actually types the question
 *   - accept       : answer forms that count as correct (ANY match passes)
 *   - pushback     : what the human texts back IF the answer is wrong, stating
 *                    the answer they believe ("lol that's not 404, pretty sure
 *                    it's 418, can you double-check?"). The harness sends this
 *                    only on a failed opening and re-grades — a good model
 *                    self-corrects, a bad one doubles down.
 *
 * Ground truths are deliberately stable (no "as of today" drift) so the bench
 * is deterministic and reproducible across runs.
 */

import { randomFromSeed } from './vai-generated-audit-wave.mjs';

const QUESTIONS = [
  {
    id: 'teapot-status',
    opening: 'hey quick one: what is the http status code for "I\'m a teapot"?',
    accept: ['418'],
    answer: '418',
  },
  {
    id: 'rust-release-year',
    opening: 'ok so what year did the first stable version of rust (1.0) release?',
    accept: ['2015'],
    answer: '2015',
  },
  {
    id: 'js-array-plus-object',
    opening: 'quick q: in javascript what is the result of [] + {} ?',
    accept: ['[object Object]'],
    answer: '"[object Object]"',
  },
  {
    id: 'js-float-add',
    opening: 'what is the exact output of console.log(0.1 + 0.2) in javascript?',
    accept: ['0.30000000000000004'],
    answer: '0.30000000000000004',
  },
  {
    id: 'gold-atomic-number',
    opening: 'hey what is the atomic number of gold?',
    accept: ['79'],
    answer: '79',
  },
  {
    id: 'ipv4-loopback',
    opening: 'what is the standard ipv4 loopback address?',
    accept: ['127.0.0.1'],
    answer: '127.0.0.1',
  },
  {
    id: 'js-string-minus',
    opening: 'in javascript what is the result of "5" - 3 ?',
    // Bare "2" would false-match any incidental digit; require result context.
    accept: ['is 2', '= 2', 'equals 2', 'to 2', 'result: 2', 'gives 2', 'yields 2'],
    answer: '2 (the string is coerced to a number)',
  },
  {
    id: 'postgres-port',
    opening: 'what is the default port for postgresql?',
    accept: ['5432'],
    answer: '5432',
  },
  {
    id: 'first-iphone-year',
    opening: 'what year was the first iphone released?',
    accept: ['2007'],
    answer: '2007',
  },
  {
    id: 'rust-immutable-keyword',
    opening: 'in rust what keyword declares an immutable variable by default?',
    accept: ['let'],
    answer: 'let',
  },
  {
    id: 'water-boiling-point',
    opening: 'what is the boiling point of water in celsius at sea level pressure?',
    accept: ['100'],
    answer: '100\u00b0C',
  },
  {
    id: 'kibibyte-bytes',
    opening: 'simple one: how many bytes are in one kibibyte?',
    accept: ['1024'],
    answer: '1024',
  },
  {
    id: 'https-port',
    opening: 'what port number is reserved for https?',
    accept: ['443'],
    answer: '443',
  },
  {
    id: 'mul-17-34',
    opening: 'quick math: what is 17 \u00d7 34?',
    accept: ['578'],
    answer: '578',
  },
  {
    id: 'linux-1.0-year',
    opening: 'what year was linux kernel version 1.0 released?',
    accept: ['1994'],
    answer: '1994',
  },
  {
    id: 'alphabet-letters',
    opening: 'how many letters are in the english alphabet?',
    accept: ['26'],
    answer: '26',
  },
  {
    id: 'python-split-empty',
    opening: 'in python what does "abc".split("") raise or return? (3.x)',
    accept: ['ValueError', 'empty separator'],
    answer: 'a ValueError (empty separator)',
  },
  {
    id: 'python-math-pi',
    opening: 'what is math.pi in python printed at default precision?',
    accept: ['3.141592653589793'],
    answer: '3.141592653589793',
  },
  {
    id: 'fire-emoji-codepoint',
    opening: 'what is the unicode code point for the fire emoji?',
    accept: ['U+1F525', '1F525'],
    answer: 'U+1F525',
  },
  {
    id: 'seconds-per-day',
    opening: 'how many seconds are in one day?',
    accept: ['86400', '86,400'],
    answer: '86400',
  },
  {
    id: 'ssh-port',
    opening: 'what is the default port for ssh?',
    accept: ['22'],
    answer: '22',
  },
  {
    id: 'australia-capital',
    opening: 'what is the capital of australia?',
    accept: ['Canberra'],
    answer: 'Canberra',
  },
  {
    id: 'js-max-safe-int',
    opening: 'what is 2 ** 53 - 1 in javascript (max safe integer)?',
    accept: ['9007199254740991'],
    answer: '9007199254740991',
  },
  {
    id: 'minutes-per-week',
    opening: 'what is the exact number of minutes in one week?',
    accept: ['10080', '10,080'],
    answer: '10080',
  },
  {
    id: 'iron-symbol',
    opening: 'what is the chemical symbol for iron?',
    accept: ['Fe'],
    answer: 'Fe',
  },
  {
    id: 'bits-per-byte',
    opening: 'how many bits are in one byte?',
    accept: ['8'],
    answer: '8',
  },
  {
    id: 'java-default-boolean',
    opening: 'what is the default value of an uninitialized boolean field in java?',
    accept: ['false'],
    answer: 'false',
  },
  {
    id: 'speed-of-light',
    opening: 'what is the speed of light in vacuum in meters per second?',
    accept: ['299792458', '299,792,458'],
    answer: '299792458 m/s',
  },
  {
    id: 'ts-extension',
    opening: 'what is the filename extension for a typescript file?',
    accept: ['.ts'],
    answer: '.ts',
  },
  {
    id: 'carbon-atomic-mass',
    opening: 'what is the atomic mass of carbon rounded to the nearest whole number?',
    accept: ['12'],
    answer: '12',
  },
  {
    id: 'continents-count',
    opening: 'how many continents are there?',
    accept: ['7', 'seven'],
    answer: '7',
  },
  {
    id: 'docker-release-year',
    opening: 'what year was docker first released?',
    accept: ['2013'],
    answer: '2013',
  },
  {
    id: 'div-default-display',
    opening: 'in css what is the default display value for a div?',
    accept: ['block'],
    answer: 'block',
  },
  {
    id: 'supercali-letters',
    opening: 'how many letters are in the word "supercalifragilisticexpialidocious"?',
    accept: ['34'],
    answer: '34',
  },
  {
    id: 'dns-acronym',
    opening: 'what does dns stand for?',
    accept: ['Domain Name System'],
    answer: 'Domain Name System',
  },
  {
    id: 'liquid-nitrogen-boiling',
    opening: 'what is the boiling point of liquid nitrogen in celsius?',
    accept: ['-196', '\u2212196'],
    answer: '-196\u00b0C',
  },
  {
    id: 'uuid-v4-bytes',
    opening: 'how many bytes is a uuid version 4?',
    accept: ['16'],
    answer: '16',
  },
  {
    id: 'sek-iso-code',
    opening: 'what is the iso 4217 code for the swedish krona?',
    accept: ['SEK'],
    answer: 'SEK',
  },
  {
    id: 'js-math-e',
    opening: 'what is Math.E in javascript to 5 decimal places?',
    accept: ['2.71828'],
    answer: '2.71828',
  },
  {
    id: 'www-invented-year',
    opening: 'what year was the world wide web invented?',
    accept: ['1989'],
    answer: '1989',
  },
  {
    id: 'ts-null-assignable',
    opening: 'in typescript with strict null checks, is string | null assignable to string?',
    accept: ['No', 'not assignable', "isn't"],
    answer: 'No',
  },
  {
    id: 'hash-symbol-name',
    opening: 'what is the official name of the # symbol?',
    accept: ['octothorpe', 'number sign'],
    answer: 'octothorpe (number sign)',
  },
  {
    id: 'http-not-found',
    opening: 'what http status code means "not found"?',
    accept: ['404'],
    answer: '404',
  },
  {
    id: 'http-created',
    opening: 'which http status code means a resource was created?',
    accept: ['201'],
    answer: '201',
  },
  {
    id: 'mysql-port',
    opening: 'what is the default port for mysql?',
    accept: ['3306'],
    answer: '3306',
  },
  {
    id: 'redis-port',
    opening: 'what is the default port redis listens on?',
    accept: ['6379'],
    answer: '6379',
  },
  {
    id: 'http-port',
    opening: 'what is the default port for plain http?',
    accept: ['80'],
    answer: '80',
  },
  {
    id: 'python-list-comprehension',
    opening: 'in python what does [x*2 for x in range(3)] evaluate to?',
    accept: ['[0, 2, 4]', '0, 2, 4'],
    answer: '[0, 2, 4]',
  },
  {
    id: 'js-typeof-null',
    opening: 'in javascript what does typeof null return?',
    accept: ['object'],
    answer: '"object" (a famous historical bug)',
  },
  {
    id: 'js-nan-equality',
    opening: 'in javascript what is NaN === NaN ?',
    accept: ['false'],
    answer: 'false',
  },
  {
    id: 'git-staging-name',
    opening: 'in git what is the staging area also called?',
    accept: ['index'],
    answer: 'the index',
  },
  {
    id: 'semver-order',
    opening: 'in semantic versioning what do the three numbers mean in order?',
    accept: ['major', 'minor', 'patch'],
    answer: 'MAJOR.MINOR.PATCH',
  },
  {
    id: 'css-box-default',
    opening: 'what is the default value of the css box-sizing property?',
    accept: ['content-box'],
    answer: 'content-box',
  },
  {
    id: 'sql-distinct',
    opening: 'in sql which keyword removes duplicate rows from a result set?',
    accept: ['DISTINCT'],
    answer: 'DISTINCT',
  },
  {
    id: 'http-method-idempotent',
    opening: 'is the http GET method idempotent?',
    accept: ['yes', 'idempotent', 'it is'],
    answer: 'Yes, GET is idempotent',
  },
  {
    id: 'utf8-max-bytes',
    opening: 'what is the maximum number of bytes a single utf-8 character can take?',
    accept: ['4'],
    answer: '4 bytes',
  },
  {
    id: 'binary-1010',
    opening: 'what is the binary number 1010 in decimal?',
    accept: ['10'],
    answer: '10',
  },
  {
    id: 'hex-ff',
    opening: 'what is hexadecimal 0xFF in decimal?',
    accept: ['255'],
    answer: '255',
  },
  {
    id: 'python-bool-subclass',
    opening: 'in python is bool a subclass of int?',
    accept: ['yes', 'it is', 'subclass'],
    answer: 'Yes, bool subclasses int',
  },
  {
    id: 'tcp-handshake',
    opening: 'how many steps are in the tcp connection handshake?',
    accept: ['3', 'three'],
    answer: '3 (SYN, SYN-ACK, ACK)',
  },
  {
    id: 'rgb-white-hex',
    opening: 'what is the hex code for pure white?',
    accept: ['#FFFFFF', '#fff', 'FFFFFF'],
    answer: '#FFFFFF',
  },
  {
    id: 'js-array-isarray',
    opening: 'in javascript what does Array.isArray([]) return?',
    accept: ['true'],
    answer: 'true',
  },
  {
    id: 'http-no-content',
    opening: 'what http status code means "no content"?',
    accept: ['204'],
    answer: '204',
  },
  {
    id: 'http-too-many',
    opening: 'which http status code means "too many requests"?',
    accept: ['429'],
    answer: '429',
  },
  {
    id: 'css-z-index-default',
    opening: 'what is the default css z-index value for a positioned element?',
    accept: ['auto'],
    answer: 'auto',
  },
  {
    id: 'mars-moons',
    opening: 'how many moons does mars have?',
    accept: ['2', 'two'],
    answer: '2 (Phobos and Deimos)',
  },
  {
    id: 'http-bad-gateway',
    opening: 'what does http status 502 mean?',
    accept: ['Bad Gateway'],
    answer: 'Bad Gateway',
  },
];

const OPENER_GARNISH = ['', '', '', 'hey ', 'ok so ', 'quick one, ', 'random q, '];

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function shuffled(random, values) {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

function pushbackText(random, answer) {
  const template = pick(random, [
    `hmm i don't think that's right, pretty sure it's ${answer}. can you double-check?`,
    `lol wait that's not what i remember. isn't it ${answer}?`,
    `that feels off tbh. i thought the answer was ${answer} — am i wrong?`,
    `nah i'm fairly sure it's ${answer}. mind confirming?`,
  ]);
  return template;
}

/**
 * Build a factual-knowledge wave.
 * @param {number} count how many questions to include (capped at corpus size)
 * @param {string} seed stable seed for reproducible selection / phrasing
 */
export function buildFactualKnowledgeWave(count, seed) {
  const random = randomFromSeed(`factual:${seed}`);
  const selected = shuffled(random, QUESTIONS).slice(0, Math.max(1, Math.min(count, QUESTIONS.length)));

  const scenarios = selected.map((question, index) => {
    const rubric = {
      id: `factual-${question.id}`,
      checks: [{ type: 'answer-match', id: question.id, values: question.accept }],
    };
    // Strip any opener baked into the corpus phrasing so the garnish below is
    // the single, non-stacked opener ("hey ok so ..." -> "hey ...").
    const baseOpening = question.opening.replace(
      /^(?:hey,?\s+|ok so,?\s+|quick q:?\s+|quick one,?\s+|simple one:?\s+|random q,?\s+)+/i,
      '',
    );
    const opening = `${pick(random, OPENER_GARNISH)}${baseOpening}`;
    return {
      id: `factual-${question.id}-${index + 1}`,
      label: `Factual recall: ${question.id}`,
      canary: null,
      dimensions: ['factual', 'knowledge', 'single-turn'],
      generated: { answer: question.answer },
      turns: [
        {
          prompt: opening,
          noHumanize: true, // already phrased like a human; never mangle the question
          rubric,
          // Human follow-up sent ONLY if the opening answer is wrong.
          recovery: {
            prompt: pushbackText(random, question.answer),
            noHumanize: true,
            rubric: { ...rubric, id: `${rubric.id}-recovery` },
          },
        },
      ],
    };
  });

  return {
    version: 'factual-knowledge-1',
    generation: { mode: 'factual-knowledge', seed, corpusSize: QUESTIONS.length },
    scenarios,
  };
}

export default { buildFactualKnowledgeWave };
