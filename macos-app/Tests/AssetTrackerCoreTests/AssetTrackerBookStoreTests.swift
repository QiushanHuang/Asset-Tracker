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
    func testTerminalizeDuringSaveReadingCancelsBeforeLateReadCanScheduleAWrite() async throws {
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
        let cancelled = expectation(description: "save read cancelled")
        let terminalized = expectation(description: "save read terminalized")
        var completionOrder: [String] = []

        _ = try coordinator.startSave(request: request) { result in
            if case .failure(let error) = result {
                XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .cancelled)
                completionOrder.append("save.cancelled")
                cancelled.fulfill()
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

        await fulfillment(of: [cancelled, terminalized], timeout: 2)
        XCTAssertEqual(completionOrder, ["save.cancelled", "terminalized"])
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 0)
        XCTAssertThrowsError(try coordinator.startSave(request: request) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerWriteGateError, .terminalLocked)
        }
        XCTAssertEqual(store.observation.loadCalls, 0)
        XCTAssertEqual(store.observation.saveCalls, 0)

        executor.runTask(at: 0)
        await Task.yield()
        XCTAssertEqual(store.observation.loadCalls, 1)
        XCTAssertEqual(store.observation.saveCalls, 0)
        XCTAssertEqual(try Data(contentsOf: underlying.storageFileURL), original)
        XCTAssertEqual(gate.state, .terminalLocked(reason: "internalError.postRender"))
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
        executor.runTask(at: 0)
        await Task.yield()
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
        XCTAssertEqual(store.observation.loadCalls, 1)
        XCTAssertEqual(store.observation.saveCalls, 0)

        executor.runTask(at: 1)
        await fulfillment(of: [saveCompleted, terminalized], timeout: 2)
        XCTAssertEqual(completionOrder, ["save.success", "terminal.first", "terminal.duplicate"])
        XCTAssertEqual(terminalReasons, ["internalError.postRender", "internalError.postRender"])
        XCTAssertEqual(gate.state, .terminalLocked(reason: "internalError.postRender"))
        XCTAssertEqual(store.observation.loadCalls, 1)
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
        XCTAssertEqual(store.observation.loadCalls, 1)
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
        executor.runTask(at: 0)
        await Task.yield()
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

        executor.runTask(at: 1)
        await fulfillment(of: [saveFailed, terminalized], timeout: 2)
        XCTAssertEqual(completionOrder, ["save.failure", "terminalized"])
        XCTAssertEqual(gate.state, .terminalLocked(reason: "internalError.postRender"))
        XCTAssertEqual(store.observation.loadCalls, 1)
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
    func testCancelledSaveReadLateCompletionCannotWriteOrConsumeNextSaveWithRepeatedOperationID() async throws {
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
        let cancelled = expectation(description: "s1 save cancelled")
        let s2Completed = expectation(description: "s2 save completed")
        let s1Request = AssetTrackerStorageSaveRequest(
            authorization: authorization,
            stateJson: #"{"memo":"S1 must never write"}"#,
            schemaVersion: 1,
            reason: "s1"
        )
        let s2Request = AssetTrackerStorageSaveRequest(
            authorization: authorization,
            stateJson: #"{"memo":"S2 only"}"#,
            schemaVersion: 1,
            reason: "s2"
        )

        let s1 = try coordinator.startSave(request: s1Request) { result in
            if case .failure(let error) = result,
               error as? AssetTrackerStorageCoordinatorError == .cancelled {
                cancelled.fulfill()
            }
        }
        try coordinator.cancelOperation(operationID: s1)
        await fulfillment(of: [cancelled], timeout: 2)
        let s2 = try coordinator.startSave(request: s2Request) { result in
            if case .success = result { s2Completed.fulfill() }
        }
        XCTAssertEqual(s1, s2)

        executor.runTask(at: 0)
        await Task.yield()
        XCTAssertEqual(store.observation.saveCalls, 0)
        XCTAssertEqual(coordinator.activity, .saveReading(operationID: "duplicate-save-id"))
        XCTAssertEqual(try Data(contentsOf: underlying.storageFileURL), original)

        executor.runTask(at: 1)
        await Task.yield()
        XCTAssertEqual(store.observation.saveCalls, 0)
        XCTAssertEqual(coordinator.activity, .saveWriting(operationID: "duplicate-save-id"))

        executor.runTask(at: 2)
        await fulfillment(of: [s2Completed], timeout: 2)
        XCTAssertEqual(store.observation.saveCalls, 1)
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
        let store = RecordingBookStoreIO(underlying: underlying, pauseFirstLoad: true)
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

        await fulfillment(of: [store.firstLoadStarted], timeout: 2)
        XCTAssertThrowsError(try coordinator.startSave(request: saveRequest) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertEqual(store.observation.loadCalls, 1)
        XCTAssertEqual(store.observation.saveCalls, 0)

        store.releaseFirstLoad()
        await fulfillment(of: [firstCompleted], timeout: 2)
        let saved = try XCTUnwrap(resultAtACK)
        XCTAssertEqual(
            gateStateAtACK,
            .validatedExisting(loadID: loadID, rawHash: saved.rawHash, token: "token-paused")
        )
        XCTAssertEqual(coordinator.activity, .idle)
        XCTAssertEqual(store.observation.loadCalls, 1)
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
        XCTAssertEqual(store.observation.loadCalls, 1)
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
        executor.runTask(at: 0)
        await Task.yield()
        XCTAssertEqual(coordinator.activity, .saveWriting(operationID: operationID))

        XCTAssertThrowsError(try coordinator.cancelOperation(operationID: operationID)) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }
        XCTAssertEqual(coordinator.activity, .saveWriting(operationID: operationID))
        XCTAssertThrowsError(try coordinator.startLoad(retry: false) { _ in }) { error in
            XCTAssertEqual(error as? AssetTrackerStorageCoordinatorError, .busy)
        }

        executor.runTask(at: 1)
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
}

