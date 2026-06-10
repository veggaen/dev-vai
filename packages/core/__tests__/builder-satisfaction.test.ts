import { describe, expect, it } from 'vitest';
import {
  evaluateBuilderRequestSatisfaction,
  extractRequestAnchors,
  hasBuilderFileBlocks,
  repairBuilderFallbackFileBlocks,
} from '../src/chat/builder-satisfaction.js';

const SCAFFOLD = [
  '```json title="package.json"',
  '{"name":"my-app","private":true,"type":"module","scripts":{"dev":"vite","build":"vite build"}}',
  '```',
  '```tsx title="src/App.tsx"',
  'export default function App() { return <div>Hello</div>; }',
  '```',
].join('\n');

const REAL_SHOPPING_APP = [
  '```tsx title="src/App.tsx"',
  'export default function App() {',
  '  // shared shopping list for the household; members can add grouped items',
  '  const [items, setItems] = useState([]); // grouped grocery items',
  '  return <ShoppingList household={members} activity={activityFeed} />;',
  '}',
  '```',
].join('\n');

describe('builder-satisfaction', () => {
  const prompt = 'Build a compact shared shopping list app for roommates with household members, grouped items, and an activity feed.';

  it('extracts distinctive feature anchors and drops build-verb glue', () => {
    const anchors = extractRequestAnchors(prompt);
    expect(anchors).toContain('shopping');
    expect(anchors).toContain('household');
    expect(anchors).toContain('activity');
    // build-verb / glue words are not anchors
    expect(anchors).not.toContain('build');
    expect(anchors).not.toContain('app');
    expect(anchors).not.toContain('compact');
  });

  it('flags a generic scaffold (files but near-zero feature coverage) as NOT satisfying', () => {
    const report = evaluateBuilderRequestSatisfaction(prompt, SCAFFOLD);
    expect(report.hasFileBlocks).toBe(true);
    expect(report.satisfied).toBe(false);
    expect(report.coverage).toBeLessThan(0.4);
    expect(report.reasons.some((r) => r.startsWith('low-anchor-coverage'))).toBe(true);
  });

  it('accepts an artifact that engages the requested features as satisfying', () => {
    const report = evaluateBuilderRequestSatisfaction(prompt, REAL_SHOPPING_APP);
    expect(report.satisfied).toBe(true);
    expect(report.coverage).toBeGreaterThanOrEqual(0.4);
  });

  it('does not treat prose with no file blocks as satisfying', () => {
    const report = evaluateBuilderRequestSatisfaction(prompt, 'Sure, here is how I would approach a shopping list with household members and an activity feed...');
    expect(report.hasFileBlocks).toBe(false);
    expect(report.satisfied).toBe(false);
  });

  it('respects a configurable coverage threshold', () => {
    const strict = evaluateBuilderRequestSatisfaction(prompt, REAL_SHOPPING_APP, { minAnchorCoverage: 0.95 });
    expect(strict.satisfied).toBe(false);
  });

  it('is not gamed by a scaffold whose package.json name echoes the request (live regression)', () => {
    const counterPrompt = 'Build a tiny single-file HTML counter app with a + button, a - button, and a live count display.';
    const scaffoldWithEchoingName = [
      '```json title="package.json"',
      '{"name":"tiny-single-file-html-counter","private":true,"type":"module","scripts":{"dev":"vite"}}',
      '```',
      '```tsx title="src/App.tsx"',
      'export default function App() { return <div>App</div>; }',
      '```',
    ].join('\n');
    const report = evaluateBuilderRequestSatisfaction(counterPrompt, scaffoldWithEchoingName);
    expect(report.satisfied).toBe(false); // package.json name no longer counts toward coverage
  });

  it('is not gamed by prose that describes features missing from the emitted files', () => {
    const output = [
      SCAFFOLD,
      'This shared shopping list supports roommates, household members, grouped items, and an activity feed.',
    ].join('\n');
    expect(evaluateBuilderRequestSatisfaction(prompt, output).satisfied).toBe(false);
  });

  it('detects builder file blocks structurally', () => {
    expect(hasBuilderFileBlocks(SCAFFOLD)).toBe(true);
    expect(hasBuilderFileBlocks('just prose, no files')).toBe(false);
  });

  it('repairs one complete untitled HTML document into an auto-applicable index file', () => {
    const output = [
      '```html',
      '<!doctype html>',
      '<html><body><button>+</button><output>live count</output></body></html>',
      '```',
    ].join('\n');
    const repaired = repairBuilderFallbackFileBlocks(output);
    expect(repaired.changed).toBe(true);
    expect(repaired.reason).toBe('single-html-index');
    expect(repaired.text).toContain('```html title="index.html"');
    expect(hasBuilderFileBlocks(repaired.text)).toBe(true);
  });

  it('does not guess file paths for multi-file untitled output', () => {
    const output = [
      '```html',
      '<!doctype html><html><body>App</body></html>',
      '```',
      '```js',
      'console.log("app");',
      '```',
    ].join('\n');
    expect(repairBuilderFallbackFileBlocks(output)).toEqual({ text: output, changed: false });
  });
});
