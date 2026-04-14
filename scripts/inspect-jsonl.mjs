/**
 * inspect-jsonl.mjs — Inspect the structure of a VS Code chat session JSONL file.
 * Shows the first 20 lines with their kind values.
 */
import fs from 'fs';
import path from 'path';

const chatDir = path.join(
  process.env.APPDATA, 'Code', 'User', 'workspaceStorage',
  'dd802bfd700b19b5995669506664a245', 'chatSessions'
);

// Current session (e6be6b9b) - most recently modified
const target = 'e6be6b9b-e1b5-4548-9e12-fe91b9daba06.jsonl';
const fp = path.join(chatDir, target);

if (!fs.existsSync(fp)) {
  console.log('File not found:', fp);
  process.exit(1);
}

const fd = fs.openSync(fp, 'r');
const bufSize = Math.min(1024 * 1024, fs.statSync(fp).size);
const buf = Buffer.alloc(bufSize);
fs.readSync(fd, buf, 0, bufSize, 0);
fs.closeSync(fd);

const text = buf.toString('utf8');
const lines = text.split('\n');

console.log(`File: ${target}`);
console.log(`Size: ${(fs.statSync(fp).size / 1024 / 1024).toFixed(1)}MB`);
console.log(`Lines in first 1MB: ${lines.length}`);
console.log('\nFirst 30 lines structure:');

for (let i = 0; i < Math.min(30, lines.length); i++) {
  const line = lines[i].trim();
  if (!line) { console.log(`  L${i}: (empty)`); continue; }
  
  try {
    const obj = JSON.parse(line);
    const keys = Object.keys(obj);
    const kind = obj.kind;
    const vKeys = obj.v ? Object.keys(obj.v).slice(0, 10) : [];
    
    if (kind === 0) {
      console.log(`  L${i}: kind=${kind} session header: id=${obj.v?.sessionId?.slice(0,8)} title="${obj.v?.customTitle || '(none)}" title2="${obj.v?.title || '(none)}"`);
      console.log(`    All v keys: ${JSON.stringify(vKeys)}`);
    } else if (kind === 3) {
      const msg = obj.v?.request?.message?.slice(0, 80) || '(no message)';
      console.log(`  L${i}: kind=${kind} request: "${msg}"`);
    } else {
      console.log(`  L${i}: kind=${kind} keys=[${keys}] v.keys=[${vKeys}]`);
      if (obj.v?.text) console.log(`    text: "${String(obj.v.text).slice(0, 100)}"`);
      if (obj.v?.value) console.log(`    value: "${String(obj.v.value).slice(0, 100)}"`);
      if (obj.v?.message?.value) console.log(`    message.value: "${String(obj.v.message.value).slice(0, 100)}"`);
    }
  } catch {
    console.log(`  L${i}: NOT JSON (${line.length} chars): "${line.slice(0, 100)}..."`);
  }
}
