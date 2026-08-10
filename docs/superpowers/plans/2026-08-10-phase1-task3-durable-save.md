# Phase 1 Task 3 Durable Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serialize every legacy primary-book write through one fail-closed JavaScript lane and acknowledge native saves or recovery points only after crash-safe, cross-process-safe persistence has been verified.

**Architecture:** `AssetTrackerSaveQueue` owns the browser-side FIFO, expected-hash ledger, callback fence, failure classification, rollback authority, and snapshot barrier. The native core owns one mutation lock, lock-in compare-and-swap, POSIX durability, crash-reconcilable ordinary recovery, bounded snapshot retention, and typed receipts; the coordinator and bridge preserve those proofs without inventing defaults. Task 3 integrates this substrate into `saveData()` but deliberately leaves the 18 legacy business-action success paths and automatic-backup product routing for Task 4.

**Tech Stack:** Vanilla JavaScript, Node `node:test`, Swift 5.10/SwiftPM, XCTest, AppKit/WKWebView bridge DTOs, Darwin POSIX APIs, subprocess `SIGKILL` recovery tests.

---

## Binding Baselines

Implementation is bound to these exact immutable inputs:

- Product V2 specification: `docs/superpowers/specs/2026-08-10-trustworthy-asset-product-v2-design.md`
  - SHA-256: `095a60b09e4657f40be0ff6fcbfd282516b26860d9a2d3f184c01e2992561b7d`
- Task 3 durable-save contract: `docs/superpowers/specs/2026-08-10-phase1-task3-durable-save-contract.md`
  - SHA-256: `4585996f8732bc5f3a2f119a90474610c0866817573dcd07dd4539ed4c422728`
  - Status: `Frozen for implementation`
- Starting implementation commit: `011921ddfa32cf3166e3b134b57f96a15793d22f`

Before each implementation slice, run:

```bash
shasum -a 256 \
  docs/superpowers/specs/2026-08-10-trustworthy-asset-product-v2-design.md \
  docs/superpowers/specs/2026-08-10-phase1-task3-durable-save-contract.md
git merge-base --is-ancestor \
  011921ddfa32cf3166e3b134b57f96a15793d22f HEAD
git rev-parse --short=12 HEAD
```

Expected: the two hashes above, an exit-zero ancestry check, and the current
slice commit. Later slice commits are expected to move `HEAD`; the immutable
starting commit must remain an ancestor. If either specification hash differs
or the ancestry check fails, stop that slice and review the changed bytes
before writing production code.

## Scope Boundaries

- Root `index.html`, `styles.css`, `script.js`, and `legacy-safety.js` remain the only editable Web runtime sources.
- Do not edit `macos-app/Resources/Web/*`; Task 11 owns generation and byte-equality release verification.
- Do not edit the divergent `记账/` directory.
- Do not add IndexedDB, the V2 event ledger, dual-write, automatic retry, or in-process reconciliation after an unknown save.
- Do not migrate the 18 bare business-action `persistData()` call sites or claim their success timing is fixed. Phase 1 Task 4 owns that work.
- Do not repurpose `storage.snapshot` as final freeze. Phase 1 Task 7 owns final-freeze state and the immutable final namespace.
- A browser save may claim only `browser-local-committed`. A native save may claim `native-durable` only after the frozen contract's complete write/sync/reread/hash/identity sequence.

## File Responsibility Map

Every path below is exact and relative to the isolated repository root
`/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/.worktrees/trustworthy-asset-v2`.

### JavaScript lane

- Modify `legacy-safety.js`: queue, canonical one-read DTO extraction, immutable receipts/errors, health validation, typed queue errors, total callback wrapper.
- Modify `script.js`: strict Web storage receipt/error adapter, queue construction after confirmed load, `saveData()` preparation/enqueue, queue-level rollback/unknown/conflict UI, native snapshot/terminalization bridge wiring, rejection observation.
- Create `tests/save-queue.test.js`: frozen contract JavaScript matrix 1–57.
- Modify `tests/data-recovery.test.js`: generation replacement, dual native recovery health, terminalization, rollback/unknown integration.
- Modify `tests/web-storage.test.js`: localStorage old/new reread classification and exact browser receipt.

### Native lane

- Create `macos-app/Sources/AssetTrackerCore/NativeDurableFileWriter.swift`: scoped mutation lock, canonical identity checks, POSIX exact write/sync/rename/reread primitives, fault injection.
- Create `macos-app/Sources/AssetTrackerCore/AssetTrackerRecoveryStore.swift`: ordinary prepared/committed index, snapshot index/ordinal/retention, pending cleanup, dual-domain audit and reconciliation.
- Modify `macos-app/Sources/AssetTrackerCore/AssetTrackerBookStore.swift`: strict save/snapshot requests, validated envelope metadata, lock-in CAS, durable receipts/errors, load health.
- Modify `macos-app/Sources/AssetTrackerCore/AssetTrackerStorageCoordinator.swift`: save/snapshot single-flight, gate ordering, typed terminalization, late-generation protection.
- Modify `macos-app/Sources/AssetTrackerCore/AssetTrackerBridgeResponse.swift`: lossless load/save/snapshot/error/health/terminalization response envelopes.
- Modify `macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift`: strict request parsing and `storage.snapshot` routing; no durability defaults.
- Modify `macos-app/Package.swift`: add `AssetTrackerFaultHarness` executable product and target.
- Create `macos-app/Sources/AssetTrackerFaultHarness/main.swift`: one-operation fault-point subprocess protocol.
- Create `macos-app/Tests/AssetTrackerCoreTests/NativeDurableFileWriterTests.swift`: frozen native matrix 1–44.
- Create `macos-app/Tests/AssetTrackerCoreTests/AssetTrackerRecoveryStoreTests.swift`: focused ordinary/snapshot semantic and audit tests.
- Modify `macos-app/Tests/AssetTrackerCoreTests/AssetTrackerBookStoreTests.swift`: coordinator, gate, response, and bridge integration.
- Create `macos-app/Tests/AssetTrackerCoreTests/ProcessKillRecoveryTests.swift`: frozen crash matrix 1–9 using a fresh verifier process.

## Parallel Ownership and Commit Discipline

- The JavaScript worker owns only the JavaScript lane files above.
- The native worker owns only the native lane files above.
- The primary agent owns this plan, cross-layer reconciliation, staging, and commits.
- The primary agent alone owns `tests/macos-scaffold.test.js`; Task 10 adds its cross-layer bridge-routing assertions after both implementation lanes exist.
- Workers do not run `git add`, `git commit`, synchronization scripts, or modify generated Web resources.
- A worker must report one stable focused RED before changing production code and one focused GREEN before handing a slice back.
- Shared integration starts only after both lane-focused suites are green. The primary agent reviews the diff before every commit.

## Required Slice Order

```text
0 Commit frozen contract and plans
  -> 1 Queue value boundary
  -> 2 FIFO success lane and callback fence
  -> 3 Queue failure/rollback/terminalization
  -> 4 Snapshot barrier and tracker/Web integration

5 POSIX writer and mutation lock
  -> 6 Ordinary recovery/index reconciliation
  -> 7 Snapshot retention and health
  -> 8 Native store/coordinator/bridge integration
  -> 9 Real-process kill recovery

4 + 9 -> 10 Cross-layer acceptance and Task 3 completion
```

Tasks 1–4 and 5–9 may advance in parallel because their production files do not overlap. Task 10 is serial.

### Authoritative JavaScript Matrix Ownership

Each frozen JavaScript matrix item has exactly one slice that must make the
complete item GREEN. Earlier slices may add an explicitly named prerequisite
subcase, but that does not transfer or duplicate ownership:

| Slice | Complete frozen JavaScript items owned |
|---|---|
| Task 2 | `1–5, 12, 15, 18, 28` |
| Task 3 | `6–11, 25, 31, 33, 35, 39, 41, 43–44, 53` |
| Task 4 | `13–14, 16–17, 19–24, 26–27, 29–30, 32, 34, 36–38, 40, 42, 45–52, 54` |
| Task 10 | `55–57` |

The four rows are a disjoint exhaustive partition of items 1–57. Task 4 owns
the JavaScript adapter prerequisites for 55–57 and Task 8 owns their native
prerequisites; Task 10 alone completes those three cross-layer items against
both implemented lanes.

### Task 0: Commit the Frozen Task 3 Documentation Baseline

**Files:**

- Create: `docs/superpowers/specs/2026-08-10-phase1-task3-durable-save-contract.md`
- Create: `docs/superpowers/plans/2026-08-10-phase1-task3-durable-save.md`
- Modify: `docs/superpowers/plans/2026-08-10-phase1-legacy-risk-isolation.md`

- [ ] **Step 1: Verify all three binding documents before staging**

Run:

```bash
test "$(shasum -a 256 docs/superpowers/specs/2026-08-10-phase1-task3-durable-save-contract.md | awk '{print $1}')" \
  = "4585996f8732bc5f3a2f119a90474610c0866817573dcd07dd4539ed4c422728"
TASK3_PLAN_SHA="$(shasum -a 256 docs/superpowers/plans/2026-08-10-phase1-task3-durable-save.md | awk '{print $1}')"
rg -F "$TASK3_PLAN_SHA" docs/superpowers/plans/2026-08-10-phase1-legacy-risk-isolation.md
git diff --check
```

Expected: the contract hash matches, the Phase 1 plan contains the exact dedicated-plan hash, and the diff check is clean.

- [ ] **Step 2: Commit the documentation as a production-neutral baseline**

```bash
git add docs/superpowers/specs/2026-08-10-phase1-task3-durable-save-contract.md \
  docs/superpowers/plans/2026-08-10-phase1-task3-durable-save.md \
  docs/superpowers/plans/2026-08-10-phase1-legacy-risk-isolation.md
git diff --cached --check
git commit -m "docs: freeze durable save implementation contract"
```

Expected: the working tree is clean and the commit changes documentation only. The final three-review range starts at production commit `011921ddfa32cf3166e3b134b57f96a15793d22f`, so this documentation commit is included in the reviewed Task 3 candidate.

### Task 1: Establish the Queue Value Boundary and Exact Error Types

**Files:**

- Create: `tests/save-queue.test.js`
- Modify: `legacy-safety.js`

- [ ] **Step 1: Write the constructor, health, and canonical extraction RED tests**

Start `tests/save-queue.test.js` with deterministic helpers and the exact public constructor:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const LegacySafety = require('../legacy-safety.js');

const H0 = '0'.repeat(64);
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function health(domain, status = 'healthy', overrides = {}) {
    return Object.freeze({
        domain,
        status,
        auditComplete: true,
        code: status === 'degraded' ? 'maintenance-pending' : null,
        maintenancePendingCount: status === 'degraded' ? 1 : 0,
        detail: status === 'degraded' ? 'fixture' : null,
        ...overrides
    });
}

function makeQueue(overrides = {}) {
    return new LegacySafety.AssetTrackerSaveQueue({
        write: overrides.write || (() => Promise.reject(new Error('unexpected write'))),
        snapshot: overrides.snapshot || (() => Promise.reject(new Error('unexpected snapshot'))),
        terminalize: overrides.terminalize || (() => Promise.resolve({
            ok: true,
            protocolVersion: 2,
            loadId: 'load-1',
            reason: 'save-not-committed',
            gateState: 'terminal-locked'
        })),
        sessionContext: { protocolVersion: 2, loadId: 'load-1', writeSessionToken: 'token-1' },
        initialAcknowledged: { stateJson: '{"memo":"H0"}', stateHash: H0 },
        initialRecoveryHealth: {
            ordinary: health('ordinary'),
            snapshot: health('snapshot')
        },
        expectedDurability: 'native-durable',
        durabilityDeadlineMs: 29_000,
        barrierDeadlineMs: 29_000,
        transportDeadlineMs: 30_000,
        generationToken: 'generation-1',
        clock: overrides.clock || { setTimeout, clearTimeout },
        onTransition: overrides.onTransition || (() => undefined),
        onAcknowledged: overrides.onAcknowledged || (() => undefined),
        onFault: overrides.onFault || (() => undefined)
    });
}
```

Add named tests for:

```text
constructor rejects non-positive or save/barrier deadlines >= transport deadline
constructor freezes session context and complete ordinary/snapshot health
getState returns immutable detached complete health objects
constructor rejects cross-domain, incomplete, or contradictory initial health
mutating the constructor input after construction cannot change queue state
```

- [ ] **Step 2: Run the focused tests and record the RED**

Run:

```bash
node --test --test-name-pattern='constructor|initial health|getState|constructor input' tests/save-queue.test.js
```

Expected: FAIL because `LegacySafety.AssetTrackerSaveQueue` and the typed queue/error exports do not exist.

- [ ] **Step 3: Add the minimal public value layer**

Extend the frozen `legacy-safety.js` export with:

```js
class AssetTrackerSaveError extends Error {}
class AssetTrackerSnapshotError extends Error {}
class AssetTrackerQueueAbortError extends Error {}
class AssetTrackerQueueHaltedError extends Error {}
class AssetTrackerQueueCallbackError extends Error {}

