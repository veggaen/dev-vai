/**
 * seed-sessions.mjs — Seed runtime with realistic VS Code session data.
 */
const now = Date.now();
const body = JSON.stringify({
  chatApps: [
    { id: 'vscode-copilot', label: 'GitHub Copilot' },
    { id: 'vscode-claude', label: 'Claude Code' },
  ],
  sessions: [
    { sessionId: 'ses_ext_001', title: 'Extending IDE with Additional Dropdown Options', chatApp: 'vscode-copilot', lastModified: now - 60_000 },
    { sessionId: 'ses_ext_002', title: "Improving Vai's Response Quality", chatApp: 'vscode-copilot', lastModified: now - 3_600_000 },
    { sessionId: 'ses_ext_003', title: 'AgentSession model and related structures discussion', chatApp: 'vscode-copilot', lastModified: now - 7_200_000 },
    { sessionId: 'ses_ext_004', title: 'Refactoring desktop chat app for IDE management', chatApp: 'vscode-copilot', lastModified: now - 86_400_000 },
    { sessionId: 'ses_ext_005', title: 'VS Code crash validation request', chatApp: 'vscode-copilot', lastModified: now - 100_000_000 },
    { sessionId: 'ses_ext_006', title: 'Extension connection + visual E2E testing', chatApp: 'vscode-claude', lastModified: now - 30_000 },
  ],
});

const resp = await fetch('http://localhost:3006/api/companion-clients/chat-info', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'x-vai-installation-key': 'vscode-dev-vai-test',
    'x-vai-client-name': 'VS Code',
    'x-vai-client-type': 'vscode-extension',
    'x-vai-launch-target': 'vscode',
  },
  body,
});

console.log('chat-info PATCH:', resp.status, await resp.text());

// Also seed model data
const modelBody = JSON.stringify({
  models: [
    { id: 'claude-opus-4-20250514', family: 'claude-opus-4', name: 'Claude Opus 4', vendor: 'Anthropic' },
    { id: 'claude-sonnet-4-20250514', family: 'claude-sonnet-4', name: 'Claude Sonnet 4', vendor: 'Anthropic' },
    { id: 'gpt-4o', family: 'gpt-4o', name: 'GPT-4o', vendor: 'OpenAI' },
    { id: 'o3', family: 'o3', name: 'o3', vendor: 'OpenAI' },
    { id: 'gemini-2.5-pro', family: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', vendor: 'Google' },
  ],
});

const resp2 = await fetch('http://localhost:3006/api/companion-clients/models', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'x-vai-installation-key': 'vscode-dev-vai-test',
    'x-vai-client-name': 'VS Code',
    'x-vai-client-type': 'vscode-extension',
    'x-vai-launch-target': 'vscode',
  },
  body: modelBody,
});

console.log('models PATCH:', resp2.status, await resp2.text());

// Verify by fetching all clients
const resp3 = await fetch('http://localhost:3006/api/companion-clients', {
  headers: { 'x-vai-installation-key': 'vscode-dev-vai-test' },
});
const clients = await resp3.json();
console.log('\nRegistered clients:', JSON.stringify(clients, null, 2).slice(0, 2000));
