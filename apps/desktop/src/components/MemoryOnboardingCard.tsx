import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDot, Download, ExternalLink, MessageSquare, Shield, Sparkles } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { useEngineStore } from '../stores/engineStore.js';

const DISMISS_KEY = 'vai-memory-onboarding-dismissed';

interface SourcePreview {
  id: string;
  title: string;
  capturedAt: string;
  sourceType: string;
}

interface MemoryOnboardingCardProps {
  onAskMemoryQuestion: (prompt: string) => void;
  onOpenSettings: () => void;
}

function isDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(DISMISS_KEY) === '1';
}

export function MemoryOnboardingCard({
  onAskMemoryQuestion,
  onOpenSettings,
}: MemoryOnboardingCardProps) {
  const { status, stats } = useEngineStore();
  const [dismissed, setDismissed] = useState(isDismissed);
  const [sources, setSources] = useState<SourcePreview[]>([]);

  useEffect(() => {
    if (status !== 'ready') return;
    void apiFetch('/api/sources')
      .then((response) => response.ok ? response.json() : [])
      .then((payload) => {
        const next = Array.isArray(payload)
          ? payload as SourcePreview[]
          : [];
        next.sort((left, right) => new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime());
        setSources(next.slice(0, 3));
      })
      .catch(() => {
        setSources([]);
      });
  }, [status]);

  const docsReady = (stats?.documentsIndexed ?? 0) > 0;
  const extensionUsed = sources.length > 0 || docsReady;

  const samplePrompt = useMemo(() => {
    const recent = sources[0];
    if (!recent) {
      return 'What have I captured recently, and what should I remember from it?';
    }
    return `What did I capture about "${recent.title}"? Explain it simply, tell me why it matters, and stay grounded in what you remember.`;
  }, [sources]);

  const dismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DISMISS_KEY, '1');
    }
  };

  if (dismissed) return null;

  return (
    <div className="mx-auto mt-8 w-full max-w-2xl rounded-[1.75rem] border border-white/[0.08] bg-white/[0.03] p-4 text-left shadow-[0_18px_80px_rgba(0,0,0,0.24)] backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-emerald-200">
            <Shield className="h-3 w-3" />
            Memory Workflow
          </div>
          <h2 className="mt-3 text-lg font-semibold tracking-[-0.03em] text-zinc-100">
            Capture a page, then ask VAI what you read.
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-zinc-400">
            This is the fastest way to feel the product: keep the runtime online, capture one real page with the browser extension, then ask a grounded memory question in chat.
          </p>
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="rounded-full border border-white/[0.08] px-3 py-1.5 text-[11px] text-zinc-500 transition-colors hover:border-white/[0.16] hover:text-zinc-300"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {[
          {
            done: status === 'ready',
            title: '1. Keep the runtime online',
            detail: status === 'ready'
              ? `Runtime ready with ${(stats?.documentsIndexed ?? 0).toLocaleString()} indexed documents.`
              : 'Start the runtime and wait for the health indicator to turn ready.',
          },
          {
            done: docsReady,
            title: '2. Capture one real page',
            detail: docsReady
              ? `${(stats?.documentsIndexed ?? 0).toLocaleString()} documents are already available for memory questions.`
              : 'Open the browser extension on any article, notes page, GitHub repo, or search result and capture it.',
          },
          {
            done: docsReady,
            title: '3. Ask a grounded memory question',
            detail: docsReady
              ? 'Use the one-click prompt below or ask what you read earlier and why it matters.'
              : 'Once at least one page is captured, ask VAI to explain it back to you.',
          },
        ].map((step) => (
          <div key={step.title} className="rounded-2xl border border-white/[0.06] bg-black/20 px-3.5 py-3">
            <div className="flex items-start gap-2">
              {step.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              ) : (
                <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
              )}
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-zinc-200">{step.title}</div>
                <div className="mt-1 text-[11px] leading-5 text-zinc-500">{step.detail}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {status === 'ready' && !extensionUsed && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-3.5 py-3">
          <Download className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-amber-200">Browser extension not set up</div>
            <div className="mt-0.5 text-[11px] leading-5 text-zinc-400">
              No captured pages yet. Install the VAI browser extension to start capturing pages, YouTube transcripts, and GitHub repos.
            </div>
          </div>
          <a
            href="https://chromewebstore.google.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
          >
            <ExternalLink className="h-3 w-3" />
            Get extension
          </a>
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-4 rounded-2xl border border-white/[0.06] bg-black/20 px-3.5 py-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            Recent captured pages
          </div>
          <div className="space-y-1.5">
            {sources.map((source) => (
              <div key={source.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium text-zinc-200">{source.title}</div>
                  <div className="text-[10px] text-zinc-500">{source.sourceType} · captured {new Date(source.capturedAt).toLocaleString()}</div>
                </div>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAskMemoryQuestion(samplePrompt)}
          disabled={!docsReady}
          className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-[12px] font-medium text-blue-200 transition-colors hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Ask a memory question
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-[12px] font-medium text-zinc-300 transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Open setup guide
        </button>
      </div>
    </div>
  );
}
