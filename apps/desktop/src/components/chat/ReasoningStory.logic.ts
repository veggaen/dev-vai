/**
 * ReasoningStory — the narrative half of the timeline.
 *
 * The spine shows the SHAPE of a turn; this module turns the same model into the
 * CONVERSATION: an ordered, human-readable feed of who did/said what to whom —
 * Vai working, peers (council members) speaking to Vai, the gate ruling, tools
 * reporting. Every line is one sentence with an attributed speaker, so the
 * back-and-forth between peers and Vai is legible at a glance and streams live
 * as phases arrive.
 *
 * Pure projection over TimelinePhase[] + CouncilThinkingUI — no IO, unit-tested.
 */

import type { ProcessNode } from './ProcessTree.logic.js';
import type { TimelinePhase } from './Timeline.logic.js';
import type { CouncilThinkingUI } from '../../stores/chatStore.js';
import { cleanModelName, shortVerdict } from './process-humanize.js';

export type StoryRole = 'vai' | 'peer' | 'gate' | 'tool' | 'note';
export type StoryTone = 'neutral' | 'good' | 'warn' | 'bad';

export interface StoryLine {
  readonly id: string;
  /** Who is speaking/acting: 'Vai', a cleaned member name, 'Council', a tool name. */
  readonly speaker: string;
  /** Peer-to-peer target when the line is directed ("qwen2.5:3b → Vai"). */
  readonly to?: string;
  readonly role: StoryRole;
  readonly tone: StoryTone;
  readonly text: string;
  /** True while this line describes work still happening (present tense, shimmer). */
  readonly live?: boolean;
  /** The timeline phase this line belongs to — lets the feed open that phase's spotlight. */
  readonly phaseId?: string;
}

const MAX_TEXT = 180;

const clip = (s: string): string => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT - 1)}…` : one;
};

const firstLine = (s: string | undefined): string => (s ?? '').split('\n')[0]?.trim() ?? '';

function toneForVerdict(verdict: string | undefined): StoryTone {
  switch ((verdict ?? '').trim()) {
    case 'ship':
    case 'good': return 'good';
    case 'needs-work': return 'warn';
    case 'bad':
    case 'reject': return 'bad';
    default: return 'neutral';
  }
}

/** A council member's spoken position, matched from the council payload when available. */
function memberLine(
  child: ProcessNode,
  council: CouncilThinkingUI | undefined,
  id: string,
): StoryLine {
  const name = cleanModelName(child.label);
  const member = council?.members.find((m) => cleanModelName(m.name) === name);
  if (member) {
    const pct = Math.round(member.confidence * 100);
    const note = firstLine(member.note);
    return {
      id,
      speaker: name,
      to: 'Vai',
      role: 'peer',
      tone: member.failed ? 'neutral' : toneForVerdict(member.verdict),
      text: member.failed
        ? "didn't get back in time"
        : clip(`${shortVerdict(member.verdict)} · ${pct}%${note ? ` — ${note}` : ''}`),
    };
  }
  // No council match (e.g. a background advisor): speak the NOTE, minus the redundant
  // leading name ("qwen2.5:3b is steering…" → "steering…"). A short detail like
  // 'background' or 'action' is a tag, not speech — never surface it as the line.
  const rawNote = firstLine(child.note);
  const rawDetail = firstLine(child.detail);
  const deName = rawNote.replace(
    new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:is|was|—|-|:)?\\s*`, 'i'),
    '',
  );
  const body = deName || rawNote || (rawDetail.length > 16 ? rawDetail : '');
  return {
    id,
    speaker: name,
    to: 'Vai',
    role: 'peer',
    tone: child.status === 'bad' ? 'bad' : 'neutral',
    text: clip(body || (child.status === 'running' ? 'is weighing in…' : 'weighed in')),
    live: child.status === 'running',
  };
}

/** Work entries (searches run, sources found, files read/shown) — the story must
 * show the WORK, not just the deliberation. Mapped from processLog kinds. */
const WORK_KINDS = new Set(['action', 'artifact', 'read', 'show']);

/** Strip a "1. " list prefix so a single query reads as speech, not an outline. */
const deList = (s: string): string => s.replace(/^\d+\.\s+/, '');

/** One work/tool node → one story line. The expanded payload stays in the
 * spotlight; the story carries the headline plus the first concrete detail
 * (the query run, the top source found). */
function workLine(child: ProcessNode, id: string, phaseId: string): StoryLine {
  const body = deList(firstLine(child.children.find((c) => c.note?.trim())?.note ?? child.note));
  return {
    id,
    speaker: 'Vai',
    role: 'tool',
    tone: child.status === 'bad' ? 'bad' : 'neutral',
    text: clip(body && body !== child.label ? `${child.label} — ${body}` : child.label),
    live: child.status === 'running',
    phaseId,
  };
}

