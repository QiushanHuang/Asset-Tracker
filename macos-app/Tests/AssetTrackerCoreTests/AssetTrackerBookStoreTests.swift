import AssetTrackerCore
import CryptoKit
import Foundation
import XCTest

final class AssetTrackerBookStoreTests: XCTestCase {
    private func temporaryRoot(_ name: String = UUID().uuidString) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("AssetTrackerBookStoreTests-\(name)", isDirectory: true)
    }

    private func removeAfterTest(_ url: URL) {
        addTeardownBlock {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func writeSource(_ data: Data, root: URL) throws -> URL {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("AssetTrackerBook.json")
        try data.write(to: source)
        return source
    }

    func testNativeDurableDTOValidatorAcceptsExactFrozenSaveAndSnapshotFields() throws {
        let stateJSON = #"{"memo":"exact UTF-8 💰"}"#
        let payloadHash = sha256(Data(stateJSON.utf8))
        let sourceHash = String(repeating: "a", count: 64)
        let stateHashAfter = String(repeating: "b", count: 64)
        let authorization = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: "load-1",
            writeSessionToken: "session-1",
            expectedHash: sourceHash,
            validatedSourceHash: sourceHash
        )
        let saveRequest = DurableBookSaveRequest(
            clientSaveID: "save-1",
            expectedSource: .sha256(sourceHash),
            payloadHash: payloadHash,
            stateJSON: stateJSON,
            schemaVersion: 1,
            reason: "manual-edit",
            authorization: authorization
        )
        let ordinaryHealth = NativeRecoveryHealth(
            domain: .ordinary,
            status: .healthy,
            auditComplete: true,
            code: nil,
            maintenancePendingCount: 0,
            detail: nil
        )
        let updatedAt = Date(timeIntervalSince1970: 1_725_000_000.125)
        let saveReceipt = NativeDurableSaveReceipt(
            clientSaveID: "save-1",
            sourceHashBefore: sourceHash,
            payloadHash: payloadHash,
            stateHashAfter: stateHashAfter,
            byteCount: 321,
            durability: .nativeDurable,
            previousSlotHashes: [sourceHash],
            recoveryHealth: ordinaryHealth,
            updatedAt: updatedAt,
            storagePath: "/private/var/tmp/AssetTrackerBook.json"
        )

        try NativeDurableDTOValidator.validate(saveRequest)
        try NativeDurableDTOValidator.validate(saveReceipt, matching: saveRequest)
        XCTAssertEqual(saveReceipt.updatedAt, updatedAt)
        XCTAssertEqual(saveReceipt.storagePath, "/private/var/tmp/AssetTrackerBook.json")
        XCTAssertEqual(NativeDurability.nativeDurable.rawValue, "nativeDurable")

        let snapshotRequest = NativeSnapshotRequest(
            clientSnapshotID: "snapshot-1",
            reason: .scheduled,
            expectedHash: stateHashAfter,
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: "load-1",
                writeSessionToken: "session-1",
                expectedHash: stateHashAfter,
                validatedSourceHash: stateHashAfter
            )
        )
        let snapshotReceipt = NativeSnapshotReceipt(
            clientSnapshotID: "snapshot-1",
            sourceHash: stateHashAfter,
            snapshotHash: stateHashAfter,
            ordinal: 0,
            snapshotStatus: .created,
            durability: .nativeDurable,
            retainedCount: 1,
            recoveryHealth: NativeRecoveryHealth(
                domain: .snapshot,
                status: .degraded,
                auditComplete: true,
                code: "cleanup-pending",
                maintenancePendingCount: 1,
                detail: "one retained cleanup remains"
            )
        )

        try NativeDurableDTOValidator.validate(snapshotRequest)
        try NativeDurableDTOValidator.validate(snapshotReceipt, matching: snapshotRequest)
        XCTAssertEqual(snapshotReceipt.ordinal, 0, "the first persistent ordinal is valid and must not be guessed")
        XCTAssertEqual(NativeSnapshotReason.scheduled.rawValue, "scheduled")
        XCTAssertEqual(NativeSnapshotStatus.created.rawValue, "created")
    }

    func testNativeDurableDTOValidatorRejectsInvalidRequestFieldsTable() {
        let stateJSON = #"{"memo":"candidate"}"#
        let payloadHash = sha256(Data(stateJSON.utf8))
        let sourceHash = String(repeating: "a", count: 64)

        func request(
            clientSaveID: String = "save-1",
            expectedSource: ExpectedBookSource = .sha256(sourceHash),
            payloadHash candidateHash: String? = nil,
            stateJSON candidateJSON: String? = nil,
            schemaVersion: Int = 1,
            reason: String = "manual-edit",
            authorization: AssetTrackerSaveAuthorization? = nil
        ) -> DurableBookSaveRequest {
            DurableBookSaveRequest(
                clientSaveID: clientSaveID,
                expectedSource: expectedSource,
                payloadHash: candidateHash ?? payloadHash,
                stateJSON: candidateJSON ?? stateJSON,
                schemaVersion: schemaVersion,
                reason: reason,
                authorization: authorization ?? AssetTrackerSaveAuthorization(
                    protocolVersion: 2,
                    loadID: "load-1",
                    writeSessionToken: "session-1",
                    expectedHash: sourceHash,
                    validatedSourceHash: sourceHash
                )
            )
        }

        let cases: [(String, DurableBookSaveRequest, NativeDurableDTOValidationError)] = [
            ("empty client ID", request(clientSaveID: ""), .emptyField("clientSaveID")),
            (
                "uppercase payload hash",
                request(payloadHash: payloadHash.uppercased()),
                .invalidHash("payloadHash")
            ),
            (
                "payload hash mismatch",
                request(payloadHash: String(repeating: "c", count: 64)),
                .hashMismatch("payloadHash")
            ),
            (
                "non-object state JSON",
                request(
                    payloadHash: sha256(Data("[]".utf8)),
                    stateJSON: "[]"
                ),
                .invalidStateJSON
            ),
            ("unsupported schema", request(schemaVersion: 2), .unsupportedSchemaVersion(2)),
            ("empty reason", request(reason: ""), .emptyField("reason")),
            (
                "authorization source mismatch",
                request(authorization: AssetTrackerSaveAuthorization(
                    protocolVersion: 2,
                    loadID: "load-1",
                    writeSessionToken: "session-1",
                    expectedHash: String(repeating: "d", count: 64),
                    validatedSourceHash: String(repeating: "d", count: 64)
                )),
                .invalidAuthorization
            ),
            (
                "missing source with nonnil authorization hashes",
                request(expectedSource: .missing),
                .invalidAuthorization
            )
        ]

        for (name, candidate, expectedError) in cases {
            XCTAssertThrowsError(try NativeDurableDTOValidator.validate(candidate), name) { error in
                XCTAssertEqual(error as? NativeDurableDTOValidationError, expectedError, name)
            }
        }
    }

    func testNativeDurableDTOValidatorRejectsInvalidReceiptAndHealthProofFieldsTable() {
        let hashA = String(repeating: "a", count: 64)
        let hashB = String(repeating: "b", count: 64)
        let healthyOrdinary = NativeRecoveryHealth(
            domain: .ordinary,
            status: .healthy,
            auditComplete: true,
            code: nil,
            maintenancePendingCount: 0,
            detail: nil
        )

        func saveReceipt(
            sourceHashBefore: String? = hashA,
            byteCount: Int = 10,
            previousSlotHashes: [String] = [hashA],
            recoveryHealth: NativeRecoveryHealth = healthyOrdinary,
            updatedAt: Date = Date(timeIntervalSince1970: 1_725_000_000),
            storagePath: String = "/tmp/AssetTrackerBook.json"
        ) -> NativeDurableSaveReceipt {
            NativeDurableSaveReceipt(
                clientSaveID: "save-1",
                sourceHashBefore: sourceHashBefore,
                payloadHash: hashA,
                stateHashAfter: hashB,
                byteCount: byteCount,
                durability: .nativeDurable,
                previousSlotHashes: previousSlotHashes,
                recoveryHealth: recoveryHealth,
                updatedAt: updatedAt,
                storagePath: storagePath
            )
        }

        let invalidHealth = NativeRecoveryHealth(
            domain: .ordinary,
            status: .healthy,
            auditComplete: false,
            code: nil,
            maintenancePendingCount: 0,
            detail: nil
        )
        let saveCases: [(String, NativeDurableSaveReceipt, NativeDurableDTOValidationError)] = [
            ("uppercase source hash", saveReceipt(sourceHashBefore: hashA.uppercased()), .invalidHash("sourceHashBefore")),
            ("zero byte count", saveReceipt(byteCount: 0), .invalidByteCount(0)),
            ("duplicate previous slots", saveReceipt(previousSlotHashes: [hashA, hashA]), .invalidPreviousSlotHashes),
            ("incomplete healthy audit", saveReceipt(recoveryHealth: invalidHealth), .invalidRecoveryHealth),
            ("non-finite date", saveReceipt(updatedAt: Date(timeIntervalSinceReferenceDate: .infinity)), .invalidDate),
            ("relative storage path", saveReceipt(storagePath: "AssetTrackerBook.json"), .invalidStoragePath)
        ]
        for (name, receipt, expectedError) in saveCases {
            XCTAssertThrowsError(try NativeDurableDTOValidator.validate(receipt), name) { error in
                XCTAssertEqual(error as? NativeDurableDTOValidationError, expectedError, name)
            }
        }

        let healthySnapshot = NativeRecoveryHealth(
            domain: .snapshot,
            status: .healthy,
            auditComplete: true,
            code: nil,
            maintenancePendingCount: 0,
            detail: nil
        )
        let snapshotCases: [(String, NativeSnapshotReceipt, NativeDurableDTOValidationError)] = [
            (
                "source and snapshot differ",
                NativeSnapshotReceipt(
                    clientSnapshotID: "snapshot-1",
                    sourceHash: hashA,
                    snapshotHash: hashB,
                    ordinal: 1,
                    snapshotStatus: .created,
                    durability: .nativeDurable,
                    retainedCount: 1,
                    recoveryHealth: healthySnapshot
                ),
                .hashMismatch("snapshotHash")
            ),
            (
                "retention exceeds contract cap",
                NativeSnapshotReceipt(
                    clientSnapshotID: "snapshot-1",
                    sourceHash: hashA,
                    snapshotHash: hashA,
                    ordinal: 1,
                    snapshotStatus: .deduplicated,
                    durability: .nativeDurable,
                    retainedCount: 25,
                    recoveryHealth: healthySnapshot
                ),
                .invalidRetainedCount(25)
            ),
            (
                "success cannot report not applicable",
                NativeSnapshotReceipt(
                    clientSnapshotID: "snapshot-1",
                    sourceHash: hashA,
                    snapshotHash: hashA,
                    ordinal: 1,
                    snapshotStatus: .created,
                    durability: .nativeDurable,
                    retainedCount: 1,
                    recoveryHealth: NativeRecoveryHealth(
                        domain: .snapshot,
                        status: .notApplicable,
                        auditComplete: true,
                        code: nil,
                        maintenancePendingCount: 0,
                        detail: nil
                    )
                ),
                .invalidRecoveryHealth
            )
        ]
        for (name, receipt, expectedError) in snapshotCases {
            XCTAssertThrowsError(try NativeDurableDTOValidator.validate(receipt), name) { error in
                XCTAssertEqual(error as? NativeDurableDTOValidationError, expectedError, name)
            }
        }
    }

    func testNativeBridgeDTOMapperPreservesReceiptsAndStructuredErrorProofsWithoutDefaults() throws {
        let hashA = String(repeating: "a", count: 64)
        let hashB = String(repeating: "b", count: 64)
        let health = NativeRecoveryHealth(
            domain: .ordinary,
            status: .degraded,
            auditComplete: true,
            code: "cleanup-pending",
            maintenancePendingCount: 1,
            detail: "pending exact blob"
        )
        let updatedAt = Date(timeIntervalSince1970: 1_725_000_000.125)
        let receipt = NativeDurableSaveReceipt(
            clientSaveID: "save-wire-1",
            sourceHashBefore: nil,
            payloadHash: hashA,
            stateHashAfter: hashB,
            byteCount: 57,
            durability: .nativeDurable,
            previousSlotHashes: [],
            recoveryHealth: health,
            updatedAt: updatedAt,
            storagePath: "/tmp/AssetTrackerBook.json"
        )

        XCTAssertEqual(
            try AssetTrackerNativeBridgeDTOMapper.saveReceipt(receipt),
            .object([
                "ok": .bool(true),
                "clientSaveId": .string("save-wire-1"),
                "payloadHash": .string(hashA),
                "sourceHashBefore": .null,
                "stateHashAfter": .string(hashB),
                "stateHash": .string(hashB),
                "byteCount": .integer(57),
                "durability": .string("native-durable"),
                "updatedAt": .string("2024-08-30T06:40:00.125Z"),
                "storagePath": .string("/tmp/AssetTrackerBook.json"),
                "recoveryHealth": .object([
                    "domain": .string("ordinary"),
                    "status": .string("degraded"),
                    "auditComplete": .bool(true),
                    "code": .string("cleanup-pending"),
                    "maintenancePendingCount": .integer(1),
                    "detail": .string("pending exact blob")
                ])
            ])
        )

        let saveError = NativeDurableSaveErrorProof(
            code: "source-conflict",
            message: "source changed",
            writeOutcome: .notCommitted,
            conflict: .sourceChanged,
            clientSaveID: "save-wire-1",
            payloadHash: hashA,
            sourceHashAfter: hashB,
            sourceReverified: true,
            coordinatorReleased: true,
            healthPersisted: false,
            recoveryHealthEvidence: nil
        )
        try NativeDurableDTOValidator.validate(saveError)
        XCTAssertEqual(
            try AssetTrackerNativeBridgeDTOMapper.saveError(saveError),
            .object([
                "code": .string("source-conflict"),
                "message": .string("source changed"),
                "writeOutcome": .string("not-committed"),
                "conflict": .string("source-changed"),
                "clientSaveId": .string("save-wire-1"),
                "payloadHash": .string(hashA),
                "sourceHashAfter": .string(hashB),
                "sourceReverified": .bool(true),
                "coordinatorReleased": .bool(true),
                "healthPersisted": .bool(false),
                "recoveryHealthEvidence": .null
            ])
        )

        let snapshotError = NativeSnapshotErrorProof(
            code: "snapshot-outcome-unknown",
            message: "verification unavailable",
            snapshotOutcome: .unknown,
            conflict: .none,
            clientSnapshotID: "snapshot-wire-1",
            sourceHashAfter: nil,
            sourceReverified: false,
            coordinatorReleased: false,
            healthPersisted: true,
            recoveryHealthEvidence: NativeRecoveryHealth(
                domain: .snapshot,
                status: .healthy,
                auditComplete: true,
                code: nil,
                maintenancePendingCount: 0,
                detail: nil
            )
        )
        try NativeDurableDTOValidator.validate(snapshotError)
        let mappedSnapshotError = try AssetTrackerNativeBridgeDTOMapper.snapshotError(snapshotError)
        guard case .object(let snapshotFields) = mappedSnapshotError else {
            return XCTFail("snapshot error must map to an object")
        }
        XCTAssertEqual(snapshotFields["snapshotOutcome"], .string("unknown"))
        XCTAssertEqual(snapshotFields["conflict"], .bool(false))
        XCTAssertEqual(snapshotFields["clientSnapshotId"], .string("snapshot-wire-1"))
        XCTAssertEqual(snapshotFields["sourceHashAfter"], .null)
        XCTAssertEqual(snapshotFields["recoveryHealthEvidence"], .object([
            "domain": .string("snapshot"),
            "status": .string("healthy"),
            "auditComplete": .bool(true),
            "code": .null,
            "maintenancePendingCount": .integer(0),
            "detail": .null
        ]))

        let inconsistentEvidence = NativeSnapshotErrorProof(
            code: "snapshot-outcome-unknown",
            message: "invalid health tuple",
            snapshotOutcome: .unknown,
            conflict: .none,
            clientSnapshotID: "snapshot-wire-2",
            sourceHashAfter: nil,
            sourceReverified: false,
            coordinatorReleased: false,
            healthPersisted: false,
            recoveryHealthEvidence: NativeRecoveryHealth(
                domain: .snapshot,
                status: .healthy,
                auditComplete: true,
                code: nil,
                maintenancePendingCount: 0,
                detail: nil
            )
        )
        XCTAssertThrowsError(try NativeDurableDTOValidator.validate(inconsistentEvidence)) { error in
            XCTAssertEqual(error as? NativeDurableDTOValidationError, .invalidRecoveryHealthEvidence)
        }
    }

    func testSaveDurablyWritesVerifiedEnvelopeAndReturnsLosslessNativeReceipt() throws {
        let root = temporaryRoot("durable-save-happy")
        removeAfterTest(root)
        let stateJSON = #"{"memo":"durable 💰","revision":1}"#
        let payloadHash = sha256(Data(stateJSON.utf8))
        let request = DurableBookSaveRequest(
            clientSaveID: "save-durable-1",
            expectedSource: .missing,
            payloadHash: payloadHash,
            stateJSON: stateJSON,
            schemaVersion: 1,
            reason: "manual-edit",
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: "load-durable-1",
                writeSessionToken: "token-durable-1",
                expectedHash: nil,
                validatedSourceHash: nil
            )
        )
        let store: any AssetTrackerDurableBookStoreIO = AssetTrackerBookStore(
            storageDirectoryURL: root
        )

        let receipt = try store.saveDurably(request)
        let primaryURL = root.appendingPathComponent("AssetTrackerBook.json")
        let primaryBytes = try Data(contentsOf: primaryURL)
        let envelope = try XCTUnwrap(
            JSONSerialization.jsonObject(with: primaryBytes) as? [String: Any]
        )

        XCTAssertEqual(Set(envelope.keys), [
            "format",
            "formatVersion",
            "schemaVersion",
            "domainCapabilityVersion",
            "minimumReaderVersion",
            "exportedAt",
            "source",
            "reason",
            "payload"
        ])
        XCTAssertEqual(envelope["format"] as? String, "qiushan.asset-book")
        XCTAssertEqual(envelope["formatVersion"] as? Int, 1)
        XCTAssertEqual(envelope["schemaVersion"] as? Int, 1)
        XCTAssertEqual(envelope["domainCapabilityVersion"] as? Int, 1)
        XCTAssertEqual(envelope["minimumReaderVersion"] as? Int, 1)
        XCTAssertEqual(envelope["source"] as? String, "macos-app")
        XCTAssertEqual(envelope["reason"] as? String, "manual-edit")
        XCTAssertEqual((envelope["payload"] as? [String: Any])?["memo"] as? String, "durable 💰")
        let exportedAt = try XCTUnwrap(envelope["exportedAt"] as? String)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        XCTAssertEqual(receipt.updatedAt, formatter.date(from: exportedAt))

        XCTAssertEqual(receipt.clientSaveID, "save-durable-1")
        XCTAssertNil(receipt.sourceHashBefore)
        XCTAssertEqual(receipt.payloadHash, payloadHash)
        XCTAssertEqual(receipt.stateHashAfter, sha256(primaryBytes))
        XCTAssertNotEqual(receipt.stateHashAfter, payloadHash)
        XCTAssertEqual(receipt.byteCount, primaryBytes.count)
        XCTAssertEqual(receipt.durability, .nativeDurable)
        XCTAssertEqual(receipt.previousSlotHashes, [])
        XCTAssertEqual(receipt.recoveryHealth, NativeRecoveryHealth(
            domain: .ordinary,
            status: .healthy,
            auditComplete: true,
            code: nil,
            maintenancePendingCount: 0,
            detail: nil
        ))
        XCTAssertEqual(receipt.storagePath, primaryURL.path)
        try NativeDurableDTOValidator.validate(receipt, matching: request)
    }

    func testSaveDurablyRejectsInvalidRequestAndSourceBeforeManagedMutationTable() throws {
        let stateJSON = #"{"memo":"candidate"}"#
        let payloadHash = sha256(Data(stateJSON.utf8))

        func authorization(expectedHash: String?) -> AssetTrackerSaveAuthorization {
            AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: "load-reject",
                writeSessionToken: "token-reject",
                expectedHash: expectedHash,
                validatedSourceHash: expectedHash
            )
        }

        let preflightCases: [(String, DurableBookSaveRequest)] = [
            (
                "payload hash mismatch",
                DurableBookSaveRequest(
                    clientSaveID: "save-bad-hash",
                    expectedSource: .missing,
                    payloadHash: String(repeating: "a", count: 64),
                    stateJSON: stateJSON,
                    schemaVersion: 1,
                    reason: "manual-edit",
                    authorization: authorization(expectedHash: nil)
                )
            ),
            (
                "non-object business payload",
                DurableBookSaveRequest(
                    clientSaveID: "save-bad-domain",
                    expectedSource: .missing,
                    payloadHash: sha256(Data("[]".utf8)),
                    stateJSON: "[]",
                    schemaVersion: 1,
                    reason: "manual-edit",
                    authorization: authorization(expectedHash: nil)
                )
            ),
            (
                "unsupported schema",
                DurableBookSaveRequest(
                    clientSaveID: "save-bad-schema",
                    expectedSource: .missing,
                    payloadHash: payloadHash,
                    stateJSON: stateJSON,
                    schemaVersion: 2,
                    reason: "manual-edit",
                    authorization: authorization(expectedHash: nil)
                )
            )
        ]

        for (name, request) in preflightCases {
            let root = temporaryRoot("durable-preflight-\(request.clientSaveID)")
            removeAfterTest(root)
            let events = DurableBookFaultObservation()
            let store = AssetTrackerBookStore(storageDirectoryURL: root, durabilityHooks: .init(faultHandler: { event in
                events.record(event)
            }))

            XCTAssertThrowsError(try store.saveDurably(request), name)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.path), name)
            XCTAssertTrue(events.snapshot().isEmpty, name)
        }

        let root = temporaryRoot("durable-source-conflict")
        removeAfterTest(root)
        let original = Data(#"{"memo":"H0"}"#.utf8)
        let primaryURL = try writeSource(original, root: root)
        let wrongSource = String(repeating: "b", count: 64)
        let events = DurableBookFaultObservation()
        let store = AssetTrackerBookStore(storageDirectoryURL: root, durabilityHooks: .init(faultHandler: { event in
            events.record(event)
        }))
        let sourceConflict = DurableBookSaveRequest(
            clientSaveID: "save-source-conflict",
            expectedSource: .sha256(wrongSource),
            payloadHash: payloadHash,
            stateJSON: stateJSON,
            schemaVersion: 1,
            reason: "manual-edit",
            authorization: authorization(expectedHash: wrongSource)
        )

        XCTAssertThrowsError(try store.saveDurably(sourceConflict))
        XCTAssertEqual(try Data(contentsOf: primaryURL), original)
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: root.appendingPathComponent("Recovery").path
        ))
        XCTAssertTrue(events.snapshot().allSatisfy { event in
            event.point == .afterLockAcquired
                && event.role == .lock
                && event.targetName == ".AssetTracker.storage.lock"
        })
    }

    func testSnapshotCreatesThenDeduplicatesExactAcknowledgedPrimary() throws {
        let root = temporaryRoot("durable-snapshot")
        removeAfterTest(root)
        let store = AssetTrackerBookStore(storageDirectoryURL: root)
        let stateJSON = #"{"memo":"snapshot source"}"#
        let payloadHash = sha256(Data(stateJSON.utf8))
        let saved = try store.saveDurably(DurableBookSaveRequest(
            clientSaveID: "save-before-snapshot",
            expectedSource: .missing,
            payloadHash: payloadHash,
            stateJSON: stateJSON,
            schemaVersion: 1,
            reason: "manual-edit",
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: "load-snapshot",
                writeSessionToken: "token-snapshot",
                expectedHash: nil,
                validatedSourceHash: nil
            )
        ))
        let primaryBytes = try Data(contentsOf: store.storageFileURL)
        let authorization = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: "load-snapshot",
            writeSessionToken: "token-snapshot",
            expectedHash: saved.stateHashAfter,
            validatedSourceHash: saved.stateHashAfter
        )
        let firstRequest = NativeSnapshotRequest(
            clientSnapshotID: "snapshot-created",
            reason: .manual,
            expectedHash: saved.stateHashAfter,
            authorization: authorization
        )
        let secondRequest = NativeSnapshotRequest(
            clientSnapshotID: "snapshot-deduplicated",
            reason: .scheduled,
            expectedHash: saved.stateHashAfter,
            authorization: authorization
        )

        let created = try store.snapshot(firstRequest)
        let deduplicated = try store.snapshot(secondRequest)

        XCTAssertEqual(created.clientSnapshotID, "snapshot-created")
        XCTAssertEqual(created.sourceHash, saved.stateHashAfter)
        XCTAssertEqual(created.snapshotHash, saved.stateHashAfter)
        XCTAssertEqual(created.ordinal, 0)
        XCTAssertEqual(created.snapshotStatus, .created)
        XCTAssertEqual(created.durability, .nativeDurable)
        XCTAssertEqual(created.retainedCount, 1)
        XCTAssertEqual(created.recoveryHealth.domain, .snapshot)
        XCTAssertEqual(created.recoveryHealth.status, .healthy)
        XCTAssertEqual(deduplicated.clientSnapshotID, "snapshot-deduplicated")
        XCTAssertEqual(deduplicated.ordinal, created.ordinal)
        XCTAssertEqual(deduplicated.snapshotStatus, .deduplicated)
        XCTAssertEqual(deduplicated.retainedCount, 1)
        XCTAssertEqual(try Data(contentsOf: store.storageFileURL), primaryBytes)
        try NativeDurableDTOValidator.validate(created, matching: firstRequest)
        try NativeDurableDTOValidator.validate(deduplicated, matching: secondRequest)
    }

    func testLoadReturnsBothAuditedHealthDomainsOrMarksBothUnavailable() throws {
        let missingRoot = temporaryRoot("dual-health-missing")
        removeAfterTest(missingRoot)
        let missing = AssetTrackerBookStore(storageDirectoryURL: missingRoot).load()

        XCTAssertEqual(missing.status, .missing)
        XCTAssertTrue(missing.recoveryHealthComplete)
        XCTAssertEqual(missing.ordinaryRecoveryHealth?.domain, .ordinary)
        XCTAssertEqual(missing.ordinaryRecoveryHealth?.status, .notApplicable)
        XCTAssertEqual(missing.snapshotRecoveryHealth?.domain, .snapshot)
        XCTAssertEqual(missing.snapshotRecoveryHealth?.status, .notApplicable)
        XCTAssertFalse(FileManager.default.fileExists(atPath: missingRoot.path))

        let corruptRoot = temporaryRoot("dual-health-corrupt")
        removeAfterTest(corruptRoot)
        let store = AssetTrackerBookStore(storageDirectoryURL: corruptRoot)
        let stateJSON = #"{"memo":"health source"}"#
        _ = try store.saveDurably(DurableBookSaveRequest(
            clientSaveID: "save-health-source",
            expectedSource: .missing,
            payloadHash: sha256(Data(stateJSON.utf8)),
            stateJSON: stateJSON,
            schemaVersion: 1,
            reason: "manual-edit",
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: "load-health",
                writeSessionToken: "token-health",
                expectedHash: nil,
                validatedSourceHash: nil
            )
        ))
        let snapshotDirectory = corruptRoot
            .appendingPathComponent("Recovery", isDirectory: true)
            .appendingPathComponent("snapshots", isDirectory: true)
        try FileManager.default.createDirectory(
            at: snapshotDirectory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let unknown = snapshotDirectory.appendingPathComponent("unknown.private")
        try Data("do not guess around me".utf8).write(to: unknown)

        let incomplete = store.load()
        XCTAssertEqual(incomplete.status, .readableBytes)
        XCTAssertEqual(incomplete.data, try Data(contentsOf: store.storageFileURL))
        XCTAssertFalse(incomplete.recoveryHealthComplete)
        XCTAssertNil(incomplete.ordinaryRecoveryHealth)
        XCTAssertNil(incomplete.snapshotRecoveryHealth)
        XCTAssertEqual(try Data(contentsOf: unknown), Data("do not guess around me".utf8))
    }

    func testSaveDurablyPropagatesRecoveryFaultFromTheInjectedHandlerWithoutReceipt() throws {
        let root = temporaryRoot("durable-fault-propagation")
        removeAfterTest(root)
        let events = DurableBookFaultObservation()
        let store = AssetTrackerBookStore(storageDirectoryURL: root, durabilityHooks: .init(faultHandler: { event in
            events.record(event)
            if event.point == .afterSourceCAS,
               event.role == .primary,
               event.targetName == "AssetTrackerBook.json" {
                throw TestBookStoreError.injectedDurabilityFault
            }
        }))
        let stateJSON = #"{"memo":"must not commit"}"#
        let request = DurableBookSaveRequest(
            clientSaveID: "save-fault",
            expectedSource: .missing,
            payloadHash: sha256(Data(stateJSON.utf8)),
            stateJSON: stateJSON,
            schemaVersion: 1,
            reason: "manual-edit",
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: "load-fault",
                writeSessionToken: "token-fault",
                expectedHash: nil,
                validatedSourceHash: nil
            )
        )

        XCTAssertThrowsError(try store.saveDurably(request)) { error in
            XCTAssertEqual(error as? TestBookStoreError, .injectedDurabilityFault)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.storageFileURL.path))
        XCTAssertEqual(events.snapshot().map(\.point), [.afterLockAcquired, .afterSourceCAS])
        XCTAssertEqual(events.snapshot().map(\.role), [.lock, .primary])
        XCTAssertEqual(events.snapshot().map(\.targetName), [
            ".AssetTracker.storage.lock",
            "AssetTrackerBook.json"
        ])
    }

    @MainActor
    func testCoordinatorDurableSaveUsesOneStoreCallAndAdvancesGateBeforeACK() async throws {
        let root = temporaryRoot("coordinator-durable-once")
        removeAfterTest(root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "durable-load" },
            tokenGenerator: { "durable-token" }
        )
        let loadID = gate.registerLoad(underlying.load(), retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .missing,
            reason: nil,
            validatedSourceHash: nil
        )
        let stateJSON = #"{"memo":"one durable call"}"#
        let request = DurableBookSaveRequest(
            clientSaveID: "durable-save-once",
            expectedSource: .missing,
            payloadHash: sha256(Data(stateJSON.utf8)),
            stateJSON: stateJSON,
            schemaVersion: 1,
            reason: "manual",
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: loadID,
                writeSessionToken: "durable-token",
                expectedHash: nil,
                validatedSourceHash: nil
            )
        )
        let store = RecordingBookStoreIO(underlying: underlying)
        let executor = ControllableRawIOExecutor()
        let beforeACKReached = LockedBooleanObservation()
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            writeGate: gate,
            faultHandler: { event in
                guard event.point == .beforeACK else { return }
                beforeACKReached.setTrue()
                throw TestBookStoreError.injectedDurabilityFault
            }
        )
        let completed = expectation(description: "before-ACK fault reported")
        var completionError: Error?

        let operationID = try coordinator.startSave(request: request) { result in
            if case .failure(let error) = result { completionError = error }
            completed.fulfill()
        }

        XCTAssertEqual(operationID, request.clientSaveID)
        XCTAssertEqual(coordinator.activity, .saveWriting(operationID: request.clientSaveID))
        XCTAssertEqual(executor.taskCount, 1)
        executor.runTask(at: 0)
        await fulfillment(of: [completed], timeout: 2)

        XCTAssertEqual(completionError as? TestBookStoreError, .injectedDurabilityFault)
        XCTAssertTrue(beforeACKReached.value)
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.durableSaveCalls, 1)
        XCTAssertEqual(store.observation.legacySaveCalls, 0)
        let committedHash = try XCTUnwrap(underlying.load().rawHash)
        XCTAssertEqual(
            gate.state,
            .validatedExisting(loadID: loadID, rawHash: committedHash, token: "durable-token")
        )
        XCTAssertEqual(coordinator.activity, .idle)
    }

    @MainActor
    func testCoordinatorSnapshotSharesSingleFlightAndDoesNotAdvanceGate() async throws {
        let root = temporaryRoot("coordinator-snapshot-single-flight")
        removeAfterTest(root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let stateJSON = #"{"memo":"snapshot source"}"#
        let seeded = try underlying.saveDurably(DurableBookSaveRequest(
            clientSaveID: "seed-before-coordinator-snapshot",
            expectedSource: .missing,
            payloadHash: sha256(Data(stateJSON.utf8)),
            stateJSON: stateJSON,
            schemaVersion: 1,
            reason: "manual",
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: "seed-load",
                writeSessionToken: "seed-token",
                expectedHash: nil,
                validatedSourceHash: nil
            )
        ))
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "snapshot-load" },
            tokenGenerator: { "snapshot-token" }
        )
        let loadID = gate.registerLoad(underlying.load(), retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: seeded.stateHashAfter
        )
        let authorization = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "snapshot-token",
            expectedHash: seeded.stateHashAfter,
            validatedSourceHash: seeded.stateHashAfter
        )
        let snapshotRequest = NativeSnapshotRequest(
            clientSnapshotID: "coordinator-snapshot",
            reason: .manual,
            expectedHash: seeded.stateHashAfter,
            authorization: authorization
        )
        let nextStateJSON = #"{"memo":"must wait"}"#
        let saveRequest = DurableBookSaveRequest(
            clientSaveID: "save-after-snapshot",
            expectedSource: .sha256(seeded.stateHashAfter),
            payloadHash: sha256(Data(nextStateJSON.utf8)),
            stateJSON: nextStateJSON,
            schemaVersion: 1,
            reason: "manual",
            authorization: authorization
        )
        let store = RecordingBookStoreIO(underlying: underlying)
        let executor = ControllableRawIOExecutor()
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            writeGate: gate
        )
        let gateBeforeSnapshot = gate.state
        let completed = expectation(description: "snapshot completed")
        var receipt: NativeSnapshotReceipt?

        let operationID = try coordinator.startSnapshot(request: snapshotRequest) { result in
            receipt = try? result.get()
            completed.fulfill()
        }

        XCTAssertEqual(operationID, snapshotRequest.clientSnapshotID)
        XCTAssertEqual(
            coordinator.activity,
            .snapshotting(operationID: snapshotRequest.clientSnapshotID)
        )
        XCTAssertThrowsError(try coordinator.startSave(request: saveRequest) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertEqual(executor.taskCount, 1)
        executor.runTask(at: 0)
        await fulfillment(of: [completed], timeout: 2)

        XCTAssertEqual(receipt?.clientSnapshotID, snapshotRequest.clientSnapshotID)
        XCTAssertEqual(store.observation.snapshotCalls, 1)
        XCTAssertEqual(store.observation.durableSaveCalls, 0)
        XCTAssertEqual(gate.state, gateBeforeSnapshot)
        XCTAssertEqual(coordinator.activity, .idle)
    }

    func testNativeBridgeRequestParserAcceptsOnlyExactDurableSaveAndSnapshotPayloads() throws {
        let stateJSON = #"{"memo":"strict host payload"}"#
        let payloadHash = sha256(Data(stateJSON.utf8))
        let sourceHash = String(repeating: "a", count: 64)
        let savePayload: [String: Any] = [
            "protocolVersion": 2,
            "loadId": "strict-load",
            "writeSessionToken": "strict-token",
            "clientSaveId": "strict-save",
            "stateJson": stateJSON,
            "payloadHash": payloadHash,
            "reason": "manual",
            "expectedHash": sourceHash,
            "validatedSourceHash": sourceHash,
            "schemaVersion": 1,
        ]
        let parsedSave = try AssetTrackerNativeBridgeRequestParser.durableSave(
            payload: savePayload
        )
        XCTAssertEqual(parsedSave.clientSaveID, "strict-save")
        XCTAssertEqual(parsedSave.expectedSource, .sha256(sourceHash))
        XCTAssertEqual(parsedSave.payloadHash, payloadHash)
        XCTAssertEqual(parsedSave.authorization.validatedSourceHash, sourceHash)

        var extraSave = savePayload
        extraSave["unexpected"] = true
        XCTAssertThrowsError(try AssetTrackerNativeBridgeRequestParser.durableSave(payload: extraSave))
        var missingSave = savePayload
        missingSave.removeValue(forKey: "reason")
        XCTAssertThrowsError(try AssetTrackerNativeBridgeRequestParser.durableSave(payload: missingSave))
        var malformedSave = savePayload
        malformedSave["schemaVersion"] = 1.5
        XCTAssertThrowsError(try AssetTrackerNativeBridgeRequestParser.durableSave(payload: malformedSave))

        let snapshotPayload: [String: Any] = [
            "protocolVersion": 2,
            "loadId": "strict-load",
            "writeSessionToken": "strict-token",
            "clientSnapshotId": "strict-snapshot",
            "reason": "scheduled",
            "expectedHash": sourceHash,
        ]
        let parsedSnapshot = try AssetTrackerNativeBridgeRequestParser.snapshot(
            payload: snapshotPayload
        )
        XCTAssertEqual(parsedSnapshot.reason, .scheduled)
        XCTAssertEqual(parsedSnapshot.expectedHash, sourceHash)
        XCTAssertEqual(parsedSnapshot.authorization.validatedSourceHash, sourceHash)

        for invalidReason in ["final", "manual ", ""] {
            var invalid = snapshotPayload
            invalid["reason"] = invalidReason
            XCTAssertThrowsError(
                try AssetTrackerNativeBridgeRequestParser.snapshot(payload: invalid),
                invalidReason
            )
        }
        var extraSnapshot = snapshotPayload
        extraSnapshot["validatedSourceHash"] = sourceHash
        XCTAssertThrowsError(try AssetTrackerNativeBridgeRequestParser.snapshot(payload: extraSnapshot))
    }

    func testNativeBridgeRequestParserAcceptsWKScriptMessageNumbersButRejectsBooleans() throws {
        let stateJSON = #"{"memo":"webkit number bridge"}"#
        let payloadHash = sha256(Data(stateJSON.utf8))
        let sourceHash = String(repeating: "a", count: 64)
        var payload: [String: Any] = [
            "protocolVersion": NSNumber(value: 2),
            "loadId": "webkit-load",
            "writeSessionToken": "webkit-token",
            "clientSaveId": "webkit-save",
            "stateJson": stateJSON,
            "payloadHash": payloadHash,
            "reason": "auto-backup",
            "expectedHash": sourceHash,
            "validatedSourceHash": sourceHash,
            "schemaVersion": NSNumber(value: 1),
        ]

        let parsed = try AssetTrackerNativeBridgeRequestParser.durableSave(payload: payload)
        XCTAssertEqual(parsed.authorization.protocolVersion, 2)
        XCTAssertEqual(parsed.schemaVersion, 1)

        payload["schemaVersion"] = NSNumber(value: true)
        XCTAssertThrowsError(try AssetTrackerNativeBridgeRequestParser.durableSave(payload: payload))
        payload["schemaVersion"] = NSNumber(value: 1.5)
        XCTAssertThrowsError(try AssetTrackerNativeBridgeRequestParser.durableSave(payload: payload))
    }

    func testLoadBridgeResponseCarriesCompleteDualHealthWithoutDefaults() {
        let ordinary = NativeRecoveryHealth(
            domain: .ordinary,
            status: .healthy,
            auditComplete: true,
            code: nil,
            maintenancePendingCount: 0,
            detail: nil
        )
        let snapshot = NativeRecoveryHealth(
            domain: .snapshot,
            status: .degraded,
            auditComplete: true,
            code: "cleanup-pending",
            maintenancePendingCount: 2,
            detail: "two pending"
        )
        let loaded = AssetTrackerStorageLoadResult(
            loadID: "dual-health-load",
            book: AssetTrackerRawBookLoadResult(
                status: .readableBytes,
                stateJson: #"{"ok":true}"#,
                rawHash: String(repeating: "c", count: 64),
                storagePath: "/tmp/AssetTrackerBook.json",
                recoveryHealthComplete: true,
                ordinaryRecoveryHealth: ordinary,
                snapshotRecoveryHealth: snapshot
            )
        )

        guard case .object(let fields) = AssetTrackerBridgeResponse.loadSuccess(
            requestID: "dual-health-response",
            loaded: loaded
        ).result else {
            return XCTFail("load result must be an object")
        }
        XCTAssertEqual(fields["recoveryHealthComplete"], .bool(true))
        XCTAssertEqual(fields["ordinaryRecoveryHealth"], .object([
            "domain": .string("ordinary"),
            "status": .string("healthy"),
            "auditComplete": .bool(true),
            "code": .null,
            "maintenancePendingCount": .integer(0),
            "detail": .null,
        ]))
        XCTAssertEqual(fields["snapshotRecoveryHealth"], .object([
            "domain": .string("snapshot"),
            "status": .string("degraded"),
            "auditComplete": .bool(true),
            "code": .string("cleanup-pending"),
            "maintenancePendingCount": .integer(2),
            "detail": .string("two pending"),
        ]))
    }

    func testInitAndMissingLoadCreateNoDirectory() {
        let root = temporaryRoot()
        removeAfterTest(root)
        let store = AssetTrackerBookStore(storageDirectoryURL: root)

        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
        let result = store.load()

        XCTAssertEqual(result.status, .missing)
        XCTAssertNil(result.data)
        XCTAssertNil(result.stateJson)
        XCTAssertNil(result.rawHash)
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
        XCTAssertEqual(store.storageFileURL, root.appendingPathComponent("AssetTrackerBook.json"))
    }

    func testLoadReturnsStrictUTF8AndSHA256OfOriginalBytesWithoutRewriting() throws {
        let root = temporaryRoot()
        removeAfterTest(root)
        let original = Data("{\"memo\":\"\u{4E2D}\u{1F4B0}\"}".utf8)
        let source = try writeSource(original, root: root)
        let attributesBefore = try FileManager.default.attributesOfItem(atPath: source.path)
        let store = AssetTrackerBookStore(storageDirectoryURL: root)

        let result = store.load()

        XCTAssertEqual(result.status, .readableBytes)
        XCTAssertEqual(result.data, original)
        XCTAssertEqual(result.stateJson, String(data: original, encoding: .utf8))
        XCTAssertEqual(result.rawHash, sha256(original))
        XCTAssertEqual(result.hashAlgorithm, "sha256")
        XCTAssertTrue(result.canExportRaw)
        XCTAssertTrue(result.canRevealFolder)
        XCTAssertEqual(try Data(contentsOf: source), original)
        let attributesAfter = try FileManager.default.attributesOfItem(atPath: source.path)
        XCTAssertEqual(attributesBefore[.size] as? NSNumber, attributesAfter[.size] as? NSNumber)
        XCTAssertEqual(attributesBefore[.modificationDate] as? Date, attributesAfter[.modificationDate] as? Date)
    }

    func testZeroBytePresentFileIsReadableBytesForTheSingleJSValidatorToReject() throws {
        let root = temporaryRoot()
        removeAfterTest(root)
        _ = try writeSource(Data(), root: root)
        let result = AssetTrackerBookStore(storageDirectoryURL: root).load()

        XCTAssertEqual(result.status, .readableBytes)
        XCTAssertEqual(result.data, Data())
        XCTAssertEqual(result.stateJson, "")
        XCTAssertEqual(result.rawHash, sha256(Data()))
    }

    func testInvalidUTF8RetainsOriginalBytesAndHashWithoutLossyText() throws {
        let root = temporaryRoot()
        removeAfterTest(root)
        let invalid = Data([0xff, 0xfe, 0x00, 0x80])
        let source = try writeSource(invalid, root: root)

        let result = AssetTrackerBookStore(storageDirectoryURL: root).load()

        XCTAssertEqual(result.status, .invalidUTF8)
        XCTAssertEqual(result.data, invalid)
        XCTAssertNil(result.stateJson)
        XCTAssertEqual(result.rawHash, sha256(invalid))
        XCTAssertEqual(try Data(contentsOf: source), invalid)
    }

    func testLoadClassifiesNotRegularPermissionAndGenericReadErrors() throws {
        let root = temporaryRoot()
        removeAfterTest(root)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("AssetTrackerBook.json")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)

        let notRegular = AssetTrackerBookStore(storageDirectoryURL: root).load()
        XCTAssertEqual(notRegular.status, .ioError)
        XCTAssertEqual(notRegular.reason, .notRegularFile)

        try FileManager.default.removeItem(at: source)
        try Data("{}".utf8).write(to: source)
        let denied = AssetTrackerBookStore(storageDirectoryURL: root) { _ in
            throw NSError(domain: NSCocoaErrorDomain, code: NSFileReadNoPermissionError)
        }.load()
        XCTAssertEqual(denied.status, .ioError)
        XCTAssertEqual(denied.reason, .permissionDenied)

        let failed = AssetTrackerBookStore(storageDirectoryURL: root) { _ in
            throw NSError(domain: NSCocoaErrorDomain, code: NSFileReadUnknownError)
        }.load()
        XCTAssertEqual(failed.status, .ioError)
        XCTAssertEqual(failed.reason, .readFailed)
    }

    func testRawExportRereadsSourceVerifiesHashAndCopiesExactInvalidUTF8Bytes() throws {
        let root = temporaryRoot()
        let exportRoot = temporaryRoot("export")
        removeAfterTest(root)
        removeAfterTest(exportRoot)
        let original = Data([0xff, 0xfe, 0x7b, 0x00, 0x7d])
        let source = try writeSource(original, root: root)
        try FileManager.default.createDirectory(at: exportRoot, withIntermediateDirectories: true)
        let destination = exportRoot.appendingPathComponent("recovered.raw")
        let store = AssetTrackerBookStore(storageDirectoryURL: root)

        let result = try store.exportRawBook(expectedHash: sha256(original), to: destination)

        XCTAssertEqual(result.rawHash, sha256(original))
        XCTAssertEqual(result.byteCount, original.count)
        XCTAssertEqual(try Data(contentsOf: destination), original)
        XCTAssertEqual(try Data(contentsOf: source), original)
    }

    func testRawExportHashMismatchAndReadFailureWriteNoDestination() throws {
        let root = temporaryRoot()
        let exportRoot = temporaryRoot("failed-export")
        removeAfterTest(root)
        removeAfterTest(exportRoot)
        let original = Data("source".utf8)
        _ = try writeSource(original, root: root)
        try FileManager.default.createDirectory(at: exportRoot, withIntermediateDirectories: true)
        let destination = exportRoot.appendingPathComponent("must-not-exist.raw")
        let store = AssetTrackerBookStore(storageDirectoryURL: root)

        XCTAssertThrowsError(try store.exportRawBook(expectedHash: String(repeating: "0", count: 64), to: destination)) { error in
            XCTAssertEqual(error as? AssetTrackerBookStoreError, .sourceHashMismatch)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        XCTAssertEqual(store.load().rawHash, sha256(original))

        let existingDestination = exportRoot.appendingPathComponent("existing.raw")
        let sentinel = Data("keep destination".utf8)
        try sentinel.write(to: existingDestination)
        XCTAssertThrowsError(try store.exportRawBook(
            expectedHash: String(repeating: "f", count: 64),
            to: existingDestination
        )) { error in
            XCTAssertEqual(error as? AssetTrackerBookStoreError, .sourceHashMismatch)
        }
        XCTAssertEqual(try Data(contentsOf: existingDestination), sentinel)

        let failedReadDestination = exportRoot.appendingPathComponent("read-failed.raw")
        let unreadableStore = AssetTrackerBookStore(storageDirectoryURL: root) { _ in
            throw NSError(domain: NSCocoaErrorDomain, code: NSFileReadNoPermissionError)
        }
        XCTAssertThrowsError(try unreadableStore.exportRawBook(
            expectedHash: sha256(original),
            to: failedReadDestination
        )) { error in
            XCTAssertEqual(error as? AssetTrackerBookStoreError, .sourceUnreadable)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: failedReadDestination.path))
        XCTAssertEqual(try Data(contentsOf: store.storageFileURL), original)
    }

    func testRawExportRejectsSameStandardizedResolvedSymlinkAndHardLinkIdentity() throws {
        let root = temporaryRoot()
        let exportRoot = temporaryRoot("identity")
        removeAfterTest(root)
        removeAfterTest(exportRoot)
        let original = Data("source identity".utf8)
        let source = try writeSource(original, root: root)
        try FileManager.default.createDirectory(at: exportRoot, withIntermediateDirectories: true)
        let store = AssetTrackerBookStore(storageDirectoryURL: root)
        let symlink = exportRoot.appendingPathComponent("source-symlink")
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: source)
        let hardLink = exportRoot.appendingPathComponent("source-hardlink")
        try FileManager.default.linkItem(at: source, to: hardLink)

        for destination in [source, symlink, hardLink] {
            XCTAssertThrowsError(try store.exportRawBook(expectedHash: sha256(original), to: destination)) { error in
                XCTAssertEqual(error as? AssetTrackerBookStoreError, .destinationMatchesSource)
            }
        }
        XCTAssertEqual(try Data(contentsOf: source), original)
    }

    func testSaveCreatesTheExplicitFinalRootOnlyOnWriteAndReturnsRawSHA256() throws {
        let root = temporaryRoot()
        removeAfterTest(root)
        let store = AssetTrackerBookStore(storageDirectoryURL: root)

        let result = try store.save(stateJson: "{\"memo\":\"saved\"}", schemaVersion: 1, reason: "test")

        XCTAssertTrue(FileManager.default.fileExists(atPath: root.path))
        XCTAssertEqual(result.rawHash, sha256(try Data(contentsOf: store.storageFileURL)))
        XCTAssertEqual(store.load().status, .readableBytes)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: store.storageFileURL)) as? [String: Any])
        XCTAssertEqual(object["format"] as? String, "qiushan.asset-book")
        XCTAssertEqual(object["schemaVersion"] as? Int, 1)
        XCTAssertEqual((object["payload"] as? [String: Any])?["memo"] as? String, "saved")
    }

    func testGateCoversInitialMissingAndExistingValidationTransitions() throws {
        let ids = SequenceGenerator(["load-missing", "load-existing"])
        let tokens = SequenceGenerator(["token-missing", "token-existing"])
        let missingGate = AssetTrackerLegacyWriteGate(loadIDGenerator: ids.next, tokenGenerator: tokens.next)
        let missingLoadID = missingGate.registerLoad(.missingResult(path: "/book"), retry: false)
        XCTAssertEqual(missingLoadID, "load-missing")
        XCTAssertEqual(missingGate.state, .candidateMissing(loadID: "load-missing"))
        let missingAck = try missingGate.confirm(
            protocolVersion: 2,
            loadID: missingLoadID,
            outcome: .missing,
            reason: nil,
            validatedSourceHash: nil
        )
        XCTAssertEqual(missingAck.writeSessionToken, "token-missing")
        XCTAssertEqual(missingGate.state, .validatedMissing(loadID: "load-missing", token: "token-missing"))

        let hash = String(repeating: "a", count: 64)
        let existingGate = AssetTrackerLegacyWriteGate(loadIDGenerator: ids.next, tokenGenerator: tokens.next)
        let existingLoadID = existingGate.registerLoad(.readableResult(hash: hash, path: "/book"), retry: false)
        XCTAssertEqual(existingLoadID, "load-existing")
        XCTAssertEqual(existingGate.state, .candidateExisting(loadID: "load-existing", rawHash: hash))
        let existingAck = try existingGate.confirm(
            protocolVersion: 2,
            loadID: existingLoadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: hash
        )
        XCTAssertEqual(existingAck.writeSessionToken, "token-existing")
        XCTAssertEqual(existingGate.state, .validatedExisting(loadID: "load-existing", rawHash: hash, token: "token-existing"))
    }

    func testGateLocksRecoverablyForRawFailuresAndSupportsOnlyFreshReadableRetry() throws {
        let ids = SequenceGenerator(["initial", "retry-missing", "retry-invalid", "retry-readable"])
        let tokens = SequenceGenerator(["retry-token"])
        let gate = AssetTrackerLegacyWriteGate(loadIDGenerator: ids.next, tokenGenerator: tokens.next)
        _ = gate.registerLoad(.invalidUTF8Result(hash: String(repeating: "1", count: 64), path: "/book"), retry: false)
        XCTAssertEqual(gate.state, .recoverableLocked(reason: "invalidUTF8"))

        let missingID = gate.registerLoad(.missingResult(path: "/book"), retry: true)
        XCTAssertEqual(missingID, "retry-missing")
        XCTAssertEqual(gate.state, .recoverableLocked(reason: "sourceMissingDuringRetry"))
        XCTAssertThrowsError(try gate.confirm(protocolVersion: 2, loadID: missingID, outcome: .missing, reason: nil, validatedSourceHash: nil))

        _ = gate.registerLoad(.ioErrorResult(reason: .readFailed, path: "/book"), retry: true)
        XCTAssertEqual(gate.state, .recoverableLocked(reason: "readFailed"))

        let hash = String(repeating: "2", count: 64)
        let readableID = gate.registerLoad(.readableResult(hash: hash, path: "/book"), retry: true)
        XCTAssertEqual(readableID, "retry-readable")
        XCTAssertEqual(gate.state, .retryCandidateExisting(loadID: "retry-readable", rawHash: hash))
        let ack = try gate.confirm(protocolVersion: 2, loadID: readableID, outcome: .valid, reason: nil, validatedSourceHash: hash)
        XCTAssertEqual(ack.writeSessionToken, "retry-token")
    }

    func testGateMapsPreRenderRecoveryAndPostRenderFailuresToDifferentLocks() throws {
        let hash = String(repeating: "3", count: 64)
        for reason in ["corrupt.preRender", "unsupported.preRender", "internalError.preRender"] {
            let gate = AssetTrackerLegacyWriteGate(loadIDGenerator: { "load-\(reason)" }, tokenGenerator: { "unused" })
            let loadID = gate.registerLoad(.readableResult(hash: hash, path: "/book"), retry: false)
            let ack = try gate.confirm(protocolVersion: 2, loadID: loadID, outcome: .recovery, reason: reason, validatedSourceHash: hash)
            XCTAssertNil(ack.writeSessionToken)
            XCTAssertEqual(gate.state, .recoverableLocked(reason: reason))
        }

        for reason in ["renderError.postRender", "internalError.postRender"] {
            let gate = AssetTrackerLegacyWriteGate(loadIDGenerator: { "load-\(reason)" }, tokenGenerator: { "unused" })
            let loadID = gate.registerLoad(.readableResult(hash: hash, path: "/book"), retry: false)
            _ = try gate.confirm(protocolVersion: 2, loadID: loadID, outcome: .recovery, reason: reason, validatedSourceHash: hash)
            XCTAssertEqual(gate.state, .terminalLocked(reason: reason))
            let stateBefore = gate.state
            _ = gate.registerLoad(.readableResult(hash: hash, path: "/book"), retry: true)
            XCTAssertEqual(gate.state, stateBefore)
            XCTAssertThrowsError(try gate.confirm(protocolVersion: 2, loadID: loadID, outcome: .valid, reason: nil, validatedSourceHash: hash)) { error in
                XCTAssertEqual(error as? AssetTrackerWriteGateError, .terminalLocked)
            }
        }
    }

    func testGateRejectsIllegalStaleWrongHashAndOldProtocolConfirmationsWithoutUnlocking() {
        let hash = String(repeating: "4", count: 64)
        let gate = AssetTrackerLegacyWriteGate(loadIDGenerator: { "load" }, tokenGenerator: { "token" })
        let loadID = gate.registerLoad(.readableResult(hash: hash, path: "/book"), retry: false)
        let cases: [(Int?, String, AssetTrackerLoadConfirmationOutcome, String?)] = [
            (nil, loadID, .valid, hash),
            (1, loadID, .valid, hash),
            (2, "stale-load", .valid, hash),
            (2, loadID, .valid, String(repeating: "5", count: 64)),
            (2, loadID, .missing, nil)
        ]

        for (version, candidateID, outcome, candidateHash) in cases {
            XCTAssertThrowsError(try gate.confirm(
                protocolVersion: version,
                loadID: candidateID,
                outcome: outcome,
                reason: nil,
                validatedSourceHash: candidateHash
            ))
            XCTAssertEqual(gate.state, .candidateExisting(loadID: "load", rawHash: hash))
        }
    }

    func testGateSaveAuthorizationRequiresProtocolLoadTokenHashesAndCurrentSource() throws {
        let originalHash = String(repeating: "6", count: 64)
        let nextHash = String(repeating: "7", count: 64)
        let gate = AssetTrackerLegacyWriteGate(loadIDGenerator: { "load" }, tokenGenerator: { "secret" })
        let loadID = gate.registerLoad(.readableResult(hash: originalHash, path: "/book"), retry: false)
        _ = try gate.confirm(protocolVersion: 2, loadID: loadID, outcome: .valid, reason: nil, validatedSourceHash: originalHash)
        let valid = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "secret",
            expectedHash: originalHash,
            validatedSourceHash: originalHash
        )
        XCTAssertNoThrow(try gate.authorizeSave(valid, currentSource: .readableResult(hash: originalHash, path: "/book")))

        let invalidRequests = [
            AssetTrackerSaveAuthorization(protocolVersion: nil, loadID: loadID, writeSessionToken: "secret", expectedHash: originalHash, validatedSourceHash: originalHash),
            AssetTrackerSaveAuthorization(protocolVersion: 1, loadID: loadID, writeSessionToken: "secret", expectedHash: originalHash, validatedSourceHash: originalHash),
            AssetTrackerSaveAuthorization(protocolVersion: 2, loadID: "stale", writeSessionToken: "secret", expectedHash: originalHash, validatedSourceHash: originalHash),
            AssetTrackerSaveAuthorization(protocolVersion: 2, loadID: loadID, writeSessionToken: nil, expectedHash: originalHash, validatedSourceHash: originalHash),
            AssetTrackerSaveAuthorization(protocolVersion: 2, loadID: loadID, writeSessionToken: "wrong", expectedHash: originalHash, validatedSourceHash: originalHash),
            AssetTrackerSaveAuthorization(protocolVersion: 2, loadID: loadID, writeSessionToken: "secret", expectedHash: nextHash, validatedSourceHash: originalHash),
            AssetTrackerSaveAuthorization(protocolVersion: 2, loadID: loadID, writeSessionToken: "secret", expectedHash: originalHash, validatedSourceHash: nextHash)
        ]
        for request in invalidRequests {
            XCTAssertThrowsError(try gate.authorizeSave(request, currentSource: .readableResult(hash: originalHash, path: "/book")))
        }
        XCTAssertThrowsError(try gate.authorizeSave(valid, currentSource: .readableResult(hash: nextHash, path: "/book")))
        XCTAssertThrowsError(try gate.authorizeSave(valid, currentSource: .invalidUTF8Result(hash: originalHash, path: "/book")))

        try gate.recordSuccessfulSave(newRawHash: nextHash)
        XCTAssertEqual(gate.state, .validatedExisting(loadID: loadID, rawHash: nextHash, token: "secret"))
        let advanced = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "secret",
            expectedHash: nextHash,
            validatedSourceHash: nextHash
        )
        XCTAssertNoThrow(try gate.authorizeSave(advanced, currentSource: .readableResult(hash: nextHash, path: "/book")))
    }

    func testConfirmACKLostThenTokenlessSaveIsRejected() throws {
        let hash = String(repeating: "8", count: 64)
        let gate = AssetTrackerLegacyWriteGate(loadIDGenerator: { "load" }, tokenGenerator: { "lost-token" })
        let loadID = gate.registerLoad(.readableResult(hash: hash, path: "/book"), retry: false)
        _ = try gate.confirm(protocolVersion: 2, loadID: loadID, outcome: .valid, reason: nil, validatedSourceHash: hash)

        let tokenless = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: nil,
            expectedHash: hash,
            validatedSourceHash: hash
        )
        XCTAssertThrowsError(try gate.authorizeSave(tokenless, currentSource: .readableResult(hash: hash, path: "/book"))) { error in
            XCTAssertEqual(error as? AssetTrackerWriteGateError, .missingWriteSessionToken)
        }
    }

    func testTerminalizeIsIdempotentAndStrictlyBoundToConfirmedLoadAndToken() throws {
        let hash = String(repeating: "a", count: 64)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "terminal-load" },
            tokenGenerator: { "terminal-token" }
        )
        let loadID = gate.registerLoad(.readableResult(hash: hash, path: "/book"), retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: hash
        )
        let validRequest = AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "terminal-token",
            reason: "internalError.postRender"
        )
        let invalidRequests = [
            AssetTrackerTerminalizationRequest(protocolVersion: 1, loadID: loadID, writeSessionToken: "terminal-token", reason: "internalError.postRender"),
            AssetTrackerTerminalizationRequest(protocolVersion: 2, loadID: "stale-load", writeSessionToken: "terminal-token", reason: "internalError.postRender"),
            AssetTrackerTerminalizationRequest(protocolVersion: 2, loadID: loadID, writeSessionToken: "wrong-token", reason: "internalError.postRender")
        ]

        for request in invalidRequests {
            XCTAssertThrowsError(try gate.terminalize(request))
            XCTAssertEqual(
                gate.state,
                .validatedExisting(loadID: loadID, rawHash: hash, token: "terminal-token")
            )
        }

        let firstAcknowledgement = try gate.terminalize(validRequest)
        XCTAssertEqual(firstAcknowledgement.reason, "internalError.postRender")
        XCTAssertEqual(gate.state, .terminalLocked(reason: "internalError.postRender"))
        let repeatedAcknowledgement = try gate.terminalize(
            AssetTrackerTerminalizationRequest(
                protocolVersion: 2,
                loadID: loadID,
                writeSessionToken: nil,
                reason: "renderError.postRender"
            )
        )
        XCTAssertEqual(
            repeatedAcknowledgement.reason,
            "internalError.postRender",
            "a retry with a different legal reason must ACK the first terminal reason"
        )
        XCTAssertThrowsError(try gate.terminalize(
            AssetTrackerTerminalizationRequest(
                protocolVersion: 2,
                loadID: loadID,
                writeSessionToken: "wrong-token",
                reason: "internalError.postRender"
            )
        ))
        XCTAssertEqual(gate.state, .terminalLocked(reason: "internalError.postRender"))

        let candidateGate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "candidate-load" },
            tokenGenerator: { "unused" }
        )
        let candidateLoadID = candidateGate.registerLoad(
            .readableResult(hash: hash, path: "/book"),
            retry: false
        )
        XCTAssertNoThrow(try candidateGate.terminalize(AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: candidateLoadID,
            writeSessionToken: nil,
            reason: "internalError.postRender"
        )))
        XCTAssertEqual(candidateGate.state, .terminalLocked(reason: "internalError.postRender"))

        let lostACKGate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "lost-ack-load" },
            tokenGenerator: { "native-secret" }
        )
        let lostACKLoadID = lostACKGate.registerLoad(.readableResult(hash: hash, path: "/book"), retry: false)
        _ = try lostACKGate.confirm(
            protocolVersion: 2,
            loadID: lostACKLoadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: hash
        )
        XCTAssertNoThrow(try lostACKGate.terminalize(AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: lostACKLoadID,
            writeSessionToken: nil,
            reason: "internalError.postRender"
        )))
        XCTAssertEqual(lostACKGate.state, .terminalLocked(reason: "internalError.postRender"))
    }

    @MainActor
    func testTerminalizedCoordinatorRejectsCapturedTokenBeforeAnyStoreReadOrWrite() async throws {
        let root = temporaryRoot("terminal-zero-io")
        removeAfterTest(root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let original = AssetTrackerRawBookLoadResult.readableResult(
            hash: String(repeating: "b", count: 64),
            path: underlying.storageFileURL.path
        )
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "terminal-load" },
            tokenGenerator: { "captured-token" }
        )
        let loadID = gate.registerLoad(original, retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: original.rawHash
        )
        let store = RecordingBookStoreIO(underlying: underlying)
        let executor = ControllableRawIOExecutor()
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            writeGate: gate,
            operationIDGenerator: { "must-not-start" }
        )
        let terminalRequest = AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "captured-token",
            reason: "internalError.postRender"
        )
        let terminalized = expectation(description: "terminalization acknowledged")
        try coordinator.terminalize(terminalRequest) { result in
            XCTAssertEqual(try? result.get().reason, "internalError.postRender")
            terminalized.fulfill()
        }
        await fulfillment(of: [terminalized], timeout: 2)
        let saveRequest = AssetTrackerStorageSaveRequest(
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: loadID,
                writeSessionToken: "captured-token",
                expectedHash: original.rawHash,
                validatedSourceHash: original.rawHash
            ),
            stateJson: #"{"memo":"must-not-write"}"#,
            schemaVersion: 1,
            reason: "captured-token"
        )

        XCTAssertThrowsError(try coordinator.startSave(request: saveRequest) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerWriteGateError, .terminalLocked)
        }
        XCTAssertEqual(coordinator.activity, .idle)
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 0)
    }

    @MainActor
    func testTerminalizeDuringLoadingCancelsCurrentOperationAndRejectsNewOperationsImmediately() async throws {
        let root = temporaryRoot("loading-terminalize")
        removeAfterTest(root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let hash = String(repeating: "f", count: 64)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "busy-load" },
            tokenGenerator: { "busy-token" }
        )
        let loadID = gate.registerLoad(.readableResult(hash: hash, path: "/book"), retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: hash
        )
        let executor = ControllableRawIOExecutor()
        let coordinator = AssetTrackerStorageCoordinator(
            store: underlying,
            rawIOExecutor: executor,
            writeGate: gate,
            operationIDGenerator: { "busy-operation" }
        )
        let cancelled = expectation(description: "loading operation cancelled")
        let terminalized = expectation(description: "loading terminalization acknowledged")
        var completionOrder: [String] = []
        _ = try coordinator.startLoad(retry: false) { result in
            if case .failure(let error) = result {
                XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .cancelled)
                completionOrder.append("load.cancelled")
                cancelled.fulfill()
            }
        }
        try coordinator.terminalize(AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "busy-token",
            reason: "internalError.postRender"
        )) { result in
            XCTAssertEqual(try? result.get().reason, "internalError.postRender")
            completionOrder.append("terminalized")
            terminalized.fulfill()
        }
        await fulfillment(of: [cancelled, terminalized], timeout: 2)
        XCTAssertEqual(completionOrder, ["load.cancelled", "terminalized"])
        XCTAssertEqual(gate.state, .terminalLocked(reason: "internalError.postRender"))
        XCTAssertEqual(coordinator.activity, .idle)

        XCTAssertThrowsError(try coordinator.startLoad(retry: false) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerWriteGateError, .terminalLocked)
        }
        XCTAssertEqual(executor.taskCount, 1)

        executor.runTask(at: 0)
        await Task.yield()
        XCTAssertEqual(gate.state, .terminalLocked(reason: "internalError.postRender"))
        XCTAssertEqual(coordinator.activity, .idle)
    }

    @MainActor
    func testTerminalizeDuringQueuedDurableSaveWaitsForReceiptBeforeLocking() async throws {
        let root = temporaryRoot("save-reading-terminalize")
        removeAfterTest(root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let original = Data(#"{"memo":"original"}"#.utf8)
        _ = try writeSource(original, root: root)
        let initial = underlying.load()
        let hash = try XCTUnwrap(initial.rawHash)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "save-reading-load" },
            tokenGenerator: { "save-reading-token" }
        )
        let loadID = gate.registerLoad(initial, retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: hash
        )
        let request = AssetTrackerStorageSaveRequest(
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: loadID,
                writeSessionToken: "save-reading-token",
                expectedHash: hash,
                validatedSourceHash: hash
            ),
            stateJson: #"{"memo":"must-not-write"}"#,
            schemaVersion: 1,
            reason: "terminalize-during-read"
        )
        let store = RecordingBookStoreIO(underlying: underlying)
        let executor = ControllableRawIOExecutor()
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            writeGate: gate,
            operationIDGenerator: { "save-reading-operation" }
        )
        let saved = expectation(description: "durable save completed")
        let terminalized = expectation(description: "terminalization acknowledged")
        var completionOrder: [String] = []

        _ = try coordinator.startSave(request: request) { result in
            if case .success = result {
                completionOrder.append("save.success")
                saved.fulfill()
            }
        }
        try coordinator.terminalize(AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "save-reading-token",
            reason: "internalError.postRender"
        )) { result in
            XCTAssertEqual(try? result.get().reason, "internalError.postRender")
            completionOrder.append("terminalized")
            terminalized.fulfill()
        }

        XCTAssertEqual(coordinator.activity, .saveWriting(operationID: "save-reading-operation"))
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 0)

        executor.runTask(at: 0)
        await fulfillment(of: [saved, terminalized], timeout: 2)
        XCTAssertEqual(completionOrder, ["save.success", "terminalized"])
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 1)
        XCTAssertNotEqual(try Data(contentsOf: underlying.storageFileURL), original)
        XCTAssertEqual(gate.state, .terminalLocked(reason: "internalError.postRender"))
        XCTAssertThrowsError(try coordinator.startSave(request: request) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerWriteGateError, .terminalLocked)
        }
    }

    @MainActor
    func testTerminalizeDuringSaveWritingWaitsForSuccessfulWriteThenACKsFirstReason() async throws {
        let root = temporaryRoot("save-writing-terminalize")
        removeAfterTest(root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "save-writing-load" },
            tokenGenerator: { "save-writing-token" }
        )
        let loadID = gate.registerLoad(.missingResult(path: underlying.storageFileURL.path), retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .missing,
            reason: nil,
            validatedSourceHash: nil
        )
        let request = AssetTrackerStorageSaveRequest(
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: loadID,
                writeSessionToken: "save-writing-token",
                expectedHash: nil,
                validatedSourceHash: nil
            ),
            stateJson: #"{"memo":"committed-before-terminal"}"#,
            schemaVersion: 1,
            reason: "terminalize-during-write"
        )
        let store = RecordingBookStoreIO(underlying: underlying)
        let executor = ControllableRawIOExecutor()
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            writeGate: gate,
            operationIDGenerator: { "save-writing-operation" }
        )
        let saveCompleted = expectation(description: "save completed first")
        let terminalized = expectation(description: "both terminalize callers acknowledged")
        terminalized.expectedFulfillmentCount = 2
        var completionOrder: [String] = []
        var terminalReasons: [String] = []

        _ = try coordinator.startSave(request: request) { result in
            guard case .success(let saved) = result else {
                return XCTFail("the in-flight write should finish")
            }
            XCTAssertEqual(
                gate.state,
                .validatedExisting(loadID: loadID, rawHash: saved.rawHash, token: "save-writing-token")
            )
            completionOrder.append("save.success")
            saveCompleted.fulfill()
        }
        XCTAssertEqual(coordinator.activity, .saveWriting(operationID: "save-writing-operation"))

        let firstRequest = AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "save-writing-token",
            reason: "internalError.postRender"
        )
        try coordinator.terminalize(firstRequest) { result in
            terminalReasons.append((try? result.get().reason) ?? "failure")
            completionOrder.append("terminal.first")
            terminalized.fulfill()
        }
        try coordinator.terminalize(AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: nil,
            reason: "renderError.postRender"
        )) { result in
            terminalReasons.append((try? result.get().reason) ?? "failure")
            completionOrder.append("terminal.duplicate")
            terminalized.fulfill()
        }
        XCTAssertThrowsError(try coordinator.terminalize(AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: "wrong-load",
            writeSessionToken: "save-writing-token",
            reason: "internalError.postRender"
        )) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerWriteGateError, .staleLoadID)
        }
        XCTAssertEqual(gate.state, .validatedMissing(loadID: loadID, token: "save-writing-token"))
        XCTAssertThrowsError(try coordinator.startLoad(retry: false) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertThrowsError(try coordinator.confirmLoad(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .missing,
            reason: nil,
            validatedSourceHash: nil
        )) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        let pendingExport = root.appendingPathComponent("must-not-export-while-terminalization-pending.raw")
        XCTAssertThrowsError(try coordinator.startRawExport(
            expectedHash: String(repeating: "0", count: 64),
            destinationURL: pendingExport
        ) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: pendingExport.path))
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 0)

        XCTAssertEqual(executor.taskCount, 1)
        executor.runTask(at: 0)
        await fulfillment(of: [saveCompleted, terminalized], timeout: 2)
        XCTAssertEqual(completionOrder, ["save.success", "terminal.first", "terminal.duplicate"])
        XCTAssertEqual(terminalReasons, ["internalError.postRender", "internalError.postRender"])
        XCTAssertEqual(gate.state, .terminalLocked(reason: "internalError.postRender"))
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 1)

        var lostACKRetryReason: String?
        try coordinator.terminalize(AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: nil,
            reason: "renderError.postRender"
        )) { result in
            lostACKRetryReason = try? result.get().reason
        }
        XCTAssertEqual(lostACKRetryReason, "internalError.postRender")
        XCTAssertThrowsError(try coordinator.startSave(request: request) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerWriteGateError, .terminalLocked)
        }
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 1)
    }

    @MainActor
    func testTerminalizeDuringFailedSaveWritingPreservesGateUntilFailureThenLocks() async throws {
        let root = temporaryRoot("failed-save-writing-terminalize")
        removeAfterTest(root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "failed-writing-load" },
            tokenGenerator: { "failed-writing-token" }
        )
        let loadID = gate.registerLoad(.missingResult(path: underlying.storageFileURL.path), retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .missing,
            reason: nil,
            validatedSourceHash: nil
        )
        let request = AssetTrackerStorageSaveRequest(
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: loadID,
                writeSessionToken: "failed-writing-token",
                expectedHash: nil,
                validatedSourceHash: nil
            ),
            stateJson: #"{"memo":"must-fail"}"#,
            schemaVersion: 1,
            reason: "failure-before-terminal"
        )
        let store = RecordingBookStoreIO(
            underlying: underlying,
            saveError: TestBookStoreError.injectedWriteFailure
        )
        let executor = ControllableRawIOExecutor()
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            writeGate: gate,
            operationIDGenerator: { "failed-writing-operation" }
        )
        let saveFailed = expectation(description: "save failure completed first")
        let terminalized = expectation(description: "terminalization followed failure")
        var completionOrder: [String] = []

        _ = try coordinator.startSave(request: request) { result in
            guard case .failure(let error) = result else {
                return XCTFail("injected save should fail")
            }
            XCTAssertEqual(error as? TestBookStoreError, .injectedWriteFailure)
            XCTAssertEqual(gate.state, .validatedMissing(loadID: loadID, token: "failed-writing-token"))
            completionOrder.append("save.failure")
            saveFailed.fulfill()
        }
        try coordinator.terminalize(AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "failed-writing-token",
            reason: "internalError.postRender"
        )) { result in
            XCTAssertEqual(try? result.get().reason, "internalError.postRender")
            completionOrder.append("terminalized")
            terminalized.fulfill()
        }
        XCTAssertEqual(gate.state, .validatedMissing(loadID: loadID, token: "failed-writing-token"))

        XCTAssertEqual(executor.taskCount, 1)
        executor.runTask(at: 0)
        await fulfillment(of: [saveFailed, terminalized], timeout: 2)
        XCTAssertEqual(completionOrder, ["save.failure", "terminalized"])
        XCTAssertEqual(gate.state, .terminalLocked(reason: "internalError.postRender"))
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: underlying.storageFileURL.path))
    }

    @MainActor
    func testTerminalizeDuringExportWaitsForExportCompletionBeforeLockAndACK() async throws {
        let root = temporaryRoot("export-terminalize-source")
        let exportRoot = temporaryRoot("export-terminalize-destination")
        removeAfterTest(root)
        removeAfterTest(exportRoot)
        let original = Data(#"{"memo":"raw-export"}"#.utf8)
        _ = try writeSource(original, root: root)
        try FileManager.default.createDirectory(at: exportRoot, withIntermediateDirectories: true)
        let destination = exportRoot.appendingPathComponent("book.raw")
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let initial = underlying.load()
        let hash = try XCTUnwrap(initial.rawHash)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "export-load" },
            tokenGenerator: { "export-token" }
        )
        let loadID = gate.registerLoad(initial, retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: hash
        )
        let store = RecordingBookStoreIO(underlying: underlying)
        let executor = ControllableRawIOExecutor()
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            writeGate: gate,
            operationIDGenerator: { "export-terminal-operation" }
        )
        let exported = expectation(description: "export completed first")
        let terminalized = expectation(description: "terminalization followed export")
        var completionOrder: [String] = []

        _ = try coordinator.startRawExport(expectedHash: hash, destinationURL: destination) { result in
            guard case .success = result else { return XCTFail("export should complete") }
            XCTAssertEqual(
                gate.state,
                .validatedExisting(loadID: loadID, rawHash: hash, token: "export-token")
            )
            completionOrder.append("export.success")
            exported.fulfill()
        }
        try coordinator.terminalize(AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "export-token",
            reason: "internalError.postRender"
        )) { result in
            XCTAssertEqual(try? result.get().reason, "internalError.postRender")
            completionOrder.append("terminalized")
            terminalized.fulfill()
        }
        XCTAssertEqual(
            gate.state,
            .validatedExisting(loadID: loadID, rawHash: hash, token: "export-token")
        )
        XCTAssertThrowsError(try coordinator.startLoad(retry: false) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }

        executor.runTask(at: 0)
        await fulfillment(of: [exported, terminalized], timeout: 2)
        XCTAssertEqual(completionOrder, ["export.success", "terminalized"])
        XCTAssertEqual(gate.state, .terminalLocked(reason: "internalError.postRender"))
        XCTAssertEqual(try Data(contentsOf: destination), original)
        XCTAssertEqual(store.observation.exportCalls, 1)
    }

    @MainActor
    func testTerminalLockedCoordinatorStillAllowsExactRawExportAndHashMismatchPreservesSource() async throws {
        let root = temporaryRoot("terminal-raw-export-source")
        let exportRoot = temporaryRoot("terminal-raw-export-destination")
        removeAfterTest(root)
        removeAfterTest(exportRoot)
        let original = Data(#"{"memo":"terminal raw export","tail":"</script>\n中文"}"#.utf8)
        let source = try writeSource(original, root: root)
        try FileManager.default.createDirectory(at: exportRoot, withIntermediateDirectories: true)
        let successfulDestination = exportRoot.appendingPathComponent("exact.raw")
        let mismatchDestination = exportRoot.appendingPathComponent("mismatch.raw")
        let mismatchSentinel = Data("keep-existing-destination".utf8)
        try mismatchSentinel.write(to: mismatchDestination)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let initial = underlying.load()
        let hash = try XCTUnwrap(initial.rawHash)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "terminal-export-load" },
            tokenGenerator: { "terminal-export-token" }
        )
        let loadID = gate.registerLoad(initial, retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: hash
        )
        let store = RecordingBookStoreIO(underlying: underlying)
        let executor = ControllableRawIOExecutor()
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            writeGate: gate,
            operationIDGenerator: SequenceGenerator(["terminal-export-success", "terminal-export-mismatch"]).next
        )
        let terminalized = expectation(description: "terminal gate established")
        try coordinator.terminalize(AssetTrackerTerminalizationRequest(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "terminal-export-token",
            reason: "renderError.postRender"
        )) { result in
            XCTAssertEqual(try? result.get().reason, "renderError.postRender")
            terminalized.fulfill()
        }
        await fulfillment(of: [terminalized], timeout: 2)
        XCTAssertEqual(gate.state, .terminalLocked(reason: "renderError.postRender"))

        XCTAssertThrowsError(try coordinator.startLoad(retry: true) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerWriteGateError, .terminalLocked)
        }
        XCTAssertThrowsError(try coordinator.confirmLoad(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: hash
        )) { error in
            XCTAssertEqual(error as? AssetTrackerWriteGateError, .terminalLocked)
        }

        let exported = expectation(description: "terminal raw export succeeds")
        _ = try coordinator.startRawExport(
            expectedHash: hash,
            destinationURL: successfulDestination
        ) { result in
            guard case .success(let rawExport) = result else {
                return XCTFail("terminal raw export should remain available")
            }
            XCTAssertEqual(rawExport.rawHash, hash)
            XCTAssertEqual(rawExport.byteCount, original.count)
            exported.fulfill()
        }
        executor.runTask(at: 0)
        await fulfillment(of: [exported], timeout: 2)
        XCTAssertEqual(try Data(contentsOf: successfulDestination), original)
        XCTAssertEqual(try Data(contentsOf: source), original)
        XCTAssertEqual(gate.state, .terminalLocked(reason: "renderError.postRender"))

        let mismatchReported = expectation(description: "terminal raw export hash mismatch reported")
        _ = try coordinator.startRawExport(
            expectedHash: String(repeating: "0", count: 64),
            destinationURL: mismatchDestination
        ) { result in
            guard case .failure(let error) = result else {
                return XCTFail("mismatched terminal export must fail")
            }
            XCTAssertEqual(error as? AssetTrackerBookStoreError, .sourceHashMismatch)
            mismatchReported.fulfill()
        }
        executor.runTask(at: 1)
        await fulfillment(of: [mismatchReported], timeout: 2)

        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 0)
        XCTAssertEqual(store.observation.exportCalls, 2)
        XCTAssertEqual(try Data(contentsOf: source), original)
        XCTAssertEqual(try Data(contentsOf: mismatchDestination), mismatchSentinel)
        XCTAssertEqual(gate.state, .terminalLocked(reason: "renderError.postRender"))
    }

    func testValidatedMissingRejectsNewlyAppearedFileAndAcceptsOnlyMatchingSession() throws {
        let gate = AssetTrackerLegacyWriteGate(loadIDGenerator: { "missing-load" }, tokenGenerator: { "missing-token" })
        let loadID = gate.registerLoad(.missingResult(path: "/book"), retry: false)
        _ = try gate.confirm(protocolVersion: 2, loadID: loadID, outcome: .missing, reason: nil, validatedSourceHash: nil)
        let request = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "missing-token",
            expectedHash: nil,
            validatedSourceHash: nil
        )

        XCTAssertNoThrow(try gate.authorizeSave(request, currentSource: .missingResult(path: "/book")))
        XCTAssertThrowsError(try gate.authorizeSave(
            request,
            currentSource: .readableResult(hash: String(repeating: "9", count: 64), path: "/book")
        )) { error in
            XCTAssertEqual(error as? AssetTrackerWriteGateError, .sourceChanged)
        }
    }

    func testFoundationJSONSerializationMatchesWebSurrogatePolicy() throws {
        let paired = Data(#"{"known":"\ud83d\udcb0","unknown":{"\ud83d\udcb0":true}}"#.utf8)
        XCTAssertNoThrow(try JSONSerialization.jsonObject(with: paired))

        for raw in [
            #"{"known":"\ud800"}"#,
            #"{"unknown":{"nested":"\udfff"}}"#,
            #"{"unknown":{"\ud800":true}}"#
        ] {
            XCTAssertThrowsError(try JSONSerialization.jsonObject(with: Data(raw.utf8)), raw)
        }
    }

    func testSerialRawIOExecutorIsFIFOWithMaximumOneActiveTask() {
        let finished = expectation(description: "all raw I/O tasks finished")
        finished.expectedFulfillmentCount = 3
        let firstStarted = expectation(description: "first raw I/O task started")
        let releaseFirst = DispatchSemaphore(value: 0)
        let observation = RawIOExecutionObservation()
        let executor = AssetTrackerSerialRawIOExecutor(label: "AssetTrackerCoreTests.raw-io")

        for index in 0..<3 {
            executor.execute {
                observation.enter(index: index, isMainThread: Thread.isMainThread)
                if index == 0 {
                    firstStarted.fulfill()
                    releaseFirst.wait()
                }
                observation.leave()
                finished.fulfill()
            }
        }

        wait(for: [firstStarted], timeout: 2)
        XCTAssertEqual(observation.order, [0])
        releaseFirst.signal()
        wait(for: [finished], timeout: 2)
        XCTAssertEqual(observation.order, [0, 1, 2])
        XCTAssertEqual(observation.maximumActive, 1)
        XCTAssertEqual(observation.mainThreadExecutions, 0)
    }

    @MainActor
    func testProductionBridgeResponsePipelineEncodesLargeLoadOffMainAndDeliversOnMainInFIFOOrder() async throws {
        let root = temporaryRoot("large-load-response")
        removeAfterTest(root)
        let encoded = expectation(description: "large response encoded off main")
        encoded.expectedFulfillmentCount = 2
        let delivered = expectation(description: "responses delivered on main")
        delivered.expectedFulfillmentCount = 2
        let observation = BridgeResponseThreadObservation(encoded: encoded)
        let encoder = AssetTrackerBridgeResponseEncoder { isMainThread in
            observation.recordEncoding(isMainThread: isMainThread)
        }
        let rawIOExecutor = AssetTrackerSerialRawIOExecutor(label: "AssetTrackerCoreTests.bridge-response")
        let pipeline = AssetTrackerBridgeResponsePipeline(
            rawIOExecutor: rawIOExecutor,
            encoder: encoder
        ) { javascript in
            observation.recordDelivery(javascript: javascript, isMainThread: Thread.isMainThread)
            delivered.fulfill()
        }
        let hostileFragment = #"\"quoted\"\n</script>\\tail  中文"#
        let largeStateJSON = String(repeating: hostileFragment, count: 250_000)
        let sourceData = Data(largeStateJSON.utf8)
        _ = try writeSource(sourceData, root: root)
        let hash = sha256(sourceData)
        let store = RecordingBookStoreIO(
            underlying: AssetTrackerBookStore(storageDirectoryURL: root)
        )
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: rawIOExecutor,
            writeGate: AssetTrackerLegacyWriteGate(loadIDGenerator: { "large-load" }),
            operationIDGenerator: { "large-load-operation" }
        )

        _ = try coordinator.startLoad(retry: false) { result in
            XCTAssertTrue(Thread.isMainThread)
            guard case .success(let loaded) = result else {
                return XCTFail("large production load should succeed")
            }
            pipeline.send(.loadSuccess(requestID: "load-response", loaded: loaded))
            pipeline.send(.failure(requestID: "second-response", error: "after large load"))
        }

        await fulfillment(of: [encoded, delivered], timeout: 10)
        XCTAssertEqual(store.observation.loadCalls, 1)
        XCTAssertEqual(store.observation.mainThreadStoreCalls, 0)
        XCTAssertEqual(observation.encodingMainThreadFlags, [false, false])
        XCTAssertEqual(observation.deliveryMainThreadFlags, [true, true])
        XCTAssertEqual(observation.deliveredRequestIDs, ["load-response", "second-response"])
        let firstResponse = try XCTUnwrap(observation.decodedResponses.first)
        let result = try XCTUnwrap(firstResponse["result"] as? [String: Any])
        XCTAssertEqual(result["stateJson"] as? String, largeStateJSON)
        XCTAssertEqual(result["rawHash"] as? String, hash)
        XCTAssertEqual(result["loadId"] as? String, "large-load")
    }

    @MainActor
    func testBridgeResponsePipelineDeliversStableRequestScopedFallbackWhenPrimaryEncoderFails() async throws {
        let delivered = expectation(description: "fallback response delivered")
        let observation = FailingBridgeEncoderObservation()
        let requestID = "fallback-\"quoted\"\n</script>&\\tail\u{2028}中文💰"
        var deliveredJavaScript: String?
        var deliveredOnMain = false
        let pipeline = AssetTrackerBridgeResponsePipeline(
            rawIOExecutor: AssetTrackerSerialRawIOExecutor(label: "AssetTrackerCoreTests.bridge-fallback"),
            encoder: AlwaysFailingBridgeResponseEncoder(observation: observation)
        ) { javascript in
            deliveredJavaScript = javascript
            deliveredOnMain = Thread.isMainThread
            delivered.fulfill()
        }

        pipeline.send(.success(requestID: requestID, result: .string("unencodable fixture")))
        await fulfillment(of: [delivered], timeout: 2)

        XCTAssertEqual(observation.callCount, 1, "fallback must not reuse the failing primary encoder")
        XCTAssertEqual(observation.mainThreadFlags, [false])
        XCTAssertTrue(deliveredOnMain)
        let javascript = try XCTUnwrap(deliveredJavaScript)
        let prefix = "window.AssetTrackerHost && window.AssetTrackerHost.__handleResponse("
        let suffix = ");"
        XCTAssertTrue(javascript.hasPrefix(prefix))
        XCTAssertTrue(javascript.hasSuffix(suffix))
        let objectStart = javascript.index(javascript.startIndex, offsetBy: prefix.count)
        let objectEnd = javascript.index(javascript.endIndex, offsetBy: -suffix.count)
        let objectJSON = String(javascript[objectStart..<objectEnd])
        let response = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(objectJSON.utf8)
        ) as? [String: Any])
        XCTAssertEqual(response["id"] as? String, requestID)
        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertEqual(response["error"] as? String, "Native response encoding failed")
        XCTAssertFalse(javascript.contains("</script>"))
        XCTAssertTrue(javascript.contains("\\u0026"))
        XCTAssertFalse(javascript.contains("\u{2028}"))
    }

    @MainActor
    func testStorageCoordinatorIgnoresLateS1CompletionWhileS2IsActiveAndRejectsConflicts() async throws {
        let root = temporaryRoot("late-completion")
        removeAfterTest(root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let store = RecordingBookStoreIO(underlying: underlying)
        let executor = ControllableRawIOExecutor()
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "load-s2" },
            tokenGenerator: { "unused" }
        )
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            writeGate: gate,
            operationIDGenerator: SequenceGenerator(["operation-s1", "operation-s2"]).next
        )
        let s1Cancelled = expectation(description: "s1 cancelled")
        let s2Completed = expectation(description: "s2 completed")

        let s1 = try coordinator.startLoad(retry: false) { result in
            if case .failure = result { s1Cancelled.fulfill() }
        }
        try coordinator.cancelOperation(operationID: s1)
        await fulfillment(of: [s1Cancelled], timeout: 2)
        let s2 = try coordinator.startLoad(retry: false) { result in
            if case .success = result { s2Completed.fulfill() }
        }
        XCTAssertEqual(s2, "operation-s2")
        XCTAssertEqual(coordinator.activity, .loading(operationID: "operation-s2"))

        let authorization = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: "unused",
            writeSessionToken: nil,
            expectedHash: nil,
            validatedSourceHash: nil
        )
        let saveRequest = AssetTrackerStorageSaveRequest(
            authorization: authorization,
            stateJson: "{}",
            schemaVersion: 1,
            reason: "conflict"
        )
        XCTAssertThrowsError(try coordinator.startLoad(retry: false) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertThrowsError(try coordinator.startSave(request: saveRequest) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertThrowsError(try coordinator.startRawExport(
            expectedHash: String(repeating: "a", count: 64),
            destinationURL: root.appendingPathComponent("export.raw")
        ) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertThrowsError(try coordinator.confirmLoad(
            protocolVersion: 2,
            loadID: "load-s2",
            outcome: .missing,
            reason: nil,
            validatedSourceHash: nil
        )) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }

        executor.runTask(at: 0)
        await Task.yield()
        XCTAssertEqual(coordinator.activity, .loading(operationID: "operation-s2"))
        XCTAssertEqual(gate.state, .neverLoaded)

        executor.runTask(at: 1)
        await fulfillment(of: [s2Completed], timeout: 2)
        XCTAssertEqual(coordinator.activity, .idle)
        XCTAssertEqual(gate.state, .candidateMissing(loadID: "load-s2"))
    }

    @MainActor
    func testStorageCoordinatorUsesInternalGenerationWhenOperationIDGeneratorRepeats() async throws {
        let firstHash = String(repeating: "d", count: 64)
        let secondHash = String(repeating: "e", count: 64)
        let store = SequencedLoadBookStoreIO(results: [
            .readableResult(hash: firstHash, path: "/book-s1"),
            .readableResult(hash: secondHash, path: "/book-s2")
        ])
        let executor = ControllableRawIOExecutor()
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "load-s2" },
            tokenGenerator: { "unused" }
        )
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            writeGate: gate,
            operationIDGenerator: { "duplicate-operation-id" }
        )
        let s1Cancelled = expectation(description: "s1 cancelled")
        let s2Completed = expectation(description: "s2 completed only by s2")
        var s2Hashes: [String?] = []

        let s1 = try coordinator.startLoad(retry: false) { result in
            if case .failure(let error) = result,
               error as? AssetTrackerStorageCoordinatorError == .cancelled {
                s1Cancelled.fulfill()
            }
        }
        try coordinator.cancelOperation(operationID: s1)
        await fulfillment(of: [s1Cancelled], timeout: 2)
        let s2 = try coordinator.startLoad(retry: false) { result in
            guard case .success(let loaded) = result else { return }
            s2Hashes.append(loaded.book.rawHash)
            s2Completed.fulfill()
        }
        XCTAssertEqual(s1, s2, "the public operation ID generator is allowed to repeat")

        executor.runTask(at: 0)
        await Task.yield()
        XCTAssertEqual(s2Hashes, [], "S1 late completion must not consume S2's completion")
        XCTAssertEqual(coordinator.activity, .loading(operationID: "duplicate-operation-id"))
        XCTAssertEqual(gate.state, .neverLoaded)

        executor.runTask(at: 1)
        await fulfillment(of: [s2Completed], timeout: 2)
        XCTAssertEqual(s2Hashes, [secondHash])
        XCTAssertEqual(coordinator.activity, .idle)
        XCTAssertEqual(gate.state, .candidateExisting(loadID: "load-s2", rawHash: secondHash))
    }

    @MainActor
    func testStorageCoordinatorGenerationExhaustionFailsClosedBeforeSchedulingIO() throws {
        let root = temporaryRoot("generation-exhaustion")
        removeAfterTest(root)
        let store = RecordingBookStoreIO(
            underlying: AssetTrackerBookStore(storageDirectoryURL: root)
        )
        let executor = ControllableRawIOExecutor()
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            operationIDGenerator: { "unused-operation" },
            initialOperationGeneration: .max
        )

        XCTAssertThrowsError(try coordinator.startLoad(retry: false) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .generationExhausted)
        }
        XCTAssertEqual(coordinator.activity, .idle)
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(executor.taskCount, 0)
    }

    @MainActor
    func testRepeatedSaveOperationIDUsesInternalGenerationAcrossDurableSingleFlight() async throws {
        let root = temporaryRoot("repeated-save-operation")
        removeAfterTest(root)
        let original = Data(#"{"memo":"original"}"#.utf8)
        _ = try writeSource(original, root: root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let originalLoad = underlying.load()
        let originalHash = try XCTUnwrap(originalLoad.rawHash)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "save-load" },
            tokenGenerator: { "save-token" }
        )
        let loadID = gate.registerLoad(originalLoad, retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: originalHash
        )
        let authorization = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "save-token",
            expectedHash: originalHash,
            validatedSourceHash: originalHash
        )
        let store = RecordingBookStoreIO(underlying: underlying)
        let executor = ControllableRawIOExecutor()
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: executor,
            writeGate: gate,
            operationIDGenerator: { "duplicate-save-id" }
        )
        let s1Completed = expectation(description: "s1 save completed")
        let s2Completed = expectation(description: "s2 save completed")
        let s1Request = AssetTrackerStorageSaveRequest(
            authorization: authorization,
            stateJson: #"{"memo":"S1 must never write"}"#,
            schemaVersion: 1,
            reason: "s1"
        )
        var s1Hash: String?
        let s1 = try coordinator.startSave(request: s1Request) { result in
            if case .success(let receipt) = result {
                s1Hash = receipt.rawHash
                s1Completed.fulfill()
            }
        }
        XCTAssertThrowsError(try coordinator.cancelOperation(operationID: s1)) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertThrowsError(try coordinator.startSave(request: s1Request) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertEqual(executor.taskCount, 1)

        executor.runTask(at: 0)
        await fulfillment(of: [s1Completed], timeout: 2)
        let committedS1Hash = try XCTUnwrap(s1Hash)
        let s2Request = AssetTrackerStorageSaveRequest(
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: loadID,
                writeSessionToken: "save-token",
                expectedHash: committedS1Hash,
                validatedSourceHash: committedS1Hash
            ),
            stateJson: #"{"memo":"S2 only"}"#,
            schemaVersion: 1,
            reason: "s2"
        )
        let s2 = try coordinator.startSave(request: s2Request) { result in
            if case .success = result { s2Completed.fulfill() }
        }
        XCTAssertEqual(s1, s2)
        XCTAssertEqual(executor.taskCount, 2)

        executor.runTask(at: 1)
        await fulfillment(of: [s2Completed], timeout: 2)
        XCTAssertEqual(store.observation.saveCalls, 2)
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(contentsOf: underlying.storageFileURL)
        ) as? [String: Any])
        XCTAssertEqual((saved["payload"] as? [String: Any])?["memo"] as? String, "S2 only")
    }

    @MainActor
    func testProductionSaveEntryRunsRealReadHashJSONAndWriteOffMainAndRejectsSecondSave() async throws {
        let root = temporaryRoot("paused-save")
        removeAfterTest(root)
        let original = Data(#"{"memo":"old"}"#.utf8)
        _ = try writeSource(original, root: root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let initial = underlying.load()
        let hash = try XCTUnwrap(initial.rawHash)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "load-paused" },
            tokenGenerator: { "token-paused" }
        )
        let loadID = gate.registerLoad(initial, retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: hash
        )
        let authorization = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "token-paused",
            expectedHash: hash,
            validatedSourceHash: hash
        )
        let store = RecordingBookStoreIO(underlying: underlying, pauseFirstSave: true)
        let operations = SequenceGenerator(["save-one", "save-two"])
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: AssetTrackerSerialRawIOExecutor(label: "AssetTrackerCoreTests.paused-save"),
            writeGate: gate,
            operationIDGenerator: operations.next
        )
        let saveRequest = AssetTrackerStorageSaveRequest(
            authorization: authorization,
            stateJson: #"{"memo":"new"}"#,
            schemaVersion: 1,
            reason: "test"
        )
        let firstCompleted = expectation(description: "first save completed")
        var resultAtACK: AssetTrackerBookSaveResult?
        var gateStateAtACK: AssetTrackerLegacyWriteGateState?

        _ = try coordinator.startSave(request: saveRequest) { result in
            XCTAssertTrue(Thread.isMainThread)
            if case .success(let saved) = result {
                resultAtACK = saved
                gateStateAtACK = gate.state
            }
            firstCompleted.fulfill()
        }

        await fulfillment(of: [store.firstSaveStarted], timeout: 2)
        XCTAssertThrowsError(try coordinator.startSave(request: saveRequest) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 1)

        store.releaseFirstSave()
        await fulfillment(of: [firstCompleted], timeout: 2)
        let saved = try XCTUnwrap(resultAtACK)
        XCTAssertEqual(
            gateStateAtACK,
            .validatedExisting(loadID: loadID, rawHash: saved.rawHash, token: "token-paused")
        )
        XCTAssertEqual(coordinator.activity, .idle)
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 1)
        XCTAssertEqual(store.observation.mainThreadStoreCalls, 0)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(contentsOf: underlying.storageFileURL)
        ) as? [String: Any])
        XCTAssertEqual((object["payload"] as? [String: Any])?["memo"] as? String, "new")
    }

    @MainActor
    func testProductionSaveEntryReportsStoreFailureOnMainAndKeepsGateAtH0() async throws {
        let root = temporaryRoot("failed-save")
        removeAfterTest(root)
        let original = Data(#"{"memo":"old"}"#.utf8)
        _ = try writeSource(original, root: root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let initial = underlying.load()
        let originalHash = try XCTUnwrap(initial.rawHash)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "load-failed-save" },
            tokenGenerator: { "token-failed-save" }
        )
        let loadID = gate.registerLoad(initial, retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .valid,
            reason: nil,
            validatedSourceHash: originalHash
        )
        let authorization = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: "token-failed-save",
            expectedHash: originalHash,
            validatedSourceHash: originalHash
        )
        let store = RecordingBookStoreIO(
            underlying: underlying,
            saveError: TestBookStoreError.injectedWriteFailure
        )
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: AssetTrackerSerialRawIOExecutor(label: "AssetTrackerCoreTests.failed-save"),
            writeGate: gate,
            operationIDGenerator: { "save-failed" }
        )
        let request = AssetTrackerStorageSaveRequest(
            authorization: authorization,
            stateJson: #"{"memo":"must-not-write"}"#,
            schemaVersion: 1,
            reason: "test-failure"
        )
        let failed = expectation(description: "failed save response")
        var responseWasOnMain = false
        var responseError: Error?

        _ = try coordinator.startSave(request: request) { result in
            responseWasOnMain = Thread.isMainThread
            if case .failure(let error) = result { responseError = error }
            failed.fulfill()
        }
        await fulfillment(of: [failed], timeout: 2)

        XCTAssertTrue(responseWasOnMain)
        XCTAssertEqual(responseError as? TestBookStoreError, .injectedWriteFailure)
        XCTAssertEqual(
            gate.state,
            .validatedExisting(loadID: loadID, rawHash: originalHash, token: "token-failed-save")
        )
        XCTAssertEqual(coordinator.activity, .idle)
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 1)
        XCTAssertEqual(store.observation.mainThreadStoreCalls, 0)
        XCTAssertEqual(try Data(contentsOf: underlying.storageFileURL), original)
    }

    @MainActor
    func testSaveWritingCannotBeCancelledOrAdmitAnotherOperation() async throws {
        let root = temporaryRoot("non-cancellable-write")
        removeAfterTest(root)
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let gate = AssetTrackerLegacyWriteGate(
            loadIDGenerator: { "load-missing-write" },
            tokenGenerator: { "token-missing-write" }
        )
        let loadID = gate.registerLoad(.missingResult(path: underlying.storageFileURL.path), retry: false)
        _ = try gate.confirm(
            protocolVersion: 2,
            loadID: loadID,
            outcome: .missing,
            reason: nil,
            validatedSourceHash: nil
        )
        let request = AssetTrackerStorageSaveRequest(
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: 2,
                loadID: loadID,
                writeSessionToken: "token-missing-write",
                expectedHash: nil,
                validatedSourceHash: nil
            ),
            stateJson: #"{"memo":"committed"}"#,
            schemaVersion: 1,
            reason: "non-cancellable"
        )
        let executor = ControllableRawIOExecutor()
        let coordinator = AssetTrackerStorageCoordinator(
            store: underlying,
            rawIOExecutor: executor,
            writeGate: gate,
            operationIDGenerator: SequenceGenerator(["save-s1", "save-s2"]).next
        )
        let completed = expectation(description: "uncancelled save completed")

        let operationID = try coordinator.startSave(request: request) { result in
            if case .success = result { completed.fulfill() }
        }
        XCTAssertEqual(coordinator.activity, .saveWriting(operationID: operationID))

        XCTAssertThrowsError(try coordinator.cancelOperation(operationID: operationID)) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertEqual(coordinator.activity, .saveWriting(operationID: operationID))
        XCTAssertThrowsError(try coordinator.startLoad(retry: false) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }

        XCTAssertEqual(executor.taskCount, 1)
        executor.runTask(at: 0)
        await fulfillment(of: [completed], timeout: 2)
        XCTAssertEqual(coordinator.activity, .idle)
        guard case .validatedExisting(let completedLoadID, _, let token) = gate.state else {
            return XCTFail("successful write must advance the gate")
        }
        XCTAssertEqual(completedLoadID, loadID)
        XCTAssertEqual(token, "token-missing-write")
    }

    @MainActor
    func testProductionRawExportEntryIsOffMainExactAndSingleFlight() async throws {
        let root = temporaryRoot("coordinated-export-source")
        let exportRoot = temporaryRoot("coordinated-export-destination")
        removeAfterTest(root)
        removeAfterTest(exportRoot)
        let original = Data([0xff, 0xfe, 0x00, 0x7b, 0x7d])
        _ = try writeSource(original, root: root)
        try FileManager.default.createDirectory(at: exportRoot, withIntermediateDirectories: true)
        let destination = exportRoot.appendingPathComponent("book.raw")
        let secondDestination = exportRoot.appendingPathComponent("book-second.raw")
        let underlying = AssetTrackerBookStore(storageDirectoryURL: root)
        let store = RecordingBookStoreIO(underlying: underlying, pauseFirstExport: true)
        let coordinator = AssetTrackerStorageCoordinator(
            store: store,
            rawIOExecutor: AssetTrackerSerialRawIOExecutor(label: "AssetTrackerCoreTests.paused-export"),
            operationIDGenerator: SequenceGenerator(["export-one", "export-two"]).next
        )
        let completed = expectation(description: "raw export completed")
        var responseWasOnMain = false
        var exportedResult: AssetTrackerRawExportResult?

        _ = try coordinator.startRawExport(
            expectedHash: sha256(original),
            destinationURL: destination
        ) { result in
            responseWasOnMain = Thread.isMainThread
            if case .success(let exported) = result { exportedResult = exported }
            completed.fulfill()
        }
        await fulfillment(of: [store.firstExportStarted], timeout: 2)
        XCTAssertThrowsError(try coordinator.startRawExport(
            expectedHash: sha256(original),
            destinationURL: secondDestination
        ) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertEqual(store.observation.exportCalls, 1)

        store.releaseFirstExport()
        await fulfillment(of: [completed], timeout: 2)
        let exported = try XCTUnwrap(exportedResult)
        XCTAssertTrue(responseWasOnMain)
        XCTAssertEqual(exported.rawHash, sha256(original))
        XCTAssertEqual(exported.byteCount, original.count)
        XCTAssertEqual(try Data(contentsOf: destination), original)
        XCTAssertFalse(FileManager.default.fileExists(atPath: secondDestination.path))
        XCTAssertEqual(store.observation.exportCalls, 1)
        XCTAssertEqual(store.observation.mainThreadStoreCalls, 0)
        XCTAssertEqual(coordinator.activity, .idle)
    }
}

