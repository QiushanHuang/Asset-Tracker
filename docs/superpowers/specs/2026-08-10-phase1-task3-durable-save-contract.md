# Phase 1 Task 3 Durable Save Contract

**Status:** Frozen for implementation  
**Execution baseline:** `011921ddfa32cf3166e3b134b57f96a15793d22f`  
**Parent product contract:** `2026-08-10-trustworthy-asset-product-v2-design.md` at SHA-256 `095a60b09e4657f40be0ff6fcbfd282516b26860d9a2d3f184c01e2992561b7d`  
**Scope owner:** Phase 1 Task 3  
**Platforms:** browser localStorage and macOS WKWebView host

## 1. Outcome

Task 3 replaces fire-and-forget persistence with a single acknowledged timeline and makes the macOS `native-durable` claim true.

When this task is complete:

1. Every call to `saveData()` freezes an exact JSON snapshot at enqueue time.
2. Saves execute FIFO with at most one active storage operation.
3. The next save's expected source hash advances only after a receipt for the preceding exact item is verified.
4. Browser success means only “committed to this browser's local storage”.
5. macOS success means the exact new primary bytes survived file synchronization, full device synchronization, atomic rename, parent-directory synchronization, reread, and SHA-256 verification.
6. A known pre-commit failure and an outcome whose durability is unknown are never presented as the same condition.
7. Ordinary native saves preserve up to two verified prior generations before replacing the primary.
8. Native manual/scheduled snapshots are content-addressed, bounded, independently verified, and serialized with saves.
9. Injected exceptions and real `SIGKILL` at every commit boundary prove old-or-complete-new recovery and truthful ACK ordering.

Task 3 is an internal safety milestone, not a release boundary. Task 4 must immediately migrate every business mutation and remove legacy auto-backup behavior before the branch may be treated as product-ready.

## 2. Non-goals and ownership boundaries

### Task 3 owns

- `AssetTrackerSaveQueue`, receipt verification, queue status, timeout handling, and late-receipt rejection.
- Queue-ledger rollback after a proven not-committed failure.
- A distinct persistence-protection state for unknown outcomes and source conflicts.
- Structured browser/native save failures.
- The native POSIX durable writer, cross-process mutation lock, lock-in CAS, rolling recovery, snapshot backend, and native DTOs.
- A queue barrier API for snapshots.
- Deterministic exception tests and subprocess `SIGKILL` recovery tests.
- A non-empty rejection observer for legacy fire-and-forget callers so they do not create unhandled rejections. The original promise must still reject for an awaiting caller.

### Task 4 owns

- `runPersistentAction` and action-level UX sequencing.
- Awaiting ACK before success messages.
- Gating every direct mutation method before in-memory mutation.
- Migrating every current `persistData()`/`saveData()` caller.
- Replacing native auto-backup saves with scheduled snapshot barriers.
- Stopping browser automatic-backup writes while preserving existing legacy backup bytes.
- Routing manual backup UI to truthful snapshot/export actions.
- Batching `fillToToday` into one command.

Task 4 must not introduce a second persistence rollback authority. Once an action's frozen save item is accepted, only the queue's last acknowledged state is authoritative. An action-local clone may recover only a synchronous mutation or pre-enqueue failure.

### Task 7 owns

- lease epochs, writer freeze, finalization, cutover, and immutable final snapshots.
- `Recovery/final/` and every retention rule for that namespace.

Task 7 must reuse the Task 3 native mutation lock and its lock ordering. The storage mutation lock is the outer lock for every disk mutation. Lease/freeze validation occurs while it is held. If the future control store has its own lock, the only allowed order is `storage mutation lock -> control-store lock`; code holding the control-store lock may never wait for the storage lock. Task 7 must not add another writer lock or release the storage lock between lease/freeze validation and a file mutation.

### Explicitly deferred

- Same-process reconciliation after a save timeout.
- Automatic save retry or reuse of a timed-out `clientSaveId`.
- Command-level idempotency for the legacy mutable model.
- Migration of all 18 legacy fire-and-forget mutation paths; Task 4 owns them.

## 3. Terminology and hashes

The following hashes are distinct and must never be aliased:

- `payloadHash`: SHA-256 of the exact UTF-8 bytes of the frozen `stateJson` created by JavaScript.
- `sourceHashBefore`: SHA-256 of the exact primary file/localStorage bytes observed immediately before the write; `null` means the source was proven missing.
- `stateHashAfter`: SHA-256 of the exact committed primary bytes after the write. On macOS these bytes are the native envelope, so this normally differs from `payloadHash`. On Web it normally equals `payloadHash`.
- `snapshotHash`: SHA-256 of the exact native primary bytes copied into a recovery point.

All hashes are lowercase 64-character hexadecimal strings. Empty strings and hashes computed from a different encoding are invalid.

`clientSaveId` and `clientSnapshotId` are unique, non-empty per-item correlation identifiers. They bind a request and receipt but are not retry keys and do not authorize idempotent replay.

## 4. JavaScript save queue

### 4.1 Public contract

```js
new AssetTrackerSaveQueue({
    write: ({
        clientSaveId,
        stateJson,
        payloadHash,
        reason,
        expectedHash,
        sessionContext
    }) => Promise<SaveReceipt>,
    snapshot: ({
        clientSnapshotId,
        reason,
        expectedHash,
        sessionContext
    }) => Promise<SnapshotReceipt>,
    terminalize: ({ reason, sessionContext }) => Promise<TerminalizationReceipt>,
    sessionContext: { protocolVersion, loadId, writeSessionToken },
    initialAcknowledged: { stateJson, stateHash: null | Hash },
    initialRecoveryHealth: {
        ordinary: RecoveryHealth,
        snapshot: RecoveryHealth
    },
    expectedDurability: 'browser-local-committed' | 'native-durable',
    durabilityDeadlineMs: 29_000,
    barrierDeadlineMs: 29_000,
    transportDeadlineMs: 30_000,
    generationToken,
    clock: { setTimeout, clearTimeout },
    onTransition,
    onAcknowledged,
    onFault
});

queue.enqueue({ stateJson, reason }); // native Promise<SaveReceipt>
queue.failPreparation(error);
queue.runBarrier({ clientSnapshotId, reason }); // native Promise<SnapshotReceipt>
queue.getState();
```

`enqueue()` and `runBarrier()` return genuine intrinsic JavaScript `Promise` instances, never caller-controlled or synchronously-reacting thenables. Settling them queues normal microtask reactions; the queue completes the current-turn callback fence and any resulting terminal transition before caller `.then`, `.catch`, or `await` code can observe the result.

```js
RecoveryHealth = {
    domain: 'none' | 'ordinary' | 'snapshot',
    status: 'healthy' | 'degraded' | 'not-applicable',
    auditComplete: Boolean,
    code: null | String,
    maintenancePendingCount: Integer,
    detail: null | String
};
```

For native sessions, `TerminalizationReceipt` is exact:

```js
{
    ok: true,
    protocolVersion: 2,
    loadId,
    reason, // the gate's first stable terminal reason
    gateState: 'terminal-locked'
}
```

The coordinator emits this ACK only after any active operation has reached its real completion and the native write gate is already terminal-locked for the bound `loadId`/session. Repeated valid terminalization returns the same first reason. Web is terminal before awaiting this receipt, and receipt failure/timeout cannot unlock it.

Browser queues initialize the ordinary and snapshot fields with their respective domains, `status='not-applicable'`, `auditComplete=true`, `code=null`, and `maintenancePendingCount=0`. Native queues receive both persisted domains from `storage.load`. A halted or already-started queue has no rebase/reset API; successful load/retry constructs a new queue.

The queue validates at construction that save and barrier deadlines are positive and strictly shorter than the host transport deadline. They have no per-item override. Tests use an injected clock; production currently uses 29 seconds while the bridge uses 30 seconds.

The queue privately freezes `sessionContext` at construction. Its queue-owned `write`, `snapshot`, and `terminalize` dependencies receive that frozen context; callers cannot supply an operation closure or reread a later tracker session. The tracker owns an opaque generation token. Every timer, write completion, barrier completion, terminalization completion, `onTransition`, `onAcknowledged`, and `onFault` callback compares that token before touching tracker state or UI. A successful load/retry replaces the queue and token; no completion from generation N may mutate generation N+1.

`initialAcknowledged.stateHash === null` means only that the load/confirm protocol proved the primary missing. The default normalized `stateJson` is the rollback/display baseline, but its own payload hash is not substituted for the missing source. The first save uses native `.missing`/Web `expectedHash=null`, and its receipt must echo `sourceHashBefore=null`.

### 4.2 Enqueue rules

`saveData()` must synchronously:

1. call `assertWritable()`;
2. normalize the in-memory candidate;
3. serialize it once with `JSON.stringify`;
4. run the same strict `LegacySafety.validateBookText` contract against that exact `stateJson` and require `valid`;
5. compute `payloadHash` from the exact UTF-8 representation used by storage;
6. enqueue immutable primitive values.

