# Phase 1 Legacy Risk Isolation Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the existing Web/macOS product fail closed instead of losing or corrupting data, repair its deterministic accounting errors, remove untrustworthy reachable features, and make every surviving core task usable across supported window sizes before V2 development begins.

**Architecture:** Keep the root `index.html`, `styles.css`, `script.js`, and new `legacy-safety.js` as the only editable legacy Web runtime. Extract pure safety primitives and the write coordinator into `legacy-safety.js`; keep product orchestration in `script.js`. Extract the native book store, durable file writer, cutover state, and bridge policy into a testable Swift library. All writes pass through one command coordinator, one cutover lease check, and one durable adapter ACK. Generated macOS Web resources are synchronized only after root tests pass.

**Tech Stack:** Vanilla JavaScript, HTML/CSS, Node `node:test`, AppKit + WKWebView, Swift Package Manager/XCTest, Playwright + axe-core for browser acceptance.

---

**Exact specification baseline:** `095a60b09e4657f40be0ff6fcbfd282516b26860d9a2d3f184c01e2992561b7d` for `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/docs/superpowers/specs/2026-08-10-trustworthy-asset-product-v2-design.md` as committed by `81a444d`. If that file changes, stop and re-review this plan before code work.

## Scope and Source-of-Truth Rules

- Edit only root Web sources:
  - `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/index.html`
  - `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/styles.css`
  - `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script.js`
  - `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/legacy-safety.js`
- Do not edit `macos-app/Resources/Web/*` directly. Generate it with `script/sync_web_assets.sh`.
- Do not edit the divergent `记账/` folder.
- Do not introduce IndexedDB, the V2 event ledger, or any dual-write path in this phase.
- Preserve unknown legacy fields and raw corrupt bytes. Fail closed when a book cannot be proven safe.
- Keep JSON export and “open data folder” available in read-only recovery. Everything that mutates the book is disabled.

## Target File Layout

### New Web/Test Files

- `legacy-safety.js`
- `tests/helpers/asset-tracker-harness.js`
- `tests/data-recovery.test.js`
- `tests/save-queue.test.js`
- `tests/legacy-feature-gates.test.js`
- `tests/legacy-accounting-safety.test.js`
- `tests/legacy-stop-loss-ui.test.js`
- `tests/legacy-navigation.test.js`
- `tests/legacy-modal-a11y.test.js`
- `tests/cutover-control.test.js`
- `tests/security-boundary.test.js`
- `tests/web-assets-sync.test.js`
- `tests/e2e/phase1-stop-loss.spec.js`
- `playwright.config.js`
- `package.json`
- `package-lock.json`
- `script/serve-web.mjs`
- `script/verify-phase1.sh`
- `script/verify_macos_webview_smoke.sh`

### New Native Files

- `macos-app/Sources/AssetTrackerCore/AssetTrackerBookStore.swift`
- `macos-app/Sources/AssetTrackerCore/NativeDurableFileWriter.swift`
- `macos-app/Sources/AssetTrackerCore/CutoverControlStore.swift`
- `macos-app/Sources/AssetTrackerCore/FreezeCoordinator.swift`
- `macos-app/Sources/AssetTrackerCore/BridgeRequestPolicy.swift`
- `macos-app/Sources/AssetTrackerFaultHarness/main.swift`
- `macos-app/Tests/AssetTrackerCoreTests/AssetTrackerBookStoreTests.swift`
- `macos-app/Tests/AssetTrackerCoreTests/NativeDurableFileWriterTests.swift`
- `macos-app/Tests/AssetTrackerCoreTests/CutoverControlStoreTests.swift`
- `macos-app/Tests/AssetTrackerCoreTests/ProcessKillRecoveryTests.swift`
- `macos-app/Tests/AssetTrackerCoreTests/BridgeRequestPolicyTests.swift`

## Required Task Order

```text
1 Test seam
  -> 2 Safe loading/recovery
  -> 3 Durable write queue/snapshots
  -> 4 Command coordinator/feature policy
  -> 5 Accounting and reporting currency
  -> 6 Transaction/date/tree integrity
  -> 7 Cutover fence and kill points
  -> 8 Remove untrusted/dead product paths
  -> 9 DOM/CSP/native bridge security
  -> 10 Responsive shell/modal/a11y
  -> 11 Full acceptance and evidence
```

Tasks are merged strictly in the order above because Tasks 5/8 and Tasks 9/10 edit overlapping root UI/runtime files. Agents may perform read-only analysis in parallel, but only one implementation task may edit the shared root runtime at a time. Generated resources are synchronized only in Task 11.

## Task 1: Establish the Test Seam and Canonical Runtime Inventory

**Files:**

- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/helpers/asset-tracker-harness.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/web-storage.test.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/macos-scaffold.test.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Package.swift`

- [ ] **Step 1: Extract the existing VM harness without changing behavior**

Move `createElementStub()` and `loadAssetTracker()` out of `tests/web-storage.test.js`. The new harness accepts explicit dependencies and exposes observations:

```js
const app = loadAssetTracker({
    localStorageSeed: {},
    nativeHandler: null,
    lockManager: null,
    confirmResult: true
});

