/**
 * CompactCombobox — A compact, searchable, scrollable dropdown that NEVER
 * extends outside the app window. Uses cmdk internally for search/filter.
 *
 * Features:
 *  - Tiny trigger button (label + chevron)
 *  - Popover positions itself relative to trigger, clamped to viewport
 *  - Search input pinned at top inside the dropdown
 *  - Scrollable list with max-height (~280px)
 *  - Thin custom scrollbar
 *  - Keyboard navigation (↑↓ Enter Esc)
 *  - Click-outside closes
 *  - Single-select or multi-select mode
 */

import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { ChevronDown, Search, Check, X } from 'lucide-react';

/* ── Types ────────────────────────────────────────────────────── */

export interface ComboboxItem {
  id: string;
  label: string;
  /** Optional secondary text shown dimmed to the right */
  hint?: string;
  /** Optional icon (rendered left of label) */
  icon?: ReactNode;
  /** Optional group header this item belongs to */
  group?: string;
  /** Nested children (for tree view) */
  children?: ComboboxItem[];
  /** Whether this item is disabled */
  disabled?: boolean;
}

export interface CompactComboboxProps {
  /** Items to display (flat or grouped via item.group) */
  items: ComboboxItem[];
  /** Currently selected id(s). String for single, string[] for multi */
  value: string | string[];
  /** Called when selection changes */
  onChange: (value: string | string[]) => void;
  /** Trigger button label when nothing is selected */
  placeholder?: string;
  /** Search input placeholder */
  searchPlaceholder?: string;
  /** Whether to allow multiple selections */
  multi?: boolean;
  /** Accent color class for the trigger ring (e.g. 'blue', 'violet') */
  accent?: 'blue' | 'violet' | 'emerald' | 'zinc' | 'sky' | 'amber';
  /** Optional icon shown in trigger */
  triggerIcon?: ReactNode;
  /** Width class for the dropdown (default: 'w-64') */
  dropdownWidth?: string;
  /** Max height for the scrollable list in px (default: 280) */
  maxHeight?: number;
  /** Optional render function to customise each item row */
  renderItem?: (item: ComboboxItem, selected: boolean) => ReactNode;
  /** Extra class on trigger */
  className?: string;
  /** Whether the combobox is disabled */
  disabled?: boolean;
  /** Position hint: 'above' forces up, 'below' forces down, 'auto' detects */
  position?: 'above' | 'below' | 'auto';
  /** Message shown when the list has no items and search is empty */
  emptyMessage?: string;
}

/* ── Accent colour tokens ────────────────────────────────────── */

const ACCENT = {
  blue: {
    ring: 'ring-blue-500/30',
    bg: 'bg-blue-500/10',
    text: 'text-blue-200',
    hoverBorder: 'hover:border-blue-500/40',
    selectedBg: 'bg-blue-500/10',
    selectedText: 'text-blue-200',
  },
  violet: {
    ring: 'ring-violet-500/30',
    bg: 'bg-violet-500/10',
    text: 'text-violet-200',
    hoverBorder: 'hover:border-violet-500/40',
    selectedBg: 'bg-violet-500/10',
    selectedText: 'text-violet-200',
  },
  emerald: {
    ring: 'ring-emerald-500/30',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-200',
    hoverBorder: 'hover:border-emerald-500/40',
    selectedBg: 'bg-emerald-500/10',
    selectedText: 'text-emerald-200',
  },
  zinc: {
    ring: 'ring-zinc-600/40',
    bg: 'bg-zinc-800/60',
    text: 'text-zinc-300',
    hoverBorder: 'hover:border-zinc-600',
    selectedBg: 'bg-zinc-700/40',
    selectedText: 'text-zinc-200',
  },
  sky: {
    ring: 'ring-sky-500/30',
    bg: 'bg-sky-500/10',
    text: 'text-sky-200',
    hoverBorder: 'hover:border-sky-500/40',
    selectedBg: 'bg-sky-500/10',
    selectedText: 'text-sky-200',
  },
  amber: {
    ring: 'ring-amber-500/30',
    bg: 'bg-amber-500/10',
    text: 'text-amber-200',
    hoverBorder: 'hover:border-amber-500/40',
    selectedBg: 'bg-amber-500/10',
    selectedText: 'text-amber-200',
  },
} as const;

