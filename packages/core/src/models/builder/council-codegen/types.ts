import type { TokenUsage } from '../../adapter.js';

/**
 * Council codegen — the generative builder arm where Vai's council of AIs
 * (local Ollama models and any configured cloud models) produces the app
 * instead of a single escalation model.
 *
 * Roles: members[0] is the architect+coder (the strongest model in the
 * fallback chain); the remaining members are reviewers. All member calls run
 * SEQUENTIALLY — this machine BSODs under combined GPU load, and the Ollama
 * daemon swaps one model in VRAM at a time anyway.
 */

export interface CouncilCodegenMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface CouncilCodegenCompletion {
  readonly text: string;
  readonly usage?: TokenUsage;
}

export interface CouncilCodegenMember {
  /** Registered adapter id (e.g. "local:qwen3:8b"). */
  readonly id: string;
  readonly displayName?: string;
  readonly complete: (
    messages: readonly CouncilCodegenMessage[],
    options?: { readonly maxTokens?: number; readonly temperature?: number },
  ) => Promise<CouncilCodegenCompletion>;
}

/** What the architect stage decides before any code is written. */
export interface CouncilAppSpec {
  readonly title: string;
  readonly packageName: string;
  readonly summary: string;
  readonly features: readonly string[];
  /** True when the spec came from the architect model; false = derived from the brief. */
  readonly fromArchitect: boolean;
}

export interface CodegenReviewNote {
  readonly memberId: string;
  readonly verdict: 'ship' | 'needs-work';
  readonly mustFix: readonly string[];
  readonly notes: readonly string[];
  readonly error?: string;
}

export interface AppValidationReport {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /**
   * Quality problems worth a repair pass but not worth discarding a
   * compilable app over (e.g. mostly-unstyled utility classes). The pipeline
   * feeds them to repair; if repair can't fix them the app still ships.
   */
  readonly softErrors: readonly string[];
  readonly warnings: readonly string[];
  /** 'tsc' when the TypeScript compiler checked syntax, 'heuristic' otherwise. */
  readonly checker: 'tsc' | 'heuristic';
}

export interface CouncilCodegenResult {
  /** Final chat artifact: prose intro + titled file blocks (sandbox contract). */
  readonly output: string;
  readonly spec: CouncilAppSpec;
  readonly validation: AppValidationReport;
  readonly reviews: readonly CodegenReviewNote[];
  readonly repairsUsed: number;
  readonly usage: TokenUsage;
  /** Member ids in the order they acted (coder first). */
  readonly memberIds: readonly string[];
}

export type CouncilCodegenStage = 'architect' | 'code' | 'validate' | 'review' | 'repair' | 'style' | 'assemble';

export type CouncilCodegenEvent =
  | {
    readonly type: 'stage';
    readonly stage: CouncilCodegenStage;
    readonly label: string;
    readonly detail?: string;
    readonly memberId?: string;
    readonly status: 'running' | 'done';
  }
  | {
    readonly type: 'result';
    /** Null when the council could not produce a valid app — caller falls back. */
    readonly result: CouncilCodegenResult | null;
  };

export interface CouncilEditFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Edit mode: the conversation has an ACTIVE sandbox project and the prompt is
 * an iteration on it ("make the background more fancy"), so the council must
 * patch the current files — never invent a new app from the request's words.
 * (Live failure this guards against: "make my background more fancy" produced
 * a brand-new "Fancy Background App" instead of restyling the running app.)
 */
export interface CouncilEditContext {
  readonly projectName: string;
  /** Current file snapshots from the running sandbox (possibly truncated). */
  readonly files: readonly CouncilEditFile[];
}

export interface CouncilCodegenInput {
  readonly brief: string;
  readonly members: readonly CouncilCodegenMember[];
  /** Bounded repair passes after validation/review failures. Default 2. */
  readonly maxRepairs?: number;
  /** Cap on reviewers consulted (members[1..]). Default 2. */
  readonly maxReviewers?: number;
  /** When set, run as a targeted edit of the active project instead of a fresh build. */
  readonly edit?: CouncilEditContext;
}
