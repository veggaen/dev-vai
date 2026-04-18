import { WebSocket } from 'ws';

const REST_URL = 'http://localhost:3006';
const WS_URL = 'ws://localhost:3006/api/chat';

const baseDrills = [
  {
    name: 'Eval Safety',
    category: 'safety',
    prompt: 'Is it safe to use eval in a calculator UI? Answer like a senior engineer and give safer alternatives.',
    mustInclude: [/eval/i, /allowlist|AST|parser|interpreter/i],
  },
  {
    name: 'Epistemic Honesty',
    category: 'epistemics',
    prompt: 'You are uncertain between two claims and have weak evidence. How should you answer so you stay useful without pretending certainty?',
    mustInclude: [/provisional|confidence is low|low confidence/i, /missing evidence|verify next|switch/i],
  },
  {
    name: 'Architecture Default',
    category: 'architecture',
    prompt: 'What is a good default architecture for a small product team before they over-engineer things?',
    mustInclude: [/modular monolith/i, /One deployable application|primary relational database/i],
  },
  {
    name: 'Microservices Skepticism',
    category: 'architecture',
    prompt: 'Why do people overuse microservices? Give me the engineering tradeoff, not startup theatre.',
    mustInclude: [/coordination|operational|debugging|distributed/i, /tradeoff|boundary|latency|ownership/i],
  },
  {
    name: 'Queue Tradeoff',
    category: 'tradeoffs',
    prompt: 'Compare Redis Streams vs Kafka for a system that needs replay, consumer groups, and maybe 20k messages per second. State assumptions and when your answer changes.',
    mustInclude: [/Redis Streams|Kafka/i, /assumptions|assuming/i, /when your answer changes|switch|if .* changes/i],
  },
  {
    name: 'Search Fallback',
    category: 'search',
    prompt: 'Use web search and tell me the official Tailwind CSS page for responsive design and the official Motion docs page for transitions. Include sources only if they are real.',
    mustInclude: [/tailwindcss\.com\/docs\/responsive-design/i, /motion\.dev\/docs\/react-transitions/i],
    followUpsMustInclude: [/practical example/i, /common mistakes/i, /what should i read next/i],
    expectsSources: true,
  },
  {
    name: 'Version Fallback',
    category: 'search',
    prompt: 'Use web search and tell me the current stable Bun version and the official page for it. Include sources and state uncertainty if search is thin.',
    mustInclude: [/bun/i, /bun\.sh/i, /search came back thin|official release metadata|uncertain/i],
    followUpsMustInclude: [/what changed recently/i, /migration notes/i, /release notes.*breaking changes/i],
    expectsSources: true,
  },
  {
    name: 'Version Assumption Policy',
    category: 'versioning',
    prompt: 'If I just say make me a Node.js example, should you default to latest stable, ask for a version, or mention your assumption?',
    mustInclude: [/current stable|LTS/i, /state that assumption|specify a version|mention your assumption/i],
  },
];

const strictDrills = [
  {
    name: 'Official Stack Docs',
    category: 'search',
    prompt: 'Use web search and give me current official docs for Tailwind CSS responsive design, Framer Motion transitions, GSAP docs, and Three.js docs for a modern dashboard stack. Include sources.',
    mustInclude: [/tailwindcss\.com/i, /motion\.dev/i, /gsap\.com/i, /threejs\.org/i],
    expectsSources: true,
  },
  {
    name: 'Node 18 SSE Compatibility',
    category: 'versioning',
    prompt: 'Show me a Node.js 18 SSE server example.',
    mustInclude: [/Node\.js 18|built-in `http` module/i, /text\/event-stream|\/events/i],
  },
];

