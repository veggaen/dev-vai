import { describe, expect, it } from 'vitest';
import { analyzeRequest, extractSubject } from './domain-model.js';
import { composeDomainApp, shouldUseDomainComposer } from './compose-domain-app.js';

describe('extractSubject', () => {
  it('pulls the subject out of "... for a X" requests', () => {
    expect(extractSubject('build me a small landing page for a coffee shop')).toBe('coffee shop');
    expect(extractSubject('a website for a hair salon')).toBe('hair salon');
    expect(extractSubject('make a landing page for a neighbourhood bakery')).toContain('bakery');
  });

  it('handles "X website/site" phrasing', () => {
    expect(extractSubject('build a florist website')).toContain('florist');
  });
});

describe('analyzeRequest — classification', () => {
  it('models a coffee shop as a cafe with a menu, hours and location (not a dev template)', () => {
    const m = analyzeRequest('build me a landing page for a coffee shop')!;
    expect(m).not.toBeNull();
    expect(m.category).toBe('cafe');
    expect(m.subject).toContain('coffee');
    expect(m.sections).toEqual(expect.arrayContaining(['hero', 'menu', 'hours', 'location']));
    expect(m.content.menu && m.content.menu.length).toBeGreaterThan(2);
    expect(m.confidence).toBeGreaterThan(0.6);
    // The defining bug: no unrelated canned brand / dev-workflow copy.
    expect(m.brandName).not.toMatch(/signal forge/i);
    expect(JSON.stringify(m)).not.toMatch(/ship releases|handoff|release flow/i);
  });

  it('classifies bakery / restaurant / salon / florist / professional', () => {
    expect(analyzeRequest('a landing page for a bakery')!.category).toBe('bakery');
    expect(analyzeRequest('a site for an italian restaurant')!.category).toBe('restaurant');
    expect(analyzeRequest('landing page for a hair salon')!.category).toBe('salon');
    expect(analyzeRequest('a flower shop website')!.category).toBe('florist');
    expect(analyzeRequest('a landing page for a dental clinic')!.category).toBe('professional');
  });

  it('picks the right content shape per category (menu vs services)', () => {
    expect(analyzeRequest('a cafe landing page')!.content.menu).toBeDefined();
    expect(analyzeRequest('a hair salon landing page')!.content.services).toBeDefined();
  });

  it('falls back to a generic-but-subject-aware model for unknown domains', () => {
    const m = analyzeRequest('a landing page for a kite repair workshop')!;
    expect(m.category).toBe('generic');
    expect(m.confidence).toBeLessThan(0.6);
    // Still names the real subject rather than discarding it.
    expect(m.heroSub.toLowerCase()).toContain('kite');
  });

  it('honors an explicitly named brand', () => {
    const m = analyzeRequest('a coffee shop landing page called Bean Theory')!;
    expect(m.brandName).toBe('Bean Theory');
  });

  it('returns null for degenerate input', () => {
    expect(analyzeRequest('')).toBeNull();
    expect(analyzeRequest('a')).toBeNull();
  });
});

describe('composeDomainApp — output', () => {
  it('emits a runnable Vite scaffold with subject-relevant content', () => {
    const out = composeDomainApp(analyzeRequest('a landing page for a coffee shop')!);
    expect(out).toContain('```tsx title="src/App.tsx"');
    expect(out).toContain('```css title="src/styles.css"');
    expect(out).toContain('title="package.json"');
    expect(out).toContain('@import "tailwindcss"');
    // Real cafe content present; legacy dev-template copy absent.
    expect(out).toMatch(/Espresso|Flat White|Pour-Over/);
    expect(out).not.toMatch(/Signal Forge|Ship releases with/);
  });

  it('renders a services section (not a menu) for a salon', () => {
    const out = composeDomainApp(analyzeRequest('a landing page for a hair salon')!);
    expect(out).toContain('id="services"');
    expect(out).toMatch(/Cut &amp; Finish|Balayage|Colour/);
  });
});

describe('shouldUseDomainComposer — wiring guard', () => {
  it('owns genuine consumer-business landings', () => {
    expect(shouldUseDomainComposer('a landing page for a coffee shop')).toBe(true);
    expect(shouldUseDomainComposer('a website for a dental clinic')).toBe(true);
  });

  it('defers the dev-tool / fitness / explicit-slot cases to the legacy templates', () => {
    expect(shouldUseDomainComposer('Build a polished landing page for a developer tool')).toBe(false);
    expect(shouldUseDomainComposer('a neon fitness landing page')).toBe(false);
    expect(shouldUseDomainComposer('a landing page with the exact heading Kinetic Pulse')).toBe(false);
  });
});
