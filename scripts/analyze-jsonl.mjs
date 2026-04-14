#!/usr/bin/env node
// Analyze the VS Code chat JSONL file to understand ALL content types
import fs from 'fs';
import path from 'path';

const wsDir = path.join(process.env.APPDATA, 'Code/User/workspaceStorage/dd802bfd700b19b5995669506664a245/chatSessions');
const files = fs.readdirSync(wsDir).filter(f => f.endsWith('.jsonl'));
const jsonlPath = path.join(wsDir, files.sort((a, b) => fs.statSync(path.join(wsDir, b)).size - fs.statSync(path.join(wsDir, a)).size)[0]);

const stat = fs.statSync(jsonlPath);
console.log(`File: ${path.basename(jsonlPath)} (${Math.round(stat.size / 1024 / 1024)}MB)`);

// Read first 3MB to get early requests structure
const chunkSize = 3_000_000;
const buf = Buffer.alloc(chunkSize);
const fd = fs.openSync(jsonlPath, 'r');
fs.readSync(fd, buf, 0, chunkSize, 0);

const text = buf.toString('utf8');
const lines = text.split('\n').filter(l => l.trim());
console.log(`Lines in first ${chunkSize / 1e6}MB: ${lines.length}`);

// Find user messages
console.log('\n========== USER MESSAGES ==========');
let userMessageCount = 0;
for (const line of lines) {
  try {
    const o = JSON.parse(line);
    if (!Array.isArray(o.k)) continue;
    
    // User message: requests.N.message
    if (o.k.length === 3 && o.k[0] === 'requests' && o.k[2] === 'message') {
      userMessageCount++;
      const msg = typeof o.v === 'string' ? o.v : JSON.stringify(o.v);
      console.log(`\n[Request #${o.k[1]}] ${msg.substring(0, 200)}...`);
    }
  } catch (e) {}
}
console.log(`\nTotal user messages found: ${userMessageCount}`);

// Find response text (assistant messages)
console.log('\n========== ASSISTANT RESPONSES ==========');
let responseCount = 0;
for (const line of lines) {
  try {
    const o = JSON.parse(line);
    if (!Array.isArray(o.k)) continue;
    
    // Response: requests.N.response — has array of content parts
    if (o.k.length === 3 && o.k[0] === 'requests' && o.k[2] === 'response') {
      responseCount++;
      const parts = Array.isArray(o.v) ? o.v : [];
      // Extract text values
      const textParts = parts.filter(p => typeof p.value === 'string' && !p.kind);
      const thinkingParts = parts.filter(p => p.kind === 'thinking');
      const toolParts = parts.filter(p => p.kind === 'toolInvocationSerialized');
      
      const fullText = textParts.map(p => p.value).join('');
      console.log(`\n[Request #${o.k[1]}] ${textParts.length} text parts, ${thinkingParts.length} thinking, ${toolParts.length} tools`);
      if (fullText.length > 0) {
        console.log(`  Text: ${fullText.substring(0, 200)}...`);
      }
      if (thinkingParts.length > 0) {
        console.log(`  Thinking: ${thinkingParts[0].value?.substring(0, 150)}...`);
      }
    }
  } catch (e) {}
}
console.log(`\nTotal response entries found: ${responseCount}`);

// Find inputState entries (what user is typing)
console.log('\n========== INPUT STATE (user typing) ==========');
let inputCount = 0;
for (const line of lines) {
  try {
    const o = JSON.parse(line);
    if (!Array.isArray(o.k)) continue;
    if (o.k[0] === 'inputState' && o.k[1] === 'inputText') {
      inputCount++;
      if (inputCount <= 5) {
        console.log(`\n[Input #${inputCount}] ${String(o.v).substring(0, 200)}...`);
      }
    }
  } catch (e) {}
}
console.log(`\nTotal input state entries: ${inputCount}`);

// Summary of ALL key paths
console.log('\n========== ALL KEY PATHS ==========');
const pathCounts = {};
for (const line of lines) {
  try {
    const o = JSON.parse(line);
    if (!Array.isArray(o.k)) continue;
    const normalized = o.k.map(x => typeof x === 'number' ? 'N' : x).join('.');
    pathCounts[normalized] = (pathCounts[normalized] || 0) + 1;
  } catch (e) {}
}
Object.entries(pathCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  console.log(`  ${k}: ${v}x`);
});

fs.closeSync(fd);
