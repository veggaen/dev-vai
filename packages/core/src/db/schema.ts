import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import type { ConversationMode } from '../chat/modes.js';

// ---- Platform Auth ----

export const platformUsers = sqliteTable('platform_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp' }),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  emailUnique: uniqueIndex('idx_platform_users_email_unique').on(table.email),
}));

export const platformAccounts = sqliteTable('platform_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => platformUsers.id),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  scope: text('scope'),
  tokenType: text('token_type'),
  tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp' }),
  rawProfile: text('raw_profile'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  providerAccountUnique: uniqueIndex('idx_platform_accounts_provider_unique').on(table.provider, table.providerAccountId),
  userIdx: index('idx_platform_accounts_user').on(table.userId),
}));

/**
 * Per-user encrypted-at-rest-optional secrets — currently the user's own
 * bring-your-own transcription (STT) API key. Keyed by (userId, name) so a user
 * can store several kinds of secret. `userId` is the platform user id when
 * signed in, or the sentinel 'local' for the local single-user desktop.
 *
 * DATA OWNERSHIP: this row is the user's own data. It is removed when the user
 * clears the key themselves (DELETE /api/stt/key) and MUST be purged when the
 * account is deleted — see deleteUserSecrets() in the runtime.
 */
export const platformUserSecrets = sqliteTable('platform_user_secrets', {
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  value: text('value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.name] }),
}));

export const platformSessions = sqliteTable('platform_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => platformUsers.id),
  tokenHash: text('token_hash').notNull(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  tokenUnique: uniqueIndex('idx_platform_sessions_token_unique').on(table.tokenHash),
  userIdx: index('idx_platform_sessions_user').on(table.userId),
}));

export const platformOauthStates = sqliteTable('platform_oauth_states', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  state: text('state').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  returnTo: text('return_to').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  stateUnique: uniqueIndex('idx_platform_oauth_states_state_unique').on(table.state),
  providerIdx: index('idx_platform_oauth_states_provider').on(table.provider),
}));

export const platformLoginHandoffs = sqliteTable('platform_login_handoffs', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull(),
  userId: text('user_id').notNull().references(() => platformUsers.id),
  targetOrigin: text('target_origin').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  codeUnique: uniqueIndex('idx_platform_login_handoffs_code_unique').on(table.codeHash),
  userIdx: index('idx_platform_login_handoffs_user').on(table.userId),
}));

export const platformDeviceCodes = sqliteTable('platform_device_codes', {
  id: text('id').primaryKey(),
  deviceCode: text('device_code').notNull(),
  userCode: text('user_code').notNull(),
  clientName: text('client_name').notNull(),
  clientType: text('client_type').notNull(),
  installationKey: text('installation_key'),
  launchTarget: text('launch_target'),
  capabilities: text('capabilities'),
  status: text('status').notNull().default('pending'),
  approvedByUserId: text('approved_by_user_id').references(() => platformUsers.id),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  lastPolledAt: integer('last_polled_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  deviceCodeUnique: uniqueIndex('idx_platform_device_codes_device_unique').on(table.deviceCode),
  userCodeUnique: uniqueIndex('idx_platform_device_codes_user_unique').on(table.userCode),
  statusIdx: index('idx_platform_device_codes_status').on(table.status),
}));

export const platformCompanionClients = sqliteTable('platform_companion_clients', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => platformUsers.id),
  installationKey: text('installation_key').notNull(),
  clientName: text('client_name').notNull(),
  clientType: text('client_type').notNull(),
  launchTarget: text('launch_target').notNull(),
  capabilities: text('capabilities'),
  availableModels: text('available_models'), // JSON: [{ id, family, name, vendor }]
  availableChatInfo: text('available_chat_info'), // JSON: { chatApps: [{id, label}], sessions: [{sessionId, title, lastModified, chatApp}] }
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  lastPolledAt: integer('last_polled_at', { mode: 'timestamp' }),
  createdViaDeviceCodeId: text('created_via_device_code_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  installationKeyUnique: uniqueIndex('idx_platform_companion_clients_installation_unique').on(table.installationKey),
  userIdx: index('idx_platform_companion_clients_user').on(table.userId),
  userLaunchTargetIdx: index('idx_platform_companion_clients_user_target').on(table.userId, table.launchTarget),
}));

