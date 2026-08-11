# Changelog

All notable product changes are recorded here.

## [3.1.0] - 2026-08-11

### Added

- Native durable save receipts tied to the exact source and committed state.
- Crash-safe ordinary recovery with pending cleanup and health reporting.
- Snapshot creation, deduplication, retention, recovery, and dual-domain health.
- Strict `storage.save`, `storage.snapshot`, load, error, and terminal bridge DTOs.
- A real-process fault harness for critical rename boundaries and confirmed-source CAS.
- Formal unsigned macOS release artifacts with SHA-256 verification.

### Changed

- Save coordination now uses one serialized durable operation instead of a read-then-write TOCTOU flow.
- The macOS host routes saves and snapshots through the native durable store.
- Web assets are synchronized from an explicit manifest before packaging.
- The app bundle now carries an explicit `3.1.0` version and build number.

### Fixed

- Recovery namespace, temporary-file, orphan, pending, and health-clear convergence gaps.
- No-op acknowledgements that could otherwise outlive their final index proof.
- Snapshot timestamp canonicalization and retention cleanup behavior.
- Terminal receipts that previously omitted protocol, load, and gate state fields.

### Distribution note

The macOS artifact is unsigned and not notarized. Apple signing and notarization are intentionally outside this release.

## [3.0.0]

- Drag-and-drop category ordering, unified transaction forms, improved trend calculations, asset anchors, templates, filtering, and enhanced import/export.