// Returns AssetTracker, elements, DOM handlers, storage writes,
// bridge requests, messages, and a deferred() helper.
```

The DOM stub must support attributes, focus, children, event dispatch, `querySelector`, `querySelectorAll`, and `classList.contains`, because later accessibility tests must observe real state rather than no-op methods.

- [ ] **Step 2: Record the current canonical-resource baseline**

```js
test('the existing root Web sources match their staged macOS copies', () => {
    for (const file of ['index.html', 'styles.css', 'script.js']) {
        assert.deepEqual(read(staged(file)), read(root(file)));
    }
});
```

This is an inventory/baseline assertion and should pass in Task 1. Do not include `legacy-safety.js` before Task 2 creates it, and do not demand the new sync behavior before Task 11 implements it. The final complete canonical-list test is created in Task 11.

- [ ] **Step 3: Split the Swift package into core, executable, and tests**

Update `Package.swift` to contain:

```swift
.library(name: "AssetTrackerCore", targets: ["AssetTrackerCore"]),
.executable(name: "AssetTracker", targets: ["AssetTrackerMac"])
```

with `AssetTrackerMac` depending on `AssetTrackerCore` and an `AssetTrackerCoreTests` test target. Do not move behavior yet; create the target directories and a smoke test first.

- [ ] **Step 4: Run the baseline**

Run:

```bash
cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账
node --test tests/web-storage.test.js tests/macos-scaffold.test.js
swift test --package-path macos-app
```

Expected before the minimal implementation: the new Swift test-target smoke test fails because the core target does not exist. The resource baseline remains green. After the harness/package extraction, all pre-existing six tests and the new smoke tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests macos-app/Package.swift macos-app/Sources/AssetTrackerCore macos-app/Tests
git commit -m "test: establish legacy safety seams"
```

## Task 2: Load Corrupt or Unsupported Books into Non-Destructive Recovery

**Files:**

- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/legacy-safety.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/index.html`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/styles.css`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/data-recovery.test.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerCore/AssetTrackerBookStore.swift`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Tests/AssetTrackerCoreTests/AssetTrackerBookStoreTests.swift`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift`

- [ ] **Step 1: Write failing load-state tests**

Cover four distinct results:

```text
missing  -> first-run default book, writable
valid    -> parsed book, writable
corrupt  -> recovery UI only, never save
ioError  -> recovery UI only, never save
```

Representative test:

```js
test('non-empty invalid JSON enters recovery and never writes defaults', async () => {
    const app = loadAssetTracker({
        localStorageSeed: { assetTrackerData: '{"broken"' }
    });
    const tracker = new app.AssetTracker();

    await tracker.initialize();

    assert.equal(tracker.recoveryMode.active, true);
    assert.equal(tracker.recoveryMode.reason, 'corrupt');
    await assert.rejects(() => tracker.saveData(), /READ_ONLY_RECOVERY/);
    assert.equal(app.localStorageWrites.length, 0);
});
```

Also test an envelope with a future unsupported schema/capability, invalid top-level payload, invalid transaction date/amount shape, native invalid UTF-8, and an I/O error. In every case, compare original bytes/hash before and after initialization.

- [ ] **Step 2: Create a UMD-style safety module**

`legacy-safety.js` must be usable by both the browser and `require()` in Node:

```js
(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AssetTrackerLegacySafety = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function build() {
    // Pure errors, validators, queues, date/FX helpers, and cutover ports.
    return Object.freeze({ /* exports */ });
});
```

Load it before `script.js` in `index.html`.

- [ ] **Step 3: Make parsing return a typed result**

Replace the ambiguous `null` result with:

```js
{ status: 'missing' }
{ status: 'valid', payload, source, meta }
{ status: 'corrupt', reason, rawHash, schemaVersion }
{ status: 'unsupported', reason, rawHash, schemaVersion }
```

Validation is strict enough to stop runtime crashes and non-finite monetary values, while retaining unknown fields for export/migration. Unsupported future schema is not corrupt; both are read-only.

- [ ] **Step 4: Add a persistent app status/recovery surface**

Add `#app-status` and `#data-safety-status` with semantic `role="status"`. Implement:

```js
setAppState(state, detail)
refreshAppStatus()
enterReadOnlyRecovery(reason, metadata)
assertWritable()
renderDataSafetyState()
```

Recovery state must show the reason, raw hash/path when available, “导出原始账本” where possible, and “打开数据目录” on macOS. It must not render the default dashboard as a normal empty book.

- [ ] **Step 5: Extract and test the native book store**

Move the inline private store out of `AssetTrackerHostBridge.swift`. Inject a temporary storage root in tests. `load()` returns the typed status and raw hash without rewriting. Never touch real `Application Support` in XCTest.

- [ ] **Step 6: Verify**

```bash
node --test tests/data-recovery.test.js
swift test --package-path macos-app --filter AssetTrackerBookStoreTests
```

The hard assertion is `sourceHashBefore === sourceHashAfter` and zero save calls for every non-empty invalid input.

- [ ] **Step 7: Commit**

```bash
git add legacy-safety.js index.html script.js styles.css tests/data-recovery.test.js macos-app
git commit -m "fix: protect unreadable legacy books"
```

## Task 3: Serialize Saves and Make Native ACK Actually Durable

**Files:**

- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/legacy-safety.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/save-queue.test.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerCore/NativeDurableFileWriter.swift`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerFaultHarness/main.swift`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerCore/AssetTrackerBookStore.swift`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Tests/AssetTrackerCoreTests/NativeDurableFileWriterTests.swift`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Tests/AssetTrackerCoreTests/ProcessKillRecoveryTests.swift`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Package.swift`

- [ ] **Step 1: Write deferred-ACK queue tests**

