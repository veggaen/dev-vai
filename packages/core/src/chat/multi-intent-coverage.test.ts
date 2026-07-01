import { describe, it, expect } from 'vitest';
import { checkMultiIntentCoverage, describeMissingParts } from './multi-intent-coverage.js';

// A draft that ONLY explains JWT (the real live behavior we captured: intent #1
// answered, intent #2 — the app — dropped).
const JWT_ONLY = `**JWT (JSON Web Token):**
A JWT is a compact token. Structure: header.payload.signature.
Flow: login -> server creates JWT -> client stores it -> sends Authorization: Bearer.`;

// A draft that ships the app but never explains JWT.
const APP_ONLY = `Building a photographer portfolio app.
\`\`\`json title="package.json"
{ "name": "photo-app", "dependencies": { "next": "^14" } }
\`\`\`
\`\`\`tsx title="src/app/page.tsx"
export default function Gallery() { return <main>Nature photos</main>; }
\`\`\``;

// A draft that does BOTH.
const BOTH = JWT_ONLY + '\n\n' + APP_ONLY;

describe('checkMultiIntentCoverage — catches the dropped deliverable', () => {
  const prompt = 'Explain how JWT auth works and then build me a photographer portfolio app with nature images.';

  it('flags the missing BUILD part when the draft only explains JWT (the live bug)', () => {
    const r = checkMultiIntentCoverage(prompt, JWT_ONLY);
    expect(r.isMultiIntent).toBe(true);
    expect(r.hasMissingPart).toBe(true);
    const missing = r.missingParts.map((p) => p.part.action);
    expect(missing).toContain('build');
    expect(describeMissingParts(r)).toMatch(/build/i);
  });

  it('flags the missing ANSWER part when the draft only ships the app', () => {
    const r = checkMultiIntentCoverage(prompt, APP_ONLY);
    expect(r.hasMissingPart).toBe(true);
    expect(r.missingParts.some((p) => p.part.action === 'answer')).toBe(true);
  });

  it('passes when the draft covers BOTH parts', () => {
    const r = checkMultiIntentCoverage(prompt, BOTH);
    expect(r.isMultiIntent).toBe(true);
    expect(r.hasMissingPart).toBe(false);
    expect(describeMissingParts(r)).toBe('');
  });

  it('a build part answered with only PROSE is not counted as covered', () => {
    const prose = JWT_ONLY + '\n\nFor the photographer app, you would use Next.js and a gallery grid.';
    const r = checkMultiIntentCoverage(prompt, prose);
    expect(r.hasMissingPart).toBe(true);
    expect(r.missingParts.some((p) => p.part.action === 'build')).toBe(true);
  });
});

describe('checkMultiIntentCoverage — single-intent turns are a cheap no-op', () => {
  it('returns not-multi for a plain question (no coverage work)', () => {
    const r = checkMultiIntentCoverage('What are great tools for computer intelligence?', 'Some answer.');
    expect(r.isMultiIntent).toBe(false);
    expect(r.hasMissingPart).toBe(false);
    expect(r.parts).toHaveLength(0);
  });

  it('returns not-multi for a single build request', () => {
    const r = checkMultiIntentCoverage('Build me a todo app.', APP_ONLY);
    expect(r.isMultiIntent).toBe(false);
  });
});
