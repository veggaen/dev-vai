/**
 * extract-session-titles.mjs — Extract session titles from VS Code chat JSONL.
 * For files without customTitle, derives title from the first user message.
 */
import fs from 'fs';
import path from 'path';

process.stdout.on('error', (error) => {
  if (error?.code === 'EPIPE') {
    process.exitCode = 0;
    process.exit(0);
  }
  throw error;
});

process.on('uncaughtException', (error) => {
  if (error?.code === 'EPIPE') {
    process.exit(0);
  }
  throw error;
});

const chatDir = path.join(
  process.env.APPDATA, 'Code', 'User', 'workspaceStorage',
  'dd802bfd700b19b5995669506664a245', 'chatSessions'
);

const files = fs.readdirSync(chatDir)
  .filter(f => f.endsWith('.jsonl'))
  .sort((a, b) => fs.statSync(path.join(chatDir, b)).size - fs.statSync(path.join(chatDir, a)).size);

for (const f of files) {
  const fp = path.join(chatDir, f);
  const stat = fs.statSync(fp);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
  
  // Read first 512KB chunk to find header and first message
  const fd = fs.openSync(fp, 'r');
  const chunkSize = Math.min(524288, stat.size);
  const buf = Buffer.alloc(chunkSize);
  fs.readSync(fd, buf, 0, chunkSize, 0);
  fs.closeSync(fd);
  
  const text = buf.toString('utf8');
  const lines = text.split('\n');
  
  let sessionId = f.replace('.jsonl', '');
  let customTitle = null;
  let derivedTitle = null;
  
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const keyPath = Array.isArray(obj.k) ? obj.k.join('.') : '';
      
      // kind 0 = header
      if (obj.kind === 0 && obj.v?.sessionId) {
        sessionId = obj.v.sessionId;
        customTitle = obj.v.customTitle || null;
      }

      // kind 1 = incremental property updates in current Copilot JSONL format
      if (obj.kind === 1 && keyPath === 'customTitle' && typeof obj.v === 'string') {
        customTitle = obj.v.trim() || customTitle;
      }
      if (obj.kind === 1 && keyPath === 'inputState.inputText' && typeof obj.v === 'string' && !derivedTitle) {
        const msg = obj.v.trim();
        derivedTitle = msg.length > 80 ? msg.slice(0, 80) + '...' : msg;
      }
      
      // kind 3 = chat request (has the user's message)
      if (obj.kind === 3 && obj.v?.request?.message && !derivedTitle) {
        const msg = obj.v.request.message.trim();
        derivedTitle = msg.length > 80 ? msg.slice(0, 80) + '...' : msg;
      }
      
      // kind 33 = request with message
      if ((obj.kind === 33 || obj.kind === 2) && obj.v?.message?.value && !derivedTitle) {
        const msg = obj.v.message.value.trim();
        derivedTitle = msg.length > 80 ? msg.slice(0, 80) + '...' : msg;
      }
      
      if (customTitle && derivedTitle) break; // Found both
    } catch {
      // Binary or broken line
    }
  }
  
  const displayTitle = customTitle || derivedTitle || '(unknown)';
  console.log(`${sessionId.slice(0,8)}  ${sizeMB}MB  ${stat.mtime.toISOString().slice(0,16)}  "${displayTitle}"`);
}