export const platformProjects = sqliteTable('platform_projects', {
  id: text('id').primaryKey(),
  sandboxProjectId: text('sandbox_project_id').notNull(),
  ownerUserId: text('owner_user_id').references(() => platformUsers.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  rootDir: text('root_dir').notNull(),
  status: text('status').notNull().default('idle'),
  visibility: text('visibility').notNull().default('private'),
  lastOpenedAt: integer('last_opened_at', { mode: 'timestamp' }),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  sandboxUnique: uniqueIndex('idx_platform_projects_sandbox_unique').on(table.sandboxProjectId),
  ownerIdx: index('idx_platform_projects_owner').on(table.ownerUserId),
  slugIdx: index('idx_platform_projects_slug').on(table.slug),
}));

export const platformProjectMembers = sqliteTable('platform_project_members', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => platformProjects.id),
  userId: text('user_id').notNull().references(() => platformUsers.id),
  role: text('role').notNull(),
  invitedByUserId: text('invited_by_user_id').references(() => platformUsers.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectUserUnique: uniqueIndex('idx_platform_project_members_unique').on(table.projectId, table.userId),
  projectIdx: index('idx_platform_project_members_project').on(table.projectId),
  userIdx: index('idx_platform_project_members_user').on(table.userId),
}));

export const platformProjectShareLinks = sqliteTable('platform_project_share_links', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => platformProjects.id),
  tokenHash: text('token_hash').notNull(),
  role: text('role').notNull(),
  maxUses: integer('max_uses').notNull().default(1),
  useCount: integer('use_count').notNull().default(0),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  createdByUserId: text('created_by_user_id').references(() => platformUsers.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  tokenUnique: uniqueIndex('idx_platform_project_share_links_token_unique').on(table.tokenHash),
  projectIdx: index('idx_platform_project_share_links_project').on(table.projectId),
}));

export const platformProjectHandoffIntents = sqliteTable('platform_project_handoff_intents', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => platformProjects.id),
  tokenHash: text('token_hash').notNull(),
  target: text('target').notNull(),
  status: text('status').notNull().default('pending'),
  createdByUserId: text('created_by_user_id').references(() => platformUsers.id),
  claimedByUserId: text('claimed_by_user_id').references(() => platformUsers.id),
  clientInfo: text('client_info'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  claimedAt: integer('claimed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  tokenUnique: uniqueIndex('idx_platform_project_handoff_token_unique').on(table.tokenHash),
  projectIdx: index('idx_platform_project_handoff_project').on(table.projectId),
  targetStatusIdx: index('idx_platform_project_handoff_target_status').on(table.target, table.status),
}));

export const platformProjectPeers = sqliteTable('platform_project_peers', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => platformProjects.id),
  peerKey: text('peer_key').notNull(),
  displayName: text('display_name').notNull(),
  ide: text('ide').notNull(),
  model: text('model').notNull(),
  status: text('status').notNull().default('idle'),
  launchTarget: text('launch_target').notNull(),
  preferredClientId: text('preferred_client_id').references(() => platformCompanionClients.id),
  instructions: text('instructions'),
  createdByUserId: text('created_by_user_id').references(() => platformUsers.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectPeerUnique: uniqueIndex('idx_platform_project_peers_unique').on(table.projectId, table.peerKey),
  projectIdx: index('idx_platform_project_peers_project').on(table.projectId),
}));

export const platformProjectAuditRequests = sqliteTable('platform_project_audit_requests', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => platformProjects.id),
  createdByUserId: text('created_by_user_id').references(() => platformUsers.id),
  prompt: text('prompt').notNull(),
  scope: text('scope').notNull().default('project'),
  status: text('status').notNull().default('pending'),
  consensusSummary: text('consensus_summary'),
  winningPeerKey: text('winning_peer_key'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdx: index('idx_platform_project_audit_requests_project').on(table.projectId),
  statusIdx: index('idx_platform_project_audit_requests_status').on(table.status),
}));

