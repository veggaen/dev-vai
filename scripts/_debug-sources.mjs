#!/usr/bin/env node
/**
 * Debug script: list ingested sources from DB
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const db = new Database('./vai.db');

try {
  const sources = db.prepare('SELECT id, title, url FROM sources ORDER BY title').all();
  console.log('Total sources:', sources.length);
  
  const keywords = ['t3', 'stack', 'mern', 'vai', 'pern', 'pipeline', 'ingest', 'cn(', 'vitest', 'next', 'config'];
  const matched = sources.filter(s => {
    const t = ((s.title || '') + ' ' + (s.url || '')).toLowerCase();
    return keywords.some(k => t.includes(k));
  });
  console.log('\nMatched sources:', matched.length);
  for (const s of matched) {
    console.log('  Title:', (s.title || '').slice(0, 80), '| URL:', (s.url || '').slice(0, 60));
  }

  // Check L1 summaries for matched sources
  console.log('\n--- L1 summaries ---');
  for (const s of matched) {
    const l1 = db.prepare('SELECT substr(content, 1, 200) as c FROM chunks WHERE source_id = ? AND level = 1').get(s.id);
    if (l1) {
      console.log('  Source:', (s.title || '').slice(0, 60));
      console.log('  L1:', l1.c.slice(0, 180));
      console.log();
    }
  }
} catch (e) {
  console.log('Error:', e.message);
} finally {
  db.close();
}
