import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../packages/constants/src/platform-values.json', import.meta.url), 'utf8'));
const baseUrl = process.env.VAI_API_URL?.trim() || `http://127.0.0.1:${manifest.ports.runtime}`;
const [action = 'list', id] = process.argv.slice(2);
const token = process.env.VAI_SESSION_TOKEN?.trim();
const headers = token ? { Authorization: `Bearer ${token}` } : {};

if (action === 'list') {
  const response = await fetch(`${baseUrl}/api/pairing/sessions`, { headers });
  if (!response.ok) throw new Error(`Credential list failed (${response.status}): ${await response.text()}`);
  const body = await response.json();
  for (const session of body.sessions ?? []) {
    console.log(`${session.id}\t${session.integrationId}\t${session.deviceLabel ?? ''}\t${session.revokedAt ? 'revoked' : 'active'}`);
  }
} else if (action === 'revoke') {
  if (!id) throw new Error('Usage: pnpm credentials:revoke -- <session-id>');
  const response = await fetch(`${baseUrl}/api/pairing/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
  if (!response.ok) throw new Error(`Credential revoke failed (${response.status}): ${await response.text()}`);
  console.log(`Revoked ${id}`);
} else {
  throw new Error(`Unknown action ${action}; use list or revoke`);
}
