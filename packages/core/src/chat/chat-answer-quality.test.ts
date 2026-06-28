import { describe, expect, it } from 'vitest';
import { evaluateChatAnswerQuality } from './chat-answer-quality.js';
import type { ConversationGrounding } from './conversation-grounding.js';

const grounding: ConversationGrounding = {
  topic: 'Vai chat context relevance',
  previousUser: 'The chat app sends user profile, selected files, and the last 8 messages as context into Vai.',
  previousAssistant: 'That context bundle should guide the response and prevent generic answers.',
  contextText: 'The chat app sends user profile, selected files, and the last 8 messages as context into Vai. That context bundle should guide the response and prevent generic answers.',
  keywords: ['Vai', 'user context', 'response relevance', 'teacher loop'],
  requestedOutcome: 'choose the highest-leverage next engineering task for Vai chat relevance',
  constraints: ['Vai remains the primary answerer', 'preserve current user context'],
};

describe('evaluateChatAnswerQuality', () => {
  it('passes grounded actionable answers that preserve topic and constraints', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'What would be the best next thing to improve relevance?',
      response: '**Best next task**\nImplement a local context-grounding pass before broad retrieval. Preserve current user context, keep Vai as the primary answerer while external LLMs stay optional critics, and add regression tests for vague follow-ups.',
      grounding,
      strategy: 'context-grounded-followup',
    });

    expect(report.verdict).toBe('pass');
    expect(report.missing.some((requirement) => requirement.kind === 'topic' || requirement.kind === 'drift')).toBe(false);
  });

  it('fails when the answer drifts into known unrelated snippet smells', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'What would be the best next thing to improve relevance?',
      response: 'Start with goroutines and slices, then compare a Swedish exam rubric before thinking about Vai.',
      grounding,
      strategy: 'context-grounded-followup',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.kind === 'drift')).toBe(true);
  });

  it('fails action-oriented prompts when the answer has no concrete next move', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'What is the best next engineering task to improve Vai chat responses?',
      response: 'This is an important area and the system should be thoughtful about it.',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.kind === 'actionability')).toBe(true);
  });

  it('passes action-oriented prompts when the answer includes a concrete check or implementation step', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'What is the best next engineering task to improve Vai chat responses?',
      response: 'Add a service-level quality gate before fallback, then verify it with a chat-service regression test.',
    });

    expect(report.verdict).toBe('pass');
  });

  it('does not treat ordinary recommendation wording as an action contract by itself', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'Which database is best for a local todo app?',
      response: 'SQLite is the best default for a local todo app because it is simple, embedded, and reliable for single-user storage.',
    });

    expect(report.missing.some((requirement) => requirement.kind === 'actionability')).toBe(false);
    expect(report.verdict).toBe('pass');
  });

  it('scores uncertain help requests for honest, guiding, useful response shape', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'I am unsure where to inspect first. Please be honest and help me figure it out.',
      response: 'Start with the failing route, then verify the stream emits a terminal done event. If it still hangs, check the fallback timeout and capture the exact missing frame.',
    });

    expect(report.verdict).toBe('pass');
    expect(report.missing.some((requirement) => requirement.kind === 'guidance')).toBe(false);
    expect(report.missing.some((requirement) => requirement.kind === 'honesty')).toBe(false);
  });

  it('fails guidance requests when the answer does not provide a usable next step', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'I am overwhelmed debugging a blank React page. Where should I start?',
      response: 'I can see you mentioned debugging a blank React page. What would you like to do?',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.kind === 'guidance')).toBe(true);
  });

  it('fails debugging guidance that invents a replacement project instead of diagnosing the existing app', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'I am overwhelmed debugging a blank React page. Where should I start?',
      response: [
        'Replace the project with these files:',
        '```json title="package.json"',
        '{"scripts":{"start":"webpack serve"}}',
        '```',
        '```js title="webpack.config.js"',
        'module.exports = {};',
        '```',
        '```html title="index.html"',
        '<div id="root"></div>',
        '```',
      ].join('\n'),
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.kind === 'scope')).toBe(true);
  });

  it('allows code artifacts when the user explicitly asks for an implementation', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'Help me debug this blank React page and show the minimal code patch.',
      response: 'Start with the first browser-console error, then apply this minimal patch:\n```tsx\nroot.render(<App />);\n```',
    });

    expect(report.missing.some((requirement) => requirement.kind === 'scope')).toBe(false);
    expect(report.verdict).toBe('pass');
  });

  it('fails diagnostic guidance that assumes an unprovided React toolchain', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'I am overwhelmed debugging a blank React page. Where should I start?',
      response: 'First run `npm ls` or `yarn why`, then check whether App.js renders.',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.kind === 'scope')).toBe(true);
  });

  it('fails unsolicited code blocks on diagnosis-only prompts', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'I am overwhelmed debugging a blank React page. Where should I start?',
      response: 'Check the browser console, then replace the component with:\n```jsx\nexport default () => <div>Hello</div>;\n```',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.kind === 'scope')).toBe(true);
  });

  it('fails contemptuous replies even when they contain a technical word', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'Help me debug this route.',
      response: 'Obviously you broke it, that was stupid. Check the route.',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.kind === 'tone')).toBe(true);
  });

  it('fails generic capability fallback for a real help request', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'I feel overwhelmed building this chat app. What should I do first?',
      response: 'I don\'t have a confident answer for that yet.\n\n**What I can do:**\n- Build projects\n- Diagnose errors',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.kind === 'drift')).toBe(true);
  });

  it('fails an unrelated first-turn retrieval dump without prior conversation grounding', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'What is the most underrated feature in modern code editors?',
      response: 'Pull the nginx image, copy package.json into the container, run npm install, and use Docker logs to inspect the process.',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.label === 'standalone topic retention')).toBe(true);
  });

  it('passes a focused first-turn answer that engages the current topic immediately', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'What is the most underrated feature in modern code editors?',
      response: 'Structural code navigation is underrated: a good editor lets you jump by symbol, inspect references, and refactor safely without hunting through files.',
    });

    expect(report.verdict).toBe('pass');
  });

  it('fails comparisons that name both options without stating a difference', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'Compare Tauri vs Electron honestly.',
      response: 'Tauri is a framework for desktop apps. Electron is a framework for desktop apps.',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.label === 'real comparison')).toBe(true);
  });

  it('fails dependency-pain answers that define monorepos without diagnosing likely causes', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'Why is my pnpm workspace such a pain with dependencies?',
      response: 'A monorepo contains multiple packages. pnpm workspaces are fast and disk-efficient.',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.label === 'problem diagnosis')).toBe(true);
  });

  it('fails audit-scaling advice that redirects into a generic React scaffold', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'I need ideas for making my audit system more scalable.',
      response: 'The stack choice is the first real decision. Frontend: React. Full-stack: Next.js. Before I scaffold anything, what design do you want?',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.label === 'audit advice scope')).toBe(true);
  });

  it('requires prompt humanizers to preserve semantics through controlled mutations', () => {
    const weak = evaluateChatAnswerQuality({
      prompt: 'Help me design a humanizer for test prompts.',
      response: 'Pick random words and numbers, then substitute them into a template.',
    });
    const strong = evaluateChatAnswerQuality({
      prompt: 'Help me design a humanizer for test prompts.',
      response: 'A good prompt humanizer preserves protected tokens and intent, then applies seeded paraphrase, abbreviation, and typo mutations so every test remains reproducible.',
    });

    expect(weak.verdict).toBe('fail');
    expect(strong.verdict).toBe('pass');
  });

  it('requires smart-friend advice to name concrete conversational qualities', () => {
    const weak = evaluateChatAnswerQuality({
      prompt: 'How do I make this feel like talking to a smart friend?',
      response: 'Be direct and engaging. Ask me about a feature and I will help.',
    });
    const strong = evaluateChatAnswerQuality({
      prompt: 'How do I make this feel like talking to a smart friend?',
      response: 'Use a smart-friend experience with recent context and remembered preferences, match the user\'s tone, and keep the first answer concise.',
    });

    expect(weak.verdict).toBe('fail');
    expect(strong.verdict).toBe('pass');
  });

  it('rejects a partial list when the user explicitly asks for all items', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'Tell me all champions that play mid lane. Give me a dotted list.',
      response: 'Here are some common mid-lane champions:\n- Annie\n- Azir\n- Lux',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.label === 'exhaustive coverage')).toBe(true);
  });

  it('accepts an honest refusal to claim an unverified exhaustive list', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'Tell me all champions that play mid lane. Give me a dotted list.',
      response: 'I cannot verify a complete mid-lane champion roster from memory alone. I need a current official roster or patch dataset before I can honestly label the list exhaustive.',
    });

    expect(report.verdict).toBe('pass');
    expect(report.missing.some((requirement) => requirement.label === 'exhaustive coverage')).toBe(false);
  });

  it('rejects adjacent-domain text that misses the requested roles or lanes', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'what are the roles or lanes called when playing 5v5 league of legends?',
      response: 'A lightweight League of Legends account manager provides auto-login, auto-queue, and client enhancement tools.',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.label === 'core request focus')).toBe(true);
  });

  it('rejects an unrelated yes answer for a requested champion list', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'Can you also tell me all of the champions that play in the mid lane? Give me a dotted list.',
      response: 'Yes - here is a playlist with all the videos from a RuneScape community post.',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.label === 'core request focus')).toBe(true);
  });

  describe('implicit "A or B" comparison detection (routing/comparison failures)', () => {
    it('requires a real comparison for "X or Y" preference questions', () => {
      for (const prompt of [
        'sqlite or postgres for a local-first desktop app?',
        'is it smarter to bootstrap or raise money for a small saas?',
        'which is better for a solo founder, an ENK or an AS in norway?',
      ]) {
        const vague = evaluateChatAnswerQuality({ prompt, response: 'Both are good options with their own strengths; it depends on your needs.' });
        expect(vague.missing.some((r) => r.label === 'real comparison'), `should demand comparison: ${prompt}`).toBe(true);
        const good = evaluateChatAnswerQuality({ prompt, response: 'For this case, prefer the first: it is faster and simpler to operate, whereas the second is better for multi-user write load. Pick the first unless you need concurrency.' });
        expect(good.missing.some((r) => r.label === 'real comparison'), `good answer satisfies: ${prompt}`).toBe(false);
      }
    });

    it('does not demand a comparison for yes/no or single-subject questions', () => {
      for (const prompt of ['should I use a VPN or not?', 'what is recursion?', 'tell me about norway or its capital']) {
        const r = evaluateChatAnswerQuality({ prompt, response: 'A short relevant answer.' });
        expect(r.requirements.some((x) => x.label === 'real comparison'), `no comparison req: ${prompt}`).toBe(false);
      }
    });
  });

  describe('concrete grounding (closes the ×247 escalated gap)', () => {
    it('flags a vague answer when the prompt explicitly asks for an example', () => {
      const report = evaluateChatAnswerQuality({
        prompt: 'How would I debounce a function in JavaScript? Give me an example.',
        response: 'You can debounce by delaying execution until activity stops. It is a common technique that improves performance and is widely used in modern apps.',
      });

      expect(report.missing.some((requirement) => requirement.label === 'concrete grounding')).toBe(true);
    });

    it('passes when the answer cites a concrete specific (code / number / worked example)', () => {
      const report = evaluateChatAnswerQuality({
        prompt: 'How would I debounce a function in JavaScript? Give me an example.',
        response: 'Use a timer. For example: `function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }` — a 300 ms delay is typical for input handlers.',
      });

      expect(report.missing.some((requirement) => requirement.label === 'concrete grounding')).toBe(false);
    });

    it('passes a how-much prompt when the answer gives a number', () => {
      const report = evaluateChatAnswerQuality({
        prompt: 'How much memory does the model use?',
        response: 'qwen2.5-coder:7b pins about 5.2 GB of VRAM while resident.',
      });

      expect(report.missing.some((requirement) => requirement.label === 'concrete grounding')).toBe(false);
    });

    it('does not invent the requirement when no concrete is requested (false-positive guard)', () => {
      const report = evaluateChatAnswerQuality({
        prompt: 'Why do you prefer local-first AI?',
        response: 'Local-first keeps things private and free. It avoids per-call costs and works offline, which fits the project north-star.',
      });

      expect(report.requirements.some((requirement) => requirement.label === 'concrete grounding')).toBe(false);
    });
  });
});
