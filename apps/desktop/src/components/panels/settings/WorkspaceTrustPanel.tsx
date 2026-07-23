import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Copy, Download, ExternalLink, FileKey2, Link2,
  Plus, RefreshCw, Save, ShieldCheck, Trash2,
} from 'lucide-react';
import { z } from 'zod';
import {
  blindComparisonSessionSchema,
  environmentSchema,
  governedMemorySchema,
  hardwareModelReportSchema,
  healthSnapshotSchema,
  personaSchema,
  restoreBundleReportSchema,
  shareManifestSchema,
  sharePublishReceiptSchema,
  skillRecordSchema,
  type BlindComparisonSession,
  type GovernedMemory,
  type HealthSnapshot,
  type Persona,
  type ShareManifest,
  type SkillRecord,
} from '@vai/contracts/adoption';
import { toast } from 'sonner';
import { apiFetch } from '../../../lib/api.js';
import { useEnvironmentStore } from '../../../stores/environmentStore.js';
import { useSettingsStore } from '../../../stores/settingsStore.js';
import { useWorkspaceStore } from '../../../stores/workspaceStore.js';
import { readWorkspaceFile } from '../../../lib/ide/workspace-client.js';
import { SettingsCard, SettingsField, SettingsSection, SettingsSelect } from './SettingsShell.js';

type OpsTab = 'health' | 'environments' | 'knowledge' | 'sharing';
const OPS_TABS: Array<{ id: OpsTab; label: string }> = [
  { id: 'health', label: 'Health' },
  { id: 'environments', label: 'Environments' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'sharing', label: 'Share & links' },
];

async function responseJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

async function copyText(value: string, label: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  toast.success(`${label} copied`);
}

function StateDot({ state }: { state: string }) {
  const tone = state === 'healthy' ? 'bg-emerald-400' : state === 'degraded' || state === 'starting' ? 'bg-amber-400' : 'bg-rose-400';
  return <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden />;
}

