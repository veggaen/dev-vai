import { describe, expect, it } from 'vitest';
import { councilGenerateApp } from './pipeline.js';
import { extractJsonObject, specFromBrief } from './pipeline.js';
import { extractAppFiles, validateGeneratedApp } from './validate-app.js';
import { parseActiveSandboxContext } from './parse-sandbox-context.js';
import type {
  CouncilCodegenEvent,
  CouncilCodegenMember,
  CouncilCodegenMessage,
  CouncilCodegenResult,
} from './types.js';

const VALID_APP_TSX = [
  "import { useState } from 'react';",
  '',
  'type Plant = { id: number; name: string; watered: boolean };',
  '',
  'const seed: Plant[] = [',
  "  { id: 1, name: 'Monstera', watered: false },",
  "  { id: 2, name: 'Pothos', watered: true },",
  "  { id: 3, name: 'Fern', watered: false },",
  "  { id: 4, name: 'Cactus', watered: true },",
  "  { id: 5, name: 'Basil', watered: false },",
  '];',
  '',
  'export default function App() {',
  '  const [plants, setPlants] = useState(seed);',
  '  function toggle(id: number) {',
  '    setPlants((current) => current.map((p) => (p.id === id ? { ...p, watered: !p.watered } : p)));',
  '  }',
  '  return (',
  '    <main className="shell">',
  '      <h1>Plant Care</h1>',
  '      <ul className="plant-list">',
  '        {plants.map((plant) => (',
  '          <li key={plant.id}>',
  '            <button type="button" onClick={() => toggle(plant.id)}>',
  '              {plant.name} — {plant.watered ? "watered" : "needs water"}',
  '            </button>',
  '          </li>',
  '        ))}',
  '      </ul>',
  '    </main>',
  '  );',
  '}',
].join('\n');

const VALID_CSS = [
  ':root { color: #eee; }',
  'body { margin: 0; background: #111; font-family: Inter, system-ui, sans-serif; }',
  '.shell { max-width: 720px; margin: 0 auto; padding: 24px; }',
  '.shell h1 { font-size: 28px; letter-spacing: -0.02em; }',
  '.plant-list { display: grid; gap: 8px; list-style: none; padding: 0; }',
  '.plant-list li { border: 1px solid #333; border-radius: 10px; }',
  '.plant-list button { width: 100%; padding: 12px; background: #1c1c1c; color: inherit; border: none; border-radius: 10px; cursor: pointer; }',
  '.plant-list button:hover { background: #262626; }',
  '.plant-list button:focus-visible { outline: 2px solid #4ade80; }',
  '.status { color: #9ca3af; font-size: 13px; }',
  '@media (max-width: 600px) { .shell { padding: 12px; } }',
].join('\n');

function coderReply(appTsx: string, css: string): string {
  return [
    '```tsx title="src/App.tsx"',
    appTsx,
    '```',
    '',
    '```css title="src/styles.css"',
    css,
    '```',
  ].join('\n');
}

function appBlock(appTsx: string): string {
  return `\`\`\`tsx title="src/App.tsx"\n${appTsx}\n\`\`\``;
}

function cssBlock(css: string): string {
  return `\`\`\`css title="src/styles.css"\n${css}\n\`\`\``;
}

/**
 * Role-aware coder stub for the architect→coder→stylist flow: replies are
 * selected by the system prompt's role, and App replies advance through
 * `appAttempts` on each coder/repair call.
 */
function smartCoder(
  id: string,
  appAttempts: readonly string[],
  css: string | ((call: number) => string) = VALID_CSS,
): CouncilCodegenMember & { calls: CouncilCodegenMessage[][] } {
  const calls: CouncilCodegenMessage[][] = [];
  let appCall = 0;
  let cssCall = 0;
  return {
    id,
    displayName: id,
    calls,
    complete: async (messages) => {
      calls.push([...messages]);
      const system = messages[0]?.content ?? '';
      let text: string;
      if (system.includes('You are the architect')) {
        text = ARCHITECT_JSON;
      } else if (system.includes('You are the stylist')) {
        cssCall += 1;
        text = cssBlock(typeof css === 'function' ? css(cssCall) : css);
      } else {
        const app = appAttempts[Math.min(appCall, appAttempts.length - 1)];
        appCall += 1;
        text = app === 'JUNK' ? 'Sorry, I cannot write that.' : appBlock(app);
      }
      return { text, usage: { promptTokens: 10, completionTokens: 20 } };
    },
  };
}

