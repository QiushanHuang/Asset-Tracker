const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

function createEvent(event, currentTarget) {
    const source = typeof event === 'string' ? { type: event } : event;
    let defaultPrevented = Boolean(source.defaultPrevented);

    return {
        ...source,
        type: source.type,
        target: source.target || currentTarget,
        currentTarget,
        get defaultPrevented() {
            return defaultPrevented;
        },
        preventDefault() {
            defaultPrevented = true;
            if (typeof source.preventDefault === 'function') {
                source.preventDefault();
            }
        }
    };
}

function matchesSelector(element, selector) {
    const candidate = selector.trim();
    if (!candidate) {
        return false;
    }

    if (candidate.startsWith('#')) {
        return element.id === candidate.slice(1);
    }

    if (candidate.startsWith('.')) {
        return element.classList.contains(candidate.slice(1));
    }

    const attributeMatch = candidate.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
    if (attributeMatch) {
        const [, name, expectedValue] = attributeMatch;
        return expectedValue === undefined
            ? element.hasAttribute(name)
            : element.getAttribute(name) === expectedValue;
    }

    return element.tagName.toLowerCase() === candidate.toLowerCase();
}

function createElementStub(initial = {}) {
    const attributes = new Map();
    const classes = new Set(String(initial.className || '').split(/\s+/).filter(Boolean));
    const listeners = new Map();
    const children = [];
    let parentElement = null;
    let textContent = initial.textContent ?? '';
    let innerHTML = initial.innerHTML ?? '';

    const detachChildren = () => {
        children.forEach(child => child.__setParent(null));
        children.length = 0;
    };

    const element = {
        tagName: String(initial.tagName || 'div').toUpperCase(),
        hidden: Boolean(initial.hidden),
        inert: Boolean(initial.inert),
        value: initial.value ?? '',
        checked: Boolean(initial.checked),
        disabled: Boolean(initial.disabled),
        style: { ...(initial.style || {}) },
        files: initial.files || [],
        dataset: { ...(initial.dataset || {}) },
        children,
        childNodes: children,
        get parentElement() {
            return parentElement;
        },
        get parentNode() {
            return parentElement;
        },
        classList: {
            add(...tokens) {
                tokens.forEach(token => classes.add(token));
            },
            remove(...tokens) {
                tokens.forEach(token => classes.delete(token));
            },
            contains(token) {
                return classes.has(token);
            },
            toggle(token, force) {
                const shouldAdd = force === undefined ? !classes.has(token) : Boolean(force);
                if (shouldAdd) {
                    classes.add(token);
                } else {
                    classes.delete(token);
                }
                return shouldAdd;
            }
        },
        setAttribute(name, value) {
            const stringValue = String(value);
            attributes.set(name, stringValue);
            if (name === 'id') {
                this.id = stringValue;
            } else if (name === 'class') {
                this.className = stringValue;
            } else if (name === 'hidden') {
                this.hidden = true;
            } else if (name === 'inert') {
                this.inert = true;
            } else if (name.startsWith('data-')) {
                const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
                this.dataset[key] = stringValue;
            }
        },
        getAttribute(name) {
            if (name === 'id' && this.id) {
                return this.id;
            }
            if (name === 'class') {
                return this.className || null;
            }
            return attributes.has(name) ? attributes.get(name) : null;
        },
        hasAttribute(name) {
            return this.getAttribute(name) !== null;
        },
        removeAttribute(name) {
            attributes.delete(name);
            if (name === 'id') {
                this.id = '';
            } else if (name === 'class') {
                this.className = '';
            } else if (name === 'hidden') {
                this.hidden = false;
            } else if (name === 'inert') {
                this.inert = false;
            }
        },
        addEventListener(type, handler) {
            if (!listeners.has(type)) {
                listeners.set(type, new Set());
            }
            listeners.get(type).add(handler);
        },
        removeEventListener(type, handler) {
            listeners.get(type)?.delete(handler);
        },
        dispatchEvent(event) {
            const dispatched = createEvent(event, this);
            for (const handler of listeners.get(dispatched.type) || []) {
                handler.call(this, dispatched);
            }
            return !dispatched.defaultPrevented;
        },
        appendChild(child) {
            if (child.parentElement) {
                child.parentElement.removeChild(child);
            }
            children.push(child);
            child.__setParent(this);
            initial.onAppendChild?.(child);
            return child;
        },
        removeChild(child) {
            const index = children.indexOf(child);
            if (index !== -1) {
                children.splice(index, 1);
                child.__setParent(null);
            }
            return child;
        },
        contains(candidate) {
            return candidate === this || children.some(child => child.contains(candidate));
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        querySelectorAll(selector) {
            const matches = [];
            const visit = (node) => {
                if (matchesSelector(node, selector)) {
                    matches.push(node);
                }
                node.children.forEach(visit);
            };
            children.forEach(visit);
            return matches;
        },
        focus() {
            initial.onFocus?.(this);
        },
        click() {
            this.dispatchEvent({ type: 'click' });
        },
        remove() {
            parentElement?.removeChild(this);
            initial.onRemove?.(this);
        },
        __setParent(parent) {
            parentElement = parent;
        }
    };

    Object.defineProperty(element, 'className', {
        enumerable: true,
        get() {
            return Array.from(classes).join(' ');
        },
        set(value) {
            classes.clear();
            String(value || '').split(/\s+/).filter(Boolean).forEach(token => classes.add(token));
        }
    });

    Object.defineProperties(element, {
        innerHTML: {
            enumerable: true,
            get() {
                return innerHTML;
            },
            set(value) {
                innerHTML = String(value ?? '');
                detachChildren();
            }
        },
        textContent: {
            enumerable: true,
            get() {
                return textContent;
            },
            set(value) {
                textContent = String(value ?? '');
                detachChildren();
            }
        }
    });

    element.id = initial.id || '';
    for (const [name, value] of Object.entries(initial.attributes || {})) {
        element.setAttribute(name, value);
    }

    return element;
}

function loadAssetTracker({
    document: documentOverride = null,
    storage: storageOverride = null,
    nativeHost = null,
    clock = null,
    localStorageSeed = {},
    nativeHandler = null,
    lockManager = null,
    confirmResult = true,
    receiverSensitiveTimers = false
} = {}) {
    const scriptPath = path.join(__dirname, '..', '..', 'script.js');
    const safetyPath = path.join(__dirname, '..', '..', 'legacy-safety.js');
    const safetyContent = fs.readFileSync(safetyPath, 'utf8');
    const scriptContent = fs.readFileSync(scriptPath, 'utf8');
    const domEvents = {};
    const windowEvents = {};
    const elements = new Map();
    const localStorageValues = new Map(
        Object.entries(localStorageSeed).map(([key, value]) => [String(key), String(value)])
    );
    const localStorageWrites = [];
    const bridgeRequests = [];
    const messages = [];
    const pendingTimeouts = new Set();
    const pendingIntervals = new Set();
    const timerDelegate = clock ?? {
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    };
    let activeElement = null;

    const trackedSetTimeout = (callback, delay, ...args) => {
        let timer;
        timer = timerDelegate.setTimeout((...callbackArgs) => {
            pendingTimeouts.delete(timer);
            callback(...callbackArgs);
        }, delay, ...args);
        pendingTimeouts.add(timer);
        return timer;
    };

    const trackedClearTimeout = (timer) => {
        pendingTimeouts.delete(timer);
        timerDelegate.clearTimeout(timer);
    };

    const trackedSetInterval = (callback, delay, ...args) => {
        const timer = timerDelegate.setInterval(callback, delay, ...args);
        pendingIntervals.add(timer);
        return timer;
    };

    const trackedClearInterval = (timer) => {
        pendingIntervals.delete(timer);
        timerDelegate.clearInterval(timer);
    };

    const dispose = () => {
        pendingTimeouts.forEach(timer => timerDelegate.clearTimeout(timer));
        pendingIntervals.forEach(timer => timerDelegate.clearInterval(timer));
        pendingTimeouts.clear();
        pendingIntervals.clear();
    };

    const eventTarget = (handlers) => {
        const listeners = new Map();

        const dispatch = (target, event) => {
            const dispatched = createEvent(event, target);
            for (const handler of Array.from(listeners.get(dispatched.type) || [])) {
                handler.call(target, dispatched);
            }
            return !dispatched.defaultPrevented;
        };

        return {
            addEventListener(type, handler) {
                if (!listeners.has(type)) {
                    listeners.set(type, new Set());
                }
                listeners.get(type).add(handler);
                const target = this;
                handlers[type] = (event = { type }) => dispatch(target, event);
            },
            removeEventListener(type, handler) {
                const typeListeners = listeners.get(type);
                typeListeners?.delete(handler);
                if (typeListeners?.size === 0) {
                    listeners.delete(type);
                    delete handlers[type];
                }
            },
            dispatchEvent(event) {
                return dispatch(this, event);
            }
        };
    };

    const makeElement = (initial = {}) => createElementStub({
        ...initial,
        onFocus(element) {
            activeElement = element;
        }
    });

    const body = makeElement({
        tagName: 'body',
        onAppendChild(element) {
            if (element.classList.contains('message')) {
                const type = element.className.split(/\s+/).find(token => token !== 'message') || 'success';
                messages.push({ text: element.textContent, type, element });
            }
        }
    });

    const defaultDocument = {
        ...eventTarget(domEvents),
        body,
        createElement(tagName) {
            return makeElement({ tagName });
        },
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, makeElement({ id }));
            }
            return elements.get(id);
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        querySelectorAll(selector) {
            const candidates = new Set([body, ...elements.values()]);
            const visit = (element) => {
                candidates.add(element);
                element.children.forEach(visit);
            };
            [body, ...elements.values()].forEach(visit);
            return Array.from(candidates).filter(element => matchesSelector(element, selector));
        },
        get activeElement() {
            return activeElement;
        }
    };
    const vmDocument = documentOverride ?? defaultDocument;

    const observedNativeHandler = nativeHandler
        ? {
            postMessage(request) {
                bridgeRequests.push(request);
                return typeof nativeHandler === 'function'
                    ? nativeHandler(request)
                    : nativeHandler.postMessage(request);
            }
        }
        : null;
    const observedNativeHost = observedNativeHandler
        ? { messageHandlers: { assetTrackerHost: observedNativeHandler } }
        : null;

    const defaultStorage = {
        getItem(key) {
            const storageKey = String(key);
            return localStorageValues.has(storageKey) ? localStorageValues.get(storageKey) : null;
        },
        setItem(key, value) {
            const write = { key: String(key), value: String(value) };
            localStorageWrites.push(write);
            localStorageValues.set(write.key, write.value);
        },
        removeItem(key) {
            const storageKey = String(key);
            localStorageWrites.push({ key: storageKey, value: null });
            localStorageValues.delete(storageKey);
        },
        clear() {
            localStorageValues.clear();
        }
    };
    const vmStorage = storageOverride ?? defaultStorage;

    const window = {
        ...eventTarget(windowEvents),
        setTimeout: trackedSetTimeout,
        clearTimeout: trackedClearTimeout,
        setInterval: trackedSetInterval,
        clearInterval: trackedClearInterval,
        webkit: nativeHost ?? observedNativeHost,
        navigator: { locks: lockManager },
        confirm(...args) {
            return typeof confirmResult === 'function' ? confirmResult(...args) : Boolean(confirmResult);
        }
    };

    const context = {
        console,
        setTimeout: trackedSetTimeout,
        clearTimeout: trackedClearTimeout,
        setInterval: trackedSetInterval,
        clearInterval: trackedClearInterval,
        TextDecoder,
        Blob,
        Event,
        queueMicrotask,
        atob: (value) => Buffer.from(value, 'base64').toString('binary'),
        btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
        localStorage: vmStorage,
        navigator: window.navigator,
        window,
        document: vmDocument,
        confirm: window.confirm
    };

    window.window = window;
    window.document = vmDocument;
    window.URL = {
        createObjectURL() { return 'blob://test'; },
        revokeObjectURL() {}
    };
    context.URL = window.URL;

    vm.createContext(context);
    if (receiverSensitiveTimers) {
        context.__trackedSetTimeout = trackedSetTimeout;
        context.__trackedClearTimeout = trackedClearTimeout;
        context.__trackedSetInterval = trackedSetInterval;
        context.__trackedClearInterval = trackedClearInterval;
        vm.runInContext(`
            globalThis.setTimeout = window.setTimeout = function (...args) {
                if (this !== globalThis && this !== window) {
                    throw new TypeError('Can only call Window.setTimeout on instances of Window');
                }
                return globalThis.__trackedSetTimeout(...args);
            };
            globalThis.clearTimeout = window.clearTimeout = function (...args) {
                if (this !== globalThis && this !== window) {
                    throw new TypeError('Can only call Window.clearTimeout on instances of Window');
                }
                return globalThis.__trackedClearTimeout(...args);
            };
            globalThis.setInterval = window.setInterval = function (...args) {
                if (this !== globalThis && this !== window) {
                    throw new TypeError('Can only call Window.setInterval on instances of Window');
                }
                return globalThis.__trackedSetInterval(...args);
            };
            globalThis.clearInterval = window.clearInterval = function (...args) {
                if (this !== globalThis && this !== window) {
                    throw new TypeError('Can only call Window.clearInterval on instances of Window');
                }
                return globalThis.__trackedClearInterval(...args);
            };
        `, context);
    }
    vm.runInContext(`${safetyContent}\n${scriptContent}\n;globalThis.__AssetTracker = AssetTracker;`, context);

    return {
        AssetTracker: context.__AssetTracker,
        elements,
        domEvents,
        windowEvents,
        localStorageWrites,
        bridgeRequests,
        messages,
        deferred,
        dispose,
        readLocalStorage(key) {
            const storageKey = String(key);
            return localStorageValues.has(storageKey) ? localStorageValues.get(storageKey) : null;
        },
        setLocalStorage(key, value) {
            const storageKey = String(key);
            if (value === null || value === undefined) {
                localStorageValues.delete(storageKey);
            } else {
                localStorageValues.set(storageKey, String(value));
            }
        },
        get pendingTimerCount() {
            return pendingTimeouts.size + pendingIntervals.size;
        },
        context
    };
}

module.exports = {
    createElementStub,
    deferred,
    loadAssetTracker
};