A JSON object that is syntactically valid but violates the known domain schema may never become a write item. Normalize, stringify, validation, and hashing are all preparation steps and share one failure path.

Preparation failure does **not** immediately roll back to the last ACK while an earlier accepted item may be in flight. Instead `failPreparation(error)`:

1. stops accepting new saves/barriers immediately;
2. restores visible memory to the most recent accepted queue-tail snapshot, or the acknowledged baseline if no item was accepted;
3. appends a no-I/O terminal marker after all previously accepted lane items;
4. returns an already-observed rejected promise to the caller;
5. lets earlier accepted items finish in order;
6. when the marker reaches the head, restores the then-current last ACK snapshot, enters failed-readonly, calls `onFault` once, and terminalizes the native session with `candidate-invalid`.

If an earlier accepted item first fails or becomes unknown/conflicted, that earlier fault wins and cancels the preparation marker. The marker never performs storage I/O. This rule prevents an invalid H2 candidate from falsely rolling the UI to H0 while an already-dispatched H1 may still commit.

No queue item may retain a mutable reference to `tracker.data`. The caller may never supply `expectedHash`; execution reads it only from the queue's private last-ACK ledger.

The queue is strict FIFO and does not coalesce. One hundred accepted snapshots mean one hundred ordered storage attempts unless an earlier failure halts the queue.

### 4.3 Save receipt

```js
{
    ok: true,
    clientSaveId,
    payloadHash,
    sourceHashBefore,
    stateHashAfter,
    stateHash: stateHashAfter,
    byteCount,
    durability: 'browser-local-committed' | 'native-durable',
    updatedAt,
    storagePath,
    recoveryHealth: {
        domain: 'ordinary' | 'none',
        status: 'healthy' | 'degraded' | 'not-applicable',
        auditComplete: Boolean,
        code: null | String,
        maintenancePendingCount: Integer,
        detail: null | String
    }
}
```

A receipt advances the ledger only if all of the following match the active item:

- `clientSaveId`;
- `payloadHash`;
- `sourceHashBefore`, including the `null` missing-source case;
- exact platform durability;
- a valid non-empty `stateHashAfter`/`stateHash` alias pair;
- a positive integer byte count consistent with the adapter result.

An invalid, incomplete, wrong-item, wrong-source, or wrong-durability receipt has unknown commit certainty. It halts the queue and never advances the ledger.

Before validation, a protected single-extraction routine reads each allowed top-level and nested receipt field exactly once into a new prototype-free plain data structure; it never enumerates, retains, or accesses the adapter object again. It validates only that extracted structure, then derives canonical deep-frozen copies for the internal ledger, callback input, and promise resolution. A getter/Proxy trap throw or invalid extracted type is a malformed receipt with unknown outcome. Alternating getters, a getter that would throw on a second access, nested health getters, callback mutation, or adapter mutation after resolution cannot change a hash, durability, health field, or caller-visible receipt. Save and snapshot receipts use the same algorithm. A strict-mode mutation attempt is a callback protocol failure, not permission to change the verified ACK.

`recoveryHealth.status === 'degraded'` is orthogonal to primary durability. If the primary is proven durable, the queue advances the hash and displays a warning; it must not retry the save or label the primary write as failed.

Recovery health has two independent domains:

```js
ordinaryRecoveryHealth: RecoveryHealth // domain must be ordinary
snapshotRecoveryHealth: RecoveryHealth // domain must be snapshot
```

The two health objects, including `auditComplete`, `code`, `maintenancePendingCount`, and `detail`, are canonical queue state. `getState()` and transition callbacks receive immutable deep copies; mutating a returned object cannot change queue state. A convenience status string may be derived by the UI but is never a second authority.

A native primary-save receipt must carry `domain='ordinary'` and may not report `not-applicable`; it updates only the ordinary domain. A Web save receipt must carry `domain='none', status='not-applicable', auditComplete=true, code=null, maintenancePendingCount=0` and changes neither domain; Web receipt claims of ordinary healthy/degraded are invalid. A snapshot receipt/error updates only the snapshot domain. Healthy evidence in one domain never clears degradation in the other. A domain becomes healthy again only when a later operation in that same domain reports an authoritative full audit/cleanup with no pending maintenance. Native load returns both persisted domain states; the ordinary and snapshot indexes persist their own pending-cleanup/last-health metadata. UI may use an unqualified green native success only when the primary is durable and neither applicable recovery domain is degraded.

### 4.4 Queue and aggregate UI state

```text
lanePhase: idle | saving | barrier-running | halted
primaryStatus:
    none | browser-local-committed | native-durable |
    failed-readonly | durability-unknown
barrierState:
    none | running | created | deduplicated | degraded |
    not-created | outcome-unknown | conflict
```

`getState()` and every transition contain at least:

```js
{
    generationToken,
    lanePhase,
    primaryStatus,
    barrierState,
    activeClientSaveId,
    activeClientSnapshotId,
    pendingCount,
    lastAcknowledgedHash,
    ordinaryRecoveryHealth,
    snapshotRecoveryHealth,
    accepting,
    halted
}
```

Every enqueue synchronously emits a transition, so pending feedback appears within 100 ms. If a barrier is active, `lanePhase` remains `barrier-running` and only `pendingCount` changes. If a save is active or the lane was idle, `lanePhase` is `saving`. Each save promise resolves when its own receipt is verified, and `onAcknowledged` may advance the private expected hash immediately. However, while any save or barrier remains active or pending, aggregate UI state stays `saving` or `barrier-running`. Stable browser/native success copy is published only after the entire lane drains. An H1 receipt while H2 is queued may never tell the user that their latest accepted H2 state is already durable.

Preparation and callback-failure markers are real no-I/O lane items. They count in `pendingCount`, set `accepting=false` in the failure turn, participate in next-item selection, and suppress every stable primary/snapshot success transition. When H1 ACKs with a marker next, the queue consumes the marker directly and enters its terminal state; it never emits an intermediate H1 success banner. Markers never advance the ledger.

Every operation outcome that permits the lane to continue has a hard callback fence. A successful save/snapshot uses:

```text
verify and canonicalize receipt
-> clear the active deadline
-> commit the internal ledger (a barrier leaves the primary ledger unchanged)
-> settle the acknowledged item's promise with its immutable successful receipt
-> select the next lane phase but do not call any adapter
-> invoke onAcknowledged and every post-receipt transition through total wrappers
-> recheck callback result, generation, lane revision, and terminal state
-> only if all wrappers succeeded may the next adapter operation dispatch
```

No later save/snapshot adapter invocation may occur inside or before this fence completes. A reentrant `onAcknowledged` enqueue appends normally but cannot be overwritten by a drain transition or dispatch ahead of an already-pending item. Stable success is emitted only from a drain checkpoint that revalidates the lane is still empty after the fence.

A valid known-not-created snapshot error is the only rejected-but-continuable outcome and uses the analogous fence:

```text
single-extract and validate canonical SnapshotError
-> clear the active deadline
-> merge its strict persisted snapshot-health evidence, if any
-> reject the barrier's native Promise with the canonical SnapshotError
-> select the next lane phase but do not call any adapter
-> publish barrierState=not-created through the total transition wrapper
-> recheck callback result, generation, lane revision, and terminal state
-> only if the wrapper succeeded may the next adapter operation dispatch
```

If this continuation callback fails, the original barrier promise remains rejected by its real `AssetTrackerSnapshotError`, the primary ledger remains at its acknowledged head, and every later item is still undispatched and is aborted by the callback fault.

During a barrier, UI uses a distinct `barrier-running` state and cannot reuse a stale primary-success banner as the current operation result.

Success copy is exact:

- Browser: `已存入此浏览器`. It may not say `安全`, `磁盘`, `本机文件`, or `备份`.
- macOS healthy: `已安全写入本机`.
- macOS degraded: `已耐久保存；恢复维护需处理` with a non-green warning state.

### 4.5 Failure taxonomy

The wire may carry a structured failure DTO:

```js
{
    ok: false,
    error: {
        code,
        message,
        writeOutcome: 'not-committed' | 'unknown',
        conflict: false | 'source-changed' | 'session-invalid',
        clientSaveId,
        payloadHash,
        sourceHashAfter: null | Hash,
        sourceReverified: Boolean,
        coordinatorReleased: Boolean,
        healthPersisted: Boolean,
        recoveryHealthEvidence: RecoveryHealth | null
    }
}
```