export const platformProjectAuditResults = sqliteTable('platform_project_audit_results', {
  id: text('id').primaryKey(),
  auditRequestId: text('audit_request_id').notNull().references(() => platformProjectAuditRequests.id),
  projectId: text('project_id').notNull().references(() => platformProjects.id),
  peerKey: text('peer_key').notNull(),
  status: text('status').notNull().default('pending'),
  claimedByUserId: text('claimed_by_user_id').references(() => platformUsers.id),
  claimedByClientId: text('claimed_by_client_id').references(() => platformCompanionClients.id),
  claimedAt: integer('claimed_at', { mode: 'timestamp' }),
  claimExpiresAt: integer('claim_expires_at', { mode: 'timestamp' }),
  verdict: text('verdict'),
  confidence: integer('confidence'),
  rationale: text('rationale'),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  auditPeerUnique: uniqueIndex('idx_platform_project_audit_results_unique').on(table.auditRequestId, table.peerKey),
  projectIdx: index('idx_platform_project_audit_results_project').on(table.projectId),
  auditIdx: index('idx_platform_project_audit_results_audit').on(table.auditRequestId),
}));

// ---- Chat ----

/**
 * Vai Memory — durable, TYPED, user-governed facts extracted from conversations.
 * The re-architected "knowledge graph": instead of untyped word-overlap edges,
 * each row is an inspectable memory card with provenance (the chat it came from),
 * so it can be surfaced into new work, edited, or deleted. Retrieval is selective
 * (never dumped into every prompt) to avoid context rot.
 */
export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  /** Source conversation for provenance (nullable if manually added). */
  conversationId: text('conversation_id'),
  kind: text('kind', { enum: ['decision', 'project', 'preference', 'fact'] }).notNull(),
  /** The memory itself, one concise statement. */
  content: text('content').notNull(),
  /** A short verbatim quote from the source, so the user can verify it. */
  sourceExcerpt: text('source_excerpt'),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  userIdx: index('idx_memories_user').on(table.userId),
  convIdx: index('idx_memories_conversation').on(table.conversationId),
}));

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  modelId: text('model_id').notNull(),
  ownerUserId: text('owner_user_id'),
  sandboxProjectId: text('sandbox_project_id'),
  /** Absolute local folder this chat works in (desktop attach) — server-persisted
      so ANY client opening the chat re-attaches the same workspace. */
  workspaceRoot: text('workspace_root'),
  mode: text('mode', { enum: ['chat', 'agent', 'builder', 'plan', 'debate'] }).$type<ConversationMode>().notNull().default('chat'),
  visibility: text('visibility', { enum: ['private', 'unlisted', 'public'] }).notNull().default('private'),
  shareSlug: text('share_slug'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/**
 * A durable task artifact for Council edits that were useful but not safe to
 * apply yet. This is the shared handoff between models and later chat turns:
 * exact proposed files plus validation/review evidence, not hidden reasoning.
 */
export const councilWorkArtifacts = sqliteTable('council_work_artifacts', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  sandboxProjectId: text('sandbox_project_id'),
  projectName: text('project_name').notNull(),
  brief: text('brief').notNull(),
  files: text('files').notNull(),
  validation: text('validation').notNull(),
  reviews: text('reviews').notNull(),
  repairsUsed: integer('repairs_used').notNull().default(0),
  memberIds: text('member_ids').notNull(),
  status: text('status', { enum: ['pending', 'applied', 'superseded'] }).notNull().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  conversationStatusIdx: index('idx_council_work_artifacts_conversation_status').on(table.conversationId, table.status, table.updatedAt),
  sandboxStatusIdx: index('idx_council_work_artifacts_sandbox_status').on(table.sandboxProjectId, table.status),
}));

// ---- Images / Training Data ----

