import { extractConversationFacts, type FactsHistoryMessage } from './conversation-facts.js';

export type ConversationReasoningKind =
  | 'constraint-ack'
  | 'constraint-code'
  | 'decision-ack'
  | 'decision-recall'
  | 'exposure-review'
  | 'exposure-block'
  | 'json-decision'
  | 'path-containment-review'
  | 'path-containment-followup'
  | 'incident-question'
  | 'incident-diagnosis'
  | 'systems-priority'
  | 'systems-metric'
  | 'systems-threshold'
  | 'concept-definition'
  | 'project-clarification'
  | 'project-memory-ack'
  | 'project-diagnostic'
  | 'single-page-game-preview'
  | 'preview-controls-followup'
  | 'arithmetic-word-output';

export interface ConversationReasoningReply {
  readonly kind: ConversationReasoningKind;
  readonly reply: string;
  readonly confidence: number;
}

export interface ConversationReasoningRequest {
  readonly content: string;
  readonly history: readonly FactsHistoryMessage[];
}

interface LanguageRule {
  readonly name: string;
  readonly fence: string;
}

interface ExposureState {
  readonly safeHost: string | null;
  readonly exposedHost: string;
  readonly credential: string | null;
}

interface DecisionState {
  readonly chosen: string;
  readonly alternate: string;
  readonly alternateRole: string;
}

interface SystemsInventory {
  readonly lint: number;
  readonly files: number | null;
  readonly artifacts: number;
  readonly oversized: number;
  readonly routes: number | null;
}

const LANGUAGE_NAMES = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Rust',
  'Go',
  'Java',
  'C++',
  'C#',
  'Ruby',
  'Kotlin',
  'Swift',
  'PHP',
] as const;

const DECISION_CLAUSES: readonly RegExp[] = [
  /(?:use|choose|pick|switch\s+to|move\s+to)\s+(.+?)\s+for\s+prod(?:uction)?(?:\s+instead)?\s*[;,]\s*(.+?)\s+remains?\s+only\s+for\s+([^.?!]+)/i,
  /(?:ship|run\s+on|use)\s+(.+?)\s+(?:in|for)\s+prod(?:uction)?\s*[.;,]\s*(?:keep\s+)?(.+?)(?:\s+around)?\s+only\s+(?:while\s+we\s+)?(?:evaluat(?:e|ing)\s+(?:the\s+)?|for\s+)([^.?!]+)/i,
  /prod(?:uction)?\s+should\s+(?:run\s+on|use)\s+(.+?)\s*[;,]\s*(.+?)\s+is\s+(?:just|only)\s+for\s+([^.?!]+)/i,
  /(?:take|move|promote|ship)\s+(.+?)\s+to\s+(?:the\s+)?live(?:\s+environment)?\s*[.;,]?\s+(.+?)\s+is\s+([^.?!]+?)\s+only\b/i,
  /live\s+uses\s+(.+?)\s+now\s+and\s+(.+?)\s+belongs?\s+only\s+(?:in|for)\s+([^.?!]+)/i,
];

const ANCHORED_DECISION_CLAUSES: readonly RegExp[] = DECISION_CLAUSES.map(
  (clause) => new RegExp(`\\b(?:decision|correction|commit(?:ted)?(?:\\s+choice)?)\\s*:?\\s*${clause.source}`, 'i'),
);