private final class BookStoreIOObservation: @unchecked Sendable {
    private let lock = NSLock()
    private var storedLoadCalls = 0
    private var storedSaveCalls = 0
    private var storedExportCalls = 0
    private var storedMainThreadStoreCalls = 0

    var loadCalls: Int { lock.withLock { storedLoadCalls } }
    var saveCalls: Int { lock.withLock { storedSaveCalls } }
    var exportCalls: Int { lock.withLock { storedExportCalls } }
    var mainThreadStoreCalls: Int { lock.withLock { storedMainThreadStoreCalls } }

    func recordLoad() {
        lock.withLock {
            storedLoadCalls += 1
            if Thread.isMainThread { storedMainThreadStoreCalls += 1 }
        }
    }

    func recordSave() {
        lock.withLock {
            storedSaveCalls += 1
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

private final class RecordingBookStoreIO: AssetTrackerBookStoreIO, @unchecked Sendable {
    let observation = BookStoreIOObservation()
    let firstLoadStarted = XCTestExpectation(description: "first store load started")
    let firstExportStarted = XCTestExpectation(description: "first raw export started")

    private let underlying: AssetTrackerBookStore
    private let pauseFirstLoad: Bool
    private let pauseFirstExport: Bool
    private let saveError: Error?
    private let releaseLoad = DispatchSemaphore(value: 0)
    private let releaseExport = DispatchSemaphore(value: 0)
    private let pauseLock = NSLock()
    private var hasPaused = false
    private var hasPausedExport = false

    init(
        underlying: AssetTrackerBookStore,
        pauseFirstLoad: Bool = false,
        pauseFirstExport: Bool = false,
        saveError: Error? = nil
    ) {
        self.underlying = underlying
        self.pauseFirstLoad = pauseFirstLoad
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
        observation.recordSave()
        if let saveError { throw saveError }
        return try underlying.save(stateJson: stateJson, schemaVersion: schemaVersion, reason: reason)
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

    func releaseFirstExport() {
        releaseExport.signal()
    }
}

private final class SequencedLoadBookStoreIO: AssetTrackerBookStoreIO, @unchecked Sendable {
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
