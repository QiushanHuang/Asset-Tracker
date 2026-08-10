const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const safety = require('../legacy-safety.js');
const { deferred, loadAssetTracker } = require('./helpers/asset-tracker-harness');

const CRITICAL_RENDER_STEPS = [
    'setupNavigation',
    'setupEventListeners',
    'renderCategories',
    'renderTransactions',
    'updateDashboard',
    'setupCharts',
    'renderAutomationRules',
    'updateAnalyticsOptions',
    'initializeSettings',
    'populateInitAssetCategoryOptions',
    'renderInitialAssetsList',
    'renderMemo',
    'initializeTransactionFilters'
];

function validLegacy(overrides = {}) {
    return {
        categories: {},
        transactions: [],
        automationRules: [],
        purposeCategories: [],
        initialAssets: [],
        settings: {
            baseCurrency: 'CNY',
            exchangeRates: { CNY: 1 }
        },
        memo: '',
        transactionTemplates: [],
        ...overrides
    };
}

function envelope(payload, overrides = {}) {
    return {
        format: 'qiushan.asset-book',
        formatVersion: 1,
        schemaVersion: 1,
        domainCapabilityVersion: 1,
        minimumReaderVersion: 1,
        payload,
        ...overrides
    };
}

function installCriticalRenderStubs(tracker, { failAt = null, calls = [] } = {}) {
    for (const step of CRITICAL_RENDER_STEPS) {
        tracker[step] = () => {
            calls.push(step);
            if (step === failAt) throw new Error(`injected:${step}`);
        };
    }
}

function assertShellIsolated(app) {
    const shell = app.elements.get('normal-app-shell');
    assert.equal(shell?.hidden, true);
    assert.equal(shell?.inert, true);
    assert.equal(shell?.getAttribute('aria-hidden'), 'true');
}

function assertRecoveryVisible(app) {
    const surface = app.elements.get('recovery-surface');
    const title = app.elements.get('recovery-title');
    assert.equal(surface?.hidden, false);
    assert.equal(app.context.document.activeElement, title);
}

function sourceHash(raw) {
    return raw === null ? null : safety.inspectDOMString(raw).rawHash;
}

function recoveryHealth(domain, status = 'healthy', overrides = {}) {
    return {
        domain,
        status,
        auditComplete: true,
        code: status === 'degraded' ? 'maintenance-pending' : null,
        maintenancePendingCount: status === 'degraded' ? 1 : 0,
        detail: status === 'degraded' ? 'fixture' : null,
        ...overrides
    };
}

function completeNativeLoadHealth() {
    return {
        updatedAt: null,
        recoveryHealthComplete: true,
        ordinaryRecoveryHealth: recoveryHealth('ordinary'),
        snapshotRecoveryHealth: recoveryHealth('snapshot')
    };
}

function oneReadRecord(label, values) {
    const reads = Object.create(null);
    const source = new Proxy(Object.create(null), {
        get(_target, key) {
            if (key === 'then') return undefined;
            if (!Object.prototype.hasOwnProperty.call(values, key)) {
                throw new Error(`${label}.${String(key)} is not allowed`);
            }
            reads[key] = (reads[key] || 0) + 1;
            if (reads[key] !== 1) throw new Error(`${label}.${key} read more than once`);
            return values[key];
        },
        ownKeys() {
            throw new Error(`${label} was enumerated`);
        },
        getOwnPropertyDescriptor() {
            throw new Error(`${label} descriptor was inspected`);
        }
    });
    return {
        source,
        assertReadOnce(fields = Object.keys(values)) {
            for (const field of fields) {
                assert.equal(reads[field], 1, `${label}.${field} read count`);
            }
        }
    };
}

function nativeAdapterHarness(t) {
    const app = loadAssetTracker({ nativeHandler() {} });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    return { app, adapter: tracker.storageAdapter };
}

function settleNativeRequest(app, request, response) {
    app.context.window.AssetTrackerHost.__handleResponse({
        id: request.id,
        ...response
    });
}

function strictNativeSaveRequest(overrides = {}) {
    const stateJson = JSON.stringify({ memo: 'native-H1' });
    return {
        clientSaveId: 'native-save-1',
        stateJson,
        payloadHash: sourceHash(stateJson),
        reason: 'manual',
        expectedHash: '0'.repeat(64),
        sessionContext: {
            protocolVersion: 2,
            loadId: 'native-load-1',
            writeSessionToken: 'native-token-1'
        },
        ...overrides
    };
}

function strictNativeSnapshotRequest(overrides = {}) {
    return {
        clientSnapshotId: 'native-snapshot-1',
        reason: 'manual',
        expectedHash: '1'.repeat(64),
        sessionContext: {
            protocolVersion: 2,
            loadId: 'native-load-1',
            writeSessionToken: 'native-token-1'
        },
        ...overrides
    };
}

function nativeLoadResult(overrides = {}) {
    const raw = JSON.stringify(validLegacy({ memo: 'native-load' }));
    const hash = sourceHash(raw);
    return {
        protocolVersion: 2,
        loadId: 'native-load-health',
        status: 'readableBytes',
        reason: null,
        stateJson: raw,
        stateHash: hash,
        rawHash: hash,
        hashAlgorithm: 'sha256',
        updatedAt: '2026-08-10T01:02:03.456+08:00',
        storagePath: '/canonical/AssetTrackerBook.json',
        canExportRaw: true,
        canRevealFolder: true,
        recoveryHealthComplete: true,
        ordinaryRecoveryHealth: recoveryHealth('ordinary'),
        snapshotRecoveryHealth: recoveryHealth('snapshot', 'degraded'),
        ...overrides
    };
}

function saveQueueForAdapter(adapter, overrides = {}) {
    return new safety.AssetTrackerSaveQueue({
        write: request => adapter.save(request),
        snapshot: request => adapter.snapshot(request),
        terminalize: request => Promise.resolve({
            ok: true,
            protocolVersion: request.protocolVersion,
            loadId: request.loadId,
            reason: request.reason,
            gateState: 'terminal-locked'
        }),
        sessionContext: {
            protocolVersion: 2,
            loadId: 'native-load-1',
            writeSessionToken: 'native-token-1'
        },
        initialAcknowledged: {
            stateJson: '{"memo":"H0"}',
            stateHash: '0'.repeat(64)
        },
        initialRecoveryHealth: {
            ordinary: recoveryHealth('ordinary'),
            snapshot: recoveryHealth('snapshot')
        },
        expectedDurability: 'native-durable',
        durabilityDeadlineMs: 29_000,
        barrierDeadlineMs: 29_000,
        transportDeadlineMs: 30_000,
        generationToken: `adapter-integration-${Date.now()}`,
        clock: { setTimeout, clearTimeout },
        onTransition: () => undefined,
        onAcknowledged: () => undefined,
        onFault: () => undefined,
        ...overrides
    });
}

function webQueueForAdapter(app, adapter, loaded, confirmed, stateJson, overrides = {}) {
    const stateHash = sourceHash(stateJson);
    return new app.context.AssetTrackerLegacySafety.AssetTrackerSaveQueue({
        write: request => adapter.save(request),
        snapshot: request => adapter.snapshot(request),
        terminalize: request => Promise.resolve({
            ok: true,
            protocolVersion: request.sessionContext.protocolVersion,
            loadId: request.sessionContext.loadId,
            reason: request.reason,
            gateState: 'terminal-locked'
        }),
        sessionContext: {
            protocolVersion: 2,
            loadId: loaded.loadId,
            writeSessionToken: confirmed.writeSessionToken
        },
        initialAcknowledged: { stateJson, stateHash },
        initialRecoveryHealth: {
            ordinary: recoveryHealth('ordinary', 'not-applicable'),
            snapshot: recoveryHealth('snapshot', 'not-applicable')
        },
        expectedDurability: 'browser-local-committed',
        durabilityDeadlineMs: 29_000,
        barrierDeadlineMs: 29_000,
        transportDeadlineMs: 30_000,
        generationToken: 'web-error-proof-queue',
        clock: { setTimeout, clearTimeout },
        onTransition: () => undefined,
        onAcknowledged: () => undefined,
        onFault: () => undefined,
        ...overrides
    });
}

test('raw evidence hashes well-formed DOMStrings as UTF-8 bytes', () => {
    const raw = JSON.stringify(validLegacy({ memo: '中💰' }));
    const evidence = safety.inspectDOMString(raw);
    const expected = Buffer.from(raw, 'utf8');

    assert.equal(evidence.hashAlgorithm, 'sha256-utf8');
    assert.equal(evidence.encoding, 'utf-8');
    assert.equal(evidence.rawHash, crypto.createHash('sha256').update(expected).digest('hex'));
    assert.deepEqual(Buffer.from(evidence.bytes), expected);
});

test('raw evidence hashes and exports lone-surrogate DOMStrings as exact UTF-16LE code units', () => {
    const raw = `{"memo":"${String.fromCharCode(0xd800)}","transactions":[]}`;
    const expected = Buffer.alloc(raw.length * 2);
    for (let index = 0; index < raw.length; index += 1) {
        expected.writeUInt16LE(raw.charCodeAt(index), index * 2);
    }

    const evidence = safety.inspectDOMString(raw);

    assert.equal(evidence.hashAlgorithm, 'sha256-utf16le-code-units');
    assert.equal(evidence.encoding, 'utf-16le-code-units');
    assert.equal(evidence.rawHash, crypto.createHash('sha256').update(expected).digest('hex'));
    assert.deepEqual(Buffer.from(evidence.bytes), expected);
});

test('empty and whitespace-present sources are corrupt, never missing', () => {
    for (const raw of ['', '  \n\t']) {
        const result = safety.validateBookText(raw);
        assert.equal(result.status, 'corrupt');
        assert.equal(result.reason, 'empty-present-source');
        assert.match(result.rawHash, /^[a-f0-9]{64}$/);
    }
});

test('valid envelope and legacy payloads produce typed valid results and retain unknown fields', () => {
    const payload = validLegacy({
        unknownRoot: { future: true },
        transactions: [{
            id: 't1',
            amount: 12.5,
            date: '2026-02-28',
            category: '现金',
            unknownTransactionField: 'retained'
        }]
    });
    const packaged = safety.validateBookText(JSON.stringify(envelope(payload, { unknownEnvelopeField: 7 })));
    const legacy = safety.validateBookText(JSON.stringify(payload));

    assert.equal(packaged.status, 'valid');
    assert.equal(packaged.source, 'book-package');
    assert.equal(packaged.payload.unknownRoot.future, true);
    assert.equal(packaged.payload.transactions[0].unknownTransactionField, 'retained');
    assert.equal(packaged.meta.schemaVersion, 1);
    assert.equal(legacy.status, 'valid');
    assert.equal(legacy.source, 'legacy-json');
    assert.equal(legacy.payload.unknownRoot.future, true);
});

test('unknown format and each higher supported-version dimension are unsupported', () => {
    const payload = validLegacy();
    const cases = [
        envelope(payload, { format: 'another.book-format' }),
        envelope(payload, { formatVersion: 2 }),
        envelope(payload, { schemaVersion: 2 }),
        envelope(payload, { domainCapabilityVersion: 2 }),
        envelope(payload, { minimumReaderVersion: 2 })
    ];

    for (const input of cases) {
        const result = safety.validateBookText(JSON.stringify(input));
        assert.equal(result.status, 'unsupported');
        assert.match(result.rawHash, /^[a-f0-9]{64}$/);
    }
});

test('invalid version-field types are corrupt instead of unsupported', () => {
    for (const badVersion of [0, -1, 1.5, '1', null, true]) {
        for (const field of ['formatVersion', 'schemaVersion', 'domainCapabilityVersion', 'minimumReaderVersion']) {
            const result = safety.validateBookText(JSON.stringify(envelope(validLegacy(), { [field]: badVersion })));
            assert.equal(result.status, 'corrupt', `${field}=${String(badVersion)}`);
            assert.ok(result.issues.some(issue => issue.path === `$.${field}`));
        }
    }
});

test('strict known fields reject invalid shapes, non-finite money, rates, frequencies, and calendar dates', () => {
    const invalidPayloads = [
        { input: [], path: '$' },
        { input: {}, path: '$' },
        { input: validLegacy({ transactions: {} }), path: '$.transactions' },
        { input: validLegacy({ transactions: [{ amount: '12', date: '2026-01-01' }] }), path: '$.transactions[0].amount' },
        { input: validLegacy({ transactions: [{ amount: 1e400, date: '2026-01-01' }] }), path: '$.transactions[0].amount' },
        { input: validLegacy({ transactions: [{ amount: 1, date: '2026-02-30' }] }), path: '$.transactions[0].date' },
        { input: validLegacy({ automationRules: [{ amount: 1, frequency: 'hourly', startDate: '2026-01-01' }] }), path: '$.automationRules[0].frequency' },
        { input: validLegacy({ automationRules: [{ amount: 1, frequency: 'daily', startDate: '2025-02-29' }] }), path: '$.automationRules[0].startDate' },
        { input: validLegacy({ transactionTemplates: [{ amount: null }] }), path: '$.transactionTemplates[0].amount' },
        { input: validLegacy({ initialAssets: [{ amount: '1', time: '2026-01-01' }] }), path: '$.initialAssets[0].amount' },
        { input: validLegacy({ initialAssets: [{ amount: 1, time: 'not-a-date' }] }), path: '$.initialAssets[0].time' },
        { input: validLegacy({ settings: { baseCurrency: 'CNY', exchangeRates: { USD: 0 } } }), path: '$.settings.exchangeRates.USD' }
    ];

    for (const { input, path } of invalidPayloads) {
        const result = safety.validateBookText(JSON.stringify(input));
        assert.equal(result.status, 'corrupt', path);
        assert.ok(result.issues.some(issue => issue.path === path), path);
    }
});

test('calendar fixture is deterministic in Node V8 and osascript JavaScriptCore without Date APIs', () => {
    const fixtures = JSON.parse(fs.readFileSync(
        path.join(__dirname, 'fixtures', 'calendar-values.json'),
        'utf8'
    ));
    const buildRaw = value => JSON.stringify(validLegacy({
        transactions: [{ id: 'calendar', category: 'cash', amount: 1, date: value }]
    }));
    const nodeResults = fixtures.map(fixture => safety.validateBookText(buildRaw(fixture.value)).status === 'valid');
    assert.deepEqual(nodeResults, fixtures.map(fixture => fixture.valid));

    const safetySource = fs.readFileSync(path.join(__dirname, '..', 'legacy-safety.js'), 'utf8');
    assert.doesNotMatch(safetySource, /\bDate(?:\.parse)?\b/);
    const jscProgram = `${safetySource}\n` +
        `var calendarFixtures = ${JSON.stringify(fixtures)};\n` +
        `var results = calendarFixtures.map(function (fixture) {\n` +
        `  var payload = {categories:{},transactions:[{id:'calendar',category:'cash',amount:1,date:fixture.value}],automationRules:[],purposeCategories:[],initialAssets:[],settings:{baseCurrency:'CNY',exchangeRates:{CNY:1}},memo:'',transactionTemplates:[]};\n` +
        `  return AssetTrackerLegacySafety.validateBookText(JSON.stringify(payload)).status === 'valid';\n` +
        `});\nJSON.stringify(results);`;
    const jscResults = JSON.parse(childProcess.execFileSync(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', jscProgram],
        { encoding: 'utf8' }
    ).trim());

    assert.deepEqual(jscResults, nodeResults);
});

test('parsed JSON rejects unpaired surrogates in known and unknown keys or values without changing evidence', () => {
    const fixtures = [
        JSON.stringify(validLegacy()).replace('"memo":""', '"memo":"\\ud800"'),
        JSON.stringify(validLegacy({ unknown: { nested: 'placeholder' } })).replace('placeholder', '\\udfff'),
        JSON.stringify(validLegacy({ unknown: { placeholder: true } })).replace('placeholder', '\\ud800')
    ];

    for (const raw of fixtures) {
        const before = safety.inspectDOMString(raw);
        const result = safety.validateBookText(raw);

        assert.equal(result.status, 'corrupt');
        assert.equal(result.reason, 'validation-failed');
        assert.ok(result.issues.some(item => item.code === 'unpaired-surrogate'));
        assert.equal(result.rawHash, before.rawHash);
        assert.equal(result.hashAlgorithm, before.hashAlgorithm);
        assert.deepEqual(Buffer.from(result.rawEvidence.bytes), Buffer.from(before.bytes));
    }

    const pairedRaw = JSON.stringify(validLegacy()).replace('"memo":""', '"memo":"\\ud83d\\udcb0"');
    assert.equal(safety.validateBookText(pairedRaw).status, 'valid');
});

test('recursive categories have no obsolete depth limit but validate every known balance', () => {
    let leaf = { id: 'leaf', name: 'leaf', balance: 1, currency: 'CNY' };
    for (let depth = 0; depth < 8; depth += 1) {
        leaf = { id: `n${depth}`, name: `n${depth}`, children: { next: leaf } };
    }
    const valid = safety.validateBookText(JSON.stringify(validLegacy({ categories: { root: leaf } })));
    assert.equal(valid.status, 'valid');

    leaf.children.next.children.next.balance = '1';
    const invalid = safety.validateBookText(JSON.stringify(validLegacy({ categories: { root: leaf } })));
    assert.equal(invalid.status, 'corrupt');
    assert.ok(invalid.issues.some(issue => issue.path.endsWith('.balance')));
});

test('currency-less legacy categories boot, inherit currency on a clone, and revalidate', async (t) => {
    const payload = validLegacy({
        categories: {
            foreign: {
                id: 'foreign',
                name: 'foreign',
                currency: 'USD',
                unknownCategory: { retained: true },
                children: {
                    branch: {
                        id: 'branch',
                        name: 'branch',
                        children: {
                            inheritedLeaf: { id: 'inherited', name: 'inherited', balance: 3 }
                        }
                    },
                    explicitLeaf: { id: 'explicit', name: 'explicit', balance: 4, currency: 'SGD' }
                }
            },
            baseLeaf: { id: 'base', name: 'base', balance: 5 }
        },
        settings: { baseCurrency: 'MYR', exchangeRates: { MYR: 1, USD: 4, SGD: 3 } },
        unknownRoot: { retained: true }
    });
    const raw = JSON.stringify(payload);
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    tracker.setupAutoBackup = async () => {};

    await tracker.initialize();

    assert.equal(tracker.lastLoadResult.status, 'valid');
    assert.notEqual(tracker.data, tracker.lastLoadResult.payload);
    assert.notEqual(tracker.data.categories.foreign, tracker.lastLoadResult.payload.categories.foreign);
    assert.notEqual(
        tracker.data.categories.foreign.unknownCategory,
        tracker.lastLoadResult.payload.categories.foreign.unknownCategory
    );
    assert.equal(tracker.data.categories.foreign.currency, 'USD');
    assert.equal(tracker.data.categories.foreign.children.branch.currency, 'USD');
    assert.equal(tracker.data.categories.foreign.children.branch.children.inheritedLeaf.currency, 'USD');
    assert.equal(tracker.data.categories.foreign.children.explicitLeaf.currency, 'SGD');
    assert.equal(tracker.data.categories.baseLeaf.currency, 'MYR');
    assert.equal(tracker.data.categories.foreign.unknownCategory.retained, true);
    assert.equal(tracker.data.unknownRoot.retained, true);
    assert.equal(tracker.lastLoadResult.payload.categories.foreign.children.branch.currency, undefined);
    assert.equal(
        tracker.lastLoadResult.payload.categories.foreign.children.branch.children.inheritedLeaf.currency,
        undefined
    );
    assert.equal(safety.validateBookText(JSON.stringify(tracker.data)).status, 'valid');
    assert.equal(app.readLocalStorage('assetTrackerData'), raw);
    assert.equal(app.localStorageWrites.length, 0);
});

