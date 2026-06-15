/**
 * SuggestionDeck — branded starter prompts for the empty chat.
 *
 * Replaces the bare "Send a message to begin" affordance with a small, premium
 * deck of capability cards that (a) show what Vai is good at and (b) start the
 * conversation in one click. Cards are mode-aware: Build/Agent modes surface
 * build-shaped prompts; Chat mode surfaces reasoning/research ones.
 *
 * Cohesion: rides the design tokens, `hover-lift`, and the intelligence-node
 * motif (a VaiNode sits in each card's corner and lights on hover), so the deck
 * feels like the same product as the ProcessTree and the rest of the shell.
 * Fully keyboard-navigable and reduced-motion safe.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Sparkles, Search, Wrench, Layers, BookOpen, Bug } from 'lucide-react';
import type { ChatMode } from '../../stores/layoutStore.js';
import { VaiNode } from '../brand/VaiNode.js';

interface Suggestion {
  readonly icon: typeof Sparkles;
  readonly title: string;
  readonly hint: string;
  readonly prompt: string;
  readonly tone: 'accent' | 'evidence' | 'compose' | 'route';
}

export const CHAT_SUGGESTIONS: readonly Suggestion[] = [
  {
    icon: Search,
    title: 'Research a live question',
    hint: 'Search, cite, and cross-check current evidence.',
    prompt: 'Research the current state of local-first AI desktop apps and give me a sourced summary of the strongest approaches.',
    tone: 'evidence',
  },
  {
    icon: BookOpen,
    title: 'Explain from first principles',
    hint: 'Build the idea carefully, then prove it with an example.',
    prompt: 'Explain how a consensus council improves an AI answer, with a concrete worked example.',
    tone: 'route',
  },
  {
    icon: Bug,
    title: 'Trace a difficult bug',
    hint: 'Find the cause, test the theory, and fix the right layer.',
    prompt: 'My React component re-renders too often on every keystroke. Walk me through how you would diagnose the cause.',
    tone: 'compose',
  },
  {
    icon: Sparkles,
    title: 'Pressure-test a decision',
    hint: 'Challenge weak assumptions before they become expensive.',
    prompt: 'I want to ship a feature flag system this week. Challenge the plan and call out the weak assumptions.',
    tone: 'accent',
  },
];

export const BUILD_SUGGESTIONS: readonly Suggestion[] = [
  {
    icon: Wrench,
    title: 'Ship a working app',
    hint: 'A polished Pomodoro with real state and session history.',
    prompt: 'Build a clean Pomodoro timer app with start/pause/reset, a circular progress ring, and a session counter.',
    tone: 'accent',
  },
  {
    icon: Layers,
    title: 'Design a product launch',
    hint: 'A responsive note-taking site with a clear point of view.',
    prompt: 'Build a premium landing page for a note-taking app: hero with a clear value prop, three feature cards, and a footer.',
    tone: 'route',
  },
  {
    icon: Sparkles,
    title: 'Create a UI system',
    hint: 'Accessible toast primitives with thoughtful motion.',
    prompt: 'Build a reusable, accessible toast notification system with success/error/info variants and smooth enter/exit motion.',
    tone: 'compose',
  },
  {
    icon: Search,
    title: 'Audit this workspace',
    hint: 'Find the biggest UX weakness, fix it, and prove it live.',
    prompt: 'Audit the current project, identify the highest-impact user experience problem, implement the fix, and verify it in the browser.',
    tone: 'evidence',
  },
];

interface SuggestionDeckProps {
  readonly mode: ChatMode;
  readonly onPrompt: (prompt: string) => void;
}

export function SuggestionDeck({ mode, onPrompt }: SuggestionDeckProps) {
  const prefersReducedMotion = useReducedMotion();
  const isBuild = mode === 'builder' || mode === 'agent';
  const suggestions = isBuild ? BUILD_SUGGESTIONS : CHAT_SUGGESTIONS;

  return (
    <motion.section
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.28, duration: 0.45 }}
      className="vai-starter-deck min-w-0"
      aria-labelledby="starter-prompts-heading"
    >
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--chat-muted)]">
            Start with a real workflow
          </p>
          <h2 id="starter-prompts-heading" className="mt-1 font-display text-[17px] font-semibold tracking-[-0.02em] text-[color:var(--chat-strong)]">
            Choose a starting point
          </h2>
        </div>
        <span className="hidden text-[10px] text-[color:var(--chat-muted)] sm:block">Click to stage a prompt</span>
      </div>

      <ul className="vai-starter-grid grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2" aria-label="Starter prompts">
        {suggestions.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.li
              key={s.title}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.36 + i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <button
                type="button"
                onClick={() => onPrompt(s.prompt)}
                className="vai-starter-card hover-lift group relative flex min-h-[132px] w-full flex-col overflow-hidden rounded-2xl border border-[color:var(--panel-border-soft)] bg-[color:var(--panel-bg-inset)] p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--panel-border-soft)] bg-[color:var(--panel-bg-elevated)] text-[color:var(--chat-muted)] transition-colors duration-200 group-hover:border-[color:var(--accent-ring)] group-hover:bg-[color:var(--accent-soft)] group-hover:text-[color:var(--accent-text)]">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-[9px] font-medium tabular-nums tracking-[0.16em] text-[color:var(--chat-muted)]">
                      0{i + 1}
                    </span>
                    <VaiNode state="thinking" size={6} tone={s.tone} />
                  </span>
                </span>

                <span className="mt-4 text-[13px] font-semibold text-[color:var(--chat-strong)]">{s.title}</span>
                <span className="mt-1 block text-[11px] leading-[1.45] text-[color:var(--chat-muted)]">{s.hint}</span>

                <span className="mt-auto flex items-center gap-1 pt-3 text-[10px] font-medium text-[color:var(--chat-muted)] transition-colors group-hover:text-[color:var(--accent-text)]">
                  Stage prompt
                  <ArrowUpRight
                    className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    aria-hidden="true"
                  />
                </span>
              </button>
            </motion.li>
          );
        })}
      </ul>
    </motion.section>
  );
}

export default SuggestionDeck;
