# Schema-only contracts

## Decision

Replace the API-shaped but core-dependent `@vai/api-types` boundary with
`@vai/contracts`: Zod schemas, inferred types, enums, and JSON-safe constants
only. It may depend on Zod and nothing else. It contains no I/O, clocks,
filesystem access, parsing side effects, network clients, or business policy.

Every HTTP body/response, WebSocket frame, agent-process event, environment
credential envelope, plugin-host message, memory record, health item, and share
manifest is validated on ingress and egress. Clients use `parse`/`safeParse`
rather than TypeScript casts.

## Compatibility and scale

Subpath exports keep dependency surfaces small. Schema versions are explicit;
additive changes remain compatible and migrations are owned outside the package.
Collections are bounded and paginated. Paths remain platform-neutral strings at
the boundary and are resolved only by the receiving host.

## Acceptance

- Package has no dependency on core/runtime/UI and a policy test proves it.
- Invalid REST, WS, agent, plugin, environment, memory, and health payloads fail.
- Runtime and desktop consume validated values at representative boundaries.
- The former package name has no production imports.
