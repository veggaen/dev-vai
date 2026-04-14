import { create } from 'zustand';
import { API_BASE } from '../lib/api.js';

type EngineStatus = 'idle' | 'starting' | 'ready' | 'error' | 'offline' | 'reconnecting';

interface EngineStats {
  vocabSize: number;
  knowledgeEntries: number;
  documentsIndexed: number;
  ngramContexts: number;
}

interface EngineState {
  status: EngineStatus;
  /** True once we've successfully connected at least once — never resets */
  hasEverConnected: boolean;
  error: string | null;
  stats: EngineStats | null;
  startPolling: () => void;
  retry: () => void;
}

let pollInterval: ReturnType<typeof setInterval> | null = null;
let pollTimeout: ReturnType<typeof setTimeout> | null = null;
let polling = false;

function isTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invokeNativeEngine(command: 'start_engine' | 'stop_engine'): Promise<void> {
  if (!isTauriApp()) return;

  const { invoke } = await import('@tauri-apps/api/core');
  await invoke(command);
}

async function startNativeEngine(): Promise<void> {
  try {
    await invokeNativeEngine('start_engine');
  } catch (error) {
    console.error('[VAI] Failed to start native engine', error);
  }
}

async function restartNativeEngine(): Promise<void> {
  if (!isTauriApp()) return;

  try {
    await invokeNativeEngine('stop_engine');
  } catch {
    // Ignore stop failures when no child is running yet.
  }

  await startNativeEngine();
}

function stopPolling() {
  polling = false;
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; }
}

export const useEngineStore = create<EngineState>((set, get) => ({
  status: 'idle',
  hasEverConnected: false,
  error: null,
  stats: null,

  retry: () => {
    stopPolling();
    set({ status: 'idle', error: null });
    void restartNativeEngine();
    setTimeout(() => get().startPolling(), 50);
  },

  startPolling: () => {
    // Already connected or already polling — skip
    if (get().status === 'ready') return;
    if (polling) return;

    console.log('[VAI] Starting engine poll...', { API_BASE });
    polling = true;
    void startNativeEngine();

    // Only show boot screen if we've NEVER connected before.
    // If we've been connected before, use 'reconnecting' (no full-page flash).
    if (get().hasEverConnected) {
      set({ status: 'reconnecting' });
    } else {
      set({ status: 'starting' });
    }

    const poll = async () => {
      if (!polling) return;
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (!polling) return; // check again after await
        if (res.ok) {
          const data = await res.json();
          console.log('[VAI] Engine ready:', data);
          stopPolling();
          set({ status: 'ready', hasEverConnected: true, error: null, stats: data.stats ?? null });
          startHealthMonitor();
        }
      } catch {
        // Server not up yet, keep polling
      }
    };

    poll();
    pollInterval = setInterval(poll, 2000);

    // Only timeout on initial connect — don't timeout reconnections
    if (!get().hasEverConnected) {
      pollTimeout = setTimeout(() => {
        if (!polling) return;
        stopPolling();
        set({ status: 'error', error: 'Engine failed to start within 30 seconds' });
      }, 30_000);
    }
  },
}));

let monitorInterval: ReturnType<typeof setInterval> | null = null;

function startHealthMonitor() {
  if (monitorInterval) clearInterval(monitorInterval);
  let failCount = 0;

  monitorInterval = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        const data = await res.json();
        const prev = useEngineStore.getState();
        // Only update state if something actually changed — prevents unnecessary re-renders
        if (prev.status !== 'ready' || prev.stats?.vocabSize !== data.stats?.vocabSize) {
          useEngineStore.setState({ status: 'ready', hasEverConnected: true, error: null, stats: data.stats ?? null });
        }
        failCount = 0;
      } else {
        failCount++;
      }
    } catch {
      failCount++;
    }

    if (failCount >= 3) {
      // Don't blast the UI — use 'reconnecting' and auto-try to reconnect
      const store = useEngineStore.getState();
      if (store.status !== 'reconnecting') {
        useEngineStore.setState({
          status: 'reconnecting',
          error: 'Reconnecting to AI engine...',
        });
      }
      // Auto-restart polling to reconnect
      if (!polling) {
        store.startPolling();
      }
    }
  }, 10_000);
}
