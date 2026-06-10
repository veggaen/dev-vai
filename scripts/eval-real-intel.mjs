/**
 * Real intelligence evaluation for Vai.
 * Writes/speaks targeted prompts (including voice-like spoken style, compounds,
 * corrections, recommendations) to the live runtime and captures full responses.
 *
 * Run: node scripts/eval-real-intel.mjs
 *
 * This exercises the recent augmentations:
 * - compound splitter + structured labeled combine (for spoken "X and Y")
 * - web rec query enrichment (reddit/review bias)
 * - extra dictation contractions
 * - contextual / correction handling
 * - overall epistemic quality, structure, sources, adaptive behavior.
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:3006/api/chat';
const REST_URL = 'http://localhost:3006';

async function createConversation() {
  const res = await fetch(`${REST_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Real Intelligence Eval', modelId: 'vai:v0' }),
  });
  if (!res.ok) throw new Error('Failed to create conversation: ' + res.status);
  const conv = await res.json();
  return conv.id;
}

async function sendToVai(conversationId, message, label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let full = '';
    let thinking = null;
    let sources = [];
    let done = false;

    console.log(`\n=== [${label}] ===`);
    console.log(`USER: ${message}`);
    console.log('VAI: ');

    ws.on('open', () => {
      ws.send(JSON.stringify({ conversationId, content: message }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'text_delta' && msg.textDelta) {
        full += msg.textDelta;
        process.stdout.write(msg.textDelta);
      } else if (msg.type === 'turn_kind') {
        // ignore or note
      } else if (msg.type === 'sources') {
        sources = msg.sources || [];
      } else if (msg.type === 'thinking') {
        thinking = msg;
      } else if (msg.type === 'done') {
        done = true;
        ws.close();
      } else if (msg.type === 'error') {
        ws.close();
        reject(new Error(msg.error || 'unknown error'));
      }
    });

    ws.on('close', () => {
      console.log('\n--- end response ---');
      if (sources && sources.length) {
        console.log(`[sources: ${sources.length}]`);
      }
      if (thinking) {
        console.log(`[strategy: ${thinking.strategy || thinking.modelTag || 'n/a'} conf=${thinking.confidence ?? '?'}]`);
      }
      resolve({ text: full.trim(), sources, thinking });
    });

    ws.on('error', (e) => {
      console.error('WS error:', e.message);
      reject(e);
    });

    setTimeout(() => {
      if (!done) {
        console.log('\n[TIMEOUT]');
        ws.close();
        resolve({ text: full.trim() || '[timeout]', sources, thinking, timedOut: true });
      }
    }, 45000);
  });
}

async function main() {
  console.log('=== VAI Real Intelligence Evaluation ===');
  console.log('Creating fresh conversation against live runtime (post-rebuild)...\n');

  let convId;
  try {
    convId = await createConversation();
    console.log(`Conversation ID: ${convId}`);
  } catch (e) {
    console.error('Could not create conversation. Is runtime healthy on :3006?', e.message);
    process.exit(1);
  }

  const tests = [
    {
      label: 'SPOKEN-COMPOUND-1 (voice style)',
      prompt: 'hey so tell me the capital of france and the capital of norway',
      expectSignals: ['**what is the capital of france?**', 'Paris', 'Norway', 'Oslo'],
    },
    {
      label: 'SPOKEN-COMPOUND-2 + CORRECTION',
      prompt: 'what is the capital of france, wait actually make it the capital of germany',
      expectSignals: ['germany', 'Berlin', 'correction'],
    },
    {
      label: 'RECOMMENDATION (the classic weak bench case)',
      prompt: 'best mechanical keyboard switch for typing',
      expectSignals: ['cherry', 'gateron', 'kailh', 'brown', 'linear', 'tactile', 'reddit'],
    },
    {
      label: 'CONTRACTION + COMPOUND (voice dictation)',
      prompt: "i'm gonna build a small tool and i wanna know about react state and also tailwind setup",
      expectSignals: ['react', 'tailwind', 'state'],
    },
    {
      label: 'RESEARCH/REDDIT STYLE',
      prompt: 'best budget noise cancelling headphones reddit',
      expectSignals: ['sony', 'bose', 'soundcore', 'reddit'],
    },
    {
      label: 'CONTEXTUAL FOLLOW-UP + PRONOUN',
      prompt: 'tell me about Oslo. How many people live there?',
      expectSignals: ['Oslo', 'people', 'population'],
    },
    {
      label: 'EPISTEMIC / HONESTY PROBE',
      prompt: 'what will the weather be in oslo on july 19th 2030 at exactly 3pm',
      expectSignals: ['don', 'know', 'cannot', 'predict', 'future', 'enough'],
    },
  ];

  const results = [];

  for (const t of tests) {
    try {
      const res = await sendToVai(convId, t.prompt, t.label);
      results.push({ ...t, response: res.text, ok: true });

      // quick heuristic check for expected signals
      const lower = (res.text || '').toLowerCase();
      const found = (t.expectSignals || []).filter(sig => lower.includes(sig.toLowerCase()));
      if (found.length < Math.ceil((t.expectSignals || []).length * 0.6)) {
        console.log(`[note: only ${found.length}/${(t.expectSignals||[]).length} expected signals surfaced]`);
      } else {
        console.log(`[signals: ${found.join(', ')}]`);
      }
    } catch (e) {
      console.error(`Failed test ${t.label}:`, e.message);
      results.push({ ...t, response: '[error]', ok: false, error: e.message });
    }
    // small pause between turns
    await new Promise(r => setTimeout(r, 800));
  }

  console.log('\n\n=== EVALUATION SUMMARY ===');
  let strong = 0;
  for (const r of results) {
    const preview = (r.response || '').slice(0, 180).replace(/\n/g, ' ');
    const hasStructure = /\*\*.*\?\*\*/.test(r.response || '');
    console.log(`\n${r.label}:`);
    console.log(`  ${preview}${ (r.response||'').length > 180 ? '...' : '' }`);
    console.log(`  structured-headings=${hasStructure}  len=${(r.response||'').length}`);
    if (r.ok && (r.response || '').length > 40 && !/i don't have a confident answer/i.test(r.response)) {
      strong++;
    }
  }

  console.log(`\nStrong/usable responses: ${strong}/${results.length}`);
  console.log('\nQualitative notes for "real intelligence":');
  console.log('- Did compounds produce clean labeled sections (new combine logic)?');
  console.log('- Did rec queries surface community signals (new enrichment + existing gates)?');
  console.log('- Corrections and spoken style handled without falling apart?');
  console.log('- Epistemic honesty when appropriate (no confident bullshit)?');
  console.log('- Follow-ups respected prior context?');
  console.log('\nIf the answers above show clear structure, appropriate sourcing, and no dropped clauses, the recent augmentations are landing.');

  console.log('\nDone. You can now inspect the full streamed responses above for signs of real intelligence.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
