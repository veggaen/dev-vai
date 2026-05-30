import { readFileSync } from 'node:fs';
const path = process.argv[2] || '_ifm_baseline_n1000_s42.json';
const r = JSON.parse(readFileSync(path, 'utf8'));
const buckets = {};
for (const f of r.failures) {
  const k = f.bundle + ': ' + f.reason
    .replace(/\d+/g, 'N')
    .replace(/\(one of:.*?\)/, '(...)')
    .replace(/expected one of:.*$/, 'expected ...')
    .replace(/found "[^"]+"/, 'found ...');
  buckets[k] = (buckets[k] || 0) + 1;
}
console.log(`All failure clusters (${r.failures.length} total):`);
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
  console.log(String(v).padStart(4), k);
}
