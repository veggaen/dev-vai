import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Users } from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { useChatStore } from '../../stores/chatStore.js';

/**
 * CouncilSeatPicker — composer control for WHICH council voices sit on the next turn.
 *
 * Default is the full roundtable (every configured member; the server's behavior when
 * `councilModelIds` is omitted). Opening the popover lets the user seat an explicit
 * subset — an explicit pick bypasses the balanced-depth delegation cap server-side,
 * so picking 3 models really seats 3 models.
 *
 * Members come from GET /api/council/config `activeMembers` (same source as the
 * settings card), fetched lazily on first open so the composer stays cheap.
 */

export interface CouncilSeatOption {
  id: string;
  name: string;
  topic?: string;
  status?: string;
}

export function CouncilSeatPicker({ disabled = false }: { disabled?: boolean }) {
  const councilModelIds = useChatStore((s) => s.councilModelIds);
  const setCouncilModelIds = useChatStore((s) => s.setCouncilModelIds);
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<CouncilSeatOption[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Portal anchor: the composer shell is `overflow: clip` (rounded-corner clipping),
  // so the menu CANNOT live inside it — it renders to <body> at a fixed position
  // above the trigger. Recomputed on open + window resize.
  const [anchor, setAnchor] = useState<{ bottom: number; right: number } | null>(null);

  const placePopover = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({
      bottom: Math.round(window.innerHeight - rect.top + 8),
      right: Math.round(window.innerWidth - rect.right),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placePopover();
    window.addEventListener('resize', placePopover);
    return () => window.removeEventListener('resize', placePopover);
  }, [open, placePopover]);

  const loadMembers = useCallback(async () => {
    try {
      const res = await apiFetch('/api/council/config');
      if (!res.ok) throw new Error('council config unavailable');
      const data = await res.json() as { activeMembers?: Array<{ id: string; name: string; topic?: string; status?: string }> };
      setMembers((data.activeMembers ?? []).map((m) => ({ id: m.id, name: m.name, topic: m.topic, status: m.status })));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (members === null) void loadMembers();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const inTrigger = rootRef.current?.contains(target) ?? false;
      const inPopover = popoverRef.current?.contains(target) ?? false;
      if (!inTrigger && !inPopover) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, members, loadMembers]);

  const isFullRoundtable = !councilModelIds || councilModelIds.length === 0;
  const selectedCount = councilModelIds?.length ?? 0;

  const toggleMember = (id: string) => {
    const current = new Set(councilModelIds ?? []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    // Selecting everyone is the same as the full roundtable — normalize back to null
    // so the wire payload stays omitted (server default) instead of a redundant list.
    if (members && current.size >= members.length) {
      setCouncilModelIds(null);
      return;
    }
    setCouncilModelIds(current.size > 0 ? [...current] : null);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={isFullRoundtable
          ? 'Council seats — full roundtable'
          : `Council seats — ${selectedCount} selected`}
        title={isFullRoundtable
          ? 'Full roundtable — every configured council voice reviews (click to pick a subset)'
          : `${selectedCount} council seat${selectedCount === 1 ? '' : 's'} selected for upcoming turns`}
        onClick={() => setOpen((v) => !v)}
        className={[
          'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]',
          isFullRoundtable
            ? 'border-[color:var(--chat-border,rgba(255,255,255,0.08))] text-[color:var(--chat-muted)] hover:text-[color:var(--chat-body)]'
            : 'border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]',
          disabled ? 'cursor-not-allowed opacity-50' : '',
        ].join(' ')}
      >
        <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{isFullRoundtable ? 'Roundtable' : `Council ×${selectedCount}`}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && anchor && createPortal(
        <div
          ref={popoverRef}
          role="listbox"
          aria-multiselectable
          aria-label="Council members"
          style={{ position: 'fixed', bottom: anchor.bottom, right: anchor.right }}
          className="z-[80] w-64 rounded-xl border border-[color:var(--border,rgba(255,255,255,0.1))] bg-[color:var(--sidebar-surface,#111)] p-2 shadow-xl"
        >
          <button
            type="button"
            role="option"
            aria-selected={isFullRoundtable}
            onClick={() => { setCouncilModelIds(null); setOpen(false); }}
            className={[
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors',
              isFullRoundtable
                ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]'
                : 'text-[color:var(--chat-body)] hover:bg-white/[0.06]',
            ].join(' ')}
          >
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="flex-1">Full roundtable</span>
            {isFullRoundtable && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          </button>

          <div className="mx-2 my-1.5 border-t border-white/[0.06]" role="presentation" />

          {members === null && !loadError && (
            <div className="px-2 py-2 text-[11px] text-[color:var(--chat-muted)]">Loading members…</div>
          )}
          {loadError && (
            <div className="px-2 py-2 text-[11px] text-[color:var(--chat-muted)]">
              Council unavailable — full roundtable will be used.
            </div>
          )}
          {members?.length === 0 && (
            <div className="px-2 py-2 text-[11px] text-[color:var(--chat-muted)]">
              No council members configured.
            </div>
          )}
          {members?.map((m) => {
            const selected = councilModelIds?.includes(m.id) ?? false;
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => toggleMember(m.id)}
                className={[
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors',
                  selected
                    ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]'
                    : 'text-[color:var(--chat-body)] hover:bg-white/[0.06]',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.status === 'available' || m.status === 'active' ? 'bg-emerald-400' : 'bg-zinc-500'}`}
                />
                <span className="min-w-0 flex-1 truncate" title={m.id}>{m.name}</span>
                {m.topic && m.topic !== 'other' && (
                  <span className="shrink-0 text-[9px] uppercase tracking-wider text-[color:var(--chat-muted)]">{m.topic}</span>
                )}
                {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}

          <div className="mt-1.5 border-t border-white/[0.06] px-2 pt-1.5 text-[10px] leading-snug text-[color:var(--chat-muted)]">
            {isFullRoundtable
              ? 'Every configured voice reviews each turn.'
              : 'Only the selected voices are seated — applies to chat reviews and builder codegen.'}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default CouncilSeatPicker;