private final class SequenceGenerator {
    private var values: [String]

    init(_ values: [String]) {
        self.values = values
    }

    func next() -> String {
        values.removeFirst()
    }
}

private enum TestBookStoreError: Error, Equatable {
    case injectedWriteFailure
    case injectedDurabilityFault
}

private final class DurableBookFaultObservation: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [NativeDurabilityFaultEvent] = []

    func record(_ event: NativeDurabilityFaultEvent) {
        lock.withLock { events.append(event) }
    }

    func snapshot() -> [NativeDurabilityFaultEvent] {
        lock.withLock { events }
    }
}

private final class LockedBooleanObservation: @unchecked Sendable {
    private let lock = NSLock()
    private var storedValue = false

    var value: Bool { lock.withLock { storedValue } }

    func setTrue() {
        lock.withLock { storedValue = true }
    }
}

private final class BookStoreIOObservation: @unchecked Sendable {
    private let lock = NSLock()
    private var storedLoadCalls = 0
    private var storedLegacySaveCalls = 0
    private var storedDurableSaveCalls = 0
    private var storedSnapshotCalls = 0
    private var storedExportCalls = 0
    private var storedMainThreadStoreCalls = 0

    var loadCalls: Int { lock.withLock { storedLoadCalls } }
    var saveCalls: Int { lock.withLock { storedLegacySaveCalls + storedDurableSaveCalls } }
    var legacySaveCalls: Int { lock.withLock { storedLegacySaveCalls } }
    var durableSaveCalls: Int { lock.withLock { storedDurableSaveCalls } }
    var snapshotCalls: Int { lock.withLock { storedSnapshotCalls } }
    var exportCalls: Int { lock.withLock { storedExportCalls } }
    var mainThreadStoreCalls: Int { lock.withLock { storedMainThreadStoreCalls } }

