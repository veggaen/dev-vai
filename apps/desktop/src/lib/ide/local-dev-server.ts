/**
 * Detect how to preview a local workspace and poll for a live dev URL.
 */

export interface DevServerPlan {
  readonly command: string;
  readonly label: string;
  readonly ports: readonly number[];
}

interface PackageJson {
  name?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const URL_PORT_RE = /https?:\/\/(?:127\.0\.0\.1|localhost):(\d{2,5})/gi;
const PORT_LINE_RE = /(?:localhost|127\.0\.0\.1):(\d{2,5})|port\s+(\d{2,5})|:(\d{4,5})\s*$/i;
const SCRIPT_PORT_RE = /--port(?:=|\s+)(\d{2,5})/gi;

export function parsePortsFromLog(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(URL_PORT_RE)) {
    const p = Number(m[1]);
    if (p > 0 && p < 65536) found.add(p);
  }
  for (const line of text.split('\n')) {
    const m = line.match(PORT_LINE_RE);
    if (!m) continue;
    const p = Number(m[1] ?? m[2] ?? m[3]);
    if (p > 0 && p < 65536) found.add(p);
  }
  return [...found];
}

function detectPackageManager(pkg: PackageJson, hint?: 'pnpm' | 'npm' | 'bun'): 'pnpm' | 'npm' | 'bun' {
  const pm = pkg.packageManager ?? '';
  if (pm.startsWith('bun')) return 'bun';
  if (pm.startsWith('npm')) return 'npm';
  if (pm.startsWith('pnpm')) return 'pnpm';
  // No explicit field — fall back to the lockfile evidence (bun projects rarely
  // set packageManager; their bun.lock/bun.lockb is the reliable signal).
  return hint ?? 'pnpm';
}

function runScript(pm: 'pnpm' | 'npm' | 'bun', script: string, args?: string): string {
  const tail = args ? ` -- ${args}` : '';
  if (pm === 'bun') return `bun run ${script}${tail}`;
  if (pm === 'npm') return `npm run ${script}${args ? ` -- ${args}` : ''}`;
  return `pnpm run ${script}${tail}`;
}

function portsFromScript(script: string, fallback: readonly number[]): number[] {
  const found = new Set<number>();
  for (const m of script.matchAll(SCRIPT_PORT_RE)) {
    const p = Number(m[1]);
    if (p > 0 && p < 65536) found.add(p);
  }
  for (const p of fallback) found.add(p);
  return [...found];
}

function isShellScript(script: string): boolean {
  return /\b(bash|sh)\s/.test(script) || script.endsWith('.sh');
}

export function detectDevServerPlan(pkgText: string, pmHint?: 'pnpm' | 'npm' | 'bun'): DevServerPlan | null {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(pkgText) as PackageJson;
  } catch {
    return null;
  }
  const scripts = pkg.scripts ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const pm = detectPackageManager(pkg, pmHint);
  const vite = Boolean(deps.vite || deps['@vitejs/plugin-react']);
  const next = Boolean(deps.next);
  const portsFor = (kind: 'vite' | 'next' | 'generic'): number[] => {
    if (kind === 'next') return [3000, 3001];
    if (kind === 'vite') return [5173, 5174, 4173];
    // NOTE: never 3006 — that is always Vai's own runtime, not the user's app.
    return [3000, 5173, 8080];
  };

  const candidates: DevServerPlan[] = [];

  if (scripts['dev:desktop']) {
    candidates.push({
      command: runScript(pm, 'dev:desktop', '--host 127.0.0.1 --port 5178 --strictPort false'),
      label: 'Desktop Vite dev',
      ports: [5178, 5173, 5174],
    });
  }

  if (scripts['dev:web']) {
    const script = scripts['dev:web'];
    candidates.push({
      command: runScript(pm, 'dev:web'),
      label: 'Web / API dev',
      ports: portsFromScript(script, [3000, 5173, 5296]),
    });
  }

  if (scripts.dev && !scripts.dev.includes('concurrently') && !isShellScript(scripts.dev)) {
    const script = scripts.dev;
    candidates.push({
      command: runScript(pm, 'dev'),
      label: next ? 'Next.js dev' : vite ? 'Vite dev' : 'Dev server',
      ports: portsFromScript(script, portsFor(next ? 'next' : vite ? 'vite' : 'generic')),
    });
  }

  if (scripts.dev && isShellScript(scripts.dev) && scripts['dev:web']) {
    candidates.push({
      command: runScript(pm, 'dev:web'),
      label: 'Web dev (shell script skipped)',
      ports: portsFromScript(scripts['dev:web'], [5296, 5173, 3000]),
    });
  }

  if (scripts.dev?.includes('concurrently') && scripts['dev:web']) {
    candidates.push({
      command: runScript(pm, 'dev:web'),
      label: 'Monorepo web dev',
      ports: portsFromScript(scripts['dev:web'], [5173, 3000, 5296]),
    });
  }

  if (scripts.start) {
    const script = scripts.start;
    candidates.push({
      command: runScript(pm, 'start'),
      label: 'Production start',
      ports: portsFromScript(script, [3000, 8080, 5296]),
    });
  }

  return candidates[0] ?? null;
}

export async function probeFirstLivePort(
  ports: readonly number[],
  probe: (port: number) => Promise<boolean>,
): Promise<number | null> {
  for (const port of ports) {
    if (await probe(port)) return port;
  }
  return null;
}