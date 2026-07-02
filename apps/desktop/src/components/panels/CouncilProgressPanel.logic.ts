import type { CouncilThinkingUI } from '../../stores/chatStore.js';
import { cleanModelName, shortVerdict, topicPhrase } from '../chat/process-humanize.js';
import { stripAnsi } from '../../lib/strip-ansi.js';

/**
 * Pure presentation model for the right "Reasoning" panel (CouncilProgressPanel).
 * Display strings read as plain "Reasoning"/"reviewers" by owner decision — internal
 * Council* types keep their names. DOM-free so it unit-tests in node.
 */

export interface OutcomeLine {
  /** One plain sentence: what the review decided and what happens next. */
  sentence: string;
  /** Quiet suffix, e.g. "82% agreement" — rendered muted after the sentence. */
  suffix: string;
  tone: 'good' | 'warn' | 'info';
}

export interface MemberRow {
  name: string;
  /** Humanized angle, no brackets: "looked at the code angle". */
  role: string;
  stance: 'good' | 'warn' | 'bad' | 'silent';
  /** One-line position for the resting row. */
  position: string;
  /** Full note revealed on row expand; empty when there is nothing more to show. */
  fullNote: string;
  confidencePct?: number;
}

export interface ReasoningPanelModel {
  outcome: OutcomeLine;
  members: MemberRow[];
  /** True when no member returned a usable review — render the outcome line only. */
  noResponders: boolean;
  lessons: string[];
  gaps: string[];
  /** "Read as: …" intent line, shown inside the expanded outcome area. */
  readAs?: string;
}

function humanizeRecommendedAction(action: string | undefined): string | undefined {
  switch ((action || '').trim()) {
    case 'search':
    case 'search-web': return 'search the web before answering';
    case 'use-tool': return 'verify with a tool before answering';
    case 'redraft': return 'rewrite the draft';
    case 'reread-intent': return 're-read the intent';
    case 'ask-one-question': return 'ask one clarifying question';
    case 'escalate': return 'bring in a stronger model';
    case 'build': return 'treat it as a build task';
    case 'answer-directly':
    case 'ship': return undefined;
    default: {
      const t = (action || '').replace(/[-_]/g, ' ').trim();
      return t || undefined;
    }
  }
}

const clamp = (text: string, max: number): string => {
  const t = stripAnsi(text).trim().split('\n')[0] ?? '';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function buildOutcomeLine(council: CouncilThinkingUI): OutcomeLine {
  const suffix = `${Math.round(council.agreement * 100)}% agreement`;
  if (council.outcome === 'ship') {
    return { sentence: 'Approved — good to send.', suffix, tone: 'good' };
  }
  if (council.outcome === 'act') {
    const action = humanizeRecommendedAction(council.recommendedAction);
    return {
      sentence: action ? `Act first — ${action}.` : 'Act first before answering.',
      suffix,
      tone: 'warn',
    };
  }
  return { sentence: 'Handed to a stronger model.', suffix, tone: 'info' };
}

export function buildMemberRows(members: CouncilThinkingUI['members']): MemberRow[] {
  return members.map((m) => {
    const name = cleanModelName(m.name);
    if (m.failed) {
      return {
        name,
        role: topicPhrase(m.topic),
        stance: 'silent' as const,
        position: "didn't get back in time",
        fullNote: '',
      };
    }
    const pct = Math.round(m.confidence * 100);
    const noteLine = clamp(m.note ?? '', 90);
    return {
      name,
      role: topicPhrase(m.topic),
      stance: m.verdict === 'good' ? ('good' as const) : m.verdict === 'bad' ? ('bad' as const) : ('warn' as const),
      position: `${shortVerdict(m.verdict)} · ${pct}%${noteLine ? ` — ${noteLine}` : ''}`,
      fullNote: stripAnsi(m.note ?? '').trim(),
      confidencePct: pct,
    };
  });
}

export function buildReasoningPanelModel(council: CouncilThinkingUI): ReasoningPanelModel {
  const members = buildMemberRows(council.members);
  const responders = council.members.filter((m) => !m.failed);
  return {
    outcome: buildOutcomeLine(council),
    members,
    noResponders: responders.length === 0,
    lessons: council.methodLessons.map((l) => stripAnsi(l).trim()).filter(Boolean),
    gaps: council.missingCapabilities.map((g) => stripAnsi(g).trim()).filter(Boolean),
    readAs: council.realIntent?.trim() ? stripAnsi(council.realIntent).trim() : undefined,
  };
}
