/**
 * code-emitters — pure answer/knowledge builders extracted from VaiEngine (vai-engine.ts).
 *
 * These were private methods with ZERO this/super coupling. Moved verbatim (no dedent:
 * leading whitespace inside template literals is significant). VaiEngine delegates to
 * them via thin wrappers, so all call sites are unchanged. Behavior-preserving;
 * proven by golden snapshot + the full core test suite.
 */
/* eslint-disable */

import type { Message } from './adapter.js';

export function generateWebsite(desc: string): string {
    const isArtGallery = /art\s+gallery|artist\s+portfolio|museum|exhibition|curatorial/i.test(desc);
    const isPhotographyPortfolio = !isArtGallery && /photographer|photography|photo\s+gallery|portrait|wedding/i.test(desc);
    const isPortfolio = isPhotographyPortfolio || (!isArtGallery && /portfolio/i.test(desc));
    const title = isArtGallery ? 'Art Gallery' : isPhotographyPortfolio ? 'Photographer Portfolio' : isPortfolio ? 'Portfolio' : 'Landing Page';
    const brand = isArtGallery ? 'Atelier North' : isPhotographyPortfolio ? 'Ava Lens' : isPortfolio ? 'John Doe' : 'Brand';
    const sectionLabel = isArtGallery ? 'Current Exhibitions' : isPhotographyPortfolio ? 'Featured Shoots' : isPortfolio ? 'Projects' : 'Features';
    const heroTitle = isArtGallery ? 'Contemporary Work, Quietly Presented' : isPhotographyPortfolio ? 'Images That Feel Lived In' : isPortfolio ? 'Full-Stack Developer' : 'Build Something Amazing';
    const heroCopy = isArtGallery
      ? 'A considered digital gallery experience for exhibitions, artists, and collectors who want the work to stay central.'
      : isPhotographyPortfolio
      ? 'Editorial photography for weddings, portraits, and brands that want polished visuals with a human pulse.'
      : isPortfolio
        ? 'I build modern web applications with React, TypeScript, and Node.js.'
        : 'The fastest way to go from idea to production.';
    const heroCta = isArtGallery ? 'View the Exhibition' : isPhotographyPortfolio ? 'View the Gallery' : isPortfolio ? 'View My Work' : 'Get Started';
    const contactTitle = isArtGallery ? 'Plan Your Visit' : isPhotographyPortfolio ? 'Book a Session' : 'Get In Touch';
    const contactButton = isArtGallery ? 'Request Details' : isPhotographyPortfolio ? 'Send Inquiry' : 'Send Message';
    return `Here's a complete **${title}** with HTML + Tailwind CSS:\n\n\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-white">
  <!-- Navigation -->
  <nav class="fixed w-full bg-gray-900/80 backdrop-blur-sm border-b border-gray-800 z-50">
    <div class="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
      <a href="#" class="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">${brand}</a>
      <div class="hidden md:flex gap-8">
        <a href="#about" class="text-gray-300 hover:text-white transition">About</a>
        <a href="#${isPortfolio ? 'projects' : 'features'}" class="text-gray-300 hover:text-white transition">${sectionLabel}</a>
        <a href="#contact" class="text-gray-300 hover:text-white transition">Contact</a>
      </div>
    </div>
  </nav>

  <!-- Hero -->
  <section class="min-h-screen flex items-center justify-center px-6">
    <div class="text-center max-w-3xl">
      <h1 class="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 bg-clip-text text-transparent">
        ${heroTitle}
      </h1>
      <p class="text-xl text-gray-400 mb-8">${heroCopy}</p>
      <a href="#${isPortfolio ? 'projects' : 'features'}" class="inline-block px-8 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition transform hover:scale-105">
        ${heroCta}
      </a>
    </div>
  </section>

  <!-- ${sectionLabel} -->
  <section id="${isPortfolio ? 'projects' : 'features'}" class="py-20 px-6">
    <div class="max-w-6xl mx-auto">
      <h2 class="text-3xl font-bold text-center mb-12">${sectionLabel}</h2>
      <div class="grid md:grid-cols-3 gap-8">
        ${[1,2,3].map(i => `<div class="bg-gray-800 rounded-xl p-6 hover:bg-gray-750 transition">
          <div class="w-12 h-12 bg-blue-600/20 rounded-lg flex items-center justify-center mb-4">
            <span class="text-2xl">${['🚀','⚡','🎨'][i-1]}</span>
          </div>
          <h3 class="text-xl font-semibold mb-2">${isPhotographyPortfolio ? `Shoot ${i}` : isPortfolio ? `Project ${i}` : `Feature ${i}`}</h3>
          <p class="text-gray-400">${isPhotographyPortfolio ? 'A curated story-driven image collection designed to make the work feel premium and immediate.' : isPortfolio ? 'A full-stack application built with modern technologies.' : 'Description of this amazing feature goes here.'}</p>
        </div>`).join('\n        ')}
      </div>
    </div>
  </section>

  <!-- Contact -->
  <section id="contact" class="py-20 px-6 bg-gray-800/50">
    <div class="max-w-xl mx-auto text-center">
      <h2 class="text-3xl font-bold mb-8">${contactTitle}</h2>
      <form class="space-y-4">
        <input type="text" placeholder="Your Name" class="w-full px-4 py-3 bg-gray-800 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none">
        <input type="email" placeholder="Your Email" class="w-full px-4 py-3 bg-gray-800 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none">
        <textarea placeholder="Your Message" rows="4" class="w-full px-4 py-3 bg-gray-800 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none"></textarea>
        <button type="submit" class="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition">${contactButton}</button>
      </form>
    </div>
  </section>

  <footer class="py-8 text-center text-gray-500 border-t border-gray-800">
    <p>&copy; 2026 ${brand}. All rights reserved.</p>
  </footer>
</body>
</html>
\`\`\`\n\n**To use:** Save as \`index.html\` and open in a browser. Tailwind loads from CDN — no build step needed.\n\n{{deploy:nextjs:basic:${title}}}\n\nWant me to add animations, a dark/light toggle, or convert this to React?`;
  }

