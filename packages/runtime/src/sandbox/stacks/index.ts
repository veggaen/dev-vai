/**
 * Stack registry — all available production stacks and their tier templates.
 * Supports both built-in stacks and user-defined custom stacks.
 */

import type { StackDefinition, StackTemplate, StackId, TierId, CustomStackConfig } from './types.js';
export type { StackDefinition, StackTemplate, StackId, TierId, CustomStackConfig } from './types.js';
export { TIER_META, DEPLOY_STEPS, customConfigToStack } from './types.js';

import { pernStack } from './pern.js';
import { mernStack } from './mern.js';
import { nextjsStack } from './nextjs-full.js';
import { t3Stack } from './t3.js';
import { customConfigToStack } from './types.js';

/** Built-in stacks */
const BUILTIN_STACKS: StackDefinition[] = [pernStack, mernStack, nextjsStack, t3Stack];

/** Custom stacks registered at runtime */
const customStacks = new Map<string, StackDefinition>();

/** All registered stacks (built-in + custom) */
export function getAllStacks(): StackDefinition[] {
  return [...BUILTIN_STACKS, ...customStacks.values()];
}

/** @deprecated Use getAllStacks() for dynamic list */
export const ALL_STACKS: StackDefinition[] = BUILTIN_STACKS;

/** Lookup a stack by ID (checks custom stacks too) */
export function getStack(stackId: string): StackDefinition | undefined {
  return BUILTIN_STACKS.find((s) => s.id === stackId) ?? customStacks.get(stackId);
}

/** Lookup a specific template by stack + tier */
export function getStackTemplate(stackId: string, tier: string): StackTemplate | undefined {
  const stack = getStack(stackId);
  if (!stack) return undefined;
  return stack.templates.find((t) => t.tier === tier);
}

/** Get all available (non-comingSoon) templates */
export function getAvailableTemplates(): StackTemplate[] {
  return getAllStacks().flatMap((s) => s.templates.filter((t) => !t.comingSoon));
}

/* ── Custom Stack Management ───────────────────────────────────── */

/** Register a custom stack from a CustomStackConfig */
export function registerCustomStack(config: CustomStackConfig): StackDefinition {
  const stack = customConfigToStack(config);
  customStacks.set(stack.id, stack);
  return stack;
}

/** Remove a custom stack */
export function unregisterCustomStack(stackId: string): boolean {
  return customStacks.delete(stackId);
}

/** Get all custom stacks */
export function getCustomStacks(): StackDefinition[] {
  return [...customStacks.values()];
}

/** Check if a stack ID is a custom stack */
export function isCustomStack(stackId: string): boolean {
  return stackId.startsWith('custom-');
}
