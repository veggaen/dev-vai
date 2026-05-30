export type BuilderPreviewQualityVerdict = 'pass' | 'warn' | 'fail';

export interface BuilderPreviewQualityInput {
  readonly prompt: string;
  readonly renderedText: string;
  readonly sourceText?: string;
  readonly cssText?: string;
}

export interface BuilderPreviewQualityRequirement {
  readonly kind: 'text' | 'style' | 'motion' | 'content' | 'interaction';
  readonly label: string;
  readonly expected: string;
  readonly matched: boolean;
}

export interface BuilderPreviewQualityReport {
  readonly verdict: BuilderPreviewQualityVerdict;
  readonly score: number;
  readonly matched: readonly BuilderPreviewQualityRequirement[];
  readonly missing: readonly BuilderPreviewQualityRequirement[];
  readonly requirements: readonly BuilderPreviewQualityRequirement[];
}

function cleanRequirementText(value: string): string {
  return value
    .replace(/[`"'.,!?;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesLoose(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function extractRequiredTexts(prompt: string): Array<{ label: string; expected: string }> {
  const requirements: Array<{ label: string; expected: string }> = [];

  for (const match of prompt.matchAll(/\b(?:exact\s+)?heading\s+([A-Z][A-Za-z0-9][A-Za-z0-9 &+\-]{1,72}?)(?=,|\.| plus\b| and\b| with\b|$)/g)) {
    requirements.push({ label: 'heading', expected: cleanRequirementText(match[1] ?? '') });
  }

  for (const match of prompt.matchAll(/\bCTA(?:\s+button)?\s+(?:labeled|labelled|called|named)\s+([A-Z][A-Za-z0-9][A-Za-z0-9 &+\-]{1,48}?)(?=,|\.| and\b| with\b|$)/gi)) {
    requirements.push({ label: 'cta', expected: cleanRequirementText(match[1] ?? '') });
  }

  for (const match of prompt.matchAll(/\bsections?\s+labeled\s+([A-Z][A-Za-z0-9 &+\-]{1,48})\s+and\s+([A-Z][A-Za-z0-9 &+\-]{1,48})(?=,|\.| with\b|$)/gi)) {
    requirements.push({ label: 'section', expected: cleanRequirementText(match[1] ?? '') });
    requirements.push({ label: 'section', expected: cleanRequirementText(match[2] ?? '') });
  }

  return requirements.filter((requirement) => requirement.expected.length > 1);
}

function extractHexRequirements(prompt: string): Array<{ label: string; expected: string }> {
  return [...prompt.matchAll(/#[0-9a-f]{6}\b/gi)].map((match) => ({
    label: 'hex color',
    expected: match[0].toLowerCase(),
  }));
}

const FORBIDDEN_TEMPLATE_LANGUAGE = [
  /\blorem ipsum\b/i,
  /\bitem\s+\d+\b/i,
  /\bcard title\b/i,
  /\bmock(?:ed)? data\b/i,
  /\bdemo shell\b/i,
  /\bbuilder target\b/i,
  /\btemplate app\b/i,
  /\bplaceholder\b/i,
];

function isAppLikePrompt(prompt: string): boolean {
  return /\b(app|dashboard|tool|tracker|editor|shop|store|booking|calendar|todo|task|notes?|crm|portal|workspace|generator)\b/i.test(prompt);
}

function hasPrimaryActionSurface(renderedText: string, sourceText: string): boolean {
  if (/<button\b|role=["']button["']|<a\b[^>]*href=|<input\b|<select\b|<textarea\b/i.test(sourceText)) {
    return true;
  }
  return /\b(add|create|save|start|book|checkout|filter|search|edit|delete|complete|send|upload|generate)\b/i.test(renderedText);
}

function hasStatefulInteraction(sourceText: string): boolean {
  if (/\bon[A-Z][A-Za-z]+\s*=|useState\(|useReducer\(|zustand|create\(/.test(sourceText)) {
    return true;
  }
  if (/<form\b|<input\b|<select\b|<textarea\b/i.test(sourceText)) {
    return true;
  }
  return false;
}

export function evaluateBuilderPreviewQuality(input: BuilderPreviewQualityInput): BuilderPreviewQualityReport {
  const renderedText = input.renderedText.replace(/\s+/g, ' ').trim();
  const sourceAndCss = `${input.sourceText ?? ''}\n${input.cssText ?? ''}`;
  const sourceText = input.sourceText ?? '';
  const requirements: BuilderPreviewQualityRequirement[] = [];

  for (const requirement of extractRequiredTexts(input.prompt)) {
    requirements.push({
      kind: 'text',
      label: requirement.label,
      expected: requirement.expected,
      matched: includesLoose(renderedText, requirement.expected),
    });
  }

  for (const requirement of extractHexRequirements(input.prompt)) {
    requirements.push({
      kind: 'style',
      label: requirement.label,
      expected: requirement.expected,
      matched: sourceAndCss.toLowerCase().includes(requirement.expected),
    });
  }

  if (/\b(?:motion|animation|animate|animated|kinetic|transition|entrance|reveal|stagger)\b/i.test(input.prompt)) {
    requirements.push({
      kind: 'motion',
      label: 'motion',
      expected: 'animation or motion implementation',
      matched: /(?:@keyframes|animation\s*:|transition\s*:|motion\.|framer-motion|animate=|initial=)/i.test(sourceAndCss),
    });
  }

  requirements.push({
    kind: 'content',
    label: 'no template language',
    expected: 'no visible placeholder/template wording',
    matched: !FORBIDDEN_TEMPLATE_LANGUAGE.some((pattern) => pattern.test(renderedText) || pattern.test(sourceText)),
  });

  if (isAppLikePrompt(input.prompt)) {
    requirements.push({
      kind: 'interaction',
      label: 'primary action',
      expected: 'visible primary action or input surface',
      matched: hasPrimaryActionSurface(renderedText, sourceText),
    });
    requirements.push({
      kind: 'interaction',
      label: 'stateful interaction',
      expected: 'observable state change, form, or control handler',
      matched: hasStatefulInteraction(sourceText),
    });
  }

  const matched = requirements.filter((requirement) => requirement.matched);
  const missing = requirements.filter((requirement) => !requirement.matched);
  const score = requirements.length === 0 ? 1 : matched.length / requirements.length;
  const verdict: BuilderPreviewQualityVerdict = missing.length === 0 ? 'pass' : score >= 0.66 ? 'warn' : 'fail';

  return {
    verdict,
    score,
    matched,
    missing,
    requirements,
  };
}
