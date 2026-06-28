import { VaiEngine } from '../packages/core/src/models/vai-engine.ts';
const e = new VaiEngine({ testMode: true });
const nudge = 'Your draft was reviewed by your friend council. Use their reading to improve THIS answer. They point at intent and method only. What the user actually wants: Provide accurate information about the author of Romeo and Juliet. You likely misread the ask. Re-read the true intent and answer THAT, directly. Rewrite the answer now.';
const combined = 'Who wrote Romeo and Juliet?\n\n' + nudge;
const r = e.tryVaiChatQualityDirection(combined, combined.toLowerCase());
console.log('combined+nudge ->', r === null ? 'NULL (does not fire)' : 'FIRES: ' + String(r).slice(0, 90));
