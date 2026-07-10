/**
 * Dual-mode composer attach — single files or whole project folders.
 */

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

/** Open the native folder picker (desktop) or return null in plain browser. */
export async function pickProjectFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const path = await invoke<string | null>('pick_project_folder');
  return typeof path === 'string' && path.trim() ? path.trim() : null;
}

/** Open the native multi-file picker (desktop). */
export async function pickAttachFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  const paths = await invoke<string[]>('pick_attach_files');
  return Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p.trim()) : [];
}

/** Read one absolute path as UTF-8 text for composer attachment. */
export async function readAbsoluteTextFile(path: string): Promise<string> {
  if (isTauri()) {
    return invoke<string>('read_absolute_text_file', { path });
  }
  throw new Error('Reading arbitrary paths needs the desktop app.');
}

export function fileNameFromPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}