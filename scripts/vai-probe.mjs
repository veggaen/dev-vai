#!/usr/bin/env node
/**
 * Probe VaiEngine in-process with a list of prompts. Prints strategy +
 * response preview so we can design accurate scenario assertions.
 *
 * Usage: node scripts/vai-probe.mjs [prompts-file.jsonl]
 *   - each line either a JSON object {prompt, label?} or a plain string
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const enginePath = join(repoRoot, 'packages/core/dist/models/vai-engine.js');
const { VaiEngine } = await import(pathToFileURL(enginePath).href);

const arg = process.argv[2];
let prompts;
if (arg) {
  const raw = readFileSync(arg, 'utf8').trim();
  prompts = raw.split(/\r?\n/).filter(Boolean).map((line, i) => {
    const s = line.trim();
    if (s.startsWith('{')) return JSON.parse(s);
    return { label: `#${i + 1}`, prompt: s };
  });
} else {
  prompts = [
    { label: 'tailwind-v4-cascade', prompt: 'My Tailwind v4 utilities like p-4 and mx-auto are being overridden by a universal reset. How do I fix that with @layer?' },
    { label: 'docker-compose-vs-docker', prompt: 'Should I use docker compose or just plain docker for local dev with a postgres + api + frontend?' },
    { label: 'framer-stagger', prompt: 'How do I stagger child animations in Framer Motion when a list renders?' },
    { label: 'gsap-scrolltrigger', prompt: 'How do I pin a section while scrolling with GSAP ScrollTrigger?' },
    { label: 'three-basic-scene', prompt: 'Show me a minimal Three.js scene with a spinning cube.' },
    { label: 'puppeteer-click', prompt: 'How do I click a button and wait for navigation in Puppeteer?' },
    { label: 'ann-embeddings', prompt: 'What is approximate nearest neighbor search and why is it useful for semantic chat search?' },
    { label: 'run-on-multiclause', prompt: 'fix my pern login, also add dark mode, and make sure the hover border stays on the container when I scroll please' },
    { label: 'no-hover-border-glides', prompt: 'min hover border box glir vekk fra containeren ved scroll - hva gjør jeg?' },
    { label: 'frustration-caps', prompt: 'IT ALMOST LIKE WATCHING A WEBSITE WITHOUT STYLING... why does my vinext template look like 2002?' },
    { label: 'single-token-2', messages: [
      { role: 'user', content: 'I have a bug with my login form - should I (1) add client validation, (2) add server validation, or (3) both?' },
      { role: 'assistant', content: 'Great question — do both, but start with (2) server-side since it\'s the real security boundary.' },
      { role: 'user', content: '2' },
    ] },
    { label: 'you-stopped', messages: [
      { role: 'user', content: 'walk me through setting up a vite + react + tailwind project' },
      { role: 'assistant', content: 'Step 1 — run `npm create vite@latest my-app -- --template react-ts`. Step 2 — …' },
      { role: 'user', content: 'you stopped? continue' },
    ] },
    { label: 'tier4-same-as-basic', prompt: 'my tier 4 template looks identical to tier basic - the changes i made are not taking effect, what pipeline steps should i check' },
    { label: 'overflow-container', prompt: 'my ui is overflowing outside the container in chrome - where should i look first, css-wise?' },
  ];
}

const engine = new VaiEngine();

for (const entry of prompts) {
  const messages = entry.messages ?? [{ role: 'user', content: entry.prompt }];
  const label = entry.label ?? entry.prompt.slice(0, 60);
  process.stdout.write(`\n─── ${label} ───\n`);
  process.stdout.write(`PROMPT: ${messages[messages.length - 1].content.slice(0, 200)}\n`);
  try {
    const res = await engine.chat({ messages, noLearn: true });
    const strategy = engine.lastResponseMeta?.strategy ?? '(none)';
    const text = res.message.content;
    const preview = text.length > 500 ? text.slice(0, 500) + '…' : text;
    process.stdout.write(`STRATEGY: ${strategy}  LEN: ${text.length}\n`);
    process.stdout.write(`RESPONSE: ${preview}\n`);
  } catch (err) {
    process.stdout.write(`ERROR: ${err?.message ?? err}\n`);
  }
}
