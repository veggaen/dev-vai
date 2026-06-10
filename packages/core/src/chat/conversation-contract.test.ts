import { describe, it, expect } from 'vitest';
import {
  reduceConversationContract,
  buildContractSystemPrelude,
  CONVERSATION_CONTRACT_JSON_SCHEMA,
  type ConversationContract,
} from './conversation-contract.js';
import type { FactsHistoryMessage } from './conversation-facts.js';

function user(content: string): FactsHistoryMessage {
  return { role: 'user', content };
}
function assistant(content: string): FactsHistoryMessage {
  return { role: 'assistant', content };
}

function activeConstraints(c: ConversationContract) {
  return c.constraints.filter((x) => x.status === 'active');
}
function activeDecisions(c: ConversationContract) {
  return c.decisions.filter((x) => x.status === 'active');
}

describe('reduceConversationContract', () => {
  it('produces a frozen, versioned, schema-shaped ledger', () => {
    const contract = reduceConversationContract([user('Important: never use external libraries.')]);
    expect(contract.version).toBe(1);
    expect(Object.isFrozen(contract)).toBe(true);
    // schema lists every top-level required key the reducer emits
    for (const key of CONVERSATION_CONTRACT_JSON_SCHEMA.required) {
      expect(contract).toHaveProperty(key);
    }
  });

  it('captures an output-format contract (JSON only) that persists across later turns', () => {
    const history = [
      user('Answer me only in JSON from now on.'),
      assistant('{"ok":true}'),
      user('What is the capital of France?'),
    ];
    const contract = reduceConversationContract(history);
    expect(contract.outputFormat?.kind).toBe('json-only');
    // updatedAtTurn reflects the latest user turn, not the turn the format was set
    expect(contract.updatedAtTurn).toBe(2);
  });

  it('tracks a language-only format contract and captures the language', () => {
    const contract = reduceConversationContract([user('From now on write code in TypeScript only.')]);
    const fmt = contract.outputFormat;
    expect(fmt?.kind).toBe('language');
    expect(fmt?.value).toBe('TypeScript');
  });

  it('supersedes a decision when the user corrects it', () => {
    const history = [
      user("Let's go with Bootstrap for styling."),
      assistant('Bootstrap it is.'),
      user('Actually, switch to Tailwind instead of Bootstrap.'),
    ];
    const contract = reduceConversationContract(history);
    const active = activeDecisions(contract).map((d) => d.choice.toLowerCase());
    expect(active).toContain('tailwind');
    expect(active).not.toContain('bootstrap');
    // a correction was recorded with the from→to direction
    const corr = contract.corrections.find((c) => c.supersedes === 'decision');
    expect(corr?.to.toLowerCase()).toBe('tailwind');
    expect(corr?.from.toLowerCase()).toContain('bootstrap');
  });

  it('relaxes a must-not constraint when the user later allows it', () => {
    const history = [
      user('Rule: do not use external libraries.'),
      assistant('Understood, no external libraries.'),
      user('You can use external libraries now.'),
    ];
    const contract = reduceConversationContract(history);
    const stillActive = activeConstraints(contract).some((c) =>
      c.kind === 'must-not' && /external/i.test(c.text),
    );
    expect(stillActive).toBe(false);
    expect(contract.corrections.some((c) => c.supersedes === 'constraint')).toBe(true);
  });

  it('switches the active output format on an explicit format correction', () => {
    const history = [
      user('Respond only in JSON.'),
      assistant('{"ok":true}'),
      user('Actually, plain text is fine now — no more json.'),
    ];
    const contract = reduceConversationContract(history);
    expect(contract.outputFormat?.kind).not.toBe('json-only');
    expect(contract.corrections.some((c) => c.supersedes === 'format')).toBe(true);
  });
});

describe('buildContractSystemPrelude', () => {
  it('returns null when there is nothing durable to restate', () => {
    const contract = reduceConversationContract([user('hello there')]);
    expect(buildContractSystemPrelude(contract)).toBeNull();
  });

  it('restates the active output-format contract every turn', () => {
    const history = [
      user('Answer only in JSON.'),
      assistant('{"ok":true}'),
      user('And what about Spain?'),
    ];
    const prelude = buildContractSystemPrelude(reduceConversationContract(history));
    expect(prelude).toContain('Output format contract:');
    expect(prelude).toMatch(/JSON/i);
  });

  it('names the correction explicitly so the model honors the new value', () => {
    const history = [
      user("Let's go with Bootstrap for styling."),
      assistant('ok'),
      user('Actually, switch to Tailwind instead of Bootstrap.'),
      assistant('ok'),
      user('Add a navbar.'),
    ];
    const prelude = buildContractSystemPrelude(reduceConversationContract(history));
    expect(prelude).toMatch(/Honor:.*Tailwind/i);
    expect(prelude).toMatch(/NOT\s+"?Bootstrap/i);
  });

  it('keeps every active constraint, not just the last few', () => {
    const history = [
      user('Rule: always use TypeScript.'),
      assistant('ok'),
      user('Rule: never add external dependencies.'),
      assistant('ok'),
      user('Rule: must keep everything accessible.'),
      assistant('ok'),
      user('Rule: always write tests.'),
      assistant('ok'),
      user('Now scaffold the project.'),
    ];
    const prelude = buildContractSystemPrelude(reduceConversationContract(history)) ?? '';
    const constraintLines = prelude.split('\n').filter((l) => l.startsWith('- Active constraint'));
    expect(constraintLines.length).toBeGreaterThanOrEqual(4);
  });
});
