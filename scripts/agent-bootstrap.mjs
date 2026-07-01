#!/usr/bin/env node
/**
 * Print Vai's agent tooling map without requiring the runtime to be up.
 * If the runtime is healthy, also report the live /api/agent/introspect shape.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const GUIDE_PATH = path.join(ROOT, 'docs', 'agent-tooling-guide.json');
const INTROSPECT_URL = process.env.VAI_INTROSPECT_URL ?? 'http://127.0.0.1:3006/api/agent/introspect';

function readJson(file) {
  if (!existsSync(file)) throw new Error(`missing ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function printCommandTable(commands) {
  const width = Math.max(...commands.map((cmd) => cmd.id.length), 2);
  for (const cmd of commands) {
    console.log(`  ${cmd.id.padEnd(width)}  [${cmd.cost}] ${cmd.command}`);
    console.log(`  ${' '.repeat(width)}   ${cmd.use}`);
  }
}

async function fetchIntrospect() {
  try {
    const res = await fetch(INTROSPECT_URL, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { ok: false, reason: `${res.status} ${res.statusText}` };
    return { ok: true, body: await res.json() };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

const guide = readJson(GUIDE_PATH);
const live = await fetchIntrospect();

console.log('Vai agent bootstrap');
console.log(`Guide: ${path.relative(ROOT, GUIDE_PATH).replaceAll(path.sep, '/')}`);
console.log('');

console.log('Principles');
for (const item of guide.principles ?? []) console.log(`- ${item}`);
console.log('');

console.log('Bootstrap order');
for (const [index, step] of (guide.bootstrapOrder ?? []).entries()) console.log(`${index + 1}. ${step}`);
console.log('');

console.log('Commands');
printCommandTable(guide.commands ?? []);
console.log('');

console.log('Delegation');
console.log(`- Codex: ${guide.delegation?.localCodex ?? 'n/a'}`);
console.log(`- Vai Council: ${guide.delegation?.vaiCouncil ?? 'n/a'}`);
console.log(`- Visibility: ${guide.delegation?.visibility ?? 'n/a'}`);
console.log('');

if (live.ok) {
  const body = live.body;
  const models = Array.isArray(body.models) ? body.models.map((model) => model.id).slice(0, 8) : [];
  const pipeline = body.builderCouncil?.freshPipeline?.slice?.(0, 4) ?? [];
  console.log('Live runtime');
  console.log(`- identity: ${body.identity?.name ?? 'unknown'}`);
  console.log(`- models: ${models.length ? models.join(', ') : 'none reported'}`);
  console.log(`- builder pipeline: ${pipeline.join(' -> ') || 'none reported'}`);
  console.log(`- introspect tooling: ${body.agentTooling ? 'available' : 'missing'}`);
} else {
  console.log('Live runtime');
  console.log(`- offline or unavailable: ${live.reason}`);
  console.log('- start/check with: pnpm vai:status');
}
