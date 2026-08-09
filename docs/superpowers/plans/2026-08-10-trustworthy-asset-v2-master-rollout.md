# Trustworthy Asset Product V2 Master Rollout Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the unsafe legacy asset tracker with a trustworthy, explainable, recoverable Web/macOS product while preserving user data and keeping the legacy writer safe until an atomic V2 cutover.

**Architecture:** Use Route C from the approved design: first isolate legacy P0/P1 risks in the current root runtime, then build a separate `/app` vertical slice around immutable ledger events and a single selected `PrimaryStore`, add the adaptive product shell, and finally perform a fenced one-way cutover. Never dual-write legacy and V2. Root Web files remain the legacy source of truth until cutover; `macos-app/Resources/Web` is generated only by `script/sync_web_assets.sh`.

**Tech Stack:** Legacy Vanilla JavaScript/CSS/HTML, Node `node:test`, AppKit + WKWebView + Swift; V2 Vite + TypeScript + React, Zod, Vitest, Playwright, IndexedDB or native SQLite selected by the WKWebView origin spike; append-only native recovery segments and canonical SHA-256 commit records.

---

## Authoritative Inputs

- Product/domain/reliability specification: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/docs/superpowers/specs/2026-08-10-trustworthy-asset-product-v2-design.md`
- Committed execution-baseline specification hash: `095a60b09e4657f40be0ff6fcbfd282516b26860d9a2d3f184c01e2992561b7d`
- Review trace: reviewers approved the substantive bytes at `6bb718d33461d89396c207c3eb79b4319658d74d59d1b15ef6229d36f3440f99`; the only subsequent edit changed the document status to “已批准” and recorded that review hash. The resulting committed bytes above are the formal execution baseline and must receive a final metadata-only hash confirmation before Phase 1 code starts.
- Specification commit: `81a444d docs: define trustworthy asset product v2`
- Phase 1 detailed plan: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/docs/superpowers/plans/2026-08-10-phase1-legacy-risk-isolation.md`
- The older `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/docs/superpowers/plans/2026-04-13-phase1-checkpoint1-foundation.md` is superseded. It contains stale source paths and must not be executed.

## Non-Negotiable Delivery Rules

1. Every behavior change starts with a failing test and ends with the smallest passing implementation.
2. Every implementation task receives an independent specification review and an independent quality/security review before merge.
3. Never edit `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Resources/Web` by hand; regenerate it from root sources.
4. Never infer a missing historical FX rate, silently normalize invalid data, or fall back to `1:1` conversion.
5. Never display a successful write before the platform-appropriate commit ACK. Web may report only local browser commit; macOS may report durable confirmation only after its native durability protocol.
6. Never convert corrupted or unsupported non-empty data into a writable empty book.
7. Never dual-write legacy and V2. The first V2 write permanently makes legacy read-only.
8. A repeated iteration counts only when it adds new evidence. A failed gate is fixed and rerun together with every affected earlier gate.
9. Each task ends with a small, reviewable commit and an evidence note under `docs/evidence/v2/`.

## Dependency Map

```text
Approved specification
        |
        v
Phase 1: legacy risk isolation
        |
        v
Phase 2A: WKWebView origin/PrimaryStore spike
        |
        v
Phase 2B: ledger + storage vertical slice
        |
        +------------------+
        |                  |
        v                  v
Phase 3A: adaptive UI   Phase 3B: data safety/import
        |                  |
        +--------+---------+
                 v
Phase 3C: deterministic insight + automation drafts
                 |
                 v
Phase 4: migration, fenced cutover, hardening
                 |
                 v
7 end-to-end loops + 7 reliability loops + 7-day soak
```

## Stage 0: Freeze Decisions and Baselines

**Status:** Complete.

**Evidence:**

