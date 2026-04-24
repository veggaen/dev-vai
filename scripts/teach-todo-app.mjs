/**
 * teach-todo-app.mjs
 * Teaches vai:v0 a complete working Next.js todo app via /api/teach
 */

const RUNTIME = 'http://localhost:3006';

const TODO_PAGE = `'use client';
import { useState } from 'react';

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

export default function TodoPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState('');

  const add = () => {
    const text = input.trim();
    if (!text) return;
    setTodos(prev => [...prev, { id: Date.now(), text, done: false }]);
    setInput('');
  };

  const toggle = (id: number) => setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const remove = (id: number) => setTodos(prev => prev.filter(t => t.id !== id));

  return (
    <main className="max-w-md mx-auto pt-16 px-4">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Todo List</h1>
      <div className="flex gap-2 mb-6">
        <input
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Add a todo..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button
          onClick={add}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >Add</button>
      </div>
      <ul className="space-y-2">
        {todos.map(todo => (
          <li key={todo.id} className="flex items-center gap-3 bg-white rounded-lg px-4 py-3 shadow-sm">
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() => toggle(todo.id)}
              className="w-4 h-4 accent-blue-600"
            />
            <span className={\`flex-1 text-sm \${todo.done ? 'line-through text-gray-400' : 'text-gray-800'}\`}>{todo.text}</span>
            <button onClick={() => remove(todo.id)} className="text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
          </li>
        ))}
      </ul>
      {todos.length === 0 && <p className="text-center text-gray-400 text-sm mt-8">No todos yet. Add one above!</p>}
    </main>
  );
}`;

const TODO_LAYOUT = `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Todo App' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}`;

const TODO_GLOBALS = `@tailwind base;
@tailwind components;
@tailwind utilities;`;

const TODO_PKG = JSON.stringify({
  name: 'todo-app',
  private: true,
  version: '0.1.0',
  scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
  dependencies: { next: '^14.2.0', react: '^18.3.1', 'react-dom': '^18.3.1' },
  devDependencies: {
    '@types/node': '^20',
    '@types/react': '^18',
    '@types/react-dom': '^18',
    autoprefixer: '^10.4.19',
    postcss: '^8.4.38',
    tailwindcss: '^3.4.4',
    typescript: '^5',
  },
}, null, 2);

const TODO_TAILWIND = `import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;`;

const TODO_POSTCSS = `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };`;

function fence(lang, title, content) {
  return `\`\`\`${lang} title="${title}"\n${content}\n\`\`\``;
}

const fullResponse = `Building a Next.js 14 todo app with add/complete/delete and Tailwind CSS.

${fence('json', 'package.json', TODO_PKG)}

${fence('tsx', 'src/app/layout.tsx', TODO_LAYOUT)}

${fence('css', 'src/app/globals.css', TODO_GLOBALS)}

${fence('tsx', 'src/app/page.tsx', TODO_PAGE)}

${fence('ts', 'tailwind.config.ts', TODO_TAILWIND)}

${fence('js', 'postcss.config.js', TODO_POSTCSS)}`;

// Build multiple pattern variants so vai:v0 matches any phrasing
const patterns = [
  'build nextjs todo app',
  'build me a nextjs todo app',
  'build a nextjs todo app',
  'create a todo app with nextjs',
  'nextjs todo app add complete delete tailwind',
  'todo app next.js tailwind features add mark complete delete',
  'build todo app next.js features add todos mark complete delete use tailwind css',
];

const entries = patterns.map(pattern => ({
  pattern,
  response: fullResponse,
  source: 'vcus-teaching-todo',
}));

console.log(`Teaching ${entries.length} patterns to vai:v0...`);

const res = await fetch(`${RUNTIME}/api/teach`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ entries }),
});

const result = await res.json();
console.log('Result:', JSON.stringify(result, null, 2));

// Also train the raw file content so vai indexes it
console.log('\nTraining raw code content...');
const trainRes = await fetch(`${RUNTIME}/api/train`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: `Next.js 14 todo app with Tailwind CSS. Complete working code:\n\n${fullResponse}`,
    source: 'vcus-teaching-todo-raw',
    language: 'code',
  }),
});
const trainResult = await trainRes.json();
console.log('Train result:', JSON.stringify(trainResult, null, 2));

// Verify by querying
console.log('\nVerifying with test query...');
const { WebSocket } = await import('ws');
await new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://localhost:3006/api/chat');
  let response = '';
  const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 30000);

  ws.on('open', () => {
    // Create a temp conversation first
    fetch(`${RUNTIME}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: 'vai:v0', mode: 'builder' }),
    }).then(r => r.json()).then(conv => {
      ws.send(JSON.stringify({ conversationId: conv.id, content: 'build me a nextjs todo app' }));
    });
  });

  ws.on('message', raw => {
    const c = JSON.parse(raw.toString());
    if (c.type === 'text_delta') { process.stdout.write(c.textDelta ?? ''); response += c.textDelta ?? ''; }
    if (c.type === 'done') { clearTimeout(timeout); ws.close(); resolve(response); }
    if (c.type === 'error') { clearTimeout(timeout); ws.close(); reject(new Error(c.error)); }
  });

  ws.on('error', e => { clearTimeout(timeout); reject(e); });
});

console.log('\n\nDone!');
