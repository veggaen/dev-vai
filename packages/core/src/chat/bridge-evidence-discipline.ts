function unavailable(
  subject: string,
  source: string,
  unavailableAction: string,
): string {
  return [
    `**Live ${subject} unavailable.**`,
    `I do not have a fresh timestamped ${source} capture result attached to this turn, so I cannot ${unavailableAction}. I will not infer it from remembered or plausible content.`,
  ].join('\n\n');
}

export const LIVE_CONTEXT_MAX_AGE_MS = 30_000;

export interface AttachedLiveContextEvidence {
  source: 'vscode-capture-adapter';
  capturedAt: string;
  openFile?: string;
  selection?: string;
  terminalOutput?: string;
}

export type LiveContextField = 'openFile' | 'selection' | 'terminalOutput';

export function getExplicitGrokFriendPrompt(input: string): string | null {
  const match = input.match(
    /^\s*(?:please\s+)?(?:ask|consult)\s+(?:the\s+)?(?:grok(?:\s+friend(?:-channel|\s+channel)?)?|friend-channel)\s*(?::|-|,|\bto\b|\babout\b)?\s+([\s\S]+?)\s*$/i,
  );
  const prompt = match?.[1]?.trim();
  return prompt ? prompt : null;
}

export function isWorkspaceDeltaQuestion(input: string): boolean {
  const lower = input.toLowerCase();
  return (
    /\b(?:which|what)\s+files?\b[\s\S]{0,80}\b(?:change|changed|edit|edited|modify|modified)\b/i.test(lower)
    || /\b(?:git status|workspace delta|repo delta)\b/i.test(lower)
  ) && /\b(?:repo|workspace|since my last message|right now|currently|current)\b/i.test(lower);
}

function inlineCode(value: string): string {
  return `\`${value.replace(/`/g, '\\`')}\``;
}

function evidenceLine(evidence: AttachedLiveContextEvidence): string {
  return `**Evidence:** ${inlineCode(evidence.source)}, captured ${inlineCode(evidence.capturedAt)}.`;
}

function isFreshEvidence(evidence: AttachedLiveContextEvidence, now: number): boolean {
  const capturedAt = Date.parse(evidence.capturedAt);
  if (!Number.isFinite(capturedAt)) return false;

  const ageMs = now - capturedAt;
  return ageMs >= -5_000 && ageMs <= LIVE_CONTEXT_MAX_AGE_MS;
}

/**
 * Incorporate a companion result only when the request asks for that exact
 * field and the evidence is fresh enough to represent current editor reality.
 */
export function tryEmitAttachedLiveContextResponse(
  input: string,
  evidence: AttachedLiveContextEvidence | undefined,
  now = Date.now(),
): string | null {
  if (!evidence || !isFreshEvidence(evidence, now)) return null;

  const lower = input.toLowerCase();
  const asksForTerminal = /\b(?:terminal|shell|console)\b/i.test(lower)
    && /\b(?:output|last line|current|right now|see|show|read)\b/i.test(lower);
  if (asksForTerminal && evidence.terminalOutput !== undefined) {
    const lines = evidence.terminalOutput.trimEnd().split(/\r?\n/);
    const lastLine = lines[lines.length - 1] ?? '';
    return [
      '**Live terminal output.**',
      inlineCode(lastLine),
      evidenceLine(evidence),
    ].join('\n\n');
  }

  const asksForSelection = /\b(?:selection|selected text|text is selected)\b/i.test(lower)
    && /\b(?:editor|file|current|right now|what|show|read|see)\b/i.test(lower);
  if (asksForSelection && evidence.selection !== undefined) {
    return [
      '**Live editor selection.**',
      inlineCode(evidence.selection),
      evidenceLine(evidence),
    ].join('\n\n');
  }

  const asksForEditorFile = /\b(?:open file|file is open|current file|file do i have open|file am i looking at|use the vs\s*code companion to tell me my open file)\b/i.test(lower);
  if (asksForEditorFile && evidence.openFile !== undefined) {
    return [
      '**Live editor file.**',
      inlineCode(evidence.openFile),
      evidenceLine(evidence),
    ].join('\n\n');
  }

  return null;
}

/**
 * Answer private live-state questions from attached evidence only. These must
 * run before memory, retrieval, or synthesis paths that can surface plausible
 * but stale content.
 */