```js
test('rapid saves serialize snapshots and advance expectedHash after ACK', async () => {
    const first = deferred();
    const second = deferred();
    const calls = [];
    tracker.storageAdapter.save = (json, options) => {
        calls.push({ json, options });
        return calls.length === 1 ? first.promise : second.promise;
    };

    tracker.data.memo = 'first';
    const p1 = tracker.saveData({ reason: 'first' });
    tracker.data.memo = 'second';
    const p2 = tracker.saveData({ reason: 'second' });
    assert.equal(calls.length, 1);

    first.resolve({ ok: true, stateHash: 'h1', durability: 'native-durable' });
    await p1;
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.expectedHash, 'h1');
    assert.match(calls[1].json, /second/);
    second.resolve({ ok: true, stateHash: 'h2', durability: 'native-durable' });
    await p2;
});
```

Add: 100 rapid mutations preserve the last state; first failure cancels later writes; rollback restores the last ACKed snapshot; timeout becomes `durability-unknown` and never causes a fresh command; localStorage uses the same queue.

- [ ] **Step 2: Implement `AssetTrackerSaveQueue`**

The queue freezes `stateJson` at enqueue time. Only the execution step reads the most recent ACK hash. On failure it rejects current/pending items and invokes a single fault callback. `persistData()` returns the queue promise; delete the fire-and-forget `.catch(() => {})` behavior.

- [ ] **Step 3: Add explicit status transitions**

Allowed write states are:

```text
idle -> saving -> browser-local-committed
              -> native-durable
              -> durability-unknown
              -> failed-readonly
```

The UI shows pending within 100ms. Web may say only “已存入此浏览器”; it must not claim disk durability or backup. macOS may say “已安全写入本机” only after `native-durable`. An unknown/timeout result stays visible and disables new mutation until reload/reconciliation.

- [ ] **Step 4: Write failing native durability tests**

Inject faults after each step:

```text
write sibling temp
fsync temp file
atomic rename/replace
fsync parent directory
reread final bytes
verify expected SHA-256
return native-durable ACK
```

First use injected exceptions to cover every branch. Then add an `AssetTrackerFaultHarness` SwiftPM executable and `ProcessKillRecoveryTests`: XCTest launches the child against a temporary directory, waits for a fault-point marker, sends `SIGKILL`, and opens the same directory with a fresh process/store. Verify old-or-complete-new bytes, no ACK claim before the durability point, persistence after an emitted ACK, and automatic `flock` release. `Data.write(..., .atomic)` alone is not sufficient evidence.

- [ ] **Step 5: Add bounded rolling recovery and independent version snapshots**

Separate three concepts:

1. **Ordinary save:** maintain exactly two rotating, validated `previous-1`/`previous-2` recovery slots. Rotation itself uses sibling temp, file fsync, rename, directory fsync, reread, and SHA-256. If the previous-state safety copy cannot be established, fail the new primary write closed.
2. **Manual/scheduled native recovery point:** `storage.snapshot` creates a content-addressed version only when the live book is valid. Deduplicate identical hashes; retain at most 24 points and always retain the newest 3. Delete an older point only after the new point and current primary both reread/verify. Cleanup failure is reported as recovery-health degradation and never causes silent deletion or a false backup-success message.
3. **Final freeze snapshot:** immutable and excluded from ordinary retention; Task 7 owns it.

A corrupt current file is never promoted to a valid recovery point and is never overwritten. Browser localStorage does not create or advertise automatic backups; Web exposes storage status plus explicit JSON export only.

- [ ] **Step 6: Verify**

```bash
node --test tests/save-queue.test.js
swift test --package-path macos-app --filter NativeDurableFileWriterTests
swift test --package-path macos-app --filter ProcessKillRecoveryTests
```

- [ ] **Step 7: Commit**

```bash
git add legacy-safety.js script.js tests/save-queue.test.js macos-app
git commit -m "fix: serialize and durably acknowledge legacy saves"
```

## Task 4: Route Every Persistent Command Through One Coordinator and Gate Unsafe Features

**Files:**

- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/index.html`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/styles.css`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/legacy-feature-gates.test.js`
- Extend: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/save-queue.test.js`

- [ ] **Step 1: Write failing command/feature tests**

Cover:

1. A transaction/category/memo success message does not exist before deferred ACK.
2. Save failure restores the last durable state and never displays success.
3. A gated method called directly cannot mutate or persist.
4. Read-only overrides every feature policy.
5. Safe JSON export and reveal-folder actions remain usable.
6. Missing/gated DOM controls do not crash event-listener setup.

- [ ] **Step 2: Add an immutable policy and safe binding helpers**

```js
const LEGACY_FEATURE_POLICY = Object.freeze({
    excelImport: false,
    fullBookReplace: false,
    resetBook: false,
    automation: false,
    initialAssets: false,
    categoryDrag: false,
    categoryCascadeDelete: false,
    accountCurrencyEdit: false,
    transactionDelete: false, // enabled only after Task 6 passes
    reportingCurrency: false, // enabled only after every Task 5 test passes
    jsonExport: true,
    revealFolder: true
});
```

Implement `requireFeature(featureId)` and `bindClickIfPresent(id, handler)`. A hidden control is not a security boundary: each gated method must reject before mutation.

- [ ] **Step 3: Add `runPersistentAction`**

```js
await this.runPersistentAction({
    reason,
    successMessage,
    mutate: () => { /* synchronous in-memory candidate mutation */ },
    refresh: () => this.refreshDataViews()
});
```

The coordinator performs: feature/read-only/cutover precheck, clone last state, mutation, enqueue frozen snapshot, wait for ACK, refresh, then success. On failure it restores the last durable snapshot, refreshes, shows a persistent error, and enters read-only if durability or conflict is uncertain.

- [ ] **Step 4: Migrate every mutation entry point**

