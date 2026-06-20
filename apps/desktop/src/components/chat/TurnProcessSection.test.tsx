import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnProcessSection } from './TurnProcessSection.js';
import { ProcessTree } from './ProcessTree.js';
import type { ChatProgressStep } from '../../stores/chatStore.js';

describe('TurnProcessSection', () => {
  it('renders ProcessTree waiting state with no steps while streaming', () => {
    const html = renderToStaticMarkup(<TurnProcessSection isStreaming steps={[]} />);
    expect(html).toContain('process-tree');
    expect(html).toContain('Thinking');
  });

  it('renders expandable process tree rows as steps arrive', () => {
    const steps: ChatProgressStep[] = [
      { stage: 'reason', label: 'Working through it', status: 'done' },
      {
        stage: 'council-vai-round-1',
        label: 'Council reviewing Vai\'s proposal',
        status: 'running',
        councilMembers: [{
          name: 'Qwen',
          topic: 'factual',
          verdict: 'needs-work',
          confidence: 0.4,
        }],
      },
    ];
    const html = renderToStaticMarkup(<TurnProcessSection isStreaming steps={steps} />);
    expect(html).toContain('process-tree');
    expect(html).toContain('Working through it');
  });

  it('keeps Council R1 visible when Council R2 is added below it live', () => {
    const steps: ChatProgressStep[] = [
      {
        stage: 'council-vai-round-1',
        label: 'Council asked Vai to revise',
        status: 'done',
      },
      {
        stage: 'vai-redraft',
        label: 'Vai redrafted from council feedback',
        status: 'done',
      },
      {
        stage: 'council-vai-round-2',
        label: 'Council re-reviewing the revised draft',
        status: 'running',
      },
    ];

    const html = renderToStaticMarkup(<ProcessTree live steps={steps} />);
    expect(html).toContain('Council R1');
    expect(html).toContain('Council R2');
    expect(html.indexOf('Council R1')).toBeLessThan(html.indexOf('Council R2'));
  });
});
