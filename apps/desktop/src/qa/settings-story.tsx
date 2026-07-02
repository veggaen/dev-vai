import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  SettingsShell,
  SettingsSection,
  SettingsCard,
  SettingsField,
  SettingsSelect,
  SettingsSwitch,
  type SettingsTabId,
} from '../components/panels/settings/SettingsShell.js';
import '../styles/index.css';
import { initOdysseusThemeFromStorage } from '../lib/odysseus-theme.js';

initOdysseusThemeFromStorage();

/** Visual story for the redesigned settings shell — real primitives, no store/backend. QA only. */
function Story() {
  const [tab, setTab] = useState<SettingsTabId>('appearance');
  const [reduceChrome, setReduceChrome] = useState(true);
  const [timeline, setTimeline] = useState(true);
  return (
    <div style={{ height: 620, width: 900, border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', background: 'var(--panel-bg)' }}>
      <SettingsShell activeTab={tab} onTabChange={setTab} showOwnerSections>
        <SettingsSection title="Appearance" description="How Vai looks and feels. Changes apply instantly.">
          <SettingsCard className="space-y-5">
            <SettingsField label="Layout density" hint="Compact is edge-to-edge; Open floats panels with soft shadows.">
              <SettingsSelect defaultValue="odyssey">
                <option value="compact">Compact</option>
                <option value="open">Open</option>
                <option value="odyssey">Odyssey</option>
              </SettingsSelect>
            </SettingsField>
            <SettingsSwitch
              checked={timeline}
              onChange={setTimeline}
              label="Spatial reasoning timeline"
              description="Show each turn as a zoomable node constellation instead of a flat tree."
            />
            <SettingsSwitch
              checked={reduceChrome}
              onChange={setReduceChrome}
              label="Reveal controls on hover"
              description="Keep the resting surface minimal; surface tools only on intent."
            />
          </SettingsCard>
        </SettingsSection>
      </SettingsShell>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ padding: 40 }}>
      <Story />
    </div>
  </StrictMode>,
);
