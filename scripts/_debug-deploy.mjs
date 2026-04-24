#!/usr/bin/env node
/**
 * Debug script — deploy one template and dump all NDJSON events to a file.
 * Usage: node scripts/_debug-deploy.mjs <stackId> <tier>
 */
import http from 'node:http';
import { writeFileSync } from 'node:fs';

const [stackId, tier] = process.argv.slice(2);
if (!stackId || !tier) {
  console.error('Usage: node scripts/_debug-deploy.mjs <stackId> <tier>');
  process.exit(1);
}

console.log(`Deploying ${stackId}-${tier}...`);
const start = Date.now();

const opts = {
  hostname: 'localhost', port: 3006,
  path: '/api/sandbox/deploy', method: 'POST',
  headers: { 'Content-Type': 'application/json' },
};

const req = http.request(opts, (res) => {
  let data = '';
  res.on('data', (c) => (data += c));
  res.on('end', () => {
    const ms = Date.now() - start;
    const events = data.trim().split('\n').map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    const outFile = `_debug-deploy-${stackId}-${tier}.json`;
    writeFileSync(outFile, JSON.stringify(events, null, 2));
    console.log(`Wrote ${events.length} events to ${outFile} (${Math.round(ms / 1000)}s)`);

    // Print step summary
    const steps = events.filter(e => e.step);
    for (const s of steps) {
      const icon = s.status === 'done' ? 'OK' : s.status === 'failed' ? 'FAIL' : s.status;
      const extra = [];
      if (s.port) extra.push(`port=${s.port}`);
      if (s.projectId) extra.push(`id=${s.projectId}`);
      if (s.elapsed) extra.push(`${Math.round(s.elapsed / 1000)}s`);
      console.log(`  ${icon.padEnd(8)} ${s.step.padEnd(12)} ${s.message || ''} ${extra.join(' ')}`);
      if (s.status === 'failed' && s.detail) {
        console.log(`           ${s.detail.slice(0, 300)}`);
      }
    }
  });
});

req.on('error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

req.write(JSON.stringify({ stackId, tier }));
req.end();
