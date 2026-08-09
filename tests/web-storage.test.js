const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAssetTracker } = require('./helpers/asset-tracker-harness');

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
            transactions: [{ id: 't1' }]
        }
    });

    const parsedEnvelope = tracker.parseBookPayload(bookEnvelope);
    assert.equal(parsedEnvelope.source, 'book-package');
    assert.equal(parsedEnvelope.payload.transactions[0].id, 't1');

    const legacyJson = JSON.stringify({
        memo: 'legacy',
        transactions: [{ id: 'legacy-1' }]
    });

    const parsedLegacy = tracker.parseBookPayload(legacyJson);
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
