/**
 * ConversationContract — a durable, correction-aware ledger of the constraints,
 * decisions, and output-format contract a user has established over a chat.
 *
 * Companion to `conversation-facts.ts`:
 *   - conversation-facts extracts raw projects / stacks / decisions / constraints
 *     statelessly, but has NO notion of corrections (a later turn overriding an
 *     earlier one) and NO output-format tracking. That's what drives the two
 *     failure families this module targets: constraint degradation (an old
 *     constraint the user already changed keeps getting honored) and
 *     output-format drift (the model forgets "JSON only" after a few turns).
 *   - this module folds the same history into a typed ledger, applies
 *     supersession when the user issues a correction, resolves the currently
 *     active output-format contract, and emits a prelude that restates the
 *     ACTIVE contract every single turn (the anti-drift mechanism).
 *
 * Determinism / trust (Thorsen):
 *   - Pure function of the transcript. No persistence boundary, no migration.
 *   - Reuses the canonical extractor (`extractConversationFacts`) so there is
 *     one source of truth for raw facts; this module only adds the temporal
 *     overlay (corrections + active format).
 *   - Outputs are frozen and fully typed.
 */

import {
  extractConversationFacts,
  type ConversationFacts,
  type FactsHistoryMessage,
} from './conversation-facts.js';

export type ConstraintKind = 'must' | 'must-not' | 'format' | 'preference';
export type LedgerStatus = 'active' | 'superseded';

export interface ContractConstraint {
  readonly text: string;
  readonly kind: ConstraintKind;
  readonly status: LedgerStatus;
  /** 1-based user-turn index where the constraint was stated. */
  readonly turn: number;
  /** Turn index of the correction that retired this constraint, if any. */
  readonly supersededByTurn?: number;
}

export interface ContractDecision {
  readonly choice: string;
  readonly category: string | null;
  readonly status: LedgerStatus;
  readonly turn: number;
  readonly supersededByTurn?: number;
}

export interface Correction {
  readonly turn: number;
  readonly supersedes: 'constraint' | 'decision' | 'format';
  /** What the user moved away from (best-effort; '' when only a relaxation). */
  readonly from: string;
  /** What the user moved to ('' when a pure relaxation / removal). */
  readonly to: string;
}

export type OutputFormatKind =
  | 'json-only'
  | 'code-only'
  | 'language'
  | 'max-words'
  | 'headings'
  | 'no-markdown';

export interface OutputFormatContract {
  readonly kind: OutputFormatKind;
  /** Language name, word budget, heading list, etc. */
  readonly value?: string;
  readonly turn: number;
  readonly status: LedgerStatus;
}

export interface ConversationContract {
  readonly version: 1;
  /** 1-based index of the last user turn folded into the ledger. */
  readonly updatedAtTurn: number;
  readonly projectName: string | null;
  readonly stacks: readonly string[];
  readonly featureNames: readonly string[];
  readonly constraints: readonly ContractConstraint[];
  readonly decisions: readonly ContractDecision[];
  readonly corrections: readonly Correction[];
  /** All output-format directives ever stated (active + superseded). */
  readonly outputFormats: readonly OutputFormatContract[];
  /** Convenience pointer to the most-recent ACTIVE format directive. */
  readonly outputFormat: OutputFormatContract | null;
}

/**
 * JSON-schema description of {@link ConversationContract}. Exported so callers
 * can validate persisted snapshots or document the ledger shape. The reducer is
 * the source of truth; this mirrors it.
 */
