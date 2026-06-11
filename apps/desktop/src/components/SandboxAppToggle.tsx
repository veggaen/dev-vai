import { PanelRightClose } from 'lucide-react';
import { useLayoutStore } from '../stores/layoutStore.js';

interface SandboxAppToggleProps {
  studioChrome?: boolean;
  size?: 'toolbar' | 'compact';
}

const toggleClass =
  'border border-[color:var(--shell-line-soft)] bg-[color:var(--panel-bg-muted)] text-[color:var(--fg)] transition-colors hover:border-[color:var(--red)] hover:bg-[color:var(--accent-soft)] hover:text-[color:var(--red)]';

/** Close the live app preview panel — paired with ChatWindow "App preview" open button. */
export function SandboxAppToggle({ size = 'toolbar' }: SandboxAppToggleProps) {
  const toggleBuilderPanel = useLayoutStore((s) => s.toggleBuilderPanel);

  if (size === 'compact') {
    return (
      <button
        type="button"
        onClick={toggleBuilderPanel}
        className={`flex h-8 items-center gap-1.5 rounded-xl px-3 text-[11px] font-medium ${toggleClass}`}
        title="Close app preview (Ctrl+B)"
      >
        <PanelRightClose className="h-3.5 w-3.5" />
        <span>Close app</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleBuilderPanel}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-medium ${toggleClass}`}
      title="Close app preview (Ctrl+B)"
    >
      <PanelRightClose className="h-3 w-3" />
      <span>Close app</span>
    </button>
  );
}