Convert and await all active methods, including transaction create/edit, category create/rename/collapse, templates, and memo. Existing account/category native currency is immutable in Phase 1; remove that editable field and reject direct method calls even for zero-balance accounts. Reporting-currency mutation stays gated until Task 5. Other gated methods return before mutation. `fillToToday` must never save once per generated row; when eventually restored it will mutate a batch and commit once.

Use this inventory command until only coordinator internals remain:

```bash
rg -n "persistData\(|saveData\(" script.js
```

Review every match manually. There must be no `persistData();` followed by a success message.

- [ ] **Step 5: Correct auto-backup semantics**

Native `setupAutoBackup()`/`performAutoBackup()` may call bounded `storage.snapshot`, never `storage.save`; `backupData()` must use the same truthful snapshot/export distinction. Web stops scheduling or writing anything called an automatic backup, preserves any pre-existing legacy backup bytes for later recovery review, and offers explicit JSON export instead. Do not start native scheduled snapshots in recovery/read-only mode.

- [ ] **Step 6: Verify and commit**

```bash
node --test tests/save-queue.test.js tests/legacy-feature-gates.test.js
```

```bash
git add index.html styles.css script.js tests
git commit -m "fix: centralize legacy mutations and safety gates"
```

## Task 5: Unify Net Worth and Make Reporting-Currency Changes Transactional

**Files:**

- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/legacy-safety.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/index.html`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/legacy-accounting-safety.test.js`

- [ ] **Step 1: Write the failing golden formula tests**

Fixtures:

- Asset `+100 CNY`, liability due `+100 CNY`, liability overpayment `-20 CNY` => current balance `100`, due liability `100`, overpayment `20`, net worth `20`.
- Asset `10 USD @ 7.2 CNY`, liability `20 SGD @ 5 CNY` => current balance `72 CNY`, due liability `100 CNY`, net worth `-28 CNY`.
- Missing required rate => aggregate status `Unavailable`, never `1:1`.

Formula:

```js
netWorth = currentBalance + liabilityOverpayment - dueLiability;
```

For liability projection:

```js
if (balance >= 0) dueLiability += balance;
else liabilityOverpayment += -balance;
```

Never call `Math.abs()` to hide an abnormal sign.

- [ ] **Step 2: Implement one pure account summary**

All surviving current-balance dashboard and detail paths call the same helper. Keep a temporary `totalAssets: netWorth` compatibility alias only while eliminating old callers. UI labels become `净资产`, `现余额`, `待还款`, and an explicit `负债溢缴` warning where present. Legacy history/trend is not allowed to consume this helper and pretend current FX is historical evidence; Task 8 removes those reachable paths until V2 projections exist.

- [ ] **Step 3: Write reporting-currency failure cases**

For CNY account `100` and USD account `10`, switching display/reporting currency to USD must leave both account amounts/currencies byte-identical. Invalid/zero/non-finite rate causes zero state change and zero save. Rejected save restores the old settings and emits no success.

- [ ] **Step 4: Implement deterministic rate rebasing**

Stored semantics are `1 currency = rate[currency] oldBase`. Preview/saving a new base uses:

```js
newRates[currency] = oldRates[currency] / oldRates[newBase];
newRates[newBase] = 1;
```

Build and validate the complete candidate first. Commit it once through `runPersistentAction`. Delete the call to `convertAllBalancesToNewBaseCurrency()` and then remove that method. Account native currency and balance never change when the report currency changes. Keep the UI/method policy closed while any test is red; only the final passing Task 5 change flips `reportingCurrency` to `true`.

- [ ] **Step 5: Verify and commit**

```bash
node --test --test-name-pattern="net worth|liability|reporting currency|missing rate" tests/legacy-accounting-safety.test.js
```

```bash
git add legacy-safety.js script.js index.html tests/legacy-accounting-safety.test.js
git commit -m "fix: make legacy totals and reporting currency deterministic"
```

## Task 6: Repair Foreign-Currency Reversal, Calendar Dates, and Category Cycles

**Files:**

- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/legacy-safety.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script.js`
- Extend: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/legacy-accounting-safety.test.js`

- [ ] **Step 1: Freeze account-native impact and test exact reversal**

Cover USD into CNY, USD into SGD, and a non-CNY report base. For each new transaction, persist the exact target-account-native delta and the FX evidence used at posting time:

```js
transaction.balanceImpact = {
    calculationVersion: 'legacy-fx-v1',
    targetAccountId,
    accountCurrency,
    nativeAmount,
    sourceCurrency,
    sourceAmount,
    fxEvidence: sourceCurrency === accountCurrency ? null : {
        rateConvention: 'reporting-base-per-unit',
        reportingBase,
        sourceRate,
        accountRate
    }
};
```

The field is a legacy stop-loss fact, not the V2 `AccountImpact` model. Compute it exactly once before the original balance mutation and store it in the same command snapshot. Define one pure `computeLegacyNativeAmountV1()` used by posting and validation: same-currency returns the finite `sourceAmount` exactly and requires `fxEvidence === null`; cross-currency requires distinct currencies, matching `calculationVersion`/`rateConvention`, positive finite `sourceRate` and `accountRate`, then returns `Number((sourceAmount * sourceRate / accountRate).toFixed(12))`, canonicalizing `-0` to `0` and rejecting overflow/non-finite output. The original balance mutation uses that exact value. Reversal subtracts the validated `nativeAmount` directly from the stable `targetAccountId`; it never consults current rates, current report currency, or mutable names.

Required failure fixtures:

