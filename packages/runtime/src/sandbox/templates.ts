/**
 * Sandbox project templates — pre-built scaffolds for common frameworks/stacks.
 * Each template provides the minimal files needed to `pnpm install && npm run dev`.
 *
 * Lockfiles (pnpm-lock.yaml) are bundled via lockfiles.gen.ts so they survive
 * tsc compilation. pnpm --frozen-lockfile uses hard-links from the global store
 * making repeated installs of the same packages nearly instant (~2-5s vs ~60s).
 */
import { NEXTJS_PNPM_LOCK, REACT_VITE_PNPM_LOCK } from './lockfiles.gen.js';
import {
  appendScaffoldMotionCss,
  generateNextGlobalsCss,
  generateNextLaunchPage,
  generateReactViteLaunchApp,
  generateReactViteLaunchCss,
  getReactViteScaffoldExtraFiles,
  getScaffoldUiFiles,
} from './scaffold-ui.js';

const NEXTJS_LOCK = NEXTJS_PNPM_LOCK;
const REACT_VITE_LOCK = REACT_VITE_PNPM_LOCK;

export interface SandboxTemplate {
  id: string;
  name: string;
  description: string;
  category: 'frontend' | 'backend' | 'fullstack';
  files: { path: string; content: string }[];
}

/* ── React + Vite (TypeScript) — Tailwind v4 + lucide-react ── */
const reactVite: SandboxTemplate = {
  id: 'react-vite',
  name: 'React + Vite',
  description: 'React 19 · Vite 8 · Tailwind v4 — modern SPA shell with motion, ambient mesh, and builder-ready prompts',
  category: 'frontend',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-app',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: {
          react: '^19.2.4',
          'react-dom': '^19.2.4',
          'framer-motion': '^12.34.0',
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
      }, null, 2),
    },
    {
      path: 'vite.config.ts',
      content: [
        `import { defineConfig } from 'vite';`,
        `import react from '@vitejs/plugin-react';`,
        `import tailwindcss from '@tailwindcss/vite';`,
        ``,
        `export default defineConfig({`,
        `  plugins: [react(), tailwindcss()],`,
        `});`,
        ``,
      ].join('\n'),
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
          jsx: 'react-jsx', strict: true, esModuleInterop: true,
          skipLibCheck: true, forceConsistentCasingInFileNames: true,
        },
        include: ['src'],
      }, null, 2),
    },
    {
      path: 'index.html',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Vai App</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.tsx"></script>\n</body>\n</html>\n`,
    },
    {
      path: 'src/main.tsx',
      content: `import { createRoot } from 'react-dom/client';\nimport { App } from './App.js';\nimport './index.css';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n`,
    },
    {
      path: 'src/index.css',
      content: generateReactViteLaunchCss(),
    },
    {
      path: 'src/App.tsx',
      content: generateReactViteLaunchApp(),
    },
    ...getReactViteScaffoldExtraFiles(),
    // pnpm lockfile — enables --frozen-lockfile installs (hard-links from store = instant)
    ...(REACT_VITE_LOCK ? [{ path: 'pnpm-lock.yaml', content: REACT_VITE_LOCK }] : []),
  ],
};