The adapter converts every wire failure into a rejected `AssetTrackerSaveError` whose properties preserve this DTO. Its public `write()` contract resolves only a valid `SaveReceipt` and rejects only an error; resolved `{ok:false}` is forbidden. Save and snapshot structured errors go through the same protected one-read extraction, plain-data validation, and canonical deep-freeze algorithm as receipts before any proof field is trusted or exposed. A getter/Proxy trap failure makes the error malformed/unknown. If a faulty adapter resolves a failure union, the queue treats it as a malformed receipt with unknown outcome. A plain error, timeout, transport loss, malformed error, invalid receipt, or error after the relevant operation-specific commit/verification point is conservatively `unknown`, except for the narrowly proven pending-cleanup degradation in Section 9.3.

The queue permits ACK-ledger rollback only when `writeOutcome='not-committed'`, conflict is false, ID/payload match the active item, `sourceHashAfter` exactly equals the item's expected hash (including `null`), `sourceReverified=true`, and `coordinatorReleased=true`. Anything missing or mismatched is `unknown`. The Web throw-and-reread-old path emits the same proof fields with `healthPersisted=false` and `recoveryHealthEvidence=null`. The health tuple is strict: `healthPersisted=false` requires null evidence; `healthPersisted=true` requires a complete, valid, same-domain ordinary structure. A false/non-null, true/null, malformed, cross-domain, or otherwise inconsistent tuple makes the entire structured error malformed and therefore `unknown`; it may never preserve prior healthy state while accepting a disk health change. A source/session conflict is not a successful rollback condition even if this command did not write; it requires reload because external truth may differ.

On the first terminal fault, the queue:

1. rejects the active item and every pending item;
2. rejects all future enqueue/barrier requests;
3. calls `onFault` exactly once;
4. ignores every late ACK and never advances its ledger;
5. attempts native terminalization when a native session exists;
6. never automatically retries or creates a new save ID.

Promise rejection types are deterministic:

```text
active item:
  AssetTrackerSaveError or AssetTrackerSnapshotError

accepted but never-dispatched pending item:
  AssetTrackerQueueAbortError {
    queueOutcome: 'not-dispatched',
    itemKind,
    clientItemId,
    payloadHash,
    causedByClientItemId,
    causeKind: 'storage-item' | 'pre-dispatch-callback' | 'post-operation-callback',
    callbackFaultId: null | String,
    completedItemKind: null | 'save' | 'snapshot',
    completedClientItemId: null | String,
    completedOutcome: null | 'successful-receipt' | 'known-not-created'
  }

future enqueue/barrier after accepting stops:
  AssetTrackerQueueHaltedError {
    queueOutcome: 'queue-halted',
    terminalCause
  }
```

Only the active/marker terminal cause invokes `onFault`. Pending cancellation and future-halted errors never run another rollback or fault callback. Task 4 must propagate/present these results but may not apply an action-local rollback after enqueue.

Native terminalization reasons added and tested by Task 3 are the stable enum:

```text
save-not-committed
save-outcome-unknown
save-conflict
snapshot-outcome-unknown
snapshot-conflict
candidate-invalid
queue-callback-failed
```

The queue enters its Web terminal state before invoking its queue-owned `terminalize` dependency. Terminalization ACK, rejection, or timeout cannot unlock or otherwise change that state. The native coordinator serializes terminalization after any active save/snapshot operation, then locks the session; a timeout never causes a second save or snapshot command.

For `not-committed` without a source conflict:

- state becomes `failed-readonly`;
- `tracker.data` is restored from `lastAcknowledgedStateJson`;
- views refresh from that snapshot;
- the normal shell becomes inert and mutation is rejected.

For `unknown`:

- state becomes `durability-unknown`;
- pending snapshots are discarded;
- the active `attemptedStateJson`, not a later pending mutation, remains visible but inert;
- copy says `保存结果未知，请重新启动以核对账本；系统不会自动重试`;
- relaunch performs a fresh load/validate/render/confirm and discovers either the old or complete new state.

For a source/session conflict:

- state is `failed-readonly` with a conflict cause;
- no claim is made that displayed memory or the last ACK snapshot equals disk;
- copy requires reload and the shell remains inert.

### 4.6 Callback failure

All external callbacks are invoked through a tested total wrapper. A callback exception can never undo an ACK, change a receipt's classification, reject a successfully stored item, strand pending items, create another fault, or escape as an unhandled rejection.

`onTransition`, `onAcknowledged`, and `onFault` are synchronous-void contracts: they must return exactly `undefined`. Any other return value—including a number, plain object, resolved/rejected/never-settling thenable, or hostile thenable—is an immediate callback protocol failure before any later adapter dispatch; the wrapper never waits to discover whether it is actually thenable. In a separate protected diagnostic block it passes that value to a captured intrinsic native `Promise.resolve`, attaches native resolve/reject consumers, and consumes the derived promise. A throwing `then` getter, a `then` method that settles and then throws, double settlement, or consumer-installation failure cannot escape the total wrapper. A non-undefined value returned while publishing an already-terminal fault is consumed only for diagnostics and cannot create a second terminal cause. A never-settling diagnostic does not block terminalization.

- Every pre-dispatch transition callback runs before adapter I/O for the item it describes. If it throws or returns non-undefined, a callback-failure marker replaces that exact undispatched item at the same FIFO position, `accepting` becomes false, and no adapter I/O occurs for that item. The item promise is not settled ahead of earlier lane items.
- If no earlier lane item exists, the marker immediately rejects the triggering item with `AssetTrackerQueueCallbackError`, uses the last ACK state, and terminalizes with `queue-callback-failed`.
- If an earlier H1 exists and H1 ACKs, the marker reaches the head, rejects the triggering H2 with `AssetTrackerQueueCallbackError`, aborts every later H3 with `causedByClientItemId=H2`, `causeKind='pre-dispatch-callback'`, and the marker's immutable `callbackFaultId`, restores H1, and invokes `onFault` once with the same fault object. If H1 first fails, conflicts, or becomes unknown, H1 wins; the marker is cancelled and H2/H3 are `AssetTrackerQueueAbortError` caused by H1 with `causeKind='storage-item'` and no callback fault ID, with no second `onFault`.
- A reentrant enqueue performed inside the failing callback is still later than the triggering item. It cannot move ahead of the replacement marker or become the terminal cause.
- If any post-operation callback throws or returns non-undefined, the already-settled operation promise keeps its real result: a successful save/snapshot receipt stays successful, and a known-not-created barrier stays rejected by its original `AssetTrackerSnapshotError`. The callback fence guarantees every later item is still undispatched. The queue creates one immutable callback fault `{callbackFaultId, causeKind:'post-operation-callback', completedItemKind, completedClientItemId, completedOutcome}`; every later abort uses the completed ID as `causedByClientItemId`, the same fault ID, cause kind, and outcome. The terminal cause, `onFault`, and all future halted errors reuse this object. The primary ledger stays at its current acknowledged head and native terminalization uses `queue-callback-failed`.
- If a transition callback throws while publishing an already-terminal state, or if `onFault` or the fallback diagnostic recorder throws, the wrapper records best-effort diagnostics without invoking another callback, changing the existing terminal cause, or producing a derived rejection.

Task 4 checks the queue is not halted after an awaited receipt and before presenting command success.

### 4.7 Promise observation

The queue promise remains rejectable to an awaiting caller. Legacy fire-and-forget paths attach a real rejection observer that records the already-centralized fault without emitting success or swallowing the original promise. The observer wrapper is synchronous, total, catches its own logging/UI errors, always returns `undefined`, never returns a thenable, and explicitly consumes its derived promise. Task 3 may not use an empty `.catch(() => {})` and may not claim that caller success timing is fixed before Task 4.

### 4.8 Rebase after load

After a successful load/validate/render/confirm, and only while no queue item or barrier is active, a fresh queue receives the exact normalized `stateJson` and confirmed source hash. Retry/relaunch creates a new queue instance and generation token; a halted generation cannot be reset or revived. Late receipts, timers, observer callbacks, and terminalization responses from the prior generation are inert.

Every protocol-v2 native `storage.load` result carries this explicit outer health container when the recovery audit completed:

```js
{
    recoveryHealthComplete: true,
    ordinaryRecoveryHealth: RecoveryHealth, // domain='ordinary'
    snapshotRecoveryHealth: RecoveryHealth  // domain='snapshot'
}
```

If either recovery-domain audit cannot complete or its DTO is malformed, `recoveryHealthComplete=false`, both health fields are `null`, and that load result cannot be confirmed into a writable queue. Missing primary is still a valid candidate only when the recovery health audit is complete. The bridge may not substitute healthy/N/A defaults for a missing native health field.

## 5. Snapshot barrier

`await queue.whenIdle(); storage.snapshot()` is forbidden because a save may enqueue between those operations.

`runBarrier` freezes a complete descriptor at enqueue time and inserts it into the same FIFO lane:

```js
queue.runBarrier({
    clientSnapshotId,
    reason: 'manual' | 'scheduled'
});
```