export function generateRestApi(desc: string, langHint: string): string {
    const normalized = `${desc} ${langHint}`.toLowerCase();

    if (/(python|fastapi)/.test(normalized)) {
      return `Here's a **FastAPI REST API**:\n\n**1. Install:**\n\`\`\`bash
pip install fastapi uvicorn
\`\`\`\n\n**2. main.py:**\n\`\`\`python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

class ItemInput(BaseModel):
    name: str

items = [
    {"id": 1, "name": "First item"},
    {"id": 2, "name": "Second item"},
]

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.get("/api/items")
def list_items():
    return items

@app.post("/api/items", status_code=201)
def create_item(payload: ItemInput):
    item = {"id": len(items) + 1, "name": payload.name}
    items.append(item)
    return item

@app.delete("/api/items/{item_id}", status_code=204)
def delete_item(item_id: int):
    index = next((i for i, item in enumerate(items) if item["id"] == item_id), None)
    if index is None:
        raise HTTPException(status_code=404, detail="Not found")
    items.pop(index)
\`\`\`\n\n**3. Run it:**\n\`\`\`bash
uvicorn main:app --reload
\`\`\`\n\n**4. Test it:**\n\`\`\`bash
curl http://localhost:8000/api/items
curl -X POST http://localhost:8000/api/items -H "Content-Type: application/json" -d '{"name":"New item"}'
\`\`\``;
    }

    if (/(rust|axum)/.test(normalized)) {
      return `Here's a **Rust REST API** with Axum:\n\n**1. Cargo.toml:**\n\`\`\`toml
[package]
name = "rust-api"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
\`\`\`\n\n**2. src/main.rs:**\n\`\`\`rust
use axum::{extract::Path, routing::{delete, get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Clone, Serialize, Deserialize)]
struct Item {
    id: u32,
    name: String,
}

#[derive(Deserialize)]
struct ItemInput {
    name: String,
}

type Db = Arc<Mutex<Vec<Item>>>;

#[tokio::main]
async fn main() {
    let db: Db = Arc::new(Mutex::new(vec![
        Item { id: 1, name: "First item".into() },
        Item { id: 2, name: "Second item".into() },
    ]));

    let app = Router::new()
        .route("/api/health", get(|| async { Json(serde_json::json!({ "status": "ok" })) }))
        .route("/api/items", get(list_items).post(create_item))
        .route("/api/items/:id", delete(delete_item))
        .with_state(db);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn list_items(axum::extract::State(db): axum::extract::State<Db>) -> Json<Vec<Item>> {
    Json(db.lock().unwrap().clone())
}

async fn create_item(
    axum::extract::State(db): axum::extract::State<Db>,
    Json(payload): Json<ItemInput>,
) -> Json<Item> {
    let mut items = db.lock().unwrap();
    let item = Item { id: items.len() as u32 + 1, name: payload.name };
    items.push(item.clone());
    Json(item)
}

async fn delete_item(
    Path(id): Path<u32>,
    axum::extract::State(db): axum::extract::State<Db>,
) {
    let mut items = db.lock().unwrap();
    items.retain(|item| item.id != id);
}
\`\`\`\n\n**3. Run it:**\n\`\`\`bash
cargo run
\`\`\``;
    }

    return `Here's a **Node.js REST API** with Express and TypeScript:\n\n**1. Install:**\n\`\`\`bash
npm install express cors
npm install -D typescript tsx @types/node @types/express
\`\`\`\n\n**2. src/index.ts:**\n\`\`\`ts
import express from "express";
import cors from "cors";

type Item = { id: number; name: string };

const app = express();
app.use(cors());
app.use(express.json());

let items: Item[] = [
  { id: 1, name: "First item" },
  { id: 2, name: "Second item" },
];

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/items", (_req, res) => {
  res.json(items);
});

app.post("/api/items", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const item = { id: Date.now(), name };
  items.push(item);
  res.status(201).json(item);
});

app.delete("/api/items/:id", (req, res) => {
  items = items.filter((item) => item.id !== Number(req.params.id));
  res.sendStatus(204);
});

app.listen(3000, () => {
  console.log("API running on http://localhost:3000");
});
\`\`\`\n\n**3. Run it:**\n\`\`\`bash
npx tsx src/index.ts
\`\`\`\n\n**4. Test it:**\n\`\`\`bash
curl http://localhost:3000/api/items
curl -X POST http://localhost:3000/api/items -H "Content-Type: application/json" -d '{"name":"New item"}'
\`\`\``;
  }

export function generateBlog(desc: string): string {
    return `Here's a **Blog** with React + TypeScript + Markdown support:\n\n**1. Setup:**\n\`\`\`bash
npm create vite@latest my-blog -- --template react-ts
cd my-blog && npm install react-markdown react-router-dom
\`\`\`\n\n**2. src/App.tsx:**\n\`\`\`tsx
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface Post { id: number; title: string; content: string; date: string; }

const initialPosts: Post[] = [
  { id: 1, title: 'Hello World', content: '# Hello World\\n\\nThis is my **first** blog post!\\n\\n- Built with React\\n- Supports Markdown\\n- Easy to extend', date: '2026-03-24' },
  { id: 2, title: 'Getting Started with TypeScript', content: '# TypeScript Guide\\n\\nTypeScript adds types to JavaScript.\\n\\n\\\`\\\`\\\`typescript\\nconst greet = (name: string): string => \\\`Hello \${name}\\\`;\\n\\\`\\\`\\\`', date: '2026-03-23' },
];

function PostList({ posts }: { posts: Post[] }) {
  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <h1>My Blog</h1>
      {posts.map(p => (
        <article key={p.id} style={{ marginBottom: 24, padding: 16, borderBottom: '1px solid #eee' }}>
          <Link to={\`/post/\${p.id}\`} style={{ textDecoration: 'none', color: '#2563eb' }}>
            <h2>{p.title}</h2>
          </Link>
          <time style={{ color: '#999' }}>{p.date}</time>
        </article>
      ))}
    </div>
  );
}

function PostView({ posts }: { posts: Post[] }) {
  const id = Number(location.pathname.split('/').pop());
  const post = posts.find(p => p.id === id);
  if (!post) return <p>Post not found</p>;
  return (
    <article style={{ maxWidth: 700, margin: '0 auto' }}>
      <Link to="/">&larr; Back</Link>
      <h1>{post.title}</h1>
      <time style={{ color: '#999' }}>{post.date}</time>
      <ReactMarkdown>{post.content}</ReactMarkdown>
    </article>
  );
}

export default function App() {
  const [posts] = useState(initialPosts);
  return (
    <BrowserRouter>
      <div style={{ padding: '2rem 1rem', fontFamily: 'system-ui' }}>
        <Routes>
          <Route path="/" element={<PostList posts={posts} />} />
          <Route path="/post/:id" element={<PostView posts={posts} />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
\`\`\`\n\n**3. Run:** \`npm run dev\`\n\nThis gives you a blog with Markdown rendering, routing, and a post list. Want me to add: a post editor, categories/tags, or a backend to store posts?`;
  }

export function generateChatApp(desc: string): string {
    return `Here's a **Real-Time Chat App** with React + WebSocket:\n\n**Backend (server.ts):**\n\`\`\`typescript
import { WebSocketServer, WebSocket } from 'ws';

const wss = new WebSocketServer({ port: 8080 });
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const payload = JSON.stringify({ ...msg, timestamp: Date.now() });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  });
  ws.on('close', () => clients.delete(ws));
});
console.log('Chat server running on ws://localhost:8080');
\`\`\`\n\n**Frontend (App.tsx):**\n\`\`\`tsx
import { useState, useEffect, useRef } from 'react';

interface Message { user: string; text: string; timestamp: number; }

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [username] = useState('User' + Math.floor(Math.random() * 1000));
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080');
    wsRef.current = ws;
    ws.onmessage = (e) => {
      setMessages(prev => [...prev, JSON.parse(e.data)]);
    };
    return () => ws.close();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = () => {
    if (!input.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ user: username, text: input.trim() }));
    setInput('');
  };

  return (
    <div style={{ maxWidth: 500, margin: '2rem auto', fontFamily: 'system-ui' }}>
      <h2>Chat Room — {username}</h2>
      <div style={{ height: 400, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 8 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 8, textAlign: m.user === username ? 'right' : 'left' }}>
            <strong style={{ color: m.user === username ? '#2563eb' : '#059669' }}>{m.user}:</strong> {m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Type a message..." style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #ccc' }} />
        <button onClick={send} style={{ padding: '8px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Send</button>
      </div>
    </div>
  );
}
\`\`\`\n\n**Setup:** \`npm install ws && npx tsx server.ts\` (backend) + \`npm run dev\` (frontend)\n\nOpen two browser tabs to test real-time messaging. Want me to add: user avatars, message persistence, or typing indicators?`;
  }

