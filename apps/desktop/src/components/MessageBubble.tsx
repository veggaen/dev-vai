/**
 * MessageBubble — Claude-inspired message rendering.
 *
 * User messages: right-aligned pill with subtle tinted bg, max-width ~80%.
 * Assistant messages: left-aligned, full width, no bubble — flowing markdown.
 * Action buttons: always visible on latest, hover-reveal on older messages.
 * Deploy markers, nudge/clarify pickers preserved from previous version.
 */

import { useState, useCallback } from 'react';
import { MarkdownRenderer } from '@vai/ui';
import { API_BASE } from '../lib/api.js';
import {
  Copy, Check, FileText, Rocket, HelpCircle, X as XIcon,
  CornerDownRight, User, Bot, RefreshCw, ThumbsUp, ThumbsDown,
  Sparkles,
} from 'lucide-react';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { useLayoutStore } from '../stores/layoutStore.js';
import { SourceCards } from './SourceCards.js';
import type { SearchSourceUI } from '../stores/chatStore.js';
import type { DeployIntent, RecoveryPattern } from '../lib/intent-detector.js';

interface FileAttachment {
  name: string;
  content: string;
  language: string;
}

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  imageId?: string | null;
  imagePreview?: string;
  files?: FileAttachment[];
  fallbackDeploy?: DeployIntent | null;
  recoveryPattern?: RecoveryPattern;
  allIntents?: DeployIntent[];
  onIntentAction?: (accepted: boolean) => void;
  /** Whether this is the newest message in the thread */
  isLatest?: boolean;
  /** Whether this message is currently being streamed */
  isStreaming?: boolean;
  /** Search sources for Perplexity-style citation cards */
  sources?: SearchSourceUI[];
  /** Follow-up questions the user can click */
  followUps?: string[];
  /** Confidence score (0-1) from search pipeline */
  confidence?: number;
  /** Feedback state: true=helpful, false=not helpful, undefined=no feedback */
  feedback?: boolean;
  /** Called when user gives thumbs up/down */
  onFeedback?: (helpful: boolean) => void;
  /** Called when user clicks a follow-up question */
  onFollowUp?: (question: string) => void;
}

