import { describe, expect, it } from 'vitest';
import { councilGenerateApp } from './pipeline.js';
import { extractJsonObject, specFromBrief } from './pipeline.js';
import { extractAppFiles, validateEditedFiles, validateGeneratedApp } from './validate-app.js';
import { parseActiveSandboxContext } from './parse-sandbox-context.js';
import type {
  CouncilCodegenEvent,
  CouncilCodegenMember,
  CouncilCodegenMessage,
  CouncilCodegenResult,
  CouncilWithheldProposal,
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
  '*, *::before, *::after { box-sizing: border-box; }',
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
  }, 20_000);
});

describe('councilGenerateApp — repair loop', () => {
  it('repairs a syntactically broken first draft', async () => {
    const broken = VALID_APP_TSX.slice(0, VALID_APP_TSX.length - 60); // truncated mid-JSX
    const coder = smartCoder('local:big', [broken, VALID_APP_TSX]);

    const { result } = await runPipeline([coder]);
    expect(result).not.toBeNull();
    expect(result!.repairsUsed).toBe(1);
    expect(result!.validation.ok).toBe(true);
  }, 20_000);

  it('accepts a distinct clean rewrite when a reviewer raises a must-fix', async () => {
    const rewritten = VALID_APP_TSX.replace('Plant Care', 'Plant Care Tracker');
    const coder = smartCoder('local:big', [VALID_APP_TSX, rewritten]);
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
  }, 20_000);

  it('withholds a fresh build when reviewer must-fixes survive unchanged repairs', async () => {
    const coder = smartCoder('local:big', [VALID_APP_TSX]);
    const reviewer = stubMember('local:small', () => '{"verdict":"needs-work","mustFix":["broken image placeholder"],"notes":[]}');
    const { result, events } = await runPipeline([coder, reviewer]);
    expect(result).toBeNull();
    expect(events.some((event) => event.type === 'stage'
      && event.stage === 'validate'
      && event.label.includes('Build withheld'))).toBe(true);
  }, 20_000);

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
  }, 20_000);
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
  }, 20_000);

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
  }, 20_000);

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

  it('rejects Tailwind-style classes because the plain-CSS sandbox cannot execute them', async () => {
    const tailwindy = VALID_APP_TSX
      .replace('className="shell"', 'className="flex flex-col gap-4 p-6 bg-gray-900"')
      .replace('className="plant-list"', 'className="text-green-600 font-medium rounded-lg"');
    const report = await validateGeneratedApp({ appTsx: tailwindy, stylesCss: VALID_CSS });
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes('utility-framework'))).toBe(true);
  });

  it('does not mistake conditional-expression punctuation for a utility class', async () => {
    const conditional = VALID_APP_TSX.replace(
      'className="plant-list"',
      'className={plants.length > 0 ? "plant-list" : "plant-list-empty"}',
    );
    const report = await validateEditedFiles(new Map([['src/App.tsx', conditional]]), ['src/App.tsx']);
    expect(report.ok).toBe(true);
    expect(report.errors.some((error) => error.includes('utility-framework'))).toBe(false);
  });

  it('rejects broken image placeholders and progress controls that can exceed the book total', async () => {
    const unsafe = VALID_APP_TSX
      .replace("name: 'Monstera', watered: false", "name: 'Monstera', watered: false, coverImage: '#', currentPage: 12, totalPages: 10")
      .replace('type Plant = { id: number; name: string; watered: boolean };', 'type Plant = { id: number; name: string; watered: boolean; coverImage?: string; currentPage?: number; totalPages?: number };');
    const report = await validateEditedFiles(
      new Map([['src/App.tsx', unsafe]]),
      ['src/App.tsx'],
      { brief: 'Build a reading tracker with progress controls.' },
    );
    expect(report.ok).toBe(false);
    expect(report.errors.some((error) => error.includes('broken-image'))).toBe(true);
    expect(report.errors.some((error) => error.includes('cannot exceed 100%'))).toBe(true);
  });

  it('rejects raw SVG data-image markup that browser rendering can break', async () => {
    const rawDataImage = VALID_APP_TSX.replace(
      '<h1>Plant Care</h1>',
      '<img src={`data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><text>Book</text></svg>`} alt="Book" />',
    );
    const report = await validateEditedFiles(new Map([['src/App.tsx', rawDataImage]]), ['src/App.tsx']);
    expect(report.ok).toBe(false);
    expect(report.errors.some((error) => error.includes('raw SVG markup'))).toBe(true);
  });

  it('requires real browser storage when the build brief promises persistent local state', async () => {
    const missing = await validateEditedFiles(
      new Map([['src/App.tsx', VALID_APP_TSX]]),
      ['src/App.tsx'],
      { brief: 'Build a reading tracker with persistent local state that survives reloads.' },
    );
    expect(missing.ok).toBe(false);
    expect(missing.errors.some((error) => error.includes('browser storage'))).toBe(true);

    const persistent = VALID_APP_TSX
      .replace('useState(seed)', "useState<Plant[]>(() => (JSON.parse(localStorage.getItem('plants') ?? 'null') as Plant[] | null) ?? seed)")
      .replace('function toggle(id: number) {', "localStorage.setItem('plants', JSON.stringify(plants));\n  function toggle(id: number) {");
    const present = await validateEditedFiles(
      new Map([['src/App.tsx', persistent]]),
      ['src/App.tsx'],
      { brief: 'Build a reading tracker with persistent local state.' },
    );
    expect(present.ok).toBe(true);
  });

  it('requests a stylist repair when CSS lacks overflow-safe sizing or a narrow-screen layout', async () => {
    const unsafeCss = VALID_CSS
      .replace('*, *::before, *::after { box-sizing: border-box; }\n', '')
      .replace('@media (max-width: 600px) { .shell { padding: 12px; } }', '');
    const report = await validateGeneratedApp({ appTsx: VALID_APP_TSX, stylesCss: unsafeCss });
    expect(report.ok).toBe(true);
    expect(report.softErrors.join(' ')).toContain('border-box');
    expect(report.softErrors.join(' ')).toContain('@media');
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
  }, 20_000);

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

  it('allows bounded safe setup files only when the edit explicitly authorizes them', async () => {
    const files = new Map([
      ['hardhat.config.ts', 'export default { solidity: "0.8.24" };'],
      ['contracts/MMM.sol', '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract MMM { }'],
    ]);
    const baseOptions = { external: true, referenceFiles: [{ path: 'package.json', content: '{"name":"mpm"}' }] };

    const blocked = await validateEditedFiles(files, ['package.json'], baseOptions);
    expect(blocked.ok).toBe(false);
    expect(blocked.errors.some((error) => error.includes('not part of the active project'))).toBe(true);

    const allowed = await validateEditedFiles(files, ['package.json'], { ...baseOptions, allowNewFiles: true });
    expect(allowed.ok).toBe(true);

    const unsafe = await validateEditedFiles(
      new Map([['../.env', 'PRIVATE_KEY=secret']]),
      ['package.json'],
      { ...baseOptions, allowNewFiles: true },
    );
    expect(unsafe.ok).toBe(false);
  });

  it('blocks a Hardhat 2-shaped proposal when the user explicitly requested a Hardhat 3 viem lane', async () => {
    const brief = 'Add chain/package.json with hardhat 3.9.1, @nomicfoundation/hardhat-toolbox-viem 5.0.7, and @openzeppelin/contracts 5.6.1. Add chain/hardhat.config.ts, chain/contracts/MMM_UnifiedEntry.sol importing ../../MMM_Unified.sol without copying its logic, chain/ignition/modules/MMM.ts, and chain/test/MMM_Unified.ts. Localhost chain id 31337 at http://127.0.0.1:8545. Root scripts chain:install, chain:compile, chain:test, chain:node, chain:deploy:local, all using npm --prefix chain.';
    const bad = new Map([
      ['package.json', JSON.stringify({ name: 'mpm', scripts: { 'chain:node': 'npx hardhat node' } })],
      ['chain/package.json', JSON.stringify({ scripts: { compile: 'hardhat compile', 'deploy:local': 'hardhat deploy --network localhost' }, devDependencies: { hardhat: '2.19.1' } })],
      ['chain/hardhat.config.ts', 'import { HardhatUserConfig } from "hardhat/config"; import { viem } from "hardhat/plugins"; export default { networks: { localhost: { url: "http://127.0.0.1:8545", chainId: 31337 } }, viem: {} };'],
      ['chain/contracts/MMM_UnifiedEntry.sol', '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\nimport "../../MMM_Unified.sol";\ncontract MMM_UnifiedEntry is MrManManUnified {}'],
      ['chain/ignition/modules/MMM.ts', 'import { Module } from "ignition"; export default class MMM extends Module { async deploy() { return hre.ethers.getContractFactory("MMM_Unified"); } }'],
      ['chain/test/MMM_Unified.ts', 'import { expect } from "chai";\nimport { ethers } from "hardhat";\nimport { deployMMM } from "./ignition";\nvoid mmm.receive({ value: 1 });'],
    ]);
    const report = await validateEditedFiles(bad, ['package.json'], {
      external: true,
      allowNewFiles: true,
      brief,
      referenceFiles: [
        { path: 'package.json', content: '{"name":"mpm","scripts":{}}' },
        { path: 'MMM_Unified.sol', content: 'contract MrManManUnified { receive() external payable {} }' },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('hardhat to the requested 3.9.1'),
      expect.stringContaining('type": "module'),
      expect.stringContaining('defineConfig'),
      expect.stringContaining('buildModule'),
      expect.stringContaining('Node test runner'),
      expect.stringContaining('missing local module'),
    ]));
  });

  it('accepts the structural Hardhat 3 patterns after the deterministic gates are satisfied', async () => {
    const brief = 'Set up Hardhat 3.9.1 under chain/. Add @nomicfoundation/hardhat-toolbox-viem 5.0.7 and @openzeppelin/contracts 5.6.1. Add chain/hardhat.config.ts, chain/contracts/MMM_UnifiedEntry.sol importing ../../MMM_Unified.sol without copying its logic, chain/ignition/modules/MMM.ts, and chain/test/MMM_Unified.ts. Use localhost chain id 31337 at http://127.0.0.1:8545. Root scripts chain:install, chain:compile, chain:test, chain:node, chain:deploy:local, all using npm --prefix chain.';
    const good = new Map([
      ['package.json', JSON.stringify({ name: 'mpm', scripts: {
        'chain:install': 'npm --prefix chain install',
        'chain:compile': 'npm --prefix chain run compile',
        'chain:test': 'npm --prefix chain run test',
        'chain:node': 'npm --prefix chain run node',
        'chain:deploy:local': 'npm --prefix chain run deploy:local',
      } })],
      ['chain/package.json', JSON.stringify({ type: 'module', scripts: {
        compile: 'hardhat build', test: 'hardhat test', node: 'hardhat node',
        'deploy:local': 'hardhat ignition deploy ./ignition/modules/MMM.ts --network localhost',
      }, devDependencies: {
        hardhat: '3.9.1', '@nomicfoundation/hardhat-toolbox-viem': '5.0.7', '@openzeppelin/contracts': '5.6.1',
      } })],
      ['chain/hardhat.config.ts', 'import { defineConfig } from "hardhat/config"; import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem"; export default defineConfig({ plugins: [hardhatToolboxViem], solidity: "0.8.24", networks: { localhost: { type: "http", chainType: "l1", url: "http://127.0.0.1:8545", chainId: 31337 } } });'],
      ['chain/contracts/MMM_UnifiedEntry.sol', '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\nimport "../../MMM_Unified.sol";'],
      ['chain/ignition/modules/MMM.ts', 'import { buildModule } from "@nomicfoundation/hardhat-ignition/modules"; export default buildModule("MMM", (m) => ({ mmm: m.contract("MrManManUnified", ["MrManMan", "MMM"]) }));'],
      ['chain/test/MMM_Unified.ts', 'import { describe, it } from "node:test"; import { network } from "hardhat"; describe("MMM", () => { it("works", async () => { const { viem } = await network.connect(); const [wallet] = await viem.getWalletClients(); await wallet.sendTransaction({ to: "0x0000000000000000000000000000000000000001", value: 1n }); void ["TOTAL_SUPPLY", "PRE_MINT_AMOUNT", "PHASE_COUNT", "MIN_CONTRIBUTION_WEI"]; }); });'],
    ]);
    const report = await validateEditedFiles(good, ['package.json'], {
      external: true,
      allowNewFiles: true,
      brief,
      referenceFiles: [
        { path: 'package.json', content: '{"name":"mpm","scripts":{}}' },
        { path: 'MMM_Unified.sol', content: 'contract MrManManUnified { receive() external payable {} }' },
      ],
    });

    expect(report.ok).toBe(true);
  });

  it('patches only the changed file and keeps the app identity', async () => {
    const coder = stubMember('local:big', () => `\`\`\`css title="src/styles.css"\n${fancyCss}\n\`\`\``);
    const { result, events } = await runPipeline([coder], 'make my background more fancy');
    expect(result).not.toBeNull();
    expect(result!.output).toContain('Prepared a Council-reviewed change for **kanban-board**');
    expect(result!.output).toContain('Nothing is applied until the project approval step completes.');
    expect(result!.output).toContain('title="src/styles.css"');
    expect(result!.output).not.toContain('title="package.json"'); // no scaffold, no new app
    expect(result!.spec.title).toBe('kanban-board');
    expect(events.some((e) => e.type === 'stage'
      && e.stage === 'architect'
      && e.label.includes('Planned a targeted edit'))).toBe(true);
    expect(events.some((e) => e.type === 'stage' && e.label.includes('targeted change'))).toBe(true);
  });

  it('deterministically repairs legacy global JSX return annotations in generated artwork components', async () => {
    const appWithArtwork = VALID_APP_TSX
      .replace(
        'export default function App() {',
        'function CoverArtwork(): JSX.Element {\n  return <svg role="img" aria-label="Original botanical cover" viewBox="0 0 80 120"><path d="M8 100 C24 54 48 44 72 18" /></svg>;\n}\n\nexport default function App() {',
      )
      .replace('<h1>Plant Care</h1>', '<h1>Plant Care</h1><CoverArtwork />');
    const coder = stubMember('local:coder', () => appBlock(appWithArtwork));

    const { result, events } = await runPipeline(
      [coder],
      'Add accessible self-contained inline SVG cover artwork without external image URLs.',
    );

    expect(result, JSON.stringify(events)).not.toBeNull();
    expect(result!.output).toContain('<svg role="img"');
    expect(result!.output).not.toContain('JSX.Element');
    expect(events.some((event) => event.type === 'stage'
      && event.stage === 'repair'
      && event.detail?.includes('global JSX component return annotation'))).toBe(true);
  });

  it('guards dynamic string lookups into literal inline-SVG artwork maps', async () => {
    const appWithArtworkMap = VALID_APP_TSX
      .replace(
        'export default function App() {',
        [
          'function IllustratedCover({ title }: { title: string }) {',
          '  const covers = {',
          '    Monstera: <svg role="img" aria-label="Monstera cover" viewBox="0 0 80 120"><path d="M8 100 C24 54 48 44 72 18" /></svg>,',
          '    Fern: <svg role="img" aria-label="Fern cover" viewBox="0 0 80 120"><path d="M10 90 C30 70 45 35 70 20" /></svg>,',
          '  };',
          '  return <div>{covers[title]}</div>;',
          '}',
          '',
          'export default function App() {',
        ].join('\n'),
      )
      .replace('<h1>Plant Care</h1>', '<h1>Plant Care</h1><IllustratedCover title="Monstera" />');
    const coder = stubMember('local:coder', () => appBlock(appWithArtworkMap));

    const { result, events } = await runPipeline(
      [coder],
      'Add distinct accessible inline SVG cover artwork selected by item title.',
    );

    expect(result, JSON.stringify(events)).not.toBeNull();
    expect(result!.output).toContain('Object.prototype.hasOwnProperty.call(covers, title)');
    expect(result!.output).toContain('covers[title as keyof typeof covers]');
    expect(events.some((event) => event.type === 'stage'
      && event.stage === 'repair'
      && event.detail?.includes('dynamic illustrated-cover map lookup'))).toBe(true);
  });

  it('rejects an edit that tries to rewrite scaffold-owned files', async () => {
    const coder = stubMember('local:big', () => [
      '```json title="package.json"',
      '{"name": "fancy-background-app"}',
      '```',
    ].join('\n'));
    const { result, events } = await runPipeline([coder], 'make my background more fancy');
    expect(result).toBeNull(); // repair re-emits the same junk → no valid edit → caller falls back
    expect(events.some((event) => event.type === 'stage'
      && event.stage === 'validate'
      && event.label.includes('Edit withheld'))).toBe(true);
  });

  it('carries a withheld proposal and its reviewer evidence into the next turn', async () => {
    const firstApp = VALID_APP_TSX.replace('<h1>Plant Care</h1>', '<div className="reading-room-grain" /><h1>Plant Care</h1>');
    const firstCoder = stubMember('local:first-coder', () => appBlock(firstApp));
    const blockingReviewer = stubMember('local:reviewer', () => JSON.stringify({
      verdict: 'needs-work',
      mustFix: ['Add a visible paper-grain layer without removing the existing controls.'],
      notes: [],
    }));
    let withheld: CouncilWithheldProposal | undefined;
    const firstEvents: CouncilCodegenEvent[] = [];
    for await (const event of councilGenerateApp({
      brief: 'Redesign the reading room with a paper-grain layer.',
      members: [firstCoder, blockingReviewer],
      edit,
      maxRepairs: 0,
    })) {
      firstEvents.push(event);
      if (event.type === 'result') withheld = event.withheld;
    }

    expect(withheld, JSON.stringify(firstEvents)).toBeDefined();
    expect(withheld!.files.map((file) => file.path)).toEqual(['src/App.tsx']);
    expect(withheld!.reviews[0].mustFix).toContain('Add a visible paper-grain layer without removing the existing controls.');

    const resumedApp = firstApp.replace('<div className="reading-room-grain" />', '<div className="reading-room-grain" aria-hidden="true" />');
    const repairCoder = stubMember('local:second-coder', () => appBlock(resumedApp));
    const cleanReviewer = stubMember('local:reviewer', () => '{"verdict":"ship","mustFix":[],"notes":["resolved"]}');
    const events: CouncilCodegenEvent[] = [];
    let result: CouncilCodegenResult | null = null;
    for await (const event of councilGenerateApp({
      brief: 'Retry the withheld reading-room edit and fix the remaining issue.',
      members: [repairCoder, cleanReviewer],
      edit,
      resume: withheld,
      maxRepairs: 1,
    })) {
      events.push(event);
      if (event.type === 'result') result = event.result;
    }

    expect(result).not.toBeNull();
    expect(result!.output).toContain('aria-hidden="true"');
    expect(events.some((event) => event.type === 'stage' && event.label.includes('Resumed a 1-file withheld proposal'))).toBe(true);
    expect(repairCoder.calls).toHaveLength(1);
    expect(repairCoder.calls[0][1].content).toContain('YOUR PREVIOUS (REJECTED) EDIT');
    expect(repairCoder.calls[0][1].content).toContain('reading-room-grain');
  }, 15_000);

  it('requires review after a resumed static-validation failure is repaired', async () => {
    const staticFailure: CouncilWithheldProposal = {
      schemaVersion: 1,
      projectName: edit.projectName,
      brief: 'Create a polished reading-room design.',
      files: [
        { path: 'src/App.tsx', content: VALID_APP_TSX },
        { path: 'src/styles.css', content: fancyCss },
        { path: 'index.html', content: '<!doctype html><div id="root"></div>' },
      ],
      validation: {
        ok: false,
        errors: ['index.html is scaffold-owned'],
        softErrors: [],
        warnings: [],
        checker: 'tsc',
      },
      reviews: [],
      repairsUsed: 2,
      memberIds: ['local:first-coder'],
    };
    const repairCoder = stubMember('local:second-coder', () => appBlock(VALID_APP_TSX));
    const reviewer = stubMember('local:reviewer', () => JSON.stringify({
      verdict: 'needs-work',
      mustFix: ['The repaired proposal is still visually generic.'],
      notes: [],
    }));
    const events: CouncilCodegenEvent[] = [];
    let result: CouncilCodegenResult | null = null;
    let nextWithheld: CouncilWithheldProposal | undefined;
    for await (const event of councilGenerateApp({
      brief: 'Resume the withheld proposal and remove the scaffold-owned file.',
      members: [repairCoder, reviewer],
      edit,
      resume: staticFailure,
      maxRepairs: 1,
    })) {
      events.push(event);
      if (event.type === 'result') {
        result = event.result;
        nextWithheld = event.withheld;
      }
    }

    expect(result).toBeNull();
    expect(reviewer.calls).toHaveLength(1);
    expect(nextWithheld?.reviews[0].mustFix).toEqual(['The repaired proposal is still visually generic.']);
    expect(events.some((event) => event.type === 'stage'
      && event.label.includes('reviewing the repaired shared proposal'))).toBe(true);
  }, 15_000);

  it('preserves the original acceptance contract when validating a continuation', async () => {
    const originalContract: CouncilWithheldProposal = {
      schemaVersion: 1,
      projectName: edit.projectName,
      brief: 'Create distinct illustrated covers and do not reuse the purple/pink gradient.',
      files: [
        { path: 'src/App.tsx', content: VALID_APP_TSX },
        { path: 'src/styles.css', content: `${VALID_CSS}\n.book-cover { background: #7c3aed; }` },
      ],
      validation: {
        ok: false,
        errors: ['Add accessible labels.'],
        softErrors: [],
        warnings: [],
        checker: 'tsc',
      },
      reviews: [],
      repairsUsed: 1,
      memberIds: ['local:coder'],
    };
    let withheld: CouncilWithheldProposal | undefined;
    for await (const event of councilGenerateApp({
      brief: 'Resume the proposal and add the missing accessible labels.',
      members: [stubMember('local:coder', () => appBlock(VALID_APP_TSX))],
      edit,
      resume: originalContract,
      maxRepairs: 0,
    })) {
      if (event.type === 'result') withheld = event.withheld;
    }

    expect(withheld?.brief).toContain('do not reuse the purple/pink gradient');
    expect(withheld?.brief).toContain('Continuation request:');
    expect(withheld?.validation.errors).toContain('The explicitly rejected purple/pink gradient palette is still present in the stylesheet.');
  });

  it('withholds empty inline-SVG placeholders and a missing requested dark atmosphere', async () => {
    const placeholderApp = VALID_APP_TSX
      .replace('<h1>Plant Care</h1>', '<h1>Plant Care</h1><svg aria-label="Book cover">{/* artwork later */}</svg>');
    const lightCss = VALID_CSS.replace('background: #111', 'background: #f4f4f9');
    const coder = stubMember('local:coder', () => [
      appBlock(placeholderApp),
      `\`\`\`css title="src/styles.css"\n${lightCss}\n\`\`\``,
    ].join('\n'));
    let withheld: CouncilWithheldProposal | undefined;
    for await (const event of councilGenerateApp({
      brief: 'Add accessible inline SVG cover artwork and a deep-ink atmospheric background.',
      members: [coder],
      edit,
      maxRepairs: 0,
    })) {
      if (event.type === 'result') withheld = event.withheld;
    }

    expect(withheld?.validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('empty SVG placeholder'),
      expect.stringContaining('deep-ink/dark page atmosphere is missing'),
    ]));
  });

  it('withholds repeated text-only covers, a rejected purple palette, and missing texture', async () => {
    const repeatedCovers = [
      '<svg aria-label="First cover" viewBox="0 0 24 36"><rect width="24" height="36" fill="#f5e7dc" /><text x="12" y="22" text-anchor="middle" font-family="Serif" font-size="12">A</text></svg>',
      '<svg aria-label="Second cover" viewBox="0 0 24 36"><rect width="24" height="36" fill="#efe1d5" /><text x="12" y="22" text-anchor="middle" font-family="Serif" font-size="12">B</text></svg>',
    ].join('');
    const repeatedApp = VALID_APP_TSX.replace('<h1>Plant Care</h1>', `<h1>Plant Care</h1>${repeatedCovers}`);
    const purpleCss = `${VALID_CSS}\n.book-cover { background: linear-gradient(145deg, #111827, #7c3aed, #ec4899); }`;
    const coder = stubMember('local:coder', () => [
      appBlock(repeatedApp),
      `\`\`\`css title="src/styles.css"\n${purpleCss}\n\`\`\``,
    ].join('\n'));
    let withheld: CouncilWithheldProposal | undefined;
    const events: CouncilCodegenEvent[] = [];
    for await (const event of councilGenerateApp({
      brief: 'Create genuinely distinct cover compositions with real illustration, do not reuse the purple/pink gradient, and add subtle paper texture.',
      members: [coder],
      edit,
      maxRepairs: 0,
    })) {
      events.push(event);
      if (event.type === 'result') withheld = event.withheld;
    }

    expect(withheld?.validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('reuse the same non-text structure'),
      expect.stringContaining('only text/background shapes'),
      expect.stringContaining('purple/pink gradient palette'),
      expect.stringContaining('paper/line texture is missing'),
    ]));
    const app = withheld?.files.find((file) => file.path === 'src/App.tsx')?.content ?? '';
    expect(app).toContain('textAnchor="middle"');
    expect(app).not.toContain('text-anchor=');
    expect(events.some((event) => event.type === 'stage'
      && event.detail?.includes('React DOM property names'))).toBe(true);
  });

  it('withholds unrecognizable title scenes and missing search-to-grid spacing', async () => {
    const weakScenes = [
      'function BookCover({ title }: { title: string }) {',
      '  switch (title) {',
      "    case 'To Kill a Mockingbird': return (<svg><circle cx=\"12\" cy=\"18\" r=\"10\" /><path d=\"M1 1L2 2\" /></svg>);",
      "    case '1984': return (<svg><circle cx=\"12\" cy=\"18\" r=\"10\" /><ellipse cx=\"12\" cy=\"18\" rx=\"8\" ry=\"4\" /><line x1=\"6\" y1=\"18\" x2=\"18\" y2=\"18\" /><line x1=\"6\" y1=\"18\" x2=\"18\" y2=\"18\" /><line x1=\"6\" y1=\"18\" x2=\"18\" y2=\"18\" /></svg>);",
      "    case 'The Great Gatsby': return (<svg><rect width=\"12\" height=\"24\" /><rect width=\"12\" height=\"24\" /><circle cx=\"12\" cy=\"18\" r=\"2\" /></svg>);",
      "    case 'Pride and Prejudice': return (<svg><ellipse cx=\"12\" cy=\"18\" rx=\"8\" ry=\"4\" /><path d=\"M1 1L2 2\" /><path d=\"M1 1L2 2\" /></svg>);",
      "    case 'The Catcher in the Rye': return (<svg><line x1=\"6\" y1=\"18\" x2=\"18\" y2=\"18\" /><line x1=\"6\" y1=\"18\" x2=\"18\" y2=\"18\" /><line x1=\"6\" y1=\"18\" x2=\"18\" y2=\"18\" /><path d=\"M1 1L2 2\" /></svg>);",
      '    default: return null;',
      '  }',
      '}',
      '',
    ].join('\n');
    const app = `${VALID_APP_TSX.replace('export default function App() {', `${weakScenes}export default function App() {`).replace('<h1>Plant Care</h1>', '<h1>Plant Care</h1><BookCover title="1984" />')}`;
    const css = `${VALID_CSS}\n.search-bar { display: flex; }`;
    const coder = stubMember('local:coder', () => [appBlock(app), `\`\`\`css title="src/styles.css"\n${css}\n\`\`\``].join('\n'));
    let withheld: CouncilWithheldProposal | undefined;
    for await (const event of councilGenerateApp({
      brief: 'Mockingbird needs a moon, branch, and perched bird; for 1984 use an eye, pupil and surveillance rays; Gatsby needs an art-deco skyline and beacon; Pride and Prejudice needs a cameo with profiles and botanical leaves; Catcher in the Rye needs wheat and a horse. Every SVG needs a unique aria-label and role="img". Restore a gap inside the search/filter bar and margin before the cards grid. Keep a visible gap between the stats header and search. Add a repeating-linear-gradient texture plus a radial-gradient light layer.',
      members: [coder],
      edit,
      maxRepairs: 0,
    })) {
      if (event.type === 'result') withheld = event.withheld;
    }

    expect(withheld?.validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('To Kill a Mockingbird cover does not yet contain'),
      expect.stringContaining('1984 cover does not yet contain'),
      expect.stringContaining('The Great Gatsby cover does not yet contain'),
      expect.stringContaining('Pride and Prejudice cover does not yet contain'),
      expect.stringContaining('The Catcher in the Rye cover does not yet contain'),
      expect.stringContaining('requested SVG cover(s) are missing both a meaningful aria-label and role="img"'),
      expect.stringContaining('.search-bar needs both an internal gap and margin below'),
      expect.stringContaining('separation between the stats header and search panel is missing'),
      expect.stringContaining('repeating-linear-gradient texture is missing'),
      expect.stringContaining('radial-gradient light layer is missing'),
    ]));
  }, 15_000);

  it('refuses truncated package JSON and mixed Storybook majors in external edits', async () => {
    const originalPackage = JSON.stringify({
      name: 'storybook-demo',
      scripts: { start: 'react-scripts start', storybook: 'start-storybook -p 9009' },
      dependencies: { 'react-scripts': '3.4.1' },
      devDependencies: {
        '@storybook/react': '^5.3.19',
        '@storybook/addon-actions': '^5.3.19',
      },
    }, null, 2);
    const projectEdit = {
      projectName: 'storybook-demo',
      external: true,
      files: [{ path: 'package.json', content: originalPackage }],
    };
    const invalid = stubMember('local:big', () => '```json title="package.json"\n{"scripts":{"build":"react\n```');
    const mixed = stubMember('local:mixed', () => `\`\`\`json title="package.json"\n${JSON.stringify({
      name: 'storybook-demo',
      scripts: { start: 'react-scripts start', storybook: 'start-storybook -p 9009' },
      dependencies: { 'react-scripts': '5.0.1' },
      devDependencies: {
        '@storybook/react': '^6.5.19',
        '@storybook/addon-actions': '^5.3.19',
      },
    }, null, 2)}\n\`\`\``);

    for (const coder of [invalid, mixed]) {
      const events: CouncilCodegenEvent[] = [];
      let result: CouncilCodegenResult | null = null;
      for await (const event of councilGenerateApp({
        brief: 'Repair the Node 22 failure while preserving the existing app and Storybook scripts.',
        members: [coder],
        edit: projectEdit,
        maxRepairs: 1,
      })) {
        events.push(event);
        if (event.type === 'result') result = event.result;
      }
      expect(result).toBeNull();
      expect(events.some((event) => event.type === 'stage'
        && event.stage === 'validate'
        && /invalid JSON|mixes Storybook major versions/.test(event.detail ?? ''))).toBe(true);
    }
  });

  it('refuses to ship when a reviewer must-fix survives a no-op repair', async () => {
    const coder = stubMember('local:big', () => appBlock(VALID_APP_TSX));
    const reviewer = stubMember('local:reviewer', () => JSON.stringify({
      verdict: 'needs-work',
      mustFix: ['client RPC URL still ends in /undefined'],
      notes: [],
    }));

    const { result, events } = await runPipeline(
      [coder, reviewer],
      'repair the undefined client RPC URL in src/App.tsx',
    );

    expect(result).toBeNull();
    expect(events.some((event) => event.type === 'stage'
      && event.label.includes('Edit refused')
      && event.detail?.includes('/undefined'))).toBe(true);
  }, 20_000);

  it('re-reviews a distinct repair and ships only after the must-fix clears', async () => {
    const repairedApp = VALID_APP_TSX.replace('<h1>Plant Care</h1>', '<h1>Plant Care Pro</h1>');
    const coder = stubMember('local:big', (_messages, call) => appBlock(call === 1 ? VALID_APP_TSX : repairedApp));
    const reviewer = stubMember('local:reviewer', (_messages, call) => JSON.stringify(call === 1
      ? { verdict: 'needs-work', mustFix: ['requested repaired heading is missing'], notes: [] }
      : { verdict: 'ship', mustFix: [], notes: [] }));

    const { result } = await runPipeline(
      [coder, reviewer],
      'change the heading to Plant Care Pro in src/App.tsx',
    );

    expect(result).not.toBeNull();
    expect(result!.output).toContain('Plant Care Pro');
    expect(reviewer.calls).toHaveLength(2);
  });

  it('cannot vote away a reported client /undefined RPC signature', async () => {
    const unsafeApp = VALID_APP_TSX.replace(
      'export default function App()',
      'const rpc = `https://mainnet.infura.io/v3/${process.env.INFURA}`;\nexport default function App()',
    );
    const coder = stubMember('local:big', () => appBlock(unsafeApp));
    const reviewer = stubMember('local:reviewer', () => JSON.stringify({
      verdict: 'ship',
      mustFix: [],
      notes: [],
    }));

    const { result, events } = await runPipeline(
      [coder, reviewer],
      'Repair the observed /undefined RPC because browser code reads a server-only environment value.',
    );

    expect(result).toBeNull();
    expect(events.some((event) => event.type === 'stage'
      && event.detail?.includes('server-only process.env'))).toBe(true);
  }, 20_000);

  it('deterministically repairs known Wagmi client-RPC and optional analytics signatures', async () => {
    const unsafeApp = VALID_APP_TSX.replace(
      'export default function App()',
      [
        'const http = (url?: string) => url;',
        'const transport = http(`https://mainnet.infura.io/v3/${process.env.INFURA}`);',
        'declare global { interface Window { __APPKIT_INITIALIZED__?: boolean } }',
        'const createAppKit = (_options: unknown) => undefined;',
        'const appkitProjectId = process.env.NEXT_PUBLIC_PROJECT_ID as string;',
        "if (typeof window !== 'undefined' && !window.__APPKIT_INITIALIZED__) {",
        '  createAppKit({',
        '    projectId: appkitProjectId,',
        '    features: { analytics: true },',
        '  })',
        '  window.__APPKIT_INITIALIZED__ = true',
        '}',
        'export default function App()',
      ].join('\n'),
    );
    const coder = stubMember('local:big', () => appBlock(unsafeApp));
    const reviewer = stubMember('local:reviewer', () => JSON.stringify({
      verdict: 'needs-work',
      mustFix: [
        'The projectId is read directly from an environment variable and may be undefined at runtime.',
        'AppKit analytics or network failures are not handled and can become an uncaught page error.',
      ],
      notes: [],
    }));

    const { result, events } = await runPipeline(
      [coder, reviewer],
      'Repair the observed /undefined RPC from a server-only env and stop optional AppKit analytics from becoming an uncaught page error.',
    );

    expect(result, JSON.stringify(events)).not.toBeNull();
    expect(result!.output).toContain('const transport = http();');
    expect(result!.output).toContain('analytics: false');
    expect(result!.output).not.toContain('process.env.INFURA');
    expect(result!.output).toContain("process.env.NEXT_PUBLIC_PROJECT_ID?.trim() ?? ''");
    expect(result!.output).toContain('Boolean(appkitProjectId)');
    expect(result!.output).toContain("console.error('AppKit initialization failed without blocking the app shell.'");
    expect(events.some((event) => event.type === 'stage'
      && event.label.includes('deterministic runtime-safety'))).toBe(true);
    expect(events.some((event) => event.type === 'stage'
      && event.label.includes('stale reviewer claim'))).toBe(true);
  });

  it('deterministically repairs the observed Book Tracker cover, progress, and hydration signatures', async () => {
    const unsafeBookApp = [
      "import { useEffect, useState } from 'react';",
      'interface Book { id: string; title: string; coverImage: string; currentPage: number; totalPages: number; }',
      "const books: Book[] = [{ id: '1', title: '1984', coverImage: '#', currentPage: 20, totalPages: 100 }];",
      'export default function App() {',
      "  const [booksState, setBooksState] = useState<Book[]>(books);",
      "  useEffect(() => { localStorage.setItem('books', JSON.stringify(booksState)); }, [booksState]);",
      "  useEffect(() => { const savedBooks = localStorage.getItem('books'); if (savedBooks) { setBooksState(JSON.parse(savedBooks)); } }, []);",
      "  const filteredBooks = booksState.filter((book) => book.title).map((book, index) => (",
      '    <article className="book-card" key={book.id}>',
      '      <img src={book.coverImage} alt={book.title} />',
      '      <input type="number" min="1" max={book.totalPages} value={book.currentPage} onChange={(e) => {',
      '        const newBooks = [...booksState];',
      '        newBooks[index].currentPage = parseInt(e.target.value, 10);',
      '        setBooksState(newBooks);',
      '      }} />',
      '    </article>',
      '  ));',
      '  return <main className="app"><div className="book-stack">{filteredBooks}</div></main>;',
      '}',
    ].join('\n');
    const bookCss = [
      '*, *::before, *::after { box-sizing: border-box; }',
      'body { margin: 0; background: #111827; font-family: Inter, sans-serif; }',
      '.app { min-height: 100vh; padding: 2rem; }',
      '.book-stack { display: grid; gap: 1rem; }',
      '.book-card { padding: 1rem; background: #fff; border-radius: 1rem; }',
      '.book-card input { width: 100%; }',
      '.book-card input:hover { border-color: #7c3aed; }',
      '.book-card input:focus-visible { outline: 2px solid #7c3aed; }',
      '.book-card img { width: 100%; }',
      '.book-card strong { color: #111827; }',
      '@media (max-width: 600px) { .app { padding: 1rem; } }',
    ].join('\n');
    const projectEdit = {
      projectName: 'book-tracker',
      files: [
        { path: 'src/App.tsx', content: unsafeBookApp },
        { path: 'src/styles.css', content: bookCss },
      ],
    };
    const coder = stubMember('local:coder', () => [appBlock(unsafeBookApp), cssBlock(bookCss)].join('\n'));
    const reviewer = stubMember('local:reviewer', () => '{"verdict":"ship","mustFix":[],"notes":[]}');
    const events: CouncilCodegenEvent[] = [];
    let result: CouncilCodegenResult | null = null;
    const brief = 'Replace every broken # cover image with self-contained CSS cover art. Clamp every currentPage update between 0 and totalPages so progress cannot exceed 100%. Preserve localStorage persistence.';

    for await (const event of councilGenerateApp({ brief, members: [coder, reviewer], edit: projectEdit })) {
      events.push(event);
      if (event.type === 'result') result = event.result;
    }

    expect(result, JSON.stringify(events)).not.toBeNull();
    expect(result!.output).toContain('className="book-cover"');
    expect(result!.output).toContain('Math.max(0, Math.min(book.totalPages');
    expect(result!.output).toContain('useState<Book[]>(() =>');
    expect(result!.output).not.toContain("coverImage: '#'");
    expect(result!.output).not.toContain('newBooks[index]');
    expect(events.some((event) => event.type === 'stage'
      && event.label.includes('deterministic runtime-safety'))).toBe(true);
  }, 20_000);

  it('repairs explicitly named reference files omitted by the coder and ignores unnamed files', async () => {
    const appkit = [
      "import { http } from 'wagmi'",
      "export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID as string",
      'export const transports = {',
      '  mainnet: http(`https://mainnet.infura.io/v3/${process.env.INFURAMAIN}`),',
      '}',
    ].join('\n');
    const provider = [
      "import { createAppKit } from '@reown/appkit/react'",
      "import { projectId as appkitProjectId } from './appkit'",
      "if (process.env.NODE_ENV === 'development') console.info('AppKit dev diagnostics')",
      'declare global { interface Window { __APPKIT_INITIALIZED__?: boolean } }',
      "if (typeof window !== 'undefined' && !window.__APPKIT_INITIALIZED__) {",
      '  createAppKit({',
      '    projectId: appkitProjectId,',
      '    features: { analytics: true },',
      '  })',
      '  window.__APPKIT_INITIALIZED__ = true',
      '}',
    ].join('\r\n');
    const omitted = 'export const untouched = true;';
    const projectEdit = {
      projectName: 'mpm-frontend',
      external: true,
      files: [
        { path: 'lib/appkit.ts', content: appkit },
        { path: 'lib/AppKitProvider.tsx', content: provider },
        { path: 'lib/unrelated.ts', content: omitted },
      ],
    };
    const coder = stubMember('local:big', () => `\`\`\`ts title="lib/appkit.ts"\n${appkit}\n\`\`\``);
    const reviewer = stubMember('local:reviewer', () => JSON.stringify({
      verdict: 'ship',
      mustFix: [],
      notes: [],
    }));
    const events: CouncilCodegenEvent[] = [];
    let result: CouncilCodegenResult | null = null;
    const brief = 'Repair /undefined RPC in lib/appkit.ts and the optional AppKit analytics uncaught page error in lib/AppKitProvider.tsx.';

    for await (const event of councilGenerateApp({ brief, members: [coder, reviewer], edit: projectEdit })) {
      events.push(event);
      if (event.type === 'result') result = event.result;
    }

    expect(result, JSON.stringify(events)).not.toBeNull();
    expect(result!.output).toContain('title="lib/appkit.ts"');
    expect(result!.output).toContain('title="lib/AppKitProvider.tsx"');
    expect(result!.output).not.toContain('title="lib/unrelated.ts"');
    expect(result!.output).toContain('mainnet: http()');
    expect(result!.output).toContain("process.env.NEXT_PUBLIC_PROJECT_ID?.trim() ?? ''");
    expect(result!.output).toContain('analytics: false');
    expect(result!.output).toContain('Boolean(appkitProjectId)');
    expect(result!.output).toContain("console.error('AppKit initialization failed without blocking the app shell.'");
    expect(result!.output).toContain("  try {\r\n    createAppKit({\r\n      projectId: appkitProjectId,");
    expect(result!.output).not.toContain("projectId: appkitProjectId ?? ''");
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