/** Walk one phase's node tree for the exchanges worth narrating. */
function nodeLines(
  phase: TimelinePhase,
  council: CouncilThinkingUI | undefined,
): StoryLine[] {
  const out: StoryLine[] = [];
  const walk = (node: ProcessNode, path: string) => {
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i];
      const id = `${phase.id}:${path}:${i}`;
      if (child.kind && WORK_KINDS.has(child.kind)) {
        // Searches run, sources found, files read — narrate the headline and
        // stop: the body child is the same payload expanded.
        out.push(workLine(child, id, phase.id));
        continue;
      }
      if (child.kind === 'tool') {
        // A tool run speaks as itself ("web-fetch · ok · 412ms"); its
        // request/event/response children are spotlight payloads, not speech.
        out.push({
          id,
          speaker: child.label,
          role: 'tool',
          tone: child.status === 'bad' ? 'bad' : 'neutral',
          text: clip(firstLine(child.detail) || (child.status === 'running' ? 'running…' : 'finished')),
          live: child.status === 'running',
          phaseId: phase.id,
        });
        continue;
      }
      if (child.kind === 'submodel') {
        out.push({ ...memberLine(child, council, id), phaseId: phase.id });
      } else if (child.kind === 'verdict') {
        const bad = child.status === 'bad';
        const body = firstLine(child.detail) || firstLine(child.label);
        // A verdict row with no actual content ("verdict", "Verdict") is dead weight — skip it.
        if (!body || /^verdicts?$/i.test(body)) continue;
        out.push({
          id,
          speaker: 'Council',
          to: 'Vai',
          role: 'gate',
          tone: bad ? 'warn' : 'good',
          text: clip(body),
          phaseId: phase.id,
        });
      } else if ((child.kind === 'reasoning' || child.kind === 'event') && child.note?.trim()) {
        out.push({
          id,
          speaker: 'Vai',
          role: 'note',
          tone: 'neutral',
          text: clip(firstLine(child.note)),
          live: child.status === 'running',
          phaseId: phase.id,
        });
      }
      walk(child, `${path}:${i}`);
    }
  };
  for (let n = 0; n < phase.nodes.length; n += 1) walk(phase.nodes[n], String(n));
  return out;
}

/**
 * Build the ordered narrative for a turn. Lines stream in phase order; a running
 * phase speaks in the present tense and is marked live.
 */
export function buildStoryLines(
  phases: readonly TimelinePhase[],
  council?: CouncilThinkingUI | null,
): StoryLine[] {
  const out: StoryLine[] = [];

  // The turn's intent read leads the story when the council surfaced one.
  const intent = council?.realIntent?.trim();
  if (intent) {
    out.push({
      id: 'story:intent',
      speaker: 'Vai',
      role: 'vai',
      tone: 'neutral',
      text: clip(`Read the ask as: ${intent}`),
    });
  }

  for (const phase of phases) {
    const running = phase.status === 'running';
    const summary = phase.summary && phase.summary !== phase.title ? phase.summary : '';
    const children = nodeLines(phase, council ?? undefined);

    if (phase.gate) {
      out.push({
        id: `${phase.id}:gate`,
        speaker: 'Council',
        to: 'Vai',
        role: 'gate',
        tone: phase.gate.approved ? 'good' : 'warn',
        text: clip(
          `${phase.gate.approved ? 'Approved' : 'Sent back'}${
            phase.gate.confidence !== undefined ? ` at ${Math.round(phase.gate.confidence * 100)}%` : ''
          }${phase.gate.reason ? ` — ${phase.gate.reason}` : ''}`,
        ),
        live: running,
        phaseId: phase.id,
      });
    } else if (/council (?:could not|couldn't|didn't) convene|council skipped/i.test(`${phase.title} ${summary}`)) {
      // A skipped council is a quiet system fact, never "Vai said…".
      out.push({
        id: `${phase.id}:head`,
        speaker: 'Council',
        role: 'gate',
        tone: 'neutral',
        text: 'skipped — nothing needed review this turn',
        live: running,
        phaseId: phase.id,
      });
    } else if (phase.phase === 'compose' || phase.phase === 'redraft') {
      // Never echo the answer's own words back into the story — the reply is right below.
      out.push({
        id: `${phase.id}:head`,
        speaker: 'Vai',
        role: 'vai',
        tone: phase.status === 'bad' ? 'bad' : 'neutral',
        text: phase.phase === 'redraft' ? 'Revised the draft' : running ? 'Drafting the answer…' : 'Drafted the answer',
        live: running,
        phaseId: phase.id,
      });
    } else if (summary || children.length === 0) {
      // A bare title above lines that already speak for themselves is noise — the head
      // line earns its place only when it carries a real summary (or stands alone).
      out.push({
        id: `${phase.id}:head`,
        speaker: 'Vai',
        role: 'vai',
        tone: phase.status === 'bad' ? 'bad' : 'neutral',
        text: clip(summary || phase.title),
        live: running,
        phaseId: phase.id,
      });
    }

    out.push(...children);
  }

  // The full narrative stays available — the feed is a scrollable window that
  // follows the newest line, never a truncated one.
  return out;
}