    func recordLoad() {
        lock.withLock {
            storedLoadCalls += 1
            if Thread.isMainThread { storedMainThreadStoreCalls += 1 }
        }
    }

    func recordLegacySave() {
        lock.withLock {
            storedLegacySaveCalls += 1
            if Thread.isMainThread { storedMainThreadStoreCalls += 1 }
        }
    }

    func recordDurableSave() {
        lock.withLock {
            storedDurableSaveCalls += 1
            if Thread.isMainThread { storedMainThreadStoreCalls += 1 }
        }
    }

    func recordSnapshot() {
        lock.withLock {
            storedSnapshotCalls += 1
            if Thread.isMainThread { storedMainThreadStoreCalls += 1 }
        }
    }

    func recordExport() {
        lock.withLock {
            storedExportCalls += 1
            if Thread.isMainThread { storedMainThreadStoreCalls += 1 }
        }
    }
}

private final class RecordingBookStoreIO: AssetTrackerDurableBookStoreIO, @unchecked Sendable {
    let observation = BookStoreIOObservation()
    let firstLoadStarted = XCTestExpectation(description: "first store load started")
    let firstSaveStarted = XCTestExpectation(description: "first durable save started")
    let firstExportStarted = XCTestExpectation(description: "first raw export started")

    private let underlying: AssetTrackerBookStore
    private let pauseFirstLoad: Bool
    private let pauseFirstSave: Bool
    private let pauseFirstExport: Bool
    private let saveError: Error?
    private let releaseLoad = DispatchSemaphore(value: 0)
    private let releaseSave = DispatchSemaphore(value: 0)
    private let releaseExport = DispatchSemaphore(value: 0)
    private let pauseLock = NSLock()
    private var hasPaused = false
    private var hasPausedSave = false
    private var hasPausedExport = false

