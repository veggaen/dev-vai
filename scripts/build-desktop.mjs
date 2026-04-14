import { execSync } from 'node:child_process';

try {
  execSync('pnpm exec tsc', { stdio: 'inherit' });
  execSync('pnpm exec vite build', { stdio: 'inherit' });
} catch (error) {
  process.exit(error && typeof error === 'object' && 'status' in error ? (error.status ?? 1) : 1);
}