#!/usr/bin/env node
const API = 'http://localhost:3006';

async function test(stack, tier) {
  const start = Date.now();
  try {
    const r = await fetch(`${API}/api/sandbox/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stackId: stack, tier }),
    });
    const txt = await r.text();
    const events = txt.trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const failed = events.filter(e => e.status === 'failed');
    const pid = events.find(e => e.projectId)?.projectId;
    const port = events.find(e => e.port)?.port;
    const ms = Date.now() - start;
    if (failed.length) {
      console.log(`FAIL ${stack}-${tier} (${Math.round(ms / 1000)}s)`);
      failed.forEach(f => {
        console.log(`     ${f.step}: ${f.message}`);
        if (f.detail) console.log(`     DETAIL: ${f.detail.slice(0, 300)}`);
      });
    } else {
      console.log(`PASS ${stack}-${tier} port=${port} (${Math.round(ms / 1000)}s)`);
    }
    if (pid) await fetch(`${API}/api/sandbox/${pid}`, { method: 'DELETE' }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    console.log(`ERR ${stack}-${tier}: ${e.message}`);
  }
}

async function run() {
  const combos = [
    ['pern', 'solid'], ['pern', 'battle-tested'], ['pern', 'vai'],
    ['mern', 'basic'], ['mern', 'solid'],
    ['nextjs', 'basic'], ['nextjs', 'solid'],
    ['t3', 'basic'], ['t3', 'solid'],
  ];
  for (const [s, t] of combos) await test(s, t);
  console.log('\nDone!');
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
