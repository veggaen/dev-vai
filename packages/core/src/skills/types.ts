/**
 * Vai Skills System
 *
 * Skills are reusable capability packs that can be:
 * - Loaded from SKILL.md files in the skills/ directory
 * - Assigned to sub-agent instances
 * - Composed into research/build/verify pipelines
 *
 * Compatible with Claude Code SKILL.md format and skills.sh conventions.
 */

// ── Skill Manifest ──────────────────────────────────────────────

export interface SkillManifest {
  /** Unique skill identifier */
  readonly name: string;
  /** One-line description */
  readonly description: string;
  /** Trigger phrases that activate this skill */
  readonly triggers: readonly string[];
  /** Tools this skill needs (browser, fetch, shell, files, etc.) */
  readonly tools: readonly SkillTool[];
  /** Permissions required */
  readonly permissions: readonly SkillPermission[];
  /** Skills this one depends on */
  readonly requires?: readonly string[];
  /** Trust level: builtin | verified | community | untrusted */
  readonly trust: SkillTrust;
  /** Version string */
  readonly version?: string;
  /** Author */
  readonly author?: string;
}

export type SkillTool =
  | 'browser'
  | 'fetch'
  | 'search'
  | 'extractor'
  | 'ranker'
  | 'shell'
  | 'files'
  | 'code-runner'
  | 'memory';

export type SkillPermission =
  | 'web'
  | 'web-screenshots'
  | 'page-text'
  | 'local-files'
  | 'shell-read'
  | 'shell-write'
  | 'memory-read'
  | 'memory-write';

export type SkillTrust = 'builtin' | 'verified' | 'community' | 'untrusted';

// ── Loaded Skill ─────────────────────────────────────────────────

export interface LoadedSkill {
  readonly manifest: SkillManifest;
  /** Full SKILL.md content (instructions for the agent) */
  readonly instructions: string;
  /** Absolute path to the skill folder */
  readonly path: string;
}

// ── Sub-Agent Definition ──────────────────────────────────────────

export type SubAgentRole =
  | 'planner'      // breaks tasks into steps
  | 'researcher'   // web search + evidence gathering
  | 'browser'      // navigates pages, extracts text
  | 'coder'        // code generation + refactoring
  | 'verifier'     // checks claims, tests code
  | 'teacher'      // decides what to permanently learn
  | 'synthesizer'  // assembles cited answer from evidence
  | 'general';     // general purpose

export interface SubAgentConfig {
  readonly role: SubAgentRole;
  /** Skills assigned to this agent */
  readonly skills: readonly string[];
  /** System prompt override (added on top of role default) */
  readonly systemPrompt?: string;
  /** Max context window for this agent */
  readonly maxHistoryMessages?: number;
  /** Tools available (subset of skill tools) */
  readonly allowedTools?: readonly SkillTool[];
}

// ── Task Delegation ───────────────────────────────────────────────

export interface AgentTask {
  readonly id: string;
  readonly role: SubAgentRole;
  readonly input: string;
  readonly context?: string;
  readonly skills?: readonly string[];
  readonly parentTaskId?: string;
}

export interface AgentTaskResult {
  readonly taskId: string;
  readonly role: SubAgentRole;
  readonly output: string;
  readonly evidence?: readonly EvidenceBlock[];
  readonly confidence: number;
  readonly skillsUsed: readonly string[];
  readonly durationMs: number;
  readonly trace: readonly TraceSpan[];
}

// ── Evidence & Citations ──────────────────────────────────────────

export interface EvidenceBlock {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  /** The extracted snippet that supports a claim */
  readonly snippet: string;
  /** Trust score 0-1 */
  readonly trustScore: number;
  readonly domain: string;
  readonly fetchedAt: string;
  /** Which claims in the final answer this block supports */
  readonly supportsClaimIds?: readonly string[];
}

export interface CitedAnswer {
  /** The synthesized answer text with [1], [2] inline citations */
  readonly text: string;
  /** Ordered list of evidence blocks */
  readonly evidence: readonly EvidenceBlock[];
  /** Overall confidence 0-1 */
  readonly confidence: number;
}

// ── Provenance ────────────────────────────────────────────────────

export interface ProvenanceRecord {
  readonly answerId: string;
  readonly query: string;
  readonly strategy: string;
  readonly skillsUsed: readonly string[];
  readonly subAgentsInvoked: readonly SubAgentRole[];
  readonly evidenceBlockIds: readonly string[];
  readonly localKnowledgeUsed: boolean;
  readonly webSearchUsed: boolean;
  readonly learnedPermanently: boolean;
  readonly userApproved: boolean | null;
  readonly createdAt: string;
}

// ── Tracing ───────────────────────────────────────────────────────

export interface TraceSpan {
  readonly step: string;
  readonly detail: string;
  readonly durationMs: number;
  readonly skillUsed?: string;
  readonly subAgent?: SubAgentRole;
}

// ── Learned Unit (with provenance) ───────────────────────────────

export type LearnedFrom =
  | 'user'
  | 'web-search'
  | 'browser-session'
  | 'document-ingest'
  | 'agent-run'
  | 'skill-output';

export type LearnedKind =
  | 'fact'
  | 'procedure'
  | 'pattern'
  | 'code-snippet'
  | 'skill'
  | 'comparison';

export interface LearnedUnit {
  readonly id: string;
  readonly kind: LearnedKind;
  readonly content: string;
  /** Source URL if from web */
  readonly sourceUrl?: string;
  /** Source page title */
  readonly sourceTitle?: string;
  /** Exact snippet from source that this was extracted from */
  readonly sourceSnippet?: string;
  /** Character positions in source text */
  readonly sourceSpan?: { readonly start: number; readonly end: number };
  readonly learnedFrom: LearnedFrom;
  /** 0-1 confidence in this unit */
  readonly confidence: number;
  /** Whether the user explicitly approved this */
  readonly approvedByUser: boolean;
  readonly createdAt: string;
  readonly tags: readonly string[];
}
