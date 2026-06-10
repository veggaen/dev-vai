import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface GrokFriendResult {
  requestId: string;
  source: 'grok-cli-friend-channel';
  capturedAt: string;
  durationMs: number;
  response: string;
}

export interface GrokCommandRunnerOptions {
  cwd: string;
  timeoutMs: number;
}

export type GrokCommandRunner = (
  command: string,
  args: string[],
  options: GrokCommandRunnerOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface GrokFriendClientOptions {
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  runner?: GrokCommandRunner;
}

const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_PROMPT_LENGTH = 8_000;

function runGrokCommand(
  command: string,
  args: string[],
  options: GrokCommandRunnerOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        encoding: 'utf8',
        maxBuffer: 512 * 1024,
        timeout: options.timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

export class GrokFriendClient {
  private readonly command: string;
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly runner: GrokCommandRunner;

  constructor(options: GrokFriendClientOptions = {}) {
    this.command = options.command ?? 'grok';
    this.cwd = options.cwd ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.runner = options.runner ?? runGrokCommand;
  }

  async ask(prompt: string): Promise<GrokFriendResult> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error('Grok friend-channel prompt is empty');
    }
    if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Grok friend-channel prompt exceeds ${MAX_PROMPT_LENGTH} characters`);
    }

    const startedAt = Date.now();
    const scopedPrompt = [
      'You are the Grok friend-channel collaborator for Vai.',
      'Answer the explicit question only. Do not run commands or edit files.',
      'Distinguish verified facts from inference. Keep the answer concise.',
      '',
      trimmedPrompt,
    ].join('\n');
    const { stdout } = await this.runner(
      this.command,
      [
        '-p',
        scopedPrompt,
        '--output-format',
        'plain',
        '--max-turns',
        '1',
        '--no-plan',
        '--no-subagents',
        '--disable-web-search',
        '--tools',
        'none',
      ],
      {
        cwd: this.cwd,
        timeoutMs: this.timeoutMs,
      },
    );
    const response = stdout.trim();
    if (!response) {
      throw new Error('Grok friend-channel returned an empty response');
    }

    return {
      requestId: randomUUID(),
      source: 'grok-cli-friend-channel',
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      response,
    };
  }
}