export function MessageBubble({
  role, content, imageId, imagePreview, files,
  fallbackDeploy, recoveryPattern = 'silent', allIntents, onIntentAction,
  isLatest = false, isStreaming = false,
  sources, followUps, confidence, feedback, onFeedback, onFollowUp,
}: MessageBubbleProps) {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const [clarifyDismissed, setClarifyDismissed] = useState(false);
  const deployStack = useSandboxStore((s) => s.deployStack);
  const toggleBuilderPanel = useLayoutStore((s) => s.toggleBuilderPanel);
  const showBuilderPanel = useLayoutStore((s) => s.showBuilderPanel);

  const handleCopyAll = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  // Parse {{deploy:stackId:tier:Display Name}} markers
  const deployPattern = /\{\{deploy:(\w+):([a-z-]+):([^}]+)\}\}/g;
  const deployActions: Array<{ stackId: string; tier: string; name: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = deployPattern.exec(content)) !== null) {
    deployActions.push({ stackId: match[1], tier: match[2], name: match[3] });
  }

  const useSilentFallback = deployActions.length === 0
    && fallbackDeploy
    && recoveryPattern === 'silent'
    && !isUser;

  if (useSilentFallback && fallbackDeploy) {
    deployActions.push({
      stackId: fallbackDeploy.stackId,
      tier: fallbackDeploy.tier,
      name: fallbackDeploy.displayName,
    });
  }

  const displayContent = content.replace(deployPattern, '').trim();

  const handleDeploy = (action: { stackId: string; tier: string; name: string }) => {
    if (!showBuilderPanel) toggleBuilderPanel();
    deployStack(action.stackId, action.tier, action.name, action.tier);
    onIntentAction?.(true);
  };

  const handleNudgeDismiss = () => { setNudgeDismissed(true); onIntentAction?.(false); };
  const handleClarifyDismiss = () => { setClarifyDismissed(true); onIntentAction?.(false); };

  const showNudge = !isUser && deployActions.length === 0 && fallbackDeploy && recoveryPattern === 'nudge' && !nudgeDismissed;
  const showClarify = !isUser && deployActions.length === 0 && !fallbackDeploy && allIntents && allIntents.length > 0 && recoveryPattern === 'clarify' && !clarifyDismissed;

  const imageSrc = imagePreview || (imageId ? `${API_BASE}/api/images/${imageId}/raw` : null);

  /* ── Action buttons visibility: always on latest, hover on older ── */
  const actionVisibility = isLatest && !isStreaming
    ? 'opacity-100'
    : 'opacity-0 group-hover/msg:opacity-100';

  return (
    <div className={`group/msg mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* ── Avatar ── */}
        <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full mt-1 ${
          isUser
            ? 'bg-violet-600/15 ring-1 ring-violet-500/25'
            : 'bg-zinc-800/80 ring-1 ring-zinc-700/40'
        }`}>
          {isUser
            ? <User className="h-3.5 w-3.5 text-violet-400" />
            : <Bot className="h-3.5 w-3.5 text-zinc-400" />
          }
        </div>

        {/* ── Content column ── */}
        <div className="min-w-0 flex-1">
          {/* Role label + confidence indicator */}
          <div className={`mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider ${
            isUser ? 'justify-end text-violet-400/50' : 'text-zinc-600'
          }`}>
            <span>{isUser ? 'You' : 'Vai'}</span>
            {!isUser && confidence !== undefined && confidence < 1 && (
              <span
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-semibold tabular-nums ${
                  confidence >= 0.7
                    ? 'bg-emerald-500/10 text-emerald-500/70'
                    : confidence >= 0.4
                      ? 'bg-amber-500/10 text-amber-500/70'
                      : 'bg-red-500/10 text-red-500/60'
                }`}
                title={`Search confidence: ${Math.round(confidence * 100)}%`}
              >
                <span className={`inline-block h-1 w-1 rounded-full ${
                  confidence >= 0.7 ? 'bg-emerald-400' : confidence >= 0.4 ? 'bg-amber-400' : 'bg-red-400'
                }`} />
                {Math.round(confidence * 100)}%
              </span>
            )}
          </div>

          {/* Message body */}
          <div
            className={`relative overflow-hidden rounded-2xl transition-all duration-200 ${
              isUser
                ? 'bg-zinc-800/70 px-4 py-3 text-zinc-100 ring-1 ring-zinc-700/40'
                : 'px-1 py-0.5 text-zinc-200'
            }`}
          >
            {/* Image */}
            {imageSrc && (
              <div className={`mb-2 ${isUser ? '' : 'pl-0'}`}>
                <img
                  src={imageSrc}
                  alt="Attached screenshot"
                  className="max-h-56 w-auto rounded-lg border border-white/10"
                  loading="lazy"
                />
              </div>
            )}

            {/* File attachments */}
            {files && files.length > 0 && (
              <div className="mb-2 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-zinc-700/30 bg-zinc-800/40 px-3 py-1.5 transition-colors hover:border-zinc-600/40">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <span className="truncate text-xs font-medium text-zinc-300">{f.name}</span>
                    <span className="text-[10px] text-zinc-600">{f.language}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Source cards (Perplexity-style) — above the answer */}
            {!isUser && sources && sources.length > 0 && (
              <SourceCards sources={sources} confidence={confidence} />
            )}

            {/* Text — low confidence responses get subtle visual decay */}
            {isUser ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</p>
            ) : (
              <div className={`overflow-x-auto text-sm leading-relaxed transition-opacity duration-300 ${
                confidence !== undefined && confidence < 0.3 ? 'opacity-75' : ''
              }`}>
                <MarkdownRenderer content={displayContent} />
                {/* Streaming cursor */}
                {isStreaming && content.length > 0 && (
                  <span className="streaming-cursor" />
                )}
              </div>
            )}

            {/* Deploy actions */}
            {deployActions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-700/20 pt-3">
                {deployActions.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => handleDeploy(action)}
                    className="group/deploy flex items-center gap-1.5 rounded-lg bg-violet-600/80 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-violet-500 hover:shadow-md hover:shadow-violet-500/20"
                  >
                    <Rocket className="h-3.5 w-3.5 transition-transform group-hover/deploy:translate-x-0.5" />
                    Deploy {action.name}
                  </button>
                ))}
              </div>
            )}

            {/* Nudge */}
            {showNudge && fallbackDeploy && (
              <div className="mt-3 border-t border-zinc-700/20 pt-3">
                <div className="flex items-start gap-2">
                  <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                  <div className="flex-1">
                    <p className="text-xs text-zinc-400">
                      Want me to scaffold <span className="font-semibold text-zinc-200">{fallbackDeploy.displayName}</span>?
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => handleDeploy({ stackId: fallbackDeploy.stackId, tier: fallbackDeploy.tier, name: fallbackDeploy.displayName })}
                        className="flex items-center gap-1.5 rounded-lg bg-violet-600/80 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-violet-500"
                      >
                        <Rocket className="h-3 w-3" />
                        Yes, deploy
                      </button>
                      <button onClick={handleNudgeDismiss} className="rounded-lg border border-zinc-700/50 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300">
                        No thanks
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Clarify Picker */}
            {showClarify && allIntents && (
              <div className="mt-3 border-t border-zinc-700/20 pt-3">
                <div className="flex items-start gap-2">
                  <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <div className="flex-1">
                    <p className="mb-2 text-xs text-zinc-500">Which stack would you like?</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {allIntents.slice(0, 4).map((intent, i) => (
                        <button
                          key={i}
                          onClick={() => handleDeploy({ stackId: intent.stackId, tier: intent.tier, name: intent.displayName })}
                          className="flex items-center gap-1.5 rounded-lg border border-zinc-700/40 bg-zinc-800/40 px-2.5 py-2 text-left text-xs text-zinc-300 transition-all hover:border-zinc-500/50 hover:bg-zinc-800/80"
                        >
                          <Rocket className="h-3 w-3 shrink-0 text-zinc-600" />
                          <span className="font-medium">{intent.displayName}</span>
                        </button>
                      ))}
                    </div>
                    <button onClick={handleClarifyDismiss} className="mt-2 flex items-center gap-1 text-[10px] text-zinc-700 transition-colors hover:text-zinc-400">
                      <XIcon className="h-2.5 w-2.5" />
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Follow-up suggestion chips ── */}
          {!isUser && followUps && followUps.length > 0 && !isStreaming && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {followUps.map((q, i) => (
                <button
                  key={i}
                  onClick={() => onFollowUp?.(q)}
                  className="flex items-center gap-1 rounded-full border border-zinc-800/60 bg-zinc-900/50 px-3 py-1 text-[11px] text-zinc-500 transition-all hover:border-violet-500/40 hover:bg-violet-500/5 hover:text-zinc-300"
                >
                  <Sparkles className="h-2.5 w-2.5 text-violet-500/60" />
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* ── Action buttons row (below the message) ── */}
          {!isUser && content.length > 0 && !isStreaming && (
            <div className={`mt-1.5 flex items-center gap-1 transition-opacity duration-150 ${actionVisibility}`}>
              <button
                onClick={handleCopyAll}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300"
                title="Copy response"
              >
                {copied
                  ? <><Check className="h-3 w-3 text-emerald-400" /> Copied</>
                  : <><Copy className="h-3 w-3" /> Copy</>
                }
              </button>
              <button
                onClick={() => onFeedback?.(true)}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                  feedback === true
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-300'
                }`}
                title="Helpful"
              >
                <ThumbsUp className="h-3 w-3" />
              </button>
              <button
                onClick={() => onFeedback?.(false)}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                  feedback === false
                    ? 'bg-red-500/10 text-red-400'
                    : 'text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-300'
                }`}
                title="Not helpful"
              >
                <ThumbsDown className="h-3 w-3" />
              </button>
              <button
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300"
                title="Retry"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
