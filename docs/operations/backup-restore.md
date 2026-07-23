# Backup and restore

Vai treats workspace files as the primary copy. Removing Vai's caches or indexes
must never remove those files. The structured backup covers host-owned metadata:
personas, learned skills, environment definitions, governed memories, complete
agent sessions and events, share manifests, and linked-object records. Pairing
tokens, session secrets, and environment credentials are intentionally excluded.

## Create and verify a backup

`GET /api/export` returns one schema-versioned JSON bundle. To create an atomic
folder snapshot, call `POST /api/export/folder` with `{ "targetRoot": "..." }`.
Vai creates a new timestamped directory and refuses to reuse an existing one.
Each JSON payload is listed in `vai-export-manifest.json` with its UTF-8 byte count and
SHA-256 digest. Verify those values before moving a backup between machines.

The API follows the runtime's normal authority rules: loopback-only when remote
auth is off, and a signed-in platform viewer plus the configured transport
credential when auth is enabled. Never publish the export folder because it can
contain private conversation and memory content.

## Restore safely

Submit the bundle to `POST /api/export/restore`:

```json
{
  "bundle": { "schemaVersion": 1, "exportedAt": 0 },
  "dryRun": true,
  "overwrite": false
}
```

The abbreviated `bundle` above is illustrative; use the complete validated
bundle returned by `/api/export`. Dry-run is the default and reports every
`domain:id` collision plus per-domain apply counts without changing state.
Review that report, then repeat with `dryRun: false`. With `overwrite: false`,
new records are merged and collisions are preserved. `overwrite: true` replaces
only records with matching IDs; unrelated current records and user files remain.

For normal or large installations, prefer `POST /api/export/restore-folder`
with `{ "sourceFolder": "...", "dryRun": true, "overwrite": false }`. The
runtime reads the snapshot locally and verifies every manifest checksum before
parsing anything, avoiding a large in-memory HTTP upload. Use JSON restore only
for small programmatic backups.

Restored non-loopback environments return as `unverified`, without credentials.
Pair them again to obtain a new revocable session. Link edges are derived data
and are rebuilt incrementally from user files after restore. A newer unknown
schema version fails validation rather than being partially imported.

## Disaster-recovery order

1. Restore the user-owned workspace folders from their normal file backup.
2. Start Vai on loopback and confirm the health panel is usable.
3. Verify the export checksums and run a dry-run restore.
4. Resolve reported ID conflicts, then apply without overwrite first.
5. Re-pair remote environments and integrations; never copy old secrets.
6. Re-index links and confirm the health/degraded-state panel reports expected
   optional subsystems before exposing the runtime remotely.
