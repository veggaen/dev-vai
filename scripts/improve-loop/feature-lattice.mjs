/**
 * feature-lattice — the environment for BUILD-UP features (a feature that builds on other features).
 *
 * The capability engine already emits `buildsOn` on each proposal (the titles of the earlier
 * proposals it extends). That dependency data existed but nothing consumed it — so a "synthesis"
 * feature could be approved without its prerequisites (a roof with no walls). This module turns the
 * flat proposal list into a DEPENDENCY DAG and answers the questions review needs:
 *
 *   - topoOrder      → the correct BUILD ORDER (prerequisites before dependents).
 *   - leverage(id)   → how much downstream line a feature unlocks (V3gga: a legitimacy SIGNAL that
 *                      raises confidence; a standalone high-impact feature is still valid).
 *   - readiness(id)  → buildable | blocked | terminal | cycle.
 *   - bundleFor(id)  → a feature PLUS its not-yet-built prerequisites, in build order = ONE
 *                      approvable package (V3gga: "if a feature requires two features, it's a bulk
 *                      package that gets approved").
 *
 * Pure + O(V+E). The lattice IS the knowledge (structure, not a data store) — the caller feeds it
 * proposals from the capabilities table and gets back an analyzable graph. No model, no I/O.
 */

/**
 * Build the lattice from proposals. Each proposal: { id, title, impact, status, buildsOn }.
 *  - `buildsOn` is a string ("A; B") or array of prerequisite TITLES (as the engine emits).
 *  - `status`: 'built'/'integrated'/'committed' ⇒ already built; anything else ⇒ still proposed.
 * Resolves buildsOn titles → node ids (case/space-insensitive), drops references that don't resolve
 * to a known proposal (a phantom prereq must not create a fake edge), and detects cycles.
 * Returns { nodes: Map<id,node>, edges, cycles }.
 */
export function buildLattice(proposals = []) {
  const nodes = new Map();
  for (const p of proposals) {
    const id = String(p.id ?? p.title);
    nodes.set(id, {
      id,
      title: String(p.title ?? id),
      impact: Number(p.impact ?? 0),
      built: isBuilt(p.status),
      dependsOn: [], // resolved node ids
      enables: [],   // reverse edges
      rawBuildsOn: normalizeBuildsOn(p.buildsOn),
    });
  }
  // Resolve buildsOn titles → ids (by normalized title match).
  const byTitle = new Map();
  for (const n of nodes.values()) byTitle.set(normTitle(n.title), n.id);
  for (const n of nodes.values()) {
    for (const dep of n.rawBuildsOn) {
      const depId = byTitle.get(normTitle(dep));
      if (depId && depId !== n.id && !n.dependsOn.includes(depId)) {
        n.dependsOn.push(depId);
        nodes.get(depId).enables.push(n.id);
      }
    }
  }
  const cycles = findCycles(nodes);
  return { nodes, cycles };
}

/** Build order: prerequisites before dependents; higher impact first among independents (Kahn). */
export function topoOrder(lattice) {
  const { nodes } = lattice;
  const indeg = new Map();
  for (const n of nodes.values()) indeg.set(n.id, n.dependsOn.length);
  // Ready set = indegree 0, ordered by impact desc (build the highest-impact buildable first).
  const ready = [...nodes.values()].filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order = [];
  const inCycle = new Set(lattice.cycles.flat());
  while (ready.length) {
    ready.sort((a, b) => nodes.get(b).impact - nodes.get(a).impact);
    const id = ready.shift();
    order.push(id);
    for (const next of nodes.get(id).enables) {
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0) ready.push(next);
    }
  }
  // Any node never emitted is inside a cycle (unbuildable) — append it flagged, don't drop silently.
  for (const n of nodes.values()) if (!order.includes(n.id)) inCycle.add(n.id);
  return { order, unbuildable: [...inCycle] };
}

/**
 * Leverage of a node = the total number of features it unlocks downstream (transitive enables),
 * so an enabling feature that many others build on scores high. Standalone/terminal = 0 (valid —
 * leverage RAISES confidence, it never disqualifies). Memoized within the call. Pure.
 */
export function leverage(lattice, id, _seen = new Set()) {
  const node = lattice.nodes.get(id);
  if (!node) return 0;
  let count = 0;
  for (const child of node.enables) {
    if (_seen.has(child)) continue;
    _seen.add(child);
    count += 1 + leverage(lattice, child, _seen);
  }
  return count;
}

/**
 * Readiness of a node:
 *   - 'cycle'    → it's in an unbuildable dependency cycle.
 *   - 'terminal' → no prerequisites (standalone; valid on its own impact).
 *   - 'buildable'→ every prerequisite is already built.
 *   - 'blocked'  → at least one prerequisite is NOT built yet.
 */
export function readiness(lattice, id) {
  if (lattice.cycles.some((c) => c.includes(id))) return 'cycle';
  const node = lattice.nodes.get(id);
  if (!node) return 'terminal';
  if (node.dependsOn.length === 0) return 'terminal';
  const missing = node.dependsOn.filter((d) => !lattice.nodes.get(d)?.built);
  return missing.length === 0 ? 'buildable' : 'blocked';
}

