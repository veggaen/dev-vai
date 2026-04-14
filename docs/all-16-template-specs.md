# VeggaAI Template Specifications — All 16 Templates

> **4 Stacks × 4 Tiers = 16 unique deployable apps**  
> Each tier is ADDITIVE — it includes everything from the tier below plus new features.  
> March 3, 2026

---

## Tier Philosophy

| Tier | Name | Badge | Concept | Time to Build |
|------|------|-------|---------|---------------|
| 1 | **Basic** | `Starter` | A polished, over-engineered todo/board/shopping list | 2-5 min scaffold |
| 2 | **Solid** | `Recommended` | Basic + Auth + Database + Sharing + API | 3-7 min scaffold |
| 3 | **Battle-Tested** | `Full Social` | Solid + Social Feed + Admin + Real-time + Tabs | 5-10 min scaffold |
| 4 | **Premium/Vai** | `Premium` | Battle-Tested + AI Chat + Panels + Wizard + Payments | 8-15 min scaffold |

---

## TIER 1: BASIC (Starter)

### App: SmartBoard™ — Intelligent Todo + Shopping + Notes

**Not just a todo list.** This is a multi-board organizer that handles daily tasks, shopping lists, meal planning, and notes — with quality UX that feels like a real product.

### Core Features

**Board System**
- Default boards on first launch: 📋 Work, 🏠 Personal, 🛒 Shopping, ☀️ Today
- Each board has: emoji icon, name, color accent, item count, completion progress
- Board sidebar: always visible on desktop (240px), bottom sheet on mobile
- "New Board" button with inline input:
  - Empty submit → red border + shake animation + "Name your board" message
  - Start typing → red clears immediately, error message fades out
  - Enter to confirm, Escape to cancel
  - Max 30 chars, trim whitespace
- Board deletion: confirm dialog, cannot delete last board
- Board reorder: drag-and-drop in sidebar

**Item Management**
- Add via input at top: placeholder "What needs to be done?"
- "+" button (teal accent) — disabled state when input empty
- Each item has: checkbox, text, edit button (pencil), delete button (trash)
- Completion: checkbox → strikethrough + opacity:0.5, smooth transition 200ms
- Edit: click pencil → inline edit mode, Enter to save, Escape to cancel
- Delete: slide-out-right animation (300ms), undo toast for 5 seconds
- Drag-and-drop reorder within board
- Completed items auto-sort to bottom (with "Completed" divider)

**Shopping List Mode** (for boards tagged as shopping)
- Quantity input per item (default 1)
- Unit selector: pieces, kg, liters, packs, bottles
- Category auto-grouping: Produce, Dairy, Meat, Bakery, Frozen, Pantry, Beverages, Other
- Price field (optional) with running total
- "Weekly Plan" view: assign items to days (Mon-Sun)
- "Shopping Day" mode: simplified checklist, large touch targets, one-hand friendly
- Recurring items: toggle "every week" / "every 2 weeks" / "monthly"

**Progress & Stats**
- Per-board progress bar: "2/5" with animated fill
- Daily completion streak counter
- Empty state: friendly illustration + "Your board is empty. Add your first item!"

**Data Persistence**
- localStorage with JSON serialization
- Auto-save on every change (debounced 300ms)
- Export all boards as JSON
- Import from JSON

**UX Polish**
- Dark theme (OKLCH color system)
- Micro-animations: add (slide-in-left), complete (strikethrough sweep), delete (slide-out-right)
- Keyboard shortcuts: Enter (add), Escape (cancel), Ctrl+N (new board), / (search)
- Responsive: mobile-first, sidebar → bottom sheet below 768px
- 4px spacing grid, consistent typography
- Focus management: new item auto-focuses input, edit auto-focuses text
- Touch: swipe-left to delete, swipe-right to complete (mobile)

**Code Quality**
- TypeScript strict mode
- Component structure: Board, BoardSidebar, ItemList, Item, AddItem, EditItem
- Custom hooks: useBoards, useLocalStorage, useDragDrop
- Zero runtime errors, zero console warnings

---

## TIER 2: SOLID (With Auth)

### Inherits: ALL of Basic

### Additional Features

**Authentication System**
- Login page: email/password fields, "Sign in with Google" button, "Create account" link
- Register page: name, email, password (strength indicator), confirm password
- AuthGate wrapper: unauthenticated → redirect to /login
- Session persistence: JWT token in httpOnly cookie
- Logout: clear session, redirect to login
- Password requirements: 8+ chars, visual strength meter (weak/fair/strong)
- Error handling: "Email already registered", "Invalid credentials", "Check your email"

