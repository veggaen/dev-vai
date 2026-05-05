/**
 * ChatMetaRouter — deterministic handler for queries *about* the conversation
 * itself ("what was my first message", "summarize this chat", "how many
 * messages have I sent"). Bypasses TF-IDF / model dispatch entirely and
 * answers directly from persisted history.
 *
 * Returns `null` when the query is not a meta-intent so the caller falls
 * back to the normal dispatch chain.
 */

export interface MetaHistoryMessage {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
}

export interface ChatMetaResult {
  readonly reply: string;
  readonly intent:
    | 'first-user'
    | 'first-assistant'
    | 'last-user'
    | 'last-assistant'
    | 'message-count'
    | 'recap';
}

const FIRST_USER_RE =
  /\b(what|whats|what's|recall|remind\s+me)\b[^?]*\b(my|i|the)\s+(first|earliest|original|initial|opening|very\s+first)\s+(message|question|prompt|thing|input|ask|line|turn|entry)\b/i;
const FIRST_USER_ALT_RE =
  /\bwhat\s+did\s+i\s+(?:(first|originally|initially)\s+)?(say|ask|write|type|send)(?:\s+(first|originally|initially))?\b/i;
const FIRST_ASSISTANT_RE =
  /\b(what|whats|what's)\b[^?]*\b(your|you)\s+(first|earliest|original|initial|opening)\s+(message|response|reply|answer|output|line|turn)\b/i;
const FIRST_ASSISTANT_ALT_RE =
  /\bwhat\s+did\s+you\s+(?:(first|originally|initially)\s+)?(say|reply|respond|answer|tell\s+me)(?:\s+(first|originally|initially))?\b/i;

const LAST_USER_RE =
  /\bwhat\s+(did|do)\s+i\s+(just|last|previously|already)\s+(say|ask|write|tell\s+you|send|type)\b/i;
const LAST_USER_ALT_RE =
  /\b(my|the)\s+(last|previous|prior)\s+(message|question|prompt|input|ask|turn)\b/i;
const LAST_ASSISTANT_RE =
  /\bwhat\s+did\s+you\s+(just|last|previously|already)\s+(say|reply|respond|answer|tell\s+me|write)\b/i;
const LAST_ASSISTANT_ALT_RE =
  /\b(your|the)\s+(last|previous|prior)\s+(message|response|reply|answer|output|turn)\b/i;

const COUNT_RE =
  /\bhow\s+many\s+(messages|turns|exchanges|replies|questions)\b[^?]*\b(have|has|did|are|in|sent|exchanged)\b/i;
const COUNT_ALT_RE =
  /\b(message|turn|exchange)\s+count\b/i;

const RECAP_RE =
  /\b(summari[sz]e|recap|tldr|tl;dr|sum\s+up|summary\s+of|overview\s+of|catch\s+me\s+up\s+on)\b[^?]*\b(this|our|the)\s+(chat|conversation|thread|discussion|exchange|talk|session)\b/i;
const RECAP_ALT_RE =
  /\bwhat\s+(have|did)\s+we\s+(talked\s+about|discussed|covered|been\s+talking\s+about|been\s+discussing)\b/i;
// Paraphrased recall asks like "summarize what I told you at the start" or
// "remind me what I asked first" — treat as first-user recall.
const FIRST_USER_PARAPHRASE_RE =
  /\b(?:summari[sz]e|recap|repeat|tell\s+me|remind\s+me)\b[^?]*\bwhat\s+i\s+(?:told|said|wrote|asked|gave)\s+(?:you\s+)?(?:at|in|from|about|near)\s+(?:the\s+)?(?:start|beginning|opening|outset|top)\b/i;
const FIRST_USER_PARAPHRASE_ALT_RE =
  /\bwhat\s+i\s+(?:told|said|wrote|asked|gave)\s+(?:you\s+)?(?:at|in|from|about|near)\s+(?:the\s+)?(?:start|beginning|opening|outset)\b/i;

function quote(text: string, max = 280): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return `"${trimmed}"`;
  return `"${trimmed.slice(0, max).trimEnd()}…"`;
}

function firstUserMessage(history: readonly MetaHistoryMessage[]): MetaHistoryMessage | null {
  return history.find((m) => m.role === 'user') ?? null;
}

function firstAssistantMessage(history: readonly MetaHistoryMessage[]): MetaHistoryMessage | null {
  return history.find((m) => m.role === 'assistant') ?? null;
}

function lastUserMessageBeforeCurrent(history: readonly MetaHistoryMessage[]): MetaHistoryMessage | null {
  // Caller is expected to pass `history` *including* the just-persisted user turn
  // at the end. We skip it so "what did I just say" returns the previous turn.
  const userTurns = history.filter((m) => m.role === 'user');
  if (userTurns.length < 2) return null;
  return userTurns[userTurns.length - 2];
}

function lastAssistantMessage(history: readonly MetaHistoryMessage[]): MetaHistoryMessage | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') return history[i];
  }
  return null;
}

