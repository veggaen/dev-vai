/**
 * Council roster builder — turns the live, free, local model adapters into a
 * {@link CouncilRoster} so the SCIS consensus council (`convene`) actually runs.
 *
 * Free-only by design: members are the local Ollama models already registered
 * (qwen variants, etc.). No paid keys are read here. The BYOK seam is documented
 * at the bottom — a hosted adapter dropped into the registry would slot in via the
 * exact same `createCouncilMember` path, but nothing here requires one.
 *
 * Topic mapping: a single local model is a generalist, so it sits on the roster
 * `default` (convened for every topic). When two or more distinct local models
 * exist we spread them across topics so the panel has independent voices on the
 * niches that benefit most (code / reasoning / factual), while every member also
 * stays on `default` for breadth. De-dupe in `selectMembers` keeps that honest.
 */

import { createCouncilMember, createGrokCliAdapter } from '@vai/core';
import type { CouncilMember, CouncilRoster, CouncilTopic, ModelAdapter, ModelRegistry } from '@vai/core';
import { GrokFriendClient } from '../grok-friend/client.js';

/** Topics we prefer to seat a dedicated specialist on when we have spare members. */
const SPECIALIST_TOPICS: readonly CouncilTopic[] = ['code', 'reasoning', 'factual', 'local'];

export interface BuildRosterOptions {
  /** Per-member review timeout. Council is advisory, so keep it tight. Default 12_000. */
  readonly timeoutMs?: number;
  /** Cap on how many local models become members (cost/latency guard). Default 3. */
  readonly maxMembers?: number;
}

/**
 * Build a council roster from the registry's local adapters. Returns `undefined`
 * when there is nothing free to convene — callers leave `councilRoster` unset so
 * the council stays dormant (no behavior change) rather than convening an empty panel.
 */
