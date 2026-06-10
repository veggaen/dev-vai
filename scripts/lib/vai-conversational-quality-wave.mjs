/**
 * Conversational-quality audit wave.
 *
 * Real people don't only ask trivia — they open messy, open-ended threads:
 * "help me debug why my docker container keeps crashing", "is it still worth
 * learning rust in 2026?", "roast my codebase ideas, be honest". There is no
 * single correct answer, so these are graded on QUALITY signals instead of an
 * exact string:
 *   - substantive    : a real answer, not a one-line dodge (min length)
 *   - not-fallback    : did NOT bail to the generic "I don't have a confident
 *                       answer" line (the GENERIC_FALLBACK guard in the grader)
 *   - on-topic        : mentions at least one anchor concept from the question
 *                       (semantic-groups), so it isn't a plausible-but-unrelated
 *                       blurb (the exact failure the factual run exposed)
 *
 * Openings are drawn verbatim from observed Grok / Perplexity / Claude-style
 * chat openers, so the register is genuinely human. `noHumanize` keeps them
 * intact — they are already messy and natural.
 */

import { randomFromSeed } from './vai-generated-audit-wave.mjs';

/**
 * Each item: the natural opener + topic anchors the reply should engage with.
 * `anchors` is a list of concept tokens; the reply must contain at least one
 * (semantic-groups passes if ANY value in the group appears).
 */
const PROMPTS = [
  { id: 'ts-monorepo', opening: 'hey, quick question — what\u2019s the best way to structure a large typescript monorepo in 2026?', anchors: ['workspace', 'package', 'monorepo', 'pnpm', 'turborepo', 'nx', 'tsconfig'] },
  { id: 'docker-crash', opening: 'ok so i\u2019ve been stuck on this for hours\u2026 can you help me debug why my docker container keeps crashing on startup?', anchors: ['logs', 'docker logs', 'exit code', 'entrypoint', 'CMD', 'restart', 'healthcheck'], diagnosticFirst: true },
  { id: 'blank-react', opening: 'i am overwhelmed debugging a blank react page. where should i start?', anchors: ['console', 'error', 'network', 'root', 'mount', 'devtools', 'request'], diagnosticFirst: true, forbiddenAssumptions: ['npm ', 'npx ', 'yarn ', 'pnpm ', 'create-react-app'] },
  { id: 'dns-rebinding', opening: 'hey can you explain how dns rebinding attacks actually work in simple terms?', anchors: ['dns', 'ip', 'rebind', 'private', 'browser', 'host', 'ttl'] },
  { id: 'rust-vs-go-2026', opening: 'i need a second opinion — is it still worth learning rust in 2026 or should i just go deeper into go?', anchors: ['rust', 'go', 'performance', 'memory', 'concurrency', 'tradeoff', 'use case'] },
  { id: 'secure-sandbox', opening: 'quick one: how would you design a secure sandbox for running untrusted code?', anchors: ['sandbox', 'isolat', 'container', 'syscall', 'seccomp', 'wasm', 'permission', 'resource limit'] },
  { id: 'auth-tauri-next', opening: 'hey, what\u2019s the current best practice for handling auth in a tauri + next.js desktop app?', anchors: ['token', 'auth', 'secure', 'store', 'session', 'oauth', 'keychain'] },
  { id: 'local-first-mistakes', opening: 'what are the biggest mistakes people make when building local-first apps?', anchors: ['sync', 'conflict', 'offline', 'merge', 'crdt', 'data', 'local'] },
  { id: 'split-file', opening: 'help me think out loud: should i split this huge file or keep it as one for now?', anchors: ['split', 'module', 'cohesion', 'maintain', 'responsibilit', 'depends', 'size'] },
  { id: 'wasm-eli15', opening: 'i need to understand webassembly better — can you explain it like i\u2019m 15?', anchors: ['wasm', 'webassembly', 'browser', 'binary', 'fast', 'compile', 'language'] },
  { id: 'offline-db-2026', opening: 'hey, what\u2019s the current state of offline-first databases in 2026?', anchors: ['offline', 'sync', 'database', 'sqlite', 'crdt', 'replicat', 'local'] },
  { id: 'ai-memory-patterns', opening: 'i\u2019m trying to make my ai actually remember things across conversations\u2026 any good patterns?', anchors: ['memory', 'store', 'embed', 'retriev', 'summar', 'context', 'persist'] },
  { id: 'long-term-memory-chat', opening: 'what\u2019s the best way to handle long-term memory in a chat interface like this?', anchors: ['memory', 'summar', 'vector', 'retriev', 'context', 'store', 'recall'] },
  { id: 'bind-0000-2026', opening: 'quick q: is it still safe to bind to 0.0.0.0 in development in 2026?', anchors: ['0.0.0.0', 'loopback', '127.0.0.1', 'expose', 'network', 'firewall', 'local'] },
  { id: 'tauri-vs-electron', opening: 'can you compare tauri vs electron in 2026 honestly?', anchors: ['tauri', 'electron', 'rust', 'chromium', 'bundle size', 'memory', 'webview'], comparison: true },
  { id: 'markdown-escape', opening: 'hey, what\u2019s the proper way to escape user input in markdown rendering?', anchors: ['escape', 'sanitiz', 'xss', 'html', 'markdown', 'render', 'untrusted'] },
  { id: 'audit-scalable', opening: 'i need ideas for making my audit system way more scalable — got any?', anchors: ['scale', 'parallel', 'batch', 'queue', 'cluster', 'sample', 'cache'] },
  { id: 'underrated-editor-feature', opening: 'what\u2019s the most underrated feature in modern code editors right now?', anchors: ['feature', 'editor', 'refactor', 'multi-cursor', 'lsp', 'navigation', 'debug'] },
  { id: 'uuid-made-of', opening: 'this might be a stupid question but\u2026 what exactly is a uuid made of?', anchors: ['128', 'bit', 'hex', 'version', 'random', 'timestamp', 'byte'] },
  { id: 'path-containment-howto', opening: 'hey, can you walk me through how you would implement path containment safely?', anchors: ['path.relative', 'resolve', 'normaliz', '..', 'prefix', 'startswith', 'traversal'] },
  { id: 'security-devs-misunderstand', opening: 'what\u2019s something you wish more developers understood about security?', anchors: ['input', 'trust', 'validat', 'least privilege', 'permission', 'access', 'role', 'defense', 'threat', 'secret'] },
  { id: 'realtime-collab-2026', opening: 'hey, what\u2019s the current best way to do real-time collaboration in 2026?', anchors: ['crdt', 'websocket', 'yjs', 'operational transform', 'sync', 'conflict', 'presence'] },
  { id: 'ssrf-frontend-dev', opening: 'can you explain ssrf like i\u2019m a frontend dev who barely touches backend?', anchors: ['ssrf', 'server', 'request', 'internal', 'metadata', 'url', 'forge'] },
  { id: 'ts-null-assignable-conv', opening: 'quick sanity check: is string | null assignable to string in typescript?', anchors: ['no', 'null', 'strict', 'assignable', 'narrow'] },
  { id: 'one-giant-file', opening: 'i feel like my code is becoming one giant file\u2026 is that always bad?', anchors: ['split', 'cohesion', 'module', 'maintain', 'not always', 'depends', 'responsibilit'] },
  { id: 'user-corrections-conv', opening: 'what\u2019s the best way to handle user corrections in a long conversation?', anchors: ['update', 'supersede', 'latest', 'override', 'state', 'memory', 'preference'] },
  { id: 'normalize-text-matching', opening: 'quick q: how do you properly normalize text for matching?', anchors: ['lowercase', 'trim', 'unicode', 'whitespace', 'diacritic', 'normaliz', 'token'] },
  { id: 'hardcoded-vs-dynamic', opening: 'what\u2019s your take on hard-coded vs fully dynamic systems?', anchors: ['hardcode', 'dynamic', 'config', 'maintain', 'tradeoff', 'flexib', 'brittle'] },
  { id: 'humanizer-design', opening: 'hey, can you help me design a good humanizer for test prompts?', anchors: ['register', 'abbreviat', 'typo', 'natural', 'paraphrase', 'protect', 'token'] },
  { id: 'test-ai-context', opening: 'what\u2019s the best way to test if an ai actually understands context?', anchors: ['follow-up', 'reference', 'pronoun', 'memory', 'multi-turn', 'context', 'recall'] },
  { id: 'pnpm-workspace-pain', opening: 'ok i\u2019m frustrated — why is my pnpm workspace being such a pain with dependencies?', anchors: ['workspace', 'hoist', 'peer', 'lockfile', 'link', 'version', 'resolution'] },
  { id: 'smart-friend-feel', opening: 'i need this to feel more like talking to a smart friend — how?', anchors: ['tone', 'natural', 'concise', 'context', 'memory', 'personal', 'register'] },
  { id: 'flaky-tests', opening: 'help — my tests are flaky and i\u2019m losing my mind', anchors: ['timing', 'race', 'async', 'isolat', 'seed', 'retry', 'order', 'deterministic'], diagnosticFirst: true },
  { id: 'system-prompt-coding', opening: 'hey, can you help me write a really good system prompt for a coding assistant?', anchors: ['role', 'constraint', 'tone', 'tool', 'format', 'instruction', 'context'] },
];

