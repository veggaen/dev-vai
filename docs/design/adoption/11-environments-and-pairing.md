# Saved environments and pairing

## Decision

A saved environment describes one backend connection independent of transport:
loopback, LAN, private mesh, HTTPS, or SSH-launched. UI and sessions reference an
environment ID, not a base URL. Each environment reports transport, endpoint,
device label, trust state, last health, and credential ID.

Pairing begins with a short-lived single-use token represented as QR, URL, or
string. Web pairing places the token in the URL fragment so browsers do not send
it to servers/proxies. The token is exchanged over the intended channel for a
revocable scoped session. Credentials are stored with existing OS protection.
List/revoke management covers integrations, credentials, devices, and sessions.

Servers bind loopback by default. Explicit exposure requires auth, an allowlisted
origin, and a visible warning. Internal ports are never advertised as public.

## Acceptance

Schema/store/expiry/replay/revocation tests; fragment parsing proves no token in
request URL/logs; loopback-default and explicit-exposure tests; per-integration
scope isolation; documented backup excludes secrets by default.
