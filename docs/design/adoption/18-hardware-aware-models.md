# Hardware-aware local model management

## Decision

Hardware probing records CPU/architecture, system RAM, GPUs, VRAM, backend
versions, and supported accelerators. Probes are best-effort and retain raw
command/exit/log evidence. Ranking uses estimated weights plus quantization,
KV-cache/context cost, backend support, architecture age, and workload fit.

Scores must be meaningfully differentiated and explainable; missing data lowers
confidence rather than inventing precision. Install/load/runtime failures display
the real sanitized command/output/log, a copy action, and the next diagnostic.

## Acceptance

Fixture hardware for NVIDIA/AMD/Apple/CPU-only/multi-GPU and old backends; ranking
separation tests; missing-driver and out-of-memory diagnostics; no platform-only
command assumptions.