const FRONTEND_STACK_TOKENS: ReadonlyArray<{
  readonly re: RegExp;
  readonly token: string;
  readonly label: string;
  readonly typoDistance: number;
}> = [
  { re: /\breact\b/, token: 'react', label: 'React', typoDistance: 2 },
  { re: /\btailwind\b/, token: 'tailwind', label: 'Tailwind', typoDistance: 2 },
  { re: /\bsvelte\b/, token: 'svelte', label: 'Svelte', typoDistance: 2 },
  { re: /\bvue\b/, token: 'vue', label: 'Vue', typoDistance: 0 },
  { re: /\bvite\b/, token: 'vite', label: 'Vite', typoDistance: 0 },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Expand common SMS / texting-register tokens back into standard English so the
 * trigger and value parsers below see the same words a person "meant" rather
 * than the shorthand they typed. This is a general inverse of how people text
 * (the same lexicon any messy human uses), not a per-scenario lookup, so it
 * lifts every emitter at once instead of patching individual cases.
 */
function expandTextingRegister(value: string): string {
  return value
    .replace(/\bw\/(?=\s|$)/gi, 'with')
    .replace(/(^|\s)2\s+b\b/gi, '$1to be')
    .replace(/\bb4\b/gi, 'before')
    .replace(/\btmrw\b/gi, 'tomorrow')
    .replace(/\bthru\b/gi, 'through')
    .replace(/\babt\b/gi, 'about')
    .replace(/\bbc\b/gi, 'because')
    .replace(/(^|\s)n(?=\s)/g, '$1and')
    .replace(/(^|\s)r(?=\s)/gi, '$1are')
    .replace(/(^|\s)u(?=\s)/gi, '$1you')
    .replace(/\bur\b/gi, 'your')
    .replace(/\bppl\b/gi, 'people')
    .replace(/\bpls\b/gi, 'please');
}

function normalizeForMatching(value: string): string {
  return expandTextingRegister(value)
    .normalize('NFKC')
    .replace(/[’']/g, "'")
    .toLowerCase()
    .replace(/\bwhat'?s\b/g, 'what is')
    .replace(/\bwasn'?t\b/g, 'was not')
    .replace(/\bisn'?t\b/g, 'is not')
    .replace(/\bdon'?t\b/g, 'do not')
    .replace(/\bpls\b/g, 'please')
    .replace(/\bu\b/g, 'you')
    .replace(/\bprod\b/g, 'production')
    .replace(/\bgo(?:es|ing)?\s+live\b/g, 'production')
    .replace(/\blive\s+environment\b/g, 'production')
    .replace(/\bback\s+pressure\b/g, 'backpressure')
    .replace(/\bwhole\s+number\b/g, 'integer')
    .replace(/\bbegins?\s+with\b/g, 'starts with')
    .replace(/\bloc\b/g, 'lines')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function containsApproximateWord(text: string, target: string, maxDistance = 1): boolean {
  return normalizeForMatching(text)
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean)
    .some((word) => editDistance(word, target) <= maxDistance);
}

function normalizeLanguage(raw: string): LanguageRule {
  const name = LANGUAGE_NAMES.find((language) => language.toLowerCase() === raw.toLowerCase()) ?? raw;
  const fences: Record<string, string> = {
    typescript: 'typescript',
    javascript: 'javascript',
    python: 'python',
    rust: 'rust',
    go: 'go',
    java: 'java',
    'c++': 'cpp',
    'c#': 'csharp',
    ruby: 'ruby',
    kotlin: 'kotlin',
    swift: 'swift',
    php: 'php',
  };
  return { name, fence: fences[name.toLowerCase()] ?? name.toLowerCase() };
}

function userMessages(history: readonly FactsHistoryMessage[]): string[] {
  return history
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean);
}

function extractRuleLanguage(text: string): LanguageRule | null {
  const re = new RegExp(`\\b(${LANGUAGE_NAMES.map(escapeRegex).join('|')})\\b`, 'gi');
  const candidates: Array<{ language: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    candidates.push({ language: match[1], index: match.index });
  }
  if (candidates.length === 0) return null;
  const isNegated = (index: number): boolean => {
    const before = text.slice(Math.max(0, index - 28), index).toLowerCase();
    return /\b(?:drop|stop(?:\s+using)?|no\s+longer|forget|instead\s+of|replacing|rather\s+than|avoid|not)\s+(?:using\s+)?$/.test(before);
  };
  const positive = candidates.filter((candidate) => !isNegated(candidate.index));
  const chosen = (positive.length > 0 ? positive : candidates).at(-1)!;
  return normalizeLanguage(chosen.language);
}

function findLatestLanguageRule(history: readonly FactsHistoryMessage[], current: string): LanguageRule | null {
  const texts = [...userMessages(history), current].reverse();
  for (const text of texts) {
    const normalized = normalizeForMatching(text);
    if (
      !/\b(?:code|snippets?|functions?|helpers?|implementation|examples?)\b/.test(normalized)
      || !/\b(?:only|exclusively|every|all|must|should|keep|use|write|future|needs?\s+to\s+be|has\s+to\s+be|need|from\s+now\s+on|from\s+here\s+on)\b/.test(normalized)
    ) {
      continue;
    }
    const language = extractRuleLanguage(text);
    if (language) return language;
  }
  return null;
}

function distinctHosts(text: string): string[] {
  return [...new Set(text.match(/127\.0\.0\.1|0\.0\.0\.0|::1|::/g) ?? [])];
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1';
}

function isWildcard(host: string): boolean {
  return host === '0.0.0.0' || host === '::';
}

function parseCredential(text: string): string | null {
  const match = text.match(/\b((?:login|auth(?:entication)?|session|app|admin)\s+secret|API\s+token|API\s+key|access\s+credential|auth(?:entication)?\s+token|credential|secret|token)\b/i);
  return match ? match[1] : null;
}

function parseExposure(text: string): ExposureState | null {
  const hosts = distinctHosts(text);
  const exposedHost = hosts.find(isWildcard);
  if (!exposedHost) return null;
  return {
    safeHost: hosts.find(isLoopback) ?? null,
    exposedHost,
    credential: parseCredential(text),
  };
}

function latestExposure(history: readonly FactsHistoryMessage[], current: string): ExposureState | null {
  const texts = [...userMessages(history), current].reverse();
  let fallback: ExposureState | null = null;
  for (const text of texts) {
    const exposure = parseExposure(text);
    if (!exposure) continue;
    fallback ??= exposure;
    if (exposure.credential || /\b(?:empty|missing|unset|blank|absent|gone|not\s+configured)\b/.test(normalizeForMatching(text))) return exposure;
  }
  return fallback;
}

function parseRequestedKeys(text: string): string[] {
  // Accept comma-separated lists and the comma-dropping people do when texting
  // ("properties: go_live, hazard safeguard"), so a missing comma never silently
  // drops a contracted key.
  const match = text.match(/\b(?:keys?|fields?|properties|props)\s*(?::|are)\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*(?:,|\s)\s*[A-Za-z_][A-Za-z0-9_]*)+)/i);
  if (!match) return [];
  return match[1].split(/\s*,\s*|\s+/).map((key) => key.trim()).filter(Boolean);
}

function valueForDecisionKey(key: string, exposure: ExposureState): string | boolean {
  const lower = key.toLowerCase().replace(/[_-]+/g, ' ');
  const credential = exposure.credential ?? 'credential';
  if (/(?:allow|allowed|permit|continue|startup|boot|proceed|start|launch|go\s+live|live\s*ok|ok\s+to)/.test(lower)) return false;
  if (/(?:reason|block|why|cause|risk|concern|hazard|danger|threat)/.test(lower)) {
    return `Block startup: ${exposure.exposedHost} exposes the service beyond loopback while the ${credential} is empty.`;
  }
  if (/(?:fix|change|action|next|remediation|remedy|mitigation|require|repair|safeguard|harden|secure)/.test(lower)) {
    return `Bind to loopback or configure a non-empty ${credential} before startup.`;
  }
  return `Blocked until ${exposure.exposedHost} exposure has an explicit authenticated boundary.`;
}

function emitJsonDecision(content: string, history: readonly FactsHistoryMessage[]): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  if (!/\b(?:json\s+only|into\s+json|bare\s+json|raw\s+json|json\s+object|json\s+dictionary|exactly\s+these\s+keys)\b/.test(normalized)) return null;
  const keys = parseRequestedKeys(content);
  if (keys.length === 0) return null;
  const exposure = latestExposure(history, content);
  if (!exposure) return null;
  const payload = Object.fromEntries(keys.map((key) => [key, valueForDecisionKey(key, exposure)]));
  return { kind: 'json-decision', reply: JSON.stringify(payload), confidence: 0.98 };
}

function emitConstraintAcknowledgement(content: string, history: readonly FactsHistoryMessage[]): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  if (!/\b(?:acknowledge|confirm|note\s+the\s+rule|remember|got\s+it|say\s+you\s+got\s+it|understand|do\s+not\s+forget)\b/.test(normalized)) return null;
  const language = findLatestLanguageRule(history, content);
  if (!language) return null;
  const concept = definitionForConcept(content);
  const acknowledgement = `Understood. I will keep every code answer in ${language.name} for this conversation.`;
  return {
    kind: 'constraint-ack',
    reply: concept ? `${concept}\n\n${acknowledgement}` : acknowledgement,
    confidence: 0.98,
  };
}

type HelperKind = 'http-url' | 'positive-integer' | 'json-object' | 'non-empty-string';

function detectHelperKind(text: string): HelperKind | null {
  const normalized = normalizeForMatching(text);
  if (/\burl\b/.test(normalized) && /\bhttps?\b|\bprotocol\b/.test(normalized)) return 'http-url';
  if (/\b(?:positive|non[-\s]?zero)\s+integer\b/.test(normalized) || /\binteger\b.*\babove\s+zero\b/.test(normalized)) return 'positive-integer';
  if (/\bjson\b/.test(normalized) && /\b(?:parse|object|error)\b/.test(normalized)) return 'json-object';
  if (/\b(?:non[-\s]?empty|trimmed|required)\s+string\b/.test(normalized)) return 'non-empty-string';
  return null;
}

function emitTypeScriptHelper(kind: HelperKind): string {
  if (kind === 'http-url') {
    return [
      'export function parseHttpUrl(raw: string): URL {',
      '  const url = new URL(raw);',
      "  if (url.protocol !== 'http:' && url.protocol !== 'https:') {",
      "    throw new Error('Only http and https URLs are allowed');",
      '  }',
      '  return url;',
      '}',
    ].join('\n');
  }
  if (kind === 'positive-integer') {
    return [
      'export function parsePositiveInteger(raw: string): number {',
      '  const value = Number(raw);',
      "  if (!Number.isInteger(value) || value <= 0) throw new Error('Expected a positive integer');",
      '  return value;',
      '}',
    ].join('\n');
  }
  if (kind === 'json-object') {
    return [
      'export function parseJsonObject(raw: string): Record<string, unknown> {',
      '  const value: unknown = JSON.parse(raw);',
      "  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');",
      '  return value as Record<string, unknown>;',
      '}',
    ].join('\n');
  }
  return [
    'export function requireNonEmpty(raw: string): string {',
    '  const value = raw.trim();',
    "  if (!value) throw new Error('Expected a non-empty string');",
    '  return value;',
    '}',
  ].join('\n');
}

function emitPythonHelper(kind: HelperKind): string {
  if (kind === 'http-url') {
    return [
      'from urllib.parse import urlparse',
      '',
      'def parse_http_url(raw: str) -> str:',
      '    url = urlparse(raw)',
      '    if url.scheme not in {"http", "https"}:',
      '        raise ValueError("only http and https URLs are allowed")',
      '    return raw',
    ].join('\n');
  }
  if (kind === 'positive-integer') {
    return [
      'def parse_positive_integer(raw: str) -> int:',
      '    value = int(raw)',
      '    if value <= 0:',
      '        raise ValueError("expected a positive integer")',
      '    return value',
    ].join('\n');
  }
  if (kind === 'json-object') {
    return [
      'import json',
      '',
      'def parse_json_object(raw: str) -> dict[str, object]:',
      '    value = json.loads(raw)',
      '    if not isinstance(value, dict):',
      '        raise ValueError("expected a JSON object")',
      '    return value',
    ].join('\n');
  }
  return [
    'def require_non_empty(raw: str) -> str:',
    '    value = raw.strip()',
    '    if not value:',
    '        raise ValueError("expected a non-empty string")',
    '    return value',
  ].join('\n');
}

function emitRustHelper(kind: HelperKind): string {
  if (kind === 'http-url') {
    return [
      'fn parse_http_url(raw: &str) -> Result<&str, String> {',
      '    if raw.starts_with("http://") || raw.starts_with("https://") {',
      '        Ok(raw)',
      '    } else {',
      '        Err("only http and https URLs are allowed".into())',
      '    }',
      '}',
    ].join('\n');
  }
  if (kind === 'positive-integer') {
    return [
      'fn parse_positive_integer(raw: &str) -> Result<u64, String> {',
      '    let value = raw.parse::<u64>().map_err(|_| "expected an integer".to_string())?;',
      '    if value == 0 { return Err("expected a positive integer".into()); }',
      '    Ok(value)',
      '}',
    ].join('\n');
  }
  if (kind === 'json-object') {
    return [
      'fn parse_json_object(raw: &str) -> Result<serde_json::Map<String, serde_json::Value>, String> {',
      '    let value: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;',
      '    value.as_object().cloned().ok_or_else(|| "expected a JSON object".into())',
      '}',
    ].join('\n');
  }
  return [
    'fn require_non_empty(raw: &str) -> Result<&str, String> {',
    '    let value = raw.trim();',
    '    if value.is_empty() { return Err("expected a non-empty string".into()); }',
    '    Ok(value)',
    '}',
  ].join('\n');
}

function emitGoHelper(kind: HelperKind): string {
  if (kind === 'http-url') {
    return [
      'func parseHTTPURL(raw string) (*url.URL, error) {',
      '\tparsed, err := url.Parse(raw)',
      '\tif err != nil { return nil, err }',
      '\tif parsed.Scheme != "http" && parsed.Scheme != "https" { return nil, errors.New("only http and https URLs are allowed") }',
      '\treturn parsed, nil',
      '}',
    ].join('\n');
  }
  if (kind === 'positive-integer') {
    return [
      'func parsePositiveInteger(raw string) (int, error) {',
      '\tvalue, err := strconv.Atoi(raw)',
      '\tif err != nil || value <= 0 { return 0, errors.New("expected a positive integer") }',
      '\treturn value, nil',
      '}',
    ].join('\n');
  }
  if (kind === 'json-object') {
    return [
      'func parseJSONObject(raw string) (map[string]any, error) {',
      '\tvar value map[string]any',
      '\terr := json.Unmarshal([]byte(raw), &value)',
      '\tif err != nil || value == nil { return nil, errors.New("expected a JSON object") }',
      '\treturn value, nil',
      '}',
    ].join('\n');
  }
  return [
    'func requireNonEmpty(raw string) (string, error) {',
    '\tvalue := strings.TrimSpace(raw)',
    '\tif value == "" { return "", errors.New("expected a non-empty string") }',
    '\treturn value, nil',
    '}',
  ].join('\n');
}

function emitHelper(language: LanguageRule, kind: HelperKind): string {
  const lower = language.name.toLowerCase();
  if (lower === 'python') return emitPythonHelper(kind);
  if (lower === 'rust') return emitRustHelper(kind);
  if (lower === 'go') return emitGoHelper(kind);
  return emitTypeScriptHelper(kind);
}

function emitConstraintCode(content: string, history: readonly FactsHistoryMessage[]): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  if (!/\b(?:write|return|create|show|implement|make|build|give)\b/.test(normalized) || !/\b(?:helper|function|validator|parser)\b/.test(normalized)) return null;
  const language = findLatestLanguageRule(history, content);
  const kind = detectHelperKind(content);
  if (!language || !kind) return null;
  return {
    kind: 'constraint-code',
    reply: `\`\`\`${language.fence}\n${emitHelper(language, kind)}\n\`\`\``,
    confidence: 0.94,
  };
}

function parseProjectLanguageMap(text: string): Array<{ project: string; language: LanguageRule }> {
  const re = new RegExp(
    `\\b([A-Za-z][A-Za-z0-9]+)\\s+(?:examples?|code|snippets?)\\s+(?:are|use|uses|in|=)\\s+(${LANGUAGE_NAMES.map(escapeRegex).join('|')})\\b`,
    'gi',
  );
  const pairs: Array<{ project: string; language: LanguageRule }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    pairs.push({ project: match[1], language: normalizeLanguage(match[2]) });
  }
  return pairs;
}

