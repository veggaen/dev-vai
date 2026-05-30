#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const DEFAULT_APP_URL = process.env.VAI_APP_URL || 'http://localhost:5173/?devAuthBypass=1';
const DEFAULT_API_URL = (process.env.VAI_API_URL || 'http://127.0.0.1:3006').replace(/\/$/, '');
const DEFAULT_MODEL_ID = process.env.VAI_MODEL_ID || 'vai:v0';
const DEV_AUTH_BYPASS_HEADERS = { 'x-vai-dev-auth-bypass': '1' };

function parseArgs(argv) {
  const options = {
    appUrl: DEFAULT_APP_URL,
    apiUrl: DEFAULT_API_URL,
    modelId: DEFAULT_MODEL_ID,
    n: 8,
    turns: 2,
    seed: 73,
    builderRate: 0.3,
    timeoutMs: 120_000,
    typeDelay: 12,
    slowMo: 20,
    keepOpenMs: 20_000,
    headless: false,
    screenshots: true,
    previewAudit: true,
    previewLimit: 4,
    keepPreviewTabs: false,
    dryRun: false,
    outputDir: '',
    onlyKind: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    const take = () => {
      index += 1;
      return next;
    };

    if (arg === '--app-url' && next) options.appUrl = take();
    else if (arg === '--api-url' && next) options.apiUrl = take().replace(/\/$/, '');
    else if (arg === '--model' && next) options.modelId = take();
    else if (arg === '--n' && next) options.n = positiveInt(take(), options.n);
    else if (arg === '--turns' && next) options.turns = positiveInt(take(), options.turns);
    else if (arg === '--seed' && next) options.seed = positiveInt(take(), options.seed);
    else if (arg === '--builder-rate' && next) options.builderRate = clamp(Number.parseFloat(take()), 0, 1);
    else if (arg === '--timeout-ms' && next) options.timeoutMs = positiveInt(take(), options.timeoutMs);
    else if (arg === '--type-delay' && next) options.typeDelay = Math.max(0, Number.parseInt(take(), 10) || 0);
    else if (arg === '--slow-mo' && next) options.slowMo = Math.max(0, Number.parseInt(take(), 10) || 0);
    else if (arg === '--keep-open-ms' && next) options.keepOpenMs = Math.max(0, Number.parseInt(take(), 10) || 0);
    else if (arg === '--preview-limit' && next) options.previewLimit = Math.max(0, Number.parseInt(take(), 10) || 0);
    else if (arg === '--output-dir' && next) options.outputDir = path.resolve(take());
    else if (arg === '--only-kind' && next) options.onlyKind = take();
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--no-screenshots') options.screenshots = false;
    else if (arg === '--no-preview-audit') options.previewAudit = false;
    else if (arg === '--keep-preview-tabs') options.keepPreviewTabs = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  options.n = positiveInt(options.n, 8);
  options.turns = positiveInt(options.turns, 2);
  options.timeoutMs = positiveInt(options.timeoutMs, 120_000);
  options.builderRate = clamp(Number.isFinite(options.builderRate) ? options.builderRate : 0.3, 0, 1);
  if (!options.outputDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    options.outputDir = path.join(ROOT, '.codex-run', `vai-chat-ui-corpus-${stamp}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/vai-chat-ui-corpus-audit.mjs [options]

Runs the corpus benchmark through the real Vai end-user chat UI.

Options:
  --app-url <url>          Desktop web app URL. Default ${DEFAULT_APP_URL}
  --api-url <url>          Runtime API URL. Default ${DEFAULT_API_URL}
  --model <id>             Model id for created chats. Default ${DEFAULT_MODEL_ID}
  --n <count>              Number of conversations. Default 8
  --turns <count>          User turns per conversation. Default 2
  --seed <number>          Deterministic corpus seed. Default 73
  --builder-rate <0..1>    Share of builder-mode app prompts. Default 0.3
  --only-kind <kind>       Restrict to one kind, for example builder or format
  --timeout-ms <ms>        Per-turn assistant wait timeout. Default 120000
  --type-delay <ms>        Visible typing delay per character. Default 12
  --slow-mo <ms>           Playwright slow motion. Default 20
  --keep-open-ms <ms>      Keep the visible browser open at the end. Default 20000
  --preview-limit <count>  Max Builder preview audits per run. Default 4
  --output-dir <dir>       Directory for JSONL, report, and screenshots
  --headless               Run hidden instead of visible
  --no-screenshots         Skip screenshot capture
  --no-preview-audit       Do not open/inspect generated Builder previews
  --keep-preview-tabs      Leave generated app preview tabs open until the run ends
  --dry-run                Print generated specs without opening the app
`);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, items) {
  return items[Math.floor(rand() * items.length) % items.length];
}

function slug(value) {
  return String(value || 'case')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'case';
}

const CHAT_SPECS = [
  {
    kind: 'conversation',
    subject: 'comfort-without-fixing',
    mode: 'chat',
    firstUser: 'I had a frustrating day and I do not want a productivity lecture. Just talk with me like a steady friend for a minute.',
    required: ['frustrating'],
    expect: { minWords: 70 },
    followups: [
      'You are sounding a bit formal. Can you make that warmer and more specific to what I said?',
      'Now give me one small thing I can do tonight that does not feel like self-improvement homework.',
    ],
  },
  {
    kind: 'format',
    subject: 'strict-json',
    mode: 'chat',
    firstUser: 'Return only valid JSON with keys "summary", "risks", and "next_step". Topic: migrating a small Electron app to Tauri.',
    required: ['summary', 'risks', 'next_step'],
    expect: { format: 'json' },
    followups: [
      'That needs to be JSON only. No markdown, no explanation. Try again with the same keys.',
      'Add a fourth key named "unknowns", still valid JSON only.',
    ],
  },
  {
    kind: 'coding',
    subject: 'small-react-hook',
    mode: 'chat',
    firstUser: 'Write a small React hook called useDebouncedValue in TypeScript. Include the code and a two-sentence explanation.',
    required: ['useDebouncedValue', 'useEffect'],
    expect: { wantsCode: true, minWords: 80 },
    followups: [
      'Now make sure cleanup is handled correctly and show one usage example.',
      'What edge case would you test first?',
    ],
  },
  {
    kind: 'planning',
    subject: 'messy-product-plan',
    mode: 'chat',
    firstUser: 'I want to build a lightweight personal CRM, a journaling app, and a reminder tool, but maybe that is one product. Help me find the actual product shape.',
    required: ['CRM', 'journal'],
    expect: { minWords: 140 },
    followups: [
      'You listed options. Pick one direction and explain why it is the strongest first version.',
      'Now turn that into a tiny 1-week build plan with three milestones.',
    ],
  },
  {
    kind: 'memory',
    subject: 'short-context-recall',
    mode: 'chat',
    firstUser: 'For this chat only, remember that the project codename is Birch Lantern and the target user is a solo consultant. What are three onboarding ideas?',
    required: ['Birch Lantern', 'consultant'],
    expect: { minWords: 100 },
    followups: [
      'Use the codename and target user I gave you earlier, but do not ask me to repeat them.',
      'Now rewrite the best idea as product copy.',
    ],
  },
  {
    kind: 'style',
    subject: 'plain-language-rewrite',
    mode: 'chat',
    firstUser: 'Rewrite this in plain language without making it childish: "The proposed operational consolidation enables cross-functional visibility while minimizing duplicative reporting vectors."',
    required: ['plain'],
    expect: { minWords: 30 },
    followups: [
      'Give me a sharper version that sounds like an actual executive wrote it.',
      'Now give me the same idea as one Slack message.',
    ],
  },
  {
    kind: 'reasoning',
    subject: 'ambiguous-debugging',
    mode: 'chat',
    firstUser: 'A desktop app sometimes shows a blank white screen after login. Give me a diagnostic order of operations that separates frontend, auth, and runtime failures.',
    required: ['frontend', 'auth', 'runtime'],
    expect: { minWords: 140 },
    followups: [
      'Now turn that into five concrete checks I can run locally.',
      'If the first check passes but the second fails, what would you inspect next?',
    ],
  },
  {
    kind: 'regression',
    subject: 'skagit-style-correction-chat',
    mode: 'chat',
    firstUser: 'I was thinking about starting a company in Norway. What company types are there to be found in Norway? Can you list all of them and also list their benefits and disadvantages in a bullet list for each?',
    required: ['ENK', 'AS', 'NUF'],
    expect: { custom: 'skagitStyleCorrectionChat' },
    followups: [
      "Okay so it didn't answer correctly right now. I was asking for what company types are there in Norway?",
      'How tall is the building in Paris, the tall metal structure?',
      "Can you tell me what 10+10 is and tell me only in letters? Don't tell me the response in numbers but give me the response in letters.",
      'The correct answer would have been to say Twenty. But you got it wrong. Let me try another question just to see if this one works. Is there sugar inside a Coca-Cola? If there is, can you reply yes? If there is not, can you reply no?',
      "Okay I'm asking one more time: can you reply yes or no? Only is it sugar in Coca-Cola?",
    ],
  },
  {
    kind: 'safety',
    subject: 'defensive-security',
    mode: 'chat',
    firstUser: 'I run a small SaaS. Give me a safe checklist for investigating suspicious login attempts without helping attackers evade detection.',
    required: ['logs', 'MFA'],
    expect: { minWords: 120 },
    followups: [
      'Make it more operational: include what to preserve, who to notify, and when to reset sessions.',
      'Add a short customer-facing status update that does not over-disclose.',
    ],
  },
];

const BUILDER_SPECS = [
  {
    kind: 'builder',
    subject: 'shared-shopping-list',
    mode: 'builder',
    firstUser: 'Build the first runnable version now. Create a compact shared shopping app for roommates. It must visibly include Shared Shopping List, Household, grouped grocery items, and Activity Chat. Make product and design assumptions and create complete files.',
    required: ['Shared Shopping List', 'Household', 'Activity Chat'],
    expect: { build: true, wantsCode: true },
    followups: [
      'Improve the same app: add item priority, assigned shopper, and a calmer mobile layout. Keep it runnable.',
      'Now add a small empty state and one micro-interaction.',
    ],
  },
  {
    kind: 'builder',
    subject: 'habit-dashboard',
    mode: 'builder',
    firstUser: 'Build a polished habit dashboard app I can preview. It must include exact labels Streak, Mood, Sleep debt, Today, and Weekly rhythm. Create complete runnable files rather than only a plan.',
    required: ['Streak', 'Mood', 'Sleep debt', 'Weekly rhythm'],
    expect: { build: true, wantsCode: true },
    followups: [
      'Make it feel less like a template: add realistic seeded data and distinct sections for energy, focus, and recovery.',
      'Add one settings panel for habit targets.',
    ],
  },
  {
    kind: 'builder',
    subject: 'ops-control-center',
    mode: 'builder',
    firstUser: 'Build an internal ops control center app. Include an approval queue, operational metrics, live activity, owner names, and obvious action buttons. Return complete runnable files now.',
    required: ['Approval', 'Activity', 'Metrics'],
    expect: { build: true, wantsCode: true },
    followups: [
      'Add a compact risk panel and make the UI denser for daily operations work.',
      'Add two filter controls and make the selected state visible.',
    ],
  },
  {
    kind: 'builder',
    subject: 'editorial-portfolio',
    mode: 'builder',
    firstUser: 'Build a premium editorial photography portfolio with masonry gallery, fullscreen lightbox behavior, project categories, and visible artist bio. Make it preview-ready now.',
    required: ['Portfolio', 'Gallery', 'Bio'],
    expect: { build: true, wantsCode: true },
    followups: [
      'Refine it so the first viewport clearly signals photography and not a generic SaaS page.',
      'Add a small contact/booking area without making it a landing page.',
    ],
  },
];

function makeCorpus(options) {
  const rand = mulberry32(options.seed);
  const specs = [];
  for (let index = 0; index < options.n; index += 1) {
    const pool = rand() < options.builderRate ? BUILDER_SPECS : CHAT_SPECS;
    let base = pick(rand, pool);
    if (options.onlyKind) {
      const candidates = [...CHAT_SPECS, ...BUILDER_SPECS].filter((spec) => spec.kind === options.onlyKind);
      if (candidates.length === 0) throw new Error(`Unknown --only-kind ${options.onlyKind}`);
      base = pick(rand, candidates);
    }
    const variant = stylePrompt(rand, base.firstUser, index);
    specs.push({
      ...base,
      id: `${String(index + 1).padStart(3, '0')}-${slug(base.kind)}-${slug(base.subject)}`,
      firstUser: variant,
      targetTurns: options.turns,
    });
  }
  return specs;
}

function stylePrompt(rand, prompt, index) {
  const wrappers = [
    (text) => text,
    (text) => `Please handle this directly, without asking clarifying questions first:\n\n${text}`,
    (text) => `${text}\n\nBe concrete and avoid generic filler.`,
    (text) => `I am testing the real app UI, so answer as if this is an actual user request. ${text}`,
  ];
  return wrappers[(Math.floor(rand() * wrappers.length) + index) % wrappers.length](prompt);
}

function analyzeResponse({ spec, turnIndex, prompt, response, error, timedOut, ms }) {
  const text = String(response || '');
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const tags = [];
  const expect = spec.expect || {};
  const codeBlock = /```/.test(trimmed);
  const builderArtifact = /\[vai-artifact\]|project update:|sandbox:|```[a-z0-9+#.-]*\s+title=["'][^"']+["']/i.test(trimmed);
  const asksClarification = /\?\s*$/.test(trimmed) && /clarify|before i|which|what kind|could you/i.test(trimmed);
  const unwantedRetrieval = !expect.allowSearch
    && spec.mode !== 'builder'
    && (
      /\b(i searched|searched for|web results|cited answer|fetching sources)\b/i.test(trimmed)
      || /\bsources?:\s/i.test(trimmed)
      || /\[\d+\]/.test(trimmed)
      || /https?:\/\//i.test(trimmed)
    );
  const failedToAnswer = /\b(didn'?t find anything|did not find anything|web results were off-topic|try rephrasing|not going to invent an answer)\b/i.test(trimmed);

  if (error) tags.push('transport_error');
  if (timedOut) tags.push('timeout');
  if (!trimmed && !error) tags.push('empty_response');
  if (/\{\{\s*(?:deploy|system|developer|instruction|template|prompt)\b|<system>|<\/system>|developer message|system prompt|BEGIN_|END_|must follow the instructions/i.test(trimmed)) {
    tags.push('template_or_instruction_leak');
  }
  if (/as an ai language model|i am just an ai|i don't have personal/i.test(lower)) tags.push('generic_ai_disclaimer');
  if (/[�]|\bÃ|\bâ€™|\bâ€œ|\bâ€/.test(trimmed)) tags.push('encoding_mojibake');
  if (expect.minWords && words < expect.minWords && !asksClarification) tags.push('too_short');
  if (expect.wantsCode && !codeBlock && !builderArtifact) tags.push('code_missing_code_block');
  if (expect.build && !builderArtifact && turnIndex === 0) tags.push('builder_no_artifact_signal');
  if (spec.mode === 'builder' && asksClarification && turnIndex === 0) tags.push('builder_clarified_instead_of_building');
  if (expect.format === 'json' && !isStrictJson(trimmed)) tags.push('format_json_violation');
  if (unwantedRetrieval) tags.push('unwanted_retrieval_response');
  if (failedToAnswer) tags.push('failed_to_answer');

  if (expect.custom === 'skagitStyleCorrectionChat') {
    if (turnIndex === 0 || turnIndex === 1) {
      const missingCompanyForms = ['ENK', 'AS', 'NUF'].filter((token) => !new RegExp(`\\b${token}\\b`, 'i').test(trimmed));
      if (missingCompanyForms.length) tags.push('norway_company_forms_missing');
      if (/fjords|midnight sun|northern lights|scandinavian country/i.test(trimmed)) tags.push('norway_trivia_instead_of_company_forms');
      if (/problem-solving|root cause|asking the right question/i.test(trimmed)) tags.push('correction_drifted_to_generic_advice');
    } else if (turnIndex === 2) {
      if (!/eiffel tower/i.test(trimmed) || !/330\s+(?:metres|meters)/i.test(trimmed)) tags.push('eiffel_fuzzy_reference_failed');
      if (failedToAnswer || /try rephrasing|web results were off-topic/i.test(trimmed)) tags.push('eiffel_fuzzy_reference_refused');
    } else if (turnIndex === 3) {
      if (trimmed !== 'Twenty') tags.push('simple_arithmetic_letter_constraint_failed');
      if (/\b20\b/.test(trimmed)) tags.push('simple_arithmetic_used_number');
    } else if (turnIndex === 4 || turnIndex === 5) {
      if (!/^yes\.?$/i.test(trimmed)) tags.push('coca_cola_yes_no_constraint_failed');
      if (/pemberton|carbonated soft drink|key points|brand history|worldwide/i.test(trimmed)) tags.push('coca_cola_history_instead_of_yes_no');
    }
  }

  const missingRequired = (spec.required || []).filter((token) => !lower.includes(String(token).toLowerCase()));
  if (missingRequired.length && turnIndex === 0) {
    tags.push(spec.mode === 'builder' ? 'builder_required_text_missing' : 'required_text_missing');
  }

  return {
    ok: tags.length === 0,
    tags,
    missingRequired,
    words,
    chars: trimmed.length,
    codeBlock,
    builderArtifact,
    asksClarification,
    unwantedRetrieval,
    failedToAnswer,
    ms,
    promptPreview: prompt.slice(0, 180),
  };
}

function isStrictJson(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function nextUserTurn(spec, turnIndex, analysis) {
  if (analysis.tags.includes('template_or_instruction_leak')) {
    return 'You exposed internal template or instruction text. Answer the original user request naturally, without mentioning system prompts, templates, or hidden instructions.';
  }
  if (analysis.tags.includes('format_json_violation')) {
    return 'That was not valid JSON only. Return the answer again as valid JSON only. No markdown and no surrounding explanation.';
  }
  if (analysis.tags.includes('unwanted_retrieval_response') || analysis.tags.includes('failed_to_answer')) {
    return 'Do not search or cite sources for this. Answer the original request directly from the text in this chat.';
  }
  if (analysis.tags.includes('builder_no_artifact_signal') || analysis.tags.includes('code_missing_code_block')) {
    return 'Please build it now rather than describing it. Return complete runnable files and make the result preview-ready.';
  }
  if (
    (analysis.tags.includes('builder_required_text_missing') || analysis.tags.includes('builder_preview_missing_required_text'))
    && analysis.missingRequired.length > 0
  ) {
    return `Revise the app so these exact visible labels are included: ${analysis.missingRequired.join(', ')}. Keep the implementation runnable.`;
  }
  if (analysis.tags.some((tag) => tag.startsWith('builder_preview_'))) {
    return 'Open the generated app mentally as a user and improve what is weak: make the preview more complete, interactive, and obviously runnable.';
  }
  if (analysis.tags.includes('too_short')) {
    return 'That was too thin. Give me the concrete version with examples and tradeoffs.';
  }
  return spec.followups?.[turnIndex] || 'Continue from your previous answer and make the next response more concrete.';
}

async function apiJson(apiUrl, relativePath, init) {
  const response = await fetch(`${apiUrl}${relativePath}`, {
    ...init,
    headers: {
      ...DEV_AUTH_BYPASS_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`${relativePath} -> ${response.status} ${await response.text()}`);
  return response.json();
}

async function maybeApiJson(apiUrl, relativePath, init) {
  try {
    return await apiJson(apiUrl, relativePath, init);
  } catch {
    return null;
  }
}

async function waitForHttp(url, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: DEV_AUTH_BYPASS_HEADERS });
      if (response.ok) return response;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`${label} is not reachable at ${url}: ${lastError}`);
}

async function patchBootstrap(apiUrl) {
  const payload = await apiJson(apiUrl, '/api/platform/bootstrap');
  payload.auth = {
    ...payload.auth,
    enabled: false,
    authenticated: true,
    user: { id: 'ui-corpus-audit', email: 'ui-corpus@test.local', name: 'UI Corpus Audit' },
  };
  return JSON.stringify(payload);
}

async function waitUntil(label, fn, timeoutMs = 60_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await fn();
    if (lastValue) return lastValue;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastValue ? `: ${JSON.stringify(lastValue).slice(0, 500)}` : ''}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStore(page) {
  await waitUntil('chat store', async () => page.evaluate('Boolean(window.__vai_chat_store?.getState)'), 45_000, 300);
}

async function getChatState(page) {
  return page.evaluate(() => {
    const state = window.__vai_chat_store.getState();
    return {
      activeConversationId: state.activeConversationId || null,
      isStreaming: Boolean(state.isStreaming),
      messages: state.messages.map((message) => ({
        id: String(message.id || ''),
        role: message.role,
        content: String(message.content || ''),
      })),
      conversations: state.conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title || '',
        mode: conversation.mode || null,
        sandboxProjectId: conversation.sandboxProjectId || null,
      })),
    };
  });
}

async function startFreshConversation(page, spec, modelId) {
  const conversationId = await page.evaluate(async ({ mode, modelId: innerModelId }) => {
    const chat = window.__vai_chat_store?.getState?.();
    if (!chat?.createConversation) throw new Error('Chat store createConversation unavailable');
    chat.startNewChat?.();
    return chat.createConversation(innerModelId, mode, { sandboxProjectId: null });
  }, { mode: spec.mode, modelId });

  await waitUntil('fresh conversation selected', async () => {
    const state = await getChatState(page);
    const conversation = state.conversations.find((entry) => entry.id === conversationId);
    if (state.activeConversationId === conversationId && conversation?.mode === spec.mode) return conversation;
    return null;
  }, 45_000, 500);

  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ timeout: 30_000 });
  await textarea.click();
  return conversationId;
}

async function typeAndSend(page, prompt, options) {
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ timeout: 30_000 });
  await textarea.click();
  await textarea.fill('');
  if (options.typeDelay > 0) {
    const lines = String(prompt).split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index]) await textarea.type(lines[index], { delay: options.typeDelay });
      if (index < lines.length - 1) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
      }
    }
  } else {
    await textarea.fill(prompt);
  }
  await page.keyboard.press('Enter');
}

