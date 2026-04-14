/**
 * read-header.mjs — Read just the first JSONL line of the current session.
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
  
  // Read first 16KB 
  const fd = fs.openSync(fp, 'r');
  const sz = Math.min(16384, stat.size);
  const buf = Buffer.alloc(sz);
  fs.readSync(fd, buf, 0, sz, 0);
  fs.closeSync(fd);
  
  const text = buf.toString('utf8');
  const newlineIdx = text.indexOf('\n');
  const firstLine = newlineIdx > 0 ? text.slice(0, newlineIdx) : text;
  
  try {
    const header = JSON.parse(firstLine);
    const v = header.v || {};
    const sessionId = (v.sessionId || f).slice(0, 8);
    const title = v.customTitle || v.title || v.computedTitle || null;
    const created = v.creationDate ? new Date(v.creationDate).toISOString().slice(0, 16) : '?';
    
    // Check all keys in v for anything title-like
    const titleKeys = Object.keys(v).filter(k => k.toLowerCase().includes('title'));
    
    console.log(`${sessionId}  ${(stat.size/1024/1024).toFixed(0)}MB  ${created}  title="${title}"  titleKeys=${JSON.stringify(titleKeys)}`);
  } catch (e) {
    console.log(`${f.slice(0,8)}  ${(stat.size/1024/1024).toFixed(0)}MB  PARSE ERROR: ${e.message.slice(0, 80)}`);
  }
}
