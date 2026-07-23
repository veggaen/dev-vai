#!/usr/bin/env node
import { WebSocket } from 'ws';

const REST_URL = process.env.VAI_REST_URL || 'http://127.0.0.1:3006';
const WS_URL = process.env.VAI_WS_URL || 'ws://127.0.0.1:3006/api/chat';
const HEADERS = { 'x-vai-dev-auth-bypass': '1' };
const DEPTHS = (process.env.VAI_PROCESS_DEPTHS || 'quick')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const CASES = [
  {
    id: 'apple-new-york',
    prompt: 'Store hours for Apple Fifth Avenue',
    officialHosts: ['apple.com'],
    requiredIdentity: /apple|fifth\s+avenue/i,
    forbiddenIdentity: /upper\s+east\s+side/i,
  },
  {
    id: 'harrods-london',
    prompt: 'What time does Harrods Knightsbridge shut tonight?',
    officialHosts: ['harrods.com'],
    requiredIdentity: /harrods|knightsbridge/i,
  },
  {
    id: 'uniqlo-ginza',
    prompt: 'Is the UNIQLO Ginza store open on Sunday?',
    officialHosts: ['uniqlo.com', 'ginza.jp'],
    requiredIdentity: /uniqlo|ginza|銀座/i,
    forbiddenIdentity: /shinjuku|新宿/i,
  },
  {
    id: 'zara-madrid-es',
    prompt: '¿A qué hora abre Zara Gran Vía Madrid?',
    officialHosts: ['zara.com'],
    requiredIdentity: /zara|gran\s+via|madrid/i,
    forbiddenIdentity: /fuencarral|castellana/i,
  },
  {
    id: 'ikea-paris-fr',
    prompt: 'À quelle heure ouvre IKEA Paris Rivoli ?',
    officialHosts: ['ikea.com'],
    requiredIdentity: /ikea|paris|rivoli/i,
  },
  {
    id: 'kadewe-berlin-de',
    prompt: 'Wann öffnet KaDeWe Berlin?',
    officialHosts: ['kadewe.de'],
    requiredIdentity: /kadewe|berlin/i,
  },
];

const requestedCaseIds = new Set((process.env.VAI_GLOBAL_CASE_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean));
const selectedCases = requestedCaseIds.size > 0
  ? CASES.filter((entry) => requestedCaseIds.has(entry.id))
  : CASES;

async function createConversation(testCase, depth) {
  const response = await fetch(`${REST_URL}/api/conversations`, {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: `Global shop practical matrix: ${testCase.id} (${depth})`,
      modelId: 'vai:v0',
      mode: 'agent',
    }),
  });
  if (!response.ok) throw new Error(`Conversation create failed (${response.status}): ${await response.text()}`);
  return (await response.json()).id;
}

function runTurn(testCase, conversationId, processDepth) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL, { headers: HEADERS });
    const result = { processDepth, conversationId, text: '', turnKind: null, sources: [] };
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${testCase.id}/${processDepth} timed out`));
    }, 300_000);

    socket.on('open', () => socket.send(JSON.stringify({
      conversationId,
      content: testCase.prompt,
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
      if (message.type === 'error') {
        clearTimeout(timeout);
        socket.close();
        reject(new Error(message.error ?? `${testCase.id}/${processDepth} returned an error`));
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

function validate(testCase, result) {
  const failures = [];
  const firstSource = result.sources[0];
  const firstUrl = firstSource?.url ?? '';
  const sourceIdentity = `${firstSource?.title ?? ''} ${firstSource?.text ?? ''} ${firstUrl}`;
  if (result.turnKind !== 'research') failures.push(`turn kind was ${result.turnKind}`);
  if (!testCase.officialHosts.some((host) => firstUrl.includes(host))) {
    failures.push(`first source was not official (${firstUrl || 'none'})`);
  }
  if (!testCase.requiredIdentity.test(sourceIdentity)) failures.push('requested branch identity missing from first source');
  if (testCase.forbiddenIdentity?.test(sourceIdentity)) failures.push('wrong branch identity appeared in first source');
  if (!/(?:\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b(?:[01]?\d|2[0-3])\.[0-5]\d(?!\.)|\b(?:[01]?\d|2[0-3])h[0-5]\d\b|\b(?:[01]?\d|2[0-3])\s*[-–—]\s*(?:[01]?\d|2[0-3])\s*(?:uhr|h)\b|\b(?:1[0-2]|0?[1-9])\s*(?:a\.?m\.?|p\.?m\.?)\b|24\/7|24\s+hours?)/i.test(result.text)) {
    failures.push('clock-bearing hours missing from answer');
  }
  if (/don't have|do not have|couldn't find|didn't find|no specific information|provided draft|general information/i.test(result.text)) {
    failures.push('apology or unsupported fallback was returned');
  }
  return failures;
}

const summaries = [];
for (const testCase of selectedCases) {
  for (const depth of DEPTHS) {
    const conversationId = await createConversation(testCase, depth);
    const result = await runTurn(testCase, conversationId, depth);
    const failures = validate(testCase, result);
    const summary = {
      id: testCase.id,
      processDepth: depth,
      conversationId,
      passed: failures.length === 0,
      failures,
      prompt: testCase.prompt,
      answer: result.text,
      firstSource: result.sources[0]?.url ?? null,
      firstTrust: result.sources[0]?.trust?.tier ?? null,
    };
    summaries.push(summary);
    console.log(JSON.stringify(summary, null, 2));
  }
}

if (summaries.some((summary) => !summary.passed)) process.exitCode = 1;
