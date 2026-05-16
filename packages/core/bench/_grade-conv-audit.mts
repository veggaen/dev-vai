/**
 * Conv-audit grader v1.
 *
 * Reads _conv_audit_v1.jsonl, tags every captured (prompt, response) with
 * REAL conversational failure modes (not template-shape regexes against
 * a known-good answer), aggregates counts, and emits:
 *
 *   _conv_audit_v1.tagged.jsonl   — every line with a `tags` array added
 *   _conv_audit_v1.report.md      — top tags + counts + sample failures
 *   _conv_audit_v1.samples.json   — up to 8 representative lines per tag
 *
 * Failure modes are intentionally conservative: each tag should be
 * defensible by reading the prompt/response pair without bench context.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const tag = process.env.GRADE_TAG || 'v1';
const inputPath = process.env.GRADE_IN ? resolve(root, process.env.GRADE_IN) : resolve(root, '_conv_audit_v1.jsonl');
const taggedPath = resolve(root, `_conv_audit_${tag}.tagged.jsonl`);
const reportPath = resolve(root, `_conv_audit_${tag}.report.md`);
const samplesPath = resolve(root, `_conv_audit_${tag}.samples.json`);

type Line = {
  bench: string;
  callIdx: number;
  ms: number;
  turnIdx: number;
  prompt: string;
  response: string;
  history: Array<{ role: string; content: string }>;
  sources: number;
  followUps: any;
  confidence: any;
  error: string | null;
};

const SCRATCH_TOKENS = [
  'Grounded continuation',
  'Next layer',
  'Practical move',
  'Building on what we just covered',
  'thinking out loud',
  '[scratch]',
  '<scratch>',
  'RELATED:',
];

const ENCYCLO_OPENERS = [
  /^[A-Z][a-zA-Z0-9 .()\-]{2,40} (?:is|are) the (?:world'?s|first|most|largest|oldest|leading)\b/,
  /^[A-Z][a-zA-Z0-9 .()\-]{2,40} \([A-Z]{2,6}\) (?:is|was)\b/,
  /^In 200[0-9]\b/,
];

const FORMAT_ONLY_PHRASES = [
  /\bonly the (?:name|number|word|letter|symbol|answer)\b/i,
  /\bjust the (?:name|number|word|letter|symbol|answer)\b/i,
  /\b(?:reply|respond|answer) with (?:only )?(?:a |the )?(?:single |one )?(?:word|number|letter|name|symbol)\b/i,
  /\byes or no\b/i,
  /\bone word\b/i,
];

const STOP = new Set([
  'the','a','an','of','to','in','is','it','and','or','but','for','with','on','at','by','from','as','are','was','were','be','been','being','this','that','these','those','i','you','he','she','they','we','my','your','his','her','their','our','me','him','them','us','if','can','could','would','should','will','shall','may','might','do','does','did','have','has','had','what','when','where','why','how','who','which','please','tell','give','show','okay','ok','yes','no','also','just','only','their','about','some','any','all','one','two','first','last',
]);

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => !STOP.has(t) && t.length > 2);
}

function ngrams(toks: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= toks.length; i++) out.push(toks.slice(i, i + n).join(' '));
  return out;
}

function wordCount(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length;
}

function gradeLine(L: Line): string[] {
  const tags: string[] = [];
  const p = String(L.prompt || '');
  const r = String(L.response || '').trim();

  if (L.error) { tags.push('engine_error'); return tags; }
  if (!r) { tags.push('empty_response'); return tags; }

  // 1) template/scratch leak
  if (SCRATCH_TOKENS.some(t => r.includes(t))) tags.push('template_leak');

  // 2) greeting eats prompt — response is *only* a greeting (no answer content)
  //    when prompt was a substantive multi-clause question. We require the
  //    response to literally START with hi/hello/hey/welcome AND be short,
  //    so we don't punish correct short answers like "Leonardo" or "1991".
  const promptWords = wordCount(p);
  const hasQ = /[?]|\b(who|what|when|where|why|how|tell me|give me|list|name)\b/i.test(p);
  const startsGreet = /^(hi|hello|hey|greetings|welcome)\b[\s,!.]/i.test(r);
  if (startsGreet && promptWords >= 10 && hasQ && wordCount(r) <= 12) {
    tags.push('greeting_eats_prompt');
  }

  // 2b) fallback template stitcher: "I don't have a solid answer for **<user tokens>** yet"
  if (/I don'?t have a solid answer for \*\*[^*]+\*\* yet/i.test(r)) {
    tags.push('fallback_stitched_topic');
  }
  if (/I don'?t (?:have|know) (?:a|the|any) (?:solid |reliable |good )?answer (?:for|to) /i.test(r) && /\*\*[^*]+\*\*/.test(r)) {
    if (!tags.includes('fallback_stitched_topic')) tags.push('fallback_stitched_topic');
  }

  // 3) stitched user-token echo: starts with a "What is X" frame + reuses a 3-gram of user tokens
  if (/^(what is|how does|what are|tell me about) /i.test(r)) {
    const pT = tokens(p);
    const rT = tokens(r);
    const pGrams = new Set(ngrams(pT, 3));
    const overlap3 = ngrams(rT, 3).some(g => pGrams.has(g));
    if (overlap3 && wordCount(r) <= 18) tags.push('stitched_user_echo');
  }

  // 4) keyword encyclopedia dump triggered by a noun the user only mentioned in passing
  const isEncycloOpener = ENCYCLO_OPENERS.some(re => re.test(r));
  if (isEncycloOpener && r.length > 200) {
    // Only flag if prompt asks something focused (short or contains "only/just/his name/its capital" style narrowing).
    if (/\b(only|just|his name|her name|its name|its capital|its symbol|its colour|its color|one word|single)\b/i.test(p) || promptWords <= 10) {
      tags.push('keyword_encyclopedia');
    }
  }

  // 5) format-only violation: prompt asks for short answer, response is verbose
  if (FORMAT_ONLY_PHRASES.some(re => re.test(p)) && wordCount(r) > 12) {
    tags.push('format_only_violated');
  }

  // 6) numbered-list requested, response has no list shape
  if (/\bas a numbered list|numbered list of|number them\b/i.test(p)) {
    if (!/(^|\n)\s*\d+[.)]\s+/m.test(r)) tags.push('format_list_violated');
  }

  // 6b) "name N items" / "list N items" without numbered marker should still produce N items
  const nm = p.match(/\b(?:name|list|give me|tell me)\s+(?:me\s+)?(?:any\s+)?(\d{1,2})\b/i);
  if (nm) {
    const want = parseInt(nm[1], 10);
    // count commas + " and " + newline bullets as separator
    const items = (r.match(/[,\u2022\n]| and /g) ?? []).length + 1;
    if (items < want) tags.push('list_too_short');
  }

  // 7) csv requested
  if (/\bas csv\b|comma[- ]separated|separated by comm(?:a|as)/i.test(p)) {
    if (!/,/.test(r) || /\n/.test(r.trim())) tags.push('format_csv_violated');
  }

  // 8) json requested
  if (/\bas json\b|in json|json format|return json\b/i.test(p)) {
    if (!/^[\s\S]*[{\[][\s\S]*[}\]]/.test(r)) tags.push('format_json_violated');
  }

  // 9) word-budget violation: "in N words"
  const wb = p.match(/\bin (\d{1,3}) words?\b/i);
  if (wb) {
    const target = parseInt(wb[1], 10);
    const actual = wordCount(r);
    if (Math.abs(actual - target) / Math.max(1, target) > 0.5) tags.push('format_words_violated');
  }

  // 10) no-content fallback ("I don't have / I can't")
  if (/^I (?:don'?t (?:have|know)|can'?t|cannot|haven'?t|am not able)\b/i.test(r)) {
    tags.push('fallback_refusal');
  }

  // 11) clarification when prompt is clearly specific (>=8 words AND mentions an entity name)
  if (/could you say a bit more|what (?:specifically|exactly) do you mean|which (?:one|sense|meaning)/i.test(r)) {
    if (promptWords >= 8) tags.push('overclarify');
  }

  // 12) extreme latency
  if (L.ms > 1500) tags.push('slow_response');

  if (tags.length === 0) tags.push('ok');
  return tags;
}

