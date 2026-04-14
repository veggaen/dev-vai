/**
 * Direct SSE deploy test — bypasses UI entirely to validate:
 * 1. Server emits correct events for PERN Basic
 * 2. Docker step = skipped with "Not included in this tier"
 * 3. Tests step = skipped with "Not included in this tier"
 * 4. Progress calculation with normalized weights would hit 100%
 */
import http from 'http';

const RUNTIME = 'http://localhost:3006';

function sseRequest(url) {
  return new Promise((resolve, reject) => {
    const events = [];
    http.get(url, res => {
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              events.push(data);
            } catch {}
          }
        }
      });
      res.on('end', () => resolve(events));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== Direct SSE Deploy Test: PERN Basic ===\n');

  const url = `${RUNTIME}/api/sandbox/deploy?stackId=pern&tier=basic`;
  console.log(`Requesting: ${url}\n`);

  const events = await sseRequest(url);

  // Analyze step events
  const STEP_WEIGHTS = { scaffold: 10, install: 40, build: 20, docker: 15, test: 10, start: 10, verify: 5 };
  const TIER_NA = 'Not included in this tier';

  const stepEvents = events.filter(e => e.step);
  const skippedNA = stepEvents.filter(e => e.status === 'skipped' && e.message === TIER_NA);
  const visibleSteps = stepEvents.filter(e => !(e.status === 'skipped' && e.message === TIER_NA));

  console.log(`Total events: ${events.length}`);
  console.log(`Step events: ${stepEvents.length}`);
  console.log(`Skipped (N/A): ${skippedNA.map(e => e.step).join(', ') || 'none'}`);
  console.log(`Visible steps: ${[...new Set(visibleSteps.map(e => e.step))].join(', ')}\n`);

  // Simulate normalized progress calculation
  const uniqueVisible = [...new Set(visibleSteps.map(e => e.step))];
  const rawTotal = uniqueVisible.reduce((sum, s) => sum + (STEP_WEIGHTS[s] || 5), 0);
  const normalizedWeights = {};
  for (const s of uniqueVisible) {
    normalizedWeights[s] = ((STEP_WEIGHTS[s] || 5) / rawTotal) * 100;
  }

  console.log('Normalized weights (visible steps only):');
  for (const [s, w] of Object.entries(normalizedWeights)) {
    console.log(`  ${s}: ${w.toFixed(1)}%`);
  }
  console.log(`  Total: ${Object.values(normalizedWeights).reduce((a, b) => a + b, 0).toFixed(1)}%`);

  // Check final states
  const finalStates = {};
  for (const e of stepEvents) {
    finalStates[e.step] = e.status;
  }

  console.log('\nFinal step states:');
  for (const [step, status] of Object.entries(finalStates)) {
    const isNA = skippedNA.some(e => e.step === step);
    console.log(`  ${step}: ${status}${isNA ? ' (hidden - N/A)' : ''}`);
  }

  // Calculate what progress would show
  let progress = 0;
  for (const step of uniqueVisible) {
    const state = finalStates[step];
    if (state === 'complete' || state === 'done') {
      progress += normalizedWeights[step];
    } else if (state === 'running') {
      progress += normalizedWeights[step] * 0.5;
    } else if (state === 'skipped') {
      progress += normalizedWeights[step]; // skipped counts as done
    }
  }

  console.log(`\n=== VERDICT ===`);
  console.log(`Docker step hidden: ${skippedNA.some(e => e.step === 'docker') ? '✓ YES' : '✗ NO'}`);
  console.log(`Tests step hidden: ${skippedNA.some(e => e.step === 'test') ? '✓ YES' : '✗ NO'}`);
  console.log(`Calculated progress: ${Math.min(100, Math.round(progress))}%`);
  console.log(`Would show 100%: ${Math.round(progress) >= 100 ? '✓ YES' : '✗ NO'}`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