test('category currency may be absent but any explicit value must be a string', () => {
    const missing = validLegacy({
        categories: { leaf: { id: 'leaf', name: 'leaf', balance: 1 } }
    });
    assert.equal(safety.validateBookText(JSON.stringify(missing)).status, 'valid');

    for (const currency of [null, 7, { code: 'CNY' }]) {
        const invalid = validLegacy({
            categories: { leaf: { id: 'leaf', name: 'leaf', balance: 1, currency } }
        });
        const result = safety.validateBookText(JSON.stringify(invalid));
        assert.equal(result.status, 'corrupt');
        assert.ok(result.issues.some(item => item.path === '$.categories.leaf.currency'));
    }
});

test('submitCategory explicitly stores the parent currency or normalized base currency', () => {
    const app = loadAssetTracker();
    const tracker = new app.AssetTracker();
    tracker.data = tracker.normalizeLoadedData(validLegacy({
        categories: {
            parent: { id: 'parent', name: 'parent', currency: 'USD', children: {} }
        },
        settings: { baseCurrency: 'MYR', exchangeRates: { MYR: 1, USD: 4 } }
    }));
    tracker.persistData = async () => ({ ok: true });
    tracker.renderCategories = () => {};
    tracker.closeModal = () => {};
    tracker.showMessage = () => {};
    app.context.document.getElementById('category-name').value = 'child';
    app.context.document.getElementById('category-balance').value = '2';
    app.context.document.getElementById('parent-category').value = 'parent';

    tracker.submitCategory();

    const child = Object.values(tracker.data.categories.parent.children)[0];
    assert.equal(child.currency, 'USD');

    app.context.document.getElementById('category-name').value = 'top';
    app.context.document.getElementById('parent-category').value = '';
    tracker.submitCategory();
    const top = Object.values(tracker.data.categories).find(category => category.name === 'top');
    assert.equal(top.currency, 'MYR');
    app.dispose();
});

test('dangerous prototype keys are rejected anywhere in the parsed graph', () => {
    const raws = [
        '{"memo":"ok","__proto__":{"polluted":true}}',
        '{"transactions":[{"amount":1,"date":"2026-01-01","constructor":{"prototype":{"polluted":true}}}]}',
        '{"settings":{"exchangeRates":{"prototype":1}}}'
    ];

    for (const raw of raws) {
        const result = safety.validateBookText(raw);
        assert.equal(result.status, 'corrupt');
        assert.ok(result.issues.some(issue => issue.code === 'dangerous-key'));
    }
    assert.equal({}.polluted, undefined);
});

test('unsafe structure and invalid version types take precedence over unknown or future formats', () => {
    const unknownWithBadVersion = JSON.stringify({
        format: 'another.book-format',
        formatVersion: '2',
        payload: validLegacy()
    });
    const futureWithDangerousKey = '{"format":"qiushan.asset-book","formatVersion":2,"payload":{"memo":"ok","constructor":{"prototype":{"polluted":true}}}}';

    const invalidVersion = safety.validateBookText(unknownWithBadVersion);
    const dangerous = safety.validateBookText(futureWithDangerousKey);

    assert.equal(invalidVersion.status, 'corrupt');
    assert.ok(invalidVersion.issues.some(item => item.path === '$.formatVersion'));
    assert.equal(dangerous.status, 'corrupt');
    assert.ok(dangerous.issues.some(item => item.code === 'dangerous-key'));
});

test('runtime-critical entity fields are required before a book can be rendered', () => {
    const fixtures = [
        { payload: validLegacy({ transactions: [{ id: 't-only' }] }), path: '$.transactions[0].date' },
        { payload: validLegacy({ categories: { cash: { id: 'cash' } } }), path: '$.categories.cash.name' },
        { payload: validLegacy({ automationRules: [{ id: 'rule' }] }), path: '$.automationRules[0].name' },
        { payload: validLegacy({ initialAssets: [{ id: 'asset' }] }), path: '$.initialAssets[0].category' },
        { payload: validLegacy({ transactionTemplates: [{ id: 'template' }] }), path: '$.transactionTemplates[0].name' }
    ];

    for (const fixture of fixtures) {
        const result = safety.validateBookText(JSON.stringify(fixture.payload));
        assert.equal(result.status, 'corrupt', fixture.path);
        assert.ok(result.issues.some(item => item.path === fixture.path), fixture.path);
    }
});

test('native Host preserves structured object errors while strings and missing responses stay conservative', async (t) => {
    const pendingTimeouts = new Map();
    let timerSequence = 0;
    const app = loadAssetTracker({
        nativeHandler() {},
        clock: {
            setTimeout(callback) {
                const handle = ++timerSequence;
                pendingTimeouts.set(handle, callback);
                return handle;
            },
            clearTimeout(handle) {
                pendingTimeouts.delete(handle);
            },
            setInterval,
            clearInterval
        }
    });
    t.after(app.dispose);
    const host = app.context.window.AssetTrackerHost;
    const structured = new Proxy({ code: 'structured-native-error', message: 'native failed' }, {
        ownKeys() {
            throw new Error('Host must not enumerate structured error');
        },
        getOwnPropertyDescriptor() {
            throw new Error('Host must not inspect structured error descriptors');
        }
    });

    const structuredObserved = host.invoke('probe.structured').then(
        () => assert.fail('structured response must reject'),
        error => error
    );
    const stringObserved = host.invoke('probe.string').then(
        () => assert.fail('string response must reject'),
        error => error
    );
    const missingObserved = host.invoke('probe.missing').then(
        () => assert.fail('missing response error must reject'),
        error => error
    );
    const lostObserved = host.invoke('probe.lost').then(
        () => assert.fail('lost response must reject'),
        error => error
    );
    const [structuredRequest, stringRequest, missingRequest] = app.bridgeRequests;

    settleNativeRequest(app, structuredRequest, { ok: false, error: structured });
    settleNativeRequest(app, stringRequest, { ok: false, error: 'native string failure' });
    settleNativeRequest(app, missingRequest, { ok: false });
    assert.doesNotThrow(() => host.__handleResponse({
        id: 'unknown-response-id',
        ok: false,
        get error() {
            throw new Error('unknown response must not read error');
        }
    }));
    const [lostTimeout] = pendingTimeouts.values();
    lostTimeout();

    const [structuredError, stringError, missingError, lostError] = await Promise.all([
        structuredObserved,
        stringObserved,
        missingObserved,
        lostObserved
    ]);
    assert.strictEqual(structuredError, structured);
    assert.equal(stringError.constructor.name, 'Error');
    assert.equal(stringError.message, 'native string failure');
    assert.equal(missingError.constructor.name, 'Error');
    assert.equal(missingError.message, 'Native host returned error');
    assert.equal(lostError.constructor.name, 'Error');
    assert.equal(lostError.message, 'Native host request timeout');
});

test('native strict save maps only queue-owned fields and returns a protected exact receipt without fallback', async (t) => {
    const { app, adapter } = nativeAdapterHarness(t);
    const request = strictNativeSaveRequest();
    adapter.stateHash = 'f'.repeat(64);
    const save = adapter.save(request);
    const saveObserved = save.then(value => value, error => error);

    assert.equal(app.bridgeRequests.length, 1);
    const wireRequest = app.bridgeRequests[0];
    assert.equal(wireRequest.type, 'storage.save');
    assert.deepEqual(JSON.parse(JSON.stringify(wireRequest.payload)), {
        protocolVersion: 2,
        loadId: 'native-load-1',
        writeSessionToken: 'native-token-1',
        clientSaveId: 'native-save-1',
        stateJson: request.stateJson,
        payloadHash: request.payloadHash,
        reason: 'manual',
        expectedHash: '0'.repeat(64),
        validatedSourceHash: '0'.repeat(64),
        schemaVersion: 1
    });

    const healthValues = recoveryHealth('ordinary');
    const healthSource = oneReadRecord('nativeSaveReceipt.recoveryHealth', healthValues);
    const receiptValues = {
        ok: true,
        clientSaveId: request.clientSaveId,
        payloadHash: request.payloadHash,
        sourceHashBefore: request.expectedHash,
        stateHashAfter: '1'.repeat(64),
        stateHash: '1'.repeat(64),
        byteCount: Buffer.byteLength(request.stateJson, 'utf8'),
        durability: 'native-durable',
        updatedAt: 'native-wire-time',
        storagePath: '/native/wire/path',
        recoveryHealth: healthSource.source
    };
    const receiptSource = oneReadRecord('nativeSaveReceipt', receiptValues);
    settleNativeRequest(app, wireRequest, { ok: true, result: receiptSource.source });
    const receipt = await saveObserved;

    receiptSource.assertReadOnce();
    healthSource.assertReadOnce();
    assert.deepEqual(JSON.parse(JSON.stringify(receipt)), {
        ...receiptValues,
        recoveryHealth: healthValues
    });
    assert.notStrictEqual(receipt, receiptSource.source);
    assert.equal(adapter.stateHash, 'f'.repeat(64), 'adapter stateHash is not strict-save authority');

    const legacyReceipt = adapter.save(strictNativeSaveRequest({ clientSaveId: 'native-save-2' }));
    const legacyObserved = legacyReceipt.then(
        () => assert.fail('the old Task2 receipt is not strict proof'),
        error => error
    );
    settleNativeRequest(app, app.bridgeRequests[1], {
        ok: true,
        result: {
            ok: true,
            stateHash: '2'.repeat(64),
            time: 'legacy-wire-time',
            path: '/legacy/wire/path'
        }
    });
    const legacyError = await legacyObserved;
    assert.equal(legacyError.constructor.name, 'TypeError');
    assert.equal(legacyError.message, 'INVALID_NATIVE_SAVE_RECEIPT');
    assert.equal(adapter.stateHash, 'f'.repeat(64));
});

test('native strict save converts thrown and resolved structured failures into typed protected errors', async (t) => {
    const { app, adapter } = nativeAdapterHarness(t);
    const request = strictNativeSaveRequest();
    const errorHealthValues = recoveryHealth('ordinary', 'degraded');
    const errorHealth = oneReadRecord('nativeSaveError.recoveryHealthEvidence', errorHealthValues);
    const errorValues = {
        code: 'native-save-failed',
        message: 'native save failed',
        writeOutcome: 'not-committed',
        conflict: false,
        clientSaveId: request.clientSaveId,
        payloadHash: request.payloadHash,
        sourceHashAfter: request.expectedHash,
        sourceReverified: true,
        coordinatorReleased: true,
        healthPersisted: true,
        recoveryHealthEvidence: errorHealth.source
    };
    const errorSource = oneReadRecord('nativeSaveError', errorValues);
    const rejected = adapter.save(request).then(
        () => assert.fail('structured native failure must reject'),
        error => error
    );
    settleNativeRequest(app, app.bridgeRequests[0], { ok: false, error: errorSource.source });
    const typed = await rejected;

    errorSource.assertReadOnce();
    errorHealth.assertReadOnce();
    assert.equal(typed.constructor.name, 'AssetTrackerSaveError');
    assert.notStrictEqual(typed, errorSource.source);
    assert.equal(typed.code, 'native-save-failed');
    assert.equal(typed.writeOutcome, 'not-committed');
    assert.deepEqual(JSON.parse(JSON.stringify(typed.recoveryHealthEvidence)), errorHealthValues);

    const resolvedRequest = strictNativeSaveRequest({ clientSaveId: 'native-save-resolved-false' });
    const resolved = adapter.save(resolvedRequest).then(
        () => assert.fail('resolved failure union is forbidden'),
        error => error
    );
    settleNativeRequest(app, app.bridgeRequests[1], {
        ok: true,
        result: {
            ok: false,
            error: {
                ...errorValues,
                clientSaveId: 'native-save-resolved-false',
                recoveryHealthEvidence: errorHealthValues
            }
        }
    });
    const resolvedError = await resolved;
    assert.equal(resolvedError.constructor.name, 'TypeError');
    assert.equal(resolvedError.message, 'INVALID_NATIVE_SAVE_RECEIPT');
    assert.equal(resolvedError.clientSaveId, undefined, 'resolved failure proof is unavailable');
});

test('native error DTO getter setters cannot forge or erase typed adapter own fields', async (t) => {
    const { app, adapter } = nativeAdapterHarness(t);
    const request = strictNativeSaveRequest({ clientSaveId: 'native-error-own-fields' });
    const values = {
        code: 'native-unknown',
        message: 'native outcome unknown',
        writeOutcome: 'unknown',
        conflict: false,
        clientSaveId: request.clientSaveId,
        payloadHash: request.payloadHash,
        sourceHashAfter: null,
        sourceReverified: false,
        coordinatorReleased: true,
        healthPersisted: false,
        recoveryHealthEvidence: null
    };
    let poisoned = false;
    const source = new Proxy(Object.create(null), {
        get(_target, key) {
            if (!poisoned) {
                poisoned = true;
                app.context.__nativeErrorExpectedHash = request.expectedHash;
                vm.runInContext(`
                    const prototype = globalThis.AssetTrackerLegacySafety.AssetTrackerSaveError.prototype;
                    Object.defineProperty(prototype, 'writeOutcome', {
                        configurable: true,
                        get() { return 'not-committed'; },
                        set() {}
                    });
                    Object.defineProperty(prototype, 'sourceHashAfter', {
                        configurable: true,
                        get() { return globalThis.__nativeErrorExpectedHash; },
                        set() {}
                    });
                    Object.defineProperty(prototype, 'sourceReverified', {
                        configurable: true,
                        get() { return true; },
                        set() {}
                    });
                `, app.context);
            }
            return values[key];
        }
    });
    const result = adapter.save(request).then(
        () => assert.fail('structured native error must reject'),
        error => error
    );
    settleNativeRequest(app, app.bridgeRequests[0], { ok: false, error: source });
    const error = await result;

    assert.equal(Object.hasOwn(error, 'writeOutcome'), true);
    assert.equal(error.writeOutcome, 'unknown');
    assert.equal(Object.hasOwn(error, 'sourceHashAfter'), true);
    assert.equal(error.sourceHashAfter, null);
    assert.equal(Object.hasOwn(error, 'sourceReverified'), true);
    assert.equal(error.sourceReverified, false);
});

test('native adapter protected receipt extraction uses load-time intrinsics after first-field poisoning', async (t) => {
    const { app, adapter } = nativeAdapterHarness(t);
    const request = strictNativeSaveRequest({ clientSaveId: 'native-intrinsic-save' });
    const save = adapter.save(request);
    const healthValues = recoveryHealth('ordinary');
    const healthSource = oneReadRecord('intrinsicReceipt.recoveryHealth', healthValues);
    const receiptValues = {
        ok: true,
        clientSaveId: request.clientSaveId,
        payloadHash: request.payloadHash,
        sourceHashBefore: request.expectedHash,
        stateHashAfter: '7'.repeat(64),
        stateHash: '7'.repeat(64),
        byteCount: Buffer.byteLength(request.stateJson, 'utf8'),
        durability: 'native-durable',
        updatedAt: 'native-intrinsic-time',
        storagePath: '/native/intrinsic/path',
        recoveryHealth: healthSource.source
    };
    const reads = Object.create(null);
    let poisoned = false;
    const source = new Proxy(Object.create(null), {
        get(_target, key) {
            if (key === 'then') return undefined;
            if (!Object.prototype.hasOwnProperty.call(receiptValues, key)) {
                throw new Error(`intrinsicReceipt.${String(key)} is not allowed`);
            }
            reads[key] = (reads[key] || 0) + 1;
            if (reads[key] !== 1) throw new Error(`intrinsicReceipt.${key} read more than once`);
            if (!poisoned) {
                poisoned = true;
                vm.runInContext(`
                    Reflect.get = () => { throw new Error('poisoned Reflect.get'); };
                    Object.freeze = () => { throw new Error('poisoned Object.freeze'); };
                    Object.create = () => { throw new Error('poisoned Object.create'); };
                    Array.isArray = () => true;
                    Number.isInteger = () => false;
                `, app.context);
            }
            return receiptValues[key];
        },
        ownKeys() {
            throw new Error('intrinsicReceipt was enumerated');
        },
        getOwnPropertyDescriptor() {
            throw new Error('intrinsicReceipt descriptor was inspected');
        }
    });
    settleNativeRequest(app, app.bridgeRequests[0], { ok: true, result: source });

    const receipt = await save;

    for (const field of Object.keys(receiptValues)) {
        assert.equal(reads[field], 1, `intrinsicReceipt.${field} read count`);
    }
    healthSource.assertReadOnce();
    assert.notStrictEqual(receipt, source);
    assert.equal(Object.isFrozen(receipt), true);
    assert.equal(Object.isFrozen(receipt.recoveryHealth), true);
    assert.deepEqual(JSON.parse(JSON.stringify(receipt)), {
        ...receiptValues,
        recoveryHealth: healthValues
    });
});

test('native receipt getter toString and toStringTag poisoning cannot misroute the next strict save', async (t) => {
    const { app, adapter } = nativeAdapterHarness(t);
    const firstRequest = strictNativeSaveRequest({ clientSaveId: 'native-route-first' });
    const secondValues = strictNativeSaveRequest({ clientSaveId: 'native-route-second' });
    app.context.__routeSecondValues = secondValues;
    const secondRequest = vm.runInContext(`({
        clientSaveId: globalThis.__routeSecondValues.clientSaveId,
        stateJson: globalThis.__routeSecondValues.stateJson,
        payloadHash: globalThis.__routeSecondValues.payloadHash,
        reason: globalThis.__routeSecondValues.reason,
        expectedHash: globalThis.__routeSecondValues.expectedHash,
        sessionContext: {
            protocolVersion: globalThis.__routeSecondValues.sessionContext.protocolVersion,
            loadId: globalThis.__routeSecondValues.sessionContext.loadId,
            writeSessionToken: globalThis.__routeSecondValues.sessionContext.writeSessionToken
        }
    })`, app.context);
    const first = adapter.save(firstRequest);
    const firstValues = {
        ok: true,
        clientSaveId: firstRequest.clientSaveId,
        payloadHash: firstRequest.payloadHash,
        sourceHashBefore: firstRequest.expectedHash,
        stateHashAfter: '7'.repeat(64),
        stateHash: '7'.repeat(64),
        byteCount: Buffer.byteLength(firstRequest.stateJson, 'utf8'),
        durability: 'native-durable',
        updatedAt: 'native-route-first-time',
        storagePath: '/native/route/first',
        recoveryHealth: recoveryHealth('ordinary')
    };
    let poisoned = false;
    const firstSource = new Proxy(Object.create(null), {
        get(_target, key) {
            if (key === 'then') return undefined;
            if (!poisoned) {
                poisoned = true;
                vm.runInContext(
                    `
                        Object.prototype.toString = () => '[object Array]';
                        Object.defineProperty(Object.prototype, Symbol.toStringTag, {
                            configurable: true,
                            value: 'Array'
                        });
                    `,
                    app.context
                );
            }
            return firstValues[key];
        }
    });
    settleNativeRequest(app, app.bridgeRequests[0], { ok: true, result: firstSource });
    assert.equal((await first).stateHashAfter, '7'.repeat(64));

    const second = adapter.save(secondRequest).then(value => value, error => error);
    assert.equal(app.bridgeRequests.length, 2, 'plain strict request must still reach Host once');
    settleNativeRequest(app, app.bridgeRequests[1], {
        ok: true,
        result: {
            ok: true,
            clientSaveId: secondRequest.clientSaveId,
            payloadHash: secondRequest.payloadHash,
            sourceHashBefore: secondRequest.expectedHash,
            stateHashAfter: '8'.repeat(64),
            stateHash: '8'.repeat(64),
            byteCount: Buffer.byteLength(secondRequest.stateJson, 'utf8'),
            durability: 'native-durable',
            updatedAt: 'native-route-second-time',
            storagePath: '/native/route/second',
            recoveryHealth: recoveryHealth('ordinary')
        }
    });
    const receipt = await second;
    assert.equal(receipt.stateHashAfter, '8'.repeat(64));
});

