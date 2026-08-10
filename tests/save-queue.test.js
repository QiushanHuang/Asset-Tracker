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

function makeOptions(overrides = {}) {
    return {
        write: () => Promise.reject(new Error('unexpected write')),
        snapshot: () => Promise.reject(new Error('unexpected snapshot')),
        terminalize: () => Promise.resolve({
            ok: true,
            protocolVersion: 2,
            loadId: 'load-1',
            reason: 'save-not-committed',
            gateState: 'terminal-locked'
        }),
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
        clock: { setTimeout, clearTimeout },
        onTransition: () => undefined,
        onAcknowledged: () => undefined,
        onFault: () => undefined,
        ...overrides
    };
}

function makeQueue(overrides = {}) {
    return new LegacySafety.AssetTrackerSaveQueue(makeOptions(overrides));
}

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

function browserReceipt(item, sourceHashBefore, stateHashAfter, overrides = {}) {
    return Object.freeze({
        ok: true,
        clientSaveId: item.clientSaveId,
        payloadHash: item.payloadHash,
        sourceHashBefore,
        stateHashAfter,
        stateHash: stateHashAfter,
        byteCount: new TextEncoder().encode(item.stateJson).byteLength,
        durability: 'browser-local-committed',
        updatedAt: '2026-08-10T00:00:00.000Z',
        storagePath: 'localStorage:assetTrackerData',
        recoveryHealth: health('none', 'not-applicable'),
        ...overrides
    });
}

function snapshotReceipt(item, sourceHash = item.expectedHash, overrides = {}) {
    return Object.freeze({
        ok: true,
        clientSnapshotId: item.clientSnapshotId,
        sourceHash,
        snapshotHash: sourceHash,
        ordinal: 0,
        snapshotStatus: 'created',
        durability: 'native-durable',
        retainedCount: 1,
        recoveryHealth: health('snapshot'),
        ...overrides
    });
}

function structuredSaveError(item, overrides = {}) {
    const error = new LegacySafety.AssetTrackerSaveError('disk full');
    Object.assign(error, {
        code: 'write-failed',
        writeOutcome: 'not-committed',
        conflict: false,
        clientSaveId: item.clientSaveId,
        payloadHash: item.payloadHash,
        sourceHashAfter: item.expectedHash,
        sourceReverified: true,
        coordinatorReleased: true,
        healthPersisted: false,
        recoveryHealthEvidence: null,
        ...overrides
    });
    return error;
}

function structuredSnapshotError(item, overrides = {}) {
    const error = new LegacySafety.AssetTrackerSnapshotError('snapshot failed');
    Object.assign(error, {
        code: 'snapshot-failed',
        snapshotOutcome: 'not-created',
        conflict: false,
        clientSnapshotId: item.clientSnapshotId,
        sourceHashAfter: item.expectedHash,
        sourceReverified: true,
        coordinatorReleased: true,
        healthPersisted: false,
        recoveryHealthEvidence: null,
        ...overrides
    });
    return error;
}

function oneReadTypedSaveError(item, overrides = {}) {
    const values = {
        code: 'write-failed',
        message: 'disk full',
        writeOutcome: 'not-committed',
        conflict: false,
        clientSaveId: item.clientSaveId,
        payloadHash: item.payloadHash,
        sourceHashAfter: item.expectedHash,
        sourceReverified: true,
        coordinatorReleased: true,
        healthPersisted: false,
        recoveryHealthEvidence: null,
        ...overrides
    };
    const reads = Object.create(null);
    const target = new LegacySafety.AssetTrackerSaveError(values.message);
    const source = new Proxy(target, {
        get(object, key, receiver) {
            if (Object.prototype.hasOwnProperty.call(values, key)) {
                reads[key] = (reads[key] || 0) + 1;
                if (reads[key] !== 1) throw new Error(`saveError.${key} was read more than once`);
                return values[key];
            }
            return Reflect.get(object, key, receiver);
        },
        ownKeys() {
            throw new Error('saveError source was enumerated');
        },
        getOwnPropertyDescriptor() {
            throw new Error('saveError source descriptor was inspected');
        }
    });
    return {
        source,
        values,
        assertEachReadOnce() {
            for (const key of Object.keys(values)) {
                assert.equal(reads[key], 1, `saveError.${key} read count`);
            }
        }
    };
}

function oneReadTypedSnapshotError(item, overrides = {}) {
    const values = {
        code: 'snapshot-failed',
        message: 'snapshot failed',
        snapshotOutcome: 'not-created',
        conflict: false,
        clientSnapshotId: item.clientSnapshotId,
        sourceHashAfter: item.expectedHash,
        sourceReverified: true,
        coordinatorReleased: true,
        healthPersisted: false,
        recoveryHealthEvidence: null,
        ...overrides
    };
    const reads = Object.create(null);
    const target = new LegacySafety.AssetTrackerSnapshotError(values.message);
    const source = new Proxy(target, {
        get(object, key, receiver) {
            if (Object.prototype.hasOwnProperty.call(values, key)) {
                reads[key] = (reads[key] || 0) + 1;
                if (reads[key] !== 1) throw new Error(`snapshotError.${key} was read more than once`);
                return values[key];
            }
            return Reflect.get(object, key, receiver);
        },
        ownKeys() {
            throw new Error('snapshotError source was enumerated');
        },
        getOwnPropertyDescriptor() {
            throw new Error('snapshotError source descriptor was inspected');
        }
    });
    return {
        source,
        values,
        assertEachReadOnce() {
            for (const key of Object.keys(values)) {
                assert.equal(reads[key], 1, `snapshotError.${key} read count`);
            }
        }
    };
}

function terminalReceipt(request, overrides = {}) {
    return Object.freeze({
        ok: true,
        protocolVersion: 2,
        loadId: request.sessionContext.loadId,
        reason: request.reason,
        gateState: 'terminal-locked',
        ...overrides
    });
}

function manualClock() {
    let nextHandle = 0;
    const scheduled = new Map();
    return {
        clock: {
            setTimeout(callback, delay) {
                nextHandle += 1;
                scheduled.set(nextHandle, { callback, delay });
                return nextHandle;
            },
            clearTimeout(handle) {
                scheduled.delete(handle);
            }
        },
        count(delay) {
            return Array.from(scheduled.values()).filter(entry => entry.delay === delay).length;
        },
        runDelay(delay) {
            const due = Array.from(scheduled.entries()).filter(([, entry]) => entry.delay === delay);
            for (const [handle, entry] of due) {
                scheduled.delete(handle);
                entry.callback();
            }
        }
    };
}

function reentrantClearClock() {
    let durabilityCallback = null;
    let durabilityClearCount = 0;
    return {
        clock: {
            setTimeout(callback, delay) {
                if (delay === 29_000) {
                    durabilityCallback = callback;
                    return 'durability-handle';
                }
                return 'terminal-handle';
            },
            clearTimeout(handle) {
                if (handle !== 'durability-handle' || durabilityCallback === null) return;
                durabilityClearCount += 1;
                const callback = durabilityCallback;
                durabilityCallback = null;
                callback();
            }
        },
        durabilityClearCount: () => durabilityClearCount
    };
}

function oneReadRecord(label, values) {
    const keys = Object.keys(values);
    const reads = Object.create(null);
    const record = new Proxy(Object.create(null), {
        get(_target, key) {
            if (key === 'then') return undefined;
            if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(values, key)) {
                throw new Error(`${label}.${String(key)} was not an allowed field`);
            }
            reads[key] = (reads[key] || 0) + 1;
            if (reads[key] !== 1) throw new Error(`${label}.${key} was read more than once`);
            return values[key];
        },
        ownKeys() {
            throw new Error(`${label} source was enumerated`);
        },
        getOwnPropertyDescriptor() {
            throw new Error(`${label} source descriptor was inspected`);
        }
    });

    return {
        record,
        assertEachReadOnce() {
            for (const key of keys) {
                assert.equal(reads[key], 1, `${label}.${key} read count`);
            }
        }
    };
}

function sequencedRecord(sequences) {
    const reads = Object.create(null);
    const record = {};
    for (const [key, sequence] of Object.entries(sequences)) {
        const values = Array.isArray(sequence) ? sequence : [sequence];
        Object.defineProperty(record, key, {
            enumerable: true,
            get() {
                const index = reads[key] || 0;
                reads[key] = index + 1;
                return values[Math.min(index, values.length - 1)];
            }
        });
    }
    return record;
}

test('constructor boundary exports the five typed queue error classes', () => {
    const errorTypes = [
        'AssetTrackerSaveError',
        'AssetTrackerSnapshotError',
        'AssetTrackerQueueAbortError',
        'AssetTrackerQueueHaltedError',
        'AssetTrackerQueueCallbackError'
    ].map(exportName => {
        assert.equal(typeof LegacySafety[exportName], 'function', `${exportName} is exported`);
        assert.equal(LegacySafety[exportName].prototype instanceof Error, true);
        return LegacySafety[exportName];
    });

    assert.equal(new Set(errorTypes).size, errorTypes.length, 'error types are pairwise distinct');
});

test('constructor rejects non-positive or save/barrier deadlines >= transport deadline', () => {
    for (const overrides of [
        { durabilityDeadlineMs: 0 },
        { durabilityDeadlineMs: -1 },
        { durabilityDeadlineMs: 30_000 },
        { barrierDeadlineMs: 0 },
        { barrierDeadlineMs: -1 },
        { barrierDeadlineMs: 30_000 }
    ]) {
        assert.throws(
            () => makeQueue(overrides),
            error => error instanceof TypeError && /deadline/i.test(error.message)
        );
    }
});

test('constructor freezes session context and complete ordinary/snapshot health', () => {
    const queue = makeQueue();
    const configuration = queue.queueConfiguration;

    assert.equal(Object.isFrozen(configuration), true);
    assert.equal(Object.isFrozen(configuration.sessionContext), true);
    assert.equal(Object.isFrozen(configuration.initialAcknowledged), true);
    assert.equal(Object.isFrozen(configuration.initialRecoveryHealth), true);
    assert.equal(Object.isFrozen(configuration.initialRecoveryHealth.ordinary), true);
    assert.equal(Object.isFrozen(configuration.initialRecoveryHealth.snapshot), true);
    assert.equal(Object.isFrozen(configuration.clock), true);
    assert.deepEqual(configuration.sessionContext, {
        protocolVersion: 2,
        loadId: 'load-1',
        writeSessionToken: 'token-1'
    });
    assert.deepEqual(configuration.initialRecoveryHealth.ordinary, health('ordinary'));
    assert.deepEqual(configuration.initialRecoveryHealth.snapshot, health('snapshot'));
});

test('initial health accepts a detached frozen incomplete audit only when degraded', () => {
    const ordinary = {
        domain: 'ordinary',
        status: 'degraded',
        auditComplete: false,
        code: 'audit-incomplete',
        maintenancePendingCount: 0,
        detail: 'ordinary recovery audit did not complete'
    };
    const queue = makeQueue({
        initialRecoveryHealth: {
            ordinary,
            snapshot: health('snapshot')
        }
    });
    const initialState = queue.getState();

    ordinary.detail = 'mutated after construction';

    assert.deepEqual(initialState.ordinaryRecoveryHealth, {
        domain: 'ordinary',
        status: 'degraded',
        auditComplete: false,
        code: 'audit-incomplete',
        maintenancePendingCount: 0,
        detail: 'ordinary recovery audit did not complete'
    });
    assert.notStrictEqual(initialState.ordinaryRecoveryHealth, ordinary);
    assert.equal(Object.isFrozen(initialState.ordinaryRecoveryHealth), true);
    assert.equal(queue.getState().ordinaryRecoveryHealth.detail, 'ordinary recovery audit did not complete');
});

test('getState returns immutable detached complete health objects', () => {
    const queue = makeQueue();
    const first = queue.getState();
    const second = queue.getState();

    assert.deepEqual(first, {
        generationToken: 'generation-1',
        lanePhase: 'idle',
        primaryStatus: 'none',
        barrierState: 'none',
        activeClientSaveId: null,
        activeClientSnapshotId: null,
        pendingCount: 0,
        lastAcknowledgedHash: H0,
        ordinaryRecoveryHealth: health('ordinary'),
        snapshotRecoveryHealth: health('snapshot'),
        accepting: true,
        halted: false
    });
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first.ordinaryRecoveryHealth, second.ordinaryRecoveryHealth);
    assert.notStrictEqual(first.snapshotRecoveryHealth, second.snapshotRecoveryHealth);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.ordinaryRecoveryHealth), true);
    assert.equal(Object.isFrozen(first.snapshotRecoveryHealth), true);
    assert.throws(() => { first.ordinaryRecoveryHealth.status = 'degraded'; }, TypeError);
    assert.equal(queue.getState().ordinaryRecoveryHealth.status, 'healthy');
});

test('constructor rejects cross-domain, incomplete, or contradictory initial health', () => {
    const invalidHealthPairs = [
        {
            ordinary: health('snapshot'),
            snapshot: health('snapshot')
        },
        {
            ordinary: {
                domain: 'ordinary',
                status: 'healthy',
                auditComplete: true,
                code: null,
                maintenancePendingCount: 0
            },
            snapshot: health('snapshot')
        },
        {
            ordinary: health('ordinary', 'healthy', {
                code: 'maintenance-pending',
                maintenancePendingCount: 1,
                detail: 'contradiction'
            }),
            snapshot: health('snapshot')
        },
        {
            ordinary: health('ordinary'),
            snapshot: health('snapshot', 'degraded', {
                code: null,
                maintenancePendingCount: 0
            })
        },
        {
            ordinary: health('ordinary', 'healthy', { auditComplete: false }),
            snapshot: health('snapshot')
        },
        {
            ordinary: health('ordinary'),
            snapshot: health('snapshot', 'not-applicable', { auditComplete: false })
        }
    ];

    for (const initialRecoveryHealth of invalidHealthPairs) {
        assert.throws(
            () => makeQueue({ initialRecoveryHealth }),
            error => error instanceof TypeError && /health/i.test(error.message)
        );
    }
});

test('mutating the constructor input after construction cannot change queue state', () => {
    const sessionContext = { protocolVersion: 2, loadId: 'load-1', writeSessionToken: 'token-1' };
    const initialAcknowledged = { stateJson: '{"memo":"H0"}', stateHash: H0 };
    const ordinary = { ...health('ordinary') };
    const snapshot = { ...health('snapshot') };
    const initialRecoveryHealth = { ordinary, snapshot };
    const clock = { setTimeout, clearTimeout };
    const options = makeOptions({
        sessionContext,
        initialAcknowledged,
        initialRecoveryHealth,
        generationToken: 'generation-1',
        clock
    });
    const queue = new LegacySafety.AssetTrackerSaveQueue(options);

    sessionContext.loadId = 'load-mutated';
    sessionContext.writeSessionToken = 'token-mutated';
    initialAcknowledged.stateJson = '{"memo":"mutated"}';
    initialAcknowledged.stateHash = H1;
    ordinary.status = 'degraded';
    snapshot.detail = 'mutated';
    initialRecoveryHealth.ordinary = health('ordinary', 'degraded');
    clock.setTimeout = () => { throw new Error('mutated clock'); };
    options.generationToken = 'generation-mutated';

    assert.deepEqual(queue.queueConfiguration.sessionContext, {
        protocolVersion: 2,
        loadId: 'load-1',
        writeSessionToken: 'token-1'
    });
    assert.deepEqual(queue.queueConfiguration.initialAcknowledged, {
        stateJson: '{"memo":"H0"}',
        stateHash: H0
    });
    assert.strictEqual(queue.queueConfiguration.clock.setTimeout, setTimeout);
    assert.deepEqual(queue.getState(), {
        generationToken: 'generation-1',
        lanePhase: 'idle',
        primaryStatus: 'none',
        barrierState: 'none',
        activeClientSaveId: null,
        activeClientSnapshotId: null,
        pendingCount: 0,
        lastAcknowledgedHash: H0,
        ordinaryRecoveryHealth: health('ordinary'),
        snapshotRecoveryHealth: health('snapshot'),
        accepting: true,
        halted: false
    });
});

test('constructor and getState use captured freeze and Reflect intrinsics', () => {
    const options = makeOptions();
    const originalFreeze = Object.freeze;
    const originalReflectGet = Reflect.get;
    let queue;
    let state;

    try {
        Object.freeze = () => { throw new Error('poisoned Object.freeze'); };
        Reflect.get = () => { throw new Error('poisoned Reflect.get'); };
        queue = new LegacySafety.AssetTrackerSaveQueue(options);
        state = queue.getState();
    } finally {
        Object.freeze = originalFreeze;
        Reflect.get = originalReflectGet;
    }

    assert.equal(Object.isFrozen(queue.queueConfiguration), true);
    assert.equal(Object.isFrozen(state), true);
    assert.equal(state.lastAcknowledgedHash, H0);
    assert.deepEqual(state.ordinaryRecoveryHealth, health('ordinary'));
});

test('constructor extracts every allowed source field exactly once without enumeration', () => {
    const session = oneReadRecord('sessionContext', {
        protocolVersion: 2,
        loadId: 'load-1',
        writeSessionToken: 'token-1'
    });
    const acknowledged = oneReadRecord('initialAcknowledged', {
        stateJson: '{"memo":"H0"}',
        stateHash: H0
    });
    const ordinary = oneReadRecord('ordinaryHealth', {
        domain: 'ordinary',
        status: 'healthy',
        auditComplete: true,
        code: null,
        maintenancePendingCount: 0,
        detail: null
    });
    const snapshot = oneReadRecord('snapshotHealth', {
        domain: 'snapshot',
        status: 'healthy',
        auditComplete: true,
        code: null,
        maintenancePendingCount: 0,
        detail: null
    });
    const recoveryHealth = oneReadRecord('initialRecoveryHealth', {
        ordinary: ordinary.record,
        snapshot: snapshot.record
    });
    const clock = oneReadRecord('clock', { setTimeout, clearTimeout });
    const options = oneReadRecord('options', {
        write: () => Promise.reject(new Error('unexpected write')),
        snapshot: () => Promise.reject(new Error('unexpected snapshot')),
        terminalize: () => Promise.resolve({ ok: true }),
        sessionContext: session.record,
        initialAcknowledged: acknowledged.record,
        initialRecoveryHealth: recoveryHealth.record,
        expectedDurability: 'native-durable',
        durabilityDeadlineMs: 29_000,
        barrierDeadlineMs: 29_000,
        transportDeadlineMs: 30_000,
        generationToken: 'generation-1',
        clock: clock.record,
        onTransition: () => undefined,
        onAcknowledged: () => undefined,
        onFault: () => undefined
    });

    const queue = new LegacySafety.AssetTrackerSaveQueue(options.record);
    const state = queue.getState();

    for (const source of [options, session, acknowledged, ordinary, snapshot, recoveryHealth, clock]) {
        source.assertEachReadOnce();
    }
    assert.notStrictEqual(queue.queueConfiguration.sessionContext, session.record);
    assert.notStrictEqual(queue.queueConfiguration.initialAcknowledged, acknowledged.record);
    assert.notStrictEqual(queue.queueConfiguration.initialRecoveryHealth, recoveryHealth.record);
    assert.notStrictEqual(queue.queueConfiguration.initialRecoveryHealth.ordinary, ordinary.record);
    assert.notStrictEqual(queue.queueConfiguration.initialRecoveryHealth.snapshot, snapshot.record);
    assert.notStrictEqual(queue.queueConfiguration.clock, clock.record);
    assert.equal(state.lastAcknowledgedHash, H0);
});