export function generateLoginPage(desc: string): string {
    return `Here's a **Login/Signup Page** with React + TypeScript:\n\n\`\`\`tsx
import { useState } from 'react';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email || !password) return setError('Please fill in all fields');
    if (!isLogin && !name) return setError('Name is required');
    if (password.length < 8) return setError('Password must be at least 8 characters');

    setLoading(true);
    try {
      const res = await fetch(\`/api/auth/\${isLogin ? 'login' : 'register'}\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ...(isLogin ? {} : { name }) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Auth failed');
      const data = await res.json();
      localStorage.setItem('token', data.token);
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', fontFamily: 'system-ui' }}>
      <form onSubmit={handleSubmit} style={{ background: 'white', padding: 32, borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.1)', width: 380 }}>
        <h2 style={{ textAlign: 'center', marginBottom: 24 }}>{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
        {error && <p style={{ color: '#e11d48', fontSize: 14, textAlign: 'center', marginBottom: 12 }}>{error}</p>}
        {!isLogin && <input value={name} onChange={e => setName(e.target.value)} placeholder="Full Name" style={{ ...inputStyle, marginBottom: 12 }} />}
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={{ ...inputStyle, marginBottom: 12 }} />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" style={{ ...inputStyle, marginBottom: 16 }} />
        <button type="submit" disabled={loading} style={{ width: '100%', padding: 12, background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer' }}>
          {loading ? 'Loading...' : isLogin ? 'Sign In' : 'Sign Up'}
        </button>
        <p style={{ textAlign: 'center', marginTop: 16, color: '#6b7280', fontSize: 14 }}>
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button type="button" onClick={() => { setIsLogin(!isLogin); setError(''); }} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer' }}>
            {isLogin ? 'Sign Up' : 'Sign In'}
          </button>
        </p>
      </form>
    </div>
  );
}
\`\`\`\n\nThis includes: form validation, loading states, error display, login/signup toggle. Wire up your backend API endpoint at \`/api/auth/login\` and \`/api/auth/register\`. Want me to generate the backend auth logic too?`;
  }

export function generateDashboard(desc: string): string {
    return `Here's a **Dashboard** with React + TypeScript:\n\n\`\`\`tsx
import { useState } from 'react';

const stats = [
  { label: 'Total Users', value: '2,847', change: '+12%', up: true },
  { label: 'Revenue', value: '$48,920', change: '+8%', up: true },
  { label: 'Active Sessions', value: '423', change: '-3%', up: false },
  { label: 'Conversion', value: '3.24%', change: '+0.5%', up: true },
];

const recentActivity = [
  { user: 'Alice', action: 'Signed up', time: '2 min ago' },
  { user: 'Bob', action: 'Made a purchase', time: '15 min ago' },
  { user: 'Charlie', action: 'Submitted a ticket', time: '1 hour ago' },
  { user: 'Diana', action: 'Updated profile', time: '3 hours ago' },
];

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui', background: '#f8fafc' }}>
      {/* Sidebar */}
      <aside style={{ width: sidebarOpen ? 240 : 60, background: '#1e293b', color: 'white', transition: 'width 0.2s', overflow: 'hidden' }}>
        <div style={{ padding: 16, borderBottom: '1px solid #334155' }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18 }}>☰</button>
          {sidebarOpen && <span style={{ marginLeft: 12, fontWeight: 'bold' }}>Dashboard</span>}
        </div>
        {['Overview', 'Analytics', 'Users', 'Settings'].map(item => (
          <div key={item} style={{ padding: '12px 16px', cursor: 'pointer', borderLeft: item === 'Overview' ? '3px solid #3b82f6' : '3px solid transparent' }}>
            {sidebarOpen ? item : item[0]}
          </div>
        ))}
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: 24 }}>
        <h1 style={{ marginBottom: 24 }}>Dashboard Overview</h1>

        {/* Stats Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          {stats.map(s => (
            <div key={s.label} style={{ background: 'white', padding: 20, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 4 }}>{s.label}</p>
              <p style={{ fontSize: 24, fontWeight: 'bold' }}>{s.value}</p>
              <span style={{ color: s.up ? '#059669' : '#e11d48', fontSize: 14 }}>{s.change}</span>
            </div>
          ))}
        </div>

        {/* Activity Table */}
        <div style={{ background: 'white', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
            <h3>Recent Activity</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ textAlign: 'left', padding: '12px 20px', color: '#6b7280', fontSize: 14 }}>User</th>
              <th style={{ textAlign: 'left', padding: '12px 20px', color: '#6b7280', fontSize: 14 }}>Action</th>
              <th style={{ textAlign: 'left', padding: '12px 20px', color: '#6b7280', fontSize: 14 }}>Time</th>
            </tr></thead>
            <tbody>{recentActivity.map((a, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '12px 20px' }}>{a.user}</td>
                <td style={{ padding: '12px 20px' }}>{a.action}</td>
                <td style={{ padding: '12px 20px', color: '#6b7280' }}>{a.time}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
\`\`\`\n\nThis includes: collapsible sidebar, stats cards with change indicators, activity table. Want me to add: charts (Chart.js/Recharts), date filters, or dark mode?`;
  }

export function generateCProgram(desc: string): string {
    if (/access\s*control/i.test(desc)) {
      return 'Here\'s a **C program** that checks access control:\n\n```c\n#include <stdio.h>\n#include <string.h>\n#include <stdbool.h>\n\n#define MAX_USERS 10\n#define MAX_NAME 32\n\ntypedef enum { READ = 1, WRITE = 2, EXECUTE = 4 } Permission;\n\ntypedef struct {\n    char name[MAX_NAME];\n    int permissions;\n} User;\n\nstatic User users[MAX_USERS];\nstatic int user_count = 0;\n\nbool add_user(const char *name, int perms) {\n    if (user_count >= MAX_USERS) return false;\n    strncpy(users[user_count].name, name, MAX_NAME - 1);\n    users[user_count].name[MAX_NAME - 1] = \'\\0\';\n    users[user_count].permissions = perms;\n    user_count++;\n    return true;\n}\n\nconst char *check_access(const char *name, Permission required) {\n    for (int i = 0; i < user_count; i++) {\n        if (strcmp(users[i].name, name) == 0) {\n            return (users[i].permissions & required) ? "GRANTED" : "DENIED";\n        }\n    }\n    return "DENIED";\n}\n\nint main(void) {\n    add_user("alice", READ | WRITE | EXECUTE);\n    add_user("bob", READ);\n    add_user("guest", 0);\n\n    printf("alice WRITE: %s\\n", check_access("alice", WRITE));   // GRANTED\n    printf("bob WRITE:   %s\\n", check_access("bob", WRITE));     // DENIED\n    printf("guest READ:  %s\\n", check_access("guest", READ));    // DENIED\n    printf("alice READ:  %s\\n", check_access("alice", READ));    // GRANTED\n    return 0;\n}\n```\n\nThis uses bitfield permissions (READ=1, WRITE=2, EXECUTE=4) so you can combine them with `|` and check with `&`.';
    }
    // Generic C program
    return 'Here\'s a **C program** template:\n\n```c\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n\nint main(int argc, char *argv[]) {\n    printf("Hello from C!\\n");\n    return 0;\n}\n```\n\nTell me what the program should do and I\'ll generate the specific implementation.';
  }

