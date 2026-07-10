import type { FastifyInstance } from 'fastify';
import { PlatformAuthService } from '../auth/platform-auth.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderDevicePage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} · Vai</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #090b0d;
        background-image: radial-gradient(circle at 16% 10%, rgba(16, 185, 129, 0.10), transparent 34%),
          radial-gradient(circle at 90% 90%, rgba(59, 130, 246, 0.07), transparent 28%);
        color: #f4f4f5;
        font-family: "Segoe UI", system-ui, sans-serif;
      }
      main {
        width: min(420px, calc(100vw - 32px));
        padding: 36px 32px;
        border: 1px solid rgba(244, 244, 245, 0.10);
        border-radius: 20px;
        background: rgba(16, 18, 20, 0.92);
        box-shadow: 0 32px 100px rgba(0, 0, 0, 0.48);
        text-align: center;
      }
      .mark {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        margin: 0 auto 18px;
        border-radius: 12px;
        border: 1px solid rgba(110, 231, 183, 0.25);
        background: rgba(110, 231, 183, 0.10);
        color: #6ee7b7;
        font-weight: 600;
        font-size: 17px;
      }
      h1 { margin: 0 0 8px; font-size: 21px; letter-spacing: -0.02em; }
      p { margin: 0 0 10px; color: #a1a1aa; line-height: 1.6; font-size: 14px; }
      .who { color: #e4e4e7; }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-top: 14px;
        padding: 11px 22px;
        border-radius: 12px;
        background: #f4f4f5;
        color: #09090b;
        text-decoration: none;
        font-weight: 600;
        font-size: 14px;
        border: 0;
        cursor: pointer;
      }
      .button:hover { background: #ffffff; }
      .muted { color: #71717a; font-size: 12px; margin-top: 16px; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true">V</div>
      <h1>${escapeHtml(title)}</h1>
      ${body}
    </main>
  </body>
</html>`;
}

/**
 * Best-effort tab close. Browsers only honor window.close() for script-opened
 * tabs, so this page never PROMISES to close — it tries, and if the tab is
 * still alive it shows honest "you can close this tab" copy instead.
 */
function renderAutoCloseScript(): string {
  return `<script>
setTimeout(() => { try { window.close(); } catch { /* not script-opened */ } }, 900);
</script>`;
}

function renderDoneFooter(): string {
  return `<p class="muted">All done — you can close this tab.</p>${renderAutoCloseScript()}`;
}

export function registerPlatformAuthRoutes(app: FastifyInstance, auth: PlatformAuthService) {
  app.get('/api/auth/me', async (request) => {
    const viewer = await auth.getViewer(request);
    return {
      ...auth.getPublicConfig(),
      ...viewer,
    };
  });

  app.get('/api/auth/browser-complete', async (_request, reply) => {
    reply.type('text/html; charset=utf-8');
    return renderDevicePage(
      'You’re signed in',
      `<p>The app reconnects on its own — nothing else to do here.</p>
      ${renderDoneFooter()}`,
    );
  });

  app.get<{ Querystring: { returnTo?: string } }>(
    '/api/auth/start',
    async (request, reply) => {
      const provider = auth.getDefaultProvider();
      if (!auth.isEnabled() || !provider) {
        reply.code(503);
        return { error: 'Platform auth is not configured' };
      }

      const authorizationUrl = await auth.buildProviderStartUrl(provider, request, request.query.returnTo);
      return reply.redirect(authorizationUrl);
    },
  );

  app.get<{ Params: { provider: string }; Querystring: { returnTo?: string } }>(
    '/api/auth/:provider/start',
    async (request, reply) => {
      const provider = auth.isProviderSupported(request.params.provider)
        ? request.params.provider
        : null;
      if (!provider) {
        reply.code(404);
        return { error: 'Unknown auth provider' };
      }

      if (!auth.isEnabled() || !auth.isProviderEnabled(provider)) {
        reply.code(503);
        return { error: `${auth.getProviderLabel(provider)} is not configured` };
      }

      const authorizationUrl = await auth.buildProviderStartUrl(provider, request, request.query.returnTo);
      return reply.redirect(authorizationUrl);
    },
  );

  app.post<{ Body: { clientName?: string; clientType?: string; installationKey?: string; launchTarget?: string; capabilities?: string[] } }>(
    '/api/auth/device/start',
    async (request, reply) => {
      if (!auth.isEnabled()) {
        reply.code(503);
        return { error: 'Platform auth is not configured' };
      }

      return auth.startDeviceLink({
        clientName: request.body?.clientName,
        clientType: request.body?.clientType,
        installationKey: request.body?.installationKey,
        launchTarget: request.body?.launchTarget,
        capabilities: request.body?.capabilities,
      });
    },
  );

  app.get<{ Querystring: { userCode?: string; auto?: string } }>(
    '/api/auth/device',
    async (request, reply) => {
      const userCode = request.query.userCode?.trim().toUpperCase();
      if (!userCode) {
        reply.code(400).type('text/html; charset=utf-8');
        return renderDevicePage('Missing link code', '<p>This device link is missing its code. Start again from VS Code or Chrome.</p>');
      }

      const deviceLink = auth.getDeviceLinkByUserCode(userCode);
      if (!deviceLink) {
        reply.code(410).type('text/html; charset=utf-8');
        return renderDevicePage('Link expired', '<p>This device link expired or was already used. Start a new one from the client you are connecting.</p>');
      }

      const viewer = await auth.getViewer(request);
      if (!viewer.authenticated || !viewer.user) {
        const loginUrl = auth.buildLoginUrl(auth.getLoginReturnTarget(request, userCode));
        const providerLabel = auth.getProviderLabel(auth.getDefaultProvider());
        reply.type('text/html; charset=utf-8');
        return renderDevicePage(
          'Connect your app',
          `<p>Sign in once and <span class="who">${escapeHtml(deviceLink.clientName)}</span> is connected.</p>
          <a class="button" href="${escapeHtml(loginUrl)}">Continue with ${escapeHtml(providerLabel)}</a>`,
        );
      }

      if (request.query.auto === '1') {
        await auth.approveDeviceLink(userCode, request);
        reply.type('text/html; charset=utf-8');
        return renderDevicePage(
          'You’re connected',
          `<p><span class="who">${escapeHtml(deviceLink.clientName)}</span> is signed in as <span class="who">${escapeHtml(viewer.user.email)}</span> and reconnects on its own.</p>
          ${renderDoneFooter()}`,
        );
      }

      reply.type('text/html; charset=utf-8');
      return renderDevicePage(
        'Approve connection',
        `<p><span class="who">${escapeHtml(deviceLink.clientName)}</span> wants to use your account <span class="who">${escapeHtml(viewer.user.email)}</span> on this machine.</p>
        <a class="button" href="/api/auth/device?userCode=${encodeURIComponent(deviceLink.userCode)}&auto=1">Approve</a>
        <p class="muted">Not you? Just close this tab — nothing is connected until you approve.</p>`,
      );
    },
  );

  app.post<{ Body: { userCode?: string } }>(
    '/api/auth/device/approve',
    async (request, reply) => {
      const userCode = request.body?.userCode?.trim().toUpperCase();
      if (!userCode) {
        reply.code(400);
        return { error: 'Missing user code' };
      }

      const user = await auth.approveDeviceLink(userCode, request);
      const wantsHtml = (request.headers.accept ?? '').includes('text/html');

      if (wantsHtml) {
        reply.type('text/html; charset=utf-8');
        return renderDevicePage(
          'You’re connected',
          `<p>This client is signed in as <span class="who">${escapeHtml(user.email)}</span>.</p>
          ${renderDoneFooter()}`,
        );
      }

      return { ok: true, user };
    },
  );

  app.post<{ Body: { deviceCode?: string } }>(
    '/api/auth/device/poll',
    async (request, reply) => {
      const deviceCode = request.body?.deviceCode?.trim();
      if (!deviceCode) {
        reply.code(400);
        return { error: 'Missing device code' };
      }

      try {
        const result = auth.pollDeviceLink(deviceCode, request);
        if (result.status === 'approved' && result.sessionToken) {
          auth.applySessionCookie(reply, result.sessionToken);
        }
        return result;
      } catch (pollError) {
        reply.code(410);
        return {
          error: pollError instanceof Error ? pollError.message : 'Device link failed',
        };
      }
    },
  );

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/:provider/callback',
    async (request, reply) => {
      const provider = auth.isProviderSupported(request.params.provider)
        ? request.params.provider
        : null;
      if (!provider) {
        reply.code(404);
        return { error: 'Unknown auth provider' };
      }

      const { code, state, error } = request.query;

      if (error) {
        reply.code(400);
        return { error };
      }

      if (!code || !state) {
        reply.code(400);
        return { error: `Missing ${auth.getProviderLabel(provider)} auth code or state` };
      }

      try {
        const result = await auth.handleProviderCallback(provider, code, state, request);
        auth.applySessionCookie(reply, result.cookieValue);
        const returnUrl = new URL(result.returnTo);
        if (auth.shouldIssueLoginHandoff(returnUrl.toString())) {
          returnUrl.searchParams.set('vai_handoff', auth.issueLoginHandoff(result.cookieValue, returnUrl.origin));
        }
        return reply.redirect(returnUrl.toString());
      } catch (callbackError) {
        reply.code(400);
        return {
          error: callbackError instanceof Error ? callbackError.message : `${auth.getProviderLabel(provider)} sign-in failed`,
        };
      }
    },
  );

  app.post<{ Body: { code?: string } }>(
    '/api/auth/handoff/exchange',
    async (request, reply) => {
      const code = request.body?.code?.trim();
      if (!code) {
        reply.code(400);
        return { error: 'Missing login handoff code' };
      }

      try {
        return auth.exchangeLoginHandoff(code, request);
      } catch (handoffError) {
        reply.code(410);
        return {
          error: handoffError instanceof Error ? handoffError.message : 'Login handoff failed',
        };
      }
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    auth.clearSession(request);
    auth.clearSessionCookie(reply);
    return { ok: true };
  });
}
