#!/usr/bin/env node
import { WebSocket } from 'ws';

const REST_URL = 'http://127.0.0.1:3006';
const WS_URL = 'ws://127.0.0.1:3006/api/chat';
const PRICE_PROMPT = 'hello, what is the price of visiting the snow park in oslo the snø and what are their prices?';
const HOURS_PROMPT = 'what are their opening hours?';
const DEPTHS = (process.env.VAI_PROCESS_DEPTHS || 'quick,balanced,deep')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const HEADERS = { 'x-vai-dev-auth-bypass': '1' };

async function createConversation(depth) {
  const response = await fetch(`${REST_URL}/api/conversations`, {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ title: `Venue hours follow-up verification (${depth})`, modelId: 'vai:v0', mode: 'agent' }),
  });
  if (!response.ok) throw new Error(`Conversation create failed (${response.status}): ${await response.text()}`);
  return (await response.json()).id;
}

function runTurn(conversationId, processDepth, content) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL, { headers: HEADERS });
    const result = { processDepth, conversationId, content, text: '', turnKind: null, modelId: null, sources: [], progress: [] };
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${processDepth} timed out for ${content}`));
    }, 300_000);

    socket.on('open', () => socket.send(JSON.stringify({
      conversationId,
      content,
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

function validateHours(result) {
  const sourceUrls = result.sources.map((source) => source.url ?? '');
  const failures = [];
  if (result.turnKind !== 'research') failures.push(`turn kind was ${result.turnKind}`);
  if (!sourceUrls.some((url) => url.includes('snooslo.no/no/opening-hours'))) failures.push('official opening-hours source missing');
  if (!/10:00\s*[-–]\s*17:00/i.test(result.text)) failures.push('published Alpine/Park time missing');
  if (!/Alpine\/Park/i.test(result.text) || !/cross-country/i.test(result.text)) failures.push('snow-zone areas are not distinguished');
  if (/395\s*kr|445\s*kr|495\s*kr|Admission prices/i.test(result.text)) failures.push('prior price answer leaked into hours answer');
  if (/```\s*json|^\s*\{\s*"(?:response|answer|message|text)"\s*:/i.test(result.text)) failures.push('ordinary answer was exposed as JSON/code');
  return failures;
}

const results = [];
for (const depth of DEPTHS) {
  const conversationId = await createConversation(depth);
  const price = await runTurn(conversationId, depth, PRICE_PROMPT);
  const hours = await runTurn(conversationId, depth, HOURS_PROMPT);
  const failures = validateHours(hours);
  const summary = {
    processDepth: depth,
    conversationId,
    passed: failures.length === 0,
    failures,
    priceContextEstablished: /395\s*kr/i.test(price.text),
    hoursText: hours.text,
    sourceUrls: hours.sources.map((source) => source.url),
    turnKind: hours.turnKind,
    modelId: hours.modelId,
  };
  results.push(summary);
  console.log(JSON.stringify(summary, null, 2));
}

if (results.some((result) => !result.passed || !result.priceContextEstablished)) process.exitCode = 1;
