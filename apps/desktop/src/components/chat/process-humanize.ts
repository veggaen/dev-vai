/**
 * process-humanize — turn the council/advisor machine fields into first-person,
 * plain-language narration for the ProcessTree.
 *
 * The process tree used to render structured payloads verbatim — e.g.
 *   "Member: Local qwen3:8b\nTopic: review\nStatus: waiting for response"
 *   "Actor: local:qwen2.5:3b\nModel: qwen2.5:3b\nState: running"
 *   "Suggested action: reread-intent"
 * which read like a console/debug dump, not like Vai (or a council member)
 * thinking out loud. These helpers rewrite those fields so every line a user
 * sees explains WHAT is happening and WHY, in Vai's voice.
 *
 * Pure + DOM-free so they unit-test in node (desktop tests run headless).
 */

/** Drop the "Local " / "local:" prefixes Ollama adapters carry, for a clean spoken name. */
export function cleanModelName(raw: string | undefined): string {
  if (!raw) return 'a local model';
  return raw.replace(/^local:/i, '').replace(/^Local\s+/i, '').trim() || 'a local model';
}

/** A friendly phrase for what a council topic means ("reasoning" → "the reasoning angle"). */
export function topicPhrase(topic: string | undefined): string {
  switch ((topic || '').toLowerCase()) {
    case 'reasoning': return 'first-principles reasoning';
    case 'code': return 'the code angle';
    case 'factual': return 'the facts';
    case 'local': return 'local knowledge';
    case 'review': return 'a review';
    case 'other': return 'this';
    default: return topic?.trim() || 'this';
  }
}

/**
 * Turn a council member's `suggestedAction` enum into a plain recommendation.
 * Kept lossless: an unknown action falls back to a readable de-kebab.
 */
export function humanizeSuggestedAction(action: string | undefined): string {
  switch ((action || '').trim()) {
    case 'reread-intent': return 're-read what you really meant before answering';
    case 'answer-directly': return 'just answer it directly';
    case 'search': return 'search the web for fresh facts first';
    case 'search-web': return 'search the web for fresh facts first';
    case 'use-tool': return 'use a tool to verify before answering';
    case 'build': return 'treat this as a build task';
    case 'redraft': return 'rewrite the draft';
    case 'escalate': return 'hand off to a stronger model';
    case 'clarify': return 'ask a clarifying question';
    default:
      return (action || '').replace(/[-_]/g, ' ').trim() || 'no change';
  }
}

/** A one-line verdict gloss: verdict + confidence → "agreed it's solid (82% sure)". */
export function humanizeVerdict(verdict: string | undefined, confidencePct: number | undefined): string {
  const pct = confidencePct !== undefined ? ` (${confidencePct}% sure)` : '';
  switch ((verdict || '').trim()) {
    case 'ship': return `says it's good to send${pct}`;
    case 'good': return `says it's solid${pct}`;
    case 'needs-work': return `wants it improved first${pct}`;
    case 'bad': return `pushes back on it${pct}`;
    case 'reject': return `rejects this approach${pct}`;
    default: return `${verdict?.trim() || 'reviewed it'}${pct}`;
  }
}

/** Compact one-word verdict chip — for dense surfaces like the council progress panel. */
export function shortVerdict(verdict: string | undefined): string {
  switch ((verdict || '').trim()) {
    case 'ship': return 'good to send';
    case 'good': return 'looks solid';
    case 'needs-work': return 'wants another pass';
    case 'bad': return 'pushes back';
    case 'reject': return 'rejects it';
    default: return verdict?.trim() || 'reviewed';
  }
}

/**
 * The spoken line for a council member that is still being consulted.
 * Replaces "Member: … / Topic: … / Status: waiting for response".
 */
export function humanizeMemberWaiting(name: string, topic: string | undefined): string {
  return `Waiting for ${cleanModelName(name)} to weigh in on ${topicPhrase(topic)}…`;
}

/**
 * The spoken line for a council member that has returned a review.
 * Replaces "Member: … / Topic: … / Status: returned structured review".
 */
