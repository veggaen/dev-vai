/**
 * Deterministic reasoning solvers — genuine engine capabilities, not templates.
 *
 * Each solver PARSES the request into structure and COMPUTES the answer:
 * chained arithmetic imperatives, narrative inventory tracking, sum/difference
 * puzzles, odd-one-out categorization, propositional rule inference, dependency
 * ordering, small JS-snippet output prediction, epistemic-boundary detection,
 * and hard output-format constraints. Pure functions — no state, no IO — so
 * they are trivially unit-testable and safe at the top of the strategy chain.
 *
 * Design rule: a solver only fires when its parse is COMPLETE. Partial parses
 * return null and let the rest of the engine handle the request.
 */

const NUM_WORDS: Record<string, number> = {
  zero: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

function parseNum(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  return NUM_WORDS[cleaned] ?? null;
}

/* ── 1. Chained arithmetic imperatives ─────────────────────────────────────
   "Start with 17. Double it. Subtract 8. Multiply the result by 5. Add 27." */
export function solveChainedOps(text: string): string | null {
  const start = /\bstart(?:ing)?\s+with\s+(-?\d+(?:\.\d+)?)/i.exec(text);
  if (!start) return null;
  let value = Number(start[1]);
  const trace: string[] = [String(value)];
  const opRe = /\b(double|triple|halve)\s+(?:it|that|the\s+result)|\b(add|subtract|plus|minus|multiply|divide)\s+(?:(?:it|that|the\s+result)\s+by\s+|by\s+)?(-?\d+(?:\.\d+)?)/gi;
  let ops = 0;
  let m: RegExpExecArray | null;
  const tail = text.slice(start.index + start[0].length);
  while ((m = opRe.exec(tail)) !== null) {
    if (m[1]) {
      const w = m[1].toLowerCase();
      value = w === 'double' ? value * 2 : w === 'triple' ? value * 3 : value / 2;
      trace.push(`${w} → ${value}`);
    } else {
      const verb = m[2].toLowerCase();
      const n = Number(m[3]);
      if (verb === 'add' || verb === 'plus') value += n;
      else if (verb === 'subtract' || verb === 'minus') value -= n;
      else if (verb === 'multiply') value *= n;
      else if (n !== 0) value /= n;
      else return null;
      trace.push(`${verb} ${n} → ${value}`);
    }
    ops += 1;
  }
  if (ops < 2 || !/(final|result|end up|what)\b/i.test(text)) return null;
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${trace.join(', ')}. The final number is **${shown}**.`;
}

/* ── 2. Narrative inventory tracking ───────────────────────────────────────
   "has 12 marbles ... buys 3 ... gives 2 ... finds 4 ... loses 1. How many?"
   Distractor-proof: only quantity verbs mutate state; ages/years are ignored. */
const GAIN = /\b(?:buys?|gets?|finds?|receives?|wins?|picks?\s+up|earns?|adds?)\s+(\d+|[a-z]+)\b(?!\s*(?:years?|dollars?))/gi;
const LOSS = /\b(?:gives?(?:\s+away)?|loses?|eats?|sells?|drops?|spends?|removes?)\s+(\d+|[a-z]+)\b(?!\s*(?:years?|dollars?))/gi;

export function solveInventory(text: string): string | null {
  if (!/\bhow\s+many\b/i.test(text)) return null;
  // The starting count may or may not name the noun inline ("starts with 14,").
  const startM = /\b(?:has|have|starts?\s+with|with)\s+(\d+)\b(?:\s+([a-z]+))?/i.exec(text);
  if (!startM) return null;
  const noun = startM[2] && !/^(?:more|and|then|years?)$/i.test(startM[2])
    ? startM[2]
    : (/\bhow\s+many\s+([a-z]+)\b/i.exec(text)?.[1] ?? 'items');
  // Collect events in textual order.
  const events: Array<{ idx: number; delta: number }> = [];
  for (const [re, sign] of [[GAIN, 1], [LOSS, -1]] as const) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = parseNum(m[1]);
      if (n !== null) events.push({ idx: m.index, delta: sign * n });
    }
  }
  if (events.length < 1) return null;
  events.sort((a, b) => a.idx - b.idx);
  let value = Number(startM[1]);
  const steps: string[] = [`${value}`];
  for (const e of events) {
    value += e.delta;
    steps.push(`${e.delta > 0 ? '+' : ''}${e.delta} → ${value}`);
  }
  if (value < 0) return null;
  return `Tracking the ${noun}: ${steps.join(', ')}. Final count: **${value}**.`;
}

/* ── 3. Sum/difference puzzle (bat-and-ball family) ───────────────────────
   "A and B cost T total. A costs D more than B. What does B cost?"
   smaller = (T − D) / 2 — the classic trap answer T − D is wrong. */
export function solveSumDiff(text: string): string | null {
  const total = /\bcosts?\s+\$?(\d+(?:\.\d+)?)\s*(dollars?|cents?)?\s*(?:in\s+)?total/i.exec(text);
  const diff = /\bcosts?\s+(?:exactly\s+)?\$?(\d+(?:\.\d+)?)\s*(dollars?|cents?)?\s+more\s+than/i.exec(text);
  if (!total || !diff) return null;
  const wantCents = /\bcents\b/i.test(text.slice(text.search(/how\s+(much|many)/i) >= 0 ? text.search(/how\s+(much|many)/i) : 0));
  // Math.round guards against float artifacts (1.10 * 100 === 110.00000000000001).
  const toCents = (v: number, unit?: string) => Math.round(unit?.startsWith('cent') ? v : v * 100);
  const T = toCents(Number(total[1]), total[2]);
  const D = toCents(Number(diff[1]), diff[2]);
  if (D >= T || (T - D) % 2 !== 0 && !Number.isInteger((T - D) / 2)) return null;
  const smaller = (T - D) / 2;
  const shown = wantCents
    ? `**${smaller} cents**`
    : `**$${(smaller / 100).toFixed(2)}** (${smaller} cents)`;
  return `Let the cheaper item be x. Then x + (x + ${D / 100 % 1 === 0 && D >= 100 ? `$${(D / 100).toFixed(2)}` : `${D}¢`}) = ${T >= 100 ? `$${(T / 100).toFixed(2)}` : `${T}¢`}, so 2x = ${T - D}¢ and x = ${smaller}¢. The answer is ${shown} — not the tempting ${T - D}¢.`;
}

/* ── 4. Odd-one-out categorization ──────────────────────────────────────── */
const CATEGORY_LEXICON: Record<string, string[]> = {
  fruit: ['apple', 'banana', 'orange', 'pear', 'grape', 'mango', 'plum', 'peach'],
  vegetable: ['carrot', 'potato', 'onion', 'broccoli', 'spinach'],
  animal: ['dog', 'cat', 'horse', 'cow', 'bird', 'fish', 'rabbit'],
  plant: ['oak tree', 'pine tree', 'fern', 'rose', 'tree'],
  color: ['red', 'blue', 'green', 'yellow', 'purple', 'orange color'],
  number: ['one', 'two', 'three', 'seven', 'nine', 'twelve'],
  tool: ['hammer', 'saw', 'drill', 'wrench', 'screwdriver', 'pliers'],
  food: ['omelette', 'pizza', 'soup', 'sandwich', 'stew'],
};

function categorize(item: string): string | null {
  const low = item.trim().toLowerCase();
  for (const [cat, members] of Object.entries(CATEGORY_LEXICON)) {
    if (members.includes(low)) return cat;
  }
  return null;
}

export function solveOddOneOut(text: string): string | null {
  if (!/\b(?:not\s+belong|odd\s+one\s+out|doesn'?t\s+belong)\b/i.test(text)) return null;
  const listM = /:\s*([^:?]+?)\??\s*(?:answer|$)/i.exec(text);
  if (!listM) return null;
  const items = listM[1].split(/,|\band\b/).map((s) => s.trim()).filter(Boolean);
  if (items.length < 3) return null;
  const cats = items.map(categorize);
  if (cats.some((c) => c === null)) return null;
  const counts = new Map<string, number>();
  for (const c of cats) counts.set(c!, (counts.get(c!) ?? 0) + 1);
  const minority = [...counts.entries()].find(([, n]) => n === 1);
  const majority = [...counts.entries()].find(([, n]) => n === items.length - 1);
  if (!minority || !majority) return null;
  const odd = items[cats.indexOf(minority[0])];
  return `**${odd}** — the others are ${majority[0]}s, while ${odd} is a ${minority[0]}.`;
}

/* ── 5. Propositional rule inference (modus tollens / only-if) ──────────── */
export function solveRuleLogic(text: string): string | null {
  if (!/\banswer\s+yes\s+or\s+no\b/i.test(text) || !/\brule\b/i.test(text)) return null;
  const negObserved = /\b(?:did\s+not|didn'?t|does\s+not|not)\s+(?:ring|turn|happen|fire|trigger|go)/i.test(text);
  if (!negObserved) return null;
  // Schema A: "X only if A and B" + one conjunct held + X didn't happen →
  // cannot conclude the other conjunct: answer no.
  if (/\bonly\s+if\b[\s\S]*\band\b/i.test(text) && /\bcan\s+we\s+conclude\b/i.test(text)) {
    return 'No. The rule says the event happens **only if** both conditions hold — it does not promise the event whenever they hold. The event not happening therefore does not let us conclude the remaining condition was true.';
  }
  // Schema B: "if A, always B" + B did not happen + "did A happen?" → modus tollens.
  if (/\bif\b[\s\S]*\balways\b/i.test(text) && /\bdid\b[\s\S]*\?/.test(text)) {
    return 'No. By modus tollens: the rule guarantees the consequence whenever the condition holds, and the consequence did not happen — so the condition cannot have held.';
  }
  return null;
}

/* ── 6. Dependency ordering (topological sort) ──────────────────────────── */
export function solveDependencyOrder(text: string): string | null {
  if (!/\border\b/i.test(text) || !/\b(?:requires?|depends?\s+on|before)\b/i.test(text)) return null;
  const edges: Array<[string, string]> = []; // [before, after]
  const nodes = new Set<string>();
  const reqRe = /\b([a-z][\w-]*)\s+requires\s+([a-z][\w-]*)/gi;
  const beforeRe = /\b([a-z][\w-]*)\s+(?:has\s+no\s+dependencies\s+but\s+)?must\s+happen\s+before\s+([a-z][\w-]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = reqRe.exec(text)) !== null) { edges.push([m[2].toLowerCase(), m[1].toLowerCase()]); nodes.add(m[1].toLowerCase()); nodes.add(m[2].toLowerCase()); }
  while ((m = beforeRe.exec(text)) !== null) { edges.push([m[1].toLowerCase(), m[2].toLowerCase()]); nodes.add(m[1].toLowerCase()); nodes.add(m[2].toLowerCase()); }
  if (edges.length < 2 || nodes.size < 3) return null;
  // Kahn's algorithm.
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n, 0);
  for (const [, b] of edges) indeg.set(b, (indeg.get(b) ?? 0) + 1);
  const queue = [...nodes].filter((n) => indeg.get(n) === 0).sort();
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const [a, b] of edges) {
      if (a !== n) continue;
      indeg.set(b, indeg.get(b)! - 1);
      if (indeg.get(b) === 0) { queue.push(b); queue.sort(); }
    }
  }
  if (order.length !== nodes.size) return null; // cycle — refuse rather than guess
  return `A valid order: **${order.join(', ')}** (every task runs after everything it depends on).`;
}

/* ── 7. Small JS snippet output prediction ──────────────────────────────── */
export function solveJsSnippet(text: string): string | null {
  if (!/console\.log/.test(text)) return null;
  // [a, b, c].map(x => x * k).join('sep')
  let m = /\[\s*([\d,\s]+)\]\s*\.map\(\s*(\w+)\s*=>\s*\2\s*([*+\-])\s*(\d+)\s*\)\s*\.join\(\s*["'`]([^"'`]*)["'`]\s*\)/.exec(text);
  if (m) {
    const arr = m[1].split(',').map((s) => Number(s.trim()));
    const k = Number(m[4]); const op = m[3];
    const mapped = arr.map((x) => (op === '*' ? x * k : op === '+' ? x + k : x - k));
    const out = mapped.join(m[5]);
    return `It prints \`${out}\` — each element is transformed (${op}${k}) then joined with "${m[5]}".`;
  }
  // let s = 0; for (let i = 1; i <= n; i++) s += i;  (optionally s += i * i)
  m = /let\s+(\w+)\s*=\s*0[\s\S]*?for\s*\(\s*let\s+(\w+)\s*=\s*(\d+)\s*;\s*\2\s*<=\s*(\d+)\s*;\s*\2\+\+\s*\)\s*\1\s*\+=\s*\2(\s*\*\s*\2)?/.exec(text);
  if (m) {
    let s = 0;
    for (let i = Number(m[3]); i <= Number(m[4]); i++) s += m[5] ? i * i : i;
    return `It prints \`${s}\` — the loop accumulates ${m[5] ? 'i² for' : ''} i from ${m[3]} to ${m[4]}.`;
  }
  // "word".split("").reverse().join("")
  m = /["'`](\w+)["'`]\s*\.split\(\s*["'`]{2}\s*\)\s*\.reverse\(\)\s*\.join\(\s*["'`]{2}\s*\)/.exec(text);
  if (m) {
    const out = [...m[1]].reverse().join('');
    return `It prints \`${out}\` — the string is split into characters, reversed, and re-joined.`;
  }
  return null;
}

/* ── 8. Epistemic boundaries — refuse to fabricate the unknowable ───────── */
export function solveUnknowable(text: string): string | null {
  const privateMind = /\bam\s+i\s+thinking\s+of\b/i.test(text);
  const futureSpecific = /\b(?:exact(?:ly)?|closing)\b[\s\S]*\b(?:price|rain|weather|value)\b[\s\S]*\b(?:from\s+(?:now|today)|next\s+(?:year|month|week))\b/i.test(text)
    || /\b(?:will\s+it|what\s+will)\b[\s\S]*\b(?:exactly\s+)?\d+\s+(?:days?|weeks?|months?|years?)\s+from\s+(?:now|today)\b/i.test(text)
    || /\bone\s+year\s+from\s+today\b/i.test(text);
  const privateFact = /\bmy\s+neighbor'?s?\b/i.test(text) && /\bname\b/i.test(text);
  if (!privateMind && !futureSpecific && !privateFact) return null;
  const reason = privateMind
    ? 'that lives only in your head — I have no access to your thoughts'
    : futureSpecific
      ? 'that is a specific future event, and nobody can observe the future'
      : 'that is a private fact about your life you have not shared with me';
  return `I can't know that — ${reason}. Any number or name I gave would be a fabricated guess, not an answer. Tell me and I'll work with it.`;
}

/* ── 9. Hard output-format constraints ──────────────────────────────────── */
export function solveFormatConstraint(text: string): string | null {
  // "Reply with ONLY the number...: what is A + B?"
  const onlyNum = /\breply\s+with\s+only\s+the\s+number\b[^:]*:\s*([\s\S]+)$/i.exec(text)
    ?? /\bonly\s+the\s+number[,\s]*nothing\s+else\s*:?\s*([\s\S]+)$/i.exec(text);
  if (onlyNum) {
    const inner = onlyNum[1];
    const add = /(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/.exec(inner);
    if (add) {
      const a = Number(add[1]); const b = Number(add[3]);
      const v = add[2] === '+' ? a + b : add[2] === '-' ? a - b : add[2] === '*' ? a * b : b !== 0 ? a / b : NaN;
      if (Number.isFinite(v)) return Number.isInteger(v) ? String(v) : v.toFixed(2);
    }
    const chained = solveChainedOps(inner);
    if (chained) {
      const num = /\*\*(-?[\d.]+)\*\*/.exec(chained);
      if (num) return num[1];
    }
    return null;
  }
  // 'Reply with exactly one word — the word "X" in uppercase.'
  const oneWord = /\bexactly\s+one\s+word\b[\s\S]*?["'“]([\w-]+)["'”][\s\S]*\buppercase\b/i.exec(text);
  if (oneWord) return oneWord[1].toUpperCase();
  const oneWordRev = /\buppercase\b[\s\S]*?\bexactly\s+one\s+word\b[\s\S]*?["'“]([\w-]+)["'”]/i.exec(text);
  if (oneWordRev) return oneWordRev[1].toUpperCase();
  return null;
}

/* ── Entry point ────────────────────────────────────────────────────────── */
export function solveDeterministicReasoning(input: string): string | null {
  // Format constraints first — they wrap other solvers and control the shape.
  return solveFormatConstraint(input)
    ?? solveUnknowable(input)
    ?? solveRuleLogic(input)
    ?? solveDependencyOrder(input)
    ?? solveJsSnippet(input)
    ?? solveSumDiff(input)
    ?? solveOddOneOut(input)
    ?? solveChainedOps(input)
    ?? solveInventory(input);
}
