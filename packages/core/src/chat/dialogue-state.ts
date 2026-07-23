import type { Message } from '../models/adapter.js';
import { isCapabilitiesFallbackResponse } from './capabilities-fallback.js';

/**
 * Vai-owned relational dialogue state.
 *
 * This is deliberately reconstructed from the persisted transcript on every
 * turn. It gives Vai a typed, inspectable account of who is speaking, who they
 * mention, what each entity believes, and what the group is trying to achieve.
 * A model may receive the state as context, but it never owns or invents it.
 */

export type DialogueEntityKind = 'human' | 'ai' | 'intelligence' | 'organization' | 'unknown';

export interface DialogueRelationship {
  readonly kind: 'works-with' | 'collaborates-with';
  readonly target: string;
}

export interface DialogueParticipant {
  readonly name: string;
  readonly kind: DialogueEntityKind;
  readonly description: string | null;
  readonly values: readonly string[];
  readonly relationships: readonly DialogueRelationship[];
  readonly firstSeenUserTurn: number;
}

export interface AttributedDialogueClaim {
  readonly speaker: string;
  readonly text: string;
  readonly kind: 'concern' | 'goal';
  readonly shared: boolean;
  readonly userTurn: number;
}

export interface DialogueState {
  readonly currentSpeaker: string | null;
  readonly participants: readonly DialogueParticipant[];
  readonly concerns: readonly AttributedDialogueClaim[];
  readonly goals: readonly AttributedDialogueClaim[];
  readonly collectiveReferent: readonly string[];
}

export interface DialogueImprovementCandidate {
  readonly missingCapability: string;
  readonly realIntent: string;
  readonly methodLesson: string;
}

export interface DialogueReflection {
  readonly status: 'gap' | 'healthy' | 'insufficient-evidence';
  readonly evidence: readonly string[];
  readonly improvement: DialogueImprovementCandidate | null;
}

export interface DialogueTurnResult {
  readonly kind: 'introduction' | 'recall' | 'reflection';
  readonly reply: string;
  readonly confidence: number;
  readonly improvement?: DialogueImprovementCandidate;
}

interface MutableParticipant {
  name: string;
  kind: DialogueEntityKind;
  description: string | null;
  values: string[];
  relationships: DialogueRelationship[];
  firstSeenUserTurn: number;
}

const NON_NAMES = new Set([
  'A', 'An', 'Asking', 'Back', 'Confused', 'Fine', 'Good', 'Here', 'Just', 'Not',
  'Okay', 'Stuck', 'Sure', 'The', 'There', 'This', 'Trying', 'Unsure', 'Well',
]);

