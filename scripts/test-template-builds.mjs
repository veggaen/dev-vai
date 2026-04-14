#!/usr/bin/env node
/**
 * Test template build verification — deploys each template and reports pass/fail.
 * Usage: node scripts/test-template-builds.mjs [combo1] [combo2] ...
 * Example: node scripts/test-template-builds.mjs pern-vai mern-vai
 * Default: tests all 16 combos
 */

import http from 'node:http';

const ALL_COMBOS = [
  ['pern', 'basic'], ['pern', 'solid'], ['pern', 'battle-tested'], ['pern', 'vai'],
  ['mern', 'basic'], ['mern', 'solid'], ['mern', 'battle-tested'], ['mern', 'vai'],
  ['nextjs', 'basic'], ['nextjs', 'solid'], ['nextjs', 'battle-tested'], ['nextjs', 'vai'],
  ['t3', 'basic'], ['t3', 'solid'], ['t3', 'battle-tested'], ['t3', 'vai'],
  ['vinext', 'basic'], ['vinext', 'solid'], ['vinext', 'battle-tested'], ['vinext', 'vai'],
];

const args = process.argv.slice(2);
const combos = args.length
  ? args.map(a => { const idx = a.indexOf('-'); return [a.slice(0, idx), a.slice(idx + 1)]; })
  : ALL_COMBOS;

async function deploy(stackId, tier) {
  return new Promise((resolve) => {
    const start = Date.now();
    const opts = {
      hostname: 'localhost', port: 3006,
      path: '/api/sandbox/deploy', method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        const ms = Date.now() - start;
        const lines = data.trim().split('\n').map(l => {
          try { return JSON.parse(l); } catch { return l; }
        });
        const steps = lines.filter(l => typeof l === 'object' && l.step);
        const failed = steps.filter(s => s.status === 'failed');
        const passed = steps.filter(s => s.status === 'done');
        const tag = `${stackId}-${tier}`;
        resolve({ tag, ms, failed, passed, steps });
      });
    });
    req.on('error', (err) => {
      resolve({ tag: `${stackId}-${tier}`, ms: 0, failed: [{ step: 'connect', message: err.message }], passed: [], steps: [] });
    });
    req.write(JSON.stringify({ stackId, tier }));
    req.end();
  });
}

const results = [];
for (const [stackId, tier] of combos) {
  const tag = `${stackId}-${tier}`;
  process.stdout.write(`Testing ${tag}...`);
  const r = await deploy(stackId, tier);
  if (r.failed.length) {
    console.log(` FAIL (${Math.round(r.ms / 1000)}s)`);
    r.failed.forEach(f => console.log(`  ${f.step}: ${(f.message || '').slice(0, 150)}`));
  } else {
    const ok = r.passed.map(p => p.step).join(',');
    console.log(` PASS (${Math.round(r.ms / 1000)}s) [${ok}]`);
  }
  results.push(r);
}

// Summary
console.log('\n--- Summary ---');
const pass = results.filter(r => r.failed.length === 0);
const fail = results.filter(r => r.failed.length > 0);
console.log(`${pass.length}/${results.length} passed`);
if (fail.length) {
  console.log('Failures:');
  fail.forEach(f => {
    const failSteps = f.failed.map(s => s.step).join(',');
    console.log(`  ${f.tag}: ${failSteps}`);
  });
}
