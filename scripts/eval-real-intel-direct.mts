/**
 * Direct "speak to the brain" evaluation of Vai's intelligence.
 * Loads the *current source* via tsx (no server, no build dependency for this run).
 * Sends the exact same battery of spoken-style, compound, correction, and
 * recommendation prompts we care about.
 *
 * This lets us observe in real time whether the recent augmentations produce
 * signs of real intelligence: structured compound answers, better handling of
 * voice dictation style, good routing, epistemic honesty, etc.
 *
 * Run with: pnpm exec tsx scripts/eval-real-intel-direct.mts
 */

import { VaiEngine } from '../packages/core/src/models/vai-engine.js';

const originalFetch = globalThis.fetch;

async function main() {
  console.log('=== DIRECT VAI INTELLIGENCE EVALUATION (source, no server) ===\n');

  // We will run some with testMode (fast, deterministic, no network) to focus on
  // our new compound / normalization / routing logic, and some without to allow
  // real web search + the new rec enrichment path.
  const engineLocal = new VaiEngine({ testMode: true });

  // For web-enabled runs we still stub nothing; let the real pipeline run.
  // (May hit rate limits or be slow; that's fine for this eval.)
  const engineWeb = new VaiEngine();

  const tests = [
    {
      engine: engineLocal,
      label: 'SPOKEN-COMPOUND (testMode, exercises new structured combine)',
      messages: [{ role: 'user' as const, content: 'hey so tell me the capital of france and the capital of norway' }],
    },
    {
      engine: engineLocal,
      label: 'CORRECTION + SPOKEN (testMode)',
      messages: [{ role: 'user' as const, content: 'what is the capital of france, wait actually make it the capital of germany' }],
    },
    {
      engine: engineLocal,
      label: 'CONTRACTIONS + COMPOUND (new normalization rules)',
      messages: [{ role: 'user' as const, content: "i'm gonna build a small tool and i wanna know about react state and also tailwind setup" }],
    },
    {
      engine: engineWeb,
      label: 'RECOMMENDATION (web allowed — tests new rec query enrichment + existing gates)',
      messages: [{ role: 'user' as const, content: 'best mechanical keyboard switch for typing' }],
    },
    {
      engine: engineWeb,
      label: 'REDDIT-STYLE REC (web)',
      messages: [{ role: 'user' as const, content: 'best budget noise cancelling headphones reddit' }],
    },
    {
      engine: engineLocal,
      label: 'CONTEXT FOLLOW-UP (contextual resolver)',
      messages: [
        { role: 'user' as const, content: 'tell me about Oslo' },
        { role: 'assistant' as const, content: 'Oslo is the capital of Norway.' },
        { role: 'user' as const, content: 'how many people live there?' },
      ],
    },
    {
      engine: engineLocal,
      label: 'EPISTEMIC HARD CASE (should be honest)',
      messages: [{ role: 'user' as const, content: 'what will the exact temperature be in oslo on 19 july 2030 at 15:00' }],
    },
  ];

  for (const t of tests) {
    console.log(`\n=== ${t.label} ===`);
    console.log('PROMPT:', t.messages[t.messages.length-1].content);
    console.log('--- RESPONSE ---');

    try {
      // The engine.chat is the main entry used by the service for a turn.
      const res = await t.engine.chat({
        messages: t.messages,
        noLearn: true,
      });

      const content = res?.message?.content ?? '[no content]';
      console.log(content);

      // Try to surface meta if the engine exposes lastResponseMeta or similar (many tests check it).
      const meta = (t.engine as any).lastResponseMeta || (t.engine as any)._lastMeta || null;
      if (meta) {
        console.log('\n[META]', JSON.stringify({
          strategy: meta.strategy,
          confidence: meta.confidence,
          topic: meta.topicDetected,
        }, null, 0));
      }
      if (res?.finishReason) console.log('[finishReason]', res.finishReason);
    } catch (e: any) {
      console.log('[ERROR in this turn]', e?.message || e);
    }

    console.log('--- END ---\n');
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n=== EVAL COMPLETE ===');
  console.log('Review the responses above for signs of real intelligence:');
  console.log('  • Did the spoken compound produce clean **labeled sub-answers** (new combine logic)?');
  console.log('  • Did corrections and pronoun follow-ups stay on topic?');
  console.log('  • For rec queries (web ones), did it pull useful community info or at least stay honest?');
  console.log('  • Contractions normalized cleanly?');
  console.log('  • When it didn\'t know (future weather), did it say so clearly instead of bullshitting?');
  console.log('\nThese are the exact behaviors the chat-quality-augment work targets.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