    init(
        underlying: AssetTrackerBookStore,
        pauseFirstLoad: Bool = false,
        pauseFirstSave: Bool = false,
        pauseFirstExport: Bool = false,
        saveError: Error? = nil
    ) {
        self.underlying = underlying
        self.pauseFirstLoad = pauseFirstLoad
        self.pauseFirstSave = pauseFirstSave
        self.pauseFirstExport = pauseFirstExport
        self.saveError = saveError
    }

    func load() -> AssetTrackerRawBookLoadResult {
        observation.recordLoad()
        let result = underlying.load()
        let shouldPause = pauseLock.withLock { () -> Bool in
            guard pauseFirstLoad, !hasPaused else { return false }
            hasPaused = true
            return true
        }
        if shouldPause {
            firstLoadStarted.fulfill()
            releaseLoad.wait()
        }
        return result
    }

    func save(stateJson: String, schemaVersion: Int, reason: String) throws -> AssetTrackerBookSaveResult {
        observation.recordLegacySave()
        if let saveError { throw saveError }
        return try underlying.save(stateJson: stateJson, schemaVersion: schemaVersion, reason: reason)
    }

    func saveDurably(_ request: DurableBookSaveRequest) throws -> NativeDurableSaveReceipt {
        observation.recordDurableSave()
        let shouldPause = pauseLock.withLock { () -> Bool in
            guard pauseFirstSave, !hasPausedSave else { return false }
            hasPausedSave = true
            return true
        }
        if shouldPause {
            firstSaveStarted.fulfill()
            releaseSave.wait()
        }
        if let saveError { throw saveError }
        return try underlying.saveDurably(request)
    }