The public descriptor contains only validated primitives. It has no operation closure, session field, or deadline override. At execution the queue calls its private `snapshot` dependency with the enqueue-frozen ID/reason, queue-owned expected hash, and constructor-frozen session context. The queue validates the result kind plus exact `clientSnapshotId`, durability, retained count, and recovery-health shape, and requires `receipt.sourceHash === receipt.snapshotHash === barrierExpectedHash` because a recovery point contains the exact captured primary bytes. Any mismatch is a malformed receipt with unknown outcome.

The barrier:

- waits for all preceding saves to be acknowledged;
- prevents later saves from dispatching until it resolves;
- uses the queue's fixed current head;
- never advances `lastAckHash` or `lastAcknowledgedStateJson`;
- is rejected when the queue is halted;
- treats source/session mismatch as a read-only conflict;
- accepts a durable snapshot with degraded retention as typed partial success.

Barrier outcomes are exhaustive:

1. **Created/deduplicated, healthy or degraded:** resolve the barrier, do not move the primary ledger, then dispatch the next lane item. Degraded recovery health remains visible.
2. **Known not created:** native proves the primary was reread at the captured hash after the failed attempt, no retained snapshot logical commit occurred, and the coordinator released its lock. A maintenance-only index commit is permitted only through the strict persisted-health tuple. Reject only the barrier promise, set `barrierState=not-created`, and continue the next queued save using the unchanged primary hash. Snapshot-domain health changes only when the error also carries valid evidence that the new health was persisted; otherwise both health fields must say no health change occurred.
3. **Source/session conflict:** halt the lane, cancel later saves, set `barrierState=conflict`, and require reload. Do not roll back primary memory.
4. **Timeout, transport loss, malformed/mismatched receipt, or no proof that the primary remained verified:** halt the lane, cancel later saves, set `barrierState=outcome-unknown`, retain the last acknowledged primary state, and require restart. This is a snapshot-outcome warning, not a claim that the already-ACKed primary save became non-durable.

The snapshot adapter resolves only a fully validated snapshot receipt and otherwise rejects `AssetTrackerSnapshotError`:

```js
{
    code,
    message,
    snapshotOutcome: 'not-created' | 'unknown',
    conflict: false | 'source-changed' | 'session-invalid',
    clientSnapshotId,
    sourceHashAfter,
    sourceReverified: Boolean,
    coordinatorReleased: Boolean,
    healthPersisted: Boolean,
    recoveryHealthEvidence: NativeRecoveryHealth | null
}
```

Only `snapshotOutcome='not-created'`, no conflict, an exact `sourceHashAfter`, `sourceReverified=true`, and `coordinatorReleased=true` permits the lane to continue. The health tuple is strict here too: false requires null evidence; true requires a complete valid snapshot-domain structure. An inconsistent tuple makes the error malformed, changes the outcome to unknown, cancels later items, and requires restart; it is never ignored while prior healthy state is retained. Valid persisted evidence is merged before the next lane item. A resolved `{ok:false}` is a malformed/unknown result just as it is for saves.

The barrier deadline is independent and strictly shorter than the host timeout. Late barrier results from a halted or replaced generation are ignored.

Required ordering test:

```text
save H0 -> H1
snapshot uses H1
save still uses H1 -> H2
```

Task 3 exposes this barrier and the full snapshot backend. Task 4, not Task 3, changes scheduled/manual product routing.

## 6. Browser adapter

The Web adapter uses the same queue and receipt shape.

Before `localStorage.setItem`, it verifies the session and current source hash. After `setItem`, it rereads the exact value and verifies the expected new hash before returning:

```text
durability = browser-local-committed
sourceHashBefore = verified old hash or null
stateHashAfter = payloadHash = hash(reread exact UTF-8 stateJson)
```

If `setItem` throws, the adapter rereads:

- exact old value: `not-committed`;
- exact new value: return a normal committed receipt;
- missing/other/unreadable: `unknown`.

Browser localStorage never returns `native-durable`. The new Task 3 queue/adapter/snapshot backend does not create or advertise a browser backup. The pre-existing `assetTrackerBackup*` product route remains an explicitly tested, non-releaseable legacy debt until Task 4 disables it; Task 3 completion must not claim otherwise.

## 7. Native request, receipt, and gate ordering

### 7.1 Request

```swift
DurableBookSaveRequest(
    clientSaveID: String,
    expectedSource: .missing | .sha256(String),
    payloadHash: String,
    stateJSON: String,
    schemaVersion: Int,
    reason: String,
    authorization: AssetTrackerSaveAuthorization
)
```

The native store verifies `payloadHash == SHA256(UTF8(stateJSON))` before mutation. The main-actor coordinator performs protocol/session preflight before scheduling I/O. That preflight does not replace lock-in CAS.

### 7.2 Receipt

```swift
NativeDurableSaveReceipt(
    clientSaveID: String,
    sourceHashBefore: String?,
    payloadHash: String,
    stateHashAfter: String,
    byteCount: Int,
    durability: .nativeDurable,
    previousSlotHashes: [String],
    recoveryHealth: NativeRecoveryHealth,
    updatedAt: Date,
    storagePath: String
)
```

```swift
NativeRecoveryHealth(
    domain: .ordinary | .snapshot,
    status: .healthy | .degraded | .notApplicable,
    auditComplete: Bool,
    code: String?,
    maintenancePendingCount: Int,
    detail: String?
)
```

The same lossless structure is used by save/snapshot receipts, structured errors with persisted evidence, `storage.load`, the bridge DTO, and JavaScript. `healthy` is valid only after a complete canonical-directory audit, a semantically valid index, verified referenced blobs, zero managed orphans, and an empty canonical pending set. `maintenancePendingCount` must equal the persisted index pending-set size whenever an index exists. `code=nil` is permitted only for healthy or not-applicable; degraded requires a stable non-empty code. Persisted evidence in a save/snapshot error may use only healthy/degraded, never not-applicable. An illegal/unknown object is corruption, not merely degraded health.

Native `storage.load` may return `.notApplicable` only after a complete bound-directory audit proves that the specific recovery domain directory is absent, is indexless and empty, or is indexless and contains only strictly validated removable temp files from its empty-index operation. It must then use `auditComplete=true`, `code=nil`, and `maintenancePendingCount=0`. A blob, unknown entry, illegal temp, symlink, or other managed object without an index is corruption. Once a valid index exists, that domain is applicable and load returns only healthy/degraded. Native save and snapshot success receipts never return not-applicable: the operation must first durably initialize its same-domain index.

The bridge maps Swift `.notApplicable` losslessly to JavaScript `'not-applicable'`; no other spelling or fallback is accepted.

`updatedAt` is the timestamp embedded in and verified with the committed native envelope; `storagePath` is the non-empty canonical primary path held by the verified store. The bridge maps both without regenerating or defaulting them. They are type-checked caller metadata, not substitutes for `sourceHashBefore`, `stateHashAfter`, byte count, or durability proof, and therefore do not independently advance the queue ledger.

Ordering is mandatory:

```text
native durable writer receipt
-> write gate recordSuccessfulSave(stateHashAfter)
-> typed bridge response enqueue
-> Web ACK delivery
```

If the Web deadline expires after native commit, the native gate may already contain H1. That is a truthful unknown outcome. The Web ignores the late receipt, requests native terminalization, disables mutation, and requires relaunch. It does not retry the command.

## 8. Native cross-process mutation lock and final CAS

All managed mutations use one storage-root lock file:

```text
.AssetTracker.storage.lock
```

The lock file is owned by the effective UID, is a regular non-symlink file, and has mode `0600`. The process holds `flock(LOCK_EX)` across:

- final source reread and expected-hash CAS;
- ordinary previous-generation establishment;
- primary durable replacement;
- snapshot blob/index creation;
- retention index mutation and known-file cleanup.

The coordinator's current separate `load()` then `save()` pattern is insufficient. `saveDurably(request)` must reread and compare `expectedSource` inside this lock. Two cooperating processes that both start with H0 may produce only one H0 -> H1 winner; the other observes H1 and returns source conflict without writing.

The writer opens the canonical parent directory first, then the storage root with `openat(O_DIRECTORY | O_NOFOLLOW)`, and records `(st_dev, st_ino, st_nlink)` for the root, lock, and every opened managed subdirectory. After acquiring `flock`, after source CAS, immediately before every logical primary/index rename or no-op verification point, after final directory synchronization, and immediately before returning a receipt, it verifies with `fstatat(..., AT_SYMLINK_NOFOLLOW)` that:

- the canonical root entry still identifies the same live inode;
- the root and nested directory FDs still identify their canonical entries;
- the lock pathname still identifies the held lock inode and `st_nlink == 1`.

Root rename/swap, lock unlink/replacement, or managed-subdirectory replacement is classified exclusively by the operation-specific logical/durability point in Section 9.3. Before that point, known failure is allowed only with every required source and health proof; after that point, authoritative-outcome uncertainty is unknown and no receipt is returned. Tests pause at these checkpoints and use a second process to replace each identity.

