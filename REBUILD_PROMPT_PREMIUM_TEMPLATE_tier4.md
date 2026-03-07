# REBUILD PROMPT — Freedom Store™

> **Purpose:** Hand this entire file to any AI coding agent to build Freedom Store™ from scratch. It describes every mechanism, every UI/UX pattern, every interaction detail, and the design philosophy that makes this product feel alive. The AI chooses the optimal stack — the spec defines **what** to build and **how it must feel**.
>
> **Origin:** Rebuilt from a working production app (Next.js 16 / Hapi.js / Prisma / Neon PostgreSQL). This prompt distills what worked, fixes what didn't, and adds the missing UI layer that makes everything feel like a $100M product instead of a side project.

---

## Why This Exists

This isn't another CRUD marketplace. It's a sovereign platform where users own their identity, bring their own AI keys, trade crypto peer-to-peer, vote with trust-weighted ballots, and engage with content that measures real impact — not vanity metrics.

The original build proved the mechanisms work. This rebuild makes them **feel right**.

---

## The Four Commandments

Every decision — from database queries to button hover states — must serve these principles in priority order:

### 1. Performance Above All Else

When in doubt, do the thing that makes the app feel **fastest**.

- **Optimistic updates everywhere.** Mutations reflect in UI before the server confirms. Roll back on error with a toast — never make the user wait for a round-trip.
- **Custom data loaders.** Route-level `loader` functions that prefetch data in parallel. No sequential waterfalls — not in JS module loading, not in data fetching, not in asset loading.
- **Link prewarming.** Custom `<Link>` component that triggers `prefetch` or `preload` on hover/focus (not just on viewport intersection). By the time they click, the page is already cached.
- **Streaming everything.** SSR streams HTML as it resolves. AI chat streams tokens via SSE. Feed updates stream via pub/sub. Never batch what you can stream.
- **Bundle discipline.** Code-split aggressively. Lazy-load below-fold components. Tree-shake imports. Target <100KB first-load JS for any route.
- **No layout shifts.** Every image has dimensions. Every skeleton matches final content size. CLS = 0.

### 2. Convenience — Zero-Friction UX

The app should feel like it reads your mind.

- **All links are share links.** Every URL is the canonical link to that resource. No "copy link" buttons needed — the URL bar is always shareable.
- **Homepage → latest content: ≤3 clicks.** Reconsider any flow that takes more.
- **Minimize blocking states.** Let users into the app ASAP. Auth can resolve in background. Content loads progressively. Skeleton > spinner > blank screen.
- **1-click for common actions.** Connect wallet? One click. Switch AI model? One click. Start a trade? One click. The second click is always the confirmation.
- **Smart defaults.** Auto-select the free AI model. Auto-detect wallet type. Auto-fill from last session. The user should never configure what can be inferred.

### 3. Security — Thoughtful, Not Paranoid

Convenient and secure are not opposites.

- **Check team + user status before mutations.** Every server action validates auth, role, and permissions. No trust-the-client shortcuts.
- **Be VERY thoughtful about public endpoints.** Every API route should have a clear answer to "who can call this and why?" If the answer is unclear, it's not public.
- **Auth checks where they make sense.** Don't gate read-only public content. Do gate writes, deletes, admin actions, financial operations.
- **BYOK keys encrypted at rest** (AES-256-GCM). Never logged. Never sent back to client after storage. Display masked only.
- **Rate limiting on all expensive operations.** AI generation, trade execution, poll creation, auth attempts.

### 4. Craftsmanship — The Invisible Quality

The difference between "works" and "feels right."

- **60fps minimum.** No jank on scroll, resize, drag, or animation. Use `will-change` sparingly but correctly. Prefer `transform` and `opacity` for animations.
- **Dark mode first.** Design in dark, adapt to light. Not the reverse.
- **Consistent spacing system.** 4px base unit. Everything aligns to grid.
- **Sound design cues.** Subtle haptic-style feedback: micro-animations on click (scale 0.97→1.0), success/error color flashes, skeleton shimmer.
- **Accessible by default.** ARIA labels, keyboard navigation, focus management, screen reader compatibility. Not bolted on — designed in.

---

## The Panel System — VS Code-Grade Window Management

This is the single biggest upgrade from the original build. Every surface in the app is a **Panel** — a draggable, resizable, dockable, poppable container that users arrange to match their workflow. Think VS Code's dual-sidebar + editor system, but for a marketplace.

### Architecture

