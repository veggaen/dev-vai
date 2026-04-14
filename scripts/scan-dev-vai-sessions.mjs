/**
 * scan-dev-vai-sessions.mjs — Deep scan of dev-vai workspace chat sessions.
 * Reads more of each JSONL to find titles in messages, not just headers.
 */
import fs from 'fs';
import path from 'path';

const APPDATA = process.env.APPDATA || '';
const wsRoot = path.join(APPDATA, 'Code', 'User', 'workspaceStorage');

// Find the dev-vai workspace
const dirs = fs.readdirSync(wsRoot).filter(d => fs.statSync(path.join(wsRoot, d)).isDirectory());
let devVaiDir = null;

for (const d of dirs) {
  try {
    const wsJson = JSON.parse(fs.readFileSync(path.join(wsRoot, d, 'workspace.json'), 'utf8'));
    if (wsJson.folder?.includes('dev-vai')) {
      devVaiDir = path.join(wsRoot, d, 'chatSessions');
      console.log('Found dev-vai workspace:', d);
      break;
    }
  } catch {}
}

if (!devVaiDir) {
  console.log('dev-vai workspace chatSessions not found');
  process.exit(1);
}

const files = fs.readdirSync(devVaiDir).filter(f => f.endsWith('.jsonl'));
console.log(`\nFound ${files.length} JSONL files\n`);

for (const f of files) {
  const fp = path.join(devVaiDir, f);
  const stat = fs.statSync(fp);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
  
  // Read first 100KB to find titles and first user message
  const fd = fs.openSync(fp, 'r');
  const bufSize = Math.min(102400, stat.size);
  const buf = Buffer.alloc(bufSize);
  fs.readSync(fd, buf, 0, bufSize, 0);
  fs.closeSync(fd);
  
  const text = buf.toString('utf8');
  const lines = text.split('\n').filter(l => l.trim());
  
  let sessionId = f.replace('.jsonl', '');
  let customTitle = null;
  let firstUserMsg = null;
  
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    try {
      const obj = JSON.parse(lines[i]);
      // Header (kind 0) has sessionId and optional customTitle
      if (obj.kind === 0 && obj.v?.sessionId) {
        sessionId = obj.v.sessionId;
        if (obj.v.customTitle) customTitle = obj.v.customTitle;
      }
      // User message (kind 3 with v.message.role === 'user' or first text content)
      if (!firstUserMsg && obj.v?.message?.value) {
        firstUserMsg = obj.v.message.value.slice(0, 150);
      }
      if (!firstUserMsg && obj.v?.request?.message) {
        firstUserMsg = obj.v.request.message.slice(0, 150);
      }
      // Also check for title in later entries (VS Code may update it)
      if (obj.v?.customTitle && !customTitle) {
        customTitle = obj.v.customTitle;
      }
    } catch {}
  }
  
  const title = customTitle || '(no customTitle)';
  const preview = firstUserMsg ? `\n    First msg: "${firstUserMsg}"` : '';
  console.log(`[${sessionId.slice(0,8)}] ${title} (${sizeMB}MB, ${stat.mtime.toISOString().slice(0,19)})${preview}\n`);
}