`flock` is advisory. The supported writer path is cooperative, while lock-in CAS detects external edits before mutation. No claim is made that advisory locking can prevent an unrelated process from ignoring the lock.

## 9. Native POSIX durable writer

### 9.1 Managed paths and permissions

- new Task 3 storage and managed directories: mode `0700`;
- new Task 3 lock, temp, index, blob, snapshot, and primary files: mode `0600`;
- owner must equal the effective UID;
- all managed targets must have the expected regular-file/directory type;
- symlinks are rejected at every managed component;
- Task 3 managed files must have zero extended ACL entries; legacy root/primary admission allows only owner-correct, non-symlink regular/directory objects and no ACL entry granting group/everyone write, delete, ownership, or security changes;
- unknown files and directories are never deleted or renamed.

Creating a managed directory includes synchronizing its parent entry. The writer uses directory file descriptors and `openat`/`renameat` family calls so path validation and mutation share an anchored directory identity. An admitted Task 2 legacy root may begin as `0755` and its primary as `0644`; on the first authorized mutation the writer safely tightens and verifies the root as `0700`, while the replacement primary is created as `0600`. It never rejects a valid owner-correct legacy book solely for those known legacy modes. Every created temp receives an explicit `fchmod(0600)` rather than relying on `open` mode through the process umask.

### 9.2 Durable replace algorithm

For exact target bytes:

1. create a same-directory random temp with `openat(O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600)`;
2. loop `write`, retrying `EINTR` and handling short writes;
3. `fsync(tempFD)`;
4. `fcntl(tempFD, F_FULLFSYNC)` on macOS;
5. revalidate canonical directory/lock identities and, for a primary write, reread the source immediately before rename: an expected existing source must retain its original hash and identity, and an expected missing source must still return `ENOENT`;
6. `renameat` the temp onto a replaceable target, or use `renameatx_np(RENAME_EXCL | RENAME_NOFOLLOW_ANY)` for a content-addressed create-only target;
7. `fsync(parentDirectoryFD)`;
8. reopen with `openat(O_NOFOLLOW)`, reread exact bytes, and collect `fstat`;
9. verify exact bytes, SHA-256, byte count, owner, type, mode, and canonical identities;
10. only then return a durable file receipt.

There is no fallback from `F_FULLFSYNC`, parent-directory sync, or reread verification to a weaker durability label. Unsupported required semantics enter read-only failure.

For a primary save, errors before a successful primary rename are `not-committed` only when the old primary is still proven. After the rename, classification follows Section 9.3: uncertainty in authoritative durability/identity is unknown, while only a later failure cleaning an already-persisted, proven-unreferenced pending blob may use the durable-degraded exception.

Temporary cleanup is limited to a fixed private prefix, the current UID, regular files, and the known managed directory. Orphan temp files are never interpreted as recovery points.

### 9.3 Operation-specific logical commit points

Known failure classification is tied to the operation's own logical commit, not to a generic primary-rename phrase:

- primary save commits when the primary rename succeeds;
- a candidate-equals-source primary no-op reaches its logical verification point only after all same-domain index/maintenance mutations are durably verified, the unchanged primary passes `fsync`, `F_FULLFSYNC`, parent-directory synchronization, exact-byte/hash reread, and final canonical-identity verification;
- snapshot creation or pending/orphan reuse-created commits when the final retained/pending snapshot index rename succeeds;
- a retained-entry dedup that needs no index mutation reaches its logical verification point only after the existing index/blob, primary, directory synchronization state, and canonical identities pass their final reread/audit; if it also clears maintenance, the maintenance-clearing index rename is its commit;
- recovery-health cleanup commits when the maintenance-clearing index rename succeeds.

An identity mismatch, exception, or process death before the relevant commit/verification point may be reported as not-committed/not-created only after exact source re-verification, coordinator release, and a valid health-evidence tuple. After the authoritative primary/snapshot/index commit, any uncertainty in that authoritative object's file or directory synchronization, reread, hash, identity, or index outcome is unknown and returns no success receipt. In particular, a root/lock/snapshot-directory swap after the final snapshot index rename can never be downgraded to known-not-created.

There is one narrow post-commit partial-success class: cleanup of a persisted pending hash that has already been proven unreferenced may fail after the authoritative primary/snapshot/index is fully synchronized, reread, hashed, and identity-verified. The operation may then return `native-durable` with same-domain degraded health only if the still-persisted pending set and `lastHealthCode='cleanup-pending'` are reread and exactly verified and the health tuple is valid. This exception never covers the authoritative file/index itself. If a maintenance-clear index rename has started and its rename, parent sync, reread, hash, or identity outcome is uncertain, the health outcome is unknown and no receipt is returned; it cannot be relabeled durable-degraded.

If a snapshot blob becomes durable but the final snapshot index does not commit, the operation may continue the lane as known-not-created only after it either durably deletes and audits that orphan or atomically records it as snapshot pending cleanup and returns valid persisted degraded-health evidence. If it cannot prove one of those outcomes, result certainty is unknown and the lane halts.

## 10. Ordinary rolling recovery

Layout:

```text
Recovery/ordinary/
  blobs/<sha256>.json
  slots.json
```

Blobs contain the exact prior primary raw bytes and are create-only. `slots.json` is one deterministic, versioned, recoverable transaction record; no separate hash sidecar is used.

The index contains both committed and optional prepared state:

```json
{
  "format": "qiushan.asset-book.ordinary-recovery",
  "version": 1,
  "committed": {
    "primaryHash": "H1-or-null",
    "slots": ["H0", "H-1"],
    "maintenance": {
      "pendingCleanupHashes": [],
      "lastHealthCode": null
    }
  },
  "prepared": {
    "operationId": "unique-id",
    "sourceHash": "H1-or-null",
    "candidateHash": "H2",
    "committedSlots": ["H0", "H-1"],
    "nextSlots": ["H1", "H0"]
  }
}
```

`prepared` is `null` outside an in-flight transition. The exact candidate envelope bytes and `candidateHash` are computed before preparing the index.

Index semantic validation is mandatory even when every referenced blob exists and hashes correctly:

```text
prepared.sourceHash == committed.primaryHash
prepared.committedSlots == committed.slots
prepared.nextSlots == canonicalNextSlots(
    sourceHash: prepared.sourceHash,
    committedSlots: prepared.committedSlots,
    candidateHash: prepared.candidateHash
)
all slot hashes are valid, unique, ordered, and backed by verified blobs
```

`canonicalNextSlots` first discards a `null` source, then takes the stable distinct sequence `[sourceHash] + committedSlots`, excludes `candidateHash`, and keeps at most two hashes. `null` is never a slot or blob name.

With no prepared record, and after either reconciliation branch completes, `committed.primaryHash` must equal the actual primary hash, including the `null` missing case. Any relationship mismatch is read-only corruption; valid blob contents do not make an inconsistent index acceptable.

Before any blob is created, a virgin ordinary namespace uses the fixed crash-safe order `create+sync ordinary directory -> durable empty slots.json -> create+sync blobs directory`. The empty index's committed primary hash equals the current verified primary or `null`; slots and pending cleanup are empty, `prepared=null`, and `lastHealthCode=null`. If the ordinary directory exists without an index, initialization is allowed only when it is empty or contains only validated removable temp files from the empty-index operation. A blob, unknown entry, illegal temp, symlink, or already-created `blobs/` directory without an index is read-only corruption; it is never guessed into an index.

A valid empty index with a missing `blobs/` entry is the one allowed post-index initialization crash state, and only while committed slots/pending are empty and `prepared=null`. Load audits it as an applicable empty domain rather than corruption. The next ordinary mutation durably creates and synchronizes `blobs/` before it creates, enumerates, or references a blob. No implementation may create `blobs/` before the empty index is durable.

At the start of every mutation, a valid prepared index is reconciled against the actual primary:

- primary equals `prepared.sourceHash`: durably clear `prepared` and preserve `committed`/`committedSlots`;
- primary equals `prepared.candidateHash`: in one durable index replacement promote `nextSlots` and candidate hash, clear `prepared`, set `pendingCleanup = (oldPending union (committedSlots - nextSlots)) - nextSlots`, and write the matching `lastHealthCode`;
- primary equals neither: enter read-only corruption.

Every referenced committed/prepared blob is revalidated before reconciliation. Reconciliation is implemented by the store and exercised by a fresh verifier process, not only by recreating an in-memory object.

The ordinary blob directory is enumerated through its bound dirfd during load audit and every mutation. A canonical valid blob absent from committed slots, prepared committed/next slots, and pending cleanup is a managed orphan: it is not offered as a recovery generation and forces ordinary health degraded. A noncanonical name, invalid canonical blob, symlink, illegal temp, or unknown entry is corruption and is never deleted. The next ordinary mutation must either make a managed orphan a verified referenced slot or atomically add it to persisted pending cleanup before any unlink. Thus a crash at `afterOrdinaryBlobDurable` cannot leave an untracked file while health reports healthy.