const TOKEN_STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'being', 'could', 'from',
  'have', 'into', 'just', 'make', 'more', 'really', 'said', 'should', 'still',
  'that', 'their', 'them', 'then', 'there', 'these', 'they', 'thing', 'think',
  'this', 'those', 'what', 'when', 'where', 'which', 'with', 'would', 'your',
]);

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function cleanClause(raw: string | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/^[,:;\s-]+|[,:;\s-]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bofc\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeVaiPerspective(raw: string | undefined): string {
  return cleanClause(raw)
    .replace(/^you\b/i, 'Vai')
    .replace(/\bmaking you\b/i, 'making Vai')
    .replace(/\bmake you\b/i, 'make Vai')
    .replace(/^Vai\s+(still\s+)?do\s+not\b/i, 'Vai $1does not');
}

function inferEntityKind(name: string, description: string): DialogueEntityKind {
  if (/^vai$/i.test(name)) return 'intelligence';
  if (/\b(?:ai|artificial intelligence|model|agent|assistant)\b/i.test(description)) return 'ai';
  if (/\b(?:company|organization|team|studio|institution)\b/i.test(description)) return 'organization';
  if (/^v3gga$/i.test(name) || /\b(?:human|person|owner|developer|engineer)\b/i.test(description)) return 'human';
  return 'unknown';
}

function validName(raw: string | undefined): string | null {
  const name = cleanClause(raw);
  if (!name || name.length > 32 || NON_NAMES.has(name)) return null;
  return /^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(name) ? name : null;
}

function extractIntroduction(content: string): { name: string; description: string } | null {
  const match = content.match(
    /\b(?:I am|I'm|i am|i'm|im|this is|This is|my name is|My name is|call me|Call me)\s+([A-Z][A-Za-z0-9_-]{1,31})\b(?:\s*,\s*(?:an?\s+)?([^.!?\n]{2,120}))?/,
  );
  const name = validName(match?.[1]);
  if (!name) return null;
  const description = cleanClause(match?.[2])
    .replace(/\s+(?:working|collaborating|partnering)\s+with\s+[A-Z][A-Za-z0-9_-]{1,31}\s*$/i, '')
    .trim();
  return { name, description };
}

function splitValues(raw: string): string[] {
  return unique(
    cleanClause(raw)
      .replace(/,?\s+and\s+/gi, ',')
      .split(',')
      .map((value) => normalizeVaiPerspective(value)),
  ).filter((value) => value.length >= 3);
}

function ensureParticipant(
  participants: Map<string, MutableParticipant>,
  name: string,
  userTurn: number,
  description = '',
): MutableParticipant {
  const key = name.toLowerCase();
  const existing = participants.get(key);
  if (existing) {
    if (!existing.description && description) existing.description = description;
    if (existing.kind === 'unknown') existing.kind = inferEntityKind(name, description);
    return existing;
  }
  const created: MutableParticipant = {
    name,
    kind: inferEntityKind(name, description),
    description: description || null,
    values: [],
    relationships: [],
    firstSeenUserTurn: userTurn,
  };
  participants.set(key, created);
  return created;
}

function pushClaim(
  target: AttributedDialogueClaim[],
  claim: AttributedDialogueClaim,
): void {
  const duplicate = target.some((existing) => (
    existing.speaker.toLowerCase() === claim.speaker.toLowerCase()
    && existing.text.toLowerCase() === claim.text.toLowerCase()
    && existing.kind === claim.kind
  ));
  if (!duplicate) target.push(claim);
}

function relationshipTargets(participant: MutableParticipant): string[] {
  return participant.relationships.map((relationship) => relationship.target);
}

export function extractDialogueState(history: readonly Message[]): DialogueState {
  const participants = new Map<string, MutableParticipant>();
  ensureParticipant(participants, 'Vai', 0, 'deterministic computer intelligence');
  const concerns: AttributedDialogueClaim[] = [];
  const goals: AttributedDialogueClaim[] = [];
  let currentSpeaker: string | null = null;
  let userTurn = 0;

  for (const message of history) {
    if (message.role !== 'user' || !message.content.trim()) continue;
    userTurn += 1;
    const content = message.content.trim();
    const introduction = extractIntroduction(content);
    if (introduction) {
      currentSpeaker = introduction.name;
      ensureParticipant(participants, introduction.name, userTurn, introduction.description);
    }
    const speaker = currentSpeaker ?? 'the user';
    const speakerProfile = currentSpeaker
      ? ensureParticipant(participants, currentSpeaker, userTurn, introduction?.description ?? '')
      : null;

    const relationPattern = /\b(?:working|collaborating|partnering)\s+with\s+([A-Z][A-Za-z0-9_-]{1,31})\b/g;
    for (const relation of content.matchAll(relationPattern)) {
      const target = validName(relation[1]);
      if (!target || !speakerProfile) continue;
      ensureParticipant(participants, target, userTurn);
      const kind = /collaborating|partnering/i.test(relation[0]) ? 'collaborates-with' : 'works-with';
      if (!speakerProfile.relationships.some((item) => item.kind === kind && item.target.toLowerCase() === target.toLowerCase())) {
        speakerProfile.relationships.push({ kind, target });
      }
    }

    const valuesMatch = content.match(/\bI\s+(?:care\s+about|value|prefer)\s+([^.!?\n]+)/i);
    if (valuesMatch && speakerProfile) {
      speakerProfile.values.push(...splitValues(valuesMatch[1]));
      speakerProfile.values = unique(speakerProfile.values);
    }

    const attributedPattern = /\b([A-Z][A-Za-z0-9_-]{1,31})\s+(?:says?|thinks?|feels?|believes?|worries?)\s+(?:that\s+)?([^.!?\n]+)/g;
    let attributedConcernFound = false;
    for (const attributed of content.matchAll(attributedPattern)) {
      const attributedSpeaker = validName(attributed[1]);
      const text = normalizeVaiPerspective(attributed[2]);
      if (!attributedSpeaker || text.length < 4) continue;
      // "what does V3gga think is wrong?" asks for an existing claim; it does
      // not assert the fragment "is wrong" as a new belief by V3gga.
      if (/^(?:is|are|was|were|what|which|who|why|how)\b/i.test(text)) continue;
      attributedConcernFound = true;
      ensureParticipant(participants, attributedSpeaker, userTurn);
      pushClaim(concerns, {
        speaker: attributedSpeaker,
        text,
        kind: 'concern',
        shared: false,
        userTurn,
      });
    }

    const directConcern = content.match(
      /\b(?:I\s+(?:think|feel)\s+(?:like\s+)?)?(you|Vai)\s+(still\s+)?(?:can'?t|cannot|do\s+not|don'?t|fail(?:s)?\s+to|aren'?t|are\s+not)\s+([^.!?\n]+)/i,
    );
    if (directConcern && !attributedConcernFound) {
      const simpler = normalizeVaiPerspective(directConcern[0].replace(/^I\s+(?:think|feel)\s+(?:like\s+)?/i, ''));
      pushClaim(concerns, {
        speaker,
        text: simpler,
        kind: 'concern',
        shared: false,
        userTurn,
      });
    }

    const goalPatterns: readonly RegExp[] = [
      /\b(?:the\s+)?goal\s+(?:we\s+share\s+)?is\s+(?:ofc\s+)?(?:to\s+)?([^.!?\n]+)/i,
      /\bour\s+(?:shared\s+)?goal\s+is\s+(?:to\s+)?([^.!?\n]+)/i,
      /\bwe\s+(?:want|aim|need)\s+to\s+([^.!?\n]+)/i,
    ];
    for (const pattern of goalPatterns) {
      const goal = content.match(pattern);
      const text = normalizeVaiPerspective(goal?.[1]);
      if (!text || text.length < 4) continue;
      pushClaim(goals, { speaker, text, kind: 'goal', shared: true, userTurn });
      break;
    }
    if (/\b(?:less|reduce|reducing)\b[^.!?\n]{0,80}\b(?:(?:third|3(?:rd|th))[- ]party|external)\b[^.!?\n]{0,40}\b(?:models?|members?)\b/i.test(content)) {
      const dependence = content.match(/\b(?:make|making|so)\s+(?:you|Vai)\s+([^.!?\n]+)/i)?.[0]
        ?? content.match(/\bVai\s+can\s+([^.!?\n]+)/i)?.[0];
      const text = normalizeVaiPerspective(dependence);
      if (text) pushClaim(goals, { speaker, text, kind: 'goal', shared: true, userTurn });
    }
  }

  const currentProfile = currentSpeaker ? participants.get(currentSpeaker.toLowerCase()) : undefined;
  const collective = unique([
    ...(currentSpeaker ? [currentSpeaker] : []),
    ...(currentProfile ? relationshipTargets(currentProfile) : []),
    ...concerns.map((claim) => claim.speaker),
    'Vai',
  ]).filter((name) => name !== 'the user').slice(0, 6);

  return Object.freeze({
    currentSpeaker,
    participants: Object.freeze([...participants.values()].map((participant) => Object.freeze({
      ...participant,
      values: Object.freeze(unique(participant.values)),
      relationships: Object.freeze([...participant.relationships]),
    }))),
    concerns: Object.freeze(concerns),
    goals: Object.freeze(goals),
    collectiveReferent: Object.freeze(collective),
  });
}

function meaningfulTokens(text: string): Set<string> {
  return new Set(text.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !TOKEN_STOP_WORDS.has(token)));
}

function lastCompletedExchange(
  history: readonly Message[],
): { user: Message; assistant: Message } | null {
  let assistantIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === 'assistant' && history[index].content.trim()) {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex < 0) return null;
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (history[index].role === 'user' && history[index].content.trim()) {
      return { user: history[index], assistant: history[assistantIndex] };
    }
  }
  return null;
}

