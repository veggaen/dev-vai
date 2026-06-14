import { useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, LogIn, Settings } from 'lucide-react';
import { useAuthStore } from '../stores/authStore.js';
import { useLayoutStore } from '../stores/layoutStore.js';
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
  const authUser = useAuthStore((s) => s.user);
  const isOwner = useAuthStore((s) => s.isOwner);
  const logout = useAuthStore((s) => s.logout);
  const startLogin = useAuthStore((s) => s.startLogin);

  const setActivePanel = useLayoutStore((s) => s.setActivePanel);

  const accountName = authUser?.name || authUser?.email?.split('@')[0] || 'Guest';
  const accountInitials = getUserInitials(authUser?.name, authUser?.email);
  const signedIn = authEnabled && authStatus === 'authenticated';

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
    startLogin();
    onClose();
  };

  const openSettings = () => {
    setActivePanel('settings');
    onClose();
  };

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
          <div className="border-b border-zinc-800/60 bg-zinc-950/80 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-sm font-semibold text-emerald-200">
                {accountInitials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-zinc-100">
                  {signedIn ? accountName : authEnabled ? 'Sign in to Vai' : accountName}
                </div>
                <div className="truncate text-xs text-zinc-500">
                  {signedIn ? authUser?.email : authEnabled ? 'Your workspace syncs when signed in' : 'Local workspace'}
                </div>
              </div>
            </div>
          </div>

          {isOwner && (
            <div className="px-4 py-2">
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                Owner
              </span>
            </div>
          )}

          <div className="border-t border-zinc-800/60 px-1 py-1">
            <button
              type="button"
              onClick={openSettings}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              <Settings className="h-3.5 w-3.5 text-zinc-500" />
              Settings
            </button>

            {signedIn ? (
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-red-300 transition-colors hover:bg-red-500/10"
              >
                <LogOut className="h-3.5 w-3.5 text-red-400" />
                Sign out
              </button>
            ) : authEnabled ? (
              <button
                type="button"
                onClick={handleSignIn}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-emerald-300 transition-colors hover:bg-emerald-500/10"
              >
                <LogIn className="h-3.5 w-3.5 text-emerald-400" />
                Sign in
              </button>
            ) : null}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