/**
 * The BUNDLE for a feature: the feature PLUS all its not-yet-built prerequisites (transitive), in
 * build order — ONE approvable package (V3gga's "bulk package"). A terminal feature bundles to just
 * itself. Returns { rootId, order:[ids], titles:[...], blocked:boolean, cycle:boolean }.
 * `blocked` stays false for a resolvable bundle (all prereqs are IN the bundle); it's true only if a
 * prerequisite is missing from the proposal set entirely (can't be bundled).
 */
export function bundleFor(lattice, id) {
  if (readiness(lattice, id) === 'cycle') {
    return { rootId: id, order: [id], titles: [titleOf(lattice, id)], blocked: false, cycle: true };
  }
  // Collect the transitive set of UNBUILT prerequisites (+ the root) via DFS.
  const needed = new Set();
  const visit = (nid) => {
    const n = lattice.nodes.get(nid);
    if (!n || needed.has(nid)) return;
    for (const dep of n.dependsOn) {
      const d = lattice.nodes.get(dep);
      if (d && !d.built) visit(dep); // only pull in UNBUILT prereqs (built ones are done)
    }
    needed.add(nid);
  };
  visit(id);
  // Order the bundle by the global topo order (prereqs first).
  const globalOrder = topoOrder(lattice).order;
  const order = globalOrder.filter((nid) => needed.has(nid));
  // A prerequisite that isn't a known node at all (phantom) → the root is blocked/unbundleable.
  const root = lattice.nodes.get(id);
  const phantomMissing = root
    ? root.rawBuildsOn.some((t) => !lattice.nodes.get(idForTitle(lattice, t)) && !root.dependsOn.length)
    : false;
  return {
    rootId: id,
    order,
    titles: order.map((nid) => titleOf(lattice, nid)),
    blocked: phantomMissing,
    cycle: false,
    size: order.length,
  };
}

/**
 * The highest-leverage BUILDABLE feature — the best next move that respects dependencies. Skips
 * blocked (needs unbuilt prereqs) and cycle nodes; among buildable+terminal, ranks by leverage then
 * impact (a high-leverage enabling feature beats an equally-impactful isolated one). Null when
 * nothing is buildable (roadmap exhausted or everything blocked). Respects the standalone-valid rule:
 * a terminal high-impact feature competes fairly.
 */
export function nextBestFeature(lattice) {
  const candidates = [...lattice.nodes.values()]
    .filter((n) => !n.built)
    .filter((n) => ['buildable', 'terminal'].includes(readiness(lattice, n.id)))
    .map((n) => ({ id: n.id, title: n.title, impact: n.impact, leverage: leverage(lattice, n.id) }));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.leverage - a.leverage || b.impact - a.impact);
  return candidates[0];
}

/** Analyze the WHOLE lattice for a review surface: each unbuilt node with readiness + leverage +
 *  its bundle. Sorted best-first (leverage, then impact). Plus any cycles to flag. */
export function analyzeLattice(lattice) {
  const items = [...lattice.nodes.values()]
    .filter((n) => !n.built)
    .map((n) => ({
      id: n.id,
      title: n.title,
      impact: n.impact,
      readiness: readiness(lattice, n.id),
      leverage: leverage(lattice, n.id),
      bundle: bundleFor(lattice, n.id),
    }))
    .sort((a, b) => b.leverage - a.leverage || b.impact - a.impact);
  return { items, cycles: lattice.cycles.map((c) => c.map((id) => titleOf(lattice, id))) };
}

// ── internals ────────────────────────────────────────────────────────────────────
function isBuilt(status) {
  return /^(built|integrated|committed|done|adopted|shipped)$/i.test(String(status ?? ''));
}
function normalizeBuildsOn(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (raw == null || raw === '') return [];
  return String(raw).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}
function normTitle(t) { return String(t).toLowerCase().replace(/\s+/g, ' ').trim(); }
function titleOf(lattice, id) { return lattice.nodes.get(id)?.title ?? id; }
function idForTitle(lattice, title) {
  const target = normTitle(title);
  for (const n of lattice.nodes.values()) if (normTitle(n.title) === target) return n.id;
  return null;
}

/** Find dependency cycles (DFS with a recursion stack). Returns arrays of node ids, one per cycle. */
function findCycles(nodes) {
  const WHITE = 0; const GRAY = 1; const BLACK = 2;
  const color = new Map([...nodes.keys()].map((k) => [k, WHITE]));
  const stack = [];
  const cycles = [];
  const seenCycle = new Set();
  const dfs = (id) => {
    color.set(id, GRAY);
    stack.push(id);
    for (const dep of nodes.get(id).dependsOn) {
      if (!nodes.has(dep)) continue;
      if (color.get(dep) === GRAY) {
        // Found a back-edge → extract the cycle from the stack.
        const start = stack.indexOf(dep);
        const cycle = stack.slice(start);
        const key = [...cycle].sort().join('|');
        if (!seenCycle.has(key)) { seenCycle.add(key); cycles.push(cycle); }
      } else if (color.get(dep) === WHITE) {
        dfs(dep);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };
  for (const id of nodes.keys()) if (color.get(id) === WHITE) dfs(id);
  return cycles;
}