test('native strict save routing accepts only cross-realm or null-prototype plain records', async (t) => {
    await t.test('null-prototype record reaches Host', async (subtest) => {
        const { app, adapter } = nativeAdapterHarness(subtest);
        const values = strictNativeSaveRequest({ clientSaveId: 'native-null-prototype' });
        const request = Object.assign(Object.create(null), values);
        const save = adapter.save(request);

        assert.equal(app.bridgeRequests.length, 1);
        settleNativeRequest(app, app.bridgeRequests[0], {
            ok: true,
            result: {
                ok: true,
                clientSaveId: request.clientSaveId,
                payloadHash: request.payloadHash,
                sourceHashBefore: request.expectedHash,
                stateHashAfter: '9'.repeat(64),
                stateHash: '9'.repeat(64),
                byteCount: Buffer.byteLength(request.stateJson, 'utf8'),
                durability: 'native-durable',
                updatedAt: 'native-null-prototype-time',
                storagePath: '/native/null-prototype',
                recoveryHealth: recoveryHealth('ordinary')
            }
        });
        assert.equal((await save).stateHashAfter, '9'.repeat(64));
    });

    for (const [label, makeRequest] of [
        ['class instance', values => Object.assign(new (class StrictRequest {})(), values)],
        ['throwing getPrototypeOf proxy', values => new Proxy(values, {
            getPrototypeOf() {
                throw new Error('request prototype is hostile');
            }
        })]
    ]) {
        await t.test(label, async (subtest) => {
            const { app, adapter } = nativeAdapterHarness(subtest);
            const request = makeRequest(strictNativeSaveRequest({
                clientSaveId: `native-invalid-shape-${label}`
            }));
            const observed = adapter.save(request).then(
                value => ({ value }),
                error => ({ error })
            );
            if (app.bridgeRequests.length !== 0) {
                settleNativeRequest(app, app.bridgeRequests[0], {
                    ok: true,
                    result: {
                        ok: true,
                        clientSaveId: request.clientSaveId,
                        payloadHash: request.payloadHash,
                        sourceHashBefore: request.expectedHash,
                        stateHashAfter: 'a'.repeat(64),
                        stateHash: 'a'.repeat(64),
                        byteCount: Buffer.byteLength(request.stateJson, 'utf8'),
                        durability: 'native-durable',
                        updatedAt: 'native-invalid-shape-time',
                        storagePath: '/native/invalid-shape',
                        recoveryHealth: recoveryHealth('ordinary')
                    }
                });
            }
            const { error = null } = await observed;

            assert.notEqual(error, null);
            assert.equal(error.constructor.name, 'TypeError');
            assert.equal(error.message, 'INVALID_SAVE_ARGUMENT_SHAPE');
            assert.equal(app.bridgeRequests.length, 0);
        });
    }
});

test('native adapter poisoned intrinsics cannot turn a false ACK into a valid receipt', async (t) => {
    await t.test('Reflect.get forgery', async (subtest) => {
        const { app, adapter } = nativeAdapterHarness(subtest);
        const request = strictNativeSaveRequest({ clientSaveId: 'native-reflect-forgery' });
        const healthValues = recoveryHealth('snapshot');
        const healthSource = oneReadRecord('falseAckReflect.recoveryHealth', healthValues);
        const originalValues = {
            ok: true,
            clientSaveId: 'wrong-original-client-id',
            payloadHash: 'not-a-hash',
            sourceHashBefore: 'not-a-source-hash',
            stateHashAfter: 'not-a-state-hash',
            stateHash: 'not-a-state-hash',
            byteCount: -1,
            durability: 'browser-local-committed',
            updatedAt: '',
            storagePath: '',
            recoveryHealth: healthSource.source
        };
        const forgedValues = {
            clientSaveId: request.clientSaveId,
            payloadHash: request.payloadHash,
            sourceHashBefore: request.expectedHash,
            stateHashAfter: '6'.repeat(64),
            stateHash: '6'.repeat(64),
            byteCount: Buffer.byteLength(request.stateJson, 'utf8'),
            durability: 'native-durable',
            updatedAt: 'forged-time',
            storagePath: '/forged/path'
        };
        const reads = Object.create(null);
        let poisoned = false;
        const source = new Proxy(Object.create(null), {
            get(_target, key) {
                if (key === 'then') return undefined;
                if (!Object.prototype.hasOwnProperty.call(originalValues, key)) {
                    throw new Error(`falseAckReflect.${String(key)} is not allowed`);
                }
                reads[key] = (reads[key] || 0) + 1;
                if (reads[key] !== 1) throw new Error(`falseAckReflect.${key} read more than once`);
                if (!poisoned) {
                    poisoned = true;
                    app.context.__forgedReceipt = forgedValues;
                    app.context.__forgedHealth = recoveryHealth('ordinary');
                    app.context.__forgedHealthSource = healthSource.source;
                    vm.runInContext(`
                        Reflect.get = (_source, key) => {
                            if (key === 'recoveryHealth') return globalThis.__forgedHealthSource;
                            if (Object.prototype.hasOwnProperty.call(globalThis.__forgedReceipt, key)) {
                                return globalThis.__forgedReceipt[key];
                            }
                            return globalThis.__forgedHealth[key];
                        };
                    `, app.context);
                }
                return originalValues[key];
            },
            ownKeys() {
                throw new Error('falseAckReflect was enumerated');
            },
            getOwnPropertyDescriptor() {
                throw new Error('falseAckReflect descriptor was inspected');
            }
        });
        const result = adapter.save(request).then(
            () => assert.fail('forged values must not replace the first-read false ACK'),
            error => error
        );
        settleNativeRequest(app, app.bridgeRequests[0], { ok: true, result: source });
        const error = await result;
        assert.equal(error.constructor.name, 'TypeError');
        assert.equal(error.message, 'INVALID_NATIVE_SAVE_RECEIPT');
        for (const field of Object.keys(originalValues)) {
            assert.equal(reads[field], 1, `falseAckReflect.${field} read count`);
        }
        healthSource.assertReadOnce();
    });

    await t.test('RegExp.test and Array.includes forgery', async (subtest) => {
        const { app, adapter } = nativeAdapterHarness(subtest);
        const request = strictNativeSaveRequest({ clientSaveId: 'native-prototype-forgery' });
        const healthValues = recoveryHealth('ordinary', 'healthy', { status: 'forged-status' });
        const healthSource = oneReadRecord('falseAckPrototype.recoveryHealth', healthValues);
        const receiptValues = {
            ok: true,
            clientSaveId: request.clientSaveId,
            payloadHash: request.payloadHash,
            sourceHashBefore: request.expectedHash,
            stateHashAfter: 'not-a-state-hash',
            stateHash: 'not-a-state-hash',
            byteCount: Buffer.byteLength(request.stateJson, 'utf8'),
            durability: 'native-durable',
            updatedAt: 'prototype-forgery-time',
            storagePath: '/prototype/forgery/path',
            recoveryHealth: healthSource.source
        };
        const reads = Object.create(null);
        let poisoned = false;
        const source = new Proxy(Object.create(null), {
            get(_target, key) {
                if (key === 'then') return undefined;
                if (!Object.prototype.hasOwnProperty.call(receiptValues, key)) {
                    throw new Error(`falseAckPrototype.${String(key)} is not allowed`);
                }
                reads[key] = (reads[key] || 0) + 1;
                if (reads[key] !== 1) throw new Error(`falseAckPrototype.${key} read more than once`);
                if (!poisoned) {
                    poisoned = true;
                    vm.runInContext(`
                        RegExp.prototype.test = () => true;
                        Array.prototype.includes = () => true;
                    `, app.context);
                }
                return receiptValues[key];
            },
            ownKeys() {
                throw new Error('falseAckPrototype was enumerated');
            },
            getOwnPropertyDescriptor() {
                throw new Error('falseAckPrototype descriptor was inspected');
            }
        });
        const result = adapter.save(request).then(
            () => assert.fail('prototype poisoning must not validate a false ACK'),
            error => error
        );
        settleNativeRequest(app, app.bridgeRequests[0], { ok: true, result: source });
        const error = await result;
        assert.equal(error.constructor.name, 'TypeError');
        assert.equal(error.message, 'INVALID_NATIVE_SAVE_RECEIPT');
        for (const field of Object.keys(receiptValues)) {
            assert.equal(reads[field], 1, `falseAckPrototype.${field} read count`);
        }
        healthSource.assertReadOnce();
    });

    await t.test('RegExp.exec forgery', async (subtest) => {
        const { app, adapter } = nativeAdapterHarness(subtest);
        const request = strictNativeSaveRequest({ clientSaveId: 'native-regexp-exec-forgery' });
        const healthValues = recoveryHealth('ordinary');
        const healthSource = oneReadRecord('falseAckExec.recoveryHealth', healthValues);
        const receiptValues = {
            ok: true,
            clientSaveId: request.clientSaveId,
            payloadHash: request.payloadHash,
            sourceHashBefore: request.expectedHash,
            stateHashAfter: 'x',
            stateHash: 'x',
            byteCount: Buffer.byteLength(request.stateJson, 'utf8'),
            durability: 'native-durable',
            updatedAt: 'regexp-exec-forgery-time',
            storagePath: '/regexp/exec/forgery',
            recoveryHealth: healthSource.source
        };
        let poisoned = false;
        const source = new Proxy(Object.create(null), {
            get(_target, key) {
                if (key === 'then') return undefined;
                if (!Object.prototype.hasOwnProperty.call(receiptValues, key)) {
                    throw new Error(`falseAckExec.${String(key)} is not allowed`);
                }
                if (!poisoned) {
                    poisoned = true;
                    vm.runInContext(`
                        RegExp.prototype.exec = () => ({
                            0: 'fake-match',
                            index: 0,
                            input: 'x'
                        });
                    `, app.context);
                }
                return receiptValues[key];
            },
            ownKeys() {
                throw new Error('falseAckExec was enumerated');
            },
            getOwnPropertyDescriptor() {
                throw new Error('falseAckExec descriptor was inspected');
            }
        });
        const result = adapter.save(request).then(
            () => assert.fail('RegExp.exec poisoning must not validate a false ACK'),
            error => error
        );
        settleNativeRequest(app, app.bridgeRequests[0], { ok: true, result: source });
        const error = await result;
        assert.equal(error.constructor.name, 'TypeError');
        assert.equal(error.message, 'INVALID_NATIVE_SAVE_RECEIPT');
        healthSource.assertReadOnce();
    });

    await t.test('Number.isInteger forgery', async (subtest) => {
        const { app, adapter } = nativeAdapterHarness(subtest);
        const request = strictNativeSaveRequest({ clientSaveId: 'native-integer-forgery' });
        const healthValues = recoveryHealth('ordinary', 'healthy', {
            maintenancePendingCount: 0.5
        });
        const healthSource = oneReadRecord('falseAckInteger.recoveryHealth', healthValues);
        const receiptValues = {
            ok: true,
            clientSaveId: request.clientSaveId,
            payloadHash: request.payloadHash,
            sourceHashBefore: request.expectedHash,
            stateHashAfter: '5'.repeat(64),
            stateHash: '5'.repeat(64),
            byteCount: Buffer.byteLength(request.stateJson, 'utf8'),
            durability: 'native-durable',
            updatedAt: 'integer-forgery-time',
            storagePath: '/integer/forgery/path',
            recoveryHealth: healthSource.source
        };
        const reads = Object.create(null);
        let poisoned = false;
        const source = new Proxy(Object.create(null), {
            get(_target, key) {
                if (key === 'then') return undefined;
                if (!Object.prototype.hasOwnProperty.call(receiptValues, key)) {
                    throw new Error(`falseAckInteger.${String(key)} is not allowed`);
                }
                reads[key] = (reads[key] || 0) + 1;
                if (reads[key] !== 1) throw new Error(`falseAckInteger.${key} read more than once`);
                if (!poisoned) {
                    poisoned = true;
                    vm.runInContext('Number.isInteger = () => true;', app.context);
                }
                return receiptValues[key];
            },
            ownKeys() {
                throw new Error('falseAckInteger was enumerated');
            },
            getOwnPropertyDescriptor() {
                throw new Error('falseAckInteger descriptor was inspected');
            }
        });
        const result = adapter.save(request).then(
            () => assert.fail('fractional health count must not become a valid ACK'),
            error => error
        );
        settleNativeRequest(app, app.bridgeRequests[0], { ok: true, result: source });
        const error = await result;
        assert.equal(error.constructor.name, 'TypeError');
        assert.equal(error.message, 'INVALID_NATIVE_SAVE_RECEIPT');
        for (const field of Object.keys(receiptValues)) {
            assert.equal(reads[field], 1, `falseAckInteger.${field} read count`);
        }
        healthSource.assertReadOnce();
    });
});

test('native strict snapshot maps the queue request and protects success and structured failure DTOs', async (t) => {
    const { app, adapter } = nativeAdapterHarness(t);
    const request = strictNativeSnapshotRequest();
    const snapshot = adapter.snapshot(request);
    const snapshotObserved = snapshot.then(value => value, error => error);

    assert.equal(app.bridgeRequests.length, 1);
    const wireRequest = app.bridgeRequests[0];
    assert.equal(wireRequest.type, 'storage.snapshot');
    assert.deepEqual(JSON.parse(JSON.stringify(wireRequest.payload)), {
        protocolVersion: 2,
        loadId: 'native-load-1',
        writeSessionToken: 'native-token-1',
        clientSnapshotId: 'native-snapshot-1',
        reason: 'manual',
        expectedHash: '1'.repeat(64)
    });
    const healthValues = recoveryHealth('snapshot');
    const healthSource = oneReadRecord('nativeSnapshotReceipt.recoveryHealth', healthValues);
    const receiptValues = {
        ok: true,
        clientSnapshotId: request.clientSnapshotId,
        sourceHash: request.expectedHash,
        snapshotHash: request.expectedHash,
        ordinal: 3,
        snapshotStatus: 'created',
        durability: 'native-durable',
        retainedCount: 4,
        recoveryHealth: healthSource.source
    };
    const receiptSource = oneReadRecord('nativeSnapshotReceipt', receiptValues);
    settleNativeRequest(app, wireRequest, { ok: true, result: receiptSource.source });
    const canonicalReceipt = await snapshotObserved;
    receiptSource.assertReadOnce();
    healthSource.assertReadOnce();
    assert.deepEqual(JSON.parse(JSON.stringify(canonicalReceipt)), {
        ...receiptValues,
        recoveryHealth: healthValues
    });

    const failedRequest = strictNativeSnapshotRequest({ clientSnapshotId: 'native-snapshot-failed' });
    const failed = adapter.snapshot(failedRequest).then(
        () => assert.fail('resolved snapshot failure is forbidden'),
        error => error
    );
    const failureHealthValues = recoveryHealth('snapshot', 'degraded');
    const failureHealth = oneReadRecord(
        'nativeSnapshotError.recoveryHealthEvidence',
        failureHealthValues
    );
    const failureValues = {
        code: 'snapshot-not-created',
        message: 'snapshot not created',
        snapshotOutcome: 'not-created',
        conflict: false,
        clientSnapshotId: 'native-snapshot-failed',
        sourceHashAfter: failedRequest.expectedHash,
        sourceReverified: true,
        coordinatorReleased: true,
        healthPersisted: true,
        recoveryHealthEvidence: failureHealth.source
    };
    const failureSource = oneReadRecord('nativeSnapshotError', failureValues);
    settleNativeRequest(app, app.bridgeRequests[1], { ok: false, error: failureSource.source });
    const typed = await failed;
    failureSource.assertReadOnce();
    failureHealth.assertReadOnce();
    assert.equal(typed.constructor.name, 'AssetTrackerSnapshotError');
    assert.equal(typed.snapshotOutcome, 'not-created');
    assert.equal(typed.clientSnapshotId, 'native-snapshot-failed');
    assert.deepEqual(JSON.parse(JSON.stringify(typed.recoveryHealthEvidence)), failureHealthValues);

    const resolvedRequest = strictNativeSnapshotRequest({ clientSnapshotId: 'native-snapshot-resolved-false' });
    const resolved = adapter.snapshot(resolvedRequest).then(
        () => assert.fail('resolved snapshot failure union is malformed'),
        error => error
    );
    settleNativeRequest(app, app.bridgeRequests[2], {
        ok: true,
        result: {
            ok: false,
            error: {
                ...failureValues,
                clientSnapshotId: resolvedRequest.clientSnapshotId,
                recoveryHealthEvidence: failureHealthValues
            }
        }
    });
    const resolvedError = await resolved;
    assert.equal(resolvedError.constructor.name, 'TypeError');
    assert.equal(resolvedError.message, 'INVALID_NATIVE_SNAPSHOT_RECEIPT');
    assert.equal(resolvedError.clientSnapshotId, undefined, 'resolved failure proof is unavailable');
});

test('native strict snapshot rejects null hashes and non-product reasons before Host I/O', async (t) => {
    for (const [label, overrides] of [
        ['null expected hash', { expectedHash: null }],
        ['final reason', { reason: 'final' }],
        ['unknown reason', { reason: 'automatic' }]
    ]) {
        await t.test(label, async (subtest) => {
            const { app, adapter } = nativeAdapterHarness(subtest);
            const observed = adapter.snapshot(strictNativeSnapshotRequest(overrides)).then(
                () => null,
                error => error
            );
            const hostCalls = app.bridgeRequests.length;
            if (hostCalls > 0) {
                settleNativeRequest(app, app.bridgeRequests[0], {
                    ok: false,
                    error: 'invalid snapshot request must not reach Host'
                });
            }
            const error = await observed;
            assert.equal(error.constructor.name, 'TypeError');
            assert.equal(error.message, 'INVALID_SNAPSHOT_REQUEST');
            assert.equal(hostCalls, 0);
        });
    }

    const scheduledHarness = nativeAdapterHarness(t);
    const scheduledRequest = strictNativeSnapshotRequest({
        clientSnapshotId: 'native-scheduled-snapshot',
        reason: 'scheduled'
    });
    const scheduled = scheduledHarness.adapter.snapshot(scheduledRequest);
    assert.equal(scheduledHarness.app.bridgeRequests.length, 1);
    assert.equal(scheduledHarness.app.bridgeRequests[0].payload.reason, 'scheduled');
    settleNativeRequest(scheduledHarness.app, scheduledHarness.app.bridgeRequests[0], {
        ok: true,
        result: {
            ok: true,
            clientSnapshotId: scheduledRequest.clientSnapshotId,
            sourceHash: scheduledRequest.expectedHash,
            snapshotHash: scheduledRequest.expectedHash,
            ordinal: 2,
            snapshotStatus: 'created',
            durability: 'native-durable',
            retainedCount: 2,
            recoveryHealth: recoveryHealth('snapshot')
        }
    });
    assert.equal((await scheduled).clientSnapshotId, scheduledRequest.clientSnapshotId);
});

