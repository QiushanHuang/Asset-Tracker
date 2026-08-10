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
    const intrinsicPromiseThen = Function.prototype.call.bind(Promise.prototype.then);
    const intrinsicArrayIsArray = Array.isArray;
    const intrinsicObjectCreate = Object.create;
    const intrinsicObjectDefineProperty = Object.defineProperty;
    const intrinsicObjectFreeze = Object.freeze;
    const intrinsicObjectKeys = Object.keys;
    const intrinsicReflectGet = Reflect.get;
    const intrinsicReflectApply = Reflect.apply;
    const intrinsicString = String;
    const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
    const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
    const intrinsicNumberIsFinite = Number.isFinite;
    const intrinsicWeakMapGet = WeakMap.prototype.get;
    const intrinsicWeakMapSet = WeakMap.prototype.set;
    const intrinsicMathCeil = Math.ceil;
    const IntrinsicUint8Array = Uint8Array;
    const IntrinsicUint32Array = Uint32Array;
    const intrinsicTypedArrayPrototype = Object.getPrototypeOf(IntrinsicUint8Array.prototype);
    const intrinsicTypedArrayLengthGetter = Object.getOwnPropertyDescriptor(
        intrinsicTypedArrayPrototype,
        'length'
    ).get;
    const intrinsicTypedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
        intrinsicTypedArrayPrototype,
        'byteLength'
    ).get;
    const SHA256_CONSTANTS = intrinsicObjectFreeze([
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
    const SHA256_INITIAL_STATE = intrinsicObjectFreeze([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
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
    const SAVE_DESCRIPTOR_FIELDS = intrinsicObjectFreeze([
        'stateJson',
        'reason'
    ]);
    const SNAPSHOT_DESCRIPTOR_FIELDS = intrinsicObjectFreeze([
        'clientSnapshotId',
        'reason'
    ]);
    const SAVE_RECEIPT_FIELDS = intrinsicObjectFreeze([
        'ok',
        'clientSaveId',
        'payloadHash',
        'sourceHashBefore',
        'stateHashAfter',
        'stateHash',
        'byteCount',
        'durability',
        'updatedAt',
        'storagePath',
        'recoveryHealth'
    ]);
    const SAVE_ERROR_FIELDS = intrinsicObjectFreeze([
        'code',
        'message',
        'writeOutcome',
        'conflict',
        'clientSaveId',
        'payloadHash',
        'sourceHashAfter',
        'sourceReverified',
        'coordinatorReleased',
        'healthPersisted',
        'recoveryHealthEvidence'
    ]);
    const SNAPSHOT_RECEIPT_FIELDS = intrinsicObjectFreeze([
        'ok',
        'clientSnapshotId',
        'sourceHash',
        'snapshotHash',
        'ordinal',
        'snapshotStatus',
        'durability',
        'retainedCount',
        'recoveryHealth'
    ]);
    const SNAPSHOT_ERROR_FIELDS = intrinsicObjectFreeze([
        'code',
        'message',
        'snapshotOutcome',
        'conflict',
        'clientSnapshotId',
        'sourceHashAfter',
        'sourceReverified',
        'coordinatorReleased',
        'healthPersisted',
        'recoveryHealthEvidence'
    ]);
    const TERMINAL_RECEIPT_FIELDS = intrinsicObjectFreeze([
        'ok',
        'protocolVersion',
        'loadId',
        'reason',
        'gateState'
    ]);
    const saveQueueInternals = new WeakMap();

    function getSaveQueueInternals(queue) {
        return intrinsicReflectApply(intrinsicWeakMapGet, saveQueueInternals, [queue]);
    }

    function setSaveQueueInternals(queue, internals) {
        intrinsicReflectApply(intrinsicWeakMapSet, saveQueueInternals, [queue, internals]);
    }

    class AssetTrackerSaveError extends Error {}
    class AssetTrackerSnapshotError extends Error {}
    class AssetTrackerQueueAbortError extends Error {}
    class AssetTrackerQueueHaltedError extends Error {}
    class AssetTrackerQueueCallbackError extends Error {}

    function isQueueRecord(value) {
        return value !== null && typeof value === 'object' && !intrinsicArrayIsArray(value);
    }

    function appendPrivateArrayItem(items, item) {
        intrinsicObjectDefineProperty(items, items.length, {
            value: item,
            writable: true,
            enumerable: true,
            configurable: true
        });
    }

    function removeFirstPrivateArrayItem(items) {
        const length = items.length;
        if (length === 0) return undefined;
        const first = items[0];
        for (let index = 1; index < length; index += 1) {
            items[index - 1] = items[index];
        }
        items.length = length - 1;
        return first;
    }

    function findPrivateArrayItem(items, sought) {
        for (let index = 0; index < items.length; index += 1) {
            if (items[index] === sought) return index;
        }
        return -1;
    }

    function canonicalDeepFrozenCopy(value) {
        if (value === null || typeof value !== 'object') return value;

        const copy = intrinsicArrayIsArray(value) ? [] : {};
        const keys = intrinsicObjectKeys(value);
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index];
            intrinsicObjectDefineProperty(copy, key, {
                value: canonicalDeepFrozenCopy(intrinsicReflectGet(value, key)),
                writable: true,
                enumerable: true,
                configurable: true
            });
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
        if (!isQueueRecord(source)) throw new TypeError(`Queue ${label} must be an object`);

        const extracted = intrinsicObjectCreate(null);
        for (let index = 0; index < fields.length; index += 1) {
            const field = fields[index];
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
        if (!isQueueRecord(value)
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
        if (!isQueueRecord(value) || typeof value.stateJson !== 'string') {
            throw new TypeError('Queue initialAcknowledged is invalid');
        }
        if (value.stateHash !== null
            && !isValidHash(value.stateHash)) {
            throw new TypeError('Queue initialAcknowledged stateHash is invalid');
        }

        return intrinsicObjectFreeze({
            stateJson: value.stateJson,
            stateHash: value.stateHash
        });
    }

    function copyRecoveryHealth(value, expectedDomain) {
        if (!isQueueRecord(value)
            || value.domain !== expectedDomain
            || (value.status !== 'healthy'
                && value.status !== 'degraded'
                && value.status !== 'not-applicable')
            || typeof value.auditComplete !== 'boolean'
            || !intrinsicNumberIsSafeInteger(value.maintenancePendingCount)
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
        if (!intrinsicNumberIsFinite(value) || value <= 0) {
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
        if (values.expectedDurability !== 'browser-local-committed'
            && values.expectedDurability !== 'native-durable') {
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

    function createPromiseCapability() {
        let resolve;
        let reject;
        const promise = new IntrinsicPromise((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        return intrinsicObjectFreeze({ promise, resolve, reject });
    }

    function freezeTypedError(error, properties) {
        const keys = intrinsicObjectKeys(properties);
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index];
            intrinsicObjectDefineProperty(error, key, {
                value: intrinsicReflectGet(properties, key),
                writable: true,
                enumerable: true,
                configurable: true
            });
        }
        return intrinsicObjectFreeze(error);
    }

    function createCallbackFault(internals, details) {
        let callbackFaultId = details.callbackFaultId;
        if (!callbackFaultId) {
            internals.nextCallbackFaultOrdinal += 1;
            callbackFaultId = `${internals.configuration.sessionContext.loadId}:callback:${internals.nextCallbackFaultOrdinal}`;
        }
        return freezeTypedError(
            new AssetTrackerQueueCallbackError('Queue callback contract failed'),
            {
                queueOutcome: 'callback-failed',
                terminalReason: 'queue-callback-failed',
                lastAcknowledgedStateJson: internals.lastAcknowledgedStateJson,
                lastAcknowledgedHash: internals.lastAcknowledgedHash,
                attemptedStateJson: details.attemptedStateJson || null,
                activeClientItemId: details.clientItemId,
                callbackFaultId,
                causeKind: details.causeKind,
                callbackName: details.callbackName,
                clientItemId: details.clientItemId,
                completedItemKind: details.completedItemKind,
                completedClientItemId: details.completedClientItemId,
                completedOutcome: details.completedOutcome
            }
        );
    }

    function createAbortError(item, cause) {
        const itemKind = itemLaneKind(item);
        return freezeTypedError(
            new AssetTrackerQueueAbortError('Accepted queue item was not dispatched'),
            {
                queueOutcome: 'not-dispatched',
                itemKind,
                clientItemId: itemClientId(item),
                payloadHash: itemKind === 'save' ? item.payloadHash : null,
                causedByClientItemId: cause.causedByClientItemId,
                causeKind: cause.causeKind,
                callbackFaultId: cause.callbackFaultId,
                completedItemKind: cause.completedItemKind,
                completedClientItemId: cause.completedClientItemId,
                completedOutcome: cause.completedOutcome
            }
        );
    }

    function createHaltedError(terminalCause) {
        return freezeTypedError(
            new AssetTrackerQueueHaltedError('Save queue is halted'),
            {
                queueOutcome: 'queue-halted',
                terminalCause
            }
        );
    }

    function deferHaltedCapability(internals, promiseCapability) {
        appendPrivateArrayItem(internals.pendingHaltedCapabilities, promiseCapability);
    }

    function rejectDeferredHaltedCapabilities(internals, terminalCause) {
        const capabilities = internals.pendingHaltedCapabilities;
        internals.pendingHaltedCapabilities = [];
        for (let index = 0; index < capabilities.length; index += 1) {
            capabilities[index].reject(createHaltedError(terminalCause));
        }
    }

    function createPreparationError(internals, message) {
        return freezeTypedError(
            new AssetTrackerSaveError(message),
            {
                code: 'candidate-invalid',
                writeOutcome: 'not-committed',
                conflict: false,
                clientSaveId: null,
                payloadHash: null,
                sourceHashAfter: internals.lastAcknowledgedHash,
                sourceReverified: true,
                coordinatorReleased: true,
                healthPersisted: false,
                recoveryHealthEvidence: null,
                queueOutcome: 'preparation-rejected',
                terminalReason: 'candidate-invalid',
                lastAcknowledgedStateJson: internals.lastAcknowledgedStateJson,
                lastAcknowledgedHash: internals.lastAcknowledgedHash,
                attemptedStateJson: null,
                activeClientItemId: null,
                callbackFaultId: null
            }
        );
    }

    function observeRejectedPromise(promise) {
        try {
            intrinsicPromiseThen(promise, ignoreDiagnostic, ignoreDiagnostic);
        } catch (_error) {
            // An intrinsic queue promise and captured then normally make this unreachable.
        }
    }

    function createMalformedSaveError(item) {
        return freezeTypedError(
            new AssetTrackerSaveError('Save receipt or adapter outcome is malformed'),
            {
                queueOutcome: 'durability-unknown',
                clientSaveId: item.clientSaveId,
                payloadHash: item.payloadHash
            }
        );
    }

    function ignoreDiagnostic() {
        return undefined;
    }

    function consumeCallbackDiagnostic(value) {
        try {
            const diagnosticPromise = intrinsicPromiseResolve(value);
            intrinsicPromiseThen(diagnosticPromise, ignoreDiagnostic, ignoreDiagnostic);
        } catch (_error) {
            // Diagnostics are deliberately best effort and never alter queue state.
        }
    }

    function invokeTotalCallback(callback, argumentsList, callbackName) {
        let result;
        try {
            result = intrinsicReflectApply(callback, undefined, argumentsList);
        } catch (_error) {
            return { ok: false, callbackName };
        }
        if (result !== undefined) {
            consumeCallbackDiagnostic(result);
            return { ok: false, callbackName };
        }
        return { ok: true, callbackName };
    }

    function invokeTerminalCallback(callback, argumentsList) {
        let result;
        try {
            result = intrinsicReflectApply(callback, undefined, argumentsList);
        } catch (_error) {
            return;
        }
        if (result !== undefined) consumeCallbackDiagnostic(result);
    }

    function replaceQueueState(queue, overrides) {
        queue.queueState = canonicalDeepFrozenCopy({
            ...queue.queueState,
            ...overrides
        });
    }

    function copyQueueState(queue) {
        return canonicalDeepFrozenCopy(queue.queueState);
    }

    function itemLaneKind(item) {
        if (!item) return null;
        if (item.kind === 'callback-marker') return item.itemKind;
        return item.kind;
    }

    function itemClientId(item) {
        if (!item) return null;
        return itemLaneKind(item) === 'snapshot'
            ? item.clientSnapshotId
            : item.clientSaveId;
    }

    function selectLaneState(queue, { drainedPrimaryStatus } = {}) {
        const internals = getSaveQueueInternals(queue);
        const nextItem = internals.items.length === 0 ? null : internals.items[0];
        const nextKind = itemLaneKind(nextItem);
        replaceQueueState(queue, {
            lanePhase: nextKind === 'snapshot'
                ? 'barrier-running'
                : nextItem
                    ? 'saving'
                    : 'idle',
            primaryStatus: !nextItem && drainedPrimaryStatus !== undefined
                ? drainedPrimaryStatus
                : queue.queueState.primaryStatus,
            barrierState: nextItem && nextItem.kind === 'snapshot'
                ? 'running'
                : queue.queueState.barrierState,
            activeClientSaveId: nextKind === 'save' ? itemClientId(nextItem) : null,
            activeClientSnapshotId: nextKind === 'snapshot' ? itemClientId(nextItem) : null,
            pendingCount: internals.items.length
        });
    }

    function publishTerminalCallbacks(queue, terminalCause) {
        const internals = getSaveQueueInternals(queue);
        invokeTerminalCallback(internals.configuration.onTransition, [copyQueueState(queue)]);
        invokeTerminalCallback(internals.configuration.onFault, [terminalCause]);
    }

    function isValidHash(value) {
        if (typeof value !== 'string' || value.length !== 64) return false;
        for (let index = 0; index < value.length; index += 1) {
            const code = intrinsicReflectApply(intrinsicStringCharCodeAt, value, [index]);
            if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) return false;
        }
        return true;
    }

    function isStableTerminalReason(value) {
        return value === 'save-not-committed'
            || value === 'save-outcome-unknown'
            || value === 'save-conflict'
            || value === 'snapshot-outcome-unknown'
            || value === 'snapshot-conflict'
            || value === 'candidate-invalid'
            || value === 'queue-callback-failed';
    }

    function clearActiveDeadline(internals, item) {
        if (!internals.activeDeadline || internals.activeDeadline.item !== item) return;
        const deadline = internals.activeDeadline;
        internals.activeDeadline = null;
        try {
            internals.configuration.clock.clearTimeout(deadline.handle);
        } catch (_error) {
            // Clearing a host timer is best effort after the operation has completed.
        }
    }

    function validateTerminalReceipt(source, request) {
        const receipt = extractAllowedFields(source, TERMINAL_RECEIPT_FIELDS, 'terminalReceipt');
        if (receipt.ok !== true
            || receipt.protocolVersion !== 2
            || receipt.loadId !== request.sessionContext.loadId
            || !isStableTerminalReason(receipt.reason)
            || receipt.gateState !== 'terminal-locked') {
            throw new TypeError('Terminalization receipt is invalid');
        }
    }

    function attemptTerminalization(queue, reason) {
        const internals = getSaveQueueInternals(queue);
        if (internals.configuration.expectedDurability !== 'native-durable'
            || internals.terminalizationStarted) {
            return;
        }
        internals.terminalizationStarted = true;
        const request = canonicalDeepFrozenCopy({
            reason,
            sessionContext: internals.configuration.sessionContext
        });

        let result;
        try {
            result = internals.configuration.terminalize(request);
        } catch (_error) {
            internals.terminalizationDone = true;
            return;
        }

        try {
            const handle = internals.configuration.clock.setTimeout(() => {
                if (internals.terminalizationDone) return;
                internals.terminalizationDone = true;
                internals.terminalizationDeadline = null;
            }, internals.configuration.transportDeadlineMs);
            if (internals.terminalizationDone) {
                try {
                    internals.configuration.clock.clearTimeout(handle);
                } catch (_error) {
                    // A synchronously fired terminal deadline is already authoritative.
                }
            } else {
                internals.terminalizationDeadline = handle;
            }
        } catch (_error) {
            internals.terminalizationDone = true;
        }

        const finish = receipt => {
            if (internals.terminalizationDone) return undefined;
            try {
                validateTerminalReceipt(receipt, request);
            } catch (_error) {
                // A malformed terminal ACK cannot change the already-terminal Web lane.
            }
            internals.terminalizationDone = true;
            if (internals.terminalizationDeadline !== null) {
                try {
                    internals.configuration.clock.clearTimeout(internals.terminalizationDeadline);
                } catch (_error) {
                    // The lane is already terminal; timeout cleanup is best effort.
                }
                internals.terminalizationDeadline = null;
            }
            return undefined;
        };
        const reject = () => finish(null);
        try {
            const adopted = intrinsicPromiseResolve(result);
            intrinsicPromiseThen(adopted, finish, reject);
        } catch (_error) {
            reject();
        }
    }

    function extractStructuredSaveError(source, item, expectedHash) {
        if (!(source instanceof AssetTrackerSaveError)) {
            throw new TypeError('Save error is not typed');
        }
        const error = extractAllowedFields(source, SAVE_ERROR_FIELDS, 'saveError');
        if (typeof error.code !== 'string'
            || error.code.length === 0
            || typeof error.message !== 'string'
            || error.message.length === 0
            || (error.writeOutcome !== 'not-committed' && error.writeOutcome !== 'unknown')
            || (error.conflict !== false
                && error.conflict !== 'source-changed'
                && error.conflict !== 'session-invalid')
            || error.clientSaveId !== item.clientSaveId
            || error.payloadHash !== item.payloadHash
            || (error.sourceHashAfter !== null && !isValidHash(error.sourceHashAfter))
            || typeof error.sourceReverified !== 'boolean'
            || typeof error.coordinatorReleased !== 'boolean'
            || typeof error.healthPersisted !== 'boolean') {
            throw new TypeError('Save error is malformed');
        }

        let recoveryHealthEvidence = null;
        if (error.healthPersisted) {
            if (error.recoveryHealthEvidence === null) {
                throw new TypeError('Persisted health evidence is missing');
            }
            recoveryHealthEvidence = copyRecoveryHealth(
                extractAllowedFields(
                    error.recoveryHealthEvidence,
                    RECOVERY_HEALTH_FIELDS,
                    'saveError.recoveryHealthEvidence'
                ),
                'ordinary'
            );
            if (recoveryHealthEvidence.status === 'not-applicable') {
                throw new TypeError('Persisted health evidence is inapplicable');
            }
        } else if (error.recoveryHealthEvidence !== null) {
            throw new TypeError('Unpersisted health evidence must be null');
        }

        let classification = 'unknown';
        if (error.conflict !== false) {
            classification = 'conflict';
        } else if (error.writeOutcome === 'not-committed'
            && error.sourceHashAfter === expectedHash
            && error.sourceReverified === true
            && error.coordinatorReleased === true) {
            classification = 'not-committed';
        }

        return {
            classification,
            values: error,
            recoveryHealthEvidence
        };
    }

    function createTerminalSaveError(internals, item, classification, structured = null) {
        const queueOutcome = classification === 'not-committed'
            ? 'not-committed'
            : classification === 'conflict'
                ? 'conflict'
                : 'durability-unknown';
        const terminalReason = classification === 'not-committed'
            ? 'save-not-committed'
            : classification === 'conflict'
                ? 'save-conflict'
                : 'save-outcome-unknown';
        const message = structured ? structured.values.message : 'Save outcome is unknown';
        const wireProperties = structured
            ? {
                code: structured.values.code,
                writeOutcome: structured.values.writeOutcome,
                conflict: structured.values.conflict,
                clientSaveId: structured.values.clientSaveId,
                payloadHash: structured.values.payloadHash,
                sourceHashAfter: structured.values.sourceHashAfter,
                sourceReverified: structured.values.sourceReverified,
                coordinatorReleased: structured.values.coordinatorReleased,
                healthPersisted: structured.values.healthPersisted,
                recoveryHealthEvidence: structured.recoveryHealthEvidence
            }
            : {
                code: 'save-outcome-unknown',
                writeOutcome: 'unknown',
                conflict: false,
                clientSaveId: item.clientSaveId,
                payloadHash: item.payloadHash,
                sourceHashAfter: null,
                sourceReverified: false,
                coordinatorReleased: false,
                healthPersisted: false,
                recoveryHealthEvidence: null
            };
        return freezeTypedError(
            new AssetTrackerSaveError(message),
            {
                ...wireProperties,
                queueOutcome,
                terminalReason,
                lastAcknowledgedStateJson: internals.lastAcknowledgedStateJson,
                lastAcknowledgedHash: internals.lastAcknowledgedHash,
                attemptedStateJson: item.stateJson,
                activeClientItemId: item.clientSaveId,
                callbackFaultId: null
            }
        );
    }

    function extractStructuredSnapshotError(source, item, expectedHash) {
        if (!(source instanceof AssetTrackerSnapshotError)) {
            throw new TypeError('Snapshot error is not typed');
        }
        const error = extractAllowedFields(source, SNAPSHOT_ERROR_FIELDS, 'snapshotError');
        if (typeof error.code !== 'string'
            || error.code.length === 0
            || typeof error.message !== 'string'
            || error.message.length === 0
            || (error.snapshotOutcome !== 'not-created' && error.snapshotOutcome !== 'unknown')
            || (error.conflict !== false
                && error.conflict !== 'source-changed'
                && error.conflict !== 'session-invalid')
            || error.clientSnapshotId !== item.clientSnapshotId
            || (error.sourceHashAfter !== null && !isValidHash(error.sourceHashAfter))
            || typeof error.sourceReverified !== 'boolean'
            || typeof error.coordinatorReleased !== 'boolean'
            || typeof error.healthPersisted !== 'boolean') {
            throw new TypeError('Snapshot error is malformed');
        }

        let recoveryHealthEvidence = null;
        if (error.healthPersisted) {
            if (error.recoveryHealthEvidence === null) {
                throw new TypeError('Persisted snapshot health evidence is missing');
            }
            recoveryHealthEvidence = copyRecoveryHealth(
                extractAllowedFields(
                    error.recoveryHealthEvidence,
                    RECOVERY_HEALTH_FIELDS,
                    'snapshotError.recoveryHealthEvidence'
                ),
                'snapshot'
            );
            if (recoveryHealthEvidence.status === 'not-applicable') {
                throw new TypeError('Persisted snapshot health evidence is inapplicable');
            }
        } else if (error.recoveryHealthEvidence !== null) {
            throw new TypeError('Unpersisted snapshot health evidence must be null');
        }

        let classification = 'unknown';
        if (error.conflict !== false) {
            classification = 'conflict';
        } else if (error.snapshotOutcome === 'not-created'
            && error.sourceHashAfter === expectedHash
            && error.sourceReverified === true
            && error.coordinatorReleased === true) {
            classification = 'not-created';
        }
        return { classification, values: error, recoveryHealthEvidence };
    }

    function createSnapshotError(internals, item, classification, structured = null) {
        const message = structured ? structured.values.message : 'Snapshot outcome is unknown';
        const wireProperties = structured
            ? {
                code: structured.values.code,
                snapshotOutcome: structured.values.snapshotOutcome,
                conflict: structured.values.conflict,
                clientSnapshotId: structured.values.clientSnapshotId,
                sourceHashAfter: structured.values.sourceHashAfter,
                sourceReverified: structured.values.sourceReverified,
                coordinatorReleased: structured.values.coordinatorReleased,
                healthPersisted: structured.values.healthPersisted,
                recoveryHealthEvidence: structured.recoveryHealthEvidence
            }
            : {
                code: 'snapshot-outcome-unknown',
                snapshotOutcome: 'unknown',
                conflict: false,
                clientSnapshotId: item.clientSnapshotId,
                sourceHashAfter: null,
                sourceReverified: false,
                coordinatorReleased: false,
                healthPersisted: false,
                recoveryHealthEvidence: null
            };
        const outcomeProperties = classification === 'not-created'
            ? { queueOutcome: 'not-created' }
            : classification === 'conflict'
                ? { queueOutcome: 'conflict', terminalReason: 'snapshot-conflict' }
                : {
                    queueOutcome: 'snapshot-outcome-unknown',
                    terminalReason: 'snapshot-outcome-unknown'
                };
        return freezeTypedError(
            new AssetTrackerSnapshotError(message),
            {
                ...wireProperties,
                ...outcomeProperties,
                lastAcknowledgedStateJson: internals.lastAcknowledgedStateJson,
                lastAcknowledgedHash: internals.lastAcknowledgedHash,
                attemptedStateJson: null,
                activeClientItemId: item.clientSnapshotId,
                callbackFaultId: null
            }
        );
    }

    function continueAfterKnownNotCreated(queue, item, structured) {
        const internals = getSaveQueueInternals(queue);
        const barrierError = createSnapshotError(internals, item, 'not-created', structured);
        removeFirstPrivateArrayItem(internals.items);
        internals.activeItem = null;
        internals.laneRevision += 1;
        const healthOverrides = structured.recoveryHealthEvidence
            ? { snapshotRecoveryHealth: structured.recoveryHealthEvidence }
            : {};
        replaceQueueState(queue, {
            ...healthOverrides,
            barrierState: 'not-created'
        });
        selectLaneState(queue);
        item.promiseCapability.reject(barrierError);

        internals.fenceDepth += 1;
        const transitionResult = invokeTotalCallback(
            internals.configuration.onTransition,
            [copyQueueState(queue)],
            'onTransition'
        );
        internals.fenceDepth -= 1;
        if (!transitionResult.ok) {
            haltForCallbackFault(queue, createCallbackFault(internals, {
                causeKind: 'post-operation-callback',
                callbackName: transitionResult.callbackName,
                clientItemId: null,
                completedItemKind: 'snapshot',
                completedClientItemId: item.clientSnapshotId,
                completedOutcome: 'known-not-created'
            }), null, 'not-created');
            return;
        }
        if (internals.halted) return;
        dispatchNextLaneItem(queue);
    }

    function haltForSnapshotFailure(queue, item, adapterError, expectedHash) {
        const internals = getSaveQueueInternals(queue);
        if (internals.halted || internals.activeItem !== item) return;
        clearActiveDeadline(internals, item);
        if (internals.halted || internals.activeItem !== item) return;

        let structured = null;
        let classification = 'unknown';
        try {
            structured = extractStructuredSnapshotError(adapterError, item, expectedHash);
            classification = structured.classification;
        } catch (_error) {
            structured = null;
        }
        if (classification === 'not-created') {
            continueAfterKnownNotCreated(queue, item, structured);
            return;
        }

        const activeError = createSnapshotError(internals, item, classification, structured);
        internals.halted = true;
        internals.accepting = false;
        internals.terminalCause = activeError;
        internals.pendingTerminalCause = null;
        internals.activeItem = null;
        internals.laneRevision += 1;
        const unsettledItems = internals.items;
        internals.items = [];
        for (let index = 0; index < unsettledItems.length; index += 1) {
            const pendingItem = unsettledItems[index];
            if (pendingItem === item) {
                pendingItem.promiseCapability.reject(activeError);
                continue;
            }
            pendingItem.promiseCapability.reject(createAbortError(pendingItem, {
                causedByClientItemId: item.clientSnapshotId,
                causeKind: 'storage-item',
                callbackFaultId: null,
                completedItemKind: null,
                completedClientItemId: null,
                completedOutcome: null
            }));
        }
        const healthOverrides = structured && structured.recoveryHealthEvidence
            ? { snapshotRecoveryHealth: structured.recoveryHealthEvidence }
            : {};
        replaceQueueState(queue, {
            ...healthOverrides,
            lanePhase: 'halted',
            primaryStatus: classification === 'conflict'
                ? 'failed-readonly'
                : queue.queueState.primaryStatus,
            barrierState: classification === 'conflict' ? 'conflict' : 'outcome-unknown',
            activeClientSaveId: null,
            activeClientSnapshotId: null,
            pendingCount: 0,
            accepting: false,
            halted: true
        });
        rejectDeferredHaltedCapabilities(internals, activeError);
        publishTerminalCallbacks(queue, activeError);
        attemptTerminalization(queue, activeError.terminalReason);
    }

    function haltForSaveFailure(queue, item, adapterError, expectedHash) {
        const internals = getSaveQueueInternals(queue);
        if (internals.halted || internals.activeItem !== item) return;
        clearActiveDeadline(internals, item);
        if (internals.halted || internals.activeItem !== item) return;

        let structured = null;
        let classification = 'unknown';
        try {
            structured = extractStructuredSaveError(adapterError, item, expectedHash);
            classification = structured.classification;
        } catch (_error) {
            structured = null;
        }
        const activeError = createTerminalSaveError(internals, item, classification, structured);
        internals.halted = true;
        internals.accepting = false;
        internals.terminalCause = activeError;
        internals.pendingTerminalCause = null;
        internals.activeItem = null;
        internals.laneRevision += 1;
        const unsettledItems = internals.items;
        internals.items = [];
        for (let index = 0; index < unsettledItems.length; index += 1) {
            const pendingItem = unsettledItems[index];
            if (pendingItem === item) {
                pendingItem.promiseCapability.reject(activeError);
                continue;
            }
            pendingItem.promiseCapability.reject(createAbortError(pendingItem, {
                causedByClientItemId: item.clientSaveId,
                causeKind: 'storage-item',
                callbackFaultId: null,
                completedItemKind: null,
                completedClientItemId: null,
                completedOutcome: null
            }));
        }
        const healthOverrides = structured && structured.recoveryHealthEvidence
            ? { ordinaryRecoveryHealth: structured.recoveryHealthEvidence }
            : {};
        replaceQueueState(queue, {
            ...healthOverrides,
            lanePhase: 'halted',
            primaryStatus: classification === 'unknown' ? 'durability-unknown' : 'failed-readonly',
            activeClientSaveId: null,
            activeClientSnapshotId: null,
            pendingCount: 0,
            accepting: false,
            halted: true
        });
        rejectDeferredHaltedCapabilities(internals, activeError);
        publishTerminalCallbacks(queue, activeError);
        attemptTerminalization(queue, activeError.terminalReason);
    }

    function haltForCallbackFault(
        queue,
        fault,
        triggeringItem = null,
        completedBarrierState = undefined
    ) {
        const internals = getSaveQueueInternals(queue);
        if (internals.halted) return;

        internals.halted = true;
        internals.accepting = false;
        internals.terminalCause = fault;
        internals.pendingTerminalCause = null;
        internals.activeItem = null;
        internals.laneRevision += 1;
        const unsettledItems = internals.items;
        internals.items = [];
        const causedByClientItemId = fault.completedClientItemId || fault.clientItemId;
        for (let index = 0; index < unsettledItems.length; index += 1) {
            const item = unsettledItems[index];
            if (item === triggeringItem) {
                item.promiseCapability.reject(fault);
                continue;
            }
            item.promiseCapability.reject(createAbortError(item, {
                causedByClientItemId,
                causeKind: fault.causeKind,
                callbackFaultId: fault.callbackFaultId,
                completedItemKind: fault.completedItemKind,
                completedClientItemId: fault.completedClientItemId,
                completedOutcome: fault.completedOutcome
            }));
        }
        replaceQueueState(queue, {
            ...(completedBarrierState === undefined ? {} : {
                barrierState: completedBarrierState
            }),
            lanePhase: 'halted',
            primaryStatus: 'failed-readonly',
            activeClientSaveId: null,
            activeClientSnapshotId: null,
            pendingCount: 0,
            accepting: false,
            halted: true
        });
        rejectDeferredHaltedCapabilities(internals, fault);
        publishTerminalCallbacks(queue, fault);
        attemptTerminalization(queue, 'queue-callback-failed');
    }

    function haltForMalformedSave(queue, item, expectedHash) {
        haltForSaveFailure(queue, item, null, expectedHash);
    }

    function extractAndValidateSaveReceipt(source, item, expectedHash, configuration) {
        const receipt = extractAllowedFields(source, SAVE_RECEIPT_FIELDS, 'saveReceipt');
        const recoveryHealth = extractAllowedFields(
            receipt.recoveryHealth,
            RECOVERY_HEALTH_FIELDS,
            'saveReceipt.recoveryHealth'
        );
        const expectedByteCount = item.payloadByteCount;

        if (receipt.ok !== true
            || receipt.clientSaveId !== item.clientSaveId
            || receipt.payloadHash !== item.payloadHash
            || receipt.sourceHashBefore !== expectedHash
            || receipt.durability !== configuration.expectedDurability
            || !isValidHash(receipt.stateHashAfter)
            || receipt.stateHash !== receipt.stateHashAfter
            || !intrinsicNumberIsSafeInteger(receipt.byteCount)
            || receipt.byteCount <= 0
            || (configuration.expectedDurability === 'browser-local-committed'
                && receipt.byteCount !== expectedByteCount)
            || typeof receipt.updatedAt !== 'string'
            || receipt.updatedAt.length === 0
            || typeof receipt.storagePath !== 'string'
            || receipt.storagePath.length === 0) {
            throw new TypeError('Save receipt is invalid');
        }

        let canonicalHealth;
        if (configuration.expectedDurability === 'native-durable') {
            canonicalHealth = copyRecoveryHealth(recoveryHealth, 'ordinary');
            if (canonicalHealth.status === 'not-applicable') {
                throw new TypeError('Native save receipt recovery health is invalid');
            }
        } else {
            canonicalHealth = copyRecoveryHealth(recoveryHealth, 'none');
            if (canonicalHealth.status !== 'not-applicable'
                || canonicalHealth.auditComplete !== true
                || canonicalHealth.code !== null
                || canonicalHealth.maintenancePendingCount !== 0
                || canonicalHealth.detail !== null) {
                throw new TypeError('Browser save receipt recovery health is invalid');
            }
        }

        return canonicalDeepFrozenCopy({
            ok: true,
            clientSaveId: receipt.clientSaveId,
            payloadHash: receipt.payloadHash,
            sourceHashBefore: receipt.sourceHashBefore,
            stateHashAfter: receipt.stateHashAfter,
            stateHash: receipt.stateHash,
            byteCount: receipt.byteCount,
            durability: receipt.durability,
            updatedAt: receipt.updatedAt,
            storagePath: receipt.storagePath,
            recoveryHealth: canonicalHealth
        });
    }

    function extractAndValidateSnapshotReceipt(source, item, expectedHash) {
        const receipt = extractAllowedFields(source, SNAPSHOT_RECEIPT_FIELDS, 'snapshotReceipt');
        const recoveryHealth = copyRecoveryHealth(
            extractAllowedFields(
                receipt.recoveryHealth,
                RECOVERY_HEALTH_FIELDS,
                'snapshotReceipt.recoveryHealth'
            ),
            'snapshot'
        );
        if (receipt.ok !== true
            || receipt.clientSnapshotId !== item.clientSnapshotId
            || !isValidHash(receipt.sourceHash)
            || receipt.sourceHash !== expectedHash
            || receipt.snapshotHash !== receipt.sourceHash
            || !intrinsicNumberIsSafeInteger(receipt.ordinal)
            || receipt.ordinal < 0
            || (receipt.snapshotStatus !== 'created' && receipt.snapshotStatus !== 'deduplicated')
            || receipt.durability !== 'native-durable'
            || !intrinsicNumberIsSafeInteger(receipt.retainedCount)
            || receipt.retainedCount < 1
            || receipt.retainedCount > 24
            || recoveryHealth.status === 'not-applicable') {
            throw new TypeError('Snapshot receipt is invalid');
        }

        return canonicalDeepFrozenCopy({
            ok: true,
            clientSnapshotId: receipt.clientSnapshotId,
            sourceHash: receipt.sourceHash,
            snapshotHash: receipt.snapshotHash,
            ordinal: receipt.ordinal,
            snapshotStatus: receipt.snapshotStatus,
            durability: receipt.durability,
            retainedCount: receipt.retainedCount,
            recoveryHealth
        });
    }

    function completePreparationMarker(queue, marker) {
        const internals = getSaveQueueInternals(queue);
        if (internals.halted || internals.activeItem !== null || internals.items[0] !== marker) return;
        const fault = createPreparationError(internals, marker.message);
        internals.halted = true;
        internals.accepting = false;
        internals.terminalCause = fault;
        internals.pendingTerminalCause = null;
        internals.laneRevision += 1;
        removeFirstPrivateArrayItem(internals.items);
        replaceQueueState(queue, {
            lanePhase: 'halted',
            primaryStatus: 'failed-readonly',
            activeClientSaveId: null,
            activeClientSnapshotId: null,
            pendingCount: 0,
            accepting: false,
            halted: true
        });
        rejectDeferredHaltedCapabilities(internals, fault);
        publishTerminalCallbacks(queue, fault);
        attemptTerminalization(queue, 'candidate-invalid');
    }

    function completeCallbackMarker(queue, marker) {
        const internals = getSaveQueueInternals(queue);
        if (internals.halted || internals.activeItem !== null || internals.items[0] !== marker) return;
        const fault = createCallbackFault(internals, {
            ...marker.faultDetails,
            callbackFaultId: marker.callbackFaultId
        });
        haltForCallbackFault(queue, fault, marker);
    }

    function dispatchNextLaneItem(queue) {
        const internals = getSaveQueueInternals(queue);
        if (internals.halted
            || internals.fenceDepth !== 0
            || internals.activeItem !== null
            || internals.items.length === 0) {
            return;
        }

        const item = internals.items[0];
        if (item.kind === 'preparation-marker') {
            completePreparationMarker(queue, item);
            return;
        }
        if (item.kind === 'callback-marker') {
            completeCallbackMarker(queue, item);
            return;
        }
        if (item.kind === 'snapshot') {
            dispatchSnapshot(queue, item);
            return;
        }
        internals.activeItem = item;
        const request = intrinsicObjectFreeze({
            clientSaveId: item.clientSaveId,
            stateJson: item.stateJson,
            payloadHash: item.payloadHash,
            reason: item.reason,
            expectedHash: internals.lastAcknowledgedHash,
            sessionContext: internals.configuration.sessionContext
        });
        try {
            const handle = internals.configuration.clock.setTimeout(() => {
                haltForSaveFailure(queue, item, null, request.expectedHash);
            }, internals.configuration.durabilityDeadlineMs);
            if (internals.halted || internals.activeItem !== item) {
                try {
                    internals.configuration.clock.clearTimeout(handle);
                } catch (_error) {
                    // A synchronously fired durability deadline is already authoritative.
                }
                return;
            }
            internals.activeDeadline = { item, handle };
        } catch (_error) {
            haltForSaveFailure(queue, item, null, request.expectedHash);
            return;
        }
        if (internals.halted || internals.activeItem !== item) return;
        let adapterResult;
        try {
            adapterResult = internals.configuration.write(request);
        } catch (error) {
            haltForSaveFailure(queue, item, error, request.expectedHash);
            return;
        }

        try {
            const adoptedResult = intrinsicPromiseResolve(adapterResult);
            intrinsicPromiseThen(
                adoptedResult,
                receipt => {
                    completeSaveReceipt(queue, item, request.expectedHash, receipt);
                    return undefined;
                },
                error => {
                    haltForSaveFailure(queue, item, error, request.expectedHash);
                    return undefined;
                }
            );
        } catch (_error) {
            haltForMalformedSave(queue, item, request.expectedHash);
        }
    }

    function dispatchSnapshot(queue, item) {
        const internals = getSaveQueueInternals(queue);
        internals.activeItem = item;
        const request = intrinsicObjectFreeze({
            clientSnapshotId: item.clientSnapshotId,
            reason: item.reason,
            expectedHash: internals.lastAcknowledgedHash,
            sessionContext: internals.configuration.sessionContext
        });
        try {
            const handle = internals.configuration.clock.setTimeout(() => {
                haltForSnapshotFailure(queue, item, null, request.expectedHash);
            }, internals.configuration.barrierDeadlineMs);
            if (internals.halted || internals.activeItem !== item) {
                try {
                    internals.configuration.clock.clearTimeout(handle);
                } catch (_error) {
                    // A synchronously fired deadline is handled by the terminal path.
                }
                return;
            }
            internals.activeDeadline = { item, handle };
        } catch (_error) {
            haltForSnapshotFailure(queue, item, null, request.expectedHash);
            return;
        }
        if (internals.halted || internals.activeItem !== item) return;

        let adapterResult;
        try {
            adapterResult = internals.configuration.snapshot(request);
        } catch (error) {
            haltForSnapshotFailure(queue, item, error, request.expectedHash);
            return;
        }
        try {
            const adoptedResult = intrinsicPromiseResolve(adapterResult);
            intrinsicPromiseThen(
                adoptedResult,
                receipt => {
                    completeSnapshotReceipt(queue, item, request.expectedHash, receipt);
                    return undefined;
                },
                error => {
                    haltForSnapshotFailure(queue, item, error, request.expectedHash);
                    return undefined;
                }
            );
        } catch (_error) {
            haltForSnapshotFailure(queue, item, null, request.expectedHash);
        }
    }

    function completeSnapshotReceipt(queue, item, expectedHash, adapterReceipt) {
        const internals = getSaveQueueInternals(queue);
        if (internals.halted || internals.activeItem !== item) return;
        clearActiveDeadline(internals, item);
        if (internals.halted || internals.activeItem !== item) return;

        let receipt;
        try {
            receipt = extractAndValidateSnapshotReceipt(adapterReceipt, item, expectedHash);
        } catch (_error) {
            haltForSnapshotFailure(queue, item, null, expectedHash);
            return;
        }

        removeFirstPrivateArrayItem(internals.items);
        internals.activeItem = null;
        internals.laneRevision += 1;
        const barrierState = receipt.recoveryHealth.status === 'degraded'
            ? 'degraded'
            : receipt.snapshotStatus;
        replaceQueueState(queue, {
            barrierState,
            snapshotRecoveryHealth: receipt.recoveryHealth
        });
        selectLaneState(queue);

        item.promiseCapability.resolve(canonicalDeepFrozenCopy(receipt));
        internals.fenceDepth += 1;
        const acknowledgedResult = invokeTotalCallback(
            internals.configuration.onAcknowledged,
            [canonicalDeepFrozenCopy(receipt)],
            'onAcknowledged'
        );
        if (!acknowledgedResult.ok) {
            internals.fenceDepth -= 1;
            haltForCallbackFault(queue, createCallbackFault(internals, {
                causeKind: 'post-operation-callback',
                callbackName: acknowledgedResult.callbackName,
                clientItemId: null,
                completedItemKind: 'snapshot',
                completedClientItemId: item.clientSnapshotId,
                completedOutcome: 'successful-receipt'
            }), null, barrierState);
            return;
        }
        if (internals.halted) {
            internals.fenceDepth -= 1;
            return;
        }

        selectLaneState(queue);
        const transitionResult = invokeTotalCallback(
            internals.configuration.onTransition,
            [copyQueueState(queue)],
            'onTransition'
        );
        if (!transitionResult.ok) {
            internals.fenceDepth -= 1;
            haltForCallbackFault(queue, createCallbackFault(internals, {
                causeKind: 'post-operation-callback',
                callbackName: transitionResult.callbackName,
                clientItemId: null,
                completedItemKind: 'snapshot',
                completedClientItemId: item.clientSnapshotId,
                completedOutcome: 'successful-receipt'
            }), null, barrierState);
            return;
        }
        internals.fenceDepth -= 1;
        if (internals.halted) return;
        dispatchNextLaneItem(queue);
    }

    function completeSaveReceipt(queue, item, expectedHash, adapterReceipt) {
        const internals = getSaveQueueInternals(queue);
        if (internals.halted || internals.activeItem !== item) return;
        clearActiveDeadline(internals, item);
        if (internals.halted || internals.activeItem !== item) return;

        let receipt;
        try {
            receipt = extractAndValidateSaveReceipt(
                adapterReceipt,
                item,
                expectedHash,
                internals.configuration
            );
        } catch (_error) {
            haltForMalformedSave(queue, item, expectedHash);
            return;
        }

        internals.lastAcknowledgedHash = receipt.stateHashAfter;
        internals.lastAcknowledgedStateJson = item.stateJson;
        internals.lastAcknowledgedReceipt = receipt;
        removeFirstPrivateArrayItem(internals.items);
        internals.activeItem = null;
        internals.laneRevision += 1;
        const healthOverrides = receipt.durability === 'native-durable'
            ? { ordinaryRecoveryHealth: receipt.recoveryHealth }
            : {};
        const completedBarrierState = queue.queueState.barrierState;
        replaceQueueState(queue, {
            ...healthOverrides,
            lastAcknowledgedHash: receipt.stateHashAfter,
            primaryStatus: receipt.durability
        });
        selectLaneState(queue);

        const promiseReceipt = canonicalDeepFrozenCopy(receipt);
        const callbackReceipt = canonicalDeepFrozenCopy(receipt);
        item.promiseCapability.resolve(promiseReceipt);

        internals.fenceDepth += 1;
        const acknowledgedResult = invokeTotalCallback(
            internals.configuration.onAcknowledged,
            [callbackReceipt],
            'onAcknowledged'
        );
        if (!acknowledgedResult.ok) {
            internals.fenceDepth -= 1;
            haltForCallbackFault(queue, createCallbackFault(internals, {
                causeKind: 'post-operation-callback',
                callbackName: acknowledgedResult.callbackName,
                clientItemId: null,
                completedItemKind: 'save',
                completedClientItemId: item.clientSaveId,
                completedOutcome: 'successful-receipt'
            }), null, completedBarrierState);
            return;
        }
        if (internals.halted) {
            internals.fenceDepth -= 1;
            return;
        }

        selectLaneState(queue, { drainedPrimaryStatus: receipt.durability });
        const transitionResult = invokeTotalCallback(
            internals.configuration.onTransition,
            [copyQueueState(queue)],
            'onTransition'
        );
        if (!transitionResult.ok) {
            internals.fenceDepth -= 1;
            haltForCallbackFault(queue, createCallbackFault(internals, {
                causeKind: 'post-operation-callback',
                callbackName: transitionResult.callbackName,
                clientItemId: null,
                completedItemKind: 'save',
                completedClientItemId: item.clientSaveId,
                completedOutcome: 'successful-receipt'
            }), null, completedBarrierState);
            return;
        }

        internals.fenceDepth -= 1;
        if (!internals.halted) dispatchNextLaneItem(queue);
    }

    class AssetTrackerSaveQueue {
        constructor(options) {
            const configuration = validateAndFreezeQueueOptions(options);
            this.queueConfiguration = configuration;
            this.queueState = createInitialQueueState(configuration);
            setSaveQueueInternals(this, {
                configuration,
                items: [],
                activeItem: null,
                lastAcknowledgedHash: configuration.initialAcknowledged.stateHash,
                lastAcknowledgedStateJson: configuration.initialAcknowledged.stateJson,
                lastAcknowledgedReceipt: null,
                nextSaveOrdinal: 0,
                nextAcceptedRevision: 0,
                nextCallbackFaultOrdinal: 0,
                laneRevision: 0,
                fenceDepth: 0,
                activeDeadline: null,
                halted: false,
                accepting: true,
                terminalCause: null,
                pendingTerminalCause: null,
                pendingHaltedCapabilities: [],
                terminalizationStarted: false,
                terminalizationDone: false,
                terminalizationDeadline: null
            });
        }

        enqueue(descriptor) {
            const promiseCapability = createPromiseCapability();
            const internals = getSaveQueueInternals(this);
            if (internals.halted) {
                promiseCapability.reject(createHaltedError(internals.terminalCause));
                return promiseCapability.promise;
            }
            if (!internals.accepting) {
                deferHaltedCapability(internals, promiseCapability);
                return promiseCapability.promise;
            }

            let values;
            try {
                values = extractAllowedFields(descriptor, SAVE_DESCRIPTOR_FIELDS, 'saveDescriptor');
                if (typeof values.stateJson !== 'string' || values.stateJson.length === 0) {
                    throw new TypeError('Save descriptor stateJson must be a non-empty string');
                }
                if (typeof values.reason !== 'string' || values.reason.length === 0) {
                    throw new TypeError('Save descriptor reason must be a non-empty string');
                }
            } catch (error) {
                promiseCapability.reject(error);
                return promiseCapability.promise;
            }

            const evidence = inspectDOMString(values.stateJson);
            if (evidence.encoding !== 'utf-8') {
                promiseCapability.reject(new TypeError('Save descriptor stateJson must be well-formed UTF-8'));
                return promiseCapability.promise;
            }

            internals.nextSaveOrdinal += 1;
            internals.nextAcceptedRevision += 1;
            internals.laneRevision += 1;
            const item = intrinsicObjectFreeze({
                kind: 'save',
                clientSaveId: `${internals.configuration.sessionContext.loadId}:save:${internals.nextSaveOrdinal}`,
                stateJson: values.stateJson,
                payloadHash: evidence.rawHash,
                payloadByteCount: stableTypedArrayByteLength(evidence.bytes),
                reason: values.reason,
                promiseCapability,
                acceptedRevision: internals.nextAcceptedRevision
            });
            appendPrivateArrayItem(internals.items, item);
            selectLaneState(this);

            internals.fenceDepth += 1;
            const transitionResult = invokeTotalCallback(
                internals.configuration.onTransition,
                [copyQueueState(this)],
                'onTransition'
            );
            internals.fenceDepth -= 1;
            if (!transitionResult.ok) {
                const faultDetails = intrinsicObjectFreeze({
                    causeKind: 'pre-dispatch-callback',
                    callbackName: transitionResult.callbackName,
                    clientItemId: item.clientSaveId,
                    completedItemKind: null,
                    completedClientItemId: null,
                    completedOutcome: null,
                    attemptedStateJson: item.stateJson
                });
                const pendingFault = createCallbackFault(internals, faultDetails);
                const itemIndex = findPrivateArrayItem(internals.items, item);
                internals.items[itemIndex] = intrinsicObjectFreeze({
                    kind: 'callback-marker',
                    itemKind: 'save',
                    clientSaveId: item.clientSaveId,
                    stateJson: item.stateJson,
                    payloadHash: item.payloadHash,
                    promiseCapability: item.promiseCapability,
                    acceptedRevision: item.acceptedRevision,
                    callbackFaultId: pendingFault.callbackFaultId,
                    faultDetails
                });
                internals.accepting = false;
                internals.pendingTerminalCause = pendingFault;
                replaceQueueState(this, {
                    lanePhase: 'saving',
                    activeClientSaveId: internals.items[0].kind === 'save'
                        ? internals.items[0].clientSaveId
                        : null,
                    activeClientSnapshotId: null,
                    pendingCount: internals.items.length,
                    accepting: false
                });
                dispatchNextLaneItem(this);
                return promiseCapability.promise;
            }

            dispatchNextLaneItem(this);
            return promiseCapability.promise;
        }

        runBarrier(descriptor) {
            const promiseCapability = createPromiseCapability();
            const internals = getSaveQueueInternals(this);
            if (internals.halted) {
                promiseCapability.reject(createHaltedError(internals.terminalCause));
                return promiseCapability.promise;
            }
            if (!internals.accepting) {
                deferHaltedCapability(internals, promiseCapability);
                return promiseCapability.promise;
            }

            let values;
            try {
                values = extractAllowedFields(
                    descriptor,
                    SNAPSHOT_DESCRIPTOR_FIELDS,
                    'snapshotDescriptor'
                );
                if (typeof values.clientSnapshotId !== 'string'
                    || values.clientSnapshotId.length === 0) {
                    throw new TypeError('Snapshot descriptor clientSnapshotId must be non-empty');
                }
                if (values.reason !== 'manual' && values.reason !== 'scheduled') {
                    throw new TypeError('Snapshot descriptor reason is invalid');
                }
            } catch (error) {
                promiseCapability.reject(error);
                return promiseCapability.promise;
            }

            const barrierStateBeforeAcceptance = this.queueState.barrierState;
            internals.nextAcceptedRevision += 1;
            internals.laneRevision += 1;
            const item = intrinsicObjectFreeze({
                kind: 'snapshot',
                clientSnapshotId: values.clientSnapshotId,
                reason: values.reason,
                promiseCapability,
                acceptedRevision: internals.nextAcceptedRevision
            });
            appendPrivateArrayItem(internals.items, item);
            selectLaneState(this);

            internals.fenceDepth += 1;
            const transitionResult = invokeTotalCallback(
                internals.configuration.onTransition,
                [copyQueueState(this)],
                'onTransition'
            );
            internals.fenceDepth -= 1;
            if (!transitionResult.ok) {
                const faultDetails = intrinsicObjectFreeze({
                    causeKind: 'pre-dispatch-callback',
                    callbackName: transitionResult.callbackName,
                    clientItemId: item.clientSnapshotId,
                    completedItemKind: null,
                    completedClientItemId: null,
                    completedOutcome: null,
                    attemptedStateJson: null
                });
                const pendingFault = createCallbackFault(internals, faultDetails);
                const itemIndex = findPrivateArrayItem(internals.items, item);
                internals.items[itemIndex] = intrinsicObjectFreeze({
                    kind: 'callback-marker',
                    itemKind: 'snapshot',
                    clientSnapshotId: item.clientSnapshotId,
                    stateJson: null,
                    payloadHash: null,
                    promiseCapability: item.promiseCapability,
                    acceptedRevision: item.acceptedRevision,
                    callbackFaultId: pendingFault.callbackFaultId,
                    faultDetails
                });
                internals.accepting = false;
                internals.pendingTerminalCause = pendingFault;
                replaceQueueState(this, {
                    accepting: false,
                    barrierState: barrierStateBeforeAcceptance
                });
                selectLaneState(this);
                dispatchNextLaneItem(this);
                return promiseCapability.promise;
            }

            dispatchNextLaneItem(this);
            return promiseCapability.promise;
        }

        failPreparation(error) {
            const promiseCapability = createPromiseCapability();
            observeRejectedPromise(promiseCapability.promise);
            const internals = getSaveQueueInternals(this);
            if (internals.halted) {
                promiseCapability.reject(createHaltedError(internals.terminalCause));
                return promiseCapability.promise;
            }
            if (!internals.accepting) {
                deferHaltedCapability(internals, promiseCapability);
                return promiseCapability.promise;
            }
            internals.accepting = false;

            let message = 'Candidate preparation failed';
            try {
                const candidateMessage = intrinsicReflectGet(error, 'message');
                if (typeof candidateMessage === 'string' && candidateMessage.length > 0) {
                    message = candidateMessage;
                }
            } catch (_error) {
                // Candidate diagnostics are optional and never retain the source error.
            }
            if (internals.halted) {
                promiseCapability.reject(createHaltedError(internals.terminalCause));
                return promiseCapability.promise;
            }

            let visibleStateJson = internals.lastAcknowledgedStateJson;
            for (let index = internals.items.length - 1; index >= 0; index -= 1) {
                if (internals.items[index].kind === 'save') {
                    visibleStateJson = internals.items[index].stateJson;
                    break;
                }
            }

            internals.nextAcceptedRevision += 1;
            internals.laneRevision += 1;
            const marker = intrinsicObjectFreeze({
                kind: 'preparation-marker',
                clientSaveId: null,
                stateJson: null,
                payloadHash: null,
                message,
                promiseCapability,
                acceptedRevision: internals.nextAcceptedRevision
            });
            const provisionalFault = createPreparationError(internals, message);
            internals.pendingTerminalCause = provisionalFault;
            appendPrivateArrayItem(internals.items, marker);
            replaceQueueState(this, {
                lanePhase: 'saving',
                activeClientSaveId: internals.items[0].kind === 'save'
                    ? internals.items[0].clientSaveId
                    : null,
                activeClientSnapshotId: null,
                pendingCount: internals.items.length,
                accepting: false
            });
            const transition = canonicalDeepFrozenCopy({
                ...this.queueState,
                transitionKind: 'preparation-rejected',
                visibleStateJson
            });

            internals.fenceDepth += 1;
            const transitionResult = invokeTotalCallback(
                internals.configuration.onTransition,
                [transition],
                'onTransition'
            );
            internals.fenceDepth -= 1;
            if (!transitionResult.ok) {
                const faultDetails = intrinsicObjectFreeze({
                    causeKind: 'pre-dispatch-callback',
                    callbackName: transitionResult.callbackName,
                    clientItemId: null,
                    completedItemKind: null,
                    completedClientItemId: null,
                    completedOutcome: null,
                    attemptedStateJson: null
                });
                const pendingFault = createCallbackFault(internals, faultDetails);
                internals.pendingTerminalCause = pendingFault;
                const markerIndex = findPrivateArrayItem(internals.items, marker);
                internals.items[markerIndex] = intrinsicObjectFreeze({
                    kind: 'callback-marker',
                    itemKind: 'save',
                    clientSaveId: null,
                    stateJson: null,
                    payloadHash: null,
                    promiseCapability,
                    acceptedRevision: marker.acceptedRevision,
                    callbackFaultId: pendingFault.callbackFaultId,
                    faultDetails
                });
                dispatchNextLaneItem(this);
                return promiseCapability.promise;
            }

            promiseCapability.reject(provisionalFault);
            dispatchNextLaneItem(this);
            return promiseCapability.promise;
        }

        getState() {
            return copyQueueState(this);
        }
    }

    function rotateRight(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
    }

    function stableTypedArrayLength(value) {
        return intrinsicReflectApply(intrinsicTypedArrayLengthGetter, value, []);
    }

    function stableTypedArrayByteLength(value) {
        return intrinsicReflectApply(intrinsicTypedArrayByteLengthGetter, value, []);
    }

    function sha256Hex(inputBytes) {
        const bytes = inputBytes;
        const byteLength = stableTypedArrayLength(bytes);
        const bitLength = byteLength * 8;
        const paddedLength = intrinsicMathCeil((byteLength + 9) / 64) * 64;
        const padded = new IntrinsicUint8Array(paddedLength);
        for (let index = 0; index < byteLength; index += 1) {
            padded[index] = bytes[index];
        }
        padded[byteLength] = 0x80;

        const highBits = (bitLength / 0x100000000) >>> 0;
        const lowBits = bitLength >>> 0;
        for (let index = 0; index < 4; index += 1) {
            const shift = 24 - index * 8;
            padded[paddedLength - 8 + index] = (highBits >>> shift) & 0xff;
            padded[paddedLength - 4 + index] = (lowBits >>> shift) & 0xff;
        }

        const state = new IntrinsicUint32Array(8);
        for (let index = 0; index < SHA256_INITIAL_STATE.length; index += 1) {
            state[index] = SHA256_INITIAL_STATE[index];
        }
        const words = new IntrinsicUint32Array(64);

        for (let offset = 0; offset < paddedLength; offset += 64) {
            for (let index = 0; index < 16; index += 1) {
                const wordOffset = offset + index * 4;
                words[index] = (
                    (padded[wordOffset] << 24)
                    | (padded[wordOffset + 1] << 16)
                    | (padded[wordOffset + 2] << 8)
                    | padded[wordOffset + 3]
                ) >>> 0;
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
                const temp1 = (h + sum1 + choose + SHA256_CONSTANTS[index] + words[index]) >>> 0;
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

        const hex = '0123456789abcdef';
        let output = '';
        for (let index = 0; index < SHA256_INITIAL_STATE.length; index += 1) {
            const word = state[index];
            for (let shift = 28; shift >= 0; shift -= 4) {
                output += hex[(word >>> shift) & 0x0f];
            }
        }
        return output;
    }

    function stableCharCodeAt(text, index) {
        return intrinsicReflectApply(intrinsicStringCharCodeAt, text, [index]);
    }

    function hasUnpairedSurrogate(text) {
        for (let index = 0; index < text.length; index += 1) {
            const codeUnit = stableCharCodeAt(text, index);
            if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
                const next = stableCharCodeAt(text, index + 1);
                if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
                index += 1;
            } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
                return true;
            }
        }
        return false;
    }

    function encodeUTF8(text) {
        const scratch = new IntrinsicUint8Array(text.length * 3);
        let offset = 0;
        for (let index = 0; index < text.length; index += 1) {
            const codeUnit = stableCharCodeAt(text, index);
            let point = codeUnit;
            if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
                const next = stableCharCodeAt(text, index + 1);
                point = 0x10000 + ((codeUnit - 0xd800) << 10) + (next - 0xdc00);
                index += 1;
            }
            if (point <= 0x7f) {
                scratch[offset] = point;
                offset += 1;
            } else if (point <= 0x7ff) {
                scratch[offset] = 0xc0 | (point >>> 6);
                scratch[offset + 1] = 0x80 | (point & 0x3f);
                offset += 2;
            } else if (point <= 0xffff) {
                scratch[offset] = 0xe0 | (point >>> 12);
                scratch[offset + 1] = 0x80 | ((point >>> 6) & 0x3f);
                scratch[offset + 2] = 0x80 | (point & 0x3f);
                offset += 3;
            } else {
                scratch[offset] = 0xf0 | (point >>> 18);
                scratch[offset + 1] = 0x80 | ((point >>> 12) & 0x3f);
                scratch[offset + 2] = 0x80 | ((point >>> 6) & 0x3f);
                scratch[offset + 3] = 0x80 | (point & 0x3f);
                offset += 4;
            }
        }
        const bytes = new IntrinsicUint8Array(offset);
        for (let index = 0; index < offset; index += 1) bytes[index] = scratch[index];
        return bytes;
    }

    function encodeUTF16LECodeUnits(text) {
        const bytes = new IntrinsicUint8Array(text.length * 2);
        for (let index = 0; index < text.length; index += 1) {
            const codeUnit = stableCharCodeAt(text, index);
            bytes[index * 2] = codeUnit & 0xff;
            bytes[index * 2 + 1] = codeUnit >>> 8;
        }
        return bytes;
    }

    function inspectDOMString(value) {
        const text = intrinsicString(value);
        const losslessUTF16 = hasUnpairedSurrogate(text);
        const bytes = losslessUTF16 ? encodeUTF16LECodeUnits(text) : encodeUTF8(text);
        return intrinsicObjectFreeze({
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
