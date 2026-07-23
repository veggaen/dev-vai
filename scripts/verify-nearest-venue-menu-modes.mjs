#!/usr/bin/env node
import { WebSocket } from 'ws';

const REST_URL = process.env.VAI_REST_URL || 'http://127.0.0.1:3006';
const WS_URL = process.env.VAI_WS_URL || 'ws://127.0.0.1:3006/api/chat';
const HEADERS = { 'x-vai-dev-auth-bypass': '1' };
const DEPTHS = (process.env.VAI_PROCESS_DEPTHS || 'quick,balanced,deep')
  .split(',').map((value) => value.trim()).filter(Boolean);
const PROMPTS = (process.env.VAI_NEAREST_MENU_PROMPTS || [
  "can you find meny of jønk' burgers closest to bygøy",
  'menu for the Jønk Burger nearest Bygdøy',
  'finn menyen til Jønk Burger nærmest Bygdøy',
].join('||')).split('||').map((value) => value.trim()).filter(Boolean);

async function createConversation(prompt, depth) {
  const response = await fetch(`${REST_URL}/api/conversations`, {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ title: `Nearest venue menu: ${depth}`, modelId: 'vai:v0', mode: 'agent' }),
  });
  if (!response.ok) throw new Error(`Conversation create failed (${response.status}): ${await response.text()}`);
  return (await response.json()).id;
}

function runTurn(prompt, conversationId, processDepth) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL, { headers: HEADERS });
    const result = { processDepth, conversationId, text: '', turnKind: null, sources: [] };
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`${processDepth} timed out`));
    }, 300_000);
    socket.on('open', () => socket.send(JSON.stringify({
      conversationId, content: prompt, mode: 'agent', processDepth, allowLearn: false,
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
        reject(new Error(message.error ?? 'Turn returned an error'));
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
  const sourceText = result.sources.map((source) => `${source.title} ${source.url} ${source.text}`).join(' ');
  if (result.turnKind !== 'research') failures.push(`turn kind was ${result.turnKind}`);
  if (!/closest verified branch:\*\*\s*jØnk colosseum|closest verified branch.*jØnk colosseum/iu.test(result.text)) failures.push('nearest Colosseum branch missing');
  const itemRows = result.text.match(/^- \*\*[^\n]+\*\* — (?:from\s+)?[^\n]*\bNOK\b/gimu) ?? [];
  if (itemRows.length < 3) failures.push(`itemized menu rows missing (${itemRows.length})`);
  if (!/foodora\.no\/.*jonk-colosseum/iu.test(sourceText)) failures.push('exact transactional Colosseum menu source missing');
  if (!/openstreetmap\.org/iu.test(sourceText)) failures.push('proximity source missing');
  if (/JØNK Grønland/iu.test(result.text)) failures.push('wrong Grønland branch leaked into answer');
  if (/couldn(?:'|’)t verify|couldn(?:'|’)t reliably|won(?:'|’)t substitute|directory listing/iu.test(result.text)) failures.push('verification limitation returned');
  return failures;
}

const summaries = [];
for (const prompt of PROMPTS) {
  for (const depth of DEPTHS) {
    const conversationId = await createConversation(prompt, depth);
    const result = await runTurn(prompt, conversationId, depth);
    const failures = validate(result);
    const summary = {
      prompt,
      processDepth: depth,
      conversationId,
      passed: failures.length === 0,
      failures,
      answer: result.text,
      sources: result.sources.map((source) => ({ title: source.title, url: source.url, trust: source.trust?.tier })),
    };
    summaries.push(summary);
    console.log(JSON.stringify(summary, null, 2));
  }
}

if (summaries.some((summary) => !summary.passed)) process.exitCode = 1;
