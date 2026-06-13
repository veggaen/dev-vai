import { describe, expect, it } from 'vitest';
import { buildTurnKindSystemHint, classifyChatTurn } from '../src/chat/turn-kind.js';

describe('classifyChatTurn', () => {
  it('classifies greetings as conversational', () => {
    expect(classifyChatTurn({
      userContent: 'hey',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('conversational');
  });

  it('classifies literal echo prompts as conversational', () => {
    expect(classifyChatTurn({
      userContent: "say back to me 'hello'",
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('conversational');
  });

  it('classifies current/discovery prompts as research', () => {
    expect(classifyChatTurn({
      userContent: 'who is top master frontend web dev on github',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('research');
  });

  it('classifies local recommendations as freshness-sensitive research', () => {
    expect(classifyChatTurn({
      userContent: 'what are good resturants in Hommersåk Norway?',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('research');
  });

  it('classifies follower-ranking prompts as research', () => {
    expect(classifyChatTurn({
      userContent: 'who has the most followers then?',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('research');
  });

  it('classifies active sandbox edit requests as builder', () => {
    expect(classifyChatTurn({
      userContent: 'make the button background blue and tighten the spacing',
      mode: 'chat',
      hasActiveSandbox: true,
    })).toBe('builder');
  });

  it('classifies software product nouns such as focus planner as builder', () => {
    expect(classifyChatTurn({
      userContent: 'Build a focus planner with pomodoro sessions, a task list, and a streak counter.',
      mode: 'builder',
      hasActiveSandbox: false,
    })).toBe('builder');
  });

  it('does not treat debugging a named frontend stack as a build request', () => {
    expect(classifyChatTurn({
      userContent: 'I am overwhelmed debugging a blank React page. Where should I start?',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('analysis');
  });

  it('distinguishes advice about starting from an explicit start-build request', () => {
    expect(classifyChatTurn({
      userContent: 'What should I check before I start debugging this portfolio page?',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('analysis');
    expect(classifyChatTurn({
      userContent: 'Start a portfolio page with a project grid and contact form.',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('builder');
  });

  it('does not classify hardware product planning prompts as builder', () => {
    expect(classifyChatTurn({
      userContent: 'I want to build a temperature humidity sensor with ESP32 hardware, casing, firmware, and a SaaS dashboard. What should I order and how should I plan this?',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('analysis');
  });

  it('still classifies explicit software prototypes for hardware products as builder', () => {
    expect(classifyChatTurn({
      userContent: 'Prototype the web dashboard UI for my ESP32 humidity sensor in React now.',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('builder');
  });

  it('classifies normal factual questions as analysis', () => {
    expect(classifyChatTurn({
      userContent: 'what is bun?',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('analysis');
  });

  it('classifies ordinary short requests as analysis', () => {
    expect(classifyChatTurn({
      userContent: 'Tell me briefly',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('analysis');
  });

  it('classifies explicit research commands as research', () => {
    expect(classifyChatTurn({
      userContent: 'do research on udyr passive',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('research');
    expect(classifyChatTurn({
      userContent: 'you should find it online pizza bakeren hommersåk',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('research');
  });

  it('classifies creative writing like haiku as conversational (not builder even with stack words)', () => {
    expect(classifyChatTurn({
      userContent: 'write a haiku about typescript',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('conversational');

    expect(classifyChatTurn({
      userContent: 'write me a short poem about debugging',
      mode: 'builder',
      hasActiveSandbox: true,
    })).toBe('conversational');
  });

  it('classifies casual gamer slang as conversational', () => {
    expect(classifyChatTurn({
      userContent: 'gg wp',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('conversational');

    expect(classifyChatTurn({
      userContent: 'lol brb',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('conversational');
  });

  it('does not treat lol in a substantive game question as casual chat', () => {
    expect(classifyChatTurn({
      userContent: 'list all lol roles',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('analysis');
  });

  it('classifies project review / EVM / HEX-better / fix unfinished contract prompts as analysis (not fact-shim)', () => {
    expect(classifyChatTurn({
      userContent: 'review my unfinished EVM contract and frontend and make it HEX but better',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('analysis');

    expect(classifyChatTurn({
      userContent: 'the project https://github.com/veggaen/EVM-Contract-frontend never got the staking logic and UI working, help fix the MMM_Unified contract and the wagmi frontend',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('analysis');

    expect(classifyChatTurn({
      userContent: 'analyze and improve the phase contribution + staking flows in this solidity + nextjs evm app',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('analysis');
  });
});

describe('buildTurnKindSystemHint', () => {
  it('returns a conversational guidance hint', () => {
    expect(buildTurnKindSystemHint('conversational')).toMatch(/plain conversational turn/i);
  });

  it('returns direct-answer guidance for analysis turns', () => {
    expect(buildTurnKindSystemHint('analysis')).toMatch(/ordinary reasoning or factual turn/i);
    expect(buildTurnKindSystemHint('analysis')).toMatch(/web sources are available/i);
  });
});
