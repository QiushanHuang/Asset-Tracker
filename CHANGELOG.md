# Changelog

All notable product changes are recorded here.

## [3.1.1] - 2026-08-11

### Fixed

- Fixed the macOS app entering `save-outcome-unknown` protection immediately after opening a ledger with automatic backup enabled.
- Preserved the required `Window` receiver when the save queue schedules and clears WebKit durability deadlines.
- Fixed the strict native bridge treating WKScriptMessage numeric `schemaVersion: 1` as a Boolean and rejecting a valid save request.
- Restored the normal writable shell and button interaction after the startup durability save succeeds.

### Tested

- Added a receiver-sensitive WebKit timer regression harness and a full native activation-backup test.
- Added Swift coverage for WKScriptMessage `NSNumber` integers, real CFBoolean rejection, and fractional-number rejection.
- Performed an actual packaged-app startup against the existing local ledger and confirmed `账本已安全打开` / `已安全写入本机` plus working navigation.

### Distribution note

The macOS artifact remains unsigned and not notarized. Apple signing and notarization are intentionally outside this release.

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
