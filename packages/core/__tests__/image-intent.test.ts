/**
 * Tests for image-generation intent detection. Pure, no model/network.
 * Rule: explicit toggle always wins; auto-detect only in chat/agent; "read the image" never triggers gen.
 */
import { describe, it, expect } from 'vitest';
import { detectImageIntent } from '../src/chat/image-intent.js';

describe('detectImageIntent — explicit toggle', () => {
  it('the explicit Image mode wins regardless of message content', () => {
    const r = detectImageIntent('a red sports car', { explicitImageMode: true });
    expect(r.wantsImage).toBe(true);
    expect(r.source).toBe('explicit');
    expect(r.confidence).toBe(1);
    expect(r.subject).toBe('a red sports car');
  });
  it('explicit wins even over a "read the image" phrase', () => {
    expect(detectImageIntent('look at this image', { explicitImageMode: true }).wantsImage).toBe(true);
  });
});

describe('detectImageIntent — auto-detect', () => {
  it('detects "draw me a cat"', () => {
    const r = detectImageIntent('draw me a cat wearing sunglasses');
    expect(r.wantsImage).toBe(true);
    expect(r.source).toBe('detected');
    expect(r.subject.toLowerCase()).toContain('cat');
  });
  it('detects "generate an image of a sunset"', () => {
    const r = detectImageIntent('generate an image of a sunset over mountains');
    expect(r.wantsImage).toBe(true);
    expect(r.subject.toLowerCase()).toContain('sunset');
  });
  it('detects "make a picture of my dog"', () => {
    expect(detectImageIntent('make a picture of my dog').wantsImage).toBe(true);
  });
  it('detects "create a logo for a coffee shop"', () => {
    const r = detectImageIntent('create a logo for a coffee shop');
    expect(r.wantsImage).toBe(true);
    expect(r.subject.toLowerCase()).toContain('coffee');
  });
  it('detects noun-led "a picture of a robot"', () => {
    expect(detectImageIntent('a picture of a robot in space').wantsImage).toBe(true);
  });
});

describe('detectImageIntent — negatives (must NOT trigger generation)', () => {
  it('does not trigger on "look at this image"', () => {
    expect(detectImageIntent('look at this image and tell me the price').wantsImage).toBe(false);
  });
  it('does not trigger on "describe the picture"', () => {
    expect(detectImageIntent('describe the picture I sent').wantsImage).toBe(false);
  });
  it('does not trigger on a plain question', () => {
    expect(detectImageIntent('what is the capital of France').wantsImage).toBe(false);
  });
  it('does not auto-detect in builder mode', () => {
    expect(detectImageIntent('draw me a cat', { mode: 'builder' }).wantsImage).toBe(false);
  });
  it('still respects the explicit toggle in builder mode', () => {
    expect(detectImageIntent('a cat', { mode: 'builder', explicitImageMode: true }).wantsImage).toBe(true);
  });
});