1. Post USD into SGD, change both stored rates, then delete: the SGD account returns exactly to its original balance.
2. Post in one reporting base, switch the reporting base, then delete: result is unchanged.
3. A legacy cross-currency transaction without frozen `balanceImpact` is not editable/deletable and causes zero mutation/save.
4. A transaction with missing `currency` is not editable/deletable; never fall back to the current report currency.
5. A legacy same-currency transaction with an explicit currency matching the uniquely resolved target account may derive `nativeAmount === amount` and is reversible.
6. Ambiguous/missing target account ID fails closed.
7. Changing the target account currency is rejected; a deliberately corrupted fixture whose current account currency differs from `balanceImpact.accountCurrency` is not reversible.
8. A tampered/non-finite impact, or an impact whose source amount/currency differs from the immutable transaction fields, is not reversible.
9. A finite but mathematically inconsistent `nativeAmount` (for example changing frozen `13.846...` to `100`) is not reversible. Same-currency requires strict `nativeAmount === sourceAmount` and null FX; cross-currency requires strict equality with `computeLegacyNativeAmountV1()` using the frozen evidence.
10. Save failure restores the confirmed state and shows no deletion success.

Editing first reverses the exact frozen old native impact, then calculates and stores a new frozen impact for the candidate. `canReverseLegacyTransaction(transaction)` validates stable account ID, current account currency equality, version/convention, finite native/source amounts, source currency, exact agreement with the transaction source fields, and the mathematical relationship above. After the tests pass, enable the transaction-delete method policy, but render edit/delete per row only when that proof succeeds; unsafe legacy rows show a concise read-only explanation.

- [ ] **Step 2: Write local-calendar tests in two time zones**

Add pure helpers:

```js
toLocalDateKey(date)       // local getters -> YYYY-MM-DD
parseLocalDateKey(value)   // new Date(year, month - 1, day)
ledgerDateKey(value)       // preserve YYYY-MM-DD prefix
```

Replace date-only uses of `toISOString().split('T')[0]` and `new Date('YYYY-MM-DD')` in surviving transaction defaults and filters. Apply the helpers to any retained but unreachable automation parsing code as a defense-in-depth fix; do not use them as a reason to keep unverified history/trend visible.

Run:

```bash
TZ=Asia/Shanghai node --test --test-name-pattern="date-only" tests/legacy-accounting-safety.test.js
TZ=America/Los_Angeles node --test --test-name-pattern="date-only" tests/legacy-accounting-safety.test.js
```

- [ ] **Step 3: Write category-cycle tests before touching drag code**

For `A -> B -> C`, dragging A onto B or C is rejected before any mutation; serialized tree bytes and save-call count remain unchanged. A legal sibling move still succeeds at the pure helper level.

Fix the immediate argument order:

```js
this.isDescendant(draggedCategory.id, targetCategory.id)
```

Repeat the guard inside the move primitive so a direct method call cannot bypass it. Keep arbitrary hierarchy drag hidden in Phase 1 even after the invariant passes.

- [ ] **Step 4: Verify and commit**

```bash
node --test tests/legacy-accounting-safety.test.js
```

```bash
git add legacy-safety.js script.js tests/legacy-accounting-safety.test.js
git commit -m "fix: preserve legacy transaction and tree integrity"
```

## Task 7: Implement the Legacy Cutover Port, Writer Fence, and Freeze Tests

**Files:**

- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/legacy-safety.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/cutover-control.test.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerCore/CutoverControlStore.swift`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerCore/FreezeCoordinator.swift`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Tests/AssetTrackerCoreTests/CutoverControlStoreTests.swift`
- Extend: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Tests/AssetTrackerCoreTests/ProcessKillRecoveryTests.swift`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift`

- [ ] **Step 1: Freeze the control contract in tests**

State contains:

```text
mode: legacyWritable | freezeRequested | legacyFrozen | legacyReadOnly
leaseEpoch
sourceRevision
active leases: leaseId, ownerId, epoch, expiresAt
updatedAt
```

Each persistent command acquires a lease before mutation. The native save request carries the token and validates it again in the same cross-process-locked critical section as the durable book write.

- [ ] **Step 2: Implement Browser and Native ports**

`BrowserLegacyCutoverControlPort.runWithLegacyLease(callback)` holds a single named Web Lock across marker reread, candidate mutation, live-book write, and revision update; it must not return a token and release the lock before the callback finishes. If Web Locks are unavailable, normal legacy use may continue with `cutoverSafe=false`, but formal freeze/cutover is unavailable and the app must not claim readiness.

`NativeLegacyCutoverControlPort` exposes:

```text
cutover.read
cutover.acquireLegacyLease
cutover.releaseLegacyLease
```

The ordinary page bridge does not expose `requestFreeze` or finalization. Those are privileged migration/native coordinator operations. `CutoverControlStore` uses `flock` on a sibling lock file so two app processes share one critical section.

- [ ] **Step 3: Implement an atomic freeze-finalization state machine**

`FreezeCoordinator` owns the only privileged path:

```text
requestFreeze(expectedEpoch)
-> persist freezeRequested and increment epoch, rejecting new leases
-> wait for or expire all older active leases
-> acquire an exclusive finalization lease/lock
-> reread epoch, sourceRevision, source bytes, and source hash
-> durably write/fsync/rename/fsync-dir/reread the immutable final snapshot
-> durably write and reread its manifest
-> atomically commit legacyFrozen(snapshotHash, sourceRevision, epoch)
-> release finalization lease
```

Add `recoverInterruptedFreeze()` and an explicit persisted `finalizationStage`. On startup it resumes or safely restarts an incomplete finalization; it never unfreezes merely because the coordinator crashed. The manifest records format/schema versions, epoch, source revision/hash, snapshot hash/bytes, created time, and verifier version.

For Web, the privileged coordinator holds the same Web Lock while rereading the marker and live-book bytes, writing the immutable final snapshot/manifest, and committing `legacyFrozen`. There is no split check/commit window.

- [ ] **Step 4: Test freeze/drain races and real process death**

Cover:

1. Two browser tabs request writes concurrently.
2. A second macOS instance holds an old lease.
3. A command pauses after marker check but before save.
4. A lease owner crashes and TTL/epoch takeover occurs.
5. Freeze begins during native durable write: the write is wholly before the final barrier or rejected.
6. An old process resumes after freeze and its epoch is permanently rejected.

Native fault points:

```text
after lease acquisition
after state reread
before temp write
after file fsync
after rename
before directory fsync
before lease release
after freeze epoch CAS
before final snapshot hash commit
after final snapshot fsync
after manifest fsync
after legacyFrozen state commit
```

Invariant:

```text
finalSnapshotHash == last source hash inside the freeze barrier
and no successful legacy write exists after legacyFrozen
```

Run the existing injected-fault matrix and the subprocess harness. For every native point, launch `AssetTrackerFaultHarness`, wait for its marker, send `SIGKILL`, then reopen from a fresh process. Assert that `flock` is released, stale epochs remain rejected, finalization resumes idempotently, and all restarts converge to one final snapshot hash.

- [ ] **Step 5: Verify and commit**

```bash
node --test tests/cutover-control.test.js
swift test --package-path macos-app --filter CutoverControlStoreTests
swift test --package-path macos-app --filter ProcessKillRecoveryTests
```

```bash
git add legacy-safety.js script.js tests/cutover-control.test.js macos-app
git commit -m "feat: fence and drain legacy writers"
```

## Task 8: Remove Random Analytics, Dead Controls, and Unvalidated Destructive Paths

**Files:**

- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/index.html`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/styles.css`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/legacy-stop-loss-ui.test.js`

