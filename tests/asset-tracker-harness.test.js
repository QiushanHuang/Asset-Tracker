const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createElementStub,
    loadAssetTracker
} = require('./helpers/asset-tracker-harness');

test('dispose clears every timeout and interval registered by the VM', (t) => {
    const app = loadAssetTracker();
    const timeout = app.context.setTimeout(() => {}, 60_000);
    const interval = app.context.setInterval(() => {}, 60_000);

    t.after(() => {
        app.context.clearTimeout(timeout);
        app.context.clearInterval(interval);
        app.dispose?.();
    });

    assert.equal(typeof app.dispose, 'function');
    assert.equal(app.pendingTimerCount, 2);

    app.dispose();

    assert.equal(app.pendingTimerCount, 0);
});

test('document and window remove the exact listener without affecting peers', (t) => {
    const app = loadAssetTracker();
    t.after(app.dispose);

    for (const [index, target] of [app.context.document, app.context.window].entries()) {
        const type = `remove-${index}`;
        let removedCalls = 0;
        let retainedCalls = 0;
        const removed = () => { removedCalls += 1; };
        const retained = () => { retainedCalls += 1; };

        target.addEventListener(type, removed);
        target.addEventListener(type, retained);
        target.removeEventListener(type, removed);
        target.dispatchEvent({ type });

        assert.equal(removedCalls, 0);
        assert.equal(retainedCalls, 1);
    }
});

test('document and window dispatch bind the target and report preventDefault', (t) => {
    const app = loadAssetTracker();
    t.after(app.dispose);

    for (const [index, target] of [app.context.document, app.context.window].entries()) {
        const type = `cancel-${index}`;
        let observedThis;
        let observedCurrentTarget;

        target.addEventListener(type, function(event) {
            observedThis = this;
            observedCurrentTarget = event.currentTarget;
            event.preventDefault();
        });

        assert.equal(target.dispatchEvent({ type }), false);
        assert.equal(observedThis, target);
        assert.equal(observedCurrentTarget, target);
    }
});

test('setting innerHTML clears children and detaches their parent links', () => {
    const parent = createElementStub();
    const child = createElementStub();
    parent.appendChild(child);

    parent.innerHTML = '<span>replacement</span>';

    assert.equal(parent.innerHTML, '<span>replacement</span>');
    assert.equal(parent.children.length, 0);
    assert.equal(child.parentElement, null);
});

test('setting textContent clears children and detaches their parent links', () => {
    const parent = createElementStub();
    const child = createElementStub();
    parent.appendChild(child);

    parent.textContent = 'replacement';

    assert.equal(parent.textContent, 'replacement');
    assert.equal(parent.children.length, 0);
    assert.equal(child.parentElement, null);
});

test('element attributes reflect hidden and inert DOM properties', () => {
    const element = createElementStub({
        attributes: { hidden: '', inert: '', 'aria-hidden': 'true' }
    });

    assert.equal(element.hidden, true);
    assert.equal(element.inert, true);
    element.removeAttribute('hidden');
    element.removeAttribute('inert');
    assert.equal(element.hidden, false);
    assert.equal(element.inert, false);
});

test('harness loads the legacy safety runtime and exposes mutable source observations', (t) => {
    const app = loadAssetTracker({
        localStorageSeed: { assetTrackerData: '{"memo":"before"}' }
    });
    t.after(app.dispose);

    assert.equal(typeof app.context.AssetTrackerLegacySafety.validateBookText, 'function');
    assert.equal(app.readLocalStorage('assetTrackerData'), '{"memo":"before"}');
    app.setLocalStorage('assetTrackerData', '{"memo":"after"}');
    assert.equal(app.readLocalStorage('assetTrackerData'), '{"memo":"after"}');
    app.setLocalStorage('assetTrackerData', null);
    assert.equal(app.readLocalStorage('assetTrackerData'), null);
});

test('document override receives the VM DOMContentLoaded registration', (t) => {
    const registrations = [];
    const documentOverride = {
        addEventListener(type, handler) {
            registrations.push({ type, handler });
        }
    };
    const app = loadAssetTracker({ document: documentOverride });
    t.after(app.dispose);

    assert.equal(app.context.document, documentOverride);
    assert.equal(app.context.window.document, documentOverride);
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].type, 'DOMContentLoaded');
    assert.equal(typeof registrations[0].handler, 'function');
});

