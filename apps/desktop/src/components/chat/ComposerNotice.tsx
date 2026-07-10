/**
 * ComposerNotice — the single attention slot inside the composer shell.
 *
 * Build-confirm, steer/queue, queued message, voice error, and mishear
 * correction used to render as up to five independently-styled rows/cards
 * stacked above the input. This component is a priority queue: at most ONE
 * notice renders at a time, always as the same slim borderless row with
 * inline text actions.
 *
 * Priority (highest first): buildConfirm > mishear > voice > steer > queued.
 */

interface BuildConfirmNotice {
  readonly text: string;
  readonly onAnswer: () => void;
  readonly onBuild: () => void;
  readonly onCancel: () => void;
}

interface SteerNotice {
  readonly onSteer: () => void;
  readonly onQueue: () => void;
}

interface QueuedNotice {
  readonly text: string;
  readonly onCancel: () => void;
}

interface VoiceNotice {
  readonly message: string;
  readonly onCheck: () => void;
}

interface MishearNotice {
  readonly prompt: string;
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
}

export interface ComposerNoticeProps {
  readonly buildConfirm?: BuildConfirmNotice | null;
  readonly steer?: SteerNotice | null;
  readonly queued?: QueuedNotice | null;
  readonly voice?: VoiceNotice | null;
  readonly mishear?: MishearNotice | null;
}

const actionClass =
  'shrink-0 rounded-md border border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] px-2 py-0.5 font-medium text-[color:var(--accent-text)] transition-colors hover:bg-[color:var(--accent-softer)]';
const quietActionClass =
  'shrink-0 rounded-md border border-[color:var(--panel-border-soft)] px-2 py-0.5 font-medium text-[color:var(--chat-body)] transition-colors hover:bg-white/[0.05]';
const dismissClass =
  'shrink-0 text-[color:var(--chat-muted)] transition-colors hover:text-[color:var(--chat-strong)]';

export function ComposerNotice({ buildConfirm, steer, queued, voice, mishear }: ComposerNoticeProps) {
  if (buildConfirm) {
    const quote = buildConfirm.text.length > 60 ? `${buildConfirm.text.slice(0, 60)}…` : buildConfirm.text;
    return (
      <div className="composer-notice flex items-center gap-2 px-4 pt-2 text-[11px]" role="status" data-testid="composer-notice">
        <span className="min-w-0 flex-1 truncate text-[color:var(--chat-body)]" title={buildConfirm.text}>
          Answer, or build an app? <span className="text-[color:var(--chat-muted)]">“{quote}”</span>
        </span>
        <button type="button" onClick={buildConfirm.onAnswer} className={quietActionClass}>
          Just answer
        </button>
        <button type="button" onClick={buildConfirm.onBuild} className={actionClass}>
          Build an app
        </button>
        <button type="button" onClick={buildConfirm.onCancel} className={dismissClass} title="Dismiss">
          Cancel
        </button>
      </div>
    );
  }

  if (mishear) {
    return (
      <div className="composer-notice flex items-center gap-2 px-4 pt-2 text-[11px] text-[color:var(--chat-body)]" aria-live="polite" data-testid="composer-notice">
        <span className="min-w-0 flex-1 truncate">{mishear.prompt}</span>
        <button type="button" onClick={mishear.onConfirm} className={actionClass} title="Remember this spelling for next time">
          Remember correction
        </button>
        <button type="button" onClick={mishear.onDismiss} className={dismissClass} title="Dismiss">
          No thanks
        </button>
      </div>
    );
  }

  if (voice) {
    return (
      <div className="composer-notice flex items-center gap-2 px-4 pt-2 text-[11px] text-amber-300" role="status" data-testid="composer-notice">
        <span className="min-w-0 flex-1 truncate">{voice.message}</span>
        <button
          type="button"
          onClick={voice.onCheck}
          className="shrink-0 rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 font-medium text-amber-100 transition-colors hover:bg-amber-400/15"
        >
          Check
        </button>
      </div>
    );
  }

  if (steer) {
    return (
      <div className="composer-notice flex items-center gap-2 px-4 pt-2 text-[11px]" data-testid="composer-notice">
        <span className="text-[color:var(--accent-text)]">Vai is working —</span>
        <button type="button" onClick={steer.onSteer} className={actionClass} title="Inject this as guidance for the current turn">
          Steer now
        </button>
        <button type="button" onClick={steer.onQueue} className={quietActionClass} title="Send this automatically when the current turn finishes (Enter)">
          Queue ↵
        </button>
      </div>
    );
  }

  if (queued) {
    return (
      <div className="composer-notice flex items-center gap-2 px-4 pt-2 text-[11px] text-[color:var(--chat-muted)]" data-testid="composer-notice">
        <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em]">Queued</span>
        <span className="min-w-0 flex-1 truncate">{queued.text}</span>
        <button type="button" onClick={queued.onCancel} className={dismissClass} title="Cancel queued message">
          Cancel
        </button>
      </div>
    );
  }

  return null;
}

export default ComposerNotice;
