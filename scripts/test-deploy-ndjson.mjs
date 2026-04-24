/**
 * Direct NDJSON deploy test — validates server events for PERN Basic
 */
import http from 'http';

const RUNTIME_URL = new URL('http://localhost:3006/api/sandbox/deploy');

function postDeploy(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(RUNTIME_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      const events = [];
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.trim()) {
            try { events.push(JSON.parse(line)); } catch {}
          }
        }
      });
      res.on('end', () => resolve(events));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== NDJSON Deploy Test: PERN Basic ===\n');

  const events = await postDeploy({ stackId: 'pern', tier: 'basic' });

  const STEP_WEIGHTS = { scaffold: 10, install: 40, build: 20, docker: 15, test: 10, start: 10, verify: 5 };
  const TIER_NA = 'Not included in this tier';

  console.log(`Total events: ${events.length}\n`);
  for (const e of events) {
    const tag = e.step ? `[${e.step}] ${e.status}: ${e.message || ''}` : JSON.stringify(e).substring(0, 100);
    console.log(`  ${tag}`);
  }

  // Analyze
  const stepEvents = events.filter(e => e.step);
  const skippedNA = stepEvents.filter(e => e.status === 'skipped' && e.message === TIER_NA);
  const uniqueSteps = [...new Set(stepEvents.map(e => e.step))];
  const visibleStepIds = uniqueSteps.filter(s => !skippedNA.some(e => e.step === s));

  console.log(`\nSkipped (N/A): ${skippedNA.map(e => e.step).join(', ') || 'none'}`);
  console.log(`Visible steps: ${visibleStepIds.join(', ')}`);

  // Simulate normalized progress
  const rawTotal = visibleStepIds.reduce((sum, s) => sum + (STEP_WEIGHTS[s] ?? 10), 0);
  let completedFraction = 0;
  // Get final state of each visible step
  const finalState = {};
  for (const e of stepEvents) finalState[e.step] = e.status;
  for (const s of visibleStepIds) {
    const w = (STEP_WEIGHTS[s] ?? 10) / rawTotal;
    if (finalState[s] === 'done' || finalState[s] === 'complete' || finalState[s] === 'skipped') completedFraction += w;
    else if (finalState[s] === 'running') completedFraction += w * 0.5;
  }
  const progress = Math.min(100, Math.round(completedFraction * 100));

  console.log(`\n=== VERDICT ===`);
  console.log(`Docker hidden: ${skippedNA.some(e => e.step === 'docker') ? '✓ YES' : '✗ NO'}`);
  console.log(`Tests hidden: ${skippedNA.some(e => e.step === 'test') ? '✓ YES' : '✗ NO'}`);
  console.log(`rawTotal=${rawTotal} completedFraction=${completedFraction.toFixed(4)}`);
  console.log(`Normalized progress: ${progress}%`);
  console.log(`Would reach 100%: ${progress >= 100 ? '✓ YES' : '✗ NO'}`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