```
┌──┬─────────────────┬──────────────────────────────────┬─────────────────┐
│  │ Panel Slot: L   │  Panel Slot: Center              │ Panel Slot: R   │
│A │                 │                                  │                 │
│c │  ┌───────────┐  │  ┌────────────────────────────┐  │  ┌───────────┐  │
│t │  │ View A    │  │  │ Tab: Feed  │ Tab: Trade    │  │  │ AI Chat   │  │
│i │  │ (can be   │  │  ├────────────┴───────────────┤  │  │           │  │
│v │  │  any View)│  │  │                            │  │  │ Messages  │  │
│i │  ├───────────┤  │  │   Main Content Area        │  │  │ + Input   │  │
│t │  │ View B    │  │  │                            │  │  │           │  │
│y │  │           │  │  │                            │  │  ├───────────┤  │
│  │  │           │  │  │                            │  │  │ BYOK Keys │  │
│B │  └───────────┘  │  └────────────────────────────┘  │  └───────────┘  │
│a │                 │                                  │                 │
│r │                 │  Panel Slot: Bottom               │                 │
│  │                 │  ┌────────────────────────────┐  │                 │
│  │                 │  │ Terminal / Logs / DevTools  │  │                 │
│  │                 │  └────────────────────────────┘  │                 │
├──┴─────────────────┴──────────────────────────────────┴─────────────────┤
│ StatusBar                                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Panel Primitives

Every panel in the system inherits from a single `<Panel>` primitive with these capabilities:

| Capability | Implementation |
|-----------|---------------|
| **4-way corner resize** | All 4 corners + all 4 edges are drag handles. User can resize diagonally (↗↘↙↖) — not just horizontally or vertically. CSS `resize: both` won't cut it — implement via pointer events + `requestAnimationFrame`. |
| **Drag to reposition** | Title bar is the drag handle. Panels snap to slot boundaries (left, right, center, bottom) with magnetic edge-snapping (8px threshold). |
| **Pop out to window** | Double-click title bar OR click pop-out icon → opens panel content in a new browser window (`window.open`) with bidirectional state sync via `BroadcastChannel`. |
| **Merge back in** | Dragging a popped-out panel back to a slot (or clicking "dock" in the floating window) merges it back into the layout. |
| **Tab grouping** | Multiple Views can share one Panel slot as tabs. Drag a View's tab to another Panel to move it. Drag between tab positions to reorder. |
| **Collapse/expand** | Each panel slot can collapse to 0px width/height with a toggle. The adjacent panel expands to fill. Double-click the divider to auto-size. |
| **Persistent layout** | Panel positions, sizes, tab order, and collapsed state are serialized to `localStorage`. On reload, the exact layout is restored. |
| **Responsive fallback** | Below 768px, panels stack vertically as full-width sections. The Activity Bar becomes a bottom tab bar. Panels that were side-by-side become swipeable sheets. |

### The Activity Bar

A narrow vertical strip (48px) on the far left, inspired by VS Code:

```
┌──┐
│🏠│  Home / Feed
│💬│  AI Chat
│📊│  Polls
│💰│  Trading
│📦│  Marketplace
│👛│  Wallets
│⚙️│  Settings
│──│
│👤│  User (bottom)
└──┘
```

- Each icon toggles the corresponding View in the Left Panel slot.
- Active icon has a left-edge accent bar (2px, brand color).
- Badge indicators: unread messages (dot), pending trades (count), new feed items (dot).
- Keyboard accessible: `Ctrl+1` through `Ctrl+7` to switch.
- Collapsible: click the active icon again to hide the Left Panel entirely.

### Resize Implementation Detail

This is critical to get right. Most apps only support 2-axis edge resize. We need **8-handle resize**:

```
   ↖  ───  ↑  ───  ↗
   │                │
   ←    Content     →
   │                │
   ↙  ───  ↓  ───  ↘
