import { CORPUS } from '../eval/generated/corpus.js';
import { VaiEngine } from '../packages/core/src/models/vai-engine.js';

const ids = ['cog-theory-of-mind-001', 'mt-context-retention-001', 'cre-constrained-writing-002', 'cre-voice-non-default-001', 'mt-correction-acceptance-001'];

for (const id of ids) {
  const c = CORPUS.find((x) => x.id === id)!;
  const eng = new VaiEngine();
  const msgs: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of c.turns) {
    if (t.role === 'user') {
      msgs.push({ role: 'user', content: t.say });
      const r = await eng.chat({ messages: msgs.slice() });
      msgs.push({ role: 'assistant', content: r.message.content });
    }
  }
  console.log('=== ' + id + ' ===');
  for (const m of msgs) {
    console.log('[' + m.role.toUpperCase() + '] ' + m.content.slice(0, 600).replace(/\n/g, ' | '));
  }
  console.log();
}
