import { Pause, Play, Workflow } from 'lucide-react';
import type { ImprovementAdoptionBoard } from '@vai/contracts/improvement-adoption';

interface OwnerAdoptionBoardProps {
  board: ImprovementAdoptionBoard | null;
  unavailable: boolean;
}

export function OwnerAdoptionBoard({ board, unavailable }: OwnerAdoptionBoardProps) {
  const paused = board?.generation.paused ?? false;

  return (
    <section className="mt-3 border-t border-[color:var(--border)] pt-3" aria-label="Self-improvement adoption queue" aria-live="polite">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="h-3.5 w-3.5 shrink-0 text-[color:var(--color-muted)]" aria-hidden />
          <div className="min-w-0">
            <h3 className="text-xs font-medium text-[color:var(--fg)]">Adoption queue</h3>
            <p className="truncate font-mono text-[10px] text-[color:var(--color-muted)]">
              {board ? `${board.stats.rawQueuedFixes} observations → ${board.stats.deduplicatedItems} work items` : 'Owner-reviewed improvements'}
            </p>
          </div>
        </div>
        {board && (
          <span className={`flex shrink-0 items-center gap-1 font-mono text-[10px] ${paused ? 'text-amber-400' : 'text-[color:var(--color-muted)]'}`}>
            {paused ? <Pause className="h-3 w-3" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />}
            {paused ? 'Generation paused' : 'Generation active'}
          </span>
        )}
      </div>

      {board ? (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2 border-y border-[color:var(--border)] py-2 font-mono text-[10px]">
            <div>
              <span className="block text-[color:var(--color-muted)]">Collapsed</span>
              <span className="text-[color:var(--fg)]">{board.stats.duplicatesCollapsed}</span>
            </div>
            <div>
              <span className="block text-[color:var(--color-muted)]">Qualified</span>
              <span className="text-[color:var(--fg)]">{board.generation.roi.qualified}</span>
            </div>
            <div>
              <span className="block text-[color:var(--color-muted)]">Shipped</span>
              <span className="text-[color:var(--fg)]">{board.generation.shipped}/{board.generation.minimumShipments}</span>
            </div>
          </div>

          <ol className="divide-y divide-[color:var(--border)]">
            {board.items.slice(0, 3).map((item) => (
              <li key={item.fingerprint} className="py-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-[10px] text-[color:var(--color-muted)]">
                    {Math.round(item.score)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-[color:var(--fg)]" title={item.title}>{item.title}</p>
                    <p className="truncate font-mono text-[10px] text-[color:var(--color-muted)]">
                      {item.class} · {item.observationCount} observations · {item.status}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-1 text-[10px] leading-relaxed text-[color:var(--color-muted)]">
            {board.generation.reason}
          </p>
        </>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--color-muted)]">
          {unavailable
            ? <>Board unavailable. Start <code className="text-[color:var(--fg)]">pnpm self-improve:watch</code>.</>
            : 'Reading the governed improvement ledger…'}
        </p>
      )}
    </section>
  );
}