test('constructor cannot freeze alternating illegal second reads from session or health sources', () => {
    const sessionContext = sequencedRecord({
        protocolVersion: 2,
        loadId: ['load-1', 'load-1', ''],
        writeSessionToken: 'token-1'
    });
    const ordinary = sequencedRecord({
        domain: 'ordinary',
        status: 'healthy',
        auditComplete: true,
        code: [null, 'contradiction'],
        maintenancePendingCount: 0,
        detail: null
    });
    const queue = makeQueue({
        sessionContext,
        initialRecoveryHealth: {
            ordinary,
            snapshot: health('snapshot')
        }
    });

    assert.equal(queue.queueConfiguration.sessionContext.loadId, 'load-1');
    assert.deepEqual(queue.queueConfiguration.initialRecoveryHealth.ordinary, health('ordinary'));
    assert.deepEqual(queue.getState().ordinaryRecoveryHealth, health('ordinary'));
});

test('FIFO enqueue freezes primitive snapshot, hashes non-ASCII UTF-8, and returns an intrinsic Promise', async () => {
    const writeResult = deferred();
    const writeCalls = [];
    const events = [];
    let enqueueReturned = false;
    let transitionAt = null;
    const queue = makeQueue({
        write: request => {
            events.push('write');
            writeCalls.push(request);
            return writeResult.promise;
        },
        onTransition: state => {
            events.push('transition');
            transitionAt = Date.now();
            assert.equal(enqueueReturned, false, 'saving transition is synchronous');
            assert.equal(state.lanePhase, 'saving');
            return undefined;
        }
    });
    const candidate = {
        stateJson: '{"memo":"甲"}',
        reason: 'manual-save',
        expectedHash: H2,
        operation: () => { throw new Error('caller operation must not run'); }
    };
    const expectedPayloadHash = createHash('sha256')
        .update(Buffer.from(candidate.stateJson, 'utf8'))
        .digest('hex');
    const startedAt = Date.now();
    const NativePromise = Promise;
    const nativeObjectFreeze = Object.freeze;
    class CallerPromise extends NativePromise {}
    let savePromise;

    try {
        global.Promise = CallerPromise;
        Object.freeze = () => { throw new Error('caller-controlled Object.freeze'); };
        savePromise = queue.enqueue(candidate);
    } finally {
        global.Promise = NativePromise;
        Object.freeze = nativeObjectFreeze;
    }
    enqueueReturned = true;
    candidate.stateJson = '{"memo":"mutated"}';
    candidate.reason = 'mutated-reason';
    candidate.expectedHash = H2;

    assert.equal(savePromise instanceof NativePromise, true);
    assert.equal(savePromise instanceof CallerPromise, false);
    assert.deepEqual(events, ['transition', 'write']);
    assert.ok(transitionAt - startedAt < 100, 'saving feedback appears within 100 ms');
    assert.equal(writeCalls.length, 1);
    assert.equal(Object.isFrozen(writeCalls[0]), true);
    assert.equal(Object.isFrozen(writeCalls[0].sessionContext), true);
    assert.equal(writeCalls[0].stateJson, '{"memo":"甲"}');
    assert.equal(writeCalls[0].reason, 'manual-save');
    assert.equal(writeCalls[0].expectedHash, H0, 'caller cannot inject expectedHash');
    assert.equal(writeCalls[0].payloadHash, expectedPayloadHash);
    assert.match(writeCalls[0].clientSaveId, /\S/);

    writeResult.resolve(nativeReceipt(writeCalls[0], H0, H1));
    const receipt = await savePromise;
    assert.equal(receipt.stateHashAfter, H1);
    assert.equal(queue.getState().lastAcknowledgedHash, H1);
});

test('FIFO two deferred receipts keep max active one and advance H0 to H1 to H2 only after receipt', async () => {
    const first = deferred();
    const second = deferred();
    const writeResults = [first, second];
    const writeCalls = [];
    const transitions = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const queue = makeQueue({
        write: request => {
            const result = writeResults[writeCalls.length];
            writeCalls.push(request);
            activeWrites += 1;
            maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
            return result.promise.then(receipt => {
                activeWrites -= 1;
                return receipt;
            });
        },
        onTransition: state => {
            transitions.push(state);
            return undefined;
        }
    });

    const firstPromise = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'edit-1' });
    const secondPromise = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'edit-2' });

    assert.equal(writeCalls.length, 1, 'max active write is one');
    assert.equal(writeCalls[0].expectedHash, H0);
    assert.equal(queue.getState().lastAcknowledgedHash, H0);

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

    second.resolve(nativeReceipt(writeCalls[1], H1, H2));
    await secondPromise;

    assert.equal(maxActiveWrites, 1);
    assert.equal(queue.getState().lastAcknowledgedHash, H2);
    assert.equal(queue.getState().primaryStatus, 'native-durable');
    assert.equal(queue.getState().lanePhase, 'idle');
});

test('barrier shares the save FIFO and keeps H1 as the expected head for snapshot and H2', async () => {
    const clock = manualClock();
    const save1 = deferred();
    const snapshot = deferred();
    const save2 = deferred();
    const callKinds = [];
    const saveCalls = [];
    const snapshotCalls = [];
    const queue = makeQueue({
        clock: clock.clock,
        write: request => {
            callKinds.push('save');
            saveCalls.push(request);
            return saveCalls.length === 1 ? save1.promise : save2.promise;
        },
        snapshot: request => {
            callKinds.push('snapshot');
            snapshotCalls.push(request);
            return snapshot.promise;
        }
    });

    const h1 = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'H1' });
    const barrier = queue.runBarrier({ clientSnapshotId: 'snapshot-1', reason: 'manual' });
    const h2 = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'H2' });

    assert.deepEqual(callKinds, ['save']);
    assert.equal(queue.getState().lanePhase, 'saving');
    assert.equal(queue.getState().pendingCount, 3);

    save1.resolve(nativeReceipt(saveCalls[0], H0, H1));
    await h1;
    assert.deepEqual(callKinds, ['save', 'snapshot']);
    assert.equal(snapshotCalls[0].expectedHash, H1);
    assert.equal(queue.getState().lastAcknowledgedHash, H1);
    assert.equal(queue.getState().lanePhase, 'barrier-running');
    assert.equal(queue.getState().barrierState, 'running');
    assert.equal(queue.getState().activeClientSnapshotId, 'snapshot-1');

    snapshot.resolve(snapshotReceipt(snapshotCalls[0], H1));
    await barrier;
    assert.deepEqual(callKinds, ['save', 'snapshot', 'save']);
    assert.equal(saveCalls[1].expectedHash, H1, 'barrier never advances the primary ledger');
    assert.equal(queue.getState().lastAcknowledgedHash, H1);

    save2.resolve(nativeReceipt(saveCalls[1], H1, H2));
    await h2;
    assert.equal(queue.getState().lastAcknowledgedHash, H2);
    assert.equal(queue.getState().lanePhase, 'idle');
});

test('an acknowledged H1 durability fact survives every queued barrier outcome without publishing idle success', async t => {
    for (const outcome of ['created', 'known-not-created', 'unknown']) {
        await t.test(outcome, async () => {
            const clock = manualClock();
            const h1Write = deferred();
            const snapshot = deferred();
            const h2Write = deferred();
            const saveCalls = [];
            const snapshotCalls = [];
            const transitions = [];
            const queue = makeQueue({
                clock: clock.clock,
                write: request => {
                    saveCalls.push(request);
                    return saveCalls.length === 1 ? h1Write.promise : h2Write.promise;
                },
                snapshot: request => {
                    snapshotCalls.push(request);
                    return snapshot.promise;
                },
                terminalize: request => Promise.resolve(terminalReceipt(request)),
                onTransition: state => {
                    transitions.push(state);
                    return undefined;
                }
            });
            const h1 = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'H1' });
            const barrier = queue.runBarrier({
                clientSnapshotId: `snapshot-after-H1-${outcome}`,
                reason: 'manual'
            });
            const h2 = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'H2' });
            const h2Observed = h2.then(
                receipt => receipt,
                error => error
            );

            h1Write.resolve(nativeReceipt(saveCalls[0], H0, H1));
            await h1;
            assert.equal(queue.getState().lanePhase, 'barrier-running');
            assert.equal(queue.getState().lastAcknowledgedHash, H1);
            assert.equal(queue.getState().primaryStatus, 'native-durable');
            assert.equal(
                transitions.some(state => state.lanePhase === 'idle'
                    && state.lastAcknowledgedHash === H1),
                false,
                'H1 ACK is a durability fact but cannot publish stable idle success while work remains'
            );

            if (outcome === 'created') {
                snapshot.resolve(snapshotReceipt(snapshotCalls[0], H1));
                await barrier;
                assert.equal(queue.getState().lanePhase, 'saving');
                assert.equal(queue.getState().primaryStatus, 'native-durable');
                h2Write.resolve(nativeReceipt(saveCalls[1], H1, H2));
                await h2Observed;
            } else if (outcome === 'known-not-created') {
                snapshot.reject(structuredSnapshotError(snapshotCalls[0]));
                const barrierError = await barrier.then(
                    () => assert.fail('known-not-created must reject'),
                    error => error
                );
                assert.equal(barrierError.queueOutcome, 'not-created');
                assert.equal(queue.getState().lanePhase, 'saving');
                assert.equal(queue.getState().primaryStatus, 'native-durable');
                h2Write.resolve(nativeReceipt(saveCalls[1], H1, H2));
                await h2Observed;
            } else {
                snapshot.reject(new Error('snapshot transport lost'));
                const [barrierError, h2Error] = await Promise.all([
                    barrier.then(() => assert.fail('unknown must reject'), error => error),
                    h2Observed
                ]);
                assert.equal(barrierError.terminalReason, 'snapshot-outcome-unknown');
                assert.equal(h2Error instanceof LegacySafety.AssetTrackerQueueAbortError, true);
                assert.equal(queue.getState().lanePhase, 'halted');
                assert.equal(queue.getState().barrierState, 'outcome-unknown');
                assert.equal(queue.getState().lastAcknowledgedHash, H1);
                assert.equal(queue.getState().primaryStatus, 'native-durable');
                assert.equal(saveCalls.length, 1);
            }
        });
    }
});

test('a queued Web H2 cannot hide the browser-local-committed durability fact from H1 ACK', async () => {
    const h1Write = deferred();
    const h2Write = deferred();
    const saveCalls = [];
    const transitions = [];
    const queue = makeQueue({
        expectedDurability: 'browser-local-committed',
        initialRecoveryHealth: {
            ordinary: health('ordinary', 'not-applicable'),
            snapshot: health('snapshot', 'not-applicable')
        },
        write: request => {
            saveCalls.push(request);
            return saveCalls.length === 1 ? h1Write.promise : h2Write.promise;
        },
        onTransition: state => {
            transitions.push(state);
            return undefined;
        }
    });
    const h1 = queue.enqueue({ stateJson: '{"memo":"web-H1"}', reason: 'H1' });
    const h2 = queue.enqueue({ stateJson: '{"memo":"web-H2"}', reason: 'H2' });

    h1Write.resolve(browserReceipt(saveCalls[0], H0, H1));
    await h1;
    assert.equal(queue.getState().lanePhase, 'saving');
    assert.equal(queue.getState().lastAcknowledgedHash, H1);
    assert.equal(queue.getState().primaryStatus, 'browser-local-committed');
    assert.equal(
        transitions.some(state => state.lanePhase === 'idle'
            && state.lastAcknowledgedHash === H1),
        false
    );

    h2Write.resolve(browserReceipt(saveCalls[1], H1, H2));
    await h2;
});

test('runBarrier one-reads and freezes only ID and reason while using queue-owned session hash and deadline', async () => {
    const clock = manualClock();
    const first = deferred();
    const snapshot = deferred();
    const saveCalls = [];
    const snapshotCalls = [];
    const descriptorValues = {
        clientSnapshotId: 'snapshot-frozen',
        reason: 'scheduled'
    };
    const descriptorReads = Object.create(null);
    let injectedFieldReads = 0;
    const descriptor = new Proxy(Object.create(null), {
        get(_target, key) {
            if (key === 'then') return undefined;
            if (['operation', 'sessionContext', 'barrierDeadlineMs'].includes(key)) {
                injectedFieldReads += 1;
                return key === 'operation'
                    ? () => { throw new Error('caller operation must not run'); }
                    : key === 'sessionContext'
                        ? { loadId: 'caller-load', writeSessionToken: 'caller-token' }
                        : 1;
            }
            if (!Object.prototype.hasOwnProperty.call(descriptorValues, key)) {
                throw new Error(`snapshotDescriptor.${String(key)} was not allowed`);
            }
            descriptorReads[key] = (descriptorReads[key] || 0) + 1;
            if (descriptorReads[key] !== 1) {
                throw new Error(`snapshotDescriptor.${key} was read more than once`);
            }
            return descriptorValues[key];
        },
        ownKeys() {
            throw new Error('snapshotDescriptor source was enumerated');
        },
        getOwnPropertyDescriptor() {
            throw new Error('snapshotDescriptor source descriptor was inspected');
        }
    });
    const queue = makeQueue({
        clock: clock.clock,
        barrierDeadlineMs: 17_000,
        write: request => {
            saveCalls.push(request);
            return first.promise;
        },
        snapshot: request => {
            snapshotCalls.push(request);
            return snapshot.promise;
        }
    });
    const h1 = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'H1' });

    const barrier = queue.runBarrier(descriptor);
    descriptorValues.clientSnapshotId = 'mutated-id';
    descriptorValues.reason = 'manual';
    assert.deepEqual({ ...descriptorReads }, { clientSnapshotId: 1, reason: 1 });
    assert.equal(injectedFieldReads, 0);
    first.resolve(nativeReceipt(saveCalls[0], H0, H1));
    await h1;

    assert.equal(snapshotCalls.length, 1);
    assert.deepEqual(snapshotCalls[0], {
        clientSnapshotId: 'snapshot-frozen',
        reason: 'scheduled',
        expectedHash: H1,
        sessionContext: {
            protocolVersion: 2,
            loadId: 'load-1',
            writeSessionToken: 'token-1'
        }
    });
    assert.equal(Object.isFrozen(snapshotCalls[0]), true);
    assert.equal(Object.isFrozen(snapshotCalls[0].sessionContext), true);
    assert.equal(clock.count(17_000), 1, 'caller cannot override the queue-owned barrier deadline');

    snapshot.resolve(snapshotReceipt(snapshotCalls[0], H1));
    await barrier;
});

test('created deduplicated and degraded snapshot receipts update only barrier and snapshot health state', async t => {
    const variants = [
        ['created', 'healthy', 'created'],
        ['deduplicated', 'healthy', 'deduplicated'],
        ['created', 'degraded', 'degraded']
    ];

    for (const [snapshotStatus, healthStatus, barrierState] of variants) {
        await t.test(`${snapshotStatus}-${healthStatus}`, async () => {
            const acknowledged = [];
            const ordinaryDegraded = health('ordinary', 'degraded', {
                code: 'ordinary-pending',
                detail: 'ordinary remains degraded'
            });
            const snapshotHealth = health('snapshot', healthStatus, healthStatus === 'degraded'
                ? { code: 'snapshot-pending', detail: 'snapshot cleanup pending' }
                : {});
            const queue = makeQueue({
                initialRecoveryHealth: {
                    ordinary: ordinaryDegraded,
                    snapshot: health('snapshot', 'degraded')
                },
                snapshot: request => Promise.resolve(snapshotReceipt(request, H0, {
                    snapshotStatus,
                    recoveryHealth: snapshotHealth
                })),
                onAcknowledged: receipt => {
                    acknowledged.push(receipt);
                    return undefined;
                }
            });

            const receipt = await queue.runBarrier({
                clientSnapshotId: `snapshot-${snapshotStatus}-${healthStatus}`,
                reason: 'manual'
            });
            const state = queue.getState();

            assert.equal(receipt.snapshotStatus, snapshotStatus);
            assert.equal(state.barrierState, barrierState);
            assert.equal(state.lanePhase, 'idle');
            assert.equal(state.lastAcknowledgedHash, H0);
            assert.deepEqual(state.ordinaryRecoveryHealth, ordinaryDegraded);
            assert.deepEqual(state.snapshotRecoveryHealth, snapshotHealth);
            assert.equal(acknowledged.length, 1);
            assert.equal(Object.isFrozen(receipt), true);
            assert.equal(Object.isFrozen(receipt.recoveryHealth), true);
        });
    }
});

test('a healthy ordinary save does not clear a degraded snapshot-health domain', async () => {
    const degradedSnapshotHealth = health('snapshot', 'degraded', {
        code: 'snapshot-cleanup-pending',
        detail: 'snapshot cleanup remains pending'
    });
    const queue = makeQueue({
        initialRecoveryHealth: {
            ordinary: health('ordinary', 'degraded'),
            snapshot: degradedSnapshotHealth
        },
        write: request => Promise.resolve(nativeReceipt(request, H0, H1, {
            recoveryHealth: health('ordinary')
        }))
    });

    await queue.enqueue({ stateJson: '{"memo":"healthy-ordinary"}', reason: 'ordinary-save' });

    assert.deepEqual(queue.getState().ordinaryRecoveryHealth, health('ordinary'));
    assert.deepEqual(queue.getState().snapshotRecoveryHealth, degradedSnapshotHealth);
});

