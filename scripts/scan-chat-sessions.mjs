/**
 * scan-chat-sessions.mjs — Scan VS Code's workspace storage for chat session JSONL files.
 * Also scans Copilot chat resource directories for conversation data.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const wsRoot = path.join(APPDATA, 'Code', 'User', 'workspaceStorage');
const globalRoot = path.join(APPDATA, 'Code', 'User', 'globalStorage');

console.log('=== Scanning VS Code chat sessions ===\n');
console.log('Workspace storage:', wsRoot);
console.log('Global storage:', globalRoot);
console.log('');

let totalSessions = 0;

// Scan workspace storage chatSessions/
if (fs.existsSync(wsRoot)) {
  const dirs = fs.readdirSync(wsRoot).filter(d => fs.statSync(path.join(wsRoot, d)).isDirectory());
  for (const d of dirs) {
    const chatDir = path.join(wsRoot, d, 'chatSessions');
    if (!fs.existsSync(chatDir)) continue;
    const files = fs.readdirSync(chatDir).filter(f => f.endsWith('.jsonl'));
    if (files.length === 0) continue;
    
    // Try to find workspace.json to identify the workspace
    let wsName = d;
    try {
      const wsJson = JSON.parse(fs.readFileSync(path.join(wsRoot, d, 'workspace.json'), 'utf8'));
      wsName = wsJson.folder || wsJson.workspace || d;
    } catch {}
    
    console.log(`--- ${wsName} (${files.length} sessions) ---`);
    for (const f of files) {
      const fp = path.join(chatDir, f);
      const stat = fs.statSync(fp);
      try {
        const content = fs.readFileSync(fp, 'utf8');
        const firstLine = content.split('\n')[0];
        const header = JSON.parse(firstLine);
        const title = header.v?.customTitle || 'Untitled';
        const sessionId = header.v?.sessionId || '???';
        console.log(`  [${sessionId.slice(0,8)}] "${title}" (${(stat.size/1024).toFixed(1)}KB, ${stat.mtime.toISOString().slice(0,19)})`);
        totalSessions++;
      } catch (e) {
        console.log(`  ${f}: parse error (${stat.size} bytes)`);
        totalSessions++;
      }
    }
    console.log('');
  }
}

// Also scan for copilot-chat resources
const copilotDirs = ['GitHub.copilot-chat', 'github.copilot-chat'];
for (const cpDir of copilotDirs) {
  const fullDir = path.join(globalRoot, cpDir);
  if (!fs.existsSync(fullDir)) continue;
  
  // Check for chat-session-resources
  const chatResDir = path.join(fullDir, 'chat-session-resources');
  if (fs.existsSync(chatResDir)) {
    const sessionDirs = fs.readdirSync(chatResDir).filter(d => fs.statSync(path.join(chatResDir, d)).isDirectory());
    console.log(`--- Copilot Chat Resources (${sessionDirs.length} sessions) ---`);
    for (const sd of sessionDirs.slice(0, 10)) {
      console.log(`  Session: ${sd}`);
    }
    if (sessionDirs.length > 10) console.log(`  ... and ${sessionDirs.length - 10} more`);
    console.log('');
  }
}

console.log(`\nTotal sessions found: ${totalSessions}`);

// Now also check the Copilot JSONL conversations directory structure
const copilotConvDir = path.join(globalRoot, 'GitHub.copilot-chat', 'chatSessions');
if (fs.existsSync(copilotConvDir)) {
  const files = fs.readdirSync(copilotConvDir).filter(f => f.endsWith('.jsonl'));
  console.log(`\nGlobal Copilot chatSessions: ${files.length} files`);
  for (const f of files.slice(0, 20)) {
    const fp = path.join(copilotConvDir, f);
    const stat = fs.statSync(fp);
    try {
      const firstLine = fs.readFileSync(fp, 'utf8').split('\n')[0];
      const hdr = JSON.parse(firstLine);
      console.log(`  "${hdr.v?.customTitle || 'Untitled'}" (${(stat.size/1024).toFixed(1)}KB)`);
    } catch {
      console.log(`  ${f}: parse error`);
    }
  }
}