async function waitForAssistantTurn(page, beforeAssistantIds, timeoutMs) {
  return waitUntil('assistant response', async () => {
    const state = await getChatState(page);
    const assistants = state.messages.filter((message) => message.role === 'assistant' && message.content.trim());
    const newAssistants = assistants.filter((message) => !beforeAssistantIds.has(message.id));
    if (!state.isStreaming && newAssistants.length > 0) {
      const latestAssistant = pickLatestUserFacingAssistant(newAssistants) || newAssistants.at(-1);
      if (latestAssistant?.content?.trim()) return { state, latestAssistant };
    }
    return null;
  }, timeoutMs, 700);
}

function pickLatestUserFacingAssistant(assistants) {
  for (let index = assistants.length - 1; index >= 0; index -= 1) {
    const content = String(assistants[index]?.content || '').trim();
    if (!content) continue;
    if (/\bProject update:/i.test(content) || /\[vai-artifact\]/i.test(content)) continue;
    return assistants[index];
  }
  return null;
}

async function getConversationMessageCount(apiUrl, conversationId) {
  const messages = await maybeApiJson(apiUrl, `/api/conversations/${conversationId}/messages`);
  return Array.isArray(messages) ? messages.length : 0;
}

async function waitForProjectUpdateArtifact(apiUrl, conversationId, sinceMessageCount, timeoutMs) {
  return waitUntil('project update artifact', async () => {
    const messages = await maybeApiJson(apiUrl, `/api/conversations/${conversationId}/messages`);
    if (!Array.isArray(messages) || messages.length <= sinceMessageCount) return null;
    return [...messages].reverse().find((message) => {
      const content = String(message.content || '');
      return message.role === 'assistant' && (content.includes('Project update:') || content.includes('[vai-artifact]'));
    }) || null;
  }, timeoutMs, 1000);
}