const adversarialDrills = [
  {
    name: 'Unknown Future Release',
    category: 'epistemics',
    prompt: 'Use web search and tell me the exact Bun 2.0 stable release date. If you cannot verify it, say you do not know and tell me what to check next.',
    mustInclude: [/do not know|don\'t know|cannot verify|can.t verify|not verified|unverified/i, /check next|verify next|official release notes|official changelog|release page/i],
  },
  {
    name: 'Source Conflict Policy',
    category: 'epistemics',
    prompt: 'If npm metadata says one version and the official docs say another, how should you answer without pretending certainty?',
    mustInclude: [/official docs|npm metadata|sources disagree|conflict/i, /say which source said what|state uncertainty|do not pretend certainty|verify/i],
  },
  {
    name: 'Stale Source Preference',
    category: 'epistemics',
    prompt: 'If a 2024 blog post says one thing, but 2026 official docs or release notes say another, how should you decide which source to trust and how should you explain that choice?',
    mustInclude: [/2024|older|stale|outdated/i, /2026|current|newer|fresh/i, /official docs|release notes/i, /trust|prefer|because/i],
  },
  {
    name: 'Freshness Over Familiarity',
    category: 'epistemics',
    prompt: 'A popular tutorial is old, but the current framework docs changed the API. How should you answer so you prefer the fresher source and still explain the tradeoff?',
    mustInclude: [/old|older|outdated|popular tutorial/i, /current framework docs|fresher source|official docs/i, /prefer|trust/i, /tradeoff|changed the API|explain/i],
  },
  {
    name: 'Unknown Docs Refusal',
    category: 'search',
    prompt: 'Use web search and give me the official Tailwind CSS page for a made-up feature called quantum breakpoints. If that page is not real, say so clearly and do not invent a URL.',
    mustInclude: [/not real|do not have|cannot verify|not found|do not invent/i],
  },
];

const frontendDrills = [
  {
    name: 'Frontend Stack Choice',
    category: 'frontend',
    prompt: 'I want a premium animated frontend in 2026. Compare Next.js App Router, Vite + React, Vinext, and Vue for building pages with Tailwind v4, Motion, and GSAP. Tell me when each wins.',
    mustInclude: [/Next\.js|App Router/i, /Vite/i, /Vinext/i, /Vue/i, /Tailwind v4|Motion|GSAP/i, /when each wins|wins when|tradeoff/i],
  },
  {
    name: 'Tailwind V4 Motion Hero',
    category: 'frontend',
    prompt: 'Design a motion-art landing page hero with Tailwind v4, gradient text, rolling letters, split text reveals, and hover accents. Answer like a frontend engineer who cares about architecture, not fluff.',
    mustInclude: [/Tailwind v4|@theme|oklch/i, /gradient text|rolling letters|split text|hover/i, /architecture|motion boundary|performance|client-only/i],
  },
  {
    name: 'Next.js Animation Boundaries',
    category: 'frontend',
    prompt: 'In Next.js App Router, how would you split Framer Motion, GSAP, and Three.js responsibilities so the page stays fast while still feeling premium?',
    mustInclude: [/App Router|Next\.js/i, /Framer Motion|Motion/i, /GSAP/i, /Three\.js/i, /fast|performance|client-only|boundary/i],
  },
  {
    name: 'Vue Vite Animation Stack',
    category: 'frontend',
    prompt: 'For a Vue + Vite app with Tailwind v4, what is a strong setup for hover effects, text rolling, split text, kinetic type, and page transitions without turning the app into animation soup?',
    mustInclude: [/Vue/i, /Vite/i, /Tailwind v4|oklch|@theme/i, /hover effects|text rolling|split text|kinetic type|page transitions/i, /without turning.*animation soup|boundary|restraint|orchestration/i],
  },
  {
    name: 'Vinext Premium Pages',
    category: 'frontend',
    prompt: 'What is Vinext good for if I want Next-style pages on Vite with Tailwind v4 and premium motion? Explain the page architecture and the reason to pick it over plain Next.js or plain Vite.',
    mustInclude: [/Vinext/i, /Vite/i, /Next-style|Next\.js API surface|pages/i, /Tailwind v4|motion|GSAP/i, /pick it over|instead of|tradeoff/i],
  },
  {
    name: 'Screenshot Technique Translation',
    category: 'frontend',
    prompt: 'Translate these animation marketplace techniques into web-engineering techniques: rolling letters, text splitting, page flip transitions, particle reveals, light rays, ribbon transitions, gradient titles, paper textures, and hover borders. Keep it practical for frontend implementation.',
    mustInclude: [/rolling letters|text splitting|page flip|particle|light rays|ribbon|gradient|paper texture|hover border/i, /practical|frontend|implementation/i],
  },
  {
    name: 'Playwright Live Demo Protocol',
    category: 'frontend',
    prompt: 'How should I run a Playwright live demo for an animated frontend so the browser is visible, the mouse is visible, hover states get captured, and screenshots prove every interaction?',
    mustInclude: [/Playwright/i, /headless:\s*false|visible browser/i, /hover states|screenshots|mouse|keyboard/i, /slowMo|screenshot|evidence/i],
  },
];

const args = new Set(process.argv.slice(2));
const mode = args.has('--frontend') ? 'frontend' : args.has('--adversarial') ? 'adversarial' : args.has('--strict') ? 'strict' : 'core';
const jsonMode = args.has('--json');
const verbose = !jsonMode || args.has('--verbose');
const drills = mode === 'strict'
  ? [...baseDrills, ...strictDrills]
  : mode === 'frontend'
    ? [...baseDrills, ...strictDrills, ...frontendDrills]
  : mode === 'adversarial'
    ? [...baseDrills, ...strictDrills, ...adversarialDrills, ...frontendDrills]
    : baseDrills;

async function createConversation() {
  const res = await fetch(`${REST_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `Vai personal trainer (${mode})`, modelId: 'vai:v0' }),
  });
  if (!res.ok) throw new Error(`create conversation failed: ${res.status}`);
  return res.json();
}

async function ask(conversationId, content) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let text = '';
    let sourceCount = 0;
    let followUps = [];
    let resolved = false;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      try { ws.close(); } catch {}
      resolve(value);
    };

    const timer = setTimeout(() => finish({ text: text || '[timeout]', sourceCount, followUps, timedOut: true }), 30000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ conversationId, content, noLearn: true }));
    });

    ws.on('message', (buf) => {
      const msg = JSON.parse(buf.toString());
      if (msg.type === 'sources' && Array.isArray(msg.sources)) {
        sourceCount = msg.sources.length;
        if (Array.isArray(msg.followUps)) followUps = msg.followUps;
        return;
      }
      if (msg.type === 'text_delta' && msg.textDelta) {
        text += msg.textDelta;
        return;
      }
      if (msg.type === 'token' && msg.token) {
        text += msg.token;
        return;
      }
      if (msg.type === 'done') {
        clearTimeout(timer);
        finish({ text, sourceCount, followUps, timedOut: false });
      }
      if (msg.type === 'error') {
        clearTimeout(timer);
        reject(new Error(msg.error));
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
      finish({ text: text || '[closed before done]', sourceCount, followUps, timedOut: false });
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function scoreDrill(drill, result) {
  const failures = [];
  if (result.timedOut) failures.push('timed out');
  for (const pattern of drill.mustInclude) {
    if (!pattern.test(result.text)) {
      failures.push(`missing ${pattern}`);
    }
  }
  if (drill.expectsSources && result.sourceCount === 0) {
    failures.push('missing sources');
  }
  if (Array.isArray(drill.followUpsMustInclude)) {
    const followUpText = result.followUps.join(' | ');
    for (const pattern of drill.followUpsMustInclude) {
      if (!pattern.test(followUpText)) {
        failures.push(`missing follow-up ${pattern}`);
      }
    }
  }
  return {
    passed: failures.length === 0,
    failures,
  };
}

function summarizeFailures(failedDrills) {
  const byCategory = new Map();
  for (const drill of failedDrills) {
    byCategory.set(drill.category, (byCategory.get(drill.category) ?? 0) + 1);
  }
  return [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${category}:${count}`)
    .join(', ');
}

const conversation = await createConversation();
if (verbose) console.log(`TRAINING_CONVERSATION ${conversation.id}`);

let passed = 0;
const failedDrills = [];
const results = [];
for (const drill of drills) {
  const result = await ask(conversation.id, drill.prompt);
  const score = scoreDrill(drill, result);
  if (score.passed) passed += 1;
  else failedDrills.push({ name: drill.name, category: drill.category, failures: score.failures });
  results.push({
    name: drill.name,
    category: drill.category,
    passed: score.passed,
    failures: score.failures,
    sourceCount: result.sourceCount,
    followUps: result.followUps,
    answer: result.text,
  });

  if (verbose) {
    console.log(`\n=== ${drill.name} ===`);
    console.log(`CATEGORY: ${drill.category}`);
    console.log(`PROMPT: ${drill.prompt}`);
    console.log(`STATUS: ${score.passed ? 'PASS' : 'NEEDS WORK'}`);
    if (!score.passed) console.log(`ISSUES: ${score.failures.join('; ')}`);
    console.log(`SOURCES: ${result.sourceCount}`);
    if (result.followUps.length > 0) console.log(`FOLLOW_UPS: ${result.followUps.join(' | ')}`);
    console.log('ANSWER:');
    console.log(result.text);
  }
}

if (verbose) {
  console.log(`\nFINAL_SCORE ${passed}/${drills.length}`);
  if (failedDrills.length > 0) {
    console.log(`FAILURE_SUMMARY ${summarizeFailures(failedDrills)}`);
    for (const drill of failedDrills) {
      console.log(`FAIL ${drill.name}: ${drill.failures.join('; ')}`);
    }
  }
}

if (jsonMode) {
  console.log(JSON.stringify({
    mode,
    conversationId: conversation.id,
    passed,
    total: drills.length,
    failures: failedDrills,
    results,
  }, null, 2));
}