/* ── Next.js 16 App Router — production-quality base ── */
const nextjs: SandboxTemplate = {
  id: 'nextjs',
  name: 'Next.js App Router',
  description: 'Next.js 16 · App Router · Tailwind v4 — full-stack launch pad for Inkwell-style apps',
  category: 'fullstack',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-app',
        version: '0.1.0',
        private: true,
        scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
        dependencies: {
          next: '^16.2.2',
          react: '^19.2.4',
          'react-dom': '^19.2.4',
          'framer-motion': '^12.34.0',
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
      }, null, 2),
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: false,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./src/*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      }, null, 2),
    },
    {
      path: 'next.config.ts',
      content: [
        `import type { NextConfig } from 'next';`,
        `const config: NextConfig = {`,
        `  allowedDevOrigins: ['127.0.0.1', 'localhost'],`,
        `};`,
        `export default config;`,
        ``,
      ].join('\n'),
    },
    {
      path: 'postcss.config.mjs',
      content: `export default {\n  plugins: {\n    '@tailwindcss/postcss': {},\n  },\n};\n`,
    },
    {
      path: 'next-env.d.ts',
      content: `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`,
    },
    {
      path: 'src/app/globals.css',
      content: generateNextGlobalsCss(),
    },
    {
      path: 'src/app/layout.tsx',
      content: [
        `import type { Metadata } from 'next';`,
        `import './globals.css';`,
        ``,
        `export const metadata: Metadata = {`,
        `  title: 'Vai App',`,
        `  description: 'Built with Vai',`,
        `  themeColor: '#09090b',`,
        `};`,
        ``,
        `export default function RootLayout({ children }: { children: React.ReactNode }) {`,
        `  return (`,
        `    <html lang="en" className="dark">`,
        `      <head />`,
        `      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">`,
        `        {children}`,
        `      </body>`,
        `    </html>`,
        `  );`,
        `}`,
        ``,
      ].join('\n'),
    },
    {
      path: 'src/app/page.tsx',
      content: generateNextLaunchPage(),
    },
    ...getScaffoldUiFiles({ name: 'indigo', hex: '#6366f1' }),
    // pnpm lockfile — enables --frozen-lockfile installs (hard-links from store = instant)
    ...(NEXTJS_LOCK ? [{ path: 'pnpm-lock.yaml', content: NEXTJS_LOCK }] : []),
  ],
};

/* ── Vue + Vite (TypeScript) ── */
const vueVite: SandboxTemplate = {
  id: 'vue-vite',
  name: 'Vue + Vite',
  description: 'Vue 3 with Vite, TypeScript, and Tailwind CSS',
  category: 'frontend',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-sandbox-vue',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: { vue: '^3.5.0' },
        devDependencies: {
          '@vitejs/plugin-vue': '^5.2.0',
          autoprefixer: '^10.4.20',
          postcss: '^8.4.49',
          tailwindcss: '^3.4.17',
          typescript: '^6.0.2',
          vite: '^8.0.4',
        },
      }, null, 2),
    },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\n\nexport default defineConfig({\n  plugins: [vue()],\n});\n`,
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
          jsx: 'preserve', strict: true, esModuleInterop: true, skipLibCheck: true,
        },
        include: ['src/**/*.ts', 'src/**/*.vue'],
      }, null, 2),
    },
    {
      path: 'tailwind.config.js',
      content: `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: ['./index.html', './src/**/*.{vue,ts}'],\n  theme: { extend: {} },\n  plugins: [],\n};\n`,
    },
    {
      path: 'postcss.config.js',
      content: `export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`,
    },
    {
      path: 'index.html',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Vai Sandbox</title>\n</head>\n<body>\n  <div id="app"></div>\n  <script type="module" src="/src/main.ts"></script>\n</body>\n</html>\n`,
    },
    {
      path: 'src/main.ts',
      content: `import { createApp } from 'vue';\nimport App from './App.vue';\nimport './style.css';\n\ncreateApp(App).mount('#app');\n`,
    },
    {
      path: 'src/style.css',
      content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n@keyframes mesh-drift { 0%,100%{transform:translate(0,0)} 50%{transform:translate(2%,-2%) scale(1.02)} }\n@keyframes kinetic-in { from{opacity:0;transform:translateY(.4em)} to{opacity:1;transform:none} }\n\nbody { margin: 0; font-family: system-ui, sans-serif; background: #09090b; color: #fafafa; }\n.shell { position: relative; min-height: 100vh; overflow: hidden; }\n.mesh { position: fixed; inset: 0; pointer-events: none; }\n.orb { position: absolute; border-radius: 9999px; filter: blur(80px); opacity: .4; animation: mesh-drift 16s ease-in-out infinite; }\n.orb.a { width: 40vmin; height: 40vmin; top: -10%; left: -5%; background: #10b981; }\n.orb.b { width: 32vmin; height: 32vmin; bottom: -8%; right: -5%; background: #6366f1; animation-delay: -8s; }\n.content { position: relative; z-index: 1; max-width: 32rem; margin: 0 auto; padding: 4rem 1.5rem; }\n.eyebrow { font-size: .7rem; letter-spacing: .15em; text-transform: uppercase; color: #34d399; margin-bottom: .75rem; }\nh1 { font-size: clamp(1.75rem, 5vw, 2.5rem); font-weight: 600; line-height: 1.15; }\n.kinetic { display: inline-block; color: #a7f3d0; animation: kinetic-in .5s ease both; }\n.lead { margin-top: 1rem; color: #a1a1aa; line-height: 1.6; font-size: .95rem; }\n`,
    },
    {
      path: 'src/App.vue',
      content: `<script setup lang="ts">\nimport { ref, onMounted, onUnmounted } from 'vue';\nconst words = ['dashboards', 'stores', 'tools', 'portfolios'];\nconst wordIndex = ref(0);\nlet timer: ReturnType<typeof setInterval> | undefined;\nonMounted(() => { timer = setInterval(() => { wordIndex.value = (wordIndex.value + 1) % words.length; }, 2800); });\nonUnmounted(() => { if (timer) clearInterval(timer); });\n</script>\n\n<template>\n  <div class="shell">\n    <div class="mesh" aria-hidden="true"><span class="orb a" /><span class="orb b" /></div>\n    <main class="content">\n      <p class="eyebrow">Vue 3 + Vite</p>\n      <h1>Build <span class="kinetic">{{ words[wordIndex] }}</span> with Vai</h1>\n      <p class="lead">Describe your product in chat — this shell becomes your real interface with routing, state, and styling.</p>\n    </main>\n  </div>\n</template>\n`,
    },
  ],
};