export const CONVERSATION_CONTRACT_JSON_SCHEMA = Object.freeze({
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ConversationContract',
  type: 'object',
  required: [
    'version',
    'updatedAtTurn',
    'constraints',
    'decisions',
    'corrections',
    'outputFormats',
    'outputFormat',
  ],
  properties: {
    version: { const: 1 },
    updatedAtTurn: { type: 'integer', minimum: 0 },
    projectName: { type: ['string', 'null'] },
    stacks: { type: 'array', items: { type: 'string' } },
    featureNames: { type: 'array', items: { type: 'string' } },
    constraints: {
      type: 'array',
      items: {
        type: 'object',
        required: ['text', 'kind', 'status', 'turn'],
        properties: {
          text: { type: 'string' },
          kind: { enum: ['must', 'must-not', 'format', 'preference'] },
          status: { enum: ['active', 'superseded'] },
          turn: { type: 'integer' },
          supersededByTurn: { type: 'integer' },
        },
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['choice', 'status', 'turn'],
        properties: {
          choice: { type: 'string' },
          category: { type: ['string', 'null'] },
          status: { enum: ['active', 'superseded'] },
          turn: { type: 'integer' },
          supersededByTurn: { type: 'integer' },
        },
      },
    },
    corrections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['turn', 'supersedes', 'from', 'to'],
        properties: {
          turn: { type: 'integer' },
          supersedes: { enum: ['constraint', 'decision', 'format'] },
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
    },
    outputFormats: { type: 'array', items: { $ref: '#/definitions/outputFormat' } },
    outputFormat: {
      oneOf: [{ type: 'null' }, { $ref: '#/definitions/outputFormat' }],
    },
  },
  definitions: {
    outputFormat: {
      type: 'object',
      required: ['kind', 'turn', 'status'],
      properties: {
        kind: {
          enum: ['json-only', 'code-only', 'language', 'max-words', 'headings', 'no-markdown'],
        },
        value: { type: 'string' },
        turn: { type: 'integer' },
        status: { enum: ['active', 'superseded'] },
      },
    },
  },
} as const);

// ─── Correction detection ─────────────────────────────────────────

