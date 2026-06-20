/**
 * Seed corpus — the real failures we have observed, by class.
 *
 * Each class names a failure MODE (not a single bug). The loop generates more
 * prompts per class via qwen, but these hand-verified rows anchor the class and
 * make every run start with known regressions (incl. the Norway opportunity bug
 * that started this whole effort).
 */
export const SEED_CLASSES = [
  {
    klass: 'routing/build-verb-poison',
    expectedIntent: 'answer a question (NOT build an app), despite a build-ish gerund',
    seeds: [
      'What is a great idea when creating a company in norway?',   // the original failure
      "what's smart to know when building a saas?",
      'what matters most when making a video game?',
      'what should I think about when setting up a team?',
      'what is a good idea when starting a restaurant?',
    ],
  },
  {
    klass: 'routing/fresh-data-trigger',
    expectedIntent: 'recognize a time-sensitive opportunity/recommendation question that benefits from search',
    seeds: [
      'what is a great idea when creating a company in norway?',
      'best industry to start a business in right now?',
      'what is a promising startup sector this year?',
      'where is the biggest opportunity for a new company today?',
    ],
  },
  {
    klass: 'answer/opportunity-framing',
    expectedIntent: 'propose concrete ideas/opportunities, not enumerate definitions or legal forms',
    seeds: [
      'what is a great idea when creating a company in norway?',
      'give me a good business idea for sweden',
      'what kind of company should I start in oslo?',
      "what's a smart thing to build a startup around in the nordics?",
    ],
  },
];
