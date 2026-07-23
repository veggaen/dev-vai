# Agent process adapters

## Decision

Every agent CLI is a subprocess behind `AgentProcessAdapter`. The adapter owns
command discovery, version probing, environment construction, stdin framing,
stdout/stderr decoding, cancellation, and exit classification. It emits only the
versioned internal agent-event schema.

Provider-specific protocol code lives in one adapter; session orchestration never
switches on provider names. Raw output is bounded, treated as untrusted data, and
retained only as a diagnostic attachment. Secrets are passed by environment or
stdin, never command arguments or query strings.

## Parity and failure

Command/PTY behavior is injectable and tested for Windows, macOS, and Linux.
Unsupported PTY features fall back visibly to pipes. Spawn failure, protocol
error, timeout, cancellation, and non-zero exit are distinct terminal events.

## Acceptance

- A fake line-delimited adapter streams start/delta/tool/done/error events.
- Malformed/oversized frames fail visibly.
- Adding a fixture provider requires one adapter registration and no orchestrator edit.
