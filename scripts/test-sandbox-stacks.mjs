#!/usr/bin/env node
/**
 * test-sandbox-stacks.mjs — Systematically test all sandbox stack × tier deployments.
 * Deploys each combination, validates all pipeline steps pass, then cleans up.
 */

const API = 'http://localhost:3006';

const stacks = ['pern', 'mern', 'nextjs', 't3'];
const tiers = ['basic', 'solid', 'battle-tested', 'vai'];

async function testDeploy(stackId, tier) {
  const start = Date.now();
  try {
    const res = await fetch(`${API}/api/sandbox/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stackId, tier }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { stackId, tier, ok: false, failed: [`HTTP ${res.status}: ${err}`], ms: Date.now() - start };
    }

    const text = await res.text();
    const events = text.trim().split('\n')
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    const projectId = events.find(e => e.projectId)?.projectId;
    const port = events.find(e => e.port)?.port;
    const failed = events.filter(e => e.status === 'failed').map(e => `${e.step}: ${e.message}`);
    const done = events.filter(e => e.status === 'done').map(e => e.step);
    const skipped = events.filter(e => e.status === 'skipped').map(e => e.step);

    // Clean up
    if (projectId) {
      await fetch(`${API}/api/sandbox/${projectId}`, { method: 'DELETE' }).catch(() => {});
    }

    // Wait a moment for port cleanup
    await new Promise(r => setTimeout(r, 1000));

    return { stackId, tier, ok: failed.length === 0, port, done, skipped, failed, ms: Date.now() - start };
  } catch (e) {
    return { stackId, tier, ok: false, failed: [e.message], ms: Date.now() - start };
  }
}

async function run() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  Sandbox Stack × Tier Deployment Test Suite       ║');
  console.log('║  4 stacks × 4 tiers = 16 combinations            ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const results = [];

  for (const stack of stacks) {
    console.log(`── ${stack.toUpperCase()} ──`);
    for (const tier of tiers) {
      process.stdout.write(`  ${stack}-${tier}... `);
      const r = await testDeploy(stack, tier);
      const status = r.ok ? '✓ PASS' : '✗ FAIL';
      const time = `${Math.round(r.ms / 1000)}s`;
      const detail = r.failed.length ? ` [${r.failed.join(', ')}]` : '';
      console.log(`${status} (${time})${detail}`);
      results.push(r);
    }
    console.log('');
  }

  // Summary
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;

  console.log('═══════════════════════════════════════════');
  console.log(`RESULTS: ${pass}/${results.length} passed, ${fail} failed`);
  console.log('═══════════════════════════════════════════');

  if (fail > 0) {
    console.log('\nFailed deployments:');
    results.filter(r => !r.ok).forEach(r => {
      console.log(`  ✗ ${r.stackId}-${r.tier}: ${r.failed.join(', ')}`);
    });
  }

  // Details table
  console.log('\nDetailed results:');
  console.log('Stack          | Tier          | Status | Time | Steps Done            | Skipped');
  console.log('---------------|---------------|--------|------|-----------------------|--------');
  for (const r of results) {
    const status = r.ok ? 'PASS' : 'FAIL';
    const time = `${Math.round(r.ms / 1000)}s`.padEnd(4);
    const done = (r.done || []).join(',').padEnd(21);
    const skip = (r.skipped || []).join(',');
    console.log(`${r.stackId.padEnd(14)} | ${r.tier.padEnd(13)} | ${status.padEnd(6)} | ${time} | ${done} | ${skip}`);
  }

  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