- [ ] **Step 1: Write static and reachable-UI failures**

```js
assert.doesNotMatch(indexHtml, /data-section="analytics"/);
assert.doesNotMatch(indexHtml, /id="customChart"|id="predictionChart"/);
assert.doesNotMatch(indexHtml, /id="hypothesis-btn"|id="export-chart-btn"/);
assert.doesNotMatch(indexHtml, /id="assetTrendChart"|id="calculate-history-btn"/);
assert.doesNotMatch(scriptSource, /Math\.random\s*\(/);
```

Also assert no reachable control refers to a missing `AssetTracker` method and initialization never invokes the removed analytics path.

- [ ] **Step 2: Remove untrustworthy product claims and methods**

Delete the analytics navigation/section, random chart generation, prediction, assumptions, and dead chart export. Also remove the reachable legacy asset-trend and historical-reconstruction controls/method chain: old cross-currency rows lack frozen account-native impact and current FX cannot serve as historical evidence. Show a concise explanation that trustworthy history returns with the V2 projection. Remove the automation destination during Phase 1 because its generated toggle/delete calls do not exist and all automation writes are gated. Preserve stored transactions, rules, initial assets, and other hidden data untouched.

- [ ] **Step 3: Make stopped features explicit**

In Settings/Data Exchange, show one compact stop-loss notice. Remove unreachable empty cards. Keep safe full-book JSON export and reveal-folder actions. Rename the top action from `备份数据` to its real effect (`导出完整账本`) unless it now calls the independently validated snapshot API.

- [ ] **Step 4: Verify and commit**

```bash
node --test tests/legacy-stop-loss-ui.test.js tests/legacy-feature-gates.test.js
```

```bash
git add index.html styles.css script.js tests
git commit -m "fix: remove untrusted legacy product paths"
```

## Task 9: Close Persistent XSS, CSP, and Native Bridge Boundaries

**Files:**

- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/index.html`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/styles.css`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/security-boundary.test.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script/serve-web.mjs`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerCore/BridgeRequestPolicy.swift`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Tests/AssetTrackerCoreTests/BridgeRequestPolicyTests.swift`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerMac/main.swift`

- [ ] **Step 1: Add hostile-content tests**

Inject malicious values into transaction description, category name, memo, template, and rule fields. Render them and assert they remain text, create no `img/script/svg` element, attach no event handler, and make zero bridge requests.

Static checks:

```js
assert.doesNotMatch(indexHtml, /\son[a-z]+\s*=/i);
assert.doesNotMatch(indexHtml, /\sstyle\s*=/i);
assert.doesNotMatch(scriptSource, /onclick\s*=/i);
assert.match(indexHtml, /script-src 'self'/);
assert.doesNotMatch(indexHtml, /script-src[^;]*unsafe-inline/);
assert.doesNotMatch(indexHtml, /unsafe-inline|unsafe-eval/);
```

- [ ] **Step 2: Replace user-content HTML interpolation**

Use `createElement`/`textContent` for user values. A narrowly scoped `escapeHTML` is allowed only for static form templates and must be tested for `& < > " '`. Render memo line breaks by creating text nodes and `<br>` elements, never by replacing text and assigning it to `innerHTML`.

Remove every inline `onclick` and `style` attribute from static and generated markup. Replace programmatic inline styles with finite CSS classes/state attributes; do not use `element.style`, `setAttribute('style', ...)`, or user-controlled CSS custom properties. Add one allowlisted `data-action` event delegation layer that resolves IDs from `dataset`, not executable strings.

- [ ] **Step 3: Add CSP**

Use the exact baseline:

```text
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none';
worker-src 'self' blob:;
```

