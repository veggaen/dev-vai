import { describe, expect, it } from 'vitest';
import { presentUserMessage } from './user-message-presentation.js';

describe('presentUserMessage', () => {
  it('keeps ordinary chat messages fully visible', () => {
    expect(presentUserMessage('Make the button blue.', false)).toEqual({
      collapsible: false,
      text: 'Make the button blue.',
      wordCount: 4,
    });
  });

  it('collapses a long task contract without losing the full expanded text', () => {
    const content = Array.from({ length: 140 }, (_, index) => `requirement-${index}`).join(' ');
    const collapsed = presentUserMessage(content, false);
    expect(collapsed.collapsible).toBe(true);
    expect(collapsed.text.length).toBeLessThan(400);
    expect(collapsed.text.endsWith('…')).toBe(true);
    expect(collapsed.wordCount).toBe(140);
    expect(presentUserMessage(content, true).text).toBe(content);
  });
});
