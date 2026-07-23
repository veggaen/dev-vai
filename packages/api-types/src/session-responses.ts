import { z } from 'zod';
import {
  agentSessionSchema,
  contextSummarySchema,
  conversationScoreSchema,
  learningReportSchema,
  pinnedNoteSchema,
  searchResultSchema,
  sessionAnalysisSchema,
  sessionEventSchema,
  sessionInsightsAggregateSchema,
} from './session-models.js';
import type {
  AgentSession,
  ContextSummary,
  ConversationScore,
  LearningReport,
  PinnedNote,
  SearchResult,
  SessionAnalysis,
  SessionEvent,
  SessionInsightsAggregate,
} from './session-models.js';

/**
 * Shared session response types.
 *
 * Import these as `import type` from desktop code so they stay compile-time only.
 */
export type SessionListResponse = {
  sessions: AgentSession[];
  total: number;
};

export type SessionContextResponse = ContextSummary;

export type SessionDetailResponse = {
  session: AgentSession;
  eventCount: number;
};

export type CreateSessionResponse = AgentSession;

export type ImportSessionResponse = {
  id: string;
  success: boolean;
};

export type SessionExportResponse = {
  session: AgentSession;
  events: SessionEvent[];
};

export type SessionEventListResponse = SessionEvent[];

export type SessionSearchResponse = {
  results: SearchResult[];
  total: number;
};

export type SessionPinnedEventsResponse = {
  events: SessionEvent[];
  total: number;
};

export type SessionPinnedNotesResponse = {
  notes: PinnedNote[];
  total: number;
};

export type SessionIntelligenceResponse = {
  score: ConversationScore | null;
  report: LearningReport | null;
  analysis: SessionAnalysis | null;
};

export type SessionInsightsResponse = SessionInsightsAggregate;

export const sessionListResponseSchema = z.object({
  sessions: z.array(agentSessionSchema), total: z.number().int().nonnegative(),
}).strict();
export const sessionContextResponseSchema = contextSummarySchema;
export const sessionDetailResponseSchema = z.object({
  session: agentSessionSchema, eventCount: z.number().int().nonnegative(),
}).strict();
export const createSessionResponseSchema = agentSessionSchema;
export const importSessionResponseSchema = z.object({ id: z.string(), success: z.boolean() }).strict();
export const sessionExportResponseSchema = z.object({
  session: agentSessionSchema, events: z.array(sessionEventSchema),
}).strict();
export const sessionEventListResponseSchema = z.array(sessionEventSchema);
export const sessionSearchResponseSchema = z.object({
  results: z.array(searchResultSchema), total: z.number().int().nonnegative(),
}).strict();
export const sessionPinnedEventsResponseSchema = z.object({
  events: z.array(sessionEventSchema), total: z.number().int().nonnegative(),
}).strict();
export const sessionPinnedNotesResponseSchema = z.object({
  notes: z.array(pinnedNoteSchema), total: z.number().int().nonnegative(),
}).strict();
export const sessionIntelligenceResponseSchema = z.object({
  score: conversationScoreSchema.nullable(), report: learningReportSchema.nullable(),
  analysis: sessionAnalysisSchema.nullable(),
}).strict();
export const sessionInsightsResponseSchema = sessionInsightsAggregateSchema;
