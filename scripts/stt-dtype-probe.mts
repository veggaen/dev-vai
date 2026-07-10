/**
 * Probe dtype/device combos for built-in Whisper to find the fastest CORRECT config.
 * Usage: node --import tsx scripts/stt-dtype-probe.mts <device> <dtype> [model]
 *   e.g. node --import tsx scripts/stt-dtype-probe.mts dml fp16
 *        node --import tsx scripts/stt-dtype-probe.mts cpu q4
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const device = process.argv[2] ?? 'cpu';
const dtypeArg = process.argv[3] ?? 'q4';
const model = process.argv[4] ?? 'onnx-community/whisper-large-v3-turbo';
const text = 'Add a dark mode toggle to the settings panel and run the tests.';

// ── synth speech ──
const dir = mkdtempSync(join(tmpdir(), 'vai-stt-probe-'));
const wavPath = join(dir, 's.wav');
execFileSync('powershell', ['-NoProfile', '-Command', `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile('${wavPath.replace(/\\/g, '\\\\')}', $fmt)
$s.Speak(${JSON.stringify(text)})
$s.Dispose()`]);
const wav = readFileSync(wavPath);
const pcm16 = wav.subarray(wav.indexOf(Buffer.from('data')) + 8);
const pcm = new Float32Array(pcm16.length / 2);
for (let i = 0; i < pcm.length; i++) pcm[i] = pcm16.readInt16LE(i * 2) / 32768;
rmSync(dir, { recursive: true, force: true });

// ── load pipeline ──
const { env, pipeline } = await import('@huggingface/transformers');
env.allowLocalModels = true;
env.useBrowserCache = false;
env.cacheDir = join(process.env.LOCALAPPDATA ?? join(homedir(), '.cache'), 'vai-whisper-cache');

const dtype = dtypeArg.includes(':')
  ? Object.fromEntries(dtypeArg.split(',').map((p) => p.split(':') as [string, string]))
  : dtypeArg;

console.log(`[probe] model=${model} device=${device} dtype=${JSON.stringify(dtype)}`);
const t0 = Date.now();
const pipe = await pipeline('automatic-speech-recognition', model, { dtype: dtype as never, device: device as never });
console.log(`[probe] load: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const englishOnly = /[.-]en$/i.test(model);
for (let run = 1; run <= 2; run++) {
  const t1 = Date.now();
  const out = await pipe(pcm, { ...(englishOnly ? {} : { language: 'en', task: 'transcribe' }), chunk_length_s: 30, return_timestamps: false });
  const secs = ((Date.now() - t1) / 1000).toFixed(1);
  const got = (Array.isArray(out) ? out[0]?.text : out.text)?.trim() ?? '';
  console.log(`[probe] run${run}: ${secs}s → ${got}`);
}
process.exit(0);
