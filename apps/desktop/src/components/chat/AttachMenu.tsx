/**
 * Attach menu — exactly two options, both opening the REAL OS Explorer dialog
 * (served by the local runtime, so it works in browser and Tauri alike):
 *   📄 File   → attach the picked file to this chat message
 *   📁 Folder → open the picked folder as the live project
 */

import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FileText, FolderOpen } from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { toast } from 'sonner';

export interface FileAttachment {
  id: string;
  name: string;
  content: string;
  language: string;
  sizeBytes: number;
}

interface AttachMenuProps {
  readonly anchorRef: React.RefObject<HTMLButtonElement | null>;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onFilesAttached: (files: FileAttachment[]) => void;
  readonly onTriggerFileInput: () => void;
}

interface PickPathResponse {
  cancelled?: boolean;
  kind?: 'file' | 'folder';
  path?: string;
  name?: string;
  sizeBytes?: number;
  content?: string | null;
  error?: string;
}

/** One call → one real Explorer dialog on this machine. */
async function pickNative(mode: 'file' | 'folder'): Promise<PickPathResponse | null> {
  const res = await apiFetch('/api/system/pick-path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  const data = await res.json().catch(() => null) as PickPathResponse | null;
  if (!res.ok || !data || data.error) throw new Error(data?.error ?? 'Native picker unavailable');
  return data.cancelled ? null : data;
}

export function AttachMenu({
  anchorRef,
  open,
  onClose,
  onFilesAttached,
  onTriggerFileInput,
}: AttachMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [open, onClose, anchorRef]);

  const attachFile = useCallback(async () => {
    onClose();
    try {
      const picked = await pickNative('file');
      if (!picked?.path || !picked.name) return;
      if (typeof picked.content !== 'string') {
        toast.error(`${picked.name} looks binary or too large to attach as text`);
        return;
      }
      const ext = picked.name.split('.').pop() || 'txt';
      onFilesAttached([{
        id: `file-${Date.now()}-${picked.name}`,
        name: picked.name,
        content: picked.content,
        language: ext,
        sizeBytes: picked.sizeBytes ?? picked.content.length,
      }]);
      toast.success(`Attached ${picked.name}`);
    } catch {
      // No native dialog on this setup — browser file input still works.
      onTriggerFileInput();
    }
  }, [onClose, onFilesAttached, onTriggerFileInput]);

  const attachFolder = useCallback(async () => {
    onClose();
    try {
      const picked = await pickNative('folder');
      if (!picked?.path) return;
      window.dispatchEvent(new CustomEvent('vai:open-workspace', { detail: { path: picked.path } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the folder picker');
    }
  }, [onClose]);

  const rect = anchorRef.current?.getBoundingClientRect();
  const style = rect
    ? { left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 8 }
    : { left: 16, bottom: 120 };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          role="menu"
          aria-label="Attach files or project"
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={{ duration: 0.14 }}
          className="fixed z-[120] min-w-[220px] overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900/98 p-1 shadow-2xl backdrop-blur-md"
          style={style}
        >
          <p className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Attach to chat
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => void attachFile()}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            <FileText className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            <span>
              <span className="block font-medium">File</span>
              <span className="block text-[11px] text-zinc-500">Pick a file in Explorer — attached to this message</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void attachFolder()}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            <FolderOpen className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />
            <span>
              <span className="block font-medium">Folder</span>
              <span className="block text-[11px] text-zinc-500">Pick a project folder — opens live in the app window</span>
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default AttachMenu;