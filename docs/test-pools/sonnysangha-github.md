# Sonny Sangha GitHub repos as a Dev-Vai IDE stress pool

Created: 2026-07-10

Source checked: https://github.com/sonnysangha?tab=repositories

## Why this pool is useful

Sonny's public repos are a strong real-world IDE test set because many are tutorial/fullstack apps with modern stacks:

- Next.js / React / TypeScript
- Clerk auth
- Convex, Sanity, MongoDB, Prisma, Stripe, Mux, OpenAI, Expo
- heavy `.env.example` setup
- projects that may compile but fail at runtime until config is supplied
- repo names that often communicate the stack clearly

That makes them ideal for testing Vai's actual promise:

1. clone/open a real project,
2. detect framework/package manager,
3. detect missing env and setup notes,
4. start what can be started,
5. fail honestly when config is missing,
6. help the user add real local env values without inventing secrets,
7. use chat to make a code change,
8. verify with rendered proof.

## Initial candidate lanes

Pick a small rotating sample first; do not clone all 63 repos at once.

### Config-heavy web apps

Good for env detection, setup guidance, and safe fallback UI.

- `pizza-app-starter-turbo-expo-nextjs-clerk-convex-monorepo`
- `Vibe-Code-the-Right-Way-Ep-1-Indeed-Clone-Multi-Tenant-Clerk-Convex-MCP`
- `property-listings-app-nextjs-clerk-auth-billing-sanity-saas`
- `scheduling-app-nextjs-16-sanity-clerk-coderabbit`
- `ecommerce-ai-nextjs-16-sanity-clerk-agentkit-stripe-checkout-vercel-ai-agents`
- `lms-platform-ai-saas-sanity-clerk-coderabbit-mux-openai-ai-agent-nextjs-16`
- `ticket-marketplace-saas-nextjs15-convex-clerk-stripe-connect`

### Mobile / Expo apps

Good for verifying Vai does not assume every project should start as a web preview.

- `AI-Dating-App-Expo-SDK-55-Clerk-Convex-OpenAI`
- `journal-ai-app-react-native-expo-sanity-clerk-billing-openai-vercel-ai-tamagui`
- `journal-app-sanity-clerk-billing-expo-router`
- `fitness-app-expo-react-native-starter-nativewind-typescript`

### Smaller focused demos

Good for fast smoke tests and chat-edit loops.

- `clerk-m2m-tutorial`
- `clerk-waitlist-demo`
- `clerk-api-keys-tutorial`
- `storybook-demo-live`
- `arcjet-nextjs-15-demo`
- `Nextjs-15-Auth0-Role-Based-Authentication-Tutorial-demo`

## Per-repo scorecard

For every repo tested, record:

- clone/open path
- detected framework and package manager
- install result
- dev command chosen by Vai
- `.env.example` vars detected
- README setup notes detected
- first preview state: rendered / setup-required / failed
- whether failure card reports the real cause
- whether "Set env values" writes `.env.local` without echoing secrets
- whether chat can make one code edit and verify HMR/render
- screenshots/evidence path

## Safety rules

- Never invent credentials, API keys, deployment URLs, OAuth IDs, Stripe keys, Clerk keys, or Convex URLs.
- Do not commit generated `.env.local`.
- Prefer one repo at a time; these projects can be large and dependency-heavy.
- If a repo requires external services, the PASS state can be a clean setup-required screen, not a fake connected app.
- If a repo is mobile-only/Expo-only, Vai should say so and offer the correct run path instead of forcing a browser preview.

## Suggested first batch

Start with three:

1. `clerk-waitlist-demo` — small Clerk env flow.
2. `arcjet-nextjs-15-demo` — focused Next.js security/rate-limit demo.
3. `ticket-marketplace-saas-nextjs15-convex-clerk-stripe-connect` — heavy realistic fullstack env stress.

This gives one small, one medium, and one gnarly app without overloading the machine.
