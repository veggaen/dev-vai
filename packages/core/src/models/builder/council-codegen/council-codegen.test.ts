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
        && 