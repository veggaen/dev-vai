import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Shared sidebar primitives — the chrome every sidebar panel is built from.
 *
 * Rewritten to Vai's doctrine (see memory: "never hardcode zinc/violet — map to tokens";
 * "BAN uppercase micro-labels"): all color comes from the Odysseus token system so the sidebar is
 * correct in both themes WITHOUT per-component `isLight` forks, headings use sentence case with real
 * hierarchy instead of tracked-out uppercase, and interactive density is revealed on hover
 * (reveal-on-intent) rather than sitting at full weight on the resting surface.
 *
 * The `isLight` prop is retained on the signatures purely so existing call sites keep compiling; it
 * is intentionally unused — tokens now carry the theme. It can be removed from callers in a later
 * sweep.
 */

/** Shared shell header for expanded sidebar panels. */
export function SidebarPanelHeader({
  title,
  subtitle,
  onCollapse,
  action,
}: {
  title: string;
  subtitle?: string;
  /** @deprecated theme is token-driven; retained for call-site compatibility. */
  isLight?: boolean;
  onCollapse: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="sidebar-header group/header flex h-12 flex-shrink-0 items-center justify-between gap-2 px-3.5">
      <div className="min-w-0">
        <h2 className="truncate text-[13px] font-semibold leading-tight text-[color:var(--shell-text)]">
          {title}
        </h2>
        {subtitle && (
          <p className="truncate text-[11px] leading-tight text-[color:var(--shell-text-muted)]">
            {subtitle}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {action}
        <button
          type="button"
          onClick={onCollapse}
          className="sidebar-icon-btn flex h-6 w-6 items-center justify-center rounded-md"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </header>
  );
}

/** Collapsible section heading for nested lists inside a sidebar panel. */
export function SidebarSection({
  label,
  count,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  /** @deprecated theme is token-driven; retained for call-site compatibility. */
  isLight?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="mt-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="sidebar-section-head group/sec flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left"
        aria-expanded={!collapsed}
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-[color:var(--shell-text-muted)] opacity-0 transition-all duration-150 group-hover/sec:opacity-100 ${collapsed ? '' : 'rotate-90 opacity-70'}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[color:var(--shell-text-muted)]">
          {label}
        </span>
        {count != null && (
          <span className="sidebar-count text-[10px] tabular-nums text-[color:var(--shell-text-muted)]">
            {count}
          </span>
        )}
      </button>
      {!collapsed && <ul className="list-none space-y-0.5 pl-0.5">{children}</ul>}
    </section>
  );
}

/** Row inside a sidebar list — semantic button with an active accent bar. */
export function SidebarListItem({
  active,
  onClick,
  onContextMenu,
  title,
  children,
  className = '',
}: {
  active?: boolean;
  /** @deprecated theme is token-driven; retained for call-site compatibility. */
  isLight?: boolean;
  onClick?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={title}
        data-active={active ? '1' : undefined}
        className={`sidebar-row group relative ml-2 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left ${className}`}
      >
        {active && (
          <span
            aria-hidden
            className="sidebar-row-accent absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full"
          />
        )}
        {children}
      </button>
    </li>
  );
}

export function SidebarEmptyState({ children }: { isLight?: boolean; children: ReactNode }) {
  return (
    <p className="px-3 py-8 text-center text-xs text-[color:var(--shell-text-muted)]">
      {children}
    </p>
  );
}