/* ── Svelte + Vite (TypeScript) ── */
const svelteVite: SandboxTemplate = {
  id: 'svelte-vite',
  name: 'Svelte + Vite',
  description: 'Svelte 5 with Vite and TypeScript',
  category: 'frontend',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-sandbox-svelte',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: {},
        devDependencies: {
          '@sveltejs/vite-plugin-svelte': '^4.0.0',
          svelte: '^5.0.0',
          typescript: '^6.0.2',
          vite: '^8.0.4',
        },
      }, null, 2),
    },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite';\nimport { svelte } from '@sveltejs/vite-plugin-svelte';\n\nexport default defineConfig({\n  plugins: [svelte()],\n});\n`,
    },
    {
      path: 'svelte.config.js',
      content: `import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';\n\nexport default {\n  preprocess: vitePreprocess(),\n};\n`,
    },
    {
      path: 'index.html',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Vai Sandbox</title>\n</head>\n<body>\n  <div id="app"></div>\n  <script type="module" src="/src/main.ts"></script>\n</body>\n</html>\n`,
    },
    {
      path: 'src/main.ts',
      content: `import App from './App.svelte';\n\nconst app = new App({ target: document.getElementById('app')! });\n\nexport default app;\n`,
    },
    {
      path: 'src/App.svelte',
      content: `<script lang="ts">\n  let name = 'Vai Sandbox';\n</script>\n\n<main style="display:flex;min-height:100vh;align-items:center;justify-content:center;background:#09090b;">\n  <h1 style="font-size:2.25rem;font-weight:bold;color:white;">Hello from {name}</h1>\n</main>\n`,
    },
  ],
};

/* ── Vanilla (HTML/CSS/JS) ── */
const vanilla: SandboxTemplate = {
  id: 'vanilla',
  name: 'Vanilla',
  description: 'Plain HTML, CSS, and JavaScript with Vite',
  category: 'frontend',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-sandbox-vanilla',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build' },
        devDependencies: { vite: '^6.0.0' },
      }, null, 2),
    },
    {
      path: 'index.html',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Vai App</title>\n  <link rel="stylesheet" href="/style.css" />\n</head>\n<body>\n  <div class="mesh" aria-hidden="true"><div class="orb orb-a"></div><div class="orb orb-b"></div></div>\n  <div id="app">\n    <div class="panel">\n      <p class="eyebrow">Vanilla + Vite</p>\n      <h1>Ship a fast web experience with Vai</h1>\n      <p>No framework overhead — describe your UI in chat and Vai expands this into a full product.</p>\n    </div>\n  </div>\n  <script type="module" src="/main.js"></script>\n</body>\n</html>\n`,
    },
    {
      path: 'style.css',
      content: `* { margin: 0; padding: 0; box-sizing: border-box; }\n@keyframes mesh-drift { 0%,100%{transform:translate(0,0)} 50%{transform:translate(2%,-2%)} }\n@keyframes fade-up { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }\nbody { font-family: system-ui, sans-serif; background: #09090b; color: #fafafa; min-height: 100vh; }\n.mesh { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }\n.orb { position: absolute; border-radius: 50%; filter: blur(70px); opacity: .35; animation: mesh-drift 18s ease-in-out infinite; }\n.orb-a { width: 38vmin; height: 38vmin; top: -8%; left: -6%; background: #f59e0b; }\n.orb-b { width: 30vmin; height: 30vmin; bottom: -10%; right: -4%; background: #8b5cf6; animation-delay: -9s; }\n#app { position: relative; z-index: 1; display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 2rem; }\n.panel { max-width: 28rem; text-align: center; animation: fade-up .6s ease both; }\n.eyebrow { font-size: .65rem; letter-spacing: .18em; text-transform: uppercase; color: #fbbf24; margin-bottom: .75rem; }\nh1 { font-size: clamp(1.5rem, 4vw, 2.25rem); font-weight: 600; line-height: 1.2; }\np { margin-top: .75rem; color: #a1a1aa; font-size: .9rem; line-height: 1.55; }\n`,
    },
    {
      path: 'main.js',
      content: `console.log('Vai Sandbox running');\n`,
    },
  ],
};