Maintenance metadata is canonical: hashes are sorted unique lowercase hex, every pending hash is unreferenced, and `pendingCleanupHashes` is disjoint from committed/prepared/next slots. Every durable index replacement enforces `pendingCleanupHashes nonempty <=> lastHealthCode='cleanup-pending'`; after a full audit, an empty pending set and zero managed orphans require `lastHealthCode=null`. Creating/merging pending and setting the code are one index replacement; clearing the final pending entry and the code are another one index replacement. More detailed runtime cleanup diagnostics are derived from this persisted condition and cannot replace it with an unpersisted code. Before any unlink the writer rereads the latest index under the lock and proves the target is still pending and unreferenced. If a pending hash becomes newly referenced, the same durable transition removes it from pending and verifies or recreates its blob before use; cleanup can never delete a re-referenced blob.

While holding the mutation lock, a normal save then:

1. rereads and validates the current primary against `expectedSource`;
2. durably initializes the empty index when this is the virgin namespace;
3. if a primary exists, durably creates or verifies its content-addressed blob and validates every retained old slot blob;
4. calculates canonical `nextSlots = distinct(compact([sourceHash]) + committed.slots).filter(hash != candidateHash).prefix(2)` without changing committed slots;
5. in one durable index replacement writes and rereads `prepared`, preserves both `committedSlots` and `nextSlots`, sets committed pending cleanup to `(oldPending union managedOrphans) - (committedSlots union nextSlots)`, and atomically writes the matching `lastHealthCode`; every orphan promoted into `nextSlots` is first verified byte-for-byte;
6. immediately before rename, revalidates canonical identities and rereads/re-hashes the source (or proves it is still missing);
7. durably replaces the primary with the already-hashed candidate;
8. in one durable index replacement, promotes candidate hash/`nextSlots` into `committed`, clears `prepared`, sets `pendingCleanup = (oldPending union (oldSlots - nextSlots)) - nextSlots`, and atomically writes the matching `lastHealthCode`;
9. only after that combined committed-index verification may it remove those known ordinary blobs, synchronize the directory, and durably clear the final pending entry plus `lastHealthCode` in one same-domain index replacement.

The invariant is “at most two prior generations; exactly two only after enough distinct history exists”. A missing initial primary has zero prior slots; the second distinct version has one. A retry after an index advance must not insert the same hash into both slots.

If `candidateHash == sourceHash`, the operation is a verified no-op: it first initializes a virgin index or reconciles any prepared record, performs the full same-domain directory audit, atomically records any managed orphan in pending cleanup together with `lastHealthCode='cleanup-pending'`, safely processes or preserves that maintenance, creates no new prepared record, and does not rotate slots. The writer synchronizes the current primary file with `fsync` and `F_FULLFSYNC`, synchronizes its directory, rereads/re-hashes it, revalidates canonical identities, and only then returns a receipt for the unchanged exact bytes with truthful health.

If the previous blob, prepared index, or pre-rename source revalidation cannot be established and verified, the new primary is not written. A missing, corrupt, malformed, or dangling non-virgin index is never guessed or rebuilt during a save. A corrupt current primary is never promoted into recovery and never overwritten. A failure after primary replacement but before committed-index finalization returns unknown/no receipt; the next fresh reconciliation deterministically commits or aborts the prepared record without losing a generation.

An orphan cleanup failure after a durable primary returns `native-durable` with degraded ordinary recovery health. It does not roll back or retry the primary save. A later ordinary operation may clear that warning only after revalidating every referenced blob and completing or proving absent every recorded pending cleanup. A load reads the index without mutating it and exposes the persisted ordinary health.

## 11. Native manual/scheduled snapshots

Layout:

```text
Recovery/snapshots/
  <primary-sha256>.json
  index.json
Recovery/final/              # Task 7 only
```

`storage.snapshot` accepts only `manual` or `scheduled`. There is no `final` enum case in the Task 3 API.

The snapshot index is versioned and contains retained entries `{hash, ordinal, createdAt}`, a persistent `nextOrdinal`, and same-domain `pendingCleanupHashes`/`lastHealthCode`. A virgin namespace durably creates its empty index before any snapshot blob. If the directory exists without an index, initialization is allowed only when it is empty or contains only strictly validated removable temp files from the empty-index operation; the writer removes those temps under the lock, synchronizes the directory, and retries durable empty-index initialization. A snapshot blob, other temp, symlink, illegal object, or unknown entry without an index is read-only corruption.

Only a hash already present in the current retained entries is `deduplicated`; it keeps its existing ordinal and `createdAt` and does not advance `nextOrdinal`. A hash found only in pending cleanup or as a managed orphan may reuse its verified content file, but it is a new logical recovery point: it receives the current `nextOrdinal`, gets a new display-only `createdAt`, advances `nextOrdinal`, is removed from pending, and returns `snapshotStatus='created'`. A wholly new hash follows the same created-entry rule after its blob is durable. Overflow fails before blob creation or logical-entry mutation.

Index validation requires unique retained hashes and ordinals, `0 <= ordinal < nextOrdinal`, `nextOrdinal` strictly greater than every retained ordinal, retained count at most 24, canonical unique pending hashes, and no retained/pending intersection. `createdAt` never controls ordering or retention.

Within the mutation lock it:

1. rereads the primary as a regular, readable file;
2. verifies source hash equals the barrier's expected head and the native gate session;
3. requires a write-gate state attesting that this exact current hash came from the strict supported payload validator, and rejects corrupt, unsupported, changed, missing, or merely syntactic JSON without creating an artifact;
4. enumerates the snapshot directory through its bound dirfd: canonical valid content files absent from both retained and pending sets are managed orphans; an invalid canonical file, symlink, illegal temp, or unknown entry is corruption and is never deleted;
5. classifies the request as retained dedup, pending/orphan reuse-created, or wholly new-created; it durably creates a missing content-addressed exact-byte snapshot or verifies an existing same-hash file byte-for-byte, rejecting a same-name mismatch without overwrite;
6. revalidates the current primary before committing the index;
7. assigns no new ordinal for retained dedup, otherwise allocates exactly one new logical ordinal, then computes the final retained set ordered by `(ordinal DESC, hash ASC)` and already capped at 24 with newest 3 preserved;
8. computes `pending = (oldPending union evicted union managedOrphans) - retainedHashes`, thereby rescuing a pending/orphan hash that becomes retained again;
9. reopens and verifies every retained entry and every present pending entry: canonical filename, uniqueness, regular/no-follow type, effective-UID owner, strict mode/ACL/link count, exact byte count, and exact SHA-256;
10. for a created/reuse-created entry or any metadata/health change, in one durable index replacement writes the final `retained <= 24`, new `nextOrdinal`, canonical disjoint pending set, and matching health metadata (`pending nonempty <=> lastHealthCode='cleanup-pending'`); there is never a durable 25-entry intermediate index. A pure retained dedup may skip this replacement only when the exact index bytes remain unchanged and the full final audit/identity verification succeeds;
11. before each unlink, rereads the current index and proves the target remains pending and unreferenced, then unlinks only that known file and synchronizes the directory;
12. after a complete audit/cleanup, durably clears the final pending entry and `lastHealthCode` in one snapshot-index replacement.

The same dirfd enumeration runs during native load health audit. A valid `afterSnapshotBlobDurable` orphan is not offered as a recovery point but forces snapshot health degraded; the next same-domain mutation atomically puts it into pending or rescues it into retained before cleanup. Unknown/invalid entries fail closed. Repeated crashes cannot accumulate untracked files while reporting healthy.

Snapshot receipt:

```js
{
    ok: true,
    clientSnapshotId,
    sourceHash,
    snapshotHash,
    ordinal,
    snapshotStatus: 'created' | 'deduplicated',
    durability: 'native-durable',
    retainedCount,
    recoveryHealth: {
        domain: 'snapshot',
        status: 'healthy' | 'degraded',
        auditComplete: Boolean,
        code: null | String,
        maintenancePendingCount: Integer,
        detail: null | String
    }
}
```

If the new point and index are durable but removal of old unreferenced files fails, receipt success remains durable and snapshot health is degraded. UI copy is `恢复点已建立，但旧恢复点清理失败`; it may not display an unqualified green success or a generic failure that encourages duplicate creation. A later snapshot may clear the warning only after an authoritative audit and completion/proof-of-absence for every recorded pending cleanup. Native load exposes both persisted recovery-health domains.

Task 3 code and retention must never enumerate, unlink, rename, or validate through `Recovery/final/`.

## 12. Fault injection and real-process crash harness

### 12.1 Fault points

Writer points:

```text
afterLockAcquired
afterSourceCAS
afterSourceRevalidation
afterTempCreate
afterExactWrite
afterFileFSync
afterFullFSync
beforeRename
afterRename
afterParentDirectoryFSync
afterFinalReread
afterHashVerified
beforeACK
afterDurableReceiptReturned
```

