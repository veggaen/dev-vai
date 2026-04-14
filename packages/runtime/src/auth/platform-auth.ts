import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { schema, type VaiConfig, type VaiDatabase } from '@vai/core';
import type { FastifyRequest, FastifyReply } from 'fastify';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

interface DeviceCodeRecord {
  id: string;
  deviceCode: string;
  userCode: string;
  clientName: string;
  clientType: string;
  installationKey: string | null;
  launchTarget: string | null;
  capabilities: string | null;
  status: string;
  approvedByUserId: string | null;
  expiresAt: Date;
  approvedAt: Date | null;
  lastPolledAt: Date | null;
  createdAt: Date;
}

interface CompanionClientSummary {
  id: string;
  installationKey: string;
  clientName: string;
  clientType: string;
  launchTarget: string;
  capabilities: string[];
}

interface DeviceLinkStartInput {
  clientName?: string;
  clientType?: string;
  installationKey?: string;
  launchTarget?: string;
  capabilities?: string[];
}

interface CompanionClientMetadata {
  installationKey: string;
  clientName: string;
  clientType: string;
  launchTarget: string;
  capabilities: string[];
  providedClientId?: string | null;
}

export interface PlatformViewer {
  authenticated: boolean;
  user: null | {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
  companionClient: CompanionClientSummary | null;
}

export interface DeviceLinkStartResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
}

export interface DeviceLinkPollResult {
  status: 'pending' | 'approved';
  expiresAt: string;
  sessionToken?: string;
  user?: NonNullable<PlatformViewer['user']>;
  companionClientId?: string;
}

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
const DEVICE_POLL_INTERVAL_SECONDS = 2;
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function encodeBase64Url(input: Buffer): string {
  return input.toString('base64url');
}

function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce<Record<string, string>>((acc, part) => {
    const [rawName, ...rawValueParts] = part.trim().split('=');
    if (!rawName) return acc;
    acc[rawName] = decodeURIComponent(rawValueParts.join('='));
    return acc;
  }, {});
}

function parseBearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

function buildCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function buildClearedCookie(name: string, secure: boolean): string {
  const parts = [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function getRequestIp(request: FastifyRequest): string | null {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]?.trim() || null;
  }
  return request.ip || null;
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeClientName(clientName?: string): string {
  const value = clientName?.trim();
  if (!value) return 'Companion Client';
  return value.slice(0, 120);
}

function normalizeClientType(clientType?: string): string {
  const value = clientType?.trim().toLowerCase();
  if (!value) return 'companion';
  return /^[a-z0-9-]+$/.test(value) ? value.slice(0, 64) : 'companion';
}

function normalizeInstallationKey(installationKey?: string | null): string | null {
  const value = installationKey?.trim().toLowerCase() ?? '';
  if (!value) return null;
  const normalized = value.replace(/[^a-z0-9:_-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 160) || null;
}

function normalizeLaunchTarget(launchTarget?: string | null): string {
  switch (launchTarget?.trim().toLowerCase()) {
    case 'desktop':
    case 'vscode':
    case 'cursor':
    case 'antigravity':
      return launchTarget.trim().toLowerCase();
    default:
      return 'desktop';
  }
}

function parseCapabilities(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
      .filter((item, index, array) => item && item.length <= 64 && array.indexOf(item) === index);
  } catch {
    return [];
  }
}

function serializeCapabilities(capabilities: string[] | undefined): string | null {
  if (!capabilities?.length) return null;
  return JSON.stringify(capabilities);
}

function generateUserCode(): string {
  let value = '';
  for (let index = 0; index < 8; index += 1) {
    const nextIndex = randomBytes(1)[0] % USER_CODE_ALPHABET.length;
    value += USER_CODE_ALPHABET[nextIndex];
  }
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

export class PlatformAuthService {
  constructor(
    private readonly db: VaiDatabase,
    private readonly config: VaiConfig['platformAuth'],
  ) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isGoogleEnabled(): boolean {
    return this.config.providers.google.enabled;
  }

  getPublicConfig() {
    return {
      enabled: this.config.enabled,
      providers: {
        google: {
          enabled: this.config.providers.google.enabled,
        },
      },
    };
  }

  async getViewer(request: FastifyRequest): Promise<PlatformViewer> {
    const session = this.getSessionFromRequest(request);
    if (!session) {
      return { authenticated: false, user: null, companionClient: null };
    }

    const row = this.getViewerRowByTokenHash(session.tokenHash);

    if (!row) {
      return { authenticated: false, user: null, companionClient: null };
    }

    this.db.update(schema.platformSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.platformSessions.id, row.sessionId))
      .run();

    const companionClient = this.upsertCompanionClientFromRequest(request, row.userId);

    return {
      authenticated: true,
      user: {
        id: row.userId,
        email: row.email,
        name: row.name,
        avatarUrl: row.avatarUrl,
      },
      companionClient,
    };
  }

  startDeviceLink(input?: DeviceLinkStartInput): DeviceLinkStartResult {
    if (!this.config.enabled) {
      throw new Error('Platform auth is not enabled');
    }

    this.purgeExpiredRecords();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEVICE_CODE_TTL_MS);
    const deviceCode = encodeBase64Url(randomBytes(32));
    const userCode = generateUserCode();

    this.db.insert(schema.platformDeviceCodes)
      .values({
        id: randomUUID(),
        deviceCode,
        userCode,
        clientName: normalizeClientName(input?.clientName),
        clientType: normalizeClientType(input?.clientType),
        installationKey: normalizeInstallationKey(input?.installationKey),
        launchTarget: normalizeLaunchTarget(input?.launchTarget),
        capabilities: serializeCapabilities(input?.capabilities),
        status: 'pending',
        approvedByUserId: null,
        expiresAt,
        approvedAt: null,
        lastPolledAt: null,
        createdAt: now,
      })
      .run();

    return {
      deviceCode,
      userCode,
      verificationUri: this.getDeviceVerificationUrl(userCode),
      expiresAt: expiresAt.toISOString(),
      intervalSeconds: DEVICE_POLL_INTERVAL_SECONDS,
    };
  }

  getDeviceLinkByUserCode(userCode: string): DeviceCodeRecord | null {
    this.purgeExpiredRecords();
    return this.db.select()
      .from(schema.platformDeviceCodes)
      .where(and(
        eq(schema.platformDeviceCodes.userCode, userCode.trim().toUpperCase()),
        gt(schema.platformDeviceCodes.expiresAt, new Date()),
      ))
      .get() ?? null;
  }

  async approveDeviceLink(userCode: string, request: FastifyRequest): Promise<NonNullable<PlatformViewer['user']>> {
    const viewer = await this.getViewer(request);
    if (!viewer.authenticated || !viewer.user) {
      throw new Error('Sign in before approving this device link.');
    }

    const deviceLink = this.getDeviceLinkByUserCode(userCode);
    if (!deviceLink) {
      throw new Error('That device link is missing or expired.');
    }

    this.db.update(schema.platformDeviceCodes)
      .set({
        status: 'approved',
        approvedByUserId: viewer.user.id,
        approvedAt: new Date(),
      })
      .where(eq(schema.platformDeviceCodes.id, deviceLink.id))
      .run();

    this.upsertCompanionClientFromDeviceLink(viewer.user.id, {
      ...deviceLink,
      approvedByUserId: viewer.user.id,
      approvedAt: new Date(),
    });

    return viewer.user;
  }

  pollDeviceLink(deviceCode: string, request: FastifyRequest): DeviceLinkPollResult {
    this.purgeExpiredRecords();

    const deviceLink = this.db.select()
      .from(schema.platformDeviceCodes)
      .where(and(
        eq(schema.platformDeviceCodes.deviceCode, deviceCode.trim()),
        gt(schema.platformDeviceCodes.expiresAt, new Date()),
      ))
      .get();

    if (!deviceLink) {
      throw new Error('Device link expired. Start again.');
    }

    this.db.update(schema.platformDeviceCodes)
      .set({ lastPolledAt: new Date() })
      .where(eq(schema.platformDeviceCodes.id, deviceLink.id))
      .run();

    if (deviceLink.status !== 'approved' || !deviceLink.approvedByUserId) {
      return {
        status: 'pending',
        expiresAt: deviceLink.expiresAt.toISOString(),
      };
    }

    const user = this.db.select({
      id: schema.platformUsers.id,
      email: schema.platformUsers.email,
      name: schema.platformUsers.name,
      avatarUrl: schema.platformUsers.avatarUrl,
    })
      .from(schema.platformUsers)
      .where(eq(schema.platformUsers.id, deviceLink.approvedByUserId))
      .get();

    if (!user) {
      throw new Error('Approved user no longer exists.');
    }

    const sessionToken = this.createSession(
      user.id,
      request,
      `${deviceLink.clientType}:${deviceLink.clientName}`,
    );

    const companionClient = this.upsertCompanionClientFromDeviceLink(user.id, deviceLink, {
      markPolled: true,
    });

    this.db.delete(schema.platformDeviceCodes)
      .where(eq(schema.platformDeviceCodes.id, deviceLink.id))
      .run();

    return {
      status: 'approved',
      expiresAt: deviceLink.expiresAt.toISOString(),
      sessionToken,
      user,
      companionClientId: companionClient?.id,
    };
  }

  getDeviceVerificationUrl(userCode: string): string {
    return `${this.config.publicUrl}/api/auth/device?userCode=${encodeURIComponent(userCode)}&auto=1`;
  }

  buildGoogleLoginUrl(returnTo?: string): string {
    if (!returnTo) return `${this.config.publicUrl}/api/auth/google/start`;
    return `${this.config.publicUrl}/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
  }

  getLoginReturnTarget(request: FastifyRequest, userCode: string): string {
    return this.sanitizeReturnTo(
      `${this.config.publicUrl}/api/auth/device?userCode=${encodeURIComponent(userCode)}&auto=1`,
      request,
    );
  }

  private getViewerRowByTokenHash(tokenHash: string) {
    return this.db.select({
      sessionId: schema.platformSessions.id,
      userId: schema.platformUsers.id,
      email: schema.platformUsers.email,
      name: schema.platformUsers.name,
      avatarUrl: schema.platformUsers.avatarUrl,
    })
      .from(schema.platformSessions)
      .innerJoin(schema.platformUsers, eq(schema.platformSessions.userId, schema.platformUsers.id))
      .where(and(
        eq(schema.platformSessions.tokenHash, tokenHash),
        gt(schema.platformSessions.expiresAt, new Date()),
      ))
      .get();
  }

  buildGoogleStartUrl(request: FastifyRequest, returnTo?: string): string {
    if (!this.config.enabled || !this.config.providers.google.enabled || !this.config.providers.google.clientId) {
      throw new Error('Google auth is not configured');
    }

    this.purgeExpiredRecords();

    const state = encodeBase64Url(randomBytes(24));
    const codeVerifier = encodeBase64Url(randomBytes(48));
    const codeChallenge = sha256Base64Url(codeVerifier);
    const redirectUri = `${this.config.publicUrl}/api/auth/google/callback`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const safeReturnTo = this.sanitizeReturnTo(returnTo, request);

    this.db.insert(schema.platformOauthStates)
      .values({
        id: randomUUID(),
        provider: 'google',
        state,
        codeVerifier,
        returnTo: safeReturnTo,
        expiresAt,
        createdAt: now,
      })
      .run();

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', this.config.providers.google.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.config.providers.google.scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  }

  async handleGoogleCallback(code: string, state: string, request: FastifyRequest): Promise<{ returnTo: string; cookieValue: string }> {
    if (!this.config.providers.google.clientId || !this.config.providers.google.clientSecret) {
      throw new Error('Google auth is not configured');
    }

    this.purgeExpiredRecords();

    const oauthState = this.db.select()
      .from(schema.platformOauthStates)
      .where(and(
        eq(schema.platformOauthStates.provider, 'google'),
        eq(schema.platformOauthStates.state, state),
        gt(schema.platformOauthStates.expiresAt, new Date()),
      ))
      .get();

    if (!oauthState) {
      throw new Error('Auth session expired. Start login again.');
    }

    this.db.delete(schema.platformOauthStates)
      .where(eq(schema.platformOauthStates.id, oauthState.id))
      .run();

    const redirectUri = `${this.config.publicUrl}/api/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.providers.google.clientId,
        client_secret: this.config.providers.google.clientSecret,
        code,
        code_verifier: oauthState.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Google token exchange failed');
    }

    const tokens = await tokenResponse.json() as GoogleTokenResponse;
    const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      throw new Error('Google user profile fetch failed');
    }

    const profile = await userInfoResponse.json() as GoogleUserInfo;
    const userId = this.upsertGoogleUser(profile, tokens);
    const cookieValue = this.createSession(userId, request);

    return {
      returnTo: oauthState.returnTo,
      cookieValue,
    };
  }

  clearSession(request: FastifyRequest): void {
    const session = this.getSessionFromRequest(request);
    if (!session) return;
    this.db.delete(schema.platformSessions)
      .where(eq(schema.platformSessions.tokenHash, session.tokenHash))
      .run();
  }

  applySessionCookie(reply: FastifyReply, cookieValue: string): void {
    reply.header('set-cookie', buildCookie(
      this.config.sessionCookieName,
      cookieValue,
      this.config.sessionTtlHours * 60 * 60,
      this.shouldUseSecureCookies(),
    ));
  }

  clearSessionCookie(reply: FastifyReply): void {
    reply.header('set-cookie', buildClearedCookie(this.config.sessionCookieName, this.shouldUseSecureCookies()));
  }

  private getSessionFromRequest(request: FastifyRequest): { token: string; tokenHash: string } | null {
    const bearerToken = parseBearerToken(request.headers.authorization);
    if (bearerToken) {
      return {
        token: bearerToken,
        tokenHash: this.hashToken(bearerToken),
      };
    }

    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[this.config.sessionCookieName];
    if (!token) return null;
    return {
      token,
      tokenHash: this.hashToken(token),
    };
  }

  private getCompanionMetadataFromRequest(request: FastifyRequest): CompanionClientMetadata | null {
    const installationKey = normalizeInstallationKey(this.getSingleHeader(request.headers['x-vai-installation-key']));
    if (!installationKey) return null;

    return {
      installationKey,
      clientName: normalizeClientName(this.getSingleHeader(request.headers['x-vai-client-name']) ?? undefined),
      clientType: normalizeClientType(this.getSingleHeader(request.headers['x-vai-client-type']) ?? undefined),
      launchTarget: normalizeLaunchTarget(this.getSingleHeader(request.headers['x-vai-launch-target'])),
      capabilities: parseCapabilities(this.getSingleHeader(request.headers['x-vai-client-capabilities'])),
      providedClientId: this.getSingleHeader(request.headers['x-vai-companion-client-id']),
    };
  }

  private upsertCompanionClientFromRequest(request: FastifyRequest, userId: string): CompanionClientSummary | null {
    const metadata = this.getCompanionMetadataFromRequest(request);
    if (!metadata) return null;
    return this.upsertCompanionClient(userId, metadata, { markPolled: false });
  }

  /**
   * Register or find a companion client by installation key without requiring a user session.
   * Creates a local system user if needed so the foreign key constraint is satisfied.
   * When the user eventually signs in via device-link, the client will be re-associated.
   */
  upsertAnonymousCompanionClient(request: FastifyRequest): CompanionClientSummary | null {
    const metadata = this.getCompanionMetadataFromRequest(request);
    if (!metadata) return null;
    // Check if this installation key already has a client (possibly with a real user)
    const existing = this.findCompanionClient(metadata.installationKey, metadata.providedClientId ?? null);
    if (existing) {
      // Update lastSeenAt without changing userId
      this.db.update(schema.platformCompanionClients)
        .set({ lastSeenAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.platformCompanionClients.id, existing.id))
        .run();
      return {
        id: existing.id,
        installationKey: metadata.installationKey,
        clientName: metadata.clientName,
        clientType: metadata.clientType,
        launchTarget: metadata.launchTarget,
        capabilities: metadata.capabilities,
      };
    }
    // Ensure local system user exists for the foreign key
    const localUserId = this.ensureLocalSystemUser();
    return this.upsertCompanionClient(localUserId, metadata, { markPolled: false });
  }

  /** Ensure a local system user exists for anonymous/local-dev operations. */
  ensureLocalSystemUser(): string {
    const LOCAL_USER_ID = '__local_system__';
    const existing = this.db.select({ id: schema.platformUsers.id })
      .from(schema.platformUsers)
      .where(eq(schema.platformUsers.id, LOCAL_USER_ID))
      .get();
    if (existing) return LOCAL_USER_ID;

    const now = new Date();
    this.db.insert(schema.platformUsers)
      .values({
        id: LOCAL_USER_ID,
        email: 'local@localhost',
        name: 'Local System',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return LOCAL_USER_ID;
  }

  private upsertCompanionClientFromDeviceLink(
    userId: string,
    deviceLink: DeviceCodeRecord,
    options?: { markPolled?: boolean },
  ): CompanionClientSummary | null {
    const installationKey = normalizeInstallationKey(deviceLink.installationKey);
    if (!installationKey) return null;

    return this.upsertCompanionClient(userId, {
      installationKey,
      clientName: normalizeClientName(deviceLink.clientName),
      clientType: normalizeClientType(deviceLink.clientType),
      launchTarget: normalizeLaunchTarget(deviceLink.launchTarget),
      capabilities: parseCapabilities(deviceLink.capabilities),
    }, {
      createdViaDeviceCodeId: deviceLink.id,
      markPolled: options?.markPolled ?? false,
    });
  }

  private upsertCompanionClient(
    userId: string,
    metadata: CompanionClientMetadata,
    options?: { createdViaDeviceCodeId?: string; markPolled?: boolean },
  ): CompanionClientSummary {
    const now = new Date();
    const existing = this.findCompanionClient(metadata.installationKey, metadata.providedClientId ?? null);
    const values = {
      userId,
      installationKey: metadata.installationKey,
      clientName: metadata.clientName,
      clientType: metadata.clientType,
      launchTarget: metadata.launchTarget,
      capabilities: serializeCapabilities(metadata.capabilities),
      lastSeenAt: now,
      lastPolledAt: options?.markPolled ? now : existing?.lastPolledAt ?? null,
      createdViaDeviceCodeId: existing?.createdViaDeviceCodeId ?? options?.createdViaDeviceCodeId ?? null,
      updatedAt: now,
    };

    const clientId = existing?.id ?? metadata.providedClientId ?? randomUUID();
    if (existing) {
      this.db.update(schema.platformCompanionClients)
        .set(values)
        .where(eq(schema.platformCompanionClients.id, existing.id))
        .run();
    } else {
      this.db.insert(schema.platformCompanionClients)
        .values({
          id: clientId,
          ...values,
          createdAt: now,
        })
        .run();
    }

    return {
      id: clientId,
      installationKey: metadata.installationKey,
      clientName: metadata.clientName,
      clientType: metadata.clientType,
      launchTarget: metadata.launchTarget,
      capabilities: metadata.capabilities,
    };
  }

  private findCompanionClient(installationKey: string, providedClientId?: string | null) {
    if (providedClientId) {
      const byId = this.db.select()
        .from(schema.platformCompanionClients)
        .where(eq(schema.platformCompanionClients.id, providedClientId))
        .get();
      if (byId) return byId;
    }

    return this.db.select()
      .from(schema.platformCompanionClients)
      .where(eq(schema.platformCompanionClients.installationKey, installationKey))
      .get() ?? null;
  }

  private getSingleHeader(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value[0]?.trim() || null;
    return value?.trim() || null;
  }

  private upsertGoogleUser(profile: GoogleUserInfo, tokens: GoogleTokenResponse): string {
    const now = new Date();
    const account = this.db.select()
      .from(schema.platformAccounts)
      .where(and(
        eq(schema.platformAccounts.provider, 'google'),
        eq(schema.platformAccounts.providerAccountId, profile.sub),
      ))
      .get();

    let userId = account?.userId;

    if (!userId) {
      const existingUser = this.db.select()
        .from(schema.platformUsers)
        .where(eq(schema.platformUsers.email, profile.email))
        .get();
      userId = existingUser?.id ?? randomUUID();

      if (existingUser) {
        this.db.update(schema.platformUsers)
          .set({
            name: profile.name ?? existingUser.name,
            avatarUrl: profile.picture ?? existingUser.avatarUrl,
            emailVerifiedAt: profile.email_verified ? (existingUser.emailVerifiedAt ?? now) : existingUser.emailVerifiedAt,
            lastLoginAt: now,
            updatedAt: now,
          })
          .where(eq(schema.platformUsers.id, existingUser.id))
          .run();
      } else {
        this.db.insert(schema.platformUsers)
          .values({
            id: userId,
            email: profile.email,
            name: profile.name ?? null,
            avatarUrl: profile.picture ?? null,
            emailVerifiedAt: profile.email_verified ? now : null,
            lastLoginAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    } else {
      this.db.update(schema.platformUsers)
        .set({
          email: profile.email,
          name: profile.name ?? null,
          avatarUrl: profile.picture ?? null,
          emailVerifiedAt: profile.email_verified ? now : null,
          lastLoginAt: now,
          updatedAt: now,
        })
        .where(eq(schema.platformUsers.id, userId))
        .run();
    }

    const tokenExpiresAt = typeof tokens.expires_in === 'number'
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    if (account) {
      this.db.update(schema.platformAccounts)
        .set({
          userId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? account.refreshToken,
          scope: tokens.scope ?? account.scope,
          tokenType: tokens.token_type ?? account.tokenType,
          tokenExpiresAt,
          rawProfile: JSON.stringify(profile),
          updatedAt: now,
        })
        .where(eq(schema.platformAccounts.id, account.id))
        .run();
    } else {
      this.db.insert(schema.platformAccounts)
        .values({
          id: randomUUID(),
          userId,
          provider: 'google',
          providerAccountId: profile.sub,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          scope: tokens.scope ?? null,
          tokenType: tokens.token_type ?? null,
          tokenExpiresAt,
          rawProfile: JSON.stringify(profile),
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    return userId;
  }

  private createSession(userId: string, request: FastifyRequest, userAgentOverride?: string): string {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlHours * 60 * 60 * 1000);
    const token = encodeBase64Url(randomBytes(48));
    const tokenHash = this.hashToken(token);

    this.db.insert(schema.platformSessions)
      .values({
        id: randomUUID(),
        userId,
        tokenHash,
        userAgent: userAgentOverride ?? request.headers['user-agent'] ?? null,
        ipAddress: getRequestIp(request),
        expiresAt,
        lastSeenAt: now,
        createdAt: now,
      })
      .run();

    return token;
  }

  private purgeExpiredRecords(): void {
    const now = new Date();
    this.db.delete(schema.platformSessions)
      .where(lt(schema.platformSessions.expiresAt, now))
      .run();
    this.db.delete(schema.platformOauthStates)
      .where(lt(schema.platformOauthStates.expiresAt, now))
      .run();
    this.db.delete(schema.platformDeviceCodes)
      .where(lt(schema.platformDeviceCodes.expiresAt, now))
      .run();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(`${this.config.sessionSecret}:${token}`).digest('hex');
  }

  private sanitizeReturnTo(returnTo: string | undefined, request: FastifyRequest): string {
    const fallback = this.config.appUrl ?? `${this.config.publicUrl}/`;
    if (!returnTo) return fallback;

    const requested = returnTo.trim();
    const allowedOrigins = new Set<string>();
    allowedOrigins.add(new URL(this.config.publicUrl).origin);
    if (this.config.appUrl) {
      allowedOrigins.add(new URL(this.config.appUrl).origin);
    }
    const referer = request.headers.referer;
    if (referer && isAbsoluteHttpUrl(referer)) {
      allowedOrigins.add(new URL(referer).origin);
    }

    try {
      const parsed = isAbsoluteHttpUrl(requested)
        ? new URL(requested)
        : new URL(requested, this.config.appUrl ?? fallback);

      if (allowedOrigins.size > 0 && !allowedOrigins.has(parsed.origin)) {
        return fallback;
      }

      return parsed.toString();
    } catch {
      return fallback;
    }
  }

  private shouldUseSecureCookies(): boolean {
    return this.config.publicUrl.startsWith('https://');
  }
}