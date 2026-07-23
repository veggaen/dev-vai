/**
 * Vai Reasoning Competition — task generators.
 *
 * 9 categories × seeded generators. Dev and holdout splits come from disjoint
 * seed ranges; the holdout is FROZEN (see holdout.frozen.json + run.mjs hash
 * guard). Checkers are strict and programmatic — improving Vai means improving
 * the engine, never these functions.
 */

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

/** A number is "present as the answer" if it appears as a standalone token. */
const hasNum = (text, n) => new RegExp(`(^|[^\\d.])${n}(?!\\.?\\d)`).test(text.replace(/,(?=\d{3}\b)/g, ''));

/* ── generators: each returns { prompt|messages, check(text), note } ── */

const GEN = {
  compositional(r) {
    const a = int(r, 3, 20), b = int(r, 2, 9), c = int(r, 2, 6), d = int(r, 1, 30);
    const ans = (a * 2 - b) * c + d;
    return {
      prompt: `Start with ${a}. Double it. Subtract ${b}. Multiply the result by ${c}. Finally add ${d}. What is the final number?`,
      check: (t) => hasNum(t, ans), note: `expect ${ans}`,
    };
  },
  adversarial(r) {
    const kind = int(r, 0, 2);
    if (kind === 0) {
      const a = int(r, 4, 30), b = int(r, 3, 20), age = int(r, 21, 60);
      return {
        prompt: `Maria has ${a} stamps and is ${age} years old. She buys ${b} more stamps and gives none away. How many stamps does she have now?`,
        check: (t) => hasNum(t, a + b) && !hasNum(t, a + b + age), note: `expect ${a + b}, ignore age ${age}`,
      };
    }
    if (kind === 1) {
      const items = pick(r, [
        ['apple', 'banana', 'carrot', 'carrot'], ['dog', 'cat', 'oak tree', 'oak tree'],
        ['red', 'blue', 'seven', 'seven'], ['hammer', 'saw', 'omelette', 'omelette'],
      ]);
      return {
        prompt: `Which of these does NOT belong with the others: ${items[0]}, ${items[1]}, ${items[2]}? Answer with the odd one out.`,
        check: (t) => t.toLowerCase().includes(items[3]), note: `expect ${items[3]}`,
      };
    }
    const total = pick(r, [110, 210, 310]); const diff = total - 10;
    const ansCents = (total - diff) / 2; // 5 cents style
    return {
      prompt: `A notebook and a pencil cost ${(total / 100).toFixed(2)} dollars in total. The notebook costs exactly ${(diff / 100).toFixed(2)} dollars more than the pencil. How many cents does the pencil cost?`,
      check: (t) => hasNum(t, ansCents), note: `expect ${ansCents} cents`,
    };
  },
  multistep(r) {
    let v = int(r, 10, 30); const steps = [];
    const n1 = int(r, 2, 8); v += n1; steps.push(`buys ${n1} more`);
    const n2 = int(r, 2, Math.min(9, v - 1)); v -= n2; steps.push(`gives ${n2} to a friend`);
    const n3 = int(r, 2, 6); v += n3; steps.push(`finds ${n3} in a drawer`);
    const n4 = int(r, 1, Math.min(5, v - 1)); v -= n4; steps.push(`loses ${n4}`);
    return {
      prompt: `Tom has some marbles. He starts with ${v - n1 + n2 - n3 + n4}, then ${steps.join(', then ')}. How many marbles does Tom have at the end?`,
      check: (t) => hasNum(t, v), note: `expect ${v}`,
    };
  },
  causal(r) {
    const kind = int(r, 0, 1);
    const A = pick(r, ['the door opens', 'the sensor trips', 'the button is pressed']);
    const B = pick(r, ['the system is armed', 'the power is on', 'the override is off']);
    if (kind === 0) {
      return {
        prompt: `Rule: the alarm rings only if ${A} AND ${B}. Yesterday ${B}, but the alarm did not ring. Based only on the rule, can we conclude that ${A.replace('the ', 'the ')}? Answer yes or no, then explain in one sentence.`,
        check: (t) => /\bno\b/i.test(t.slice(0, 200)), note: 'expect no (A must be false)',
      };
    }
    return {
      prompt: `Rule: if ${A}, the light always turns green. This morning the light did NOT turn green. Based only on the rule, did ${A.replace('the ', 'the ')}? Answer yes or no, then explain in one sentence.`,
      check: (t) => /\bno\b/i.test(t.slice(0, 200)), note: 'expect no (modus tollens)',
    };
  },
  planning(r) {
    const names = ['alpha', 'bravo', 'delta', 'echo'];
    // chain: names[0] -> names[1] -> names[2], names[3] independent-first
    return {
      prompt: `You have four tasks: ${names[1]} requires ${names[0]} to be finished first. ${names[2]} requires ${names[1]}. ${names[3]} has no dependencies but must happen before ${names[2]}. Give one valid order to run all four tasks, comma-separated.`,
      check: (t) => {
        const low = t.toLowerCase();
        const pos = names.map((n) => low.lastIndexOf(n));
        return pos.every((p) => p >= 0) && pos[0] < pos[1] && pos[1] < pos[2] && pos[3] < pos[2];
      },
      note: 'alpha<bravo<delta, echo<delta',
    };
  },
  code(r) {
    const kind = int(r, 0, 2);
    if (kind === 0) {
      const arr = [int(r, 1, 5), int(r, 2, 6), int(r, 3, 7)]; const m = int(r, 2, 4);
      const out = arr.map((x) => x * m).join('-');
      return {
        prompt: `What exactly does this JavaScript print?\nconsole.log([${arr.join(', ')}].map(x => x * ${m}).join('-'));`,
        check: (t) => t.includes(out), note: `expect ${out}`,
      };
    }
    if (kind === 1) {
      const n = int(r, 3, 6); let s = 0; for (let i = 1; i <= n; i++) s += i;
      return {
        prompt: `What number does this JavaScript print?\nlet s = 0;\nfor (let i = 1; i <= ${n}; i++) s += i;\nconsole.log(s);`,
        check: (t) => hasNum(t, s), note: `expect ${s}`,
      };
    }
    const w = pick(r, ['stack', 'query', 'panel']);
    return {
      prompt: `What exactly does this JavaScript print?\nconsole.log("${w}".split("").reverse().join(""));`,
      check: (t) => t.includes([...w].reverse().join('')), note: `expect ${[...w].reverse().join('')}`,
    };
  },
  epistemic(r) {
    const q = pick(r, [
      'What number between 1 and 100 am I thinking of right now? Give me the number.',
      'What will the exact closing price of Bitcoin be one year from today? Give a number.',
      'What is the name of my neighbor\'s cat? Answer with the name.',
      'Will it rain in Oslo exactly 47 days from now, yes or no?',
    ]);
    return {
      prompt: q,
      check: (t) => /can('|no)?t|cannot|couldn'?t|no way to|don'?t know|unknow|impossible|not able|cannot know|guess|unable/i.test(t)
        && !/the (number|answer|name) is\s+\w+[.!]?\s*$/i.test(t.trim()),
      note: 'expect honest uncertainty, no confident fabrication',
    };
  },
  memory(r) {
    const code = `zephyr-${int(r, 10, 99)}`; const editor = pick(r, ['neovim', 'zed', 'helix']);
    return {
      messages: [
        { role: 'user', content: `Before we start: my project codename is ${code} and my favorite editor is ${editor}. Please remember both.` },
        { role: 'assistant', content: `Got it — codename ${code}, favorite editor ${editor}.` },
        { role: 'user', content: 'Unrelated: what is a queue in computer science, in one sentence?' },
        { role: 'assistant', content: 'A queue is a first-in, first-out structure where the first item added is the first removed.' },
        { role: 'user', content: 'Back to my setup — what is my project codename?' },
      ],
      check: (t) => t.toLowerCase().includes(code), note: `expect recall of ${code}`,
    };
  },
  control(r) {
    const kind = int(r, 0, 1);
    if (kind === 0) {
      const a = int(r, 12, 60), b = int(r, 13, 70);
      return {
        prompt: `Reply with ONLY the number, nothing else: what is ${a} + ${b}?`,
        check: (t) => new RegExp(`^\\s*\\**${a + b}\\**\\s*\\.?\\s*$`).test(t.trim()), note: `expect bare ${a + b}`,
      };
    }
    const word = pick(r, ['ready', 'done', 'confirmed']);
    return {
      prompt: `Reply with exactly one word — the word "${word}" in uppercase.`,
      check: (t) => t.trim().replace(/[.!]$/, '') === word.toUpperCase(), note: `expect ${word.toUpperCase()}`,
    };
  },
};

export const CATEGORIES = Object.keys(GEN);

export function genTasks(seedBase, perCategory) {
  const tasks = [];
  for (const cat of CATEGORIES) {
    for (let i = 0; i < perCategory; i++) {
      const r = mulberry32(seedBase + i * 101 + CATEGORIES.indexOf(cat) * 7919);
      const t = GEN[cat](r);
      tasks.push({ id: `${cat}-${seedBase}-${i}`, cat, ...t });
    }
  }
  return tasks;
}

/** Metamorphic variants: meaning-preserving rewrites the answer must survive. */
export function metamorphs(task, r) {
  if (task.messages) return []; // multi-turn tasks are excluded from metamorphic wrapping
  const wraps = [
    (p) => `Quick question — ${p.charAt(0).toLowerCase()}${p.slice(1)}`,
    (p) => `My colleague asked me this and I want to double-check the answer. ${p}`,
    (p) => `${pick(r, ['The weather in Oslo is rainy today.', 'I just got back from lunch.', 'My desk is a mess right now.'])} Anyway: ${p}`,
  ];
  return wraps.map((w, i) => ({ ...task, id: `${task.id}-m${i}`, prompt: w(task.prompt) }));
}
