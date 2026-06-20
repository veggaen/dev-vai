import { describe, it, expect } from 'vitest';
import {
  parseProofProposal,
  runProof,
  gatherMemberProof,
  proofTrustWeight,
  type ProofRunner,
} from './member-experiment.js';
import type { RunEvidence } from '../tools/run-evidence.js';
import type { ModelAdapter } from '../models/adapter.js';

/**
 * member-experiment — a member proves a claim before presenting it. The safety boundary
 * (allowlist-only) and the proved/disproved/blocked classification are the load-bearing parts.
 */

function evidence(partial: Partial<RunEvidence>): RunEvidence {
  return {
    id: 'run:test', command: 'node', args: [], ok: true, exitCode: 0, passed: true,
    stdout: '', stderr: '', durationMs: 1, timedOut: false, truncated: false,
    ranAt: new Date().toISOString(), ...partial,
  } as RunEvidence;
}

const passRunner: ProofRunner = async () => evidence({ passed: true, exitCode: 0, stdout: 'ok' });
const failRunner: ProofRunner = async () => evidence({ passed: false, exitCode: 1, stderr: 'AssertionError: expected 2' });

describe('parseProofProposal', () => {
  it('parses a valid proposal', () => {
    const p = parseProofProposal('{"hypothesis":"2+2 is 4","command":"node","args":["-e","process.exit(2+2===4?0:1)"]}');
    expect(p).toMatchObject({ command: 'node', hypothesis: '2+2 is 4' });
  });
  it('returns null when no proof is proposed (empty fields)', () => {
    expect(parseProofProposal('{"hypothesis":"","command":"","args":[]}')).toBeNull();
  });
  it('returns null for garbage', () => {
    expect(parseProofProposal('I think it works')).toBeNull();
  });
});

describe('runProof — safety + classification', () => {
  it('BLOCKS a command not on the verification allowlist', async () => {
    const r = await runProof(
      { hypothesis: 'delete things', command: 'rm', args: ['-rf', '/'] },
      { runner: passRunner },
    );
    expect(r.status).toBe('blocked');
    expect(r.detail).toMatch(/allowlist/i);
  });

  it('marks PROVED when an allowlisted command passes', async () => {
    const r = await runProof(
      { hypothesis: '2+2=4', command: 'node', args: ['-e', 'process.exit(0)'] },
      { runner: passRunner },
    );
    expect(r.status).toBe('proved');
    expect(r.detail).toMatch(/PASS/);
  });

  it('marks DISPROVED when an allowlisted command fails', async () => {
    const r = await runProof(
      { hypothesis: 'wrong claim', command: 'node', args: ['-e', 'process.exit(1)'] },
      { runner: failRunner },
    );
    expect(r.status).toBe('disproved');
    expect(r.detail).toMatch(/FAIL/);
    expect(r.detail).toMatch(/AssertionError/);
  });

  it('BLOCKS gracefully when the runner throws', async () => {
    const boom: ProofRunner = async () => { throw new Error('spawn EACCES'); };
    const r = await runProof({ hypothesis: 'x', command: 'node', args: ['-e', '0'] }, { runner: boom });
    expect(r.status).toBe('blocked');
  });
});

describe('proofTrustWeight', () => {
  it('boosts a proved member, discounts a disproved one, neutral otherwise', () => {
    expect(proofTrustWeight('proved')).toBeGreaterThan(1);
    expect(proofTrustWeight('disproved')).toBeLessThan(1);
    expect(proofTrustWeight('blocked')).toBe(1);
    expect(proofTrustWeight(undefined)).toBe(1);
  });
});

describe('gatherMemberProof — full round', () => {
  function adapterReturning(reply: string): ModelAdapter {
    return {
      id: 's', displayName: 'S', supportsToolUse: false,
      async chat() { return { message: { role: 'assistant', content: reply } } as any; },
      async *chatStream() { /* unused */ },
    } as any;
  }

  it('runs the proposed proof and returns a verified result', async () => {
    const r = await gatherMemberProof(
      adapterReturning('{"hypothesis":"2+2=4","command":"node","args":["-e","process.exit(0)"]}'),
      { system: 'sys', note: 'I claim 2+2=4', runProofOptions: { runner: passRunner } },
    );
    expect(r?.status).toBe('proved');
  });

  it('returns null when the member proposes no proof', async () => {
    const r = await gatherMemberProof(
      adapterReturning('{"hypothesis":"","command":"","args":[]}'),
      { system: 'sys', note: 'no proof needed', runProofOptions: { runner: passRunner } },
    );
    expect(r).toBeNull();
  });

  it('never throws if the model errors', async () => {
    const broken = { id: 'x', displayName: 'X', chat: async () => { throw new Error('down'); }, async *chatStream() {}, supportsToolUse: false } as any;
    const r = await gatherMemberProof(broken, { system: 's', note: 'n', runProofOptions: { runner: passRunner } });
    expect(r).toBeNull();
  });
});