function stubMember(
  id: string,
  respond: (messages: readonly CouncilCodegenMessage[], call: number) => string,
): CouncilCodegenMember & { calls: CouncilCodegenMessage[][] } {
  const calls: CouncilCodegenMessage[][] = [];
  return {
    id,
    displayName: id,
    calls,
    complete: async (messages) => {
      calls.push([...messages]);
      return { text: respond(messages, calls.length), usage: { promptTokens: 10, completionTokens: 20 } };
    },
  };
}

async function runPipeline(members: readonly CouncilCodegenMember[], brief = 'build a houseplant watering tracker app') {
  const events: CouncilCodegenEvent[] = [];
  let result: CouncilCodegenResult | null = null;
  for await (const event of councilGenerateApp({ brief, members })) {
    events.push(event);
    if (event.type === 'result') result = event.result;
  }
  return { events, result };
}

const ARCHITECT_JSON = '{"title": "Plant Care", "packageName": "plant-care", "summary": "Track watering.", "features": ["list plants", "toggle watered", "see status"]}';

describe('councilGenerateApp — happy path', () => {
  it('produces an assembled scaffold from architect + coder + stylist + clean reviews', async () => {
    const coder = smartCoder('local:big', [VALID_APP_TSX]);
    const reviewer = stubMember('local:small', () => '{"verdict": "ship", "mustFix": [], "notes": ["nice"]}');

    const { result, events } = await runPipeline([coder, reviewer]);
    expect(result).not.toBeNull();
    expect(result!.output).toContain('title="src/App.tsx"');
    expect(result!.output).toContain('title="src/styles.css"');
    expect(result!.output).toContain('title="package.json"');
    expect(result!.output).toContain('plant-care');
    expect(result!.repairsUsed).toBe(0);
    expect(result!.memberIds).toEqual(['local:big', 'local:small']);
    expect(coder.calls.length).toBe(3); // architect + app + stylist, no repairs
    expect(events.some((e) => e.type === 'stage' && e.stage === 'review')).toBe(true);
    expect(events.some((e) => e.type === 'stage' && e.stage === 'style')).toBe(true);
  });
});

describe('councilGenerateApp — repair loop', () => {
  it('repairs a syntactically broken first draft', async () => {
    const broken = VALID_APP_TSX.slice(0, VALID_APP_TSX.length - 60); // truncated mid-JSX
    const coder = smartCoder('local:big', [broken, VALID_APP_TSX]);

    const { result } = await runPipeline([coder]);
    expect(result).not.toBeNull();
    expect(result!.repairsUsed).toBe(1);
    expect(result!.validation.ok).toBe(true);
  });

  it('repairs when a reviewer raises a must-fix', async () => {
    const coder = smartCoder('local:big', [VALID_APP_TSX]);
    let reviewCount = 0;
    const reviewer = stubMember('local:small', () => {
      reviewCount += 1;
      return '{"verdict": "needs-work", "mustFix": ["the toggle does not persist"], "notes": []}';
    });

    const { result } = await runPipeline([coder, reviewer]);
    expect(result).not.toBeNull();
    expect(result!.repairsUsed).toBe(1);
    expect(reviewCount).toBe(1); // reviewers are not re-consulted after repair
    expect(coder.calls.length).toBe(4); // architect + app + one repair + stylist
  });

  it('returns null when the code never validates', async () => {
    const coder = smartCoder('local:big', ['JUNK']);

    const { result } = await runPipeline([coder]);
    expect(result).toBeNull();
  });

  it('repairs the stylesheet when coverage is thin, without touching the app', async () => {
    const coder = smartCoder('local:big', [VALID_APP_TSX], (cssCall) =>
      cssCall === 1 ? '.shell { padding: 4px; }' : VALID_CSS);
    const { result } = await runPipeline([coder]);
    expect(result).not.toBeNull();
    expect(result!.validation.ok).toBe(true);
    expect(result!.repairsUsed).toBe(1); // one stylist repair
  });
});