export function generateUtilitySnippet(desc: string, langHint: string): string {
    const lang = langHint || 'typescript';
    const langLabel = lang.charAt(0).toUpperCase() + lang.slice(1);

    // --- Debounce ---
    if (/debounce/i.test(desc)) {
      if (/python/i.test(lang)) {
        return `Here's a **debounce** function in **Python**:\n\n\`\`\`python\nimport threading\nfrom typing import Callable, Any\n\ndef debounce(delay: float) -> Callable:\n    """Decorator that delays execution until after 'delay' seconds of inactivity."""\n    def decorator(fn: Callable) -> Callable:\n        timer: threading.Timer | None = None\n        def debounced(*args: Any, **kwargs: Any) -> None:\n            nonlocal timer\n            if timer is not None:\n                timer.cancel()\n            timer = threading.Timer(delay, fn, args=args, kwargs=kwargs)\n            timer.start()\n        return debounced\n    return decorator\n\n# Usage\n@debounce(0.3)\ndef on_input_change(value: str) -> None:\n    print(f"Processing: {value}")\n\non_input_change("h")\non_input_change("he")\non_input_change("hel")  # Only this one fires after 300ms\n\`\`\``;
      }
      return `Here's a **debounce** function in **${langLabel}**:\n\n\`\`\`typescript\n/**\n * Returns a debounced version of the given function.\n * The function will only execute after \`delay\` ms of inactivity.\n */\nfunction debounce<T extends (...args: any[]) => any>(\n  fn: T,\n  delay: number\n): (...args: Parameters<T>) => void {\n  let timeoutId: ReturnType<typeof setTimeout> | null = null;\n\n  return (...args: Parameters<T>) => {\n    if (timeoutId !== null) clearTimeout(timeoutId);\n    timeoutId = setTimeout(() => {\n      timeoutId = null;\n      fn(...args);\n    }, delay);\n  };\n}\n\n// Usage\nconst debouncedSearch = debounce((query: string) => {\n  console.log("Searching:", query);\n}, 300);\n\ndebouncedSearch("h");\ndebouncedSearch("he");\ndebouncedSearch("hel");  // Only this one fires after 300ms\n\`\`\`\n\n**Key points:**\n- Generic type \`T\` preserves the original function's parameter types\n- Returns \`void\` since the call is delayed (no return value)\n- Clears previous timer on each call, so only the last call within \`delay\` ms executes`;
    }

    // --- Throttle ---
    if (/throttle/i.test(desc)) {
      return `Here's a **throttle** function in **${langLabel}**:\n\n\`\`\`typescript\n/**\n * Returns a throttled version of the given function.\n * The function executes at most once per \`limit\` ms.\n */\nfunction throttle<T extends (...args: any[]) => any>(\n  fn: T,\n  limit: number\n): (...args: Parameters<T>) => void {\n  let lastCall = 0;\n  let timeoutId: ReturnType<typeof setTimeout> | null = null;\n\n  return (...args: Parameters<T>) => {\n    const now = Date.now();\n    const remaining = limit - (now - lastCall);\n\n    if (remaining <= 0) {\n      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }\n      lastCall = now;\n      fn(...args);\n    } else if (!timeoutId) {\n      timeoutId = setTimeout(() => {\n        lastCall = Date.now();\n        timeoutId = null;\n        fn(...args);\n      }, remaining);\n    }\n  };\n}\n\n// Usage\nconst throttledScroll = throttle(() => {\n  console.log("Scroll position:", window.scrollY);\n}, 200);\n\nwindow.addEventListener("scroll", throttledScroll);\n\`\`\`\n\n**Key points:**\n- Executes immediately on first call, then at most once per \`limit\` ms\n- Trailing call is guaranteed — the last invocation within a burst always fires\n- Useful for scroll, resize, and mousemove handlers`;
    }

    // --- Deep clone ---
    if (/deep\s*(?:clone|copy)/i.test(desc)) {
      return `Here's a **deep clone** function in **${langLabel}**:\n\n\`\`\`typescript\n/**\n * Deep clones a value, handling objects, arrays, dates, maps, sets, and regexes.\n * Does NOT handle circular references — use structuredClone() for that.\n */\nfunction deepClone<T>(value: T): T {\n  // Primitives and null\n  if (value === null || typeof value !== "object") return value;\n\n  // Built-in types\n  if (value instanceof Date) return new Date(value.getTime()) as T;\n  if (value instanceof RegExp) return new RegExp(value.source, value.flags) as T;\n  if (value instanceof Map) {\n    const map = new Map();\n    value.forEach((v, k) => map.set(deepClone(k), deepClone(v)));\n    return map as T;\n  }\n  if (value instanceof Set) {\n    const set = new Set();\n    value.forEach((v) => set.add(deepClone(v)));\n    return set as T;\n  }\n\n  // Arrays and plain objects\n  if (Array.isArray(value)) return value.map(deepClone) as T;\n  const clone = {} as Record<string, unknown>;\n  for (const key of Object.keys(value)) {\n    clone[key] = deepClone((value as Record<string, unknown>)[key]);\n  }\n  return clone as T;\n}\n\n// Usage\nconst original = { a: 1, b: { c: [2, 3] }, d: new Date() };\nconst cloned = deepClone(original);\ncloned.b.c.push(4);\nconsole.log(original.b.c); // [2, 3] — original unchanged\n\`\`\`\n\n**Modern alternative:** \`structuredClone(obj)\` — built-in, handles circular refs, available in Node 17+ and all modern browsers.`;
    }

    // --- Memoize ---
    if (/memoi[zs]e/i.test(desc)) {
      return `Here's a **memoize** function in **${langLabel}**:\n\n\`\`\`typescript\n/**\n * Caches results of expensive function calls.\n * Uses a Map for O(1) lookup by serialized arguments.\n */\nfunction memoize<T extends (...args: any[]) => any>(fn: T): T {\n  const cache = new Map<string, ReturnType<T>>();\n\n  return ((...args: Parameters<T>): ReturnType<T> => {\n    const key = JSON.stringify(args);\n    if (cache.has(key)) return cache.get(key)!;\n    const result = fn(...args);\n    cache.set(key, result);\n    return result;\n  }) as T;\n}\n\n// Usage\nconst expensiveCalc = memoize((n: number): number => {\n  console.log("Computing...");\n  return n * n;\n});\n\nexpensiveCalc(5); // logs "Computing...", returns 25\nexpensiveCalc(5); // returns 25 (cached, no log)\n\`\`\`\n\n**Caveats:**\n- Uses \`JSON.stringify\` for cache keys — works for primitives and simple objects\n- For object arguments, consider a \`WeakMap\`-based approach\n- Add a max cache size to prevent memory leaks in long-running processes`;
    }

    // --- Event emitter ---
    if (/event\s*(?:emitter|bus|dispatcher)/i.test(desc)) {
      return `Here's a type-safe **event emitter** in **${langLabel}**:\n\n\`\`\`typescript\ntype EventMap = Record<string, any[]>;\n\nclass EventEmitter<Events extends EventMap> {\n  private listeners = new Map<keyof Events, Set<Function>>();\n\n  on<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): () => void {\n    if (!this.listeners.has(event)) this.listeners.set(event, new Set());\n    this.listeners.get(event)!.add(fn);\n    return () => this.listeners.get(event)?.delete(fn);\n  }\n\n  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {\n    this.listeners.get(event)?.forEach(fn => fn(...args));\n  }\n\n  off<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): void {\n    this.listeners.get(event)?.delete(fn);\n  }\n}\n\n// Usage\ninterface AppEvents {\n  userLogin: [userId: string];\n  message: [from: string, text: string];\n  error: [error: Error];\n}\n\nconst bus = new EventEmitter<AppEvents>();\nconst unsub = bus.on("message", (from, text) => console.log(from, text));\nbus.emit("message", "Alice", "Hello!");\nunsub(); // cleanup\n\`\`\``;
    }

    // --- Retry ---
    if (/retry/i.test(desc)) {
      return `Here's a **retry** utility in **${langLabel}**:\n\n\`\`\`typescript\nasync function retry<T>(\n  fn: () => Promise<T>,\n  options: { maxAttempts?: number; delay?: number; backoff?: number } = {}\n): Promise<T> {\n  const { maxAttempts = 3, delay = 1000, backoff = 2 } = options;\n\n  for (let attempt = 1; attempt <= maxAttempts; attempt++) {\n    try {\n      return await fn();\n    } catch (err) {\n      if (attempt === maxAttempts) throw err;\n      const waitMs = delay * Math.pow(backoff, attempt - 1);\n      await new Promise(r => setTimeout(r, waitMs));\n    }\n  }\n  throw new Error("Unreachable");\n}\n\n// Usage\nconst data = await retry(\n  () => fetch("https://api.example.com/data").then(r => r.json()),\n  { maxAttempts: 3, delay: 500, backoff: 2 }\n);\n\`\`\`\n\n**Features:**\n- Exponential backoff: waits 500ms → 1s → 2s\n- Generic return type preserves the function's return type\n- Throws the last error after all attempts are exhausted`;
    }

    // --- Pipe / compose ---
    if (/pipe|compose/i.test(desc)) {
      return `Here's **pipe** and **compose** in **${langLabel}**:\n\n\`\`\`typescript\n/** Left-to-right function composition */\nfunction pipe<T>(...fns: Array<(arg: T) => T>): (arg: T) => T {\n  return (arg: T) => fns.reduce((acc, fn) => fn(acc), arg);\n}\n\n/** Right-to-left function composition */\nfunction compose<T>(...fns: Array<(arg: T) => T>): (arg: T) => T {\n  return (arg: T) => fns.reduceRight((acc, fn) => fn(acc), arg);\n}\n\n// Usage\nconst trim = (s: string) => s.trim();\nconst lower = (s: string) => s.toLowerCase();\nconst exclaim = (s: string) => s + "!";\n\nconst process = pipe(trim, lower, exclaim);\nconsole.log(process("  HELLO  ")); // "hello!"\n\`\`\``;
    }

    // --- Generic fallback for other utility requests ---
    const funcName = desc
      .replace(/\b(?:function|utility|helper|hook|class|module|snippet|method|create|write|make|build|implement|generate|a|an|the|in|for|with|using)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!funcName) {
      return `What utility function would you like? Some common ones:\n\n- **debounce** — delay execution until idle\n- **throttle** — limit execution frequency\n- **deepClone** — recursively copy objects\n- **memoize** — cache function results\n- **retry** — retry async operations with backoff\n- **pipe/compose** — chain functions\n- **eventEmitter** — pub/sub pattern\n\nJust say "write a [name] function in ${lang}" and I'll generate it.`;
    }

    return `Here's a **${funcName}** utility in **${langLabel}**:\n\n\`\`\`${lang === 'typescript' ? 'typescript' : lang}\n// ${funcName} implementation\n// TODO: This is a template — describe the specific behavior you need\n// and I'll generate a complete, working implementation.\n\nexport function ${funcName.replace(/\s+/g, '')}() {\n  // Implement ${funcName} logic here\n  throw new Error("Not implemented — tell me the specifics");\n}\n\`\`\`\n\nCan you describe what this ${funcName} should do? For example:\n- What inputs does it take?\n- What should it return?\n- Any edge cases to handle?`;
  }

