/**
 * member-evidence — the council "pull model" round.
 *
 * Before a member votes, it gets ONE bounded chance to fetch the context its lens needs:
 * it is shown the question + the available read-only tools (readFile/grep/listFiles) and
 * asked which to call. The runner executes those calls against the sandboxed
 * {@link CouncilContextTools}, then hands the results back so the member grounds its note in
 * evidence IT chose and can VERIFY — rather than whatever the orchestrator pre-flattened.
 *
 * One round only: enough for a member to look where it suspects the problem lives, bounded so
 * a weak local model can't loop forever. A member that needs nothing returns no requests and
 * we skip straight to the vote (no latency tax on simple turns).
 */

import { z } from 'zod';
import type { ModelAdapter } from '../models/adapter.js';
import type { CouncilInput } from './types.js';
import type { CouncilContextTools } from './context-tools.js';

/** Max tool calls a member may request in its one evidence round (keeps it bounded). */
const MAX_REQUESTS = 4;
const EVIDENCE_MAX_TOKENS = 300;

const toolRequestSchema = z.object({
  tool: z.enum(['readFile', 'grep', 'listFiles']),
  path: z.string().optional(),
  pattern: z.string().optional(),
  glob: z.string().optional(),
  start: z.coerce.number().optional(),
  end: z.coerce.number().optional(),
});

const requestsSchema = z.object({
  requests: z.array(toolRequestSchema).catch([]),
});

export type ToolRequest = z.infer<typeof toolRequestSchema>;

/** Instruction block describing the tools — shown to every member so they all know the surface. */
export const EVIDENCE_TOOL_INSTRUCTIONS = [
  'CONTEXT TOOLS (read-only, repo-sandboxed). Before you vote you MAY fetch evidence your lens',
  'needs. Reply with STRICT JSON ONLY: {"requests":[ ... ]} (empty array if you need nothing).',
  'Each request is one of:',
  '  {"tool":"grep","pattern":"<regex>","glob":"<optional glob like src/**/*.ts>"}',
  '  {"tool":"readFile","path":"<repo-relative path>","start":<optional line>,"end":<optional line>}',
  '  {"tool":"listFiles","glob":"<glob>"}',
  `You may request at most ${MAX_REQUESTS} calls. Fetch only what you will actually use to ground`,
  'your note. Do not invent paths — grep or listFiles first if unsure where something lives.',
].join('\n');

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  return first !== -1 && last > first ? body.slice(first, last + 1) : null;
}

/** Parse a member's raw tool-request reply into a bounded, validated request list. */
export function parseToolRequests(raw: string): ToolRequest[] {
  const json = extractJson(raw);
  if (!json) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return []; }
  const result = requestsSchema.safeParse(parsed);
  if (!result.success) return [];
  return result.data.requests.slice(0, MAX_REQUESTS);
}

/** Execute one validated request against the tools, returning a formatted evidence snippet. */
export function runToolRequest(tools: CouncilContextTools, req: ToolRequest): string {
  switch (req.tool) {
    case 'grep': {
      if (!req.pattern) return 'grep: missing pattern.';
      const r = tools.grep(req.pattern, req.glob);
      if (r.hits.length === 0) return `grep /${req.pattern}/ → no matches.`;
      const lines = r.hits.map((h) => `  ${h.path}:${h.line}  ${h.text}`).join('\n');
      return `grep /${req.pattern}/${r.truncated ? ' (truncated)' : ''}:\n${lines}`;
    }
    case 'readFile': {
      if (!req.path) return 'readFile: missing path.';
      const range = req.start != null && req.end != null ? { start: req.start, end: req.end } : undefined;
      const r = tools.readFile(req.path, range);
      if (!r.found) return `readFile ${req.path} → ${r.content}`;
      const head = `readFile ${req.path} (lines ${r.range?.start}-${r.range?.end} of ${r.totalLines}):`;
      return `${head}\n${r.content}`;
    }
    case 'listFiles': {
      if (!req.glob) return 'listFiles: missing glob.';
      const r = tools.listFiles(req.glob);
      if (r.files.length === 0) return `listFiles ${req.glob} → none.`;
      return `listFiles ${req.glob}${r.truncated ? ' (truncated)' : ''}:\n  ${r.files.join('\n  ')}`;
    }
    default:
      return 'Unknown tool.';
  }
}

export interface GatherEvidenceOptions {
  readonly system: string;
  readonly question: string;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
  /** Injectable for tests: parse the model reply into requests (defaults to {@link parseToolRequests}). */
  readonly now?: () => number;
}

export interface MemberEvidence {
  /** The requests the member chose (for the trace / "what did this member look at"). */
  readonly requests: readonly ToolRequest[];
  /** Per-request raw results, paired with the request — feeds the context-state ledger. */
  readonly fetched: readonly { readonly request: ToolRequest; readonly resultText: string }[];
  /** Formatted evidence block to append to the review prompt, or '' if none. */
  readonly block: string;
}

/**
 * Run the one evidence round for a member. Asks the adapter which tools to call, runs them,
 * and returns a formatted evidence block. Never throws into the turn — any failure yields an
 * empty block so the member simply votes without extra context (graceful degradation).
 */
export async function gatherMemberEvidence(
  adapter: ModelAdapter,
  _input: CouncilInput,
  tools: CouncilContextTools,
  opts: GatherEvidenceOptions,
): Promise<MemberEvidence> {
  try {
    const response = await adapter.chat({
      messages: [
        { role: 'system', content: `${opts.system}\n\n${EVIDENCE_TOOL_INSTRUCTIONS}` },
        { role: 'user', content: `QUESTION:\n${opts.question}\n\nReturn the JSON requests now (or {"requests":[]}).` },
      ],
      temperature: 0,
      maxTokens: opts.maxTokens ?? EVIDENCE_MAX_TOKENS,
      signal: opts.signal,
    });
    const requests = parseToolRequests(response.message.content);
    if (requests.length === 0) return { requests: [], fetched: [], block: '' };
    const fetched = requests.map((request) => ({ request, resultText: runToolRequest(tools, request) }));
    const block = [
      'EVIDENCE YOU FETCHED (verify it supports your note; ignore anything that does not):',
      ...fetched.map((f) => f.resultText),
    ].join('\n\n');
    return { requests, fetched, block };
  } catch {
    return { requests: [], fetched: [], block: '' };
  }
}
