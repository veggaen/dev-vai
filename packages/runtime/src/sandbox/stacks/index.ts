/**
 * Stack registry — all available production stacks and their tier templates.
 */

import type { StackDefinition, StackTemplate, StackId, TierId } from './types.js';
export type { StackDefinition, StackTemplate, StackId, TierId } from './types.js';
export { TIER_META, DEPLOY_STEPS } from './types.js';

import { pernStack } from './pern.js';
import { mernStack } from './mern.js';
import { nextjsStack } from './nextjs-full.js';
import { t3Stack } from './t3.js';

/** All registered stacks */
export const ALL_STACKS: StackDefinition[] = [pernStack, mernStack, nextjsStack, t3Stack];

/** Lookup a stack by ID */
export function getStack(stackId: string): StackDefinition | undefined {
  return ALL_STACKS.find((s) => s.id === stackId);
}

/** Lookup a specific template by stack + tier */
export function getStackTemplate(stackId: string, tier: string): StackTemplate | undefined {
  const stack = getStack(stackId);
  if (!stack) return undefined;
  return stack.templates.find((t) => t.tier === tier);
}

/** Get all available (non-comingSoon) templates */
export function getAvailableTemplates(): StackTemplate[] {
  return ALL_STACKS.flatMap((s) => s.templates.filter((t) => !t.comingSoon));
}
