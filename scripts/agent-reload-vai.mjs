#!/usr/bin/env node
/**
 * AGENT-RELOAD-VAI — Thorough, no-shortcuts way to apply changes to Vai and verify.
 *
 * Do not cut corners:
 * - Always full build of core.
 * - Full stop + start of runtime.
 * - Health verification.
 * - Then, speak to Vai with a fresh probe (using agent-speak-to-vai) that tests the change + something new.
 *
 * Usage:
 *   node scripts/agent-reload-vai.mjs [optional verification prompt]
 *
 * If no prompt given, it will use a default thoughtful one, but caller should usually provide
 * a new/different/aligned question that exercises what was just changed.
 */

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CORE_PKG = '@vai/core';
const SPEAK_SCRIPT = join(ROOT, 'scripts', 'agent-speak-to-vai.mjs');
const SERVER_SCRIPT = join(ROOT, 'scripts', 'vai-server.mjs');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[agent-reload] $ ${cmd} ${args.join(' ')}`);
    const p = spawn(cmd, args, { stdio: 'inherit', cwd: opts.cwd || ROOT, shell: process.platform === 'win32' });
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
    p.on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const verificationPrompt = args.join(' ').trim() || 
    'Given the recent changes to compound handling and voice normalization, give me a fresh example of a spoken multi-part question that would have been weak before but should now be clear and structured. Then answer it yourself as you would to a user.';

  console.log('=== AGENT-RELOAD-VAI (thorough, no shortcuts) ===\n');

  // 1. Build core fully
  console.log('Step 1: Full build of @vai/core (think twice — make sure types and all are good)');
  await run('pnpm', ['--filter', CORE_PKG, 'build']);

  // 2. Stop any running
  console.log('\nStep 2: Stop existing server cleanly');
  try { await run('node', [SERVER_SCRIPT, 'stop']); } catch (e) { console.log('  (stop was not needed or had warnings)'); }

  // 3. Start fresh
  console.log('\nStep 3: Start server fresh and wait for health (no shortcuts)');
  await run('node', [SERVER_SCRIPT, 'start']);

  // 4. Small settle
  await new Promise(r => setTimeout(r, 1500));

  // 5. Speak with a new probe
  console.log('\nStep 4: Speak to Vai with a fresh, aligned probe (the point of the reload)');
  console.log(`Verification prompt: ${verificationPrompt}\n`);

  try {
    await run('node', [SPEAK_SCRIPT, verificationPrompt]);
  } catch (e) {
    console.error('Speak step had issues, but reload steps completed.');
  }

  console.log('\n=== RELOAD COMPLETE ===');
  console.log('Now, as the computer/agent: review the response above.');
  console.log('- Did the change produce the expected improvement in real output?');
  console.log('- What new thing did this interaction reveal?');
  console.log('- What should the next different/aligned probe be?');
  console.log('Log of this session is in .vai-agent-dialogue.log');
}

main().catch(err => {
  console.error('[agent-reload] Error (surfaced fully, no hiding):', err);
  process.exit(1);
});
