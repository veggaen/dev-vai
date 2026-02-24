import { useSettingsStore } from '../stores/settingsStore.js';

export function ModelSelector() {
  const { models, selectedModelId, setSelectedModelId } = useSettingsStore();

  return (
    <select
      value={selectedModelId ?? ''}
      onChange={(e) => setSelectedModelId(e.target.value)}
      className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.displayName}
        </option>
      ))}
    </select>
  );
}
