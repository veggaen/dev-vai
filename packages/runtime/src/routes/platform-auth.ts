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
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, #1f2937, #09090b 58%);
        color: #f4f4f5;
        font-family: "Segoe UI", sans-serif;
      }
      main {
        width: min(560px, calc(100vw - 32px));
        padding: 28px;
        border: 1px solid rgba(244, 244, 245, 0.12);
        border-radius: 18px;
        background: rgba(24, 24, 27, 0.9);
        box-shadow: 0 32px 80px rgba(0, 0, 0, 0.35);
      }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0 0 14px; color: #d4d4d8; line-height: 1.55; }
      .card {
        margin: 18px 0;
        padding: 14px 16px;
        border-radius: 14px;
        background: rgba(39, 39, 42, 0.72);
        border: 1px solid rgba(244, 244, 245, 0.08);
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 12px 16px;
        border-radius: 12px;
        background: #2563eb;
        color: white;
        text-decoration: none;
        font-weight: 600;
        border: 0;
        cursor: pointer;
      }
      code {
        font-family: Consolas, monospace;
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(63, 63, 70, 0.7);
      }
      .muted { color: #a1a1aa; font-size: 14px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      ${body}
    </main>
  </body>
</html>`;
}

function renderAutoCloseScript(): string {
  return `<script>
window.setTimeout(() => {
  try {
    window.close();
  } catch {
    // Ignore browser tabs that cannot be closed programmatically.
  }
}, 1200);
</script>`;
}

function renderCloseButton(): string {
  return `<button class="button" type="button" onclick="window.close()">Close this tab</button>`;
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
      'Sign-in complete',
      `<p>Your VeggaAI browser sign-in finished successfully.</p>
      <div class="card">
        <p>The desktop app should reconnect on its own within a few seconds.</p>
      </div>
      ${renderCloseButton()}
      <p class="muted">This tab will try to close itself automatically.</p>
      ${renderAutoCloseScript()}`,
    );
  });

  app.get<{ Querystring: { returnTo?: string } }>(
    '/api/auth/google/start',
    async (request, reply) => {
      if (!auth.isEnabled() || !auth.isGoogleEnabled()) {
        reply.code(503);
        return { error: 'Google auth is not configured' };
      }

      const authorizationUrl = auth.buildGoogleStartUrl(request, request.query.returnTo);
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
        const loginUrl = auth.buildGoogleLoginUrl(auth.getLoginReturnTarget(request, userCode));
        reply.type('text/html; charset=utf-8');
        return renderDevicePage(
          'Sign in to continue',
          `<p>Finish linking <code>${escapeHtml(deviceLink.clientName)}</code> to this VeggaAI runtime.</p>
          <div class="card">
            <p>You are linking code <code>${escapeHtml(deviceLink.userCode)}</code>.</p>
            <p class="muted">Sign in with the VeggaAI platform account you want this client to use.</p>
          </div>
          <a class="button" href="${escapeHtml(loginUrl)}">Continue with Google</a>`,
        );
      }

      if (request.query.auto === '1') {
        await auth.approveDeviceLink(userCode, request);
        reply.type('text/html; charset=utf-8');
        return renderDevicePage(
          'Device linked',
          `<p><code>${escapeHtml(deviceLink.clientName)}</code> is now linked to <code>${escapeHtml(viewer.user.email)}</code>.</p>
          <div class="card">
            <p>The desktop app should reconnect automatically now.</p>
          </div>
          ${renderCloseButton()}
          <p class="muted">This tab will try to close itself automatically.</p>
          ${renderAutoCloseScript()}`,
        );
      }

      reply.type('text/html; charset=utf-8');
      return renderDevicePage(
        'Approve device link',
        `<p><code>${escapeHtml(deviceLink.clientName)}</code> wants to use your local VeggaAI runtime session.</p>
        <div class="card">
          <p>Signed in as <code>${escapeHtml(viewer.user.email)}</code>.</p>
          <p>Link code: <code>${escapeHtml(deviceLink.userCode)}</code>.</p>
        </div>
        <a class="button" href="/api/auth/device?userCode=${encodeURIComponent(deviceLink.userCode)}&auto=1">Approve</a>`,
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
          'Device linked',
          `<p>This client is now linked to <code>${escapeHtml(user.email)}</code>.</p>
          <div class="card">
            <p>You can close this tab and return to your client.</p>
          </div>`,
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

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/google/callback',
    async (request, reply) => {
      const { code, state, error } = request.query;

      if (error) {
        reply.code(400);
        return { error };
      }

      if (!code || !state) {
        reply.code(400);
        return { error: 'Missing Google auth code or state' };
      }

      try {
        const result = await auth.handleGoogleCallback(code, state, request);
        auth.applySessionCookie(reply, result.cookieValue);

        // Append session token as URL hash fragment so the SPA can store it
        // in localStorage (more reliable than cookies across Vite proxy).
        const returnUrl = new URL(result.returnTo);
        returnUrl.hash = `vai_token=${encodeURIComponent(result.cookieValue)}`;
        return reply.redirect(returnUrl.toString());
      } catch (callbackError) {
        reply.code(400);
        return {
          error: callbackError instanceof Error ? callbackError.message : 'Google sign-in failed',
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