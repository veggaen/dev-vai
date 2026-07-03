import type { FastifyInstance } from 'fastify';
import type { ChatService } from '@vai/core';
import type { PlatformAuthService } from '../auth/platform-auth.js';

/**
 * Knowledge-graph route — Vai's "second brain" map.
 *
 * Deterministic core (Thorsen rule: the inspectable engine decides first): every
 * conversation/project becomes a node; edges are computed with plain TF-IDF cosine
 * similarity over titles + transcripts. No model, no network, reproducible for a
 * given corpus — an embeddings provider can later REPLACE tfidfVectors() behind the
 * same interface as an optional accelerator, never as a requirement.
 *
 * Pure math is exported for unit tests; the route is a thin authorized wrapper.
 */

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: 'chat' | 'project';
  /** Connected-component id — the UI colors clusters with this. */
  readonly cluster: number;
  /** Relative importance (degree-weighted), for node sizing. */
  readonly weight: number;
  readonly updatedAt?: string;
}

export interface GraphEdge {
  readonly source: string;
  readonly target: string;
  /** Cosine similarity in [0,1]. */
  readonly weight: number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of',
  'in', 'on', 'for', 'with', 'at', 'by', 'from', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'we', 'they', 'me', 'my', 'your', 'so', 'do', 'does', 'did', 'can',
  'could', 'should', 'would', 'will', 'just', 'not', 'no', 'yes', 'if', 'then', 'than', 'as',
  'what', 'when', 'how', 'why', 'which', 'who', 'all', 'also', 'into', 'about', 'up', 'out',
  'new', 'like', 'want', 'need', 'make', 'use', 'get', 'please', 'thanks', 'ok', 'okay',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && t.length < 30 && !STOPWORDS.has(t));
}

/** TF-IDF vectors as sparse maps. Deterministic for a given doc list. */
export function tfidfVectors(docs: readonly string[]): Map<string, number>[] {
  const termDocFreq = new Map<string, number>();
  const docTokens = docs.map((d) => {
    const counts = new Map<string, number>();
    for (const tok of tokenize(d)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
    for (const term of counts.keys()) termDocFreq.set(term, (termDocFreq.get(term) ?? 0) + 1);
    return counts;
  });
  const n = docs.length;
  return docTokens.map((counts) => {
    const vec = new Map<string, number>();
    for (const [term, tf] of counts) {
      const df = termDocFreq.get(term) ?? 1;
      // Skip terms in nearly every doc — they say nothing about RELATION.
      if (df / n > 0.85) continue;
      vec.set(term, (1 + Math.log(tf)) * Math.log(1 + n / df));
    }
    return vec;
  });
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, val] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += val * other;
  }
  if (dot === 0) return 0;
  let na = 0; for (const v of a.values()) na += v * v;
  let nb = 0; for (const v of b.values()) nb += v * v;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Union-find for cluster labeling (connected components over kept edges). */
function components(count: number, edges: readonly { a: number; b: number }[]): number[] {
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const { a, b } of edges) parent[find(a)] = find(b);
  const roots = new Map<number, number>();
  return parent.map((_, i) => {
    const r = find(i);
    if (!roots.has(r)) roots.set(r, roots.size);
    return roots.get(r)!;
  });
}

export interface GraphSourceDoc {
  readonly id: string;
  readonly label: string;
  readonly kind: GraphNode['kind'];
  readonly text: string;
  readonly updatedAt?: string;
}

/** Build the graph: TF-IDF cosine edges (threshold + per-node cap) → clustered nodes. */
export function buildKnowledgeGraph(
  docs: readonly GraphSourceDoc[],
  opts: { threshold?: number; maxEdgesPerNode?: number } = {},
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const threshold = opts.threshold ?? 0.12;
  const maxPer = opts.maxEdgesPerNode ?? 4;
  const vectors = tfidfVectors(docs.map((d) => `${d.label}\n${d.label}\n${d.text}`));

  // All candidate pairs above threshold, strongest first.
  const candidates: { a: number; b: number; weight: number }[] = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const w = cosine(vectors[i], vectors[j]);
      if (w >= threshold) candidates.push({ a: i, b: j, weight: w });
    }
  }
  candidates.sort((x, y) => y.weight - x.weight);

  // Cap per-node degree so hubs don't turn the map into a hairball.
  const degree = new Array<number>(docs.length).fill(0);
  const kept: typeof candidates = [];
  for (const c of candidates) {
    if (degree[c.a] >= maxPer || degree[c.b] >= maxPer) continue;
    degree[c.a]++; degree[c.b]++;
    kept.push(c);
  }

  const clusters = components(docs.length, kept);
  const nodes = docs.map((d, i): GraphNode => ({
    id: d.id,
    label: d.label,
    kind: d.kind,
    cluster: clusters[i],
    weight: 1 + degree[i],
    updatedAt: d.updatedAt,
  }));
  const edges = kept.map((c): GraphEdge => ({
    source: docs[c.a].id,
    target: docs[c.b].id,
    weight: Number(c.weight.toFixed(3)),
  }));
  return { nodes, edges };
}

export interface KnowledgeGraphDeps {
  readonly chatService: ChatService;
  readonly auth: PlatformAuthService;
}

export function registerKnowledgeGraphRoutes(app: FastifyInstance, deps: KnowledgeGraphDeps): void {
  app.get('/api/graph/knowledge', async (request, reply) => {
    const viewer = await deps.auth.getViewer(request);
    const authEnabled = typeof deps.auth.isEnabled === 'function' ? deps.auth.isEnabled() : true;
    if (authEnabled && !viewer.authenticated) {
      return { nodes: [], edges: [], generatedAt: new Date().toISOString() };
    }
    const userId = viewer.user?.id ?? null;

    const conversations = deps.chatService.listConversations(200, 0, userId);
    if (!Array.isArray(conversations) || conversations.length === 0) {
      return { nodes: [], edges: [], generatedAt: new Date().toISOString() };
    }

    const docs: GraphSourceDoc[] = conversations.map((c) => {
      let text = '';
      try {
        const msgs = deps.chatService.getMessages(c.id) as Array<{ content?: string }>;
        // First + last slices carry the intent and the outcome; middle is noise at scale.
        const joined = msgs.map((m) => m.content ?? '').join('\n');
        text = joined.length > 6000 ? joined.slice(0, 3000) + joined.slice(-3000) : joined;
      } catch { /* messages unavailable → title-only node */ }
      return {
        id: c.id,
        label: c.title ?? 'Untitled',
        kind: c.sandboxProjectId ? 'project' as const : 'chat' as const,
        text,
        updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
      };
    });

    reply.header('cache-control', 'no-store');
    return { ...buildKnowledgeGraph(docs), generatedAt: new Date().toISOString() };
  });
}
