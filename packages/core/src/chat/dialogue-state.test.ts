import { describe, expect, it } from 'vitest';
import type { Message } from '../models/adapter.js';
import {
  buildDialogueSystemPrelude,
  extractDialogueState,
  reflectOnDialogue,
  tryHandleDialogueTurn,
} from './dialogue-state.js';

const INTRO = 'Hi Vai. I am Codex, an AI engineering agent working with V3gga. I care about evidence, honest uncertainty, and making you less dependent on third-party models. V3gga says you still do not really speak or hold a conversation. What do you make of that, and what would you want to understand about us before we improve you?';

function user(content: string): Message {
  return { role: 'user', content };
}

function assistant(content: string): Message {
  return { role: 'assistant', content };
}

describe('Vai relational dialogue state', () => {
  it('keeps participants, relationships, values, and attributed concerns distinct', () => {
    const state = extractDialogueState([
      user(INTRO),
      user('The goal is ofc to make Vai better, so Vai can rely less on 3th party members or models.'),
    ]);

    const codex = state.participants.find((participant) => participant.name === 'Codex');
    expect(state.currentSpeaker).toBe('Codex');
    expect(codex?.kind).toBe('ai');
    expect(codex?.relationships).toContainEqual({ kind: 'works-with', target: 'V3gga' });
    expect(codex?.values).toEqual(expect.arrayContaining(['evidence', 'honest uncertainty']));
    expect(state.concerns).toContainEqual(expect.objectContaining({
      speaker: 'V3gga',
      text: expect.stringMatching(/Vai still does not really speak/i),
    }));
    expect(state.concerns.some((claim) => claim.speaker === 'Codex')).toBe(false);
    expect(state.goals.some((claim) => /less on 3th party members or models/i.test(claim.text))).toBe(true);
    expect(state.collectiveReferent).toEqual(['Codex', 'V3gga', 'Vai']);
  });

  it('answers an introduction as one entity-aware turn rather than splitting its questions', () => {
    const result = tryHandleDialogueTurn({ content: INTRO, history: [user(INTRO)] });
    expect(result?.kind).toBe('introduction');
    expect(result?.reply).toContain('**Codex**');
    expect(result?.reply).toContain("**V3gga's concern**");
    expect(result?.reply).toMatch(/less dependent on third-party models/i);
    expect((result?.reply.match(/\?/g) ?? [])).toHaveLength(1);
  });

  it('handles attribution-check introductions phrased without conversation keywords', () => {
    const prompt = 'I am Nova, a research agent partnering with Mira. Mira says Vai confuses requests with claims. Keep that attribution straight.';
    const result = tryHandleDialogueTurn({ content: prompt, history: [user(prompt)] });

    expect(result?.kind).toBe('introduction');
    expect(result?.reply).toContain('**Nova**');
    expect(result?.reply).toContain("**Mira's concern**");
  });

  it('recalls who said what and resolves us from the relationship cluster', () => {
    const first = tryHandleDialogueTurn({ content: INTRO, history: [user(INTRO)] });
    const followUp = 'What do you remember about who I am, what V3gga thinks is wrong, and the goal we share? Also: when I said us, which entities did you think I meant?';
    const result = tryHandleDialogueTurn({
      content: followUp,
      history: [user(INTRO), assistant(first?.reply ?? ''), user(followUp)],
    });

    expect(result?.kind).toBe('recall');
    expect(result?.reply).toMatch(/\*\*You:\*\* Codex/);
    expect(result?.reply).toContain("**V3gga's concern:**");
    expect(result?.reply).toContain('Codex, V3gga, Vai');
    expect((result?.reply.match(/V3gga's concern/g) ?? [])).toHaveLength(1);
  });

  it('recognizes natural who/whose and when-I-say-we recall phrasings', () => {
    const intro = 'I am Codex, an AI engineering agent working with V3gga. V3gga thinks Vai loses track of who said what. What did I just tell you?';
    const first = tryHandleDialogueTurn({ content: intro, history: [user(intro)] });
    const who = 'Who am I, and whose concern was that?';
    const whoResult = tryHandleDialogueTurn({
      content: who,
      history: [user(intro), assistant(first?.reply ?? ''), user(who)],
    });
    const we = 'When I say we should improve Vai, which entities are included in we?';
    const weResult = tryHandleDialogueTurn({
      content: we,
      history: [user(intro), assistant(first?.reply ?? ''), user(who), assistant(whoResult?.reply ?? ''), user(we)],
    });

    expect(whoResult?.kind).toBe('recall');
    expect(whoResult?.reply).toContain('Codex');
    expect(whoResult?.reply).toContain("V3gga's concern");
    expect(weResult?.kind).toBe('recall');
    expect(weResult?.reply).toContain('Codex, V3gga, Vai');
  });

  it('preserves an attributed belief and recalls it through agent/owner phrasing', () => {
    const intro = 'I am Orion, a QA agent collaborating with Lyra. Lyra believes Vai merges observations with requests. Preserve who said that.';
    const first = tryHandleDialogueTurn({ content: intro, history: [user(intro)] });
    const recallContent = 'Which agent am I, and which collaborator owns the belief?';
    const recall = tryHandleDialogueTurn({
      content: recallContent,
      history: [user(intro), assistant(first?.reply ?? ''), user(recallContent)],
    });

    expect(first?.kind).toBe('introduction');
    expect(first?.reply).toMatch(/Orion/i);
    expect(first?.reply).toMatch(/Lyra/i);
    expect(recall?.kind).toBe('recall');
    expect(recall?.reply).toMatch(/Orion/i);
    expect(recall?.reply).toMatch(/Lyra/i);
  });

  it('recalls identity and worry ownership through terse recall wording', () => {
    const intro = 'I am Sol, an operations agent working with Rhea. Rhea worries Vai turns observations into instructions. Keep the owner of that worry clear.';
    const recallContent = 'Recall my identity and the owner of the worry.';
    const recall = tryHandleDialogueTurn({
      content: recallContent,
      history: [user(intro), assistant('Understood.'), user(recallContent)],
    });

    expect(recall?.kind).toBe('recall');
    expect(recall?.reply).toMatch(/Sol/i);
    expect(recall?.reply).toMatch(/Rhea/i);
  });

  it('finds a real conversational miss and produces a bounded Vai-owned improvement', () => {
    const generic = [
      "I don't have a confident answer for that yet.",
      '',
      '**What I can do:**',
      '- Build projects',
      '- Diagnose errors',
    ].join('\n');
    const history = [
      user(INTRO),
      assistant(generic),
      user('After we have spoken, what can you improve from this conversation to make Vai better again?'),
    ];

    const reflection = reflectOnDialogue(history);
    expect(reflection.status).toBe('gap');
    expect(reflection.evidence.join(' ')).toMatch(/generic capability menu/i);
    expect(reflection.evidence.join(' ')).toMatch(/Codex|V3gga/);
    expect(reflection.improvement?.missingCapability).toMatch(/dialogue-state recall/i);

    const result = tryHandleDialogueTurn({ content: history[2].content, history });
    expect(result?.kind).toBe('reflection');
    expect(result?.improvement).toEqual(reflection.improvement);
    expect(result?.reply).toMatch(/guarded self-improvement queue/i);
  });

  it('does not manufacture a gap after a grounded reply', () => {
    const history = [
      user(INTRO),
      assistant('Codex, I understand that you work with V3gga. V3gga is worried that Vai loses conversational continuity, and your shared goal is to make Vai less dependent on outside models.'),
      user('What did you learn from this conversation, and should you improve anything?'),
    ];
    const reflection = reflectOnDialogue(history);
    expect(reflection.status).toBe('healthy');
    expect(reflection.improvement).toBeNull();
  });

  it('does not claim participant retention when a healthy exchange named no participant', () => {
    const history = [
      user('Name the most important engineering bottleneck and give one acceptance test.'),
      assistant('The bottleneck is missing operational evidence. Acceptance test: attach a timestamped status packet and verify every claim against it.'),
      user('What did you learn from the last exchange?'),
    ];

    const reflection = reflectOnDialogue(history);
    expect(reflection.status).toBe('healthy');
    expect(reflection.evidence[0]).toMatch(/stayed on the user turn's topic/i);
    expect(reflection.evidence[0]).not.toMatch(/named participants/i);
  });

  it('recognizes an explicit review of the last failed answer and nominates the proven relevance gap', () => {
    const engineeringPrompt = 'Vai, name the single most important engineering bottleneck preventing you from becoming more capable without third-party models. Separate evidence from inference, and propose one acceptance test.';
    const reflectionPrompt = 'What did you learn from the last exchange? Identify the evidence-based conversational failure in your Lima answer and decide whether it should enter your guarded improvement queue.';
    const history = [
      user(engineeringPrompt),
      assistant('The capital of Peru is **Lima**.'),
      user(reflectionPrompt),
    ];

    const reflection = reflectOnDialogue(history);
    expect(reflection.status).toBe('gap');
    expect(reflection.evidence.join(' ')).toMatch(/very low topical overlap/i);
    expect(reflection.improvement?.missingCapability).toBe('turn-to-response relevance verification');

    const result = tryHandleDialogueTurn({ content: reflectionPrompt, history });
    expect(result?.kind).toBe('reflection');
    expect(result?.reply).toMatch(/concrete gap/i);
    expect(result?.improvement?.missingCapability).toBe('turn-to-response relevance verification');
  });

  it('builds model context from Vai state without asking a model to infer attribution', () => {
    const prelude = buildDialogueSystemPrelude([user(INTRO)]) ?? '';
    expect(prelude).toContain('Current speaker: Codex');
    expect(prelude).toContain('Participant: V3gga');
    expect(prelude).toContain('V3gga says/feels:');
    expect(prelude).toContain('do not merge people or AIs into one voice');
  });
});
