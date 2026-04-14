import { create } from 'zustand';
import { thorsenPulse, type ThorsenSyncState } from '../lib/thorsen.js';

export type VinextMotionBudget = 'full' | 'balanced' | 'minimal';
export type VinextTrustLevel = 'verified' | 'degraded' | 'offline';

export interface VinextState {
  syncState: ThorsenSyncState | 'offline';
  latencyMs: number | null;
  motionBudget: VinextMotionBudget;
  trustLevel: VinextTrustLevel;
  lastUpdatedAt: number | null;
  isPolling: boolean;
  startPolling: () => void;
  stopPolling: () => void;
  pollOnce: () => Promise<void>;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function motionBudgetFor(state: ThorsenSyncState | 'offline'): VinextMotionBudget {
  if (state === 'wormhole') return 'full';
  if (state === 'parallel') return 'balanced';
  return 'minimal';
}

function trustLevelFor(state: ThorsenSyncState | 'offline'): VinextTrustLevel {
  if (state === 'offline') return 'offline';
  if (state === 'wormhole') return 'verified';
  return 'degraded';
}

export const useVinextStore = create<VinextState>((set, get) => ({
  syncState: 'offline',
  latencyMs: null,
  motionBudget: 'minimal',
  trustLevel: 'offline',
  lastUpdatedAt: null,
  isPolling: false,

  pollOnce: async () => {
    try {
      const pulse = await thorsenPulse();
      set({
        syncState: pulse.state,
        latencyMs: pulse.latencyMs,
        motionBudget: motionBudgetFor(pulse.state),
        trustLevel: trustLevelFor(pulse.state),
        lastUpdatedAt: Date.now(),
      });
    } catch {
      set({
        syncState: 'offline',
        latencyMs: null,
        motionBudget: 'minimal',
        trustLevel: 'offline',
        lastUpdatedAt: Date.now(),
      });
    }
  },

  startPolling: () => {
    if (intervalHandle) return;
    set({ isPolling: true });
    void get().pollOnce();
    intervalHandle = setInterval(() => {
      void get().pollOnce();
    }, 2500);
  },

  stopPolling: () => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    set({ isPolling: false });
  },
}));