test('resolved native failure unions terminate the queue as unknown and never dispatch the next item', async (t) => {
    await t.test('save union', async (subtest) => {
        const { app, adapter } = nativeAdapterHarness(subtest);
        const queue = saveQueueForAdapter(adapter);
        const h1 = queue.enqueue({ stateJson: '{"memo":"H1"}', reason: 'H1' });
        const h2 = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'H2' });
        const request = app.bridgeRequests[0];
        settleNativeRequest(app, request, {
            ok: true,
            result: {
                ok: false,
                error: {
                    code: 'forbidden-proof',
                    message: 'must not classify',
                    writeOutcome: 'not-committed',
                    conflict: false,
                    clientSaveId: request.payload.clientSaveId,
                    payloadHash: request.payload.payloadHash,
                    sourceHashAfter: request.payload.expectedHash,
                    sourceReverified: true,
                    coordinatorReleased: true,
                    healthPersisted: false,
                    recoveryHealthEvidence: null
                }
            }
        });
        const activeError = await h1.then(() => null, error => error);
        const pendingError = await h2.then(() => null, error => error);
        assert.equal(activeError.queueOutcome, 'durability-unknown');
        assert.equal(pendingError.queueOutcome, 'not-dispatched');
        assert.equal(app.bridgeRequests.filter(item => item.type === 'storage.save').length, 1);
    });

    await t.test('snapshot union', async (subtest) => {
        const { app, adapter } = nativeAdapterHarness(subtest);
        const queue = saveQueueForAdapter(adapter);
        const barrier = queue.runBarrier({ clientSnapshotId: 'union-snapshot', reason: 'manual' });
        const h2 = queue.enqueue({ stateJson: '{"memo":"H2"}', reason: 'H2' });
        settleNativeRequest(app, app.bridgeRequests[0], {
            ok: true,
            result: {
                ok: false,
                error: {
                    code: 'forbidden-proof',
                    message: 'must not classify',
                    snapshotOutcome: 'not-created',
                    conflict: false,
                    clientSnapshotId: 'union-snapshot',
                    sourceHashAfter: '0'.repeat(64),
                    sourceReverified: true,
                    coordinatorReleased: true,
                    healthPersisted: false,
                    recoveryHealthEvidence: null
                }
            }
        });
        const activeError = await barrier.then(() => null, error => error);
        const pendingError = await h2.then(() => null, error => error);
        assert.equal(activeError.queueOutcome, 'snapshot-outcome-unknown');
        assert.equal(pendingError.queueOutcome, 'not-dispatched');
        assert.equal(app.bridgeRequests.filter(item => item.type === 'storage.snapshot').length, 1);
        assert.equal(app.bridgeRequests.filter(item => item.type === 'storage.save').length, 0);
    });
});

test('Web strict snapshot fails closed without localStorage or legacy backup writes', async (t) => {
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: JSON.stringify(validLegacy()) } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    const writesBefore = app.localStorageWrites.length;

    const error = await tracker.storageAdapter.snapshot(strictNativeSnapshotRequest()).then(
        () => null,
        value => value
    );

    assert.notEqual(error, null);
    assert.equal(error.constructor.name, 'AssetTrackerSnapshotError');
    assert.equal(error.message, 'NATIVE_SNAPSHOT_REQUIRED');
    assert.equal(error.snapshotOutcome, 'unknown');
    assert.equal(error.conflict, false);
    assert.equal(error.clientSnapshotId, 'native-snapshot-1');
    assert.equal(error.sourceHashAfter, null);
    assert.equal(error.sourceReverified, false);
    assert.equal(error.coordinatorReleased, true);
    assert.equal(error.healthPersisted, false);
    assert.equal(error.recoveryHealthEvidence, null);
    assert.equal(app.localStorageWrites.length, writesBefore);
    assert.equal(app.readLocalStorage('assetTrackerBackup'), null);
    assert.equal(app.readLocalStorage('assetTrackerLastBackupTime'), null);

    const queue = saveQueueForAdapter(tracker.storageAdapter, {
        expectedDurability: 'browser-local-committed',
        initialRecoveryHealth: {
            ordinary: recoveryHealth('ordinary', 'not-applicable'),
            snapshot: recoveryHealth('snapshot', 'not-applicable')
        }
    });
    const barrier = queue.runBarrier({ clientSnapshotId: 'web-snapshot', reason: 'manual' });
    const pending = queue.enqueue({ stateJson: '{"memo":"never-written"}', reason: 'pending' });
    const barrierError = await barrier.then(() => null, value => value);
    const pendingError = await pending.then(() => null, value => value);
    assert.equal(barrierError.queueOutcome, 'snapshot-outcome-unknown');
    assert.equal(pendingError.queueOutcome, 'not-dispatched');
    assert.equal(app.localStorageWrites.length, writesBefore);
});

test('queue Web ACK keeps acceptance-time byte count after transition poisons TypedArray byteLength', async (t) => {
    const h0 = JSON.stringify(validLegacy({ memo: 'web-byte-count-H0' }));
    const h1 = JSON.stringify(validLegacy({ memo: '中💰-web-byte-count-H1' }));
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: h0 } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    const adapter = tracker.storageAdapter;
    const loaded = await adapter.load();
    const confirmed = await adapter.confirmLoad({
        protocolVersion: 2,
        loadId: loaded.loadId,
        outcome: 'valid',
        reason: null,
        validatedSourceHash: loaded.rawHash
    });
    let poisoned = false;
    const queue = webQueueForAdapter(app, adapter, loaded, confirmed, h0, {
        onTransition(state) {
            if (poisoned || state.lanePhase !== 'saving') return undefined;
            poisoned = true;
            vm.runInContext(`
                const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
                Object.defineProperty(typedArrayPrototype, 'byteLength', {
                    configurable: true,
                    get() { return 1; }
                });
            `, app.context);
            return undefined;
        }
    });

    const outcome = await queue.enqueue({ stateJson: h1, reason: 'web-byte-count-H1' }).then(
        receipt => ({ receipt }),
        error => ({ error })
    );

    assert.equal(app.readLocalStorage('assetTrackerData'), h1, 'the exact H1 bytes were committed');
    assert.equal(outcome.error, undefined);
    assert.equal(outcome.receipt.byteCount, Buffer.byteLength(h1, 'utf8'));
    assert.equal(queue.getState().lastAcknowledgedHash, sourceHash(h1));
    assert.equal(queue.getState().primaryStatus, 'browser-local-committed');
    assert.equal(queue.getState().lanePhase, 'idle');
});

test('queue Web strict save ignores transition poisoning of gate membership and receipt time', async (t) => {
    for (const [label, poison] of [
        ['Array includes gate membership', `Array.prototype.includes = () => false;`],
        ['Date toISOString receipt time', `Date.prototype.toISOString = () => '';`]
    ]) {
        await t.test(label, async (subtest) => {
            const h0 = JSON.stringify(validLegacy({ memo: `${label}-H0` }));
            const h1 = JSON.stringify(validLegacy({ memo: `${label}-H1` }));
            const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: h0 } });
            subtest.after(app.dispose);
            const tracker = new app.AssetTracker();
            const adapter = tracker.storageAdapter;
            const loaded = await adapter.load();
            const confirmed = await adapter.confirmLoad({
                protocolVersion: 2,
                loadId: loaded.loadId,
                outcome: 'valid',
                reason: null,
                validatedSourceHash: loaded.rawHash
            });
            let poisoned = false;
            const queue = webQueueForAdapter(app, adapter, loaded, confirmed, h0, {
                onTransition(state) {
                    if (poisoned || state.lanePhase !== 'saving') return undefined;
                    poisoned = true;
                    vm.runInContext(poison, app.context);
                    return undefined;
                }
            });
            const writesBefore = app.localStorageWrites.length;

            const outcome = await queue.enqueue({ stateJson: h1, reason: `strict-${label}` }).then(
                receipt => ({ receipt }),
                error => ({ error })
            );

            assert.equal(outcome.error, undefined);
            assert.equal(app.readLocalStorage('assetTrackerData'), h1);
            assert.equal(app.localStorageWrites.length, writesBefore + 1);
            assert.equal(outcome.receipt.updatedAt.length > 0, true);
            assert.equal(queue.getState().lastAcknowledgedHash, sourceHash(h1));
            assert.equal(queue.getState().primaryStatus, 'browser-local-committed');
            assert.equal(queue.getState().lanePhase, 'idle');
        });
    }
});

test('queue to Web adapter errors keep conservative own proof after descriptor prototype mutation', async (t) => {
    await t.test('post-write reread failure stays durability unknown and aborts H2', async (subtest) => {
        const h0 = JSON.stringify(validLegacy({ memo: 'web-proof-H0' }));
        const h1 = JSON.stringify(validLegacy({ memo: 'web-proof-H1' }));
        let current = h0;
        let reads = 0;
        let writes = 0;
        const app = loadAssetTracker({
            storage: {
                getItem() {
                    reads += 1;
                    if (reads >= 4) throw new Error('post-write reread failed');
                    return current;
                },
                setItem(_key, value) {
                    writes += 1;
                    current = value;
                }
            }
        });
        subtest.after(app.dispose);
        const tracker = new app.AssetTracker();
        const adapter = tracker.storageAdapter;
        const loaded = await adapter.load();
        const confirmed = await adapter.confirmLoad({
            protocolVersion: 2,
            loadId: loaded.loadId,
            outcome: 'valid',
            reason: null,
            validatedSourceHash: loaded.rawHash
        });
        const queue = webQueueForAdapter(app, adapter, loaded, confirmed, h0);
        const descriptor = {};
        Object.defineProperty(descriptor, 'stateJson', {
            get() {
                app.context.__webProofExpectedHash = sourceHash(h0);
                vm.runInContext(`
                    const prototype = globalThis.AssetTrackerLegacySafety.AssetTrackerSaveError.prototype;
                    Object.defineProperty(prototype, 'writeOutcome', {
                        configurable: true,
                        get() { return 'not-committed'; },
                        set() {}
                    });
                    Object.defineProperty(prototype, 'sourceHashAfter', {
                        configurable: true,
                        get() { return globalThis.__webProofExpectedHash; },
                        set() {}
                    });
                    Object.defineProperty(prototype, 'sourceReverified', {
                        configurable: true,
                        get() { return true; },
                        set() {}
                    });
                `, app.context);
                return h1;
            }
        });
        Object.defineProperty(descriptor, 'reason', {
            get() { return 'web-proof-H1'; }
        });

        const active = queue.enqueue(descriptor);
        const pending = queue.enqueue({
            stateJson: JSON.stringify(validLegacy({ memo: 'web-proof-H2' })),
            reason: 'web-proof-H2'
        });
        const activeError = await active.then(() => null, error => error);
        const pendingError = await pending.then(() => null, error => error);

        assert.equal(activeError.queueOutcome, 'durability-unknown');
        assert.equal(activeError.terminalReason, 'save-outcome-unknown');
        assert.equal(pendingError.queueOutcome, 'not-dispatched');
        assert.equal(writes, 1);
        assert.equal(queue.getState().lastAcknowledgedHash, sourceHash(h0));
    });

    await t.test('unsupported Web snapshot stays unknown and aborts H2 without storage writes', async (subtest) => {
        const h0 = JSON.stringify(validLegacy({ memo: 'web-snapshot-proof-H0' }));
        const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: h0 } });
        subtest.after(app.dispose);
        const tracker = new app.AssetTracker();
        const adapter = tracker.storageAdapter;
        const loaded = await adapter.load();
        const confirmed = await adapter.confirmLoad({
            protocolVersion: 2,
            loadId: loaded.loadId,
            outcome: 'valid',
            reason: null,
            validatedSourceHash: loaded.rawHash
        });
        const queue = webQueueForAdapter(app, adapter, loaded, confirmed, h0);
        const descriptor = {};
        Object.defineProperty(descriptor, 'clientSnapshotId', {
            get() {
                app.context.__webSnapshotExpectedHash = sourceHash(h0);
                vm.runInContext(`
                    const prototype = globalThis.AssetTrackerLegacySafety.AssetTrackerSnapshotError.prototype;
                    Object.defineProperty(prototype, 'snapshotOutcome', {
                        configurable: true,
                        get() { return 'not-created'; },
                        set() {}
                    });
                    Object.defineProperty(prototype, 'sourceHashAfter', {
                        configurable: true,
                        get() { return globalThis.__webSnapshotExpectedHash; },
                        set() {}
                    });
                    Object.defineProperty(prototype, 'sourceReverified', {
                        configurable: true,
                        get() { return true; },
                        set() {}
                    });
                `, app.context);
                return 'web-snapshot-proof';
            }
        });
        Object.defineProperty(descriptor, 'reason', {
            get() { return 'manual'; }
        });
        const writesBefore = app.localStorageWrites.length;

        const barrier = queue.runBarrier(descriptor);
        const pending = queue.enqueue({
            stateJson: JSON.stringify(validLegacy({ memo: 'never-written-H2' })),
            reason: 'web-snapshot-pending-H2'
        });
        const barrierError = await barrier.then(() => null, error => error);
        const pendingError = await pending.then(() => null, error => error);

        assert.equal(barrierError.queueOutcome, 'snapshot-outcome-unknown');
        assert.equal(barrierError.terminalReason, 'snapshot-outcome-unknown');
        assert.equal(pendingError.queueOutcome, 'not-dispatched');
        assert.equal(app.localStorageWrites.length, writesBefore);
        assert.equal(queue.getState().barrierState, 'outcome-unknown');
    });
});

test('queue strict terminalize maps session fields and returns only the protected exact receipt', async (t) => {
    const { app, adapter } = nativeAdapterHarness(t);
    const request = {
        reason: 'snapshot-outcome-unknown',
        sessionContext: {
            protocolVersion: 2,
            loadId: 'native-terminal-load',
            writeSessionToken: 'native-terminal-token'
        }
    };
    const terminal = adapter.terminalize(request);
    const terminalObserved = terminal.then(value => value, error => error);

    assert.equal(app.bridgeRequests.length, 1);
    const wireRequest = app.bridgeRequests[0];
    assert.equal(wireRequest.type, 'storage.terminalize');
    assert.deepEqual(JSON.parse(JSON.stringify(wireRequest.payload)), {
        protocolVersion: 2,
        loadId: 'native-terminal-load',
        writeSessionToken: 'native-terminal-token',
        reason: 'snapshot-outcome-unknown'
    });
    const receiptValues = {
        ok: true,
        protocolVersion: 2,
        loadId: 'native-terminal-load',
        reason: 'snapshot-outcome-unknown',
        gateState: 'terminal-locked'
    };
    const receiptSource = oneReadRecord('terminalReceipt', receiptValues);
    settleNativeRequest(app, wireRequest, { ok: true, result: receiptSource.source });
    const receipt = await terminalObserved;

    receiptSource.assertReadOnce();
    assert.deepEqual(JSON.parse(JSON.stringify(receipt)), receiptValues);
    assert.notStrictEqual(receipt, receiptSource.source);

    const oldStrict = adapter.terminalize({
        reason: 'save-outcome-unknown',
        sessionContext: {
            protocolVersion: 2,
            loadId: 'native-terminal-load',
            writeSessionToken: 'native-terminal-token'
        }
    }).then(
        () => assert.fail('strict terminalization requires the exact receipt'),
        error => error
    );
    settleNativeRequest(app, app.bridgeRequests[1], {
        ok: true,
        result: { ok: true, reason: 'save-outcome-unknown' }
    });
    const oldStrictError = await oldStrict;
    assert.equal(oldStrictError.constructor.name, 'TypeError');
    assert.equal(oldStrictError.message, 'INVALID_NATIVE_TERMINAL_RECEIPT');
});

test('legacy flat postRender terminalization remains narrow and rejects other flat reasons before host I/O', async (t) => {
    const { app, adapter } = nativeAdapterHarness(t);
    const legacyRequest = {
        protocolVersion: 2,
        loadId: 'legacy-post-render-load',
        writeSessionToken: 'legacy-post-render-token',
        reason: 'internalError.postRender'
    };
    const terminal = adapter.terminalize(legacyRequest);
    assert.equal(app.bridgeRequests.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(app.bridgeRequests[0].payload)), legacyRequest);
    const oldReceipt = { ok: true, reason: 'internalError.postRender' };
    settleNativeRequest(app, app.bridgeRequests[0], { ok: true, result: oldReceipt });
    assert.strictEqual(await terminal, oldReceipt);

    const callsBeforeInvalid = app.bridgeRequests.length;
    const invalid = adapter.terminalize({
        ...legacyRequest,
        reason: 'save-outcome-unknown'
    }).then(() => null, error => error);
    const callsAfterInvalid = app.bridgeRequests.length;
    if (callsAfterInvalid > callsBeforeInvalid) {
        settleNativeRequest(app, app.bridgeRequests[callsBeforeInvalid], {
            ok: false,
            error: 'invalid flat request must not have reached Host'
        });
    }
    const invalidError = await invalid;
    assert.equal(invalidError.constructor.name, 'TypeError');
    assert.equal(invalidError.message, 'INVALID_TERMINALIZE_REQUEST');
    assert.equal(callsAfterInvalid, callsBeforeInvalid);
    assert.equal(adapter.webGateState, 'terminalLocked');
});

