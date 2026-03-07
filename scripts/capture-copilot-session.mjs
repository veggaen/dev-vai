#!/usr/bin/env node
/**
 * Batch Capture — Push multiple events to a session in one call.
 *
 * Usage:
 *   node scripts/capture-copilot-session.mjs <sessionId> <eventsFile.json>
 *   echo '<json>' | node scripts/capture-copilot-session.mjs <sessionId> -
 *
 * Events file format: JSON array of event objects:
 *   [
 *     { "type": "message", "content": "hello", "meta": { "eventType": "message", "role": "user" } },
 *     { "type": "note", "content": "Created copilot-instructions.md", "meta": { "eventType": "note" } }
 *   ]
 */

import { readFileSync } from 'node:fs';

const API_BASE = process.env.VAI_API_BASE || 'http://localhost:3006';

const [, , sessionId, source] = process.argv;

if (!sessionId || !source) {
  console.error('Usage: capture-copilot-session.mjs <sessionId> <events.json | ->');
  process.exit(1);
}

async function main() {
  let raw;

  if (source === '-') {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks).toString('utf-8');
  } else {
    raw = readFileSync(source, 'utf-8');
  }

  const events = JSON.parse(raw);

  if (!Array.isArray(events) || events.length === 0) {
    console.error('Events must be a non-empty JSON array');
    process.exit(1);
  }

  // Enrich events with timestamps if missing
  const now = Date.now();
  const enriched = events.map((e, i) => ({
    ...e,
    timestamp: e.timestamp || now + i,     // slight offset to preserve order
    meta: e.meta || { eventType: e.type },
  }));

  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: enriched }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to push events (${res.status}): ${text}`);
    process.exit(1);
  }

  const data = await res.json();
  console.log(`✅ Pushed ${enriched.length} events to session ${sessionId} (total: ${data.totalEvents})`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
