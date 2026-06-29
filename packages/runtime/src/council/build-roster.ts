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

import { buildLocalLensMembers, buildRoleMembers, assignModelsToRoles, LOCAL_COUNCIL_ROLES, createCouncilMember, createGrokCliAdapter, createCouncilContextTools, runCommandEvidence, MemberAvailabilityStore } from '@vai/core';
import type { DiscoveredOllamaModel } from '@vai/core';
import type { CouncilContextTools, CouncilMember, CouncilMemberNote, CouncilRoster, CouncilTopic, ModelAdapter, ModelRegistry, ProofRunner } from '@vai/core';
import { GrokFriendClient } from '../grok-friend/client.js';
import { nicheTopicForModel } from './model-niche-catalog.js';

/** Topics we prefer to seat a dedicated specialist on when we have spare members. */
const SPECIALIST_TOPICS: readonly CouncilTopic[] = ['code', 'reasoning', 'factual', 'local'];

/**
 * Shared, process-lifetime availability tracker. The roster is rebuilt per turn but this
 * persists, so a member that failed (e.g. Grok out of credits / 403) is SKIPPED on the next
 * turns until its cooldown elapses — the council stops wasting cycles on a dead member, and
 * the recorded reason + fix hint can be surfaced to the user. Exposed for the UI / a status
 * route.
 */
export const councilAvailability = new MemberAvailabilityStore();

/**
 * Wrap a member's review so its availability is tracked: SKIP (return an error-marked note,
 * which reachConsensus excludes) while the member is in its failure cooldown; on a real
 * failure (throw, null, or an error-marked note) record WHY so we back off; on a usable note
 * record success so the member is trusted again. This is what makes "know why a member is
 * down, stop retrying until resolved" real.
 */
function wrapWithAvailability(member: CouncilMember): CouncilMember {
  return {
    ...member,
    async review(input, opts) {
      if (!councilAvailability.shouldTry(member.id)) {
        const state = councilAvailability.get(member.id);
        return {
          memberId: member.id,
          memberName: member.displayName,
          topic: member.topic,
          verdict: 'needs-work',
          confidence: 0,
          realIntent: '',
          hiddenMeaning: '',
          missingCapability: '',
          suggestedAction: 'answer-directly',
          searchQuery: '',
          methodLesson: '',
          concerns: [],
          durationMs: 0,
          // Error-marked → excluded from consensus; carries the reason + fix for the trace.
          error: `skipped (${state?.reason ?? 'unavailable'}): ${state?.fixHint ?? 'in cooldown'}`,
        } satisfies CouncilMemberNote;
      }
      try {
        // Thread `opts` (incl. onReasoningDelta) through so the live reasoning stream reaches
        // the model — the availability wrapper must be transparent to the streaming callback.
        const note = await member.review(input, opts);
        if (!note || note.error) {
          councilAvailability.recordFailure(member.id, member.displayName, note?.error ?? 'no usable response');
          return note;
        }
        councilAvailability.recordSuccess(member.id);
        return note;
      } catch (error) {
        councilAvailability.recordFailure(member.id, member.displayName, error);
        throw error;
      }
    },
  };
}

export interface BuildRosterOptions {
  /** Per-member review timeout. Council is advisory, so keep it tight. Default 12_000. */
  readonly timeoutMs?: number;
  /** Cap on how many local models become members (cost/latency guard). Default 3. */
  readonly maxMembers?: number;
  /**
   * Seat Grok (CLI / friend-channel) as a council member. OFF by default now: Grok is a
   * paid external voice that kept getting called every turn even when out of credits. The
   * desktop "council members" settings toggle drives this; falls back to the
   * VAI_COUNCIL_GROK env opt-in when unset. See {@link grokEnabledFromEnv}.
   */
  readonly enableGrok?: boolean;
  /**
   * Number of distinct LENS passes to run the generalist local model through (skeptic,
   * pragmatist, capability-gap hunter, intent reader, ...). Each lens is a separate council
   * member built on the SAME local adapter with a different review framing, so a single local
   * model produces independent angles to mix and re-judge. Default 1 (no extra angles). Driven
   * by VAI_COUNCIL_LENSES; capped to the available lens definitions.
   */
  readonly localLensCount?: number;
  /**
   * Repo root to seat the read-only "pull model" context tools at. When set, every LOCAL
   * member gets {@link CouncilContextTools} (readFile/grep/listFiles, sandboxed to this root)
   * and may fetch the evidence its lens needs before voting. Grok members are external and
   * don't get filesystem tools. Omit to keep members prompt-only (current behavior). Driven by
   * VAI_COUNCIL_CONTEXT_ROOT when unset.
   */
  readonly contextRoot?: string;
}