test('native adapter rejects success receipts that are not correlated to their strict request', async (t) => {
    for (const [label, receiptOverrides] of [
        ['save client ID', { clientSaveId: 'wrong-save-id' }],
        ['save payload hash', { payloadHash: '8'.repeat(64) }],
        ['save source hash', { sourceHashBefore: '8'.repeat(64) }]
    ]) {
        await t.test(label, async (subtest) => {
            const { app, adapter } = nativeAdapterHarness(subtest);
            const request = strictNativeSaveRequest();
            const result = adapter.save(request).then(
                () => assert.fail(`${label} must reject`),
                error => error
            );
            settleNativeRequest(app, app.bridgeRequests[0], {
                ok: true,
                result: {
                    ok: true,
                    clientSaveId: request.clientSaveId,
                    payloadHash: request.payloadHash,
                    sourceHashBefore: request.expectedHash,
                    stateHashAfter: '9'.repeat(64),
                    stateHash: '9'.repeat(64),
                    byteCount: Buffer.byteLength(request.stateJson, 'utf8'),
                    durability: 'native-durable',
                    updatedAt: 'correlation-time',
                    storagePath: '/native/correlation/path',
                    recoveryHealth: recoveryHealth('ordinary'),
                    ...receiptOverrides
                }
            });
            const error = await result;
            assert.equal(error.constructor.name, 'TypeError');
            assert.equal(error.message, 'INVALID_NATIVE_SAVE_RECEIPT');
            assert.equal(app.bridgeRequests.length, 1);
        });
    }

    for (const [label, receiptOverrides] of [
        ['snapshot client ID', { clientSnapshotId: 'wrong-snapshot-id' }],
        ['snapshot expected hash', {
            sourceHash: '8'.repeat(64),
            snapshotHash: '8'.repeat(64)
        }],
        ['snapshot hash pair', { sourceHash: '8'.repeat(64) }]
    ]) {
        await t.test(label, async (subtest) => {
            const { app, adapter } = nativeAdapterHarness(subtest);
            const request = strictNativeSnapshotRequest();
            const result = adapter.snapshot(request).then(
                () => assert.fail(`${label} must reject`),
                error => error
            );
            settleNativeRequest(app, app.bridgeRequests[0], {
                ok: true,
                result: {
                    ok: true,
                    clientSnapshotId: request.clientSnapshotId,
                    sourceHash: request.expectedHash,
                    snapshotHash: request.expectedHash,
                    ordinal: 1,
                    snapshotStatus: 'created',
                    durability: 'native-durable',
                    retainedCount: 1,
                    recoveryHealth: recoveryHealth('snapshot'),
                    ...receiptOverrides
                }
            });
            const error = await result;
            assert.equal(error.constructor.name, 'TypeError');
            assert.equal(error.message, 'INVALID_NATIVE_SNAPSHOT_RECEIPT');
            assert.equal(app.bridgeRequests.length, 1);
        });
    }
});

test('native adapter rejects structured errors that are not correlated to their strict request', async (t) => {
    for (const [label, errorOverrides] of [
        ['save client ID', { clientSaveId: 'wrong-save-error-id' }],
        ['save payload hash', { payloadHash: '8'.repeat(64) }]
    ]) {
        await t.test(label, async (subtest) => {
            const { app, adapter } = nativeAdapterHarness(subtest);
            const request = strictNativeSaveRequest();
            const result = adapter.save(request).then(
                () => assert.fail(`${label} must reject`),
                error => error
            );
            settleNativeRequest(app, app.bridgeRequests[0], {
                ok: false,
                error: {
                    code: 'save-not-committed',
                    message: 'correlation fixture',
                    writeOutcome: 'not-committed',
                    conflict: false,
                    clientSaveId: request.clientSaveId,
                    payloadHash: request.payloadHash,
                    sourceHashAfter: '8'.repeat(64),
                    sourceReverified: true,
                    coordinatorReleased: true,
                    healthPersisted: false,
                    recoveryHealthEvidence: null,
                    ...errorOverrides
                }
            });
            const error = await result;
            assert.equal(error.constructor.name, 'TypeError');
            assert.equal(error.message, 'INVALID_NATIVE_SAVE_ERROR');
            assert.equal(app.bridgeRequests.length, 1);
        });
    }

    await t.test('snapshot client ID', async (subtest) => {
        const { app, adapter } = nativeAdapterHarness(subtest);
        const request = strictNativeSnapshotRequest();
        const result = adapter.snapshot(request).then(
            () => assert.fail('snapshot error client ID must reject'),
            error => error
        );
        settleNativeRequest(app, app.bridgeRequests[0], {
            ok: false,
            error: {
                code: 'snapshot-not-created',
                message: 'correlation fixture',
                snapshotOutcome: 'not-created',
                conflict: false,
                clientSnapshotId: 'wrong-snapshot-error-id',
                sourceHashAfter: '8'.repeat(64),
                sourceReverified: true,
                coordinatorReleased: true,
                healthPersisted: false,
                recoveryHealthEvidence: null
            }
        });
        const error = await result;
        assert.equal(error.constructor.name, 'TypeError');
        assert.equal(error.message, 'INVALID_NATIVE_SNAPSHOT_ERROR');
        assert.equal(app.bridgeRequests.length, 1);
    });

    const saveHarness = nativeAdapterHarness(t);
    const saveRequest = strictNativeSaveRequest({ clientSaveId: 'save-error-other-source' });
    const saveResult = saveHarness.adapter.save(saveRequest).then(() => null, error => error);
    settleNativeRequest(saveHarness.app, saveHarness.app.bridgeRequests[0], {
        ok: false,
        error: {
            code: 'save-unknown',
            message: 'different source is queue-classified',
            writeOutcome: 'unknown',
            conflict: false,
            clientSaveId: saveRequest.clientSaveId,
            payloadHash: saveRequest.payloadHash,
            sourceHashAfter: '8'.repeat(64),
            sourceReverified: true,
            coordinatorReleased: true,
            healthPersisted: false,
            recoveryHealthEvidence: null
        }
    });
    const typedSave = await saveResult;
    assert.equal(typedSave.constructor.name, 'AssetTrackerSaveError');
    assert.equal(typedSave.sourceHashAfter, '8'.repeat(64));

    const snapshotHarness = nativeAdapterHarness(t);
    const snapshotRequest = strictNativeSnapshotRequest({ clientSnapshotId: 'snapshot-error-other-source' });
    const snapshotResult = snapshotHarness.adapter.snapshot(snapshotRequest).then(() => null, error => error);
    settleNativeRequest(snapshotHarness.app, snapshotHarness.app.bridgeRequests[0], {
        ok: false,
        error: {
            code: 'snapshot-unknown',
            message: 'different source is queue-classified',
            snapshotOutcome: 'unknown',
            conflict: false,
            clientSnapshotId: snapshotRequest.clientSnapshotId,
            sourceHashAfter: '8'.repeat(64),
            sourceReverified: true,
            coordinatorReleased: true,
            healthPersisted: false,
            recoveryHealthEvidence: null
        }
    });
    const typedSnapshot = await snapshotResult;
    assert.equal(typedSnapshot.constructor.name, 'AssetTrackerSnapshotError');
    assert.equal(typedSnapshot.sourceHashAfter, '8'.repeat(64));
});

test('native adapter enforces safe integer and snapshot retention receipt bounds', async (t) => {
    for (const byteCount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        await t.test(`save byteCount ${byteCount}`, async (subtest) => {
            const { app, adapter } = nativeAdapterHarness(subtest);
            const request = strictNativeSaveRequest({ clientSaveId: `save-byte-${byteCount}` });
            const result = adapter.save(request).then(
                () => assert.fail('invalid byteCount must reject'),
                error => error
            );
            settleNativeRequest(app, app.bridgeRequests[0], {
                ok: true,
                result: {
                    ok: true,
                    clientSaveId: request.clientSaveId,
                    payloadHash: request.payloadHash,
                    sourceHashBefore: request.expectedHash,
                    stateHashAfter: '7'.repeat(64),
                    stateHash: '7'.repeat(64),
                    byteCount,
                    durability: 'native-durable',
                    updatedAt: 'integer-bound-time',
                    storagePath: '/native/integer-bound',
                    recoveryHealth: recoveryHealth('ordinary')
                }
            });
            const error = await result;
            assert.equal(error.constructor.name, 'TypeError');
            assert.equal(error.message, 'INVALID_NATIVE_SAVE_RECEIPT');
        });
    }

    for (const [label, ordinal, retainedCount, valid] of [
        ['lower retention bound', 0, 1, true],
        ['upper retention bound', 1, 24, true],
        ['zero retained', 1, 0, false],
        ['too many retained', 1, 25, false],
        ['fractional retained', 1, 1.5, false],
        ['unsafe retained', 1, Number.MAX_SAFE_INTEGER + 1, false],
        ['negative ordinal', -1, 1, false],
        ['fractional ordinal', 0.5, 1, false],
        ['unsafe ordinal', Number.MAX_SAFE_INTEGER + 1, 1, false]
    ]) {
        await t.test(label, async (subtest) => {
            const { app, adapter } = nativeAdapterHarness(subtest);
            const request = strictNativeSnapshotRequest({ clientSnapshotId: `snapshot-${label}` });
            const result = adapter.snapshot(request).then(value => value, error => error);
            settleNativeRequest(app, app.bridgeRequests[0], {
                ok: true,
                result: {
                    ok: true,
                    clientSnapshotId: request.clientSnapshotId,
                    sourceHash: request.expectedHash,
                    snapshotHash: request.expectedHash,
                    ordinal,
                    snapshotStatus: 'created',
                    durability: 'native-durable',
                    retainedCount,
                    recoveryHealth: recoveryHealth('snapshot')
                }
            });
            const outcome = await result;
            if (valid) {
                assert.equal(outcome.retainedCount, retainedCount);
                assert.equal(outcome.ordinal, ordinal);
            } else {
                assert.equal(outcome.constructor.name, 'TypeError');
                assert.equal(outcome.message, 'INVALID_NATIVE_SNAPSHOT_RECEIPT');
            }
        });
    }
});

test('strict terminal receipt binds load and stable reason taxonomy without requiring current reason equality', async (t) => {
    const request = {
        reason: 'snapshot-outcome-unknown',
        sessionContext: {
            protocolVersion: 2,
            loadId: 'terminal-correlation-load',
            writeSessionToken: 'terminal-correlation-token'
        }
    };
    for (const [label, receiptOverrides] of [
        ['wrong load', { loadId: 'wrong-terminal-load' }],
        ['invalid stable reason', { reason: 'internalError.postRender' }]
    ]) {
        await t.test(label, async (subtest) => {
            const { app, adapter } = nativeAdapterHarness(subtest);
            const result = adapter.terminalize(request).then(
                () => assert.fail(`${label} must reject`),
                error => error
            );
            settleNativeRequest(app, app.bridgeRequests[0], {
                ok: true,
                result: {
                    ok: true,
                    protocolVersion: 2,
                    loadId: request.sessionContext.loadId,
                    reason: request.reason,
                    gateState: 'terminal-locked',
                    ...receiptOverrides
                }
            });
            const error = await result;
            assert.equal(error.constructor.name, 'TypeError');
            assert.equal(error.message, 'INVALID_NATIVE_TERMINAL_RECEIPT');
            assert.equal(app.bridgeRequests.length, 1);
        });
    }

    const stableHarness = nativeAdapterHarness(t);
    const stable = stableHarness.adapter.terminalize(request);
    settleNativeRequest(stableHarness.app, stableHarness.app.bridgeRequests[0], {
        ok: true,
        result: {
            ok: true,
            protocolVersion: 2,
            loadId: request.sessionContext.loadId,
            reason: 'save-conflict',
            gateState: 'terminal-locked'
        }
    });
    const stableReceipt = await stable;
    assert.equal(stableReceipt.reason, 'save-conflict');
    assert.equal(stableHarness.app.bridgeRequests.length, 1);
});

test('native load round-trips complete dual health and exact hash time and path evidence', async (t) => {
    const { app, adapter } = nativeAdapterHarness(t);
    const load = adapter.load();
    const loadObserved = load.then(value => value, error => error);
    const wireRequest = app.bridgeRequests[0];
    const result = nativeLoadResult();
    const ordinary = oneReadRecord('nativeLoad.ordinaryRecoveryHealth', result.ordinaryRecoveryHealth);
    const snapshot = oneReadRecord('nativeLoad.snapshotRecoveryHealth', result.snapshotRecoveryHealth);
    const source = oneReadRecord('nativeLoad', {
        ...result,
        ordinaryRecoveryHealth: ordinary.source,
        snapshotRecoveryHealth: snapshot.source
    });
    settleNativeRequest(app, wireRequest, { ok: true, result: source.source });
    const loaded = await loadObserved;

    source.assertReadOnce();
    ordinary.assertReadOnce();
    snapshot.assertReadOnce();
    assert.equal(loaded.recoveryHealthComplete, true);
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.ordinaryRecoveryHealth)), result.ordinaryRecoveryHealth);
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.snapshotRecoveryHealth)), result.snapshotRecoveryHealth);
    assert.equal(loaded.stateHash, result.stateHash);
    assert.equal(loaded.rawHash, result.rawHash);
    assert.equal(loaded.updatedAt, result.updatedAt);
    assert.equal(loaded.storagePath, result.storagePath);
});

test('native load permits false plus both null and rejects missing malformed or contradictory health', async (t) => {
    const validIncomplete = nativeLoadResult({
        recoveryHealthComplete: false,
        ordinaryRecoveryHealth: null,
        snapshotRecoveryHealth: null
    });
    const invalid = [
        ['old native result missing health fields', {
            recoveryHealthComplete: undefined,
            ordinaryRecoveryHealth: undefined,
            snapshotRecoveryHealth: undefined
        }],
        ['false with ordinary health', {
            recoveryHealthComplete: false,
            ordinaryRecoveryHealth: recoveryHealth('ordinary'),
            snapshotRecoveryHealth: null
        }],
        ['true missing snapshot health', {
            recoveryHealthComplete: true,
            snapshotRecoveryHealth: null
        }],
        ['cross-domain ordinary health', {
            ordinaryRecoveryHealth: recoveryHealth('snapshot')
        }],
        ['contradictory healthy health', {
            ordinaryRecoveryHealth: recoveryHealth('ordinary', 'healthy', { code: 'illegal-code' })
        }],
        ['malformed updatedAt type', { updatedAt: 17 }],
        ['malformed storagePath type', { storagePath: { path: '/native/book' } }]
    ];

    const incompleteHarness = nativeAdapterHarness(t);
    const incomplete = incompleteHarness.adapter.load();
    settleNativeRequest(incompleteHarness.app, incompleteHarness.app.bridgeRequests[0], {
        ok: true,
        result: validIncomplete
    });
    const incompleteResult = await incomplete;
    assert.equal(incompleteResult.recoveryHealthComplete, false);
    assert.equal(incompleteResult.ordinaryRecoveryHealth, null);
    assert.equal(incompleteResult.snapshotRecoveryHealth, null);

    const requests = [];
    let trackerApp;
    const rawResult = nativeLoadResult({
        recoveryHealthComplete: false,
        ordinaryRecoveryHealth: null,
        snapshotRecoveryHealth: null
    });
    trackerApp = loadAssetTracker({
        nativeHost: {
            messageHandlers: {
                assetTrackerHost: {
                    postMessage(request) {
                        requests.push(request);
                        queueMicrotask(() => {
                            const result = request.type === 'storage.load'
                                ? rawResult
                                : request.type === 'storage.confirmLoad'
                                    ? { ok: true, writeSessionToken: 'must-not-confirm' }
                                    : { ok: true };
                            trackerApp.context.window.AssetTrackerHost.__handleResponse({
                                id: request.id,
                                ok: true,
                                result
                            });
                        });
                    }
                }
            }
        }
    });
    t.after(trackerApp.dispose);
    const tracker = new trackerApp.AssetTracker();
    installCriticalRenderStubs(tracker);

    await tracker.initialize();

    assert.equal(requests.filter(request => request.type === 'storage.confirmLoad').length, 0);
    assert.equal(requests.filter(request => request.type === 'storage.save').length, 0);
    assert.equal(tracker.appState, 'readOnlyRecovery');
    assert.equal(tracker.recoveryMode.active, true);
    assert.equal(tracker.writeSessionToken, null);
    assert.equal(tracker.rawEvidence?.rawHash, rawResult.rawHash, 'readable raw evidence remains exportable');
    assert.equal(tracker.pendingRawLoad?.recoveryHealthComplete, false);
    assert.equal(tracker.pendingRawLoad?.ordinaryRecoveryHealth, null);
    assert.equal(tracker.pendingRawLoad?.snapshotRecoveryHealth, null);

    for (const [label, overrides] of invalid) {
        await t.test(label, async (subtest) => {
            const { app, adapter } = nativeAdapterHarness(subtest);
            const load = adapter.load().then(
                () => assert.fail(`${label} must fail closed`),
                error => error
            );
            settleNativeRequest(app, app.bridgeRequests[0], {
                ok: true,
                result: nativeLoadResult(overrides)
            });
            const error = await load;
            assert.equal(error.constructor.name, 'TypeError');
            assert.equal(error.message, 'INVALID_NATIVE_LOAD_RESULT');
        });
    }
});

test('native virgin load accepts exact not-applicable dual health and reaches writable confirmation', async (t) => {
    const virginResult = nativeLoadResult({
        loadId: 'native-virgin-load',
        status: 'missing',
        stateJson: null,
        stateHash: '',
        rawHash: null,
        canExportRaw: false,
        recoveryHealthComplete: true,
        ordinaryRecoveryHealth: recoveryHealth('ordinary', 'not-applicable', {
            detail: 'virgin ordinary domain'
        }),
        snapshotRecoveryHealth: recoveryHealth('snapshot', 'not-applicable')
    });

    const directHarness = nativeAdapterHarness(t);
    const direct = directHarness.adapter.load();
    settleNativeRequest(directHarness.app, directHarness.app.bridgeRequests[0], {
        ok: true,
        result: virginResult
    });
    const copied = await direct;
    assert.equal(copied.status, 'missing');
    assert.deepEqual(
        JSON.parse(JSON.stringify(copied.ordinaryRecoveryHealth)),
        recoveryHealth('ordinary', 'not-applicable', { detail: 'virgin ordinary domain' })
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(copied.snapshotRecoveryHealth)),
        recoveryHealth('snapshot', 'not-applicable')
    );

    const requests = [];
    let app;
    app = loadAssetTracker({
        nativeHost: {
            messageHandlers: {
                assetTrackerHost: {
                    postMessage(request) {
                        requests.push(request);
                        queueMicrotask(() => {
                            const result = request.type === 'storage.load'
                                ? virginResult
                                : { ok: true, writeSessionToken: 'native-virgin-token' };
                            app.context.window.AssetTrackerHost.__handleResponse({
                                id: request.id,
                                ok: true,
                                result
                            });
                        });
                    }
                }
            }
        }
    });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    tracker.setupAutoBackup = async () => undefined;

    await tracker.initialize();

    assert.equal(tracker.appState, 'writable');
    assert.equal(tracker.recoveryMode.active, false);
    assert.equal(tracker.writeSessionToken, 'native-virgin-token');
    assert.equal(requests.filter(request => request.type === 'storage.confirmLoad').length, 1);
    assert.equal(requests.filter(request => request.type === 'storage.save').length, 0);

    const malformedHarness = nativeAdapterHarness(t);
    const malformed = malformedHarness.adapter.load().then(
        () => assert.fail('contradictory not-applicable health must fail closed'),
        error => error
    );
    settleNativeRequest(malformedHarness.app, malformedHarness.app.bridgeRequests[0], {
        ok: true,
        result: {
            ...virginResult,
            ordinaryRecoveryHealth: recoveryHealth('ordinary', 'not-applicable', {
                auditComplete: false
            })
        }
    });
    const malformedError = await malformed;
    assert.equal(malformedError.constructor.name, 'TypeError');
    assert.equal(malformedError.message, 'INVALID_NATIVE_LOAD_RESULT');
});

