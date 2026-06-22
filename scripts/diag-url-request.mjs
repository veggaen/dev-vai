import { VaiEngine } from '../packages/core/src/models/vai-engine.ts';
const e = new VaiEngine({ testMode: true });
const qs = [
  'Look at https://github.com/veggaen/DEV-VEGGASTARE and tell me what is this app and is it good?',
  'What stack does https://github.com/veggaen/DEV-VEGGASTARE use?',
  'Look at https://github.com/colinhacks/zod and tell me what is this app and is it good?',
  'What stack does https://github.com/honojs/hono use?',
];
for (const q of qs) {
  const r = await e.tryUrlBasedRequest(q.toLowerCase(), q);
  console.log('\n=== ' + q.slice(0,55));
  console.log(r === null ? 'NULL (fell through to keyword arm — THE BUG)' : 'HANDLED: ' + String(r).slice(0,160).replace(/\n/g,' '));
}