/* ── Express API (TypeScript) ── */
const expressApi: SandboxTemplate = {
  id: 'express-api',
  name: 'Express API',
  description: 'Express.js REST API with TypeScript',
  category: 'backend',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-sandbox-express',
        private: true,
        type: 'module',
        scripts: { dev: 'tsx watch src/index.ts', build: 'tsc', start: 'node dist/index.js' },
        dependencies: { express: '^4.21.0', cors: '^2.8.5' },
        devDependencies: {
          '@types/express': '^5.0.0',
          '@types/cors': '^2.8.17',
          '@types/node': '^22.0.0',
          tsx: '^4.19.0',
          typescript: '^6.0.2',
        },
      }, null, 2),
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
          outDir: 'dist', strict: true, esModuleInterop: true, skipLibCheck: true,
        },
        include: ['src'],
      }, null, 2),
    },
    {
      path: 'src/index.ts',
      content: `import express from 'express';\nimport cors from 'cors';\n\nconst app = express();\nconst PORT = process.env.PORT || 3100;\n\napp.use(cors());\napp.use(express.json());\n\napp.get('/api/health', (_req, res) => {\n  res.json({ status: 'ok', timestamp: new Date().toISOString() });\n});\n\napp.get('/api/hello', (_req, res) => {\n  res.json({ message: 'Hello from Vai Sandbox API' });\n});\n\napp.listen(PORT, () => {\n  console.log(\`Server running on http://localhost:\${PORT}\`);\n});\n`,
    },
  ],
};

/**
 * Express + hexagonal layout (ports & adapters) — teaching-friendly, inspired by classic
 * hexagonal samples (e.g. hotel/booking domains): domain → application → HTTP + in-memory persistence.
 */
