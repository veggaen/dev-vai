/**
 * BroadcastModelPicker — Compact searchable model selector for broadcast mode.
 *
 * Shows all models reported by connected IDEs (via dynamic discovery),
 * grouped by vendor/family, with a clean search-and-scroll UI.
 */

import { useMemo } from 'react';
import { Cpu } from 'lucide-react';
import { CompactCombobox, type ComboboxItem } from './CompactCombobox.js';

interface ModelInfo {
  family: string;
  label: string;
}

interface BroadcastModelPickerProps {
  models: ModelInfo[];
  value: string;
  onChange: (family: string) => void;
}

/* ── Vendor-detection heuristic for grouping ─────────────────── */

function detectVendor(family: string, label: string): string {
  const l = (family + ' ' + label).toLowerCase();
  if (l.includes('claude') || l.includes('haiku') || l.includes('opus') || l.includes('sonnet')) return 'Anthropic';
  if (l.includes('gpt') || l.includes('o3') || l.includes('o4') || l.includes('codex')) return 'OpenAI';
  if (l.includes('gemini')) return 'Google';
  if (l.includes('grok')) return 'xAI';
  if (l.includes('raptor') || l.includes('oswe')) return 'Other';
  if (l.includes('copilot-fast') || l.includes('auto')) return 'Copilot';
  return 'Other';
}

/* ── Tier badge for model class ─────────────────────────────── */

function modelTier(family: string): string | undefined {
  const l = family.toLowerCase();
  if (l.includes('opus') || l.includes('5.4') || l.includes('5.3') || l.includes('codex-max')) return '★';
  if (l.includes('sonnet-4.6') || l.includes('5.2') || l.includes('5.1') || l.includes('2.5-pro') || l.includes('3.1-pro') || l.includes('3-pro')) return '◆';
  if (l.includes('mini') || l.includes('flash') || l.includes('fast') || l.includes('haiku')) return '⚡';
  return undefined;
}

/* ── Vendor sort order so groups appear in a logical sequence ── */

const VENDOR_ORDER: Record<string, number> = {
  Anthropic: 0,
  OpenAI: 1,
  Google: 2,
  xAI: 3,
  Copilot: 4,
  Other: 5,
};

/* ── Tier-weight for sorting within each vendor group ─────── */

function tierWeight(family: string): number {
  const l = family.toLowerCase();
  if (l.includes('opus') || l.includes('5.4') || l.includes('5.3') || l.includes('codex-max')) return 0;
  if (l.includes('pro') || l.includes('5.2') || l.includes('5.1') || l.includes('sonnet-4.6') || l.includes('sonnet-4.5')) return 1;
  if (l.includes('sonnet') || l.includes('4.1') || l.includes('5.') || l.includes('gpt-4o')) return 2;
  if (l.includes('mini') || l.includes('flash') || l.includes('fast') || l.includes('haiku')) return 3;
  return 2;
}

export function BroadcastModelPicker({ models, value, onChange }: BroadcastModelPickerProps) {
  const items = useMemo<ComboboxItem[]>(() => {
    const withMeta = models.map((m) => ({
      id: m.family,
      label: m.label,
      hint: modelTier(m.family),
      group: detectVendor(m.family, m.label),
      _vendorOrder: VENDOR_ORDER[detectVendor(m.family, m.label)] ?? 5,
      _tierWeight: tierWeight(m.family),
    }));

    // Sort: by vendor group order first, then by tier within each vendor
    withMeta.sort((a, b) => a._vendorOrder - b._vendorOrder || a._tierWeight - b._tierWeight);

    return withMeta.map(({ _vendorOrder: _, _tierWeight: __, ...item }) => item);
  }, [models]);

  return (
    <CompactCombobox
      items={items}
      value={value}
      onChange={(v) => onChange(v as string)}
      placeholder="Model"
      searchPlaceholder="Search models…"
      accent="blue"
      triggerIcon={<Cpu className="h-3 w-3 text-blue-400/60" />}
      dropdownWidth="w-72"
      maxHeight={280}
      position="above"
    />
  );
}