test('native load enforces the frozen status-specific DTO shape without cross-field fallback', async (t) => {
    const validFixtures = {
        missing: nativeLoadResult({
            status: 'missing',
            reason: null,
            stateJson: null,
            stateHash: '',
            rawHash: null,
            canExportRaw: false
        }),
        readableBytes: nativeLoadResult(),
        invalidUTF8: nativeLoadResult({
            status: 'invalidUTF8',
            reason: null,
            stateJson: null,
            stateHash: '',
            canExportRaw: true
        }),
        ioError: nativeLoadResult({
            status: 'ioError',
            reason: 'readFailed',
            stateJson: null,
            stateHash: '',
            rawHash: null,
            updatedAt: null,
            canExportRaw: false
        })
    };
    for (const [status, fixture] of Object.entries(validFixtures)) {
        await t.test(`valid ${status}`, async (subtest) => {
            const { app, adapter } = nativeAdapterHarness(subtest);
            const load = adapter.load();
            settleNativeRequest(app, app.bridgeRequests[0], { ok: true, result: fixture });
            assert.equal((await load).status, status);
        });
    }

    const invalidFixtures = [
        ['missing with state bytes', { ...validFixtures.missing, stateJson: '{"memo":"forged"}' }],
        ['missing with raw hash', { ...validFixtures.missing, rawHash: '4'.repeat(64) }],
        ['missing with state hash', { ...validFixtures.missing, stateHash: '4'.repeat(64) }],
        ['readable with I/O reason', { ...validFixtures.readableBytes, reason: 'readFailed' }],
        ['readable with unequal state hash', {
            ...validFixtures.readableBytes,
            stateHash: '4'.repeat(64)
        }],
        ['invalid UTF-8 with state text', {
            ...validFixtures.invalidUTF8,
            stateJson: '{"memo":"not UTF-8 proof"}'
        }],
        ['invalid UTF-8 with nonempty state alias', {
            ...validFixtures.invalidUTF8,
            stateHash: validFixtures.invalidUTF8.rawHash
        }],
        ['I/O error without a reason', { ...validFixtures.ioError, reason: null }],
        ['I/O error with raw hash', { ...validFixtures.ioError, rawHash: '4'.repeat(64) }],
        ['I/O error advertised export', { ...validFixtures.ioError, canExportRaw: true }],
        ['I/O error with unknown reason', { ...validFixtures.ioError, reason: 'networkLost' }],
        ['native result with alternate hash algorithm', {
            ...validFixtures.readableBytes,
            hashAlgorithm: 'sha256-utf8'
        }]
    ];
    for (const [label, fixture] of invalidFixtures) {
        await t.test(label, async (subtest) => {
            const { app, adapter } = nativeAdapterHarness(subtest);
            const load = adapter.load().then(
                () => assert.fail(`${label} must fail closed`),
                error => error
            );
            settleNativeRequest(app, app.bridgeRequests[0], { ok: true, result: fixture });
            const error = await load;
            assert.equal(error.constructor.name, 'TypeError');
            assert.equal(error.message, 'INVALID_NATIVE_LOAD_RESULT');
        });
    }
});

test('the Web protocol-v2 gate rejects fabricated, stale, repeated, and unknown confirmations', async (t) => {
    const raw = JSON.stringify(validLegacy());
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    const adapter = tracker.storageAdapter;
    const hash = sourceHash(raw);
    const fabricated = {
        protocolVersion: 2,
        loadId: 'not-loaded',
        outcome: 'valid',
        reason: null,
        validatedSourceHash: hash
    };

    const fabricatedAck = await adapter.confirmLoad(fabricated);
    assert.equal(fabricatedAck.ok, false);
    await assert.rejects(() => adapter.save('{"memo":"forged"}', {
        protocolVersion: 2,
        loadId: fabricated.loadId,
        writeSessionToken: fabricatedAck.writeSessionToken,
        expectedHash: hash,
        validatedSourceHash: hash
    }), /WRITE_SESSION_NOT_VALIDATED/);

    const candidate = await adapter.load();
    const wrongLoadAck = await adapter.confirmLoad({ ...fabricated, loadId: 'stale' });
    const unknownOutcomeAck = await adapter.confirmLoad({
        ...fabricated,
        loadId: candidate.loadId,
        outcome: 'anything'
    });
    assert.equal(wrongLoadAck.ok, false);
    assert.equal(unknownOutcomeAck.ok, false);

    const validAck = await adapter.confirmLoad({
        ...fabricated,
        loadId: candidate.loadId
    });
    assert.equal(validAck.ok, true);
    assert.equal(typeof validAck.writeSessionToken, 'string');
    assert.equal((await adapter.confirmLoad({ ...fabricated, loadId: candidate.loadId })).ok, false);

    await adapter.load();
    await assert.rejects(() => adapter.save('{"memo":"stale-session"}', {
        protocolVersion: 2,
        loadId: candidate.loadId,
        writeSessionToken: validAck.writeSessionToken,
        expectedHash: hash,
        validatedSourceHash: hash
    }), /WRITE_SESSION_NOT_VALIDATED/);
    assert.equal(app.localStorageWrites.length, 0);
    assert.equal(app.readLocalStorage('assetTrackerData'), raw);
});

test('the static shell starts hidden, inert, and labelled recovery/status hooks exist', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
    assert.match(indexHtml, /id="normal-app-shell"[^>]*\bhidden\b[^>]*\binert\b[^>]*aria-hidden="true"/);
    assert.match(indexHtml, /id="recovery-surface"[^>]*\bhidden\b[^>]*aria-labelledby="recovery-title"/);
    assert.match(indexHtml, /id="recovery-title"[^>]*tabindex="-1"/);
    assert.match(indexHtml, /id="app-status"[^>]*role="status"/);
    assert.match(indexHtml, /id="data-safety-status"[^>]*role="status"/);
    for (const id of ['export-raw-book-btn', 'reveal-storage-folder-btn', 'retry-book-load-btn']) {
        assert.match(indexHtml, new RegExp(`id="${id}"[^>]*\\bhidden\\b`));
    }
    assert.match(styles, /\.recovery-actions\s+\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/s);
});

test('missing source becomes a writable first-run book only after critical render and confirmation', async (t) => {
    const app = loadAssetTracker();
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    const calls = [];
    let autoBackupStarts = 0;
    installCriticalRenderStubs(tracker, { calls });
    tracker.setupAutoBackup = () => { autoBackupStarts += 1; };

    await tracker.initialize();

    assert.deepEqual(calls, CRITICAL_RENDER_STEPS);
    assert.equal(tracker.lastLoadResult.status, 'missing');
    assert.equal(tracker.recoveryMode.active, false);
    assert.equal(tracker.appState, 'writable');
    assert.equal(typeof tracker.writeSessionToken, 'string');
    assert.equal(app.elements.get('normal-app-shell').hidden, false);
    assert.equal(app.elements.get('normal-app-shell').inert, false);
    assert.equal(app.elements.get('normal-app-shell').hasAttribute('aria-hidden'), false);
    assert.equal(app.elements.get('recovery-surface').hidden, true);
    assert.equal(autoBackupStarts, 1);
    assert.equal(app.readLocalStorage('assetTrackerData'), null);
});

test('valid source retains unknown fields and reveals only after matching confirmation', async (t) => {
    const raw = JSON.stringify(validLegacy({ unknownRoot: { keep: 'yes' } }));
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    tracker.setupAutoBackup = () => {};

    await tracker.initialize();

    assert.equal(tracker.lastLoadResult.status, 'valid');
    assert.equal(tracker.data.unknownRoot.keep, 'yes');
    assert.equal(tracker.storageMeta.stateHash, sourceHash(raw));
    assert.equal(app.readLocalStorage('assetTrackerData'), raw);
    assert.equal(app.localStorageWrites.length, 0);
    assert.equal(tracker.appState, 'writable');
});

test('corrupt, unsupported, empty-present, and Web read I/O failures enter distinct recovery without writes or timers', async (t) => {
    const cases = [
        { name: 'corrupt', raw: '{"broken"', reason: 'corrupt', copy: '账本内容无法安全读取' },
        { name: 'unsupported', raw: JSON.stringify(envelope(validLegacy(), { schemaVersion: 2 })), reason: 'unsupported', copy: '此版本无法打开该账本；账本不一定损坏' },
        { name: 'empty', raw: '', reason: 'corrupt', copy: '账本内容无法安全读取' }
    ];

    for (const fixture of cases) {
        await t.test(fixture.name, async (subtest) => {
            const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: fixture.raw } });
            subtest.after(app.dispose);
            const beforeHash = sourceHash(fixture.raw);
            const tracker = new app.AssetTracker();
            installCriticalRenderStubs(tracker);

            await tracker.initialize();

            assert.equal(tracker.recoveryMode.active, true);
            assert.equal(tracker.recoveryMode.reason, fixture.reason);
            assert.match(app.elements.get('recovery-title').textContent, new RegExp(fixture.copy));
            assertShellIsolated(app);
            assertRecoveryVisible(app);
            assert.equal(app.readLocalStorage('assetTrackerData'), fixture.raw);
            assert.equal(sourceHash(app.readLocalStorage('assetTrackerData')), beforeHash);
            assert.equal(app.localStorageWrites.length, 0);
            assert.equal(app.pendingTimerCount, 0);
            assert.equal(app.elements.get('export-raw-book-btn').hidden, false);
            assert.equal(app.elements.get('reveal-storage-folder-btn').hidden, true);
            assert.equal(app.elements.get('retry-book-load-btn').hidden, false);
        });
    }

    await t.test('ioError', async () => {
        const writes = [];
        const app = loadAssetTracker({
            storage: {
                getItem() { throw new Error('permission denied'); },
                setItem(key, value) { writes.push({ key, value }); },
                removeItem(key) { writes.push({ key, removed: true }); }
            }
        });
        t.after(app.dispose);
        const tracker = new app.AssetTracker();
        installCriticalRenderStubs(tracker);

        await tracker.initialize();

        assert.equal(tracker.recoveryMode.reason, 'ioError');
        assert.match(app.elements.get('recovery-title').textContent, /暂时无法读取账本/);
        assert.equal(app.elements.get('export-raw-book-btn').hidden, true);
        assert.equal(app.elements.get('retry-book-load-btn').hidden, false);
        assert.equal(writes.length, 0);
        assert.equal(app.pendingTimerCount, 0);
    });
});

test('native invalid UTF-8 enters corrupt recovery without transporting raw bytes through JavaScript', async (t) => {
    const app = loadAssetTracker();
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    tracker.storageAdapter = {
        supportsNative: true,
        async load() {
            return {
                protocolVersion: 2,
                loadId: 'load-invalid',
                status: 'invalidUTF8',
                reason: null,
                stateJson: null,
                rawHash: 'a'.repeat(64),
                hashAlgorithm: 'sha256',
                storagePath: '/tmp/book.json',
                canExportRaw: true,
                canRevealFolder: true,
                ...completeNativeLoadHealth()
            };
        }
    };

    await tracker.initialize();

    assert.equal(tracker.recoveryMode.reason, 'corrupt');
    assert.equal(tracker.rawEvidence.bytes, undefined);
    assert.equal(tracker.rawEvidence.rawHash, 'a'.repeat(64));
    assert.equal(app.elements.get('export-raw-book-btn').hidden, false);
    assert.equal(app.elements.get('reveal-storage-folder-btn').hidden, false);
    assert.equal(app.pendingTimerCount, 0);
});

test('a validator implementation exception is recoverable internalError and never labels the source corrupt', async (t) => {
    const raw = JSON.stringify(validLegacy());
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    tracker.validateRawBook = () => { throw new Error('validator bug'); };

    await tracker.initialize();

    assert.equal(tracker.recoveryMode.reason, 'internalError');
    assert.equal(tracker.recoveryMode.phase, 'preRender');
    assert.match(app.elements.get('recovery-title').textContent, /应用未能完成安全打开/);
    assert.doesNotMatch(app.elements.get('recovery-title').textContent, /损坏/);
    assert.equal(app.elements.get('retry-book-load-btn').hidden, false);
    assert.equal(app.readLocalStorage('assetTrackerData'), raw);
    assert.equal(app.localStorageWrites.length, 0);
});

test('validator failure confirms the raw readable candidate and rejects a failed recovery ACK', async (t) => {
    const raw = JSON.stringify(validLegacy());
    const rawHash = sourceHash(raw);
    const app = loadAssetTracker();
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    const confirmations = [];
    const exports = [];
    tracker.storageAdapter = {
        supportsNative: true,
        async load() {
            return {
                protocolVersion: 2,
                loadId: 'validator-candidate',
                status: 'readableBytes',
                stateJson: raw,
                rawHash,
                hashAlgorithm: 'sha256',
                storagePath: '/fixed/AssetTrackerBook.json',
                canExportRaw: true,
                canRevealFolder: true,
                ...completeNativeLoadHealth()
            };
        },
        async confirmLoad(request) {
            confirmations.push(request);
            return { ok: false, error: 'stale candidate' };
        }
    };
    tracker.fileAdapter.exportRawBook = async options => { exports.push(options); };
    tracker.validateRawBook = () => { throw new Error('validator failure'); };

    await tracker.initialize();
    await tracker.exportRawBook();

    assert.equal(confirmations.length, 1);
    assert.equal(confirmations[0].loadId, 'validator-candidate');
    assert.equal(confirmations[0].outcome, 'recovery');
    assert.equal(confirmations[0].validatedSourceHash, rawHash);
    assert.equal(tracker.recoveryMode.reason, 'internalError');
    assert.equal(tracker.recoveryMode.terminal, true);
    assert.equal(tracker.rawEvidence.rawHash, rawHash);
    assert.equal(app.elements.get('export-raw-book-btn').hidden, false);
    assert.deepEqual(JSON.parse(JSON.stringify(exports)), [{
        expectedHash: rawHash,
        suggestedName: 'AssetTrackerBook.raw'
    }]);
    assert.equal(app.elements.get('retry-book-load-btn').hidden, true);
});

test('each retry clears old raw evidence before load and an I/O retry cannot reuse it', async (t) => {
    const original = '{"broken"';
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: original } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    await tracker.initialize();
    assert.equal(app.elements.get('export-raw-book-btn').hidden, false);
    assert.equal(tracker.rawEvidence.rawHash, sourceHash(original));

    const retryLoad = deferred();
    tracker.storageAdapter.load = async () => retryLoad.promise;
    const retry = tracker.retryBookLoad();
    await Promise.resolve();
    const duringRetry = {
        rawEvidence: tracker.rawEvidence,
        pendingRawLoad: tracker.pendingRawLoad,
        exportHidden: app.elements.get('export-raw-book-btn').hidden
    };
    retryLoad.resolve({
        protocolVersion: 2,
        loadId: 'retry-io-no-bytes',
        status: 'ioError',
        reason: 'readFailed',
        stateJson: null,
        rawHash: null,
        canExportRaw: false,
        canRevealFolder: false,
        storagePath: 'localStorage'
    });
    await retry;

    assert.equal(duringRetry.rawEvidence, null);
    assert.equal(duringRetry.pendingRawLoad, null);
    assert.equal(duringRetry.exportHidden, true);
    assert.equal(tracker.rawEvidence, null);
    assert.equal(app.elements.get('export-raw-book-btn').hidden, true);
    let exportCalls = 0;
    tracker.fileAdapter.saveFile = async () => { exportCalls += 1; return { ok: true }; };
    app.elements.get('export-raw-book-btn').hidden = false;
    await assert.rejects(() => tracker.exportRawBook(), /RAW_EVIDENCE_UNAVAILABLE/);
    assert.equal(exportCalls, 0);
});

test('recovery action methods recheck current-attempt capability and exact Web bytes', async (t) => {
    await t.test('tampered Web bytes and Web reveal', async (subtest) => {
        const raw = '{"broken"';
        const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
        subtest.after(app.dispose);
        const tracker = new app.AssetTracker();
        installCriticalRenderStubs(tracker);
        await tracker.initialize();
        let exportCalls = 0;
        let revealCalls = 0;
        tracker.fileAdapter.saveFile = async () => { exportCalls += 1; return { ok: true }; };
        tracker.fileAdapter.revealDataFolder = async () => { revealCalls += 1; return { ok: true }; };
        tracker.rawEvidence.bytes[0] ^= 0xff;
        app.elements.get('export-raw-book-btn').hidden = false;
        app.elements.get('reveal-storage-folder-btn').hidden = false;

        await assert.rejects(() => tracker.exportRawBook(), /RAW_EVIDENCE_UNAVAILABLE/);
        await assert.rejects(() => tracker.revealStorageFolder(), /RECOVERY_ACTION_UNAVAILABLE/);
        assert.equal(exportCalls, 0);
        assert.equal(revealCalls, 0);
    });

    await t.test('native hash without explicit export capability', async (subtest) => {
        const app = loadAssetTracker();
        subtest.after(app.dispose);
        const tracker = new app.AssetTracker();
        installCriticalRenderStubs(tracker);
        let exportCalls = 0;
        tracker.storageAdapter = {
            supportsNative: true,
            async load() {
                return {
                    protocolVersion: 2,
                    loadId: 'native-no-export-capability',
                    status: 'invalidUTF8',
                    stateJson: null,
                    rawHash: 'e'.repeat(64),
                    hashAlgorithm: 'sha256',
                    storagePath: '/tmp/book.json',
                    canRevealFolder: true,
                    ...completeNativeLoadHealth()
                };
            }
        };
        tracker.fileAdapter.exportRawBook = async () => { exportCalls += 1; return { ok: true }; };

        await tracker.initialize();

        assert.equal(app.elements.get('export-raw-book-btn').hidden, true);
        app.elements.get('export-raw-book-btn').hidden = false;
        await assert.rejects(() => tracker.exportRawBook(), /RAW_EVIDENCE_UNAVAILABLE/);
        assert.equal(exportCalls, 0);
    });
});

test('native I/O evidence remains exportable and a hash mismatch never substitutes the Web hash', async (t) => {
    const raw = JSON.stringify(validLegacy());
    const webHash = sourceHash(raw);
    const nativeHash = 'd'.repeat(64);
    const fixtures = [
        {
            status: 'ioError',
            reason: 'readFailed',
            stateJson: null,
            rawHash: nativeHash
        },
        {
            status: 'readableBytes',
            reason: null,
            stateJson: raw,
            rawHash: nativeHash
        }
    ];

    for (const [index, fixture] of fixtures.entries()) {
        await t.test(String(index), async (subtest) => {
            const app = loadAssetTracker();
            subtest.after(app.dispose);
            const tracker = new app.AssetTracker();
            installCriticalRenderStubs(tracker);
            const exports = [];
            tracker.storageAdapter = {
                supportsNative: true,
                async load() {
                    return {
                        protocolVersion: 2,
                        loadId: `native-evidence-${index}`,
                        hashAlgorithm: 'sha256',
                        storagePath: '/fixed/AssetTrackerBook.json',
                        canExportRaw: true,
                        canRevealFolder: true,
                        ...completeNativeLoadHealth(),
                        ...fixture
                    };
                },
                async confirmLoad() {
                    return { ok: true, writeSessionToken: null };
                }
            };
            tracker.fileAdapter.exportRawBook = async options => { exports.push(options); };

            await tracker.initialize();
            await tracker.exportRawBook();

            assert.equal(tracker.recoveryMode.active, true);
            assert.equal(tracker.rawEvidence.rawHash, nativeHash);
            assert.equal(tracker.rawEvidence.hashAlgorithm, 'sha256');
            assert.notEqual(tracker.rawEvidence.rawHash, webHash);
            assert.deepEqual(JSON.parse(JSON.stringify(exports)), [{
                expectedHash: nativeHash,
                suggestedName: 'AssetTrackerBook.raw'
            }]);
        });
    }
});