export function generateAdvancedCalculatorUI(): string {
    return '**Advanced calculator UI architecture:**\n\n' +
      '**Safe math evaluation:** Use `evaluateExpression()` — an AST-based parser, never `eval()`. Parse input into tokens → build expression tree → evaluate recursively. Libraries: `math.js` or hand-rolled recursive descent (~80 LOC).\n\n' +
      '**History panel:** Scrollable list of past computations with result. Store in state array: `{ expression, result, timestamp }[]`. Click to re-use a past expression.\n\n' +
      '**Theme support:** Light/dark toggle via CSS custom properties. Theme stored in localStorage. React context for theme state.\n\n' +
      '**Keyboard support:** Map physical keys to calculator buttons. Number keys, operators, Enter for equals, Backspace for delete, Escape for clear.\n\n' +
      '**React component structure:**\n' +
      '- `<Calculator>` — root, holds expression state\n' +
      '- `<Display>` — shows current expression + result\n' +
      '- `<Keypad>` — grid of buttons\n' +
      '- `<HistoryPanel>` — scrollable computation log\n' +
      '- `<ThemeToggle>` — light/dark switch\n\n' +
      '**UI details:** Monospace font for display, subtle press animation on buttons, smooth height transition when history panel opens.';
  }

export function generateCalculator(lang: string): string {
    const templates: Record<string, string> = {
      javascript: `\`\`\`javascript
// Simple Calculator
class Calculator {
  add(a, b) { return a + b; }
  subtract(a, b) { return a - b; }
  multiply(a, b) { return a * b; }
  divide(a, b) {
    if (b === 0) throw new Error('Cannot divide by zero');
    return a / b;
  }
  modulo(a, b) { return a % b; }
  power(a, b) { return Math.pow(a, b); }
}

// Usage
const calc = new Calculator();
console.log('10 + 5 =', calc.add(10, 5));        // 15
console.log('10 - 5 =', calc.subtract(10, 5));    // 5
console.log('10 * 5 =', calc.multiply(10, 5));    // 50
console.log('10 / 5 =', calc.divide(10, 5));      // 2
console.log('10 % 3 =', calc.modulo(10, 3));      // 1
console.log('2 ^ 8  =', calc.power(2, 8));        // 256
\`\`\``,
      python: `\`\`\`python
# Simple Calculator
class Calculator:
    def add(self, a, b):
        return a + b

    def subtract(self, a, b):
        return a - b

    def multiply(self, a, b):
        return a * b

    def divide(self, a, b):
        if b == 0:
            raise ValueError("Cannot divide by zero")
        return a / b

    def modulo(self, a, b):
        return a % b

    def power(self, a, b):
        return a ** b

# Usage
calc = Calculator()
print(f"10 + 5 = {calc.add(10, 5)}")        # 15
print(f"10 - 5 = {calc.subtract(10, 5)}")    # 5
print(f"10 * 5 = {calc.multiply(10, 5)}")    # 50
print(f"10 / 5 = {calc.divide(10, 5)}")      # 2.0
print(f"10 % 3 = {calc.modulo(10, 3)}")      # 1
print(f"2 ^ 8  = {calc.power(2, 8)}")        # 256
\`\`\``,
      java: `\`\`\`java
public class Calculator {
    public double add(double a, double b) { return a + b; }
    public double subtract(double a, double b) { return a - b; }
    public double multiply(double a, double b) { return a * b; }
    public double divide(double a, double b) {
        if (b == 0) throw new ArithmeticException("Cannot divide by zero");
        return a / b;
    }
    public double modulo(double a, double b) { return a % b; }
    public double power(double a, double b) { return Math.pow(a, b); }

    public static void main(String[] args) {
        Calculator calc = new Calculator();
        System.out.println("10 + 5 = " + calc.add(10, 5));
        System.out.println("10 - 5 = " + calc.subtract(10, 5));
        System.out.println("10 * 5 = " + calc.multiply(10, 5));
        System.out.println("10 / 5 = " + calc.divide(10, 5));
    }
}
\`\`\``,
    };
    const code = templates[lang] || templates['javascript'];
    return `Here's a **calculator** in **${lang}**:\n\n${code}\n\nThis calculator supports addition, subtraction, multiplication, division (with zero-check), modulo, and power operations.`;
  }

