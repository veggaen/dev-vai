import { describe, expect, it } from 'vitest';
import { CONVERSATION_MODE_SYSTEM_PROMPTS } from '../src/chat/modes.js';

describe('conversation mode prompts', () => {
  it('keeps builder mode focused on from-scratch builds by default', () => {
    const prompt = CONVERSATION_MODE_SYSTEM_PROMPTS.builder;
    expect(prompt).toMatch(/create it from scratch as runnable file blocks/i);
    expect(prompt).toMatch(/only emit sandbox template deploy markers when the user explicitly asks/i);
  });

  it('keeps a verified lucide-react icon shortlist in builder mode', () => {
    const prompt = CONVERSATION_MODE_SYSTEM_PROMPTS.builder;
    expect(prompt).toMatch(/LUCIDE-REACT ICONS \(v1\.7\)/i);
    expect(prompt).toMatch(/LayoutDashboard/i);
    expect(prompt).toMatch(/ShoppingCart/i);
    expect(prompt).toMatch(/Sparkles/i);
    expect(prompt).toMatch(/choose one from this list instead of guessing/i);
  });

  it('keeps agent mode from defaulting normal builds onto templates', () => {
    const prompt = CONVERSATION_MODE_SYSTEM_PROMPTS.agent;
    expect(prompt).toMatch(/prefer from-scratch project files or direct file edits/i);
    expect(prompt).toMatch(/only use sandbox template deploy markers when the user explicitly asks/i);
  });

  it('lets chat mode update the active preview app in place when the user explicitly asks', () => {
    const prompt = CONVERSATION_MODE_SYSTEM_PROMPTS.chat;
    expect(prompt).toMatch(/output only the changed files using title="path\/to\/file" blocks/i);
    expect(prompt).toMatch(/keep the current sandbox\/project attached across follow-up edits/i);
  });

  it('lets chat mode emit runnable output for explicit build-now requests', () => {
    const prompt = CONVERSATION_MODE_SYSTEM_PROMPTS.chat;
    expect(prompt).toMatch(/do not stop at advice or planning/i);
    expect(prompt).toMatch(/emit either sandbox action markers or complete runnable files using title="path\/to\/file" code blocks/i);
  });

  it('appends sandbox deploy/template context to agent and builder modes', () => {
    expect(CONVERSATION_MODE_SYSTEM_PROMPTS.agent).toMatch(/SANDBOX TEMPLATES AND DEPLOYS/i);
    expect(CONVERSATION_MODE_SYSTEM_PROMPTS.agent).toMatch(/\{\{deploy:stackId:tier:Display Name\}\}/);
    expect(CONVERSATION_MODE_SYSTEM_PROMPTS.builder).toMatch(/SANDBOX TEMPLATES AND DEPLOYS/i);
  });

  it('documents the express-hexa hexagonal template marker', () => {
    expect(CONVERSATION_MODE_SYSTEM_PROMPTS.agent).toMatch(/\{\{template:express-hexa:Hexagonal Express API\}\}/);
    expect(CONVERSATION_MODE_SYSTEM_PROMPTS.builder).toMatch(/express-hexa/i);
    expect(CONVERSATION_MODE_SYSTEM_PROMPTS.builder).toMatch(/ports-and-adapters/i);
  });

  it('embeds shared engineering discipline (think / simplicity / surgical / goal-driven)', () => {
    for (const mode of ['chat', 'agent', 'builder', 'plan'] as const) {
      const p = CONVERSATION_MODE_SYSTEM_PROMPTS[mode];
      expect(p).toMatch(/ENGINEERING DISCIPLINE/i);
      expect(p).toMatch(/Think before coding/i);
      expect(p).toMatch(/Simplicity first/i);
      expect(p).toMatch(/Surgical changes/i);
      expect(p).toMatch(/Goal-driven execution/i);
    }
    expect(CONVERSATION_MODE_SYSTEM_PROMPTS.debate).toMatch(/simplicity and surgical scope/i);
  });
});