No directive may contain `unsafe-inline` or `unsafe-eval`. `script/serve-web.mjs` sends the complete policy as the actual HTTP `Content-Security-Policy` response header, including `frame-ancestors`; an integration test fetches the page and compares the normalized header exactly. The local-file WKWebView page also carries the enforceable subset in a meta policy, while navigation/main-frame/new-window controls supply the container boundary that meta cannot provide. All third-party scripts remain local and their checked-in hashes are recorded.

- [ ] **Step 4: Enforce bridge and navigation policy**

The bridge accepts only the main frame whose resolved URL is inside the exact bundled `Resources/Web` directory. Normalize/standardize paths before containment checks; `/Resources/WebEvil` must not pass. Allow only known request types with strict DTOs, bounded IDs/payload sizes, per-method application-state allowlists, and rate limits. Reject remote, `javascript:`, `data:`, subframe, and new-window requests. File imports validate size, extension and MIME before reading; recovery paths reject symlinks and use current-user-only permissions. Logs never contain account names, descriptions, amounts, or book payloads.

Use `WKNavigationDelegate`/`WKUIDelegate` in `main.swift`. Prefer `callAsyncJavaScript(_:arguments:in:contentWorld:)` or argument injection for responses instead of concatenating untrusted JSON into executable source.

- [ ] **Step 5: Verify and commit**

```bash
node --test tests/security-boundary.test.js
swift test --package-path macos-app --filter BridgeRequestPolicyTests
```

```bash
git add index.html styles.css script.js script/serve-web.mjs tests/security-boundary.test.js macos-app
git commit -m "fix: constrain legacy content and native bridge"
```

## Task 10: Make the Surviving Product Reachable, Responsive, and Accessible

**Files:**

- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/index.html`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/styles.css`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/legacy-navigation.test.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/legacy-modal-a11y.test.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/macos-scaffold.test.js`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Sources/AssetTrackerMac/main.swift`

- [ ] **Step 1: Write navigation-state tests**

Add `#nav-toggle`, stable sidebar ID/label, and `#nav-backdrop`. Test `aria-expanded`, backdrop state, selecting a destination, Escape close/focus restoration, and exactly one active section/title.

- [ ] **Step 2: Implement the stop-loss adaptive shell**

Use a drawer at `<=960px`; desktop retains the sidebar. This is a safe temporary shell, not the final V2 four-destination IA. Remove global overflow hiding. Ensure:

- content/grid children have `min-width: 0`;
- dashboard uses `minmax(0, 1fr)` and one column at narrow widths;
- header/actions wrap;
- summary is one column at `<=360px`;
- only the transaction-table container scrolls horizontally;
- major targets are at least `44x44px` with `8px` spacing;
- text and status contrast meet WCAG AA;
- card hover/entry motion respects `prefers-reduced-motion`.

- [ ] **Step 3: Write modal/focus failures**

Test named `role="dialog"`, `aria-modal`, real close button, first-control focus, Tab/Shift-Tab trap, Escape, trigger focus restoration, hidden modal removal from focus order, `role="alert"` errors, and polite success status.

- [ ] **Step 4: Implement modal semantics and scroll**

Use `max-height: calc(100dvh - 2rem); overflow-y: auto`. A single keydown handler gives modal Escape priority over navigation Escape. Errors do not disappear before assistive technology can read them.

- [ ] **Step 5: Set the macOS minimum size**

```swift
window.minSize = NSSize(width: 900, height: 640)
```

At 900px, the temporary drawer breakpoint must produce a usable layout rather than a clipped desktop/sidebar hybrid.

- [ ] **Step 6: Verify and commit**

```bash
node --test tests/legacy-navigation.test.js tests/legacy-modal-a11y.test.js tests/macos-scaffold.test.js
swift build --package-path macos-app
```

```bash
git add index.html styles.css script.js tests macos-app/Sources/AssetTrackerMac/main.swift
git commit -m "fix: make legacy shell reachable and accessible"
```

## Task 11: Add Browser Acceptance, Synchronize Resources, and Record Evidence

**Files:**

- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/package.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/package-lock.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/playwright.config.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/e2e/phase1-stop-loss.spec.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/tests/web-assets-sync.test.js`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script/verify-phase1.sh`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script/verify_macos_webview_smoke.sh`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script/sync_web_assets.sh`
- Generate: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/macos-app/Resources/Web/*`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/docs/evidence/v2/phase1-legacy-risk-isolation.md`

- [ ] **Step 1: Add reproducible browser tooling**

Add scripts for `test:unit`, `test:e2e`, `test:a11y`, and `verify:phase1`. Pin exact Playwright and axe-core versions and commit the generated `package-lock.json`. `playwright.config.js` uses `webServer` to run `node script/serve-web.mjs --port 4173`; tests never rely on an ambient server. Reproducible setup is `npm ci` followed by the lockfile-selected `npx playwright install chromium`. Record the resulting Chromium revision in evidence. Do not add production dependencies to the legacy runtime.

- [ ] **Step 2: Build the E2E matrix**

At `320x568`, `375x667`, `768x1024`, `812x375`, `1024x768`, and `1440x900`, plus 200% text zoom:

- navigate to every surviving destination and return;
- open the longest transaction modal and reach submit/cancel;
- assert `document.documentElement.scrollWidth === document.documentElement.clientWidth` except inside the explicit table scroller;
- create a transaction with deferred persistence and verify pending-before-success;
- inject a save failure and verify rollback/read-only/no false success;
- boot from corrupt storage and verify recovery UI/hash preservation;
- render hostile text and run axe; critical/serious violations must be zero.
- fetch the root document and assert the actual HTTP CSP header exactly matches the approved baseline.

- [ ] **Step 3: Update the sync script**

Create the final `tests/web-assets-sync.test.js`, now including `legacy-safety.js` and all vendor files. Its byte-identity assertion runs only when `ASSET_TRACKER_VERIFY_STAGED=1`; the ordinary unit suite tests the source-list/target guards without assuming generation has already happened. Synchronize the explicit list from root. The script may recreate only the resolved staged Web directory after validating that exact target; run it only after root tests pass.

- [ ] **Step 4: Test the packaged WKWebView runtime**

`script/verify_macos_webview_smoke.sh` builds the actual `.app`, launches it in an isolated temporary Application Support location with a smoke-output environment variable, and waits with a bounded timeout for a JSON result emitted after WK navigation completes. The probe verifies:

- `index.html`, `legacy-safety.js`, Chart.js, XLSX, and CSS load from the bundle;
- the local-file CSP blocks an inline-script probe;
- a legal main-frame bridge `storage.load` round-trip succeeds;
- a subframe bridge call fails;
- remote main navigation and `window.open` fail;
- app termination leaves no write in the real user data directory.

Run the smoke test against the packaged resources, not the root development page. Any timeout/failure preserves logs and fails the gate.

- [ ] **Step 5: Create one verification entry point**

`script/verify-phase1.sh` runs, in order:

```bash
npm ci
npx playwright install chromium
node --check legacy-safety.js
node --check script.js
node --test tests/*.test.js
TZ=Asia/Shanghai node --test tests/legacy-accounting-safety.test.js
TZ=America/Los_Angeles node --test tests/legacy-accounting-safety.test.js
swift test --package-path macos-app
swift build --package-path macos-app --product AssetTracker
npx playwright test tests/e2e/phase1-stop-loss.spec.js
bash script/sync_web_assets.sh
ASSET_TRACKER_VERIFY_STAGED=1 node --test tests/web-assets-sync.test.js
cmp index.html macos-app/Resources/Web/index.html
cmp styles.css macos-app/Resources/Web/styles.css
cmp script.js macos-app/Resources/Web/script.js
cmp legacy-safety.js macos-app/Resources/Web/legacy-safety.js
bash script/verify_macos_webview_smoke.sh
git diff --check
```

- [ ] **Step 6: Run a two-reviewer gate**

Reviewer A checks exact compliance with the approved specification and this plan. Reviewer B independently checks correctness, security, performance regression, test quality, and generated-resource discipline. Address findings with new failing tests, then rerun the entire verification entry point.

- [ ] **Step 7: Perform and record the VoiceOver gate**

On the packaged macOS app, record a manual VoiceOver transcript/checklist for:

1. opening, switching, and closing the narrow navigation;
2. `保存中`, browser-local/native-confirmed, failure, and read-only status announcements;
3. the corrupt-book recovery explanation and every safe recovery action;
4. the longest modal's name, field labels, inline errors, close action, focus trap, and trigger-focus restoration.

No item may be replaced by axe automation. Record macOS/VoiceOver versions, build hash, pass/fail, and any issue ID in the evidence note.

- [ ] **Step 8: Record all evidence**

The evidence note includes commit hashes, environment, exact test counts, viewport screenshots, corrupt-book before/after hashes, 100-write queue trace, native injected-fault and subprocess-SIGKILL matrices, freeze/finalization trace, HTTP and local-file CSP evidence, packaged-WKWebView result, axe output, VoiceOver checklist, Swift results, limitations, and the explicit decision that Phase 2 remains blocked until every Phase 1 hard gate passes.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json playwright.config.js tests/e2e tests/web-assets-sync.test.js script macos-app/Resources/Web docs/evidence/v2
git commit -m "test: verify phase one legacy risk isolation"
```

## Phase 1 Completion Gate

Phase 1 is complete only when all of the following are simultaneously true:

1. Corrupt/unsupported non-empty input retains identical source bytes/hash and causes zero writes.
2. One hundred rapid state changes serialize correctly and the final durable state equals the final intended state.
3. No success message appears before the platform-appropriate commit ACK; Web says only browser-local committed, while macOS claims durability only after native fsync/reread ACK. Injected failure restores the last confirmed state and blocks further mutation.
4. Native ACK follows file fsync, atomic replace, parent-directory fsync, reread, and SHA-256 verification.
5. Native rolling/scheduled/final snapshots follow their bounded retention and atomic protocols; Web makes no automatic-backup claim and retains explicit JSON export.
6. Net worth, due liability, overpayment, report-currency conversion, missing-FX status, immutable account currency, and frozen account-native foreign-currency reversal pass their golden fixtures; unevidenced or tampered legacy reversal fails closed.
7. Date-only behavior passes in Asia/Shanghai and America/Los_Angeles; category moves cannot create a cycle.
8. Freeze drains earlier writers, durably finalizes one manifest/snapshot, recovers from every interrupted stage, and permanently rejects stale epochs in dual-tab, dual-instance, pause, TTL, injected-fault, and subprocess-SIGKILL scenarios.
9. Production-reachable code contains no random analysis, unevidenced history/trend, dead control, inline script/style, persistent-XSS path, remote bridge navigation, or ungated destructive import/reset/automation path; HTTP and local-file/container CSP evidence pass.
10. All target viewports and 200% text have no non-intentional overflow/cropping; all surviving tasks are keyboard reachable; axe critical/serious is zero; the packaged-app VoiceOver checklist passes.
11. Root and staged macOS Web assets are byte-identical, the packaged WKWebView smoke passes, all Node/XCTest/Playwright tests pass, Swift builds, and both independent reviewers approve.