**Auth UX**
- Google OAuth: popup flow (not redirect), auto-close on success
- Loading state during auth: full-screen skeleton with pulsing logo
- "Remember me" checkbox
- Session expiry: 30 days, silent refresh
- Avatar in top-right corner: initials fallback if no image

**Database-Backed Storage**
- Boards and items stored in database (not localStorage)
- Per-user data isolation
- Sync on login: merge any localStorage data → database → clear localStorage
- Optimistic updates: UI changes instantly, DB write is fire-and-forget
- Conflict resolution: server wins for concurrent edits

**Sharing & Collaboration**
- Share button per board → generates unique link
- Shared boards: read-only by default
- Share link shows board without requiring login
- Copy link with toast confirmation
- Revoke sharing at any time

**Board Templates**
- "Create from Template" option in new board dialog
- Templates: Weekly Shopping, Sprint Planning, Daily Routine, Meal Prep, Packing List, Reading List
- Each template comes pre-populated with relevant categories and sample items

**Enhanced Features**
- Tags/labels: color-coded badges on items (Important, Urgent, Low Priority, custom)
- Search: Ctrl+K opens command palette, search across all boards + items
- Due dates: date picker per item, overdue items highlighted in red
- Sort options: manual, alphabetical, by date, by completion status
- Filter: show all / active / completed

**API Layer**
- REST endpoints: `GET/POST/PUT/DELETE /api/boards`, `/api/boards/:id/items`
- Input validation with Zod schemas
- Rate limiting: 100 req/min per user
- Error responses: consistent JSON format with error codes

**Stack-Specific Auth**

| Stack | Auth Library | Session | DB |
|-------|-------------|---------|-----|
| PERN | Passport.js + express-session | Cookie + PostgreSQL session store | Prisma + PostgreSQL |
| MERN | Passport.js + JWT | Bearer token | Mongoose + MongoDB |
| Next.js | NextAuth v5 (Auth.js) | JWT | Prisma + PostgreSQL |
| T3 | NextAuth v5 via tRPC | JWT | Prisma + PostgreSQL |

---

## TIER 3: BATTLE-TESTED (Social Platform)

### Inherits: ALL of Solid

### Additional Features

**Tabbed Navigation Shell**
- 6-tab navigation bar:
  📋 Boards | 📢 Feed | 💬 Messages | 🔔 Notifications | 👤 Profile | ⚙️ Admin
- Active tab: accent underline + bold label
- Badge indicators: unread message count, notification dot, pending admin items
- Tab transitions: content cross-fades (200ms)
- Mobile: bottom tab bar (5 tabs, Admin hidden or in menu)
- Keyboard: Ctrl+1 through Ctrl+6 to switch tabs

**Social Feed**
- Share boards publicly → appears in global feed
- Feed items: board card preview with title, description, item count, author avatar + name
- Interactions: Like (heart), Comment, Repost, Bookmark
- Like animation: heart scale + color transition (200ms)
- Comment thread: inline expansion, newest first
- Feed sorting: Recent, Popular (most likes), Trending (velocity)
- Infinite scroll with skeleton loaders (3 skeleton cards as placeholder)

**Messaging System**
- Direct messages between users
- Message list: avatar + name + last message preview + timestamp + unread badge
- Chat view: message bubbles (sent right, received left), auto-scroll, typing indicator
- Send text messages (no file upload in this tier)
- Real-time delivery via WebSocket or polling (5s interval fallback)
- Online status: green dot on avatar

**Notifications**
- Notification types: new like, new comment, new follower, board shared with you, mention
- Notification list: icon + message + timestamp + read/unread state
- Mark all as read button
- Click notification → navigate to relevant content
- Real-time: new notifications push without refresh

**Admin Dashboard** (role: ADMIN or OWNER)
- Stats overview cards: Total Users, Total Boards, Items Created Today, Active Sessions
- User management table: name, email, role, joined date, last active, status
- Actions: promote to admin, demote, suspend, delete
- Content moderation queue: reported items, review + approve/remove
- System health: basic uptime, response time chart
- Charts: user growth (line), boards per day (bar), popular categories (pie)
- Charts library: Recharts or Chart.js

**Collaborative Boards**
- Invite users by email to edit a board
- Collaborator list on board settings
- Real-time sync: changes by one user appear for others
- Activity log per board: "Vegga added 'Buy milk' at 14:23"
- Permission levels: Owner (full), Editor (add/edit/delete items), Viewer (read-only)

**Export & Import**
- Export board: PDF (formatted printable list), CSV, JSON
- PDF export: clean layout with board name, date, items grouped by category
- Import from CSV (column mapping dialog)