test('every critical render step failure terminal-locks before reveal and leaves source evidence unchanged', async (t) => {
    const raw = JSON.stringify(validLegacy({ memo: 'render fixture' }));
    const expectedHash = sourceHash(raw);

    for (const step of CRITICAL_RENDER_STEPS) {
        await t.test(step, async () => {
            const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
            t.after(app.dispose);
            const tracker = new app.AssetTracker();
            installCriticalRenderStubs(tracker, { failAt: step });

            await tracker.initialize();

            assert.equal(tracker.recoveryMode.reason, 'renderError');
            assert.equal(tracker.recoveryMode.phase, 'postRender');
            assert.equal(tracker.writeSessionToken, null);
            assert.match(app.elements.get('recovery-title').textContent, /账本暂时无法安全显示/);
            assert.doesNotMatch(app.elements.get('recovery-title').textContent, /需要修复账本/);
            assertShellIsolated(app);
            assertRecoveryVisible(app);
            assert.equal(app.elements.get('retry-book-load-btn').hidden, true);
            assert.equal(app.readLocalStorage('assetTrackerData'), raw);
            assert.equal(sourceHash(app.readLocalStorage('assetTrackerData')), expectedHash);
            assert.equal(app.localStorageWrites.length, 0);
            assert.equal(app.pendingTimerCount, 0);
        });
    }
});

test('critical render failure enters Web terminal before the sole native terminalize timeout settles', async (t) => {
    const raw = JSON.stringify(validLegacy({ memo: 'critical render lost ACK' }));
    const rawHash = sourceHash(raw);
    const requests = [];
    const pendingTimeouts = new Map();
    let timeoutSequence = 0;
    let app;
    const clock = {
        setTimeout(callback, delay, ...args) {
            const handle = { kind: 'timeout', id: ++timeoutSequence };
            pendingTimeouts.set(handle, { callback, delay, args });
            return handle;
        },
        clearTimeout(handle) {
            pendingTimeouts.delete(handle);
        },
        setInterval() {
            throw new Error('critical render recovery must not schedule auto backup');
        },
        clearInterval() {}
    };
    const nativeHost = {
        messageHandlers: {
            assetTrackerHost: {
                postMessage(request) {
                    requests.push(request);
                    if (request.type !== 'storage.load') return;
                    queueMicrotask(() => {
                        app.context.window.AssetTrackerHost.__handleResponse({
                            id: request.id,
                            ok: true,
                            result: {
                                protocolVersion: 2,
                                loadId: 'critical-render-load',
                                status: 'readableBytes',
                                reason: null,
                                stateJson: raw,
                                stateHash: rawHash,
                                rawHash,
                                hashAlgorithm: 'sha256',
                                storagePath: '/native/AssetTrackerBook.json',
                                canExportRaw: true,
                                canRevealFolder: true,
                                ...completeNativeLoadHealth()
                            }
                        });
                    });
                }
            }
        }
    };
    app = loadAssetTracker({ nativeHost, clock });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker, { failAt: 'renderCategories' });
    let initializationSettled = false;
    const initialization = tracker.initialize().then(
        value => {
            initializationSettled = true;
            return value;
        },
        error => {
            initializationSettled = true;
            throw error;
        }
    );

    await new Promise(resolve => setImmediate(resolve));

    assert.equal(initializationSettled, false, 'only the native terminalize timeout may remain pending');
    assert.equal(tracker.recoveryMode.reason, 'renderError');
    assert.equal(tracker.recoveryMode.phase, 'postRender');
    assert.equal(tracker.recoveryMode.terminal, true);
    assert.equal(tracker.storageAdapter.webGateState, 'terminalLocked');
    assert.equal(tracker.writeSessionToken, null);
    assert.equal(tracker.autoBackupTimer, null);
    assertShellIsolated(app);
    assertRecoveryVisible(app);
    assert.equal(app.localStorageWrites.length, 0);
    assert.equal(requests.filter(request => request.type === 'storage.confirmLoad').length, 0);
    const terminalizeRequests = requests.filter(request => request.type === 'storage.terminalize');
    assert.equal(terminalizeRequests.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(terminalizeRequests[0].payload)), {
        protocolVersion: 2,
        loadId: 'critical-render-load',
        writeSessionToken: null,
        reason: 'renderError.postRender'
    });
    assert.equal(requests.filter(request => request.type === 'storage.save').length, 0);
    assert.equal(pendingTimeouts.size, 1);
    assert.equal(app.pendingTimerCount, 1, 'the native host timeout is the only remaining timer');

    const [[timeoutHandle, timeoutRecord]] = pendingTimeouts.entries();
    assert.equal(timeoutRecord.delay, 30000);
    pendingTimeouts.delete(timeoutHandle);
    timeoutRecord.callback(...timeoutRecord.args);
    await initialization;

    assert.equal(initializationSettled, true);
    assert.equal(app.pendingTimerCount, 0);
    assert.equal(tracker.recoveryMode.terminal, true);
    assertShellIsolated(app);
    assertRecoveryVisible(app);
});

test('ACK activation tail faults fail closed without rejecting initialize', async (t) => {
    const raw = JSON.stringify(validLegacy({ memo: 'activation tail fixture' }));
    const expectedHash = sourceHash(raw);
    const fixtures = [
        { name: 'renderDataSafetyState sync throw', method: 'renderDataSafetyState', persistent: true },
        { name: 'revealNormalShell sync throw', method: 'revealNormalShell' },
        { name: 'section title focus sync throw', focus: true },
        { name: 'setupAutoBackup sync throw', method: 'setupAutoBackup' },
        { name: 'setupAutoBackup async rejection', rejectingThenable: true }
    ];

    for (const fixture of fixtures) {
        await t.test(fixture.name, async (subtest) => {
            const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
            subtest.after(app.dispose);
            const tracker = new app.AssetTracker();
            installCriticalRenderStubs(tracker);
            const originalConfirmLoad = tracker.storageAdapter.confirmLoad.bind(tracker.storageAdapter);
            let acknowledgedToken = null;
            tracker.storageAdapter.confirmLoad = async request => {
                const acknowledgement = await originalConfirmLoad(request);
                if (request.outcome !== 'recovery') {
                    acknowledgedToken = acknowledgement.writeSessionToken;
                }
                return acknowledgement;
            };

            if (fixture.method) {
                const original = tracker[fixture.method].bind(tracker);
                let injected = false;
                tracker[fixture.method] = (...args) => {
                    if (fixture.persistent || !injected) {
                        injected = true;
                        throw new Error(`injected:${fixture.method}`);
                    }
                    return original(...args);
                };
            } else if (fixture.focus) {
                const sectionTitle = app.context.document.getElementById('section-title');
                const original = sectionTitle.focus.bind(sectionTitle);
                let injected = false;
                sectionTitle.focus = () => {
                    if (!injected) {
                        injected = true;
                        throw new Error('injected:section-title.focus');
                    }
                    return original();
                };
            } else if (fixture.rejectingThenable) {
                tracker.setupAutoBackup = () => ({
                    then(_resolve, reject) {
                        reject(new Error('injected:setupAutoBackup async rejection'));
                    }
                });
            } else {
                assert.fail(`unknown activation fixture: ${fixture.name}`);
            }

            let initializeError = null;
            try {
                await tracker.initialize();
            } catch (error) {
                initializeError = error;
            }

            assert.equal(initializeError, null);
            assert.equal(tracker.recoveryMode.active, true);
            assert.equal(tracker.recoveryMode.reason, 'internalError');
            assert.equal(tracker.recoveryMode.phase, 'postRender');
            assert.equal(tracker.recoveryMode.terminal, true);
            assert.equal(tracker.writeSessionToken, null);
            assert.equal(tracker.validatedSourceHash, null);
            assert.equal(tracker.storageAdapter.confirmedSession, null);
            assert.equal(tracker.storageAdapter.pendingCandidate, null);
            assert.equal(tracker.storageAdapter.webGateState, 'terminalLocked');
            assert.equal(tracker.autoBackupTimer, null);
            assert.equal(app.pendingTimerCount, 0);
            assertShellIsolated(app);
            assertRecoveryVisible(app);
            assert.equal(app.elements.get('retry-book-load-btn').hidden, true);
            assert.equal(app.readLocalStorage('assetTrackerData'), raw);
            assert.equal(sourceHash(app.readLocalStorage('assetTrackerData')), expectedHash);
            assert.equal(app.localStorageWrites.length, 0);

            if (fixture.name === 'renderDataSafetyState sync throw') {
                assert.equal(typeof acknowledgedToken, 'string');
                await assert.rejects(() => tracker.storageAdapter.save('{"memo":"must-not-write"}', {
                    protocolVersion: 2,
                    loadId: tracker.lastLoadResult.loadId,
                    writeSessionToken: acknowledgedToken,
                    expectedHash,
                    validatedSourceHash: expectedHash
                }), /WRITE_SESSION_NOT_VALIDATED/);
                let freshLoads = 0;
                tracker.storageAdapter.load = async () => {
                    freshLoads += 1;
                    return { status: 'missing' };
                };
                await assert.rejects(() => tracker.retryBookLoad(), /TERMINAL_RECOVERY/);
                assert.equal(freshLoads, 0);
            }
        });
    }
});

test('terminal activation rejects a captured native ACK token before host save dispatch', async (t) => {
    const raw = JSON.stringify(validLegacy({ memo: 'native activation token' }));
    const rawHash = sourceHash(raw);
    const acknowledgedToken = 'native-token-captured-before-tail-fault';
    const requests = [];
    let nativeTerminalized = false;
    let app;
    const nativeHost = {
        messageHandlers: {
            assetTrackerHost: {
                postMessage(request) {
                    requests.push(request);
                    queueMicrotask(() => {
                        if (request.type === 'storage.terminalize') {
                            nativeTerminalized = true;
                        }
                        if (request.type === 'storage.save' && nativeTerminalized) {
                            app.context.window.AssetTrackerHost.__handleResponse({
                                id: request.id,
                                ok: false,
                                error: 'native terminal gate rejected captured token'
                            });
                            return;
                        }
                        const result = request.type === 'storage.load'
                            ? {
                                protocolVersion: 2,
                                loadId: 'native-load-activation',
                                status: 'readableBytes',
                                reason: null,
                                stateJson: raw,
                                stateHash: rawHash,
                                rawHash,
                                hashAlgorithm: 'sha256',
                                storagePath: '/native/book',
                                canExportRaw: true,
                                canRevealFolder: true,
                                ...completeNativeLoadHealth()
                            }
                            : request.type === 'storage.confirmLoad'
                                ? { ok: true, writeSessionToken: acknowledgedToken }
                                : { ok: true, stateHash: rawHash };
                        app.context.window.AssetTrackerHost.__handleResponse({
                            id: request.id,
                            ok: true,
                            result
                        });
                    });
                }
            }
        }
    };
    app = loadAssetTracker({ nativeHost });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    tracker.renderDataSafetyState = () => {
        throw new Error('injected:native-renderDataSafetyState');
    };

    await tracker.initialize();

    assert.equal(tracker.recoveryMode.terminal, true);
    assert.equal(tracker.storageAdapter.webGateState, 'terminalLocked');
    const terminalizeRequests = requests.filter(request => request.type === 'storage.terminalize');
    assert.equal(terminalizeRequests.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(terminalizeRequests[0].payload)), {
        protocolVersion: 2,
        loadId: 'native-load-activation',
        writeSessionToken: acknowledgedToken,
        reason: 'internalError.postRender'
    });
    const saveCallsBefore = requests.filter(request => request.type === 'storage.save').length;
    await assert.rejects(() => tracker.storageAdapter.save('{"memo":"must-not-write"}', {
        protocolVersion: 2,
        loadId: 'native-load-activation',
        writeSessionToken: acknowledgedToken,
        expectedHash: rawHash,
        validatedSourceHash: rawHash
    }), /WRITE_SESSION_NOT_VALIDATED/);
    assert.equal(requests.filter(request => request.type === 'storage.save').length, saveCallsBefore);

    await assert.rejects(() => app.context.window.AssetTrackerHost.invoke('storage.save', {
        protocolVersion: 2,
        loadId: 'native-load-activation',
        writeSessionToken: acknowledgedToken,
        expectedHash: rawHash,
        validatedSourceHash: rawHash,
        stateJson: '{"memo":"direct-host-must-not-write"}',
        schemaVersion: 1,
        reason: 'direct-host-boundary'
    }), /native terminal gate rejected captured token/);
    assert.equal(requests.filter(request => request.type === 'storage.save').length, saveCallsBefore + 1);
});

test('native confirm or terminalize transport failures stay terminal and never reuse the candidate', async (t) => {
    const raw = JSON.stringify(validLegacy({ memo: 'terminal transport fixture' }));
    const rawHash = sourceHash(raw);
    for (const failureType of ['storage.confirmLoad', 'storage.terminalize']) {
        await t.test(failureType, async (subtest) => {
            const requests = [];
            let app;
            const nativeHost = {
                messageHandlers: {
                    assetTrackerHost: {
                        postMessage(request) {
                            requests.push(request);
                            queueMicrotask(() => {
                                if (request.type === failureType) {
                                    app.context.window.AssetTrackerHost.__handleResponse({
                                        id: request.id,
                                        ok: false,
                                        error: failureType === 'storage.confirmLoad'
                                            ? 'another storage operation is busy'
                                            : 'terminalize transport failed'
                                    });
                                    return;
                                }
                                const result = request.type === 'storage.load'
                                    ? {
                                        protocolVersion: 2,
                                        loadId: `native-${failureType}`,
                                        status: 'readableBytes',
                                        reason: null,
                                        stateJson: raw,
                                        stateHash: rawHash,
                                        rawHash,
                                        hashAlgorithm: 'sha256',
                                        storagePath: '/native/book',
                                        canExportRaw: true,
                                        canRevealFolder: true,
                                        ...completeNativeLoadHealth()
                                    }
                                    : request.type === 'storage.confirmLoad'
                                        ? { ok: true, writeSessionToken: 'transport-token' }
                                        : { ok: true };
                                app.context.window.AssetTrackerHost.__handleResponse({
                                    id: request.id,
                                    ok: true,
                                    result
                                });
                            });
                        }
                    }
                }
            };
            app = loadAssetTracker({ nativeHost });
            subtest.after(app.dispose);
            const tracker = new app.AssetTracker();
            installCriticalRenderStubs(tracker);
            if (failureType === 'storage.terminalize') {
                tracker.renderDataSafetyState = () => {
                    throw new Error('injected:activation-tail');
                };
            }

            await tracker.initialize();

            assert.equal(tracker.recoveryMode.terminal, true);
            assert.equal(tracker.storageAdapter.webGateState, 'terminalLocked');
            assert.equal(requests.filter(request => request.type === 'storage.confirmLoad').length, 1);
            assert.equal(requests.filter(request => request.type === 'storage.terminalize').length, 1);
            const terminalize = requests.find(request => request.type === 'storage.terminalize');
            assert.equal(terminalize.payload.loadId, `native-${failureType}`);
            assert.equal(
                terminalize.payload.writeSessionToken,
                failureType === 'storage.confirmLoad' ? null : 'transport-token'
            );
            await assert.rejects(() => tracker.retryBookLoad(), /TERMINAL_RECOVERY/);
            assert.equal(requests.filter(request => request.type === 'storage.load').length, 1);
            assert.equal(requests.filter(request => request.type === 'storage.save').length, 0);
        });
    }
});

test('enterReadOnlyRecovery clears a zero-valued interval handle', (t) => {
    const clearedIntervals = [];
    const app = loadAssetTracker({
        clock: {
            setTimeout,
            clearTimeout,
            setInterval() { return 0; },
            clearInterval(handle) { clearedIntervals.push(handle); }
        }
    });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    tracker.autoBackupTimer = 0;

    tracker.enterReadOnlyRecovery('internalError', {}, { phase: 'postRender', terminal: true });

    assert.deepEqual(clearedIntervals, [0]);
    assert.equal(tracker.autoBackupTimer, null);
});

test('performAutoBackup always returns a consumable Promise and native forwards persistData', async (t) => {
    await t.test('read-only no-op', async (subtest) => {
        const app = loadAssetTracker();
        subtest.after(app.dispose);
        const tracker = new app.AssetTracker();
        tracker.recoveryMode.active = true;
        tracker.appState = 'readOnlyRecovery';

        const result = tracker.performAutoBackup();

        assert.equal(typeof result?.then, 'function');
        await result;
    });

    await t.test('Web backup', async (subtest) => {
        const app = loadAssetTracker();
        subtest.after(app.dispose);
        const tracker = new app.AssetTracker();
        tracker.recoveryMode.active = false;
        tracker.appState = 'writable';

        const result = tracker.performAutoBackup();

        assert.equal(typeof result?.then, 'function');
        await result;
    });

    await t.test('native persist result', async (subtest) => {
        const app = loadAssetTracker();
        subtest.after(app.dispose);
        const tracker = new app.AssetTracker();
        const expected = { ok: true, stateHash: 'native-result' };
        tracker.storageAdapter.supportsNative = true;
        tracker.recoveryMode.active = false;
        tracker.appState = 'writable';
        tracker.persistData = async options => ({ ...expected, reason: options.reason });

        const result = tracker.performAutoBackup();

        assert.equal(typeof result?.then, 'function');
        assert.deepEqual(await result, { ...expected, reason: 'auto-backup' });
    });
});

test('legacy Web assetTrackerBackup routing remains a Task4 non-release debt', async (t) => {
    const app = loadAssetTracker();
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    tracker.recoveryMode.active = false;
    tracker.appState = 'writable';

    await tracker.performAutoBackup();

    assert.notEqual(app.readLocalStorage('assetTrackerBackup'), null);
    assert.notEqual(app.readLocalStorage('assetTrackerLastBackupTime'), null);
    assert.equal(app.readLocalStorage('assetTrackerData'), null);
});

test('a real due native backup rejection during activation fails closed', async (t) => {
    const app = loadAssetTracker();
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    tracker.storageAdapter = {
        supportsNative: true,
        async load() {
            return {
                protocolVersion: 2,
                loadId: 'native-missing-for-backup',
                status: 'missing',
                stateJson: null,
                rawHash: null,
                hashAlgorithm: 'sha256',
                storagePath: '/tmp/AssetTrackerBook.json',
                canExportRaw: false,
                canRevealFolder: true,
                ...completeNativeLoadHealth()
            };
        },
        async confirmLoad() {
            return { ok: true, writeSessionToken: 'native-backup-token' };
        }
    };
    tracker.persistData = () => ({
        then(_resolve, reject) {
            reject(new Error('injected native backup rejection'));
        }
    });

    await tracker.initialize();

    assert.equal(tracker.recoveryMode.reason, 'internalError');
    assert.equal(tracker.recoveryMode.phase, 'postRender');
    assert.equal(tracker.recoveryMode.terminal, true);
    assert.equal(tracker.writeSessionToken, null);
    assert.equal(tracker.autoBackupTimer, null);
    assert.equal(app.pendingTimerCount, 0);
    assertShellIsolated(app);
});

