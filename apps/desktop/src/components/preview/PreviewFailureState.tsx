import { MessageSquare, RotateCcw, Terminal, XCircle } from 'lucide-react';

export function createPreviewRepairPrompt(message: string): string {
  const reason = message.trim() || 'The preview failed without a reported reason.';
  return `Repair the current sandbox preview failure: ${reason}

Inspect the existing project and logs, identify the root cause, change only the files required, restart the preview, and verify the rendered app before declaring success.`;
}

export function PreviewFailureState({
  message,
  canRestart,
  onRestart,
  onRepair,
  onViewConsole,
}: {
  message: string;
  canRestart: boolean;
  onRestart: () => void;
  onRepair: () => void;
  onViewConsole: () => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6 sm:p-8">
      <section className="w-full max-w-xl rounded-[1.75rem] border border-[color:color-mix(in_oklab,var(--red)_30%,var(--panel-border))] bg-[color:var(--panel-bg)] p-6 text-left shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:color-mix(in_oklab,var(--red)_12%,transparent)] text-[color:var(--red)] ring-1 ring-[color:color-mix(in_oklab,var(--red)_24%,transparent)]">
            <XCircle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--red)]">
              Preview stopped
            </p>
            <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-[color:var(--chat-strong)]">
              This build did not reach a runnable state.
            </h3>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-[color:var(--panel-border-soft)] bg-[color:var(--panel-bg-inset)] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--chat-muted)]">
            Reported cause
          </p>
          <p className="mt-2 break-words font-mono text-[11px] leading-6 text-[color:var(--chat-strong)]">
            {message}
          </p>
        </div>

        <p className="mt-4 text-[12px] leading-6 text-[color:var(--chat-muted)]">
          Existing files stay in place. Restart the server when the code is likely healthy, or stage a repair request that gives Vai this exact failure context.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {canRestart && (
            <button
              type="button"
              onClick={onRestart}
              className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--accent)] px-3.5 py-2 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Restart preview
            </button>
          )}
          <button
            type="button"
            onClick={onRepair}
            className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--panel-border)] bg-[color:var(--panel-bg-elevated)] px-3.5 py-2 text-[11px] font-semibold text-[color:var(--chat-strong)] transition-colors hover:border-[color:var(--accent-ring)] hover:text-[color:var(--accent-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Stage repair prompt
          </button>
          <button
            type="button"
            onClick={onViewConsole}
            className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[11px] font-medium text-[color:var(--chat-muted)] transition-colors hover:bg-[color:var(--panel-bg-muted)] hover:text-[color:var(--chat-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
          >
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
            View console
          </button>
        </div>
      </section>
    </div>
  );
}
