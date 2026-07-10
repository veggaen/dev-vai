/**
 * Workspace terminal — run commands in the attached project root.
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { Terminal, Trash2, Play, Loader2 } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.js';
import { useSandboxStore } from '../../stores/sandboxStore.js';

const QUICK_COMMANDS = [
  { label: 'dev', cmd: 'pnpm dev' },
  { label: 'test', cmd: 'pnpm test' },
  { label: 'typecheck', cmd: 'pnpm exec tsc --noEmit' },
  { label: 'build', cmd: 'pnpm build' },
] as const;

/** package.json scripts surfaced as one-click actions for the attached sandbox project. */
const SANDBOX_DECK_SCRIPTS = ['build', 'lint', 'test', 'typecheck', 'check'] as const;

export function TerminalPanel() {
  const localRoot = useWorkspaceStore((s) => s.localRoot);
  const lines = useWorkspaceStore((s) => s.terminalLines);
  const terminalBusy = useWorkspaceStore((s) => s.terminalBusy);
  const runCommand = useWorkspaceStore((s) => s.runTerminalCommand);
  const clearTerminal = useWorkspaceStore((s) => s.clearTerminal);
  const sandboxLogs = useSandboxStore((s) => s.logs);
  const sandboxStatus = useSandboxStore((s) => s.status);
  const sandboxProjectName = useSandboxStore((s) => s.projectName);
  const sandboxExternal = useSandboxStore((s) => s.external);
  const availableScripts = useSandboxStore((s) => s.availableScripts);
  const commandRun = useSandboxStore((s) => s.commandRun);
  const runScript = useSandboxStore((s) => s.runScript);

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const displayLines = localRoot ? lines : sandboxLogs;

  useEffect(() => {
    if (!localRoot && sandboxLogs.length > 0) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [displayLines.length, localRoot, sandboxLogs.length]);

  const submit = useCallback(() => {
    const cmd = input.trim();
    if (!cmd || !localRoot) return;
    setInput('');
    void runCommand(cmd);
  }, [input, localRoot, runCommand]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0d0d0f]">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <Terminal size={13} className="text-emerald-400/80" />
        <span className="flex-1 text-[11px] font-medium text-[color:var(--chat-body)]">
          {localRoot
            ? 'Project terminal'
            : sandboxExternal && sandboxProjectName
              ? `Project console — ${sandboxProjectName}`
              : 'Build console'}
        </span>
        {!localRoot && availableScripts.length > 0 && (
          <div className="flex items-center gap-1">
            {SANDBOX_DECK_SCRIPTS.filter((s) => availableScripts.includes(s)).map((script) => {
              const isThisRunning = commandRun?.script === script && commandRun.status === 'running';
              const anyRunning = commandRun?.status === 'running';
              const lastState = commandRun?.script === script && commandRun.status !== 'running' ? commandRun.status : null;
              return (
                <button
                  key={script}
                  type="button"
                  disabled={anyRunning}
                  onClick={() => void runScript(script)}
                  title={isThisRunning ? `${script} is running…` : `Run "${script}" in the project (one command at a time)`}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-40 ${
                    isThisRunning
                      ? 'bg-violet-500/20 text-violet-300'
                      : lastState === 'done'
                        ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                        : lastState === 'failed'
                          ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                          : 'text-[color:var(--chat-muted)] hover:bg-white/[0.06] hover:text-[color:var(--chat-body)]'
                  }`}
                >
                  {isThisRunning && <Loader2 size={10} className="animate-spin" />}
                  {script}
                </button>
              );
            })}
          </div>
        )}
        {localRoot && (
          <div className="flex items-center gap-1">
            {QUICK_COMMANDS.map((q) => (
              <button
                key={q.label}
                type="button"
                disabled={terminalBusy}
                onClick={() => void runCommand(q.cmd)}
                className="rounded px-1.5 py-0.5 text-[10px] text-[color:var(--chat-muted)] hover:bg-white/[0.06] hover:text-[color:var(--chat-body)] disabled:opacity-40"
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => (localRoot ? clearTerminal() : undefined)}
          className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/[0.06]"
          title="Clear"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-[1.7]">
        {displayLines.length === 0 ? (
          <p className="text-[color:var(--chat-muted)] opacity-60">
            {localRoot ? 'Run a command below — output appears here' : `Sandbox ${sandboxStatus}…`}
          </p>
        ) : (
          // Flat terminal lines — global `pre` styling (chat code blocks) must
          // NOT apply here; each line as a boxed card reads terribly.
          displayLines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-words text-[color:var(--chat-muted)]">
              {line}
            </div>
          ))
        )}
      </div>

      {localRoot && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-white/[0.06] p-2">
          <span className="text-[11px] text-emerald-400/70">$</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="pnpm dev, vitest, git status…"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-[color:var(--chat-body)] outline-none focus:border-emerald-400/30"
          />
          <button
            type="button"
            disabled={terminalBusy || !input.trim()}
            onClick={submit}
            className="rounded-lg bg-emerald-600/70 p-1.5 text-white disabled:opacity-40"
          >
            {terminalBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          </button>
        </div>
      )}

      {!localRoot && sandboxStatus === 'running' && (
        <div className="shrink-0 border-t border-white/[0.06] px-3 py-1 text-[10px] text-[color:var(--chat-muted)]">
          Streaming sandbox build output…
        </div>
      )}
    </div>
  );
}

export default TerminalPanel;