Policy points:

```text
afterOrdinaryDirectoryDurable
afterEmptyOrdinaryIndexDurable
afterOrdinaryBlobsDirectoryDurable
afterOrdinaryBlobDurable
afterPreparedOrdinaryIndexDurable
afterPrimaryDurableBeforeACK
afterCommittedOrdinaryIndexDurable
afterSnapshotDirectoryDurable
afterEmptySnapshotIndexDurable
afterSnapshotBlobDurable
afterSnapshotIndexDurable
beforeRetentionUnlink
afterRetentionUnlink
afterRetentionDirectoryFSync
beforeRecoveryHealthClear
afterRecoveryHealthClear
```

### 12.2 Harness

`AssetTrackerFaultHarness` is a SwiftPM executable depending only on `AssetTrackerCore`. At a requested fault point it emits one newline-terminated marker to stdout, flushes it, and pauses. XCTest waits for the marker, sends `SIGKILL`, then invokes a separate fresh verifier process against the same canonical directory. Merely constructing another store object inside the XCTest process is insufficient.

Required invariants:

- before primary rename, the primary is the exact old bytes;
- after primary rename, the primary is exact old or exact complete new, never partial;
- a kill at `beforeACK` may leave the durable new file but can never leave an ACK claim;
- a kill after `afterDurableReceiptReturned` always leaves the exact new bytes/hash; this marker proves the Core durable receipt, not WKWebView delivery;
- process death releases `flock` and a fresh process can acquire it;
- an orphan temp is never indexed or offered as recovery;
- failure to establish ordinary safety state leaves the primary unchanged;
- snapshot retention never touches a final-namespace sentinel.

Coordinator/Bridge tests separately prove `durable receipt -> gate H1 -> response pipeline enqueue`, and Web transport tests prove delivery cannot precede that ordering. The harness must not call a Core receipt marker a Web-delivered ACK.

The harness must be built explicitly:

```bash
swift build --package-path macos-app --product AssetTrackerFaultHarness
ASSET_TRACKER_FAULT_HARNESS="$(swift build --package-path macos-app --show-bin-path)/AssetTrackerFaultHarness" \
  swift test --package-path macos-app --filter ProcessKillRecoveryTests
```

## 13. Required RED-to-GREEN matrix

### JavaScript queue

1. enqueue-time snapshot freeze;
2. two deferred receipts prove FIFO and max active one;
3. H0 -> H1 -> H2 advances only after each exact receipt;
4. wrong save ID, payload hash, source hash, durability, or state hash is rejected;
5. 100 rapid accepted snapshots persist the 100th exact state;
6. first explicit failure cancels active/pending/future and calls `onFault` once;
7. a known failure after one ACK restores that ACK snapshot;
8. first known failure restores the load-confirm snapshot;
9. timeout preserves the active attempted snapshot and becomes `durability-unknown`;
10. late receipt after timeout cannot move the queue or adapter-derived expected hash;
11. timeout terminalizes native and requires relaunch;
12. `saving` transition occurs in the enqueue turn;
13. Web/native durability and copy are exact;
14. localStorage runs through the same FIFO;
15. no public reset/rebase API exists; load/retry replaces only an idle pre-use queue with a fresh generation;
16. rejection remains observable to await while legacy fire-and-forget produces no unhandled rejection;
17. successful load/retry rebases a new queue generation;
18. H1 ACK while H2 is pending advances expected hash but never publishes stable H1 success;
19. barrier orders save H1 -> snapshot H1 -> save H2 without moving hash during snapshot;
20. barrier freezes ID, reason, session, and descriptor fields at enqueue time;
21. a known-not-created snapshot rejects only its promise and then dispatches H2 from H1;
22. barrier timeout/malformed receipt halts, cancels H2, preserves durable H1, and becomes snapshot-outcome-unknown;
23. snapshot source/session conflict halts pending saves;
24. completion from generation N cannot change generation N+1 UI/data;
25. adapter-resolved `{ok:false}` is forbidden and treated as unknown;
26. the legacy rejection observer remains total even when its underlying observer throws;
27. enqueue during an active barrier emits synchronously but keeps `barrier-running`;
28. reentrant `onAcknowledged` enqueue cannot be overwritten by a stale drain transition;
29. snapshot degradation survives a healthy ordinary save, and ordinary degradation survives a healthy snapshot;
30. only an authoritative same-domain audit clears its degradation;
31. invalid candidate while H1 is active ends at H1 if H1 ACKs, H0 if H1 is proven not committed, and H1-attempted if H1 is unknown;
32. normalize/stringify/hash/validator throws append a zero-I/O marker and create no unhandled rejection;
33. active, pending-not-dispatched, and future-halted errors have distinct required types;
34. all seven persistence terminalization reasons are accepted, queued behind active native I/O, and cannot unlock Web state;
35. confirmed-missing baseline uses null through first-save receipt and known-failure rollback;
36. caller cannot inject an operation closure or override the queue-owned barrier deadline/session;
37. Web initial/save/reload keeps both recovery domains not-applicable and rejects a Web ordinary-health claim;
38. false `not-committed` without exact source proof becomes unknown, including bridge field preservation and null-source proof;
39. H1 ACK followed by a preparation marker has no intermediate durable-success transition, and markers count as pending with `accepting=false`;
40. pre-dispatch `onTransition` throw performs zero I/O; post-receipt `onAcknowledged`/`onTransition` throw preserves save or barrier receipt success and cancels later items;
41. `onFault` throw cannot create a second callback or unhandled rejection;
42. Task 3 tests explicitly document that legacy browser auto-backup routing remains until Task 4;
43. H2 transition failure while H1 is active replaces H2 in place: H1 ACK makes H2 CallbackError/H3 abort, while H1 not-committed/unknown makes H1 the sole cause; reentrant H3 cannot jump the marker;
44. both complete immutable health objects round-trip through `getState`, reject cross-domain replacement, and cannot be mutated from outside;
45. snapshot receipt requires `snapshotHash === sourceHash === barrierExpectedHash`;
46. false/non-null, true/null, malformed, and cross-domain persisted-health tuples make save/snapshot errors unknown and never continue H2 with stale healthy state;
47. H1 save or snapshot post-receipt callback failure is fenced before H2 dispatch and produces zero H2 adapter/native calls;
48. callbacks and adapter-side later mutation cannot change canonical deep-frozen save/snapshot receipts or nested health returned to Task 4;
49. resolved, rejected, and never-settling callback thenables are consumed as immediate protocol failures without dispatching H2 or creating an unhandled rejection;
50. post-operation H2/H3 aborts, future halted errors, terminal cause, and `onFault` share one immutable callback fault ID and completed save/snapshot outcome correlation;
51. a valid known-not-created barrier fences its transition before H2; throw/non-undefined/three thenable variants keep the original SnapshotError and cause zero H2 I/O;
52. alternating/second-read-throwing/nested getters and Proxy traps prove every allowed receipt/error field is extracted once before validation;
53. throwing `then` getter, settle-then-throw, double settlement, and nonthenable non-undefined callback returns are consumed without escape or a second fault, including `onFault`;
54. the first caller reaction on a native save/barrier Promise observes the fully completed callback fence/terminal state and cannot synchronously display success before it;
55. terminalization ACK has exact protocol/load/reason/gate fields and is emitted only after native gate lock;
56. native load health container round-trips both complete domains, while missing/malformed health prevents writable confirmation without invented defaults;
57. native `updatedAt`/`storagePath` round-trip from the durable receipt, are type-validated, and cannot substitute for commit-proof fields.

### Native writer and store

