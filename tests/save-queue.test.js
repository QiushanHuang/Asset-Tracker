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