const raw = readFileSync(inputPath, 'utf8').split(/\r?\n/).filter(Boolean);
console.log(`graded ${raw.length} lines from ${inputPath}`);

const tagCounts: Record<string, number> = {};
const benchTagCounts: Record<string, Record<string, number>> = {};
const samples: Record<string, Line[]> = {};
const taggedOut: string[] = [];

for (const ln of raw) {
  let L: Line;
  try { L = JSON.parse(ln); } catch { continue; }
  const tags = gradeLine(L);
  taggedOut.push(JSON.stringify({ ...L, tags }));
  for (const t of tags) {
    tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    benchTagCounts[L.bench] ??= {};
    benchTagCounts[L.bench][t] = (benchTagCounts[L.bench][t] ?? 0) + 1;
    if (t !== 'ok' && t !== 'slow_response') {
      samples[t] ??= [];
      if (samples[t].length < 8) samples[t].push(L);
    }
  }
}

writeFileSync(taggedPath, taggedOut.join('\n') + '\n');
writeFileSync(samplesPath, JSON.stringify(samples, null, 2));

// Report
const total = raw.length;
const okCount = tagCounts['ok'] ?? 0;
const failLines = total - okCount;
const lines: string[] = [];
lines.push(`# Conv-audit v1 report`);
lines.push(``);
lines.push(`Captured ${total} (prompt, response) pairs from ${Object.keys(benchTagCounts).length} benches.`);
lines.push(`Of those, ${okCount} (${(okCount * 100 / total).toFixed(1)}%) carry no failure tag; ${failLines} (${(failLines * 100 / total).toFixed(1)}%) match at least one failure tag.`);
lines.push(``);
lines.push(`## Tag totals (sorted)`);
lines.push(``);
lines.push(`| tag | count | % of total |`);
lines.push(`|---|---:|---:|`);
const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
for (const [t, c] of sortedTags) {
  lines.push(`| \`${t}\` | ${c} | ${(c * 100 / total).toFixed(1)}% |`);
}
lines.push(``);
lines.push(`## Per-bench top tag (non-ok)`);
lines.push(``);
lines.push(`| bench | total | worst tag | count |`);
lines.push(`|---|---:|---|---:|`);
const benchOrder = Object.keys(benchTagCounts).sort();
for (const b of benchOrder) {
  const tc = benchTagCounts[b];
  const tot = Object.values(tc).reduce((a, n) => a + n, 0);
  const entries = Object.entries(tc).filter(([t]) => t !== 'ok' && t !== 'slow_response');
  entries.sort((a, b) => b[1] - a[1]);
  const worst = entries[0];
  lines.push(`| ${b} | ${tot} | ${worst ? '`' + worst[0] + '`' : '_(none)_'} | ${worst ? worst[1] : 0} |`);
}
lines.push(``);
lines.push(`## Sample failures per tag (up to 4 per tag)`);
lines.push(``);
for (const [t] of sortedTags) {
  if (t === 'ok' || t === 'slow_response') continue;
  const arr = samples[t] ?? [];
  if (arr.length === 0) continue;
  lines.push(`### \`${t}\` (showing ${Math.min(4, arr.length)} of ${tagCounts[t]})`);
  lines.push(``);
  for (const L of arr.slice(0, 4)) {
    const q = String(L.prompt).replace(/\s+/g, ' ').slice(0, 240);
    const a = String(L.response).replace(/\s+/g, ' ').slice(0, 280);
    lines.push(`- **[${L.bench} #${L.callIdx} t=${L.turnIdx} ms=${L.ms}]**`);
    lines.push(`  - **Q:** ${q}`);
    lines.push(`  - **A:** ${a}`);
  }
  lines.push(``);
}

writeFileSync(reportPath, lines.join('\n'));
console.log(`wrote: ${reportPath}`);
console.log(`wrote: ${taggedPath}`);
console.log(`wrote: ${samplesPath}`);
console.log(``);
console.log(`Tag totals:`);
for (const [t, c] of sortedTags) console.log(`  ${t.padEnd(28)} ${c}`);
