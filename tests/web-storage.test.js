const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadAssetTracker } = require('./helpers/asset-tracker-harness');

const hashText = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function notApplicableHealth(domain) {
    return {
        domain,
        status: 'not-applicable',
        auditComplete: true,
        code: null,
        maintenancePendingCount: 0,
        detail: null
    };
}

async function confirmedWebAdapter(app, source = null) {
    const tracker = new app.AssetTracker();
    const adapter = tracker.storageAdapter;
    const loaded = await adapter.load();
    const confirmed = await adapter.confirmLoad({
        protocolVersion: 2,
        loadId: loaded.loadId,
        outcome: loaded.status === 'missing' ? 'missing' : 'valid',
        reason: null,
        validatedSourceHash: loaded.status === 'missing' ? null : loaded.rawHash
    });
    assert.equal(confirmed.ok, true);
    return {
        adapter,
        loaded,
        confirmed,
        request(stateJson, clientSaveId = 'web-save-1') {
            return {
                clientSaveId,
                stateJson,
                payloadHash: hashText(stateJson),
                reason: 'test',
                expectedHash: source === null ? null : hashText(source),
                sessionContext: {
                    protocolVersion: 2,
                    loadId: loaded.loadId,
                    writeSessionToken: confirmed.writeSessionToken
                }
            };
        }
    };
}

test('Web load always returns explicit complete not-applicable recovery health', async (t) => {
    const existing = JSON.stringify({ memo: 'existing' });
    const fixtures = [
        loadAssetTracker(),
        loadAssetTracker({ localStorageSeed: { assetTrackerData: existing } }),
        loadAssetTracker({ storage: { getItem() { throw new Error('read failed'); } } })
    ];
    t.after(() => fixtures.forEach(app => app.dispose()));

    const results = [];
    for (const app of fixtures) {
        const tracker = new app.AssetTracker();
        results.push(await tracker.storageAdapter.load());
    }

    assert.deepEqual(results.map(result => result.status), ['missing', 'readableBytes', 'ioError']);
    for (const result of results) {
        assert.equal(result.recoveryHealthComplete, true);
        assert.deepEqual(JSON.parse(JSON.stringify(result.ordinaryRecoveryHealth)), notApplicableHealth('ordinary'));
        assert.deepEqual(JSON.parse(JSON.stringify(result.snapshotRecoveryHealth)), notApplicableHealth('snapshot'));
    }
});

test('Web save consumes the queue request and returns an exact reread-backed receipt', async (t) => {
    const before = JSON.stringify({ memo: 'before' });
    const after = JSON.stringify({ memo: '存储后' });
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: before } });
    t.after(app.dispose);
    const { adapter, request } = await confirmedWebAdapter(app, before);

    const receipt = await adapter.save(request(after));

    assert.deepEqual(JSON.parse(JSON.stringify(receipt)), {
        ok: true,
        clientSaveId: 'web-save-1',
        payloadHash: hashText(after),
        sourceHashBefore: hashText(before),
        stateHashAfter: hashText(after),
        stateHash: hashText(after),
        byteCount: Buffer.byteLength(after, 'utf8'),
        durability: 'browser-local-committed',
        updatedAt: receipt.updatedAt,
        storagePath: 'localStorage:assetTrackerData',
        recoveryHealth: notApplicableHealth('none')
    });
    assert.equal(typeof receipt.updatedAt, 'string');
    assert.notEqual(receipt.updatedAt, '');
    assert.equal(app.readLocalStorage('assetTrackerData'), after);
});

test('Web save source mismatch rejects a typed source conflict before writing', async (t) => {
    const before = JSON.stringify({ memo: 'before' });
    const changed = JSON.stringify({ memo: 'external' });
    const after = JSON.stringify({ memo: 'candidate' });
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: before } });
    t.after(app.dispose);
    const { adapter, request } = await confirmedWebAdapter(app, before);
    app.setLocalStorage('assetTrackerData', changed);

    const error = await adapter.save(request(after)).then(() => null, value => value);

    assert.equal(error.constructor.name, 'AssetTrackerSaveError');
    assert.deepEqual({
        code: error.code,
        writeOutcome: error.writeOutcome,
        conflict: error.conflict,
        clientSaveId: error.clientSaveId,
        payloadHash: error.payloadHash,
        sourceHashAfter: error.sourceHashAfter,
        sourceReverified: error.sourceReverified,
        coordinatorReleased: error.coordinatorReleased,
        healthPersisted: error.healthPersisted,
        recoveryHealthEvidence: error.recoveryHealthEvidence
    }, {
        code: 'source-conflict',
        writeOutcome: 'not-committed',
        conflict: 'source-changed',
        clientSaveId: 'web-save-1',
        payloadHash: hashText(after),
        sourceHashAfter: hashText(changed),
        sourceReverified: true,
        coordinatorReleased: true,
        healthPersisted: false,
        recoveryHealthEvidence: null
    });
    assert.equal(app.localStorageWrites.length, 0);
});

