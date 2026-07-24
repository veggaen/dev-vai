/**
 * Deterministic owner control plane for the self-improvement corpus.
 *
 * Historical fixes/proposals stay immutable evidence. This module projects repeated
 * observations into stable work items and keeps decisions in an append-only ledger plus
 * one current-state row. It never applies source changes.
 */
import { createHash } from 'node:crypto';
import { analyzeRoiTrend } from './compute-roi.mjs';
import { LOOP_DEFAULTS } from './loop-config.mjs';

export const ADOPTION_STATUSES = Object.freeze(['backlog', 'in-review', 'approved', 'rejected', 'shipped']);
export const ADOPTION_RISKS = Object.freeze(['low', 'medium', 'high', 'critical']);

const STATUS_PRIORITY = Object.freeze({ approved: 5, 'in-review': 4, backlog: 3, rejected: 1, shipped: 0 });
const SOURCE_RE = /(?:^|[\s("'`])((?:[a-zA-Z]:)?[^:\s"'`]+?\.(?:tsx?|jsx?|mjs|cjs|rs))(?:[:#](\d+))?/i;
const SPACE_RE = /\s+/g;
const SHA_RE = /^[a-f0-9]{7,40}$/i;

const text = (value, limit = LOOP_DEFAULTS.adoptionTextLimit) =>
  String(value ?? '').replace(SPACE_RE, ' ').trim().slice(0, limit);
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const tableExists = (db, table) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
const allIfTable = (db, table, sql, ...args) => tableExists(db, table) ? db.prepare(sql).all(...args) : [];
const oneIfTable = (db, table, sql, ...args) => tableExists(db, table) ? db.prepare(sql).get(...args) : null;

function normalizeTarget(location, summary) {
  const raw = text(location || summary, 500).replaceAll('\\', '/');
  const match = SOURCE_RE.exec(raw);
  if (match) {
    const path = match[1].replace(/^[\s("'`]+/, '').toLowerCase();
    return match[2] ? `${path}:${match[2]}` : path;
  }
  return `summary:${text(summary, 240).toLowerCase()
    .replace(/\b\d+\b/g, '#').replace(/[^a-z0-9/_#.-]+/g, ' ').trim()}`;
}

export function adoptionFingerprint(fix = {}) {
  const klass = text(fix.class || 'unknown', 160).toLowerCase();
  const target = normalizeTarget(fix.location, fix.summary);
  return createHash('sha256').update(`${klass}|${target}`).digest('hex').slice(0, 24);
}

export function ensureAdoptionTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS improvement_adoptions (
      fingerprint TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'backlog',
      assignee TEXT,
      risk TEXT,
      expires_at TEXT,
      decision_reason TEXT,
      rollback TEXT,
      evidence TEXT,
      commit_sha TEXT,
      compute_round_id INTEGER,
      quality_before REAL,
      quality_after REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS improvement_adoption_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_improvement_adoption_events_fingerprint
      ON improvement_adoption_events(fingerprint, id);
  `);
}

function computeRows(db) {
  return allIfTable(db, 'compute_log',
    'SELECT id,model_calls,wall_ms,proposals,qualified,adopted,created_at FROM compute_log ORDER BY id ASC');
}

export function deriveGenerationPolicy(db) {
  const rounds = computeRows(db);
  const roi = analyzeRoiTrend(rounds.map((row) => ({
    modelCalls: row.model_calls,
    wallMs: row.wall_ms,
    proposals: row.proposals,
    qualified: row.qualified,
    adopted: row.adopted,
  })));
  const shipped = tableExists(db, 'improvement_adoptions')
    ? number(db.prepare("SELECT COUNT(*) AS n FROM improvement_adoptions WHERE status='shipped'").get()?.n)
    : 0;
  const minimumShipments = LOOP_DEFAULTS.adoptionResumeShipments;
  const hasAdoptionBacklog = roi.totalQualified > 0;
  const positiveCredit = roi.totalRealized > 0;
  const paused = hasAdoptionBacklog && (shipped < minimumShipments || !positiveCredit);
  return {
    state: paused ? 'paused' : 'active',
    paused,
    reason: paused
      ? `${roi.totalQualified} qualified proposals await adoption; ship ${Math.max(0, minimumShipments - shipped)} more with measured evidence before generating more.`
      : `Generation is available: ${shipped}/${minimumShipments} governed shipments and ${roi.totalRealized} credited adoption(s).`,
    minimumShipments,
    shipped,
    roi: {
      state: roi.state,
      realizedPerUnit: roi.cumulativeRoi,
      potentialPerUnit: roi.cumulativePotentialRoi,
      realized: roi.totalRealized,
      qualified: roi.totalQualified,
      compute: roi.totalCompute,
    },
  };
}

function proposalCounts(db) {
  const byFix = new Map();
  let open = 0;
  let rejected = 0;
  for (const row of allIfTable(db, 'proposals',
    'SELECT fix_id,status FROM proposals ORDER BY id ASC')) {
    const status = text(row.status, 120).toLowerCase();
    const entry = byFix.get(Number(row.fix_id)) ?? { open: 0, rejected: 0, accepted: 0 };
    if (status === 'proposed' || status === 'queued') { entry.open += 1; open += 1; }
    else if (status.includes('rejected')) { entry.rejected += 1; rejected += 1; }
    else if (status.includes('applied') || status.includes('accepted') || status.includes('committed')) entry.accepted += 1;
    byFix.set(Number(row.fix_id), entry);
  }
  return { byFix, open, rejected };
}

function scoreItem(item, nowMs) {
  const recency = Number.isFinite(Date.parse(item.latestObservedAt))
    ? Math.max(0, 1 - ((nowMs - Date.parse(item.latestObservedAt)) / (365 * 86_400_000)))
    : 0;
  return Math.round((
    Math.min(40, Math.log2(1 + item.failureCount) * 8)
    + Math.min(25, Math.log2(1 + item.observationCount) * 7)
    + Math.min(15, item.proposals.open * 3)
    + Math.min(8, item.proposals.accepted * 4)
    + (item.targetKnown ? 8 : 0)
    + recency * 4
    + (STATUS_PRIORITY[item.status] ?? 0)
    - Math.min(18, item.proposals.rejected * 2)
  ) * 10) / 10;
}

export function buildAdoptionBoard(db, { limit = LOOP_DEFAULTS.adoptionBoardLimit, now = new Date() } = {}) {
  const safeLimit = Math.max(1, Math.min(LOOP_DEFAULTS.adoptionBoardLimit, Math.floor(number(limit) || 1)));
  const fixes = allIfTable(db, 'fixes',
    "SELECT id,class,failure_count,location,summary,status,created_at FROM fixes WHERE status='queued' ORDER BY id ASC");
  const { byFix, open, rejected } = proposalCounts(db);
  const current = new Map(allIfTable(db, 'improvement_adoptions',
    'SELECT * FROM improvement_adoptions ORDER BY fingerprint ASC').map((row) => [row.fingerprint, row]));
  const grouped = new Map();

  for (const fix of fixes) {
    const fingerprint = adoptionFingerprint(fix);
    const proposal = byFix.get(Number(fix.id)) ?? { open: 0, rejected: 0, accepted: 0 };
    const found = grouped.get(fingerprint);
    if (!found) {
      grouped.set(fingerprint, {
        fingerprint,
        class: text(fix.class, 160) || 'unknown',
        title: text(fix.summary, 240) || `Improve ${text(fix.class, 160) || 'unknown'}`,
        target: normalizeTarget(fix.location, fix.summary),
        targetKnown: SOURCE_RE.test(text(fix.location, 500)),
        observationCount: 1,
        failureCount: number(fix.failure_count),
        firstObservedAt: text(fix.created_at, 64),
        latestObservedAt: text(fix.created_at, 64),
        sourceFixIds: [number(fix.id)],
        proposals: { ...proposal },
      });
      continue;
    }
    found.observationCount += 1;
    found.failureCount += number(fix.failure_count);
    found.latestObservedAt = String(fix.created_at) > found.latestObservedAt ? text(fix.created_at, 64) : found.latestObservedAt;
    found.firstObservedAt = String(fix.created_at) < found.firstObservedAt ? text(fix.created_at, 64) : found.firstObservedAt;
    found.sourceFixIds.push(number(fix.id));
    found.proposals.open += proposal.open;
    found.proposals.rejected += proposal.rejected;
    found.proposals.accepted += proposal.accepted;
  }

  const items = [...grouped.values()].map((item) => {
    const decision = current.get(item.fingerprint);
    const merged = {
      ...item,
      status: decision?.status ?? 'backlog',
      assignee: decision?.assignee ?? null,
      risk: decision?.risk ?? null,
      expiresAt: decision?.expires_at ?? null,
      decisionReason: decision?.decision_reason ? text(decision.decision_reason) : null,
      rollback: decision?.rollback ? text(decision.rollback) : null,
      evidence: decision?.evidence ? text(decision.evidence) : null,
      commitSha: decision?.commit_sha ?? null,
      computeRoundId: decision?.compute_round_id ?? null,
      qualityBefore: decision?.quality_before ?? null,
      qualityAfter: decision?.quality_after ?? null,
      updatedAt: decision?.updated_at ?? null,
    };
    return { ...merged, score: scoreItem(merged, now.getTime()) };
  }).sort((a, b) => b.score - a.score || a.fingerprint.localeCompare(b.fingerprint))
    .slice(0, safeLimit);

  const policy = deriveGenerationPolicy(db);
  return {
    schemaVersion: 1,
    capturedAt: now.toISOString(),
    available: true,
    source: 'self-improve:corpus',
    stats: {
      rawQueuedFixes: fixes.length,
      deduplicatedItems: grouped.size,
      duplicatesCollapsed: Math.max(0, fixes.length - grouped.size),
      openProposals: open,
      rejectedProposals: rejected,
      shipped: policy.shipped,
    },
    generation: policy,
    items,
  };
}

const TRANSITIONS = Object.freeze({
  backlog: new Set(['in-review', 'approved', 'rejected']),
  'in-review': new Set(['backlog', 'approved', 'rejected']),
  approved: new Set(['in-review', 'rejected', 'shipped']),
  rejected: new Set(['in-review']),
  shipped: new Set(),
});

function required(value, label, min = 1) {
  const out = text(value);
  if (out.length < min) throw new Error(`${label} is required`);
  return out;
}

function sourceForFingerprint(db, fingerprint) {
  for (const fix of allIfTable(db, 'fixes',
    "SELECT class,location,summary FROM fixes WHERE status='queued' ORDER BY id ASC")) {
    if (adoptionFingerprint(fix) === fingerprint) {
      return {
        title: text(fix.summary, 240) || `Improve ${text(fix.class, 160) || 'unknown'}`,
        class: text(fix.class, 160) || 'unknown',
      };
    }
  }
  return null;
}

export function recordAdoptionDecision(db, fingerprint, input = {}, { now = new Date() } = {}) {
  ensureAdoptionTables(db);
  const fp = text(fingerprint, 80);
  const item = sourceForFingerprint(db, fp);
  if (!item) throw new Error('unknown adoption fingerprint');
  const prior = db.prepare('SELECT * FROM improvement_adoptions WHERE fingerprint=?').get(fp);
  const fromStatus = prior?.status ?? 'backlog';
  const toStatus = text(input.status, 40);
  if (!ADOPTION_STATUSES.includes(toStatus)) throw new Error(`invalid adoption status: ${toStatus}`);
  if (!TRANSITIONS[fromStatus]?.has(toStatus)) throw new Error(`invalid adoption transition: ${fromStatus} -> ${toStatus}`);

  const merged = {
    assignee: input.assignee === undefined ? prior?.assignee ?? null : text(input.assignee, 160) || null,
    risk: input.risk === undefined ? prior?.risk ?? null : text(input.risk, 40) || null,
    expiresAt: input.expiresAt === undefined ? prior?.expires_at ?? null : text(input.expiresAt, 64) || null,
    reason: input.reason === undefined ? prior?.decision_reason ?? null : text(input.reason) || null,
    rollback: input.rollback === undefined ? prior?.rollback ?? null : text(input.rollback) || null,
    evidence: input.evidence === undefined ? prior?.evidence ?? null : text(input.evidence) || null,
    commitSha: input.commitSha === undefined ? prior?.commit_sha ?? null : text(input.commitSha, 40) || null,
    computeRoundId: input.computeRoundId === undefined ? prior?.compute_round_id ?? null : number(input.computeRoundId),
    qualityBefore: input.qualityBefore === undefined ? prior?.quality_before ?? null : number(input.qualityBefore),
    qualityAfter: input.qualityAfter === undefined ? prior?.quality_after ?? null : number(input.qualityAfter),
  };

  if (toStatus === 'rejected') required(merged.reason, 'rejection reason', 8);
  if (toStatus === 'approved') {
    required(merged.reason, 'approval reason', 8);
    required(merged.assignee, 'assignee');
    if (!ADOPTION_RISKS.includes(merged.risk)) throw new Error('risk must be low, medium, high, or critical');
    if (!merged.expiresAt || !Number.isFinite(Date.parse(merged.expiresAt)) || Date.parse(merged.expiresAt) <= now.getTime()) {
      throw new Error('approval expiry must be a future ISO timestamp');
    }
    required(merged.rollback, 'rollback plan', 8);
  }
  if (toStatus === 'shipped') {
    if (!SHA_RE.test(merged.commitSha ?? '')) throw new Error('shipment requires a 7-40 character hexadecimal commit SHA');
    required(merged.evidence, 'shipment evidence', 8);
    if (!Number.isInteger(merged.computeRoundId) || merged.computeRoundId <= 0
      || !oneIfTable(db, 'compute_log', 'SELECT id FROM compute_log WHERE id=?', merged.computeRoundId)) {
      throw new Error('shipment requires an existing compute round');
    }
    if (!(Number.isFinite(merged.qualityBefore) && Number.isFinite(merged.qualityAfter)
      && merged.qualityAfter > merged.qualityBefore)) {
      throw new Error('shipment requires a positive measured quality delta');
    }
  }

  const at = now.toISOString();
  const payload = JSON.stringify({ ...merged, title: item.title, class: item.class });
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO improvement_adoptions (
        fingerprint,status,assignee,risk,expires_at,decision_reason,rollback,evidence,
        commit_sha,compute_round_id,quality_before,quality_after,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        status=excluded.status,assignee=excluded.assignee,risk=excluded.risk,
        expires_at=excluded.expires_at,decision_reason=excluded.decision_reason,
        rollback=excluded.rollback,evidence=excluded.evidence,commit_sha=excluded.commit_sha,
        compute_round_id=excluded.compute_round_id,quality_before=excluded.quality_before,
        quality_after=excluded.quality_after,updated_at=excluded.updated_at
    `).run(fp, toStatus, merged.assignee, merged.risk, merged.expiresAt, merged.reason,
      merged.rollback, merged.evidence, merged.commitSha, merged.computeRoundId,
      merged.qualityBefore, merged.qualityAfter, prior?.created_at ?? at, at);
    db.prepare(`
      INSERT INTO improvement_adoption_events (fingerprint,from_status,to_status,payload,created_at)
      VALUES (?,?,?,?,?)
    `).run(fp, fromStatus, toStatus, payload, at);
    if (toStatus === 'shipped') {
      const credited = db.prepare('UPDATE compute_log SET adopted=adopted+1 WHERE id=?').run(merged.computeRoundId);
      if (!credited.changes) throw new Error('compute attribution failed');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return {
    fingerprint: fp,
    title: item.title,
    class: item.class,
    status: toStatus,
    assignee: merged.assignee,
    risk: merged.risk,
    expiresAt: merged.expiresAt,
    decisionReason: merged.reason,
    rollback: merged.rollback,
    evidence: merged.evidence,
    commitSha: merged.commitSha,
    computeRoundId: merged.computeRoundId,
    qualityBefore: merged.qualityBefore,
    qualityAfter: merged.qualityAfter,
    updatedAt: at,
  };
}

export function adoptionEvents(db, fingerprint) {
  if (!tableExists(db, 'improvement_adoption_events')) return [];
  return db.prepare(`
    SELECT id,fingerprint,from_status AS fromStatus,to_status AS toStatus,payload,created_at AS createdAt
    FROM improvement_adoption_events WHERE fingerprint=? ORDER BY id ASC
  `).all(fingerprint).map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}

export function validateAdoptionBoard(value) {
  if (!value || value.schemaVersion !== 1 || value.available !== true || !Array.isArray(value.items)) {
    throw new Error('invalid adoption board');
  }
  if (value.items.length > LOOP_DEFAULTS.adoptionBoardLimit) throw new Error('adoption board exceeds item limit');
  for (const item of value.items) {
    if (!/^[a-f0-9]{24}$/.test(item.fingerprint) || !ADOPTION_STATUSES.includes(item.status)) {
      throw new Error('invalid adoption board item');
    }
  }
  return value;
}

export function formatAdoptionBoard(board) {
  const g = board.generation;
  const lines = [
    `Adoption: ${board.stats.rawQueuedFixes} observations -> ${board.stats.deduplicatedItems} work items (${board.stats.duplicatesCollapsed} duplicates collapsed)`,
    `Generation: ${g.state.toUpperCase()} - ${g.reason}`,
    `Compute ROI: ${g.roi.realizedPerUnit}/unit realized; ${g.roi.potentialPerUnit}/unit potential; ${g.roi.realized} shipped / ${g.roi.qualified} qualified over ${g.roi.compute} compute`,
  ];
  for (const [index, item] of board.items.slice(0, 8).entries()) {
    lines.push(`${index + 1}. [${item.status}] ${item.title} (${item.class}) - score ${item.score}, ${item.observationCount} observations - ${item.fingerprint}`);
  }
  return lines.join('\n');
}
