/**
 * Wait for the VAI runtime server to become healthy before continuing.
 * Used to sequence desktop startup after runtime is ready.
 *
 * Usage: node scripts/wait-for-runtime.mjs
 * Exits 0 once /health returns 200, exits 1 after timeout.
 */

const PORT = Number(process.env.VAI_PORT ?? 3006);
const URL = `http://localhost:${PORT}/health`;
const TIMEOUT_MS = 60_000;
const POLL_MS = 500;

async function waitForHealth() {
  const start = Date.now();

  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const res = await fetch(URL);
      if (res.ok) {
        console.log(`[VAI] Runtime server is ready on port ${PORT}`);
        return true;
      }
    } catch {
      // Server not up yet — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  console.error(`[VAI] Timeout waiting for runtime on port ${PORT}`);
  return false;
}

const ok = await waitForHealth();
process.exit(ok ? 0 : 1);