test('Web save rejects an invalid queue session as a typed session conflict before reading or writing', async (t) => {
    const before = JSON.stringify({ memo: 'before' });
    const after = JSON.stringify({ memo: 'candidate' });
    let reads = 0;
    let writes = 0;
    const storage = {
        getItem() {
            reads += 1;
            return before;
        },
        setItem() {
            writes += 1;
        }
    };
    const app = loadAssetTracker({ storage });
    t.after(app.dispose);
    const { adapter, request } = await confirmedWebAdapter(app, before);
    const readsBeforeSave = reads;
    const invalid = request(after);
    invalid.sessionContext.writeSessionToken = 'forged-token';

    const error = await adapter.save(invalid).then(() => null, value => value);

    assert.equal(error.constructor.name, 'AssetTrackerSaveError');
    assert.equal(error.writeOutcome, 'not-committed');
    assert.equal(error.conflict, 'session-invalid');
    assert.equal(error.clientSaveId, 'web-save-1');
    assert.equal(error.payloadHash, hashText(after));
    assert.equal(error.sourceReverified, false);
    assert.equal(error.coordinatorReleased, true);
    assert.equal(reads, readsBeforeSave);
    assert.equal(writes, 0);
});

test('Web strict save rejects a queue expected hash outside the confirmed session head before source I/O', async (t) => {
    const h0 = JSON.stringify({ memo: 'H0' });
    const hx = JSON.stringify({ memo: 'external-HX' });
    const h1 = JSON.stringify({ memo: 'candidate-H1' });
    let stored = h0;
    let reads = 0;
    let writes = 0;
    const storage = {
        getItem() {
            reads += 1;
            return stored;
        },
        setItem(_key, value) {
            writes += 1;
            stored = String(value);
        }
    };
    const app = loadAssetTracker({ storage });
    t.after(app.dispose);
    const { adapter, request } = await confirmedWebAdapter(app, h0);
    stored = hx;
    const readsBeforeSave = reads;
    const writesBeforeSave = writes;
    const unauthorized = request(h1, 'web-head-conflict');
    unauthorized.expectedHash = hashText(hx);

    const error = await adapter.save(unauthorized).then(() => null, value => value);

    assert.notEqual(error, null, 'session-head mismatch must reject');
    assert.equal(error.constructor.name, 'AssetTrackerSaveError');
    assert.equal(error.writeOutcome, 'not-committed');
    assert.equal(error.conflict, 'session-invalid');
    assert.equal(error.clientSaveId, 'web-head-conflict');
    assert.equal(error.payloadHash, hashText(h1));
    assert.equal(error.sourceReverified, false);
    assert.equal(reads, readsBeforeSave, 'session-head CAS rejects before localStorage read');
    assert.equal(writes, writesBeforeSave);
    assert.equal(stored, hx);
});

test('Web strict saves advance the confirmed session head and reuse the same token for H1 then H2', async (t) => {
    const h0 = JSON.stringify({ memo: 'H0' });
    const h1 = JSON.stringify({ memo: 'H1' });
    const h2 = JSON.stringify({ memo: 'H2' });
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: h0 } });
    t.after(app.dispose);
    const { adapter, request } = await confirmedWebAdapter(app, h0);
    const token = adapter.confirmedSession.token;

    const receipt1 = await adapter.save(request(h1, 'web-H1'));
    assert.equal(receipt1.stateHashAfter, hashText(h1));
    assert.equal(adapter.confirmedSession.rawHash, hashText(h1));
    assert.equal(adapter.confirmedSession.token, token);

    const request2 = request(h2, 'web-H2');
    request2.expectedHash = hashText(h1);
    const receipt2 = await adapter.save(request2);

    assert.equal(receipt2.sourceHashBefore, hashText(h1));
    assert.equal(receipt2.stateHashAfter, hashText(h2));
    assert.equal(adapter.confirmedSession.rawHash, hashText(h2));
    assert.equal(adapter.confirmedSession.token, token);
    assert.equal(app.readLocalStorage('assetTrackerData'), h2);
});