    func snapshot(_ request: NativeSnapshotRequest) throws -> NativeSnapshotReceipt {
        observation.recordSnapshot()
        return try underlying.snapshot(request)
    }

    func exportRawBook(expectedHash: String, to destinationURL: URL) throws -> AssetTrackerRawExportResult {
        observation.recordExport()
        let shouldPause = pauseLock.withLock { () -> Bool in
            guard pauseFirstExport, !hasPausedExport else { return false }
            hasPausedExport = true
            return true
        }
        if shouldPause {
            firstExportStarted.fulfill()
            releaseExport.wait()
        }
        return try underlying.exportRawBook(expectedHash: expectedHash, to: destinationURL)
    }

    func releaseFirstLoad() {
        releaseLoad.signal()
    }

    func releaseFirstSave() {
        releaseSave.signal()
    }

    func releaseFirstExport() {
        releaseExport.signal()
    }
}

private final class SequencedLoadBookStoreIO: AssetTrackerDurableBookStoreIO, @unchecked Sendable {
    private let lock = NSLock()
    private var results: [AssetTrackerRawBookLoadResult]

    init(results: [AssetTrackerRawBookLoadResult]) {
        self.results = results
    }

    func load() -> AssetTrackerRawBookLoadResult {
        lock.withLock { results.removeFirst() }
    }

