import { spawn } from 'node:child_process';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;
const TIMEOUT_MS = 2_500;

async function isFrontendReady() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

if (await isFrontendReady()) {
  console.log(`[VAI] Frontend already responding on port ${PORT} — reusing existing Vite instance`);
  process.exit(0);
}

const child = spawn('pnpm', ['--filter', '@vai/desktop', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
