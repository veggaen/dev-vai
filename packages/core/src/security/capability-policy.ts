import type { CapabilityScope, ToolCapability } from '@vai/contracts/adoption';

const SCOPE_CAPABILITIES: Record<CapabilityScope, ReadonlySet<ToolCapability>> = {
  'read-only': new Set<ToolCapability>(['read']),
  'no-shell': new Set<ToolCapability>(['read', 'write', 'network', 'git']),
  'no-network': new Set<ToolCapability>(['read', 'write', 'shell', 'git', 'process']),
  full: new Set<ToolCapability>(['read', 'write', 'shell', 'network', 'git', 'process']),
};

export interface CapabilityDecision {
  readonly allowed: boolean;
  readonly workspaceScope: CapabilityScope;
  readonly sessionScope: CapabilityScope;
  readonly effective: ReadonlySet<ToolCapability>;
  readonly denied: readonly ToolCapability[];
}

/** Host-owned scope intersection. Repository text/config never participates. */
export function decideToolCapabilities(input: {
  readonly required: readonly ToolCapability[];
  readonly workspaceScope: CapabilityScope;
  readonly sessionScope?: CapabilityScope;
}): CapabilityDecision {
  const sessionScope = input.sessionScope ?? input.workspaceScope;
  const workspace = SCOPE_CAPABILITIES[input.workspaceScope];
  const session = SCOPE_CAPABILITIES[sessionScope];
  const effective = new Set([...workspace].filter((capability) => session.has(capability)));
  const denied = [...new Set(input.required)].filter((capability) => !effective.has(capability));
  return {
    allowed: denied.length === 0,
    workspaceScope: input.workspaceScope,
    sessionScope,
    effective,
    denied,
  };
}

export function capabilityDenialMessage(toolName: string, decision: CapabilityDecision): string {
  return `Capability denied for ${toolName}: ${decision.denied.join(', ')} not available under workspace=${decision.workspaceScope}, session=${decision.sessionScope}.`;
}