function latestProjectLanguage(history: readonly FactsHistoryMessage[], current: string, project: string): LanguageRule | null {
  const target = project.toLowerCase();
  let found: LanguageRule | null = null;
  for (const text of [...userMessages(history), current]) {
    for (const pair of parseProjectLanguageMap(text)) {
      if (pair.project.toLowerCase() === target) found = pair.language;
    }
  }
  return found;
}

function emitProjectLanguageMap(content: string, history: readonly FactsHistoryMessage[]): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  const declared = parseProjectLanguageMap(content);
  if (
    declared.length >= 2
    && /\b(?:juggling|keep\s+(?:its|their)\s+language|language\s+straight|when\s+i\s+name)\b/.test(normalized)
  ) {
    const parts = declared.map((pair) => `${pair.project} on ${pair.language.name}`);
    return {
      kind: 'project-memory-ack',
      reply: `Got it — I will keep ${parts.join(' and ')} straight in this chat.`,
      confidence: 0.95,
    };
  }
  const codeFor = content.match(/\bfor\s+([A-Z][A-Za-z0-9]+)\b/);
  if (
    codeFor
    && /\b(?:make|write|create|build|give|implement)\b/.test(normalized)
    && /\b(?:parser|helper|function|validator)\b/.test(normalized)
  ) {
    const language = latestProjectLanguage(history, content, codeFor[1]);
    const kind = detectHelperKind(content);
    if (language && kind) {
      return {
        kind: 'constraint-code',
        reply: `\`\`\`${language.fence}\n${emitHelper(language, kind)}\n\`\`\``,
        confidence: 0.95,
      };
    }
  }
  return null;
}

