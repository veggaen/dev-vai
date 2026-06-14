/**
 * Tests for the Stage C vision boundary. NullVisionAdapter is always tested (the honest-decline
 * default). The Grok live read is gated behind VAI_TEST_GROK_LIVE=1 + grok installed, and uses a
 * generated 32x32 red PNG (above grok's 512-pixel minimum) so it needs no fixture file.
 */
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { NullVisionAdapter } from '../src/vision/adapter.js';
import { createGrokVisionAdapter } from '../src/vision/grok-vision.js';
import { isGrokCliAvailable } from '../src/models/grok-cli-adapter.js';

describe('NullVisionAdapter', () => {
  it('cannot see and returns null (forces an honest decline)', async () => {
    expect(NullVisionAdapter.canSee).toBe(false);
    const out = await NullVisionAdapter.describe({ dataBase64: 'x', mime: 'image/png' });
    expect(out).toBeNull();
  });
});

describe('createGrokVisionAdapter — gating', () => {
  it('returns null when grok is unavailable, else a seeing adapter', () => {
    const a = createGrokVisionAdapter();
    if (isGrokCliAvailable()) {
      expect(a).not.toBeNull();
      expect(a!.canSee).toBe(true);
    } else {
      expect(a).toBeNull();
    }
  });
});

/** Build a solid-color PNG of size n x n (n>=23 keeps it over grok's 512px minimum). */
function makeSolidPng(n: number, r: number, g: number, b: number): string {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
    return (~c) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, crcBuf]);
  };
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((n * 3 + 1) * n);
  for (let y = 0; y < n; y++) {
    raw[y * (n * 3 + 1)] = 0;
    for (let x = 0; x < n; x++) { const o = y * (n * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  }
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return png.toString('base64');
}

const LIVE = process.env.VAI_TEST_GROK_LIVE === '1' && isGrokCliAvailable();
describe.runIf(LIVE)('createGrokVisionAdapter — live read', () => {
  it('reads the dominant color of a generated red PNG', async () => {
    const adapter = createGrokVisionAdapter({ timeoutMs: 30_000 })!;
    const b64 = makeSolidPng(32, 230, 15, 15);
    const out = await adapter.describe({ dataBase64: b64, mime: 'image/png', question: 'What is the dominant color? Answer one word.' });
    expect(out).not.toBeNull();
    expect(out!.text.toLowerCase()).toMatch(/red/);
    expect(out!.source).toBe('vision:grok-cli');
  }, 35_000);
});
