#!/usr/bin/env node
import { openDb } from './db.mjs';
import {
  buildAdoptionBoard,
  formatAdoptionBoard,
  recordAdoptionDecision,
  validateAdoptionBoard,
} from './adoption-control.mjs';

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args.shift() : 'list';
const value = (flag, fallback = undefined) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const has = (flag) => args.includes(flag);
const DB_PATH = value('--db', 'scripts/improve-loop/.corpus.sqlite');
const db = openDb(DB_PATH);

try {
  if (command === 'list' || command === 'status') {
    const board = validateAdoptionBoard(buildAdoptionBoard(db, { limit: Number(value('--limit', '20')) }));
    console.log(has('--json') ? JSON.stringify(board, null, 2) : formatAdoptionBoard(board));
  } else if (command === 'decide') {
    const fingerprint = args.find((arg) => !arg.startsWith('--') && arg !== value('--status'));
    if (!fingerprint) throw new Error('usage: self-improve:adoption decide <fingerprint> --status <state> [decision fields]');
    const item = recordAdoptionDecision(db, fingerprint, {
      status: value('--status'),
      reason: value('--reason'),
      assignee: value('--assignee'),
      risk: value('--risk'),
      expiresAt: value('--expires'),
      rollback: value('--rollback'),
      evidence: value('--evidence'),
      commitSha: value('--commit'),
      computeRoundId: value('--compute-round'),
      qualityBefore: value('--quality-before'),
      qualityAfter: value('--quality-after'),
    });
    console.log(has('--json') ? JSON.stringify(item, null, 2) : `Recorded ${item.status}: ${item.title} (${item.fingerprint})`);
  } else {
    throw new Error(`unknown adoption command: ${command}`);
  }
} catch (error) {
  console.error(`adoption: ${error.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