    func save(stateJson: String, schemaVersion: Int, reason: String) throws -> AssetTrackerBookSaveResult {
        fatalError("save is not used by this fixture")
    }

    func saveDurably(_ request: DurableBookSaveRequest) throws -> NativeDurableSaveReceipt {
        fatalError("saveDurably is not used by this fixture")
    }

    func snapshot(_ request: NativeSnapshotRequest) throws -> NativeSnapshotReceipt {
        fatalError("snapshot is not used by this fixture")
    }

    func exportRawBook(expectedHash: String, to destinationURL: URL) throws -> AssetTrackerRawExportResult {
        fatalError("export is not used by this fixture")
    }
}

private final class RawIOExecutionObservation: @unchecked Sendable {
    private let lock = NSLock()
    private var storedOrder: [Int] = []
    private var active = 0
    private var storedMaximumActive = 0
    private var storedMainThreadExecutions = 0

    var order: [Int] { lock.withLock { storedOrder } }
    var maximumActive: Int { lock.withLock { storedMaximumActive } }
    var mainThreadExecutions: Int { lock.withLock { storedMainThreadExecutions } }

    func enter(index: Int, isMainThread: Bool) {
        lock.withLock {
            storedOrder.append(index)
            active += 1
            storedMaximumActive = max(storedMaximumActive, active)
            if isMainThread { storedMainThreadExecutions += 1 }
        }
    }

