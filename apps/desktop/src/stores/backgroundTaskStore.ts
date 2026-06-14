import { create } from 'zustand';

export type BackgroundTaskStatus = 'running' | 'done' | 'failed';

export interface BackgroundTask {
  id: string;
  label: string;
  startedAt: number;
  endedAt?: number;
  status: BackgroundTaskStatus;
}

interface BackgroundTaskState {
  tasks: BackgroundTask[];
  startTask: (id: string, label: string) => void;
  finishTask: (id: string, status?: Exclude<BackgroundTaskStatus, 'running'>) => void;
  dismissTask: (id: string) => void;
  dismissAll: () => void;
}

export const useBackgroundTaskStore = create<BackgroundTaskState>((set) => ({
  tasks: [],
  startTask: (id, label) => set((state) => {
    const existing = state.tasks.find((t) => t.id === id);
    if (existing) {
      return {
        tasks: state.tasks.map((t) => (
          t.id === id
            ? { ...t, label, status: 'running' as const, endedAt: undefined }
            : t
        )),
      };
    }
    return {
      tasks: [
        ...state.tasks.filter((t) => t.status === 'running'),
        { id, label, startedAt: Date.now(), status: 'running' as const },
      ].slice(-24),
    };
  }),
  finishTask: (id, status = 'done') => set((state) => ({
    tasks: state.tasks.map((t) => (
      t.id === id ? { ...t, status, endedAt: Date.now() } : t
    )),
  })),
  dismissTask: (id) => set((state) => ({
    tasks: state.tasks.filter((t) => t.id !== id),
  })),
  dismissAll: () => set({ tasks: [] }),
}));
