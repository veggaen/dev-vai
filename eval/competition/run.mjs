/**
 * Vai Reasoning Competition — runner.
 *
 * Usage:  tsx eval/competition/run.mjs [--split dev|holdout|all] [--meta] [--cat name] [--fails N]
 *
 * Holdout freeze: on first holdout run this writes holdout.frozen.json with a
 * SHA-256 of tasks.mjs. Every later run recomputes the hash — a mismatch means
 * the generators/scorer changed after freezing and holdout numbers are VOID.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { genTasks, metamorphs, mulberry32, CATEGORIES } from './tasks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[i + 1]) : dflt;
};
const split = opt('split', 'all');
const withMeta = args.includes('--meta');
const onlyCat = opt('cat', null);
const showFails = Number(opt('fails', 2));

const DEV_SEED = 1000, HOLDOUT_SEED = 500000, PER_CAT = 8;

/* holdout freeze guard */
const tasksSrc = readFileSync(join(HERE, 'tasks.mjs'), 'utf8');
const hash = createHash('sha256').update(tasksSrc).digest('hex');
const frozenPath = join(HERE, 'holdout.frozen.json');
if (!existsSync(frozenPath)) {
  writeFileSync(frozenPath, JSON.stringify({ frozenAt: new Date().toISOString(), tasksHash: hash, seed: HOLDOUT_SEED, perCategory: PER_CAT }, null, 2));
  console.log('[freeze] holdout frozen:', hash.slice(0, 16));
} else {
  const frozen = JSON.parse(readFileSync(frozenPath, 'utf8'));
  if (frozen.tasksHash !== hash) {
    console.error(`[freeze] !! tasks.mjs changed since holdout freeze (${frozen.tasksHash.slice(0, 12)} -> ${hash.slice(0, 12)}). HOLDOUT SCORES VOID.`);
    process.exitCode = 2;
  }
}

const { VaiEngine } = await import(pathToFileURL(join(ROOT, 'packages', 'core', 'src', 'models', 'vai-engine.ts')).href);
const engine = new VaiEngine({ testMode: true, rng: () => 0.42, now: () => 1_700_000_000_000 });

async function ask(task) {
  const messages = task.messages ?? [{ role: 'user', content: task.prompt }];
  const r = await engine.chat({ messages });
  return r?.message?.content ?? '';
}

async function runSplit(name, seed) {
  let tasks = genTasks(seed, PER_CAT);
  if (onlyCat) tasks = tasks.filter((t) => t.cat === onlyCat);
  const perCat = new Map();
  const fails = [];
  const metaBroken = new Map(); // cat -> {consistent, total}
  for (const task of tasks) {
    const text = await ask(task);
    const pass = task.check(text);
    const s = perCat.get(task.cat) ?? { pass: 0, total: 0 };
    s.total += 1; if (pass) s.pass += 1;
    perCat.set(task.cat, s);
    if (!pass) fails.push({ id: task.id, note: task.note, prompt: (task.prompt ?? '[multi-turn]').slice(0, 110), got: text.slice(0, 160).replace(/\n/g, ' ') });
    if (withMeta && pass) {
      const variants = metamorphs(task, mulberry32(seed + 17));
      let ok = true;
      for (const v of variants) {
        const vt = await ask(v);
        if (!v.check(vt)) { ok = false; fails.push({ id: v.id, note: `META drift: ${v.note}`, prompt: v.prompt.slice(0, 110), got: vt.slice(0, 160).replace(/\n/g, ' ') }); break; }
      }
      const m = metaBroken.get(task.cat) ?? { consistent: 0, total: 0 };
      if (variants.length) { m.total += 1; if (ok) m.consistent += 1; metaBroken.set(task.cat, m); }
    }
  }
  console.log(`\n== ${name} (seed ${seed}) ==`);
  let tp = 0, tt = 0;
  for (const cat of CATEGORIES) {
    const s = perCat.get(cat); if (!s) continue;
    tp += s.pass; tt += s.total;
    const m = metaBroken.get(cat);
    console.log(`${cat.padEnd(14)} ${String(s.pass).padStart(2)}/${s.total}${m ? `  meta ${m.consistent}/${m.total}` : ''}`);
  }
  console.log(`TOTAL          ${tp}/${tt}  (${((tp / Math.max(1, tt)) * 100).toFixed(1)}%)`);
  for (const f of fails.slice(0, showFails * CATEGORIES.length)) {
    console.log(`  ✗ ${f.id} [${f.note}]\n    Q: ${f.prompt}\n    A: ${f.got}`);
  }
  return { pass: tp, total: tt };
}

if (split === 'dev' || split === 'all') await runSplit('DEV', DEV_SEED);
if (split === 'holdout' || split === 'all') await runSplit('HOLDOUT', HOLDOUT_SEED);