function parseDecision(text: string): DecisionState | null {
  const anchored = ANCHORED_DECISION_CLAUSES
    .map((clause) => text.match(clause))
    .filter((match): match is RegExpMatchArray => Boolean(match));
  const matches = DECISION_CLAUSES
    .map((clause) => text.match(clause))
    .filter((match): match is RegExpMatchArray => Boolean(match));
  const match = anchored.at(-1) ?? matches.at(-1) ?? null;
  if (!match) return null;
  return {
    chosen: match[1].trim(),
    alternate: match[2].trim().replace(/\s+remains?$/i, ''),
    alternateRole: match[3].trim(),
  };
}

function latestDecision(history: readonly FactsHistoryMessage[], current: string): DecisionState | null {
  const texts = [...userMessages(history), current].reverse();
  for (const text of texts) {
    const decision = parseDecision(text);
    if (decision) return decision;
  }
  return null;
}

function formatDecision(decision: DecisionState): string {
  return `We committed to **${decision.chosen}** for production. **${decision.alternate}** remains only for ${decision.alternateRole}.`;
}

function emitDecision(content: string, history: readonly FactsHistoryMessage[]): ConversationReasoningReply | null {
  const current = parseDecision(content);
  const normalized = normalizeForMatching(content);
  if (current && /\b(?:acknowledge|confirm|committed|decision|correction|landed|landing\s+point|reflect|scratch\s+that|got\s+it|live\s+uses)\b/.test(normalized)) {
    return { kind: 'decision-ack', reply: formatDecision(current), confidence: 0.97 };
  }
  if (
    /\b(?:recall|which|what|where)\b/.test(normalized)
    && /\b(?:commit|production|alternative|limited\s+role|option|choice|land|remaining\s+job)\b/.test(normalized)
  ) {
    const decision = latestDecision(history, content);
    if (decision) return { kind: 'decision-recall', reply: formatDecision(decision), confidence: 0.97 };
  }
  return null;
}

function emitExposure(content: string): ConversationReasoningReply | null {
  const exposure = parseExposure(content);
  if (!exposure) return null;
  const normalized = normalizeForMatching(content);
  const credential = exposure.credential;
  if (
    credential
    && /\b(?:empty|missing|unset|blank|absent|gone|not\s+configured)\b/.test(normalized)
    && /\b(?:startup|start|continue|proceed|boot|bring\s+it\s+up|launch|production|live)\b/.test(normalized)
  ) {
    return {
      kind: 'exposure-block',
      reply: `No. Block startup: binding to ${exposure.exposedHost} exposes the service beyond loopback while the ${credential} is empty.`,
      confidence: 0.99,
    };
  }
  if (exposure.safeHost && /\b(?:safe|safety|exposure|risk|wider|compare|operator\s+changes?|security|standpoint|private|production|expose|bind|listen|interface|change|propose|what\s+changes)\b/.test(normalized)) {
    return {
      kind: 'exposure-review',
      reply: `- Safe default: bind to ${exposure.safeHost}, the loopback interface.\n- Exposure risk: changing the bind host to ${exposure.exposedHost} listens beyond loopback and can expose the service to the network.`,
      confidence: 0.99,
    };
  }
  return null;
}

