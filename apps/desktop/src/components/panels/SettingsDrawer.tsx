/**
 * Full-width settings drawer — ~80% of the workspace with a click-outside backdrop.
 * Replaces the narrow sidebar slot so settings has room for tabs, forms, and grids.
 */

import { lazy, Suspense, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useLayoutStore } from '../../stores/layoutStore.js';

const SettingsPanel = lazy(async () => ({
  default: (await import('./SettingsPanel.js')).SettingsPanel,
}));

function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-[color:var(--color-muted)]">
      Loading settings…
    </div>
  );
}

export function SettingsDrawer() {
  const setActivePanel = useLayoutStore((s) => s.setActivePanel);
  const themeEditingBaseId = useLayoutStore((s) => s.themeEditingBaseId);
  const editingTheme = Boolean(themeEditingBaseId);
  const close = useCallback(() => setActivePanel('chats'), [setActivePanel]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  return (
    <>
      {/* Settings panel — 80% of workspace after activity rail */}
      <motion.div
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -16 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={`settings-drawer flex h-full min-w-0 flex-col overflow-hidden border-r border-[color:var(--shell-line-soft)] bg-[color:var(--sidebar-surface)] shadow-[4px_0_24px_rgba(0,0,0,0.18)] ${
          editingTheme ? 'flex-[2] max-w-[min(42rem,48%)]' : 'flex-[4]'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-[color:var(--border)] px-5">
          <div>
            <h2 className="text-sm font-semibold text-[color:var(--fg)]">Settings</h2>
            <p className="text-[11px] text-[color:var(--color-muted)]">Appearance, AI, integrations, shortcuts</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--color-muted)] transition-colors hover:bg-[color:var(--panel-bg-muted)] hover:text-[color:var(--fg)]"
            aria-label="Close settings"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Suspense fallback={<PanelLoading />}>
            <div className="h-full min-h-0 flex-1">
              <SettingsPanel />
            </div>
          </Suspense>
        </div>
      </motion.div>

      {/* Backdrop — remaining ~20%, click to dismiss */}
      <motion.button
        type="button"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={editingTheme ? undefined : close}
        className={`settings-drawer-backdrop h-full min-w-[4.5rem] flex-1 border-0 transition-colors ${
          editingTheme
            ? 'cursor-default bg-transparent'
            : 'cursor-default bg-black/35 hover:bg-black/45'
        }`}
        aria-label="Close settings"
        title="Click to close settings"
      />
    </>
  );
}
