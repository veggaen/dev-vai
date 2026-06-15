import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const runtimeTarget = process.env.VAI_DESKTOP_RUNTIME_URL?.trim() || 'http://localhost:3006';

const runtimeProxy = {
  '/health': { target: runtimeTarget, changeOrigin: true },
  '/api': {
    target: runtimeTarget,
    changeOrigin: true,
    ws: true,
  },
  '/docker': { target: runtimeTarget, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: runtimeProxy,
  },
  // `vite preview` does not inherit `server.proxy` — without this, production
  // previews boot-loop on "Warming up the engine..." because /health 404s.
  preview: {
    port: 4173,
    strictPort: true,
    proxy: runtimeProxy,
  },
});