/** Words that flag the user is overriding something they said before. */
const CORRECTION_LEAD_RE =
  /\b(?:actually|wait|no,|nope,|scratch\s+that|on\s+second\s+thought|i\s+changed\s+my\s+mind|let'?s\s+not|instead)\b/i;

/** "switch to X", "use X instead (of Y)", "change it to X", "make it X". */
const REPLACE_RE =
  /\b(?:switch(?:ed)?\s+to|use|go\s+with|change\s+(?:it\s+)?to|make\s+it|move\s+to)\s+([A-Za-z0-9][\w.+#/-]{1,38})(?:\s+instead(?:\s+of\s+([A-Za-z0-9][\w.+#/-]{1,38}))?|\s+not\s+([A-Za-z0-9][\w.+#/-]{1,38}))?/i;

/** "stop using X", "don't use X anymore", "no more X", "drop X". */
const REMOVE_RE =
  /\b(?:stop\s+using|don'?t\s+use|do\s+not\s+use|no\s+more|drop|get\s+rid\s+of|remove)\s+(?:the\s+)?([A-Za-z0-9][\w.+#/-]{1,38})\b/i;

/** "you can use X now", "X is fine now", "it's ok to use X" — relaxes a must-not. */
const RELAX_RE =
  /\b(?:you\s+can\s+(?:now\s+)?use|it'?s\s+(?:ok|okay|fine)\s+to\s+use|feel\s+free\s+to\s+use|([A-Za-z0-9][\w.+#/-]{1,38})\s+(?:is|are)\s+(?:ok|okay|fine|allowed)\s*(?:now)?)\b/i;

// ─── Output-format detection ──────────────────────────────────────

interface FormatHit {
  kind: OutputFormatKind;
  value?: string;
}

function detectFormatDirectives(content: string): FormatHit[] {
  const hits: FormatHit[] = [];
  const text = content;

  if (/\b(?:only\s+(?:in\s+|as\s+)?json|json\s+only|respond\s+(?:in|with)\s+(?:valid\s+)?json|as\s+(?:valid\s+|raw\s+)?json|return\s+(?:valid\s+)?json)\b/i.test(text)
    && !/\bno\s+json\b/i.test(text)) {
    hits.push({ kind: 'json-only' });
  }
  if (/\b(?:code\s+only|only\s+code|just\s+(?:the\s+)?code|no\s+prose|no\s+explanation)\b/i.test(text)) {
    hits.push({ kind: 'code-only' });
  }
  if (/\b(?:no\s+markdown|plain\s+text\s+only|without\s+markdown|don'?t\s+use\s+markdown)\b/i.test(text)) {
    hits.push({ kind: 'no-markdown' });
  }
  const langMatch =
    /\b(TypeScript|JavaScript|Python|Rust|Go|Java|C\+\+|C#|Ruby|Kotlin|Swift|PHP)\s+(?:only|exclusively)\b/i.exec(text)
    ?? /\b(?:only\s+(?:use\s+|write\s+(?:in\s+)?)?)(TypeScript|JavaScript|Python|Rust|Go|Java|C\+\+|C#|Ruby|Kotlin|Swift|PHP)\b/i.exec(text);
  if (langMatch) {
    hits.push({ kind: 'language', value: langMatch[1] });
  }
  const wordsMatch =
    /\b(?:under|at\s+most|no\s+more\s+than|max(?:imum)?(?:\s+of)?|less\s+than|keep\s+it\s+(?:under|below|to))\s+(\d{1,4})\s+words?\b/i.exec(text);
  if (wordsMatch) {
    hits.push({ kind: 'max-words', value: wordsMatch[1] });
  }
  const headingsMatch =
    /\buse\s+(?:the\s+|these\s+|exactly\s+these\s+)?headings?\b\s*[:\-]?\s*(.+)$/im.exec(text);
  if (headingsMatch) {
    const list = headingsMatch[1].trim().replace(/[.]+$/, '');
    if (list.length > 0) hits.push({ kind: 'headings', value: list });
  }
  return hits;
}

/** A correction that targets the active format (e.g. "actually, plain text"). */
function detectFormatCorrection(content: string): FormatHit | 'clear' | null {
  if (!CORRECTION_LEAD_RE.test(content) && !/\b(?:no\s+more\s+json|drop\s+the\s+json|forget\s+the\s+json)\b/i.test(content)) {
    // A format correction needs an override signal so we don't retire a format
    // every time JSON is merely mentioned again.
    if (!/\b(?:no\s+more\s+json|stop\s+(?:the\s+|returning\s+)?json|plain\s+text\s+(?:is\s+fine|now)|forget\s+the\s+(?:json|format))\b/i.test(content)) {
      return null;
    }
  }
  const hits = detectFormatDirectives(content);
  if (hits.length > 0) return hits[hits.length - 1];
  if (/\b(?:no\s+more\s+json|drop\s+the\s+json|forget\s+the\s+(?:json|format)|plain\s+(?:text|english)\s+is\s+fine|stop\s+(?:the\s+|returning\s+)?json)\b/i.test(content)) {
    return 'clear';
  }
  return null;
}

// ─── Reducer ──────────────────────────────────────────────────────

/** Trim a captured term and drop trailing sentence punctuation (keeps internal dots like "Next.js"). */
function cleanTerm(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/[.,;:!?]+$/, '').trim();
}

function inferCategory(choice: string): string | null {
  const lower = choice.toLowerCase();
  if (/\btailwind|chakra|mantine|shadcn|bootstrap|css|styl/.test(lower)) return 'styling';
  if (/\bauth|login|clerk|auth0|nextauth|lucia/.test(lower)) return 'auth';
  if (/\bpostgres|mysql|sqlite|mongo|prisma|drizzle|supabase/.test(lower)) return 'database';
  if (/\breact|vue|svelte|next|nuxt|astro|remix|solid/.test(lower)) return 'framework';
  if (/\bvercel|netlify|cloudflare|aws|fly/.test(lower)) return 'deployment';
  return null;
}

/**
 * Fold a chat transcript into a durable contract ledger. Pure; safe to call on
 * every turn. The history should include the just-persisted user turn.
 */
export function reduceConversationContract(
  history: readonly FactsHistoryMessage[],
): ConversationContract {
  const facts: ConversationFacts = extractConversationFacts(history);

  const constraints: ContractConstraint[] = facts.constraints.map((c) => ({
    text: c.text,
    kind: c.kind,
    status: 'active' as LedgerStatus,
    turn: c.turn,
  }));
  const decisions: ContractDecision[] = facts.decisions.map((d) => ({
    choice: d.choice,
    category: d.category,
    status: 'active' as LedgerStatus,
    turn: d.turn,
  }));
  const corrections: Correction[] = [];
  const outputFormats: OutputFormatContract[] = [];

  const supersedeDecision = (idx: number, byTurn: number) => {
    decisions[idx] = { ...decisions[idx], status: 'superseded', supersededByTurn: byTurn };
  };
  const supersedeConstraint = (idx: number, byTurn: number) => {
    constraints[idx] = { ...constraints[idx], status: 'superseded', supersededByTurn: byTurn };
  };
  const retireActiveFormat = (): OutputFormatContract | null => {
    for (let i = outputFormats.length - 1; i >= 0; i--) {
      if (outputFormats[i].status === 'active') {
        outputFormats[i] = { ...outputFormats[i], status: 'superseded' };
        return outputFormats[i];
      }
    }
    return null;
  };
  const findActiveDecisionByTerm = (term: string): number => {
    const t = term.toLowerCase();
    for (let i = decisions.length - 1; i >= 0; i--) {
      if (decisions[i].status !== 'active') continue;
      const c = decisions[i].choice.toLowerCase();
      if (c.includes(t) || t.includes(c)) return i;
    }
    return -1;
  };
  const findActiveConstraintByTerm = (term: string): number => {
    const t = term.toLowerCase();
    for (let i = constraints.length - 1; i >= 0; i--) {
      if (constraints[i].status !== 'active') continue;
      if (constraints[i].text.toLowerCase().includes(t)) return i;
    }
    return -1;
  };

  let userTurn = 0;
  for (const msg of history) {
    if (msg.role !== 'user') continue;
    userTurn += 1;
    const content = msg.content;

    // 1) New output-format directives stated this turn.
    for (const hit of detectFormatDirectives(content)) {
      // A fresh primary format ("json only" / "code only" / "no markdown")
      // retires a prior active primary format of a different shape. Modifier
      // formats (language / max-words / headings) coexist.
      const primary = hit.kind === 'json-only' || hit.kind === 'code-only' || hit.kind === 'no-markdown';
      if (primary) {
        const prevActive = outputFormats.find((f) => f.status === 'active'
          && (f.kind === 'json-only' || f.kind === 'code-only' || f.kind === 'no-markdown'));
        if (prevActive && prevActive.kind !== hit.kind) {
          retireActiveFormat();
          corrections.push({ turn: userTurn, supersedes: 'format', from: prevActive.kind, to: hit.kind });
        } else if (prevActive && prevActive.kind === hit.kind) {
          continue; // restating the same format — no new entry
        }
      }
      outputFormats.push({ kind: hit.kind, value: hit.value, turn: userTurn, status: 'active' });
    }

    // 2) Explicit format correction ("actually, plain text", "no more json").
    const fmtCorrection = detectFormatCorrection(content);
    if (fmtCorrection) {
      const retired = retireActiveFormat();
      if (fmtCorrection === 'clear') {
        if (retired) corrections.push({ turn: userTurn, supersedes: 'format', from: retired.kind, to: '' });
      } else {
        outputFormats.push({ kind: fmtCorrection.kind, value: fmtCorrection.value, turn: userTurn, status: 'active' });
        corrections.push({ turn: userTurn, supersedes: 'format', from: retired?.kind ?? '', to: fmtCorrection.kind });
      }
    }

    // 3) Decision / constraint corrections.
    const hasLead = CORRECTION_LEAD_RE.test(content);
    const replace = REPLACE_RE.exec(content);
    if (replace && (hasLead || replace[2] || replace[3])) {
      const to = cleanTerm(replace[1]);
      const from = cleanTerm(replace[2] ?? replace[3]);
      let fromIdx = from ? findActiveDecisionByTerm(from) : -1;
      if (fromIdx < 0 && !from) {
        // No explicit "instead of X": retire the most recent active decision in
        // the same category as the replacement, else the most recent overall.
        const cat = inferCategory(to);
        for (let i = decisions.length - 1; i >= 0; i--) {
          if (decisions[i].status !== 'active') continue;
          if (cat && decisions[i].category === cat) { fromIdx = i; break; }
        }
        if (fromIdx < 0) {
          for (let i = decisions.length - 1; i >= 0; i--) {
            if (decisions[i].status === 'active') { fromIdx = i; break; }
          }
        }
      }
      if (fromIdx >= 0) {
        const fromChoice = decisions[fromIdx].choice;
        supersedeDecision(fromIdx, userTurn);
        decisions.push({ choice: to, category: inferCategory(to), status: 'active', turn: userTurn });
        corrections.push({ turn: userTurn, supersedes: 'decision', from: fromChoice, to });
      }
    }

    // 4) Constraint removal / relaxation.
    const remove = REMOVE_RE.exec(content);
    if (remove) {
      const term = cleanTerm(remove[1]);
      const cIdx = findActiveConstraintByTerm(term);
      if (cIdx >= 0) {
        supersedeConstraint(cIdx, userTurn);
        corrections.push({ turn: userTurn, supersedes: 'constraint', from: constraints[cIdx].text, to: '' });
      } else {
        const dIdx = findActiveDecisionByTerm(term);
        if (dIdx >= 0) {
          supersedeDecision(dIdx, userTurn);
          corrections.push({ turn: userTurn, supersedes: 'decision', from: decisions[dIdx].choice, to: '' });
        }
      }
    }
    const relax = RELAX_RE.exec(content);
    if (relax) {
      const term = cleanTerm(relax[1])
        || cleanTerm(/\buse\s+(?:the\s+)?([A-Za-z0-9][\w.+#/-]{1,38})/i.exec(content)?.[1]);
      if (term) {
        const cIdx = findActiveConstraintByTerm(term);
        if (cIdx >= 0 && constraints[cIdx].kind === 'must-not') {
          supersedeConstraint(cIdx, userTurn);
          corrections.push({ turn: userTurn, supersedes: 'constraint', from: constraints[cIdx].text, to: '' });
        }
      }
    }
  }

  const activeFormat =
    [...outputFormats].reverse().find((f) => f.status === 'active') ?? null;

  return Object.freeze({
    version: 1,
    updatedAtTurn: userTurn,
    projectName: facts.projects.length > 0 ? facts.projects[facts.projects.length - 1].name : null,
    stacks: Object.freeze([...facts.stacks]) as readonly string[],
    featureNames: Object.freeze([...facts.featureNames]) as readonly string[],
    constraints: Object.freeze(constraints) as readonly ContractConstraint[],
    decisions: Object.freeze(decisions) as readonly ContractDecision[],
    corrections: Object.freeze(corrections) as readonly Correction[],
    outputFormats: Object.freeze(outputFormats) as readonly OutputFormatContract[],
    outputFormat: activeFormat,
  });
}

// ─── Prelude ──────────────────────────────────────────────────────

function describeFormat(f: OutputFormatContract): string {
  switch (f.kind) {
    case 'json-only': return 'respond ONLY as valid JSON (no prose, no markdown fences)';
    case 'code-only': return 'respond with code ONLY (no prose explanation)';
    case 'no-markdown': return 'respond in plain text with NO markdown';
    case 'language': return `write code ONLY in ${f.value ?? 'the chosen language'}`;
    case 'max-words': return `keep the answer under ${f.value ?? 'the stated number of'} words`;
    case 'headings': return `use exactly these headings, in order: ${f.value ?? ''}`.trim();
    default: return f.kind;
  }
}

/**
 * Build a system prelude that restates the ACTIVE contract every turn. This is
 * what the model sees; it is intentionally explicit so a long-context model
 * cannot quietly drift off a constraint or output format the user set earlier.
 *
 * Replaces `buildFactsSystemPrelude` in the chat pipeline. Returns null when
 * there is nothing durable to restate.
 *
 * The line markers (`Output format contract:`, `Honor:`, etc.) are stable so
 * downstream tooling / evals can detect that the contract was surfaced.
 */
export function buildContractSystemPrelude(contract: ConversationContract): string | null {
  const lines: string[] = [];

  if (contract.projectName) {
    lines.push(`- Active project: ${contract.projectName}`);
  }
  if (contract.stacks.length > 0) {
    lines.push(`- Stack the user named: ${contract.stacks.join(', ')}`);
  }
  if (contract.featureNames.length > 0) {
    lines.push(`- Feature names: ${contract.featureNames.join(', ')}`);
  }

  const activeConstraints = contract.constraints.filter((c) => c.status === 'active');
  for (const c of activeConstraints) {
    lines.push(`- Active constraint (${c.kind}): ${c.text}`);
  }

  const activeDecisions = contract.decisions.filter((d) => d.status === 'active');
  for (const d of activeDecisions) {
    lines.push(`- Active decision: ${d.choice}${d.category ? ` (${d.category})` : ''}`);
  }

  // Surface the most recent corrections explicitly — the durability mechanism
  // against constraint degradation.
  const recentCorrections = contract.corrections.slice(-3);
  for (const corr of recentCorrections) {
    if (corr.to && corr.from) {
      lines.push(`- Honor: the user changed ${corr.from} → ${corr.to} (turn ${corr.turn}); honor "${corr.to}", NOT "${corr.from}".`);
    } else if (corr.from) {
      lines.push(`- Honor: the user retired "${corr.from}" (turn ${corr.turn}); do not reintroduce it.`);
    }
  }

  if (contract.outputFormat) {
    lines.push(`- Output format contract: ${describeFormat(contract.outputFormat)}.`);
  }

  if (lines.length === 0) return null;
  return [
    'Conversation contract — the user established these earlier in THIS conversation. Honor every item on every turn unless the user changes it:',
    ...lines,
  ].join('\n');
}
