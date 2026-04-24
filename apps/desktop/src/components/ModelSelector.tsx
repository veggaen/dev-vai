import { useSettingsStore } from '../stores/settingsStore.js';
import { CompactCombobox } from './CompactCombobox.js';
import { Cpu } from 'lucide-react';
import { useMemo } from 'react';

export function ModelSelector() {
  const { models, selectedModelId, setSelectedModelId } = useSettingsStore();

  const items = useMemo(() => {
    return models.map((m) => ({
      id: m.id,
      label: m.displayName,
      group: m.provider,
    }));
  }, [models]);

  return (
    <CompactCombobox
      items={items}
      value={selectedModelId ?? ''}
      onChange={(v) => setSelectedModelId(v as string)}
      placeholder="Select model…"
      searchPlaceholder="Search models…"
      accent="blue"
      triggerIcon={<Cpu className="h-3 w-3 text-blue-400/60" />}
      maxHeight={280}
    />
  );
}