class AssetTrackerSaveQueue {
    constructor(options) {
        const configuration = validateAndFreezeQueueOptions(options);
        this.queueConfiguration = configuration;
        this.queueState = createInitialQueueState(configuration);
    }

    getState() {
        return canonicalDeepFrozenCopy(this.queueState);
    }
}
```

Implement `validateAndFreezeQueueOptions`, `createInitialQueueState`, and `canonicalDeepFrozenCopy` in the same module. Add `enqueue`, `failPreparation`, and `runBarrier` only in the later slices that first test their behavior. Capture intrinsic `Promise`, `Promise.resolve`, `Object.freeze`, and `Reflect.get` at module initialization so hostile objects cannot replace them. Receipt/error one-read extraction is first exercised and implemented through the public queue operation paths in Tasks 2–4; Task 1 does not expose a test-only extractor.

- [ ] **Step 4: Run the focused and adjacent suites**

Run:

```bash
node --check legacy-safety.js
node --test --test-name-pattern='constructor|initial health|getState|constructor input' tests/save-queue.test.js
node --test tests/data-recovery.test.js tests/web-storage.test.js
```

Expected: all selected tests PASS and existing recovery/storage tests remain green.

- [ ] **Step 5: Hand the slice to the primary agent for review and commit**

The primary agent inspects `git diff -- legacy-safety.js tests/save-queue.test.js`, runs `git diff --check`, then commits only this slice:

```bash
git add legacy-safety.js tests/save-queue.test.js
git commit -m "test: define durable save queue boundary"
```

### Task 2: Implement Strict FIFO Saves, Receipt Verification, and the Callback Fence

**Files:**

- Modify: `tests/save-queue.test.js`
- Modify: `legacy-safety.js`

- [ ] **Step 1: Write the FIFO and successful-receipt RED tests**

Use two deferred writes and a receipt helper whose fields exactly match the frozen contract:

```js
function nativeReceipt(item, sourceHashBefore, stateHashAfter, overrides = {}) {
    return Object.freeze({
        ok: true,
        clientSaveId: item.clientSaveId,
        payloadHash: item.payloadHash,
        sourceHashBefore,
        stateHashAfter,
        stateHash: stateHashAfter,
        byteCount: new TextEncoder().encode(item.stateJson).byteLength,
        durability: 'native-durable',
        updatedAt: '2026-08-10T00:00:00.000Z',
        storagePath: '/tmp/AssetTrackerBook.json',
        recoveryHealth: health('ordinary'),
        ...overrides
    });
}
```

Add exact named tests completing frozen JavaScript matrix items 1–5, 12, 15,
18, and 28. Add explicitly labelled success-lane prerequisite subcases for
later callback/receipt items 40, 47–50, and 52–54, plus queue-level receipt
subcases for both allowed durability strings; these subcases do not claim the
complete later item. Full item 13, production localStorage item 14, and every
barrier/snapshot half remain Task 4. The critical assertions are:

```js
assert.equal(writeCalls.length, 1, 'max active write is one');
assert.equal(writeCalls[0].expectedHash, H0);
first.resolve(nativeReceipt(writeCalls[0], H0, H1));
await firstPromise;
assert.equal(writeCalls.length, 2);
assert.equal(writeCalls[1].expectedHash, H1);
assert.equal(queue.getState().lastAcknowledgedHash, H1);
assert.ok(transitions.every(transition => transition.lanePhase === 'saving'));
assert.equal(
    transitions.some(transition =>
        transition.primaryStatus === 'native-durable' && transition.lanePhase === 'idle'
    ),
    false,
    'no stable H1 success may appear while H2 remains accepted'
);
```

Include 100 frozen saves; wrong ID/payload/source/durability/hash/byte count; one-read receipt getters/Proxy traps and alternating values through a real write completion; reentrant enqueue; synchronous callback throw; non-`undefined` callback return; resolved/rejected/never-settling/hostile thenables; first caller reaction observing the completed callback fence; mutation of the canonical receipt and nested health after adapter resolution.

Use a non-ASCII state such as `{"memo":"甲"}` and compare the accepted
item's `payloadHash` with an independently computed
`createHash('sha256').update(Buffer.from(stateJson, 'utf8')).digest('hex')`
digest. The expected value must not come from queue code or a receipt helper.

- [ ] **Step 2: Run the focused tests and record the RED**

Run:

```bash
node --test --test-name-pattern='FIFO|rapid|receipt|callback fence|reentrant|thenable|first caller' tests/save-queue.test.js
```

Expected: FAIL because the Task 1 shell has no lane/drain implementation.

- [ ] **Step 3: Implement the FIFO lane and hard fence**

Use private frozen queue items with exactly these primitive fields:

```js
{
    kind: 'save',
    clientSaveId,
    stateJson,
    payloadHash,
    reason,
    promiseCapability,
    acceptedRevision
}
```

`enqueue()` must synchronously freeze the descriptor, append the item, publish `saving` through the total callback wrapper, and only then allow the drain to call `write()`. Execution reads `expectedHash` only from the private last-ACK ledger. On a verified receipt, commit the ledger and settle that item's intrinsic promise, but do not dispatch the next adapter operation until `onAcknowledged` and the post-receipt transition wrappers complete and the generation/revision/terminal checks pass.

The total wrapper accepts only exact `undefined`. For every other result, pass the result to captured intrinsic `Promise.resolve` inside a separate guarded diagnostic block, attach both consumers, and never await it. Preserve a completed operation's real result while converting later undispatched items to one correlated callback fault.

- [ ] **Step 4: Run focused, 100-item, and full queue tests**

Run:

```bash
node --test --test-name-pattern='FIFO|rapid|receipt|callback fence|reentrant|thenable|first caller' tests/save-queue.test.js
node --test tests/save-queue.test.js
node --test tests/data-recovery.test.js tests/web-storage.test.js
```

Expected: PASS; the 100-item case reports max active one and persists the exact 100th state.

- [ ] **Step 5: Review and commit the success lane**

```bash
git add legacy-safety.js tests/save-queue.test.js
git commit -m "feat: serialize acknowledged legacy saves"
```

### Task 3: Implement Failure Classification, Preparation Markers, Rollback, and Terminalization

**Files:**

- Modify: `tests/save-queue.test.js`
- Modify: `legacy-safety.js`

- [ ] **Step 1: Write the fail-closed queue RED matrix**

Add exact named tests completing frozen JavaScript matrix items 6–11, 25, 31,
33, 35, 39, 41, 43–44, and 53. Add explicitly labelled queue/save-only
prerequisite subcases for later production/bridge/barrier items 34, 38, 40,
46–50, 52, and 54–55; these do not claim complete ownership. Task 4 owns the
complete items 13–14, 16–17, 19–24, 26–27, 29–30, 32, 34, 36–38, 40, 42,
45–52, and 54, plus the JavaScript-adapter prerequisites for cross-layer
items 55–57. Task 10 alone owns the complete cross-layer items 55–57. Use a
structured known-not-committed fixture with every proof field present:

```js
const error = new LegacySafety.AssetTrackerSaveError('disk full');
Object.assign(error, {
    code: 'write-failed',
    writeOutcome: 'not-committed',
    conflict: false,
    clientSaveId: active.clientSaveId,
    payloadHash: active.payloadHash,
    sourceHashAfter: H0,
    sourceReverified: true,
    coordinatorReleased: true,
    healthPersisted: false,
    recoveryHealthEvidence: null
});
```

Test all strict tuple inversions: false/non-null, true/null, wrong domain, incomplete evidence, wrong source including `null`, conflict, and resolved `{ok:false}`. Assert only the complete proof rolls back to `lastAcknowledgedStateJson`; every malformed or transport result becomes unknown and preserves the active attempted snapshot.

For candidate preparation, enqueue H1, call `failPreparation(candidateError)`,
and assert the zero-I/O marker waits behind H1. `failPreparation()` must also
publish, before it returns, one immutable `preparation-rejected` transition
whose `visibleStateJson` is the most recent accepted queue-tail `stateJson`, or
the acknowledged baseline when no save item has been accepted. Cover H1 ACK,
H1 known not committed, H1 unknown, callback-marker replacement,
pending/future error types, immutable cause correlation, and no intermediate
H1 stable-success transition. With H1 deferred and an invalid H2 currently
rendered, assert the transition restores visible H1 before H1 settles; with H1
and H2 accepted and invalid H3 rendered, assert it restores H2 and performs
zero H3 adapter I/O.

For terminalization, assert the queue enters Web terminal before invoking the
dependency and reaches the five reasons available without a barrier:
`save-not-committed`, `save-outcome-unknown`, `save-conflict`,
`candidate-invalid`, and `queue-callback-failed`. Validate the exact terminal
receipt, ignore ACK failure/timeout, and never create a new save ID. Task 4
uses real `runBarrier()` paths to add `snapshot-outcome-unknown` and
`snapshot-conflict`, completing item 34. Assert a generation-N
timer/completion cannot update a replacement generation.

- [ ] **Step 2: Run the focused failure tests and record the RED**

Run:

```bash
node --test --test-name-pattern='not-committed|unknown|conflict|preparation|marker|terminal|rollback|abort|halted' tests/save-queue.test.js
```

Expected: FAIL because failure proof validation, marker scheduling, queue-level rollback, and Task 3 terminal reasons are incomplete.

- [ ] **Step 3: Implement deterministic queue failure objects and terminal states**

Implement the exact frozen error split:

```text
active storage item -> canonical AssetTrackerSaveError or AssetTrackerSnapshotError
accepted undispatched item -> AssetTrackerQueueAbortError(queueOutcome='not-dispatched')
future item -> AssetTrackerQueueHaltedError(queueOutcome='queue-halted')
callback marker -> AssetTrackerQueueCallbackError with immutable callbackFaultId
```

Known-not-committed restores the private last-ACK JSON and enters `failed-readonly`. Unknown keeps the active attempted JSON visible and enters `durability-unknown`. Conflict makes no disk-equality claim. All three stop acceptance, reject pending/future items, call `onFault` once, and terminalize native without retry. A candidate preparation marker has no storage operation and loses to an earlier active storage fault.

The preparation transition is separate from the later terminal `onFault`.
`failPreparation()` first sets `accepting=false`, freezes the queue-tail or
acknowledged-baseline JSON as `visibleStateJson`, and synchronously publishes
that transition through the same total callback wrapper before returning its
already-observed rejected Promise. Only then does it append the no-I/O marker
at the lane tail. A callback failure while publishing this transition replaces
the preparation marker at the same FIFO position under the frozen callback
rules; it cannot dispatch the invalid candidate or overtake an earlier item.

- [ ] **Step 4: Expose immutable rollback/unknown evidence to the tracker callback**

The queue's one `onFault` value contains detached immutable evidence for the later tracker integration:

```js
{
    queueOutcome,
    terminalReason,
    lastAcknowledgedStateJson,
    lastAcknowledgedHash,
    attemptedStateJson,
    activeClientItemId,
    callbackFaultId
}
```

The pure queue tests mutate this callback value in strict mode and prove the internal ledger is unchanged. They also prove terminalization receives the exact queue reason/session and that terminal ACK failure cannot revive the lane. Task 4 maps this evidence to `AssetTracker` memory, UI, and generation state.

- [ ] **Step 5: Run focused and integration GREEN tests**

Run:

```bash
node --check legacy-safety.js
node --test --test-name-pattern='not-committed|unknown|conflict|preparation|marker|terminal|rollback|abort|halted' tests/save-queue.test.js
node --test tests/save-queue.test.js
```

Expected: PASS with no unhandled rejection and no adapter call after the first terminal fault.

- [ ] **Step 6: Review and commit the failure lane**

```bash
git add legacy-safety.js tests/save-queue.test.js
git commit -m "fix: fail legacy save queue closed"
```

### Task 4: Add the Snapshot Barrier and Integrate Exact Browser/Native Adapters

**Files:**

- Modify: `tests/save-queue.test.js`
- Modify: `tests/data-recovery.test.js`
- Modify: `tests/web-storage.test.js`
- Modify: `legacy-safety.js`
- Modify: `script.js`

- [ ] **Step 1: Write barrier and adapter RED tests**

Add exact named tests for all Task 4-owned production/integration items:
13–14, 16–17, 19–24, 26–27, 29–30, 32, 34, 36–38, 40, 42, 45–52, and
54. Add explicitly labelled JavaScript-adapter prerequisite tests for
cross-layer items 55–57; Task 10 owns their complete result. Item 34 must reach all seven reasons through real save, marker,
callback, and `runBarrier()` paths. Required ordering fixture:

```js
const h1 = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'manual' });
const snapshot = queue.runBarrier({ clientSnapshotId: 'snapshot-1', reason: 'manual' });
const h2 = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'manual' });

