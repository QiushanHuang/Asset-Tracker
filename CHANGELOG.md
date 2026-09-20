# Changelog

All notable product changes are recorded here.

## [3.3.0] - 2026-09-20

### Added

- Original WeChat XLSX and Alipay CSV import, including GB18030 text and long text transaction identifiers.
- Local PDF text extraction for supported ICBC and OCBC FRANK layouts, with page totals, running balances and original-currency checks.
- Persistent import review batches, matching evidence and per-record decisions, included in full JSON backups and NAS snapshots.
- Resume unresolved reviews after reloading; explicit duplicate-only audit saves.

### Fixed

- Historical imports and later edits/deletions preserve current balances in local and NAS ledgers.
- Native WKWebView PDF loading uses local classic bundles without weakening CORS settings.
- Unknown NAS save results during review expose the existing idempotent retry flow.

### Limits

- Similar date and amount indicate a candidate, not proof of duplication. Transfers, refunds, combined payments and reversals require review.
- Account mapping must follow the actual funding account, not just the payment platform name.
- Supported text PDFs only; no OCR. macOS Apple silicon package is not Apple-notarized.

## [3.2.1] - 2026-09-20

### Added

- Project-specific expense categories and fast consecutive entry.
- Four complete local analysis workspaces with explicit ranges and rate assumptions.
- Optional NAS personal/shared/family books, invitations, role enforcement, revisions, transfers and household cash-flow summaries.
- Safe import review, standalone NAS setup, new logo/icon and bilingual operating guides.

### Fixed

- CSV/binary decoding, cancelled file pickers, duplicate/conflicting spreadsheet rows and stale imports.
- Transaction time/lineage loss and premature account-balance rounding during NAS edits.
- Hidden-panel recomputation during pagination and unnecessary NAS summary recalculation.
- Trusted-LAN NAS entry and identifier generation outside HTTPS secure contexts, behind explicit origin configuration.
- Updated the bundled SheetJS parser from 0.18.5 to 0.20.3; retained upstream license notices.

- Corrected debt balance direction in NAS entry/edit/delete and spreadsheet imports; preserved legacy reversal semantics.
- Spreadsheet exports now mark internal transfers and legacy debt deltas; unsupported appends require full JSON instead of losing financial meaning.

### Distribution and scope

- Apple-silicon macOS app, local web archive, NAS source/configuration archive and linux/amd64 image.
- The macOS app is unsigned; NAS collaboration remains early-stage, with trusted-LAN HTTP available only by explicit opt-in.
- No personal ledger, bootstrap secret, device-specific configuration or internal diagnostics are included.

### 中文摘要

新增项目分类、四大本地分析、连续记账和NAS家庭协作；修复导入编码、重复记录、保存反馈及历史精度问题。
更新Logo、同文件中英切换README、操作手册和表格解析库。详见[完整更新说明](docs/releases/v3.2.1.md#中文)。

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
