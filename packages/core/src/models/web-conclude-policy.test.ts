import { describe, expect, it } from 'vitest';
import {
  hasSubstantiveQuestionAfterOpener,
  isExplicitResearchRequest,
  isBusinessOpportunityRequest,
  isFreshLocalBusinessContactRequest,
  isFreshLocalRecommendationRequest,
  isLiveFactualLookupQuery,
  needsLiveExternalEvidence,
  isGameFranchiseOverviewQuestion,
  isPureConversationalTurn,
  normalizeWebConclusionInput,
  shouldConcludeWithWebSearch,
  shouldDeferWebConclusionToLocalRoutes,
  shouldSkipWebConclusion,
} from './web-conclude-policy.js';

describe('web-conclude-policy', () => {
  it('treats research imperatives as explicit research', () => {
    expect(isExplicitResearchRequest('do research on udyr passive')).toBe(true);
    expect(isExplicitResearchRequest('look it up')).toBe(true);
    expect(isExplicitResearchRequest('you should find it online pizza bakeren hommersåk')).toBe(true);
  });

  it('defaults substantive factual questions to web conclusion', () => {
    expect(shouldConcludeWithWebSearch('how much does an ak cost in cs2')).toBe(true);
    expect(shouldConcludeWithWebSearch('who is udyr in league')).toBe(true);
  });

  it('treats local recommendations as current without an explicit latest cue', () => {
    const prompt = 'what are good resturants in Hommersåk Norway?';
    expect(isFreshLocalRecommendationRequest(prompt)).toBe(true);
    expect(shouldDeferWebConclusionToLocalRoutes(prompt)).toBe(false);
    expect(shouldConcludeWithWebSearch(prompt)).toBe(true);
  });

  it('treats explicit business contact lookup as freshness-sensitive', () => {
    const prompt = 'find the phone number online for Pizzabakeren Hommersåk';
    expect(isFreshLocalBusinessContactRequest(prompt)).toBe(true);
    expect(shouldConcludeWithWebSearch(prompt)).toBe(true);
    expect(isFreshLocalBusinessContactRequest('what was the phone number to pb hommersåk?')).toBe(false);
    expect(isFreshLocalBusinessContactRequest('Build a clean phone-friendly shopping app.')).toBe(false);
    expect(isFreshLocalBusinessContactRequest('I am a photographer and need a website.')).toBe(false);
  });

  it('skips builder and greeting turns', () => {
    expect(shouldSkipWebConclusion('hey')).toBe(true);
    expect(shouldSkipWebConclusion('heya')).toBe(true);
    expect(shouldSkipWebConclusion('build me a todo app', { activeMode: 'builder' })).toBe(true);
    expect(shouldConcludeWithWebSearch('build me a todo app', { activeMode: 'builder' })).toBe(false);
  });

  it('allows live factual lookups in agent mode', () => {
    expect(needsLiveExternalEvidence('price of eth and btc?')).toBe(true);
    expect(needsLiveExternalEvidence('whats the price of solana?')).toBe(true);
    expect(needsLiveExternalEvidence('how much is a barrel of oil today?')).toBe(true);
    expect(needsLiveExternalEvidence('what is NVIDIA trading at?')).toBe(true);
    expect(shouldSkipWebConclusion('price of eth and btc?', { activeMode: 'agent' })).toBe(false);
    expect(shouldSkipWebConclusion('whats the price of solana?', { activeMode: 'agent' })).toBe(false);
    expect(shouldSkipWebConclusion('what is the capital of France?', { activeMode: 'agent' })).toBe(true);
  });

  it('detects volatile value lookups without ticker allowlists', () => {
    expect(needsLiveExternalEvidence('price of chainlink?')).toBe(true);
    expect(needsLiveExternalEvidence('how much is a Model Y worth right now?')).toBe(true);
    expect(needsLiveExternalEvidence('build me a pricing page for my SaaS')).toBe(false);
    expect(needsLiveExternalEvidence('create a crypto tracker app')).toBe(false);
    expect(needsLiveExternalEvidence('what is the weather in Bergen today?')).toBe(true);
  });

  it('classifies pure conversational turns structurally instead of per-word lists', () => {
    expect(isPureConversationalTurn('heya')).toBe(true);
    expect(isPureConversationalTurn('yo')).toBe(true);
    expect(isPureConversationalTurn('list all lol roles')).toBe(false);
    expect(isPureConversationalTurn('what is Docker')).toBe(false);
    expect(isPureConversationalTurn('Hello, who is the king of Norway?')).toBe(false);
    expect(hasSubstantiveQuestionAfterOpener('Hello, who is the king of Norway?')).toBe(true);
    expect(hasSubstantiveQuestionAfterOpener('heya')).toBe(false);
  });

  it('strips style wrappers before routing and skips bare decorated follow-ups', () => {
    expect(normalizeWebConclusionInput('Please provide a concise explanation: why though?')).toBe('why though?');
    expect(shouldSkipWebConclusion('Please provide a concise explanation: why though?')).toBe(true);
    expect(shouldSkipWebConclusion('ok wait how so? idk if that makes sense')).toBe(true);
  });

  it('removes generic conversational lead-ins before search planning', () => {
    expect(normalizeWebConclusionInput('Please provide a concise explanation: I need a straight answer on EV battery range facts for a quiz')).toBe('EV battery range facts for a quiz');
    expect(normalizeWebConclusionInput('look it up: Docker vs Podman when migrating legacy code')).toBe('Docker vs Podman when migrating legacy code');
    expect(normalizeWebConclusionInput('waht is dockre')).toBe('what is dockre');
  });

  it('keeps local control turns out of search fan-out', () => {
    expect(shouldSkipWebConclusion('What is 8 + 2 * 3?')).toBe(true);
    expect(shouldSkipWebConclusion('and what would 12 times twelve be?')).toBe(true);
    expect(shouldSkipWebConclusion('and what would twelve times twelve be?')).toBe(true);
    expect(shouldSkipWebConclusion("What's my name?")).toBe(true);
    expect(shouldSkipWebConclusion('what day is it tomorrow?')).toBe(true);
    expect(shouldSkipWebConclusion('and what about in 30 days?')).toBe(true);
    expect(shouldSkipWebConclusion('how about 7 days ago?')).toBe(true);
    expect(shouldSkipWebConclusion('how many messages have I sent you so far?')).toBe(true);
    expect(shouldSkipWebConclusion('how many words are in this sentence?')).toBe(true);
    expect(shouldSkipWebConclusion("What is my next-door neighbor's middle name?")).toBe(true);
    expect(shouldSkipWebConclusion('Help me with my project.')).toBe(true);
    expect(shouldSkipWebConclusion("No, it's actually Sydney.")).toBe(true);
  });

  it('lets stable explanations use local knowledge before later web fallback', () => {
    expect(shouldSkipWebConclusion('what is Docker')).toBe(false);
    expect(shouldDeferWebConclusionToLocalRoutes('what is Docker')).toBe(true);
    expect(shouldDeferWebConclusionToLocalRoutes('tell me about the pythagorean theorem please')).toBe(true);
    expect(shouldDeferWebConclusionToLocalRoutes('kan u forklare pyhton')).toBe(true);
    expect(shouldDeferWebConclusionToLocalRoutes('exsplain perplexity in simple words')).toBe(true);
    expect(shouldDeferWebConclusionToLocalRoutes('list 3 popular javascript frameworks')).toBe(true);
    expect(shouldDeferWebConclusionToLocalRoutes('what is the latest Docker version')).toBe(false);
  });

  it('still honors explicit search requests for otherwise local-shaped turns', () => {
    expect(shouldSkipWebConclusion('search the web for what day it is tomorrow')).toBe(false);
  });

  it('leaves build URLs for the dedicated URL route', () => {
    expect(shouldSkipWebConclusion('can you rebuild https://github.com/pingdotgg/lawn?')).toBe(true);
    expect(shouldDeferWebConclusionToLocalRoutes('Take a look at https://github.com/pingdotgg/lawn')).toBe(true);
  });

  it('limits counter-strike overview to definitional prompts', () => {
    expect(isGameFranchiseOverviewQuestion('what is counter-strike')).toBe(true);
    expect(isGameFranchiseOverviewQuestion('how much does ak cost in cs2')).toBe(false);
  });

  it('detects business-opportunity questions and routes them to research+synthesis', () => {
    // The Norway bug class: these want concrete IDEAS, not legal forms or definitions.
    expect(isBusinessOpportunityRequest('What is a great idea when creating a company in norway?')).toBe(true);
    expect(isBusinessOpportunityRequest('give me a promising business idea for the nordics')).toBe(true);
    expect(isBusinessOpportunityRequest('what kind of startup makes sense in a small country?')).toBe(true);
    expect(isBusinessOpportunityRequest('what is an underrated business opportunity right now?')).toBe(true);
    // Must NOT fire for procedural/forms/factual asks.
    expect(isBusinessOpportunityRequest('how do I register a company in norway?')).toBe(false);
    expect(isBusinessOpportunityRequest('what company forms exist in norway?')).toBe(false);
    expect(isBusinessOpportunityRequest('what is the capital of norway?')).toBe(false);
    // And such questions must NOT skip the web conclusion (they need fresh synthesis).
    expect(shouldSkipWebConclusion('What is a great idea when creating a company in norway?')).toBe(false);
  });
});
