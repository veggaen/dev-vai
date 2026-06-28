import { describe, it, expect } from 'vitest';
import { escapeHtml, renderInfoBlockHtml } from './info-block.js';

describe('info-block — deterministic, safe HTML', () => {
  it('escapes every attacker-influenced text value', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml('a"b\'c&d')).toBe('a&quot;b&#39;c&amp;d');
  });

  it('renders a key-value block with escaped values and no scripts', () => {
    const html = renderInfoBlockHtml({
      kind: 'key-value',
      title: 'Council verdict',
      rows: [{ label: 'consensus', value: 'good', tone: 'good' }, { label: 'note', value: '<img onerror=x>' }],
    });
    expect(html).toContain('Council verdict');
    expect(html).toContain('&lt;img onerror=x&gt;'); // escaped, not live
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img onerror');
  });

  it('renders a steps block with state glyphs', () => {
    const html = renderInfoBlockHtml({
      kind: 'steps',
      steps: [{ label: 'draft', state: 'done' }, { label: 'review', state: 'running' }],
    });
    expect(html).toContain('✓');
    expect(html).toContain('draft');
    expect(html).toContain('review');
  });
});
