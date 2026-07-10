import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore.js';

function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function AuthLoading({ browserLinking }: { browserLinking: boolean }) {
  return (
    <div className="space-y-5 text-center" aria-live="polite">
      <div className="mx-auto h-11 w-11 animate-spin rounded-full border-2 border-emerald-300/20 border-t-emerald-300 motion-reduce:animate-none" />
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-zinc-100">
          {browserLinking ? 'Finish Sign-In In Your Browser' : 'Restoring Your Session'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          {browserLinking
            ? 'Vai will reconnect this app as soon as you approve the sign-in.'
            : 'Checking your account and workspace access.'}
        </p>
      </div>
    </div>
  );
}

/**
 * Runtime unreachable ≠ signed out. Showing sign-in buttons here caused daily
 * needless re-auth: every runtime restart flashed the login panel and users
 * clicked through the whole provider dance while their session was still valid.
 */
function AuthReconnecting() {
  return (
    <div className="space-y-5 text-center" aria-live="polite">
      <div className="mx-auto h-11 w-11 animate-spin rounded-full border-2 border-amber-300/20 border-t-amber-300 motion-reduce:animate-none" />
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-zinc-100">
          Connecting To Your Workspace
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          The local runtime isn’t answering yet — usually it’s just starting up.
          You’re still signed in; this reconnects on its own.
        </p>
      </div>
    </div>
  );
}

function WorkspaceBenefit({ title, body }: { title: string; body: string }) {
  return (
    <li className="border-l border-zinc-800 pl-4">
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      <p className="mt-1 text-sm leading-6 text-zinc-500">{body}</p>
    </li>
  );
}

export function AuthGate() {
  const {
    status,
    enabled,
    providerId,
    providerLabel,
    browserLinking,
    error,
    startLogin,
    startLoginInBrowser,
    fetchSession,
  } = useAuthStore();

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

  const desktop = isDesktopApp();
  const isLoading = status === 'loading';
  const isReconnecting = status === 'error';
  const providerName = providerLabel ?? 'your identity provider';
  const providerGlyph = providerName.slice(0, 1).toUpperCase() || 'V';
  const signIn = desktop ? () => void startLoginInBrowser() : startLogin;

  return (
    <main className="relative grid min-h-screen place-items-center overflow-x-hidden bg-[#090b0d] px-6 py-8 text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_10%,rgba(16,185,129,0.11),transparent_34%),radial-gradient(circle_at_90%_90%,rgba(59,130,246,0.08),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/50 to-transparent" />

      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-zinc-800/90 bg-zinc-950/88 shadow-[0_32px_100px_rgba(0,0,0,0.48)] backdrop-blur-xl lg:grid-cols-[1.1fr_0.9fr]">
        <div className="flex flex-col justify-between border-b border-zinc-900 px-7 py-8 lg:border-b-0 lg:border-r lg:px-11 lg:py-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-300/20 bg-emerald-300/10 text-sm font-semibold text-emerald-200">
                V
              </div>
              <div>
                <div className="text-sm font-semibold tracking-[0.16em] text-zinc-200">VAI</div>
                <div className="text-xs text-zinc-500">Your workspace</div>
              </div>
            </div>

            <h1 className="mt-10 max-w-xl text-balance text-4xl font-semibold tracking-[-0.055em] text-zinc-50 lg:text-5xl">
              Your Work, Your Context, One Room.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-sm leading-7 text-zinc-400 lg:text-base">
              Vai keeps your conversations, projects, and collaborators together while you decide which tools and models join the work.
            </p>
          </div>

          <ul className="mt-10 grid gap-5 sm:grid-cols-3 lg:grid-cols-1">
            <WorkspaceBenefit title="Pick Up Where You Left Off" body="Return to the same project context across desktop and web." />
            <WorkspaceBenefit title="Invite With Intention" body="Share projects with clear roles instead of handing over everything." />
            <WorkspaceBenefit title="Stay In Control" body="Use local reasoning first and add external tools when they earn their place." />
          </ul>
        </div>

        <div className="flex items-center justify-center px-7 py-8 lg:px-10 lg:py-10">
          <div className="w-full max-w-sm">
            {browserLinking || isLoading ? (
              <AuthLoading browserLinking={browserLinking} />
            ) : isReconnecting ? (
              <AuthReconnecting />
            ) : (
              <>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-300">Welcome To Vai</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-zinc-50">Sign In To Your Workspace</h2>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  Continue with {providerName}. New here? Your account is created during your first sign-in.
                </p>

                {error && (
                  <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100" aria-live="polite">
                    {error}
                  </div>
                )}

                {!providerId && (
                  <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm leading-6 text-zinc-400" aria-live="polite">
                    Sign-in is not ready yet. Ask the workspace owner to finish the identity provider setup.
                  </div>
                )}

                <button
                  type="button"
                  onClick={signIn}
                  disabled={!providerId}
                  className="mt-7 flex w-full touch-manipulation items-center justify-center gap-3 rounded-xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-950 text-xs font-semibold text-zinc-100" aria-hidden="true">
                    {providerGlyph}
                  </span>
                  {desktop ? 'Open Browser To Sign In' : `Continue With ${providerName}`}
                </button>

                <button
                  type="button"
                  onClick={() => void fetchSession()}
                  className="mt-3 w-full touch-manipulation rounded-xl px-5 py-2.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                >
                  Refresh Session
                </button>

                <p className="mt-5 text-center text-xs leading-5 text-zinc-600">
                  Your workspace access follows the permissions set for each shared project.
                </p>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
