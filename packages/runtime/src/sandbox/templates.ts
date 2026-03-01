/**
 * Sandbox project templates — pre-built scaffolds for common frameworks/stacks.
 * Each template provides the minimal files needed to `npm install && npm run dev`.
 */

export interface SandboxTemplate {
  id: string;
  name: string;
  description: string;
  category: 'frontend' | 'backend' | 'fullstack';
  files: { path: string; content: string }[];
}

/* ── React + Vite (TypeScript) ── */
const reactVite: SandboxTemplate = {
  id: 'react-vite',
  name: 'React + Vite',
  description: 'React 19 with Vite, TypeScript, and Tailwind CSS',
  category: 'frontend',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-sandbox-react',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: {
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          '@vitejs/plugin-react': '^4.3.0',
          autoprefixer: '^10.4.20',
          postcss: '^8.4.49',
          tailwindcss: '^3.4.17',
          typescript: '^5.7.0',
          vite: '^6.0.0',
        },
      }, null, 2),
    },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n`,
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
      path: 'tailwind.config.js',
      content: `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: ['./index.html', './src/**/*.{ts,tsx}'],\n  theme: { extend: {} },\n  plugins: [],\n};\n`,
    },
    {
      path: 'postcss.config.js',
      content: `export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`,
    },
    {
      path: 'index.html',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Vai Sandbox</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.tsx"></script>\n</body>\n</html>\n`,
    },
    {
      path: 'src/main.tsx',
      content: `import { createRoot } from 'react-dom/client';\nimport { App } from './App';\nimport './index.css';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n`,
    },
    {
      path: 'src/index.css',
      content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nbody {\n  margin: 0;\n  font-family: system-ui, -apple-system, sans-serif;\n}\n`,
    },
    {
      path: 'src/App.tsx',
      content: `export function App() {\n  return (\n    <div className="flex min-h-screen items-center justify-center bg-zinc-950">\n      <h1 className="text-4xl font-bold text-white">Hello from Vai Sandbox</h1>\n    </div>\n  );\n}\n`,
    },
  ],
};

/* ── Next.js (App Router, TypeScript) ── */
const nextjs: SandboxTemplate = {
  id: 'nextjs',
  name: 'Next.js',
  description: 'Next.js 15 with App Router, TypeScript, and Tailwind CSS',
  category: 'fullstack',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'vai-sandbox-nextjs',
        private: true,
        scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
        dependencies: { next: '^15.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: {
          '@types/react': '^19.0.0',
          '@types/node': '^22.0.0',
          autoprefixer: '^10.4.20',
          postcss: '^8.4.49',
          tailwindcss: '^3.4.17',
          typescript: '^5.7.0',
        },
      }, null, 2),
    },
    {
      path: 'next.config.ts',
      content: `import type { NextConfig } from 'next';\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n`,
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022', lib: ['dom', 'dom.iterable', 'esnext'], module: 'esnext',
          moduleResolution: 'bundler', jsx: 'preserve', strict: true,
          esModuleInterop: true, skipLibCheck: true, incremental: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./src/*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      }, null, 2),
    },
    {
      path: 'tailwind.config.js',
      content: `/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  content: ['./src/**/*.{ts,tsx}'],\n  theme: { extend: {} },\n  plugins: [],\n};\n`,
    },
    {
      path: 'postcss.config.js',
      content: `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`,
    },
    {
      path: 'src/app/layout.tsx',
      content: `import type { Metadata } from 'next';\nimport './globals.css';\n\nexport const metadata: Metadata = {\n  title: 'Vai Sandbox',\n  description: 'Built with VeggaAI',\n};\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}\n`,
    },
    {
      path: 'src/app/globals.css',
      content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nbody { margin: 0; font-family: system-ui, -apple-system, sans-serif; }\n`,
    },
    {
      path: 'src/app/page.tsx',
      content: `export default function Home() {\n  return (\n    <div className="flex min-h-screen items-center justify-center bg-zinc-950">\n      <h1 className="text-4xl font-bold text-white">Hello from Vai Sandbox</h1>\n    </div>\n  );\n}\n`,
    },
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
          typescript: '^5.7.0',
          vite: '^6.0.0',
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
      content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nbody {\n  margin: 0;\n  font-family: system-ui, -apple-system, sans-serif;\n}\n`,
    },
    {
      path: 'src/App.vue',
      content: `<script setup lang="ts">\n</script>\n\n<template>\n  <div class="flex min-h-screen items-center justify-center bg-zinc-950">\n    <h1 class="text-4xl font-bold text-white">Hello from Vai Sandbox</h1>\n  </div>\n</template>\n`,
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
          typescript: '^5.7.0',
          vite: '^6.0.0',
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
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Vai Sandbox</title>\n  <link rel="stylesheet" href="/style.css" />\n</head>\n<body>\n  <div id="app">\n    <h1>Hello from Vai Sandbox</h1>\n  </div>\n  <script type="module" src="/main.js"></script>\n</body>\n</html>\n`,
    },
    {
      path: 'style.css',
      content: `* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: system-ui, -apple-system, sans-serif; background: #09090b; color: #fff; }\n#app { display: flex; min-height: 100vh; align-items: center; justify-content: center; }\nh1 { font-size: 2.25rem; font-weight: bold; }\n`,
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
          typescript: '^5.7.0',
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
          typescript: '^5.7.0',
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
          typescript: '^5.7.0',
          vite: '^6.0.0',
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

/** All available templates */
export const SANDBOX_TEMPLATES: SandboxTemplate[] = [
  reactVite,
  nextjs,
  vueVite,
  svelteVite,
  vanilla,
  expressApi,
  fastifyApi,
  astro,
  solidVite,
  flaskApi,
];

/** Lookup by ID */
export function getTemplate(id: string): SandboxTemplate | undefined {
  return SANDBOX_TEMPLATES.find((t) => t.id === id);
}
