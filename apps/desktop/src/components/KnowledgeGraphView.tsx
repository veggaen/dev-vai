/**
 * KnowledgeGraphView — Vai's second-brain map (Obsidian-style, Vai-native).
 *
 * A full-screen overlay rendering every chat/project as a living node in a
 * force-directed field. Edges come from the runtime's DETERMINISTIC TF-IDF
 * cosine core (/api/graph/knowledge) — reproducible relations first; embedding
 * models can upgrade the backend later without touching this view.
 *
 * Hand-rolled physics on a single <canvas> (repulsion + springs + gravity),
 * no graph library: ~40 lines of integration beats a dependency for this size,
 * stays 60fps, and keeps the bundle clean. Clusters share a hue; hover lights
 * a node's neighborhood; click opens the conversation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Waypoints, X } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { useChatStore } from '../stores/chatStore.js';
import { useLayoutStore } from '../stores/layoutStore.js';

interface ApiNode { id: string; label: string; kind: 'chat' | 'project'; cluster: number; weight: number }
interface ApiEdge { source: string; target: string; weight: number }

interface SimNode extends ApiNode { x: number; y: number; vx: number; vy: number; r: number }

const CLUSTER_HUES = [8, 262, 152, 200, 38, 320, 100, 178, 290, 58];

function clusterColor(cluster: number, alpha = 1): string {
  const hue = CLUSTER_HUES[cluster % CLUSTER_HUES.length];
  return `oklch(0.72 0.17 ${hue} / ${alpha})`;
}

export function KnowledgeGraphView() {
  const open = useLayoutStore((s) => s.showKnowledgeGraph);
  const toggle = useLayoutStore((s) => s.toggleKnowledgeGraph);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [counts, setCounts] = useState({ nodes: 0, edges: 0, clusters: 0 });
  const simRef = useRef<{ nodes: SimNode[]; edges: ApiEdge[]; byId: Map<string, SimNode> }>({ nodes: [], edges: [], byId: new Map() });
  const hoverRef = useRef<SimNode | null>(null);
  const dragRef = useRef<SimNode | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await apiFetch('/api/graph/knowledge');
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { nodes: ApiNode[]; edges: ApiEdge[] };
      if (!body.nodes.length) { setStatus('empty'); return; }
      const cx = (canvasRef.current?.clientWidth ?? 1200) / 2;
      const cy = (canvasRef.current?.clientHeight ?? 800) / 2;
      // Seed positions per cluster so related nodes are born near each other —
      // the simulation settles in ~1s instead of untangling from randomness.
      const nodes: SimNode[] = body.nodes.map((n, i) => {
        const clusterAngle = (n.cluster * 2.399963) % (Math.PI * 2); // golden angle
        const jitter = 60 + (i % 7) * 22;
        return {
          ...n,
          x: cx + Math.cos(clusterAngle) * 160 + Math.cos(i * 1.7) * jitter,
          y: cy + Math.sin(clusterAngle) * 160 + Math.sin(i * 2.3) * jitter,
          vx: 0, vy: 0,
          r: Math.min(4 + n.weight * 2.4, 16),
        };
      });
      simRef.current = { nodes, edges: body.edges, byId: new Map(nodes.map((n) => [n.id, n])) };
      setCounts({ nodes: nodes.length, edges: body.edges.length, clusters: new Set(nodes.map((n) => n.cluster)).size });
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { if (open) void load(); }, [open, load]);

  // Escape closes the overlay — the map should never trap the keyboard.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggle(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, toggle]);

  // Physics + paint loop. Runs only while the overlay is open.
  useEffect(() => {
    if (!open || status !== 'ready') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let alive = true;

    const step = () => {
      if (!alive) return;
      const { nodes, edges, byId } = simRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr; canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // ── forces ──
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        // Coulomb repulsion (softened, distance-capped for O(n²) sanity ≤ ~200 nodes)
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > 90_000) continue;
          if (d2 < 1) { d2 = 1; dx = 1; dy = 0; }
          const f = 900 / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
        // Gravity toward center
        a.vx += (w / 2 - a.x) * 0.0012;
        a.vy += (h / 2 - a.y) * 0.0012;
      }
      // Springs
      for (const e of edges) {
        const a = byId.get(e.source), b = byId.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(Math.hypot(dx, dy), 1);
        const rest = 120 - e.weight * 60;
        const f = (d - rest) * 0.004 * (0.5 + e.weight);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      // Integrate
      for (const n of nodes) {
        if (dragRef.current === n) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= 0.86; n.vy *= 0.86;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(24, Math.min(w - 24, n.x));
        n.y = Math.max(24, Math.min(h - 24, n.y));
      }

      // ── paint ──
      ctx.clearRect(0, 0, w, h);
      const hover = hoverRef.current;
      const neighborhood = new Set<string>();
      if (hover) {
        neighborhood.add(hover.id);
        for (const e of edges) {
          if (e.source === hover.id) neighborhood.add(e.target);
          if (e.target === hover.id) neighborhood.add(e.source);
        }
      }
      for (const e of edges) {
        const a = byId.get(e.source), b = byId.get(e.target);
        if (!a || !b) continue;
        const lit = hover && (e.source === hover.id || e.target === hover.id);
        ctx.strokeStyle = lit
          ? clusterColor(a.cluster, 0.75)
          : `oklch(0.72 0.05 20 / ${hover ? 0.05 : 0.10 + e.weight * 0.25})`;
        ctx.lineWidth = lit ? 1.6 : 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (const n of nodes) {
        const dimmed = hover !== null && !neighborhood.has(n.id);
        const alpha = dimmed ? 0.25 : 1;
        // soft halo
        const halo = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 3);
        halo.addColorStop(0, clusterColor(n.cluster, 0.28 * alpha));
        halo.addColorStop(1, 'transparent');
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 3, 0, Math.PI * 2); ctx.fill();
        // body
        ctx.fillStyle = clusterColor(n.cluster, alpha);
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
        // projects wear a ring — they carry code, not just words
        if (n.kind === 'project') {
          ctx.strokeStyle = clusterColor(n.cluster, 0.8 * alpha);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3.5, 0, Math.PI * 2); ctx.stroke();
        }
        // labels: hover neighborhood always; otherwise only weighty nodes
        if ((hover && neighborhood.has(n.id)) || (!hover && n.weight >= 3)) {
          ctx.font = '11px ui-monospace, monospace';
          ctx.fillStyle = `oklch(0.92 0.01 60 / ${dimmed ? 0.3 : 0.92})`;
          ctx.textAlign = 'center';
          const label = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
          ctx.fillText(label, n.x, n.y - n.r - 7);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [open, status]);

  // Pointer interaction: hover highlight, drag nodes, click to open the chat.
  const pick = (e: React.PointerEvent): SimNode | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best: SimNode | null = null; let bestD = 24;
    for (const n of simRef.current.nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD + n.r) { best = n; bestD = d; }
    }
    return best;
  };
  const movedRef = useRef(false);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="knowledge-graph"
        className="fixed inset-0 z-[80] flex flex-col bg-[color:var(--bg)]/95 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        role="dialog"
        aria-label="Knowledge graph"
      >
        <div className="flex items-center gap-3 px-5 pt-4">
          <Waypoints className="h-4 w-4 text-[color:var(--accent)]" />
          <span className="text-[13px] font-medium text-[color:var(--fg)]">Knowledge graph</span>
          <span className="text-[11px] tabular-nums text-[color:var(--chat-muted)]">
            {counts.nodes} nodes · {counts.edges} relations · {counts.clusters} clusters
          </span>
          <button
            type="button"
            onClick={() => { void load(); }}
            title="Recompute relations"
            aria-label="Recompute relations"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--chat-muted)] transition-colors hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${status === 'loading' ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={toggle}
            title="Close graph (Esc)"
            aria-label="Close knowledge graph"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--chat-muted)] transition-colors hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {status === 'loading' && (
          <div className="flex flex-1 items-center justify-center">
            <span className="vai-process-shimmer text-[12px]">Mapping relations…</span>
          </div>
        )}
        {status === 'empty' && (
          <div className="flex flex-1 items-center justify-center text-[12px] text-[color:var(--chat-muted)]">
            No conversations yet — the map draws itself as you and Vai work.
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-1 items-center justify-center text-[12px] text-[color:var(--chat-muted)]">
            Couldn't reach the graph service — is the runtime up?
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={`min-h-0 flex-1 ${status === 'ready' ? '' : 'hidden'} cursor-grab active:cursor-grabbing`}
          onPointerMove={(e) => {
            if (dragRef.current) {
              const rect = canvasRef.current!.getBoundingClientRect();
              dragRef.current.x = e.clientX - rect.left;
              dragRef.current.y = e.clientY - rect.top;
              movedRef.current = true;
              return;
            }
            hoverRef.current = pick(e);
          }}
          onPointerDown={(e) => { dragRef.current = pick(e); movedRef.current = false; }}
          onPointerUp={(e) => {
            const grabbed = dragRef.current;
            dragRef.current = null;
            if (grabbed && !movedRef.current) {
              toggle();
              void useChatStore.getState().selectConversation(grabbed.id);
            }
            e.preventDefault();
          }}
          onPointerLeave={() => { hoverRef.current = null; dragRef.current = null; }}
        />
        <p className="px-5 pb-3 text-[10.5px] text-[color:var(--chat-muted)]">
          Hover to light a neighborhood · drag to rearrange · click a node to open that chat · relations are Vai's own deterministic similarity core
        </p>
      </motion.div>
    </AnimatePresence>
  );
}

export default KnowledgeGraphView;