- Three rounds of product, UX, accounting, migration, and reliability review are recorded in the approved specification.
- Product IA is `总览 / 账户 / 流水 / 更多` with a global `记一笔` action.
- The source of truth is immutable posted events plus dated opening/balance assertions; balances are projections, never editable stored totals.
- The existing baseline is `6/6` Node tests passing and a successful Swift scratch build.

**Gate:** The committed execution baseline is hash-verified, and reviewers confirm that the post-review byte change is metadata-only, before implementation starts.

## Stage 1: Legacy Risk Isolation

Execute the companion plan:

`/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/docs/superpowers/plans/2026-08-10-phase1-legacy-risk-isolation.md`

**Outcomes:**

- Corrupted/unsupported books open in a non-destructive read-only recovery state.
- Writes are serialized, snapshot at enqueue time, and wait for the truthful platform-specific commit/durability state before success text.
- A legacy cutover checkpoint can freeze and drain every writer.
- Deterministic accounting errors are repaired: net worth sign, report-currency rebasing, foreign-currency reversal, local calendar dates, and category-cycle prevention.
- Random analytics, dead controls, and unvalidated destructive workflows are removed or gated.
- Persistent XSS, bridge navigation, narrow-screen reachability, modal accessibility, and macOS minimum-size defects are closed.

**Hard gate:**

```bash
cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账
node --test tests/*.test.js
TZ=Asia/Shanghai node --test tests/legacy-accounting-safety.test.js
TZ=America/Los_Angeles node --test tests/legacy-accounting-safety.test.js
swift test --package-path macos-app
swift build --package-path macos-app
bash script/verify-phase1.sh
git diff --check
```

In addition, browser acceptance must show zero non-intentional horizontal overflow at `320, 375, 768, 812 landscape, 1024, 1440` CSS pixels and at 200% text zoom.

## Stage 2A: Select the macOS PrimaryStore Once

Create the detailed plan only after Stage 1 passes:

`docs/superpowers/plans/2026-08-10-phase2a-primary-store-spike.md`

### Task 2A.1: Fixed-origin WKWebView spike

**Create:**

- `spikes/wkwebview-origin/`
- `macos-app/Tests/AssetTrackerMacTests/WKOriginPersistenceTests.swift`
- `docs/evidence/v2/phase2a-origin-spike.md`

Test install, upgrade, bundle move, re-sign, quarantine, relaunch, two instances, and recovery after process kill. Record the exact origin and data-store path without relying on undocumented defaults.

### Task 2A.2: Publish-channel decision

- If every origin/persistence gate passes, lock macOS to IndexedDB using a non-ephemeral `WKWebsiteDataStore` and stable origin.
- Otherwise lock macOS to native SQLite behind the same `PrimaryStore` contract.
- Write the decision and evidence into a checked-in manifest. Runtime fallback is forbidden.

**Gate:** The chosen adapter passes the same revision, transaction, unique-claim, command-idempotency, and crash-reopen contract suite.

## Stage 2B: Trustworthy Ledger and Storage Vertical Slice

Create the detailed plan after 2A:

`docs/superpowers/plans/2026-08-10-phase2b-ledger-storage-vertical-slice.md`

### Task 2B.1: Scaffold the isolated V2 application

**Create:** `/app` as Vite + TypeScript + React. Do not use the stale 2026-04 plan verbatim. Establish strict TypeScript, Vitest, Playwright, linting, formatting, bundle analysis, and deterministic fake clocks/IDs.

### Task 2B.2: Implement canonical domain values

Implement `Money`, minor units/decimal policy, `LocalDate`, `BookTimeZone`, canonical FX pair/rate, stable IDs, and canonical serialization. Cover Golden 18–20 and 33 before entities.

### Task 2B.3: Implement Account, DraftEvent, LedgerEvent, and AccountImpact

Drafts are mutable by revision; posted events are immutable. Implement income, expense, credit expense, transfer, borrowing, repayment, opening balance, and balance calibration using the approved user terminology.

### Task 2B.4: Implement corrections and assertions

