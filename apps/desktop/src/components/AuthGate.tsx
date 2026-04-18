import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore.js';

function AuthLoading() {
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-emerald-300/20 border-t-emerald-300" />
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Restoring your platform session</h2>
        <p className="mt-2 text-sm text-zinc-400">Checking whether VeggaAI already knows who you are.</p>
      </div>
    </div>
  );
}

function BrowserLinkLoading() {
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-emerald-300/20 border-t-emerald-300" />
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Waiting for browser approval</h2>
        <p className="mt-2 text-sm text-zinc-400">Finish sign-in in your browser. VeggaAI will reconnect this desktop app automatically as soon as the link is approved.</p>
      </div>
    </div>
  );
}

export function AuthGate() {
  const { status, enabled, googleEnabled, browserLinking, error, startGoogleLogin, startGoogleLoginInBrowser, fetchSession } = useAuthStore();

  useEffect(() => {
    if (!enabled || browserLinking) return;

    const refresh = () => {
      void fetchSession();
    };

    const interval = window.setInterval(refresh, 4000);
    const handleFocus = () => refresh();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [browserLinking, enabled, fetchSession]);

  if (!enabled) {
    return null;
  }

  const isLoading = status === 'loading';
  const isError = status === 'error';

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-zinc-950 px-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.14),transparent_28%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent" />

      <div className="relative w-full max-w-4xl overflow-hidden rounded-[28px] border border-zinc-800 bg-zinc-950/92 shadow-[0_40px_120px_rgba(0,0,0,0.65)] backdrop-blur-xl">
        <div className="grid min-h-[560px] lg:grid-cols-[1.15fr_0.85fr]">
          <div className="flex flex-col justify-between border-b border-zinc-900 p-8 lg:border-b-0 lg:border-r lg:p-12">
            <div>
              <div className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-emerald-300">
                Platform Identity
              </div>
              <h1 className="mt-6 max-w-xl text-4xl font-semibold tracking-[-0.04em] text-zinc-50 lg:text-5xl">
                One account for the shell that plans, builds, and ships.
              </h1>
              <p className="mt-5 max-w-xl text-sm leading-7 text-zinc-400 lg:text-base">
                VeggaAI now has a provider-backed session layer. Google sign-in creates a platform user, links the provider account, and persists an httpOnly session for the shell.
              </p>
              <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-500">
                After sign-in, the fastest way to feel the product is simple: capture one real page in the browser extension, then ask the desktop shell what you read and why it mattered.
              </p>
            </div>

            <div className="mt-10 grid gap-3 text-sm text-zinc-300 sm:grid-cols-3">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Provider</div>
                <div className="mt-2 text-base text-zinc-100">Google OAuth</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Session</div>
                <div className="mt-2 text-base text-zinc-100">Database-backed</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Shell</div>
                <div className="mt-2 text-base text-zinc-100">Auth-aware bootstrap</div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center p-8 lg:p-12">
            <div className="w-full max-w-md rounded-[24px] border border-zinc-800 bg-zinc-900/70 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              {browserLinking ? (
                <BrowserLinkLoading />
              ) : isLoading ? (
                <AuthLoading />
              ) : (
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.03em] text-zinc-100">
                    Sign in to continue
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-zinc-400">
                    The shell is gated because platform auth is enabled. Continue with Google to restore your working session. The desktop app now rechecks auth automatically while this screen is open.
                  </p>
                  <p className="mt-3 text-xs leading-5 text-zinc-500">
                    Once you are through this gate, look for the memory workflow in chat or settings: capture a page, then ask a grounded recall question.
                  </p>

                  {isError && (
                    <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                      {error}
                    </div>
                  )}

                  {!googleEnabled && (
                    <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-400">
                      Google OAuth is not configured yet. Set GOOGLE_WEB_OAUTH_CLIENT_ID and GOOGLE_WEB_OAUTH_CLIENT_SECRET, then reload the runtime.
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={startGoogleLogin}
                    disabled={!googleEnabled}
                    className="mt-6 flex w-full items-center justify-center gap-3 rounded-2xl bg-zinc-100 px-5 py-3 text-sm font-medium text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-950 text-xs font-semibold text-zinc-100">G</span>
                    Continue with Google
                  </button>

                  <button
                    type="button"
                    onClick={() => void startGoogleLoginInBrowser()}
                    disabled={!googleEnabled}
                    className="mt-3 w-full rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-sm text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-500"
                  >
                    Sign in via browser
                  </button>

                  <button
                    type="button"
                    onClick={() => void fetchSession()}
                    className="mt-3 w-full rounded-2xl border border-zinc-800 px-5 py-3 text-sm text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-950"
                  >
                    Check again now
                  </button>

                  <p className="mt-3 text-center text-xs text-zinc-500">
                    Manual refresh is only here as fallback. Returning from the browser should usually update this screen on its own.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}