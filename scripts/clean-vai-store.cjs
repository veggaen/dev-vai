/**
 * Clean the poisoned knowledge store.
 *
 * Backs up vai-knowledge.json, vai.db, vai.db-shm, vai.db-wal to .bak-<date>
 * siblings, then:
 *   - drops every chunk + source whose source_type='youtube'
 *   - filters learnedEntries in vai-knowledge.json to keep only entries whose
 *     source is not YouTube/TikTok/Instagram and whose response doesn't
 *     contain transcript-noise markers
 *
 * Run with: node scripts/clean-vai-store.cjs
 *
 * To roll back: copy the .bak-<date>.* files back over the originals.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:/Users/v3gga/AppData/Roaming/ai.vegga.vai';
const KN_JSON = path.join(DATA_DIR, 'vai-knowledge.json');
const DB_PATH = path.join(DATA_DIR, 'vai.db');
const today = new Date().toISOString().slice(0, 10);
const SUFFIX = `.bak-${today}`;

function backup(file) {
  if (!fs.existsSync(file)) return;
  const dst = file + SUFFIX;
  fs.copyFileSync(file, dst);
  console.log(`backed up ${path.basename(file)} -> ${path.basename(dst)}`);
}

console.log('=== backup phase ===');
backup(KN_JSON);
backup(DB_PATH);
backup(DB_PATH + '-shm');
backup(DB_PATH + '-wal');

console.log('\n=== sqlite cleanup ===');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

const before = {
  sources: db.prepare('SELECT COUNT(*) c FROM sources').get().c,
  chunks: db.prepare('SELECT COUNT(*) c FROM chunks').get().c,
  ytSources: db.prepare("SELECT COUNT(*) c FROM sources WHERE source_type='youtube'").get().c,
};
console.log('before:', before);

// Get the IDs of all youtube sources, then delete their chunks then themselves.
const ytIds = db.prepare("SELECT id FROM sources WHERE source_type='youtube'").all().map(r => r.id);
console.log(`will delete ${ytIds.length} youtube sources`);

const deletedChunks = db.transaction(() => {
  let total = 0;
  const stmt = db.prepare('DELETE FROM chunks WHERE source_id = ?');
  for (const id of ytIds) {
    const info = stmt.run(id);
    total += info.changes;
  }
  return total;
})();
console.log(`deleted ${deletedChunks} chunks`);

const delSrc = db.prepare("DELETE FROM sources WHERE source_type='youtube'").run();
console.log(`deleted ${delSrc.changes} sources`);

// Also nuke any chunk whose content is obvious transcript noise even if its
// source isn't tagged youtube.
const junkRe = "content LIKE '%subscribe%' OR content LIKE '%donate%' OR content LIKE '%🔥%' OR content LIKE '%youtu.be%' OR content LIKE '%=== TRANSCRIPT ===%' OR content LIKE '%[Music]%'";
const junkChunks = db.prepare(`DELETE FROM chunks WHERE ${junkRe}`).run();
console.log(`deleted ${junkChunks.changes} extra junk chunks`);

const after = {
  sources: db.prepare('SELECT COUNT(*) c FROM sources').get().c,
  chunks: db.prepare('SELECT COUNT(*) c FROM chunks').get().c,
};
console.log('after:', after);

db.exec('VACUUM');
db.close();

console.log('\n=== json cleanup ===');
const j = JSON.parse(fs.readFileSync(KN_JSON, 'utf8'));
const beforeN = j.learnedEntries.length;
const isJunk = (e) => {
  if (e.source && /youtube\.com|tiktok\.com|instagram\.com|youtu\.be/i.test(e.source)) return true;
  if (e.response && /subscribe|patreon|donate|onlyfans|🔥|❤️|👇|youtu\.be|\[music\]|=== transcript ===/i.test(e.response)) return true;
  return false;
};
const cleaned = j.learnedEntries.filter((e) => !isJunk(e));
const removed = beforeN - cleaned.length;
j.learnedEntries = cleaned;
j.savedAt = Date.now();
fs.writeFileSync(KN_JSON, JSON.stringify(j, null, 2));
console.log(`learnedEntries: ${beforeN} -> ${cleaned.length} (removed ${removed})`);

console.log('\nDone. To roll back, copy the .bak files back over the originals.');
