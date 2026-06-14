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

const CHAT_SUGGESTIONS: readonly Suggestion[] = [
  {
    icon: Search,
    title: 'Research with sources',
    hint: 'Vai searches, cites, and cross-checks',
    prompt: 'Research the current state of local-first AI desktop apps and give me a sourced summary of the strongest approaches.',
    tone: 'evidence',
  },
  {
    icon: BookOpen,
    title: 'Explain something deeply',
    hint: 'First-principles, with a worked example',
    prompt: 'Explain how a consensus council improves an AI answer, with a concrete worked example.',
    tone: 'route',
  },
  {
    icon: Bug,
    title: 'Debug with me',
    hint: 'Walk through the cause, not just a patch',
    prompt: 'My React component re-renders too often on every keystroke. Walk me through how you would diagnose the cause.',
    tone: 'compose',
  },
  {
    icon: Sparkles,
    title: 'Challenge an idea',
    hint: 'Stress-test assumptions honestly',
    prompt: 'I want to ship a feature flag system this week. Challenge the plan and call out the weak assumptions.',
    tone: 'accent',
  },
];

const BUILD_SUGGESTIONS: readonly Suggestion[] = [
  {
    icon: Wrench,
    title: 'Build a small app',
    hint: 'Scaffolds, runs, and previews live',
    prompt: 'Build a clean Pomodoro timer app with start/pause/reset, a circular progress ring, and a session counter.',
    tone: 'accent',
  },
  {
    icon: Layers,
    title: 'A landing page',
    hint: 'Premium hero, sections, responsive',
    prompt: 'Build a premium landing page for a note-taking app: hero with a clear value prop, three feature cards, and a footer.',
    tone: 'route',
  },
  {
    icon: Sparkles,
    title: 'A polished component',
    hint: 'One focused, reusable piece',
    prompt: 'Build a reusable, accessible toast notification system with success/error/info variants and smooth enter/exit motion.',
    tone: 'compose',
  },
  {
    icon: Search,
    title: 'Improve what exists',
    hint: 'Tighten an existing UI',
    prompt: 'Take a generic dashboard layout and tighten the spacing, hierarchy, and typography to feel premium.',
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
    <div
      className="mt-9 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2"
      role="list"
      aria-label="Starter prompts"
    >
      {suggestions.map((s, i) => {
        const Icon = s.icon;
        return (
          <motion.button
            key={s.title}
            type="button"
            role="listitem"
            onClick={() => onPrompt(s.prompt)}
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32 + i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="hover-lift group relative flex items-start gap-3 overflow-hidden rounded-2xl border border-[color:var(--panel-border-soft)] bg-[color:var(--panel-bg-inset)] p-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
          >
            {/* Icon tile — quiet by default, accent-washed on hover */}
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[color:var(--panel-border-soft)] bg-[color:var(--panel-bg-elevated)] text-[color:var(--chat-muted)] transition-colors duration-200 group-hover:border-[color:var(--accent-ring)] group-hover:bg-[color:var(--accent-soft)] group-hover:text-[color:var(--accent-text)]">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-[color:var(--chat-strong)]">{s.title}</span>
                <ArrowUpRight
                  className="h-3.5 w-3.5 shrink-0 -translate-x-1 text-[color:var(--chat-muted)] opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-hover:text-[color:var(--accent-text)]"
                  aria-hidden="true"
                />
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-[color:var(--chat-muted)]">{s.hint}</span>
            </span>

            {/* Intelligence-node motif — settles in the corner, breathes on hover. */}
            <span className="pointer-events-none absolute right-3 top-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <VaiNode state="thinking" size={6} tone={s.tone} />
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

export default SuggestionDeck;