function buildRecap(history: readonly MetaHistoryMessage[]): string {
  const turns = history.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (turns.length === 0) return "We haven't exchanged any messages yet.";
  const userCount = turns.filter((t) => t.role === 'user').length;
  const assistantCount = turns.filter((t) => t.role === 'assistant').length;
  const userTurns = turns.filter((t) => t.role === 'user').slice(0, 5);
  const lines: string[] = [];
  lines.push(`So far this conversation has ${userCount} message${userCount === 1 ? '' : 's'} from you and ${assistantCount} from me.`);
  if (userTurns.length > 0) {
    lines.push('Topics you raised:');
    userTurns.forEach((t, idx) => {
      lines.push(`${idx + 1}. ${quote(t.content, 140).slice(1, -1)}`);
    });
  }
  return lines.join('\n');
}

export function tryHandleChatMeta(
  content: string,
  history: readonly MetaHistoryMessage[],
): ChatMetaResult | null {
  const text = content.trim();
  if (!text) return null;

  if (FIRST_USER_RE.test(text) || FIRST_USER_ALT_RE.test(text)
    || FIRST_USER_PARAPHRASE_RE.test(text) || FIRST_USER_PARAPHRASE_ALT_RE.test(text)) {
    const msg = firstUserMessage(history);
    if (!msg) return { reply: "You haven't sent any messages yet — this is your first turn.", intent: 'first-user' };
    return { reply: `Your first message in this chat was: ${quote(msg.content)}.`, intent: 'first-user' };
  }

  if (FIRST_ASSISTANT_RE.test(text) || FIRST_ASSISTANT_ALT_RE.test(text)) {
    const msg = firstAssistantMessage(history);
    if (!msg) return { reply: "I haven't replied to anything yet — this is the first turn.", intent: 'first-assistant' };
    return { reply: `My first reply in this chat was: ${quote(msg.content)}.`, intent: 'first-assistant' };
  }

  if (LAST_USER_RE.test(text) || LAST_USER_ALT_RE.test(text)) {
    const msg = lastUserMessageBeforeCurrent(history);
    if (!msg) return { reply: "This is the only message you've sent so far in this chat.", intent: 'last-user' };
    return { reply: `Your previous message was: ${quote(msg.content)}.`, intent: 'last-user' };
  }

  if (LAST_ASSISTANT_RE.test(text) || LAST_ASSISTANT_ALT_RE.test(text)) {
    const msg = lastAssistantMessage(history);
    if (!msg) return { reply: "I haven't said anything yet in this conversation — this would be my first reply.", intent: 'last-assistant' };
    return { reply: `My previous reply was: ${quote(msg.content)}.`, intent: 'last-assistant' };
  }

  if (COUNT_RE.test(text) || COUNT_ALT_RE.test(text)) {
    const userCount = history.filter((m) => m.role === 'user').length;
    const assistantCount = history.filter((m) => m.role === 'assistant').length;
    return {
      reply: `So far this chat has ${userCount} message${userCount === 1 ? '' : 's'} from you and ${assistantCount} from me (${userCount + assistantCount} total).`,
      intent: 'message-count',
    };
  }

  if (RECAP_RE.test(text) || RECAP_ALT_RE.test(text)) {
    return { reply: buildRecap(history), intent: 'recap' };
  }

  return null;
}