test('known-not-created rejects only its barrier, merges strict snapshot health, and continues H2 from the same head', async () => {
    const clock = manualClock();
    const snapshot = deferred();
    const save = deferred();
    const snapshotCalls = [];
    const saveCalls = [];
    const terminalCalls = [];
    const transitions = [];
    const persistedHealth = health('snapshot', 'degraded', {
        code: 'snapshot-orphan-pending',
        detail: 'orphan cleanup pending'
    });
    const queue = makeQueue({
        clock: clock.clock,
        snapshot: request => {
            snapshotCalls.push(request);
            return snapshot.promise;
        },
        write: request => {
            saveCalls.push(request);
            return save.promise;
        },
        terminalize: request => {
            terminalCalls.push(request);
            return Promise.resolve(terminalReceipt(request));
        },
        onTransition: state => {
            transitions.push(state);
            return undefined;
        }
    });
    const barrier = queue.runBarrier({ clientSnapshotId: 'snapshot-not-created', reason: 'manual' });
    const h2 = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'H2' });

    snapshot.reject(structuredSnapshotError(snapshotCalls[0], {
        healthPersisted: true,
        recoveryHealthEvidence: persistedHealth
    }));
    await Promise.resolve();
    assert.equal(queue.getState().barrierState, 'not-created');
    const barrierError = await barrier.then(
        () => assert.fail('known-not-created barrier must reject'),
        error => error
    );

    assert.equal(barrierError instanceof LegacySafety.AssetTrackerSnapshotError, true);
    assert.equal(Object.isFrozen(barrierError), true);
    assert.equal(Object.isFrozen(barrierError.recoveryHealthEvidence), true);
    assert.equal(barrierError.snapshotOutcome, 'not-created');
    assert.equal(queue.getState().barrierState, 'not-created');
    assert.equal(queue.getState().lastAcknowledgedHash, H0);
    assert.deepEqual(queue.getState().snapshotRecoveryHealth, persistedHealth);
    assert.deepEqual(queue.getState().ordinaryRecoveryHealth, health('ordinary'));
    assert.equal(saveCalls.length, 1, 'H2 dispatches only after the rejection transition fence');
    assert.equal(saveCalls[0].expectedHash, H0);
    assert.equal(terminalCalls.length, 0);
    assert.equal(transitions.some(state => state.barrierState === 'not-created'), true);

    save.resolve(nativeReceipt(saveCalls[0], H0, H2));
    await h2;
});

test('malformed snapshot receipts and inconsistent health proof halt unknown and abort H2 with its save ID', async t => {
    const variants = [
        ['wrong source hash', request => Promise.resolve(snapshotReceipt(request, H2))],
        ['wrong snapshot hash', request => Promise.resolve(snapshotReceipt(request, H0, {
            snapshotHash: H2
        }))],
        ['resolved failure union', () => Promise.resolve({ ok: false, error: 'snapshot failed' })],
        ['cross-domain success health', request => Promise.resolve(snapshotReceipt(request, H0, {
            recoveryHealth: health('ordinary')
        }))],
        ['throwing receipt getter', request => Promise.resolve(new Proxy(
            snapshotReceipt(request, H0),
            {
                get(target, key, receiver) {
                    if (key === 'snapshotHash') throw new Error('snapshotHash getter failed');
                    return Reflect.get(target, key, receiver);
                }
            }
        ))],
        ['false with non-null health', request => Promise.reject(structuredSnapshotError(request, {
            healthPersisted: false,
            recoveryHealthEvidence: health('snapshot', 'degraded')
        }))],
        ['true with null health', request => Promise.reject(structuredSnapshotError(request, {
            healthPersisted: true,
            recoveryHealthEvidence: null
        }))],
        ['cross-domain health', request => Promise.reject(structuredSnapshotError(request, {
            healthPersisted: true,
            recoveryHealthEvidence: health('ordinary', 'degraded')
        }))]
    ];

    for (const [label, snapshot] of variants) {
        await t.test(label, async () => {
            const clock = manualClock();
            const saveCalls = [];
            const terminalCalls = [];
            const queue = makeQueue({
                clock: clock.clock,
                snapshot,
                write: request => {
                    saveCalls.push(request);
                    return Promise.reject(new Error('H2 must not dispatch'));
                },
                terminalize: request => {
                    terminalCalls.push(request);
                    return Promise.resolve(terminalReceipt(request));
                }
            });
            const barrier = queue.runBarrier({
                clientSnapshotId: `snapshot-unknown-${label}`,
                reason: 'manual'
            });
            const h2 = queue.enqueue({ stateJson: '{"memo":"pending-H2"}', reason: 'H2' });
            await Promise.resolve();
            assert.equal(queue.getState().halted, true);
            const [barrierError, h2Error] = await Promise.all([
                barrier.then(() => assert.fail('barrier must reject unknown'), error => error),
                h2.then(() => assert.fail('H2 must abort'), error => error)
            ]);

            assert.equal(barrierError instanceof LegacySafety.AssetTrackerSnapshotError, true);
            assert.equal(barrierError.terminalReason, 'snapshot-outcome-unknown');
            assert.equal(h2Error instanceof LegacySafety.AssetTrackerQueueAbortError, true);
            assert.equal(h2Error.itemKind, 'save');
            assert.equal(h2Error.clientItemId, 'load-1:save:1');
            assert.equal(h2Error.causedByClientItemId, `snapshot-unknown-${label}`);
            assert.equal(saveCalls.length, 0);
            assert.equal(queue.getState().barrierState, 'outcome-unknown');
            assert.equal(queue.getState().lastAcknowledgedHash, H0);
            assert.deepEqual(queue.getState().snapshotRecoveryHealth, health('snapshot'));
            assert.deepEqual(terminalCalls.map(call => call.reason), ['snapshot-outcome-unknown']);
        });
    }
});

test('snapshot source and session conflicts halt the lane without a primary rollback claim', async t => {
    for (const conflict of ['source-changed', 'session-invalid']) {
        await t.test(conflict, async () => {
            const clock = manualClock();
            const terminalCalls = [];
            const queue = makeQueue({
                clock: clock.clock,
                snapshot: request => Promise.reject(structuredSnapshotError(request, {
                    conflict
                })),
                terminalize: request => {
                    terminalCalls.push(request);
                    return Promise.resolve(terminalReceipt(request));
                }
            });
            const barrier = queue.runBarrier({
                clientSnapshotId: `snapshot-conflict-${conflict}`,
                reason: 'scheduled'
            });
            await Promise.resolve();
            assert.equal(queue.getState().halted, true);
            const barrierError = await barrier.then(
                () => assert.fail('conflict must reject'),
                error => error
            );

            assert.equal(barrierError instanceof LegacySafety.AssetTrackerSnapshotError, true);
            assert.equal(barrierError.terminalReason, 'snapshot-conflict');
            assert.equal(barrierError.conflict, conflict);
            assert.equal(queue.getState().barrierState, 'conflict');
            assert.equal(queue.getState().primaryStatus, 'failed-readonly');
            assert.equal(queue.getState().lastAcknowledgedHash, H0);
            assert.deepEqual(terminalCalls.map(call => call.reason), ['snapshot-conflict']);
        });
    }
});

test('barrier deadline preserves durable H1, aborts H2, terminalizes, and ignores the late snapshot receipt', async () => {
    const clock = manualClock();
    const first = deferred();
    const snapshot = deferred();
    const saveCalls = [];
    const snapshotCalls = [];
    const terminalCalls = [];
    const queue = makeQueue({
        clock: clock.clock,
        barrierDeadlineMs: 17_000,
        write: request => {
            saveCalls.push(request);
            return first.promise;
        },
        snapshot: request => {
            snapshotCalls.push(request);
            return snapshot.promise;
        },
        terminalize: request => {
            terminalCalls.push(request);
            return Promise.resolve(terminalReceipt(request));
        }
    });
    const h1 = queue.enqueue({ stateJson: '{"memo":"durable-H1"}', reason: 'H1' });
    first.resolve(nativeReceipt(saveCalls[0], H0, H1));
    await h1;
    const barrier = queue.runBarrier({ clientSnapshotId: 'snapshot-timeout', reason: 'scheduled' });
    const h2 = queue.enqueue({ stateJson: '{"memo":"pending-H2"}', reason: 'H2' });

    clock.runDelay(17_000);
    assert.equal(queue.getState().halted, true);
    const [barrierError, h2Error] = await Promise.all([
        barrier.then(() => assert.fail('deadline must reject'), error => error),
        h2.then(() => assert.fail('H2 must abort'), error => error)
    ]);

    assert.equal(barrierError.terminalReason, 'snapshot-outcome-unknown');
    assert.equal(h2Error instanceof LegacySafety.AssetTrackerQueueAbortError, true);
    assert.equal(queue.getState().primaryStatus, 'native-durable');
    assert.equal(queue.getState().lastAcknowledgedHash, H1);
    assert.equal(queue.getState().barrierState, 'outcome-unknown');
    assert.equal(saveCalls.length, 1);
    assert.deepEqual(terminalCalls.map(call => call.reason), ['snapshot-outcome-unknown']);

    snapshot.resolve(snapshotReceipt(snapshotCalls[0], H1));
    await Promise.resolve();
    assert.equal(queue.getState().lastAcknowledgedHash, H1);
    assert.equal(queue.getState().barrierState, 'outcome-unknown');
    assert.equal(saveCalls.length, 1, 'late snapshot completion cannot dispatch H2');
});

test('synchronous barrier deadline callback halts before snapshot adapter I/O', async t => {
    for (const registrationOutcome of ['return-handle', 'throw-after-callback']) {
        await t.test(registrationOutcome, async () => {
            const snapshotCalls = [];
            const terminalCalls = [];
            const queue = makeQueue({
                barrierDeadlineMs: 17_000,
                clock: {
                    setTimeout(callback, delay) {
                        if (delay === 17_000) {
                            callback();
                            if (registrationOutcome === 'throw-after-callback') {
                                throw new Error('timer registration failed after callback');
                            }
                            return 'barrier-handle';
                        }
                        return 'terminal-handle';
                    },
                    clearTimeout: () => undefined
                },
                snapshot: request => {
                    snapshotCalls.push(request);
                    return Promise.resolve(snapshotReceipt(request, H0));
                },
                terminalize: request => {
                    terminalCalls.push(request);
                    return Promise.resolve(terminalReceipt(request));
                }
            });

            const error = await queue.runBarrier({
                clientSnapshotId: `snapshot-sync-deadline-${registrationOutcome}`,
                reason: 'manual'
            }).then(() => assert.fail('deadline must reject'), reason => reason);

            assert.equal(error instanceof LegacySafety.AssetTrackerSnapshotError, true);
            assert.equal(error.terminalReason, 'snapshot-outcome-unknown');
            assert.equal(queue.getState().barrierState, 'outcome-unknown');
            assert.equal(snapshotCalls.length, 0);
            assert.deepEqual(terminalCalls.map(call => call.reason), ['snapshot-outcome-unknown']);
        });
    }
});

test('barrier enqueue during an active barrier stays synchronous and reentrant snapshot ACK enqueue keeps FIFO order', async () => {
    const clock = manualClock();
    const snapshot = deferred();
    const save2 = deferred();
    const save3 = deferred();
    const snapshotCalls = [];
    const saveCalls = [];
    const transitions = [];
    let h3 = null;
    let queue;
    queue = makeQueue({
        clock: clock.clock,
        snapshot: request => {
            snapshotCalls.push(request);
            return snapshot.promise;
        },
        write: request => {
            saveCalls.push(request);
            return saveCalls.length === 1 ? save2.promise : save3.promise;
        },
        onAcknowledged: receipt => {
            if (receipt.clientSnapshotId === 'snapshot-reentrant') {
                h3 = queue.enqueue({ stateJson: '{"memo":"H3"}', reason: 'H3' });
            }
            return undefined;
        },
        onTransition: state => {
            transitions.push(state);
            return undefined;
        }
    });
    const barrier = queue.runBarrier({ clientSnapshotId: 'snapshot-reentrant', reason: 'manual' });
    const h2 = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'H2' });

    assert.equal(snapshotCalls.length, 1);
    assert.equal(saveCalls.length, 0);
    assert.equal(queue.getState().lanePhase, 'barrier-running');
    assert.equal(queue.getState().activeClientSnapshotId, 'snapshot-reentrant');
    assert.equal(queue.getState().pendingCount, 2);
    assert.equal(transitions.at(-1).lanePhase, 'barrier-running');

    snapshot.resolve(snapshotReceipt(snapshotCalls[0], H0));
    await barrier;
    assert.equal(saveCalls.length, 1);
    assert.equal(saveCalls[0].stateJson, '{"memo":"H2"}');
    assert.equal(h3 instanceof Promise, true);

    save2.resolve(nativeReceipt(saveCalls[0], H0, H2));
    await h2;
    assert.equal(saveCalls.length, 2);
    assert.equal(saveCalls[1].stateJson, '{"memo":"H3"}');
    save3.resolve(nativeReceipt(saveCalls[1], H2, H1));
    await h3;
});

test('post-operation callback faults roll provisional next-barrier state back to the completed outcome', async t => {
    await t.test('save ACK plus pending B1 restores the prior none state', async () => {
        const clock = manualClock();
        const save = deferred();
        const saveCalls = [];
        const snapshotCalls = [];
        const queue = makeQueue({
            clock: clock.clock,
            write: request => {
                saveCalls.push(request);
                return save.promise;
            },
            snapshot: request => {
                snapshotCalls.push(request);
                return Promise.resolve(snapshotReceipt(request));
            },
            terminalize: request => Promise.resolve(terminalReceipt(request)),
            onAcknowledged: receipt => {
                if (receipt.clientSaveId) throw new Error('save ACK callback failed');
                return undefined;
            }
        });
        const h1 = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'H1' });
        const b1 = queue.runBarrier({ clientSnapshotId: 'pending-B1', reason: 'manual' });
        const b1Observed = b1.then(
            () => assert.fail('pending B1 must abort'),
            error => error
        );

        save.resolve(nativeReceipt(saveCalls[0], H0, H1));
        const receipt = await h1;
        const b1Error = await b1Observed;

        assert.equal(receipt.stateHashAfter, H1);
        assert.equal(b1Error instanceof LegacySafety.AssetTrackerQueueAbortError, true);
        assert.equal(b1Error.completedItemKind, 'save');
        assert.equal(b1Error.completedClientItemId, receipt.clientSaveId);
        assert.equal(snapshotCalls.length, 0);
        assert.equal(queue.getState().barrierState, 'none');
    });

    await t.test('created B1 plus pending B2 preserves created', async () => {
        const clock = manualClock();
        const first = deferred();
        const snapshotCalls = [];
        const queue = makeQueue({
            clock: clock.clock,
            snapshot: request => {
                snapshotCalls.push(request);
                return first.promise;
            },
            terminalize: request => Promise.resolve(terminalReceipt(request)),
            onAcknowledged: receipt => {
                if (receipt.clientSnapshotId === 'created-B1') {
                    throw new Error('created callback failed');
                }
                return undefined;
            }
        });
        const b1 = queue.runBarrier({ clientSnapshotId: 'created-B1', reason: 'manual' });
        const b2 = queue.runBarrier({ clientSnapshotId: 'pending-created-B2', reason: 'manual' });
        const b2Observed = b2.then(
            () => assert.fail('pending B2 must abort'),
            error => error
        );

        first.resolve(snapshotReceipt(snapshotCalls[0], H0));
        const receipt = await b1;
        const b2Error = await b2Observed;

        assert.equal(receipt.snapshotStatus, 'created');
        assert.equal(b2Error instanceof LegacySafety.AssetTrackerQueueAbortError, true);
        assert.equal(b2Error.completedItemKind, 'snapshot');
        assert.equal(b2Error.completedClientItemId, 'created-B1');
        assert.equal(snapshotCalls.length, 1, 'B2 never reaches the adapter');
        assert.equal(queue.getState().barrierState, 'created');
    });

    await t.test('known-not-created B1 plus pending B2 preserves not-created', async () => {
        const clock = manualClock();
        const first = deferred();
        const snapshotCalls = [];
        let failCompletedTransition = false;
        const queue = makeQueue({
            clock: clock.clock,
            snapshot: request => {
                snapshotCalls.push(request);
                return first.promise;
            },
            terminalize: request => Promise.resolve(terminalReceipt(request)),
            onTransition: () => {
                if (failCompletedTransition) throw new Error('known outcome transition failed');
                return undefined;
            }
        });
        const b1 = queue.runBarrier({ clientSnapshotId: 'not-created-B1', reason: 'manual' });
        const b1Observed = b1.then(
            () => assert.fail('known-not-created B1 must reject'),
            error => error
        );
        const b2 = queue.runBarrier({ clientSnapshotId: 'pending-not-created-B2', reason: 'manual' });
        const b2Observed = b2.then(
            () => assert.fail('pending B2 must abort'),
            error => error
        );

        failCompletedTransition = true;
        first.reject(structuredSnapshotError(snapshotCalls[0]));
        const b1Error = await b1Observed;
        const b2Error = await b2Observed;

        assert.equal(b1Error.queueOutcome, 'not-created');
        assert.equal(b2Error instanceof LegacySafety.AssetTrackerQueueAbortError, true);
        assert.equal(b2Error.completedOutcome, 'known-not-created');
        assert.equal(snapshotCalls.length, 1, 'B2 never reaches the adapter');
        assert.equal(queue.getState().barrierState, 'not-created');
    });

    await t.test('reentrant B2 enqueue followed by the outer save callback throw restores none', async () => {
        const clock = manualClock();
        const save = deferred();
        const saveCalls = [];
        const snapshotCalls = [];
        let b2Observed = null;
        let queue;
        queue = makeQueue({
            clock: clock.clock,
            write: request => {
                saveCalls.push(request);
                return save.promise;
            },
            snapshot: request => {
                snapshotCalls.push(request);
                return Promise.resolve(snapshotReceipt(request));
            },
            terminalize: request => Promise.resolve(terminalReceipt(request)),
            onAcknowledged: receipt => {
                if (receipt.clientSaveId) {
                    const b2 = queue.runBarrier({
                        clientSnapshotId: 'reentrant-pending-B2',
                        reason: 'manual'
                    });
                    b2Observed = b2.then(
                        () => assert.fail('reentrant B2 must abort'),
                        error => error
                    );
                    throw new Error('outer save callback failed');
                }
                return undefined;
            }
        });
        const h1 = queue.enqueue({ stateJson: '{"memo":"reentrant-H1"}', reason: 'H1' });

        save.resolve(nativeReceipt(saveCalls[0], H0, H1));
        const receipt = await h1;
        const b2Error = await b2Observed;

        assert.equal(receipt.stateHashAfter, H1);
        assert.equal(b2Error instanceof LegacySafety.AssetTrackerQueueAbortError, true);
        assert.equal(b2Error.completedClientItemId, receipt.clientSaveId);
        assert.equal(snapshotCalls.length, 0);
        assert.equal(queue.getState().barrierState, 'none');
    });
});