**Theme System**
- Three modes: Dark (default), Light, System (follows OS)
- Theme toggle in profile/settings
- Smooth transition between themes (200ms CSS transition on custom properties)
- Theme persists per user in database

**Advanced UX**
- Keyboard shortcuts panel: press `?` to see all shortcuts
- Command palette: Ctrl+K for universal search + quick actions
- Virtualized lists: boards with 100+ items render efficiently
- Offline indicator: banner when connection lost, queue changes, sync on reconnect
- Undo/redo stack: Ctrl+Z / Ctrl+Shift+Z for last 20 actions

**Testing**
- E2E test suite covering: auth flow, board CRUD, share flow, feed interactions
- API integration tests for all endpoints
- Component unit tests for critical components

---

## TIER 4: PREMIUM / VAI (Full Commerce)

### Inherits: ALL of Battle-Tested

### Additional Features

**First-Launch Setup Wizard**
- 5 steps, full-screen, progress indicator, skip option per step:
  1. **Welcome:** VeggaAI branding animation, "Let's set up your workspace"
  2. **Database:** Connection string input OR "Use default" (SQLite for dev), test connection button with spinner + success/fail feedback
  3. **AI Keys (BYOK):** Paste API keys with auto-detect:
     - `sk-` → OpenAI (green badge)
     - `sk-ant-` → Anthropic (amber badge)  
     - `gsk_` → Groq (blue badge)
     - `xai-` → Grok (black badge)
     - `AIza` → Google (multicolor badge)
     - Keys masked after entry: `sk-pr••••abcd`
     - "Get a key" links to each provider's console
     - Skip → uses platform's free tier (rate-limited)
  4. **OAuth:** Google Client ID/Secret input, "How to get these" expandable guide with screenshots, test button
  5. **Admin Account:** Name, email, password, confirm → creates first admin user
  6. **Complete:** Confetti animation, "Your workspace is ready" → Launch button

**Glass Sidebar Shell**
- VeggaAI branded sidebar:
  - Collapsed (rail): 48px width, icons only, tooltip labels on hover
  - Expanded: 260px width, icons + labels + search
  - Toggle: click hamburger or Ctrl+B
  - Glass morphism: `backdrop-filter: blur(16px); background: oklch(0.16 0.005 250 / 0.80);`
- Activity bar icons: 🏠 Home, 📋 Boards, 💬 AI Chat, 📢 Feed, 🔔 Alerts, ⚙️ Settings
- Active indicator: left accent bar (2px, violet)
- Bottom: user avatar + name + status, settings gear

**OKLCH Violet Theme System**
```css
--bg-primary:     oklch(0.13 0.00 0);
--bg-secondary:   oklch(0.16 0.00 0);
--bg-elevated:    oklch(0.19 0.005 250);
--border-subtle:  oklch(0.25 0.00 0);
--border-active:  oklch(0.45 0.14 270);    /* violet */
--accent:         oklch(0.65 0.20 270);    /* violet */
--accent-hover:   oklch(0.58 0.22 270);
--success:        oklch(0.65 0.18 155);
--danger:         oklch(0.60 0.22 25);
```

**AI Chat Panel**
- Dockable panel (can be sidebar, bottom, or popped-out window)
- SSE streaming responses: text appears token-by-token
- Multi-provider: switch between OpenAI, Anthropic, Groq, Google, Grok
- Model picker dropdown per provider
- Conversation history in sidebar (grouped: Today, Yesterday, Older)
- Markdown rendering: bold, italic, code blocks (syntax-highlighted), tables, lists
- Message actions: Copy, Retry, Like, Dislike
- Typing indicator: 3 pulsing dots
- Auto-scroll with "scroll to bottom" FAB when user scrolls up
- Chat input: auto-growing textarea, Enter to send, Shift+Enter for newline
- BYOK panel (collapsible below input): manage saved keys, add new, delete

**AI-Powered Board Features**
- "Ask Vai" button in board toolbar:
  - "Create a meal prep board for the week" → Vai generates board with items
  - "Suggest items for a camping trip" → Vai adds suggestions to current board
  - "Categorize my shopping list" → Vai auto-groups items
  - "What am I forgetting?" → Vai analyzes board and suggests missing items
- Smart categorization: AI auto-assigns categories to new items
- Natural language due dates: "buy milk tomorrow", "finish report by Friday"

**Panel System (VS Code-inspired)**
- Panels: Board, Chat, Feed, Notifications, Settings — each is a Panel View
- Drag panels to: left slot, center slot, right slot, bottom slot
- Resize via draggable dividers (minimum 200px per panel)
- Tab grouping: multiple views share one panel slot as tabs
- Collapse/expand: double-click divider to auto-size
- Layout persistence: save to database, restore on login
- Pop-out: double-click title bar → opens in new browser window
- BroadcastChannel sync between main window and pop-outs