assert.deepEqual(callKinds, ['save']);
save1.resolve(nativeReceipt(saveCalls[0], H0, H1));
await h1;
assert.deepEqual(callKinds, ['save', 'snapshot']);
assert.equal(snapshotCalls[0].expectedHash, H1);
snapshotDeferred.resolve({
    ok: true,
    clientSnapshotId: 'snapshot-1',
    sourceHash: H1,
    snapshotHash: H1,
    ordinal: 0,
    durability: 'native-durable',
    retainedCount: 1,
    snapshotStatus: 'created',
    recoveryHealth: health('snapshot')
});
await snapshot;
assert.equal(saveCalls[1].expectedHash, H1);
```

Cover created/deduplicated/degraded, exact triple hash, known-not-created with strict persisted health, timeout, malformed result, source/session conflict, callback-fence failures, and a caller attempt to inject an operation/session/deadline.

Web adapter tests must prove old-value reread -> known not committed, new-value reread -> normal receipt, other/unreadable -> unknown, and the same FIFO owns localStorage. Exact status assertions are mandatory:

```js
assert.equal(webHealthyCopy, '已存入此浏览器');
assert.equal(nativeHealthyCopy, '已安全写入本机');
assert.equal(nativeDegradedCopy, '已耐久保存；恢复维护需处理');
assert.equal(nativeDegradedTone, 'warning');
assert.notEqual(nativeDegradedTone, 'success');
```

The Web string must also exclude `安全`, `磁盘`, `本机文件`, and `备份`. Empty/generic copy fails. Add an explicit test documenting that legacy browser automatic-backup routing remains Phase 1 Task 4 debt.

Native load fixtures in `tests/data-recovery.test.js` must reject missing/malformed dual health, round-trip both complete domains, and preserve `updatedAt`/canonical `storagePath` without treating either as hash proof. Task 10 owns the matching native-bridge static/routing assertions.

Add production-visible preparation fixtures as well. In the first, defer H1,
render a mutated H2, force H2 validation or hash preparation to throw, and
assert `tracker.data` plus rendered views synchronously return to accepted H1
before H1 resolves or rejects. In the second, keep H1 active and H2 accepted,
render invalid H3, and assert the same synchronous transition restores H2,
with zero H3 Web/native adapter calls. Both fixtures retain the later marker
ordering and earlier-fault-wins assertions from Task 3.

- [ ] **Step 2: Run the focused RED**

Run:

```bash
node --test --test-name-pattern='barrier|snapshot|terminal|localStorage|copy|browser-local|preparation|normalize|stringify|validator|hash|backup|recovery health|updatedAt|storagePath' \
  tests/save-queue.test.js tests/data-recovery.test.js tests/web-storage.test.js
