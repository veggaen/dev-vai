import { readFileSync } from 'node:fs';
const s = readFileSync('packages/runtime/src/sandbox/stacks/pern.ts','utf-8');
const i = s.indexOf("path: 'src/App.tsx'");
console.log('idx:', i);
if(i>=0) console.log(JSON.stringify(s.slice(i-10,i+80)));