test('pre-dispatch barrier transition failure rejects the barrier and performs zero snapshot I/O', async () => {
    const clock = manualClock();
    const snapshotCalls = [];
    const faults = [];
    const terminalCalls = [];
    const queue = makeQueue({
        clock: clock.clock,
        snapshot: request => {
            snapshotCalls.push(request);
            return Promise.resolve(snapshotReceipt(request, H0));
        },
        terminalize: request => {
            terminalCalls.push(request);
            return Promise.resolve(terminalReceipt(request));
        },
        onTransition: state => {
            if (state.lanePhase === 'barrier-running') {
                throw new Error('barrier transition failed');
            }
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const barrier = queue.runBarrier({ clientSnapshotId: 'snapshot-pre-dispatch', reason: 'manual' });
    const barrierObserved = barrier.then(
        () => assert.fail('pre-dispatch callback must reject'),
        reason => reason
    );
    await Promise.resolve();

    assert.equal(queue.getState().halted, true);
    const error = await barrierObserved;
    assert.equal(error instanceof LegacySafety.AssetTrackerQueueCallbackError, true);
    assert.equal(error.causeKind, 'pre-dispatch-callback');
    assert.equal(error.clientItemId, 'snapshot-pre-dispatch');
    assert.equal(error.completedItemKind, null);
    assert.equal(snapshotCalls.length, 0);
    assert.equal(queue.getState().barrierState, 'none');
    assert.strictEqual(faults[0], error);
    assert.deepEqual(terminalCalls.map(call => call.reason), ['queue-callback-failed']);
});

test('snapshot successful receipt callback faults preserve its receipt and fence H2 before the first caller reaction', async t => {
    for (const callbackName of ['onAcknowledged', 'onTransition']) {
        await t.test(callbackName, async () => {
            const clock = manualClock();
            const snapshot = deferred();
            const snapshotCalls = [];
            const saveCalls = [];
            const faults = [];
            const events = [];
            const queue = makeQueue({
                clock: clock.clock,
                snapshot: request => {
                    snapshotCalls.push(request);
                    return snapshot.promise;
                },
                write: request => {
                    saveCalls.push(request);
                    return Promise.reject(new Error('H2 must not dispatch'));
                },
                terminalize: request => Promise.resolve(terminalReceipt(request)),
                onAcknowledged: callbackName === 'onAcknowledged'
                    ? receipt => { receipt.snapshotHash = H2; }
                    : () => undefined,
                onTransition: state => {
                    if (callbackName === 'onTransition' && state.barrierState === 'created') {
                        throw new Error('snapshot transition failed');
                    }
                    return undefined;
                },
                onFault: fault => {
                    events.push('onFault');
                    faults.push(fault);
                    return undefined;
                }
            });
            const barrier = queue.runBarrier({
                clientSnapshotId: `snapshot-success-${callbackName}`,
                reason: 'manual'
            });
            const callerObserved = barrier.then(receipt => {
                events.push('first caller');
                return { receipt, callerState: queue.getState() };
            });
            const h2 = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'H2' });
            const h2Observed = h2.then(
                () => assert.fail('H2 must abort'),
                error => error
            );

            snapshot.resolve(snapshotReceipt(snapshotCalls[0], H0));
            await Promise.resolve();
            assert.equal(queue.getState().halted, true);
            const { receipt, callerState } = await callerObserved;
            const h2Error = await h2Observed;

            assert.equal(receipt.clientSnapshotId, `snapshot-success-${callbackName}`);
            assert.equal(callerState.halted, true);
            assert.equal(h2Error instanceof LegacySafety.AssetTrackerQueueAbortError, true);
            assert.equal(h2Error.causeKind, 'post-operation-callback');
            assert.equal(h2Error.completedItemKind, 'snapshot');
            assert.equal(h2Error.completedClientItemId, receipt.clientSnapshotId);
            assert.equal(h2Error.completedOutcome, 'successful-receipt');
            assert.equal(saveCalls.length, 0);
            assert.equal(queue.getState().lastAcknowledgedHash, H0);
            assert.equal(faults[0].completedItemKind, 'snapshot');
            assert.equal(faults[0].completedClientItemId, receipt.clientSnapshotId);
            assert.equal(h2Error.callbackFaultId, faults[0].callbackFaultId);
            assert.deepEqual(events, ['onFault', 'first caller']);
        });
    }
});

test('known-not-created callback return variants preserve SnapshotError and fence H2 with one callback fault', async t => {
    const variants = [
        ['throw', () => { throw new Error('known-not-created transition failed'); }],
        ['number', () => 1],
        ['resolved thenable', () => Promise.resolve('invalid')],
        ['rejected thenable', () => Promise.reject(new Error('diagnostic reject'))],
        ['never thenable', () => new Promise(() => {})]
    ];

    for (const [label, callbackResult] of variants) {
        await t.test(label, async () => {
            const clock = manualClock();
            const snapshot = deferred();
            const snapshotCalls = [];
            const saveCalls = [];
            const faults = [];
            const queue = makeQueue({
                clock: clock.clock,
                snapshot: request => {
                    snapshotCalls.push(request);
                    return snapshot.promise;
                },
                write: request => {
                    saveCalls.push(request);
                    return Promise.reject(new Error('H2 must not dispatch'));
                },
                terminalize: request => Promise.resolve(terminalReceipt(request)),
                onTransition: state => state.barrierState === 'not-created'
                    ? callbackResult()
                    : undefined,
                onFault: fault => {
                    faults.push(fault);
                    return undefined;
                }
            });
            const barrier = queue.runBarrier({
                clientSnapshotId: `snapshot-not-created-callback-${label}`,
                reason: 'manual'
            });
            const barrierObserved = barrier.then(
                () => assert.fail('known-not-created must reject'),
                error => error
            );
            const h2 = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'H2' });
            const h2Observed = h2.then(
                () => assert.fail('H2 must abort'),
                error => error
            );
            snapshot.reject(structuredSnapshotError(snapshotCalls[0]));
            await Promise.resolve();

            assert.equal(queue.getState().halted, true);
            const barrierError = await barrierObserved;
            const h2Error = await h2Observed;
            assert.equal(barrierError instanceof LegacySafety.AssetTrackerSnapshotError, true);
            assert.equal(barrierError.queueOutcome, 'not-created');
            assert.equal(h2Error instanceof LegacySafety.AssetTrackerQueueAbortError, true);
            assert.equal(h2Error.causeKind, 'post-operation-callback');
            assert.equal(h2Error.completedItemKind, 'snapshot');
            assert.equal(h2Error.completedClientItemId, barrierError.clientSnapshotId);
            assert.equal(h2Error.completedOutcome, 'known-not-created');
            assert.equal(saveCalls.length, 0);
            assert.equal(faults.length, 1);
            assert.equal(faults[0].terminalReason, 'queue-callback-failed');
        });
    }
});

test('snapshot receipt and error fields are each extracted once and exposed as detached deep-frozen values', async () => {
    const receiptHealthValues = {
        domain: 'snapshot',
        status: 'healthy',
        auditComplete: true,
        code: null,
        maintenancePendingCount: 0,
        detail: null
    };
    const receiptHealth = oneReadRecord('snapshotReceipt.recoveryHealth', receiptHealthValues);
    const receiptValues = {
        ok: true,
        clientSnapshotId: 'snapshot-one-read-receipt',
        sourceHash: H0,
        snapshotHash: H0,
        ordinal: 0,
        snapshotStatus: 'created',
        durability: 'native-durable',
        retainedCount: 1,
        recoveryHealth: receiptHealth.record
    };
    const receiptSource = oneReadRecord('snapshotReceipt', receiptValues);
    const receiptQueue = makeQueue({
        snapshot: () => Promise.resolve(receiptSource.record)
    });
    const receipt = await receiptQueue.runBarrier({
        clientSnapshotId: 'snapshot-one-read-receipt',
        reason: 'manual'
    });
    receiptSource.assertEachReadOnce();
    receiptHealth.assertEachReadOnce();
    receiptValues.snapshotHash = H2;
    receiptHealthValues.status = 'degraded';
    assert.equal(receipt.snapshotHash, H0);
    assert.equal(receipt.recoveryHealth.status, 'healthy');
    assert.equal(receiptQueue.getState().snapshotRecoveryHealth.status, 'healthy');
    assert.equal(Object.isFrozen(receipt), true);
    assert.equal(Object.isFrozen(receipt.recoveryHealth), true);

    const errorHealthValues = {
        domain: 'snapshot',
        status: 'degraded',
        auditComplete: true,
        code: 'snapshot-pending',
        maintenancePendingCount: 1,
        detail: 'pending cleanup'
    };
    const errorHealth = oneReadRecord('snapshotError.recoveryHealthEvidence', errorHealthValues);
    const errorQueue = makeQueue({
        snapshot: request => {
            const oneRead = oneReadTypedSnapshotError(request, {
                healthPersisted: true,
                recoveryHealthEvidence: errorHealth.record
            });
            errorQueue.oneReadSnapshotError = oneRead;
            return Promise.reject(oneRead.source);
        }
    });
    const error = await errorQueue.runBarrier({
        clientSnapshotId: 'snapshot-one-read-error',
        reason: 'manual'
    }).then(() => assert.fail('known-not-created must reject'), reason => reason);
    errorQueue.oneReadSnapshotError.assertEachReadOnce();
    errorHealth.assertEachReadOnce();
    errorQueue.oneReadSnapshotError.values.sourceHashAfter = H2;
    errorHealthValues.code = 'mutated';
    assert.equal(error.sourceHashAfter, H0);
    assert.equal(error.recoveryHealthEvidence.code, 'snapshot-pending');
    assert.equal(errorQueue.getState().snapshotRecoveryHealth.code, 'snapshot-pending');
    assert.equal(Object.isFrozen(error), true);
    assert.equal(Object.isFrozen(error.recoveryHealthEvidence), true);
});

test('active save failure aborts a pending snapshot with its exact snapshot ID', async () => {
    const clock = manualClock();
    const first = deferred();
    const saveCalls = [];
    const snapshotCalls = [];
    const queue = makeQueue({
        clock: clock.clock,
        write: request => {
            saveCalls.push(request);
            return first.promise;
        },
        snapshot: request => {
            snapshotCalls.push(request);
            return Promise.resolve(snapshotReceipt(request));
        },
        terminalize: request => Promise.resolve(terminalReceipt(request))
    });
    const h1 = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'H1' });
    const barrier = queue.runBarrier({ clientSnapshotId: 'snapshot-pending-abort', reason: 'scheduled' });
    first.reject(structuredSaveError(saveCalls[0]));
    await h1.then(() => assert.fail('H1 must reject'), () => undefined);
    const barrierError = await barrier.then(() => assert.fail('snapshot must abort'), error => error);

    assert.equal(barrierError instanceof LegacySafety.AssetTrackerQueueAbortError, true);
    assert.equal(barrierError.itemKind, 'snapshot');
    assert.equal(barrierError.clientItemId, 'snapshot-pending-abort');
    assert.equal(barrierError.payloadHash, null);
    assert.equal(barrierError.causedByClientItemId, saveCalls[0].clientSaveId);
    assert.equal(snapshotCalls.length, 0);
});

test('rapid FIFO accepts 100 frozen saves with one active write and persists the exact 100th state', async () => {
    const writeCalls = [];
    const acknowledgedHashes = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            activeWrites += 1;
            maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
            const stateHashAfter = createHash('sha256')
                .update(`ack-${writeCalls.length}`)
                .digest('hex');
            acknowledgedHashes.push(stateHashAfter);
            return Promise.resolve(nativeReceipt(
                request,
                request.expectedHash,
                stateHashAfter
            )).then(receipt => {
                activeWrites -= 1;
                return receipt;
            });
        }
    });
    const promises = [];

    for (let index = 1; index <= 100; index += 1) {
        const stateJson = JSON.stringify({ memo: `rapid-${index}` });
        promises.push(queue.enqueue({ stateJson, reason: `rapid-${index}` }));
    }
    const receipts = await Promise.all(promises);

    assert.equal(writeCalls.length, 100);
    assert.equal(maxActiveWrites, 1);
    assert.equal(writeCalls[99].stateJson, '{"memo":"rapid-100"}');
    assert.equal(writeCalls[99].expectedHash, acknowledgedHashes[98]);
    assert.equal(receipts[99].stateHashAfter, acknowledgedHashes[99]);
    assert.equal(queue.getState().lastAcknowledgedHash, acknowledgedHashes[99]);
});

test('receipt verification rejects wrong identity, hashes, durability, byte count, metadata, and failure unions', async t => {
    const cases = [
        ['clientSaveId', (item, receipt) => ({ ...receipt, clientSaveId: `${item.clientSaveId}-wrong` })],
        ['payloadHash', (_item, receipt) => ({ ...receipt, payloadHash: H2 })],
        ['sourceHashBefore', (_item, receipt) => ({ ...receipt, sourceHashBefore: H2 })],
        ['durability', (_item, receipt) => ({ ...receipt, durability: 'browser-local-committed' })],
        ['state hash alias', (_item, receipt) => ({ ...receipt, stateHash: H2 })],
        ['state hash shape', (_item, receipt) => ({ ...receipt, stateHashAfter: 'bad', stateHash: 'bad' })],
        ['byteCount', (_item, receipt) => ({ ...receipt, byteCount: receipt.byteCount + 1 })],
        ['updatedAt metadata', (_item, receipt) => ({ ...receipt, updatedAt: null })],
        ['storagePath metadata', (_item, receipt) => ({ ...receipt, storagePath: '' })],
        ['recovery health domain', (_item, receipt) => ({
            ...receipt,
            recoveryHealth: health('snapshot')
        })],
        ['resolved failure union', () => ({ ok: false, error: { code: 'write-failed' } })]
    ];

    for (const [label, mutate] of cases) {
        await t.test(label, async () => {
            const result = deferred();
            const writeCalls = [];
            const queue = makeQueue({
                write: request => {
                    writeCalls.push(request);
                    return result.promise;
                }
            });
            const savePromise = queue.enqueue({ stateJson: '{"memo":"bad receipt"}', reason: label });
            const rejection = assert.rejects(
                savePromise,
                error => error instanceof LegacySafety.AssetTrackerSaveError
                    && error.queueOutcome === 'durability-unknown'
            );
            const valid = nativeReceipt(writeCalls[0], H0, H1);

            result.resolve(mutate(writeCalls[0], valid));
            await rejection;

            assert.equal(queue.getState().lastAcknowledgedHash, H0);
            assert.equal(queue.getState().halted, true);
            assert.equal(writeCalls.length, 1);
        });
    }
});

test('receipt extraction reads every top-level and nested getter once through a real completion', async () => {
    const result = deferred();
    const writeCalls = [];
    const queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            return result.promise;
        }
    });
    const savePromise = queue.enqueue({ stateJson: '{"memo":"one read"}', reason: 'one-read' });
    const item = writeCalls[0];
    const receiptHealth = oneReadRecord('receipt.recoveryHealth', {
        domain: 'ordinary',
        status: 'healthy',
        auditComplete: true,
        code: null,
        maintenancePendingCount: 0,
        detail: null
    });
    const receiptSource = oneReadRecord('receipt', {
        ok: true,
        clientSaveId: item.clientSaveId,
        payloadHash: item.payloadHash,
        sourceHashBefore: H0,
        stateHashAfter: H1,
        stateHash: H1,
        byteCount: new TextEncoder().encode(item.stateJson).byteLength,
        durability: 'native-durable',
        updatedAt: '2026-08-10T00:00:00.000Z',
        storagePath: '/tmp/AssetTrackerBook.json',
        recoveryHealth: receiptHealth.record
    });

    result.resolve(receiptSource.record);
    const receipt = await savePromise;

    receiptSource.assertEachReadOnce();
    receiptHealth.assertEachReadOnce();
    assert.equal(receipt.stateHashAfter, H1);

    const alternatingResult = deferred();
    const alternatingCalls = [];
    const alternatingQueue = makeQueue({
        write: request => {
            alternatingCalls.push(request);
            return alternatingResult.promise;
        }
    });
    const alternatingPromise = alternatingQueue.enqueue({
        stateJson: '{"memo":"alternating"}',
        reason: 'alternating'
    });
    const alternatingItem = alternatingCalls[0];
    const alternatingHealth = sequencedRecord({
        domain: 'ordinary',
        status: 'healthy',
        auditComplete: true,
        code: [null, 'contradiction'],
        maintenancePendingCount: 0,
        detail: null
    });
    const alternatingReceipt = sequencedRecord({
        ok: true,
        clientSaveId: [alternatingItem.clientSaveId, 'wrong-id'],
        payloadHash: alternatingItem.payloadHash,
        sourceHashBefore: H0,
        stateHashAfter: H1,
        stateHash: H1,
        byteCount: new TextEncoder().encode(alternatingItem.stateJson).byteLength,
        durability: 'native-durable',
        updatedAt: '2026-08-10T00:00:00.000Z',
        storagePath: '/tmp/AssetTrackerBook.json',
        recoveryHealth: alternatingHealth
    });

    alternatingResult.resolve(alternatingReceipt);
    const canonical = await alternatingPromise;
    assert.equal(canonical.clientSaveId, alternatingItem.clientSaveId);
    assert.equal(canonical.recoveryHealth.code, null);
});

test('receipt completion uses captured keys, create, and array intrinsics after module load', async t => {
    const nativeObjectKeys = Object.keys;
    const nativeObjectCreate = Object.create;
    const nativeArrayIsArray = Array.isArray;
    const variants = [
        ['Object.keys', adapterReceipt => {
            Object.keys = value => value && value.stateHashAfter === H1
                ? []
                : nativeObjectKeys(value);
        }],
        ['Object.create', () => {
            Object.create = prototype => {
                if (prototype === null) throw new Error('caller-controlled Object.create');
                return nativeObjectCreate(prototype);
            };
        }],
        ['Array.isArray', adapterReceipt => {
            Array.isArray = value => {
                if (value === adapterReceipt || value === adapterReceipt.recoveryHealth) {
                    throw new Error('caller-controlled Array.isArray');
                }
                return nativeArrayIsArray(value);
            };
        }]
    ];

    for (const [label, poison] of variants) {
        await t.test(label, async () => {
            const result = deferred();
            const writeCalls = [];
            const queue = makeQueue({
                write: request => {
                    writeCalls.push(request);
                    return result.promise;
                }
            });
            const savePromise = queue.enqueue({
                stateJson: `{"memo":"${label}"}`,
                reason: label
            });
            const adapterReceipt = nativeReceipt(writeCalls[0], H0, H1);

            try {
                poison(adapterReceipt);
                result.resolve(adapterReceipt);
                const receipt = await savePromise;
                assert.equal(receipt.stateHashAfter, H1);
                assert.equal(queue.getState().lastAcknowledgedHash, H1);
            } finally {
                Object.keys = nativeObjectKeys;
                Object.create = nativeObjectCreate;
                Array.isArray = nativeArrayIsArray;
            }
        });
    }
});

test('receipt is canonical deep frozen and isolated from callbacks and adapter mutation', async () => {
    const result = deferred();
    const writeCalls = [];
    let callbackReceipt = null;
    const queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            return result.promise;
        },
        onAcknowledged: receipt => {
            callbackReceipt = receipt;
            assert.throws(() => { receipt.stateHashAfter = H2; }, TypeError);
            assert.throws(() => { receipt.recoveryHealth.status = 'degraded'; }, TypeError);
            return undefined;
        }
    });
    const savePromise = queue.enqueue({ stateJson: '{"memo":"canonical"}', reason: 'canonical' });
    const adapterReceipt = {
        ...nativeReceipt(writeCalls[0], H0, H1),
        recoveryHealth: { ...health('ordinary') }
    };

    result.resolve(adapterReceipt);
    const receipt = await savePromise;
    adapterReceipt.stateHashAfter = H2;
    adapterReceipt.recoveryHealth.status = 'degraded';

    assert.equal(Object.isFrozen(receipt), true);
    assert.equal(Object.isFrozen(receipt.recoveryHealth), true);
    assert.equal(Object.isFrozen(callbackReceipt), true);
    assert.equal(Object.isFrozen(callbackReceipt.recoveryHealth), true);
    assert.notStrictEqual(receipt, adapterReceipt);
    assert.notStrictEqual(receipt.recoveryHealth, adapterReceipt.recoveryHealth);
    assert.notStrictEqual(receipt, callbackReceipt);
    assert.equal(receipt.stateHashAfter, H1);
    assert.equal(receipt.recoveryHealth.status, 'healthy');
    assert.equal(callbackReceipt.stateHashAfter, H1);
    assert.equal(queue.getState().ordinaryRecoveryHealth.status, 'healthy');
});