export const images = sqliteTable('images', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').references(() => conversations.id),
  sourceId: text('source_id').references(() => sources.id),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  data: text('data').notNull(), // base64 encoded
  description: text('description').notNull(), // human-provided fact/description (required)
  question: text('question'), // optional question about the image
  width: integer('width'),
  height: integer('height'),
  sizeBytes: integer('size_bytes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ---- Chat Messages ----

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id),
  role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
  content: text('content').notNull(),
  imageId: text('image_id').references(() => images.id),
  toolCalls: text('tool_calls'),
  toolCallId: text('tool_call_id'),
  tokenCount: integer('token_count'),
  modelId: text('model_id'),
  durationMs: integer('duration_ms'),
  /** User feedback: 1 = helpful, 0 = not helpful, null = no feedback yet */
  feedback: integer('feedback'),
  /**
   * JSON snapshot of the DispatchPlan (steered + optional baseline/unsteered plan)
   * for this assistant turn. This is the primary reference data for later
   * calculating steering benefit (lift in score/choice/outcome) vs no-guidance,
   * per-actor efficacy, and signals for re-calibration (e.g. guidance that
   * no longer correlates with positive signals).
   */
  plan: text('plan'),
  /**
   * JSON snapshot of the PRUNED process trace (the progress steps + their council
   * notes / tool summaries / process-log entries) for an assistant turn. The live
   * trace is assembled on the client from streamed `progress` chunks and otherwise
   * exists only in memory; without this column the in-message ProcessTree collapses
   * to bare leaf rows after the app is closed and reopened (nothing left to expand).
   * Pruned of bulky raw fields and size-capped so vai.db does not bloat.
   */
  progressTrace: text('progress_trace'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ---- Steering / Multi-Actor Guidance (persistent friend + agent + robot steering) ----

/**
 * Persisted RouteGuidance records. Written when a human, AI agent, or robot
 * "steers" Vai by posting avoid/prefer hints on handlers for scopes.
 * These become the durable reference + the load source for future turns.
 * Analysis over these + linked message.plan data tells us if steering helped.
 */
export const routeGuidances = sqliteTable('route_guidances', {
  id: text('id').primaryKey(),
  /** Null = global steering (applies everywhere). */
  conversationId: text('conversation_id').references(() => conversations.id),
  from: text('from', { enum: ['human', 'ai'] }).notNull(),
  /** Display name or actor identifier (e.g. "claude-4", "robot-arm-01", "vegge"). */
  author: text('author'),
  signal: text('signal', { enum: ['avoid', 'prefer'] }).notNull(),
  handler: text('handler').notNull(),
  note: text('note'),
  scope: text('scope', { enum: ['class', 'conversation', 'global'] }).notNull(),
  /** JSON string of string[] for salient tokens (class scope matching). */
  matchTokens: text('match_tokens'),
  intent: text('intent'),
  weight: real('weight').notNull().default(1.0),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  /** The message/turn that prompted this steering action (for lineage + analysis). */
  originMessageId: text('origin_message_id').references(() => messages.id),
  /** How many turns this guidance has actually been applied to (reference metric). */
  appliedCount: integer('applied_count').notNull().default(0),
  lastAppliedAt: integer('last_applied_at', { mode: 'timestamp' }),
}, (table) => ({
  convoIdx: index('idx_route_guidances_convo').on(table.conversationId),
  activeScopeIdx: index('idx_route_guidances_active_scope').on(table.active, table.scope),
  createdIdx: index('idx_route_guidances_created').on(table.createdAt),
}));

// ---- Source Ingestion ----

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  sourceType: text('source_type', { enum: ['web', 'youtube', 'file'] }).notNull(),
  url: text('url'),
  title: text('title').notNull(),
  capturedAt: integer('captured_at', { mode: 'timestamp' }).notNull(),
  qualityScore: real('quality_score'),
  lastValidated: integer('last_validated', { mode: 'timestamp' }),
  meta: text('meta'),
});

export const chunks = sqliteTable('chunks', {
  id: text('id').primaryKey(),
  sourceId: text('source_id')
    .notNull()
    .references(() => sources.id),
  level: integer('level').notNull(),
  ordinal: integer('ordinal').notNull(),
  content: text('content').notNull(),
  meta: text('meta'),
});

// ---- VCUS Taught Knowledge ----