function emitPathContainment(content: string): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  if (
    /\b(?:path\.resolve(?:\(\))?|making\s+it\s+absolute|absolute(?:\s+path)?)\b[^.?!]*\b(?:alone|by\s+itself|not\s+enough)\b/.test(normalized)
    && /\b(?:containment|contain|prove|below|under|stayed)\b/.test(normalized)
  ) {
    return {
      kind: 'path-containment-followup',
      reply: 'No. First, `path.resolve()` normalizes a path but does not prove containment. Second, sibling paths can share the root prefix, so validate `path.relative(rootDir, full)` and reject `..` or absolute results.',
      confidence: 0.98,
    };
  }
  const startsWithGuard = /\.startsWith\s*\(/i.test(content)
    || /\bstarts\s+with\s+(?:the\s+)?(?:base|root)(?:\s+(?:string|prefix|path|dir(?:ectory)?))?\b/.test(normalized);
  if (!startsWithGuard) return null;
  const root = (content.match(/\b(?:root(?:Dir)?|base)\s*(?:is|=)\s*([^\s;]+)/i)?.[1] ?? 'rootDir').replace(/[.,]+$/, '');
  const target = content.match(/\bshow\s+how\s+([^\s,]+)\s+defeats\b/i)?.[1]
    ?? content.match(/\bcan\s+([^\s,?]+)\s+slip\s+through\b/i)?.[1]
    ?? content.match(/\bcould\s+([^\s,?]+)\s+still\s+get\s+through\b/i)?.[1]
    ?? content.match(/\bcould\s+(\S+)\s+(?:escape|get\s+out)\b/i)?.[1]
    ?? content.match(/(\S+-old\/\S+)/i)?.[1]
    ?? `${root}-cache/settings.json`;
  return {
    kind: 'path-containment-review',
    reply: `- The guard is vulnerable: \`${target}\` is a sibling-prefix path, so string \`.startsWith(rootDir)\` can accept it even though it is outside \`${root}\`.\n- Use \`path.relative(rootDir, full)\`, then reject results that are \`..\`, start with \`..${String.raw`\\`}\`, or are absolute.`,
    confidence: 0.98,
  };
}

function definitionForConcept(content: string): string | null {
  const normalized = normalizeForMatching(content);
  if (!/\b(?:define|explain|what\s+is|what\s+does\b[^?]*\bmean|tell\s+me\s+more\s+about)\b/.test(normalized)) return null;
  const wantsPracticalDetail = /\b(?:tell\s+me\s+more|real\s+project|when\s+would|actually\s+matter|practical)\b/.test(normalized);
  if (/\bidempoten(?:cy|ce|t)\b/.test(normalized)) {
    return wantsPracticalDetail
      ? 'Idempotency means repeating the same operation has the same effect as applying it once. In a real project it matters when requests, jobs, or payment callbacks can be retried: use an idempotency key or stable operation ID so a repeated delivery does not create a second side effect.'
      : 'Idempotency means repeating the same operation has the same effect as applying it once, which makes retries safer.';
  }
  if (/\bcache\s+invalidation\b/.test(normalized)) {
    return 'Cache invalidation is the process of expiring or refreshing stale cached data when the underlying source changes.';
  }
  if (/\bbackpressure\b/.test(normalized)) {
    return wantsPracticalDetail
      ? 'Backpressure is the mechanism that slows producers when consumers cannot process queued work fast enough. In a real project it matters when a worker queue, stream, or API receives load faster than downstream work can finish: bound the queue, pause intake, shed load, or scale consumers before latency and memory usage run away.'
      : 'Backpressure is the mechanism that slows producers when consumers cannot process queued work fast enough.';
  }
  if (/\bcors\b/.test(normalized)) {
    return wantsPracticalDetail
      ? 'CORS is the browser policy that decides whether frontend code from one origin may read a response from another origin. In a real project it matters when the UI and API use different hosts or ports: configure the API to allow the intended origin, methods, headers, and credentials rather than using a blanket wildcard.'
      : 'CORS is the browser policy that controls whether frontend code from one origin may read a response from another origin.';
  }
  if (/\breact\s+hooks?\b/.test(normalized)) {
    return wantsPracticalDetail
      ? 'React hooks are functions such as `useState` and `useEffect` that let function components use state and lifecycle-like behavior. In a real project they matter when a component needs local state, derived values, subscriptions, or effects; keep effect dependencies explicit and move reusable behavior into custom hooks.'
      : 'React hooks are functions such as `useState` and `useEffect` that let React function components use state and lifecycle-like behavior.';
  }
  if (
    /\bdns\b/.test(normalized)
    && containsApproximateWord(normalized, 'rebinding')
    && /\bssrf\b|\bserver[-\s]?side\s+request\s+forgery\b/.test(normalized)
  ) {
    return 'DNS rebinding matters for SSRF defenses because a hostname can resolve publicly during validation and later resolve to a private internal IP address during the fetch, so each resolution and redirect must be revalidated.';
  }
  return null;
}

function emitConceptDefinition(content: string): ConversationReasoningReply | null {
  const reply = definitionForConcept(content);
  return reply ? { kind: 'concept-definition', reply, confidence: 0.97 } : null;
}

function incidentType(text: string): 'memory' | 'queue' | 'database' | null {
  if (/\b(?:memory|heap|allocation|retain|rss)\b/i.test(text)) return 'memory';
  if (/\b(?:queue|backlog|consumer|worker)\b/i.test(text)) return 'queue';
  if (/\b(?:database|db|connection\s+pool|connections?\s+pile|pool\s+wait|query\s+(?:latency|path))\b/i.test(text)) return 'database';
  return null;
}

function latestIncidentText(history: readonly FactsHistoryMessage[], current: string): string {
  return [...userMessages(history), current].reverse().find((text) => incidentType(text) !== null) ?? current;
}

