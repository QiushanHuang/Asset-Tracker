'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LegacySafety = require('../legacy-safety.js');

const H0 = '0'.repeat(64);
const H1 = '1'.repeat(64);

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

function oneReadRecord(label, values) {
    const keys = Object.keys(values);
    const reads = Object.create(null);
    const record = new Proxy(Object.create(null), {
        get(_target, key) {
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
