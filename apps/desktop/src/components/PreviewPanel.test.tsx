import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewRepairPrompt, PreviewFailureState } from './preview/PreviewFailureState.js';

describe('Preview failure recovery', () => {
  it('builds a grounded repair prompt from the reported failure', () => {
    const prompt = createPreviewRepairPrompt('Vite exited with code 1');

    expect(prompt).toContain('Vite exited with code 1');
    expect(prompt).toMatch(/identify the root cause/i);
    expect(prompt).toMatch(/verify the rendered app/i);
  });

  it('renders the real cause and explicit recovery actions', () => {
    const html = renderToStaticMarkup(
      <PreviewFailureState
        message="Dependency install failed"
        canRestart
        onRestart={vi.fn()}
        onRepair={vi.fn()}
        onViewConsole={vi.fn()}
      />,
    );

    expect(html).toContain('Dependency install failed');
    expect(html).toContain('Restart preview');
    expect(html).toContain('Stage repair prompt');
    expect(html).toContain('View console');
  });

  it('does not offer a server restart without an active project', () => {
    const html = renderToStaticMarkup(
      <PreviewFailureState
        message="Project creation failed"
        canRestart={false}
        onRestart={vi.fn()}
        onRepair={vi.fn()}
        onViewConsole={vi.fn()}
      />,
    );

    expect(html).not.toContain('Restart preview');
    expect(html).toContain('Stage repair prompt');
  });
});
