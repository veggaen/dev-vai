import { describe, expect, it } from 'vitest';
import type { Message } from '../models/adapter.js';
import {
  rewritePronounFollowUp,
  detectUserName,
  detectRecallQuestion,
  recallUserAttribute,
  recallFromConversation,
  recallAssistantContactDetail,
  rewriteBusinessContactLookupFollowUp,
  isEpisodicOrPersonalInput,
  inferBoldTopic,
  cleanTopic,
} from './contextual-resolver.js';

const turn = (role: Message['role'], content: string): Message => ({ role, content });

describe('rewritePronounFollowUp', () => {
  it('resolves "there" (place) to "in <topic>"', () => {
    expect(rewritePronounFollowUp('how many people live there?', 'Oslo'))
      .toBe('how many people live in Oslo?');
  });

  it('resolves "one" to "a <topic>"', () => {
    expect(rewritePronounFollowUp('would you recommend using one?', 'VPN'))
      .toBe('would you recommend using a VPN?');
  });

  it('resolves "it" to "<topic>"', () => {
    expect(rewritePronounFollowUp('is it bigger than Sweden?', 'Norway'))
      .toBe('is Norway bigger than Sweden?');
  });

  it('cleans a parenthetical topic before substituting', () => {
    expect(rewritePronounFollowUp('would you recommend using one?', 'VPN (Virtual Private Network)'))
      .toBe('would you recommend using a VPN?');
  });

  it('does NOT rewrite when the topic is already named', () => {
    expect(rewritePronounFollowUp('is Oslo bigger than Bergen?', 'Oslo')).toBeNull();
  });

  it('does NOT rewrite long standalone questions', () => {
    expect(rewritePronounFollowUp('what is the population of the largest city in the country to the north?', 'Oslo')).toBeNull();
  });

  it('does NOT rewrite a non-question statement', () => {
    expect(rewritePronounFollowUp('i like it a lot', 'Oslo')).toBeNull();
  });

  it('does NOT rewrite imperative build/action requests ("it" = the thing to build)', () => {
    expect(rewritePronounFollowUp('can you make it for me now?', 'commerce store')).toBeNull();
    expect(rewritePronounFollowUp('build it now', 'commerce store')).toBeNull();
    expect(rewritePronounFollowUp('do it', 'commerce store')).toBeNull();
  });

  it('does NOT attach a stale topic to complete short standalone questions', () => {
    expect(rewritePronounFollowUp('does spotify have podcasts?', 'Vetle')).toBeNull();
    expect(rewritePronounFollowUp('what is docker?', 'Vetle')).toBeNull();
  });

  it('attaches the topic to a genuinely subjectless short follow-up', () => {
    expect(rewritePronounFollowUp('how many?', 'Podcast titles'))
      .toBe('how many (about Podcast titles)?');
  });

  it('tolerates non-string input without throwing', () => {
    expect(rewritePronounFollowUp(null as unknown as string, 'Oslo')).toBeNull();
    expect(rewritePronounFollowUp(123 as unknown as string, 'Oslo')).toBeNull();
  });
});

describe('detectUserName', () => {
  it('detects a stated name', () => {
    expect(detectUserName([turn('user', "hey, i'm vetle")])).toBe('Vetle');
    expect(detectUserName([turn('user', 'my name is Astrid')])).toBe('Astrid');
  });
  it('ignores false positives like "i\'m asking"', () => {
    expect(detectUserName([turn('user', "i'm asking about docker")])).toBeNull();
    expect(detectUserName([turn('user', "i'm fuzzy on CAP theorem tradeoffs")])).toBeNull();
    expect(detectUserName([turn('user', 'I am overwhelmed debugging a blank React page.')])).toBeNull();
  });
});