```

- **Corner handles** (4): Allow simultaneous X+Y resize. Cursor: `nwse-resize`, `nesw-resize`.
- **Edge handles** (4): Single-axis resize. Cursor: `ew-resize`, `ns-resize`.
- **Handle size:** 6px visible (but 12px hit area for touch targets).
- **Min panel size:** 200px width, 150px height. Panels cannot be resized smaller.
- **Snap guidelines:** When resizing near the 50% or 33% width mark, show a subtle blue guide line and snap to it if within 8px.
- **Performance:** All resize logic runs via `pointermove` + `requestAnimationFrame`. Never measure layout during resize — use cached dimensions and apply via `transform` or CSS custom properties.

### State Persistence Schema

```ts
type PanelLayout = {
  version: number;
  slots: {
    left:   { width: number; collapsed: boolean; tabs: ViewId[]; activeTab: ViewId };
    right:  { width: number; collapsed: boolean; tabs: ViewId[]; activeTab: ViewId };
    center: { tabs: ViewId[]; activeTab: ViewId };
    bottom: { height: number; collapsed: boolean; tabs: ViewId[]; activeTab: ViewId };
  };
  poppedOut: ViewId[];  // Views currently in separate windows
  activityBar: { position: "left" | "right"; collapsed: boolean };
};
```

Serialize to `localStorage` on every layout change (debounced 300ms). Restore on mount.

---

## The Chat System — Claude.ai Quality, Better Architecture

The AI chat must feel indistinguishable from Claude.ai in responsiveness, but with BYOK superpowers and multi-provider parity.

### Chat Layout (when docked as a Panel)

```
┌─────────────────────────────────────┐
│ [Model ▾] [Provider pill]  [⋯ menu]│
├─────────────────────────────────────┤
│                                     │
│   Welcome message / empty state     │
│   (centered, fades out on first msg)│
│                                     │
│   ┌─────────────────────────────┐   │
│   │ User message (right-aligned)│   │
│   └─────────────────────────────┘   │
│                                     │
│   ┌──┐                             │
│   │🤖│ Assistant response           │
│   └──┘ with **markdown** rendering  │
│        ```code blocks```            │
│        [Copy] [👍] [👎] [⟳ Retry]  │
│                                     │
│   ┌─────────────────────────────┐   │
│   │ User message                │   │
│   └─────────────────────────────┘   │
│                                     │
│   ● ● ● (typing indicator)         │
│                                     │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ [📎] [textarea ↕ auto-grow   ] │ │
│ │       placeholder: "Message…"   │ │
│ │ [🔑 BYOK] [Model ▾]    [▶/■]  │ │
│ └─────────────────────────────────┘ │
│ Claude can make mistakes.           │
└─────────────────────────────────────┘
```

### Message Lifecycle — Sub-200ms Feel

1. **User presses Enter:**
   - Textarea content captured, cleared, reset to 1-line height.
   - User message appended to thread **immediately** (optimistic).
   - Auto-scroll to bottom.
   - Send button → stop button (■) transition over 150ms.
   - SSE connection opened via `fetch()` with `ReadableStream` reader.

2. **Thinking state** (0–200ms):
   - 3 dots with staggered pulse animation appear below user message.
   - Implementation: `@keyframes pulse` with `animation-delay: 0s, 0.2s, 0.4s`.

3. **Streaming** (200ms–complete):
   - Text chunks appended to a `ref` (NOT React state) for zero-rerender streaming.
   - DOM updated directly via `textContent` or `innerHTML` append.
   - React state synced only on `[DONE]` signal.
   - Auto-scroll continues IF user is within 100px of bottom. If they've scrolled up, show floating "↓ Scroll to bottom" FAB.
   - Markdown rendered incrementally — partial bold, partial code blocks are fine.

4. **Stream complete:**
   - Stop button → send button transition.
   - Action buttons fade in (200ms): Copy, 👍, 👎, Retry.
   - Conversation auto-saved to DB (fire-and-forget).

### Textarea Mechanics

- **Auto-grow:** Starts at 1 line (~44px). Grows with content up to max ~200px (8 lines). Then internal scroll.
- **Keyboard:** `Enter` = send. `Shift+Enter` = newline. `Escape` = abort stream. `↑` on empty = edit last message.
- **Paste:** Images paste as attachments (show as pill chips above textarea).

### Scrolling — The Hard Part

```ts
// On every streaming chunk:
const container = threadRef.current;
const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
if (isNearBottom) {
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}
setShowScrollFAB(!isNearBottom);
```

- FAB: Small circle, bottom-right of message thread, `opacity: 0 → 1` transition, 150ms.
- Click FAB → `scrollTo({ top: scrollHeight, behavior: 'smooth' })` → hide FAB.
- On user message send → ALWAYS scroll to bottom regardless of position.

### BYOK Panel (expandable)

Sits below the textarea as a collapsible section:

```
┌─────────────────────────────────────┐
│ 🔑 Use your own API key        [▾] │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ Paste API key…   [🔍 auto-detect]│ │
│ └─────────────────────────────────┘ │
│ Detected: OpenAI ✓                  │
│ ☑ Remember this key                │
│                                     │
│ Saved keys:                         │
│ [OpenAI: sk-pr••••abcd ✕]          │
│ [Groq: gsk_••••efgh ✕]             │
│                                     │
│ Get keys: OpenAI · Anthropic · Groq │
└─────────────────────────────────────┘
```

- **Auto-detect:** As user types, run `inferProviderFromApiKey()`:
  - `sk-` → OpenAI
  - `sk-ant-` → Anthropic
  - `sk-or-` → OpenRouter
  - `gsk_` → Groq
  - `xai-` → Grok
  - `AIza` → Google
- Show detected provider icon + name instantly (no round-trip).
- When key is saved, the model picker instantly unlocks that provider's models (no reload).
- Saved keys show as pills with masked display (`sk-pr••••abcd`) + delete button.
- "Get keys" links open provider console URLs in new tab.

### Provider Architecture (Route Handler)

```
POST /api/ai-chat
├── Auth: session (authenticated) OR IP-based (anonymous, rate-limited)
├── Input: Zod-validated { messages[], sessionId?, model?, provider?, aiAuth? }
├── Key resolution (authenticated):
│   1. Inline BYOK (aiAuth.apiKey) → used immediately
│   2. Saved BYOK (UserAiKey DB lookup) → decrypt AES-256-GCM
│   3. Platform key (env var) → free providers only, or premium entitled
├── Key resolution (anonymous):
│   └── Platform Google key only (rate-limited: N/hour/IP)
├── Stream factory: createSseStream(upstream, extractText, label)
│   ├── Google:    candidates[0].content.parts[0].text
│   ├── OpenAI:    choices[0].delta.content
│   ├── Anthropic: content_block_delta → delta.text
│   ├── Groq:      OpenAI-compatible
│   ├── Grok:      OpenAI-compatible
│   └── OpenRouter: OpenAI-compatible + HTTP-Referer header
├── Safety: injection filter, sensitive data detection, HTML strip
├── Quota: free daily limit → credit packs → daily cap → owner exempt
└── Response headers: X-Ai-Cost-Tier, X-Ai-Provider, X-Ai-Model
```

### Smart Error Messages

Every provider error includes:
- **What happened** in plain English (not raw API error).
- **Why it happened** (wrong key type, quota exhausted, model not found).
- **How to fix it** (link to provider console, suggest alternative model, suggest BYOK).
- **Wrong-provider detection:** If an OpenAI key is sent to Groq, say so explicitly.

### Conversation Management (Sidebar View)

- Conversations grouped chronologically: Today, Yesterday, Previous 7 Days, Older.
- Each item shows: truncated title (auto-generated from first message), message count, date.
- Hover actions: rename, delete, pin, share.
- "New Chat" button at top → clears thread instantly.
- Conversations auto-save to DB: `AiConversation` (metadata) → `AiMessage[]` (content).
- Search across conversation history by keyword.

---

## The Wallet System — Multi-Chain, Multi-Wallet, Instant

### Wallet Runtime Context

Single React context unifying all wallet state:

```ts
type WalletContextValue = {
  evm: {
    connected: boolean;
    address: `0x${string}` | null;
    chainId: number;
    brand: "MetaMask" | "Coinbase" | "WalletConnect" | "Injected" | null;
    balance: bigint | null;
  };
  solana: {
    connected: boolean;
    address: string | null;
    brand: string | null;
  };
  busy: { evm: boolean; sol: boolean };
  evmConnectors: readonly Connector[];
  connectEvm: (connector: Connector) => Promise<void>;
  disconnectEvm: () => Promise<void>;
  connectSolana: (walletName: WalletName) => Promise<void>;
  disconnectSolana: () => Promise<void>;
};
```

### Connect Flow

1. **Disconnected state:** Button says "Connect Wallet" (or just "Connect" on mobile).
2. **Click →** Modal opens with two sections:
   - **Recommended:** MetaMask (tagged "Desktop"), WalletConnect (tagged "Mobile"), Coinbase.
   - **More Wallets:** All other detected connectors.
   - Each shows real icon from `getConnectorBrand()` mapping.
3. **Click connector →** `connectAsync({ connector })` fires, modal auto-closes, button morphs to:
   - Green dot + truncated address (`0x1234…abcd`) + chevron.
   - Brand icon (MetaMask fox, Coinbase logo, etc.) shows before address.
4. **Click connected button →** Dropdown (NOT modal) with:
   - EVM card: address (copyable), chain name, balance, network switcher, disconnect.
   - Solana card: address (copyable), disconnect.
   - Each card has green "Connected" pill with pulsing dot.

### Sidebar Wallet Panel (Power Users)

When the Wallet View is active in a Panel slot, it shows:

- **All linked wallets** from DB + live-connected wallets + session registry.
- **Wallet registry** (`Map<string, Entry>` in `sessionStorage`) persists across page reloads.
- **Per-wallet card:**
  - Brand icon + label (editable: "My Trading Wallet").
  - Address (copyable chip).
  - Chain badge (Ethereum=blue, Polygon=purple, Solana=gradient).
  - Verified badge (if wallet has signed verification message).
  - Balance with skeleton loader.
  - Actions: Disconnect, Set Default, View on Explorer, Verify (sign message).
- **Network switcher:** Dropdown to switch EVM chains via `useSwitchChain`.
- **Transfer panel:** Send native token between connected wallets.
- **Active wallet indicator:** Green left border on the currently active wallet.

### Instant-Response Patterns

- `brand` persisted to `localStorage` → correct icon shows before wagmi hydrates.
- Address shows from connector callback immediately (don't wait for React re-render).
- `busy` flags prevent double-click, show spinner on the specific connector button.
- DB upsert on connect is fire-and-forget (doesn't block UI).
- Skeleton loaders for balance (not spinners).

---

## Auth System — Multi-Identity, Progressive Trust

### Architecture

```
Auth.js (NextAuth v5)
├── PrismaAdapter → PostgreSQL
├── JWT strategy (Edge-compatible)
├── Providers: Credentials, Google, GitHub, Discord
├── Split config: auth.config.ts (Edge-safe) + auth.ts (full Prisma)
└── Session enrichment via jwt + session callbacks
```

### Session Shape

```ts
{
  id: string;
  role: "USER" | "ADMIN" | "OWNER";
  email: string;
  name: string;              // resolved from identitySource
  image: string | null;      // resolved from identitySource
  isOAuth: boolean;
  isTwoFactorEnabled: boolean;
  identitySource: "AUTO" | "MANUAL" | "GOOGLE" | "GITHUB" | "DISCORD";
  verificationTier: VerificationTier;  // current 14-tier level
  tierMultiplier: number;              // 0.10 → 1.20
}
```

### Multi-Identity Resolution

Users can link Google + GitHub + Discord to one account. Each stores separate profile data:

```
User.googleProfileName / googleProfileImage
User.githubProfileName / githubProfileImage
User.discordProfileName / discordProfileImage
```

`identitySource` controls which provider's name/image the session returns. `resolveDisplayName()` and `resolveDisplayImage()` walk the fallback chain.

### 14-Tier Progressive Verification

```
ANONYMOUS(0.10x) → UNVERIFIED(0.15x) → EMAIL_VERIFIED(0.25x) →
WALLET_ONLY(0.30x) → WEB2_BASIC(0.40x) → WEB2_SOCIAL(0.50x) →
GOOGLE_VERIFIED(0.55x) → MULTI_OAUTH(0.65x) → WALLET_PLUS_SOCIAL(0.75x) →
PAYMENT_LINKED(0.85x) → PAYMENT_VERIFIED(0.95x) → PHONE_VERIFIED(1.00x) →
KYC_VERIFIED(1.10x) → FULLY_VERIFIED(1.20x)
```

Multiplier applies to: True Reach view strength, poll vote weight, trade limits, content trust badges. Tier recalculates automatically on OAuth link, wallet signature, payment, phone verification, KYC.

### Security Details

- Email verification required before first login.
- Optional 2FA (TOTP) — check `twoFactorConfirmation` in `signIn` callback.
- Rate-limit login attempts (IP-based, sliding window).
- OAuth link confirmation email when linking new provider.
- `currentUser()` / `requireUser()` server-side helpers.

---

## Remaining Mechanisms (The Product Moat)

These are what make Freedom Store™ different from every other marketplace. Build all of them.

### True Reach™ — 7-Pillar Behavioral Scoring

Replace vanity metrics (likes, follows) with real engagement measurement:

| # | Pillar | Weight | Measures |
|---|--------|--------|----------|
| 1 | Visibility | 18% | Qualified views (500ms dwell, IP dedup, bot filter) |
| 2 | Engagement Depth | 25% | Scroll %, dwell time, interaction density |
| 3 | Conversion Impact | 18% | CTR, saves, shares, purchases |
| 4 | Loyalty & Retention | 14% | Return visits, content affinity, session frequency |
| 5 | Network Growth | 10% | Organic follower growth, referral chains |
| 6 | Brand Recall | 5% | Direct searches, unprompted mentions |
| 7 | Momentum Velocity | 10% | Growth acceleration, trend consistency, viral coefficient |

**Formula:** `trueReachScore = Σ(pillar_i × weight_i)` → normalized 0–100

**Anti-gaming per pillar:** 500ms dwell minimum, scroll velocity anomaly detection, click verification windows, save-unsave pattern detection, follow-unfollow cycle detection, burst rate limiting, sudden spike investigation. Every pillar has its own countermeasure — do not skip these.

**Client tracking hook** (`useReachTracker`): scroll depth, dwell time, tab visibility, hover deep-reads, copy events, return visits.

### OSRS-Style P2P Trading

Old School RuneScape-inspired trading UI:

- **Inventory:** 4×7 grid (28 slots), real ERC-20/NFT tokens from connected wallets, dark "stone" empty slots, drag-and-drop with modifiers (default=full, shift=half, ctrl=third), right-click context menu (Split, Copy, Send, Trade).
- **Trade Window:** Dual 4×4 offer grids ("Your Offer" / "Their Offer"), two-step accept (add items → confirm exact trade, any modification resets both accepts), real-time sync between traders.
- **Self-trade mode:** Trade between your own wallets via source/destination selector.
- The trade window itself is a **Panel** — it can be popped out, resized, and docked like any other view.

### 5-Mode Unified Trading

All trades share one data model:

| Mode | What | Blockchain? | Tax? |
|------|------|-------------|------|
| P2P | Two users, OSRS grids | Yes | Yes |
| SELF | Between own wallets | Yes | Yes |
| DEX | Aggregator swap (0x/KyberSwap) | Yes | Yes |
| PAPER | DB-simulated, no real crypto | No | No |
| LOCAL | Devnet trades | Yes (local) | No |

**Tax compliance (Norway / Skatteetaten):** 22% capital gains, FIFO + AVERAGE cost basis, RF-1159 CSV export, auto gain/loss per trade.

### Paper Trading (DB-Simulated)

Virtual $100K portfolio, real market prices (CoinGecko / swap API), zero blockchain cost:
- Server-side execution: action → DB write → portfolio update.
- Holdings tracking, cost basis, P&L, full trade history.
- Serverless-friendly (no persistent chain connections).

### Advanced Poll System (6+ Question Types)

SINGLE_CHOICE | MULTI_CHOICE | SLIDER | SCALE | TEXT | NESTED (conditional follow-ups) | RANKING | SHAPE_MATCH | UI_ARRANGE.

- **Builder:** Drag-and-drop reorder, per-question config, Ctrl+V image paste, 7 templates.
- **Vote weighting:** `tierMultiplier × completionMultiplier × responseQuality`
  - Completion: 100%=1.0x, 75-99%=0.8x, 50-74%=0.6x, 25-49%=0.3x, <25%=0.1x
  - Quality: text length bonus, consistency bonus, speedrun penalty.
- **Interactive 5-screen preview:** Welcome → Sections → Questions → Completion → Results.
- **Analytics carousel:** Radar, Bar, Pie, Line, Heatmap charts.
- **Feeds True Reach:** Engagement (P2), Loyalty (P4), Conversion (P3).

### AI Quiz Generation with SSE Streaming

6-step pipeline, each fires a Server-Sent Event with progress:

```
VALIDATING → GENERATING → PARSING → ENRICHING → SAVING → COMPLETE
```

Anti-injection via `sanitizeUserPrompt()`. Trust score annotation per verification tier. Per-user rate limiting.

### Pulse Feed (Real-Time Social)

Post types: text, image, poll (inline builder), repost, quote-repost, "pulse" reactions (positive/negative heartbeat).

- Real-time via pub/sub channels (Pusher or equivalent).
- Intercepting modal for in-feed poll detail viewing.
- **Every interaction feeds True Reach tracking** via `useReachTracker`.
- Feed view is a **Panel** — can be side-by-side with chat or trading.

### Seller Payment Routing

3-level resolution cascade:
```
Product.receiverWalletId → Company.defaultReceivingWalletId → User.defaultReceivingWalletId
```
Same for PayPal: Company email → User email (verified only, timing-safe token, 24h expiry).

Multi-seller carts: resolve each product independently, flag `multiSeller: true` if destinations differ. Crypto (EVM + Solana) and PayPal fiat rails.

### Site Gate (Private Testing)

Environment-controlled access lock:
- `SITE_MODE=private` + `GATE_PASSWORD` → all routes redirect to `/gate`.
- Cookie-based: `veggastare_access = "granted_<base64(password prefix)>"`.
- Whitelisted: `/gate`, legal pages, OAuth callbacks, webhooks.
- API routes return JSON 401 (no redirect).
- Fail-safe: auto-disables if no password set.

### Norwegian Legal Integration

- **Brønnøysundregistrene** (business registry): live org number lookup, auto-fill company name/address/legal form, 9-digit validation + formatting (XXX XXX XXX), map Norwegian legal forms (AS/ENK/ANS/DA/SA/NUF/FORENING) to platform types.
- **Skatteetaten** (tax): 22% cap gains, FIFO/AVERAGE, RF-1159 CSV export.

### Warehouse Real-Time Sync + LocalDevTools

- **Dual-channel:** WebSocket (bidirectional, for warehouse operators sending updates) + pub/sub broadcast (unidirectional, for dashboard viewers).
- **LocalDevTools panel** (a dockable Panel View): Mine blocks, snapshot/revert chain, set balance, send from account — for local blockchain development.

---

## Visual Language — The Design System

### Color System

```css
/* OKLCH-based, dark-mode-first */
--bg-primary:     oklch(0.13 0.00 0);      /* near-black */
--bg-secondary:   oklch(0.16 0.00 0);      /* panels */
--bg-elevated:    oklch(0.19 0.005 250);   /* hover/active states */
--border-subtle:  oklch(0.25 0.00 0);      /* dividers */
--border-active:  oklch(0.45 0.14 250);    /* focus rings, active tabs */
--text-primary:   oklch(0.93 0.00 0);      /* main text */
--text-secondary: oklch(0.60 0.00 0);      /* muted text */
--accent:         oklch(0.65 0.20 250);    /* brand — blue-ish */
--success:        oklch(0.65 0.18 155);    /* green */
--warning:        oklch(0.75 0.15 80);     /* amber */
--danger:         oklch(0.60 0.22 25);     /* red */
```

### Spacing

4px base. All margins, paddings, gaps are multiples of 4: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

### Typography

- **Body:** 14px/1.5, 400 weight, system font stack (`Inter` if loaded, then `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`).
- **Code:** 13px/1.4, `"JetBrains Mono", "Fira Code", "Cascadia Code", monospace`.
- **Headings:** 16px (h4), 18px (h3), 22px (h2), 28px (h1). Weight 600.
- **Small / caption:** 12px, weight 400, `--text-secondary` color.

### Glass & Blur Effects

```css
.glass-panel {
  background: oklch(0.16 0.005 250 / 0.80);
  backdrop-filter: blur(16px) saturate(1.2);
  border: 1px solid oklch(0.30 0.00 0 / 0.50);
  border-radius: 12px;
  box-shadow: 0 4px 24px oklch(0 0 0 / 0.30);
}
```

Use glass for: floating panels, popped-out windows, dropdown menus, modals, the Activity Bar.

### Animation Standards

- **Duration:** 100ms (micro), 200ms (standard), 300ms (panel slide), 500ms (page transition).
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` for enters, `cubic-bezier(0.7, 0, 0.84, 0)` for exits.
- **Principles:** Animate `transform` and `opacity` only. Never animate `width`, `height`, `top`, `left` — use transform equivalents.
- **Click feedback:** `scale(0.97)` for 100ms, then spring back to `scale(1)` over 200ms.
- **Panel transitions:** `translateX` for left/right slides, `translateY` for bottom slide, `scale(0.95) → scale(1)` for pop-in.