export function tryEmitPrivateLiveContextResponse(input: string): string | null {
  const lower = input.toLowerCase();

  const asksForGrokProof = /\b(?:did|have)\s+(?:you|vai)\s+(?:actually\s+)?call\b[\s\S]{0,80}\bgrok\b/i.test(lower)
    && /\b(?:this turn|right now|timestamped|evidence|proof|actually)\b/i.test(lower);
  if (asksForGrokProof) {
    return [
      '**No.**',
      'I did not receive an attributed Grok friend-channel result in this turn, so I cannot claim that a Grok call completed.',
    ].join('\n\n');
  }

  const asksForAdapterProof = /\b(?:did|have)\s+(?:you|vai)\s+(?:actually\s+)?call\b[\s\S]{0,80}\b(?:vs\s*code|companion|capture|adapter)\b/i.test(lower)
    && /\b(?:this turn|right now|timestamped|evidence|proof|actually)\b/i.test(lower);
  if (asksForAdapterProof) {
    return [
      '**No.**',
      'I did not receive a timestamped VS Code companion capture result in this turn, so I cannot claim that a live adapter call completed.',
    ].join('\n\n');
  }

  const asksForTerminal = /\b(?:terminal|shell|console)\b/i.test(lower)
    && /\b(?:output|last line|current|right now|see|show|read)\b/i.test(lower);
  if (asksForTerminal) {
    return unavailable('terminal output', 'VS Code companion terminal', 'report the current terminal output');
  }

  const asksForSelection = /\b(?:selection|selected text|text is selected)\b/i.test(lower)
    && /\b(?:editor|file|current|right now|what|show|read|see)\b/i.test(lower);
  if (asksForSelection) {
    return unavailable('editor selection', 'VS Code companion editor-selection', 'report the selected text');
  }

  const explicitlyNamesChatWindow = /\b(?:current\s+)?chat window\b/i.test(lower);
  const asksForObservedScreen = /\bscreen\b/i.test(lower)
    && /\b(?:exact text|direct observation|right now|currently visible|what (?:do|can) you see)\b/i.test(lower);
  const asksForChatWindow = explicitlyNamesChatWindow || asksForObservedScreen;
  if (asksForChatWindow) {
    return unavailable('chat-window observation', 'desktop UI observation', 'report text visible in the current chat window');
  }

  if (isWorkspaceDeltaQuestion(input)) {
    return unavailable('workspace delta', 'workspace or git-status', 'report which files changed');
  }

  const asksForEditorFile = /\b(?:open file|file is open|current file|file do i have open|file am i looking at|use the vs\s*code companion to tell me my open file)\b/i.test(lower);
  if (asksForEditorFile) {
    return unavailable('editor file', 'VS Code companion active-editor', 'tell which file is open');
  }

  return null;
}

export function getRequestedLiveContextFields(input: string): LiveContextField[] {
  const lower = input.toLowerCase();
  const fields: LiveContextField[] = [];

  if (
    /\b(?:terminal|shell|console)\b/i.test(lower)
    && /\b(?:output|last line|current|right now|see|show|read)\b/i.test(lower)
  ) {
    fields.push('terminalOutput');
  }

  if (
    /\b(?:selection|selected text|text is selected)\b/i.test(lower)
    && /\b(?:editor|file|current|right now|what|show|read|see)\b/i.test(lower)
  ) {
    fields.push('selection');
  }

  if (/\b(?:open file|file is open|current file|file do i have open|file am i looking at|use the vs\s*code companion to tell me my open file)\b/i.test(lower)) {
    fields.push('openFile');
  }

  return fields;
}

/**
 * Keep capability audits judgeable: distinguish what this turn proves from
 * integrations that are merely planned or described.
 */
export function tryEmitBridgeCapabilityAudit(input: string): string | null {
  const lower = input.toLowerCase();
  const asksForEvidenceLedger = (
    /\bimplemented\b[\s\S]{0,40}\bend to end\b/i.test(lower)
    || /\bseparate\b[\s\S]{0,50}\bdemonstrated\b[\s\S]{0,50}\bplanned\b/i.test(lower)
    || /\bactually\s+do\b[\s\S]{0,80}\b(?:observed|demonstrated|planned|evidence)\b/i.test(lower)
  ) && /\b(?:vai|bridge|capabilit|adapter|companion|tools?|running app)\b/i.test(lower);
  if (!asksForEvidenceLedger) return null;

  return [
    '**Observed in this turn**',
    '- Vai received your message and returned this response through the chat path.',
    '',
    '**Not demonstrated in this turn**',
    '- A timestamped VS Code companion capture result.',
    '- A Grok friend-channel call with an attributed result.',
    '- Tool execution or robot control.',
    '',
    'I cannot claim additional bridge capabilities are implemented end to end from evidence attached to this turn. Planned integrations remain proposals until a real result is returned and attributed.',
  ].join('\n');
}