export function generateTodoList(lang: string): string {
    const templates: Record<string, string> = {
      python: `\`\`\`python
# Todo List Manager
class TodoList:
    def __init__(self):
        self.tasks = []

    def add(self, task):
        self.tasks.append({"text": task, "done": False})
        print(f"Added: {task}")

    def remove(self, index):
        if 0 <= index < len(self.tasks):
            removed = self.tasks.pop(index)
            print(f"Removed: {removed['text']}")
        else:
            print("Invalid index")

    def complete(self, index):
        if 0 <= index < len(self.tasks):
            self.tasks[index]["done"] = True
            print(f"Completed: {self.tasks[index]['text']}")

    def show(self):
        if not self.tasks:
            print("No tasks yet!")
            return
        for i, task in enumerate(self.tasks):
            status = "✓" if task["done"] else "○"
            print(f"  {i}. [{status}] {task['text']}")

# Usage
todo = TodoList()
todo.add("Buy groceries")
todo.add("Write unit tests")
todo.add("Read documentation")
todo.complete(1)
todo.show()
# Output:
#   0. [○] Buy groceries
#   1. [✓] Write unit tests
#   2. [○] Read documentation
\`\`\``,
      javascript: `\`\`\`javascript
// Todo List Manager
class TodoList {
  constructor() {
    this.tasks = [];
  }

  add(text) {
    this.tasks.push({ text, done: false });
    console.log(\\\`Added: \\\${text}\\\`);
  }

  remove(index) {
    if (index >= 0 && index < this.tasks.length) {
      const [removed] = this.tasks.splice(index, 1);
      console.log(\\\`Removed: \\\${removed.text}\\\`);
    }
  }

  complete(index) {
    if (index >= 0 && index < this.tasks.length) {
      this.tasks[index].done = true;
    }
  }

  show() {
    if (!this.tasks.length) { console.log('No tasks yet!'); return; }
    this.tasks.forEach((t, i) => {
      const status = t.done ? '✓' : '○';
      console.log(\\\`  \\\${i}. [\\\${status}] \\\${t.text}\\\`);
    });
  }
}

// Usage
const todo = new TodoList();
todo.add('Buy groceries');
todo.add('Write unit tests');
todo.add('Read documentation');
todo.complete(1);
todo.show();
\`\`\``,
      java: `\`\`\`java
import java.util.ArrayList;

public class TodoList {
    private ArrayList<String[]> tasks = new ArrayList<>();

    public void add(String text) {
        tasks.add(new String[]{text, "false"});
        System.out.println("Added: " + text);
    }

    public void remove(int index) {
        if (index >= 0 && index < tasks.size()) {
            String[] removed = tasks.remove(index);
            System.out.println("Removed: " + removed[0]);
        }
    }

    public void complete(int index) {
        if (index >= 0 && index < tasks.size()) {
            tasks.get(index)[1] = "true";
        }
    }

    public void show() {
        for (int i = 0; i < tasks.size(); i++) {
            String status = tasks.get(i)[1].equals("true") ? "✓" : "○";
            System.out.println("  " + i + ". [" + status + "] " + tasks.get(i)[0]);
        }
    }

    public static void main(String[] args) {
        TodoList todo = new TodoList();
        todo.add("Buy groceries");
        todo.add("Write unit tests");
        todo.complete(1);
        todo.show();
    }
}
\`\`\``,
    };
    const code = templates[lang] || templates['python'];
    return `Here's a **todo list** in **${lang}**:\n\n${code}\n\nFeatures: add tasks, remove by index, mark complete, and display with status icons.`;
  }

export function generateCounter(lang: string): string {
    if (lang === 'react' || lang === 'jsx' || lang === 'tsx' || lang === 'javascript' || lang === 'typescript') {
      return `Here's a **counter component** in **React**:

\`\`\`jsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ textAlign: 'center', padding: '2rem' }}>
      <h1>Counter: {count}</h1>
      <button onClick={() => setCount(c => c - 1)}>-</button>
      <button onClick={() => setCount(0)} style={{ margin: '0 1rem' }}>
        Reset
      </button>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}

export default Counter;
\`\`\`

Uses \`useState\` for state management with increment, decrement, and reset controls.`;
    }
    // Fallback for other langs — simple CLI counter
    return `Here's a **counter** in **${lang}**:

\`\`\`${lang}
# Simple counter
count = 0

def increment():
    global count
    count += 1
    return count

def decrement():
    global count
    count -= 1
    return count

def reset():
    global count
    count = 0
    return count

print(increment())  # 1
print(increment())  # 2
print(decrement())  # 1
print(reset())      # 0
\`\`\``;
  }

export function generateFizzBuzz(lang: string): string {
    const templates: Record<string, string> = {
      javascript: `\`\`\`javascript
function fizzBuzz(n) {
  const result = [];
  for (let i = 1; i <= n; i++) {
    if (i % 15 === 0) result.push('FizzBuzz');
    else if (i % 3 === 0) result.push('Fizz');
    else if (i % 5 === 0) result.push('Buzz');
    else result.push(i.toString());
  }
  return result;
}

// Print FizzBuzz from 1 to 20
fizzBuzz(20).forEach(item => console.log(item));
\`\`\``,
      python: `\`\`\`python
def fizz_buzz(n):
    result = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            result.append("FizzBuzz")
        elif i % 3 == 0:
            result.append("Fizz")
        elif i % 5 == 0:
            result.append("Buzz")
        else:
            result.append(str(i))
    return result

# Print FizzBuzz from 1 to 20
for item in fizz_buzz(20):
    print(item)
\`\`\``,
      java: `\`\`\`java
public class FizzBuzz {
    public static String[] fizzBuzz(int n) {
        String[] result = new String[n];
        for (int i = 1; i <= n; i++) {
            if (i % 15 == 0) result[i-1] = "FizzBuzz";
            else if (i % 3 == 0) result[i-1] = "Fizz";
            else if (i % 5 == 0) result[i-1] = "Buzz";
            else result[i-1] = String.valueOf(i);
        }
        return result;
    }

    public static void main(String[] args) {
        for (String item : fizzBuzz(20)) {
            System.out.println(item);
        }
    }
}
\`\`\``,
    };
    const code = templates[lang] || templates['javascript'];
    return `Here's **FizzBuzz** in **${lang}**:\n\n${code}\n\nClassic FizzBuzz: prints "Fizz" for multiples of 3, "Buzz" for multiples of 5, "FizzBuzz" for both, and the number otherwise.`;
  }