async function waitForConversationSandboxId(apiUrl, page, conversationId, timeoutMs) {
  return waitUntil('conversation sandbox id', async () => {
    const conversations = await maybeApiJson(apiUrl, '/api/conversations?limit=100');
    const apiSandbox = conversations?.find?.((conversation) => conversation.id === conversationId)?.sandboxProjectId || null;
    if (apiSandbox) return apiSandbox;
    return page.evaluate((id) => {
      const state = window.__vai_chat_store.getState();
      return state.conversations.find((conversation) => conversation.id === id)?.sandboxProjectId || null;
    }, conversationId);
  }, timeoutMs, 1000);
}

async function waitForSandboxRunning(apiUrl, sandboxId, timeoutMs) {
  return waitUntil(`sandbox ${sandboxId} running`, async () => {
    const sandbox = await maybeApiJson(apiUrl, `/api/sandbox/${sandboxId}`);
    if (!sandbox) return null;
    if (sandbox.status === 'failed') return { failed: true, sandbox };
    if (sandbox.status === 'running' && sandbox.devPort) return sandbox;
    return null;
  }, timeoutMs, 1000);
}

async function auditBuilderPreview(context, chatPage, options, spec, conversationId, beforeMessageCount, specIndex, turnIndex) {
  const audit = {
    attempted: true,
    projectUpdateId: null,
    sandboxId: null,
    url: null,
    screenshots: [],
    interaction: null,
    dom: null,
    consoleErrors: [],
    failures: [],
    tags: [],
  };

  const previewTimeout = Math.min(options.timeoutMs, 90_000);
  const projectUpdate = await waitForProjectUpdateArtifact(
    options.apiUrl,
    conversationId,
    beforeMessageCount,
    previewTimeout,
  ).catch(() => null);
  audit.projectUpdateId = projectUpdate?.id || null;

  const sandboxId = await waitForConversationSandboxId(options.apiUrl, chatPage, conversationId, previewTimeout).catch(() => null);
  audit.sandboxId = sandboxId;
  if (!sandboxId) {
    audit.failures.push('no sandbox project id');
    audit.tags.push('builder_preview_no_sandbox');
    return audit;
  }

  const sandbox = await waitForSandboxRunning(options.apiUrl, sandboxId, previewTimeout).catch((error) => ({
    failed: true,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (!sandbox || sandbox.failed) {
    audit.failures.push(sandbox?.error || 'sandbox did not reach running state');
    audit.tags.push('builder_preview_not_running');
    return audit;
  }

  const previewPage = await context.newPage();
  previewPage.on('console', (message) => {
    if (message.type() === 'error' && !/favicon/i.test(message.text())) {
      audit.consoleErrors.push(message.text());
    }
  });

  try {
    audit.url = `http://127.0.0.1:${sandbox.devPort}`;
    await previewPage.goto(audit.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await previewPage.waitForTimeout(1200);

    const baseName = `${String(specIndex + 1).padStart(3, '0')}-${String(turnIndex + 1).padStart(2, '0')}-preview-${slug(spec.subject)}`;
    const beforePath = await captureScreenshot(previewPage, options, `${baseName}-before`);
    if (beforePath) audit.screenshots.push(beforePath);

    audit.interaction = await interactWithPreview(previewPage);
    await previewPage.waitForTimeout(800);

    const afterPath = await captureScreenshot(previewPage, options, `${baseName}-after`);
    if (afterPath) audit.screenshots.push(afterPath);

    audit.dom = await previewPage.evaluate(() => {
      const text = document.body?.innerText || '';
      const allElements = Array.from(document.body?.querySelectorAll('*') || []);
      const animatedCount = allElements.filter((element) => {
        const style = window.getComputedStyle(element);
        return (style.animationName && style.animationName !== 'none')
          || (style.transitionDuration && style.transitionDuration !== '0s')
          || (style.transform && style.transform !== 'none');
      }).length;
      return {
        title: document.title,
        textPreview: text.replace(/\s+/g, ' ').trim().slice(0, 1200),
        textLength: text.trim().length,
        regionCount: document.querySelectorAll('main, section, article, aside, form, nav').length,
        buttonCount: document.querySelectorAll('button, a').length,
        inputCount: document.querySelectorAll('input, textarea, select').length,
        animatedCount,
      };
    });

    const previewText = audit.dom.textPreview.toLowerCase();
    const missingRequired = (spec.required || []).filter((token) => !previewText.includes(String(token).toLowerCase()));
    if (missingRequired.length > 0) {
      audit.failures.push(`preview missing required text: ${missingRequired.join(', ')}`);
      audit.tags.push('builder_preview_missing_required_text');
      audit.missingRequired = missingRequired;
    }
    if (audit.dom.textLength < 80) {
      audit.failures.push(`preview text too short: ${audit.dom.textLength}`);
      audit.tags.push('builder_preview_too_sparse');
    }
    if (audit.dom.regionCount < 2) {
      audit.failures.push(`preview has too few structural regions: ${audit.dom.regionCount}`);
      audit.tags.push('builder_preview_weak_structure');
    }
    if (audit.consoleErrors.length > 0) {
      audit.failures.push(`preview console errors: ${audit.consoleErrors.slice(0, 3).join(' | ')}`);
      audit.tags.push('builder_preview_console_error');
    }
    if (audit.interaction?.type === 'none') {
      audit.failures.push('preview had no usable click or input target');
      audit.tags.push('builder_preview_no_interaction_target');
    }
  } catch (error) {
    audit.failures.push(error instanceof Error ? error.message : String(error));
    audit.tags.push('builder_preview_error');
  } finally {
    if (!options.keepPreviewTabs) await previewPage.close().catch(() => {});
  }

  return audit;
}

async function interactWithPreview(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const labelFor = (element) => (
      element.getAttribute('aria-label')
      || element.textContent
      || element.getAttribute('placeholder')
      || element.getAttribute('name')
      || element.id
      || element.tagName
    ).replace(/\s+/g, ' ').trim().slice(0, 120);

    const clickable = Array.from(document.querySelectorAll('button:not([disabled]), a[href], [role="button"]'))
      .find((element) => isVisible(element));
    if (clickable instanceof HTMLElement) {
      const before = document.body.innerText || '';
      clickable.click();
      const after = document.body.innerText || '';
      return {
        type: 'click',
        label: labelFor(clickable),
        textChanged: before !== after,
      };
    }

    const input = Array.from(document.querySelectorAll('input:not([disabled]), textarea:not([disabled])'))
      .find((element) => isVisible(element));
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      input.focus();
      input.value = 'Benchmark test';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        type: 'fill',
        label: labelFor(input),
        value: input.value,
      };
    }

    return { type: 'none', label: null };
  });
}

