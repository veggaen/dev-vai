# Platform constants and literal policy

## Decision

Create `@vai/constants` as the source of persisted filenames/relative paths,
loopback hosts, internal/dev ports, protocol names, pagination limits, timeouts,
stream bounds, and index limits. Values are grouped by domain and deeply frozen.
The package contains constants and pure URL/path-independent helpers only.

OS-specific absolute paths are never constants. Hosts combine constants with
platform path APIs at runtime. Environment overrides are parsed once and still
fall back to the same constants.

## Enforcement

A repository policy check scans production sources for governed path, port, and
limit literals outside `@vai/constants`. A literal added to an allowlist needs a
reason. Tests, fixtures, CSS measurements, generated templates, and protocol
status codes are not confused with operational limits.

## Acceptance

- Runtime port, direct channel port, database/knowledge/lock names, dev ports,
  session limits, tool limits, and request timeouts use exported constants.
- `pnpm lint:constants` fails on an introduced governed literal.
- Windows/macOS/Linux callers resolve persisted locations with native path APIs.