export function generateHttpServer(lang: string): string {
    const templates: Record<string, string> = {
      python: `\`\`\`python
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

class MyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<h1>Hello from Python HTTP Server!</h1>')
        elif self.path == '/api/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not Found')

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        data = json.loads(body) if body else {}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"received": data}).encode())

server = HTTPServer(('localhost', 8080), MyHandler)
print('Server running on http://localhost:8080')
server.serve_forever()
\`\`\``,
      javascript: `\`\`\`javascript
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Hello from Node.js HTTP Server!</h1>');
  } else if (req.url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const data = JSON.parse(body || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: data }));
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(8080, () => {
  console.log('Server running on http://localhost:8080');
});
\`\`\``,
    };
    const code = templates[lang] || templates['python'];
    return `Here's a **simple HTTP server** in **${lang}**:\n\n${code}\n\nHandles GET routes for / and /api/status, plus a POST endpoint that echoes back received JSON data.`;
  }

export function generateLinkedList(lang: string): string {
    const templates: Record<string, string> = {
      java: `\`\`\`java
public class LinkedList<T> {
    private static class Node<T> {
        T data;
        Node<T> next;
        Node(T data) { this.data = data; this.next = null; }
    }

    private Node<T> head;
    private int size;

    public LinkedList() { head = null; size = 0; }

    public void insertFirst(T data) {
        Node<T> node = new Node<>(data);
        node.next = head;
        head = node;
        size++;
    }

    public void insertLast(T data) {
        Node<T> node = new Node<>(data);
        if (head == null) { head = node; }
        else {
            Node<T> curr = head;
            while (curr.next != null) curr = curr.next;
            curr.next = node;
        }
        size++;
    }

    public T deleteFirst() {
        if (head == null) throw new RuntimeException("List is empty");
        T data = head.data;
        head = head.next;
        size--;
        return data;
    }

    public boolean contains(T data) {
        Node<T> curr = head;
        while (curr != null) {
            if (curr.data.equals(data)) return true;
            curr = curr.next;
        }
        return false;
    }

    public int size() { return size; }

    public void print() {
        Node<T> curr = head;
        while (curr != null) {
            System.out.print(curr.data + " -> ");
            curr = curr.next;
        }
        System.out.println("null");
    }

    public static void main(String[] args) {
        LinkedList<Integer> list = new LinkedList<>();
        list.insertLast(1);
        list.insertLast(2);
        list.insertLast(3);
        list.insertFirst(0);
        list.print();             // 0 -> 1 -> 2 -> 3 -> null
        list.deleteFirst();
        list.print();             // 1 -> 2 -> 3 -> null
        System.out.println("Contains 2: " + list.contains(2));
        System.out.println("Size: " + list.size());
    }
}
\`\`\``,
      python: `\`\`\`python
class Node:
    def __init__(self, data):
        self.data = data
        self.next = None

class LinkedList:
    def __init__(self):
        self.head = None
        self._size = 0

    def insert_first(self, data):
        node = Node(data)
        node.next = self.head
        self.head = node
        self._size += 1

    def insert_last(self, data):
        node = Node(data)
        if not self.head:
            self.head = node
        else:
            curr = self.head
            while curr.next:
                curr = curr.next
            curr.next = node
        self._size += 1

    def delete_first(self):
        if not self.head:
            raise IndexError("List is empty")
        data = self.head.data
        self.head = self.head.next
        self._size -= 1
        return data

    def contains(self, data):
        curr = self.head
        while curr:
            if curr.data == data:
                return True
            curr = curr.next
        return False

    def size(self):
        return self._size

    def __str__(self):
        items = []
        curr = self.head
        while curr:
            items.append(str(curr.data))
            curr = curr.next
        return " -> ".join(items) + " -> None"

# Usage
ll = LinkedList()
ll.insert_last(1)
ll.insert_last(2)
ll.insert_last(3)
ll.insert_first(0)
print(ll)                  # 0 -> 1 -> 2 -> 3 -> None
ll.delete_first()
print(ll)                  # 1 -> 2 -> 3 -> None
print(f"Contains 2: {ll.contains(2)}")
print(f"Size: {ll.size()}")
\`\`\``,
      javascript: `\`\`\`javascript
class Node {
  constructor(data) {
    this.data = data;
    this.next = null;
  }
}

class LinkedList {
  constructor() {
    this.head = null;
    this._size = 0;
  }

  insertFirst(data) {
    const node = new Node(data);
    node.next = this.head;
    this.head = node;
    this._size++;
  }

  insertLast(data) {
    const node = new Node(data);
    if (!this.head) { this.head = node; }
    else {
      let curr = this.head;
      while (curr.next) curr = curr.next;
      curr.next = node;
    }
    this._size++;
  }

  deleteFirst() {
    if (!this.head) throw new Error('List is empty');
    const data = this.head.data;
    this.head = this.head.next;
    this._size--;
    return data;
  }

  contains(data) {
    let curr = this.head;
    while (curr) {
      if (curr.data === data) return true;
      curr = curr.next;
    }
    return false;
  }

  size() { return this._size; }

  toString() {
    const items = [];
    let curr = this.head;
    while (curr) { items.push(curr.data); curr = curr.next; }
    return items.join(' -> ') + ' -> null';
  }
}

// Usage
const list = new LinkedList();
list.insertLast(1);
list.insertLast(2);
list.insertLast(3);
list.insertFirst(0);
console.log(list.toString());    // 0 -> 1 -> 2 -> 3 -> null
list.deleteFirst();
console.log(list.toString());    // 1 -> 2 -> 3 -> null
console.log('Contains 2:', list.contains(2));
console.log('Size:', list.size());
\`\`\``,
    };
    const code = templates[lang] || templates['java'];
    return `Here's a **linked list** implementation in **${lang}**:\n\n${code}\n\nA singly linked list with insert (first/last), delete, contains, size, and print operations.`;
  }

export function generateGuessingGame(lang: string): string {
    if (lang === 'python') {
      return `Here's a **number guessing game** in **Python**:

\`\`\`python
import random

def guessing_game():
    number = random.randint(1, 100)
    attempts = 0

    print("I'm thinking of a number between 1 and 100!")

    while True:
        guess = int(input("Your guess: "))
        attempts += 1

        if guess < number:
            print("Too low!")
        elif guess > number:
            print("Too high!")
        else:
            print(f"Correct! You got it in {attempts} attempts!")
            break

guessing_game()
\`\`\`

Classic number guessing with too-high / too-low hints and attempt counter.`;
    }
    return `Here's a **number guessing game** in **JavaScript**:

\`\`\`javascript
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const number = Math.floor(Math.random() * 100) + 1;
let attempts = 0;

console.log("I'm thinking of a number between 1 and 100!");

function ask() {
  rl.question('Your guess: ', (answer) => {
    const guess = parseInt(answer);
    attempts++;
    if (guess < number) { console.log('Too low!'); ask(); }
    else if (guess > number) { console.log('Too high!'); ask(); }
    else { console.log(\\\`Correct! You got it in \\\${attempts} attempts!\\\`); rl.close(); }
  });
}
ask();
\`\`\`

Classic number guessing game with hints and attempt tracking.`;
  }

