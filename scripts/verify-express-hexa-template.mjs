#!/usr/bin/env node
/**
 * End-to-end check for the gallery template `express-hexa` (hexagonal Express API).
 *
 * Flow: POST /api/sandbox/from-template → install → start → HTTP checks on /api/health, /api/rooms, POST book.
 *
 * This is separate from **stack deploys** (pern / mern / nextjs / t3 / vinext / game × basic|solid|battle-tested|vai),
 * which live under packages/runtime/src/sandbox/stacks/ and use mergeFiles() for tier inheritance.
 * Gallery templates live in packages/runtime/src/sandbox/templates.ts (list: GET /api/sandbox/templates).
 *
 * Requires runtime (e.g. pnpm dev:web) on VAI_API / VAI_API_BASE / default http://127.0.0.1:3006
 *
 *   node scripts/verify-express-hexa-template.mjs
 *   node scripts/verify-express-hexa-template.mjs http://127.0.0.1:3006
 */

const DEFAULT_BASE = process.env.VAI_API?.trim() || process.env.VAI_API_BASE?.trim() || 'http://127.0.0.1:3006';

function parseBase(argv) {
  const pos = argv.find((a) => /^https?:\/\//i.test(a));
  return (pos || DEFAULT_BASE).replace(/\/$/, '');
}

async function fetchHealth(baseUrl) {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) throw new Error(`/health ${res.status}`);
}

async function createFromTemplate(baseUrl, templateId, name) {
  const res = await fetch(`${baseUrl}/api/sandbox/from-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, name }),
  });
  if (!res.ok) throw new Error(`from-template: ${res.status} ${await res.text()}`);
  return res.json();
}

async function installSandbox(baseUrl, projectId) {
  const res = await fetch(`${baseUrl}/api/sandbox/${projectId}/install`, { method: 'POST' });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`install failed: ${JSON.stringify(json)}`);
  }
}

async function startSandbox(baseUrl, projectId) {
  const res = await fetch(`${baseUrl}/api/sandbox/${projectId}/start`, { method: 'POST' });
  if (!res.ok) throw new Error(`start: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getSandbox(baseUrl, projectId) {
  const res = await fetch(`${baseUrl}/api/sandbox/${projectId}`);
  if (!res.ok) throw new Error(`get sandbox: ${res.status}`);
  return res.json();
}

async function waitForRunning(baseUrl, projectId, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = await getSandbox(baseUrl, projectId);
    if (j.status === 'failed') {
      throw new Error(`sandbox failed: ${JSON.stringify(j.logs?.slice?.(-12) ?? j)}`);
    }
    if (j.status === 'running' && j.devPort) return j;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('timeout waiting for dev server');
}

async function fetchApi(port, path, opts = {}) {
  const hosts = ['127.0.0.1', 'localhost'];
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    for (const host of hosts) {
      const url = `http://${host}:${port}${path}`;
      try {
        const res = await fetch(url, {
          method: opts.method || 'GET',
          headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
          body: opts.body,
        });
        return res;
      } catch (e) {
        lastErr = e;
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw lastErr ?? new Error(`fetch ${path} timeout`);
}

async function main() {
  const baseUrl = parseBase(process.argv.slice(2));
  await fetchHealth(baseUrl);

  const name = `hexa-verify-${Date.now()}`;
  console.log(`verify-express-hexa-template: creating from-template express-hexa (${name})...`);
  const created = await createFromTemplate(baseUrl, 'express-hexa', name);
  const projectId = created.id;
  if (!projectId) throw new Error('no project id');

  console.log('verify-express-hexa-template: install...');
  await installSandbox(baseUrl, projectId);

  console.log('verify-express-hexa-template: start...');
  await startSandbox(baseUrl, projectId);

  const running = await waitForRunning(baseUrl, projectId);
  const port = running.devPort;
  console.log('verify-express-hexa-template: dev port', port);

  const health = await fetchApi(port, '/api/health');
  if (!health.ok) throw new Error(`/api/health ${health.status}`);
  const healthJson = await health.json();
  if (healthJson.status !== 'ok') {
    throw new Error(`unexpected health body: ${JSON.stringify(healthJson)}`);
  }

  const roomsRes = await fetchApi(port, '/api/rooms');
  if (!roomsRes.ok) throw new Error(`/api/rooms ${roomsRes.status}`);
  const roomsJson = await roomsRes.json();
  if (!Array.isArray(roomsJson.rooms) || roomsJson.rooms.length < 2) {
    throw new Error(`expected >=2 rooms: ${JSON.stringify(roomsJson)}`);
  }

  const bookRes = await fetchApi(port, '/api/rooms/r1/book', { method: 'POST' });
  if (bookRes.status !== 201) {
    const t = await bookRes.text();
    throw new Error(`POST book expected 201, got ${bookRes.status}: ${t.slice(0, 200)}`);
  }

  const roomsAfter = await (await fetchApi(port, '/api/rooms')).json();
  const r1 = roomsAfter.rooms.find((r) => r.id === 'r1');
  if (!r1 || r1.available !== false) {
    throw new Error(`expected r1 booked (available false): ${JSON.stringify(r1)}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        templateId: 'express-hexa',
        projectId,
        previewUrl: `http://127.0.0.1:${port}/`,
        checks: ['GET /api/health', 'GET /api/rooms', 'POST /api/rooms/r1/book', 'rooms state'],
      },
      null,
      2,
    ),
  );
  console.log('verify-express-hexa-template: PASS');
}

main().catch((e) => {
  console.error('verify-express-hexa-template: FAIL', e?.message ?? e);
  process.exit(1);
});
