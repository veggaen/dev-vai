import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Shared shell header for expanded sidebar panels. */
export function SidebarPanelHeader({
  title,
  subtitle,
  isLight,
  onCollapse,
  action,
}: {
  title: string;
  subtitle?: string;
  isLight: boolean;
  onCollapse: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="flex h-11 flex-shrink-0 items-center justify-between gap-2 px-4">
      <div className="min-w-0">
        <h2
          className={`truncate text-[11px] font-semibold uppercase tracking-[0.18em] ${
            isLight ? 'text-zinc-600' : 'text-zinc-400'
          }`}
        >
          {title}
        </h2>
        {subtitle && (
          <p className={`truncate text-[10px] ${isLight ? 'text-zinc-400' : 'text-zinc-600'}`}>
            {subtitle}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {action}
        <button
          type="button"
          onClick={onCollapse}
          className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
            isLight ? 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'
          }`}
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
  isLight,
  children,
}: {
  label: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  isLight: boolean;
  children: ReactNode;
}) {
  return (
    <section className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
          isLight ? 'text-zinc-600 hover:bg-zinc-200/60' : 'text-zinc-400 hover:bg-white/[0.035]'
        }`}
        aria-expanded={!collapsed}
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.14em] opacity-80">
          {label}
        </span>
        {count != null && (
          <span className={`text-[10px] tabular-nums ${isLight ? 'text-zinc-400' : 'text-zinc-600'}`}>
            {count}
          </span>
        )}
      </button>
      {!collapsed && <ul className="list-none space-y-0.5 pl-1">{children}</ul>}
    </section>
  );
}

/** Row inside a sidebar list — semantic button with optional accent bar. */
export function SidebarListItem({
  active,
  isLight,
  onClick,
  onContextMenu,
  title,
  children,
  className = '',
}: {
  active?: boolean;
  isLight: boolean;
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
        className={`group relative ml-3 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left transition-all duration-150 ${
          active
            ? isLight
              ? 'bg-white text-zinc-950 shadow-sm'
              : 'bg-white/[0.065] text-zinc-100'
            : isLight
              ? 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
        } ${className}`}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[color:var(--accent)]"
          />
        )}
        {children}
      </button>
    </li>
  );
}

export function SidebarEmptyState({ isLight, children }: { isLight: boolean; children: ReactNode }) {
  return (
    <p className={`px-3 py-8 text-center text-xs ${isLight ? 'text-zinc-500' : 'text-zinc-600'}`}>
      {children}
    </p>
  );
}
