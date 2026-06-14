#!/usr/bin/env node
/** Quick live probe: Agent mode Tinder clone build over /api/chat */
import { WebSocket } from 'ws';

const wsUrl = `${(process.env.VAI_API ?? 'http://127.0.0.1:3006').replace(/^http/i, 'ws').replace(/\/$/, '')}/api/chat?devAuthBypass=1`;
const prompt = process.argv.slice(2).join(' ') || 'Build a 100% accurate Tinder clone — card stack swipe UI, like/nope buttons, match overlay, bottom nav (Home, Explore, Likes, Messages, Profile), gradient logo, photo carousel dots, age/distance badges, super like button. React + Vite, offline-ready with placeholder photos. Ship complete runnable files.';
const FILE_BLOCK_RE = /```[\s\S]*?title="([^"]+)"[\s\S]*?```/g;

const out = { text: '', progress: [], fallback: null, error: null, modelId: null, strategy: null };
const started = Date.now();

await new Promise((resolve, reject) => {
  const ws = new WebSocket(wsUrl);
  const timer = setTimeout(() => {
    ws.close();
    reject(new Error(`timeout after 420s (${out.text.length} chars)`));
  }, 420_000);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      conversationId: `agent-tinder-probe-${Date.now()}`,
      content: prompt,
      modelId: 'vai:v0',
      mode: 'agent',
      allowLearn: false,
    }));
  });

  ws.on('message', (raw) => {
    let chunk;
    try { chunk = JSON.parse(raw.toString()); } catch { return; }
    if (chunk.type === 'text_delta' && chunk.textDelta) out.text += chunk.textDelta;
    if (chunk.type === 'progress' && chunk.progress?.label) {
      out.progress.push(`${chunk.progress.label}${chunk.progress.status === 'running' ? ' [running]' : ''}`);
    }
    if (chunk.type === 'fallback_notice') out.fallback = chunk.fallback;
    if (chunk.type === 'error') {
      out.error = chunk.error;
      clearTimeout(timer);
      ws.close();
      resolve();
    }
    if (chunk.type === 'done') {
      out.modelId = chunk.modelId ?? chunk.thinking?.modelTag ?? null;
      out.strategy = chunk.thinking?.strategy ?? null;
      clearTimeout(timer);
      ws.close();
      resolve();
    }
  });

  ws.on('error', (err) => {
    clearTimeout(timer);
    reject(err);
  });
});

const files = [...out.text.matchAll(FILE_BLOCK_RE)].map((match) => match[1]);
const report = {
  elapsedMs: Date.now() - started,
  modelId: out.modelId,
  strategy: out.strategy,
  fallback: out.fallback,
  error: out.error,
  answerChars: out.text.length,
  fileCount: files.length,
  files,
  hasPackageJson: files.some((path) => path.endsWith('package.json')),
  stillWorkflowAdvice: /Reference-driven build workflow/i.test(out.text),
  progressTail: out.progress.slice(-15),
  preview: out.text.slice(0, 400).replace(/\s+/g, ' '),
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.fileCount > 0 && report.hasPackageJson ? 0 : 1);