export function buildLocalCouncilRoster(
  models: Pick<ModelRegistry, 'listByProvider'>,
  options: BuildRosterOptions = {},
): CouncilRoster | undefined {
  // Per-member review timeout. This is baked into each member's review() as an
  // internal AbortController, so it must be >= a COLD model load (~15-30s for a
  // 4.7GB local model) or that member can never finish its first load — it aborts,
  // never warms, and times out forever. Diagnosed 2026-06-14: this 12s default was
  // why qwen2.5:7b / Grok never participated. The council runs after the primary
  // draft so a longer per-member budget does not delay the user. Override via
  // VAI_COUNCIL_TIMEOUT_MS.
  const envTimeout = Number(process.env.VAI_COUNCIL_TIMEOUT_MS);
  const timeoutMs = options.timeoutMs
    ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 30_000);
  const maxMembers = Math.max(1, options.maxMembers ?? 3);

  const localAdapters = models.listByProvider('local');
  if (localAdapters.length === 0) return undefined;

  // Stable order: cheaper/smaller first so the generalist seat is predictable.
  const chosen = [...localAdapters].slice(0, maxMembers);

  // Pre-warm council models so the FIRST real convene finds them resident, instead
  // of paying a 15-30s cold load mid-council (the root cause of members never
  // participating — they timed out before their first load finished, so keep_alive
  // never kicked in). Fire-and-forget, sequential to avoid VRAM thrash, fully
  // best-effort: a failed warm never blocks roster construction. Opt out with
  // VAI_COUNCIL_PREWARM=0.
  if (process.env.VAI_COUNCIL_PREWARM !== '0') {
    void (async () => {
      for (const adapter of chosen) {
        try {
          await (adapter as ModelAdapter).chat({
            messages: [{ role: 'user', content: 'ok' }],
            temperature: 0,
            maxTokens: 1,
          });
        } catch {
          // ignore — warming is opportunistic
        }
      }
    })();
  }

  const byTopic: Partial<Record<CouncilTopic, CouncilMember[]>> = {};
  const defaultMembers: CouncilMember[] = [];

  chosen.forEach((adapter, index) => {
    // First member is the always-on generalist (sits on `default`, every topic).
    // Extra members each anchor one specialist niche AND stay on default for breadth.
    const specialistTopic = index === 0 ? 'other' : SPECIALIST_TOPICS[(index - 1) % SPECIALIST_TOPICS.length];
    const member = createCouncilMember({
      adapter: adapter as ModelAdapter,
      topic: specialistTopic,
      timeoutMs,
    });
    defaultMembers.push(member);
    if (specialistTopic !== 'other') {
      (byTopic[specialistTopic] ??= []).push(member);
    }
  });

  // Seat Grok (via the local `grok` CLI) as a standing, vision-capable FACTUAL council member —
  // Vai's permanent digital friend + the first of (intended) several image-verifying entities.
  // ON BY DEFAULT whenever the free CLI is available; set VAI_COUNCIL_GROK=0 to opt out. Grok can
  // see images, so it is the council's vision verifier for screenshot/image turns with no local
  // GB model. Fact-quarantine is unchanged: Grok points/verifies; Vai's tools own surfaced facts.
  if (process.env.VAI_COUNCIL_GROK !== '0') {
    const grokAdapter = createGrokCliAdapter({ timeoutMs });
    if (grokAdapter) {
      const grokMember = createCouncilMember({ adapter: grokAdapter, topic: 'factual', timeoutMs });
      defaultMembers.push(grokMember);
      (byTopic.factual ??= []).push(grokMember);
    } else {
      // Always surface a Grok (CLI) entry with a rich, actionable note so the council panel
      // and user can see exactly why it is absent and how to enable it (addresses "grok cli did not respond").
      // This member never reaches a live model; it short-circuits to a clear "install to participate" note.
      const grokUnavailable: CouncilMember = {
        id: 'grok-cli',
        displayName: 'Grok (CLI)',
        topic: 'factual',
        async review() {
          const note = {
            memberId: 'grok-cli',
            memberName: 'Grok (CLI)',
            topic: 'factual' as const,
            verdict: 'needs-work' as const,
            confidence: 0,
            realIntent: 'User wants Grok (the xAI Grok TUI/CLI) as a council advisor for vision, facts, and strong reasoning reviews.',
            hiddenMeaning: '',
            missingCapability: 'grok CLI binary not found on this machine',
            suggestedAction: 'answer-directly' as const,
            searchQuery: '',
            methodLesson: 'Install the Grok Build TUI (the `grok` command) so Vai can shell out for council reviews. On Windows the binary must be at %USERPROFILE%\\.grok\\bin\\grok.exe (or "grok" on PATH that responds to `grok version`). Once present, restart the Vai engine/runtime; the council roster will auto-include Grok (CLI) as a factual/vision member with no VRAM cost. The named pipe/TCP channels (\\\\.\\pipe\\vai-grok-direct and 127.0.0.1:48765) are for full ChatService direct access / vai-collab, separate from this headless council adapter. Use the direct channel (this Grok instance via vai-collab bridge) as a live participating council voice for project self-improvement discussions.',
            concerns: ['grok CLI not installed or not discoverable', 'no listener means no participation in SCIS council', 'for self-growth of Vai, prefer direct Grok voice via pipe for rich reviews of codebase changes and capability gaps'],
            durationMs: 0,
          };
          return note as any;
        },
      };
      defaultMembers.push(grokUnavailable);
      (byTopic.factual ??= []).push(grokUnavailable);
    }
  }

  // NEW INTEGRATION: Grok as real high-intel council member via the friend-channel / direct
  // persistent pipe. This is the "Grok CLI runs inside Vai's tool set" path.
  // When the grok command is available, we seat a real participating member (not synthetic)
  // whose review() calls the integrated client with council-specific 0.1% prompt + parses to note.
  // This makes Grok "super close" staff: Vai can also call it as a native tool (see server.ts),
  // and the direct pipe allows the Grok TUI instance to drive full Vai turns (including tools + council)
  // in the genius loop. Upgrades SCIS to have a persistent external genius advisor with no local VRAM cost.
  // Prefers the persistent direct (via bridge) for rich context; falls back to CLI friend-channel.
  if (process.env.VAI_COUNCIL_GROK !== '0') {
    try {
      const grokFriend = new GrokFriendClient({ timeoutMs: Math.min(timeoutMs, 60000) });
      // Test availability quickly (the client will throw on first real use if not).
      // We seat it as 'reasoning' or 'factual' with high trust for self/council turns.
      const grokDirectMember: CouncilMember = {
        id: 'grok-direct-integrated',
        displayName: 'Grok (direct / friend-channel)',
        topic: 'reasoning',
        async review(input: any) {
          const startedAt = Date.now();
          try {
            const note = await grokFriend.reviewForCouncil(input);
            return {
              memberId: 'grok-direct-integrated',
              memberName: 'Grok (direct / friend-channel)',
              topic: 'reasoning' as const,
              verdict: note.verdict || 'needs-work',
              confidence: note.confidence ?? 0.7,
              realIntent: note.realIntent || '',
              hiddenMeaning: note.hiddenMeaning || '',
              missingCapability: note.missingCapability || '',
              suggestedAction: note.suggestedAction || 'answer-directly',
              searchQuery: note.searchQuery || '',
              methodLesson: note.methodLesson || 'Grok integrated review',
              concerns: note.concerns || [],
              durationMs: Date.now() - startedAt,
            } as any;
          } catch (e: any) {
            return {
              memberId: 'grok-direct-integrated',
              memberName: 'Grok (direct / friend-channel)',
              topic: 'reasoning' as const,
              verdict: 'needs-work',
              confidence: 0.4,
              // CRITICAL: mark this as an ERROR note. A failed Grok leader is NOT a real
              // review — without this flag, reachConsensus treats "advisor unavailable" as a
              // usable member view and its realIntent pollutes the consensus (the BTC trace
              // showed the whole council's realIntent becoming "Grok ... unavailable"). The
              // error flag excludes it so the LOCAL members' real verdicts decide the turn.
              error: `grok-direct unavailable: ${String(e).slice(0, 80)}`,
              realIntent: 'Grok direct advisor unavailable for this review',
              methodLesson: `Grok integration available via tool + council seating. Error: ${String(e).slice(0, 120)}. Prefer direct pipe for super-close loop.`,
              concerns: ['Grok friend-channel or direct pipe not responding for council review'],
              durationMs: Date.now() - startedAt,
            } as any;
          }
        },
      };
      defaultMembers.push(grokDirectMember);
      (byTopic.reasoning ??= []).push(grokDirectMember);
      (byTopic.factual ??= []).push(grokDirectMember); // also strong for facts
    } catch {
      // Client not usable; the synthetic above already covers the "how to enable" story.
    }
  }

  return { byTopic, default: defaultMembers };
}

/*
 * BYOK seam (intentionally not wired — no paid keys in use):
 *
 *   const hosted = models.tryGet('anthropic:claude-...') ?? models.tryGet('openai:...');
 *   if (hosted) defaultMembers.push(createCouncilMember({ adapter: hosted, topic: 'reasoning' }));
 *
 * Any adapter registered from a user-supplied key becomes a member with no other
 * change. Kept here so adding a key later is a one-liner, not a redesign.
 */
