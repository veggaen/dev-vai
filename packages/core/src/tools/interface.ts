export interface ToolContext {
  workingDir: string;
  signal?: AbortSignal;
  timeout?: number;
}

export interface ToolResult {
  success: boolean;
  output: string;
  artifacts?: Array<{ path: string; content: string }>;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;

  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