/* ── Component ───────────────────────────────────────────────── */

export function CompactCombobox({
  items,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  multi = false,
  accent = 'zinc',
  triggerIcon,
  dropdownWidth = 'w-64',
  maxHeight = 280,
  renderItem,
  className = '',
  disabled = false,
  position = 'auto',
  emptyMessage = 'No options available',
}: CompactComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const colors = ACCENT[accent];
  const selectedSet = new Set(Array.isArray(value) ? value : [value]);

  // Flatten for label lookup
  const flatItems = flattenItems(items);
  const selectedLabels = flatItems.filter((i) => selectedSet.has(i.id)).map((i) => i.label);
  const triggerLabel = selectedLabels.length === 0
    ? placeholder
    : selectedLabels.length <= 2
      ? selectedLabels.join(', ')
      : `${selectedLabels[0]} +${selectedLabels.length - 1}`;

  /* ── Position the dropdown inside the viewport ── */
  const [pos, setPos] = useState<{ top: number; left: number; direction: 'below' | 'above' }>({ top: 0, left: 0, direction: 'below' });

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    // Use actual dropdown height if rendered, otherwise estimate
    const dropH = dropdownRef.current?.offsetHeight ?? (maxHeight + 52);

    const direction: 'below' | 'above' =
      position === 'above' ? 'above'
      : position === 'below' ? 'below'
      : spaceBelow >= dropH ? 'below'
      : spaceAbove >= dropH ? 'above'
      : spaceBelow > spaceAbove ? 'below' : 'above';

    const top = direction === 'below' ? rect.bottom + 4 : rect.top - dropH - 4;
    // Clamp horizontally: ensure the full dropdown width fits
    const dropW = dropdownRef.current?.offsetWidth ?? 260;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - dropW - 12));

    setPos({ top: Math.max(4, top), left, direction });
  }, [maxHeight, position]);

  /* ── Open/close handlers ── */
  const handleOpen = useCallback(() => {
    if (disabled) return;
    setSearch('');
    updatePosition();
    setOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [disabled, updatePosition]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSearch('');
  }, []);

  const handleToggle = useCallback(() => {
    if (open) handleClose();
    else handleOpen();
  }, [open, handleOpen, handleClose]);

  /* ── Click outside ── */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, handleClose]);

  /* ── Escape key ── */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  /* ── Resize reflow ── */
  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [open, updatePosition]);

  /* ── Scroll reflow ── */
  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener('scroll', handler, true);
    return () => window.removeEventListener('scroll', handler, true);
  }, [open, updatePosition]);

  /* ── Re-measure once dropdown renders (actual height may differ from estimate) ── */
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => updatePosition());
  }, [open, updatePosition]);

  /* ── Selection handler ── */
  const handleSelect = useCallback((id: string) => {
    if (multi) {
      const arr = Array.isArray(value) ? value : [value].filter(Boolean);
      const next = arr.includes(id) ? arr.filter((v) => v !== id) : [...arr, id];
      onChange(next);
    } else {
      onChange(id);
      handleClose();
    }
  }, [multi, value, onChange, handleClose]);

  /* ── Group items ── */
  const groups = groupItems(items);
  const visibleGroups = groups
    .map(({ group, items: groupItems }) => ({
      group,
      items: filterItems(groupItems, search),
    }))
    .filter(({ items: groupItems }) => groupItems.length > 0);
  const emptyStateLabel = search.trim()
    ? `No matches for “${search.trim()}”`
    : emptyMessage;

  return (
    <>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={handleToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`
          inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/60
          px-2.5 py-1 text-[11px] font-medium transition-all
          ${open ? `ring-1 ${colors.ring} border-zinc-600` : `${colors.hoverBorder}`}
          ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
          bg-zinc-900/80 backdrop-blur-sm
          ${className}
        `}
        title={triggerLabel}
      >
        {triggerIcon}
        <span className={`max-w-[120px] truncate ${selectedLabels.length > 0 ? colors.text : 'text-zinc-500'}`}>
          {triggerLabel}
        </span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown — portaled to body so it escapes any overflow/focus traps */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className={`
            fixed z-[100] ${dropdownWidth}
            rounded-xl border border-zinc-700/60 bg-zinc-900/95
            shadow-2xl shadow-black/30 backdrop-blur-xl
            overflow-hidden
          `}
          style={{
            top: pos.top,
            left: pos.left,
            animation: pos.direction === 'above' ? 'combobox-in-above 120ms ease-out' : 'combobox-in 120ms ease-out',
          }}
        >
          <Command shouldFilter={false} className="flex flex-col">
            {/* Search input */}
            <div className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <Command.Input
                ref={searchInputRef}
                value={search}
                onValueChange={setSearch}
                placeholder={searchPlaceholder}
                className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="rounded p-0.5 text-zinc-600 transition-colors hover:text-zinc-300"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Scrollable list */}
            <Command.List
              className="overflow-y-auto overflow-x-hidden combobox-scroll pb-1"
              style={{ maxHeight }}
            >
              {visibleGroups.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <span className="text-xs text-zinc-600">{emptyStateLabel}</span>
                </div>
              )}

              {visibleGroups.map(({ group, items: groupItems }) => {
                const content = groupItems.map((item) => {
                  const selected = selectedSet.has(item.id);
                  return (
                    <Command.Item
                      key={item.id}
                      value={item.id}
                      disabled={item.disabled}
                      onSelect={() => handleSelect(item.id)}
                      className={`
                        group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs
                        cursor-pointer outline-none transition-colors
                        data-[selected=true]:bg-zinc-800/70
                        ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-zinc-800/50'}
                        ${selected ? colors.selectedBg : ''}
                      `}
                    >
                      {renderItem ? (
                        renderItem(item, selected)
                      ) : (
                        <>
                          {item.icon && <span className="shrink-0">{item.icon}</span>}
                          <span className={`flex-1 truncate ${selected ? colors.selectedText : 'text-zinc-300'}`}>
                            {item.label}
                          </span>
                          {item.hint && (
                            <span className="shrink-0 text-[10px] text-zinc-600">{item.hint}</span>
                          )}
                          {multi && selected && (
                            <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                          )}
                          {!multi && selected && (
                            <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                          )}
                        </>
                      )}
                    </Command.Item>
                  );
                });

                return group ? (
                  <Command.Group key={group} className="px-1.5 pt-2">
                    <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                      {group}
                    </div>
                    {content}
                  </Command.Group>
                ) : (
                  <div key="ungrouped" className="px-1.5 py-1">
                    {content}
                  </div>
                );
              })}
            </Command.List>
          </Command>
        </div>,
        document.body,
      )}
    </>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

function flattenItems(items: ComboboxItem[]): ComboboxItem[] {
  const result: ComboboxItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children) result.push(...flattenItems(item.children));
  }
  return result;
}

interface GroupedItems {
  group: string | null;
  items: ComboboxItem[];
}

function groupItems(items: ComboboxItem[]): GroupedItems[] {
  const map = new Map<string | null, ComboboxItem[]>();
  for (const item of items) {
    const key = item.group ?? null;
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
}

function filterItems(items: ComboboxItem[], query: string): ComboboxItem[] {
  if (!query.trim()) return items;
  const q = query.toLowerCase();
  return items.filter((item) =>
    item.label.toLowerCase().includes(q) ||
    item.hint?.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q) ||
    item.group?.toLowerCase().includes(q)
  );
}
