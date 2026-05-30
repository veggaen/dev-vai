import type { PlatformViewer } from '../auth/platform-auth.js';
import type { ProjectService } from '../projects/service.js';

export type ConversationAccess = 'read' | 'write';

export interface ConversationAccessSubject {
  ownerUserId?: string | null;
  sandboxProjectId?: string | null;
  visibility?: 'private' | 'unlisted' | 'public' | string | null;
}

export interface ConversationAccessDecision {
  allowed: boolean;
  statusCode?: 401 | 403 | 404;
  error?: string;
}

export interface ConversationAccessInput {
  conversation: ConversationAccessSubject | null | undefined;
  viewer: PlatformViewer;
  projects: Pick<ProjectService, 'canReadSandbox' | 'canWriteSandbox'>;
  access: ConversationAccess;
  authEnabled: boolean;
}

function denyForViewer(viewer: PlatformViewer, authenticatedMessage: string, anonymousMessage: string): ConversationAccessDecision {
  return viewer.authenticated && viewer.user
    ? { allowed: false, statusCode: 403, error: authenticatedMessage }
    : { allowed: false, statusCode: 401, error: anonymousMessage };
}

export function authorizeConversationAccess(input: ConversationAccessInput): ConversationAccessDecision {
  const { conversation, viewer, projects, access, authEnabled } = input;

  if (!conversation) {
    return { allowed: false, statusCode: 404, error: 'Conversation not found' };
  }

  // Preserve local-first/dev behavior when platform auth is disabled. Authenticated
  // deployments use the stricter branches below and do not treat null-owner rows as shared.
  if (!authEnabled) {
    return { allowed: true };
  }

  const viewerId = viewer.user?.id ?? null;
  if (conversation.ownerUserId) {
    if (viewerId && conversation.ownerUserId === viewerId) {
      return { allowed: true };
    }
  } else {
    return denyForViewer(
      viewer,
      'This legacy conversation is not assigned to your account',
      'Sign in to access this conversation',
    );
  }

  if (viewerId && conversation.sandboxProjectId) {
    const canAccessProject = access === 'write'
      ? projects.canWriteSandbox(conversation.sandboxProjectId, viewerId)
      : projects.canReadSandbox(conversation.sandboxProjectId, viewerId);
    if (canAccessProject) {
      return { allowed: true };
    }
  }

  if (access === 'read' && conversation.visibility === 'public') {
    return { allowed: true };
  }

  return denyForViewer(
    viewer,
    access === 'write' ? 'Not your conversation' : 'You do not have access to this conversation',
    access === 'write' ? 'Sign in to update this conversation' : 'Sign in to access this conversation',
  );
}