```

Expected: FAIL because `runBarrier`, strict `storage.snapshot`, and exact dual-health adapter mapping are incomplete.

- [ ] **Step 3: Implement the barrier in the same FIFO lane**

Freeze only `{clientSnapshotId, reason}` at enqueue time. At execution, call the private snapshot dependency with the queue-owned expected hash and constructor-frozen session. A successful or valid known-not-created outcome must finish its callback fence before a later save dispatches; a barrier never changes the primary hash/JSON ledger.

Implement exact browser receipt/error conversion in `AssetTrackerStorageAdapter.save()` and strict native save/snapshot/terminal/load DTO conversion. Adapter functions resolve only valid success receipts and reject typed errors; resolved failure unions are forbidden.

After load/validate/render/confirm, construct one generation-owned queue. Its `onFault` integration performs:

```js
const lastAckReasons = new Set([
    'save-not-committed',
    'candidate-invalid',
    'queue-callback-failed',
    'snapshot-outcome-unknown'
]);
try {
    let replacementJson = null;
    if (lastAckReasons.has(fault.terminalReason)) {
        replacementJson = fault.lastAcknowledgedStateJson;
    } else if (fault.terminalReason === 'save-outcome-unknown') {
        replacementJson = fault.attemptedStateJson;
    } else if (![
        'save-conflict',
        'snapshot-conflict'
    ].includes(fault.terminalReason)) {
        throw new Error('UNKNOWN_PERSISTENCE_TERMINAL_REASON');
    }
    if (replacementJson !== null) {
        this.data = JSON.parse(replacementJson);
        this.refreshDataViews();
    }
} finally {
    this.enterPersistenceProtection(fault);
}
```

The integration RED covers all seven reasons. At minimum it renders pending
H2 before each of: an H1 save timeout (restore active attempted H1), a snapshot
timeout (restore durable H1), candidate marker, and callback marker (both
restore last ACK). It asserts `tracker.data` and the rendered view agree before
protection UI becomes active. Save/snapshot conflicts preserve current memory
and make no disk-equality claim. The method name is the existing production
`refreshDataViews()` seam; no nonexistent catch-all refresh method is invented.
Injected parse/refresh failure must still enter protection through `finally`
and is consumed by the existing total observer without a second fault.

The same generation owns a synchronous `onTransition` handler for
`preparation-rejected`. It accepts only the queue's detached primitive
`visibleStateJson`, verifies the generation token, assigns the parsed value to
`this.data`, and calls the existing `refreshDataViews()` before returning
`undefined`. It does not enter terminal protection yet: the queued marker or
an earlier storage fault remains authoritative. Any parse/refresh exception
is handled by the queue's total callback wrapper as the pre-dispatch callback
fault that replaces this marker; no invalid candidate I/O is permitted.

Retry/relaunch replaces the queue and opaque generation; late callbacks and timers from the old generation are inert. Unknown copy is exactly `保存结果未知，请重新启动以核对账本；系统不会自动重试`, never the corrupt-recovery claim “本次未写入”.

- [ ] **Step 4: Route `saveData()` through preparation and the queue**

`saveData()` runs writable preflight first, then converts every normalize/serialize/validate/hash preparation exception into the same queue marker before enqueue:

```js
this.assertWritable();
try {
    const normalized = this.normalizeLoadedData(this.data);
    const stateJson = JSON.stringify(normalized);
    const validation = LegacySafety.validateBookText(stateJson);
    if (validation.status !== 'valid') {
        throw new Error('CANDIDATE_INVALID');
    }
    this.data = normalized;
    return this.observePersistencePromise(
        this.saveQueue.enqueue({ stateJson, reason })
    );
} catch (error) {
    return this.observePersistencePromise(
        this.saveQueue.failPreparation(error)
    );
}
```

`normalizeLoadedData()` is the existing normalization seam; `JSON.stringify` immediately freezes the candidate into a primitive string before any asynchronous work, so later mutation of array/object references cannot change the item. `AssetTrackerSaveQueue.enqueue()` synchronously computes `payloadHash` from the exact UTF-8 `stateJson` with `LegacySafety.sha256Hex(new TextEncoder().encode(stateJson))` before accepting the item; passing a string directly is forbidden because the current helper accepts bytes. Hash failure becomes the same preparation marker and cannot observe a later mutation. The observer records the already-centralized rejection and consumes its derived branch without empty catch or success messaging. Phase 1 Task 4 will later await individual business commands.

The catch path relies on `failPreparation()` completing the synchronous
`preparation-rejected` transition before it returns the rejected Promise; the
observer is not the visible-state rollback mechanism and may not delay that
transition until the marker reaches the head.

- [ ] **Step 5: Run all JavaScript Task 3 tests**

Run:

```bash
node --check legacy-safety.js
node --check script.js
node --test tests/save-queue.test.js
node --test tests/data-recovery.test.js tests/web-storage.test.js
node --test tests/*.test.js
```

Expected: all tests pass except the single already-approved release-only staged-assets skip in the normal full suite.

- [ ] **Step 6: Review and commit the complete JavaScript lane**

```bash
git add legacy-safety.js script.js tests/save-queue.test.js tests/data-recovery.test.js tests/web-storage.test.js
git commit -m "feat: add save queue snapshot barrier"
```

### Task 5: Build the POSIX Durable Writer and Canonical Mutation Lock

**Files:**

- Create: `macos-app/Sources/AssetTrackerCore/NativeDurableFileWriter.swift`
- Create: `macos-app/Tests/AssetTrackerCoreTests/NativeDurableFileWriterTests.swift`

- [ ] **Step 1: Write syscall-order, identity, and lock RED tests**

Create focused XCTest fixtures around a narrow syscall adapter. The production-facing types are fixed here and reused by Tasks 6–9:

```swift
public enum NativeDurabilityFaultPoint: String, CaseIterable, Sendable {
    case afterLockAcquired, afterSourceCAS, afterSourceRevalidation
    case afterTempCreate, afterExactWrite, afterFileFSync, afterFullFSync
    case beforeRename, afterRename, afterParentDirectoryFSync
    case afterFinalReread, afterHashVerified, beforeACK, afterDurableReceiptReturned
    case afterOrdinaryDirectoryDurable, afterEmptyOrdinaryIndexDurable
    case afterOrdinaryBlobsDirectoryDurable, afterOrdinaryBlobDurable
    case afterPreparedOrdinaryIndexDurable, afterPrimaryDurableBeforeACK
    case afterCommittedOrdinaryIndexDurable, afterSnapshotDirectoryDurable
    case afterEmptySnapshotIndexDurable, afterSnapshotBlobDurable
    case afterSnapshotIndexDurable
    case beforeRetentionUnlink, afterRetentionUnlink, afterRetentionDirectoryFSync
    case beforeRecoveryHealthClear, afterRecoveryHealthClear
}

public enum NativeDurabilityRole: String, Sendable {
    case lock, primary, bookStore, ordinaryDirectory, ordinaryBlob
    case ordinaryEmptyIndex, ordinaryPreparedIndex, ordinaryCommittedIndex
    case ordinaryHealthIndex, snapshotDirectory, snapshotBlob
    case snapshotEmptyIndex, snapshotFinalIndex, snapshotHealthIndex
    case coordinator, harness
}

public struct NativeDurabilityFaultEvent: Sendable {
    public let point: NativeDurabilityFaultPoint
    public let role: NativeDurabilityRole
    public let targetName: String

    public init(
        point: NativeDurabilityFaultPoint,
        role: NativeDurabilityRole,
        targetName: String
    ) {
        self.point = point
        self.role = role
        self.targetName = targetName
    }
}

public typealias NativeDurabilityFaultHandler =
    @Sendable (NativeDurabilityFaultEvent) throws -> Void

public enum NativeDurableWriteDisposition: Sendable {
    case replace
    case createOnly
}

public enum ExpectedBookSource: Equatable, Sendable {
    case missing
    case sha256(String)
}

public struct NativeDurableFileReceipt: Equatable, Sendable {
    public let sha256: String
    public let byteCount: Int
    public let device: UInt64
    public let inode: UInt64
    public let mode: UInt16
}

protocol NativePOSIX: Sendable {
    func effectiveUserID() -> uid_t
    func openAt(directoryFD: Int32, path: String, flags: Int32, mode: mode_t) throws -> Int32
    func makeDirectoryAt(directoryFD: Int32, path: String, mode: mode_t) throws
    func read(fileFD: Int32, bytes: UnsafeMutableRawBufferPointer) throws -> Int
    func write(fileFD: Int32, bytes: UnsafeRawBufferPointer) throws -> Int
    func flock(fileFD: Int32, operation: Int32) throws
    func fstat(fileFD: Int32) throws -> stat
    func syncFile(fileFD: Int32) throws
    func fullSyncFile(fileFD: Int32) throws
    func changeMode(fileFD: Int32, mode: mode_t) throws
    func renameAt(
        sourceDirectoryFD: Int32,
        source: String,
        destinationDirectoryFD: Int32,
        destination: String,
        exclusive: Bool
    ) throws
    func syncDirectory(directoryFD: Int32) throws
    func fstatAt(directoryFD: Int32, path: String, noFollow: Bool) throws -> stat
    func directoryEntries(directoryFD: Int32) throws -> [NativeDirectoryEntry]
    func extendedACLEntryCount(fileFD: Int32) throws -> Int
    func hasDangerousLegacyACL(fileFD: Int32, ownerUserID: uid_t) throws -> Bool
    func clearExtendedACL(fileFD: Int32) throws
    func unlinkAt(directoryFD: Int32, path: String) throws
    func close(fileFD: Int32)
}

struct NativeDirectoryEntry: Equatable, Sendable {
    let name: String
    let fileType: NativeDirectoryEntryType
}

enum NativeDirectoryEntryType: Equatable, Sendable {
    case regular, directory, symbolicLink, other
}

struct NativeSourceProof: Sendable {
    fileprivate let leaseID: UInt64
    fileprivate let targetName: String
    fileprivate let expectedSource: ExpectedBookSource
    fileprivate let device: UInt64?
    fileprivate let inode: UInt64?
    fileprivate let byteCount: Int?
}

final class NativeDurableFileWriter: @unchecked Sendable {
    init(
        rootURL: URL,
        faultHandler: @escaping NativeDurabilityFaultHandler = { _ in }
    )

    init(
        rootURL: URL,
        posix: any NativePOSIX,
        faultHandler: @escaping NativeDurabilityFaultHandler
    )

    func withExclusiveMutationLock<T>(
        _ body: (NativeLockedBookDirectory) throws -> T
    ) throws -> T
}

final class NativeLockedBookDirectory {
    func readValidated(relativePath: String) throws -> Data?
    func verifyPrimarySource(
        expectedSource: ExpectedBookSource
    ) throws -> NativeSourceProof
    func durableReplacePrimary(
        _ bytes: Data,
        sourceProof: NativeSourceProof
    ) throws -> NativeDurableFileReceipt
    func durablyVerifyUnchangedPrimary(
        sourceProof: NativeSourceProof
    ) throws -> NativeDurableFileReceipt
    func durableWrite(
        _ bytes: Data,
        relativePath: String,
        disposition: NativeDurableWriteDisposition,
        role: NativeDurabilityRole
    ) throws -> NativeDurableFileReceipt
    func durablySyncManagedDirectory(
        relativePath: String,
        role: NativeDurabilityRole
    ) throws
    func createManagedDirectory(
        relativePath: String,
        role: NativeDurabilityRole
    ) throws
    func enumerate(relativePath: String) throws -> [NativeDirectoryEntry]
    func unlinkOrdinaryPendingAndSync(relativePath: String) throws
    func unlinkSnapshotPendingAndSync(relativePath: String) throws
    func revalidateCanonicalIdentity() throws
}
```

`NativeLockedBookDirectory` holds a private one-use lease created after
`flock(LOCK_EX)`. Every method verifies that lease is active and belongs to its
`NativeSourceProof`; `withExclusiveMutationLock` invalidates the lease in
`defer` before unlocking. Returning or retaining the capability is harmless:
any later method call throws `leaseExpired` before a syscall.

All production callers share one writer instance. The writer also keeps a
process-local registry keyed by the opened root directory device/inode so a
same-thread acquisition of the same root through a second writer instance
fails before a second `flock`; different threads still serialize on the fixed
lock, and the same thread may nest different roots. Task 7 reuses this exact
lock scope rather than constructing a second lock implementation.

The fixed lock is never exposed as a half-initialized canonical inode. When it
is missing, the writer creates a random sibling lock temp with
`O_CREAT|O_EXCL|O_NOFOLLOW`, clears inherited ACLs, applies and verifies `0600`,
performs `fsync` plus `F_FULLFSYNC`, and publishes it with an exclusive rename
before synchronizing the root directory. A loser opens the fully published
canonical lock. Private pre-publication lock temps left by a killed process are
ignored and preserved; no scan or speculative cleanup may delete them or any
unknown sentinel. A pre-existing canonical lock is admitted by owner/type,
single-link, `0600`, and zero-ACL metadata, but its bytes are opaque and are
never rewritten merely because they are nonempty.

Legacy root/primary admission and newly managed objects use different ACL
rules. A legacy root or primary may be admitted only when it is owner-bound and
has no dangerous non-owner write/delete/security ACL entry. Every newly
created managed directory/file and the root once the canonical lock is held
must have inherited ACLs explicitly cleared, then be mode-normalized and
verified with zero ACL entries before it can contribute to a receipt. ACL
inspection or clearing errors fail closed.

`NativeSourceProof` is created only for the fixed canonical
`AssetTrackerBook.json` basename and embeds that target identity; callers
cannot apply it to an arbitrary relative path. `durablyVerifyUnchangedPrimary`
uses the proof without rename: it performs file `fsync`, `F_FULLFSYNC`, parent
directory sync, exact reread/hash/stat, source and canonical-identity
revalidation, then returns the same receipt shape. The managed-directory
primitive synchronizes and revalidates a bound ordinary/snapshot directory
without changing an index. Task 6 uses the first for candidate-equals-source;
Task 7 uses both for pure retained snapshot dedup.

Every non-primary write/directory call requires one internal semantic role.
The locked directory validates a fixed role-to-managed-target allowlist before
the first syscall (for example, `ordinaryPreparedIndex` may target only
`Recovery/ordinary/slots.json`). This is how one shared writer emits distinct
empty/prepared/committed/health index checkpoints even when the basename is
the same; an illegal role/path pair fails before I/O.

The two pending-unlink APIs have fixed implicit roles and cannot be exchanged.
The snapshot variant owns the retention fault boundaries inside the syscall
sequence itself:

```text
beforeRetentionUnlink
unlinkat
afterRetentionUnlink
fsync(snapshot directory)
afterRetentionDirectoryFSync
final no-callback canonical ENOENT proof
```

The ordinary variant never emits snapshot-retention points. Both validate the
known managed pending target and lease before unlink. This makes the
unlink-before-directory-sync crash window observable instead of collapsing
`afterRetentionUnlink` and `afterRetentionDirectoryFSync` to one state.

Name focused tests for frozen native matrix items 1–5, 14–16, and 33:

```text
testExactWriteRetriesEINTRAndShortWritesIncludingZeroAndLargePayloads
testDurableReplaceOrdersTempWriteFSyncFullFSyncRenameDirectoryFSyncRereadHash
testCreateOnlyCollisionNeverOverwritesExistingContentAddressedBlob
testManagedPathsRejectSymlinkNonRegularWrongOwnerWrongModeAndUnexpectedACL
testLegacyRootAndPrimaryPermissionsUpgradeWithoutChangingPrimaryBytes
testCanonicalRootLockAndManagedDirectoryIdentityAreRevalidatedBeforeReceipt
testHeldFileDescriptorsMatchCanonicalEntriesByDeviceAndInode
testExplicitFchmodMakesManagedFilesPrivateUnderPermissiveUmask
testExternalSourceChangeAfterInitialCASAndBeforeRenameIsNeverOverwritten
testEscapedLockedDirectoryFailsBeforeAnySyscallAfterUnlock
testMutationLockScopeRejectsRecursiveAcquisitionAndIsReusableByTask7
testUnchangedPrimaryVerificationRunsFileAndDirectoryDurabilityWithoutRename
testManagedDirectorySyncRevalidatesBoundIdentityWithoutMutation
testIllegalSemanticRoleAndManagedTargetPairFailsBeforeAnySyscall
testSnapshotPendingUnlinkFaultsBracketUnlinkAndDirectorySyncExactly
testOrdinaryPendingUnlinkNeverEmitsSnapshotRetentionFaultPoints
testLockBootstrapPublishesOnlyInitializedDurableInodeAndFreshReopensEveryFailureBoundary
testAuthorizedMutationClearsInheritedBenignACLFromRootAndEveryNewManagedObject
testPreparedTempExactBytesAreReprovedAfterEveryExternalPreRenameCallback
testFinalReceiptRejectsSameInodeContentMutationAtEveryFinalCallback
testExistingManagedDirectoryRetryDurablySyncsChildAndParentAfterInterruptedCreation
```

The fake POSIX adapter must record every method in `NativePOSIX`, including
`flock`, `read`, `fstat(fd)`, `fstatat`, `fchmod`, `mkdirat`, directory
enumeration, dangerous-legacy-ACL inspection, zero-ACL inspection, ACL clearing,
`openat`, `write`, both sync calls,
`renameat`/exclusive rename, `unlinkat`, and close order. Real
temporary-directory tests verify private `0700` managed directories, `0600`
managed files, and that a second independent lock attempt cannot enter until
the first releases. The true two-process CAS winner test remains Task 9, where
the subprocess executable exists.

- [ ] **Step 2: Run the focused tests and record the RED**

Run:

```bash
swift test --package-path macos-app --filter NativeDurableFileWriterTests
```

Expected: compilation FAIL because `NativeDurableFileWriter`, its lock scope, and the syscall seam do not exist.

- [ ] **Step 3: Implement the minimal mutation lock and durable primitive**

The writer anchors the canonical storage root from its parent directory file
descriptor. If the root was first observed missing, both the creator and an
`EEXIST` loser reopen it with no-follow semantics and idempotently synchronize
the root and its parent before lock admission. It then uses the crash-safe
private-temp publication protocol above for the fixed lock, takes
`flock(LOCK_EX)`, tightens the admitted root to `0700` with zero ACL, and
revalidates parent entry/root/lock device, inode, link count, owner, type, mode,
and ACL after acquisition. A locked operation may use only relative managed
basenames through the directory descriptor. Creating a managed directory, or
retrying after an interrupted creation when the directory already exists,
uses one already-bound parent descriptor for the child open, both syncs, and
both pre/post-sync proofs. Only the initial existence probe may route an
`ENOENT` into creation; an `ENOENT` or identity change during any later proof
fails closed and never recreates the name. Both paths idempotently synchronize
the child directory and that same actual parent, then revalidate the child
FD-to-name identity, `0700`/owner/link/zero-ACL metadata, the parent, and the
complete root/lock/ancestor chain.

The exact durable replace sequence is:

```text
openat sibling temp with O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC mode 0600
clear inherited ACLs, fchmod(temp, 0600), and verify zero ACL, independent of umask
write exact bytes, retry EINTR and short writes
fsync(temp)
fcntl(temp, F_FULLFSYNC)
run all declared pre-rename fault callbacks
silently reopen/re-read and prove the temp FD, canonical temp name, exact bytes, byte count, SHA-256, owner, mode, and zero ACL still agree
revalidate root/lock/managed-directory identities
for primary replace, prove missing or exact initial hash, byte count, device, and inode from NativeSourceProof, trigger afterSourceRevalidation, then repeat a silent final source proof
after the final source-name fstat proof, make rename the immediately following syscall, with no callback or unrelated syscall between them
rename atomically (create-only uses an exclusive no-follow rename)
fsync(parent directory)
reopen final with O_NOFOLLOW
verify regular file, owner, 0600, exact bytes, byte count, and SHA-256
run declared post-rename/final fault callbacks, then silently repeat exact bytes/hash/stat, FD-to-name identity, zero-ACL, and canonical directory/lock/root proofs
return NativeDurableFileReceipt
```

Each descriptor uses `defer`-backed close. Never resolve a target through a string path after the directory descriptor is bound. Cleanup removes only a temp name created by the current operation and never scans or deletes an unknown entry.

Every cleanup/unlink first proves that the still-open owned FD is the current
canonical leaf by device/inode/type/owner/link count. If a callback or another
process replaced the name, the replacement is preserved. The retention unlink
path performs its final ENOENT proof only after all retention callbacks, and a
final receipt is issued only after the last callback is followed by a silent
authoritative re-read and canonical proof. Fault injection is never itself the
last proof.

Emit the shared throwing fault event at every writer/lock checkpoint owned by
this file, with the exact role and managed target name. Unit tests install a
recording handler and assert every declared writer point is reachable in the
expected order; an injected throw follows the same production cleanup path.

- [ ] **Step 4: Run focused and strict-concurrency GREEN tests**

Run:

```bash
swift test --package-path macos-app --filter NativeDurableFileWriterTests
swift build --package-path macos-app -Xswiftc -strict-concurrency=complete -Xswiftc -warnings-as-errors
```

Expected: PASS; the recorded sequence includes both `fsync` and `F_FULLFSYNC` before rename and a parent-directory sync after rename.

- [ ] **Step 5: Review and commit the durable primitive**

```bash
git add macos-app/Sources/AssetTrackerCore/NativeDurableFileWriter.swift \
  macos-app/Tests/AssetTrackerCoreTests/NativeDurableFileWriterTests.swift
git commit -m "feat: add native durable file primitive"
```

### Task 6: Implement Crash-Reconcilable Ordinary Recovery

**Files:**

- Create: `macos-app/Sources/AssetTrackerCore/AssetTrackerRecoveryStore.swift`
- Create: `macos-app/Tests/AssetTrackerCoreTests/AssetTrackerRecoveryStoreTests.swift`
- Modify: `macos-app/Tests/AssetTrackerCoreTests/NativeDurableFileWriterTests.swift`

- [ ] **Step 1: Write ordinary-index and reconciliation RED tests**

Define the on-disk ordinary index as one durable JSON object with a committed record, optional prepared record, canonical pending cleanup, and persisted health code. The test helper serializes the exact versioned shape:

```swift
public enum NativeRecoveryDomain: String, Codable, Sendable {
    case ordinary
    case snapshot
}

public enum NativeRecoveryStatus: String, Codable, Sendable {
    case healthy
    case degraded
    case notApplicable
}

public struct NativeRecoveryHealth: Codable, Equatable, Sendable {
    public let domain: NativeRecoveryDomain
    public let status: NativeRecoveryStatus
    public let auditComplete: Bool
    public let code: String?
    public let maintenancePendingCount: Int
    public let detail: String?
}

struct OrdinaryRecoveryIndex: Codable, Equatable, Sendable {
    let format: String
    let version: Int
    var committed: OrdinaryCommittedState
    var prepared: OrdinaryPreparedState?
}

struct OrdinaryCommittedState: Codable, Equatable, Sendable {
    var primaryHash: String?
    var slots: [String]
    var maintenance: OrdinaryMaintenanceState
}

struct OrdinaryMaintenanceState: Codable, Equatable, Sendable {
    var pendingCleanupHashes: [String]
    var lastHealthCode: String?
}

struct OrdinaryPreparedState: Codable, Equatable, Sendable {
    let operationId: String
    let sourceHash: String?
    let candidateHash: String
    let committedSlots: [String]
    let nextSlots: [String]
}
```

The encoder must produce the exact contract keys and constants
`format='qiushan.asset-book.ordinary-recovery'` and `version=1`. Implement a
custom `encode(to:)` that emits `prepared: null` when no transition is active;
synthesized optional encoding is forbidden because it omits that key. Encode
with a dedicated `JSONEncoder` configured with `.sortedKeys` and
`.withoutEscapingSlashes`, then use a byte-level fixture to prove the exact
deterministic shape before those bytes are hashed or persisted.

Implement a custom strict `init(from:)` that requires the exact key set with
`container.allKeys`, distinguishes explicit JSON null `prepared` from a
missing key, validates the format/version constants, and requires the exact
nested maintenance key set even when `lastHealthCode` is null. Add byte
fixtures for every missing/extra key, wrong format/version, and noncanonical
maintenance shape; synthesized `Decodable` is forbidden.

Add named tests for the ordinary-only parts of frozen native matrix items 7–13,
17, 21, 25–26, 34–36, and 39–40. Real two-process CAS item 6 moves to Task 9;
cross-domain item 27 and all snapshot/ordinal halves move to Task 7:

```text
testVirginOrdinaryCreatesDirectoryThenDurableEmptyIndexThenBlobsDirectory
testH0H1H2KeepsExactlyH1ThenH0AsDistinctPriorGenerations
testFailureCreatingPreviousBlobPreparedIndexOrCommittedIndexLeavesH0Exact
testCandidateEqualToSourceIsVerifiedNoOpAndDoesNotRotate
testCandidateEqualToSourceFaultsOnBothSidesOfFinalVerificationClassifyCorrectly
testH0H1H0NeverKeepsCurrentH0AsHistory
testPreparedCrashWithOldPrimaryKeepsCommittedSlots
testPreparedCrashWithNewPrimaryPromotesExactlyNextSlots
testRepeatedCrashReconciliationNeverDuplicatesOrDropsALogicalGeneration
testSemanticIndexRelationshipsFailClosedEvenWhenEveryBlobExists
testMissingPreparedOrMaintenanceKeyAndWrongFormatOrVersionFailClosed
testCorruptChangedOrDomainInvalidCandidateCannotOverwriteCurrent
testAfterOrdinaryBlobDurableAuditsDegradedAndRetryOrNoOpConverges
testPromoteAtomicallyRecordsEveryNewlyUnreferencedBlobAsPending
testCleanupFailurePersistsOrdinaryDegradationAndExactPendingCount
testOrdinarySameDomainAuditClearsHealthAfterEveryBlobReverifies
testDuplicateIntersectingOrNoncanonicalOrdinaryPendingMetadataFailsClosed
testNativeLoadDistinguishesAbsentIndexlessEmptyValidatedTempAndApplicableEmptyDomains
testEveryOrdinaryIndexReplacementKeepsPendingAndHealthCodeAtomicAcrossCrash
```

For every injected exception before a new primary is authoritative, assert exact old primary bytes. For every index fixture, reread and hash every referenced blob; an index that is syntactically valid but semantically noncanonical must fail closed.

- [ ] **Step 2: Run the ordinary focused tests and record the RED**

Run:

```bash
swift test --package-path macos-app --filter AssetTrackerRecoveryStoreTests
```

Expected: compilation FAIL because `AssetTrackerRecoveryStore` and the versioned index types do not exist.

- [ ] **Step 3: Implement ordinary audit, prepare, promote, and cleanup**

Virgin initialization order is fixed:

```text
ordinary directory -> durable empty slots index -> blobs directory
```

Only a strictly validated empty-index temp left by that operation may be removed/retried while the index is absent. Any blob, symlink, unknown entry, or illegal temp in an indexless domain is corruption.

Inside the single mutation lock:

```swift
let nextSlots = Array(
    distinct(([sourceHash].compactMap { $0 }) + committed.slots)
        .filter { $0 != candidateHash }
        .prefix(2)
)
```

Before writing a prepared index, prove `prepared.sourceHash == committed.primaryHash`, `prepared.committedSlots == committed.slots`, every source/slot blob exists and matches its name, and `nextSlots` equals the canonical formula. Durably create/verify the old primary blob, durably write the prepared index, replace/verify the primary, then atomically replace the index with promoted committed slots plus every newly unreferenced hash in `pendingCleanup`. Cleanup happens only after that authoritative index commit; failure leaves a truthful durable-degraded index. Ordinary pending cleanup calls only `unlinkOrdinaryPendingAndSync(relativePath:)`; it cannot emit snapshot retention checkpoints.

If candidate bytes equal verified source bytes, perform maintenance
reconciliation without manufacturing a generation, then call the Task 5
`durablyVerifyUnchangedPrimary(sourceProof:)` primitive for the contract's
explicit no-op final verification. No Task 6 code reimplements or weakens that
file/directory durability sequence.

Emit ordinary policy fault events immediately after each corresponding
durable directory/index/blob/primary transition and on both sides of recovery
health clear. The event is inside the mutation-lock lifetime and never replaces
the subsequent reread/identity verification. Roles are exact:
`ordinaryEmptyIndex`, `ordinaryPreparedIndex`, `ordinaryCommittedIndex`, and
`ordinaryHealthIndex` distinguish separate writes to the same `slots.json`;
directory/blob points use `ordinaryDirectory`/`ordinaryBlob`, and the
post-primary policy point uses `primary`.

- [ ] **Step 4: Run focused ordinary and writer tests**

Run:

```bash
swift test --package-path macos-app --filter AssetTrackerRecoveryStoreTests
swift test --package-path macos-app --filter NativeDurableFileWriterTests
```

Expected: PASS; after sufficient history there are at most two verified distinct prior generations, never duplicate filler slots.

- [ ] **Step 5: Review and commit ordinary recovery**

```bash
git add macos-app/Sources/AssetTrackerCore/AssetTrackerRecoveryStore.swift \
  macos-app/Tests/AssetTrackerCoreTests/AssetTrackerRecoveryStoreTests.swift \
  macos-app/Tests/AssetTrackerCoreTests/NativeDurableFileWriterTests.swift
git commit -m "feat: add crash-safe ordinary recovery"
```

### Task 7: Implement Bounded Native Snapshots and Dual-Domain Health

**Files:**

- Modify: `macos-app/Sources/AssetTrackerCore/AssetTrackerRecoveryStore.swift`
- Modify: `macos-app/Tests/AssetTrackerCoreTests/AssetTrackerRecoveryStoreTests.swift`
- Modify: `macos-app/Tests/AssetTrackerCoreTests/NativeDurableFileWriterTests.swift`

- [ ] **Step 1: Write snapshot retention, ordinal, and health RED tests**

The snapshot index is separate from ordinary recovery and persists retained points, monotonic `nextOrdinal`, canonical pending cleanup, and snapshot health in one durable object:

```swift
struct SnapshotRecoveryIndex: Codable, Equatable, Sendable {
    let format: String
    let version: Int
    var retained: [SnapshotPoint]
    var nextOrdinal: UInt64
    var pendingCleanupHashes: [String]
    var lastHealthCode: String?
}

struct SnapshotPoint: Codable, Equatable, Sendable {
    let hash: String
    let ordinal: UInt64
    let createdAt: Date
}
```

Use `format='qiushan.asset-book.snapshot-recovery'`, `version=1`, the same
dedicated sorted-key encoder, an explicit millisecond-since-Unix-epoch date
strategy, and a byte-level fixture. `lastHealthCode` is encoded explicitly as
JSON null when healthy so pending/code atomicity is visible in every durable
index version.

Use a custom strict decoder that requires the exact key set at every level,
validates the format/version constants, requires explicit JSON null for a
healthy `lastHealthCode`, uses the same explicit date strategy, and rejects
missing/extra/unknown-version/noncanonical retained or pending metadata before
any cleanup or snapshot action.

Add named tests for frozen native matrix items 18–20, 22–24, 26–28, 32, and 37–41:

```text
testSnapshotRejectsCorruptUnsupportedOrChangedPrimaryWithoutArtifact
testSnapshotSuccessCannotClearOrdinaryDegradationAndOrdinarySuccessCannotClearSnapshotDegradation
testRetainedSameHashDeduplicatesWithoutChangingOrdinalOrCreatedAt
testPendingOrOrphanSameHashCreatesOneFreshLogicalPointAndOrdinal
testOrdinalUniquenessRangeAndOverflowFailBeforeBlobCreation
testTwentyFifthSnapshotCommitsAtMostTwentyFourAndPreservesNewestThree
testClockRollbackAndEqualTimestampsCannotEvictTheNewestOrdinal
testEveryRetainedBlobIsReverifiedBeforeIndexCommit
testSnapshotIndexAtomicallyCarriesPendingAndLastHealthCode
testAfterSnapshotBlobDurableOrphanAuditsDegradedAndIsRescuedOrCleaned
testCleanupFailureReturnsDurableDegradedOnlyAfterPendingHealthReverify
testMaintenanceClearUncertaintyIsUnknownRatherThanFalseHealthy
testFinalNamespaceSentinelSurvivesEveryAuditAndRetentionPass
testSnapshotDirectorySwapAfterIndexCommitReturnsNoReceipt
testVirginSnapshotDirectoryAndEmptyIndexTempSurviveEveryInitFault
testMissingSnapshotIndexKeyAndWrongFormatOrVersionFailClosed
```

- [ ] **Step 2: Run the snapshot focused tests and record the RED**

Run:

```bash
swift test --package-path macos-app --filter AssetTrackerRecoveryStoreTests
```

Expected: FAIL because snapshot index, ordinal, deduplication, and retention are not implemented.

- [ ] **Step 3: Implement snapshot create/deduplicate/retain semantics**

Virgin order is `snapshot directory -> durable empty index -> content-addressed blob`. A retained hash is the only deduplication case. A matching pending/orphan blob may be reused physically, but it becomes one new logical point with the next persistent ordinal and current display time; remove it from pending in the same index commit before cleanup.

Retention sorts by persistent ordinal, not wall time. Build the final index with at most 24 retained points and the full canonical pending set in one durable replace. Never select the newest three ordinals for eviction. Before the final index commit, reverify the current primary and every blob remaining retained. Every evicted snapshot pending blob uses `unlinkSnapshotPendingAndSync(relativePath:)`, so the writer—not an outer policy callback—places the three retention checkpoints around the real `unlinkat` and directory sync. Task 3 scanners never enter the final-freeze namespace.

Return created/deduplicated success with native durability after final index
sync/reread/hash. A pure retained dedup with unchanged index must call
`durablyVerifyUnchangedPrimary(sourceProof:)` and
`durablySyncManagedDirectory(relativePath:role:)` with `snapshotFinalIndex`
after the full blob/index audit;
it may not infer durability from read-only validation. A cleanup failure after
an authoritative index commit is successful-but-degraded only after persisted
pending health is reread and verified. Any uncertainty about the authoritative
index, identity, or health-clear commit returns unknown and no receipt.

Emit snapshot policy and health fault events at their exact contract
boundaries with snapshot roles and target names; the Task 5 specialized
snapshot unlink primitive alone emits the three retention-unlink events
around its real syscalls. Focused tests install a recording handler and fail
if any snapshot point is unreachable before Task 9 adds process death. Roles are exact: `snapshotEmptyIndex`,
`snapshotFinalIndex`, and `snapshotHealthIndex` distinguish virgin, final
retained/pending, and maintenance-clear writes to the same `index.json`;
directory/blob points use `snapshotDirectory`/`snapshotBlob`.

- [ ] **Step 4: Run ordinary, snapshot, and writer GREEN tests**

Run:

```bash
swift test --package-path macos-app --filter AssetTrackerRecoveryStoreTests
swift test --package-path macos-app --filter NativeDurableFileWriterTests
```

Expected: PASS; retained count never exceeds 24, newest three ordinals remain, and domain health clears only after an authoritative same-domain audit.

- [ ] **Step 5: Review and commit snapshot recovery**

```bash
git add macos-app/Sources/AssetTrackerCore/AssetTrackerRecoveryStore.swift \
  macos-app/Tests/AssetTrackerCoreTests/AssetTrackerRecoveryStoreTests.swift \
  macos-app/Tests/AssetTrackerCoreTests/NativeDurableFileWriterTests.swift
git commit -m "feat: add durable native recovery points"
```

### Task 8: Integrate Durable Requests, Coordinator Ordering, and Bridge DTOs

**Files:**

- Modify: `macos-app/Sources/AssetTrackerCore/AssetTrackerBookStore.swift`
- Modify: `macos-app/Sources/AssetTrackerCore/AssetTrackerStorageCoordinator.swift`
- Modify: `macos-app/Sources/AssetTrackerCore/AssetTrackerBridgeResponse.swift`
- Modify: `macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift`
- Modify: `macos-app/Tests/AssetTrackerCoreTests/AssetTrackerBookStoreTests.swift`

- [ ] **Step 1: Write request, receipt, load-health, and ordering RED tests**

Define and test the exact Core requests/receipts from the frozen contract:

```swift
public enum NativeDurability: String, Codable, Sendable {
    case nativeDurable
}

public enum NativeSnapshotReason: String, Codable, Sendable {
    case manual
    case scheduled
}

public struct DurableBookSaveRequest: Equatable, Sendable {
    public let clientSaveID: String
    public let expectedSource: ExpectedBookSource
    public let payloadHash: String
    public let stateJSON: String
    public let schemaVersion: Int
    public let reason: String
    public let authorization: AssetTrackerSaveAuthorization

    public init(
        clientSaveID: String,
        expectedSource: ExpectedBookSource,
        payloadHash: String,
        stateJSON: String,
        schemaVersion: Int,
        reason: String,
        authorization: AssetTrackerSaveAuthorization
    ) {
        self.clientSaveID = clientSaveID
        self.expectedSource = expectedSource
        self.payloadHash = payloadHash
        self.stateJSON = stateJSON
        self.schemaVersion = schemaVersion
        self.reason = reason
        self.authorization = authorization
    }
}

public struct NativeDurableSaveReceipt: Equatable, Sendable {
    public let clientSaveID: String
    public let sourceHashBefore: String?
    public let payloadHash: String
    public let stateHashAfter: String
    public let byteCount: Int
    public let durability: NativeDurability
    public let previousSlotHashes: [String]
    public let recoveryHealth: NativeRecoveryHealth
    public let updatedAt: Date
    public let storagePath: String
}

public struct NativeSnapshotRequest: Equatable, Sendable {
    public let clientSnapshotID: String
    public let reason: NativeSnapshotReason
    public let expectedHash: String
    public let authorization: AssetTrackerSaveAuthorization

    public init(
        clientSnapshotID: String,
        reason: NativeSnapshotReason,
        expectedHash: String,
        authorization: AssetTrackerSaveAuthorization
    ) {
        self.clientSnapshotID = clientSnapshotID
        self.reason = reason
        self.expectedHash = expectedHash
        self.authorization = authorization
    }
}

public struct NativeSnapshotReceipt: Equatable, Sendable {
    public let clientSnapshotID: String
    public let sourceHash: String
    public let snapshotHash: String
    public let ordinal: UInt64
    public let snapshotStatus: NativeSnapshotStatus
    public let durability: NativeDurability
    public let retainedCount: Int
    public let recoveryHealth: NativeRecoveryHealth
}

public enum NativeSnapshotStatus: String, Codable, Sendable {
    case created
    case deduplicated
}
```

Add named tests for frozen native matrix items 29–32 and 42–44, plus the
native prerequisites of cross-layer JavaScript items 55–57. Task 10 owns the
complete cross-layer result:

```text
testCoordinatorPreflightFailurePerformsZeroStoreIO
testStoreRehashesPayloadAndPerformsExpectedSourceCASInsideMutationLock
testGateAdvancesAfterDurableReceiptAndBeforeBridgeResponseEnqueue
testSnapshotAndSaveUseOneCoordinatorSingleFlight
testTerminalizationDuringDurableSaveWaitsForRealCompletionThenLocksGate
testTerminalizationReceiptCarriesFirstStableReasonOnlyAfterTerminalLock
testLoadReturnsBothAuditedHealthDomainsOrMarksRecoveryHealthIncomplete
testBridgeRoundTripsStructuredNotCommittedUnknownConflictAndPersistedHealth
testBridgeRoundTripsUpdatedAtAndCanonicalStoragePathWithoutDefaulting
```

Use a completion sink that inspects gate state inside bridge-response enqueue. Use a fake store to prove invalid authorization, client ID, payload hash, source hash, snapshot reason, or malformed health produces zero mutation calls. `AssetTrackerCoreTests` imports only `AssetTrackerCore`; HostBridge route coverage remains the primary-owned Node static test in Task 10, while `swift build` proves the Mac target can call both explicit public request initializers.

The public `AssetTrackerBookStore` and `AssetTrackerStorageCoordinator`
initializers each accept the same optional `NativeDurabilityFaultHandler`,
defaulting to a no-op. They pass that handler into all internal writer/recovery
objects and coordinator checkpoints. The Mac app always uses the default; the
Core-only fault harness supplies one selector closure. No fault API is exposed
through WKWebView.

- [ ] **Step 2: Run the integration tests and record the RED**

Run:

```bash
swift test --package-path macos-app --filter AssetTrackerBookStoreTests
```

Expected: FAIL because the current save result is not the frozen durable receipt, `storage.snapshot` is absent, and load/bridge health is incomplete.

- [ ] **Step 3: Replace the old save path with lock-in durable store operations**

The coordinator performs protocol/session preflight on the main actor, then schedules exactly one store operation on the existing serial raw-I/O executor. The store recomputes `payloadHash`, takes the shared mutation lock, reopens/revalidates the current primary inside that lock, compares `.missing` or the exact expected SHA, triggers the shared `afterSourceCAS` hook, and runs ordinary recovery and primary durability with the resulting `NativeSourceProof`. `AssetTrackerRecoveryStore` triggers `afterPrimaryDurableBeforeACK` immediately after the verified primary replacement and before its committed-index promotion. Only after recovery promotion and the final receipt return does the coordinator call `recordSuccessfulSave(stateHashAfter)`, trigger `beforeACK`, and enqueue the typed bridge response, in that order.

Add `startSnapshot(request:completion:)` to the same coordinator single-flight state. A snapshot never advances the write gate's primary hash. A pending terminalization waits behind save/snapshot real completion and ACKs only after the bound gate is terminal-locked.

- [ ] **Step 4: Implement lossless bridge response mapping**

Map every native enum/field explicitly:

```text
nativeDurable -> native-durable
notApplicable -> not-applicable
manual/scheduled -> manual/scheduled
updatedAt -> verified envelope timestamp ISO-8601
storagePath -> verified canonical primary path
```

`storage.load` includes `recoveryHealthComplete` and both complete domain objects or includes `false` with both null. The bridge must not synthesize healthy/not-applicable, regenerate time/path, or collapse structured error proof fields. All responses continue through the existing off-main response encoder pipeline and main-actor WK delivery.

- [ ] **Step 5: Run focused integration and strict builds**

Run:

```bash
swift test --package-path macos-app --filter AssetTrackerBookStoreTests
swift build --package-path macos-app
swift test --package-path macos-app -Xswiftc -strict-concurrency=complete -Xswiftc -warnings-as-errors
```

Expected: PASS; no old `Data.write(..., .atomic)` primary-save path remains reachable from the bridge.

- [ ] **Step 6: Review and commit the native integration**

```bash
git add macos-app/Sources/AssetTrackerCore/AssetTrackerBookStore.swift \
  macos-app/Sources/AssetTrackerCore/AssetTrackerStorageCoordinator.swift \
  macos-app/Sources/AssetTrackerCore/AssetTrackerBridgeResponse.swift \
  macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift \
  macos-app/Tests/AssetTrackerCoreTests/AssetTrackerBookStoreTests.swift
git commit -m "feat: bridge native durable save receipts"
```

### Task 9: Prove Crash Recovery with a Real Fault Harness

**Files:**

- Modify: `macos-app/Package.swift`
- Create: `macos-app/Sources/AssetTrackerFaultHarness/main.swift`
- Create: `macos-app/Tests/AssetTrackerCoreTests/ProcessKillRecoveryTests.swift`

- [ ] **Step 1: Add the harness product and write process RED tests**

Add this product/target shape to `Package.swift`:

```swift
.executable(name: "AssetTrackerFaultHarness", targets: ["AssetTrackerFaultHarness"])

.executableTarget(
    name: "AssetTrackerFaultHarness",
    dependencies: ["AssetTrackerCore"],
    path: "Sources/AssetTrackerFaultHarness"
)
```

The executable accepts exactly three harness-only modes. `mutate` accepts either no fault
selector for a normal completion/race run, or one complete point-and-role pair
for a pause/kill-or-resume run. It also accepts an independent
`--rendezvous-after-confirm` test flag. Supplying only half the fault pair is a
usage error:

```text
AssetTrackerFaultHarness mutate --root PATH --request FILE \
  [--fault-point NAME --fault-role ROLE] [--rendezvous-after-confirm]
AssetTrackerFaultHarness verify --root PATH
AssetTrackerFaultHarness swap --root PATH --component root|lock|ordinary|snapshot
```

When present, `--fault-point` also requires `--fault-role`; the pair selects one exact
`NativeDurabilityFaultEvent` so an index temp cannot be mistaken for the
primary temp at the same writer checkpoint. A selected event or confirmation
rendezvous emits its marker, flushes stdout, and blocks on stdin until it reads
the exact line `GO`; EOF or any other line is a harness error. Kill tests send
`SIGKILL` while blocked. Identity-race tests make the external change and then
write `GO`. The two-child H0 CAS race omits the fault selector, enables the
confirmation rendezvous, waits until both children report the same H0, then
writes `GO` to both so both enter the real store path from the same confirmed
source.

At the selected point it writes one newline-delimited JSON marker before the
pause gate:

```json
{"event":"fault-point","point":"afterRename","role":"primary","targetName":"AssetTrackerBook.json"}
```

On normal completion it emits one receipt marker only after the durable receipt exists:

```json
{"event":"receipt","clientSaveId":"save-1","stateHashAfter":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","durability":"native-durable"}
```

The rendezvous and structured loser/error markers are exact, newline-delimited
JSON as well:

```json
{"event":"ready-after-confirm","operation":"save","clientSaveId":"save-1","sourceHash":"0000000000000000000000000000000000000000000000000000000000000000"}
{"event":"error","operation":"save","error":{"code":"source-conflict","message":"source changed","writeOutcome":"not-committed","conflict":"source-changed","clientSaveId":"save-2","payloadHash":"2222222222222222222222222222222222222222222222222222222222222222","sourceHashAfter":"1111111111111111111111111111111111111111111111111111111111111111","sourceReverified":true,"coordinatorReleased":true,"healthPersisted":false,"recoveryHealthEvidence":null}}
{"event":"error","operation":"snapshot","error":{"code":"snapshot-source-conflict","message":"source changed","snapshotOutcome":"unknown","conflict":"source-changed","clientSnapshotId":"snapshot-2","sourceHashAfter":"1111111111111111111111111111111111111111111111111111111111111111","sourceReverified":true,"coordinatorReleased":true,"healthPersisted":false,"recoveryHealthEvidence":null}}
```

The save and snapshot marker unions preserve their different frozen field
names and proof shapes exactly; they never use Boolean conflict or a generic
operation ID. The test parser rejects missing/extra/wrongly typed fields. A
resumed post-commit identity mismatch uses the operation's exact unknown
outcome, never a receipt or invented rollback proof.

`verify` opens the directory in a separate process and emits canonical primary hash, ordinary/snapshot health, slots, retained hashes/ordinals, and final-namespace sentinel presence. `swap` is an intentionally noncooperating adversary used only against an XCTest-owned temporary root: it records the canonical component's old and new device/inode/link identities, replaces that component without acquiring the book lock, and emits one strict completion marker. It never runs in the Mac app and is not a storage/recovery API.

```json
{"event":"swap-complete","component":"snapshot","oldDevice":1,"oldInode":2,"newDevice":1,"newInode":3,"oldLinkCount":1,"newLinkCount":1}
```

The request file is one strict versioned JSON envelope with an exact key set:

```json
{
  "version": 1,
  "operation": "save",
  "clientSaveId": "save-1",
  "expectedHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "stateJson": "{\"memo\":\"H1\"}",
  "reason": "manual"
}
```

`operation` is exactly `save` or `snapshot`. A save envelope requires exactly
`clientSaveId`, primitive `stateJson`, and an arbitrary nonempty reason; a
snapshot envelope replaces that key with `clientSnapshotId`, requires null
`stateJson`, and accepts only reason `manual` or `scheduled`. A generic
`clientOperationId` is forbidden. `expectedHash` is null only for the
confirmed-missing baseline. The child performs the real Core load and
gate confirmation for that source, recomputes payload hashes inside the store,
then submits the public durable request. Missing/extra/wrongly typed envelope
fields fail before any mutation. The parent test prepares every table-row
prestate before launching the child; the child never manufactures H0 or a
recovery index from the request.

Create `ProcessKillRecoveryTests.swift` for frozen crash matrix 1–9. The test validates the harness path from `ASSET_TRACKER_FAULT_HARNESS`, launches the exact operation/prestate/point/role row below, waits at most five seconds for the exact marker, sends `SIGKILL`, waits for termination, and launches a separate verifier child against the same root. If the marker deadline expires, capture stdout/stderr, force-kill the child, and fail with `UNREACHED_FAULT_POINT`; no test may wait indefinitely.

Use this executable ownership and expectation table; every frozen point appears at least once in the table-driven reachability assertion, while additional rows exercise domain-specific roles where required. In the seven rows labelled `afterTempCreate through afterHashVerified`, “through” is an exact Cartesian expansion over:

```text
afterTempCreate, afterExactWrite, afterFileFSync, afterFullFSync,
beforeRename, afterRename, afterParentDirectoryFSync,
afterFinalReread, afterHashVerified
```

`ProcessKillRecoveryTests` creates one process fixture for every listed
point×role pair; a single representative point is not sufficient.

| Checkpoint(s) | Owner | Fault role | Operation fixture and prestate | Expected fresh-verifier result after kill |
|---|---|---|---|---|
| `afterLockAcquired` | writer/lock | `lock` | save H0→H1, valid ordinary H0 | primary H0; lock reacquirable |
| `afterSourceCAS` | book store | `bookStore` | save H0→H1 after strict validator attestation | primary H0; no gate/receipt claim |
| `afterTempCreate`, `afterExactWrite`, `afterFileFSync`, `afterFullFSync`, `beforeRename` | writer | `primary` | ordinary initialized; save H0→H1 | exact H0; temp never a recovery point |
| `afterSourceRevalidation` | writer | `primary` | save H0→H1 with proof H0 | exact H0 unless a separate adversarial writer changed it; HX is never overwritten |
| `afterRename`, `afterParentDirectoryFSync`, `afterFinalReread`, `afterHashVerified` | writer | `primary` | save H0→H1 with prepared index | exact complete H0 or H1; fresh reconciliation preserves generations; never partial |
| `afterTempCreate` through `afterHashVerified` | writer | `ordinaryEmptyIndex` | virgin ordinary save at each writer boundary | pre-rename: absent/indexless legal temp only; post-rename: complete valid empty index; never partial/applicable-false |
| `afterTempCreate` through `afterHashVerified` | writer | `ordinaryPreparedIndex` | H0→H1 prepared-index replacement | pre-rename old committed index; post-rename complete prepared index; fresh recovery preserves committed slots |
| `afterTempCreate` through `afterHashVerified` | writer | `ordinaryCommittedIndex` | primary already H1, committed-index promotion | pre-rename prepared index; post-rename complete committed H1/slots; fresh recovery never drops a generation |
| `afterTempCreate` through `afterHashVerified` | writer | `snapshotEmptyIndex` | first snapshot against valid H1 at each writer boundary | pre-rename: absent/indexless legal temp only; post-rename: complete valid empty index; primary H1 unchanged |
| `afterTempCreate` through `afterHashVerified` | writer | `snapshotFinalIndex` | create snapshot point with non-virgin index | pre-commit old complete index or post-commit new complete index; post-commit uncertainty has no receipt |
| `afterTempCreate` through `afterHashVerified` | writer | `ordinaryHealthIndex` | clear persisted ordinary pending cleanup | never false healthy; old degraded or fully verified clear/unknown |
| `afterTempCreate` through `afterHashVerified` | writer | `snapshotHealthIndex` | clear persisted snapshot pending cleanup | never false healthy; old degraded or fully verified clear/unknown |
| `afterOrdinaryDirectoryDurable` | recovery store | `ordinaryDirectory` | virgin missing primary | absent primary; ordinary is absent or allowed indexless-empty |
| `afterEmptyOrdinaryIndexDurable` | recovery store | `ordinaryEmptyIndex` | virgin missing primary | applicable empty ordinary index; missing blobs directory is allowed |
| `afterOrdinaryBlobsDirectoryDurable` | recovery store | `ordinaryDirectory` | virgin missing primary | applicable empty ordinary domain |
| `afterOrdinaryBlobDurable` | recovery store | `ordinaryBlob` | primary H0, first distinct H1 save | H0 remains; fresh audit is degraded for managed orphan |
| `afterPreparedOrdinaryIndexDurable` | recovery store | `ordinaryPreparedIndex` | H0→H1 with prior slots | H0 plus committed old slots; prepared reconciles without loss |
| `afterPrimaryDurableBeforeACK` | recovery store | `primary` | H0→H1 | complete H1 with prepared reconciliation; no ACK marker |
| `afterCommittedOrdinaryIndexDurable` | recovery store | `ordinaryCommittedIndex` | H0→H1 | complete H1 and canonical prior slots/pending health |
| `afterSnapshotDirectoryDurable` | recovery store | `snapshotDirectory` | valid H1, virgin snapshot domain | primary H1; snapshot absent or allowed indexless-empty |
| `afterEmptySnapshotIndexDurable` | recovery store | `snapshotEmptyIndex` | valid H1, virgin snapshot domain | primary H1; applicable empty snapshot index |
| `afterSnapshotBlobDurable` | recovery store | `snapshotBlob` | valid H1, create first point | primary H1; point unretained and audit degraded/orphan-safe |
| `afterSnapshotIndexDurable` | recovery store | `snapshotFinalIndex` | valid H1, create point | retained point/index is complete; primary unchanged |
| `beforeRetentionUnlink`, `afterRetentionUnlink`, `afterRetentionDirectoryFSync` | recovery store | `snapshotFinalIndex` | 25th point with canonical 24 retained | retained set ≤24 after reconciliation; newest three preserved; pending truthful |
| `beforeRecoveryHealthClear`, `afterRecoveryHealthClear` | recovery store | `ordinaryHealthIndex` and `snapshotHealthIndex` | persisted same-domain pending cleanup in separate table rows | no false healthy state; outcome is prior degraded or verified clear/unknown |
| `beforeACK` | coordinator | `coordinator` | full H0→H1 save through coordinator, after gate advance | native gate is H1 and primary H1; no bridge/receipt marker |
| `afterDurableReceiptReturned` | harness wrapper | `harness` | store/coordinator returned real H1 durable receipt | exact H1/hash and lock released; marker is Core receipt proof, not Web delivery |

The same harness includes a two-child race from H0: both present the same
expected hash and distinct payloads. Both must first emit
`ready-after-confirm` with exact H0 before either receives `GO`; after both are
released, exactly one returns a durable receipt, the loser emits the strict
source-conflict/not-committed marker above, and the verifier sees the winner's
complete bytes. A test that lets either child observe H1 during load/confirm is
invalid and cannot close native matrix item 6. This proves cross-process
lock-in CAS rather than merely same-process lock serialization.

Add a second table-driven resume matrix for canonical identity races. These
tests do not kill the paused child: a separate helper process swaps the named
same-UID inode, the parent writes `GO`, and the original child must emit a
structured error and exit without any receipt:

| Pause point/role | External swap after marker | Required resumed result |
|---|---|---|
| `afterLockAcquired` / `lock` | `swap --component root`, then `lock` in separate runs | pre-commit not-committed only with exact source proof; no mutation/receipt |
| `afterTempCreate` / `ordinaryPreparedIndex` | `swap --component ordinary` | pre-commit failure; primary exact H0; no receipt |
| `afterRename` / `snapshotFinalIndex` | `swap --component root`, `lock`, then `snapshot` in separate runs | authoritative snapshot outcome unknown; primary unchanged; no receipt |

Each swap helper proves the pathname now resolves to a different live inode
before sending `GO`. The test waits at most five seconds for an exact error or
receipt marker; timeout and receipt both fail. This is distinct from the
SIGKILL matrix and proves the final identity rechecks actually reject an
operation that resumes after the adversarial change.

Exact process-test names include:

```text
testEveryDeclaredPointRoleScenarioReachesItsExactMarkerBeforeDeadline
testVirginOrdinaryAndSnapshotIndexKillsCoverEveryWriterBoundary
testOrdinaryPreparedAndCommittedIndexKillsCoverEveryWriterBoundary
testSnapshotFinalAndBothHealthClearIndexesCoverEveryWriterBoundary
testTwoConfirmedH0ChildrenRaceOnlyInsideTheMutationLock
testHarnessRejectsMalformedRequestReceiptErrorAndRendezvousMarkers
testResumedRootLockOrdinaryAndSnapshotIdentitySwapsNeverReturnReceipt
testFreshVerifierRunsOnlyPermittedPreparedAndVirginReconciliation
```

- [ ] **Step 2: Build and run the crash suite to record the RED**

Run:

```bash
swift build --package-path macos-app --product AssetTrackerFaultHarness
ASSET_TRACKER_FAULT_HARNESS="$(swift build --package-path macos-app --show-bin-path)/AssetTrackerFaultHarness" \
  swift test --package-path macos-app --filter ProcessKillRecoveryTests
```

Expected: FAIL because the executable protocol and real pause/kill/reopen paths are not implemented.

- [ ] **Step 3: Connect the already-owned hooks without weakening production ordering**

Tasks 5–8 already call one shared throwing hook at their owned points:
writer/lock lifecycle points and the three in-syscall snapshot-retention points
in `NativeDurableFileWriter`; remaining policy/health points including
`afterPrimaryDurableBeforeACK` in `AssetTrackerRecoveryStore`;
`afterSourceCAS` in `AssetTrackerBookStore`; and `beforeACK` in
`AssetTrackerStorageCoordinator` after gate advancement. The harness supplies
the selector and emits/pauses only when both point and role match. Immediately
after the real store/coordinator returns its durable receipt, the harness
wrapper triggers `afterDurableReceiptReturned`; this point is not emitted by
the writer. Production's default hook is a no-op.

Do not insert a separate “test ACK” into the writer. Receipt output belongs only to the harness after the real store/coordinator returns its durable receipt.

The verifier first records a read-only pre-reopen observation, then invokes the
production startup reconciliation path in that fresh process and records the
post-reopen result. It may perform only the deterministic prepared-index and
allowed virgin-state reconciliation defined by the frozen contract; it must
never create a new book/snapshot, guess an index, delete an unknown entry, or
turn an orphan into a recovery point. The process test keeps both observations
and fails if reconciliation mutates anything outside that permitted set.

- [ ] **Step 4: Run the full exception and SIGKILL matrix**

Run:

```bash
swift test --package-path macos-app --filter NativeDurableFileWriterTests
swift test --package-path macos-app --filter AssetTrackerRecoveryStoreTests
swift build --package-path macos-app --product AssetTrackerFaultHarness
test -x "$(swift build --package-path macos-app --show-bin-path)/AssetTrackerFaultHarness"
ASSET_TRACKER_FAULT_HARNESS="$(swift build --package-path macos-app --show-bin-path)/AssetTrackerFaultHarness" \
  swift test --package-path macos-app --filter ProcessKillRecoveryTests
```

Expected: PASS. Pre-authoritative kills reopen to exact old state or a contract-defined virgin/degraded intermediate; post-authoritative kills reopen to a complete new state or truthful unknown/degraded state, never partial bytes or a false receipt. The killed process releases `flock`; final namespace sentinels and unknown files remain untouched.

- [ ] **Step 5: Review and commit the crash harness**

```bash
git add macos-app/Package.swift \
  macos-app/Sources/AssetTrackerFaultHarness/main.swift \
  macos-app/Tests/AssetTrackerCoreTests/ProcessKillRecoveryTests.swift
git commit -m "test: prove native save crash recovery"
```

### Task 10: Reconcile Both Lanes and Run the Task 3 Completion Gate

**Files:**

- Modify: `tests/macos-scaffold.test.js`
- Modify only as required by failing cross-layer tests: all Task 3 files listed above
- Do not modify: `macos-app/Resources/Web/*`

- [ ] **Step 1: Write the cross-layer bridge-routing acceptance tests**

In the primary-owned `tests/macos-scaffold.test.js`, add exact named tests:

```text
macOS bridge routes storage.snapshot through the shared coordinator
macOS bridge maps save snapshot health and terminal DTOs without defaults
macOS bridge preserves updatedAt and canonical storagePath as metadata only
snapshot classification uses operation-specific index commit points rather than primary rename
cross-layer item 55 binds terminal ACK delivery to the already-locked gate
cross-layer item 56 binds dual audited native load health to strict JS confirmation
cross-layer item 57 binds Core receipt metadata through Bridge to JS without defaults
```

The static assertions require `storage.snapshot -> storageCoordinator.startSnapshot`, reject a `final` snapshot case, require typed response constructors for complete dual health and exact terminalization, and reject any generic snapshot error branch keyed to `primaryRenamed`/`afterPrimaryRename`. For items 55–57, Task 10 records the conjunction of the named Task 4 JS adapter test, named Task 8 Core ordering/mapping test, and this real route assertion; no single-lane mock is accepted as the complete item.

- [ ] **Step 2: Run the cross-layer acceptance test and reconcile only if needed**

Run before any reconciliation:

```bash
node --test --test-name-pattern='storage.snapshot|maps save snapshot health|updatedAt|operation-specific index|cross-layer item' tests/macos-scaffold.test.js
```

Expected: PASS is allowed when Tasks 4 and 8 already chose the same route and
DTO names; record that no reconciliation was required. If an assertion fails,
first prove the mismatch against both completed lane contracts, then modify
only the mismatched cross-layer route or DTO mapping and rerun to PASS. Task 10
is an acceptance/reconciliation gate, not a production feature slice, so it is
explicitly exempt from the “new test must first be RED” worker rule; it may
never manufacture a failure or reopen queue/durability semantics.

- [ ] **Step 3: Run exact contract and source-boundary checks**

Run:

```bash
test "$(shasum -a 256 docs/superpowers/specs/2026-08-10-phase1-task3-durable-save-contract.md | awk '{print $1}')" \
  = "4585996f8732bc5f3a2f119a90474610c0866817573dcd07dd4539ed4c422728"
git diff -- macos-app/Resources/Web
rg -n "Data\.write\([^\n]*\.atomic|assetTrackerBackup" \
  macos-app/Sources script.js tests/save-queue.test.js
```

Expected: exact hash match; no generated-resource diff; any remaining `assetTrackerBackup*` occurrence is covered by the explicit Phase 1 Task 4 debt test, and no bridge-reachable primary save uses Foundation atomic write.

- [ ] **Step 4: Run the complete JavaScript verification gate**

Run:

```bash
node --check legacy-safety.js
node --check script.js
node --test tests/save-queue.test.js
node --test tests/data-recovery.test.js tests/web-storage.test.js tests/macos-scaffold.test.js
node --test tests/*.test.js
```

Expected: zero failures; only the already-approved staged-assets release-only skip may remain in the normal suite.

- [ ] **Step 5: Run the complete native verification gate**

Run:

```bash
swift build --package-path macos-app --product AssetTrackerFaultHarness
swift test --package-path macos-app --filter NativeDurableFileWriterTests
ASSET_TRACKER_FAULT_HARNESS="$(swift build --package-path macos-app --show-bin-path)/AssetTrackerFaultHarness" \
  swift test --package-path macos-app --filter ProcessKillRecoveryTests
swift test --package-path macos-app
swift build --package-path macos-app
swift test --package-path macos-app -Xswiftc -strict-concurrency=complete -Xswiftc -warnings-as-errors
```

Expected: all builds and tests PASS. Record executed test counts and scratch/harness path in the task evidence.

- [ ] **Step 6: Commit and lock one complete candidate tree**

Run:

```bash
git diff --check
git status --short
git diff -- macos-app/Resources/Web
git add legacy-safety.js script.js \
  tests/save-queue.test.js tests/data-recovery.test.js \
  tests/web-storage.test.js tests/macos-scaffold.test.js \
  macos-app/Package.swift \
  macos-app/Sources/AssetTrackerCore/NativeDurableFileWriter.swift \
  macos-app/Sources/AssetTrackerCore/AssetTrackerRecoveryStore.swift \
  macos-app/Sources/AssetTrackerCore/AssetTrackerBookStore.swift \
  macos-app/Sources/AssetTrackerCore/AssetTrackerStorageCoordinator.swift \
  macos-app/Sources/AssetTrackerCore/AssetTrackerBridgeResponse.swift \
  macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift \
  macos-app/Sources/AssetTrackerFaultHarness/main.swift \
  macos-app/Tests/AssetTrackerCoreTests/NativeDurableFileWriterTests.swift \
  macos-app/Tests/AssetTrackerCoreTests/AssetTrackerRecoveryStoreTests.swift \
  macos-app/Tests/AssetTrackerCoreTests/AssetTrackerBookStoreTests.swift \
  macos-app/Tests/AssetTrackerCoreTests/ProcessKillRecoveryTests.swift
git diff --cached --check
git commit -m "fix: reconcile durable save layers"
TASK3_CANDIDATE_COMMIT="$(git rev-parse HEAD)"
TASK3_CANDIDATE_TREE="$(git rev-parse HEAD^{tree})"
```

Expected: the working tree is clean, generated Web resources are absent from the commit, and the two identifiers name the exact complete Task 3 candidate. Earlier slice commits and the Task 0 documentation commit remain in history; the reviewed range is production base `011921ddfa32cf3166e3b134b57f96a15793d22f..$TASK3_CANDIDATE_COMMIT`.

- [ ] **Step 7: Run adversarial review against the locked base-to-candidate range**

Dispatch three independent reviewers. Give each the same production base commit, candidate commit, candidate tree, frozen contract SHA, and this implementation-plan SHA. Each reviewer inspects the full committed range and verifies `git rev-parse HEAD^{tree}` equals the candidate tree before testing:

1. JavaScript queue reviewer: frozen matrix 1–57, callback fence, generation, rollback/unknown UI, adapter proofs.
2. Native durability reviewer: frozen native matrix 1–44 plus crash matrix 1–9, POSIX order, identity, recovery indexes.
3. Cross-layer reviewer: DTO losslessness, gate/receipt ordering, snapshot/save/terminalization single-flight, Task 4/7 scope boundaries.

Each reviewer returns `APPROVE` or a reproducible `REJECT` with command, fixture, and file/line evidence bound to the candidate tree. A rejection is fixed with a new focused RED before production changes, then committed; Steps 3–7 restart from the new candidate. All three prior verdicts are discarded after any tree change. Approval requires three verdicts naming the same candidate tree.

- [ ] **Step 8: Verify the approved candidate remains byte-identical and clean**

Run:

```bash
git diff --check
git status --short
git diff -- macos-app/Resources/Web
test "$(git rev-parse HEAD^{tree})" = "$TASK3_CANDIDATE_TREE"
```

Expected: clean worktree, no generated-resource diff, and the approved tree still matches exactly. There is no post-review commit or amend. Task 11 later owns `macos-app/Resources/Web` generation.

## Completion Evidence Template

The Task 3 handoff records:

```text
contract SHA-256:
implementation commit:
Node focused/full commands and counts:
Swift focused/full/strict commands and counts:
fault harness executable path:
SIGKILL fault points executed:
generated Web resources diff:
independent reviewer verdicts:
known Phase 1 Task 4 debt (18 callers and backup routing):
known Phase 1 Task 7 debt (final freeze):
files changed:
limitations:
```

Task 3 is complete only when the frozen contract verification gate and all three independent reviews pass on the same implementation bytes.
