/**
 * Claude-authored probe prompts — the PRIMARY source of test prompts.
 *
 * Rationale (user direction 2026-06-20): qwen-generated prompts drift toward easy
 * variations of the seeds and stop finding new bugs. Claude authors most prompts
 * deliberately to probe DIVERSE, HARD failure modes across the whole codebase;
 * qwen contributes only a small minority (controlled by --qwen-frac in run.mjs).
 *
 * Each entry: a failure CLASS, the expected interpretation, and a hand-written
 * set of prompts chosen to stress a specific seam. Classes map to real code:
 *   routing/build-verb-poison   → looksLikeFactualQuestion BUILD_VERB_ANYWHERE
 *   routing/fresh-data-trigger  → FRESH_DATA_LEAD + search plan intent
 *   answer/opportunity-framing  → vai-engine curated-answer triggers + composer
 *   answer/curated-trap         → other hardcoded curated answers firing too broadly
 *   routing/comparison          → comparison-question handling (router thicket)
 *   answer/freshness-staleness  → time-sensitive facts answered from frozen memory
 *   followup/context-carry      → "it/that/the second one" referring to prior turn
 */

export const CLAUDE_PROMPT_BANK = [
  {
    klass: 'routing/build-verb-poison',
    expectedIntent: 'answer a question (NOT build an app), despite an innocent build/create/make gerund',
    prompts: [
      'what is a great idea when creating a company in norway?',
      'what should I know before building a team from scratch?',
      'what matters when designing a logo for a startup?',
      'what are common mistakes when writing a business plan?',
      'how do people decide what to make when starting a youtube channel?',
      'what is worth considering when setting up a home office?',
    ],
  },
  {
    klass: 'answer/opportunity-framing',
    expectedIntent: 'propose concrete ideas/opportunities, not enumerate definitions or legal forms',
    prompts: [
      'what is a great idea when creating a company in norway?',
      'give me a promising business idea for the nordics',
      'what kind of startup makes sense in a small country with cheap clean energy?',
      'i have some savings and free time — what could I build that people would pay for?',
      'what is an underrated business opportunity right now?',
    ],
  },
  {
    klass: 'answer/curated-trap',
    expectedIntent: 'answer the ACTUAL question, not fire an unrelated hardcoded curated answer',
    prompts: [
      // probe whether other curated answers (like the Norway one) over-trigger
      'tell me about Norway as a travel destination',
      'is Norway a good place to live?',
      'what is the weather like in Norway in winter?',
      'how does React handle performance in large apps generally?',
      'what makes a good company culture?',
    ],
  },
  {
    klass: 'routing/comparison',
    expectedIntent: 'directly compare the two things and give a verdict, not define one of them',
    prompts: [
      'which is better for a solo founder, an ENK or an AS in norway?',
      'rust vs go for a high-throughput backend — which and why?',
      'sqlite or postgres for a local-first desktop app?',
      'is it smarter to bootstrap or raise money for a small saas?',
    ],
  },
  {
    klass: 'answer/freshness-staleness',
    expectedIntent: 'recognize a time-sensitive fact and fetch it fresh, not answer from frozen memory',
    prompts: [
      'who is the current prime minister of norway?',
      'what is the latest stable version of node?',
      'what is the price of bitcoin right now?',
      'what major AI model was released most recently?',
    ],
  },
  {
    klass: 'followup/context-carry',
    expectedIntent: 'resolve pronouns/ordinals against the prior turn, not answer from loose keywords',
    prompts: [
      'and what about the second one?',
      'can you make that simpler?',
      'why is it better than the alternative?',
      'what would you change about it?',
    ],
  },
];

/** Flatten the bank into work items for the loop. */
export function claudeWorkItems() {
  const items = [];
  for (const c of CLAUDE_PROMPT_BANK) {
    for (const p of c.prompts) {
      items.push({ prompt: p, klass: c.klass, expectedIntent: c.expectedIntent, origin: 'claude' });
    }
  }
  return items;
}