### Skeleton / Shimmer

```css
.skeleton {
  background: linear-gradient(
    90deg,
    oklch(0.19 0.00 0) 25%,
    oklch(0.23 0.00 0) 50%,
    oklch(0.19 0.00 0) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite ease-in-out;
  border-radius: 6px;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Every loading state uses skeletons that match the exact dimensions of the final content. No spinners except for inline button actions.

---

## Database Schema (Core Models)

```prisma
model User {
  id                    String    @id @default(cuid())
  name                  String?
  email                 String?   @unique
  emailVerified         DateTime?
  image                 String?
  password              String?
  role                  UserRole  @default(USER)
  isTwoFactorEnabled    Boolean   @default(false)
  identitySource        String    @default("AUTO")
  verificationTier      String    @default("UNVERIFIED")
  
  googleProfileName     String?
  googleProfileImage    String?
  githubProfileName     String?
  githubProfileImage    String?
  discordProfileName    String?
  discordProfileImage   String?
  
  wallets               Wallet[]
  aiKeys                UserAiKey[]
  aiConversations       AiConversation[]
  accounts              Account[]
  trades                Trade[]
  trueReachScore        Float     @default(0)
}

enum UserRole { USER ADMIN OWNER }

model Wallet {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  family        String    // "EVM" | "SOLANA" | "BITCOIN"
  address       String
  label         String?
  chainId       Int?
  isDefault     Boolean   @default(false)
  verifiedAt    DateTime?
  connectorType String?
  createdAt     DateTime  @default(now())
  @@unique([userId, address])
}