    func leave() {
        lock.withLock { active -= 1 }
    }
}

private final class ControllableRawIOExecutor: AssetTrackerRawIOExecuting, @unchecked Sendable {
    private let lock = NSLock()
    private var tasks: [@Sendable () -> Void] = []

    var taskCount: Int { lock.withLock { tasks.count } }

    func execute(_ work: @escaping @Sendable () -> Void) {
        lock.withLock { tasks.append(work) }
    }

    func runTask(at index: Int) {
        let task = lock.withLock { tasks[index] }
        task()
    }
}

private final class BridgeResponseThreadObservation: @unchecked Sendable {
    private let lock = NSLock()
    private let encoded: XCTestExpectation
    private var storedEncodingMainThreadFlags: [Bool] = []
    private var storedDeliveryMainThreadFlags: [Bool] = []
    private var storedJavaScripts: [String] = []

    init(encoded: XCTestExpectation) {
        self.encoded = encoded
    }

    var encodingMainThreadFlags: [Bool] { lock.withLock { storedEncodingMainThreadFlags } }
    var deliveryMainThreadFlags: [Bool] { lock.withLock { storedDeliveryMainThreadFlags } }
    var deliveredRequestIDs: [String] {
        decodedResponses.compactMap { $0["id"] as? String }
    }
    var decodedResponses: [[String: Any]] {
        lock.withLock { storedJavaScripts }.compactMap(Self.decodeResponse)
    }

