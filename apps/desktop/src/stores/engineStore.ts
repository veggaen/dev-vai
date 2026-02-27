import { create } from 'zustand';

type EngineStatus = 'idle' | 'starting' | 'ready' | 'error';

interface EngineState {
  status: EngineStatus;
  error: string | null;
  stats: {
    vocabSize: number;
    knowledgeEntries: number;
    documentsIndexed: number;
    ngramContexts: number;
  } | null;
  startPolling: () => () => void;
}

const API_BASE = 'http://localhost:3006';

export const useEngineStore = create<EngineState>((set) => ({
  status: 'idle',
  error: null,
  stats: null,

  startPolling: () => {
    set({ status: 'starting' });

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const data = await res.json();
          set({ status: 'ready', error: null, stats: data.stats ?? null });
          clearInterval(interval);
        }
      } catch {
        // Engine still starting — keep polling
      }
    }, 1000);

    // Timeout after 30s
    const timeout = setTimeout(() => {
      clearInterval(interval);
      set({ status: 'error', error: 'Engine failed to start within 30 seconds' });
    }, 30_000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  },
}));
