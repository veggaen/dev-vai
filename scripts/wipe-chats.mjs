#!/usr/bin/env node
/**
 * Reset chat history to a blank slate — SAFELY.
 *
 * What it does, in order:
 *   1. Locates vai.db (arg > VAI_DB_PATH > ./vai.db).
 *   2. Makes a timestamped BACKUP first (your undo) — including -wal/-shm.
 *   3. Deletes ONLY the chat tables (conversations, messages, images, sandbox
 *      revisions). Your account, memories, projects, and voice profile are untouched.
 *   4. VACUUMs and prints how many rows it removed.
 *
 * Usage (CLOSE THE VAI APP FIRST so the DB isn't locked):
 *   node scripts/wipe-chats.mjs [path/to/vai.db]
 *
 * Restore if needed:  copy the printed .bak file back over vai.db
 */

import { existsSync, copyFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const dbPath = resolve(process.argv[2] || process.env.VAI_DB_PATH || './vai.db');

if (!existsSync(dbPath)) {
  console.error(`\n✗ No database found at: ${dbPath}`);
  console.error('  Pass the path explicitly, e.g.  node scripts/wipe-chats.mjs "C:\\\\path\\\\to\\\\vai.db"');
  console.error('  (Search your machine for "vai.db" if unsure — the packaged app keeps its own.)\n');
  process.exit(1);
}

// 1) Backup — copy the main file plus any WAL/SHM sidecars.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${dbPath}.bak-${stamp}`;
copyFileSync(dbPath, backup);
for (const sfx of ['-wal', '-shm']) {
  if (existsSync(dbPath + sfx)) copyFileSync(dbPath + sfx, backup + sfx);
}
console.log(`\n✓ Backup written: ${backup}  (${statSync(backup).size} bytes)`);

// 2) Open and clear the chat tables only.
let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.error('\n✗ Could not load better-sqlite3. Run this from the repo (e.g. `cd packages/runtime`)');
  console.error('  where its dependencies are installed, or `pnpm --filter @vai/runtime exec node ../../scripts/wipe-chats.mjs`.\n');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = OFF');

// Child-first order (harmless with FKs off, correct with them on).
const TABLES = ['sandbox_revision_files', 'sandbox_revisions', 'messages', 'images', 'conversations'];

const countBefore = {};
for (const t of TABLES) {
  try { countBefore[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; }
  catch { countBefore[t] = 0; } // table may not exist in older DBs
}

const wipe = db.transaction(() => {
  for (const t of TABLES) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* table absent — skip */ }
  }
});
wipe();
db.exec('VACUUM');
db.close();

console.log('\n✓ Chat history cleared:');
for (const t of TABLES) console.log(`    ${t.padEnd(24)} -${countBefore[t] ?? 0} rows`);
console.log('\n  Your account, memories, projects and voice profile were left intact.');
console.log(`  Undo: copy "${backup}" back over "${dbPath}".\n`);
