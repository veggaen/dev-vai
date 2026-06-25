#!/usr/bin/env node
/**
 * council-ui - convene the real multi-model council on a plain UI question and
 * print only useful member notes. Empty progress shells do not count as useful
 * responses; this keeps the overnight findings panel honest.
 */
import { WebSocket } from 'ws';
import { formatCouncilSummary } from './council-summary.mjs';

const args = process.argv.slice(2);
const flagIdx = (name) => args.indexOf(name);
const baseUrl = (flagIdx('--base-url') >= 0 ? args[flagIdx('--base-url') + 1] : null)
  ?? process.env.VAI_API
  ?? 'http://localhost:3006';

const skip = new Set();
args.forEach((arg, index) => {
  if (arg.startsWith('--')) {
    skip.add(index);
    skip.add(index + 1);
  }
});
const question = args.filter((_, index) => !skip.has(index)).join(' ').trim();
if (!question) {
  console.error('need a question');
  process.exit(1);
}

const ws = new WebSocket(`${baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}/api/chat`, {
  headers: { 'x-vai-dev-auth-bypass': '1' },
});
let council = [];
let finished = false;
const TIMEOUT = Number(process.env.COUNCIL_UI_TIMEOUT_MS) || 200_000;
const timer = setTimeout(() => {
  console.error('timeout');
  finish();
}, TIMEOUT);

ws.on('open', () => ws.send(JSON.stringify({
  conversationId: `council-ui-${Date.now()}`,
  content: question,
  mode: 'chat',
  processDepth: 'deep',
  allowLearn: false,
})));

ws.on('message', (data) => {
  let message;
  try { message = JSON.parse(data.toString()); } catch { return; }
  if (message.type === 'progress' && message.progress?.councilMembers?.length) {
    council = message.progress.councilMembers;
  }
  if (message.type === 'done') finish();
});

ws.on('error', (error) => {
  console.error('ws', error.message);
  finish();
});

function finish() {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  console.log(formatCouncilSummary(council));
  try { ws.close(); } catch {}
  process.exit(0);
}