test('receipt queue accepts exact browser-local-committed and native-durable variants', async t => {
    for (const durability of ['browser-local-committed', 'native-durable']) {
        await t.test(durability, async () => {
            const result = deferred();
            const calls = [];
            const notApplicable = health('ordinary', 'not-applicable');
            const options = durability === 'browser-local-committed'
                ? {
                    expectedDurability: durability,
                    initialRecoveryHealth: {
                        ordinary: notApplicable,
                        snapshot: health('snapshot', 'not-applicable')
                    }
                }
                : { expectedDurability: durability };
            const queue = makeQueue({
                ...options,
                write: request => {
                    calls.push(request);
                    return result.promise;
                }
            });
            const savePromise = queue.enqueue({ stateJson: '{"memo":"platform"}', reason: durability });
            const receipt = durability === 'native-durable'
                ? nativeReceipt(calls[0], H0, H1)
                : browserReceipt(calls[0], H0, H1);

            result.resolve(receipt);
            const canonical = await savePromise;

            assert.equal(canonical.durability, durability);
            assert.equal(queue.getState().primaryStatus, durability);
            if (durability === 'browser-local-committed') {
                assert.deepEqual(queue.getState().ordinaryRecoveryHealth, notApplicable);
                assert.deepEqual(
                    queue.getState().snapshotRecoveryHealth,
                    health('snapshot', 'not-applicable')
                );
            }
        });
    }
});

test('FIFO queue exposes no public reset or rebase API', async () => {
    const calls = [];
    const queue = makeQueue({
        write: request => {
            calls.push(request);
            return Promise.resolve(nativeReceipt(request, request.expectedHash, H1));
        }
    });

    assert.equal(queue.reset, undefined);
    assert.equal(queue.rebase, undefined);
    await queue.enqueue({ stateJson: '{"memo":"used"}', reason: 'used' });
    assert.equal(queue.reset, undefined);
    assert.equal(queue.rebase, undefined);
    assert.equal(calls.length, 1);
});

test('callback fence blocks adapter I/O after pre-dispatch and post-receipt callback faults', async t => {
    await t.test('pre-dispatch onTransition throw performs zero I/O', async () => {
        const writeCalls = [];
        const queue = makeQueue({
            write: request => {
                writeCalls.push(request);
                return Promise.reject(new Error('must not dispatch'));
            },
            onTransition: () => { throw new Error('transition failed'); }
        });
        const savePromise = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'transition-fault' });

        await assert.rejects(savePromise, LegacySafety.AssetTrackerQueueCallbackError);
        assert.equal(writeCalls.length, 0);
        assert.equal(queue.getState().halted, true);
    });

    for (const callbackName of ['onAcknowledged', 'post-receipt onTransition']) {
        await t.test(`${callbackName} preserves H1 receipt and aborts H2 before I/O`, async () => {
            const first = deferred();
            const writeCalls = [];
            const faults = [];
            const callbacks = callbackName === 'onAcknowledged'
                ? {
                    onAcknowledged: () => { throw new Error('ack callback failed'); }
                }
                : {
                    onTransition: state => {
                        if (state.lastAcknowledgedHash === H1) {
                            throw new Error('post-receipt transition failed');
                        }
                        return undefined;
                    }
                };
            const queue = makeQueue({
                write: request => {
                    writeCalls.push(request);
                    return first.promise;
                },
                onFault: fault => {
                    faults.push(fault);
                    return undefined;
                },
                ...callbacks
            });
            const firstPromise = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'first' });
            const secondPromise = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'second' });
            const secondObserved = secondPromise.then(
                () => assert.fail('H2 must not resolve'),
                error => error
            );

            first.resolve(nativeReceipt(writeCalls[0], H0, H1));
            const firstReceipt = await firstPromise;
            const secondError = await secondObserved;

            assert.equal(firstReceipt.stateHashAfter, H1);
            assert.equal(writeCalls.length, 1, 'H2 adapter call is fenced');
            assert.equal(secondError instanceof LegacySafety.AssetTrackerQueueAbortError, true);
            assert.match(secondError.callbackFaultId, /\S/);
            assert.equal(secondError.callbackFaultId, faults[0].callbackFaultId);
            assert.equal(secondError.causeKind, 'post-operation-callback');
            assert.equal(secondError.completedItemKind, 'save');
            assert.equal(secondError.completedClientItemId, writeCalls[0].clientSaveId);
            assert.equal(secondError.completedOutcome, 'successful-receipt');
            assert.equal(Object.isFrozen(secondError), true);
            assert.equal(Object.isFrozen(faults[0]), true);
            assert.equal(queue.getState().lastAcknowledgedHash, H1);
            assert.equal(queue.getState().halted, true);

            const futureError = await queue.enqueue({
                stateJson: '{"memo":"future"}',
                reason: 'future'
            }).then(
                () => assert.fail('future enqueue must not resolve'),
                error => error
            );
            assert.equal(futureError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
            assert.strictEqual(futureError.terminalCause, faults[0]);
        });
    }
});

test('callback fence consumes non-undefined and hostile thenable results without dispatching H2', async t => {
    const variants = [
        ['number', () => 7],
        ['resolved thenable', () => Promise.resolve('resolved')],
        ['rejected thenable', () => Promise.reject(new Error('diagnostic rejection'))],
        ['never-settling thenable', () => new Promise(() => {})],
        ['throwing then getter', () => Object.defineProperty({}, 'then', {
            get() { throw new Error('then getter failed'); }
        })],
        ['settle-then-throw thenable', () => ({
            then(resolve) {
                resolve('done');
                throw new Error('after settle');
            }
        })],
        ['double-settlement thenable', () => ({
            then(resolve, reject) {
                resolve('first');
                reject(new Error('second'));
            }
        })]
    ];

    for (const [label, callbackResult] of variants) {
        await t.test(label, async () => {
            const first = deferred();
            const writeCalls = [];
            let faultCount = 0;
            const queue = makeQueue({
                write: request => {
                    writeCalls.push(request);
                    return first.promise;
                },
                onAcknowledged: callbackResult,
                onFault: () => {
                    faultCount += 1;
                    return undefined;
                }
            });
            const firstPromise = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: label });
            const secondObserved = queue.enqueue({
                stateJson: '{"memo":"H2"}',
                reason: `${label}-pending`
            }).then(
                () => assert.fail('H2 must not resolve'),
                error => error
            );

            first.resolve(nativeReceipt(writeCalls[0], H0, H1));
            const receipt = await firstPromise;
            const secondError = await secondObserved;
            await new Promise(resolve => setImmediate(resolve));

            assert.equal(receipt.stateHashAfter, H1);
            assert.equal(secondError instanceof LegacySafety.AssetTrackerQueueAbortError, true);
            assert.equal(writeCalls.length, 1);
            assert.equal(faultCount, 1);
            assert.equal(queue.getState().halted, true);
        });
    }
});

test('callback fence keeps reentrant enqueue-time transitions ahead of all adapter I/O', async t => {
    await t.test('successful outer transition returns before FIFO H1 dispatch', async () => {
        const first = deferred();
        const second = deferred();
        const writeCalls = [];
        let transitionCalls = 0;
        let insideOuterTransition = false;
        let secondPromise = null;
        let queue;
        queue = makeQueue({
            write: request => {
                assert.equal(insideOuterTransition, false, 'adapter cannot run inside outer transition');
                writeCalls.push(request);
                return writeCalls.length === 1 ? first.promise : second.promise;
            },
            onTransition: () => {
                transitionCalls += 1;
                if (transitionCalls === 1) {
                    insideOuterTransition = true;
                    secondPromise = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'reentrant-H2' });
                    assert.equal(writeCalls.length, 0);
                    insideOuterTransition = false;
                }
                return undefined;
            }
        });

        const firstPromise = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'outer-H1' });
        assert.equal(writeCalls.length, 1);
        assert.equal(writeCalls[0].stateJson, '{"memo":"H1"}');
        assert.equal(queue.getState().pendingCount, 2);
        assert.equal(queue.getState().lanePhase, 'saving');

        first.resolve(nativeReceipt(writeCalls[0], H0, H1));
        await firstPromise;
        assert.equal(writeCalls.length, 2);
        assert.equal(writeCalls[1].stateJson, '{"memo":"H2"}');
        second.resolve(nativeReceipt(writeCalls[1], H1, H2));
        await secondPromise;
    });

    for (const outcome of ['throw', 'non-undefined']) {
        await t.test(`outer reentrant transition ${outcome} performs zero I/O`, async () => {
            const writeCalls = [];
            let transitionCalls = 0;
            let secondPromise = null;
            let queue;
            queue = makeQueue({
                write: request => {
                    writeCalls.push(request);
                    return Promise.reject(new Error('must not dispatch'));
                },
                onTransition: () => {
                    transitionCalls += 1;
                    if (transitionCalls === 1) {
                        secondPromise = queue.enqueue({
                            stateJson: '{"memo":"H2"}',
                            reason: `reentrant-${outcome}`
                        });
                        if (outcome === 'throw') throw new Error('outer transition failed');
                        return { callbackProtocol: 'invalid' };
                    }
                    return undefined;
                }
            });

            const firstPromise = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: outcome });
            const firstObserved = firstPromise.then(
                () => assert.fail('H1 must not resolve'),
                error => error
            );
            const secondObserved = secondPromise.then(
                () => assert.fail('H2 must not resolve'),
                error => error
            );

            assert.equal(writeCalls.length, 0);
            assert.equal(await firstObserved instanceof LegacySafety.AssetTrackerQueueCallbackError, true);
            assert.equal(await secondObserved instanceof LegacySafety.AssetTrackerQueueAbortError, true);
            assert.equal(queue.getState().halted, true);
        });
    }
});

test('reentrant onAcknowledged enqueue remains after an already-pending FIFO save', async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const results = [first, second, third];
    const hashes = [H1, H2, createHash('sha256').update('H3').digest('hex')];
    const writeCalls = [];
    const transitions = [];
    let thirdPromise = null;
    let queue;
    queue = makeQueue({
        write: request => {
            const result = results[writeCalls.length];
            writeCalls.push(request);
            return result.promise;
        },
        onAcknowledged: receipt => {
            if (receipt.stateHashAfter === H1) {
                thirdPromise = queue.enqueue({ stateJson: '{"memo":"H3"}', reason: 'reentrant-H3' });
            }
            return undefined;
        },
        onTransition: state => {
            transitions.push(state);
            return undefined;
        }
    });
    const firstPromise = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'H1' });
    const secondPromise = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'H2' });

    first.resolve(nativeReceipt(writeCalls[0], H0, hashes[0]));
    await firstPromise;
    assert.equal(writeCalls.length, 2);
    assert.equal(writeCalls[1].stateJson, '{"memo":"H2"}');
    assert.equal(writeCalls[1].expectedHash, hashes[0]);
    assert.equal(
        transitions.some(state => state.lastAcknowledgedHash === H1 && state.lanePhase === 'idle'),
        false,
        'reentrant H3 prevents stale H1 idle publication'
    );

    second.resolve(nativeReceipt(writeCalls[1], hashes[0], hashes[1]));
    await secondPromise;
    assert.equal(writeCalls.length, 3);
    assert.equal(writeCalls[2].stateJson, '{"memo":"H3"}');
    assert.equal(writeCalls[2].expectedHash, hashes[1]);

    third.resolve(nativeReceipt(writeCalls[2], hashes[1], hashes[2]));
    await thirdPromise;
    assert.equal(queue.getState().lastAcknowledgedHash, hashes[2]);
    assert.equal(queue.getState().lanePhase, 'idle');
});

test('first caller reaction observes the completed callback fence and terminal state', async () => {
    const result = deferred();
    const writeCalls = [];
    const events = [];
    const queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            return result.promise;
        },
        onAcknowledged: () => {
            events.push('onAcknowledged');
            throw new Error('post-receipt callback failed');
        },
        onFault: () => {
            events.push('onFault');
            return undefined;
        }
    });
    const savePromise = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'caller-order' });
    const firstReaction = savePromise.then(receipt => {
        events.push('first caller');
        return {
            receipt,
            state: queue.getState()
        };
    });

    result.resolve(nativeReceipt(writeCalls[0], H0, H1));
    const observed = await firstReaction;

    assert.equal(observed.receipt.stateHashAfter, H1);
    assert.equal(observed.state.lastAcknowledgedHash, H1);
    assert.equal(observed.state.halted, true);
    assert.deepEqual(events, ['onAcknowledged', 'onFault', 'first caller']);
});

test('not-committed rollback rejects active, aborts pending, halts future, and terminalizes once', async () => {
    const activeResult = deferred();
    const terminalResult = deferred();
    const writeCalls = [];
    const terminalCalls = [];
    const faults = [];
    let queue;
    queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            return activeResult.promise;
        },
        terminalize: request => {
            assert.equal(queue.getState().halted, true, 'Web state is terminal before native call');
            terminalCalls.push(request);
            return terminalResult.promise;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const firstPromise = queue.enqueue({ stateJson: '{"memo":"attempted-H1"}', reason: 'H1' });
    const secondPromise = queue.enqueue({ stateJson: '{"memo":"pending-H2"}', reason: 'H2' });
    const firstObserved = firstPromise.then(
        () => assert.fail('active H1 must reject'),
        error => error
    );
    const secondObserved = secondPromise.then(
        () => assert.fail('pending H2 must reject'),
        error => error
    );

    activeResult.reject(structuredSaveError(writeCalls[0]));
    const activeError = await firstObserved;
    const pendingError = await secondObserved;

    assert.equal(activeError instanceof LegacySafety.AssetTrackerSaveError, true);
    assert.equal(activeError.queueOutcome, 'not-committed');
    assert.equal(activeError.terminalReason, 'save-not-committed');
    assert.equal(activeError.lastAcknowledgedStateJson, '{"memo":"H0"}');
    assert.equal(activeError.lastAcknowledgedHash, H0);
    assert.equal(activeError.attemptedStateJson, '{"memo":"attempted-H1"}');
    assert.equal(activeError.activeClientItemId, writeCalls[0].clientSaveId);
    assert.equal(activeError.callbackFaultId, null);
    assert.equal(Object.isFrozen(activeError), true);
    assert.strictEqual(faults[0], activeError);
    assert.equal(faults.length, 1);

    assert.equal(pendingError instanceof LegacySafety.AssetTrackerQueueAbortError, true);
    assert.equal(pendingError.queueOutcome, 'not-dispatched');
    assert.equal(pendingError.itemKind, 'save');
    assert.equal(pendingError.clientItemId, writeCalls[0].clientSaveId.replace(':save:1', ':save:2'));
    assert.equal(pendingError.causedByClientItemId, writeCalls[0].clientSaveId);
    assert.equal(pendingError.causeKind, 'storage-item');
    assert.equal(pendingError.callbackFaultId, null);

    const state = queue.getState();
    assert.equal(state.primaryStatus, 'failed-readonly');
    assert.equal(state.lastAcknowledgedHash, H0);
    assert.equal(state.accepting, false);
    assert.equal(state.halted, true);
    assert.equal(terminalCalls.length, 1);
    assert.deepEqual(terminalCalls[0], {
        reason: 'save-not-committed',
        sessionContext: {
            protocolVersion: 2,
            loadId: 'load-1',
            writeSessionToken: 'token-1'
        }
    });
    assert.equal(Object.isFrozen(terminalCalls[0]), true);
    assert.equal(Object.isFrozen(terminalCalls[0].sessionContext), true);
    assert.equal(writeCalls.length, 1, 'pending H2 never dispatches');

    const futureError = await queue.enqueue({ stateJson: '{"memo":"future"}', reason: 'future' }).then(
        () => assert.fail('future save must reject'),
        error => error
    );
    assert.equal(futureError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
    assert.strictEqual(futureError.terminalCause, activeError);
    assert.throws(() => { activeError.lastAcknowledgedHash = H2; }, TypeError);

    terminalResult.resolve(terminalReceipt(terminalCalls[0]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queue.getState().halted, true);
    assert.equal(faults.length, 1);
    assert.equal(terminalCalls.length, 1);
});

test('not-committed rollback after H1 ACK restores H1 and accepts strict persisted health evidence', async () => {
    const first = deferred();
    const second = deferred();
    const writeCalls = [];
    const faults = [];
    const queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            return writeCalls.length === 1 ? first.promise : second.promise;
        },
        terminalize: request => Promise.resolve(terminalReceipt(request)),
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const firstPromise = queue.enqueue({ stateJson: '{"memo":"durable-H1"}', reason: 'H1' });
    const secondPromise = queue.enqueue({ stateJson: '{"memo":"attempted-H2"}', reason: 'H2' });
    const secondObserved = secondPromise.then(
        () => assert.fail('H2 must reject'),
        error => error
    );

    first.resolve(nativeReceipt(writeCalls[0], H0, H1));
    await firstPromise;
    const degraded = health('ordinary', 'degraded', {
        auditComplete: false,
        code: 'audit-incomplete',
        maintenancePendingCount: 0,
        detail: 'audit could not complete'
    });
    second.reject(structuredSaveError(writeCalls[1], {
        healthPersisted: true,
        recoveryHealthEvidence: degraded
    }));
    const error = await secondObserved;

    assert.equal(error.queueOutcome, 'not-committed');
    assert.equal(error.lastAcknowledgedStateJson, '{"memo":"durable-H1"}');
    assert.equal(error.lastAcknowledgedHash, H1);
    assert.equal(error.attemptedStateJson, '{"memo":"attempted-H2"}');
    assert.deepEqual(queue.getState().ordinaryRecoveryHealth, degraded);
    assert.equal(queue.getState().lastAcknowledgedHash, H1);
    assert.strictEqual(faults[0], error);
});

test('structured save error and nested health use one-read Proxy extraction and produce a detached frozen fault', async () => {
    const result = deferred();
    const writeCalls = [];
    const faults = [];
    const queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            return result.promise;
        },
        terminalize: request => Promise.resolve(terminalReceipt(request)),
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const savePromise = queue.enqueue({ stateJson: '{"memo":"one-read-error"}', reason: 'one-read' });
    const healthValues = {
        domain: 'ordinary',
        status: 'degraded',
        auditComplete: false,
        code: 'audit-incomplete',
        maintenancePendingCount: 0,
        detail: 'audit incomplete'
    };
    const healthSource = oneReadRecord('saveError.recoveryHealthEvidence', healthValues);
    const errorSource = oneReadTypedSaveError(writeCalls[0], {
        healthPersisted: true,
        recoveryHealthEvidence: healthSource.record
    });

    result.reject(errorSource.source);
    const error = await savePromise.then(
        () => assert.fail('known failure must reject'),
        reason => reason
    );

    errorSource.assertEachReadOnce();
    healthSource.assertEachReadOnce();
    assert.notStrictEqual(error, errorSource.source);
    assert.strictEqual(faults[0], error);
    assert.equal(Object.isFrozen(error), true);
    assert.equal(Object.isFrozen(error.recoveryHealthEvidence), true);
    assert.deepEqual(error.recoveryHealthEvidence, healthValues);

    errorSource.values.code = 'mutated-after-completion';
    healthValues.code = 'mutated-after-completion';
    assert.equal(error.code, 'write-failed');
    assert.equal(error.recoveryHealthEvidence.code, 'audit-incomplete');
    assert.equal(queue.getState().ordinaryRecoveryHealth.code, 'audit-incomplete');
});