function HealthPane() {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [hardware, setHardware] = useState<z.infer<typeof hardwareModelReportSchema> | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [healthBody, hardwareBody] = await Promise.all([
        apiFetch('/api/health/detail').then(responseJson),
        apiFetch('/api/hardware/models').then(responseJson),
      ]);
      setHealth(healthSnapshotSchema.parse(healthBody));
      setHardware(hardwareModelReportSchema.parse(hardwareBody));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Health check failed');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <>
      <SettingsSection title="System health" description="Optional services report their real state and the exact impact when unavailable.">
        <SettingsCard className="!p-0">
          <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--fg)]">
              <Activity className="h-4 w-4" /> {health ? `Overall: ${health.overall}` : 'Checking subsystems…'}
            </div>
            <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-md p-1.5 text-[color:var(--color-muted)] hover:bg-[color:var(--panel-bg-muted)] hover:text-[color:var(--fg)]" aria-label="Refresh health">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="divide-y divide-[color:var(--border)]">
            {health?.subsystems.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-medium text-[color:var(--fg)]">
                  <StateDot state={item.state} /> {item.label}
                  {item.optional && <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-muted)]">optional</span>}
                  <span className="ml-auto text-[10px] capitalize text-[color:var(--color-muted)]">{item.state}</span>
                </div>
                <p className="mt-1.5 pl-4 text-[11px] leading-5 text-[color:var(--color-muted)]">{item.impact}</p>
                {item.cause && <p className="pl-4 text-[11px] leading-5 text-amber-300/90">{item.cause}</p>}
                {item.nextAction && <p className="pl-4 text-[11px] leading-5 text-[color:var(--fg)]">Next: {item.nextAction}</p>}
              </div>
            ))}
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Local model fit" description="Scores reflect detected memory, backend, quantization, and model age—not a generic recommendation.">
        <SettingsCard className="!p-0">
          {hardware && (
            <div className="border-b border-[color:var(--border)] px-4 py-3 text-[11px] leading-5 text-[color:var(--color-muted)]">
              <span className="font-medium text-[color:var(--fg)]">{hardware.hardware.cpu}</span> · {hardware.hardware.logicalCores} threads · {Math.round(hardware.hardware.ramBytes / 1024 ** 3)} GB RAM
            </div>
          )}
          <div className="divide-y divide-[color:var(--border)]">
            {hardware?.models.map((model) => (
              <div key={model.modelId} className="flex items-start gap-3 px-4 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--panel-bg-muted)] text-xs font-semibold text-[color:var(--fg)]">{model.score}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[color:var(--fg)]"><span>{model.modelId}</span><span className="text-[10px] capitalize text-[color:var(--color-muted)]">{model.fitLabel.replaceAll('-', ' ')}</span></div>
                  <p className="mt-1 text-[11px] leading-5 text-[color:var(--color-muted)]">{model.reasons.join(' · ')}</p>
                  {model.nextAction && <p className="text-[11px] text-[color:var(--fg)]">Next: {model.nextAction}</p>}
                </div>
              </div>
            ))}
            {hardware?.hardware.failures.map((failure) => (
              <div key={`${failure.check}:${failure.command}`} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-xs font-medium text-amber-300/90"><span>{failure.check}</span><button type="button" onClick={() => void copyText(`${failure.command}\n${failure.output}`, 'Diagnostic')} className="inline-flex items-center gap-1 text-[10px] text-[color:var(--color-muted)] hover:text-[color:var(--fg)]"><Copy className="h-3 w-3" /> Copy detail</button></div>
                <code className="mt-2 block max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-black/20 p-2 text-[10px] leading-4 text-[color:var(--color-muted)]">{failure.command}{'\n'}{failure.output}</code>
                <p className="mt-1 text-[11px] text-[color:var(--fg)]">Next: {failure.nextAction}</p>
              </div>
            ))}
          </div>
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function EnvironmentsPane() {
  const localRoot = useWorkspaceStore((state) => state.localRoot);
  const environments = useEnvironmentStore((state) => state.environments);
  const activeId = useEnvironmentStore((state) => state.activeEnvironmentId);
  const fetchEnvironments = useEnvironmentStore((state) => state.fetchEnvironments);
  const setActive = useEnvironmentStore((state) => state.setActiveEnvironment);
  const [name, setName] = useState('My device');
  const [transport, setTransport] = useState<'loopback' | 'lan' | 'private-mesh' | 'https' | 'ssh'>('loopback');
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:3006');
  const [pairing, setPairing] = useState<{ token: string; pairingFragment: string; expiresAt: number } | null>(null);
  const [workspaceScope, setWorkspaceScope] = useState<'read-only' | 'no-shell' | 'no-network' | 'full'>('read-only');

  useEffect(() => { void fetchEnvironments(); }, [fetchEnvironments]);
  useEffect(() => {
    if (!localRoot) return;
    void apiFetch(`/api/capabilities?workspaceId=${encodeURIComponent(localRoot)}`).then(responseJson).then((body) => {
      const parsed = z.object({ grants: z.array(z.object({ workspaceScope: z.enum(['read-only', 'no-shell', 'no-network', 'full']), sessionId: z.string().optional() }).passthrough()) }).parse(body);
      const workspaceGrant = parsed.grants.find((grant) => !grant.sessionId);
      setWorkspaceScope(workspaceGrant?.workspaceScope ?? 'read-only');
    }).catch(() => undefined);
  }, [localRoot]);
  const addEnvironment = async () => {
    try {
      const body = await apiFetch('/api/environments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, transport, endpoint, deviceLabel: name, exposed: transport !== 'loopback' }) }).then(responseJson);
      const saved = environmentSchema.parse(body);
      await fetchEnvironments(); setActive(saved.id); toast.success('Environment saved');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save environment'); }
  };
  const createPairing = async (environmentId: string) => {
    try {
      const body = await apiFetch('/api/pairing/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ environmentId, integrationId: 'vai-desktop', scopes: ['connect'] }) }).then(responseJson);
      const parsed = z.object({ token: z.string(), pairingFragment: z.string(), expiresAt: z.number() }).parse(body);
      setPairing(parsed);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Pairing failed'); }
  };
  const saveCapability = async () => {
    if (!localRoot) { toast.error('Attach a workspace first'); return; }
    try {
      await apiFetch('/api/capabilities', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: localRoot, scope: workspaceScope }) }).then(responseJson);
      toast.success(`Workspace capability set to ${workspaceScope}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Capability grant failed'); }
  };
  return (
    <>
      <SettingsSection title="Capability matrix" description="The runtime—not this UI—intersects workspace and session grants at dispatch. Repository configuration can never increase this scope.">
        <SettingsCard>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <SettingsField label="Workspace maximum" hint={localRoot ?? 'Attach a workspace to create a host-owned grant.'}>
              <SettingsSelect value={workspaceScope} onChange={(event) => setWorkspaceScope(event.target.value as typeof workspaceScope)} disabled={!localRoot}>
                <option value="read-only">Read-only · file reads only</option><option value="no-shell">No shell · writes and network, no processes</option><option value="no-network">No network · local processes and writes</option><option value="full">Full · read, write, shell, network, git, process</option>
              </SettingsSelect>
            </SettingsField>
            <button type="button" onClick={() => void saveCapability()} disabled={!localRoot} className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-3 py-2.5 text-xs font-medium text-[color:var(--fg)] disabled:opacity-40">Save grant</button>
          </div>
          {workspaceScope === 'full' && <p className="mt-3 text-[11px] leading-5 text-amber-300/90">Full allows opaque provider CLIs to run project code with your OS account. Vai still records the session, but portable OS-level containment is not claimed.</p>}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Saved environments" description="One saved connection regardless of transport. Every server remains loopback-only until you explicitly expose it.">
        <SettingsCard className="!p-0">
          <div className="divide-y divide-[color:var(--border)]">
            {environments.map((environment) => (
              <div key={environment.id} className="flex items-center gap-3 px-4 py-3">
                <button type="button" onClick={() => setActive(environment.id)} className={`h-3 w-3 rounded-full border ${activeId === environment.id ? 'border-[color:var(--accent)] bg-[color:var(--accent)]' : 'border-[color:var(--border)]'}`} aria-label={`Use ${environment.name}`} />
                <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-[color:var(--fg)]">{environment.name}</div><div className="truncate text-[10px] text-[color:var(--color-muted)]">{environment.transport} · {environment.endpoint} · {environment.trust}</div></div>
                <button type="button" onClick={() => void createPairing(environment.id)} className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[10px] text-[color:var(--fg)] hover:bg-[color:var(--panel-bg-muted)]">Pair</button>
              </div>
            ))}
            {environments.length === 0 && <p className="px-4 py-5 text-center text-xs text-[color:var(--color-muted)]">No saved environments yet.</p>}
          </div>
        </SettingsCard>
      </SettingsSection>
      {pairing && (
        <SettingsSection title="One-time pairing">
          <SettingsCard>
            <div className="flex items-start gap-3"><FileKey2 className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--accent-text)]" /><div className="min-w-0 flex-1"><p className="text-xs leading-5 text-[color:var(--fg)]">Valid until {new Date(pairing.expiresAt).toLocaleTimeString()}. It can be exchanged once and is carried in a URL hash, never a query.</p><code className="mt-2 block break-all rounded-md bg-[color:var(--panel-bg-muted)] p-2 text-[10px] text-[color:var(--color-muted)]">{pairing.pairingFragment}</code><button type="button" onClick={() => void copyText(pairing.token, 'Pairing token')} className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-[color:var(--fg)]"><Copy className="h-3 w-3" /> Copy token</button></div></div>
          </SettingsCard>
        </SettingsSection>
      )}
      <SettingsSection title="Add environment">
        <SettingsCard className="grid gap-3 sm:grid-cols-2">
          <SettingsField label="Name"><input value={name} onChange={(event) => setName(event.target.value)} className="vai-input w-full px-3 py-2 text-xs" /></SettingsField>
          <SettingsField label="Transport"><SettingsSelect value={transport} onChange={(event) => setTransport(event.target.value as typeof transport)}>{['loopback', 'lan', 'private-mesh', 'https', 'ssh'].map((value) => <option key={value}>{value}</option>)}</SettingsSelect></SettingsField>
          <SettingsField label="Endpoint"><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} className="vai-input w-full px-3 py-2 text-xs" /></SettingsField>
          <div className="flex items-end"><button type="button" onClick={() => void addEnvironment()} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-3 py-2 text-xs font-medium text-[color:var(--fg)]"><Plus className="h-3.5 w-3.5" /> Save environment</button></div>
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function KnowledgePane() {
  const models = useSettingsStore((state) => state.models);
  const [memories, setMemories] = useState<GovernedMemory[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [comparePrompt, setComparePrompt] = useState('');
  const [comparison, setComparison] = useState<BlindComparisonSession | null>(null);
  const [personaName, setPersonaName] = useState('');
  const [personaPrompt, setPersonaPrompt] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [memoryBody, skillBody, personaBody] = await Promise.all([
        apiFetch('/api/memory').then(responseJson), apiFetch('/api/learned-skills').then(responseJson), apiFetch('/api/personas').then(responseJson),
      ]);
      setMemories(z.object({ memories: z.array(governedMemorySchema) }).parse(memoryBody).memories);
      setSkills(z.object({ skills: z.array(skillRecordSchema) }).parse(skillBody).skills);
      setPersonas(z.object({ personas: z.array(personaSchema) }).parse(personaBody).personas);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Knowledge request failed'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const patchMemory = async (memory: GovernedMemory, patch: Record<string, unknown>) => {
    await apiFetch(`/api/memory/${encodeURIComponent(memory.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(responseJson); await refresh();
  };
  const remove = async (path: string) => { await apiFetch(path, { method: 'DELETE' }).then(responseJson); await refresh(); };
  const createPersona = async () => {
    try { await apiFetch('/api/personas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: personaName, description: 'User-authored profile', systemPrompt: personaPrompt, capabilityCeiling: 'read-only' }) }).then(responseJson); setPersonaName(''); setPersonaPrompt(''); await refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Persona could not be saved'); }
  };
  const runCompare = async () => {
    const modelIds = models.slice(0, 2).map((model) => model.id);
    if (modelIds.length < 2) { toast.error('Connect at least two models for blind compare'); return; }
    try { const body = await apiFetch('/api/model-compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: comparePrompt, modelIds, personaIds: [] }) }).then(responseJson); setComparison(blindComparisonSessionSchema.parse(body)); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Compare failed'); }
  };
  return (
    <>
      <SettingsSection title="Inspectable memory" description="Automatic memory remains yours: edit, archive, or permanently delete every record.">
        <SettingsCard className="!p-0"><div className="divide-y divide-[color:var(--border)]">{memories.map((memory) => <MemoryRow key={memory.id} memory={memory} onSave={(patch) => void patchMemory(memory, patch)} onDelete={() => void remove(`/api/memory/${encodeURIComponent(memory.id)}`)} />)}{memories.length === 0 && <p className="px-4 py-5 text-center text-xs text-[color:var(--color-muted)]">No memories recorded.</p>}</div></SettingsCard>
      </SettingsSection>
      <SettingsSection title="Agent-authored skills" description="Low-confidence skills are visibly flagged and are never auto-trusted.">
        <SettingsCard className="!p-0"><div className="divide-y divide-[color:var(--border)]">{skills.map((skill) => <SkillRow key={skill.id} skill={skill} onRefresh={refresh} />)}{skills.length === 0 && <p className="px-4 py-5 text-center text-xs text-[color:var(--color-muted)]">No learned skills yet.</p>}</div></SettingsCard>
      </SettingsSection>
      <SettingsSection title="Personas & blind compare" description="Reusable profiles can join group sessions; compare lanes stay anonymous until you vote.">
        <SettingsCard className="space-y-3">
          <div className="flex flex-wrap gap-1.5">{personas.map((persona) => <span key={persona.id} className="rounded-full border border-[color:var(--border)] px-2 py-1 text-[10px] text-[color:var(--fg)]">{persona.name} · {persona.capabilityCeiling}</span>)}</div>
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"><input value={personaName} onChange={(event) => setPersonaName(event.target.value)} placeholder="Persona name" className="vai-input px-3 py-2 text-xs" /><input value={personaPrompt} onChange={(event) => setPersonaPrompt(event.target.value)} placeholder="System prompt profile" className="vai-input px-3 py-2 text-xs" /><button type="button" onClick={() => void createPersona()} className="rounded-lg border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--fg)]">Save</button></div>
          <div className="border-t border-[color:var(--border)] pt-3"><textarea value={comparePrompt} onChange={(event) => setComparePrompt(event.target.value)} placeholder="Send the same prompt to two models…" className="vai-input min-h-20 w-full px-3 py-2 text-xs" /><button type="button" onClick={() => void runCompare()} className="mt-2 rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-3 py-2 text-xs font-medium text-[color:var(--fg)]">Start blind A/B</button></div>
          {comparison && <div className="grid gap-2 sm:grid-cols-2">{comparison.candidates.map((candidate) => <button key={candidate.laneId} type="button" onClick={async () => { const body = await apiFetch(`/api/model-compare/${comparison.id}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ laneId: candidate.laneId }) }).then(responseJson); setComparison(blindComparisonSessionSchema.parse(body)); }} className="rounded-lg border border-[color:var(--border)] p-3 text-left text-xs leading-5 text-[color:var(--fg)]"><span className="mb-2 block text-[9px] uppercase tracking-widest text-[color:var(--color-muted)]">Anonymous lane</span>{candidate.text}</button>)}</div>}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function MemoryRow({ memory, onSave, onDelete }: { memory: GovernedMemory; onSave: (patch: Record<string, unknown>) => void; onDelete: () => void }) {
  const [content, setContent] = useState(memory.content);
  useEffect(() => setContent(memory.content), [memory.content]);
  return <div className="px-4 py-3"><div className="flex items-center gap-2"><span className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--accent-text)]">{memory.kind}</span><span className="text-[9px] text-[color:var(--color-muted)]">{memory.status}</span><div className="ml-auto flex gap-1"><button type="button" onClick={() => onSave({ content })} className="p-1 text-[color:var(--color-muted)] hover:text-[color:var(--fg)]" aria-label="Save memory"><Save className="h-3.5 w-3.5" /></button><button type="button" onClick={() => onSave({ status: memory.status === 'active' ? 'archived' : 'active' })} className="px-1 text-[9px] text-[color:var(--color-muted)] hover:text-[color:var(--fg)]">{memory.status === 'active' ? 'Archive' : 'Restore'}</button><button type="button" onClick={onDelete} className="p-1 text-[color:var(--color-muted)] hover:text-rose-300" aria-label="Delete memory"><Trash2 className="h-3.5 w-3.5" /></button></div></div><textarea value={content} onChange={(event) => setContent(event.target.value)} className="mt-2 min-h-14 w-full resize-y bg-transparent text-xs leading-5 text-[color:var(--fg)] outline-none" />{memory.sourceExcerpt && <p className="text-[10px] leading-4 text-[color:var(--color-muted)]">Evidence: “{memory.sourceExcerpt}”</p>}</div>;
}

function SkillRow({ skill, onRefresh }: { skill: SkillRecord; onRefresh: () => Promise<void> }) {
  const [content, setContent] = useState(skill.content);
  useEffect(() => setContent(skill.content), [skill.content]);
  const mutate = async (method: 'PATCH' | 'DELETE', body?: unknown) => { await apiFetch(`/api/learned-skills/${encodeURIComponent(skill.id)}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }).then(responseJson); await onRefresh(); };
  return <div className="px-4 py-3"><div className="flex items-center gap-2 text-xs font-medium text-[color:var(--fg)]"><span>{skill.name}</span>{skill.flagged && <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[9px] text-amber-300">low confidence</span>}<span className="ml-auto text-[10px] text-[color:var(--color-muted)]">{Math.round(skill.confidence * 100)}% · {skill.successes}/{skill.failures}</span></div><textarea value={content} onChange={(event) => setContent(event.target.value)} className="mt-2 min-h-16 w-full resize-y bg-transparent text-[11px] leading-5 text-[color:var(--color-muted)] outline-none" /><div className="flex gap-3"><button type="button" onClick={() => void mutate('PATCH', { content })} className="text-[10px] font-medium text-[color:var(--fg)]">Save changes</button><button type="button" onClick={() => void mutate('DELETE')} className="text-[10px] text-rose-300/90">Delete</button></div></div>;
}

function SharingPane() {
  const localRoot = useWorkspaceStore((state) => state.localRoot);
  const localName = useWorkspaceStore((state) => state.localName);
  const tree = useWorkspaceStore((state) => state.tree);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [protection, setProtection] = useState<'public' | 'authenticated' | 'token' | 'private'>('authenticated');
  const [manifest, setManifest] = useState<ShareManifest | null>(null);
  const [customCss, setCustomCss] = useState('');
  const [domain, setDomain] = useState('');
  const [domainResult, setDomainResult] = useState('');
  const [backupFolder, setBackupFolder] = useState('');
  const [restoreReport, setRestoreReport] = useState<z.infer<typeof restoreBundleReportSchema> | null>(null);
  const [linkGraph, setLinkGraph] = useState<{ objects: Array<{ id: string; label: string; path?: string }>; edges: Array<{ sourceId: string; targetRef: string; label: string }> }>({ objects: [], edges: [] });
  const workspaceId = localRoot ?? 'detached-workspace';
  const files = useMemo(() => tree.filter((entry) => !entry.dir), [tree]);

  useEffect(() => {
    void apiFetch('/api/shares').then(responseJson).then((body) => {
      const parsed = z.object({ manifests: z.array(shareManifestSchema) }).parse(body);
      const current = parsed.manifests.find((item) => item.workspaceId === workspaceId) ?? null;
      setManifest(current); setSelected(new Set(current?.items.filter((item) => item.included).map((item) => item.path) ?? []));
    }).catch(() => undefined);
  }, [workspaceId]);
  const refreshGraph = useCallback(async () => {
    try {
      const body = await apiFetch(`/api/links/graph?workspaceId=${encodeURIComponent(workspaceId)}`).then(responseJson);
      setLinkGraph(z.object({ objects: z.array(z.object({ id: z.string(), label: z.string(), path: z.string().optional() }).passthrough()), edges: z.array(z.object({ sourceId: z.string(), targetRef: z.string(), label: z.string() }).passthrough()) }).parse(body));
    } catch { /* empty index is a valid degraded state */ }
  }, [workspaceId]);
  useEffect(() => { void refreshGraph(); }, [refreshGraph]);

  const publish = async () => {
    const currentByPath = new Map(manifest?.items.map((item) => [item.path, item]) ?? []);
    const knownPaths = new Set([...files.map((file) => file.path), ...(manifest?.items.map((item) => item.path) ?? [])]);
    const items = await Promise.all([...knownPaths].map(async (path) => {
      const open = tabs.find((tab) => tab.path === path);
      let content = open?.draft ?? currentByPath.get(path)?.content;
      if (selected.has(path) && content === undefined && localRoot) {
        try { content = await readWorkspaceFile(localRoot, path); } catch { /* visible as unavailable permalink */ }
      }
      return {
        objectId: currentByPath.get(path)?.objectId ?? crypto.randomUUID(), path,
        slug: currentByPath.get(path)?.slug ?? (path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID().slice(0, 8)),
        protection: currentByPath.get(path)?.protection ?? protection, included: selected.has(path),
        ...(content !== undefined ? { content } : {}),
        ...(customCss.trim() ? { themeCss: customCss } : currentByPath.get(path)?.themeCss ? { themeCss: currentByPath.get(path)?.themeCss } : {}),
      };
    }));
    if (items.length === 0) { toast.error('Attach a workspace with files first'); return; }
    try { const body = await apiFetch('/api/shares/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, items }) }).then(responseJson); const receipt = sharePublishReceiptSchema.parse(body); setManifest(receipt.manifest); toast.success(`Published revision ${receipt.manifest.revision} in ${Date.now() - receipt.publishedAt < 5000 ? 'seconds' : 'the background'}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Publish failed'); }
  };
  const indexOpenFiles = async () => {
    try { await Promise.all(tabs.map((tab) => apiFetch('/api/links/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, object: { id: `file:${tab.path}`, kind: 'file', label: tab.path.split(/[\\/]/).pop() ?? tab.path, path: tab.path, updatedAt: Date.now() }, content: tab.draft }) }).then(responseJson))); await refreshGraph(); toast.success(`Indexed ${tabs.length} open file${tabs.length === 1 ? '' : 's'}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Link indexing failed'); }
  };
  const exportFolder = async () => {
    if (!localRoot) { toast.error('Attach a local folder first'); return; }
    try { const body = await apiFetch('/api/export/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetRoot: localRoot }) }).then(responseJson); const result = z.object({ path: z.string(), files: z.array(z.string()) }).parse(body); setBackupFolder(result.path); setRestoreReport(null); toast.success(`Exported ${result.files.length} stores to ${result.path}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Export failed'); }
  };
  const restoreFolder = async (apply: boolean) => {
    if (!backupFolder.trim()) { toast.error('Choose an exported Vai backup folder first'); return; }
    try {
      const body = await apiFetch('/api/export/restore-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceFolder: backupFolder, dryRun: !apply, overwrite: false }) }).then(responseJson);
      const report = restoreBundleReportSchema.parse(body); setRestoreReport(report);
      toast.success(apply ? `Restored ${Object.values(report.applied).reduce((sum, count) => sum + count, 0)} new records` : `Dry run complete: ${report.conflicts.length} conflicts preserved`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Restore check failed'); }
  };
  const verifyDomain = async () => {
    try {
      const body = await apiFetch('/api/shares/domain/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain }) }).then(responseJson);
      const result = z.object({ verified: z.boolean(), records: z.array(z.string()), diagnostic: z.string(), nextAction: z.string() }).parse(body);
      setDomainResult(`${result.verified ? 'Verified' : 'Not verified'} · ${result.records.join(', ') || 'no matching DNS records'} · ${result.nextAction}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'DNS verification failed'); }
  };
  return <>
    <SettingsSection title="Selective sharing" description="Review every exposed item at a glance. Protection is explicit and omitted files remain private.">
      <SettingsCard className="!p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--border)] px-4 py-3"><span className="text-xs font-medium text-[color:var(--fg)]">{localName ?? 'No workspace'} · {selected.size} exposed</span><SettingsSelect value={protection} onChange={(event) => setProtection(event.target.value as typeof protection)} className="ml-auto !w-auto !py-1.5 text-[10px]"><option value="public">Public</option><option value="authenticated">Signed in</option><option value="token">Protected token</option><option value="private">Private</option></SettingsSelect><button type="button" onClick={() => void publish()} className="rounded-md border border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-2.5 py-1.5 text-[10px] font-medium text-[color:var(--fg)]">Publish now</button></div>
        <div className="max-h-72 divide-y divide-[color:var(--border)] overflow-auto">{files.map((file) => <label key={file.path} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-xs text-[color:var(--fg)]"><input type="checkbox" checked={selected.has(file.path)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(file.path); else next.delete(file.path); return next; })} className="accent-[color:var(--accent)]" /><span className="min-w-0 flex-1 truncate">{file.path}</span><span className="text-[9px] capitalize text-[color:var(--color-muted)]">{manifest?.items.find((item) => item.path === file.path)?.protection ?? protection}</span></label>)}{files.length === 0 && <p className="px-4 py-5 text-center text-xs text-[color:var(--color-muted)]">Attach a workspace to choose files.</p>}</div>
        <div className="border-t border-[color:var(--border)] px-4 py-3"><label className="text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-muted)]">Optional share CSS</label><textarea value={customCss} onChange={(event) => setCustomCss(event.target.value)} placeholder="body { font-family: system-ui; }" className="vai-input mt-2 min-h-14 w-full px-3 py-2 font-mono text-[10px]" /></div>
        {manifest && <div className="border-t border-[color:var(--border)] px-4 py-3 text-[10px] text-[color:var(--color-muted)]">Stable manifest · revision {manifest.revision} · {manifest.items.filter((item) => item.included).length} live permalink{manifest.items.filter((item) => item.included).length === 1 ? '' : 's'}</div>}
      </SettingsCard>
    </SettingsSection>
    <SettingsSection title="Links, previews & ownership" description="Index only changed/open files; backlinks and graph data stay incremental and exportable.">
      <SettingsCard>
        <div className="grid gap-2 sm:grid-cols-3"><button type="button" onClick={() => void indexOpenFiles()} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--fg)]"><Link2 className="h-3.5 w-3.5" /> Index open files</button><button type="button" onClick={() => void exportFolder()} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--fg)]"><Download className="h-3.5 w-3.5" /> Export folder</button><a href="/api/export" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--fg)]"><ExternalLink className="h-3.5 w-3.5" /> Export JSON</a></div>
        <div className="mt-3 grid gap-2 border-t border-[color:var(--border)] pt-3 sm:grid-cols-[1fr_auto_auto]"><input value={backupFolder} onChange={(event) => { setBackupFolder(event.target.value); setRestoreReport(null); }} placeholder="Exported Vai backup folder" className="vai-input min-w-0 px-3 py-2 text-xs" /><button type="button" onClick={() => void restoreFolder(false)} className="rounded-lg border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--fg)]">Check restore</button><button type="button" disabled={!restoreReport?.dryRun} onClick={() => void restoreFolder(true)} className="rounded-lg border border-[color:var(--accent)] px-3 py-2 text-xs text-[color:var(--fg)] disabled:cursor-not-allowed disabled:opacity-40">Restore new</button></div>
        {restoreReport && <p className="mt-2 text-[10px] leading-4 text-[color:var(--color-muted)]">{restoreReport.dryRun ? 'Dry run' : 'Applied'} · {restoreReport.conflicts.length} existing IDs preserved · {Object.values(restoreReport.wouldApply).reduce((sum, count) => sum + count, 0)} records eligible</p>}
        {linkGraph.objects.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[color:var(--border)] pt-3">{linkGraph.objects.map((object) => { const outgoing = linkGraph.edges.filter((edge) => edge.sourceId === object.id); const incoming = linkGraph.edges.filter((edge) => edge.targetRef.toLowerCase() === (object.path ?? object.label).toLowerCase()); return <span key={object.id} className="group relative rounded-full border border-[color:var(--border)] px-2 py-1 text-[10px] text-[color:var(--fg)]">{object.label}<span className="ml-1 text-[color:var(--color-muted)]">{incoming.length}← {outgoing.length}→</span><span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-56 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] p-2 text-[10px] leading-4 text-[color:var(--color-muted)] shadow-xl group-hover:block">{object.path ?? object.label}<br />Backlinks: {incoming.map((edge) => edge.label).join(', ') || 'none'}<br />Links to: {outgoing.map((edge) => edge.targetRef).join(', ') || 'none'}</span></span>; })}</div>}
      </SettingsCard>
    </SettingsSection>
    <SettingsSection title="Custom domain" description="Vai checks real CNAME/TXT DNS records; it never treats a text field as proof of ownership."><SettingsCard><div className="flex gap-2"><input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="docs.example.com" className="vai-input min-w-0 flex-1 px-3 py-2 text-xs" /><button type="button" onClick={() => void verifyDomain()} className="rounded-lg border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--fg)]">Verify DNS</button></div>{domainResult && <p className="mt-2 text-[11px] leading-5 text-[color:var(--color-muted)]">{domainResult}</p>}</SettingsCard></SettingsSection>
  </>;
}

export function WorkspaceTrustPanel() {
  const [tab, setTab] = useState<OpsTab>('health');
  return <div>
    <div className="mb-6 flex items-start gap-3"><div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]"><ShieldCheck className="h-4 w-4" /></div><div><h2 className="text-lg font-semibold text-[color:var(--fg)]">Workspace & trust</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[color:var(--color-muted)]">Inspect degraded services, paired devices, learned knowledge, and exactly what leaves this workspace.</p></div></div>
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-[color:var(--border)]">{OPS_TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`relative shrink-0 px-3 py-2 text-xs font-medium ${tab === item.id ? 'text-[color:var(--fg)] after:absolute after:inset-x-2 after:-bottom-px after:h-px after:bg-[color:var(--accent)]' : 'text-[color:var(--color-muted)] hover:text-[color:var(--fg)]'}`}>{item.label}</button>)}</div>
    {tab === 'health' && <HealthPane />}{tab === 'environments' && <EnvironmentsPane />}{tab === 'knowledge' && <KnowledgePane />}{tab === 'sharing' && <SharingPane />}
  </div>;
}
