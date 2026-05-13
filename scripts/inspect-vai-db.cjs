const Database = require('better-sqlite3');
const path = 'C:/Users/v3gga/AppData/Roaming/ai.vegga.vai/vai.db';
const db = new Database(path, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('tables:', tables.map(t => t.name).join(', '));
for (const t of tables) {
  try {
    const c = db.prepare('SELECT COUNT(*) c FROM "' + t.name + '"').get();
    console.log(t.name + ':', c.c);
  } catch (e) { console.log(t.name + ': err'); }
}
// Look for poisoned content
for (const t of tables) {
  try {
    const cols = db.prepare('PRAGMA table_info("' + t.name + '")').all().map(c => c.name);
    const textCol = cols.find(c => /response|content|answer|value|text|body/i.test(c));
    if (!textCol) continue;
    const junk = db.prepare(`SELECT COUNT(*) c FROM "${t.name}" WHERE "${textCol}" LIKE '%youtube%' OR "${textCol}" LIKE '%subscribe%' OR "${textCol}" LIKE '%donate%' OR "${textCol}" LIKE '%🔥%'`).get();
    console.log(`${t.name}.${textCol}: junk=${junk.c}`);
  } catch (e) {}
}
db.close();