export function reflectOnDialogue(history: readonly Message[]): DialogueReflection {
  const exchange = lastCompletedExchange(history);
  if (!exchange) return { status: 'insufficient-evidence', evidence: [], improvement: null };

  const evidence: string[] = [];
  const userText = exchange.user.content;
  const assistantText = exchange.assistant.content;
  const exchangeState = extractDialogueState([exchange.user]);
  const namedParticipants = exchangeState.participants
    .map((participant) => participant.name)
    .filter((name) => name !== 'Vai');
  const missedNames = namedParticipants.filter((name) => !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(assistantText));

  if (isCapabilitiesFallbackResponse(assistantText) || /\bwhat i can do\b/i.test(assistantText)) {
    evidence.push('The reply fell back to a generic capability menu instead of continuing the relationship in the transcript.');
  }
  if (missedNames.length > 0) {
    evidence.push(`The reply did not acknowledge named participant${missedNames.length === 1 ? '' : 's'}: ${missedNames.join(', ')}.`);
  }

  const userTokens = meaningfulTokens(userText);
  const answerTokens = meaningfulTokens(assistantText);
  const overlap = [...userTokens].filter((token) => answerTokens.has(token));
  if (userTokens.size >= 6 && overlap.length / userTokens.size < 0.12) {
    evidence.push('The reply had very low topical overlap with the completed user turn.');
  }

  if (evidence.length === 0) {
    return {
      status: 'healthy',
      evidence: [namedParticipants.length > 0
        ? 'The last completed reply retained the named participants and stayed on the user turn\'s topic.'
        : 'The last completed reply stayed on the user turn\'s topic and did not fall back to unrelated capabilities.'],
      improvement: null,
    };
  }

  const missedEntityState = missedNames.length > 0;
  const fallbackState = evidence.some((item) => /generic capability menu/i.test(item));
  return {
    status: 'gap',
    evidence,
    improvement: fallbackState
      ? {
          missingCapability: 'dialogue-state recall before generic capability fallback',
          realIntent: 'continue a relationship-aware conversation using the persisted transcript',
          methodLesson: 'Reconstruct speakers, attributed beliefs, shared goals, and unresolved asks before any generic fallback can answer.',
        }
      : missedEntityState
        ? {
            missingCapability: 'participant-aware response planning for named entities',
            realIntent: 'respond to each named participant and preserve who said what',
            methodLesson: 'Verify that a relational reply covers the current speaker and every attributed speaker before release.',
          }
        : {
            missingCapability: 'turn-to-response relevance verification',
            realIntent: 'keep the reply grounded in the completed conversational turn',
            methodLesson: 'Measure salient-topic overlap before release and prefer an honest clarification over an unrelated answer.',
          },
  };
}