test('throwing structured-error Proxy trap is malformed unknown and cannot escape the queue', async () => {
    const result = deferred();
    const writeCalls = [];
    const queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            return result.promise;
        },
        terminalize: request => Promise.resolve(terminalReceipt(request))
    });
    const savePromise = queue.enqueue({ stateJson: '{"memo":"proxy-trap"}', reason: 'proxy' });
    const typed = structuredSaveError(writeCalls[0]);
    const hostile = new Proxy(typed, {
        get(target, key, receiver) {
            if (key === 'payloadHash') throw new Error('payloadHash trap');
            return Reflect.get(target, key, receiver);
        }
    });

    result.reject(hostile);
    const error = await savePromise.then(
        () => assert.fail('malformed error must reject'),
        reason => reason
    );

    assert.equal(error instanceof LegacySafety.AssetTrackerSaveError, true);
    assert.equal(error.queueOutcome, 'durability-unknown');
    assert.equal(error.terminalReason, 'save-outcome-unknown');
    assert.equal(queue.getState().primaryStatus, 'durability-unknown');
});

test('not-committed null baseline remains a proven missing-source rollback', async () => {
    const result = deferred();
    const writeCalls = [];
    const queue = makeQueue({
        initialAcknowledged: { stateJson: '{"memo":"default"}', stateHash: null },
        write: request => {
            writeCalls.push(request);
            return result.promise;
        },
        terminalize: request => Promise.resolve(terminalReceipt(request))
    });
    const savePromise = queue.enqueue({ stateJson: '{"memo":"first-save"}', reason: 'first' });
    const observed = savePromise.then(
        () => assert.fail('first save must reject'),
        error => error
    );

    assert.equal(writeCalls[0].expectedHash, null);
    result.reject(structuredSaveError(writeCalls[0], { sourceHashAfter: null }));
    const error = await observed;

    assert.equal(error.queueOutcome, 'not-committed');
    assert.equal(error.lastAcknowledgedHash, null);
    assert.equal(error.lastAcknowledgedStateJson, '{"memo":"default"}');
    assert.equal(queue.getState().lastAcknowledgedHash, null);
});

test('unknown proof and strict persisted-health tuple inversions preserve the active attempted snapshot', async t => {
    const variants = [
        ['plain transport error', item => new Error(`transport lost for ${item.clientSaveId}`), 'reject'],
        ['wrong source', item => structuredSaveError(item, { sourceHashAfter: H2 }), 'reject'],
        ['wrong null source', item => structuredSaveError(item, { sourceHashAfter: null }), 'reject'],
        ['wrong client ID', item => structuredSaveError(item, { clientSaveId: 'wrong-id' }), 'reject'],
        ['wrong payload hash', item => structuredSaveError(item, { payloadHash: H2 }), 'reject'],
        ['false with non-null health', item => structuredSaveError(item, {
            healthPersisted: false,
            recoveryHealthEvidence: health('ordinary', 'degraded')
        }), 'reject'],
        ['true with null health', item => structuredSaveError(item, {
            healthPersisted: true,
            recoveryHealthEvidence: null
        }), 'reject'],
        ['wrong health domain', item => structuredSaveError(item, {
            healthPersisted: true,
            recoveryHealthEvidence: health('snapshot', 'degraded')
        }), 'reject'],
        ['incomplete health evidence', item => structuredSaveError(item, {
            healthPersisted: true,
            recoveryHealthEvidence: {
                domain: 'ordinary',
                status: 'degraded',
                auditComplete: false,
                code: 'audit-incomplete',
                maintenancePendingCount: 0
            }
        }), 'reject'],
        ['resolved failure union', () => ({ ok: false, error: { code: 'write-failed' } }), 'resolve']
    ];

    for (const [label, makeOutcome, settlement] of variants) {
        await t.test(label, async () => {
            const result = deferred();
            const terminalCalls = [];
            const writeCalls = [];
            const faults = [];
            const queue = makeQueue({
                write: request => {
                    writeCalls.push(request);
                    return result.promise;
                },
                terminalize: request => {
                    terminalCalls.push(request);
                    return Promise.reject(new Error('terminal ACK lost'));
                },
                onFault: fault => {
                    faults.push(fault);
                    return undefined;
                }
            });
            const savePromise = queue.enqueue({
                stateJson: `{"memo":"attempted-${label}"}`,
                reason: label
            });
            const observed = savePromise.then(
                () => assert.fail('unknown save must reject'),
                error => error
            );
            const outcome = makeOutcome(writeCalls[0]);

            result[settlement](outcome);
            const error = await observed;
            await new Promise(resolve => setImmediate(resolve));

            assert.equal(error instanceof LegacySafety.AssetTrackerSaveError, true);
            assert.equal(error.queueOutcome, 'durability-unknown');
            assert.equal(error.terminalReason, 'save-outcome-unknown');
            assert.equal(error.lastAcknowledgedStateJson, '{"memo":"H0"}');
            assert.equal(error.lastAcknowledgedHash, H0);
            assert.equal(error.attemptedStateJson, `{"memo":"attempted-${label}"}`);
            assert.equal(error.activeClientItemId, writeCalls[0].clientSaveId);
            assert.equal(error.callbackFaultId, null);
            assert.strictEqual(faults[0], error);
            assert.equal(faults.length, 1);
            assert.equal(queue.getState().primaryStatus, 'durability-unknown');
            assert.equal(queue.getState().lastAcknowledgedHash, H0);
            assert.deepEqual(queue.getState().ordinaryRecoveryHealth, health('ordinary'));
            assert.deepEqual(terminalCalls.map(call => call.reason), ['save-outcome-unknown']);
            assert.equal(queue.getState().halted, true, 'terminal rejection cannot revive queue');
        });
    }
});

test('conflict rejects without a disk-equality rollback claim and terminalizes save-conflict', async () => {
    const result = deferred();
    const writeCalls = [];
    const faults = [];
    const terminalCalls = [];
    const queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            return result.promise;
        },
        terminalize: request => {
            terminalCalls.push(request);
            return Promise.resolve(terminalReceipt(request));
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const savePromise = queue.enqueue({ stateJson: '{"memo":"conflicted-H1"}', reason: 'conflict' });
    const observed = savePromise.then(
        () => assert.fail('conflicted save must reject'),
        error => error
    );

    result.reject(structuredSaveError(writeCalls[0], {
        conflict: 'source-changed',
        sourceHashAfter: H2
    }));
    const error = await observed;

    assert.equal(error.queueOutcome, 'conflict');
    assert.equal(error.terminalReason, 'save-conflict');
    assert.equal(error.lastAcknowledgedStateJson, '{"memo":"H0"}');
    assert.equal(error.attemptedStateJson, '{"memo":"conflicted-H1"}');
    assert.equal(queue.getState().primaryStatus, 'failed-readonly');
    assert.equal(queue.getState().lastAcknowledgedHash, H0);
    assert.strictEqual(faults[0], error);
    assert.deepEqual(terminalCalls.map(call => call.reason), ['save-conflict']);
});

