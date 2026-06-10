import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown } from './MarkdownRenderer.js';

describe('renderInlineMarkdown', () => {
  it('escapes raw HTML before rendering inline markdown', () => {
    const html = renderInlineMarkdown('<img src=x onerror="alert(1)">');

    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });

  it('blocks executable link protocols', () => {
    expect(renderInlineMarkdown('[click](javascript:alert(1))')).toContain('href="#"');
  });

  it('keeps safe links escaped for HTML attributes', () => {
    expect(renderInlineMarkdown('[site](https://example.com?q=1&x=2)')).toContain(
      'href="https://example.com?q=1&amp;x=2"',
    );
  });
});
