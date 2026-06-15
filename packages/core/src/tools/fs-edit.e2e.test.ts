import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  proposeFsEdit,
  applyFsEdit,
  verifyFsEdit,
  rollbackFsEdit,
  contentHash,
} from './fs-edit.js';

/**
 * END-TO-END against REAL temp files: prove the safe-modification contract on disk —
 * propose→apply→verify roundtrip, the pre-image concurrency guard that refuses to
 * clobber a file changed out from under a stale plan, create-new, and rollback.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vai-fsedit-'));
});
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe('fs-edit — propose/apply/verify roundtrip', () => {
  it('proposes a real diff without writing, then applies and verifies it', async () => {
    await writeFile(join(root, 'app.ts'), 'export const v = 1;\n', 'utf8');

    const proposal = await proposeFsEdit('app.ts', 'export const v = 2;\n', { root });
    expect(proposal.ok).toBe(true);
    const plan = proposal.plan!;
    expect(plan.isCreate).toBe(false);
    expect(plan.diff).toContain('- export const v = 1;');
    expect(plan.diff).toContain('+ export const v = 2;');
    // propose() must NOT have written — disk still holds the old content.
    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('export const v = 1;\n');

    const applied = await applyFsEdit(plan, { root });
    expect(applied.ok).toBe(true);
    expect(applied.verification?.ok).toBe(true);
    // Disk now holds exactly the proposed content.
    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('export const v = 2;\n');
  });

  it('refuses a no-op (proposing the current content)', async () => {
    await writeFile(join(root, 'same.ts'), 'unchanged\n', 'utf8');
    const proposal = await proposeFsEdit('same.ts', 'unchanged\n', { root });
    expect(proposal.ok).toBe(false);
    expect(proposal.error).toMatch(/no-op/i);
  });
});

describe('fs-edit — pre-image concurrency guard (the safety property)', () => {
  it('REFUSES to apply when the file changed since the plan was made', async () => {
    await writeFile(join(root, 'race.ts'), 'original\n', 'utf8');
    const plan = (await proposeFsEdit('race.ts', 'my edit\n', { root })).plan!;

    // Someone else edits the file AFTER we planned but BEFORE we apply.
    await writeFile(join(root, 'race.ts'), 'their concurrent edit\n', 'utf8');

    const applied = await applyFsEdit(plan, { root });
    expect(applied.ok).toBe(false);
    expect(applied.error).toMatch(/changed since the plan|refusing to clobber/i);
    // The concurrent edit is preserved — we did NOT clobber it.
    expect(await readFile(join(root, 'race.ts'), 'utf8')).toBe('their concurrent edit\n');
  });

  it('applies cleanly when the file is untouched between plan and apply', async () => {
    await writeFile(join(root, 'stable.ts'), 'before\n', 'utf8');
    const plan = (await proposeFsEdit('stable.ts', 'after\n', { root })).plan!;
    const applied = await applyFsEdit(plan, { root });
    expect(applied.ok).toBe(true);
  });
});

describe('fs-edit — create new files', () => {
  it('proposes and applies a create for a non-existent path', async () => {
    const proposal = await proposeFsEdit('nested/new.ts', 'export const fresh = true;\n', { root });
    expect(proposal.ok).toBe(true);
    expect(proposal.plan!.isCreate).toBe(true);
    expect(proposal.plan!.beforeHash).toBe('absent');

    const applied = await applyFsEdit(proposal.plan!, { root });
    expect(applied.ok).toBe(true);
    expect(await readFile(join(root, 'nested/new.ts'), 'utf8')).toBe('export const fresh = true;\n');
  });

  it('refuses to "edit" an absent file when a non-absent pre-image was expected', async () => {
    const plan = (await proposeFsEdit('ghost.ts', 'content\n', { root })).plan!;
    // Tamper the plan to claim a real pre-image hash for a file that does not exist.
    const tampered = { ...plan, beforeHash: contentHash('imaginary prior\n'), isCreate: false };
    const applied = await applyFsEdit(tampered, { root });
    expect(applied.ok).toBe(false);
    expect(applied.error).toMatch(/absent|refusing/i);
  });
});

describe('fs-edit — rollback', () => {
  it('captures a backup on apply and restores it on rollback', async () => {
    await writeFile(join(root, 'doc.md'), '# original\n', 'utf8');
    const plan = (await proposeFsEdit('doc.md', '# edited\n', { root })).plan!;

    const applied = await applyFsEdit(plan, { root, createBackup: true });
    expect(applied.ok).toBe(true);
    expect(applied.backup?.content).toBe('# original\n');
    expect(await readFile(join(root, 'doc.md'), 'utf8')).toBe('# edited\n');

    // Simulate a downstream gate (build/test) failing → roll back.
    const rolled = await rollbackFsEdit(applied.backup!, { root });
    expect(rolled.ok).toBe(true);
    expect(await readFile(join(root, 'doc.md'), 'utf8')).toBe('# original\n');
  });
});

describe('fs-edit — verify is the release gate', () => {
  it('verify passes only when disk matches the proposed after-hash', async () => {
    await writeFile(join(root, 'v.ts'), 'a\n', 'utf8');
    const plan = (await proposeFsEdit('v.ts', 'b\n', { root })).plan!;
    await applyFsEdit(plan, { root });
    expect((await verifyFsEdit(plan)).ok).toBe(true);

    // External corruption after apply → verify must FAIL (catches partial/raced writes).
    await writeFile(join(root, 'v.ts'), 'corrupted\n', 'utf8');
    const v = await verifyFsEdit(plan);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/≠ proposed|hash/i);
  });
});

describe('fs-edit — path confinement on apply', () => {
  it('refuses to apply a plan whose path escapes the root', async () => {
    const plan = (await proposeFsEdit('inside.ts', 'x\n', { root })).plan!;
    const escaped = { ...plan, path: join(root, '..', 'escape.ts'), relPath: '../escape.ts' };
    const applied = await applyFsEdit(escaped, { root });
    expect(applied.ok).toBe(false);
    expect(applied.error).toMatch(/escapes workspace/i);
  });
});
