/**
 * gen-lockfiles.mjs — regenerate lockfiles.gen.ts
 * Run: node scripts/gen-lockfiles.mjs
 *
 * Reads the pnpm lockfiles from packages/runtime/src/sandbox/ and
 * embeds them as TypeScript string constants so they survive tsc compilation.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandboxDir = join(root, 'packages/runtime/src/sandbox');

const nextjs = readFileSync(join(sandboxDir, 'nextjs-lock.yaml'), 'utf-8');
const reactVite = readFileSync(join(sandboxDir, 'react-vite-lock.yaml'), 'utf-8');

// Escape for template literal embedding
function esc(s) {
  return s
    .split('\\').join('\\\\')
    .split('`').join('\\`')
    .split('${').join('\\${');
}

const out = [
  '// AUTO-GENERATED — do not edit manually.',
  '// Regenerate: node scripts/gen-lockfiles.mjs',
  '// Bundled pnpm lockfiles for sandbox templates — frozen-lockfile = hard-links = fast installs.',
  '/* eslint-disable */',
  `export const NEXTJS_PNPM_LOCK = \`${esc(nextjs)}\`;`,
  '',
  `export const REACT_VITE_PNPM_LOCK = \`${esc(reactVite)}\`;`,
  '',
].join('\n');

writeFileSync(join(sandboxDir, 'lockfiles.gen.ts'), out);
console.log(`Generated lockfiles.gen.ts (${out.length} chars)`);
