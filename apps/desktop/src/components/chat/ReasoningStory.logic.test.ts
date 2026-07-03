import { describe, expect, it } from 'vitest';
import { buildStoryLines } from './ReasoningStory.logic.js';
import type { TimelinePhase } from './Timeline.logic.js';
import type { ProcessNode } from './ProcessTree.logic.js';
import type { CouncilThinkingUI } from '../../stores/chatStore.js';

const node = (over: Partial<ProcessNode> & { id: string; label: string }): ProcessNode => ({
  detail: undefined,
  note: undefined,
  status: 'done',
  children: [],
  ...over,
} as ProcessNode);

const phase = (over: Partial<TimelinePhase> & { id: string; title: string }): TimelinePhase => ({
  phase: 'understand',
  summary: '',
  status: 'done',
  round: 1,
  nodes: [],
  ...over,
} as TimelinePhase);

const council: CouncilThinkingUI = {
  outcome: 'ship',
  agreement: 0.8,
  confidence: 0.82,
  topic: 'code',
  summary: 'Approved.',
  realIntent: 'Fix the login bug without touching the session store.',
  recommendedAction: '',
  missingCapabilities: [],
  methodLessons: [],
  members: [
    { name: 'Local qwen2.5:3b', topic: 'code', verdict: 'good', confidence: 0.82, action: 'ship', note: 'Grounded and current.\nMore detail.' },
    { name: 'deepseek-r1', topic: 'reasoning', verdict: 'needs-work', confidence: 0.44, action: 'redraft', note: 'Missed the follow-up.' },
  ],
};

describe('buildStoryLines', () => {
  it('leads with the intent read when the council surfaced one', () => {
    const lines = buildStoryLines([phase({ id: 'p1', title: 'Understanding the ask' })], council);
    expect(lines[0]).toMatchObject({ speaker: 'Vai', role: 'vai' });
    expect(lines[0].text).toContain('Fix the login bug');
  });

  it('narrates a phase as one attributed prose line (summary preferred over title)', () => {
    const lines = buildStoryLines([
      phase({ id: 'p1', title: 'Gather', summary: 'Pulled 3 sources on session tokens' }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ speaker: 'Vai', text: 'Pulled 3 sources on session tokens' });
  });

  it('renders peers speaking TO Vai with verdict, confidence and note', () => {
    const p = phase({
      id: 'p2',
      title: 'Council',
      nodes: [node({
        id: 'root', label: 'Council round',
        children: [node({ id: 'm1', label: 'Local qwen2.5:3b', kind: 'submodel' })],
      })],
    });
    const lines = buildStoryLines([p], council);
    const peer = lines.find((l) => l.role === 'peer');
    expect(peer).toMatchObject({ speaker: 'qwen2.5:3b', to: 'Vai', tone: 'good' });
    expect(peer?.text).toContain('looks solid');
    expect(peer?.text).toContain('82%');
    expect(peer?.text).toContain('Grounded and current.');
  });

  it('a failed peer reads as silent, never as an error', () => {
    const failedCouncil = { ...council, members: [{ ...council.members[0], failed: true }] };
    const p = phase({
      id: 'p2', title: 'Council',
      nodes: [node({ id: 'r', label: 'round', children: [node({ id: 'm', label: 'Local qwen2.5:3b', kind: 'submodel' })] })],
    });
    const peer = buildStoryLines([p], failedCouncil).find((l) => l.role === 'peer');
    expect(peer).toMatchObject({ tone: 'neutral', text: "didn't get back in time" });
  });

  it('gates rule in tone: approved=good, sent back=warn, with confidence and reason', () => {
    const approved = phase({ id: 'g1', title: 'Gate', gate: { approved: true, confidence: 0.92, reason: '3/3 members approved' } as TimelinePhase['gate'] });
    const sentBack = phase({ id: 'g2', title: 'Gate', gate: { approved: false, confidence: 0.4, reason: 'coverage too thin' } as TimelinePhase['gate'] });
    const lines = buildStoryLines([approved, sentBack]);
    expect(lines[0]).toMatchObject({ speaker: 'Council', to: 'Vai', role: 'gate', tone: 'good' });
    expect(lines[0].text).toContain('Approved at 92%');
    expect(lines[1]).toMatchObject({ tone: 'warn' });
    expect(lines[1].text).toContain('Sent back');
    expect(lines[1].text).toContain('coverage too thin');
  });

  it('running phases stream as live lines', () => {
    const lines = buildStoryLines([phase({ id: 'p1', title: 'Drafting the answer', status: 'running' })]);
    expect(lines[0].live).toBe(true);
  });

  it('bounds the feed on very long turns, keeping the newest lines', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      phase({ id: `p${i}`, title: `Step ${i}` }));
    const lines = buildStoryLines(many);
    expect(lines.length).toBeLessThanOrEqual(48);
    expect(lines[lines.length - 1].text).toBe('Step 79');
  });

  it('clips runaway notes to one readable sentence-length line', () => {
    const p = phase({
      id: 'p1', title: 'Think',
      nodes: [node({
        id: 'r', label: 'root',
        children: [node({ id: 't', label: 'Thought', kind: 'reasoning', note: 'x'.repeat(400) })],
      })],
    });
    const noteLine = buildStoryLines([p]).find((l) => l.role === 'note');
    expect(noteLine?.text.length).toBeLessThanOrEqual(180);
    expect(noteLine?.text.endsWith('…')).toBe(true);
  });
});

describe('story truthfulness (screenshot review fixes)', () => {
  it('a skipped council is a quiet system fact, never Vai speech', () => {
    const lines = buildStoryLines([phase({ id: 'c1', title: 'Council could not convene', phase: 'deliberate' })]);
    expect(lines[0]).toMatchObject({ speaker: 'Council', role: 'gate', tone: 'neutral' });
    expect(lines[0].text).toContain('skipped');
  });

  it('compose phases never echo the answer text into the story', () => {
    const lines = buildStoryLines([
      phase({ id: 'd1', title: 'Vai drafts', summary: 'Hey - what do you want me to tackle?', phase: 'compose' }),
    ]);
    expect(lines[0].text).toBe('Drafted the answer');
  });

  it('a bare title above self-explanatory child lines is suppressed', () => {
    const p = phase({
      id: 'p1', title: 'Local model friend continued in the background',
      nodes: [node({ id: 'r', label: 'root', children: [node({ id: 'm', label: 'qwen2.5:3b', kind: 'submodel', note: 'qwen2.5:3b is steering quietly in the background.' })] })],
    });
    const lines = buildStoryLines([p]);
    expect(lines).toHaveLength(1); // only the peer line — no title-as-speech
    expect(lines[0]).toMatchObject({ speaker: 'qwen2.5:3b', role: 'peer' });
    expect(lines[0].text).toContain('steering quietly');
  });
});
