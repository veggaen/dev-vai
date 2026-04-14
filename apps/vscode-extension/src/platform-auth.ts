import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { apiCall, setAuthTokenProvider, setClientMetadataProvider } from './api.js';

interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface AuthPayload {
  enabled: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  companionClient?: {
    id: string;
    installationKey: string;
    clientName: string;
    clientType: string;
    launchTarget: string;
    capabilities: string[];
  } | null;
}

interface DeviceStartPayload {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
}

interface DevicePollPayload {
  status: 'pending' | 'approved';
  expiresAt: string;
  sessionToken?: string;
  user?: AuthUser;
  companionClientId?: string;
}

export interface PlatformAuthState {
  status: 'signed-out' | 'signing-in' | 'authenticated' | 'error';
  user: AuthUser | null;
  error: string | null;
}

const SECRET_KEY = 'vai.platformSessionToken';
const INSTALLATION_KEY_STATE = 'vai.platformInstallationKey';
const COMPANION_CLIENT_ID_STATE = 'vai.platformCompanionClientId';
const CLIENT_NAME = 'VS Code Extension';
const CLIENT_TYPE = 'vscode-extension';
const LAUNCH_TARGET = 'vscode';
const CLIENT_CAPABILITIES = ['audit-consume', 'handoff-consume', 'broadcast-consume'];

let extensionContext: vscode.ExtensionContext | null = null;
let sessionToken: string | undefined;
let state: PlatformAuthState = {
  status: 'signed-out',
  user: null,
  error: null,
};

const onDidChangeEmitter = new vscode.EventEmitter<PlatformAuthState>();
export const onDidChangePlatformAuthState = onDidChangeEmitter.event;

function setState(nextState: PlatformAuthState): void {
  state = nextState;
  onDidChangeEmitter.fire(state);
}

async function persistToken(token?: string): Promise<void> {
  if (!extensionContext) return;
  if (token) {
    await extensionContext.secrets.store(SECRET_KEY, token);
    return;
  }
  await extensionContext.secrets.delete(SECRET_KEY);
}

export function getPlatformAuthState(): PlatformAuthState {
  return state;
}

export function initPlatformAuth(context: vscode.ExtensionContext): void {
  extensionContext = context;
  setAuthTokenProvider(() => sessionToken);
  setClientMetadataProvider(async () => ({
    installationKey: await getInstallationKey(),
    clientName: CLIENT_NAME,
    clientType: CLIENT_TYPE,
    launchTarget: LAUNCH_TARGET,
    capabilities: CLIENT_CAPABILITIES,
    companionClientId: extensionContext ? extensionContext.globalState.get<string>(COMPANION_CLIENT_ID_STATE) : undefined,
  }));
}

export async function restorePlatformAuth(): Promise<void> {
  if (!extensionContext) return;

  sessionToken = await extensionContext.secrets.get(SECRET_KEY);
  if (!sessionToken) {
    setState({ status: 'signed-out', user: null, error: null });
    return;
  }

  await refreshPlatformAuth();
}

export async function refreshPlatformAuth(): Promise<void> {
  try {
    const payload = await apiCall('/api/auth/me') as AuthPayload;
    if (!payload.enabled || !payload.authenticated || !payload.user) {
      sessionToken = undefined;
      await persistToken(undefined);
      await persistCompanionClientId(undefined);
      setState({ status: 'signed-out', user: null, error: null });
      return;
    }

    await persistCompanionClientId(payload.companionClient?.id);

    setState({ status: 'authenticated', user: payload.user, error: null });
  } catch (error) {
    setState({
      status: 'error',
      user: state.user,
      error: error instanceof Error ? error.message : 'Unable to verify platform session.',
    });
  }
}

export async function signInToPlatform(): Promise<void> {
  setState({ status: 'signing-in', user: state.user, error: null });

  try {
    const installationKey = await getInstallationKey();
    const payload = await apiCall('/api/auth/device/start', 'POST', {
      clientName: CLIENT_NAME,
      clientType: CLIENT_TYPE,
      installationKey,
      launchTarget: LAUNCH_TARGET,
      capabilities: CLIENT_CAPABILITIES,
    }) as DeviceStartPayload;

    await vscode.env.openExternal(vscode.Uri.parse(payload.verificationUri));

    const expiresAt = new Date(payload.expiresAt).getTime();
    const intervalMs = Math.max(1000, payload.intervalSeconds * 1000);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Waiting for VeggaAI sign-in (${payload.userCode})`,
        cancellable: true,
      },
      async (progress, cancellationToken) => {
        progress.report({ message: 'Finish approval in your browser.' });

        while (Date.now() < expiresAt) {
          if (cancellationToken.isCancellationRequested) {
            throw new Error('Sign-in cancelled.');
          }

          const result = await apiCall('/api/auth/device/poll', 'POST', {
            deviceCode: payload.deviceCode,
          }) as DevicePollPayload;

          if (result.status === 'approved' && result.sessionToken && result.user) {
            sessionToken = result.sessionToken;
            await persistToken(sessionToken);
            await persistCompanionClientId(result.companionClientId);
            setState({ status: 'authenticated', user: result.user, error: null });
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }

        throw new Error('Sign-in timed out. Start again from VS Code.');
      },
    );

    if (state.status === 'authenticated' && state.user) {
      vscode.window.showInformationMessage(`VeggaAI connected as ${state.user.email}`);
      return;
    }

    throw new Error('Sign-in did not complete.');
  } catch (error) {
    sessionToken = undefined;
    await persistToken(undefined);
    await persistCompanionClientId(undefined);
    setState({
      status: 'error',
      user: null,
      error: error instanceof Error ? error.message : 'Sign-in failed.',
    });
    throw error;
  }
}

export async function signOutFromPlatform(): Promise<void> {
  try {
    await apiCall('/api/auth/logout', 'POST');
  } catch {
    // Local cleanup still matters if the runtime session is already gone.
  }

  sessionToken = undefined;
  await persistToken(undefined);
  await persistCompanionClientId(undefined);
  setState({ status: 'signed-out', user: null, error: null });
}

async function getInstallationKey(): Promise<string> {
  if (!extensionContext) {
    throw new Error('Platform auth has not been initialized');
  }

  const existing = extensionContext.globalState.get<string>(INSTALLATION_KEY_STATE);
  if (existing?.trim()) {
    return existing;
  }

  const nextValue = `vscode-${randomUUID()}`;
  await extensionContext.globalState.update(INSTALLATION_KEY_STATE, nextValue);
  return nextValue;
}

async function persistCompanionClientId(clientId?: string): Promise<void> {
  if (!extensionContext) return;
  await extensionContext.globalState.update(COMPANION_CLIENT_ID_STATE, clientId?.trim() || undefined);
}