test('Web save overload rejects every non-record non-string shape without storage I/O', async (t) => {
    const before = JSON.stringify({ memo: 'before' });
    const invalidInputs = [
        ['null', null],
        ['undefined', undefined],
        ['array', []],
        ['date', new Date('2026-08-10T00:00:00.000Z')],
        ['function', () => undefined],
        ['number', 1],
        ['boolean', true],
        ['bigint', 1n],
        ['symbol', Symbol('invalid')],
        ['boxed string', new String('{"memo":"boxed"}')]
    ];

    for (const [label, invalidInput] of invalidInputs) {
        await t.test(label, async () => {
            let reads = 0;
            let writes = 0;
            const storage = {
                getItem() {
                    reads += 1;
                    return before;
                },
                setItem() {
                    writes += 1;
                }
            };
            const app = loadAssetTracker({ storage });
            t.after(app.dispose);
            const { adapter, loaded, confirmed } = await confirmedWebAdapter(app, before);
            const readsBeforeSave = reads;
            const legacyOptions = {
                protocolVersion: 2,
                loadId: loaded.loadId,
                writeSessionToken: confirmed.writeSessionToken,
                expectedHash: hashText(before),
                validatedSourceHash: hashText(before),
                reason: 'shape-boundary'
            };

            const error = await adapter.save(invalidInput, legacyOptions).then(
                () => null,
                value => value
            );

            assert.notEqual(error, null, label);
            assert.equal(error.constructor.name, 'TypeError', label);
            assert.equal(error.message, 'INVALID_SAVE_ARGUMENT_SHAPE', label);
            assert.equal(reads, readsBeforeSave, label);
            assert.equal(writes, 0, label);
        });
    }
});

test('Web save routes a malformed plain record to strict validation without legacy fallback', async (t) => {
    const before = JSON.stringify({ memo: 'before' });
    let reads = 0;
    let writes = 0;
    const storage = {
        getItem() {
            reads += 1;
            return before;
        },
        setItem() {
            writes += 1;
        }
    };
    const app = loadAssetTracker({ storage });
    t.after(app.dispose);
    const { adapter, loaded, confirmed } = await confirmedWebAdapter(app, before);
    const readsBeforeSave = reads;

    const error = await adapter.save({}, {
        protocolVersion: 2,
        loadId: loaded.loadId,
        writeSessionToken: confirmed.writeSessionToken,
        expectedHash: hashText(before),
        validatedSourceHash: hashText(before),
        reason: 'must-not-fallback'
    }).then(() => null, value => value);

    assert.notEqual(error, null);
    assert.equal(error.constructor.name, 'TypeError');
    assert.equal(error.message, 'INVALID_WEB_SAVE_REQUEST');
    assert.equal(reads, readsBeforeSave);
    assert.equal(writes, 0);
});

test('Web save classifies a prewrite source read failure as typed unknown without writing', async (t) => {
    const before = JSON.stringify({ memo: 'before' });
    const after = JSON.stringify({ memo: 'candidate' });
    let failRead = false;
    let writes = 0;
    const storage = {
        getItem() {
            if (failRead) throw new Error('prewrite read failed');
            return before;
        },
        setItem() {
            writes += 1;
        }
    };
    const app = loadAssetTracker({ storage });
    t.after(app.dispose);
    const { adapter, request } = await confirmedWebAdapter(app, before);
    failRead = true;

    const error = await adapter.save(request(after)).then(() => null, value => value);

    assert.equal(error.constructor.name, 'AssetTrackerSaveError');
    assert.equal(error.writeOutcome, 'unknown');
    assert.equal(error.conflict, false);
    assert.equal(error.clientSaveId, 'web-save-1');
    assert.equal(error.payloadHash, hashText(after));
    assert.equal(error.sourceReverified, false);
    assert.equal(error.coordinatorReleased, true);
    assert.equal(writes, 0);
});

