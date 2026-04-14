import { useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, LogIn, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../stores/authStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { toast } from 'sonner';

function getUserInitials(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name?.trim() || email?.trim() || 'V').replace(/@.*$/, '');
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

interface UserPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
}

export function UserPopover({ open, onClose, anchorRect }: UserPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  const authEnabled = useAuthStore((s) => s.enabled);
  const authStatus = useAuthStore((s) => s.status);
  const googleEnabled = useAuthStore((s) => s.googleEnabled);
  const authUser = useAuthStore((s) => s.user);
  const isOwner = useAuthStore((s) => s.isOwner);
  const fetchSession = useAuthStore((s) => s.fetchSession);
  const logout = useAuthStore((s) => s.logout);
  const startGoogleLogin = useAuthStore((s) => s.startGoogleLogin);
  const syncBootstrap = useAuthStore((s) => s.syncBootstrap);

  const bootstrap = useSettingsStore((s) => s.bootstrap);
  const fetchBootstrap = useSettingsStore((s) => s.fetchBootstrap);

  const bootstrapAuth = bootstrap?.auth;
  const effectiveAuthEnabled = authEnabled || bootstrapAuth?.enabled || false;
  const effectiveGoogleEnabled = googleEnabled || bootstrapAuth?.providers.google.enabled || false;
  const accountName = authUser?.name || authUser?.email?.split('@')[0] || 'Platform account';
  const accountInitials = getUserInitials(authUser?.name, authUser?.email);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, handleClickOutside]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleRefreshAuth = async () => {
    try {
      const nextBootstrap = await fetchBootstrap();
      syncBootstrap(nextBootstrap?.auth);
      await fetchSession();
      const authState = useAuthStore.getState();
      if (authState.enabled && authState.status === 'authenticated') {
        toast.success('Session restored');
      } else if (authState.enabled) {
        toast.message('Platform auth is enabled but not signed in.');
      } else {
        toast.error('Platform auth appears disabled.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to refresh auth');
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Signed out');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to sign out');
    }
  };

  const handleSignIn = () => {
    startGoogleLogin();
    onClose();
  };

  // Position the popover above the anchor, aligned to the left edge of the rail
  const popoverStyle: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        left: anchorRect.right + 8,
        bottom: window.innerHeight - anchorRect.bottom,
        zIndex: 9999,
      }
    : { position: 'fixed', left: 56, bottom: 48, zIndex: 9999 };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, scale: 0.95, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 4 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          style={popoverStyle}
          className="w-64 overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900 shadow-2xl shadow-black/40"
        >
          {/* Header */}
          <div className="border-b border-zinc-800/60 bg-zinc-950/80 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-sm font-semibold text-emerald-200">
                {accountInitials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-zinc-100">
                  {effectiveAuthEnabled
                    ? authStatus === 'authenticated'
                      ? accountName
                      : 'Not signed in'
                    : 'Local mode'}
                </div>
                <div className="truncate text-xs text-zinc-500">
                  {authStatus === 'authenticated' ? authUser?.email : effectiveAuthEnabled ? 'Sign in required' : 'No auth enforcement'}
                </div>
              </div>
            </div>
          </div>

          {/* Info rows */}
          <div className="space-y-0 px-1 py-1">
            {/* Status row */}
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-zinc-500">Status</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                authStatus === 'authenticated'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : effectiveAuthEnabled
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-500'
              }`}>
                {authStatus === 'authenticated' ? 'Signed in' : effectiveAuthEnabled ? 'Needs auth' : 'Local'}
              </span>
            </div>

            {/* Provider row */}
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-zinc-500">Provider</span>
              <span className="text-xs text-zinc-300">{effectiveGoogleEnabled ? 'Google OAuth' : 'Unavailable'}</span>
            </div>

            {/* Owner badge */}
            {isOwner && (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-zinc-500">Role</span>
                <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-200">Owner</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="border-t border-zinc-800/60 px-1 py-1">
            <button
              onClick={() => void handleRefreshAuth()}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              <RefreshCw className="h-3.5 w-3.5 text-zinc-500" />
              Check auth
            </button>

            {effectiveAuthEnabled && authStatus === 'authenticated' ? (
              <button
                onClick={() => void handleLogout()}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-red-300 transition-colors hover:bg-red-500/10"
              >
                <LogOut className="h-3.5 w-3.5 text-red-400" />
                Sign out
              </button>
            ) : effectiveAuthEnabled && effectiveGoogleEnabled ? (
              <button
                onClick={handleSignIn}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-emerald-300 transition-colors hover:bg-emerald-500/10"
              >
                <LogIn className="h-3.5 w-3.5 text-emerald-400" />
                Sign in with Google
              </button>
            ) : null}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
