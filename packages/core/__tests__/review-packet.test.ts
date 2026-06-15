import { describe, expect, it } from 'vitest';
import {
  buildContextSummary,
  buildCouncilReviewPacket,
  trimRelevantHistory,
  trimRetrievedSnippets,
} from '../src/consensus/review-packet.js';

describe('review-packet', () => {
  it('trims history to salient recent messages, not the full thread', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: i === 18
        ? 'Can you explain JavaScript closures with a runnable example?'
        : `filler message ${i} about unrelated weather and sports`,
    }));
    const relevant = trimRelevantHistory(history, 'Explain JavaScript closures with a runnable example');
    expect(relevant.length).toBeLessThanOrEqual(6);
    expect(relevant.some((m) => /closure/i.test(m.content))).toBe(true);
    expect(relevant[0]?.content).not.toMatch(/^filler message 0/);
  });

  it('caps retrieved snippets and trims long bodies', () => {
    const snippets = trimRetrievedSnippets(Array.from({ length: 8 }, (_, i) => ({
      title: `Source ${i}`,
      url: `https://example.com/${i}`,
      snippet: 'x'.repeat(400),
    })));
    expect(snippets).toHaveLength(5);
    expect(snippets[0]?.snippet?.length).toBeLessThanOrEqual(280);
  });

  it('builds a compact context summary', () => {
    const summary = buildContextSummary(
      {
        prompt: 'What is the capital of Norway?',
        draftText: 'Oslo.',
        modelId: 'vai:v0',
        turnKind: 'chat',
        confidence: 0.82,
        hasEvidence: true,
      },
      [{ role: 'user', content: 'Earlier we talked about Scandinavia.' }],
      [{ title: 'Wikipedia', snippet: 'Oslo is the capital.' }],
    );
    expect(summary).toContain('turn=chat');
    expect(summary).toContain('evidence=attached');
    expect(summary).toContain('history=1 msg');
    expect(summary).toContain('snippets=1');
  });

  it('buildCouncilReviewPacket returns all focused fields together', () => {
    const packet = buildCouncilReviewPacket({
      prompt: 'Fix my React table re-render issue',
      draftText: 'Try memoizing rows.',
      modelId: 'local:qwen',
      history: [
        { role: 'user', content: 'My React table re-renders on every filter change.' },
        { role: 'assistant', content: 'That usually means unstable props.' },
      ],
      sources: [{ title: 'React docs', snippet: 'memo prevents unnecessary re-renders.' }],
      hasEvidence: true,
    });
    expect(packet.contextSummary).toMatch(/turn=chat|evidence=attached/);
    expect(packet.relevantHistory?.length).toBeGreaterThan(0);
    expect(packet.retrievedSnippets?.length).toBe(1);
  });
});