test('an interval backup rejection terminal-locks the running app and clears its timer', async (t) => {
    let intervalCallback = null;
    const clearedIntervals = [];
    const raw = JSON.stringify(validLegacy());
    const app = loadAssetTracker({
        localStorageSeed: {
            assetTrackerData: raw,
            assetTrackerLastBackupTime: String(Date.now())
        },
        clock: {
            setTimeout,
            clearTimeout,
            setInterval(callback) {
                intervalCallback = callback;
                return 17;
            },
            clearInterval(handle) {
                clearedIntervals.push(handle);
            }
        }
    });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    await tracker.initialize();
    assert.equal(tracker.autoBackupTimer, 17);

    tracker.performAutoBackup = () => ({
        catch(handler) {
            return Promise.resolve(handler(new Error('injected interval backup rejection')));
        }
    });
    const runner = intervalCallback();
    if (runner?.then) await runner;

    assert.equal(tracker.recoveryMode.reason, 'internalError');
    assert.equal(tracker.recoveryMode.phase, 'postRender');
    assert.equal(tracker.recoveryMode.terminal, true);
    assert.equal(tracker.writeSessionToken, null);
    assert.equal(tracker.autoBackupTimer, null);
    assert.deepEqual(clearedIntervals, [17]);
    assert.equal(app.pendingTimerCount, 0);
    assertShellIsolated(app);
});

test('native interval backup rejection terminalizes the bound session even when terminal ACK fails or times out', async (t) => {
    const raw = JSON.stringify(validLegacy({ memo: 'native interval terminalization' }));
    const rawHash = sourceHash(raw);

    for (const terminalOutcome of ['ack', 'unknown', 'timeout']) {
        await t.test(terminalOutcome, async (subtest) => {
            let intervalCallback = null;
            const requests = [];
            let saveCallCount = 0;
            let app;
            const nativeHost = {
                messageHandlers: {
                    assetTrackerHost: {
                        postMessage(request) {
                            requests.push(request);
                            queueMicrotask(() => {
                                if (request.type === 'storage.terminalize' && terminalOutcome === 'timeout') {
                                    return;
                                }
                                if (request.type === 'storage.load') {
                                    app.context.window.AssetTrackerHost.__handleResponse({
                                        id: request.id,
                                        ok: true,
                                        result: {
                                            protocolVersion: 2,
                                            loadId: `interval-load-${terminalOutcome}`,
                                            status: 'readableBytes',
                                            reason: null,
                                            stateJson: raw,
                                            stateHash: rawHash,
                                            rawHash,
                                            hashAlgorithm: 'sha256',
                                            storagePath: '/native/AssetTrackerBook.json',
                                            canExportRaw: true,
                                            canRevealFolder: true,
                                            ...completeNativeLoadHealth()
                                        }
                                    });
                                    return;
                                }
                                if (request.type === 'storage.confirmLoad') {
                                    app.context.window.AssetTrackerHost.__handleResponse({
                                        id: request.id,
                                        ok: true,
                                        result: { ok: true, writeSessionToken: `interval-token-${terminalOutcome}` }
                                    });
                                    return;
                                }
                                if (request.type === 'storage.save') {
                                    saveCallCount += 1;
                                    app.context.window.AssetTrackerHost.__handleResponse(saveCallCount === 1
                                        ? {
                                            id: request.id,
                                            ok: true,
                                            result: {
                                                ok: true,
                                                stateHash: String('c').repeat(64),
                                                updatedAt: '2026-08-10T00:00:00.000Z',
                                                storagePath: '/native/AssetTrackerBook.json'
                                            }
                                        }
                                        : {
                                            id: request.id,
                                            ok: false,
                                            error: 'injected interval storage.save rejection'
                                        });
                                    return;
                                }
                                if (request.type === 'storage.terminalize') {
                                    app.context.window.AssetTrackerHost.__handleResponse(terminalOutcome === 'ack'
                                        ? { id: request.id, ok: true, result: { ok: true, reason: 'internalError.postRender' } }
                                        : { id: request.id, ok: false, error: 'unknown terminalization result' });
                                }
                            });
                        }
                    }
                }
            };
            app = loadAssetTracker({
                nativeHost,
                clock: {
                    setTimeout,
                    clearTimeout,
                    setInterval(callback) {
                        intervalCallback = callback;
                        return 23;
                    },
                    clearInterval() {}
                }
            });
            subtest.after(app.dispose);
            const tracker = new app.AssetTracker();
            installCriticalRenderStubs(tracker);

            await tracker.initialize();
            assert.equal(typeof intervalCallback, 'function');
            assert.equal(saveCallCount, 1, 'activation backup establishes the production save path');

            const intervalRun = intervalCallback();
            await new Promise(resolve => setImmediate(resolve));
            if (terminalOutcome !== 'timeout' && intervalRun?.then) {
                await intervalRun;
            }

            assert.equal(tracker.recoveryMode.reason, 'internalError');
            assert.equal(tracker.recoveryMode.phase, 'postRender');
            assert.equal(tracker.recoveryMode.terminal, true);
            assert.equal(tracker.storageAdapter.webGateState, 'terminalLocked');
            assert.equal(tracker.writeSessionToken, null);
            const terminalizeRequests = requests.filter(request => request.type === 'storage.terminalize');
            assert.equal(terminalizeRequests.length, 1);
            assert.deepEqual(JSON.parse(JSON.stringify(terminalizeRequests[0].payload)), {
                protocolVersion: 2,
                loadId: `interval-load-${terminalOutcome}`,
                writeSessionToken: `interval-token-${terminalOutcome}`,
                reason: 'internalError.postRender'
            });
            await assert.rejects(() => tracker.retryBookLoad(), /TERMINAL_RECOVERY/);
            await assert.rejects(() => tracker.storageAdapter.save('{}', {
                protocolVersion: 2,
                loadId: `interval-load-${terminalOutcome}`,
                writeSessionToken: `interval-token-${terminalOutcome}`,
                expectedHash: String('c').repeat(64),
                validatedSourceHash: String('c').repeat(64)
            }), /WRITE_SESSION_NOT_VALIDATED/);
            assert.equal(requests.filter(request => request.type === 'storage.save').length, 2);
        });
    }
});

test('a lost or invalid confirmation ACK becomes terminal post-render internalError', async (t) => {
    const raw = JSON.stringify(validLegacy());
    const expectedHash = sourceHash(raw);
    for (const confirmation of [
        async () => { throw new Error('transport lost'); },
        async () => ({ ok: true, writeSessionToken: null }),
        async () => ({ ok: false, error: 'stale loadId' })
    ]) {
        const app = loadAssetTracker();
        t.after(app.dispose);
        const tracker = new app.AssetTracker();
        installCriticalRenderStubs(tracker);
        tracker.storageAdapter = {
            supportsNative: true,
            async load() {
                return {
                    protocolVersion: 2,
                    loadId: 'load-confirm',
                    status: 'readableBytes',
                    stateJson: raw,
                    stateHash: expectedHash,
                    rawHash: expectedHash,
                    hashAlgorithm: 'sha256',
                    storagePath: '/tmp/book.json',
                    canExportRaw: true,
                    canRevealFolder: true,
                    ...completeNativeLoadHealth()
                };
            },
            confirmLoad: confirmation
        };

        await tracker.initialize();

        assert.equal(tracker.recoveryMode.reason, 'internalError');
        assert.equal(tracker.recoveryMode.phase, 'postRender');
        assert.equal(tracker.writeSessionToken, null);
        assert.equal(app.elements.get('retry-book-load-btn').hidden, true);
        assertShellIsolated(app);
    }
});

test('Web confirmation failure preserves the exact source and never learns a write token', async (t) => {
    const raw = JSON.stringify(validLegacy({ memo: 'confirmation boundary' }));
    const beforeHash = sourceHash(raw);
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    tracker.storageAdapter.confirmLoad = async () => ({ ok: false, error: 'stale candidate' });

    await tracker.initialize();

    assert.equal(tracker.recoveryMode.reason, 'internalError');
    assert.equal(tracker.recoveryMode.terminal, true);
    assert.equal(tracker.writeSessionToken, null);
    assert.equal(app.readLocalStorage('assetTrackerData'), raw);
    assert.equal(sourceHash(app.readLocalStorage('assetTrackerData')), beforeHash);
    assert.equal(app.localStorageWrites.length, 0);
});

test('read-only recovery blocks all write paths and automatic backup work', async (t) => {
    const raw = '{"broken"';
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    await tracker.initialize();

    assert.throws(() => tracker.assertWritable(), /READ_ONLY_RECOVERY/);
    await assert.rejects(() => tracker.saveData(), /READ_ONLY_RECOVERY/);
    await assert.rejects(() => tracker.persistData(), /READ_ONLY_RECOVERY/);
    tracker.setupAutoBackup();
    tracker.performAutoBackup();
    await assert.rejects(() => tracker.saveBackupSettings(), /READ_ONLY_RECOVERY/);
    assert.equal(app.localStorageWrites.length, 0);
    assert.equal(app.pendingTimerCount, 0);
    assert.equal(app.readLocalStorage('assetTrackerData'), raw);
});

test('Web raw export preserves exact UTF-16LE evidence and is the only written target', async (t) => {
    const raw = `{"memo":"${String.fromCharCode(0xd800)}","transactions":[]}`;
    const expected = safety.inspectDOMString(raw);
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    let exportRequest = null;
    tracker.fileAdapter.saveFile = async (request) => {
        exportRequest = request;
        return { ok: true };
    };
    await tracker.initialize();

    await tracker.exportRawBook();

    assert.equal(exportRequest.encoding, 'base64');
    assert.deepEqual(Buffer.from(exportRequest.text, 'base64'), Buffer.from(expected.bytes));
    assert.match(app.elements.get('recovery-source-detail').textContent, /sha256-utf16le-code-units/);
    assert.equal(app.localStorageWrites.length, 0);
    assert.equal(app.readLocalStorage('assetTrackerData'), raw);
});

test('cancelled or failed Web raw export leaves source bytes and hash unchanged', async (t) => {
    for (const message of ['user cancelled', 'destination failed']) {
        await t.test(message, async (subtest) => {
            const raw = '{"broken"';
            const beforeHash = sourceHash(raw);
            const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
            subtest.after(app.dispose);
            const tracker = new app.AssetTracker();
            installCriticalRenderStubs(tracker);
            tracker.fileAdapter.saveFile = async () => { throw new Error(message); };
            await tracker.initialize();

            await assert.rejects(() => tracker.exportRawBook(), new RegExp(message));

            assert.equal(app.readLocalStorage('assetTrackerData'), raw);
            assert.equal(sourceHash(app.readLocalStorage('assetTrackerData')), beforeHash);
            assert.equal(app.localStorageWrites.length, 0);
        });
    }
});

test('native recovery export and reveal use capability-backed calls without changing evidence', async (t) => {
    const rawHash = 'b'.repeat(64);
    const app = loadAssetTracker();
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    const calls = [];
    tracker.storageAdapter = {
        supportsNative: true,
        async load() {
            return {
                protocolVersion: 2,
                loadId: 'invalid-native',
                status: 'invalidUTF8',
                stateJson: null,
                rawHash,
                hashAlgorithm: 'sha256',
                storagePath: '/fixed/AssetTrackerBook.json',
                canExportRaw: true,
                canRevealFolder: true,
                ...completeNativeLoadHealth()
            };
        }
    };
    tracker.fileAdapter.exportRawBook = async options => { calls.push({ type: 'export', options }); };
    tracker.fileAdapter.revealDataFolder = async () => { calls.push({ type: 'reveal' }); };
    await tracker.initialize();

    await tracker.exportRawBook();
    await tracker.revealStorageFolder();

    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
        { type: 'export', options: { expectedHash: rawHash, suggestedName: 'AssetTrackerBook.raw' } },
        { type: 'reveal' }
    ]);
    assert.equal(tracker.rawEvidence.rawHash, rawHash);
});

test('recoverable retry uses a fresh loadId and only valid plus render plus confirm unlocks', async (t) => {
    const corrupt = '{"broken"';
    const valid = JSON.stringify(validLegacy({ memo: 'fixed externally' }));
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: corrupt } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    tracker.setupAutoBackup = () => {};
    await tracker.initialize();
    const firstLoadId = tracker.lastLoadResult.loadId;

    app.setLocalStorage('assetTrackerData', valid);
    await tracker.retryBookLoad();

    assert.equal(tracker.lastLoadResult.status, 'valid');
    assert.notEqual(tracker.lastLoadResult.loadId, firstLoadId);
    assert.equal(tracker.data.memo, 'fixed externally');
    assert.equal(tracker.recoveryMode.active, false);
    assert.equal(tracker.appState, 'writable');
    assert.equal(app.elements.get('normal-app-shell').hidden, false);
    assert.equal(app.readLocalStorage('assetTrackerData'), valid);
});

test('retry is single-flight and successful reveal removes aria isolation and moves focus out of recovery', async (t) => {
    const corrupt = '{"broken"';
    const valid = JSON.stringify(validLegacy({ memo: 'fixed once' }));
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: corrupt } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    tracker.setupAutoBackup = () => {};
    await tracker.initialize();

    app.setLocalStorage('assetTrackerData', valid);
    const retryGate = deferred();
    const originalLoad = tracker.storageAdapter.load.bind(tracker.storageAdapter);
    let retryLoads = 0;
    tracker.storageAdapter.load = async options => {
        retryLoads += 1;
        const result = await originalLoad(options);
        await retryGate.promise;
        return result;
    };

    const firstRetry = tracker.retryBookLoad();
    const secondRetry = tracker.retryBookLoad();
    await Promise.resolve();

    assert.equal(retryLoads, 1);
    assert.equal(app.elements.get('retry-book-load-btn').disabled, true);

    retryGate.resolve();
    await Promise.all([firstRetry, secondRetry]);

    const shell = app.elements.get('normal-app-shell');
    assert.equal(shell.hidden, false);
    assert.equal(shell.inert, false);
    assert.equal(shell.hasAttribute('aria-hidden'), false);
    assert.equal(app.context.document.activeElement, app.elements.get('section-title'));
    assert.equal(app.elements.get('retry-book-load-btn').disabled, false);
    assert.equal(tracker.appState, 'writable');
});

test('retry remains locked for corrupt, unsupported, ioError, and sticky missing results', async (t) => {
    const initial = '{"broken"';
    const fixtures = [
        { value: '{"still-broken"', expected: 'corrupt' },
        { value: JSON.stringify(envelope(validLegacy(), { minimumReaderVersion: 2 })), expected: 'unsupported' },
        { value: null, expected: 'ioError' }
    ];

    for (const fixture of fixtures) {
        const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: initial } });
        t.after(app.dispose);
        const tracker = new app.AssetTracker();
        installCriticalRenderStubs(tracker);
        await tracker.initialize();
        if (fixture.value === null) {
            tracker.storageAdapter.load = async () => ({
                status: 'ioError',
                reason: 'readFailed',
                storagePath: 'localStorage',
                canExportRaw: false,
                canRevealFolder: false,
                loadId: 'retry-io'
            });
        } else {
            app.setLocalStorage('assetTrackerData', fixture.value);
        }

        await tracker.retryBookLoad();

        assert.equal(tracker.recoveryMode.active, true);
        assert.equal(tracker.recoveryMode.reason, fixture.expected);
        assertShellIsolated(app);
        assert.equal(app.localStorageWrites.length, 0);
    }

    const missingApp = loadAssetTracker({ localStorageSeed: { assetTrackerData: initial } });
    t.after(missingApp.dispose);
    const missingTracker = new missingApp.AssetTracker();
    installCriticalRenderStubs(missingTracker);
    await missingTracker.initialize();
    missingApp.setLocalStorage('assetTrackerData', null);
    await missingTracker.retryBookLoad();
    assert.equal(missingTracker.recoveryMode.active, true);
    assert.equal(missingTracker.appState, 'readOnlyRecovery');
    assertShellIsolated(missingApp);
    assert.equal(missingApp.localStorageWrites.length, 0);
});

test('retry render and validator failures preserve the corrected source under the right lock', async (t) => {
    for (const failure of ['render', 'validator']) {
        await t.test(failure, async (subtest) => {
            const initial = '{"broken"';
            const corrected = JSON.stringify(validLegacy({ memo: `retry-${failure}` }));
            const correctedHash = sourceHash(corrected);
            const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: initial } });
            subtest.after(app.dispose);
            const tracker = new app.AssetTracker();
            installCriticalRenderStubs(tracker);
            await tracker.initialize();
            app.setLocalStorage('assetTrackerData', corrected);

            if (failure === 'render') {
                tracker.renderMemo = () => { throw new Error('retry render failed'); };
            } else {
                tracker.validateRawBook = () => { throw new Error('retry validator failed'); };
            }
            await tracker.retryBookLoad();

            assert.equal(tracker.recoveryMode.reason, failure === 'render' ? 'renderError' : 'internalError');
            assert.equal(tracker.recoveryMode.terminal, failure === 'render');
            assert.equal(app.readLocalStorage('assetTrackerData'), corrected);
            assert.equal(sourceHash(app.readLocalStorage('assetTrackerData')), correctedHash);
            assert.equal(app.localStorageWrites.length, 0);
            assertShellIsolated(app);
        });
    }
});

test('terminal render/internal recovery rejects retry without a new load', async (t) => {
    const raw = JSON.stringify(validLegacy());
    const app = loadAssetTracker({ localStorageSeed: { assetTrackerData: raw } });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker, { failAt: 'renderMemo' });
    await tracker.initialize();
    let loadCalls = 0;
    tracker.storageAdapter.load = async () => { loadCalls += 1; return { status: 'missing' }; };

    await assert.rejects(() => tracker.retryBookLoad(), /TERMINAL_RECOVERY/);

    assert.equal(loadCalls, 0);
    assert.equal(tracker.recoveryMode.reason, 'renderError');
});

test('protocol-v2 load confirmation token and hashes accompany native saves', async (t) => {
    const raw = JSON.stringify(validLegacy({ memo: 'before' }));
    const rawHash = sourceHash(raw);
    const app = loadAssetTracker();
    t.after(app.dispose);
    const tracker = new app.AssetTracker();
    installCriticalRenderStubs(tracker);
    tracker.setupAutoBackup = () => {};
    const calls = [];
    tracker.storageAdapter = {
        supportsNative: true,
        async load() {
            return {
                protocolVersion: 2,
                loadId: 'load-v2',
                status: 'readableBytes',
                stateJson: raw,
                stateHash: rawHash,
                rawHash,
                hashAlgorithm: 'sha256',
                storagePath: '/tmp/book.json',
                canExportRaw: true,
                canRevealFolder: true,
                ...completeNativeLoadHealth()
            };
        },
        async confirmLoad(request) {
            calls.push({ type: 'confirm', request });
            return { ok: true, writeSessionToken: 'opaque-token' };
        },
        async save(stateJson, options) {
            calls.push({ type: 'save', stateJson, options });
            return { ok: true, stateHash: 'c'.repeat(64) };
        }
    };

    await tracker.initialize();
    tracker.data.memo = 'after';
    await tracker.saveData({ reason: 'test' });

    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
        type: 'confirm',
        request: {
            protocolVersion: 2,
            loadId: 'load-v2',
            outcome: 'valid',
            reason: null,
            validatedSourceHash: rawHash
        }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1].options)), {
        protocolVersion: 2,
        loadId: 'load-v2',
        writeSessionToken: 'opaque-token',
        expectedHash: rawHash,
        validatedSourceHash: rawHash,
        reason: 'test'
    });
});