model UserAiKey {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider     String   // OPENAI | ANTHROPIC | GOOGLE | GROQ | GROK | OPENROUTER
  encryptedKey String
  iv           String
  authTag      String
  maskedKey    String   // "sk-pr••••abcd"
  fingerprint  String   // SHA-256 prefix for dedup
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([userId, provider])
}

model AiConversation {
  id          String       @id @default(cuid())
  creatorId   String
  creator     User         @relation(fields: [creatorId], references: [id], onDelete: Cascade)
  title       String?
  isPublic    Boolean      @default(false)
  isDeleted   Boolean      @default(false)
  isSuspended Boolean      @default(false)
  messages    AiMessage[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model AiMessage {
  id             String         @id @default(cuid())
  conversationId String
  conversation   AiConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String         // "user" | "assistant" | "system"
  content        String
  provider       String?
  model          String?
  costTier       String?        // "free" | "premium" | "byok"
  createdAt      DateTime       @default(now())
}

model Trade {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  mode          String   // P2P | SELF | DEX | PAPER | LOCAL
  status        String   // PENDING | ACCEPTED | COMPLETED | CANCELLED
  fromAddress   String
  toAddress     String
  items         Json     // array of { token, amount, ... }
  costBasis     Json?    // FIFO/AVERAGE calc
  gainLoss      Float?
  txHash        String?
  chainId       Int?
  createdAt     DateTime @default(now())
}

model AiDailyUsage {
  id     String @id @default(cuid())
  userId String
  date   String // "2025-01-15"
  count  Int    @default(0)
  @@unique([userId, date])
}
```

Extend with: Product, Company, Poll, PollQuestion, PollResponse, PulseFeedPost, TrueReachEvent, Warehouse, Order, etc. The models above are the foundation — build out commerce, social, and analytics models as needed.

---

## Stack Decision Framework

Before writing code, propose your stack for each layer and justify it:

| Layer | Decision Needed | Must Support |
|-------|----------------|-------------|
| **Framework** | Next.js? Vinext? SvelteKit? | App Router, RSC, Server Actions, SSE streaming, middleware |
| **Hosting** | Vercel? Cloudflare Workers? Fly.io? | Edge functions, WebSocket, preview deploys |
| **Database** | Neon Postgres? Turso? D1? PlanetScale? | Branching (dev/preview/prod), 50+ models, full-text search |
| **ORM** | Prisma? Drizzle? | Type-safe, schema migrations, edge-compatible |
| **Real-time** | Pusher? Durable Objects? PartyKit? | Pub/sub channels, presence, bidirectional WS |
| **Auth** | Auth.js? Lucia? Clerk? Better Auth? | 14-tier progressive verification, wallet signature, multi-OAuth |
| **Web3** | wagmi+viem? ethers.js? Reown? | EVM + Solana, multi-wallet, ERC-20 transfers, tx signing |
| **File Storage** | EdgeStore? R2? Uploadthing? | Image upload, CDN, resize |
| **AI** | Vercel AI SDK? Direct fetch? | 6 providers, streaming, BYOK key injection at runtime |
| **Testing** | Playwright? Vitest? | E2E browser tests, component tests, API tests |
| **CSS** | Tailwind v4? UnoCSS? | OKLCH colors, dark-mode-first, component library compat |
| **Components** | shadcn/ui? Ark UI? Radix? | Accessible primitives, complex UIs (grids, builders, panels) |
| **Panel system** | Custom? Allotment? react-mosaic? | 4-way resize, pop-out, tab groups, layout persistence |

---

## File Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout: providers, panel shell, activity bar
│   ├── page.tsx                # Landing / feed
│   ├── api/
│   │   ├── ai-chat/route.ts    # SSE streaming chat endpoint
│   │   ├── polls/              # Poll CRUD + AI generation
│   │   ├── trades/             # Trade execution + history
│   │   └── wallets/            # Wallet sync + verify
│   └── (protected)/
│       ├── chat/page.tsx       # AI chat full page
│       ├── trade/page.tsx      # Trading page
│       ├── polls/page.tsx      # Poll builder + list
│       └── settings/page.tsx   # BYOK keys, wallet linking, identity
├── components/
│   ├── panels/
│   │   ├── PanelShell.tsx      # Root panel layout manager
│   │   ├── Panel.tsx           # Base panel primitive (resize, drag, pop)
│   │   ├── PanelDivider.tsx    # Draggable divider between panels
│   │   ├── ActivityBar.tsx     # Left icon strip
│   │   └── StatusBar.tsx       # Bottom status strip
│   ├── chat/
│   │   ├── ChatView.tsx        # Chat as a Panel View
│   │   ├── ChatMessage.tsx     # Message bubble + markdown
│   │   ├── ChatInput.tsx       # Auto-grow textarea + send/stop
│   │   ├── ChatModelPicker.tsx # Provider/model dropdown
│   │   ├── ByokPanel.tsx       # BYOK key input + saved keys
│   │   └── ChatSidebar.tsx     # Conversation history list
│   ├── wallet/
│   │   ├── WalletProvider.tsx  # WalletRuntimeContext
│   │   ├── WalletButton.tsx    # Connect button + dropdown
│   │   ├── WalletPanel.tsx     # Sidebar wallet manager
│   │   └── NetworkSwitcher.tsx # Chain switcher
│   ├── trading/
│   │   ├── InventoryGrid.tsx   # 4×7 OSRS inventory
│   │   ├── TradeWindow.tsx     # Dual 4×4 trade grids
│   │   └── PaperTradeView.tsx  # Virtual portfolio
│   ├── feed/
│   │   ├── PulseFeed.tsx       # Real-time post feed
│   │   └── PostComposer.tsx    # Create post
│   ├── polls/
│   │   ├── PollBuilder.tsx     # Builder with drag-and-drop
│   │   ├── PollTaker.tsx       # 5-screen response flow
│   │   └── PollAnalytics.tsx   # Chart carousel
│   └── auth/
│       ├── LoginForm.tsx
│       ├── RegisterForm.tsx
│       └── GateScreen.tsx      # Private mode login
├── lib/
│   ├── ai-key-crypto.ts        # AES-256-GCM encrypt/decrypt
│   ├── ai-key-store.ts         # UserAiKey CRUD
│   ├── daily-ai-quota.ts       # Usage tracking
│   ├── ai-chat/safety.ts       # Injection filter, rate limit, HTML strip
│   ├── true-reach.ts           # 7-pillar scoring engine
│   ├── verification-tiers.ts   # 14-tier calculator
│   ├── tax-engine.ts           # FIFO/AVERAGE, RF-1159 export
│   ├── panel-layout.ts         # Layout persistence & restore
│   ├── user-auth.ts            # currentUser() / requireUser()
│   └── db.ts                   # Database client singleton
├── hooks/
│   ├── use-reach-tracker.ts    # Client-side engagement tracking
│   ├── use-chat.ts             # Chat state + streaming
│   ├── use-panel-resize.ts     # 8-handle resize hook
│   ├── use-wallet-verify.ts    # Sign-message verification
│   └── use-panel-dnd.ts        # Panel drag-and-drop
├── auth.ts                     # NextAuth full init
├── auth.config.ts              # Edge-safe provider config
└── middleware.ts               # Auth + gate + route protection
```

---

## 5-Layer E2E Test Pyramid

```
suite.spec.ts   → All tests in 5 layers
master.spec.ts  → Meta-test validating suite ran correctly
helpers.ts      → Data-driven route arrays (add route = auto coverage)
```

| Layer | What | Example |
|-------|------|---------|
| **Alive** | No 500 errors | Every route returns 2xx or 3xx |
| **Routing** | Pages load, guards enforce | Protected routes redirect unauthed |
| **Content** | Expected elements visible | Chat input renders, wallet button exists |
| **Flows** | Multi-step journeys work | Connect wallet → start trade → accept |
| **Data** | API responses match schema | `/api/ai-chat` returns SSE stream |

---

## Implementation Order

1. **Stack selection** — Justify every choice. Get approval before writing code.
2. **Panel system** — PanelShell, Panel primitive, ActivityBar, layout persistence. This is the foundation everything lives inside.
3. **Auth** — NextAuth v5, Prisma schema (core models), verification tiers, site gate.
4. **Chat + BYOK** — SSE streaming route, ChatView, BYOK panel, conversation management.
5. **Wallets** — WalletRuntimeContext, WalletButton, WalletPanel, network switching.
6. **Commerce** — Products, companies, Norwegian org lookup, payment routing.
7. **Social** — Pulse feed, True Reach tracking hook, 7-pillar scoring engine.
8. **Polls** — 6+ question types, builder, analytics, AI quiz generation.
9. **Trading** — OSRS inventory/trade grids, paper trading, DEX, tax compliance.
10. **Real-time + Backend** — Warehouse sync, WebSocket, notifications.
11. **Polish** — Animations, glass effects, responsive, keyboard shortcuts, E2E tests.

---

## Validation Checklist

| # | Test | Pass Criteria |
|---|------|--------------|
| 1 | Panel resize | All 8 handles work. Diagonal resize is smooth at 60fps. |
| 2 | Panel pop-out | Pop out chat → new window syncs messages. Dock back in → seamless. |
| 3 | Layout persistence | Arrange panels → refresh → exact layout restored. |
| 4 | Chat streaming | Send message → first token appears in <200ms → smooth stream. |
| 5 | BYOK auto-detect | Paste `sk-` key → OpenAI detected. Paste `gsk_` → Groq detected. |
| 6 | BYOK key save | Save key → reload → key still available (encrypted in DB). |
| 7 | Wallet connect | Click MetaMask → connected in 1 interaction → address shows. |
| 8 | Wallet persist | Connect → refresh → wallet still shows (sessionStorage + DB). |
| 9 | True Reach scores | Post → interact → score 0–100 calculates correctly. |
| 10 | Tier progression | Link OAuth → tier bumps → multiplier changes reflect. |
| 11 | OSRS trade | Dual grids → drag items → two-step accept → transfer executes. |
| 12 | Paper trade | Buy/sell → virtual portfolio updates → P&L correct. |
| 13 | Poll system | Create all 6+ types → respond → analytics render correctly. |
| 14 | Quiz streaming | Describe topic → see 6 SSE steps → poll created in DB. |
| 15 | Feed real-time | Post in tab A → appears in tab B without refresh. |
| 16 | Site gate | Private mode → blocked → enter password → access granted. |
| 17 | Norwegian org | Enter org number → company auto-fills from Brønnøysundregistrene. |
| 18 | Tax export | Execute trades → export RF-1159 CSV → valid format. |
| 19 | E2E pyramid | All 5 layers green, meta-test validates. |
| 20 | Performance | LCP < 1.2s, CLS = 0, FID < 50ms on every route. |
| 21 | Type-check | `tsc --noEmit` — zero errors. |

---

## Execute

```
You are building Freedom Store™ from this specification.

1. Read the Four Commandments (Performance, Convenience, Security,
   Craftsmanship) and internalize them. Every decision you make
   must honor these in priority order.
2. Read every mechanism and the Panel System specification carefully.
3. Propose your complete tech stack with justifications for each layer.
4. Get my approval on the stack before writing code.
5. Build the panel system FIRST — it's the container everything lives inside.
6. Follow the implementation order in this document.
7. Validate each mechanism against the checklist.
8. Do not skip any anti-gaming mechanism, formula, interaction pattern,
   or animation detail — they are the product's moat.
9. Every loading state is a skeleton. Every mutation is optimistic.
   Every panel is resizable. Every view is poppable.
```
