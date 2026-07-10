/**
 * Wires IDE events from chat WS + local workspace lifecycle into workspaceStore.
 */

import { useEffect } from 'react';
import type { IdeEvent } from '@vai/api-types/ide-ws';
import { ideEventSchema } from '@vai/api-types/ide-ws';
import { useWorkspaceStore } from '../stores/workspaceStore.js';

export function useWorkspaceIde() {
  const handleIdeEvent = useWorkspaceStore((s) => s.handleIdeEvent);

  useEffect(() => {
    const onIdeEvent = (e: Event) => {
      const detail = (e as CustomEvent<IdeEvent>).detail;
      if (!detail) return;
      const parsed = ideEventSchema.safeParse(detail);
      if (parsed.success) handleIdeEvent(parsed.data);
    };
    window.addEventListener('vai:ide-event', onIdeEvent);
    return () => window.removeEventListener('vai:ide-event', onIdeEvent);
  }, [handleIdeEvent]);

  useEffect(() => {
    const onWsIde = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      const parsed = ideEventSchema.safeParse(detail);
      if (parsed.success) {
        handleIdeEvent(parsed.data);
        window.dispatchEvent(new CustomEvent('vai:ide-event', { detail: parsed.data }));
      }
    };
    window.addEventListener('vai:ws-ide-event', onWsIde);
    return () => window.removeEventListener('vai:ws-ide-event', onWsIde);
  }, [handleIdeEvent]);
}

export default useWorkspaceIde;