test('Web save requires an exact post-setItem reread before acknowledging success', async (t) => {
    const before = JSON.stringify({ memo: 'before' });
    const after = JSON.stringify({ memo: 'candidate' });
    const other = JSON.stringify({ memo: 'external-after-write' });
    let afterWrite = false;
    const storage = {
        getItem() {
            return afterWrite ? other : before;
        },
        setItem() {
            afterWrite = true;
        }
    };
    const app = loadAssetTracker({ storage });
    t.after(app.dispose);
    const { adapter, request } = await confirmedWebAdapter(app, before);

    const error = await adapter.save(request(after)).then(() => null, value => value);

    assert.equal(error.constructor.name, 'AssetTrackerSaveError');
    assert.equal(error.writeOutcome, 'unknown');
    assert.equal(error.conflict, false);
    assert.equal(error.clientSaveId, 'web-save-1');
    assert.equal(error.payloadHash, hashText(after));
    assert.equal(error.sourceReverified, true);
    assert.equal(error.sourceHashAfter, hashText(other));
});

test('Web save setItem failure distinguishes exact old and exact new rereads', async (t) => {
    const before = JSON.stringify({ memo: 'before' });
    const after = JSON.stringify({ memo: 'after' });

    for (const reread of ['old', 'new']) {
        let stored = before;
        let failWrites = false;
        const storage = {
            getItem() { return stored; },
            setItem(_key, value) {
                if (!failWrites) {
                    stored = String(value);
                    return;
                }
                if (reread === 'new') stored = String(value);
                throw new Error(`set failed ${reread}`);
            }
        };
        const app = loadAssetTracker({ storage });
        t.after(app.dispose);
        const { adapter, request } = await confirmedWebAdapter(app, before);
        failWrites = true;

        const outcome = await adapter.save(request(after, `web-${reread}`)).then(
            value => ({ receipt: value }),
            error => ({ error })
        );

        if (reread === 'new') {
            assert.equal(outcome.receipt.durability, 'browser-local-committed');
            assert.equal(outcome.receipt.stateHashAfter, hashText(after));
        } else {
            assert.equal(outcome.error.constructor.name, 'AssetTrackerSaveError');
            assert.equal(outcome.error.writeOutcome, 'not-committed');
            assert.equal(outcome.error.conflict, false);
            assert.equal(outcome.error.sourceHashAfter, hashText(before));
            assert.equal(outcome.error.sourceReverified, true);
            assert.equal(outcome.error.coordinatorReleased, true);
            assert.equal(outcome.error.healthPersisted, false);
            assert.equal(outcome.error.recoveryHealthEvidence, null);
        }
    }
});

test('Web save setItem failure classifies other, missing, and unreadable rereads as unknown', async (t) => {
    const before = JSON.stringify({ memo: 'before' });
    const after = JSON.stringify({ memo: 'after' });
    const other = JSON.stringify({ memo: 'other' });

    for (const reread of ['other', 'missing', 'throw']) {
        let stored = before;
        let failWrites = false;
        const storage = {
            getItem() {
                if (!failWrites) return stored;
                if (reread === 'throw') throw new Error('reread failed');
                return reread === 'missing' ? null : other;
            },
            setItem() {
                failWrites = true;
                throw new Error('set failed');
            }
        };
        const app = loadAssetTracker({ storage });
        t.after(app.dispose);
        const { adapter, request } = await confirmedWebAdapter(app, before);

        const error = await adapter.save(request(after, `web-${reread}`)).then(() => null, value => value);

        assert.equal(error.constructor.name, 'AssetTrackerSaveError');
        assert.equal(error.writeOutcome, 'unknown');
        assert.equal(error.conflict, false);
        assert.equal(error.clientSaveId, `web-${reread}`);
        assert.equal(error.payloadHash, hashText(after));
        assert.equal(error.healthPersisted, false);
        assert.equal(error.recoveryHealthEvidence, null);
    }
});

