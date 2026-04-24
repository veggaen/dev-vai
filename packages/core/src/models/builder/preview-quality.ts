export type BuilderPreviewQualityVerdict = 'pass' | 'warn' | 'fail';

export interface BuilderPreviewQualityInput {
  readonly prompt: string;
  readonly renderedText: string;
  readonly sourceText?: string;
  readonly cssText?: string;
}

export interface BuilderPreviewQualityRequirement {
  readonly kind: 'text' | 'style' | 'motion';
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

export function evaluateBuilderPreviewQuality(input: BuilderPreviewQualityInput): BuilderPreviewQualityReport {
  const renderedText = input.renderedText.replace(/\s+/g, ' ').trim();
  const sourceAndCss = `${input.sourceText ?? ''}\n${input.cssText ?? ''}`;
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