    func recordEncoding(isMainThread: Bool) {
        lock.withLock { storedEncodingMainThreadFlags.append(isMainThread) }
        encoded.fulfill()
    }

    func recordDelivery(javascript: String, isMainThread: Bool) {
        lock.withLock {
            storedDeliveryMainThreadFlags.append(isMainThread)
            storedJavaScripts.append(javascript)
        }
    }

    private static func decodeResponse(_ javascript: String) -> [String: Any]? {
        let prefix = "window.AssetTrackerHost && window.AssetTrackerHost.__handleResponse(JSON.parse("
        let suffix = "));"
        guard javascript.hasPrefix(prefix), javascript.hasSuffix(suffix) else { return nil }
        let literalStart = javascript.index(javascript.startIndex, offsetBy: prefix.count)
        let literalEnd = javascript.index(javascript.endIndex, offsetBy: -suffix.count)
        let jsonStringLiteral = String(javascript[literalStart..<literalEnd])
        guard
            let wrapperData = "[\(jsonStringLiteral)]".data(using: .utf8),
            let wrapper = try? JSONSerialization.jsonObject(with: wrapperData) as? [String],
            let responseJSON = wrapper.first,
            let responseData = responseJSON.data(using: .utf8),
            let response = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any]
        else {
            return nil
        }
        return response
    }
}

private final class FailingBridgeEncoderObservation: @unchecked Sendable {
    private let lock = NSLock()
    private var storedMainThreadFlags: [Bool] = []

    var callCount: Int { lock.withLock { storedMainThreadFlags.count } }
    var mainThreadFlags: [Bool] { lock.withLock { storedMainThreadFlags } }

    func recordCall() {
        lock.withLock { storedMainThreadFlags.append(Thread.isMainThread) }
    }
}

private struct AlwaysFailingBridgeResponseEncoder: AssetTrackerBridgeResponseEncoding {
    let observation: FailingBridgeEncoderObservation

    func javaScript(for response: AssetTrackerBridgeResponse) throws -> String {
        observation.recordCall()
        throw AssetTrackerBridgeResponseEncodingError.invalidJSONObject
    }
}

private extension NSLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
