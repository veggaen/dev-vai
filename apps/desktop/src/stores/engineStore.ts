import { create } from 'zustand';
import { API_BASE } from '../lib/api.js';

type EngineStatus = 'idle' | 'starting' | 'ready' | 'error' | 'offline';

interface EngineStats {
  vocabSize: number;
  knowledgeEntries: number;
  documentsIndexed: number;
  ngramContexts: number;
}

interface EngineState {
  status: EngineStatus;
  error: string | null;
  stats: EngineStats | null;
  startPolling: () => void;
  retry: () => void;
}

let pollInterval: ReturnType<typeof setInterval> | null = null;
let pollTimeout: ReturnType<typeof setTimeout> | null = null;
let polling = false;

function stopPolling() {
  polling = false;
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; }
}

export const useEngineStore = create<EngineState>((set, get) => ({
  status: 'idle',
  error: null,
  stats: null,

  retry: () => {
    stopPolling();
    set({ status: 'idle', error: null });
    setTimeout(() => get().startPolling(), 50);
  },

  startPolling: () => {
    // Already connected or already polling — skip
    if (get().status === 'ready') return;
    if (polling) return;

    console.log('[VAI] Starting engine poll...', { API_BASE });
    polling = true;
    set({ status: 'starting' });

    const poll = async () => {
      if (!polling) return;
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (!polling) return; // check again after await
        if (res.ok) {
          const data = await res.json();
          console.log('[VAI] Engine ready:', data);
          stopPolling();
          set({ status: 'ready', error: null, stats: data.stats ?? null });
          startHealthMonitor();
        }
      } catch {
        // Server not up yet, keep polling
      }
    };

    poll();
    pollInterval = setInterval(poll, 1000);

    pollTimeout = setTimeout(() => {
      if (!polling) return;
      stopPolling();
      set({ status: 'error', error: 'Engine failed to start within 30 seconds' });
    }, 30_000);
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
        failCount = 0;
        useEngineStore.setState({ status: 'ready', stats: data.stats ?? null });
      } else {
        failCount++;
      }
    } catch {
      failCount++;
    }

    if (failCount >= 3) {
      useEngineStore.setState({
        status: 'offline',
        error: 'Lost connection to AI engine',
      });
    }
  }, 10_000);
}
