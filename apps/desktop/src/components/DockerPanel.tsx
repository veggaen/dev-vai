/**
 * DockerPanel — Docker sandbox management UI.
 *
 * Docker-Desktop-style panel showing:
 *   • Daemon status (running/stopped/not-installed)
 *   • Container list with status indicators
 *   • Start/Stop/Restart/Remove actions per container
 *   • Resource usage (CPU/memory) for running containers
 *   • Container logs viewer
 *   • Quick actions for sandbox deployment
 *
 * Accessible from the Activity Rail (Docker icon).
 */

import { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Container, Play, Square, RotateCw, Trash2, ChevronDown,
  ChevronRight, Cpu, HardDrive, RefreshCw, AlertCircle,
  CheckCircle2, XCircle, Clock, Loader2,
} from 'lucide-react';
import { useDockerStore, type DockerContainer } from '../stores/dockerStore.js';

/* ── Status badge ── */
function StatusBadge({ status }: { status: DockerContainer['status'] }) {
  const colors: Record<string, string> = {
    running: 'bg-emerald-500',
    stopped: 'bg-zinc-600',
    created: 'bg-blue-500',
    restarting: 'bg-amber-500',
    paused: 'bg-amber-500',
    exited: 'bg-red-500',
    dead: 'bg-red-700',
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className={`h-2 w-2 rounded-full ${colors[status] || 'bg-zinc-600'}`} />
      <span className="text-[10px] capitalize text-zinc-400">{status}</span>
    </div>
  );
}

