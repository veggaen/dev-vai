/**
 * Live E2E proof for the rebuilt STT pipeline.
 * 1. Synthesizes a spoken sentence with Windows SAPI TTS → 16 kHz mono wav.
 * 2. Converts to float32 PCM (the exact payload the desktop client sends).
 * 3. POSTs /api/stt/transcribe on the dev runtime and scores the transcript (WER).
 *
 * Usage: node scripts/stt-live-proof.mjs [--port 3016] [--text "..."]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const port = args.includes('--port') ? args[args.indexOf('--port') + 1] : '3016';
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : undefined;
const quality = args.includes('--quality') ? args[args.indexOf('--quality') + 1] : 'best';
const text = args.includes('--text')
  ? args[args.indexOf('--text') + 1]
  : 'Hey Vai, refactor the sandbox manager to cache pnpm installs, then run the visual tests and show me a screenshot of the preview.';

const dir = mkdtempSync(join(tmpdir(), 'vai-stt-proof-'));
const wavPath = join(dir, 'speech.wav');

// ── 1. Synthesize speech (SAPI, 16 kHz 16-bit mono) ──
const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile('${wavPath.replace(/\\/g, '\\\\')}', $fmt)
$s.Rate = 1
$s.Speak(${JSON.stringify(text)})
$s.Dispose()
`;
execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });

// ── 2. wav → float32 PCM base64 ──
const wav = readFileSync(wavPath);
const dataIdx = wav.indexOf(Buffer.from('data'));
const pcm16 = wav.subarray(dataIdx + 8);
const f32 = new Float32Array(pcm16.length / 2);
for (let i = 0; i < f32.length; i++) f32[i] = pcm16.readInt16LE(i * 2) / 32768;
const b64 = Buffer.from(f32.buffer).toString('base64');
console.log(`[proof] synthesized ${(f32.length / 16000).toFixed(1)}s of speech (${(b64.length / 1024).toFixed(0)} KB payload)`);

// ── 3. Transcribe ──
const t0 = Date.now();
const res = await fetch(`http://127.0.0.1:${port}/api/stt/transcribe`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: b64, mimeType: 'audio/pcm-f32le;rate=16000', language: 'en-US', quality, ...(model ? { model } : {}) }),
});
const body = await res.json();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

if (!res.ok) {
  console.error(`[proof] FAIL — HTTP ${res.status}:`, JSON.stringify(body));
  process.exit(1);
}

// ── 4. Score (word error rate via Levenshtein on words) ──
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const ref = norm(text);
const hyp = norm(body.text ?? '');
const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)]);
for (let j = 0; j <= hyp.length; j++) d[0][j] = j;
for (let i = 1; i <= ref.length; i++)
  for (let j = 1; j <= hyp.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
const wer = ref.length ? d[ref.length][hyp.length] / ref.length : 1;

console.log(`[proof] engine:     ${body.engine}`);
console.log(`[proof] latency:    ${elapsed}s`);
console.log(`[proof] reference:  ${text}`);
console.log(`[proof] transcript: ${body.text}`);
console.log(`[proof] WER:        ${(wer * 100).toFixed(1)}%`);
rmSync(dir, { recursive: true, force: true });
console.log(wer <= 0.15 ? '[proof] PASS ✅ (WER ≤ 15%)' : '[proof] FAIL ❌ (WER > 15%)');
process.exit(wer <= 0.15 ? 0 : 1);
