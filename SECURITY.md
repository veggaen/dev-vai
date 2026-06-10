# Security Policy

## Supported Versions

VAI is under active development. Security fixes are applied to the current
default branch. Older snapshots are not maintained as supported releases.

## Reporting A Vulnerability

Please do not open a public issue for a suspected vulnerability.

Report the issue privately to the repository owner with:

- The affected route, component, or workflow.
- Reproduction steps or a minimal proof of concept.
- The expected impact and any known preconditions.
- Suggested mitigations, if available.

Do not access data that is not yours, disrupt other users, or run destructive
tests against a shared environment. You should receive an acknowledgement
within seven days.

## Local-First Boundary

The runtime binds to loopback by default. Network exposure is an explicit
deployment decision and requires API authentication through `VAI_API_KEYS`.
Use a separate `VAI_CAPTURE_API_KEY` for remote capture clients.