test('book payload parsing supports full-book envelope and legacy JSON', (t) => {
    const app = loadAssetTracker();
    t.after(app.dispose);
    const { AssetTracker } = app;
    const tracker = new AssetTracker();

    const bookEnvelope = JSON.stringify({
        format: 'qiushan.asset-book',
        formatVersion: 1,
        schemaVersion: 1,
        exportedAt: '2026-04-14T00:00:00.000Z',
        source: 'macos-app',
        payload: {
            transactions: [{ id: 't1', date: '2026-04-14', category: '现金', amount: 1 }]
        }
    });

    const parsedEnvelope = tracker.parseBookPayload(bookEnvelope);
    assert.equal(parsedEnvelope.status, 'valid');
    assert.equal(parsedEnvelope.source, 'book-package');
    assert.equal(parsedEnvelope.payload.transactions[0].id, 't1');

    const legacyJson = JSON.stringify({
        memo: 'legacy',
        transactions: [{ id: 'legacy-1', date: '2026-04-14', category: '现金', amount: 1 }]
    });

    const parsedLegacy = tracker.parseBookPayload(legacyJson);
    assert.equal(parsedLegacy.status, 'valid');
    assert.equal(parsedLegacy.source, 'legacy-json');
    assert.equal(parsedLegacy.payload.memo, 'legacy');
});

test('normalizeLoadedData fills settings, memo, templates, and backup fields', (t) => {
    const app = loadAssetTracker();
    t.after(app.dispose);
    const { AssetTracker, elements } = app;
    const tracker = new AssetTracker();

    tracker.data = tracker.normalizeLoadedData({
        settings: {
            baseCurrency: 'USD',
            exchangeRates: {
                EUR: 8.0
            }
        }
    });

    tracker.initializeSettings();

    assert.equal(tracker.data.settings.baseCurrency, 'USD');
    assert.equal(tracker.data.settings.autoBackup, true);
    assert.equal(tracker.data.settings.backupInterval, 24);
    assert.equal(Array.isArray(tracker.data.transactionTemplates), true);
    assert.equal(tracker.data.transactionTemplates.length, 0);
    assert.equal(tracker.data.memo, '');
    assert.equal(elements.get('base-currency').value, 'USD');
    assert.equal(elements.get('auto-backup-enabled').checked, true);
    assert.equal(elements.get('backup-interval').value, 24);
});

test('saveData rejects when storage adapter reports a business failure', async (t) => {
    const app = loadAssetTracker();
    t.after(app.dispose);
    const { AssetTracker } = app;
    const tracker = new AssetTracker();

    tracker.appState = 'writable';
    tracker.writeSessionToken = 'test-token';
    tracker.validatedSourceHash = null;
    tracker.lastLoadResult = { loadId: 'test-load' };

    tracker.storageAdapter = {
        supportsNative: true,
        save: async () => ({ ok: false, error: 'disk failed' })
    };

    await assert.rejects(
        async () => tracker.saveData(),
        /disk failed/
    );
});

test('initializeApp also primes automation and analytics state', (t) => {
    const app = loadAssetTracker();
    t.after(app.dispose);
    const { AssetTracker } = app;
    const tracker = new AssetTracker();
    const calls = [];

    tracker.setupNavigation = () => calls.push('navigation');
    tracker.setupEventListeners = () => calls.push('events');
    tracker.renderCategories = () => calls.push('categories');
    tracker.renderTransactions = () => calls.push('transactions');
    tracker.updateDashboard = () => calls.push('dashboard');
    tracker.setupCharts = () => calls.push('charts');
    tracker.initializeSettings = () => calls.push('settings');
    tracker.populateInitAssetCategoryOptions = () => calls.push('init-assets');
    tracker.renderInitialAssetsList = () => calls.push('initial-assets-list');
    tracker.renderMemo = () => calls.push('memo');
    tracker.initializeTransactionFilters = () => calls.push('filters');
    tracker.renderAutomationRules = () => calls.push('automation');
    tracker.updateAnalyticsOptions = () => calls.push('analytics');

    tracker.initializeApp();

    assert.equal(calls.includes('automation'), true);
    assert.equal(calls.includes('analytics'), true);
});

test('DOMContentLoaded marks initialized only after initialize resolves', async (t) => {
    const app = loadAssetTracker();
    t.after(app.dispose);
    const { AssetTracker, domEvents, context } = app;
    let resolveInitialize;

    AssetTracker.prototype.initialize = function() {
        return new Promise((resolve) => {
            resolveInitialize = () => {
                this.initialized = true;
                resolve();
            };
        });
    };
    AssetTracker.prototype.showMessage = () => {};

    domEvents.DOMContentLoaded();

    assert.notEqual(context.window.assetTracker.initialized, true);

    resolveInitialize();
    await Promise.resolve();

    assert.equal(context.window.assetTracker.initialized, true);
});