/* ── Container row ── */
function ContainerRow({ container }: { container: DockerContainer }) {
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const { startContainer, stopContainer, restartContainer, removeContainer, getContainerLogs } = useDockerStore();

  const isRunning = container.status === 'running';

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await getContainerLogs(container.id);
      setLogs(data);
    } catch {
      setLogs('Failed to fetch logs');
    }
    setLogsLoading(false);
  }, [container.id, getContainerLogs]);

  const toggle = () => {
    setExpanded(!expanded);
    if (!expanded && !logs) fetchLogs();
  };

  return (
    <div className="border-b border-zinc-800/40 last:border-0">
      {/* Main row */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800/30 transition-colors"
        onClick={toggle}
      >
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500 flex-shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-zinc-500 flex-shrink-0" />
        }

        <Container className="h-3.5 w-3.5 text-zinc-500 flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-200 truncate">
              {container.name}
            </span>
            <StatusBadge status={container.status} />
          </div>
          <div className="text-[10px] text-zinc-600 truncate">
            {container.image}
            {container.ports?.length > 0 && (
              <span className="ml-1.5 text-zinc-500">
                → {container.ports.join(', ')}
              </span>
            )}
          </div>
        </div>

        {/* Resource usage for running containers */}
        {isRunning && container.cpu && (
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {container.cpu}
            </span>
            <span className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" />
              {container.memory}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {isRunning ? (
            <>
              <button
                onClick={() => stopContainer(container.id)}
                className="rounded p-1 text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                title="Stop container"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => restartContainer(container.id)}
                className="rounded p-1 text-zinc-500 hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
                title="Restart container"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => startContainer(container.id)}
                className="rounded p-1 text-zinc-500 hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors"
                title="Start container"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => removeContainer(container.id)}
                className="rounded p-1 text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                title="Remove container"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded: logs + details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mx-3 mb-2 rounded-lg border border-zinc-800/40 bg-zinc-900/50">
              {/* Details */}
              <div className="flex items-center justify-between border-b border-zinc-800/30 px-3 py-1.5">
                <span className="text-[10px] text-zinc-500">
                  Created: {new Date(container.created).toLocaleString()}
                </span>
                <button
                  onClick={fetchLogs}
                  className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <RefreshCw className={`h-3 w-3 ${logsLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {/* Logs */}
              <div className="max-h-40 overflow-y-auto p-2">
                {logsLoading ? (
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading logs...
                  </div>
                ) : logs ? (
                  <pre className="whitespace-pre-wrap text-[10px] leading-relaxed text-zinc-400 font-mono">
                    {logs}
                  </pre>
                ) : (
                  <span className="text-[10px] text-zinc-600">No logs available</span>
                )}
              </div>

              {/* Labels */}
              {container.labels && Object.keys(container.labels).length > 0 && (
                <div className="border-t border-zinc-800/30 px-3 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(container.labels).slice(0, 5).map(([k, v]) => (
                      <span key={k} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">
                        {k}={v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Daemon Status Display ── */
function DaemonStatus({ status }: { status: string }) {
  const icons: Record<string, typeof CheckCircle2> = {
    running: CheckCircle2,
    stopped: XCircle,
    error: AlertCircle,
    'not-installed': AlertCircle,
    unknown: Clock,
  };

  const colors: Record<string, string> = {
    running: 'text-emerald-400',
    stopped: 'text-red-400',
    error: 'text-red-400',
    'not-installed': 'text-amber-400',
    unknown: 'text-zinc-500',
  };

  const labels: Record<string, string> = {
    running: 'Docker Engine Running',
    stopped: 'Docker Engine Stopped',
    error: 'Docker Connection Error',
    'not-installed': 'Docker Not Installed',
    unknown: 'Checking Docker...',
  };

  const Icon = icons[status] || Clock;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/40">
      <Icon className={`h-4 w-4 ${colors[status] || 'text-zinc-500'}`} />
      <span className="text-xs font-medium text-zinc-300">
        {labels[status] || status}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DockerPanel — Main Component
   ═══════════════════════════════════════════════════════════════ */

interface DockerPanelProps {
  onClose?: () => void;
}

export function DockerPanel({ onClose }: DockerPanelProps) {
  const {
    daemonStatus, containers, loading, error,
    lastRefresh, refresh,
  } = useDockerStore();

  // Auto-refresh on mount and every 10s
  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(), 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const runningCount = containers.filter((c) => c.status === 'running').length;
  const stoppedCount = containers.filter((c) => c.status !== 'running').length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex h-10 items-center justify-between border-b border-zinc-800/40 px-3">
        <div className="flex items-center gap-2">
          <Container className="h-4 w-4 text-blue-400" />
          <span className="text-xs font-medium text-zinc-300">Docker Sandboxes</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => refresh()}
            className={`rounded p-1 text-zinc-500 hover:text-zinc-300 transition-colors ${loading ? 'animate-spin' : ''}`}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Close"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Daemon status */}
      <DaemonStatus status={daemonStatus} />

      {/* Stats bar */}
      {daemonStatus === 'running' && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-zinc-800/40 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {runningCount} running
          </span>
          <span className="flex items-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
            {stoppedCount} stopped
          </span>
          {lastRefresh && (
            <span className="ml-auto">
              Updated {new Date(lastRefresh).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mx-3 mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <p className="text-[11px] text-red-400">{error}</p>
        </div>
      )}

      {/* Container list */}
      <div className="flex-1 overflow-y-auto">
        {daemonStatus !== 'running' ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Container className="mb-3 h-10 w-10 text-zinc-700" />
            <p className="text-sm text-zinc-500 mb-2">
              {daemonStatus === 'not-installed'
                ? 'Docker is not installed'
                : daemonStatus === 'stopped'
                  ? 'Docker Engine is not running'
                  : 'Checking Docker status...'}
            </p>
            <p className="text-xs text-zinc-600 max-w-[240px]">
              {daemonStatus === 'not-installed'
                ? 'Install Docker Desktop to enable isolated sandbox containers.'
                : daemonStatus === 'stopped'
                  ? 'Start Docker Desktop to manage sandbox containers.'
                  : 'Connecting to Docker daemon...'}
            </p>
          </div>
        ) : containers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Container className="mb-3 h-10 w-10 text-zinc-700" />
            <p className="text-sm text-zinc-500 mb-1">No containers</p>
            <p className="text-xs text-zinc-600 max-w-[220px]">
              Deploy a sandbox project to create isolated Docker containers.
            </p>
          </div>
        ) : (
          containers.map((c) => <ContainerRow key={c.id} container={c} />)
        )}
      </div>

      {/* Footer with quick info */}
      {daemonStatus === 'running' && (
        <div className="border-t border-zinc-800/40 px-3 py-1.5">
          <p className="text-[9px] text-zinc-600">
            Containers are isolated: separate network, cgroup limits (512MB / 1 CPU), non-root user
          </p>
        </div>
      )}
    </div>
  );
}
