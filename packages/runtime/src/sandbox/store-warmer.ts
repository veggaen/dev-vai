/**
 * pnpm Store Warmer — pre-populates the global pnpm content-addressable store
 * with the most common sandbox dependency sets on runtime startup.
 *
 * After warming, any sandbox using the same packages installs in ~2-5s via
 * hard-links (NTFS) instead of downloading from npm (~60s).
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const WARM_SETS = [
  {
    name: 'nextjs-16',
    pkg: {
      name: 'vai-warmup',
      private: true,
      dependencies: {
        next: '^16.2.2',
        react: '^19.2.4',
        'react-dom': '^19.2.4',
        'lucide-react': '^1.7.0',
        clsx: '^2.1.1',
        'tailwind-merge': '^3.5.0',
      },
      devDependencies: {
        typescript: '^6.0.2',
        '@types/node': '^25.5.2',
        '@types/react': '^19.2.14',
        '@types/react-dom': '^19.2.3',
        tailwindcss: '^4.2.2',
        '@tailwindcss/postcss': '^4.2.2',
        postcss: '^8.5.0',
      },
    },
  },
  {
    name: 'react-vite-8',
    pkg: {
      name: 'vai-warmup',
      private: true,
      type: 'module',
      dependencies: {
        react: '^19.2.4',
        'react-dom': '^19.2.4',
        'lucide-react': '^1.7.0',
        clsx: '^2.1.1',
        'tailwind-merge': '^3.5.0',
      },
      devDependencies: {
        '@types/react': '^19.2.14',
        '@types/react-dom': '^19.2.3',
        '@vitejs/plugin-react': '^6.0.1',
        '@tailwindcss/vite': '^4.2.2',
        tailwindcss: '^4.2.2',
        typescript: '^6.0.2',
        vite: '^8.0.4',
      },
    },
  },
];

async function runPnpm(args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('pnpm', args, { cwd, shell: true, stdio: 'pipe' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Warm the pnpm store in the background.
 * Called once at server startup — does not block the server from starting.
 */
export function warmPnpmStore(): void {
  void (async () => {
    const workDir = join(tmpdir(), `vai-pnpm-warm-${randomUUID()}`);
    try {
      // Quick check: can we even run pnpm?
      const pnpmOk = await runPnpm(['--version'], tmpdir());
      if (!pnpmOk) {
        console.info('[store-warmer] pnpm not available — skipping store warmup');
        return;
      }

      await mkdir(workDir, { recursive: true });

      for (const set of WARM_SETS) {
        const setDir = join(workDir, set.name);
        await mkdir(setDir, { recursive: true });
        await writeFile(join(setDir, 'package.json'), JSON.stringify(set.pkg, null, 2));

        console.info(`[store-warmer] warming pnpm store for ${set.name}...`);
        const start = Date.now();
        const ok = await runPnpm(['install', '--no-frozen-lockfile', '--prefer-offline'], setDir);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);

        if (ok) {
          console.info(`[store-warmer] ${set.name} warmed in ${elapsed}s — subsequent installs will use hard-links`);
        } else {
          console.warn(`[store-warmer] ${set.name} warm failed after ${elapsed}s — first sandbox install may be slow`);
        }
      }
    } catch (err) {
      console.warn('[store-warmer] unexpected error:', err);
    } finally {
      // Clean up temp dirs (node_modules can be large)
      if (existsSync(workDir)) {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  })();
}