Implement exact reversal, `CorrectionGroup`, stable projection slots, refund limits, assertion root/leaf supersession, move semantics, and cycle/fork prevention. Cover Golden 9–14, 16–17, 28, 31, 32, and 34. Golden 15 belongs to Stage 3C automation.

### Task 2B.5: Implement repository contracts

Use one `UnitOfWork` for entity writes, all `DeduplicationClaim` rows, `CommitLog`, outbox state, and revision changes. Run the identical contract suite against the adapter selected in 2A and a deterministic in-memory test adapter.

### Task 2B.6: Implement native recovery protocol

Persist the same canonical `CommitRecordBody` bytes used by PrimaryStore. Verify `commitChainHash == headHash == segmentHash`, atomic temp/fsync/rename/directory-fsync, segment idempotency, manifest rebuild, canonical base snapshots, and staging restore.

### Task 2B.7: Implement projections and the golden ledger

Build balance, due liability, liability overpayment, net worth, today-spend, trend, and change-bridge projections. Maintain one executable golden catalog with explicit stage ownership. Stage 2B must pass Golden 1–14, 16–26, 28–29, 31–34, and 36; scenarios owned by later stages must not be marked passing early. Golden 37 is reserved for the platform activation/recovery-base gate in Stage 4 even though its underlying snapshot primitives are built earlier.

### Task 2B.8: Implement read-only legacy migration dry-run

Map leaf balances, non-leaf synthetic accounts, cutover anchors, same-time ordering, future-event compensation, raw-source retention, and quarantine. Run the same input 100 times and require identical canonical hashes.

**Hard gate:** 200 deterministic commands, at least 20 storage/recovery kill points, every Stage-2-owned golden listed above, no partial commit, no duplicate economic effect, deterministic migration hash, and 100% recovery of fully acknowledged commits.

## Stage 3: Adaptive Product and Complete Core Journeys

Create three implementation plans after Stage 2B passes:

- `docs/superpowers/plans/2026-08-10-phase3a-adaptive-shell.md`
- `docs/superpowers/plans/2026-08-10-phase3b-data-safety-import.md`
- `docs/superpowers/plans/2026-08-10-phase3c-insight-automation.md`

### Stage 3A: Adaptive shell and account workspace

- Desktop: 240px rail at `>=1200`, collapsible rail at intermediate widths.
- Tablet: persistent 80px rail; master-detail in landscape and single column in portrait.
- Phone: four-item bottom navigation; global record action remains a button outside the navigation semantics.
- Implement onboarding, accounts, record flow, transactions, correction, calibration, and the persistent save/read-only status bar.
- Use semantic buttons/forms/dialogs, keyboard paths, focus restoration, reduced motion, text alternatives, and WCAG 2.2 AA contrast.

### Stage 3B: Data safety and exchange

- Implement the Data Safety Center, backup health, snapshot list, restore preview, staging validation, import diff, quarantine report, full-book round-trip, and danger zone.
- Validate JSON/CSV/XLSX before mutation, prevent ZIP bombs/prototype pollution/formula injection, and create a pre-import recovery point.
- Never call browser storage a backup; distinguish PrimaryStore from native recovery replicas.

### Stage 3C: Deterministic insight and automation drafts

- Implement net-worth change bridge, verified trends, data-table alternatives, recent month stable sorting, and export only from reconciled projections.
- Implement immutable schedule identity, versioned rule intent, occurrence claims, draft review, handover CAS, and deterministic catch-up. Do not restore prediction or arbitrary chart configuration.
- Add and pass Golden 15, 27, and 30 for occurrence idempotency, rule-version selection, and schedule handover races.

**Hard gate:** Complete the five required user journeys at every target viewport; keyboard-only completion; axe critical/serious `0`; every aggregate drills into reconciled events; import/export/restore round-trip matches counts, balances, and hashes.

## Stage 4: Migration, Cutover, and Release Hardening