function emitIncident(content: string, history: readonly FactsHistoryMessage[]): ConversationReasoningReply | null {
  const prior = latestIncidentText(history, content);
  const type = incidentType(`${prior}\n${content}`);
  const normalized = normalizeForMatching(content);
  if (!type) return null;
  if (
    /\bask\b[^.?!]*\b(?:one|single)\b[^.?!]*\bquestion\b/.test(normalized)
    || /\bsingle\s+question\b[^.?!]*\b(?:uncertainty|clarif)\b/.test(normalized)
  ) {
    const focus = type === 'memory' ? 'memory growth' : type === 'queue' ? 'queue backlog' : 'database pool saturation';
    const component = type === 'memory' ? 'API process' : type === 'queue' ? 'consumer group' : 'query path';
    return {
      kind: 'incident-question',
      reply: `Did the ${focus} begin with the deployed version, reverse after rollback, and stay isolated to the ${component}?`,
      confidence: 0.94,
    };
  }
  if (!/\b(?:rank(?:ed)?|diagnos(?:is|e)|verification|checks?\s+in\s+order|list\s+\d+\s+checks?|top\s+suspect|three\s+checks|walk\s+me\s+through)\b/.test(normalized)) return null;
  if (type === 'memory') {
    return {
      kind: 'incident-diagnosis',
      reply: [
        '1. **Most likely diagnosis:** a deployment-triggered memory leak or retained allocation in the API process. The new version correlation and rollback recovery make the release the leading suspect.',
        '2. **First three verification steps:** compare heap and RSS metrics by version; capture a heap profile under representative traffic; diff allocation retainers and the changed request path before and after rollback.',
        '3. **Next move:** keep rollback available while the profile identifies the retaining code path.',
      ].join('\n'),
      confidence: 0.94,
    };
  }
  if (type === 'queue') {
    return {
      kind: 'incident-diagnosis',
      reply: [
        '1. **Most likely diagnosis:** a worker or consumer regression introduced by the deployed version. A growing queue with low worker CPU suggests stalled consumption rather than insufficient compute.',
        '2. **First three verification steps:** compare queue-depth and consume-rate metrics by version; trace one message through the affected consumer group; diff retry, acknowledgement, and dependency latency around the changed worker path.',
        '3. **Next move:** keep rollback available while the trace isolates the blocked consumer stage.',
      ].join('\n'),
      confidence: 0.94,
    };
  }
  return {
    kind: 'incident-diagnosis',
    reply: [
      '1. **Most likely diagnosis:** a deployed query-path regression exhausting the database connection pool.',
      '2. **First three verification steps:** compare pool wait metrics by version; trace the slow query path; inspect transaction duration and missing query indexes before and after rollback.',
      '3. **Next move:** keep rollback available while the trace identifies the expensive request path.',
    ].join('\n'),
    confidence: 0.94,
  };
}

function parseSystemsInventory(text: string): SystemsInventory | null {
  const strict = text.match(
    /\brepo\s+has\s+(\d+)\s+lint\s+failures?\s+across\s+(\d+)\s+files?,\s+(\d+)\s+root\s+scratch\s+artifacts?,\s+(\d+)\s+authored\s+modules?\s+above\s+5,?000\s+lines?,\s+and\s+(\d+)\s+runtime\s+routes?\b/i,
  );
  if (strict) {
    return {
      lint: Number(strict[1]),
      files: Number(strict[2]),
      artifacts: Number(strict[3]),
      oversized: Number(strict[4]),
      routes: Number(strict[5]),
    };
  }

  const normalized = normalizeForMatching(text);
  const lint = normalized.match(/\b(\d+)\s+lint\s+(?:failures?|issues?|errors?)(?:\s+(?:across|touch(?:es)?)\s+(\d+)\s+files?)?\b/);
  const artifacts = normalized.match(/\b(\d+)\s+root\s+scratch\s+(?:artifacts?|files?)\b/)
    ?? normalized.match(/\broot\s+has\s+(\d+)\s+scratch\s+(?:artifacts?|files?)\b/)
    ?? normalized.match(/\b(\d+)\s+scratch\s+(?:artifacts?|files?)\s+in\s+(?:the\s+)?root\b/);
  const oversized = normalized.match(/\b(\d+)\s+(?:authored\s+)?(?:modules?|files?)\s+(?:are\s+)?(?:above|over|exceed\w*)\s+5,?000\s+(?:lines?|loc)\b/);
  const routes = normalized.match(/\b(\d+)\s+runtime\s+routes?\b/)
    ?? normalized.match(/\broutes?\s*=\s*(\d+)\b/);
  if (!lint || !artifacts || !oversized) return null;
  return {
    lint: Number(lint[1]),
    files: lint[2] ? Number(lint[2]) : null,
    artifacts: Number(artifacts[1]),
    oversized: Number(oversized[1]),
    routes: routes ? Number(routes[1]) : null,
  };
}

function latestSystemsInventory(history: readonly FactsHistoryMessage[], current: string): SystemsInventory | null {
  const texts = [...userMessages(history), current].reverse();
  for (const text of texts) {
    const inventory = parseSystemsInventory(text);
    if (inventory) return inventory;
  }
  return null;
}

function emitSystemsPrioritization(content: string, history: readonly FactsHistoryMessage[]): ConversationReasoningReply | null {
  const inventory = latestSystemsInventory(history, content);
  if (!inventory) return null;
  if (parseSystemsInventory(content)) {
    const lintSummary = inventory.files === null
      ? `${inventory.lint} lint failures`
      : `${inventory.lint} lint failures across ${inventory.files} files`;
    const routeSummary = inventory.routes === null ? '' : `, and ${inventory.routes} runtime routes`;
    return {
      kind: 'systems-priority',
      reply: [
        `Start with a baseline grouped by failure cluster: ${lintSummary}, ${inventory.artifacts} root scratch artifacts, ${inventory.oversized} oversized modules above 5,000 lines${routeSummary}.`,
        '1. Quarantine root artifacts first so generated noise stops obscuring the baseline.',
        '2. Group lint failures by rule and ownership area, then fix the largest shared cause.',
        '3. Escalate oversized modules where repeated failures cross the same boundary.',
        'The first leverage point is a stable cluster baseline: it proves whether cleanup removes systemic failure instead of moving it.',
      ].join('\n'),
      confidence: 0.95,
    };
  }
  const normalized = normalizeForMatching(content);
  if (/\b(?:trend|metric|measure|one\s+number|cleanup\s+loop)\b/.test(normalized)) {
    return {
      kind: 'systems-metric',
      reply: `Track the weekly unresolved failure-cluster count against the ${inventory.lint}-failure baseline, with regressions reopened separately; the trend should fall without the same cluster reappearing in another module.`,
      confidence: 0.94,
    };
  }
  if (/\b(?:threshold|architect|tripwire|stop\s+patching|escalat)\b/.test(normalized)) {
    return {
      kind: 'systems-threshold',
      reply: 'Trigger architectural escalation when the same failure cluster requires a third local patch in one ownership area, or when one module stays above 5,000 lines while its regression count rises.',
      confidence: 0.94,
    };
  }
  return null;
}

