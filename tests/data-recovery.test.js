const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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
                canRevealFolder: true
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
                canRevealFolder: true
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
                    canRevealFolder: true
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
                                canRevealFolder: true
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
                                canRevealFolder: true
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
                                        canRevealFolder: true
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
                canRevealFolder: true
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
                                            canRevealFolder: true
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
                    canRevealFolder: true
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
                canRevealFolder: true
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
                canRevealFolder: true
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
