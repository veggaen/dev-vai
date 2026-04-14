import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
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

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  modelId: text('model_id').notNull(),
  ownerUserId: text('owner_user_id'),
  sandboxProjectId: text('sandbox_project_id'),
  mode: text('mode', { enum: ['chat', 'agent', 'builder', 'plan', 'debate'] }).$type<ConversationMode>().notNull().default('chat'),
  visibility: text('visibility', { enum: ['private', 'unlisted', 'public'] }).notNull().default('private'),
  shareSlug: text('share_slug'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

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