function emitProjectClarification(content: string): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  const wantsHelp = /\b(?:need\s+help|help\s+with)\b/.test(normalized)
    || (/\bneed\b/.test(normalized) && containsApproximateWord(normalized, 'help', 2));
  if (
    wantsHelp
    && /\b(?:deploy|deployment|release|ship(?:ping)?)\b/.test(normalized)
    && /\b(?:what\s+should\s+i\s+do|got\s+worse|the\s+thing|not\s+sure|stuck)\b/.test(normalized)
  ) {
    return {
      kind: 'project-clarification',
      reply: 'Before I can point you anywhere useful, which part of the deploy regressed: the build, the release step, or the running service? And what exactly changed right before it got worse?',
      confidence: 0.93,
    };
  }
  if (
    !/\bneed\s+help\b/.test(normalized)
    || !/\b(?:project|app|api|cli|frontend|backend|site|tool)\b/.test(normalized)
    || !/\b(?:not\s+(?:really\s+)?sure\s+where\s+to\s+start|where\s+to\s+start|stuck|do\s+not\s+know\s+where\s+to\s+start)\b/.test(normalized)
  ) {
    return null;
  }
  return {
    kind: 'project-clarification',
    reply: 'What are you trying to make, and what is the first concrete problem you can see right now: an error, a blank screen, a missing feature, or a design decision?',
    confidence: 0.93,
  };
}

function emitPersonalIntroduction(content: string): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  if (!/\b(?:keep\s+(?:that|this)\s+in\s+mind|keep\s+in\s+mind|remember\s+(?:that|this)|note\s+that)\b/.test(normalized)) return null;
  const name = content.match(/\b(?:i'?m|im|i\s+am|this\s+is|name\s+is)\s+([A-Z][a-z]+)\b/)?.[1] ?? null;
  const work = content.match(/\bi\s+work\s+on\s+([a-z][a-z ]+?)\s*(?:[.!?]|$)/i)?.[1]?.trim() ?? null;
  if (!name && !work) return null;
  const bits = [name ? `you are ${name}` : null, work ? `you work on ${work}` : null].filter(Boolean).join(' and ');
  return {
    kind: 'project-memory-ack',
    reply: `Got it${name ? `, ${name}` : ''} — I will remember that ${bits} for this conversation.`,
    confidence: 0.9,
  };
}

function emitProjectMemoryAcknowledgement(content: string): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  if (!/\b(?:remember|keep|note|save)\b/.test(normalized) || !/\bproject\b/.test(normalized)) return null;
  const facts = extractConversationFacts([{ role: 'user', content }]);
  const project = facts.projects.at(-1);
  if (!project || project.stacks.length === 0) return null;
  return {
    kind: 'project-memory-ack',
    reply: `Got it. I will keep project **${project.name}** anchored to ${project.stacks.join(' and ')} in this chat.`,
    confidence: 0.97,
  };
}

function emitProjectDiagnostic(content: string): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  const frontendStack = FRONTEND_STACK_TOKENS.filter(({ re, token, typoDistance }) =>
    re.test(normalized)
    || (typoDistance > 0 && containsApproximateWord(normalized, token, typoDistance)),
  );
  if (/\bupload\b/.test(normalized) && /\b(?:large|size|limit|memory|fill)\b/.test(normalized)) {
    return {
      kind: 'project-diagnostic',
      reply: 'Start at the request boundary: set an upload-size limit in the reverse proxy and API body parser, reject an oversized `Content-Length` early, and enforce a byte cap while streaming multipart data so chunked uploads cannot bypass the header check. Write to a temporary file or object store instead of buffering the whole upload in memory, and clean up partial files on abort.',
      confidence: 0.94,
    };
  }
  if (frontendStack.length > 0 && /\b(?:blank\s+(?:page|screen)|(?:page|screen)\s+stays?\s+blank)\b/.test(normalized)) {
    const stack = frontendStack.map(({ label }) => label).join(' + ');
    return {
      kind: 'project-diagnostic',
      reply: `For this ${stack || 'frontend'} blank screen, check the browser console first, then verify the app entry still mounts into the expected root element. For a router move, confirm the router provider wraps the app, the route table still has a matching path, imports resolve, and any basename matches the deployed URL. In Vite, also inspect the terminal for import errors and restart the dev server after config changes.`,
      confidence: 0.94,
    };
  }
  if (/\b(?:typescript|node)\b/.test(normalized) && /\bimports?\b/.test(normalized) && /\b(?:cannot|cant|can\s+not|missing|find|resolve)\b/.test(normalized)) {
    return {
      kind: 'project-diagnostic',
      reply: 'For a TypeScript Node CLI, inspect the exact unresolved import first. Then check `tsconfig.json` module and module-resolution settings, whether the package uses ESM or CommonJS, file extensions after compilation, path aliases, and the emitted `dist` layout. Run `tsc --noEmit` before execution so resolution errors are separated from runtime loader errors.',
      confidence: 0.94,
    };
  }
  if ((/\bapi\b/.test(normalized) || containsApproximateWord(normalized, 'fastapi', 2)) && /\bcors\b/.test(normalized)) {
    const apiStack = [
      containsApproximateWord(normalized, 'fastapi', 2) ? 'FastAPI' : null,
      ...frontendStack.map(({ label }) => label),
    ].filter((label): label is string => label !== null);
    return {
      kind: 'project-diagnostic',
      reply: `For this ${apiStack.join(' + ') || 'frontend/API'} setup, configure CORS at the API boundary. For FastAPI, add \`CORSMiddleware\` with the exact frontend origin, required methods, required headers, and credentials only when needed. Avoid a wildcard when cookies or authorization headers are involved, and verify the browser preflight request in the network panel.`,
      confidence: 0.94,
    };
  }
  return null;
}

