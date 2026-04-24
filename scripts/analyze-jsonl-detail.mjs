#!/usr/bin/env node
// Detailed analysis of JSONL entry contents
import fs from 'fs';
import path from 'path';

const wsDir = path.join(process.env.APPDATA, 'Code/User/workspaceStorage/dd802bfd700b19b5995669506664a245/chatSessions');
const files = fs.readdirSync(wsDir).filter(f => f.endsWith('.jsonl'));
const jsonlPath = path.join(wsDir, files.sort((a, b) => fs.statSync(path.join(wsDir, b)).size - fs.statSync(path.join(wsDir, a)).size)[0]);
const stat = fs.statSync(jsonlPath);

// Read last 50MB
const readSize = Math.min(50_000_000, stat.size);
const buf = Buffer.alloc(readSize);
const fd = fs.openSync(jsonlPath, 'r');
fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
fs.closeSync(fd);
const text = buf.toString('utf8');
const allLines = text.split('\n').filter(l => l.trim());

console.log(`Total parseable lines: ${allLines.length}\n`);

// 1. Show inputState.inputText entries (user messages)
console.log('===== inputState.inputText (User Messages) =====');
let inputCount = 0;
for (const line of allLines) {
  try {
    const o = JSON.parse(line);
    if (!Array.isArray(o.k)) continue;
    if (o.k[0] === 'inputState' && o.k[1] === 'inputText' && typeof o.v === 'string') {
      inputCount++;
      console.log(`\n[#${inputCount}] (${o.v.length} chars) ${o.v.substring(0, 300)}...`);
    }
  } catch (e) {}
}

// 2. Show `requests` full patches (contain user messages?)
console.log('\n\n===== requests patches (full request objects) =====');
let reqCount = 0;
for (const line of allLines) {
  try {
    const o = JSON.parse(line);
    if (!Array.isArray(o.k)) continue;
    const keyPath = o.k.map(x => typeof x === 'number' ? 'N' : x).join('.');
    if (keyPath === 'requests') {
      reqCount++;
      const items = Array.isArray(o.v) ? o.v : [o.v];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        // Extract relevant fields
        const msg = item.message || item.inputText || item.text || item.prompt;
        const keys = Object.keys(item).join(', ');
        console.log(`\n[Request #${reqCount}] kind=${o.kind} Keys: ${keys}`);
        if (msg) {
          const msgText = typeof msg === 'string' ? msg : JSON.stringify(msg).substring(0, 300);
          console.log(`  Message: ${msgText.substring(0, 300)}...`);
        }
        // Show first 500 chars of structure
        console.log(`  Sample: ${JSON.stringify(item).substring(0, 500)}...`);
      }
    }
  } catch (e) {}
}

// 3. Show response patches — how many have thinking vs text vs tool calls
console.log('\n\n===== requests.N.response analysis =====');
let thinkingCount = 0, textCount = 0, toolCount = 0, otherCount = 0, totalResponseEntries = 0;
for (const line of allLines) {
  try {
    const o = JSON.parse(line);
    if (!Array.isArray(o.k)) continue;
    const keyPath = o.k.map(x => typeof x === 'number' ? 'N' : x).join('.');
    if (keyPath === 'requests.N.response' && Array.isArray(o.v)) {
      totalResponseEntries++;
      for (const item of o.v) {
        if (!item || typeof item !== 'object') continue;
        if (item.kind === 'thinking') thinkingCount++;
        else if (item.kind === 'toolInvocationSerialized') toolCount++;
        else if (!('kind' in item) && item.value) textCount++;
        else otherCount++;
      }
    }
  } catch (e) {}
}
console.log(`Response entries: ${totalResponseEntries}`);
console.log(`  Thinking blocks: ${thinkingCount}`);
console.log(`  Text blocks: ${textCount}`);
console.log(`  Tool invocations: ${toolCount}`);
console.log(`  Other: ${otherCount}`);
