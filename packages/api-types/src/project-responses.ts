/**
 * Shared project/collaboration response types.
 *
 * Import these as `import type` from desktop code so they stay compile-time only.
 */
export type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'tester';
export type HandoffTarget = 'desktop' | 'vscode' | 'cursor' | 'antigravity';

export interface ProjectCompanionClient {
  id: string;
  clientName: string;
  clientType: string;
  launchTarget: string;
  lastSeenAt: string | null;
  lastPolledAt: string | null;
}

export interface GlobalCompanionClient extends ProjectCompanionClient {
  availableModels: string | null;
  availableChatInfo: string | null;
}

export interface ClaimedByUserSummary {
  id: string;
  name: string | null;
  email: string;
}

export interface ProjectPeerResponse {
  id: string;
  projectId: string;
  peerKey: string;
  displayName: string;
  ide: string;
  model: string;
  status: 'idle' | 'invited' | 'ready' | 'active';
  launchTarget: string;
  preferredClientId: string | null;
  preferredClient: ProjectCompanionClient | null;
  instructions: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditResultResponse {
  id: string;
  auditRequestId: string;
  projectId: string;
  peerKey: string;
  status: 'pending' | 'claimed' | 'submitted';
  claimedByUserId: string | null;
  claimedByClientId: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  claimIsStale: boolean;
  claimedByUser: ClaimedByUserSummary | null;
  claimedByClient: ProjectCompanionClient | null;
  verdict: string | null;
  confidence: number | null;
  rationale: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRequestResponse {
  id: string;
  projectId: string;
  prompt: string;
  scope: string;
  status: 'pending' | 'collecting' | 'completed';
  consensusSummary: string | null;
  winningPeerKey: string | null;
  createdAt: string;
  updatedAt: string;
  results: AuditResultResponse[];
}

export interface ProjectHandoffIntentResponse {
  token: string;
  target: HandoffTarget;
  expiresAt: string;
  launchUrl: string | null;
}

export interface ProjectHandoffConsumeResponse {
  projectId: string;
  sandboxProjectId: string;
  name: string;
  rootDir: string;
  role: ProjectRole | null;
  target: HandoffTarget;
  devPort: number | null;
  devUrl: string | null;
}
