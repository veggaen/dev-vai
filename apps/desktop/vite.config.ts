import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/health': 'http://localhost:3006',
      '/api': {
        target: 'http://localhost:3006',
        ws: true,
      },
      '/docker': 'http://localhost:3006',
    },
  },
});
