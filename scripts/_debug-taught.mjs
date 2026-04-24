#!/usr/bin/env node
/**
 * Debug script: list taught entries from the SQLite DB
 */
import Database from 'better-sqlite3';

const db = new Database('./vai.db');

try {
  const rows = db.prepare('SELECT pattern, source, substr(response, 1, 120) as resp_start FROM taught_entries').all();
  console.log('Total taught entries:', rows.length);
  
  // Find entries with vai/pipeline/ingest in pattern
  const vaiEntries = rows.filter(r => 
    r.pattern.includes('vai') || r.pattern.includes('pipeline') || r.pattern.includes('ingest')
  );
  console.log('\n--- Entries with vai/pipeline/ingest in pattern:', vaiEntries.length, '---');
  for (const r of vaiEntries.slice(0, 15)) {
    console.log('  Pattern:', r.pattern.slice(0, 100));
    console.log('  Source:', r.source);
    console.log('  Response:', r.resp_start);
    console.log();
  }

  // Find entries with stack or tier in pattern
  const stackEntries = rows.filter(r => r.pattern.includes('stack') || r.pattern.includes('tier'));
  console.log('\n--- Entries with stack/tier in pattern:', stackEntries.length, '---');
  for (const r of stackEntries.slice(0, 20)) {
    console.log('  Pattern:', r.pattern.slice(0, 100));
    console.log('  Source:', r.source);
    console.log();
  }

  // Find entries with next.js or mern or pern
  const webEntries = rows.filter(r => 
    r.pattern.includes('next.js') || r.pattern.includes('mern') || r.pattern.includes('pern') || r.pattern.includes('config')
  );
  console.log('\n--- Entries with next.js/mern/pern/config:', webEntries.length, '---');
  for (const r of webEntries.slice(0, 20)) {
    console.log('  Pattern:', r.pattern.slice(0, 100));
    console.log('  Source:', r.source);
    console.log();
  }
} catch (e) {
  console.log('Error:', e.message);
  // Try to list tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables.map(t => t.name));
} finally {
  db.close();
}
