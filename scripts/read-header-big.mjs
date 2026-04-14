/**
 * read-header-big.mjs — Read session headers with larger buffers.
 * VS Code embeds screenshots in the header, making them huge.
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
  
  // Read first 10MB to find the first newline
  const fd = fs.openSync(fp, 'r');
  const sz = Math.min(10 * 1024 * 1024, stat.size);
  const buf = Buffer.alloc(sz);
  fs.readSync(fd, buf, 0, sz, 0);
  fs.closeSync(fd);
  
  const text = buf.toString('utf8');
  const newlineIdx = text.indexOf('\n');
  
  if (newlineIdx < 0) {
    console.log(`${f.slice(0,8)}  ${(stat.size/1024/1024).toFixed(0)}MB  NO NEWLINE in first ${(sz/1024/1024).toFixed(0)}MB`);
    continue;
  }
  
  const firstLine = text.slice(0, newlineIdx);
  
  try {
    const header = JSON.parse(firstLine);
    const v = header.v || {};
    const sessionId = (v.sessionId || f).slice(0, 8);
    const title = v.customTitle || v.title || null;
    const created = v.creationDate ? new Date(v.creationDate).toISOString().slice(0, 16) : '?';
    
    // Find actual user messages in subsequent lines
    let firstMsg = null;
    let remaining = text.slice(newlineIdx + 1);
    let lineCount = 0;
    while (remaining && lineCount < 50 && !firstMsg) {
      const nl = remaining.indexOf('\n');
      const line = nl > 0 ? remaining.slice(0, nl) : remaining;
      remaining = nl > 0 ? remaining.slice(nl + 1) : '';
      lineCount++;
      
      if (line.length < 10) continue;
      try {
        const obj = JSON.parse(line);
        // kind=1, check for turns with user messages
        if (obj.kind === 1 && Array.isArray(obj.v)) {
          for (const item of obj.v) {
            if (typeof item === 'string' && item.length > 20 && !item.startsWith('{')) {
              firstMsg = item.slice(0, 120);
              break;
            }
          }
        }
        // Direct message fields
        if (obj.v?.request?.message && !firstMsg) {
          firstMsg = obj.v.request.message.slice(0, 120);
        }
      } catch {}
    }
    
    console.log(`${sessionId}  ${(stat.size/1024/1024).toFixed(0)}MB  ${created}  header=${(firstLine.length/1024).toFixed(0)}KB  title="${title}"  firstMsg="${firstMsg || '?'}"`);
  } catch (e) {
    console.log(`${f.slice(0,8)}  ${(stat.size/1024/1024).toFixed(0)}MB  header=${(firstLine.length/1024).toFixed(0)}KB  PARSE: ${e.message.slice(0, 100)}`);
  }
}
