export interface RuntimePrewarmPlan {
  kind: 'light' | 'heavy';
  prompt: string;
}

export function resolveRuntimePrewarmPlan(
  env: NodeJS.ProcessEnv = process.env,
): RuntimePrewarmPlan | null {
  if (env.VAI_DISABLE_PREWARM === '1') return null;

  if (env.VAI_HEAVY_PREWARM === '1') {
    return {
      kind: 'heavy',
      prompt: 'build a simple counter in pure HTML and CSS',
    };
  }

  return {
    kind: 'light',
    prompt: 'hello',
  };
}
