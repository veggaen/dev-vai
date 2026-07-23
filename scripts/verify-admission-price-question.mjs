#!/usr/bin/env node
import { WebSocket } from 'ws';

const REST_URL = 'http://127.0.0.1:3006';
const WS_URL = 'ws://127.0.0.1:3006/api/chat';
const PROMPT = 'hello, what is the price of visiting the snow park in oslo the snø and what are their prices?';
const DEPTHS = ['quick', 'balanced', 'deep'];
const HEADERS = { 'x-vai-dev-auth-bypass': '1' };

async function createConversation(depth) {
  const response = await fetch(`${REST_URL}/api/conversations`, {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ title: `Admission price verification (${depth})`, modelId: 'vai:v0', mode: 'agent' }),
  });
  if (!response.ok) throw new Error(`Conversation create failed (${response.status}): ${await response.text()}`);
  return (await response.json()).id;
}

function runTurn(conversationId, processDepth) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL, { headers: HEADERS });
    const result = { processDepth, conversationId, text: '', turnKind: null, modelId: null, sources: [], progress: [] };
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${processDepth} timed out`));
    }, 300_000);

    socket.on('open', () => {
      socket.send(JSON.stringify({
        conversationId,
        content: PROMPT,
        mode: 'agent',
        processDepth,
        allowLearn: false,
      }));
    });
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === 'text_delta') result.text += message.textDelta ?? '';
      if (message.type === 'turn_kind') result.turnKind = message.turnKind ?? null;
      if (message.type === 'sources') result.sources.push(...(message.sources ?? []));
      if (message.type === 'progress' && message.progress?.label) result.progress.push(message.progress.label);
      if (message.modelId) result.modelId = message.modelId;
      if (message.type === 'error') {
        clearTimeout(timeout);
        socket.close();
        reject(new Error(message.error ?? `${processDepth} returned an error`));
      }
      if (message.type === 'done') {
        clearTimeout(timeout);
        socket.close();
        resolve(result);
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function validate(result) {
  const sourceUrls = result.sources.map((source) => source.url ?? '');
  const failures = [];
  if (result.turnKind !== 'research') failures.push(`turn kind was ${result.turnKind}`);
  if (!sourceUrls.some((url) => url.includes('snooslo.no/no/products'))) failures.push('official SNØ source missing');
  if (!/395\s*kr/i.test(result.text) || !/145\s*kr/i.test(result.text) || !/495\s*kr/i.test(result.text)) {
    failures.push('expected current ticket prices missing');
  }
  if (/```\s*json|^\s*\{\s*"(?:response|answer|message|text)"\s*:/i.test(result.text)) {
    failures.push('ordinary answer was exposed as JSON/code');
  }
  if (/don't have real-time data|do not have real-time data/i.test(result.text)) failures.push('returned the old live-data decline');
  return failures;
}

const results = [];
for (const depth of DEPTHS) {
  const conversationId = await createConversation(depth);
  const result = await runTurn(conversationId, depth);
  const failures = validate(result);
  results.push({ ...result, passed: failures.length === 0, failures });
  console.log(JSON.stringify(results.at(-1), null, 2));
}

if (results.some((result) => !result.passed)) process.exitCode = 1;
