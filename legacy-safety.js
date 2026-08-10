(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AssetTrackerLegacySafety = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function build() {
    'use strict';

    const BOOK_FORMAT = 'qiushan.asset-book';
    const SUPPORTED_VERSION = 1;
    const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const LEGACY_ROOT_FIELDS = new Set([
        'categories',
        'transactions',
        'automationRules',
        'purposeCategories',
        'initialAssets',
        'settings',
        'memo',
        'transactionTemplates'
    ]);
    const VERSION_FIELDS = [
        'formatVersion',
        'schemaVersion',
        'domainCapabilityVersion',
        'minimumReaderVersion'
    ];
    const AUTOMATION_FREQUENCIES = new Set(['daily', 'weekly', 'monthly', 'yearly']);
    const IntrinsicPromise = Promise;
    const intrinsicPromiseResolve = Promise.resolve.bind(Promise);
    const intrinsicObjectFreeze = Object.freeze;
    const intrinsicReflectGet = Reflect.get;
    const QUEUE_OPTION_FIELDS = intrinsicObjectFreeze([
        'write',
        'snapshot',
        'terminalize',
        'sessionContext',
        'initialAcknowledged',
        'initialRecoveryHealth',
        'expectedDurability',
        'durabilityDeadlineMs',
        'barrierDeadlineMs',
        'transportDeadlineMs',
        'generationToken',
        'clock',
        'onTransition',
        'onAcknowledged',
        'onFault'
    ]);
    const SESSION_CONTEXT_FIELDS = intrinsicObjectFreeze([
        'protocolVersion',
        'loadId',
        'writeSessionToken'
    ]);
    const INITIAL_ACKNOWLEDGED_FIELDS = intrinsicObjectFreeze([
        'stateJson',
        'stateHash'
    ]);
    const INITIAL_RECOVERY_HEALTH_FIELDS = intrinsicObjectFreeze([
        'ordinary',
        'snapshot'
    ]);
    const RECOVERY_HEALTH_FIELDS = intrinsicObjectFreeze([
        'domain',
        'status',
        'auditComplete',
        'code',
        'maintenancePendingCount',
        'detail'
    ]);
    const CLOCK_FIELDS = intrinsicObjectFreeze([
        'setTimeout',
        'clearTimeout'
    ]);

    class AssetTrackerSaveError extends Error {}
    class AssetTrackerSnapshotError extends Error {}
    class AssetTrackerQueueAbortError extends Error {}
    class AssetTrackerQueueHaltedError extends Error {}
    class AssetTrackerQueueCallbackError extends Error {}

    function canonicalDeepFrozenCopy(value) {
        if (value === null || typeof value !== 'object') return value;

        const copy = Array.isArray(value) ? [] : {};
        for (const key of Object.keys(value)) {
            copy[key] = canonicalDeepFrozenCopy(intrinsicReflectGet(value, key));
        }
        return intrinsicObjectFreeze(copy);
    }

    function requireFunction(value, field) {
        if (typeof value !== 'function') {
            throw new TypeError(`Queue ${field} must be a function`);
        }
        return value;
    }

    function extractAllowedFields(source, fields, label) {
        if (!isRecord(source)) throw new TypeError(`Queue ${label} must be an object`);

        const extracted = Object.create(null);
        for (const field of fields) {
            try {
                extracted[field] = intrinsicReflectGet(source, field);
            } catch (error) {
                throw new TypeError(`Queue ${label}.${field} could not be read`, { cause: error });
            }
        }
        return intrinsicObjectFreeze(extracted);
    }

    function extractQueueOptionGraph(options) {
        const values = extractAllowedFields(options, QUEUE_OPTION_FIELDS, 'options');
        const sessionContext = extractAllowedFields(
            values.sessionContext,
            SESSION_CONTEXT_FIELDS,
            'sessionContext'
        );
        const initialAcknowledged = extractAllowedFields(
            values.initialAcknowledged,
            INITIAL_ACKNOWLEDGED_FIELDS,
            'initialAcknowledged'
        );
        const initialRecoveryHealth = extractAllowedFields(
            values.initialRecoveryHealth,
            INITIAL_RECOVERY_HEALTH_FIELDS,
            'initialRecoveryHealth'
        );
        const ordinaryRecoveryHealth = extractAllowedFields(
            initialRecoveryHealth.ordinary,
            RECOVERY_HEALTH_FIELDS,
            'initialRecoveryHealth.ordinary'
        );
        const snapshotRecoveryHealth = extractAllowedFields(
            initialRecoveryHealth.snapshot,
            RECOVERY_HEALTH_FIELDS,
            'initialRecoveryHealth.snapshot'
        );
        const clock = extractAllowedFields(values.clock, CLOCK_FIELDS, 'clock');

        return {
            values,
            sessionContext,
            initialAcknowledged,
            ordinaryRecoveryHealth,
            snapshotRecoveryHealth,
            clock
        };
    }

    function copySessionContext(value) {
        if (!isRecord(value)
            || value.protocolVersion !== 2
            || typeof value.loadId !== 'string'
            || value.loadId.length === 0
            || typeof value.writeSessionToken !== 'string'
            || value.writeSessionToken.length === 0) {
            throw new TypeError('Queue sessionContext is invalid');
        }

        return intrinsicObjectFreeze({
            protocolVersion: 2,
            loadId: value.loadId,
            writeSessionToken: value.writeSessionToken
        });
    }

    function copyInitialAcknowledged(value) {
        if (!isRecord(value) || typeof value.stateJson !== 'string') {
            throw new TypeError('Queue initialAcknowledged is invalid');
        }
        if (value.stateHash !== null
            && (typeof value.stateHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.stateHash))) {
            throw new TypeError('Queue initialAcknowledged stateHash is invalid');
        }

        return intrinsicObjectFreeze({
            stateJson: value.stateJson,
            stateHash: value.stateHash
        });
    }

    function copyRecoveryHealth(value, expectedDomain) {
        const requiredFields = [
            'domain',
            'status',
            'auditComplete',
            'code',
            'maintenancePendingCount',
            'detail'
        ];
        if (!isRecord(value)
            || requiredFields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
            || value.domain !== expectedDomain
            || !['healthy', 'degraded', 'not-applicable'].includes(value.status)
            || typeof value.auditComplete !== 'boolean'
            || !Number.isInteger(value.maintenancePendingCount)
            || value.maintenancePendingCount < 0
            || (value.detail !== null && typeof value.detail !== 'string')) {
            throw new TypeError(`Queue ${expectedDomain} recovery health is invalid`);
        }

        const isDegraded = value.status === 'degraded';
        if ((isDegraded && (typeof value.code !== 'string' || value.code.length === 0))
            || (!isDegraded && value.code !== null)
            || (!isDegraded && value.auditComplete !== true)
            || (!isDegraded && value.maintenancePendingCount !== 0)) {
            throw new TypeError(`Queue ${expectedDomain} recovery health is contradictory`);
        }

        return intrinsicObjectFreeze({
            domain: value.domain,
            status: value.status,
            auditComplete: value.auditComplete,
            code: value.code,
            maintenancePendingCount: value.maintenancePendingCount,
            detail: value.detail
        });
    }

    function validateDeadline(value, field) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new TypeError(`Queue ${field} deadline must be positive`);
        }
        return value;
    }

    function validateAndFreezeQueueOptions(options) {
        const extraction = extractQueueOptionGraph(options);
        const values = extraction.values;
        const transportDeadlineMs = validateDeadline(values.transportDeadlineMs, 'transport');
        const durabilityDeadlineMs = validateDeadline(values.durabilityDeadlineMs, 'durability');
        const barrierDeadlineMs = validateDeadline(values.barrierDeadlineMs, 'barrier');
        if (durabilityDeadlineMs >= transportDeadlineMs) {
            throw new TypeError('Queue durability deadline must be shorter than transport deadline');
        }
        if (barrierDeadlineMs >= transportDeadlineMs) {
            throw new TypeError('Queue barrier deadline must be shorter than transport deadline');
        }
        if (!['browser-local-committed', 'native-durable'].includes(values.expectedDurability)) {
            throw new TypeError('Queue expectedDurability is invalid');
        }
        if (values.generationToken === undefined) {
            throw new TypeError('Queue generationToken is required');
        }

        const sessionContext = copySessionContext(extraction.sessionContext);
        const initialAcknowledged = copyInitialAcknowledged(extraction.initialAcknowledged);
        const initialRecoveryHealth = intrinsicObjectFreeze({
            ordinary: copyRecoveryHealth(extraction.ordinaryRecoveryHealth, 'ordinary'),
            snapshot: copyRecoveryHealth(extraction.snapshotRecoveryHealth, 'snapshot')
        });
        const clock = intrinsicObjectFreeze({
            setTimeout: requireFunction(extraction.clock.setTimeout, 'clock.setTimeout'),
            clearTimeout: requireFunction(extraction.clock.clearTimeout, 'clock.clearTimeout')
        });

        return intrinsicObjectFreeze({
            write: requireFunction(values.write, 'write'),
            snapshot: requireFunction(values.snapshot, 'snapshot'),
            terminalize: requireFunction(values.terminalize, 'terminalize'),
            sessionContext,
            initialAcknowledged,
            initialRecoveryHealth,
            expectedDurability: values.expectedDurability,
            durabilityDeadlineMs,
            barrierDeadlineMs,
            transportDeadlineMs,
            generationToken: values.generationToken,
            clock,
            onTransition: requireFunction(values.onTransition, 'onTransition'),
            onAcknowledged: requireFunction(values.onAcknowledged, 'onAcknowledged'),
            onFault: requireFunction(values.onFault, 'onFault')
        });
    }

    function createInitialQueueState(configuration) {
        return canonicalDeepFrozenCopy({
            generationToken: configuration.generationToken,
            lanePhase: 'idle',
            primaryStatus: 'none',
            barrierState: 'none',
            activeClientSaveId: null,
            activeClientSnapshotId: null,
            pendingCount: 0,
            lastAcknowledgedHash: configuration.initialAcknowledged.stateHash,
            ordinaryRecoveryHealth: configuration.initialRecoveryHealth.ordinary,
            snapshotRecoveryHealth: configuration.initialRecoveryHealth.snapshot,
            accepting: true,
            halted: false
        });
    }

    class AssetTrackerSaveQueue {
        constructor(options) {
            const configuration = validateAndFreezeQueueOptions(options);
            this.queueConfiguration = configuration;
            this.queueState = createInitialQueueState(configuration);
        }

        getState() {
            return canonicalDeepFrozenCopy(this.queueState);
        }
    }

    function rotateRight(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
    }

    function sha256Hex(inputBytes) {
        const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
        const bitLength = bytes.length * 8;
        const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
        const padded = new Uint8Array(paddedLength);
        padded.set(bytes);
        padded[bytes.length] = 0x80;

        const highBits = Math.floor(bitLength / 0x100000000);
        const lowBits = bitLength >>> 0;
        const view = new DataView(padded.buffer);
        view.setUint32(paddedLength - 8, highBits, false);
        view.setUint32(paddedLength - 4, lowBits, false);

        const constants = new Uint32Array([
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
            0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
            0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
            0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
            0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
            0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
            0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
            0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
            0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ]);
        const state = new Uint32Array([
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
        ]);
        const words = new Uint32Array(64);

        for (let offset = 0; offset < padded.length; offset += 64) {
            for (let index = 0; index < 16; index += 1) {
                words[index] = view.getUint32(offset + index * 4, false);
            }
            for (let index = 16; index < 64; index += 1) {
                const word15 = words[index - 15];
                const word2 = words[index - 2];
                const sigma0 = rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
                const sigma1 = rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
                words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
            }

            let a = state[0];
            let b = state[1];
            let c = state[2];
            let d = state[3];
            let e = state[4];
            let f = state[5];
            let g = state[6];
            let h = state[7];

            for (let index = 0; index < 64; index += 1) {
                const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
                const choose = (e & f) ^ (~e & g);
                const temp1 = (h + sum1 + choose + constants[index] + words[index]) >>> 0;
                const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
                const majority = (a & b) ^ (a & c) ^ (b & c);
                const temp2 = (sum0 + majority) >>> 0;
                h = g;
                g = f;
                f = e;
                e = (d + temp1) >>> 0;
                d = c;
                c = b;
                b = a;
                a = (temp1 + temp2) >>> 0;
            }

            state[0] = (state[0] + a) >>> 0;
            state[1] = (state[1] + b) >>> 0;
            state[2] = (state[2] + c) >>> 0;
            state[3] = (state[3] + d) >>> 0;
            state[4] = (state[4] + e) >>> 0;
            state[5] = (state[5] + f) >>> 0;
            state[6] = (state[6] + g) >>> 0;
            state[7] = (state[7] + h) >>> 0;
        }

        return Array.from(state, word => word.toString(16).padStart(8, '0')).join('');
    }

    function hasUnpairedSurrogate(text) {
        for (let index = 0; index < text.length; index += 1) {
            const codeUnit = text.charCodeAt(index);
            if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
                const next = text.charCodeAt(index + 1);
                if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
                index += 1;
            } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
                return true;
            }
        }
        return false;
    }

    function encodeUTF8(text) {
        const bytes = [];
        for (const symbol of text) {
            const point = symbol.codePointAt(0);
            if (point <= 0x7f) {
                bytes.push(point);
            } else if (point <= 0x7ff) {
                bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f));
            } else if (point <= 0xffff) {
                bytes.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f));
            } else {
                bytes.push(
                    0xf0 | (point >>> 18),
                    0x80 | ((point >>> 12) & 0x3f),
                    0x80 | ((point >>> 6) & 0x3f),
                    0x80 | (point & 0x3f)
                );
            }
        }
        return new Uint8Array(bytes);
    }

    function encodeUTF16LECodeUnits(text) {
        const bytes = new Uint8Array(text.length * 2);
        for (let index = 0; index < text.length; index += 1) {
            const codeUnit = text.charCodeAt(index);
            bytes[index * 2] = codeUnit & 0xff;
            bytes[index * 2 + 1] = codeUnit >>> 8;
        }
        return bytes;
    }

    function inspectDOMString(value) {
        const text = String(value);
        const losslessUTF16 = hasUnpairedSurrogate(text);
        const bytes = losslessUTF16 ? encodeUTF16LECodeUnits(text) : encodeUTF8(text);
        return Object.freeze({
            text,
            bytes,
            rawHash: sha256Hex(bytes),
            hashAlgorithm: losslessUTF16 ? 'sha256-utf16le-code-units' : 'sha256-utf8',
            encoding: losslessUTF16 ? 'utf-16le-code-units' : 'utf-8',
            isWellFormed: !losslessUTF16
        });
    }

    function isRecord(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function issue(issues, path, code, message) {
        issues.push({ path, code, message });
    }

    function validateNoDangerousKeys(root, issues) {
        const stack = [{ value: root, path: '$' }];
        while (stack.length > 0) {
            const { value, path } = stack.pop();
            if (!value || typeof value !== 'object') continue;
            for (const key of Object.keys(value)) {
                const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
                if (DANGEROUS_KEYS.has(key)) {
                    issue(issues, childPath, 'dangerous-key', `Unsafe object key: ${key}`);
                } else {
                    stack.push({ value: value[key], path: childPath });
                }
            }
        }
    }

    function validateNoUnpairedSurrogates(root, issues) {
        const stack = [{ value: root, path: '$' }];
        while (stack.length > 0) {
            const { value, path } = stack.pop();
            if (typeof value === 'string') {
                if (hasUnpairedSurrogate(value)) {
                    issue(issues, path, 'unpaired-surrogate', 'String contains an unpaired UTF-16 surrogate');
                }
                continue;
            }
            if (!value || typeof value !== 'object') continue;
            for (const key of Object.keys(value)) {
                const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`;
                if (hasUnpairedSurrogate(key)) {
                    issue(issues, childPath, 'unpaired-surrogate', 'Object key contains an unpaired UTF-16 surrogate');
                }
                stack.push({ value: value[key], path: childPath });
            }
        }
    }

    function validateStringIfPresent(object, key, path, issues, { allowNull = false } = {}) {
        if (!Object.prototype.hasOwnProperty.call(object, key)) return;
        const value = object[key];
        if ((allowNull && value === null) || typeof value === 'string') return;
        issue(issues, `${path}.${key}`, 'invalid-type', 'Expected a string');
    }

    function validateBooleanIfPresent(object, key, path, issues) {
        if (Object.prototype.hasOwnProperty.call(object, key) && typeof object[key] !== 'boolean') {
            issue(issues, `${path}.${key}`, 'invalid-type', 'Expected a boolean');
        }
    }

    function validateFiniteIfPresent(object, key, path, issues, { positive = false } = {}) {
        if (!Object.prototype.hasOwnProperty.call(object, key)) return;
        const value = object[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
            issue(issues, `${path}.${key}`, 'invalid-number', positive ? 'Expected a positive finite number' : 'Expected a finite number');
        }
    }

    function requireString(object, key, path, issues) {
        if (!Object.prototype.hasOwnProperty.call(object, key)) {
            issue(issues, `${path}.${key}`, 'missing-field', 'Required string is missing');
            return;
        }
        validateStringIfPresent(object, key, path, issues);
    }

    function requireFinite(object, key, path, issues) {
        if (!Object.prototype.hasOwnProperty.call(object, key)) {
            issue(issues, `${path}.${key}`, 'missing-field', 'Required finite number is missing');
            return;
        }
        validateFiniteIfPresent(object, key, path, issues);
    }

    function requireDate(object, key, path, issues) {
        if (!Object.prototype.hasOwnProperty.call(object, key)) {
            issue(issues, `${path}.${key}`, 'missing-field', 'Required calendar date is missing');
            return;
        }
        validateDateIfPresent(object, key, path, issues);
    }

    function isLeapYear(year) {
        return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    }

    function isRealCalendarDay(year, month, day) {
        if (month < 1 || month > 12 || day < 1) return false;
        const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return day <= monthLengths[month - 1];
    }

    function isValidCalendarValue(value) {
        if (typeof value !== 'string') return false;
        const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateOnly) {
            return isRealCalendarDay(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
        }

        const dateTime = value.match(
            /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?(?:(Z)|([+-])(\d{2}):(\d{2}))?$/
        );
        if (!dateTime) return false;

        const year = Number(dateTime[1]);
        const month = Number(dateTime[2]);
        const day = Number(dateTime[3]);
        const hour = Number(dateTime[4]);
        const minute = Number(dateTime[5]);
        const second = dateTime[6] === undefined ? 0 : Number(dateTime[6]);
        if (!isRealCalendarDay(year, month, day)) return false;
        if (hour > 23 || minute > 59 || second > 59) return false;
        if (dateTime[9] !== undefined) {
            const offsetHour = Number(dateTime[10]);
            const offsetMinute = Number(dateTime[11]);
            if (offsetHour > 23 || offsetMinute > 59) return false;
        }
        return true;
    }

    function validateDateIfPresent(object, key, path, issues, { allowEmpty = false, allowNull = false } = {}) {
        if (!Object.prototype.hasOwnProperty.call(object, key)) return;
        const value = object[key];
        if ((allowEmpty && value === '') || (allowNull && value === null)) return;
        if (!isValidCalendarValue(value)) {
            issue(issues, `${path}.${key}`, 'invalid-date', 'Expected a real calendar date');
        }
    }

    function validateObjectArray(value, path, issues, validateItem) {
        if (!Array.isArray(value)) {
            issue(issues, path, 'invalid-type', 'Expected an array');
            return;
        }
        value.forEach((item, index) => {
            const itemPath = `${path}[${index}]`;
            if (!isRecord(item)) {
                issue(issues, itemPath, 'invalid-type', 'Expected an object');
                return;
            }
            validateItem(item, itemPath, issues);
        });
    }

    function validateCategoryMap(categories, path, issues) {
        if (!isRecord(categories)) {
            issue(issues, path, 'invalid-type', 'Expected a category object');
            return;
        }
        for (const [key, category] of Object.entries(categories)) {
            const categoryPath = `${path}.${key}`;
            if (!isRecord(category)) {
                issue(issues, categoryPath, 'invalid-type', 'Expected a category record');
                continue;
            }
            requireString(category, 'id', categoryPath, issues);
            requireString(category, 'name', categoryPath, issues);
            validateFiniteIfPresent(category, 'balance', categoryPath, issues);
            validateStringIfPresent(category, 'currency', categoryPath, issues);
            validateBooleanIfPresent(category, 'isDebt', categoryPath, issues);
            validateBooleanIfPresent(category, 'collapsed', categoryPath, issues);
            const hasChildren = isRecord(category.children) && Object.keys(category.children).length > 0;
            if (hasChildren) {
                validateCategoryMap(category.children, `${categoryPath}.children`, issues);
            } else {
                if (!Object.prototype.hasOwnProperty.call(category, 'balance')) {
                    issue(issues, `${categoryPath}.balance`, 'missing-field', 'Required finite number is missing');
                }
                if (Object.prototype.hasOwnProperty.call(category, 'children')) {
                    validateCategoryMap(category.children, `${categoryPath}.children`, issues);
                }
            }
        }
    }

    function validateTransaction(item, path, issues) {
        ['id', 'category'].forEach(field => requireString(item, field, path, issues));
        ['subcategory', 'currency', 'type', 'purpose', 'description'].forEach(field =>
            validateStringIfPresent(item, field, path, issues)
        );
        requireFinite(item, 'amount', path, issues);
        requireDate(item, 'date', path, issues);
        validateBooleanIfPresent(item, 'includeTime', path, issues);
    }

    function validateAutomationRule(item, path, issues) {
        ['id', 'name', 'category'].forEach(field => requireString(item, field, path, issues));
        validateStringIfPresent(item, 'subcategory', path, issues);
        requireFinite(item, 'amount', path, issues);
        if (!Object.prototype.hasOwnProperty.call(item, 'frequency')) {
            issue(issues, `${path}.frequency`, 'missing-field', 'Required automation frequency is missing');
        } else if (!AUTOMATION_FREQUENCIES.has(item.frequency)) {
            issue(issues, `${path}.frequency`, 'unsupported-frequency', 'Unsupported automation frequency');
        }
        requireDate(item, 'startDate', path, issues);
        validateDateIfPresent(item, 'endDate', path, issues, { allowEmpty: true, allowNull: true });
        validateDateIfPresent(item, 'lastExecuted', path, issues, { allowEmpty: true, allowNull: true });
        validateBooleanIfPresent(item, 'active', path, issues);
    }

    function validateInitialAsset(item, path, issues) {
        ['id', 'category', 'currency'].forEach(field => requireString(item, field, path, issues));
        validateStringIfPresent(item, 'subcategory', path, issues);
        requireFinite(item, 'amount', path, issues);
        requireDate(item, 'time', path, issues);
        validateDateIfPresent(item, 'createdAt', path, issues);
    }

    function validateTemplate(item, path, issues) {
        ['id', 'name', 'category'].forEach(field => requireString(item, field, path, issues));
        ['subcategory', 'currency', 'type', 'purpose', 'description'].forEach(field =>
            validateStringIfPresent(item, field, path, issues)
        );
        requireFinite(item, 'amount', path, issues);
        validateDateIfPresent(item, 'createdAt', path, issues);
    }

    function validateSettings(settings, path, issues) {
        if (!isRecord(settings)) {
            issue(issues, path, 'invalid-type', 'Expected settings object');
            return;
        }
        validateStringIfPresent(settings, 'baseCurrency', path, issues);
        validateBooleanIfPresent(settings, 'autoBackup', path, issues);
        validateFiniteIfPresent(settings, 'backupInterval', path, issues, { positive: true });
        if (Object.prototype.hasOwnProperty.call(settings, 'exchangeRates')) {
            const rates = settings.exchangeRates;
            if (!isRecord(rates)) {
                issue(issues, `${path}.exchangeRates`, 'invalid-type', 'Expected exchange-rate object');
            } else {
                for (const [currency, rate] of Object.entries(rates)) {
                    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
                        issue(issues, `${path}.exchangeRates.${currency}`, 'invalid-rate', 'Expected a positive finite exchange rate');
                    }
                }
            }
        }
    }

    function validateLegacyPayload(payload, issues) {
        if (!isRecord(payload)) {
            issue(issues, '$', 'invalid-top-level', 'Book payload must be an object');
            return;
        }
        if (![...LEGACY_ROOT_FIELDS].some(field => Object.prototype.hasOwnProperty.call(payload, field))) {
            issue(issues, '$', 'unknown-root', 'No known legacy root field is present');
            return;
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'categories')) {
            validateCategoryMap(payload.categories, '$.categories', issues);
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'transactions')) {
            validateObjectArray(payload.transactions, '$.transactions', issues, validateTransaction);
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'automationRules')) {
            validateObjectArray(payload.automationRules, '$.automationRules', issues, validateAutomationRule);
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'initialAssets')) {
            validateObjectArray(payload.initialAssets, '$.initialAssets', issues, validateInitialAsset);
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'transactionTemplates')) {
            validateObjectArray(payload.transactionTemplates, '$.transactionTemplates', issues, validateTemplate);
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'purposeCategories')) {
            if (!Array.isArray(payload.purposeCategories)) {
                issue(issues, '$.purposeCategories', 'invalid-type', 'Expected an array');
            } else {
                payload.purposeCategories.forEach((value, index) => {
                    if (typeof value !== 'string') {
                        issue(issues, `$.purposeCategories[${index}]`, 'invalid-type', 'Expected a string');
                    }
                });
            }
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'settings')) {
            validateSettings(payload.settings, '$.settings', issues);
        }
        validateStringIfPresent(payload, 'memo', '$', issues);
    }

    function readVersions(container, issues) {
        const versions = {};
        for (const field of VERSION_FIELDS) {
            const value = Object.prototype.hasOwnProperty.call(container, field) ? container[field] : SUPPORTED_VERSION;
            versions[field] = value;
            if (!Number.isInteger(value) || value <= 0) {
                issue(issues, `$.${field}`, 'invalid-version', 'Version must be a positive integer');
            }
        }
        return versions;
    }

    function validateBookText(rawText) {
        const evidence = inspectDOMString(rawText);
        const base = {
            rawHash: evidence.rawHash,
            hashAlgorithm: evidence.hashAlgorithm,
            rawEvidence: evidence
        };
        if (!evidence.isWellFormed) {
            return { status: 'corrupt', reason: 'ill-formed-dom-string', issues: [], ...base };
        }
        if (typeof rawText !== 'string' || rawText.trim().length === 0) {
            return { status: 'corrupt', reason: 'empty-present-source', issues: [], ...base };
        }

        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch (error) {
            return { status: 'corrupt', reason: 'invalid-json', issues: [], ...base };
        }

        const issues = [];
        validateNoUnpairedSurrogates(parsed, issues);
        validateNoDangerousKeys(parsed, issues);
        if (!isRecord(parsed)) {
            issue(issues, '$', 'invalid-top-level', 'Book must be an object');
            return { status: 'corrupt', reason: 'invalid-payload', issues, ...base };
        }

        if (Object.prototype.hasOwnProperty.call(parsed, 'format') && typeof parsed.format !== 'string') {
            issue(issues, '$.format', 'invalid-type', 'Format must be a string');
        }

        const isEnvelope = parsed.format === BOOK_FORMAT;
        const versions = readVersions(parsed, issues);
        if (issues.length > 0) {
            return {
                status: 'corrupt',
                reason: issues.some(item => item.code === 'invalid-version') ? 'invalid-version' : 'validation-failed',
                schemaVersion: versions.schemaVersion,
                issues,
                ...base
            };
        }
        if (Object.prototype.hasOwnProperty.call(parsed, 'format') && parsed.format !== BOOK_FORMAT) {
            return { status: 'unsupported', reason: 'unknown-format', issues, ...base };
        }
        if (VERSION_FIELDS.some(field => versions[field] > SUPPORTED_VERSION)) {
            return {
                status: 'unsupported',
                reason: 'future-version',
                schemaVersion: versions.schemaVersion,
                issues,
                ...base
            };
        }

        const payload = isEnvelope ? parsed.payload : parsed;
        validateLegacyPayload(payload, issues);
        if (issues.length > 0) {
            return {
                status: 'corrupt',
                reason: 'validation-failed',
                schemaVersion: versions.schemaVersion,
                issues,
                ...base
            };
        }

        return {
            status: 'valid',
            payload,
            source: isEnvelope ? 'book-package' : 'legacy-json',
            meta: {
                ...versions,
                exportedAt: isEnvelope && typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
                source: isEnvelope && typeof parsed.source === 'string' ? parsed.source : 'legacy'
            },
            issues: [],
            ...base
        };
    }

    return Object.freeze({
        AssetTrackerQueueAbortError,
        AssetTrackerQueueCallbackError,
        AssetTrackerQueueHaltedError,
        AssetTrackerSaveError,
        AssetTrackerSaveQueue,
        AssetTrackerSnapshotError,
        inspectDOMString,
        sha256Hex,
        validateBookText
    });
});
