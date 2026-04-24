import { getDefaultBuilderModules } from './modules.js';
import type { BuilderIntent, BuilderIntentInput, BuilderAudience } from './types.js';

function inferAudience(text: string): BuilderAudience {
  if (/\b(?:for\s+me|my\s+own|personal|privately|private)\b/i.test(text)) {
    return 'personal';
  }
  if (/\b(?:clients?|portfolio|creator|photographer|artist|writer)\b/i.test(text)) {
    return 'creator';
  }
  return 'consumer';
}

export function resolveBuilderIntent(input: BuilderIntentInput): BuilderIntent | null {
  const text = `${input.input} ${input.cleanedProjectDesc} ${input.fullDesc}`.trim();
  const audience = inferAudience(text);
  const isCloneRequest = /\b(?:clone|copy|recreate|replicate|inspired|style|like)\b/i.test(text);
  const requestsRunnableApp = /\b(?:app|application|project|site|website|platform|tool|dashboard|portfolio|gallery|feed)\b/i.test(text);

  if (
    /\b(?:photographer|photography|photo\s+gallery|lightbox|masonry|editorial|portrait|wedding)\b/i.test(text)
    && /\b(?:portfolio|gallery|site|website|app|page)\b/i.test(text)
  ) {
    return {
      archetype: 'portfolio',
      audience,
      domain: 'photography',
      modules: getDefaultBuilderModules('portfolio'),
      prompt: input.input,
      cleanedPrompt: input.cleanedProjectDesc,
      isCloneRequest,
    };
  }

  if (
    /\b(?:sell|selling|shop|store|storefront|catalog|checkout|products?|ecommerce|commerce|marketplace|webshop)\b/i.test(text)
    && /\b(?:app|application|site|store|shop|website|platform|brand|business|marketplace|webshop|catalog)\b/i.test(text)
    && !/\b(shared\s+shopping|shopping\s+app|shopping\s*list|grocery|household|roommates?)\b/i.test(text)
  ) {
    return {
      archetype: 'storefront',
      audience: 'consumer',
      domain: 'commerce',
      modules: getDefaultBuilderModules('storefront'),
      prompt: input.input,
      cleanedPrompt: input.cleanedProjectDesc,
      isCloneRequest,
    };
  }

  if (
    /\b(?:twitter|twiter|twiiter|x(?:\.com)?|tweet(?:s)?|timeline|for\s+you|who\s+to\s+follow|social\s+feed)\b/i.test(text)
    && (isCloneRequest || /\b(?:feed|timeline|composer|post|follow)\b/i.test(text))
  ) {
    return {
      archetype: 'social-feed',
      audience: 'consumer',
      domain: 'social',
      modules: getDefaultBuilderModules('social-feed'),
      prompt: input.input,
      cleanedPrompt: input.cleanedProjectDesc,
      referenceBrand: /\bx(?:\.com)?\b/i.test(text) ? 'x' : 'twitter',
      isCloneRequest,
    };
  }

  if (
    requestsRunnableApp
    && /\b(?:dashboard|analytics\s*dashboard|metrics\s*dashboard|data\s*dashboard|admin\s+dashboard)\b/i.test(text)
    && /\b(?:analytics|metrics?|kpi|chart|charts|graph|plot|recharts)\b/i.test(text)
  ) {
    return {
      archetype: 'dashboard',
      audience: 'consumer',
      domain: 'operations',
      modules: getDefaultBuilderModules('dashboard'),
      prompt: input.input,
      cleanedPrompt: input.cleanedProjectDesc,
      isCloneRequest,
    };
  }

  if (
    requestsRunnableApp
    && /\b(?:tinder|dating|dating\s+app|swipe|swiping|match(?:ing)?|matches|profile\s+deck)\b/i.test(text)
  ) {
    return {
      archetype: 'matching',
      audience: 'consumer',
      domain: 'dating',
      modules: getDefaultBuilderModules('matching'),
      prompt: input.input,
      cleanedPrompt: input.cleanedProjectDesc,
      referenceBrand: /\btinder\b/i.test(text) ? 'tinder' : undefined,
      isCloneRequest,
    };
  }

  if (
    requestsRunnableApp
    && /\b(?:booking|appointment|appointments|calendar|scheduler|schedule\s+meetings|bookings|reservation|consultation|client\s+booking)\b/i.test(text)
  ) {
    return {
      archetype: 'booking',
      audience,
      domain: 'scheduling',
      modules: getDefaultBuilderModules('booking'),
      prompt: input.input,
      cleanedPrompt: input.cleanedProjectDesc,
      isCloneRequest,
    };
  }

  if (
    requestsRunnableApp
    && /\b(?:training|workout|fitness|gym|exercise|routine|program|split|habit|running|lift(?:ing)?|strength)\b/i.test(text)
  ) {
    return {
      archetype: 'tracker',
      audience,
      domain: 'fitness',
      modules: getDefaultBuilderModules('tracker'),
      prompt: input.input,
      cleanedPrompt: input.cleanedProjectDesc,
      isCloneRequest,
    };
  }

  return null;
}