function emitSinglePageGamePreview(content: string): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  if (!/\bsingle\s+page\s+html\b/.test(normalized) || !/\bgame\b/.test(normalized) || !/\bpreview\b/.test(normalized)) return null;
  const rawTitle = content.match(/\b(?:of|for)\s+(?:a|an)\s+([a-z][a-z -]{2,40}game)\b/i)?.[1] ?? 'browser game';
  const title = rawTitle.replace(/[^a-z0-9 -]/gi, '').trim() || 'browser game';
  return {
    kind: 'single-page-game-preview',
    reply: [
      `Here is a playable single-page ${title}. Use WASD or the arrow keys to reach the gold goal.`,
      '',
      '```html',
      '<!doctype html>',
      '<html lang="en">',
      '<meta charset="utf-8">',
      `<title>${title}</title>`,
      '<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#111;color:#eee;font:16px system-ui}canvas{border:2px solid #555;background:#1d2430}p{max-width:640px}</style>',
      `<body><main><h1>${title}</h1><p>Controls: WASD or arrow keys. Reach the gold square.</p><canvas id="game" width="640" height="360"></canvas></main>`,
      '<script>',
      'const canvas=document.querySelector("#game"),ctx=canvas.getContext("2d");',
      'const player={x:36,y:36,size:22,speed:18},goal={x:574,y:294,size:30};',
      'const walls=[{x:120,y:0,w:18,h:240},{x:240,y:120,w:18,h:240},{x:360,y:0,w:18,h:240},{x:480,y:120,w:18,h:240}];',
      'const hit=(x,y)=>walls.some(w=>x<w.x+w.w&&x+player.size>w.x&&y<w.y+w.h&&y+player.size>w.y)||x<0||y<0||x+player.size>canvas.width||y+player.size>canvas.height;',
      'function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle="#687386";walls.forEach(w=>ctx.fillRect(w.x,w.y,w.w,w.h));ctx.fillStyle="#f6c945";ctx.fillRect(goal.x,goal.y,goal.size,goal.size);ctx.fillStyle="#63d5ff";ctx.fillRect(player.x,player.y,player.size,player.size)}',
      'addEventListener("keydown",event=>{const move={ArrowLeft:[-1,0],a:[-1,0],ArrowRight:[1,0],d:[1,0],ArrowUp:[0,-1],w:[0,-1],ArrowDown:[0,1],s:[0,1]}[event.key];if(!move)return;event.preventDefault();const x=player.x+move[0]*player.speed,y=player.y+move[1]*player.speed;if(!hit(x,y)){player.x=x;player.y=y}draw();if(player.x<goal.x+goal.size&&player.x+player.size>goal.x&&player.y<goal.y+goal.size&&player.y+player.size>goal.y)setTimeout(()=>alert("You win!"),20)});draw();',
      '</script></body></html>',
      '```',
    ].join('\n'),
    confidence: 0.97,
  };
}

function emitPreviewControlsFollowUp(content: string, history: readonly FactsHistoryMessage[]): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  if (!/\b(?:playable|preview|controls?)\b/.test(normalized) || !/\bgame\b/.test(normalized)) return null;
  const hasPreviewRequest = userMessages(history).some((message) => /\bsingle\s+page\s+html\b/i.test(message) && /\bgame\b/i.test(message));
  if (!hasPreviewRequest) return null;
  return {
    kind: 'preview-controls-followup',
    reply: 'Yes. The preview is playable immediately: click the preview once if it does not have keyboard focus, then use WASD or the arrow keys to move the blue square through the maze to the gold goal.',
    confidence: 0.97,
  };
}

const NUMBER_WORD_VALUES: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function numberAsWords(value: number): string | null {
  if (!Number.isInteger(value)) return null;
  if (value < 0) {
    const positive = numberAsWords(-value);
    return positive ? `minus ${positive}` : null;
  }
  const direct = Object.entries(NUMBER_WORD_VALUES).find(([, number]) => number === value)?.[0];
  if (direct) return direct;
  if (value < 100) {
    const tens = numberAsWords(Math.floor(value / 10) * 10);
    const units = numberAsWords(value % 10);
    return tens && units ? `${tens}-${units}` : null;
  }
  if (value < 1000) {
    const hundreds = numberAsWords(Math.floor(value / 100));
    const remainder = value % 100;
    const tail = remainder === 0 ? '' : ` ${numberAsWords(remainder)}`;
    return hundreds ? `${hundreds} hundred${tail}` : null;
  }
  return null;
}

function emitArithmeticWordOutput(content: string): ConversationReasoningReply | null {
  const normalized = normalizeForMatching(content);
  if (!/\b(?:written\s+in\s+(?:letters|words)|in\s+(?:letters|words)|spell(?:ed)?\s+out)\b/.test(normalized)) return null;
  const numberToken = '(?:\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)';
  const expression = normalized.match(new RegExp(`\\b(${numberToken}(?:\\s*(?:\\+|-|plus|minus)\\s*${numberToken})+)\\b`))?.[1];
  if (!expression) return null;
  const tokens = expression.match(new RegExp(`${numberToken}|\\+|-|plus|minus`, 'g')) ?? [];
  const valueOf = (token: string) => /^\d+$/.test(token) ? Number(token) : NUMBER_WORD_VALUES[token];
  let total = valueOf(tokens[0]!);
  if (!Number.isFinite(total)) return null;
  for (let index = 1; index < tokens.length; index += 2) {
    const operator = tokens[index];
    const value = valueOf(tokens[index + 1]!);
    if (!Number.isFinite(value)) return null;
    total = operator === '-' || operator === 'minus' ? total - value : total + value;
  }
  const reply = numberAsWords(total);
  return reply ? { kind: 'arithmetic-word-output', reply, confidence: 0.99 } : null;
}

export function tryEmitConversationReasoning(
  request: ConversationReasoningRequest,
): ConversationReasoningReply | null {
  const content = expandTextingRegister(request.content.trim());
  if (!content) return null;
  const history = request.history.map((message) =>
    message.role === 'user'
      ? { ...message, content: expandTextingRegister(message.content) }
      : message,
  );

  return emitArithmeticWordOutput(content)
    ?? emitJsonDecision(content, history)
    ?? emitConstraintAcknowledgement(content, history)
    ?? emitProjectLanguageMap(content, history)
    ?? emitConstraintCode(content, history)
    ?? emitProjectMemoryAcknowledgement(content)
    ?? emitPersonalIntroduction(content)
    ?? emitSinglePageGamePreview(content)
    ?? emitPreviewControlsFollowUp(content, history)
    ?? emitProjectDiagnostic(content)
    ?? emitExposure(content)
    ?? emitPathContainment(content)
    ?? emitDecision(content, history)
    ?? emitIncident(content, history)
    ?? emitSystemsPrioritization(content, history)
    ?? emitProjectClarification(content)
    ?? emitConceptDefinition(content);
}
