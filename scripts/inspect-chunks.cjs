const Database = require('better-sqlite3');
const path = 'C:/Users/v3gga/AppData/Roaming/ai.vegga.vai/vai.db';
const db = new Database(path, { readonly: true });

console.log('=== sources sample ===');
const cols = db.prepare('PRAGMA table_info("sources")').all().map(c => c.name);
console.log('cols:', cols.join(', '));
const sources = db.prepare('SELECT * FROM sources LIMIT 5').all();
for (const s of sources) console.log(JSON.stringify(s).slice(0, 200));

console.log('\n=== sources by type ===');
const urlCol = cols.find(c => /url|uri|source|origin/i.test(c));
if (urlCol) {
  const urls = db.prepare(`SELECT "${urlCol}" u, COUNT(*) c FROM sources GROUP BY substr("${urlCol}",1,30) ORDER BY c DESC LIMIT 10`).all();
  for (const r of urls) console.log(r.c, '|', r.u);
}

console.log('\n=== chunks sample (junk) ===');
const ch = db.prepare(`SELECT id, source_id, substr(content,1,180) snippet FROM chunks WHERE content LIKE '%youtube%' OR content LIKE '%subscribe%' OR content LIKE '%donate%' OR content LIKE '%🔥%' LIMIT 8`).all();
for (const r of ch) console.log(r.id, r.source_id, '|', r.snippet);

console.log('\n=== chunks total vs junk ===');
const total = db.prepare('SELECT COUNT(*) c FROM chunks').get().c;
console.log('total chunks:', total);

db.close();