test('unknown timeout preserves attempted H1, aborts H2, terminalizes, and ignores a late ACK', async () => {
    const clock = manualClock();
    const activeResult = deferred();
    const terminalResult = deferred();
    const writeCalls = [];
    const terminalCalls = [];
    const faults = [];
    const queue = makeQueue({
        clock: clock.clock,
        write: request => {
            writeCalls.push(request);
            return activeResult.promise;
        },
        terminalize: request => {
            terminalCalls.push(request);
            return terminalResult.promise;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const firstPromise = queue.enqueue({ stateJson: '{"memo":"timeout-H1"}', reason: 'timeout-H1' });
    const secondPromise = queue.enqueue({ stateJson: '{"memo":"pending-H2"}', reason: 'pending-H2' });
    const firstObserved = firstPromise.then(
        () => assert.fail('timed out H1 must reject'),
        error => error
    );
    const secondObserved = secondPromise.then(
        () => assert.fail('pending H2 must reject'),
        error => error
    );

    assert.equal(clock.count(29_000), 1, 'one queue-owned durability deadline');
    clock.runDelay(29_000);
    const activeError = await firstObserved;
    const pendingError = await secondObserved;

    assert.equal(activeError.queueOutcome, 'durability-unknown');
    assert.equal(activeError.terminalReason, 'save-outcome-unknown');
    assert.equal(activeError.attemptedStateJson, '{"memo":"timeout-H1"}');
    assert.equal(pendingError instanceof LegacySafety.AssetTrackerQueueAbortError, true);
    assert.equal(pendingError.causedByClientItemId, writeCalls[0].clientSaveId);
    assert.equal(queue.getState().primaryStatus, 'durability-unknown');
    assert.equal(queue.getState().lastAcknowledgedHash, H0);
    assert.deepEqual(terminalCalls.map(call => call.reason), ['save-outcome-unknown']);
    assert.equal(writeCalls.length, 1);

    activeResult.resolve(nativeReceipt(writeCalls[0], H0, H1));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queue.getState().lastAcknowledgedHash, H0, 'late receipt cannot advance ledger');
    assert.strictEqual(faults[0], activeError);
    assert.equal(faults.length, 1);
    assert.equal(terminalCalls.length, 1);
    assert.equal(writeCalls.length, 1, 'late receipt cannot dispatch H2');

    assert.equal(clock.count(30_000), 1, 'terminalization has one bounded observation deadline');
    clock.runDelay(30_000);
    terminalResult.resolve(terminalReceipt(terminalCalls[0]));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queue.getState().halted, true);
    assert.equal(queue.getState().lastAcknowledgedHash, H0);
});

test('valid ACK cannot outrun a durability fault reentered by clearTimeout cleanup', async () => {
    const clock = reentrantClearClock();
    const result = deferred();
    const writeCalls = [];
    const acknowledged = [];
    const faults = [];
    const terminalCalls = [];
    const queue = makeQueue({
        clock: clock.clock,
        write: request => {
            writeCalls.push(request);
            return result.promise;
        },
        terminalize: request => {
            terminalCalls.push(request);
            return Promise.resolve(terminalReceipt(request));
        },
        onAcknowledged: receipt => {
            acknowledged.push(receipt);
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const savePromise = queue.enqueue({ stateJson: '{"memo":"ACK-race"}', reason: 'H1' });
    const observed = savePromise.then(
        () => assert.fail('reentrant durability fault must win before ACK commit'),
        error => error
    );

    result.resolve(nativeReceipt(writeCalls[0], H0, H1));
    const error = await observed;
    const futureError = await queue.enqueue({ stateJson: '{"memo":"future"}', reason: 'future' }).then(
        () => assert.fail('future save must halt'),
        reason => reason
    );

    assert.equal(clock.durabilityClearCount(), 1);
    assert.equal(error instanceof LegacySafety.AssetTrackerSaveError, true);
    assert.equal(error.queueOutcome, 'durability-unknown');
    assert.equal(error.terminalReason, 'save-outcome-unknown');
    assert.equal(acknowledged.length, 0);
    assert.equal(faults.length, 1);
    assert.strictEqual(faults[0], error);
    assert.strictEqual(futureError.terminalCause, error);
    assert.deepEqual(terminalCalls.map(call => call.reason), ['save-outcome-unknown']);
    assert.deepEqual(queue.getState(), {
        generationToken: 'generation-1',
        lanePhase: 'halted',
        primaryStatus: 'durability-unknown',
        barrierState: 'none',
        activeClientSaveId: null,
        activeClientSnapshotId: null,
        pendingCount: 0,
        lastAcknowledgedHash: H0,
        ordinaryRecoveryHealth: health('ordinary'),
        snapshotRecoveryHealth: health('snapshot'),
        accepting: false,
        halted: true
    });
});

test('structured rejection cannot replace a durability fault reentered by clearTimeout cleanup', async () => {
    const clock = reentrantClearClock();
    const result = deferred();
    const writeCalls = [];
    const acknowledged = [];
    const faults = [];
    const terminalCalls = [];
    const queue = makeQueue({
        clock: clock.clock,
        write: request => {
            writeCalls.push(request);
            return result.promise;
        },
        terminalize: request => {
            terminalCalls.push(request);
            return Promise.resolve(terminalReceipt(request));
        },
        onAcknowledged: receipt => {
            acknowledged.push(receipt);
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const savePromise = queue.enqueue({ stateJson: '{"memo":"reject-race"}', reason: 'H1' });
    const observed = savePromise.then(
        () => assert.fail('save must reject'),
        error => error
    );

    result.reject(structuredSaveError(writeCalls[0]));
    const error = await observed;
    const futureError = await queue.enqueue({ stateJson: '{"memo":"future"}', reason: 'future' }).then(
        () => assert.fail('future save must halt'),
        reason => reason
    );

    assert.equal(clock.durabilityClearCount(), 1);
    assert.equal(error instanceof LegacySafety.AssetTrackerSaveError, true);
    assert.equal(error.queueOutcome, 'durability-unknown');
    assert.equal(error.terminalReason, 'save-outcome-unknown');
    assert.equal(acknowledged.length, 0);
    assert.equal(faults.length, 1);
    assert.strictEqual(faults[0], error);
    assert.strictEqual(futureError.terminalCause, error);
    assert.deepEqual(terminalCalls.map(call => call.reason), ['save-outcome-unknown']);
    assert.equal(queue.getState().lanePhase, 'halted');
    assert.equal(queue.getState().primaryStatus, 'durability-unknown');
    assert.equal(queue.getState().lastAcknowledgedHash, H0);
    assert.equal(queue.getState().accepting, false);
    assert.equal(queue.getState().halted, true);
});

test('synchronous durability deadline callback halts before adapter I/O and cannot leave a late write', async t => {
    for (const throwsAfterCallback of [false, true]) {
        await t.test(throwsAfterCallback ? 'callback then registration throws' : 'callback then returns handle', async () => {
            const writeCalls = [];
            const terminalCalls = [];
            const cleared = [];
            let nextHandle = 0;
            const clock = {
                setTimeout(callback, delay) {
                    nextHandle += 1;
                    const handle = nextHandle;
                    if (delay === 29_000) {
                        callback();
                        if (throwsAfterCallback) throw new Error('registration failed after firing');
                    }
                    return handle;
                },
                clearTimeout(handle) {
                    cleared.push(handle);
                }
            };
            const queue = makeQueue({
                clock,
                write: request => {
                    writeCalls.push(request);
                    return Promise.resolve(nativeReceipt(request, H0, H1));
                },
                terminalize: request => {
                    terminalCalls.push(request);
                    return Promise.resolve(terminalReceipt(request));
                }
            });

            const error = await queue.enqueue({
                stateJson: `{"memo":"sync-timeout-${throwsAfterCallback}"}`,
                reason: 'timeout'
            }).then(
                () => assert.fail('synchronous deadline must reject'),
                reason => reason
            );

            assert.equal(error instanceof LegacySafety.AssetTrackerSaveError, true);
            assert.equal(error.queueOutcome, 'durability-unknown');
            assert.equal(writeCalls.length, 0, 'terminal timeout cannot fall through to adapter I/O');
            assert.deepEqual(terminalCalls.map(call => call.reason), ['save-outcome-unknown']);
            assert.equal(cleared.includes(1), !throwsAfterCallback);
            assert.equal(queue.getState().halted, true);
            assert.equal(queue.getState().lastAcknowledgedHash, H0);
        });
    }
});

test('timer handle zero is cleared for save ACK and synchronous terminal timeout cannot revive its handle', async t => {
    await t.test('save ACK clears handle zero', async () => {
        const result = deferred();
        const writeCalls = [];
        const cleared = [];
        const queue = makeQueue({
            clock: {
                setTimeout: () => 0,
                clearTimeout: handle => cleared.push(handle)
            },
            write: request => {
                writeCalls.push(request);
                return result.promise;
            }
        });
        const savePromise = queue.enqueue({ stateJson: '{"memo":"handle-zero"}', reason: 'H1' });

        result.resolve(nativeReceipt(writeCalls[0], H0, H1));
        await savePromise;

        assert.deepEqual(cleared, [0]);
        assert.equal(queue.getState().lastAcknowledgedHash, H1);
    });

    await t.test('synchronous terminal timeout clears returned handle zero and consumes late rejection', async () => {
        const result = deferred();
        const terminalResult = deferred();
        const writeCalls = [];
        const terminalCalls = [];
        const cleared = [];
        const queue = makeQueue({
            clock: {
                setTimeout(callback, delay) {
                    if (delay === 30_000) {
                        callback();
                        return 0;
                    }
                    return 1;
                },
                clearTimeout: handle => cleared.push(handle)
            },
            write: request => {
                writeCalls.push(request);
                return result.promise;
            },
            terminalize: request => {
                terminalCalls.push(request);
                return terminalResult.promise;
            }
        });
        const savePromise = queue.enqueue({ stateJson: '{"memo":"terminal-sync"}', reason: 'H1' });
        const observed = savePromise.then(
            () => assert.fail('save must reject'),
            error => error
        );

        result.reject(structuredSaveError(writeCalls[0]));
        const error = await observed;
        terminalResult.reject(new Error('late terminal transport loss'));
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(error.terminalReason, 'save-not-committed');
        assert.deepEqual(terminalCalls.map(call => call.reason), ['save-not-committed']);
        assert.deepEqual(cleared, [1, 0]);
        assert.equal(queue.getState().halted, true);
        assert.equal(queue.getState().lastAcknowledgedHash, H0);
    });
});

test('terminal receipt uses exact one-read extraction while malformed and lost ACKs leave Web terminal', async t => {
    for (const settlement of ['malformed', 'lost']) {
        await t.test(settlement, async () => {
            const result = deferred();
            const terminalResult = deferred();
            const writeCalls = [];
            const terminalCalls = [];
            const queue = makeQueue({
                write: request => {
                    writeCalls.push(request);
                    return result.promise;
                },
                terminalize: request => {
                    terminalCalls.push(request);
                    return terminalResult.promise;
                }
            });
            const savePromise = queue.enqueue({
                stateJson: `{"memo":"terminal-${settlement}"}`,
                reason: settlement
            });
            const observed = savePromise.then(
                () => assert.fail('save must reject'),
                error => error
            );

            result.reject(structuredSaveError(writeCalls[0]));
            const error = await observed;
            if (settlement === 'lost') {
                terminalResult.reject(new Error('terminal ACK lost'));
            } else {
                const receiptSource = oneReadRecord('terminalReceipt', {
                    ok: true,
                    protocolVersion: 2,
                    loadId: terminalCalls[0].sessionContext.loadId,
                    reason: 'wrong-reason',
                    gateState: 'terminal-locked'
                });
                terminalResult.resolve(receiptSource.record);
                await new Promise(resolve => setImmediate(resolve));
                receiptSource.assertEachReadOnce();
            }
            await new Promise(resolve => setImmediate(resolve));

            assert.equal(error.terminalReason, 'save-not-committed');
            assert.equal(queue.getState().halted, true);
            assert.equal(queue.getState().lastAcknowledgedHash, H0);
            assert.equal(terminalCalls.length, 1);
        });
    }
});

test('preparation message getter reentrant enqueue stays future-halted for candidate terminalization', async t => {
    for (const getterOutcome of ['return', 'throw']) {
        await t.test(getterOutcome, async () => {
            const clock = manualClock();
            const writeCalls = [];
            const transitions = [];
            const faults = [];
            let reentrantPromise = null;
            let queue;
            queue = makeQueue({
                clock: clock.clock,
                write: request => {
                    writeCalls.push(request);
                    return Promise.reject(new Error('reentrant candidate must not write'));
                },
                terminalize: request => Promise.resolve(terminalReceipt(request)),
                onTransition: state => {
                    transitions.push(state);
                    return undefined;
                },
                onFault: fault => {
                    faults.push(fault);
                    return undefined;
                }
            });
            const candidateError = Object.defineProperty({}, 'message', {
                get() {
                    reentrantPromise = queue.enqueue({
                        stateJson: `{"memo":"getter-${getterOutcome}"}`,
                        reason: 'getter-reentrant'
                    });
                    if (getterOutcome === 'throw') throw new Error('hostile message getter');
                    return 'candidate getter message';
                }
            });

            const preparationPromise = queue.failPreparation(candidateError);
            const reentrantObserved = reentrantPromise.then(
                () => assert.fail('getter reentrant enqueue must halt'),
                error => error
            );
            const preparationError = await preparationPromise.then(
                () => assert.fail('preparation must reject'),
                error => error
            );

            assert.equal(writeCalls.length, 0, 'getter reentrant enqueue is never accepted or dispatched');
            const transition = transitions.find(state => state.transitionKind === 'preparation-rejected');
            assert.equal(transition.visibleStateJson, '{"memo":"H0"}');
            assert.equal(transition.pendingCount, 1, 'only the no-I/O preparation marker is pending');
            assert.equal(preparationError.message, getterOutcome === 'throw'
                ? 'Candidate preparation failed'
                : 'candidate getter message');
            const reentrantError = await reentrantObserved;
            assert.equal(reentrantError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
            assert.equal(faults.length, 1);
            assert.equal(faults[0].terminalReason, 'candidate-invalid');
            assert.strictEqual(reentrantError.terminalCause, faults[0]);
        });
    }
});

test('preparation message getter reentrant enqueue binds the replacement callback terminal cause', async () => {
    const clock = manualClock();
    const writeCalls = [];
    const transitions = [];
    const faults = [];
    let reentrantPromise = null;
    let queue;
    queue = makeQueue({
        clock: clock.clock,
        write: request => {
            writeCalls.push(request);
            return Promise.reject(new Error('reentrant candidate must not write'));
        },
        terminalize: request => Promise.resolve(terminalReceipt(request)),
        onTransition: state => {
            transitions.push(state);
            if (state.transitionKind === 'preparation-rejected') {
                throw new Error('preparation transition failed');
            }
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const candidateError = Object.defineProperty({}, 'message', {
        get() {
            reentrantPromise = queue.enqueue({
                stateJson: '{"memo":"getter-callback"}',
                reason: 'getter-reentrant'
            });
            return 'candidate getter message';
        }
    });

    const preparationPromise = queue.failPreparation(candidateError);
    const reentrantObserved = reentrantPromise.then(
        () => assert.fail('getter reentrant enqueue must halt'),
        error => error
    );
    const preparationError = await preparationPromise.then(
        () => assert.fail('callback marker must reject'),
        error => error
    );

    assert.equal(writeCalls.length, 0, 'getter reentrant enqueue is never accepted or dispatched');
    const transition = transitions.find(state => state.transitionKind === 'preparation-rejected');
    assert.equal(transition.visibleStateJson, '{"memo":"H0"}');
    assert.equal(transition.pendingCount, 1);
    const reentrantError = await reentrantObserved;
    assert.equal(preparationError instanceof LegacySafety.AssetTrackerQueueCallbackError, true);
    assert.equal(faults.length, 1);
    assert.strictEqual(faults[0], preparationError);
    assert.equal(reentrantError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
    assert.strictEqual(reentrantError.terminalCause, preparationError);
});

test('preparation message getter reentrant enqueue waits for an earlier H1 terminal cause', async () => {
    const clock = manualClock();
    const first = deferred();
    const writeCalls = [];
    const transitions = [];
    const faults = [];
    let reentrantPromise = null;
    let queue;
    queue = makeQueue({
        clock: clock.clock,
        write: request => {
            writeCalls.push(request);
            return first.promise;
        },
        terminalize: request => Promise.resolve(terminalReceipt(request)),
        onTransition: state => {
            transitions.push(state);
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const firstPromise = queue.enqueue({ stateJson: '{"memo":"accepted-H1"}', reason: 'H1' });
    const firstObserved = firstPromise.then(
        () => assert.fail('H1 must reject'),
        error => error
    );
    const candidateError = Object.defineProperty({}, 'message', {
        get() {
            reentrantPromise = queue.enqueue({
                stateJson: '{"memo":"unaccepted-H2"}',
                reason: 'getter-reentrant'
            });
            return 'candidate getter message';
        }
    });
    const preparationObserved = queue.failPreparation(candidateError).then(
        () => assert.fail('preparation must reject'),
        error => error
    );
    let reentrantSettled = false;
    const reentrantObserved = reentrantPromise.then(
        () => assert.fail('getter reentrant enqueue must halt'),
        error => {
            reentrantSettled = true;
            return error;
        }
    );
    await Promise.resolve();

    assert.equal(reentrantSettled, false, 'future capability waits for the FIFO winner');
    assert.equal(writeCalls.length, 1, 'only previously accepted H1 performs I/O');
    const transition = transitions.find(state => state.transitionKind === 'preparation-rejected');
    assert.equal(transition.visibleStateJson, '{"memo":"accepted-H1"}');
    assert.equal(transition.pendingCount, 2, 'H1 plus preparation marker; getter item was not accepted');

    first.reject(structuredSaveError(writeCalls[0]));
    const firstError = await firstObserved;
    await preparationObserved;
    const reentrantError = await reentrantObserved;

    assert.equal(firstError.terminalReason, 'save-not-committed');
    assert.equal(reentrantError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
    assert.strictEqual(reentrantError.terminalCause, firstError);
    assert.strictEqual(faults[0], firstError);
    assert.equal(faults.length, 1);
    assert.equal(writeCalls.length, 1);
});

test('preparation message getter cannot append after an active H1 deadline becomes authoritative', async t => {
    for (const getterOutcome of ['return', 'throw']) {
        await t.test(getterOutcome, async () => {
            const first = deferred();
            const writeCalls = [];
            const transitions = [];
            const faults = [];
            const terminalCalls = [];
            let durabilityCallback = null;
            const queue = makeQueue({
                clock: {
                    setTimeout(callback, delay) {
                        if (delay === 29_000) {
                            durabilityCallback = callback;
                            return 'durability-deadline';
                        }
                        return 'terminalization-deadline';
                    },
                    clearTimeout: () => undefined
                },
                write: request => {
                    writeCalls.push(request);
                    return first.promise;
                },
                terminalize: request => {
                    terminalCalls.push(request);
                    return Promise.resolve(terminalReceipt(request));
                },
                onTransition: state => {
                    transitions.push(state);
                    return undefined;
                },
                onFault: fault => {
                    faults.push(fault);
                    return undefined;
                }
            });
            const firstPromise = queue.enqueue({
                stateJson: `{"memo":"active-H1-${getterOutcome}"}`,
                reason: 'H1'
            });
            const firstObserved = firstPromise.then(
                () => assert.fail('H1 deadline must reject'),
                error => error
            );
            assert.equal(typeof durabilityCallback, 'function');
            const candidateError = Object.defineProperty({}, 'message', {
                get() {
                    durabilityCallback();
                    if (getterOutcome === 'throw') throw new Error('hostile message getter');
                    return 'candidate getter message';
                }
            });

            const preparationObserved = queue.failPreparation(candidateError).then(
                () => assert.fail('preparation after terminal H1 must reject'),
                error => error
            );
            const firstError = await firstObserved;
            const preparationError = await preparationObserved;
            const terminalTransitionIndex = transitions.findIndex(state =>
                state.halted === true && state.lanePhase === 'halted'
            );
            const state = queue.getState();

            assert.notEqual(terminalTransitionIndex, -1, 'H1 publishes its terminal transition');
            assert.equal(
                transitions.some(transition => transition.transitionKind === 'preparation-rejected'),
                false,
                'the losing preparation never publishes a transition'
            );
            assert.equal(
                transitions.length,
                terminalTransitionIndex + 1,
                'nothing republishes queue state after the terminal transition'
            );
            assert.equal(state.halted, true);
            assert.equal(state.lanePhase, 'halted');
            assert.equal(state.pendingCount, 0, 'the losing preparation appends no marker');
            assert.equal(state.primaryStatus, 'durability-unknown');
            assert.equal(firstError instanceof LegacySafety.AssetTrackerSaveError, true);
            assert.equal(firstError.terminalReason, 'save-outcome-unknown');
            assert.equal(preparationError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
            assert.strictEqual(preparationError.terminalCause, firstError);
            assert.equal(faults.length, 1);
            assert.strictEqual(faults[0], firstError);
            assert.deepEqual(terminalCalls.map(call => call.reason), ['save-outcome-unknown']);
            assert.equal(writeCalls.length, 1);

            first.resolve(nativeReceipt(writeCalls[0], H0, H1));
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(queue.getState().lastAcknowledgedHash, H0, 'late H1 ACK stays inert');
            assert.equal(faults.length, 1);
            assert.equal(terminalCalls.length, 1);
        });
    }
});

test('preparation marker publishes the accepted H1 tail synchronously and terminalizes only after H1 ACK', async () => {
    const clock = manualClock();
    const first = deferred();
    const writeCalls = [];
    const transitions = [];
    const faults = [];
    const terminalCalls = [];
    let failPreparationReturned = false;
    const queue = makeQueue({
        clock: clock.clock,
        write: request => {
            writeCalls.push(request);
            return first.promise;
        },
        terminalize: request => {
            terminalCalls.push(request);
            return Promise.resolve(terminalReceipt(request));
        },
        onTransition: state => {
            transitions.push({ state, beforeReturn: !failPreparationReturned });
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const firstPromise = queue.enqueue({ stateJson: '{"memo":"accepted-H1"}', reason: 'H1' });
    const preparationPromise = queue.failPreparation(new Error('candidate H2 invalid'));
    failPreparationReturned = true;
    const preparationObserved = preparationPromise.then(
        () => assert.fail('invalid candidate must reject'),
        error => error
    );
    const preparationTransition = transitions.find(entry =>
        entry.state.transitionKind === 'preparation-rejected'
    );

    assert.ok(preparationTransition, 'preparation transition is emitted before return');
    assert.equal(preparationTransition.beforeReturn, true);
    assert.equal(preparationTransition.state.visibleStateJson, '{"memo":"accepted-H1"}');
    assert.equal(preparationTransition.state.accepting, false);
    assert.equal(preparationTransition.state.pendingCount, 2, 'H1 plus no-I/O marker');
    assert.equal(preparationTransition.state.lanePhase, 'saving');
    assert.equal(Object.isFrozen(preparationTransition.state), true);
    assert.equal(writeCalls.length, 1);
    assert.equal(faults.length, 0, 'marker waits behind H1');
    assert.equal(terminalCalls.length, 0);

    let futureSettled = false;
    const futureObserved = queue.enqueue({ stateJson: '{"memo":"future"}', reason: 'future' }).then(
        () => assert.fail('accepting stopped in preparation turn'),
        error => {
            futureSettled = true;
            return error;
        }
    );
    await Promise.resolve();
    assert.equal(futureSettled, false, 'future halted cause waits for the FIFO winner');

    first.resolve(nativeReceipt(writeCalls[0], H0, H1));
    const firstReceipt = await firstPromise;
    const preparationError = await preparationObserved;
    const futureError = await futureObserved;

    assert.equal(firstReceipt.stateHashAfter, H1);
    assert.equal(preparationError instanceof LegacySafety.AssetTrackerSaveError, true);
    assert.equal(preparationError.terminalReason, 'candidate-invalid');
    assert.equal(futureError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
    assert.strictEqual(futureError.terminalCause, faults[0]);
    assert.equal(faults.length, 1);
    assert.equal(faults[0].terminalReason, 'candidate-invalid');
    assert.equal(faults[0].queueOutcome, 'preparation-rejected');
    assert.equal(faults[0].lastAcknowledgedStateJson, '{"memo":"accepted-H1"}');
    assert.equal(faults[0].lastAcknowledgedHash, H1);
    assert.equal(faults[0].attemptedStateJson, null);
    assert.equal(faults[0].activeClientItemId, null);
    assert.equal(faults[0].callbackFaultId, null);
    assert.equal(Object.isFrozen(faults[0]), true);
    assert.deepEqual(terminalCalls.map(call => call.reason), ['candidate-invalid']);
    assert.equal(writeCalls.length, 1, 'marker creates no save ID or adapter call');
    assert.equal(queue.getState().lastAcknowledgedHash, H1);
    assert.equal(queue.getState().primaryStatus, 'failed-readonly');
    assert.equal(
        transitions.some(entry => entry.state.primaryStatus === 'native-durable'
            && entry.state.lanePhase === 'idle'),
        false,
        'marker suppresses intermediate stable H1 success'
    );
});

test('preparation marker restores the most recent accepted H2 tail and performs zero invalid H3 I/O', async () => {
    const clock = manualClock();
    const first = deferred();
    const second = deferred();
    const writeCalls = [];
    const transitions = [];
    const faults = [];
    const queue = makeQueue({
        clock: clock.clock,
        write: request => {
            writeCalls.push(request);
            return writeCalls.length === 1 ? first.promise : second.promise;
        },
        terminalize: request => Promise.resolve(terminalReceipt(request)),
        onTransition: state => {
            transitions.push(state);
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const firstPromise = queue.enqueue({ stateJson: '{"memo":"accepted-H1"}', reason: 'H1' });
    const secondPromise = queue.enqueue({ stateJson: '{"memo":"accepted-H2"}', reason: 'H2' });
    const preparationPromise = queue.failPreparation(new Error('rendered H3 invalid'));
    const preparationObserved = preparationPromise.then(
        () => assert.fail('invalid H3 must reject'),
        error => error
    );
    const transition = transitions.find(state => state.transitionKind === 'preparation-rejected');

    assert.equal(transition.visibleStateJson, '{"memo":"accepted-H2"}');
    assert.equal(transition.pendingCount, 3, 'H1, H2, and marker are ordered');
    assert.equal(writeCalls.length, 1);

    first.resolve(nativeReceipt(writeCalls[0], H0, H1));
    await firstPromise;
    assert.equal(writeCalls.length, 2);
    second.resolve(nativeReceipt(writeCalls[1], H1, H2));
    await secondPromise;
    const preparationError = await preparationObserved;

    assert.equal(preparationError.terminalReason, 'candidate-invalid');
    assert.equal(writeCalls.length, 2, 'invalid H3 has no adapter request');
    assert.equal(faults[0].lastAcknowledgedStateJson, '{"memo":"accepted-H2"}');
    assert.equal(faults[0].lastAcknowledgedHash, H2);
    assert.equal(queue.getState().lastAcknowledgedHash, H2);
    assert.equal(
        transitions.some(state => state.primaryStatus === 'native-durable'
            && state.lanePhase === 'idle'),
        false,
        'tail marker suppresses H1/H2 stable success'
    );
});

test('onAcknowledged reentrant failPreparation suppresses stable success before the first caller reaction', async () => {
    const result = deferred();
    const writeCalls = [];
    const transitions = [];
    const faults = [];
    let preparationPromise = null;
    let queue;
    queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            return result.promise;
        },
        terminalize: request => Promise.resolve(terminalReceipt(request)),
        onAcknowledged: () => {
            preparationPromise = queue.failPreparation(new Error('reentrant candidate invalid'));
            return undefined;
        },
        onTransition: state => {
            transitions.push(state);
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const savePromise = queue.enqueue({ stateJson: '{"memo":"ack-then-invalid"}', reason: 'H1' });
    let callerObservedState = null;
    const callerObserved = savePromise.then(receipt => {
        callerObservedState = queue.getState();
        return receipt;
    });

    result.resolve(nativeReceipt(writeCalls[0], H0, H1));
    const receipt = await callerObserved;
    const preparationError = await preparationPromise.then(
        () => assert.fail('reentrant preparation must reject'),
        error => error
    );

    assert.equal(receipt.stateHashAfter, H1);
    assert.equal(preparationError.terminalReason, 'candidate-invalid');
    assert.equal(callerObservedState.halted, true, 'caller observes the completed marker fence');
    assert.equal(callerObservedState.lastAcknowledgedHash, H1);
    const futureError = await queue.enqueue({ stateJson: '{"memo":"future"}', reason: 'future' }).then(
        () => assert.fail('future must halt'),
        error => error
    );
    assert.strictEqual(futureError.terminalCause, faults[0]);
    assert.equal(
        transitions.some(state => state.primaryStatus === 'native-durable'
            && state.lanePhase === 'idle'),
        false,
        'reentrant marker suppresses stable H1 success'
    );
    assert.equal(writeCalls.length, 1);
});

test('preparation marker uses the acknowledged baseline when no save was accepted', async () => {
    const writeCalls = [];
    const transitions = [];
    const faults = [];
    const terminalCalls = [];
    const queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            return Promise.reject(new Error('must not write'));
        },
        terminalize: request => {
            terminalCalls.push(request);
            return Promise.resolve(terminalReceipt(request));
        },
        onTransition: state => {
            transitions.push(state);
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });

    const error = await queue.failPreparation(new Error('initial candidate invalid')).then(
        () => assert.fail('preparation must reject'),
        reason => reason
    );
    const transition = transitions.find(state => state.transitionKind === 'preparation-rejected');

    assert.equal(transition.visibleStateJson, '{"memo":"H0"}');
    assert.equal(transition.pendingCount, 1);
    assert.equal(error.terminalReason, 'candidate-invalid');
    assert.equal(faults.length, 1);
    assert.equal(faults[0].lastAcknowledgedStateJson, '{"memo":"H0"}');
    assert.equal(writeCalls.length, 0);
    assert.deepEqual(terminalCalls.map(call => call.reason), ['candidate-invalid']);
});

for (const earlierOutcome of ['not-committed', 'unknown', 'conflict']) {
    test(`earlier H1 ${earlierOutcome} wins over and cancels a preparation marker`, async () => {
        const clock = manualClock();
        const first = deferred();
        const writeCalls = [];
        const faults = [];
        const terminalCalls = [];
        const queue = makeQueue({
            clock: clock.clock,
            write: request => {
                writeCalls.push(request);
                return first.promise;
            },
            terminalize: request => {
                terminalCalls.push(request);
                return Promise.resolve(terminalReceipt(request));
            },
            onFault: fault => {
                faults.push(fault);
                return undefined;
            }
        });
        const firstPromise = queue.enqueue({ stateJson: '{"memo":"active-H1"}', reason: 'H1' });
        const firstObserved = firstPromise.then(
            () => assert.fail('H1 must reject'),
            error => error
        );
        const preparationObserved = queue.failPreparation(new Error('H2 invalid')).then(
            () => assert.fail('preparation must reject'),
            error => error
        );
        let futureSettled = false;
        const futureObserved = queue.enqueue({ stateJson: '{"memo":"future"}', reason: 'future' }).then(
            () => assert.fail('future save must halt'),
            error => {
                futureSettled = true;
                return error;
            }
        );
        await Promise.resolve();
        assert.equal(futureSettled, false, 'future terminal cause is not provisional');

        if (earlierOutcome === 'not-committed') {
            first.reject(structuredSaveError(writeCalls[0]));
        } else if (earlierOutcome === 'conflict') {
            first.reject(structuredSaveError(writeCalls[0], {
                conflict: 'source-changed',
                sourceHashAfter: H2
            }));
        } else {
            first.reject(new Error('transport lost'));
        }
        const firstError = await firstObserved;
        const preparationError = await preparationObserved;
        const futureError = await futureObserved;

        assert.equal(preparationError instanceof LegacySafety.AssetTrackerSaveError, true);
        assert.equal(preparationError.terminalReason, 'candidate-invalid');
        assert.equal(futureError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
        assert.strictEqual(futureError.terminalCause, firstError);
        assert.strictEqual(faults[0], firstError, 'H1 is the sole onFault cause');
        assert.equal(faults.length, 1);
        assert.deepEqual(terminalCalls.map(call => call.reason), [
            earlierOutcome === 'not-committed'
                ? 'save-not-committed'
                : earlierOutcome === 'conflict'
                    ? 'save-conflict'
                    : 'save-outcome-unknown'
        ]);
        assert.equal(writeCalls.length, 1);
    });
}

test('preparation transition callback failure replaces the candidate marker with one callback marker', async () => {
    const writeCalls = [];
    const faults = [];
    const terminalCalls = [];
    const queue = makeQueue({
        write: request => {
            writeCalls.push(request);
            return Promise.reject(new Error('must not write'));
        },
        terminalize: request => {
            terminalCalls.push(request);
            return Promise.resolve(terminalReceipt(request));
        },
        onTransition: state => {
            if (state.transitionKind === 'preparation-rejected') {
                throw new Error('visible rollback callback failed');
            }
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });

    const error = await queue.failPreparation(new Error('candidate invalid')).then(
        () => assert.fail('replacement callback marker must reject'),
        reason => reason
    );

    assert.equal(error instanceof LegacySafety.AssetTrackerQueueCallbackError, true);
    assert.equal(error.terminalReason, 'queue-callback-failed');
    assert.equal(error.causeKind, 'pre-dispatch-callback');
    assert.equal(error.callbackName, 'onTransition');
    assert.match(error.callbackFaultId, /\S/);
    assert.strictEqual(faults[0], error);
    assert.equal(faults.length, 1);
    assert.deepEqual(terminalCalls.map(call => call.reason), ['queue-callback-failed']);
    assert.equal(writeCalls.length, 0);
});

for (const callbackOutcome of ['throw', 'non-undefined']) {
    test(`preparation callback ${callbackOutcome} keeps reentrant enqueue behind the replacement marker`, async () => {
        const writeCalls = [];
        const faults = [];
        const terminalCalls = [];
        let reentrantPromise = null;
        let insidePreparation = false;
        let queue;
        queue = makeQueue({
            write: request => {
                writeCalls.push(request);
                return Promise.reject(new Error('must not write'));
            },
            terminalize: request => {
                terminalCalls.push(request);
                return Promise.resolve(terminalReceipt(request));
            },
            onTransition: state => {
                if (state.transitionKind === 'preparation-rejected' && !insidePreparation) {
                    insidePreparation = true;
                    reentrantPromise = queue.enqueue({
                        stateJson: '{"memo":"reentrant-after-preparation"}',
                        reason: 'reentrant'
                    });
                    insidePreparation = false;
                    if (callbackOutcome === 'throw') throw new Error('preparation callback failed');
                    return { callbackProtocol: 'invalid' };
                }
                return undefined;
            },
            onFault: fault => {
                faults.push(fault);
                return undefined;
            }
        });

        const preparationPromise = queue.failPreparation(new Error('candidate invalid'));
        const preparationObserved = preparationPromise.then(
            () => assert.fail('replacement marker must reject'),
            error => error
        );
        const reentrantObserved = reentrantPromise.then(
            () => assert.fail('reentrant future enqueue must halt'),
            error => error
        );
        const preparationError = await preparationObserved;
        const reentrantError = await reentrantObserved;

        assert.equal(preparationError instanceof LegacySafety.AssetTrackerQueueCallbackError, true);
        assert.equal(preparationError.terminalReason, 'queue-callback-failed');
        assert.equal(reentrantError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
        assert.strictEqual(reentrantError.terminalCause, preparationError);
        assert.strictEqual(faults[0], preparationError);
        assert.equal(faults.length, 1);
        assert.deepEqual(terminalCalls.map(call => call.reason), ['queue-callback-failed']);
        assert.equal(writeCalls.length, 0);
    });
}

test('active H1 storage fault wins over a preparation callback marker and its reentrant item', async () => {
    const clock = manualClock();
    const first = deferred();
    const writeCalls = [];
    const faults = [];
    const terminalCalls = [];
    let reentrantPromise = null;
    let insidePreparation = false;
    let queue;
    queue = makeQueue({
        clock: clock.clock,
        write: request => {
            writeCalls.push(request);
            return first.promise;
        },
        terminalize: request => {
            terminalCalls.push(request);
            return Promise.resolve(terminalReceipt(request));
        },
        onTransition: state => {
            if (state.transitionKind === 'preparation-rejected' && !insidePreparation) {
                insidePreparation = true;
                reentrantPromise = queue.enqueue({
                    stateJson: '{"memo":"reentrant-H3"}',
                    reason: 'H3'
                });
                insidePreparation = false;
                throw new Error('preparation callback failed');
            }
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const firstPromise = queue.enqueue({ stateJson: '{"memo":"active-H1"}', reason: 'H1' });
    const firstObserved = firstPromise.then(
        () => assert.fail('H1 must reject'),
        error => error
    );
    const preparationPromise = queue.failPreparation(new Error('candidate H2 invalid'));
    const preparationObserved = preparationPromise.then(
        () => assert.fail('callback marker must be cancelled'),
        error => error
    );
    const reentrantObserved = reentrantPromise.then(
        () => assert.fail('reentrant future enqueue must halt'),
        error => error
    );

    first.reject(structuredSaveError(writeCalls[0]));
    const firstError = await firstObserved;
    const preparationError = await preparationObserved;
    const reentrantError = await reentrantObserved;

    assert.equal(preparationError instanceof LegacySafety.AssetTrackerQueueAbortError, true);
    assert.equal(preparationError.causedByClientItemId, writeCalls[0].clientSaveId);
    assert.equal(preparationError.causeKind, 'storage-item');
    assert.equal(preparationError.callbackFaultId, null);
    assert.equal(reentrantError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
    assert.strictEqual(reentrantError.terminalCause, firstError);
    assert.strictEqual(faults[0], firstError);
    assert.equal(faults.length, 1);
    assert.deepEqual(terminalCalls.map(call => call.reason), ['save-not-committed']);
    assert.equal(writeCalls.length, 1);
});

test('active H1 ACK lets a preparation callback marker become the exact future halted cause', async () => {
    const clock = manualClock();
    const first = deferred();
    const writeCalls = [];
    const faults = [];
    let futurePromise = null;
    let queue;
    queue = makeQueue({
        clock: clock.clock,
        write: request => {
            writeCalls.push(request);
            return first.promise;
        },
        terminalize: request => Promise.resolve(terminalReceipt(request)),
        onTransition: state => {
            if (state.transitionKind === 'preparation-rejected' && futurePromise === null) {
                futurePromise = queue.enqueue({ stateJson: '{"memo":"future"}', reason: 'future' });
                throw new Error('preparation transition failed');
            }
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const firstPromise = queue.enqueue({ stateJson: '{"memo":"active-H1"}', reason: 'H1' });
    const preparationObserved = queue.failPreparation(new Error('candidate H2 invalid')).then(
        () => assert.fail('callback marker must reject'),
        error => error
    );
    let futureSettled = false;
    const futureObserved = futurePromise.then(
        () => assert.fail('future must halt'),
        error => {
            futureSettled = true;
            return error;
        }
    );
    await Promise.resolve();
    assert.equal(futureSettled, false, 'H1 remains the earlier possible winner');

    first.resolve(nativeReceipt(writeCalls[0], H0, H1));
    await firstPromise;
    const preparationError = await preparationObserved;
    const futureError = await futureObserved;

    assert.equal(preparationError instanceof LegacySafety.AssetTrackerQueueCallbackError, true);
    assert.equal(preparationError.lastAcknowledgedHash, H1);
    assert.equal(futureError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
    assert.strictEqual(futureError.terminalCause, preparationError);
    assert.strictEqual(faults[0], preparationError);
    assert.equal(writeCalls.length, 1);
});

test('callback marker waits behind active H1 ACK, then faults H2 and aborts reentrant H3 in place', async () => {
    const clock = manualClock();
    const first = deferred();
    const writeCalls = [];
    const transitions = [];
    const faults = [];
    const terminalCalls = [];
    let shouldFailH2 = false;
    let thirdPromise = null;
    let queue;
    queue = makeQueue({
        clock: clock.clock,
        write: request => {
            writeCalls.push(request);
            return first.promise;
        },
        terminalize: request => {
            terminalCalls.push(request);
            return Promise.resolve(terminalReceipt(request));
        },
        onTransition: state => {
            transitions.push(state);
            if (shouldFailH2 && state.pendingCount === 2) {
                shouldFailH2 = false;
                thirdPromise = queue.enqueue({ stateJson: '{"memo":"reentrant-H3"}', reason: 'H3' });
                throw new Error('H2 transition failed');
            }
            return undefined;
        },
        onFault: fault => {
            faults.push(fault);
            return undefined;
        }
    });
    const firstPromise = queue.enqueue({ stateJson: '{"memo":"active-H1"}', reason: 'H1' });
    const firstObserved = firstPromise.then(
        receipt => ({ receipt }),
        error => ({ error })
    );
    shouldFailH2 = true;
    const secondPromise = queue.enqueue({ stateJson: '{"memo":"failed-H2"}', reason: 'H2' });
    const secondObserved = secondPromise.then(
        () => assert.fail('H2 callback marker must reject'),
        error => error
    );
    const thirdObserved = thirdPromise.then(
        () => assert.fail('reentrant H3 must abort'),
        error => error
    );

    assert.equal(writeCalls.length, 1, 'H2/H3 remain undispatched behind H1');
    assert.equal(queue.getState().accepting, false);
    assert.equal(queue.getState().pendingCount, 3);
    assert.equal(faults.length, 0, 'callback marker has not reached head');
    assert.equal(terminalCalls.length, 0);

    first.resolve(nativeReceipt(writeCalls[0], H0, H1));
    const firstOutcome = await firstObserved;
    const secondError = await secondObserved;
    const thirdError = await thirdObserved;

    assert.equal(firstOutcome.error, undefined);
    assert.equal(firstOutcome.receipt.stateHashAfter, H1);
    assert.equal(secondError instanceof LegacySafety.AssetTrackerQueueCallbackError, true);
    assert.equal(secondError.queueOutcome, 'callback-failed');
    assert.equal(secondError.terminalReason, 'queue-callback-failed');
    assert.equal(secondError.causeKind, 'pre-dispatch-callback');
    assert.equal(secondError.callbackName, 'onTransition');
    assert.equal(secondError.activeClientItemId, 'load-1:save:2');
    assert.equal(secondError.attemptedStateJson, '{"memo":"failed-H2"}');
    assert.equal(secondError.lastAcknowledgedStateJson, '{"memo":"active-H1"}');
    assert.equal(secondError.lastAcknowledgedHash, H1);
    assert.match(secondError.callbackFaultId, /\S/);
    assert.strictEqual(faults[0], secondError);

    assert.equal(thirdError instanceof LegacySafety.AssetTrackerQueueAbortError, true);
    assert.equal(thirdError.causedByClientItemId, 'load-1:save:2');
    assert.equal(thirdError.causeKind, 'pre-dispatch-callback');
    assert.equal(thirdError.callbackFaultId, secondError.callbackFaultId);
    assert.equal(thirdError.completedItemKind, null);
    assert.equal(thirdError.completedClientItemId, null);
    assert.equal(thirdError.completedOutcome, null);
    assert.equal(Object.isFrozen(thirdError), true);
    assert.equal(writeCalls.length, 1, 'marker and H3 perform zero adapter I/O');
    assert.equal(queue.getState().lastAcknowledgedHash, H1);
    assert.equal(queue.getState().primaryStatus, 'failed-readonly');
    assert.equal(faults.length, 1);
    assert.deepEqual(terminalCalls.map(call => call.reason), ['queue-callback-failed']);
    assert.equal(
        transitions.some(state => state.primaryStatus === 'native-durable'
            && state.lanePhase === 'idle'),
        false,
        'callback marker suppresses intermediate H1 stable success'
    );

    const futureError = await queue.enqueue({ stateJson: '{"memo":"future"}', reason: 'future' }).then(
        () => assert.fail('future save must halt'),
        error => error
    );
    assert.equal(futureError instanceof LegacySafety.AssetTrackerQueueHaltedError, true);
    assert.strictEqual(futureError.terminalCause, secondError);
});

for (const earlierOutcome of ['not-committed', 'unknown']) {
    test(`active H1 ${earlierOutcome} cancels the H2 callback marker and reentrant H3 with H1 as sole cause`, async () => {
        const clock = manualClock();
        const first = deferred();
        const writeCalls = [];
        const faults = [];
        const terminalCalls = [];
        let shouldFailH2 = false;
        let thirdPromise = null;
        let queue;
        queue = makeQueue({
            clock: clock.clock,
            write: request => {
                writeCalls.push(request);
                return first.promise;
            },
            terminalize: request => {
                terminalCalls.push(request);
                return Promise.resolve(terminalReceipt(request));
            },
            onTransition: state => {
                if (shouldFailH2 && state.pendingCount === 2) {
                    shouldFailH2 = false;
                    thirdPromise = queue.enqueue({ stateJson: '{"memo":"reentrant-H3"}', reason: 'H3' });
                    throw new Error('H2 transition failed');
                }
                return undefined;
            },
            onFault: fault => {
                faults.push(fault);
                return undefined;
            }
        });
        const firstPromise = queue.enqueue({ stateJson: '{"memo":"active-H1"}', reason: 'H1' });
        const firstObserved = firstPromise.then(
            () => assert.fail('H1 must reject'),
            error => error
        );
        shouldFailH2 = true;
        const secondPromise = queue.enqueue({ stateJson: '{"memo":"failed-H2"}', reason: 'H2' });
        const secondObserved = secondPromise.then(
            () => assert.fail('H2 marker must be cancelled'),
            error => error
        );
        const thirdObserved = thirdPromise.then(
            () => assert.fail('H3 must be cancelled'),
            error => error
        );

        if (earlierOutcome === 'not-committed') {
            first.reject(structuredSaveError(writeCalls[0]));
        } else {
            first.reject(new Error('transport lost'));
        }
        const firstError = await firstObserved;
        const secondError = await secondObserved;
        const thirdError = await thirdObserved;

        assert.equal(firstError instanceof LegacySafety.AssetTrackerSaveError, true);
        for (const pendingError of [secondError, thirdError]) {
            assert.equal(pendingError instanceof LegacySafety.AssetTrackerQueueAbortError, true);
            assert.equal(pendingError.causedByClientItemId, writeCalls[0].clientSaveId);
            assert.equal(pendingError.causeKind, 'storage-item');
            assert.equal(pendingError.callbackFaultId, null);
        }
        assert.strictEqual(faults[0], firstError);
        assert.equal(faults.length, 1, 'H2 callback draft never emits onFault');
        assert.deepEqual(terminalCalls.map(call => call.reason), [
            earlierOutcome === 'not-committed' ? 'save-not-committed' : 'save-outcome-unknown'
        ]);
        assert.equal(writeCalls.length, 1);
    });
}

test('terminal onFault throw and hostile thenable returns cannot create a second fault or rejection', async t => {
    const variants = [
        ['throw', () => { throw new Error('onFault failed'); }],
        ['resolved thenable', () => Promise.resolve('invalid callback return')],
        ['rejected thenable', () => Promise.reject(new Error('diagnostic reject'))],
        ['never thenable', () => new Promise(() => {})],
        ['throwing then getter', () => Object.defineProperty({}, 'then', {
            get() { throw new Error('then getter failed'); }
        })],
        ['settle then throw', () => ({
            then(resolve) {
                resolve('done');
                throw new Error('after settle');
            }
        })],
        ['double settlement', () => ({
            then(resolve, reject) {
                resolve('first');
                reject(new Error('second'));
            }
        })]
    ];

    for (const [label, onFault] of variants) {
        await t.test(label, async () => {
            const result = deferred();
            const writeCalls = [];
            const terminalCalls = [];
            const queue = makeQueue({
                write: request => {
                    writeCalls.push(request);
                    return result.promise;
                },
                terminalize: request => {
                    terminalCalls.push(request);
                    return Promise.resolve(terminalReceipt(request));
                },
                onFault
            });
            const savePromise = queue.enqueue({ stateJson: `{"memo":"${label}"}`, reason: label });
            const observed = savePromise.then(
                () => assert.fail('save must reject'),
                error => error
            );

            result.reject(structuredSaveError(writeCalls[0]));
            const error = await observed;
            await new Promise(resolve => setImmediate(resolve));

            assert.equal(error.terminalReason, 'save-not-committed');
            assert.equal(queue.getState().halted, true);
            assert.deepEqual(terminalCalls.map(call => call.reason), ['save-not-committed']);
        });
    }
});