const OPENER_GARNISH = ['', '', '', '', 'hey ', 'ok so '];

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

/**
 * Build a conversational-quality wave.
 * @param {number} count number of open-ended prompts (capped at corpus size)
 * @param {string} seed stable seed for reproducible selection
 */
export function buildConversationalQualityWave(count, seed) {
  const random = randomFromSeed(`conversational:${seed}`);
  const selected = shuffled(random, PROMPTS).slice(0, Math.max(1, Math.min(count, PROMPTS.length)));

  const scenarios = selected.map((item, index) => {
    const base = item.opening.replace(/^(?:hey,?\s+|ok so,?\s+)+/i, '');
    const opening = `${pick(random, OPENER_GARNISH)}${base}`;
    return {
      id: `conversational-${item.id}-${index + 1}`,
      label: `Open-ended quality: ${item.id}`,
      canary: null,
      dimensions: ['conversational', 'open-ended', 'quality'],
      turns: [
        {
          prompt: opening,
          noHumanize: true,
          rubric: {
            id: `conversational-${item.id}`,
            checks: [
              { type: 'min-chars', value: 80, axis: 'human' },
              { type: 'max-words', value: 600, axis: 'human' },
              {
                type: 'semantic-groups',
                groups: [{ id: 'on-topic', values: item.anchors, minMatches: 2 }],
                axes: ['human', 'ai'],
              },
              ...(item.comparison ? [{
                type: 'comparison-shape',
                axes: ['human', 'ai'],
              }] : []),
              ...(item.diagnosticFirst ? [{
                type: 'diagnostic-first',
                axes: ['human', 'robot'],
              }] : []),
              ...(item.forbiddenAssumptions ? [{
                type: 'not-contains-any',
                values: item.forbiddenAssumptions,
                axes: ['ai', 'robot'],
              }] : []),
            ],
          },
        },
      ],
    };
  });

  return {
    version: 'conversational-quality-3',
    generation: { mode: 'conversational-quality', seed, corpusSize: PROMPTS.length },
    scenarios,
  };
}

export default { buildConversationalQualityWave };
