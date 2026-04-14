/**
 * run-visual-qa.mjs — Trigger the visual QA runner in the user's Chrome.
 *
 * Uses Chrome DevTools Protocol (CDP) to inject window.__vai_qa.run()
 * into the running VeggaAI desktop app at localhost:5173.
 *
 * Usage: node scripts/run-visual-qa.mjs [--verify-only] [--build]
 *
 * The simulated cursor moves visually inside the app — no real mouse hijacking.
 */

import { execSync } from 'node:child_process';

const VERIFY_ONLY = process.argv.includes('--verify-only');
const BUILD_MODE = process.argv.includes('--build');

// Find Chrome's remote debugging port — look for the VeggaAI tab
const CDP_PORT = 9222;

async function findVaiTarget() {
  try {
    const res = await fetch(`http://localhost:${CDP_PORT}/json`);
    const targets = await res.json();
    const vai = targets.find(t =>
      t.url?.includes('localhost:5173') && t.type === 'page'
    );
    return vai;
  } catch {
    return null;
  }
}

async function connectAndRun(wsUrl) {
  // Use native WebSocket (Node 22+)
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    let id = 1;
    const pending = new Map();

    ws.onopen = () => {
      const expression = BUILD_MODE
        ? `window.__vai_qa?.build()?.promise?.then(r => JSON.stringify(r)) ?? 'QA not loaded'`
        : VERIFY_ONLY
          ? `window.__vai_qa?.verify()?.promise?.then(r => JSON.stringify(r)) ?? 'QA not loaded'`
          : `window.__vai_qa?.run()?.promise?.then(r => JSON.stringify(r)) ?? 'QA not loaded'`;

      const msgId = id++;
      pending.set(msgId, resolve);

      ws.send(JSON.stringify({
        id: msgId,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
      }));

      const mode = BUILD_MODE ? 'build' : VERIFY_ONLY ? 'verify' : 'run';
      console.log(`[qa] Injected ${mode} command — watch the browser!`);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const result = msg.result?.result?.value;
        if (result) {
          try {
            const parsed = JSON.parse(result);
            console.log('\n═══ QA Results ═══');
            console.log(`Overall: ${parsed.passed ? '✓ PASSED' : '✗ FAILED'}`);
            for (const step of parsed.steps) {
              console.log(`  ${step.passed ? '✓' : '✗'} ${step.name}: ${step.detail}`);
            }
          } catch {
            console.log('[qa] Result:', result);
          }
        } else if (msg.result?.exceptionDetails) {
          console.error('[qa] Error:', msg.result.exceptionDetails.text);
        }
        pending.get(msg.id)(result);
        ws.close();
      }
    };

    ws.onerror = (err) => {
      reject(new Error(`WebSocket error: ${err.message}`));
    };

    // Timeout after 3 minutes
    setTimeout(() => {
      ws.close();
      reject(new Error('QA timed out after 3 minutes'));
    }, 180000);
  });
}

async function main() {
  console.log(`[qa] Looking for VeggaAI tab on CDP port ${CDP_PORT}...`);

  const target = await findVaiTarget();

  if (!target) {
    console.log('[qa] No VeggaAI tab found via CDP.');
    console.log('[qa] Make sure Chrome is running with --remote-debugging-port=9222');
    console.log('[qa] Or paste this in the browser console:');
    console.log('');
    console.log(BUILD_MODE
      ? '  window.__vai_qa.build()'
      : VERIFY_ONLY
        ? '  window.__vai_qa.verify()'
        : '  window.__vai_qa.run()');
    console.log('');
    console.log('[qa] The simulated cursor will animate through the QA flow.');
    process.exit(0);
  }

  console.log(`[qa] Found: ${target.title} (${target.url})`);
  console.log(`[qa] Connecting to: ${target.webSocketDebuggerUrl}`);

  await connectAndRun(target.webSocketDebuggerUrl);
}

main().catch(err => {
  console.error('[qa] Fatal:', err.message);
  process.exit(1);
});
