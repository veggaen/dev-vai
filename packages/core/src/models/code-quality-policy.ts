/**
 * Deliberate default quality bar for VaiEngine code/build routes.
 *
 * Classifies build requests into minimal | standard | advanced before routing,
 * and detects over-engineering on trivial domains.
 */

export type ComplexityTier = 'minimal' | 'standard' | 'advanced';

export interface CodePolicy {
  readonly tier: ComplexityTier;
  readonly reason: string;
  readonly contract: QualityContract;
  readonly scopeNote?: string;
  readonly tierIsExplicit: boolean;
}

export interface QualityContract {
  readonly summary: string;
  readonly mustHave: readonly string[];
  readonly avoid: readonly string[];
}

const RX_MINIMAL = /\b(?:simpl(?:e|est|er)|minimal|barebones?|bare[\s-]?bones?|tiny|quick|throwaway|toy|just\s+(?:a\s+)?(?:snippet|example|demo)|beginner|learning|for\s+(?:a\s+)?class|no\s+(?:frills|deps|dependencies)|plain|vanilla|skeleton|stub|hello\s*world|one[\s-]?liner)\b/i;

const RX_ADVANCED = /\b(?:production[\s-]?(?:ready|grade)?|enterprise|scalable|scale|high[\s-]?(?:availability|throughput)|robust|battle[\s-]?tested|fault[\s-]?tolerant|observab(?:le|ility)|hardened|secure(?:d)?|mission[\s-]?critical|real[\s-]?world|ship(?:pable|ping)?\s+(?:this|it|to\s+prod)|for\s+prod(?:uction)?)\b/i;

const RX_HEAVY_INFRA = /\b(?:micro[\s-]?services?|kubernetes|k8s|kafka|event[\s-]?sourc(?:ed|ing)|cqrs|service[\s-]?mesh|saga\s+pattern|distributed\s+(?:cache|lock|transaction)|sharding|multi[\s-]?region|terraform|helm\s+chart|grpc\s+mesh|hexagonal\s+architecture|clean\s+architecture|onion\s+architecture|ddd|domain[\s-]?driven)\b/i;

const RX_TRIVIAL_DOMAIN = /\b(?:to[\s-]?do(?:\s*list)?|task\s*list|counter|calculator|hello\s*world|guess(?:ing)?\s+(?:the\s+)?number|tic[\s-]?tac[\s-]?toe|stopwatch|timer|notes?\s+app|weather\s+widget|tip\s+calculator|temperature\s+convert(?:er|or)|coin\s+flip|dice\s+roll(?:er)?)\b/i;

const RX_IS_BUILDISH = /\b(?:build|create|make|write|generate|scaffold|implement|code|app|application|api|server|component|function|script|cli|service|website|page|dashboard|clone)\b/i;

const CONTRACTS: Record<ComplexityTier, QualityContract> = {
  minimal: {
    summary:
      'Smallest correct version that teaches/demonstrates the idea. Readable over robust.',
    mustHave: [
      'Runs as-is with no setup beyond the language runtime',
      'No external dependencies unless strictly required',
      'A single file / single function where reasonable',
      'Clear names; one short comment only if the trick is non-obvious',
    ],
    avoid: [
      'Frameworks, build tooling, config files',
      'Abstraction layers, interfaces, or patterns the problem does not need',
      'Error handling beyond the happy path (unless the point is errors)',
    ],
  },
  standard: {
    summary:
      'Good, production-lean software a competent engineer would actually ship for a small real project: correct, readable, honest about edge cases — without speculative architecture.',
    mustHave: [
      'Correct happy path AND the obvious failure modes handled (bad input, empty, not-found)',
      'Idiomatic for the language/framework (use the standard library / conventional patterns)',
      'Sensible structure: separated concerns where it earns its keep, not before',
      'Types where the language has them; meaningful names; no dead code',
      'A one-line run/usage hint so the user can actually run it',
    ],
    avoid: [
      'Speculative generality (config for cases nobody asked for)',
      'Heavy infra (queues, caches, microservices) for a single-process problem',
      'Premature optimization; clever code where clear code is faster to read',
    ],
  },
  advanced: {
    summary:
      'Production-grade: the version that survives real traffic and a code review at a serious shop.',
    mustHave: [
      'Comprehensive error handling and input validation at boundaries',
      'Observability hooks (structured logs / metrics / health) where relevant',
      'Concurrency/throughput considerations stated and handled',
      'Security basics: no injection vectors, secrets via env, least privilege',
      'Tests or a clear, runnable test stub; documented assumptions and trade-offs',
    ],
    avoid: [
      'Adding architecture the stated scale does not justify — state when it is overkill',
      'Hand-waving ("add auth here") instead of a concrete, runnable approach',
    ],
  },
};

export function decideCodePolicy(rawInput: string): CodePolicy {
  const input = typeof rawInput === 'string' ? rawInput : '';

  const wantsAdvanced = RX_ADVANCED.test(input);
  const wantsMinimal = RX_MINIMAL.test(input);

  let tier: ComplexityTier;
  let reason: string;
  let tierIsExplicit: boolean;

  if (wantsAdvanced && !wantsMinimal) {
    tier = 'advanced';
    reason = 'request used production/scale/robustness language';
    tierIsExplicit = true;
  } else if (wantsMinimal && !wantsAdvanced) {
    tier = 'minimal';
    reason = 'request asked for a simple/minimal/learning version';
    tierIsExplicit = true;
  } else if (wantsMinimal && wantsAdvanced) {
    tier = 'standard';
    reason = 'request mixed simple and production signals — defaulting to standard';
    tierIsExplicit = false;
  } else {
    tier = 'standard';
    reason = 'no complexity specified — defaulting to good, production-lean software';
    tierIsExplicit = false;
  }

  const scopeNote = detectOverEngineering(input, tier);

  return {
    tier,
    reason,
    contract: CONTRACTS[tier],
    ...(scopeNote ? { scopeNote } : {}),
    tierIsExplicit,
  };
}

export function detectOverEngineering(
  rawInput: string,
  tier: ComplexityTier,
): string | undefined {
  const input = typeof rawInput === 'string' ? rawInput : '';
  if (!RX_HEAVY_INFRA.test(input)) return undefined;
  if (!RX_TRIVIAL_DOMAIN.test(input)) return undefined;

  const matchedDomain = input.match(RX_TRIVIAL_DOMAIN)?.[0]?.trim() ?? 'this';
  return (
    `Heads up: a ${matchedDomain} doesn't need that infrastructure to be good — ` +
    `the heavy setup adds failure modes without adding value here. ` +
    `I'll build exactly what you asked, but the simpler single-process version ` +
    `would be more maintainable. Say "keep it simple" and I'll scope it down.`
  );
}

export function renderQualityBrief(policy: CodePolicy): string {
  const c = policy.contract;
  const lines: string[] = [];
  lines.push(`Quality bar (${policy.tier}): ${c.summary}`);
  lines.push('Must satisfy:');
  for (const m of c.mustHave) lines.push(`  - ${m}`);
  lines.push('Deliberately avoid:');
  for (const a of c.avoid) lines.push(`  - ${a}`);
  if (policy.scopeNote) lines.push(`Scope note: ${policy.scopeNote}`);
  return lines.join('\n');
}

export function looksLikeCodeRequest(rawInput: string): boolean {
  const input = typeof rawInput === 'string' ? rawInput : '';
  return RX_IS_BUILDISH.test(input);
}
