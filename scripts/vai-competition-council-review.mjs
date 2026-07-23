#!/usr/bin/env node
/**
 * Advisory blind Council review for subjective competition answers.
 *
 * Deterministic rubric failures remain final. This helper hides contestant
 * identity, alternates candidate order, and asks Council only for omissions,
 * unsafe confidence, and rubric-quality feedback.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const reportPath = path.resolve(process.argv[2] ?? 'artifacts/vai-competition/final-visible.json');
const outPath = path.resolve(process.argv[3] ?? 'artifacts/vai-competition/council-review.json');
const baseUrl = process.env.VAI_API ?? 'http://localhost:3006';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const requestedIds = process.argv.slice(4);
const subjectiveIds = report.contestants.codex
  .filter((row) => row.subjective && row.passed)
  .map((row) => row.scenarioId);
const selectedIds = (requestedIds.length > 0 ? requestedIds : subjectiveIds).slice(0, 3);

const findRow = (contestant, scenarioId) => report.contestants[contestant]
  .find((row) => row.scenarioId === scenarioId);

const pairs = selectedIds.map((scenarioId, index) => {
  const codex = findRow('codex', scenarioId);
  const vai = findRow('vai', scenarioId);
  if (!codex || !vai) throw new Error(`Missing scenario in report: ${scenarioId}`);
  const prompt = codex.turns.map((turn) => turn.prompt).join('\nFollow-up: ');
  const codexAnswer = codex.turns.map((turn) => turn.answer).join('\n--- next turn ---\n');
  const vaiAnswer = vai.turns.map((turn) => turn.answer).join('\n--- next turn ---\n');
  const swap = index % 2 === 0;
  return {
    scenarioId,
    prompt,
    candidateA: swap ? vaiAnswer : codexAnswer,
    candidateB: swap ? codexAnswer : vaiAnswer,
    hiddenOrder: swap ? { A: 'vai', B: 'codex' } : { A: 'codex', B: 'vai' },
  };
});

const packet = pairs.map((pair, index) => [
  `PAIR ${index + 1}`,
  `Prompt: ${pair.prompt}`,
  `Candidate A:\n${pair.candidateA}`,
  `Candidate B:\n${pair.candidateB}`,
].join('\n\n')).join('\n\n========\n\n');

const content = [
  'Self-improvement review: blindly validate anonymized answer pairs from a deterministic capability competition.',
  'Candidate order alternates and identities are withheld. For each pair, return A, B, or tie; name only material correctness, safety, engineering-judgment, or completeness gaps. Flag an unfair rubric. Do not infer authorship and do not override objective deterministic failures.',
  packet,
].join('\n\n');

const result = await new Promise((resolve) => {
  const wsUrl = `${baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}/api/chat`;
  const ws = new WebSocket(wsUrl, { headers: { 'x-vai-dev-auth-bypass': '1' } });
  const startedAt = Date.now();
  let text = '';
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { ws.close(); } catch {}
    resolve({ ...value, elapsedMs: Date.now() - startedAt });
  };
  const timer = setTimeout(() => finish({ status: 'timeout', text, council: null }), 180_000);
  ws.on('open', () => ws.send(JSON.stringify({
    conversationId: `competition-council-${Date.now()}`,
    content,
    modelId: 'vai:v0',
    mode: 'chat',
    processDepth: 'balanced',
    allowLearn: false,
  })));
  ws.on('message', (raw) => {
    let chunk;
    try { chunk = JSON.parse(raw.toString()); } catch { return; }
    if (chunk.type === 'text_delta' && chunk.textDelta) text += chunk.textDelta;
    if (chunk.type === 'error') finish({ status: 'error', error: chunk.error, text, council: null });
    if (chunk.type === 'done') finish({ status: 'complete', text, council: chunk.thinking?.council ?? null });
  });
  ws.on('error', (error) => finish({ status: 'error', error: String(error), text, council: null }));
});

const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceReport: reportPath,
  role: 'advisory-only',
  identitiesWithheldDuringReview: true,
  pairs: pairs.map(({ scenarioId, hiddenOrder }) => ({ scenarioId, hiddenOrder })),
  result,
};
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

console.log(`COUNCIL_REVIEW status=${result.status} elapsedMs=${result.elapsedMs}`);
if (result.council) {
  const responded = (result.council.members ?? []).filter((member) => !member.failed);
  console.log(`outcome=${result.council.outcome} agreement=${Math.round((result.council.agreement ?? 0) * 100)}% responded=${responded.length}/${result.council.members?.length ?? 0}`);
  for (const member of responded) console.log(`${member.name}: ${member.verdict} - ${member.note ?? member.action ?? ''}`);
} else if (result.text) {
  console.log(result.text.slice(0, 1600));
}
console.log(`report=${outPath}`);
if (result.status !== 'complete') process.exitCode = 2;

