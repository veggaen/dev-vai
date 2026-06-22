import { gatherWebEvidence } from '../packages/core/src/consensus/web-evidence.js';
import { extractUrls } from '../packages/core/src/consensus/web-evidence.js';
const prompt = 'Look at https://github.com/veggaen/DEV-VEGGASTARE and tell me what is this app and is it good?';
console.log('extractUrls ->', extractUrls(prompt));
const t0 = Date.now();
const ev = await gatherWebEvidence(prompt);
console.log('via:', ev.via, '| sources:', ev.sources.length, '| aiOverview:', ev.aiOverview ? 'yes' : 'no', '| ms:', Date.now()-t0);
for (const s of ev.sources.slice(0,3)) {
  console.log('\n--- source:', s.url);
  console.log('  title:', s.title);
  console.log('  snippet:', String(s.snippet||'').slice(0,300).replace(/\n/g,' '));
}
