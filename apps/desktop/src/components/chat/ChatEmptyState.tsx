/**
 * ChatEmptyState — first-viewport hero for a fresh chat.
 *
 * The pulsing Vai mark, a short branded line with real personality, and a
 * mode-aware SuggestionDeck so the first screen demonstrates what Vai can do and
 * starts the conversation in one click — instead of a bare "send a message".
 */

import { motion, useReducedMotion } from 'framer-motion';
import { Braces, DraftingCompass, ShieldCheck } from 'lucide-react';
import { VaiWelcomeMark } from './VaiWelcomeMark.js';
import { SuggestionDeck } from './SuggestionDeck.js';
import { useLayoutStore } from '../../stores/layoutStore.js';

interface ChatEmptyStateProps {
  /** @deprecated Kept for API compatibility — settings are in the sidebar rail. */
  onOpenSettings?: () => void;
  /** Fill + send a starter prompt (wired by ChatWindow). */
  onPrompt?: (prompt: string) => void;
}

export function ChatEmptyState({ onPrompt }: ChatEmptyStateProps) {
  const prefersReducedMotion = useReducedMotion();
  const mode = useLayoutStore((s) => s.mode);
  const showBuilderPanel = useLayoutStore((s) => s.showBuilderPanel);
  const isBuild = mode === 'builder' || mode === 'agent';

  const headline = isBuild
    ? 'From intent to running software.'
    : 'Answers with evidence, not theater.';
  const lede = isBuild
    ? 'Plan with the council, build in a live sandbox, and verify the rendered result before it ships.'
    : 'Ask a hard question. Vai can reason, research, cross-check, and show the path it took.';
  const workflow = isBuild
    ? [
        { icon: DraftingCompass, label: 'Plan', detail: 'Intent + blueprint' },
        { icon: Braces, label: 'Build', detail: 'Code + live sandbox' },
        { icon: ShieldCheck, label: 'Verify', detail: 'Tests + rendered proof' },
      ]
    : [
        { icon: DraftingCompass, label: 'Frame', detail: 'Clarify the real ask' },
        { icon: Braces, label: 'Investigate', detail: 'Reason + retrieve' },
        { icon: ShieldCheck, label: 'Verify', detail: 'Cross-check the answer' },
      ];

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
      className="vai-launchpad relative z-[1] flex min-h-full min-w-0 items-center justify-center px-5 pb-56 pt-10 sm:px-8 md:pb-52"
      data-clean-empty-state="v8"
      data-workspace={showBuilderPanel ? 'split' : 'chat'}
    >
      <div className={`vai-launchpad-grid relative mx-auto grid w-full min-w-0 ${
        showBuilderPanel
          ? 'max-w-[720px] grid-cols-1 items-start gap-8'
          : 'max-w-[1040px] gap-9 lg:grid-cols-[0.92fr_1.08fr] lg:items-end lg:gap-12'
      }`}>
        <section className="vai-launchpad-copy min-w-0 text-left">
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.4 }}
            className="vai-launchpad-brand flex items-center gap-4"
          >
            <VaiWelcomeMark size="md" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[color:var(--accent-text)]">
                Vai software studio
              </p>
              <p className="mt-1 text-[11px] text-[color:var(--chat-muted)]">
                Deterministic engine · specialist council · visible proof
              </p>
            </div>
          </motion.div>

          <motion.h1
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className={`vai-launchpad-title mt-8 max-w-xl font-display font-semibold leading-[0.96] tracking-[-0.055em] text-[color:var(--chat-strong)] ${
              showBuilderPanel
                ? 'text-[clamp(2.35rem,3.7vw,3.75rem)]'
                : 'text-[clamp(2.25rem,4.1vw,4.5rem)]'
            }`}
          >
            {headline}
          </motion.h1>

          <motion.p
            initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24, duration: 0.45 }}
            className="vai-launchpad-lede mt-5 max-w-lg text-[14px] leading-6 text-[color:var(--chat-muted)]"
          >
            {lede}
          </motion.p>

          <motion.ol
            initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32, duration: 0.45 }}
            className="vai-launchpad-workflow mt-8 grid grid-cols-3 overflow-hidden rounded-2xl border border-[color:var(--panel-border-soft)] bg-[color:var(--panel-bg-inset)]"
            aria-label={isBuild ? 'Vai build workflow' : 'Vai answer workflow'}
          >
            {workflow.map((step, index) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.label}
                  className="relative min-w-0 px-3 py-3.5 after:absolute after:inset-y-3 after:right-0 after:w-px after:bg-[color:var(--panel-border-soft)] last:after:hidden sm:px-4"
                >
                  <div className="flex items-center gap-2 text-[color:var(--chat-strong)]">
                    <Icon className="h-3.5 w-3.5 text-[color:var(--accent-text)]" aria-hidden="true" />
                    <span className="text-[12px] font-semibold">{step.label}</span>
                    <span className="ml-auto text-[9px] tabular-nums text-[color:var(--chat-muted)]">
                      0{index + 1}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-[10.5px] text-[color:var(--chat-muted)]">{step.detail}</p>
                </li>
              );
            })}
          </motion.ol>
        </section>

        {onPrompt && <SuggestionDeck mode={mode} onPrompt={onPrompt} />}
      </div>
    </motion.div>
  );
}