export function generateHelloWorld(lang: string): string {
    const examples: Record<string, string> = {
      javascript: '```javascript\nconsole.log("Hello, World!");\n```',
      typescript: '```typescript\nconsole.log("Hello, World!");\n```',
      python: '```python\nprint("Hello, World!")\n```',
      java: '```java\npublic class HelloWorld {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n```',
      rust: '```rust\nfn main() {\n    println!("Hello, World!");\n}\n```',
      golang: '```go\npackage main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, World!")\n}\n```',
      c: '```c\n#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}\n```',
      cpp: '```cpp\n#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n```',
      csharp: '```csharp\nusing System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello, World!");\n    }\n}\n```',
      ruby: '```ruby\nputs "Hello, World!"\n```',
      php: '```php\n<?php\necho "Hello, World!\\n";\n```',
      swift: '```swift\nprint("Hello, World!")\n```',
      kotlin: '```kotlin\nfun main() {\n    println("Hello, World!")\n}\n```',
      html: '```html\n<!DOCTYPE html>\n<html>\n<head><title>Hello</title></head>\n<body>\n    <h1>Hello, World!</h1>\n</body>\n</html>\n```',
      elixir: '```elixir\nIO.puts("Hello, World!")\n```',
      lua: '```lua\nprint("Hello, World!")\n```',
      dart: '```dart\nvoid main() {\n  print("Hello, World!");\n}\n```',
      bash: '```bash\necho "Hello, World!"\n```',
      sql: '```sql\nSELECT \'Hello, World!\';\n```',
      css: '```css\nbody::after {\n  content: "Hello, World!";\n}\n```',
    };
    const code = examples[lang] || examples.javascript;
    return `Here's Hello World in **${lang}**:\n\n${code}`;
  }

export function generateSumFunction(lang: string): string {
    const examples: Record<string, string> = {
      javascript: '```javascript\nfunction sum(a, b) {\n  return a + b;\n}\n\n// Usage:\nconsole.log(sum(3, 5)); // 8\n```',
      typescript: '```typescript\nfunction sum(a: number, b: number): number {\n  return a + b;\n}\n\n// Usage:\nconsole.log(sum(3, 5)); // 8\n```',
      python: '```python\ndef sum_numbers(a, b):\n    return a + b\n\n# Usage:\nprint(sum_numbers(3, 5))  # 8\n```',
      java: '```java\npublic static int sum(int a, int b) {\n    return a + b;\n}\n```',
      rust: '```rust\nfn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n```',
      golang: '```go\nfunc sum(a, b int) int {\n    return a + b\n}\n```',
      elixir: '```elixir\ndef sum(a, b), do: a + b\n```',
    };
    const code = examples[lang] || examples.javascript;
    return `Here's a sum function in **${lang}**:\n\n${code}`;
  }

export function generateGenericFunction(lang: string, description: string, isExample = false): string {
    // If it's a generic "how to make a function" request, show a proper example
    if (isExample) {
      const examples: Record<string, string> = {
        javascript: '```javascript\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n\n// Usage:\nconsole.log(greet("World")); // "Hello, World!"\n```',
        typescript: '```typescript\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\n// Usage:\nconsole.log(greet("World")); // "Hello, World!"\n```',
        python: '```python\ndef greet(name):\n    return f"Hello, {name}!"\n\n# Usage:\nprint(greet("World"))  # Hello, World!\n```',
        java: '```java\npublic static String greet(String name) {\n    return "Hello, " + name + "!";\n}\n```',
        rust: '```rust\nfn greet(name: &str) -> String {\n    format!("Hello, {}!", name)\n}\n```',
        golang: '```go\nfunc greet(name string) string {\n    return fmt.Sprintf("Hello, %s!", name)\n}\n```',
        csharp: '```csharp\nstatic string Greet(string name) {\n    return $"Hello, {name}!";\n}\n```',
        c: '```c\nvoid greet(const char* name) {\n    printf("Hello, %s!\\n", name);\n}\n```',
        cpp: '```cpp\nstd::string greet(const std::string& name) {\n    return "Hello, " + name + "!";\n}\n```',
      };
      const code = examples[lang] || examples.javascript;
      return `Here's how to write a function in **${lang}**:\n\n${code}`;
    }

    const templates: Record<string, (name: string, desc: string) => string> = {
      javascript: (name, desc) => `\`\`\`javascript\n/**\n * ${desc}\n */\nfunction ${name}(/* params */) {\n  // TODO: implement ${desc}\n}\n\`\`\``,
      typescript: (name, desc) => `\`\`\`typescript\n/**\n * ${desc}\n */\nfunction ${name}(/* params */): void {\n  // TODO: implement ${desc}\n}\n\`\`\``,
      python: (name, desc) => `\`\`\`python\ndef ${name}():\n    """${desc}"""\n    # TODO: implement\n    pass\n\`\`\``,
    };

    // Generate a function name from description
    const name = description.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).slice(0, 3)
      .map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join('');

    const gen = templates[lang] || templates.javascript;
    return `Here's a function template for "${description}" in **${lang}**:\n\n${gen(name || 'myFunction', description)}`;
  }

export function generateStructCode(lang: string, name: string, _input: string): string {
    switch (lang) {
      case 'rust':
        return `Here's a Rust struct **${name}**:\n\n\`\`\`rust\n#[derive(Debug, Clone, PartialEq)]\npub struct ${name} {\n    pub id: u64,\n    pub name: String,\n    pub active: bool,\n}\n\nimpl ${name} {\n    pub fn new(id: u64, name: &str) -> Self {\n        Self { id, name: name.to_string(), active: true }\n    }\n}\n\`\`\``;
      case 'c':
        return `Here's a C struct **${name}**:\n\n\`\`\`c\n#include <stdint.h>\n#include <stdbool.h>\n\ntypedef struct {\n    uint64_t id;\n    char name[256];\n    bool active;\n} ${name};\n\nvoid ${name}_init(${name}* self, uint64_t id, const char* name) {\n    self->id = id;\n    strncpy(self->name, name, sizeof(self->name) - 1);\n    self->name[sizeof(self->name) - 1] = '\\0';\n    self->active = true;\n}\n\`\`\``;
      case 'cpp':
        return `Here's a C++ struct **${name}**:\n\n\`\`\`cpp\n#include <string>\n#include <cstdint>\n\nstruct ${name} {\n    uint64_t id;\n    std::string name;\n    bool active = true;\n\n    ${name}(uint64_t id, const std::string& name)\n        : id(id), name(name) {}\n};\n\`\`\``;
      case 'go':
        return `Here's a Go struct **${name}**:\n\n\`\`\`go\ntype ${name} struct {\n\tID     uint64\n\tName   string\n\tActive bool\n}\n\nfunc New${name}(id uint64, name string) ${name} {\n\treturn ${name}{ID: id, Name: name, Active: true}\n}\n\`\`\``;
      default:
        return `Structs work best in Rust, C, C++, or Go. Try specifying one of those languages.`;
    }
  }

export function generateInterfaceCode(lang: string, name: string, _input: string): string {
    switch (lang) {
      case 'typescript':
        return `Here's a TypeScript interface **${name}**:\n\n\`\`\`typescript\ninterface ${name} {\n  id: string;\n  name: string;\n  createdAt: Date;\n  isActive(): boolean;\n}\n\`\`\``;
      case 'go':
        return `Here's a Go interface **${name}**:\n\n\`\`\`go\ntype ${name} interface {\n\tGetID() string\n\tGetName() string\n\tIsActive() bool\n}\n\`\`\``;
      case 'java':
        return `Here's a Java interface **${name}**:\n\n\`\`\`java\npublic interface ${name} {\n    String getId();\n    String getName();\n    boolean isActive();\n}\n\`\`\``;
      default:
        return `Interfaces work best in TypeScript, Go, or Java. Try specifying one of those languages.`;
    }
  }