**Metrics Dashboard**
- Usage analytics: boards created, items completed, streaks, most active times
- AI usage: requests per provider, tokens consumed, estimated cost
- User engagement: DAU/WAU/MAU if multi-user, session duration
- Charts: line (activity over time), bar (boards per category), donut (completion rate)
- Export metrics as CSV

**Payment Integration**
- Stripe integration for premium features
- Subscription tiers: Free (5 boards, no AI), Pro ($9/mo, unlimited + AI), Team ($29/mo, collaboration + admin)
- Billing page: current plan, usage, invoices, payment method
- Upgrade flow: select plan → Stripe checkout → confirmation
- Feature gating: locked features show upgrade prompt with what they unlock

**Advanced Shopping**
- Budget tracking per shopping board: set weekly/monthly budget, track spending
- Price comparison: mark items with prices, see total by store
- Recipe integration: add a recipe → auto-generates shopping list with ingredients
- Smart suggestions: based on past purchases, suggest items you might need
- Barcode scanning (mobile): scan product → add to list with name + price

**Recurring & Scheduled Items**
- Set items to recur: daily, weekly, biweekly, monthly, custom
- Calendar view: see items due each day
- Auto-create recurring items on their schedule
- Snooze: push a recurring item to next occurrence

**Refer to `REBUILD_PROMPT_PREMIUM_TEMPLATE_tier4.md` for:**
- Full panel system specification (8-handle resize, magnetic snapping)
- Complete chat system spec (sub-200ms feel, ref-based streaming)
- Wallet system (multi-chain, multi-wallet, EVM + Solana)
- True Reach scoring engine (7-pillar behavioral metrics)
- OSRS-style P2P trading
- Advanced poll system (6+ question types)
- Norwegian legal integration (Brønnøysund, Skatteetaten)
- 5-layer E2E test pyramid
- Complete database schema

---

## Cross-Stack Template Matrix

| Feature | PERN | MERN | Next.js | T3 |
|---------|------|------|---------|-----|
| **Runtime** | Express + React (Vite) | Express + React (Vite) | Next.js App Router | Next.js + tRPC |
| **Database** | PostgreSQL + Prisma | MongoDB + Mongoose | PostgreSQL + Prisma | PostgreSQL + Prisma |
| **Auth** | Passport.js + session | Passport.js + JWT | NextAuth v5 | NextAuth v5 via tRPC |
| **API style** | REST | REST | Server Actions + Route Handlers | tRPC procedures |
| **Validation** | Zod | Zod | Zod | Zod (tRPC input) |
| **Styling** | Tailwind CSS | Tailwind CSS | Tailwind CSS | Tailwind CSS |
| **Real-time** | Socket.io | Socket.io | Server-Sent Events | tRPC subscriptions |
| **Build** | Vite (client) + tsc (server) | Vite (client) + tsc (server) | next build | next build |
| **Dev** | concurrently (client + server) | concurrently (client + server) | next dev | next dev |

---

## Validation: How to Confirm Each Tier Works

After deploying each of the 16 templates:

### Basic Check
- [ ] App renders without errors
- [ ] Board sidebar visible with default boards
- [ ] Can add, complete, delete items
- [ ] Drag and drop works
- [ ] Empty state validation on "New Board"
- [ ] Responsive: works on mobile viewport
- [ ] Dark theme applied

### Solid Check (above + these)
- [ ] Login page appears for unauthenticated users
- [ ] Can create account with email/password
- [ ] Google OAuth button visible and clickable
- [ ] After login, boards load from database
- [ ] Can share a board and access via link
- [ ] Search works across boards
- [ ] Tags and due dates functional

### Battle-Tested Check (above + these)
- [ ] 6-tab navigation visible
- [ ] Feed tab shows shared boards
- [ ] Messages tab opens messaging UI
- [ ] Notifications show recent activity
- [ ] Admin dashboard accessible for admin users
- [ ] Charts render with data
- [ ] Collaborative editing works between two users
- [ ] Theme switcher works (dark/light/system)

### Premium Check (above + these)
- [ ] Setup wizard appears on first launch
- [ ] BYOK key auto-detection works
- [ ] Glass sidebar with VeggaAI branding
- [ ] AI Chat panel opens and streams responses
- [ ] Panel drag/resize works
- [ ] Metrics dashboard shows data
- [ ] "Ask Vai" generates board content
- [ ] Stripe checkout flow works (test mode)
