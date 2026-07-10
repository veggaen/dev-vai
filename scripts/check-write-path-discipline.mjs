#!/usr/bin/env node
/**
 * Write-path discipline gate — Master.md §12.6.2: nothing writes to the user's
 * disk without approval.
 *
 * The market context (docs/research/ide-expectations-2026.md, E2): the #1 trust
 * failure developers cite in AI IDEs is silent writes — agents touching files
 * without permission. VAI IDE's entire local-disk write surface is ONE guarded
 * Tauri command behind ONE approval chokepoint. This gate makes that invariant
 * structural: any new call site fails CI.
 *
 * Enforced invariants:
 *   1. `ide_write_file` is invoked from exactly one frontend module
 *      (workspace-client.ts) and defined in exactly one backend (main.rs).
 *   2. `writeWorkspaceFile` stays module-private to workspace-client.ts.
 *   3. `applyApprovedProposals` (the approval chokepoint) is called only from
 *      allowlisted modules, and its body still filters on status === 'approved'.
 *
 * Sandbox writes (`sandboxStore.writeFiles`) are exempt by design: the sandbox
 * is reversible and never the user's own folder. Local disk is the hard line.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CODE_EXT = /\.(ts|tsx|rs|js|mjs|mts|jsx)$/;
const IS_TEST = /\.(test|spec)\.[a-z]+$/;

/** token → files (exact repo paths) allowed to mention it in code. */
const RULES = [
  {
    token: 'ide_write_file',
    allowed: [
      'apps/desktop/src/lib/ide/workspace-client.ts', // sole frontend caller
      'apps/desktop/src-tauri/src/main.rs', // command definition + handler registration
      'scripts/check-write-path-discipline.mjs', // this gate
    ],
  },
  {
    token: 'writeWorkspaceFile',
    allowed: [
      'apps/desktop/src/lib/ide/workspace-client.ts', // private helper, not exported
      'scripts/check-write-path-discipline.mjs',
    ],
  },
  {
    token: 'applyApprovedProposals',
    allowed: [
      'apps/desktop/src/lib/ide/workspace-client.ts', // definition (approval filter lives here)
      'apps/desktop/src/stores/workspaceStore.ts', // applyApproved store action
      // Legacy modal — scheduled for demotion in P1-5. Remove this entry with it.
      'apps/desktop/src/components/ide/WorkspaceLauncher.tsx',
      'scripts/check-write-path-discipline.mjs',
    ],
  },
];

const tracked = execFileSync('git', ['ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8')
  .split('\0')
  .filter((p) => p && CODE_EXT.test(p) && !IS_TEST.test(p));

const failures = [];

for (const file of tracked) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted in working tree
  }
  for (const { token, allowed } of RULES) {
    if (text.includes(token) && !allowed.includes(file)) {
      failures.push(
        `${token} referenced outside its allowlist: ${file}\n` +
          `    Local-disk writes flow through the approval chokepoint only. If this is\n` +
          `    deliberate, extend RULES in scripts/check-write-path-discipline.mjs in the\n` +
          `    same commit and say why in the commit message.`,
      );
    }
  }
}

// Invariant 2b: writeWorkspaceFile must remain unexported.
// Invariant 3b: the chokepoint must still filter on approved status.
try {
  const client = readFileSync('apps/desktop/src/lib/ide/workspace-client.ts', 'utf8');
  if (/export\s+(async\s+)?function\s+writeWorkspaceFile/.test(client)) {
    failures.push(
      'writeWorkspaceFile is exported from workspace-client.ts — it must stay module-private ' +
        'so all local-disk writes pass through applyApprovedProposals.',
    );
  }
  if (!client.includes("status !== 'approved'") && !client.includes('status === \'approved\'')) {
    failures.push(
      "applyApprovedProposals no longer filters on status 'approved' — the §12.6.2 chokepoint is broken.",
    );
  }
} catch {
  failures.push('apps/desktop/src/lib/ide/workspace-client.ts missing — write chokepoint not found.');
}

if (failures.length > 0) {
  console.error(`write-path discipline: ${failures.length} violation(s)\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}

console.log(
  `write-path discipline: clean (${tracked.length} code files scanned; local-disk writes ` +
    'flow only through the approved-proposal chokepoint)',
);
