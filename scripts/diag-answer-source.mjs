#!/usr/bin/env node
// Diagnose WHERE the bad answers come from: call the engine directly (no council, no WS)
// to see if tryVaiChatQualityDirection or another method is hijacking ordinary questions.
import { VaiEngine } from '../packages/core/src/models/vai-engine.ts';

const e = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });
const qs = [
  'Who wrote Romeo and Juliet?',
  'Hi, what can you help me with?',
  'Explain how a hash map works and its time complexity.',
  'What is the difference between REST and GraphQL?',
];
for (const q of qs) {
  // Probe the suspected hijacker directly
  const direct = e.tryVaiChatQualityDirection ? e.tryVaiChatQualityDirection(q, q.toLowerCase()) : '(no method)';
  console.log('\n=== ' + q);
  console.log('tryVaiChatQualityDirection ->', direct === null ? 'NULL (does not fire)' : 'FIRES: ' + String(direct).slice(0, 80));
}
