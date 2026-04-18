# Contributing to VeggaAI

Thanks for taking a look at VAI.

## Before you start

- Read [`Master.md`](Master.md) first. It is the durable source of truth for project doctrine and priorities.
- Treat files in `Temporary_files/` and other scratch areas as non-authoritative working material unless explicitly promoted.
- Prefer small, working, measurable slices over broad speculative changes.

## Local setup

```bash
pnpm install
pnpm dev
```

Optional surfaces:

```bash
pnpm dev:ext
pnpm dev:desktop
pnpm dev:web
```

## Quality bar

Run these before opening a PR:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm vai:retrieval:eval
```

If you touch chat quality or grounding behavior, also run:

```bash
pnpm vai:chat:bench
pnpm vai:eval
```

## Pull request guidance

- Keep changes focused.
- Explain the user-facing impact and the reason for the change.
- Add or update tests when behavior changes or regression risk is non-trivial.
- Do not silently weaken privacy, trust, or retrieval quality gates.

## Architecture notes

- `packages/core` contains the engine, ingest, search, eval, sessions, and skills.
- `packages/runtime` contains the Fastify/WebSocket server and sandbox orchestration.
- `apps/desktop` and `apps/extension` are product surfaces, not throwaway demos.
- `packages/api-types` is the preferred place for shared request/response contracts.

## Scratch material

If you need temporary notes, logs, or experiments, keep them out of the product surface. Use ignored local directories instead of adding new top-level clutter.