const expressHexa: SandboxTemplate = {
  id: 'express-hexa',
  name: 'Express + hexagonal API',
  description: 'Express · TypeScript · domain + application + adapters (rooms + book flow)',
  category: 'backend',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-sandbox-express-hexa',
        private: true,
        type: 'module',
        scripts: { dev: 'tsx watch src/index.ts', build: 'tsc', start: 'node dist/index.js' },
        dependencies: { express: '^4.21.0', cors: '^2.8.5' },
        devDependencies: {
          '@types/express': '^5.0.0',
          '@types/cors': '^2.8.17',
          '@types/node': '^22.0.0',
          tsx: '^4.19.0',
          typescript: '^6.0.2',
        },
      }, null, 2),
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
          outDir: 'dist', strict: true, esModuleInterop: true, skipLibCheck: true,
        },
        include: ['src'],
      }, null, 2),
    },
    {
      path: 'src/domain/ports.ts',
      content: [
        '/** Inner hexagon: entities + inbound ports (interfaces). */',
        '',
        'export type Room = {',
        '  id: string;',
        '  name: string;',
        '  available: boolean;',
        '};',
        '',
        '/** Persistence port — implement in adapters (memory, SQL, etc.). */',
        'export interface RoomRepository {',
        '  listRooms(): Room[];',
        '  reserve(roomId: string): { ok: boolean; error?: string };',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/application/room-service.ts',
      content: [
        "import type { Room, RoomRepository } from '../domain/ports.js';",
        '',
        '/** Application service — use cases; depends only on ports, not HTTP/DB. */',
        'export class RoomService {',
        '  constructor(private readonly rooms: RoomRepository) {}',
        '',
        '  getAvailability(): Room[] {',
        '    return this.rooms.listRooms();',
        '  }',
        '',
        '  book(roomId: string) {',
        '    return this.rooms.reserve(roomId);',
        '  }',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/adapters/in-memory-room-repository.ts',
      content: [
        "import type { Room, RoomRepository } from '../domain/ports.js';",
        '',
        '/** Outbound adapter: in-memory stand-in for a real database. */',
        'export class InMemoryRoomRepository implements RoomRepository {',
        '  private readonly data: Room[] = [',
        "    { id: 'r1', name: 'North Suite', available: true },",
        "    { id: 'r2', name: 'Garden View', available: true },",
        '  ];',
        '',
        '  listRooms(): Room[] {',
        '    return this.data.map((r) => ({ ...r }));',
        '  }',
        '',
        '  reserve(roomId: string): { ok: boolean; error?: string } {',
        '    const room = this.data.find((x) => x.id === roomId);',
        "    if (!room) return { ok: false, error: 'Room not found' };",
        "    if (!room.available) return { ok: false, error: 'Already booked' };",
        '    room.available = false;',
        '    return { ok: true };',
        '  }',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/adapters/http/routes.ts',
      content: [
        "import type { Express } from 'express';",
        "import type { RoomService } from '../../application/room-service.js';",
        '',
        '/** Driving adapter: HTTP maps to application service. */',
        'export function registerRoomRoutes(app: Express, service: RoomService): void {',
        "  app.get('/api/rooms', (_req, res) => {",
        '    res.json({ rooms: service.getAvailability() });',
        '  });',
        '',
        "  app.post('/api/rooms/:id/book', (req, res) => {",
        '    const result = service.book(req.params.id);',
        '    if (result.ok) res.status(201).json({ booked: true });',
        "    else res.status(400).json({ error: result.error ?? 'Cannot book' });",
        '  });',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/index.ts',
      content: [
        "import express from 'express';",
        "import cors from 'cors';",
        "import { InMemoryRoomRepository } from './adapters/in-memory-room-repository.js';",
        "import { RoomService } from './application/room-service.js';",
        "import { registerRoomRoutes } from './adapters/http/routes.js';",
        '',
        'const PORT = Number(process.env.PORT) || 3100;',
        '',
        'const repo = new InMemoryRoomRepository();',
        'const roomService = new RoomService(repo);',
        '',
        'const app = express();',
        'app.use(cors());',
        'app.use(express.json());',
        '',
        'registerRoomRoutes(app, roomService);',
        '',
        "app.get('/api/health', (_req, res) => {",
        '  res.json({',
        "    status: 'ok',",
        "    architecture: 'hexagonal — domain → application → adapters',",
        '  });',
        '});',
        '',
        "app.listen(PORT, '0.0.0.0', () => {",
        '  console.log(`Server running on http://localhost:${PORT}`);',
        '});',
        '',
      ].join('\n'),
    },
  ],
};

/* ── Fastify API (TypeScript) ── */
const fastifyApi: SandboxTemplate = {
  id: 'fastify-api',
  name: 'Fastify API',
  description: 'Fastify REST API with TypeScript',
  category: 'backend',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-sandbox-fastify',
        private: true,
        type: 'module',
        scripts: { dev: 'tsx watch src/index.ts', build: 'tsc', start: 'node dist/index.js' },
        dependencies: { fastify: '^5.2.0', '@fastify/cors': '^10.0.0' },
        devDependencies: {
          '@types/node': '^22.0.0',
          tsx: '^4.19.0',
          typescript: '^6.0.2',
        },
      }, null, 2),
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
          outDir: 'dist', strict: true, esModuleInterop: true, skipLibCheck: true,
        },
        include: ['src'],
      }, null, 2),
    },
    {
      path: 'src/index.ts',
      content: `import Fastify from 'fastify';\nimport cors from '@fastify/cors';\n\nconst app = Fastify({ logger: true });\nconst PORT = Number(process.env.PORT) || 3100;\n\nawait app.register(cors);\n\napp.get('/api/health', async () => ({\n  status: 'ok',\n  timestamp: new Date().toISOString(),\n}));\n\napp.get('/api/hello', async () => ({\n  message: 'Hello from Vai Sandbox API',\n}));\n\nawait app.listen({ port: PORT, host: '0.0.0.0' });\nconsole.log(\`Server running on http://localhost:\${PORT}\`);\n`,
    },
  ],
};

