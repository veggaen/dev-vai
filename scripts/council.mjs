#!/usr/bin/env node
/**
 * Summon the Vai council on a coding task — from the terminal, where your models live.
 *
 * Several of YOUR installed local models each propose an edit to one file (a different model
 * per member where possible), then a judge model picks the best. Nothing is written unless
 * you pass --write (a .bak backup is made first).
 *
 * Runs entirely on your machine against Ollama — no external tokens.
 *
 * Usage:
 *   node scripts/council.mjs <file> "<task>"                 # show candidates + judge pick
 *   node scripts/council.mjs <file> "<task>" --write         # apply the judge's pick (backs up)
 *   node scripts/council.mjs <file> "<task>" --members 4     # how many members (default 3)
 *   OLLAMA_HOST=http://localhost:11434 node scripts/council.mjs ...
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const BASE = (process.env.OLLAMA_HOST || process.env.LOCAL_MODEL_URL || 'http://localhost:11434').replace(/\/$/, '');
const ROLES = {
  coder: 'You are a pragmatic generalist engineer.',
  backend: 'You specialise in server logic, data, APIs and correctness.',
  frontend: 'You specialise in UI/UX, components, styling and accessibility.',
  'human-sim': 'You act as a demanding user/QA, hardening edge cases and clarity.',
};
const DENY = /embed|whisper|nomic|bge|minilm|clip|rerank|tts|piper/i;
const PREFER = /coder|code|qwen|llama|deepseek|mistral|codestral|gemma|phi|command|granite|starcoder|yi/i;

function args() {
  const a = process.argv.slice(2);
  const file = a[0];
  const task = a[1];
  const write = a.includes('--write');
  const mi = a.indexOf('--members');
  const members = mi >= 0 ? Math.max(1, Math.min(4, Number(a[mi + 1]) || 3)) : 3;
  return { file, task, write, members };
}

function unwrap(raw) {
  let t = String(raw || '').trim();
  const f = t.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/);
  if (f) t = f[1];
  return t.replace(/\r\n/g, '\n');
}

async function tags() {
  try {
    const r = await fetch(`${BASE}/api/tags`);
    if (!r.ok) return [];
    const b = await r.json();
    const names = (b.models || []).map((m) => m.name).filter((n) => n && !DENY.test(n));
    return names.sort((x, y) => Number(PREFER.test(y)) - Number(PREFER.test(x)));
  } catch { return []; }
}

async function generate(model, prompt, numPredict) {
  const r = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, think: false, keep_alive: '30m', options: { temperature: 0.1, num_predict: numPredict }, prompt }),
  });
  if (!r.ok) throw new Error(`${model}: HTTP ${r.status}`);
  const b = await r.json();
  return String(b.response ?? '');
}

function editPrompt(task, path, content, role) {
  const hint = ROLES[role] ? ` ${ROLES[role]}` : '';
  return [
    `You are an expert software engineer.${hint}`,
    'Apply the requested change to the file below.',
    'Return ONLY the COMPLETE updated file contents — no explanations, no markdown fences.',
    'Preserve unrelated code exactly. If the change does not apply, return the file unchanged.',
    '', `Task: ${task}`, '', `File: ${path}`, '---', content,
  ].join('\n');
}

function stats(before, after) {
  const a = before.split('\n'), b = after.split('\n');
  const setB = new Set(b);
  let added = 0, removed = 0;
  for (const l of b) if (!before.includes(l)) added++;
  for (const l of a) if (!setB.has(l)) removed++;
  return { added, removed };
}

async function main() {
  const { file, task, write, members } = args();
  if (!file || !task) {
    console.error('Usage: node scripts/council.mjs <file> "<task>" [--write] [--members N]');
    process.exit(1);
  }
  if (!existsSync(file)) { console.error(`No such file: ${file}`); process.exit(1); }
  const content = readFileSync(file, 'utf8');

  const pool = await tags();
  if (pool.length === 0) {
    console.error(`No usable models found at ${BASE}. Install one, e.g.  ollama pull qwen2.5-coder:7b`);
    process.exit(1);
  }
  const roles = ['coder', 'backend', 'human-sim', 'frontend'].slice(0, members);
  const numPredict = Math.min(8192, Math.max(512, Math.ceil(content.length / 2)));
  console.log(`\n⚖  Council on ${file}\n   task: ${task}\n   members: ${roles.map((r, i) => `${r}=${pool[i % pool.length]}`).join(', ')}\n`);

  const candidates = [];
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i], model = pool[i % pool.length];
    process.stdout.write(`   • ${role} (${model}) … `);
    try {
      const after = unwrap(await generate(model, editPrompt(task, file, content, role), numPredict));
      if (after && after !== content) {
        const s = stats(content, after);
        candidates.push({ role, model, after, s });
        console.log(`+${s.added} -${s.removed}`);
      } else console.log('no change');
    } catch (e) { console.log(`failed (${e.message})`); }
  }
  if (candidates.length === 0) { console.error('\nNo member produced an edit.'); process.exit(1); }

  // Judge.
  let pick = 0;
  if (candidates.length > 1) {
    const listed = candidates.map((c, i) => `### Option ${i} (${c.role} · ${c.model})\n${c.after.slice(0, 1500)}`).join('\n\n');
    const jp = [
      'You are a senior engineer reviewing candidate edits to the same file.',
      `Task: ${task}`, `File: ${file}`, '',
      'Pick the SINGLE best option. Reply with ONLY the option number then a short reason. Example: "1 - clearest and safest".',
      '', listed,
    ].join('\n');
    try {
      const jr = await generate(pool[0], jp, 120);
      const m = jr.match(/\d+/);
      pick = m ? Math.max(0, Math.min(candidates.length - 1, Number(m[0]))) : 0;
      console.log(`\n👩‍⚖  Judge picks Option ${pick} (${candidates[pick].role}) — ${jr.trim().slice(0, 160)}`);
    } catch { console.log('\n👩‍⚖  Judge unavailable — defaulting to Option 0.'); }
  }

  const chosen = candidates[pick];
  if (write) {
    const bak = `${file}.bak-${Date.now()}`;
    copyFileSync(file, bak);
    writeFileSync(file, chosen.after);
    console.log(`\n✓ Applied ${chosen.role}'s edit (${chosen.model}). Backup: ${bak}`);
  } else {
    console.log(`\nWinner: ${chosen.role} (${chosen.model}), +${chosen.s.added} -${chosen.s.removed}. Re-run with --write to apply.\n`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
