/**
 * Native pick-path route — opens the OS file dialog ON THIS MACHINE and returns
 * the chosen path with file-vs-folder auto-detection.
 *
 * Why this lives in the runtime: the desktop UI often runs as a plain browser
 * tab (localhost:5173), and browsers cannot reveal absolute filesystem paths.
 * The runtime is a local process on the same machine, so it CAN show the real
 * Explorer/Finder dialog. Loopback-only: this must never be reachable remotely.
 *
 * One dialog, both kinds (Windows): OpenFileDialog with ValidateNames=false and
 * a placeholder filename — picking a real file returns that file; clicking Open
 * inside a folder returns `<folder>\<placeholder>`, which we resolve to the folder.
 */

import { spawn } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const PLACEHOLDER = 'Choose this folder';
const DIALOG_TIMEOUT_MS = 5 * 60_000; // the user may take their time
const MAX_INLINE_FILE_BYTES = 1_000_000;

function isLoopbackRequest(request: FastifyRequest): boolean {
  const ip = request.ip ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/** Run a picker command and capture the selected path (empty = cancelled). */
function runPicker(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolvePath, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Dialog timed out'));
    }, DIALOG_TIMEOUT_MS);
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out.trim()) {
        reject(new Error(err.trim() || `picker exited with code ${code}`));
        return;
      }
      resolvePath(out.trim());
    });
  });
}

type PickMode = 'file' | 'folder' | 'any';

async function pickPathNative(mode: PickMode): Promise<string | null> {
  if (process.platform === 'win32') {
    // -STA is required for WinForms dialogs.
    // 'file'  → a real OpenFileDialog (must pick an existing file).
    // 'folder'/'any' → the placeholder-name trick keeps the FULL Explorer UI
    //                  (unlike FolderBrowserDialog's cramped tree).
    const wantsFile = mode === 'file';
    const title = wantsFile
      ? 'Pick a file to attach to this chat'
      : mode === 'folder'
        ? 'Open your project folder — navigate INTO it and click Open'
        : 'Open a project folder (click Open inside it) or pick a single file';
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      // Owner form with TopMost: dialogs spawned from a background service have
      // no foreground rights, so without this the Explorer dialog opens BEHIND
      // the browser and looks like nothing happened.
      '$owner = New-Object System.Windows.Forms.Form;',
      '$owner.TopMost = $true;',
      '$owner.ShowInTaskbar = $false;',
      '$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized;',
      '$d = New-Object System.Windows.Forms.OpenFileDialog;',
      `$d.Title = '${title}';`,
      `$d.CheckFileExists = ${wantsFile ? '$true' : '$false'};`,
      `$d.ValidateNames = ${wantsFile ? '$true' : '$false'};`,
      '$d.DereferenceLinks = $true;',
      wantsFile ? '' : `$d.FileName = '${PLACEHOLDER}';`,
      "$d.Filter = 'All files (*.*)|*.*';",
      "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }",
      '$owner.Dispose();',
    ].filter(Boolean).join(' ');
    const out = await runPicker('powershell', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script]);
    return out || null;
  }
  if (process.platform === 'darwin') {
    const script = mode === 'file'
      ? 'POSIX path of (choose file with prompt "Pick a file to attach")'
      : mode === 'folder'
        ? 'POSIX path of (choose folder with prompt "Pick a project folder")'
        : 'try\nset p to POSIX path of (choose file with prompt "Pick a file (Cancel to pick a folder)")\non error\nset p to POSIX path of (choose folder with prompt "Pick a project folder")\nend try\np';
    const out = await runPicker('osascript', ['-e', script]);
    return out || null;
  }
  // Linux: zenity if present.
  const args = ['--file-selection', `--title=${mode === 'file' ? 'Pick a file' : 'Pick a folder'}`];
  if (mode === 'folder') args.push('--directory');
  const out = await runPicker('zenity', args);
  return out || null;
}

export function registerPickPathRoute(app: FastifyInstance): void {
  app.post<{ Body: { mode?: string } }>('/api/system/pick-path', async (request, reply) => {
    if (!isLoopbackRequest(request)) {
      reply.status(403);
      return { error: 'The native picker is only available on the local machine' };
    }
    const rawMode = request.body?.mode;
    const mode: PickMode = rawMode === 'file' || rawMode === 'folder' ? rawMode : 'any';
    try {
      const raw = await pickPathNative(mode);
      if (!raw) return { cancelled: true };

      // Auto-detect: a real existing file → file; the placeholder (or any
      // non-existent name) inside an existing folder → that folder.
      if (existsSync(raw) && statSync(raw).isFile()) {
        const size = statSync(raw).size;
        let content: string | null = null;
        if (size <= MAX_INLINE_FILE_BYTES) {
          const text = readFileSync(raw, 'utf-8');
          if (!text.includes('\u0000')) content = text; // binary stays path-only
        }
        return { kind: 'file', path: raw, name: basename(raw), sizeBytes: size, content };
      }
      if (existsSync(raw) && statSync(raw).isDirectory()) {
        return { kind: 'folder', path: raw };
      }
      const parent = dirname(raw);
      if (existsSync(parent) && statSync(parent).isDirectory()) {
        return { kind: 'folder', path: parent };
      }
      reply.status(400);
      return { error: `Selected path does not exist: ${raw}` };
    } catch (err) {
      reply.status(500);
      return { error: err instanceof Error ? err.message : 'Native picker failed' };
    }
  });
}