export const taughtEntries = sqliteTable('taught_entries', {
  id: text('id').primaryKey(),
  pattern: text('pattern').notNull(),
  response: text('response').notNull(),
  source: text('source').notNull().default('vcus-teaching'),
  language: text('language').notNull().default('en'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ---- VCUS Eval ----

export const evalRuns = sqliteTable('eval_runs', {
  id: text('id').primaryKey(),
  modelId: text('model_id').notNull(),
  track: text('track', {
    enum: ['comprehension', 'casual', 'creative', 'complex', 'navigation', 'bugfix', 'feature', 'thorsen', 'gym', 'cognitive'],
  }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
  config: text('config'),
});

export const evalScores = sqliteTable('eval_scores', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => evalRuns.id),
  taskId: text('task_id').notNull(),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  score: real('score'),
  attempts: integer('attempts').notNull(),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  wallTime: integer('wall_time'),
  detail: text('detail'),
});

// ---- Broadcast Messages (IDE Orchestra) ----

export const platformBroadcastMessages = sqliteTable('platform_broadcast_messages', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => platformProjects.id),
  senderUserId: text('sender_user_id').notNull().references(() => platformUsers.id),
  content: text('content').notNull(),
  meta: text('meta'), // JSON: { preferredModel?: string }
  targetMode: text('target_mode').notNull().default('all'), // 'all' | 'selected'
  targetClientIds: text('target_client_ids'), // JSON array of companion client IDs (null = all)
  status: text('status').notNull().default('pending'), // 'pending' | 'partial' | 'completed' | 'expired'
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  projectIdx: index('idx_platform_broadcast_messages_project').on(table.projectId),
  senderIdx: index('idx_platform_broadcast_messages_sender').on(table.senderUserId),
  statusIdx: index('idx_platform_broadcast_messages_status').on(table.status),
}));

export const platformBroadcastDeliveries = sqliteTable('platform_broadcast_deliveries', {
  id: text('id').primaryKey(),
  broadcastId: text('broadcast_id').notNull().references(() => platformBroadcastMessages.id),
  targetClientId: text('target_client_id').notNull().references(() => platformCompanionClients.id),
  status: text('status').notNull().default('pending'), // 'pending' | 'claimed' | 'responded' | 'expired'
  claimedAt: integer('claimed_at', { mode: 'timestamp' }),
  respondedAt: integer('responded_at', { mode: 'timestamp' }),
  responseContent: text('response_content'),
  responseMeta: text('response_meta'), // JSON: { model, tokensIn, tokensOut, durationMs }
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  broadcastIdx: index('idx_platform_broadcast_deliveries_broadcast').on(table.broadcastId),
  targetIdx: index('idx_platform_broadcast_deliveries_target').on(table.targetClientId),
  statusIdx: index('idx_platform_broadcast_deliveries_status').on(table.status),
  broadcastTargetUnique: uniqueIndex('idx_platform_broadcast_deliveries_unique').on(table.broadcastId, table.targetClientId),
}));

// ---- Session Scores (Cognitive Scorer) ----

export const sessionScores = sqliteTable('session_scores', {
  sessionId: text('session_id').primaryKey(),
  scores: text('scores').notNull(),          // JSON blob: ConversationScore
  scoredAt: integer('scored_at').notNull(),
  scorerVersion: text('scorer_version').notNull(),
  overallGrade: text('overall_grade').notNull(),
}, (table) => ({
  gradeIdx: index('idx_session_scores_grade').on(table.overallGrade),
  scoredAtIdx: index('idx_session_scores_scored_at').on(table.scoredAt),
}));

// ---- Cognitive Lessons (Learning Extractor) ----

export const cognitiveLessons = sqliteTable('cognitive_lessons', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  category: text('category').notNull(),      // 'breakthrough-question' | 'success-pattern' | 'anti-pattern' | 'reasoning-chain'
  summary: text('summary').notNull(),
  evidence: text('evidence').notNull(),
  turnPairIndices: text('turn_pair_indices').notNull(),   // JSON array of numbers
  foundationAlignment: text('foundation_alignment').notNull(), // JSON array of strings
  confidence: real('confidence').notNull(),
  extractedAt: integer('extracted_at').notNull(),
}, (table) => ({
  sessionIdx: index('idx_cognitive_lessons_session').on(table.sessionId),
  categoryIdx: index('idx_cognitive_lessons_category').on(table.category),
  confidenceIdx: index('idx_cognitive_lessons_confidence').on(table.confidence),
}));

// ---- Usage Tracking ----

