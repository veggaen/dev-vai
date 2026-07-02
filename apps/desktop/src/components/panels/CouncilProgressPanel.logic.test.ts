import { describe, expect, it } from 'vitest';
import { buildMemberRows, buildOutcomeLine, buildReasoningPanelModel } from './CouncilProgressPanel.logic.js';
import type { CouncilThinkingUI } from '../../stores/chatStore.js';

const base: CouncilThinkingUI = {
  outcome: 'act',
  agreement: 0.66,
  confidence: 0.7,
  topic: 'factual',
  summary: 'Panel approved with one dissent.',
  realIntent: 'Compare the two options and recommend one.',
  recommendedAction: 'search-web',
  missingCapabilities: ['No live price feed'],
  methodLessons: ['Cite the fetched source inline.'],
  members: [
    { name: 'Local qwen3:8b', topic: 'code', verdict: 'good', confidence: 0.82, action: 'ship', note: 'Grounded and current.\nSecond line detail.' },
    { name: 'deepseek-r1', topic: 'reasoning', verdict: 'needs-work', confidence: 0.44, action: 'redraft', note: 'Missed the follow-up intent.' },
    { name: 'gemma2', topic: 'review', verdict: 'bad', confidence: 0.3, action: 'redraft', note: '', failed: true },
  ],
};

describe('buildOutcomeLine', () => {
  it('act outcome names the action in plain words with agreement as a quiet suffix', () => {
    const line = buildOutcomeLine(base);
    expect(line.sentence).toBe('Act first — search the web before answering.');
    expect(line.suffix).toBe('66% agreement');
    expect(line.tone).toBe('warn');
  });

  it('ship outcome reads as approved', () => {
    const line = buildOutcomeLine({ ...base, outcome: 'ship', agreement: 0.9 });
    expect(line.sentence).toBe('Approved — good to send.');
    expect(line.suffix).toBe('90% agreement');
    expect(line.tone).toBe('good');
  });

  it('escalate outcome reads as a handoff', () => {
    expect(buildOutcomeLine({ ...base, outcome: 'escalate' }).sentence).toBe('Handed to a stronger model.');
  });

  it('act with no useful recommended action still reads as a sentence', () => {
    expect(buildOutcomeLine({ ...base, recommendedAction: '' }).sentence).toBe('Act first before answering.');
  });
});

describe('buildMemberRows', () => {
  it('maps a responding member to a quiet prose position (no verdict jargon)', () => {
    const rows = buildMemberRows(base.members);
    expect(rows[0]).toMatchObject({ name: 'qwen3:8b', stance: 'good' });
    expect(rows[0]?.position).toBe('looks solid · 82% — Grounded and current.');
    expect(rows[0]?.fullNote).toContain('Second line detail.');
    expect(rows[1]?.position).toContain('wants another pass · 44%');
  });

  it('a failed member renders one muted silent line', () => {
    const rows = buildMemberRows(base.members);
    expect(rows[2]).toMatchObject({ stance: 'silent', position: "didn't get back in time", fullNote: '' });
  });
});

describe('buildReasoningPanelModel', () => {
  it('assembles outcome, members, lessons, gaps and the intent read', () => {
    const model = buildReasoningPanelModel(base);
    expect(model.members).toHaveLength(3);
    expect(model.noResponders).toBe(false);
    expect(model.lessons).toEqual(['Cite the fetched source inline.']);
    expect(model.gaps).toEqual(['No live price feed']);
    expect(model.readAs).toBe('Compare the two options and recommend one.');
  });

  it('flags no-responders so the panel renders the outcome line only', () => {
    const model = buildReasoningPanelModel({
      ...base,
      members: base.members.map((m) => ({ ...m, failed: true })),
    });
    expect(model.noResponders).toBe(true);
  });
});
