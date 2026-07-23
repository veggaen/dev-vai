# File ownership and structured export

## Decision

User-authored content remains ordinary files in user-selected folders. Vai stores
derived indexes/caches separately and can rebuild them. Every Vai-owned database
domain exports a documented, versioned folder/JSON representation: conversations,
sessions, memories, personas, skills, environments (without secrets), links,
share manifests, and settings.

Imports validate schemas, preserve unknown future fields in an extension bag, and
offer dry-run conflict reports. Backups are atomic snapshots with checksums;
restore never silently overwrites newer user files.

## Acceptance

Round-trip/dry-run/corruption/version/conflict tests and a documented CLI/API
backup/restore flow. Deleting Vai's cache must not delete user content.
