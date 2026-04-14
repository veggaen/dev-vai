/**
 * deep-extract-titles.mjs — Extract the auto-generated titles from huge JSONL chat files.
 * Reads the first 2MB to find the session title in VS Code's format.
 * Also looks for Copilot's generated title field.
 */
import fs from 'fs';
import path from 'path';

const chatDir = path.join(
  process.env.APPDATA, 'Code', 'User', 'workspaceStorage',
  'dd802bfd700b19b5995669506664a245', 'chatSessions'
);

const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.jsonl'));

for (const f of files) {
  const fp = path.join(chatDir, f);
  const stat = fs.statSync(fp);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
  
  // Read first 2MB for large files
  const fd = fs.openSync(fp, 'r');
  const chunkSize = Math.min(2 * 1024 * 1024, stat.size);
  const buf = Buffer.alloc(chunkSize);
  fs.readSync(fd, buf, 0, chunkSize, 0);
  fs.closeSync(fd);
  
  const text = buf.toString('utf8');
  
  let sessionId = f.replace('.jsonl', '').slice(0, 8);
  let customTitle = null;
  let derivedTitle = null;
  let firstUserMsg = null;
  
  // Try line-by-line parse
  let lineStart = 0;
  let linesProcessed = 0;
  
  for (let i = 0; i < text.length && linesProcessed < 100; i++) {
    if (text[i] !== '\n') continue;
    
    const line = text.slice(lineStart, i).trim();
    lineStart = i + 1;
    linesProcessed++;
    
    if (!line || line.length < 5) continue;
    
    try {
      const obj = JSON.parse(line);
      
      if (obj.kind === 0 && obj.v) {
        if (obj.v.sessionId) sessionId = obj.v.sessionId.slice(0, 8);
        if (obj.v.customTitle) customTitle = obj.v.customTitle;
        // Also check for VS Code's computed title
        if (obj.v.title) customTitle = customTitle || obj.v.title;
        if (obj.v.computedTitle) customTitle = customTitle || obj.v.computedTitle;
      }
      
      // User messages can be in different formats
      if (obj.kind === 3 && obj.v?.request?.message && !firstUserMsg) {
        firstUserMsg = obj.v.request.message.trim().slice(0, 120);
      }
      if (obj.v?.text && typeof obj.v.text === 'string' && !firstUserMsg && obj.v.text.length > 10) {
        firstUserMsg = obj.v.text.trim().slice(0, 120);
      }
      if (obj.v?.value && typeof obj.v.value === 'string' && !firstUserMsg && obj.v.value.length > 10) {
        firstUserMsg = obj.v.value.trim().slice(0, 120);
      }
    } catch {
      // Not valid JSON — try searching for known patterns
      if (!firstUserMsg && line.includes('"message"')) {
        const match = line.match(/"message"\s*:\s*"([^"]{10,120})"/);
        if (match) firstUserMsg = match[1];
      }
    }
  }
  
  const title = customTitle || '—';
  const msg = firstUserMsg || '(no message found in first 100 lines)';
  console.log(`${sessionId}  ${sizeMB}MB  ${stat.mtime.toISOString().slice(0,16)}`);
  console.log(`  Title: ${title}`);
  console.log(`  First: ${msg}`);
  console.log('');
}
