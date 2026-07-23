import type { CapabilityScope, ToolCapability } from '@vai/contracts/adoption';

export interface ToolContext {
  workingDir: string;
  signal?: AbortSignal;
  timeout?: number;
  workspaceScope: CapabilityScope;
  sessionScope: CapabilityScope;
  capabilities: ReadonlySet<ToolCapability>;
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
  readonly requiredCapabilities: readonly ToolCapability[];

  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