describe('councilGenerateApp — resilience', () => {
  it('falls back to a brief-derived spec when architect output is junk', async () => {
    const coder: CouncilCodegenMember = {
      id: 'local:big',
      displayName: 'local:big',
      complete: async (messages) => {
        const system = messages[0]?.content ?? '';
        if (system.includes('You are the architect')) return { text: 'no json here' };
        if (system.includes('You are the stylist')) return { text: cssBlock(VALID_CSS) };
        return { text: appBlock(VALID_APP_TSX) };
      },
    };

    const { result } = await runPipeline([coder]);
    expect(result).not.toBeNull();
    expect(result!.spec.fromArchitect).toBe(false);
  });

  it('treats a throwing reviewer as non-blocking', async () => {
    const coder = smartCoder('local:big', [VALID_APP_TSX]);
    const reviewer: CouncilCodegenMember = {
      id: 'local:flaky',
      complete: async () => {
        throw new Error('daemon unloaded the model');
      },
    };

    const { result } = await runPipeline([coder, reviewer]);
    expect(result).not.toBeNull();
    expect(result!.reviews[0]?.error).toContain('daemon');
  });

  it('yields a null result for an empty member list', async () => {
    const { result } = await runPipeline([]);
    expect(result).toBeNull();
  });
});

describe('validateGeneratedApp', () => {
  it('accepts the valid app via the tsc checker', async () => {
    const report = await validateGeneratedApp({ appTsx: VALID_APP_TSX, stylesCss: VALID_CSS });
    expect(report.ok).toBe(true);
    expect(report.checker).toBe('tsc');
  });

  it('rejects non-react imports', async () => {
    const withImport = `import axios from 'axios';\n${VALID_APP_TSX}`;
    const report = await validateGeneratedApp({ appTsx: withImport, stylesCss: VALID_CSS });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes('axios'))).toBe(true);
  });

  it('rejects truncated JSX with a syntax error', async () => {
    const report = await validateGeneratedApp({
      appTsx: VALID_APP_TSX.slice(0, VALID_APP_TSX.length - 60),
      stylesCss: VALID_CSS,
    });
    expect(report.ok).toBe(false);
  });

  it('rejects unbalanced CSS as truncation', async () => {
    const report = await validateGeneratedApp({ appTsx: VALID_APP_TSX, stylesCss: '.shell { color: red;' });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes('unbalanced'))).toBe(true);
  });

  // The three live-eval bug classes the syntax-only gate missed.
  it('catches an undefined setter name (TS2304 — live flashcards bug)', async () => {
    const buggy = VALID_APP_TSX.replace('setPlants((current)', 'setPlantList((current)');
    const report = await validateGeneratedApp({ appTsx: buggy, stylesCss: VALID_CSS });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes('setPlantList'))).toBe(true);
  });

  it('catches indexing an untyped object literal (TS7053 — live trip-splitter bug)', async () => {
    const buggy = VALID_APP_TSX.replace(
      'export default function App() {',
      [
        'export default function App() {',
        '  const balances = {};',
        "  (balances as never) && (balances['someone'] = 1);",
      ].join('\n'),
    ).replace("(balances as never) && (balances['someone'] = 1);", "balances['someone'] = 1;");
    const report = await validateGeneratedApp({ appTsx: buggy, stylesCss: VALID_CSS });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes('index'))).toBe(true);
  });

  it('flags mostly-unstyled Tailwind-style classes as a soft (repairable, non-fatal) error', async () => {
    const tailwindy = VALID_APP_TSX
      .replace('className="shell"', 'className="flex flex-col gap-4 p-6 bg-gray-900"')
      .replace('className="plant-list"', 'className="text-green-600 font-medium rounded-lg"');
    const report = await validateGeneratedApp({ appTsx: tailwindy, stylesCss: VALID_CSS });
    // Soft: drives a repair pass but never discards a compilable app.
    expect(report.ok).toBe(true);
    expect(report.softErrors.some((e) => e.includes('unstyled'))).toBe(true);
  });

  it('ships a compilable app even when soft styling issues persist after stylist repairs', async () => {
    // Stylist covers every class (coverage OK) but stays below the richness
    // bar (no hover/font) on every attempt — soft errors never block shipping.
    const thinButCovering = ':root { color: #eee; }\n.shell { padding: 8px; }\n.plant-list { display: grid; }\n.status { color: #888; }';
    const coder = smartCoder('local:big', [VALID_APP_TSX], thinButCovering);
    const { result } = await runPipeline([coder]);
    expect(result).not.toBeNull();
    expect(result!.repairsUsed).toBeGreaterThan(0); // stylist repairs were attempted
    expect(result!.output).toContain('title="src/App.tsx"');
    expect(result!.output).toContain('title="src/styles.css"');
  });

  it('only warns about a couple of unstyled stragglers', async () => {
    const oneMiss = VALID_APP_TSX.replace('className="plant-list"', 'className="plant-list stray-class"');
    const report = await validateGeneratedApp({ appTsx: oneMiss, stylesCss: VALID_CSS });
    expect(report.ok).toBe(true);
    expect(report.warnings.some((w) => w.includes('stray-class'))).toBe(true);
  });
});