async function captureScreenshot(page, options, name) {
  if (!options.screenshots) return null;
  const filePath = path.join(options.outputDir, 'screenshots', `${name}.png`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

async function appendJsonl(filePath, row) {
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

function summarize(rows) {
  const total = rows.length;
  const failed = rows.filter((row) => row.analysis.tags.length > 0).length;
  const byTag = new Map();
  const byKind = new Map();
  for (const row of rows) {
    const kind = row.kind || 'unknown';
    byKind.set(kind, (byKind.get(kind) || 0) + 1);
    for (const tag of row.analysis.tags) byTag.set(tag, (byTag.get(tag) || 0) + 1);
  }
  const orderedTags = [...byTag.entries()].sort((a, b) => b[1] - a[1]);
  const orderedKinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
  return { total, failed, passRate: total ? Number(((total - failed) / total).toFixed(3)) : 0, orderedTags, orderedKinds };
}

async function writeReport(filePath, options, specs, rows) {
  const summary = summarize(rows);
  const lines = [
    '# Vai Chat UI Corpus Audit',
    '',
    `- App URL: ${options.appUrl}`,
    `- Runtime API: ${options.apiUrl}`,
    `- Conversations: ${specs.length}`,
    `- Turns captured: ${summary.total}`,
    `- Pass rate: ${(summary.passRate * 100).toFixed(1)}%`,
    '',
    '## Failure Tags',
    '',
    ...(summary.orderedTags.length
      ? summary.orderedTags.map(([tag, count]) => `- ${tag}: ${count}`)
      : ['- none']),
    '',
    '## Kinds',
    '',
    ...summary.orderedKinds.map(([kind, count]) => `- ${kind}: ${count}`),
    '',
    '## Failed Rows',
    '',
  ];

  for (const row of rows.filter((entry) => entry.analysis.tags.length > 0).slice(0, 40)) {
    lines.push(`- ${row.specId} turn ${row.turnIndex + 1}: ${row.analysis.tags.join(', ')}`);
    lines.push(`  Prompt: ${row.prompt.replace(/\s+/g, ' ').slice(0, 220)}`);
    lines.push(`  Response: ${row.response.replace(/\s+/g, ' ').slice(0, 260)}`);
  }

  const previewRows = rows.filter((row) => row.previewAudit?.attempted);
  if (previewRows.length > 0) {
    lines.push('');
    lines.push('## Preview Audits');
    lines.push('');
    for (const row of previewRows.slice(0, 30)) {
      const audit = row.previewAudit;
      lines.push(`- ${row.specId} turn ${row.turnIndex + 1}: ${audit.url || 'no preview url'}`);
      lines.push(`  Interaction: ${audit.interaction?.type || 'none'}${audit.interaction?.label ? ` (${audit.interaction.label})` : ''}`);
      lines.push(`  DOM: ${audit.dom ? `${audit.dom.regionCount} regions, ${audit.dom.buttonCount} buttons/links, ${audit.dom.inputCount} inputs` : 'not captured'}`);
      lines.push(`  Failures: ${audit.failures.length ? audit.failures.join(' | ') : 'none'}`);
    }
  }

  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const specs = makeCorpus(options);

  if (options.dryRun) {
    console.log(JSON.stringify(specs, null, 2));
    return;
  }

  await fs.mkdir(options.outputDir, { recursive: true });
  const jsonlPath = path.join(options.outputDir, 'turns.jsonl');
  const reportPath = path.join(options.outputDir, 'report.md');
  await fs.writeFile(jsonlPath, '', 'utf8');

  console.log('Vai real chat UI corpus audit');
  console.log(`  app: ${options.appUrl}`);
  console.log(`  runtime: ${options.apiUrl}`);
  console.log(`  output: ${options.outputDir}`);
  console.log(`  conversations: ${specs.length}`);
  console.log(`  turns/conversation: ${options.turns}`);

  await waitForHttp(`${options.apiUrl}/health`, 'runtime health', 30_000);
  await waitForHttp(options.appUrl, 'desktop web app', 30_000);
  const patchedBootstrap = await patchBootstrap(options.apiUrl);

  const browser = await chromium.launch({
    headless: options.headless,
    slowMo: options.slowMo,
    args: ['--no-sandbox', '--window-size=1440,1000'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  await page.route('**/api/platform/bootstrap', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: patchedBootstrap,
  }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, user: { id: 'ui-corpus-audit', email: 'ui-corpus@test.local', name: 'UI Corpus Audit' } }),
  }));

  const rows = [];
  let previewAuditsRun = 0;
  try {
    await page.goto(options.appUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForStore(page);
    await captureScreenshot(page, options, '000-app-loaded');

    for (let specIndex = 0; specIndex < specs.length; specIndex += 1) {
      const spec = specs[specIndex];
      console.log(`[${specIndex + 1}/${specs.length}] ${spec.id} (${spec.mode})`);
      const conversationId = await startFreshConversation(page, spec, options.modelId);
      await captureScreenshot(page, options, `${String(specIndex + 1).padStart(3, '0')}-00-start-${slug(spec.subject)}`);

      let prompt = spec.firstUser;
      for (let turnIndex = 0; turnIndex < options.turns; turnIndex += 1) {
        const beforeState = await getChatState(page);
        const beforeAssistantIds = new Set(beforeState.messages
          .filter((message) => message.role === 'assistant' && message.content.trim())
          .map((message) => message.id));
        const beforeApiMessageCount = spec.mode === 'builder'
          ? await getConversationMessageCount(options.apiUrl, conversationId).catch(() => beforeState.messages.length)
          : beforeState.messages.length;
        const startedAt = Date.now();
        let response = '';
        let error = null;
        let timedOut = false;
        let assistantId = null;
        let postState = null;
        let previewAudit = null;

        try {
          await typeAndSend(page, prompt, options);
          await captureScreenshot(page, options, `${String(specIndex + 1).padStart(3, '0')}-${String(turnIndex + 1).padStart(2, '0')}-prompt-sent`);
          const result = await waitForAssistantTurn(page, beforeAssistantIds, options.timeoutMs);
          postState = result.state;
          assistantId = result.latestAssistant.id;
          response = result.latestAssistant.content;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          timedOut = /timed out/i.test(error);
        }

        const ms = Date.now() - startedAt;
        const analysis = analyzeResponse({ spec, turnIndex, prompt, response, error, timedOut, ms });
        if (
          options.previewAudit
          && spec.mode === 'builder'
          && previewAuditsRun < options.previewLimit
          && !timedOut
        ) {
          previewAuditsRun += 1;
          console.log(`  preview audit ${previewAuditsRun}/${options.previewLimit}: opening generated app`);
          previewAudit = await auditBuilderPreview(
            context,
            page,
            options,
            spec,
            conversationId,
            beforeApiMessageCount,
            specIndex,
            turnIndex,
          );
          for (const tag of previewAudit.tags || []) {
            if (!analysis.tags.includes(tag)) analysis.tags.push(tag);
          }
          if (previewAudit.missingRequired?.length) {
            analysis.missingRequired = [...new Set([...analysis.missingRequired, ...previewAudit.missingRequired])];
          }
          analysis.ok = analysis.tags.length === 0;
        }
        const screenshot = await captureScreenshot(page, options, `${String(specIndex + 1).padStart(3, '0')}-${String(turnIndex + 1).padStart(2, '0')}-assistant-response`);
        const row = {
          runId: path.basename(options.outputDir),
          specId: spec.id,
          kind: spec.kind,
          subject: spec.subject,
          mode: spec.mode,
          conversationId,
          turnIndex,
          prompt,
          response,
          assistantId,
          analysis,
          error,
          timedOut,
          ms,
          screenshot,
          previewAudit,
          messageCount: postState?.messages?.length ?? null,
          createdAt: new Date().toISOString(),
        };
        rows.push(row);
        await appendJsonl(jsonlPath, row);
        const tagText = analysis.tags.length ? analysis.tags.join(', ') : 'ok';
        console.log(`  turn ${turnIndex + 1}: ${tagText} (${ms} ms)`);

        if (turnIndex < options.turns - 1) {
          prompt = nextUserTurn(spec, turnIndex, analysis);
        }
      }
    }
  } finally {
    await writeReport(reportPath, options, specs, rows).catch((error) => {
      console.warn(`Failed to write report: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (options.keepOpenMs > 0 && !options.headless) {
      console.log(`Keeping browser open for ${options.keepOpenMs}ms so the run remains visible...`);
      await sleep(options.keepOpenMs);
    }
    await browser.close();
  }

  const summary = summarize(rows);
  console.log(`Done. ${summary.total} turns, ${summary.failed} tagged failures, pass rate ${(summary.passRate * 100).toFixed(1)}%.`);
  console.log(`JSONL: ${jsonlPath}`);
  console.log(`Report: ${reportPath}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
