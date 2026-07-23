#!/usr/bin/env node
import { WebSocket } from 'ws';

const REST_URL = 'http://127.0.0.1:3006';
const WS_URL = 'ws://127.0.0.1:3006/api/chat';
const PROMPT = 'when does the bakery on hommersåk open up? brygge bakeren';
const DEPTHS = (process.env.VAI_PROCESS_DEPTHS || 'quick,balanced,deep')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const HEADERS = { 'x-vai-dev-auth-bypass': '1' };

async function createConversation(depth) {
  const response = await fetch(`${REST_URL}/api/conversations`, {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: `Arbitrary local-business hours verification (${depth})`,
      modelId: 'vai:v0',
      mode: 'agent',
    }),
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

    socket.on('open', () => socket.send(JSON.stringify({
      conversationId,
      content: PROMPT,
      mode: 'agent',
      processDepth,
      allowLearn: false,
    })));
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
  const failures = [];
  const sourceUrls = result.sources.map((source) => source.url ?? '');
  if (result.turnKind !== 'research') failures.push(`turn kind was ${result.turnKind}`);
  if (!sourceUrls[0]?.includes('bryggensenter.no/butikkoversikt')) failures.push('first source was not the first-party tenant page');
  if (!/05[.:]00\s*[-–]\s*18[.:]00/i.test(result.text)) failures.push('weekday hours missing');
  if (!/05[.:]00\s*[-–]\s*17[.:]00/i.test(result.text)) failures.push('Saturday hours missing');
  if (/19[.:]00/.test(result.text)) failures.push('outdated directory hours leaked into the answer');
  if (/don't have information|couldn't find useful|did not include details/i.test(result.text)) failures.push('apology fallback was returned');
  if (/```\s*json|^\s*\{\s*"(?:response|answer|message|text)"\s*:/i.test(result.text)) failures.push('ordinary answer was exposed as JSON/code');
  return failures;
}

const summaries = [];
for (const depth of DEPTHS) {
  const conversationId = await createConversation(depth);
  const result = await runTurn(conversationId, depth);
  const failures = validate(result);
  const summary = {
    processDepth: depth,
    conversationId,
    passed: failures.length === 0,
    failures,
    text: result.text,
    sourceUrls: result.sources.map((source) => source.url),
    turnKind: result.turnKind,
    modelId: result.modelId,
  };
  summaries.push(summary);
  console.log(JSON.stringify(summary, null, 2));
}

if (summaries.some((summary) => !summary.passed)) process.exitCode = 1;
