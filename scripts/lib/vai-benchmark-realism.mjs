const SYNTHETIC_PATTERNS = [
  ['prompt-visible-marker', /\b(?:LANTERN|QUARTZ|EMBER|SUMMIT|TULIP|HARBOR|CEDAR|SIGNAL|ATLAS|ROOT|BRAID|SMUDGE|THREAD|GATE|LAND|BASE|POOL|HELLO|DUO|FOG)-\d+-\d+\b/i],
  ['audit-wrapper', /\b(?:audit prompt|production control|lead-engineer check|regression check)\b/i],
  ['explicit-test-language', /\b(?:i am testing whether|fresh chat, same task but stricter|follow up with a trick|ignore this irrelevant note)\b/i],
  ['numbered-context-switch', /\bcontext switch \d+\b/i],
  ['protocol-command', /\b(?:acknowledge the rule|compress the corrected|return to [A-Z]+-\d+|control [A-Z]+-\d+)\b/i],
];

const HUMAN_STYLE_PATTERNS = [
  ['conversational-opener', /^(?:okay|ok|so|emm|yeah|hello|hi|hey|well|actually|i think|can you|let'?s|sorry|quick (?:q|question|one))\b/i],
  ['compound-request', /\b(?:and then|also|but|actually|from there|what about|so that|and remember|and keep)\b/i],
  ['lowercase-i', /(^|\W)i(?:'m|'d|'ll|'ve|\W)/],
  ['informal-spelling', /\b(?:pls|whats|wasnt|isnt|dont|u|gotta|itterate|awoids|buildt|sendt|nad)\b/i],
  ['self-correction', /\b(?:wait|actually|scratch that|change of plan|sorry|i mean)\b/i],
  ['practical-goal', /\b(?:so i can|in my project|preview|runnable|what should i do|help me|make improvements|fix|verify)\b/i],
];

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function auditPromptRealism(prompt) {
  const text = normalize(prompt);
  const syntheticFlags = SYNTHETIC_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([id]) => id);
  const humanTraits = HUMAN_STYLE_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([id]) => id);
  const score = Math.max(0, 100 - syntheticFlags.length * 25);
  return {
    prompt: text,
    score,
    syntheticFlags,
    humanTraits,
  };
}

export function auditWaveRealism(wave, lane = wave.generation?.mode ?? 'unknown') {
  const prompts = wave.scenarios.flatMap((scenario) => scenario.turns.map((turn, turnIndex) => ({
    scenarioId: scenario.id,
    turnIndex,
    prompt: turn.prompt,
    promptVisibleCanary: Boolean(scenario.canary && String(turn.prompt).includes(scenario.canary)),
    audit: auditPromptRealism(turn.prompt),
  })));
  const flagged = prompts.filter((item) => item.audit.syntheticFlags.length > 0);
  const visibleCanaries = prompts.filter((item) => item.promptVisibleCanary);
  const averageScore = prompts.length
    ? Math.round(prompts.reduce((sum, item) => sum + item.audit.score, 0) / prompts.length)
    : 0;
  return {
    lane,
    prompts: prompts.length,
    averageScore,
    syntheticPrompts: flagged.length,
    syntheticRate: prompts.length ? Number((flagged.length / prompts.length).toFixed(3)) : 0,
    promptVisibleCanaries: visibleCanaries.length,
    humanTraitPrompts: prompts.filter((item) => item.audit.humanTraits.length > 0).length,
    examples: flagged.slice(0, 6).map((item) => ({
      scenarioId: item.scenarioId,
      turn: item.turnIndex + 1,
      flags: item.audit.syntheticFlags,
      prompt: item.audit.prompt,
    })),
  };
}

