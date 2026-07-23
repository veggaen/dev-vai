# Disconnect resilience

## Decision

Local editor/composer state never depends on connection state. Mutations enter a
durable local outbox with idempotency keys; optimistic UI is explicitly labeled
pending. Reconnect performs ordered catch-up from a server cursor, then drains the
outbox. Duplicate acknowledgements are harmless.

Agent streams persist sequence numbers and resumable cursors. On reconnect they
resume when the provider/session supports it; otherwise the stream becomes a
visible terminal `interrupted` state with retained partial text and a retry action.
Silence is never represented as success.

## Acceptance

Tests simulate disconnect before send, mid-stream, after server commit/before ack,
reordered reconnect, duplicate events, server reset, and device clock skew. The
composer remains editable in every case.