describe('dynamic recall', () => {
  it('detects recall questions + the attribute', () => {
    expect(detectRecallQuestion('what was my name again?')).toEqual({ attribute: 'name' });
    expect(detectRecallQuestion('who am i?')).toEqual({ attribute: 'name' });
    expect(detectRecallQuestion("what's my favorite color?")).toEqual({ attribute: 'favorite color' });
    expect(detectRecallQuestion('remind me my job')).toEqual({ attribute: 'job' });
    expect(detectRecallQuestion('what is the capital of france?')).toBeNull();
  });

  it('recalls an arbitrary stated attribute', () => {
    const h = [turn('user', 'my favorite color is teal'), turn('assistant', 'nice')];
    expect(recallUserAttribute(h, 'favorite color')).toBe('teal');
  });

  it('recalls the name', () => {
    expect(recallUserAttribute([turn('user', "i'm vetle")], 'name')).toBe('Vetle');
  });

  it('answers a recall question from history, or honestly says it is unknown', () => {
    const h = [turn('user', "hey i'm vetle"), turn('assistant', 'hi'), turn('user', 'what was my name again?')];
    expect(recallFromConversation('what was my name again?', h)).toBe('Your name is **Vetle**.');
    expect(recallFromConversation('what is my job?', h)).toMatch(/haven't told me your job/i);
    expect(recallFromConversation('what is the capital of france?', h)).toBeNull();
  });
});

describe('isEpisodicOrPersonalInput (episodic↔semantic guard)', () => {
  it('flags greetings + personal statements as episodic (do NOT learn as facts)', () => {
    expect(isEpisodicOrPersonalInput("hey, i'm vetle")).toBe(true);
    expect(isEpisodicOrPersonalInput('i am building a todo app')).toBe(true);
    expect(isEpisodicOrPersonalInput('thanks!')).toBe(true);
    expect(isEpisodicOrPersonalInput('i like dark mode')).toBe(true);
  });

  it('does NOT flag real knowledge questions (their answers should be learned)', () => {
    expect(isEpisodicOrPersonalInput('what is docker?')).toBe(false);
    expect(isEpisodicOrPersonalInput('i want to know who is king in norway')).toBe(false);
    expect(isEpisodicOrPersonalInput('does starbucks make cappuccino?')).toBe(false);
  });
});

describe('assistant contact detail recall', () => {
  const restaurantAnswer = [
    'I found these currently listed options:',
    '- **Pizzabakeren Hommersåk** - pizza. Phone: +47 51 62 74 00. [1]',
    '- **Al Forno** - italian. Phone: +47 41 77 77 17. [2]',
  ].join('\n');

  it('resolves a compact business abbreviation against prior assistant evidence', () => {
    const history = [
      turn('assistant', restaurantAnswer),
      turn('user', 'what was the phone number to pb hommersåk?'),
    ];

    expect(recallAssistantContactDetail('what was the phone number to pb hommersåk?', history)).toEqual({
      entity: 'Pizzabakeren Hommersåk',
      phone: '+47 51 62 74 00',
    });
  });

  it('does not guess when a contact question is ambiguous', () => {
    expect(recallAssistantContactDetail('what was the phone number?', [
      turn('assistant', restaurantAnswer),
    ])).toBeNull();
  });

  it('carries the prior phone request into an explicit online correction', () => {
    const history = [
      turn('assistant', restaurantAnswer),
      turn('user', 'what was the phone number to pb hommersåk?'),
      turn('assistant', 'I am not sure.'),
      turn('user', 'you should find it online pizza bakeren hommersåk'),
    ];

    expect(rewriteBusinessContactLookupFollowUp(
      'you should find it online pizza bakeren hommersåk',
      history,
    )).toBe('find the phone number online for Pizzabakeren Hommersåk');
  });
});

describe('inferBoldTopic / cleanTopic', () => {
  it('pulls the bolded entity from the last assistant turn', () => {
    expect(inferBoldTopic([turn('assistant', 'The capital of Norway is **Oslo**.')])).toBe('Oslo');
  });
  it('cleans parentheticals and markdown', () => {
    expect(cleanTopic('**VPN (Virtual Private Network)**')).toBe('VPN');
  });
});
