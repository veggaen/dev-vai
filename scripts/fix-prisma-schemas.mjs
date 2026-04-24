#!/usr/bin/env node
/**
 * fix-prisma-schemas.mjs — Fix single-line Prisma schema blocks
 * in stack templates to multi-line format compatible with Prisma 6+.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const base = 'packages/runtime/src/sandbox/stacks';
const files = ['t3.ts', 'pern.ts', 'nextjs-full.ts'];

for (const f of files) {
  const fp = join(base, f);
  let content = readFileSync(fp, 'utf-8');
  let count = 0;

  // Fix: generator client { provider = "prisma-client-js" } → multi-line
  const genPattern = /`generator client \{ provider = "prisma-client-js" \}`/g;
  content = content.replace(genPattern, () => {
    count++;
    return '`generator client {`,\n      `  provider = "prisma-client-js"`,\n      `}`';
  });

  // Fix: datasource db { provider = "sqlite"; url = "file:./dev.db" } → multi-line
  const sqlitePattern = /`datasource db \{ provider = "sqlite"; url = "file:\.\/dev\.db" \}`/g;
  content = content.replace(sqlitePattern, () => {
    count++;
    return '`datasource db {`,\n      `  provider = "sqlite"`,\n      `  url      = "file:./dev.db"`,\n      `}`';
  });

  // Fix: datasource db { provider = "postgresql"; url = env("DATABASE_URL") } → multi-line
  const pgPattern = /`datasource db \{ provider = "postgresql"; url = env\("DATABASE_URL"\) \}`/g;
  content = content.replace(pgPattern, () => {
    count++;
    return '`datasource db {`,\n      `  provider = "postgresql"`,\n      `  url      = env("DATABASE_URL")`,\n      `}`';
  });

  writeFileSync(fp, content);
  console.log(`${f}: ${count} schema blocks fixed to multi-line`);
}
