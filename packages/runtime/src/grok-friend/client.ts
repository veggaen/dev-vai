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
      'You have full access to tools, web search, planning, and sub-agents as needed to collaborate effectively and give the highest-quality help.',
      'Answer the explicit question. Use tools where they improve the answer.',
      'Distinguish verified facts from inference. Be concise but complete.',
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

  /**
   * Special mode for SCIS council integration: act as 0.1% world-class niche engineer
   * reviewer. The prompt includes the full council input + strict instruction to return
   * ONLY the JSON note (verdict, realIntent, methodLesson with proof+edge, etc.).
   * This makes the Grok CLI a real participating high-intel council member "inside"
   * Vai's toolset and roster (not just external or synthetic).
   */
  async reviewForCouncil(input: any): Promise<any> {
    const reviewPrompt = [
      'You are a 0.1%-level world-class engineer on Vai\'s SCIS consensus council.',
      'Vai prepared a draft. You review only (fact-quarantine). You may use tools, web search, code inspection, or any capabilities to form the best possible review.',
      'Return STRICT JSON ONLY matching the council note schema:',
      'verdict: "good" | "needs-work" | "bad"',
      'confidence: number 0-1',
      'realIntent: short string',
      'hiddenMeaning: short string or ""',
      'missingCapability: short string or ""',
      'suggestedAction: "answer-directly" | "web-search" | "reread-intent" | "ask-one-question"',
      'searchQuery: string or ""',
      'methodLesson: short string including proof method + 1 named edge case',
      'concerns: array of short strings',
      '',
      'Ground in the provided context. For self-improvement turns use the vaiProjectSelfContext keyAreas. Use Thorsen rotate if stuck. Output only the JSON at the end.',
      '',
      JSON.stringify(input),
    ].join('\n');

    const result = await this.ask(reviewPrompt);
    // Attempt to extract JSON from the response (the model is instructed to be strict).
    const jsonMatch = result.response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {}
    }
    // Fallback note if parse fails (still useful).
    return {
      verdict: 'needs-work',
      confidence: 0.5,
      realIntent: 'Grok advisor review (parse fallback)',
      methodLesson: result.response.slice(0, 300),
      concerns: ['JSON parse failed on Grok response; raw output used as lesson'],
    };
  }
}