/**
 * Grok is OFF unless explicitly opted in. We treat the absence of the env var as "off" (the
 * new default) and only enable on an explicit truthy value. The desktop toggle sets this env
 * for the runtime, but an explicit {@link BuildRosterOptions.enableGrok} always wins.
 */
export function grokEnabledFromEnv(): boolean {
  const raw = (process.env.VAI_COUNCIL_GROK ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

/** True when capability-probe role assignment is enabled (default OFF — unchanged behavior). */
export function roleAssignEnabledFromEnv(): boolean {
  return /^(1|true|on|yes)$/i.test((process.env.VAI_COUNCIL_ROLE_ASSIGN ?? '').trim());
}

/** Parse a billions-of-params estimate from an Ollama model id/name, e.g. "qwen3:8b" → 8. */
function paramBFromName(name: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*b\b/i.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Project the runtime's local ADAPTERS into the minimal `DiscoveredOllamaModel` shape the
 * capability probe (`assignModelsToRoles`) consumes. We don't re-query Ollama here — the
 * adapters are already the discovered models; we just estimate size from the name (good enough
 * to rank strongest→weakest, which is all the probe needs). thinking is inferred from the id.
 */
function adaptersToDiscovered(adapters: readonly ModelAdapter[]): DiscoveredOllamaModel[] {
  return adapters.map((a) => {
    const name = a.id.replace(/^local:/, '');
    const parameterB = paramBFromName(name);
    return {
      name,
      sizeBytes: (parameterB ?? 0) * 1e9,
      parameterB,
      contextWindow: null,
      thinking: /deepseek|r1|think|reason/i.test(name),
      toolUse: false,
      vision: false,
      embedding: /embed/i.test(name),
    };
  });
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
  // Grok: explicit option wins; otherwise opt-in via env (default OFF).
  const enableGrok = options.enableGrok ?? grokEnabledFromEnv();
  // Multi-angle local council: how many lens passes to run the generalist model through. Explicit
  // option wins; otherwise VAI_COUNCIL_LENSES; default 1 (no extra angles — unchanged behavior).
  // Clamped to the number of defined lenses by buildLocalLensMembers.
  const envLenses = Number(process.env.VAI_COUNCIL_LENSES);
  const localLensCount = options.localLensCount
    ?? (Number.isFinite(envLenses) && envLenses > 0 ? Math.floor(envLenses) : 1);

  // Pull-model: seat read-only context tools for local members so they fetch + verify their
  // own evidence before voting. Explicit option wins; otherwise VAI_COUNCIL_CONTEXT_ROOT. The
  // member only fetches when its lens judges it relevant (it returns no requests otherwise), so
  // this adds no latency to simple turns. Read-only + sandboxed to the root (see context-tools).
  const contextRoot = options.contextRoot ?? (process.env.VAI_COUNCIL_CONTEXT_ROOT?.trim() || undefined);
  const contextTools: CouncilContextTools | undefined = contextRoot
    ? createCouncilContextTools(contextRoot)
    : undefined;

  // Experiment loop: when VAI_COUNCIL_PROOF=1, seat a proof runner so a member can run ONE
  // allowlisted command to verify its claim before presenting (proved boosts its vote, disproved
  // discounts it). OFF by default — running a command per member per turn is heavier, so it's
  // opt-in for self-improvement / code work. Bounded + allowlist-gated inside runCommandEvidence.
  const proofEnabled = /^(1|true|on|yes)$/i.test((process.env.VAI_COUNCIL_PROOF ?? '').trim());
  const proofRunner: ProofRunner | undefined = proofEnabled
    ? (command, args, opts) => runCommandEvidence(command, args, { cwd: opts.cwd ?? contextRoot, timeoutMs: opts.timeoutMs })
    : undefined;

  const localAdapters = models.listByProvider('local');
  if (localAdapters.length === 0) return undefined;

  // Selection order matters when maxMembers caps the panel: a recognized NICHE
  // specialist (DeepSeek-R1 → reasoning, a coder model → code) must win a seat over a
  // generic generalist, otherwise the first-discovered models fill the cap and the
  // specialist you deliberately pulled never participates (the bug where deepseek-r1:8b
  // sat unused behind two qwen generalists). We keep a STABLE sort: specialists first,
  // generalists after, original order preserved within each group. The first generalist
  // still anchors the `default` seat below. When maxMembers is large enough to seat
  // everyone (the "all installed models" default), the sort is a no-op on membership and
  // only affects which model anchors which topic.
  const ranked = [...localAdapters]
    .map((adapter, originalIndex) => ({
      adapter,
      originalIndex,
      isSpecialist: nicheTopicForModel((adapter as ModelAdapter).id) !== null,
    }))
    .sort((a, b) => {
      if (a.isSpecialist !== b.isSpecialist) return a.isSpecialist ? -1 : 1;
      return a.originalIndex - b.originalIndex;
    })
    .map((entry) => entry.adapter);
  const chosen = ranked.slice(0, maxMembers);

  // Pre-warm so the FIRST real convene finds a member resident instead of paying a
  // 15-30s cold load mid-council (the root cause of members never participating — they
  // timed out before their first load finished). ANTI-CRASH: warm only the FIRST member
  // (the anchor) and with a SHORT keep_alive, so we don't pin every installed model in
  // VRAM at boot — with "seat all models" that would be the combined-load crash. The
  // remaining members load lazily on their turn and evict promptly (short keep_alive in
  // member.review), so only one council model is resident at a time. Set
  // VAI_COUNCIL_PREWARM=all to warm every member (only safe with plenty of VRAM), or
  // VAI_COUNCIL_PREWARM=0 to disable.
  const prewarmMode = (process.env.VAI_COUNCIL_PREWARM ?? '').trim().toLowerCase();
  if (prewarmMode !== '0') {
    const toWarm = prewarmMode === 'all' ? chosen : chosen.slice(0, 1);
    const warmKeepAlive = process.env.VAI_COUNCIL_KEEP_ALIVE?.trim() || '20s';
    void (async () => {
      for (const adapter of toWarm) {
        try {
          await (adapter as ModelAdapter).chat({
            messages: [{ role: 'user', content: 'ok' }],
            temperature: 0,
            maxTokens: 1,
            keepAlive: warmKeepAlive,
          });
        } catch {
          // ignore — warming is opportunistic
        }
      }
    })();
  }

  const byTopic: Partial<Record<CouncilTopic, CouncilMember[]>> = {};
  const defaultMembers: CouncilMember[] = [];

  // CAPABILITY-PROBE ROLE ASSIGNMENT (flag-gated VAI_COUNCIL_ROLE_ASSIGN=1, default OFF).
  // Instead of one generalist adapter run through N lenses, seat EACH Thorsen role on the
  // model the probe judged best for its tier (strongest model → highest tier). Needs ≥2 chosen
  // models to be worth it. When it seats a role panel, we SKIP the per-adapter loop below but
  // still flow through the shared availability-wrapping + roster assembly at the end (pattern
  // fidelity — role members must be wrapped + returned exactly like every other member).
  let rolePanelSeated = false;
  if (roleAssignEnabledFromEnv() && chosen.length >= 2) {
    const discovered = adaptersToDiscovered(chosen as ModelAdapter[]);
    const byName = new Map((chosen as ModelAdapter[]).map((a) => [a.id.replace(/^local:/, ''), a]));
    const assignments = assignModelsToRoles(discovered, LOCAL_COUNCIL_ROLES);
    const seats = assignments
      .filter((a) => a.modelName && byName.has(a.modelName))
      .map((a) => ({ role: a.role, adapter: byName.get(a.modelName!)! }));
    if (seats.length > 0) {
      defaultMembers.push(...buildRoleMembers({ seats, topic: 'other', timeoutMs, contextTools, proofRunner }));
      rolePanelSeated = true;
    }
    // No usable seats (shouldn't happen with chosen.length>=2) → fall through to default path.
  }

  if (!rolePanelSeated) chosen.forEach((adapter, index) => {
    // Topic seating: a recognized NICHE specialist (DeepSeek-R1 → reasoning, a coder model →
    // code, etc.) seats on its strength via the catalog; everything else uses the positional
    // spread. The first member still anchors `default` (generalist) unless it's a clear niche.
    const niche = nicheTopicForModel((adapter as ModelAdapter).id);
    const positional = index === 0 ? 'other' : SPECIALIST_TOPICS[(index - 1) % SPECIALIST_TOPICS.length];
    const specialistTopic: CouncilTopic = niche ? niche.topic : positional;

    // Multi-angle local council: when asked for >1 lens, the GENERALIST seat (index 0) is
    // expanded into several lens members on the same adapter — independent voices (skeptic,
    // pragmatist, capability-gap hunter, intent reader) instead of one. This is how the council
    // gets real deliberation from a single free local model and stops needing a paid voice.
    if (index === 0 && localLensCount > 1 && !niche) {
      const lensMembers = buildLocalLensMembers({
        adapter: adapter as ModelAdapter,
        topic: 'other',
        count: localLensCount,
        timeoutMs,
        contextTools,
        proofRunner,
      });
      defaultMembers.push(...lensMembers);
      return;
    }

    const member = createCouncilMember({
      adapter: adapter as ModelAdapter,
      topic: specialistTopic,
      timeoutMs,
      contextTools,
      proofRunner,
    });
    defaultMembers.push(member);
    if (specialistTopic !== 'other') {
      (byTopic[specialistTopic] ??= []).push(member);
    }
  });

  // Seat Grok (via the local `grok` CLI) as a standing, vision-capable FACTUAL council member —
  // Vai's permanent digital friend + the first of (intended) several image-verifying entities.
  // OFF BY DEFAULT now (see {@link grokEnabledFromEnv}): Grok is a paid external voice and kept
  // being consulted every turn even when out of credits. Enable it from the desktop "council
  // members" toggle (sets enableGrok) or VAI_COUNCIL_GROK=1. When enabled Grok can see images, so
  // it is the council's vision verifier for screenshot/image turns with no local GB model.
  // Fact-quarantine is unchanged: Grok points/verifies; Vai's tools own surfaced facts.
  if (enableGrok) {
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
  if (enableGrok) {
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

  // Wrap every member with availability tracking so a failing member (Grok 0 credits / 403,
  // a timing-out local model) is recorded with its reason and skipped on subsequent turns
  // until its cooldown elapses — and trusted again the moment it succeeds.
  const wrappedDefault = defaultMembers.map(wrapWithAvailability);
  const wrappedByTopic: Partial<Record<CouncilTopic, CouncilMember[]>> = {};
  // Preserve identity across topic buckets: wrap each distinct member once, reuse the wrapper.
  const wrapperById = new Map(wrappedDefault.map((m) => [m.id, m] as const));
  const wrapOnce = (m: CouncilMember): CouncilMember => {
    const existing = wrapperById.get(m.id);
    if (existing) return existing;
    const w = wrapWithAvailability(m);
    wrapperById.set(m.id, w);
    return w;
  };
  for (const [topic, members] of Object.entries(byTopic)) {
    if (members) wrappedByTopic[topic as CouncilTopic] = members.map(wrapOnce);
  }

  return { byTopic: wrappedByTopic, default: wrappedDefault };
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
