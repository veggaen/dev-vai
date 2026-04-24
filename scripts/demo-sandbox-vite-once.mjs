/**
 * One-shot: create sandbox, write a tiny Vite app, install, start, print preview URL.
 * Usage: node scripts/demo-sandbox-vite-once.mjs
 */
const API = process.env.VAI_API_BASE ?? 'http://localhost:3006';

const pkg = {
  name: 'vai-sandbox-demo',
  private: true,
  type: 'module',
  version: '0.0.1',
  scripts: {
    dev: 'vite',
    build: 'vite build',
  },
  devDependencies: {
    vite: '^6.3.5',
  },
};

const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vai sandbox demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`;

const styleCss = `
:root {
  --bg: #0c0c0f;
  --card: #14141a;
  --border: rgba(255,255,255,0.08);
  --text: #fafafa;
  --muted: #71717a;
  --accent: #ff5c1a;
  --accent-dim: rgba(255, 92, 26, 0.15);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255, 92, 26, 0.2), transparent),
    linear-gradient(180deg, var(--bg), #050506);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}
.shell {
  width: 100%;
  max-width: 28rem;
  border-radius: 1.25rem;
  border: 1px solid var(--border);
  background: linear-gradient(145deg, rgba(255,255,255,0.04), transparent);
  box-shadow: 0 24px 80px rgba(0,0,0,0.45);
  padding: 1.75rem;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 0.75rem;
}
h1 {
  font-size: 1.35rem;
  font-weight: 600;
  letter-spacing: -0.03em;
  margin: 0 0 0.5rem;
  line-height: 1.25;
}
p.lead {
  margin: 0 0 1.25rem;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--muted);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border-radius: 0.9rem;
  background: var(--accent-dim);
  border: 1px solid rgba(255, 92, 26, 0.25);
}
.count {
  font-size: 2rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
}
button {
  appearance: none;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.55rem 1rem;
  border-radius: 9999px;
  background: var(--accent);
  color: #0a0a0a;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
button:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(255, 92, 26, 0.35);
}
button:active { transform: translateY(0); }
footer {
  margin-top: 1.25rem;
  font-size: 0.7rem;
  color: var(--muted);
  text-align: center;
}
`;

const mainJs = `import './style.css';

let n = 0;
const root = document.getElementById('root');

function render() {
  root.innerHTML = \`
    <div class="shell">
      <div class="badge">● Live in sandbox</div>
      <h1>Built through the Vai API</h1>
      <p class="lead">This page was written to the sandbox, dependencies installed, and Vite started — same path your Builder preview uses.</p>
      <div class="row">
        <span class="count" id="num">\${n}</span>
        <button type="button" id="btn">Increment</button>
      </div>
      <footer>Vanilla Vite · no framework · hot reload on save</footer>
    </div>
  \`;
  document.getElementById('btn').onclick = () => {
    n += 1;
    document.getElementById('num').textContent = String(n);
  };
}

render();
`;

const viteConfig = `import { defineConfig } from 'vite';
const port = Number(process.env.PORT) || 5173;
export default defineConfig({
  server: {
    host: true,
    port,
    strictPort: true,
  },
});
`;

const files = [
  { path: 'package.json', content: JSON.stringify(pkg, null, 2) },
  { path: 'index.html', content: indexHtml },
  { path: 'vite.config.js', content: viteConfig },
  { path: 'src/main.js', content: mainJs },
  { path: 'src/style.css', content: styleCss },
];

async function main() {
  const name = `vai-demo-${Date.now()}`;
  const createRes = await fetch(`${API}/api/sandbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!createRes.ok) throw new Error(`create ${createRes.status} ${await createRes.text()}`);
  const { id } = await createRes.json();
  process.stderr.write(`Project ${id} (${name})\n`);

  const writeRes = await fetch(`${API}/api/sandbox/${id}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  if (!writeRes.ok) throw new Error(`write ${writeRes.status} ${await writeRes.text()}`);

  const installRes = await fetch(`${API}/api/sandbox/${id}/install`, { method: 'POST' });
  const installJson = await installRes.json();
  if (!installRes.ok || !installJson.success) {
    throw new Error(`install failed: ${JSON.stringify(installJson)}`);
  }

  const startRes = await fetch(`${API}/api/sandbox/${id}/start`, { method: 'POST' });
  if (!startRes.ok) throw new Error(`start ${startRes.status} ${await startRes.text()}`);
  const { port } = await startRes.json();

  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await fetch(`${API}/api/sandbox/${id}`);
    const j = await st.json();
    if (j.status === 'running' && j.devPort) {
      const url = `http://localhost:${j.devPort}`;
      process.stdout.write(JSON.stringify({ ok: true, projectId: id, previewUrl: url, assignedPort: port }, null, 2));
      process.stdout.write('\n');
      return;
    }
    if (j.status === 'failed') throw new Error(`sandbox failed: ${JSON.stringify(j.logs?.slice?.(-5))}`);
  }
  throw new Error('timeout waiting for dev server');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