1. zero-byte, large, short-write, and `EINTR` behavior;
2. sibling exclusive no-follow temp and private mode;
3. exact syscall/verification ordering through `F_FULLFSYNC`;
4. create-only content-address collision never overwrites;
5. symlink, non-regular, wrong owner, wrong mode, and unexpected managed ACL fail closed;
6. two processes starting at H0 allow exactly one CAS winner;
7. H0/H1/H2 rotation yields previous-1 H1 and previous-2 H0;
8. previous-copy/index failure leaves H0 exact;
9. prepared-index crash with old primary preserves committed slots, while new primary promotes next slots;
10. committed/prepared source, slot, order, and canonical-next relationships are rejected when inconsistent even if all blobs exist;
11. H0 -> H1 -> H0 excludes current H0 from history, and candidate-equals-source is a verified no-op;
12. virgin ordinary uses `directory -> empty index -> blobs directory`, snapshot uses `directory -> empty index -> blob`, and both survive every temp/write/fsync/full-sync/pre-rename kill boundary without mistaking a legal intermediate for corruption;
13. repeat after crash never duplicates or drops a logical generation;
14. root, lock, ordinary, and snapshot directory inode replacement never produces an ACK;
15. external source change after initial CAS and before rename is never overwritten;
16. valid Task 2 `0755` root/`0644` primary upgrades without data loss, while new managed output is private;
17. corrupt/changed current or domain-invalid candidate cannot be overwritten or snapshotted;
18. every retained snapshot blob is reverified before index commit;
19. 25th snapshot leaves at most 24 and preserves newest 3 under clock rollback and equal timestamps;
20. a verified hash already retained deduplicates without changing ordinal/time;
21. ordinary promote/reconcile atomically records every newly unreferenced blob as pending;
22. snapshot final index atomically contains at most 24 plus canonical pending—never a durable 25-entry state;
23. a pending/orphan hash reused as a newly created logical point gets a new ordinal, is removed from pending before cleanup, and is never unlinked;
24. `afterSnapshotBlobDurable` orphan makes audit degraded and is safely rescued or cleaned on the next mutation;
25. duplicate/intersecting/noncanonical maintenance metadata fails closed;
26. cleanup failure persists same-domain health and returns durable-but-degraded;
27. same-domain audit clears health while cross-domain success does not, including virgin/degraded no-op and restart;
28. final namespace sentinel survives every scan;
29. coordinator advances gate only after durable receipt and before ACK delivery;
30. structured pre-commit/unknown errors and persisted health evidence survive the bridge;
31. terminalization during a durable write waits for its result, then locks the session;
32. snapshot and save share native single-flight coordination;
33. the mutation-lock scope is reusable by Task 7 and rejects recursive acquisition; control-store integration tests remain Task 7 work;
34. native load distinguishes absent, indexless-empty, validated empty-index-temp, and valid empty-index domains as specified, including mixed ordinary/snapshot applicability;
35. `afterOrdinaryBlobDurable` fresh load is degraded, then both a distinct retry and candidate-equals-source no-op converge without exposing the orphan as a prior generation;
36. every ordinary/snapshot index replacement keeps pending and `lastHealthCode` atomic, including crash immediately after committed index and before/after health clear;
37. retained same-hash is deduplicated without a new ordinal, whereas pending/orphan same-hash is created with exactly one fresh ordinal; ordinal uniqueness/range/overflow are enforced;
38. root, lock, and snapshot-directory swaps after final snapshot-index commit yield unknown/no receipt, never known-not-created;
39. ordinary/snapshot pending cleanup failure returns durable-degraded only after authoritative state and persisted pending health reverify, while maintenance-clear rename/sync/reread uncertainty is unknown;
40. virgin and degraded candidate-equals-source no-ops classify injected identity/faults on both sides of their explicit final verification point;
41. static contract/routing tests reject any generic snapshot classification based on a primary-rename checkpoint;
42. `storage.load` emits the explicit dual-health container only after both native domain audits complete, and malformed/incomplete health cannot be confirmed writable;
43. terminalization response is enqueued only after the bound gate is terminal-locked and returns the first stable reason;
44. durable save maps envelope `updatedAt` and canonical primary `storagePath` losslessly through Core/Bridge without using either as hash proof.

### Process crash

1. `SIGKILL` at every writer checkpoint converges to old-or-complete-new;
2. before-receipt kill makes no durable-receipt claim;
3. after-durable-receipt kill preserves exact new bytes;
4. killed process releases the lock;
5. orphan temp and orphan unindexed blob are not recovery points;
6. prepared old/new/index decisions and snapshot/final-namespace invariants survive a separate fresh verifier process;
7. canonical root/lock/managed-directory swaps and the initial-index kill matrix produce no false receipt;
8. ordinary directory/index/blobs creation kills reopen to exactly the allowed virgin/applicable state;
9. snapshot final-index and recovery-health-clear commit boundaries preserve truthful unknown/health semantics after restart.

## 14. Files in scope

The Phase 1 plan's Task 3 file inventory is extended to include the integration surfaces required by this contract:

- `legacy-safety.js`
- `script.js`
- `tests/save-queue.test.js`
- `tests/data-recovery.test.js` when terminalization/error metadata requires regression coverage
- `tests/macos-scaffold.test.js`
- `macos-app/Package.swift`
- `macos-app/Sources/AssetTrackerCore/NativeDurableFileWriter.swift`
- `macos-app/Sources/AssetTrackerCore/AssetTrackerBookStore.swift`
- `macos-app/Sources/AssetTrackerCore/AssetTrackerStorageCoordinator.swift`
- `macos-app/Sources/AssetTrackerCore/AssetTrackerBridgeResponse.swift`
- `macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift`
- `macos-app/Sources/AssetTrackerFaultHarness/main.swift`
- `macos-app/Tests/AssetTrackerCoreTests/NativeDurableFileWriterTests.swift`
- `macos-app/Tests/AssetTrackerCoreTests/ProcessKillRecoveryTests.swift`
- existing Core tests extended for coordinator/bridge integration.

`macos-app/Resources/Web` remains a generated release artifact and is not synchronized until Task 11.

## 15. Verification gate

Task 3 cannot be approved on mocked exceptions alone. All commands below must pass from a clean worktree after the implementation commit is staged:

```bash
node --check legacy-safety.js
node --check script.js
node --test tests/save-queue.test.js
node --test tests/data-recovery.test.js tests/web-storage.test.js tests/macos-scaffold.test.js
node --test tests/*.test.js

swift build --package-path macos-app --product AssetTrackerFaultHarness
swift test --package-path macos-app --filter NativeDurableFileWriterTests
ASSET_TRACKER_FAULT_HARNESS="$(swift build --package-path macos-app --show-bin-path)/AssetTrackerFaultHarness" \
  swift test --package-path macos-app --filter ProcessKillRecoveryTests
swift test --package-path macos-app
swift build --package-path macos-app
swift test --package-path macos-app -Xswiftc -strict-concurrency=complete -Xswiftc -warnings-as-errors

git diff --check
```

The normal Node suite may retain only the already-approved staged-assets release skip. A staged-assets byte-equality gate remains Task 11 work.

## 16. Approval rules

Reviewers must reject Task 3 if any of the following remains possible:

- a second save reads an unacknowledged or adapter-mutated hash;
- a timeout or malformed ACK advances the queue;
- a caller-controlled closure/session/deadline can enter a barrier descriptor;
- an unknown outcome is displayed as rolled back or failed-before-write;
- a known pre-commit failure leaves later pending mutations visible as durable;
- a local candidate-preparation failure rolls back past an earlier in-flight item or dispatches storage I/O;
- a callback-failure marker can overtake an earlier item, leave its triggering item ambiguous, or invoke a second fault;
- a later adapter can dispatch before every lane-continuing post-operation callback wrapper succeeds;
- a mutable or shared adapter receipt can be changed by a callback or after resolution;
- an adapter getter/Proxy field can be read twice across extraction and validation;
- a callback thenable can block the lane, escape unhandled, or dispatch a later item;
- pending cancellation and future halted enqueue use an indistinguishable active-storage error;
- native terminalization is absent, uses an unrecognized reason, or can unlock Web terminal state;
- terminalization ACK can precede native gate lock or omit its bound load/first reason;
- an item ACK publishes stable success while a later lane item is pending;
- a barrier result advances the primary ledger or an unknown barrier permits later saves;
- a known-not-created barrier can continue H2 before its transition callback fence succeeds;
- a snapshot receipt does not prove `snapshotHash == sourceHash == captured head`;
- ordinary-domain success clears snapshot degradation, or the reverse;
- native load can invent a missing health domain or confirm writable without a complete dual-domain audit;
- persisted-health flags/evidence are inconsistent, cross-domain, lossy, or allow stale healthy state to continue;
- a completion from an obsolete queue generation changes current UI or data;
- native ACK occurs before full file/directory synchronization and reread/hash verification;
- an authoritative commit uncertainty is mislabeled durable-degraded, or a proven pending-only cleanup failure is mislabeled as loss of primary durability;
- source CAS happens outside the mutation lock;
- source is not revalidated immediately before primary rename;
- a candidate-equals-source save has no explicit final logical verification point;
- canonical root, lock, or managed-directory identity can change without invalidating the receipt;
- previous-state establishment fails but the primary is still replaced;
- a prepared ordinary index cannot deterministically reconcile both old- and new-primary crash outcomes;
- a virgin namespace can create a blob before a durable empty index;
- a legitimate virgin directory/index initialization crash has no deterministic load-health state;
- an index can reference an unverified or missing recovery blob;
- pending cleanup and its persisted health code can tear across index replacements;
- a pending/orphan snapshot hash can re-enter retained state without a new logical ordinal;
- snapshot retention depends on wall-clock ordering rather than a persistent ordinal;
- snapshot scheduling races a save outside the queue barrier;
- cleanup degradation causes false failure, false green success, or primary hash rollback;
- Task 3 code touches the final-freeze namespace;
- exception tests pass but fresh-process `SIGKILL` tests are absent;
- production routing claims Task 4's caller/success/auto-backup work is complete.