test('storage override handles real production adapter reads and writes', async (t) => {
    const calls = [];
    const storageOverride = {
        getItem(key) {
            calls.push({ method: 'getItem', key });
            return '{"memo":"injected"}';
        },
        setItem(key, value) {
            calls.push({ method: 'setItem', key, value });
        },
        removeItem(key) {
            calls.push({ method: 'removeItem', key });
        }
    };
    const app = loadAssetTracker({
        storage: storageOverride,
        localStorageSeed: { assetTrackerData: '{"memo":"seed"}' }
    });
    t.after(app.dispose);
    const tracker = new app.AssetTracker();

    assert.equal(app.context.localStorage, storageOverride);
    const loaded = await tracker.storageAdapter.load();
    assert.equal(loaded.stateJson, '{"memo":"injected"}');
    const confirmation = await tracker.storageAdapter.confirmLoad({
        protocolVersion: 2,
        loadId: loaded.loadId,
        outcome: 'valid',
        reason: null,
        validatedSourceHash: loaded.rawHash
    });
    assert.equal(confirmation.ok, true);
    await tracker.storageAdapter.save('{"memo":"written"}', {
        protocolVersion: 2,
        loadId: loaded.loadId,
        writeSessionToken: confirmation.writeSessionToken,
        expectedHash: loaded.rawHash,
        validatedSourceHash: loaded.rawHash
    });
    assert.deepEqual(calls, [
        { method: 'getItem', key: 'assetTrackerData' },
        { method: 'getItem', key: 'assetTrackerData' },
        { method: 'getItem', key: 'assetTrackerData' },
        { method: 'setItem', key: 'assetTrackerData', value: '{"memo":"written"}' }
    ]);
});

test('nativeHost override receives real bridge requests through window.webkit', async (t) => {
    const requests = [];
    const nativeHost = {
        messageHandlers: {
            assetTrackerHost: {
                postMessage(request) {
                    requests.push(request);
                }
            }
        }
    };
    const app = loadAssetTracker({ nativeHost });
    t.after(app.dispose);

    assert.equal(app.context.window.webkit, nativeHost);
    const resultPromise = app.context.window.AssetTrackerHost.invoke('storage.load', {});
    assert.equal(requests.length, 1);
    app.context.window.AssetTrackerHost.__handleResponse({
        id: requests[0].id,
        ok: true,
        result: { stateJson: null }
    });
    assert.deepEqual(await resultPromise, { stateJson: null });
});

test('clock override delegates tracked timers and dispose clears their handles', (t) => {
    const calls = [];
    let sequence = 0;
    const clock = {
        setTimeout(callback, delay, ...args) {
            const handle = { kind: 'timeout', id: ++sequence };
            calls.push({ method: 'setTimeout', handle, callback, delay, args });
            return handle;
        },
        clearTimeout(handle) {
            calls.push({ method: 'clearTimeout', handle });
        },
        setInterval(callback, delay, ...args) {
            const handle = { kind: 'interval', id: ++sequence };
            calls.push({ method: 'setInterval', handle, callback, delay, args });
            return handle;
        },
        clearInterval(handle) {
            calls.push({ method: 'clearInterval', handle });
        }
    };
    const app = loadAssetTracker({ clock });
    t.after(app.dispose);

    const timeout = app.context.setTimeout(() => {}, 125, 'timeout-arg');
    const interval = app.context.setInterval(() => {}, 250, 'interval-arg');
    assert.equal(app.pendingTimerCount, 2);

    app.dispose();

    assert.equal(app.pendingTimerCount, 0);
    assert.deepEqual(calls.map(call => call.method), [
        'setTimeout',
        'setInterval',
        'clearTimeout',
        'clearInterval'
    ]);
    assert.equal(calls[0].handle, timeout);
    assert.equal(calls[0].delay, 125);
    assert.deepEqual(calls[0].args, ['timeout-arg']);
    assert.equal(calls[1].handle, interval);
    assert.equal(calls[1].delay, 250);
    assert.deepEqual(calls[1].args, ['interval-arg']);
    assert.equal(calls[2].handle, timeout);
    assert.equal(calls[3].handle, interval);
});

test('nativeHandler compatibility alias keeps bridgeRequests observation', async (t) => {
    const app = loadAssetTracker({ nativeHandler() {} });
    t.after(app.dispose);

    const resultPromise = app.context.window.AssetTrackerHost.invoke('storage.load', {});
    assert.equal(app.bridgeRequests.length, 1);
    app.context.window.AssetTrackerHost.__handleResponse({
        id: app.bridgeRequests[0].id,
        ok: true,
        result: { stateJson: null }
    });
    assert.deepEqual(await resultPromise, { stateJson: null });
});