/* ── Astro (TypeScript) ── */
const astro: SandboxTemplate = {
  id: 'astro',
  name: 'Astro',
  description: 'Astro static site with TypeScript and Tailwind CSS',
  category: 'frontend',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-sandbox-astro',
        private: true,
        type: 'module',
        scripts: { dev: 'astro dev', build: 'astro build', preview: 'astro preview' },
        dependencies: { astro: '^4.16.0', '@astrojs/tailwind': '^5.1.0', tailwindcss: '^3.4.17' },
        devDependencies: { typescript: '^5.7.0' },
      }, null, 2),
    },
    {
      path: 'astro.config.mjs',
      content: `import { defineConfig } from 'astro/config';\nimport tailwind from '@astrojs/tailwind';\n\nexport default defineConfig({\n  integrations: [tailwind()],\n});\n`,
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({ extends: 'astro/tsconfigs/strict' }, null, 2),
    },
    {
      path: 'src/pages/index.astro',
      content: `---\n// Welcome to Astro\n---\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Vai Sandbox</title>\n</head>\n<body class="flex min-h-screen items-center justify-center bg-zinc-950">\n  <h1 class="text-4xl font-bold text-white">Hello from Vai Sandbox</h1>\n</body>\n</html>\n`,
    },
  ],
};

/* ── SolidJS + Vite (TypeScript) ── */
const solidVite: SandboxTemplate = {
  id: 'solid-vite',
  name: 'SolidJS + Vite',
  description: 'SolidJS with Vite and TypeScript',
  category: 'frontend',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-sandbox-solid',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: { 'solid-js': '^1.9.0' },
        devDependencies: {
          'vite-plugin-solid': '^2.10.0',
          typescript: '^6.0.2',
          vite: '^8.0.4',
        },
      }, null, 2),
    },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite';\nimport solid from 'vite-plugin-solid';\n\nexport default defineConfig({\n  plugins: [solid()],\n});\n`,
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
          jsx: 'preserve', jsxImportSource: 'solid-js',
          strict: true, esModuleInterop: true, skipLibCheck: true,
        },
        include: ['src'],
      }, null, 2),
    },
    {
      path: 'index.html',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Vai Sandbox</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/index.tsx"></script>\n</body>\n</html>\n`,
    },
    {
      path: 'src/index.tsx',
      content: `import { render } from 'solid-js/web';\nimport App from './App';\n\nrender(() => <App />, document.getElementById('root')!);\n`,
    },
    {
      path: 'src/App.tsx',
      content: `export default function App() {\n  return (\n    <div style={{\n      display: 'flex', 'min-height': '100vh', 'align-items': 'center',\n      'justify-content': 'center', background: '#09090b',\n    }}>\n      <h1 style={{ 'font-size': '2.25rem', 'font-weight': 'bold', color: 'white' }}>\n        Hello from Vai Sandbox\n      </h1>\n    </div>\n  );\n}\n`,
    },
  ],
};

/* ── Python Flask API ── */
const flaskApi: SandboxTemplate = {
  id: 'flask-api',
  name: 'Flask API',
  description: 'Python Flask REST API',
  category: 'backend',
  files: [
    {
      path: 'requirements.txt',
      content: 'flask>=3.0.0\nflask-cors>=4.0.0\n',
    },
    {
      path: 'app.py',
      content: `from flask import Flask, jsonify\nfrom flask_cors import CORS\nimport os\n\napp = Flask(__name__)\nCORS(app)\n\n@app.route('/api/health')\ndef health():\n    return jsonify({'status': 'ok'})\n\n@app.route('/api/hello')\ndef hello():\n    return jsonify({'message': 'Hello from Vai Sandbox API'})\n\nif __name__ == '__main__':\n    port = int(os.environ.get('PORT', 3100))\n    app.run(host='0.0.0.0', port=port, debug=True)\n`,
    },
  ],
};

