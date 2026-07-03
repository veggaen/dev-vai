import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { VaiNode, type VaiNodeProps } from '../brand/VaiNode.js';
import { copyProcessText } from './ProcessTree.copy.js';
import {
  shapeChanges,
  summaryLabel,
  changesToText,
  type CouncilChangeEntry,
  type ShapedChange,
} from './SelfImprovements.logic.js';

/**
 * SelfImprovements — the quiet "Council improved Vai" surface.
 *
 * At rest it is a single calm line (collapsed). Open it and the recent self-improvements unfold,
 * each entry ALREADY EXPANDED so you read the process (what changed, why, files, verification, the
 * peer verdict), not a teaser — and every entry is copyable for debugging.
 *
 * Deliberately follows ProcessTree's idioms: framer height/opacity only, `--chat-*` tokens, VaiNode
 * as the resting locus, chevron rotate to open. No pills / chips / uppercase micro-labels (banned).
 */

interface SelfImprovementsProps {
  /** Poll interval ms while mounted; 0 disables polling (fetch once). */
  readonly pollMs?: number;
  /** Injected fetch for tests/storybook; defaults to the live route. */
  readonly load?: () => Promise<CouncilChangeEntry[]>;
}

const ease = [0.25, 0.1, 0.25, 1] as const;

function kindTone(kind: ShapedChange['kind']): VaiNodeProps['tone'] {
  switch (kind) {
    case 'integrated': return 'verify';
    case 'reverted': return 'route';
    case 'held': return 'compose';
    case 'proposed': return 'evidence';
    default: return 'accent'; // shelved / unknown — quiet
  }
}

async function defaultLoad(): Promise<CouncilChangeEntry[]> {
  const res = await apiFetch('/api/council/changelog?limit=12');
  if (!res.ok) return [];
  const body = (await res.json()) as { entries?: CouncilChangeEntry[] };
  return Array.isArray(body.entries) ? body.entries : [];
}

export function SelfImprovements({ pollMs = 0, load = defaultLoad }: SelfImprovementsProps) {
  const [raw, setRaw] = useState<CouncilChangeEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = () => { void load().then((e) => { if (alive) setRaw(e); }).catch(() => {}); };
    run();
    if (pollMs > 0) {
      const id = window.setInterval(run, pollMs);
      return () => { alive = false; window.clearInterval(id); };
    }
    return () => { alive = false; };
  }, [load, pollMs]);

  const changes = shapeChanges(raw);
  const copyAll = useCallback(async () => {
    const ok = await copyProcessText(changesToText(shapeChanges(raw)));
    if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
  }, [raw]);

  // Nothing to show and nothing loading → render nothing (don't clutter the resting surface).
  if (changes.length === 0) return null;

  return (
    <div className="self-improve mb-3 text-[12px]" data-testid="self-improvements">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group self-improve__summary flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[color:var(--chat-muted)] hover:text-[color:var(--chat-body)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        <VaiNode state="done" size={9} tone="verify" />
        <span className="min-w-0 flex-1 truncate text-[11px]">{summaryLabel(changes.length)}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="self-improve-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease }}
            style={{ overflow: 'hidden' }}
            className="mt-0.5 pl-1"
          >
            <div className="mb-1 flex items-center justify-end">
              <button
                type="button"
                onClick={() => { void copyAll(); }}
                className="process-tree__copy-btn process-tree__copy-btn--sm"
                title="Copy all self-improvements"
                aria-label="Copy all self-improvements"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
            <ol className="space-y-1.5">
              {changes.map((c, i) => (
                <ChangeRow key={`${c.commit ?? c.title}-${i}`} change={c} />
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** One self-improvement — rendered EXPANDED (steps open by default), quiet and legible. */
function ChangeRow({ change }: { change: ShapedChange }) {
  const [copied, setCopied] = useState(false);
  const copyOne = useCallback(async () => {
    const ok = await copyProcessText(changesToText([change]));
    if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
  }, [change]);

  return (
    <li className="self-improve__item group/si pl-1">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-3.5 w-3 shrink-0 items-center justify-center">
          <VaiNode state="done" size={8} tone={kindTone(change.kind)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 text-[color:var(--chat-body)]">{change.title}</span>
            {change.when && (
              <span className="shrink-0 tabular-nums text-[10px] text-[color:var(--chat-muted)]">{change.when}</span>
            )}
            <button
              type="button"
              onClick={() => { void copyOne(); }}
              className="process-tree__copy-btn process-tree__copy-btn--sm process-tree__copy-btn--panel shrink-0"
              title="Copy this self-improvement"
              aria-label="Copy this self-improvement"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
          {/* the "why" is the story — kept in plain prose, not a labelled chip */}
          {change.why && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--chat-muted)]">{change.why}</p>
          )}
          <dl className="mt-1 space-y-0.5 text-[10px] text-[color:var(--chat-muted)]">
            {change.kindLabel && change.kindLabel !== 'integrated' && (
              <Meta term="status" value={change.kindLabel} />
            )}
            {change.area && <Meta term="area" value={change.area} />}
            {change.files.length > 0 && (
              <Meta term={change.files.length === 1 ? 'file' : 'files'} value={change.files.join('  ·  ')} mono />
            )}
            {change.verification && <Meta term="verified" value={change.verification} />}
            {change.peers && (
              <Meta
                term="peers"
                value={`${change.peers.accepted ? 'accepted' : 'not accepted'} · ${change.peers.acceptPct}% · modern/scale ${change.peers.modernScale}${change.peers.dissent.length ? ` · dissent: ${change.peers.dissent.join('; ')}` : ''}`}
              />
            )}
            {change.commit && <Meta term="commit" value={change.commit} mono />}
          </dl>
        </div>
      </div>
    </li>
  );
}

/** A quiet term/value line. Lowercase key, thin — NOT an uppercase micro-label or a pill. */
function Meta({ term, value, mono = false }: { term: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-[color:var(--chat-muted)] opacity-60">{term}</dt>
      <dd className={`min-w-0 flex-1 break-words text-[color:var(--chat-muted)] ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

export default SelfImprovements;
