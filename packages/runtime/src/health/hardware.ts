import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { hardwareModelReportSchema, hardwareProfileSchema, modelFitSchema, type HardwareProfile, type ModelFit } from '@vai/contracts/adoption';
import { TIMEOUTS_MS } from '@vai/constants';

const execFileAsync = promisify(execFile);
interface CommandResult { stdout: string; stderr: string; }
export interface HardwareRunner { (command: string, args: readonly string[]): Promise<CommandResult>; }

interface LocalModelInfo { id: string; size?: number; quantization?: string; family?: string; backend: string; }

function architectureScore(id: string, family = ''): number {
  const text = `${id} ${family}`.toLowerCase();
  if (/qwen3|llama3\.3|gemma3|phi4/.test(text)) return 100;
  if (/qwen2\.5|llama3\.2|mistral-small/.test(text)) return 82;
  if (/llama3|gemma2|deepseek-r1/.test(text)) return 68;
  if (/llama2|mistral:7b/.test(text)) return 38;
  return 55;
}

export function rankModelFit(hardware: HardwareProfile, models: readonly LocalModelInfo[]): ModelFit[] {
  const availableVram = Math.max(0, ...hardware.gpus.map((gpu) => gpu.vramBytes ?? 0));
  return models.map((model) => {
    const estimated = model.size;
    const ratio = estimated && availableVram ? estimated / availableVram : undefined;
    const fitPoints = ratio === undefined ? 18 : ratio <= 0.65 ? 55 : ratio <= 0.85 ? 43 : ratio <= 1 ? 28 : Math.max(0, 18 - (ratio - 1) * 30);
    const backendPoints = model.backend === 'ollama' ? 20 : 10;
    const agePoints = architectureScore(model.id, model.family) * 0.25;
    const score = Math.round(Math.min(100, fitPoints + backendPoints + agePoints));
    const fits = ratio === undefined ? true : ratio <= 1;
    const fitLabel: ModelFit['fitLabel'] = ratio === undefined ? 'unknown' : ratio <= 0.65 ? 'excellent' : ratio <= 0.85 ? 'good' : ratio <= 1 ? 'tight' : 'does-not-fit';
    return modelFitSchema.parse({
      modelId: model.id, score, fits, fitLabel, estimatedBytes: estimated, quantization: model.quantization,
      backend: model.backend,
      reasons: [
        ratio === undefined ? 'VRAM fit is unknown because model or GPU memory size is unavailable.' : `Estimated model/VRAM ratio: ${(ratio * 100).toFixed(0)}%.`,
        `Backend readiness: ${model.backend}.`, `Architecture freshness contribution: ${Math.round(agePoints)}/25.`,
      ],
      ...(!fits ? { nextAction: 'Choose a smaller quantization or a model with fewer parameters.' } : {}),
    });
  }).sort((left, right) => right.score - left.score || left.modelId.localeCompare(right.modelId));
}

export class HardwareModelService {
  constructor(private readonly run: HardwareRunner = async (command, args) => {
    const result = await execFileAsync(command, [...args], { windowsHide: true, timeout: TIMEOUTS_MS.apiRequest, maxBuffer: 2_000_000 });
    return { stdout: result.stdout, stderr: result.stderr };
  }) {}

  async scan(): Promise<HardwareProfile> {
    const gpus: HardwareProfile['gpus'] = [];
    const failures: HardwareProfile['failures'] = [];
    const command = 'nvidia-smi';
    const args = ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'];
    try {
      const result = await this.run(command, args);
      for (const line of result.stdout.trim().split(/\r?\n/).filter(Boolean)) {
        const [name, memoryMiB] = line.split(',').map((value) => value.trim());
        gpus.push({ name, vramBytes: Number(memoryMiB) * 1024 * 1024, backend: 'cuda' });
      }
    } catch (error) {
      failures.push({ check: 'nvidia-gpu', command: `${command} ${args.join(' ')}`, output: error instanceof Error ? error.message : String(error), nextAction: 'Install/repair the NVIDIA driver, or use the CPU/Metal/ROCm backend shown by your model provider.' });
    }
    if (gpus.length === 0 && process.platform === 'darwin') {
      gpus.push({ name: 'Apple unified memory GPU', vramBytes: os.totalmem(), backend: 'metal' });
    }
    return hardwareProfileSchema.parse({
      platform: `${process.platform}-${process.arch}`, cpu: os.cpus()[0]?.model ?? 'Unknown CPU',
      logicalCores: Math.max(1, os.cpus().length), ramBytes: os.totalmem(), gpus, failures, scannedAt: Date.now(),
    });
  }

  async report(): Promise<{ hardware: HardwareProfile; models: ModelFit[] }> {
    const hardware = await this.scan();
    const models: LocalModelInfo[] = [];
    try {
      const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(TIMEOUTS_MS.apiRequest) });
      if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
      const body = await response.json() as { models?: Array<{ name?: string; size?: number; details?: { quantization_level?: string; family?: string } }> };
      for (const model of body.models ?? []) if (model.name) models.push({ id: model.name, size: model.size, quantization: model.details?.quantization_level, family: model.details?.family, backend: 'ollama' });
    } catch (error) {
      hardware.failures.push({ check: 'ollama-models', command: 'ollama list', output: error instanceof Error ? error.message : String(error), nextAction: 'Start Ollama, then run `ollama list` and retry the scan.' });
    }
    return hardwareModelReportSchema.parse({ hardware, models: rankModelFit(hardware, models) });
  }
}
