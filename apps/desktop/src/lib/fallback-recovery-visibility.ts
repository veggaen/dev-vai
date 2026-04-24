export interface FallbackRecoveryVisibilityInput {
  readonly isUser: boolean;
  readonly isProjectUpdate: boolean;
  readonly hasAppliedFileBlocks: boolean;
}

export function shouldShowFallbackRecoveryChrome(input: FallbackRecoveryVisibilityInput): boolean {
  return !input.isUser && !input.isProjectUpdate && !input.hasAppliedFileBlocks;
}