/* ── Vinext (Next.js API on Vite + Cloudflare Workers) ── */
const vinext: SandboxTemplate = {
  id: 'vinext',
  name: 'Vinext',
  description: 'Next.js API on Vite — deploy to Cloudflare Workers',
  category: 'fullstack',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-sandbox-vinext',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vinext dev',
          build: 'vinext build',
          start: 'vinext start',
          deploy: 'vinext deploy',
        },
        dependencies: {
          vinext: '^0.0.39',
          react: '^19.2.4',
          'react-dom': '^19.2.4',
        },
        devDependencies: {
          '@types/react': '^19.2.14',
          '@types/node': '^25.5.2',
          '@vitejs/plugin-rsc': '^0.5.22',
          autoprefixer: '^10.4.20',
          postcss: '^8.5.0',
          tailwindcss: '^4.2.2',
          '@tailwindcss/vite': '^4.2.2',
          typescript: '^5.9.0',
          vite: '^8.0.4',
        },
      }, null, 2),
    },
    {
      path: 'vite.config.ts',
      content: [
        `import { defineConfig } from 'vite';`,
        `import vinext from 'vinext';`,
        ``,
        `export default defineConfig({`,
        `  plugins: [vinext()],`,
        `});`,
        ``,
      ].join('\n'),
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          lib: ['dom', 'dom.iterable', 'esnext'],
          module: 'esnext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          paths: { '@/*': ['./src/*'] },
        },
        include: ['**/*.ts', '**/*.tsx'],
        exclude: ['node_modules'],
      }, null, 2),
    },
    {
      path: 'tailwind.config.js',
      content: `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: ['./src/**/*.{ts,tsx}'],\n  theme: { extend: {} },\n  plugins: [],\n};\n`,
    },
    {
      path: 'postcss.config.cjs',
      content: `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`,
    },
    {
      path: 'src/app/layout.tsx',
      content: [
        `import type { Metadata } from 'next';`,
        `import './globals.css';`,
        ``,
        `export const metadata: Metadata = {`,
        `  title: 'Vai Sandbox — Vinext',`,
        `  description: 'Built with VeggaAI on Vinext',`,
        `};`,
        ``,
        `export default function RootLayout({ children }: { children: React.ReactNode }) {`,
        `  return (`,
        `    <html lang="en">`,
        `      <body>{children}</body>`,
        `    </html>`,
        `  );`,
        `}`,
        ``,
      ].join('\n'),
    },
    {
      path: 'src/app/globals.css',
      content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nbody { margin: 0; font-family: system-ui, -apple-system, sans-serif; }\n`,
    },
    {
      path: 'src/app/page.tsx',
      content: [
        `export default function Home() {`,
        `  return (`,
        `    <div className="flex min-h-screen items-center justify-center bg-zinc-950">`,
        `      <div className="text-center">`,
        `        <h1 className="text-4xl font-bold text-white">Hello from Vai Sandbox</h1>`,
        `        <p className="mt-4 text-zinc-400">Powered by Vinext — Next.js API on Vite</p>`,
        `      </div>`,
        `    </div>`,
        `  );`,
        `}`,
        ``,
      ].join('\n'),
    },
    {
      path: 'src/app/api/health/route.ts',
      content: [
        `import { NextResponse } from 'next/server';`,
        ``,
        `export async function GET() {`,
        `  return NextResponse.json({ status: 'ok', runtime: 'vinext' });`,
        `}`,
        ``,
      ].join('\n'),
    },
  ],
};

/** All available templates */
export const SANDBOX_TEMPLATES: SandboxTemplate[] = [
  reactVite,
  nextjs,
  vueVite,
  svelteVite,
  vanilla,
  expressApi,
  expressHexa,
  fastifyApi,
  astro,
  solidVite,
  flaskApi,
  vinext,
];

/** Lookup by ID */
export function getTemplate(id: string): SandboxTemplate | undefined {
  return SANDBOX_TEMPLATES.find((t) => t.id === id);
}
