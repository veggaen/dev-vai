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
} from '@vai/core/browser';

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