describe('extractAppFiles', () => {
  it('reads titled blocks', () => {
    const files = extractAppFiles(coderReply('const x = 1;', '.a { color: red; }'));
    expect(files.appTsx).toBe('const x = 1;');
    expect(files.stylesCss).toBe('.a { color: red; }');
  });

  it('falls back to untitled tsx/css blocks', () => {
    const text = 'Here you go:\n```tsx\nconst x = 1;\n```\nand styles:\n```css\n.a { color: red; }\n```';
    const files = extractAppFiles(text);
    expect(files.appTsx).toBe('const x = 1;');
    expect(files.stylesCss).toBe('.a { color: red; }');
  });
});

describe('extractJsonObject', () => {
  it('parses fenced and prose-wrapped JSON', () => {
    expect(extractJsonObject('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('the spec is {"a": [1, 2,]} ok')).toEqual({ a: [1, 2] });
    expect(extractJsonObject('no json')).toBeNull();
  });
});

describe('councilGenerateApp — edit mode', () => {
  const edit = {
    projectName: 'kanban-board',
    files: [
      { path: 'src/App.tsx', content: VALID_APP_TSX },
      { path: 'src/styles.css', content: VALID_CSS },
    ],
  };
  const fancyCss = `${VALID_CSS}\nbody { background: linear-gradient(135deg, #111, #312e81); }`;

  it('patches only the changed file and keeps the app identity', async () => {
    const coder = stubMember('local:big', () => `\`\`\`css title="src/styles.css"\n${fancyCss}\n\`\`\``);
    const { result, events } = await runPipeline([coder], 'make my background more fancy');
    expect(result).not.toBeNull();
    expect(result!.output).toContain('Updated **kanban-board**');
    expect(result!.output).toContain('title="src/styles.css"');
    expect(result!.output).not.toContain('title="package.json"'); // no scaffold, no new app
    expect(result!.spec.title).toBe('kanban-board');
    expect(events.some((e) => e.type === 'stage' && e.label.includes('targeted change'))).toBe(true);
  });

  it('rejects an edit that tries to rewrite scaffold-owned files', async () => {
    const coder = stubMember('local:big', () => [
      '```json title="package.json"',
      '{"name": "fancy-background-app"}',
      '```',
    ].join('\n'));
    const { result } = await runPipeline([coder], 'make my background more fancy');
    expect(result).toBeNull(); // repair re-emits the same junk → no valid edit → caller falls back
  });

  async function runPipeline(members: readonly CouncilCodegenMember[], brief: string) {
    const events: CouncilCodegenEvent[] = [];
    let result: CouncilCodegenResult | null = null;
    for await (const event of councilGenerateApp({ brief, members, edit })) {
      events.push(event);
      if (event.type === 'result') result = event.result;
    }
    return { events, result };
  }
});

describe('parseActiveSandboxContext', () => {
  it('parses project name and snapshot files from the desktop system prompt', () => {
    const prompt = [
      'ACTIVE SANDBOX PROJECT: "kanban-board"',
      'Dev server is RUNNING at http://localhost:4102',
      '',
      'CURRENT FILE SNAPSHOTS:',
      'FILE: src/App.tsx',
      '```tsx',
      'export default function App() { return null; }',
      '```',
      'FILE: src/styles.css',
      '```css',
      '.a { color: red; }',
      '```',
      '',
      'EDITING RULES: prefer targeted edits.',
    ].join('\n');
    const ctx = parseActiveSandboxContext(prompt);
    expect(ctx?.projectName).toBe('kanban-board');
    expect(ctx?.files.map((f) => f.path)).toEqual(['src/App.tsx', 'src/styles.css']);
  });

  it('drops truncated snapshots and handles absent context', () => {
    const prompt = [
      'ACTIVE SANDBOX PROJECT: "x"',
      'CURRENT FILE SNAPSHOTS:',
      'FILE: src/App.tsx',
      '```tsx',
      'const a = 1;\n/* truncated for prompt context */',
      '```',
    ].join('\n');
    expect(parseActiveSandboxContext(prompt)?.files).toEqual([]);
    expect(parseActiveSandboxContext('You are in Builder mode.')).toBeNull();
    expect(parseActiveSandboxContext(undefined)).toBeNull();
  });
});

describe('brand blueprints', () => {
  it('detects tinder-family briefs and demands the signature features', async () => {
    const { detectBrandBlueprint } = await import('./brand-blueprints.js');
    const bp = detectBrandBlueprint('build me a clone of tinder');
    expect(bp?.brand).toBe('Tinder');
    expect(bp!.features.join(' ')).toMatch(/It'?s a Match/i);
    expect(bp!.features.join(' ')).toMatch(/likesYou/);
    expect(bp!.reviewChecklist.join(' ')).toMatch(/no external image URLs/i);
    expect(detectBrandBlueprint('build a recipe box app')).toBeNull();
  });

  it('threads the blueprint into architect/coder/reviewer prompts', async () => {
    const { detectBrandBlueprint } = await import('./brand-blueprints.js');
    const { buildArchitectMessages, buildCoderMessages, buildReviewerMessages } = await import('./prompts.js');
    const bp = detectBrandBlueprint('tinder clone');
    expect(buildArchitectMessages('tinder clone', bp)[0].content).toContain('BRAND BLUEPRINT — Tinder');
    const spec = { title: 'T', packageName: 't', summary: 's', features: ['f'], fromArchitect: true } as const;
    expect(buildCoderMessages('tinder clone', spec, bp)[0].content).toContain('fd297b');
    expect(buildReviewerMessages('tinder clone', spec, 'code', bp)[0].content).toContain('must-fix');
  });
});

describe('external asset ban', () => {
  it('rejects external image URLs in App.tsx (the randomuser.me case)', async () => {
    const withRemote = VALID_APP_TSX.replace(
      "{ id: 1, name: 'Monstera', watered: false },",
      "{ id: 1, name: 'Monstera', watered: false }, // https://randomuser.me/api/portraits/women/1.jpg",
    ).replace('<h1>Plant Care</h1>', '<h1>Plant Care</h1><img src="https://randomuser.me/api/portraits/women/1.jpg" alt="x" />');
    const report = await validateGeneratedApp({ appTsx: withRemote, stylesCss: VALID_CSS });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes('randomuser.me'))).toBe(true);
  });

  it('allows the w3.org SVG namespace', async () => {
    const withSvg = VALID_APP_TSX.replace(
      '<h1>Plant Care</h1>',
      '<h1>Plant Care</h1><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" /></svg>',
    );
    const report = await validateGeneratedApp({ appTsx: withSvg, stylesCss: VALID_CSS });
    expect(report.ok).toBe(true);
  });
});

describe('specFromBrief', () => {
  it('strips build verbs and titles the remainder', () => {
    const spec = specFromBrief('build me a houseplant watering tracker');
    expect(spec.title.toLowerCase()).toContain('houseplant');
    expect(spec.packageName).toMatch(/^[a-z0-9-]+$/);
    expect(spec.fromArchitect).toBe(false);
  });
});