export function humanizeMemberReturned(
  name: string,
  topic: string | undefined,
  verdict: string | undefined,
  confidencePct: number | undefined,
  failed?: boolean,
): string {
  const who = cleanModelName(name);
  if (failed) return `${who} didn't get back in time on ${topicPhrase(topic)}.`;
  return `${who} looked at ${topicPhrase(topic)} and ${humanizeVerdict(verdict, confidencePct)}.`;
}

/**
 * The spoken line for an advisor/shadow-steering model.
 * Replaces "Actor: … / Model: … / State: running".
 */
export function humanizeAdvisorState(
  modelId: string,
  state: string | undefined,
  opts?: { durationMs?: number; confidencePct?: number },
): string {
  const who = cleanModelName(modelId);
  const dur = opts?.durationMs !== undefined ? ` (${formatSpokenMs(opts.durationMs)})` : '';
  switch ((state || '').toLowerCase()) {
    case 'background':
      return `${who} is steering quietly in the background — guiding the answer, not writing it.`;
    case 'running':
      return `${who} is thinking it through${dur}…`;
    case 'invalid':
      return `${who} came back unusable, so Vai is setting it aside.`;
    case 'unavailable':
      return `${who} isn't available right now, so Vai is moving on without it.`;
    case 'done':
    case 'complete':
      return `${who} finished${dur}.`;
    default:
      return `${who}: ${(state || 'working').toString()}${dur}.`;
  }
}

/** Compact, spoken duration: "1.2s", "340ms". */
export function formatSpokenMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

/**
 * The live-tail label: instead of a bare "Working…", say what Vai is doing right
 * now, derived from the active step's stage (and the council member in flight when
 * there is one). Keeps it short — this is the pulsing bottom line of the live tree.
 */
export function humanizeLiveTail(active?: {
  stage?: string;
  /** Name of the council member currently being consulted, if any. */
  memberInFlight?: string;
  memberTopic?: string;
}): string {
  const stage = active?.stage ?? '';
  if (active?.memberInFlight) {
    return `Consulting ${cleanModelName(active.memberInFlight)} on ${topicPhrase(active.memberTopic)}…`;
  }
  if (stage.startsWith('council')) return 'Convening the council…';
  if (stage === 'vai-draft') return 'Drafting an answer…';
  if (stage === 'vai-redraft') return 'Revising the answer…';
  if (stage === 'search' || stage === 'research') return 'Searching for fresh facts…';
  if (stage === 'escalate') return 'Bringing in a stronger model…';
  if (stage === 'quality-check' || stage === 'verify') return 'Double-checking the answer…';
  if (stage.startsWith('build') || stage === 'apply' || stage === 'preview') return 'Building it…';
  if (stage.startsWith('tool')) return 'Running a tool…';
  if (stage.startsWith('image')) return 'Looking at the image…';
  return 'Thinking it through…';
}

/**
 * Humanize a council member's full review body (the expandable note).
 * Replaces the "Real intent: … / Suggested action: … / Method lesson: …" stack
 * with a paragraph that reads like the member explaining itself. Lossless: every
 * present field still appears, just phrased.
 */
export function humanizeMemberBody(fields: {
  name?: string;
  realIntent?: string;
  hiddenMeaning?: string;
  missingCapability?: string;
  suggestedAction?: string;
  methodLesson?: string;
  concerns?: readonly string[];
}): string {
  const who = cleanModelName(fields.name);
  const lines: string[] = [];
  if (fields.realIntent?.trim()) lines.push(`What ${who} thinks you're really after: ${fields.realIntent.trim()}`);
  if (fields.hiddenMeaning?.trim()) lines.push(`Reading between the lines: ${fields.hiddenMeaning.trim()}`);
  if (fields.missingCapability?.trim()) lines.push(`What Vai would need to nail it: ${fields.missingCapability.trim()}`);
  if (fields.suggestedAction?.trim()) lines.push(`${who} suggests Vai ${humanizeSuggestedAction(fields.suggestedAction)}.`);
  if (fields.methodLesson?.trim()) lines.push(`How to do it well: ${fields.methodLesson.trim()}`);
  if (fields.concerns?.length) lines.push(`Things ${who} flagged:\n- ${fields.concerns.join('\n- ')}`);
  return lines.join('\n\n');
}