Create:

`docs/superpowers/plans/2026-08-10-phase4-cutover-release.md`

### Task 4.1: Shadow migration and classification

Compare V2 against the approved golden contract, not legacy output. Classify each difference as `expected-fix`, `migration-defect`, or `quarantined-unknown`. Zero unexplained minor-unit differences are allowed.

### Task 4.2: Freeze and final migration

Acquire the finalization lease, advance epoch, freeze legacy, drain all prior writers, create the final legacy snapshot + manifest, and build the V2 candidate. Do not activate it yet.

### Task 4.3: Establish V2 recovery readiness

Create and reread the platform-appropriate canonical V2 base snapshot, restore it into one-time staging, replay recovery segments, and compare head hash, entity counts, per-account balances, and capability versions.

### Task 4.4: Serialize abort against first V2 write

Use `CutoverWriteFence` inside the selected PrimaryStore transaction. If abort wins, first V2 write rejects and legacy may unfreeze; if first V2 write wins, abort rejects and legacy stays permanently read-only. Test crashes after fence, pointer, unfreeze, and cleanup.

### Task 4.5: Package and rollback compatibility

Build signed/notarized release candidates where credentials exist, generate SBOM/licenses, verify dependency advisories, and test the previous stable V2 build against every newly written capability. Rollback never means resuming legacy writes.

**Hard gate:** Golden 35 and the activation/platform aspects of Golden 37 pass, then the complete 37-scenario suite passes together. No unresolved P0/P1; performance, security, accessibility, migration, recovery, upgrade, and rollback matrices pass; a seven-day soak produces no data loss, commit gap, hash fork, or unexplained accounting difference.

## Seven Complete End-to-End Iterations

For each iteration create `docs/evidence/v2/e2e-loop-N.md` containing environment, build/commit, fixtures, exact commands, screenshots, failures, fixes, reruns, and residual risk.

1. Accounting correctness: event matrix, assertions, corrections, FX, all golden projections.
2. Core journeys: onboarding, record, correction, calibration, templates, recurring drafts.
3. Cross-device UX: all viewports, 200% text, keyboard, VoiceOver, error/read-only states.
4. Migration and exchange: dry-run, quarantine, deduplication, CSV/XLSX/JSON, round-trip.
5. Recovery and rollback: snapshots, segments, staging, cutover race, rollback build.
6. Performance and security: 50k/500/10-year dataset, XSS, hostile files, bridge, dependencies.
7. Release candidate: production package, install/upgrade matrix, complete regression, soak start.

## Seven Reliability Iterations with Five Review Roles

Use five roles in two concurrent batches because only four agent slots exist: persistence faults, data integrity, performance, security, and final validation. Each loop requires an independent reviewer and a retest after every fix.

1. Queue/revision/Web Locks/out-of-order ACK/duplicate command.
2. Adapter/outbox/native rename/ACK/snapshot/activation kill points, including abort-vs-first-write.
3. Quota/disk-full/read-only directory/corrupt snapshot/hash break/permission change.
4. Malicious JSON/XLSX/CSV/duplicate import/migration ambiguity/formula injection/rollback.
5. Fixed 50k-event performance corpus, memory, startup, projections, scrolling, worker budgets.
6. macOS upgrade/move/re-sign/quarantine/two instances/origin/bridge permissions.
7. Full regression, release package, recovery drill, and seven-day soak conclusion.

## Evidence and Stop Conditions

Stop all writes and block release on any unexplained minor-unit difference, corrupted or unsupported capability, broken revision/sequence/hash chain, missing acknowledged command, partial migration/import/restore, duplicate economic effect, P0/P1, failed origin gate without a verified alternate adapter, or exceeded hard performance budget.

V2 replaces legacy only when all four stage gates, all seven end-to-end iterations, all seven reliability iterations, the complete 37-scenario golden suite, and the seven-day soak are evidenced and passing.