export const retrievalQualityLog = sqliteTable('retrieval_quality_log', {
  id: text('id').primaryKey(),
  /** The search query that triggered this retrieval */
  query: text('query').notNull(),
  /** Number of results returned */
  resultCount: integer('result_count').notNull().default(0),
  /** Top-1 confidence score (0–1) */
  topScore: real('top_score').notNull().default(0),
  /** Average score across top-K results */
  avgScore: real('avg_score').notNull().default(0),
  /** Whether any result had score >= 0.5 (hit) */
  isHit: integer('is_hit', { mode: 'boolean' }).notNull().default(false),
  /** Source of this retrieval: 'chat' | 'search' | 'eval' */
  source: text('source').notNull().default('chat'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  createdAtIdx: index('retrieval_quality_log_created_at_idx').on(t.createdAt),
}));

// ---- Visual / Fact Grounding Log (Stage E — cross-check + vision learning data) ----

/**
 * One labeled outcome per cross-check / vision run. The dataset for tuning the corroboration
 * threshold + tolerance, measuring new-vs-old, and (later) fine-tuning Vai's visual inspection.
 * `errorType` is the taxonomy from the council review: it lets us bucket failure CLASSES rather
 * than just pass/fail. Append-only; never read on the hot path.
 */
export const visualGroundingLog = sqliteTable('visual_grounding_log', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').references(() => conversations.id),
  messageId: text('message_id').references(() => messages.id),
  prompt: text('prompt').notNull(),
  /** Resolved subject the claim was anchored to ("ETH"), or null. */
  subject: text('subject'),
  /** The numeric value the draft claimed, if any. */
  claimNumber: real('claim_number'),
  /** Median of the qualifying corroborating candidates, if computed. */
  evidenceMedian: real('evidence_median'),
  /** How many subject-anchored candidates corroborated/disagreed. */
  corroboration: integer('corroboration').notNull().default(0),
  /** 'confirm' | 'contradict' | 'inconclusive' | 'declined' */
  verdict: text('verdict').notNull(),
  /** Whether a vision adapter was used for this turn. */
  visionUsed: integer('vision_used', { mode: 'boolean' }).notNull().default(false),
  visionConfidence: real('vision_confidence'),
  /** Whether the answer was ultimately shipped (vs declined / redrafted). */
  shipped: integer('shipped', { mode: 'boolean' }).notNull().default(false),
  /**
   * Error class when the run represents a caught/avoided failure:
   * price_hallucination | image_claim_without_vision | fabricated_timestamp |
   * weak_source_confirmation | persistent_error_after_correction | null (clean).
   */
  errorType: text('error_type'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  createdAtIdx: index('visual_grounding_log_created_at_idx').on(t.createdAt),
  errorTypeIdx: index('visual_grounding_log_error_type_idx').on(t.errorType),
}));

export const usageRecords = sqliteTable('usage_records', {
  id: text('id').primaryKey(),
  modelId: text('model_id').notNull(),
  provider: text('provider').notNull(),
  conversationId: text('conversation_id').references(() => conversations.id),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  finishReason: text('finish_reason').notNull().default('stop'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const sandboxRevisions = sqliteTable('sandbox_revisions', {
  id: text('id').primaryKey(),
  sandboxProjectId: text('sandbox_project_id').notNull(),
  conversationId: text('conversation_id').references(() => conversations.id),
  messageId: text('message_id').references(() => messages.id),
  actorUserId: text('actor_user_id').references(() => platformUsers.id),
  baseVersion: integer('base_version').notNull(),
  version: integer('version').notNull(),
  summary: text('summary'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  sandboxIdx: index('idx_sandbox_revisions_sandbox').on(table.sandboxProjectId),
  createdAtIdx: index('idx_sandbox_revisions_created_at').on(table.createdAt),
}));

export const sandboxRevisionFiles = sqliteTable('sandbox_revision_files', {
  id: text('id').primaryKey(),
  revisionId: text('revision_id').notNull().references(() => sandboxRevisions.id),
  path: text('path').notNull(),
  changeType: text('change_type', { enum: ['create', 'update', 'delete'] }).notNull(),
  beforeContent: text('before_content'),
  afterContent: text('after_content'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  revisionIdx: index('idx_sandbox_revision_files_revision').on(table.revisionId),
}));
