import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Search, Pin, Trash2, Code2, ChevronRight } from 'lucide-react';
import { SidebarPanelHeader } from '../components/sidebar/SidebarPrimitives.js';
import { CouncilProgressPanel } from '../components/panels/CouncilProgressPanel.js';
import type { CouncilThinkingUI } from '../stores/chatStore.js';
import '../styles/index.css';
import { initOdysseusThemeFromStorage } from '../lib/odysseus-theme.js';

initOdysseusThemeFromStorage();

/**
 * Visual story for the redesigned sidebar — renders the real header primitive plus a faithful copy
 * of the ChatsPanel markup (same classes) so the token-only, reveal-on-intent redesign can be
 * screenshotted without booting the runtime/auth/store. QA harness only; not shipped.
 */

const chats = [
  { id: '1', title: 'Reasoning timeline redesign', when: 'Just now', working: true, code: false },
  { id: '2', title: 'HEX launcher fork — wagmi wiring', when: '2m ago', working: false, code: true },
  { id: '3', title: 'Council self-eval loop', when: '1h ago', working: false, code: false },
  { id: '4', title: 'Perpetual innovation loop verify', when: '3h ago', working: false, code: false },
];

function ChatRow({ c, active }: { c: (typeof chats)[number]; active: boolean }) {
  return (
    <div
      data-active={active ? '1' : undefined}
      className="sidebar-row group relative ml-2 flex items-center gap-2 rounded-lg px-2 py-1.5"
      title={c.title}
    >
      {active && <span aria-hidden className="sidebar-row-accent absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full" />}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {c.code && <Code2 aria-hidden className="h-3 w-3 shrink-0 text-[color:var(--phase-route)]" />}
          <span className="min-w-0 flex-1 truncate text-[13px] leading-tight">{c.title}</span>
          {c.working ? (
            <span className="flex flex-shrink-0 items-center gap-1 text-[10px] font-medium text-[color:var(--accent-text)]">
              <span aria-hidden className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--accent)] opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
              </span>
              Working…
            </span>
          ) : (
            <span className="flex-shrink-0 text-[10px] tabular-nums text-[color:var(--shell-text-muted)]">{c.when}</span>
          )}
        </div>
      </div>
      <button aria-label="Pin" className="sidebar-affordance flex h-5 w-5 flex-shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100">
        <Pin className="h-3 w-3" />
      </button>
      <button aria-label="Delete" className="sidebar-affordance sidebar-affordance--danger flex h-5 w-5 flex-shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function Sidebar() {
  const [active, setActive] = useState('1');
  return (
    <aside
      className="sidebar-panel-shell flex h-[560px] w-[280px] flex-col overflow-hidden rounded-[var(--layout-radius,12px)] border border-[color:var(--border)]"
      style={{ background: 'var(--sidebar-surface)' }}
    >
      <SidebarPanelHeader title="Chats" subtitle="Your conversations" isLight={false} onCollapse={() => {}} />
      <div className="flex-shrink-0 px-3 pb-2 pt-2">
        <button className="sidebar-newchat group/nc mb-1.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium">
          <span className="sidebar-newchat-glyph flex h-6 w-6 items-center justify-center rounded-md"><Plus className="h-3.5 w-3.5" /></span>
          New chat
          <span className="sidebar-kbd ml-auto text-[10px] tabular-nums text-[color:var(--shell-text-muted)]">Ctrl+N</span>
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--shell-text-muted)]" />
          <input placeholder="Search chats" className="sidebar-search w-full rounded-lg py-1.5 pl-8 pr-3 text-sm outline-none" />
        </div>
      </div>
      <div className="px-1.5 pb-2">
        <div className="mt-1.5">
          <button className="sidebar-section-head group/sec flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left">
            <ChevronRight className="h-3 w-3 shrink-0 rotate-90 text-[color:var(--shell-text-muted)] opacity-70" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[color:var(--shell-text-muted)]">Today</span>
            <span className="sidebar-count text-[10px] tabular-nums text-[color:var(--shell-text-muted)]">4</span>
          </button>
          <div onClick={(e) => { const id = (e.target as HTMLElement).closest('[title]')?.getAttribute('title'); if (id) setActive(chats.find((c) => c.title === id)?.id ?? active); }}>
            {chats.map((c) => <ChatRow key={c.id} c={c} active={c.id === active} />)}
          </div>
        </div>
      </div>
    </aside>
  );
}

const reviewFixture: CouncilThinkingUI = {
  outcome: 'act',
  agreement: 0.66,
  confidence: 0.7,
  topic: 'factual',
  summary: 'Panel approved with one dissent.',
  realIntent: 'Compare the two options and recommend one.',
  recommendedAction: 'search-web',
  missingCapabilities: ['No live price feed for local listings'],
  methodLessons: ['Cite the fetched source inline next to the number it backs.'],
  members: [
    { name: 'Local qwen3:8b', topic: 'code', verdict: 'good', confidence: 0.82, action: 'ship', note: 'Grounded and current. The draft cites both sources and the comparison holds up.' },
    { name: 'deepseek-r1', topic: 'reasoning', verdict: 'needs-work', confidence: 0.44, action: 'redraft', note: 'Missed the follow-up intent — the user asked for a recommendation, not a summary.' },
    { name: 'gemma2', topic: 'review', verdict: 'bad', confidence: 0.3, action: 'redraft', note: '', failed: true },
  ],
};

function ReasoningPanelStory() {
  return (
    <div className="flex h-[560px] overflow-hidden rounded-[var(--layout-radius,12px)] border border-[color:var(--border)]">
      <CouncilProgressPanel council={reviewFixture} onApplyLesson={() => {}} onReconvene={() => {}} onDesignMode={() => {}} onExportVisualPlan={() => {}} />
    </div>
  );
}

function ReasoningPanelEmptyStory() {
  return (
    <div className="flex h-[560px] overflow-hidden rounded-[var(--layout-radius,12px)] border border-[color:var(--border)]">
      <CouncilProgressPanel council={null} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ display: 'flex', gap: 32, padding: 40, alignItems: 'flex-start' }}>
      <Sidebar />
      <ReasoningPanelStory />
      <ReasoningPanelEmptyStory />
    </div>
  </StrictMode>,
);