function isDialogueRecall(content: string): boolean {
  return /\bwhat\s+do\s+you\s+(?:remember|understand|know)\s+about\s+(?:me|us|who\s+i\s+am)\b/i.test(content)
    || /\b(?:remind|recall)\s+(?:me\s+)?(?:who\s+i\s+am|my\s+identity)\b/i.test(content)
    || /\bwhen\s+i\s+(?:say|said)\s+["']?(?:us|we)["']?/i.test(content)
    || /\bwhich\s+(?:people|participants|entities)\b[^?\n]{0,80}\b(?:we|us)\b/i.test(content)
    || /\bwhat\s+.+goal\s+(?:we|i)\s+share\b/i.test(content)
    || /\bwho\s+am\s+i\b/i.test(content) && /\b(?:remember|conversation|chat|whose|who\s+(?:made|said|owns?))\b/i.test(content)
    || /\b(?:which|what)\s+(?:agent|person|participant|entity)\s+am\s+i\b/i.test(content)
    || /\bwhose\s+(?:concern|claim|belief|idea|view|worry)\s+(?:was|is)\s+(?:that|it)\b/i.test(content)
    || /\b(?:who\s+(?:made|said|owns?)|which\s+(?:collaborator|partner|participant)\s+owns?|owner\s+of)\b[^?\n]{0,80}\b(?:concern|claim|belief|idea|view|worry)\b/i.test(content);
}

function isDialogueIntroduction(content: string): boolean {
  return extractIntroduction(content) !== null
    && /\b(?:what\s+do\s+you\s+make|what\s+would\s+you\s+want|what\s+did\s+i\s+just\s+tell|understand\s+about\s+(?:me|us)|before\s+we|hold\s+a\s+conversation|talk\s+to|speak\s+to|keep\s+(?:that|the)\s+attribution|keep\s+(?:the\s+)?owner|preserve\s+(?:who\s+said|the\s+owner)|who\s+said\s+what|whose\s+(?:concern|claim)|attribution\s+straight)\b/i.test(content);
}

function isDialogueReflectionRequest(content: string, history: readonly Message[]): boolean {
  if (!history.some((message) => message.role === 'assistant' && message.content.trim())) return false;
  return /\bwhat\s+(?:did|can|should)\s+you\s+(?:learn|improve|do\s+better)\b[^?]*\b(?:conversation|chat|talk)\b/i.test(content)
    || /\bwhat\s+did\s+you\s+learn\s+from\s+(?:the\s+)?(?:last|previous|that)\s+(?:exchange|turn|reply|answer)\b/i.test(content)
    || /\b(?:identify|find|review|explain)\b[^?\n]{0,120}\b(?:conversational\s+)?(?:failure|mistake|gap|wrong|off-topic)\b[^?\n]{0,120}\b(?:answer|reply|exchange|turn)\b/i.test(content)
    || /\b(?:guarded\s+)?improvement\s+queue\b/i.test(content)
    || /\bafter\s+(?:we(?:'ve|\s+have)?\s+)?(?:spoke|spoken|talked|talking|this\s+conversation)\b/i.test(content)
    || /\b(?:better|improve)\s+Vai\s+again\b/i.test(content);
}

function renderRecall(state: DialogueState, content: string): string {
  const speaker = state.currentSpeaker
    ? state.participants.find((participant) => participant.name === state.currentSpeaker)
    : null;
  const lines: string[] = ['Here is the conversational state I can ground from this chat:'];
  if (speaker) {
    const relations = speaker.relationships.length > 0
      ? `; ${speaker.relationships.map((relationship) => `${relationship.kind === 'works-with' ? 'working' : 'collaborating'} with ${relationship.target}`).join(', ')}`
      : '';
    lines.push(`- **You:** ${speaker.name}${speaker.description ? ` - ${speaker.description}` : ''}${relations}.`);
    if (speaker.values.length > 0) lines.push(`- **What you value:** ${speaker.values.join('; ')}.`);
  }
  for (const concern of state.concerns.slice(-3)) {
    lines.push(`- **${concern.speaker}'s concern:** ${concern.text}.`);
  }
  for (const goal of state.goals.slice(-2)) {
    lines.push(`- **Shared direction:** ${goal.text}.`);
  }
  if (/\b(?:us|we|our)\b/i.test(content) && state.collectiveReferent.length > 0) {
    lines.push(`- **"Us" / "we":** I resolve that to ${state.collectiveReferent.join(', ')} in this conversation.`);
  }
  if (lines.length === 1) {
    lines.push('- I do not yet have a named speaker or attributed viewpoint to recall honestly.');
  }
  return lines.join('\n');
}

function renderIntroduction(state: DialogueState): string {
  const speaker = state.currentSpeaker
    ? state.participants.find((participant) => participant.name === state.currentSpeaker)
    : null;
  const concern = state.concerns.at(-1);
  const goal = state.goals.at(-1);
  const relationship = speaker && speaker.relationships.length > 0
    ? `, ${speaker.relationships.map((item) => `${item.kind === 'works-with' ? 'working' : 'collaborating'} with ${item.target}`).join(', ')}`
    : '';
  const opening = speaker
    ? `I understand you as **${speaker.name}**${speaker.description ? `, ${speaker.description}` : ''}${relationship}.`
    : 'I understand that a new participant is speaking with me.';
  const concernLine = concern
    ? `I hear **${concern.speaker}'s concern** as: ${concern.text}.`
    : 'I hear the concern as a failure of conversational continuity, not merely a wording problem.';
  const goalLine = goal
    ? `The shared direction I can ground is: ${goal.text}.`
    : 'The shared direction is for Vai to own more of the understanding and decision path itself.';
  const combined = `${concern?.text ?? ''} ${goal?.text ?? ''}`;
  const question = /\b(?:conversation|speak|talk|context|remember)\b/i.test(combined)
    ? 'Which failure costs you most in a real turn: forgetting who said what, replying generically, or failing to ask the next useful question?'
    : /\b(?:third[- ]party|external|models?|members?)\b/i.test(combined)
      ? 'Which capability should Vai own end-to-end first so outside models become optional critics rather than necessary answerers?'
      : 'What is the single conversational behavior you most want me to prove in the next turn?';
  return [opening, concernLine, goalLine, `What I want to understand next is concrete: ${question}`].join('\n\n');
}

function renderLearnedState(state: DialogueState): string | null {
  const speaker = state.currentSpeaker
    ? state.participants.find((participant) => participant.name === state.currentSpeaker)
    : null;
  const parts = [
    speaker ? `${speaker.name}${speaker.description ? ` is ${speaker.description}` : ' is the current speaker'}` : null,
    state.concerns.at(-1) ? `${state.concerns.at(-1)!.speaker}'s concern is that ${state.concerns.at(-1)!.text}` : null,
    state.goals.at(-1) ? `the shared direction is ${state.goals.at(-1)!.text}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `${parts.join('; ')}.` : null;
}

function renderReflection(reflection: DialogueReflection, state: DialogueState): string {
  const learned = renderLearnedState(state);
  const learnedLines = learned ? [`**What I learned:** ${learned}`, ''] : [];
  if (reflection.status === 'healthy') {
    return [
      ...learnedLines,
      'I reviewed the last completed exchange and did not find a proven conversational failure to queue.',
      '',
      `Evidence: ${reflection.evidence[0]}`,
      '',
      'The honest next move is another adversarial follow-up, not inventing an improvement just to look self-aware.',
    ].join('\n');
  }
  if (reflection.status === 'insufficient-evidence' || !reflection.improvement) {
    return [
      ...learnedLines,
      'I do not have a completed user-and-Vai exchange to evaluate yet. I need to answer once before I can claim evidence of what should improve.',
    ].join('\n');
  }
  return [
    ...learnedLines,
    'I found a concrete gap in the last completed exchange.',
    '',
    ...reflection.evidence.map((item) => `- ${item}`),
    '',
    `**Vai-owned improvement candidate:** ${reflection.improvement.missingCapability}.`,
    `**Method:** ${reflection.improvement.methodLesson}`,
    '',
    'This is a bounded candidate for the guarded self-improvement queue; it is not permission to edit code without tests and verification.',
  ].join('\n');
}

export function tryHandleDialogueTurn(input: {
  readonly content: string;
  readonly history: readonly Message[];
}): DialogueTurnResult | null {
  const content = input.content.trim();
  if (!content) return null;
  const state = extractDialogueState(input.history);
  if (isDialogueReflectionRequest(content, input.history)) {
    const reflection = reflectOnDialogue(input.history);
    return {
      kind: 'reflection',
      reply: renderReflection(reflection, state),
      confidence: reflection.status === 'insufficient-evidence' ? 0.85 : 0.98,
      ...(reflection.improvement ? { improvement: reflection.improvement } : {}),
    };
  }
  if (isDialogueRecall(content)) {
    return { kind: 'recall', reply: renderRecall(state, content), confidence: 0.99 };
  }
  if (isDialogueIntroduction(content)) {
    return { kind: 'introduction', reply: renderIntroduction(state), confidence: 0.97 };
  }
  return null;
}

/**
 * Compact state for optional model arms. This never asks a model to infer who
 * said what; it hands the model Vai's already-derived state and strict rules.
 */
export function buildDialogueSystemPrelude(history: readonly Message[]): string | null {
  const state = extractDialogueState(history);
  const nonVaiParticipants = state.participants.filter((participant) => participant.name !== 'Vai');
  if (nonVaiParticipants.length === 0 && state.concerns.length === 0 && state.goals.length === 0) return null;

  const lines = [
    'Vai-owned relational dialogue state, reconstructed from this transcript:',
    ...(state.currentSpeaker ? [`- Current speaker: ${state.currentSpeaker}`] : []),
    ...nonVaiParticipants.map((participant) => {
      const relation = participant.relationships.length > 0
        ? `; relationships: ${participant.relationships.map((item) => `${item.kind} ${item.target}`).join(', ')}`
        : '';
      const values = participant.values.length > 0 ? `; values: ${participant.values.join(', ')}` : '';
      return `- Participant: ${participant.name} (${participant.kind})${participant.description ? `; ${participant.description}` : ''}${relation}${values}`;
    }),
    ...state.concerns.slice(-4).map((claim) => `- ${claim.speaker} says/feels: ${claim.text}`),
    ...state.goals.slice(-3).map((claim) => `- Shared goal stated by ${claim.speaker}: ${claim.text}`),
    ...(state.collectiveReferent.length > 0 ? [`- Current we/us cluster: ${state.collectiveReferent.join(', ')}`] : []),
    'Rules: keep each claim attributed to its speaker; do not merge people or AIs into one voice; answer the latest relational ask before offering generic capabilities; say when a referent is ambiguous.',
  ];
  return lines.join('\n');
}
