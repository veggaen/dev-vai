import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const runtimeTarget = process.env.VAI_DESKTOP_RUNTIME_URL?.trim() || 'http://localhost:3006';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/health': { target: runtimeTarget, changeOrigin: true },
      '/api': {
        target: runtimeTarget,
        changeOrigin: true,
        ws: true,
      },
      '/docker': { target: runtimeTarget, changeOrigin: true },
    },
  },
});
