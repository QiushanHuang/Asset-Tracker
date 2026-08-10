import CryptoKit
import Darwin
import Foundation
import XCTest
@testable import AssetTrackerCore

private func writePrivateForFault(_ data: Data, to url: URL) throws {
    guard FileManager.default.createFile(atPath: url.path, contents: data),
          Darwin.chmod(url.path, 0o600) == 0
    else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
}

private func overwriteInPlaceForFault(_ data: Data, at url: URL) throws {
    let fd = Darwin.open(url.path, O_WRONLY | O_TRUNC | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    defer { Darwin.close(fd) }
    try data.withUnsafeBytes { bytes in
        var offset = 0
        while offset < bytes.count {
            let count = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
            guard count > 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
            offset += count
        }
    }
}

private func addACLForFault(_ entry: String, to url: URL) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/chmod")
    process.arguments = ["+a", entry, url.path]
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw POSIXError(.EIO) }
}

private func swapDirectoryForFault(
    canonical: URL,
    detached: URL,
    replacementChildren: [String] = []
) throws {
    try FileManager.default.moveItem(at: canonical, to: detached)
    try FileManager.default.createDirectory(at: canonical, withIntermediateDirectories: false)
    guard Darwin.chmod(canonical.path, 0o700) == 0 else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    for child in replacementChildren {
        let childURL = canonical.appendingPathComponent(child, isDirectory: true)
        try FileManager.default.createDirectory(at: childURL, withIntermediateDirectories: false)
        guard Darwin.chmod(childURL.path, 0o700) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
    }
}

final class NativeDurableFileWriterTests: XCTestCase {
    private let fileManager = FileManager.default

    private func makeScratch(_ name: String = #function) throws -> (base: URL, root: URL) {
        let base = fileManager.temporaryDirectory
            .appendingPathComponent("NativeDurableFileWriterTests-\(name)-\(UUID().uuidString)", isDirectory: true)
        let root = base.appendingPathComponent("Book", isDirectory: true)
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        XCTAssertEqual(Darwin.chmod(root.path, 0o700), 0)
        let basePath = base.path
        addTeardownBlock {
            try? FileManager.default.removeItem(atPath: basePath)
        }
        return (base, root)
    }

    private func makeDirectory(_ url: URL, mode: mode_t = 0o700) throws {
        try fileManager.createDirectory(at: url, withIntermediateDirectories: false)
        XCTAssertEqual(Darwin.chmod(url.path, mode), 0)
    }

    private func makeOrdinaryBlobs(in root: URL) throws -> URL {
        let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
        let ordinary = recovery.appendingPathComponent("ordinary", isDirectory: true)
        let blobs = ordinary.appendingPathComponent("blobs", isDirectory: true)
        try makeDirectory(recovery)
        try makeDirectory(ordinary)
        try makeDirectory(blobs)
        return blobs
    }

    private func makeSnapshots(in root: URL) throws -> URL {
        let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
        if !fileManager.fileExists(atPath: recovery.path) {
            try makeDirectory(recovery)
        }
        let snapshots = recovery.appendingPathComponent("snapshots", isDirectory: true)
        try makeDirectory(snapshots)
        return snapshots
    }

    private func writePrivate(_ data: Data, to url: URL) throws {
        XCTAssertTrue(fileManager.createFile(atPath: url.path, contents: data))
        XCTAssertEqual(Darwin.chmod(url.path, 0o600), 0)
    }

    private func overwriteInPlace(_ data: Data, at url: URL) throws {
        let fd = Darwin.open(url.path, O_WRONLY | O_TRUNC | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        defer { Darwin.close(fd) }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                guard count > 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
                offset += count
            }
        }
    }

    private func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func permissions(_ url: URL) throws -> mode_t {
        var value = stat()
        guard Darwin.lstat(url.path, &value) == 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        return value.st_mode & mode_t(0o7777)
    }

    private func extendedACLCount(_ url: URL) throws -> Int {
        let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        defer { Darwin.close(fd) }
        return try DarwinNativePOSIX().extendedACLEntryCount(fileFD: fd)
    }

    private func addACL(_ entry: String, to url: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/chmod")
        process.arguments = ["+a", entry, url.path]
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw POSIXError(.EIO)
        }
    }

    func testExactWriteRetriesEINTRAndShortWritesIncludingZeroAndLargePayloads() throws {
        let (_, root) = try makeScratch()
        let blobs = try makeOrdinaryBlobs(in: root)
        let posix = RecordingNativePOSIX(writeSteps: [.interrupt, .zero, .limit(7), .limit(257)])
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        let large = Data((0 ..< 256 * 1024).map { UInt8(truncatingIfNeeded: $0) })
        let largeName = "Recovery/ordinary/blobs/\(hash(large)).json"
        let empty = Data()
        let emptyName = "Recovery/ordinary/blobs/\(hash(empty)).json"

        let receipts = try writer.withExclusiveMutationLock { locked in
            let first = try locked.durableWrite(
                large,
                relativePath: largeName,
                disposition: .createOnly,
                role: .ordinaryBlob
            )
            let second = try locked.durableWrite(
                empty,
                relativePath: emptyName,
                disposition: .createOnly,
                role: .ordinaryBlob
            )
            return (first, second)
        }

        XCTAssertEqual(receipts.0.sha256, hash(large))
        XCTAssertEqual(receipts.0.byteCount, large.count)
        XCTAssertEqual(receipts.1.sha256, hash(empty))
        XCTAssertEqual(receipts.1.byteCount, 0)
        XCTAssertEqual(try Data(contentsOf: blobs.appendingPathComponent("\(hash(large)).json")), large)
        XCTAssertEqual(try Data(contentsOf: blobs.appendingPathComponent("\(hash(empty)).json")), empty)
        XCTAssertGreaterThan(posix.callCount(prefix: "write:"), 4)
    }

    func testDurableReplaceOrdersTempWriteFSyncFullFSyncRenameDirectoryFSyncRereadHash() throws {
        let (_, root) = try makeScratch()
        _ = try makeOrdinaryBlobs(in: root)
        let events = FaultEventRecorder()
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix) { events.record($0) }
        let bytes = Data("generation-zero".utf8)
        let relativePath = "Recovery/ordinary/blobs/\(hash(bytes)).json"

        let receipt = try writer.withExclusiveMutationLock { locked in
            try locked.durableWrite(
                bytes,
                relativePath: relativePath,
                disposition: .createOnly,
                role: .ordinaryBlob
            )
        }

        XCTAssertEqual(receipt.sha256, hash(bytes))
        XCTAssertEqual(receipt.byteCount, bytes.count)
        XCTAssertEqual(receipt.mode, 0o600)
        XCTAssertEqual(
            events.snapshot().map(\.point),
            [
                .afterLockAcquired,
                .afterTempCreate,
                .afterExactWrite,
                .afterFileFSync,
                .afterFullFSync,
                .beforeRename,
                .afterRename,
                .afterParentDirectoryFSync,
                .afterFinalReread,
                .afterHashVerified,
            ]
        )
        XCTAssertTrue(events.snapshot().dropFirst().allSatisfy {
            $0.role == .ordinaryBlob && $0.targetName == relativePath
        })

        let calls = posix.snapshotCalls()
        let tempOpen = try XCTUnwrap(calls.firstIndex { $0.hasPrefix("openAt:.AssetTracker.tmp.") })
        let chmod = try XCTUnwrap(calls[tempOpen...].firstIndex { $0.hasPrefix("changeMode:") })
        let write = try XCTUnwrap(calls[chmod...].firstIndex { $0.hasPrefix("write:") })
        let fileSync = try XCTUnwrap(calls[write...].firstIndex { $0.hasPrefix("syncFile:") })
        let fullSync = try XCTUnwrap(calls[fileSync...].firstIndex { $0.hasPrefix("fullSyncFile:") })
        let rename = try XCTUnwrap(calls[fullSync...].firstIndex { $0.hasPrefix("renameAt:") })
        let directorySync = try XCTUnwrap(calls[rename...].firstIndex { $0.hasPrefix("syncDirectory:") })
        let finalOpen = try XCTUnwrap(calls[directorySync...].firstIndex {
            $0.hasPrefix("openAt:\(hash(bytes)).json:")
        })
        let finalRead = try XCTUnwrap(calls[finalOpen...].firstIndex { $0.hasPrefix("read:") })
        let finalStat = try XCTUnwrap(calls[finalOpen...].firstIndex { $0.hasPrefix("fstat:") })
        XCTAssertLessThan(tempOpen, chmod)
        XCTAssertLessThan(chmod, write)
        XCTAssertLessThan(write, fileSync)
        XCTAssertLessThan(fileSync, fullSync)
        XCTAssertLessThan(fullSync, rename)
        XCTAssertLessThan(rename, directorySync)
        XCTAssertLessThan(directorySync, finalOpen)
        XCTAssertLessThan(finalOpen, finalRead)
        XCTAssertLessThan(finalOpen, finalStat)
    }

    func testCreateOnlyCollisionNeverOverwritesExistingContentAddressedBlob() throws {
        let (_, root) = try makeScratch()
        let blobs = try makeOrdinaryBlobs(in: root)
        let writer = NativeDurableFileWriter(rootURL: root)
        let original = Data("original".utf8)
        let replacement = Data("replacement".utf8)
        let name = "Recovery/ordinary/blobs/\(hash(original)).json"

        try writer.withExclusiveMutationLock { locked in
            _ = try locked.durableWrite(original, relativePath: name, disposition: .createOnly, role: .ordinaryBlob)
            XCTAssertThrowsError(
                try locked.durableWrite(replacement, relativePath: name, disposition: .createOnly, role: .ordinaryBlob)
            )
        }

        XCTAssertEqual(try Data(contentsOf: blobs.appendingPathComponent("\(hash(original)).json")), original)
    }

    func testManagedPathsRejectSymlinkNonRegularWrongOwnerWrongModeAndUnexpectedACL() throws {
        do {
            let (base, root) = try makeScratch("symlink")
            let outside = base.appendingPathComponent("outside", isDirectory: true)
            try makeDirectory(outside)
            try fileManager.createSymbolicLink(
                at: root.appendingPathComponent("Recovery"),
                withDestinationURL: outside
            )
            let writer = NativeDurableFileWriter(rootURL: root)
            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                try locked.createManagedDirectory(relativePath: "Recovery/ordinary", role: .ordinaryDirectory)
            })
        }

        do {
            let (_, root) = try makeScratch("wrong-mode")
            let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
            try makeDirectory(recovery, mode: 0o755)
            let writer = NativeDurableFileWriter(rootURL: root)
            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                try locked.enumerate(relativePath: "Recovery")
            })
        }

        do {
            let (_, root) = try makeScratch("non-regular")
            try makeDirectory(root.appendingPathComponent("AssetTrackerBook.json"))
            let writer = NativeDurableFileWriter(rootURL: root)
            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                _ = try locked.verifyPrimarySource(expectedSource: .sha256(String(repeating: "0", count: 64)))
            })
        }

        do {
            let (_, root) = try makeScratch("wrong-owner")
            let posix = RecordingNativePOSIX(effectiveUserID: Darwin.geteuid() &+ 1)
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            XCTAssertThrowsError(try writer.withExclusiveMutationLock { _ in })
        }

        do {
            let (_, root) = try makeScratch("acl")
            let posix = RecordingNativePOSIX(aclEntryCount: 1)
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            XCTAssertThrowsError(try writer.withExclusiveMutationLock { _ in })
        }
    }

    func testMissingStorageRootIsCreatedPrivateAndParentSyncedBeforeLockAdmission() throws {
        let (_, root) = try makeScratch()
        try fileManager.removeItem(at: root)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            try locked.revalidateCanonicalIdentity()
        }

        XCTAssertEqual(try permissions(root), 0o700)
        XCTAssertEqual(try permissions(root.appendingPathComponent(".AssetTracker.storage.lock")), 0o600)
        let calls = posix.snapshotCalls()
        let rootCreate = try XCTUnwrap(calls.firstIndex { $0.hasPrefix("makeDirectoryAt:Book:") })
        let rootOpen = try XCTUnwrap(calls[rootCreate...].firstIndex { $0.hasPrefix("openAt:Book:") })
        let lockOpen = try XCTUnwrap(calls[rootOpen...].firstIndex {
            $0.hasPrefix("openAt:.AssetTracker.storage.lock:")
        })
        let rootPreparation = Array(calls[rootOpen ..< lockOpen])
        XCTAssertTrue(rootPreparation.contains { $0.hasPrefix("changeMode:") })
        XCTAssertGreaterThanOrEqual(
            rootPreparation.filter { $0.hasPrefix("syncDirectory:") }.count,
            2,
            "new root and its parent must both be synchronized before lock creation"
        )
        XCTAssertLessThan(rootCreate, rootOpen)
        XCTAssertLessThan(rootOpen, lockOpen)
    }

    func testConcurrentFirstSaveRootCreatorEEXISTReopensAndAdmitsTheWinnerRoot() throws {
        let (_, root) = try makeScratch()
        try fileManager.removeItem(at: root)
        let posix = RecordingNativePOSIX(rootCreationRaceURL: root)
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var enteredLock = false

        try writer.withExclusiveMutationLock { locked in
            enteredLock = true
            try locked.revalidateCanonicalIdentity()
        }

        XCTAssertTrue(enteredLock)
        XCTAssertEqual(try permissions(root), 0o700)
        let calls = posix.snapshotCalls()
        let rootCreate = try XCTUnwrap(calls.firstIndex { $0.hasPrefix("makeDirectoryAt:Book:") })
        let rootOpen = try XCTUnwrap(calls[rootCreate...].firstIndex { $0.hasPrefix("openAt:Book:") })
        let lockOpen = try XCTUnwrap(calls[rootOpen...].firstIndex {
            $0.hasPrefix("openAt:.AssetTracker.storage.lock:")
        })
        XCTAssertLessThan(rootCreate, rootOpen)
        XCTAssertLessThan(rootOpen, lockOpen)
        XCTAssertGreaterThanOrEqual(
            calls[rootOpen ..< lockOpen].filter { $0.hasPrefix("syncDirectory:") }.count,
            2,
            "an EEXIST loser must make the observed new root and its parent durable if the creator dies"
        )
    }

    func testAuthorizedMutationClearsInheritedBenignACLFromRootAndEveryNewManagedObject() throws {
        for rootInitiallyExists in [false, true] {
            let (base, root) = try makeScratch("inherited-acl-\(rootInitiallyExists)")
            if rootInitiallyExists {
                XCTAssertEqual(Darwin.chmod(root.path, 0o755), 0)
                try addACL(
                    "user:\(NSUserName()) allow read,file_inherit,directory_inherit",
                    to: root
                )
            } else {
                try fileManager.removeItem(at: root)
                try addACL(
                    "user:\(NSUserName()) allow read,file_inherit,directory_inherit",
                    to: base
                )
            }
            let writer = NativeDurableFileWriter(rootURL: root)
            let primary = root.appendingPathComponent("AssetTrackerBook.json")
            let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
            let bytes = Data("first save".utf8)

            let receipt = try writer.withExclusiveMutationLock { locked in
                try locked.createManagedDirectory(relativePath: "Recovery", role: .ordinaryDirectory)
                let proof = try locked.verifyPrimarySource(expectedSource: .missing)
                return try locked.durableReplacePrimary(bytes, sourceProof: proof)
            }

            XCTAssertEqual(receipt.sha256, hash(bytes))
            for url in [
                root,
                root.appendingPathComponent(".AssetTracker.storage.lock"),
                recovery,
                primary,
            ] {
                XCTAssertEqual(try extendedACLCount(url), 0, "url=\(url.path)")
            }
            XCTAssertEqual(try permissions(root), 0o700)
            XCTAssertEqual(try permissions(recovery), 0o700)
            XCTAssertEqual(try permissions(primary), 0o600)
        }
    }

    func testLockBootstrapPublishesOnlyInitializedDurableInodeAndFreshReopensEveryFailureBoundary() throws {
        for boundary in RecordingNativePOSIX.LockBootstrapFailure.allCases {
            let (_, root) = try makeScratch("lock-bootstrap-\(boundary)")
            let lockURL = root.appendingPathComponent(".AssetTracker.storage.lock")
            let posix = RecordingNativePOSIX(lockBootstrapFailure: boundary)
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            XCTAssertThrowsError(
                try writer.withExclusiveMutationLock { _ in },
                "boundary=\(boundary)"
            )
            XCTAssertFalse(
                try fileManager.contentsOfDirectory(atPath: root.path)
                    .contains { $0.hasPrefix(".AssetTracker.lock.tmp.") },
                "boundary=\(boundary) left a private bootstrap name"
            )
            if fileManager.fileExists(atPath: lockURL.path) {
                XCTAssertEqual(try permissions(lockURL), 0o600, "boundary=\(boundary)")
                XCTAssertEqual(try extendedACLCount(lockURL), 0, "boundary=\(boundary)")
            }

            let freshWriter = NativeDurableFileWriter(rootURL: root)
            try freshWriter.withExclusiveMutationLock { locked in
                try locked.revalidateCanonicalIdentity()
            }
            XCTAssertEqual(try permissions(lockURL), 0o600, "boundary=\(boundary)")
            XCTAssertEqual(try extendedACLCount(lockURL), 0, "boundary=\(boundary)")
        }

        let (_, root) = try makeScratch("lock-bootstrap-order")
        let posix = RecordingNativePOSIX(newLockTempInitialMode: 0)
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        try writer.withExclusiveMutationLock { locked in
            try locked.revalidateCanonicalIdentity()
        }
        let calls = posix.snapshotCalls()
        let tempOpen = try XCTUnwrap(calls.firstIndex {
            $0.hasPrefix("openAt:.AssetTracker.lock.tmp.")
        })
        let clearACL = try XCTUnwrap(calls[tempOpen...].firstIndex {
            $0.hasPrefix("clearExtendedACL:")
        })
        let changeMode = try XCTUnwrap(calls[clearACL...].firstIndex {
            $0.hasPrefix("changeMode:")
        })
        let fileSync = try XCTUnwrap(calls[changeMode...].firstIndex {
            $0.hasPrefix("syncFile:")
        })
        let fullSync = try XCTUnwrap(calls[fileSync...].firstIndex {
            $0.hasPrefix("fullSyncFile:")
        })
        let publish = try XCTUnwrap(calls[fullSync...].firstIndex {
            $0.hasPrefix("renameAt:.AssetTracker.lock.tmp.")
                && $0.contains(":.AssetTracker.storage.lock:true")
        })
        let rootSync = try XCTUnwrap(calls[publish...].firstIndex {
            $0.hasPrefix("syncDirectory:")
        })
        let canonicalOpen = try XCTUnwrap(calls[rootSync...].firstIndex {
            $0.hasPrefix("openAt:.AssetTracker.storage.lock:")
        })
        let flock = try XCTUnwrap(calls[canonicalOpen...].firstIndex {
            $0.hasPrefix("flock:") && $0.hasSuffix(":2")
        })
        XCTAssertLessThan(tempOpen, clearACL)
        XCTAssertLessThan(clearACL, changeMode)
        XCTAssertLessThan(changeMode, fileSync)
        XCTAssertLessThan(fileSync, fullSync)
        XCTAssertLessThan(fullSync, publish)
        XCTAssertLessThan(publish, rootSync)
        XCTAssertLessThan(rootSync, canonicalOpen)
        XCTAssertLessThan(canonicalOpen, flock)
        XCTAssertEqual(try permissions(root.appendingPathComponent(".AssetTracker.storage.lock")), 0o600)
    }

    func testLockBootstrapExclusiveRenameLoserUsesPublishedCanonicalAndPreservesUnknownSentinels() throws {
        let (_, root) = try makeScratch("lock-bootstrap-race")
        let orphan = root.appendingPathComponent(".AssetTracker.lock.tmp.sentinel")
        let sentinel = Data("do not delete".utf8)
        try writePrivate(sentinel, to: orphan)
        let posix = RecordingNativePOSIX(simulateLockRenameRace: true)
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            try locked.revalidateCanonicalIdentity()
        }

        let lockURL = root.appendingPathComponent(".AssetTracker.storage.lock")
        XCTAssertEqual(try Data(contentsOf: orphan), sentinel)
        XCTAssertEqual(try permissions(lockURL), 0o600)
        XCTAssertEqual(try extendedACLCount(lockURL), 0)
        XCTAssertTrue(posix.snapshotCalls().contains {
            $0.hasPrefix("renameAt:.AssetTracker.lock.tmp.")
                && $0.contains(":.AssetTracker.storage.lock:true")
        })
        XCTAssertEqual(
            try fileManager.contentsOfDirectory(atPath: root.path)
                .filter { $0.hasPrefix(".AssetTracker.lock.tmp.") },
            [orphan.lastPathComponent]
        )
    }

    func testFreshWriterIgnoresAndPreservesPrivateLockTempsFromEveryPrepublicationKillState() throws {
        let (_, root) = try makeScratch("lock-bootstrap-kill-orphans")
        let states = ["after-open", "after-clear", "after-chmod", "after-fsync", "after-full-sync"]
        var expected: [URL: Data] = [:]
        for state in states {
            let url = root.appendingPathComponent(".AssetTracker.lock.tmp.crash-\(state)")
            let bytes = Data("sentinel-\(state)".utf8)
            try writePrivate(bytes, to: url)
            expected[url] = bytes
        }
        let afterOpen = root.appendingPathComponent(".AssetTracker.lock.tmp.crash-after-open")
        try addACL("user:\(NSUserName()) allow read", to: afterOpen)
        XCTAssertEqual(try extendedACLCount(afterOpen), 1)
        XCTAssertEqual(Darwin.chmod(afterOpen.path, 0), 0)

        let writer = NativeDurableFileWriter(rootURL: root)
        try writer.withExclusiveMutationLock { locked in
            try locked.revalidateCanonicalIdentity()
        }

        XCTAssertEqual(try permissions(afterOpen), 0)
        XCTAssertEqual(Darwin.chmod(afterOpen.path, 0o600), 0)
        XCTAssertEqual(try extendedACLCount(afterOpen), 1)
        for (url, bytes) in expected {
            XCTAssertEqual(try Data(contentsOf: url), bytes, "url=\(url.lastPathComponent)")
        }
        let canonical = root.appendingPathComponent(".AssetTracker.storage.lock")
        XCTAssertEqual(try permissions(canonical), 0o600)
        XCTAssertEqual(try extendedACLCount(canonical), 0)
    }

    func testSafeNonemptyCanonicalLockIsSerializedAndNeverDeletedOrRewritten() throws {
        let (_, root) = try makeScratch("unknown-canonical-lock")
        let lockURL = root.appendingPathComponent(".AssetTracker.storage.lock")
        let sentinel = Data("unknown lock payload".utf8)
        try writePrivate(sentinel, to: lockURL)
        let writer = NativeDurableFileWriter(rootURL: root)

        try writer.withExclusiveMutationLock { locked in
            try locked.revalidateCanonicalIdentity()
        }
        XCTAssertEqual(try Data(contentsOf: lockURL), sentinel)
        XCTAssertEqual(try permissions(lockURL), 0o600)
    }

    func testClearExtendedACLFailureOnOwnedWriteTempStopsBeforeRenameAndCleansOnlyThatTemp() throws {
        let (_, root) = try makeScratch("write-temp-clear-failure")
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        let h0 = Data("H0".utf8)
        try writePrivate(h0, to: primary)
        try NativeDurableFileWriter(rootURL: root).withExclusiveMutationLock { _ in }
        let sentinelURL = root.appendingPathComponent(".AssetTracker.tmp.sentinel")
        let sentinel = Data("unrelated".utf8)
        try writePrivate(sentinel, to: sentinelURL)
        let posix = RecordingNativePOSIX(clearACLFailurePathPrefix: ".AssetTracker.tmp.")
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returnedReceipt = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(h0)))
            _ = try locked.durableReplacePrimary(Data("H1".utf8), sourceProof: proof)
            returnedReceipt = true
        })
        XCTAssertFalse(returnedReceipt)
        XCTAssertEqual(try Data(contentsOf: primary), h0)
        XCTAssertEqual(try Data(contentsOf: sentinelURL), sentinel)
        XCTAssertFalse(posix.snapshotCalls().contains {
            $0.hasPrefix("renameAt:.AssetTracker.tmp.")
        })
        XCTAssertEqual(
            try fileManager.contentsOfDirectory(atPath: root.path)
                .filter { $0.hasPrefix(".AssetTracker.tmp.") },
            [sentinelURL.lastPathComponent]
        )
    }

    func testLegacyRootAndPrimaryPermissionsUpgradeWithoutChangingPrimaryBytes() throws {
        let (_, root) = try makeScratch()
        XCTAssertEqual(Darwin.chmod(root.path, 0o755), 0)
        let sourceURL = root.appendingPathComponent("AssetTrackerBook.json")
        let source = Data("legacy".utf8)
        try writePrivate(source, to: sourceURL)
        XCTAssertEqual(Darwin.chmod(sourceURL.path, 0o644), 0)
        let writer = NativeDurableFileWriter(rootURL: root)

        try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(source)))
            XCTAssertEqual(try locked.readValidated(relativePath: "AssetTrackerBook.json"), source)
            _ = try locked.durableReplacePrimary(Data("new".utf8), sourceProof: proof)
        }

        XCTAssertEqual(try permissions(root), 0o700)
        XCTAssertEqual(try permissions(sourceURL), 0o600)
        XCTAssertEqual(try Data(contentsOf: sourceURL), Data("new".utf8))
    }

    func testLegacyACLAdmissionDistinguishesBenignOwnerACLFromDangerousAndManagedACLs() throws {
        do {
            let (_, root) = try makeScratch("benign-legacy-acl")
            XCTAssertEqual(Darwin.chmod(root.path, 0o755), 0)
            let primary = root.appendingPathComponent("AssetTrackerBook.json")
            let bytes = Data("legacy".utf8)
            try writePrivate(bytes, to: primary)
            XCTAssertEqual(Darwin.chmod(primary.path, 0o644), 0)
            try addACL("user:\(NSUserName()) allow read,write", to: root)
            try addACL("user:\(NSUserName()) allow read", to: primary)

            let writer = NativeDurableFileWriter(rootURL: root)
            try writer.withExclusiveMutationLock { locked in
                _ = try locked.verifyPrimarySource(expectedSource: .sha256(hash(bytes)))
            }
        }

        do {
            let (_, root) = try makeScratch("dangerous-legacy-acl")
            XCTAssertEqual(Darwin.chmod(root.path, 0o755), 0)
            try addACL("group:everyone allow write,delete,writesecurity,chown", to: root)
            let writer = NativeDurableFileWriter(rootURL: root)
            XCTAssertThrowsError(try writer.withExclusiveMutationLock { _ in })
        }


        do {
            let (_, root) = try makeScratch("dangerous-named-user-acl")
            XCTAssertEqual(Darwin.chmod(root.path, 0o755), 0)
            try addACL("user:nobody allow write", to: root)
            let writer = NativeDurableFileWriter(rootURL: root)
            XCTAssertThrowsError(try writer.withExclusiveMutationLock { _ in })
        }

        do {
            let (_, root) = try makeScratch("managed-acl")
            let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
            try makeDirectory(recovery)
            try addACL("user:\(NSUserName()) allow read", to: recovery)
            let writer = NativeDurableFileWriter(rootURL: root)
            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                _ = try locked.enumerate(relativePath: "Recovery")
            })
        }
    }

    func testExistingWrongModeLockIsRejectedWithoutSilentUndurableRepair() throws {
        let (_, root) = try makeScratch()
        let lock = root.appendingPathComponent(".AssetTracker.storage.lock")
        try writePrivate(Data(), to: lock)
        XCTAssertEqual(Darwin.chmod(lock.path, 0o644), 0)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { _ in })
        XCTAssertEqual(try permissions(lock), 0o644)
        let calls = posix.snapshotCalls()
        let lockOpen = try XCTUnwrap(calls.firstIndex { $0.hasPrefix("openAt:.AssetTracker.storage.lock:") })
        XCTAssertFalse(calls[lockOpen...].contains { $0.hasPrefix("changeMode:") })
    }

    func testCanonicalRootLockAndManagedDirectoryIdentityAreRevalidatedBeforeReceipt() throws {
        let (base, root) = try makeScratch()
        _ = try makeOrdinaryBlobs(in: root)
        let movedRoot = base.appendingPathComponent("detached-book", isDirectory: true)
        let writer = NativeDurableFileWriter(rootURL: root) { event in
            guard event.point == .afterTempCreate else { return }
            try FileManager.default.moveItem(at: root, to: movedRoot)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
            guard Darwin.chmod(root.path, 0o700) == 0 else {
                throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
            }
        }
        let bytes = Data("identity".utf8)

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            try locked.durableWrite(
                bytes,
                relativePath: "Recovery/ordinary/blobs/\(hash(bytes)).json",
                disposition: .createOnly,
                role: .ordinaryBlob
            )
        })
        XCTAssertFalse(fileManager.fileExists(atPath: root.appendingPathComponent("Recovery").path))
        let detachedEntries = try fileManager.contentsOfDirectory(atPath: movedRoot
            .appendingPathComponent("Recovery/ordinary/blobs").path)
        XCTAssertFalse(detachedEntries.contains { $0.hasPrefix(".AssetTracker.tmp.") })
    }

    func testHeldFileDescriptorsMatchCanonicalEntriesByDeviceAndInode() throws {
        let (_, root) = try makeScratch()
        _ = try makeOrdinaryBlobs(in: root)
        let ordinary = root.appendingPathComponent("Recovery/ordinary", isDirectory: true)
        let detached = root.appendingPathComponent("Recovery/ordinary-detached", isDirectory: true)
        let writer = NativeDurableFileWriter(rootURL: root) { event in
            guard event.point == .afterTempCreate else { return }
            try FileManager.default.moveItem(at: ordinary, to: detached)
            try FileManager.default.createDirectory(at: ordinary, withIntermediateDirectories: false)
            guard Darwin.chmod(ordinary.path, 0o700) == 0 else {
                throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
            }
        }
        let bytes = Data("directory-identity".utf8)

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            try locked.durableWrite(
                bytes,
                relativePath: "Recovery/ordinary/blobs/\(hash(bytes)).json",
                disposition: .createOnly,
                role: .ordinaryBlob
            )
        })
    }

    func testExplicitFchmodMakesManagedFilesPrivateUnderPermissiveUmask() throws {
        let (_, root) = try makeScratch()
        _ = try makeOrdinaryBlobs(in: root)
        let oldMask = Darwin.umask(0)
        defer { _ = Darwin.umask(oldMask) }
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        let bytes = Data("private".utf8)
        let url = root.appendingPathComponent("Recovery/ordinary/slots.json")

        try writer.withExclusiveMutationLock { locked in
            _ = try locked.durableWrite(
                bytes,
                relativePath: "Recovery/ordinary/slots.json",
                disposition: .replace,
                role: .ordinaryEmptyIndex
            )
        }

        XCTAssertEqual(try permissions(url), 0o600)
        let calls = posix.snapshotCalls()
        let tempOpen = try XCTUnwrap(calls.firstIndex { $0.hasPrefix("openAt:.AssetTracker.tmp.") })
        let chmod = try XCTUnwrap(calls[tempOpen...].firstIndex { $0.hasPrefix("changeMode:") })
        let write = try XCTUnwrap(calls[chmod...].firstIndex { $0.hasPrefix("write:") })
        XCTAssertLessThan(tempOpen, chmod)
        XCTAssertLessThan(chmod, write)
    }

    func testEveryTask5OwnedCheckpointThrowCleansOnlyItsTempAndReturnsNoReceipt() throws {
        let checkpoints: [NativeDurabilityFaultPoint] = [
            .afterLockAcquired,
            .afterSourceRevalidation,
            .afterTempCreate,
            .afterExactWrite,
            .afterFileFSync,
            .afterFullFSync,
            .beforeRename,
            .afterRename,
            .afterParentDirectoryFSync,
            .afterFinalReread,
            .afterHashVerified,
        ]

        for checkpoint in checkpoints {
            let (_, root) = try makeScratch("checkpoint-\(checkpoint.rawValue)")
            let primary = root.appendingPathComponent("AssetTrackerBook.json")
            let h0 = Data("H0".utf8)
            let h1 = Data("H1".utf8)
            try writePrivate(h0, to: primary)
            let events = FaultEventRecorder()
            let writer = NativeDurableFileWriter(rootURL: root) { event in
                events.record(event)
                if event.point == checkpoint {
                    throw InjectedWriterFault.stop
                }
            }
            var returnedReceipt = false

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(h0)))
                _ = try locked.durableReplacePrimary(h1, sourceProof: proof)
                returnedReceipt = true
            }, "checkpoint \(checkpoint.rawValue)")
            XCTAssertFalse(returnedReceipt, "checkpoint \(checkpoint.rawValue)")
            XCTAssertTrue(
                events.snapshot().contains { $0.point == checkpoint },
                "checkpoint \(checkpoint.rawValue) was not reached"
            )
            XCTAssertFalse(
                try fileManager.contentsOfDirectory(atPath: root.path)
                    .contains { $0.hasPrefix(".AssetTracker.tmp.") },
                "checkpoint \(checkpoint.rawValue) left a temp"
            )
            let primaryAfter = try Data(contentsOf: primary)
            if [
                NativeDurabilityFaultPoint.afterRename,
                .afterParentDirectoryFSync,
                .afterFinalReread,
                .afterHashVerified,
            ].contains(checkpoint) {
                XCTAssertEqual(primaryAfter, h1)
            } else {
                XCTAssertEqual(primaryAfter, h0)
            }
        }

        let (_, root) = try makeScratch("source-revalidation-success")
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        let h0 = Data("H0".utf8)
        let h1 = Data("H1".utf8)
        try writePrivate(h0, to: primary)
        let events = FaultEventRecorder()
        let writer = NativeDurableFileWriter(rootURL: root) { events.record($0) }
        let receipt = try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(h0)))
            return try locked.durableReplacePrimary(h1, sourceProof: proof)
        }
        XCTAssertEqual(receipt.sha256, hash(h1))
        XCTAssertTrue(events.snapshot().contains { $0.point == .afterSourceRevalidation })
    }

    func testTempCleanupNeverUnlinksAReplacementAtTheCreatedTempName() throws {
        let (base, root) = try makeScratch()
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        let detachedTemp = base.appendingPathComponent("detached-created-temp")
        let source = Data("H0".utf8)
        let replacement = Data("unknown replacement".utf8)
        try writePrivate(source, to: primary)
        let replacedTempURL = URLRecorder()
        let writer = NativeDurableFileWriter(rootURL: root) { event in
            guard event.point == .afterTempCreate, event.role == .primary else { return }
            let tempName = try XCTUnwrap(
                FileManager.default.contentsOfDirectory(atPath: root.path)
                    .first { $0.hasPrefix(".AssetTracker.tmp.") }
            )
            let tempURL = root.appendingPathComponent(tempName)
            try FileManager.default.moveItem(at: tempURL, to: detachedTemp)
            try writePrivateForFault(replacement, to: tempURL)
            replacedTempURL.record(tempURL)
            throw InjectedWriterFault.stop
        }

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(source)))
            return try locked.durableReplacePrimary(Data("H1".utf8), sourceProof: proof)
        })
        let canonicalReplacement = try XCTUnwrap(replacedTempURL.snapshot())
        XCTAssertEqual(try Data(contentsOf: canonicalReplacement), replacement)
        XCTAssertTrue(fileManager.fileExists(atPath: detachedTemp.path))
        XCTAssertEqual(try Data(contentsOf: primary), source)
    }

    func testSuccessfulPathNeverRenamesAReplacementAtTheCreatedTempName() throws {
        let (base, root) = try makeScratch()
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        let detachedTemp = base.appendingPathComponent("detached-created-temp")
        let source = Data("H0".utf8)
        let replacement = Data("unknown replacement".utf8)
        try writePrivate(source, to: primary)
        let replacedTempURL = URLRecorder()
        let writer = NativeDurableFileWriter(rootURL: root) { event in
            guard event.point == .afterTempCreate, event.role == .primary else { return }
            let tempName = try XCTUnwrap(
                FileManager.default.contentsOfDirectory(atPath: root.path)
                    .first { $0.hasPrefix(".AssetTracker.tmp.") }
            )
            let tempURL = root.appendingPathComponent(tempName)
            try FileManager.default.moveItem(at: tempURL, to: detachedTemp)
            try writePrivateForFault(replacement, to: tempURL)
            replacedTempURL.record(tempURL)
        }
        var returnedReceipt = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(source)))
            _ = try locked.durableReplacePrimary(Data("H1".utf8), sourceProof: proof)
            returnedReceipt = true
        })
        XCTAssertFalse(returnedReceipt)
        XCTAssertEqual(try Data(contentsOf: primary), source)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(replacedTempURL.snapshot())), replacement)
        XCTAssertEqual(try Data(contentsOf: detachedTemp), Data("H1".utf8))
    }

    func testPreparedTempExactBytesAreReprovedAfterEveryExternalPreRenameCallback() throws {
        let callbacks: [NativeDurabilityFaultPoint] = [
            .afterTempCreate,
            .afterExactWrite,
            .afterFileFSync,
            .afterFullFSync,
            .afterSourceRevalidation,
            .beforeRename,
        ]
        for callback in callbacks {
            let (_, root) = try makeScratch("temp-same-inode-\(callback.rawValue)")
            let primary = root.appendingPathComponent("AssetTrackerBook.json")
            let h0 = Data("H0".utf8)
            let h1 = Data("H1".utf8)
            let corrupt = Data("corrupt prepared bytes that must never replace H0".utf8)
            try writePrivate(h0, to: primary)
            let writer = NativeDurableFileWriter(rootURL: root) { event in
                guard event.point == callback, event.role == .primary else { return }
                let tempName = try XCTUnwrap(
                    FileManager.default.contentsOfDirectory(atPath: root.path)
                        .first { $0.hasPrefix(".AssetTracker.tmp.") }
                )
                let tempURL = root.appendingPathComponent(tempName)
                var before = stat()
                XCTAssertEqual(Darwin.lstat(tempURL.path, &before), 0)
                try overwriteInPlaceForFault(corrupt, at: tempURL)
                var after = stat()
                XCTAssertEqual(Darwin.lstat(tempURL.path, &after), 0)
                XCTAssertEqual(before.st_dev, after.st_dev)
                XCTAssertEqual(before.st_ino, after.st_ino)
            }
            var returnedReceipt = false

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(h0)))
                _ = try locked.durableReplacePrimary(h1, sourceProof: proof)
                returnedReceipt = true
            }, "callback=\(callback.rawValue)")
            XCTAssertFalse(returnedReceipt, "callback=\(callback.rawValue)")
            XCTAssertEqual(try Data(contentsOf: primary), h0, "callback=\(callback.rawValue)")
            XCTAssertFalse(
                try fileManager.contentsOfDirectory(atPath: root.path)
                    .contains { $0.hasPrefix(".AssetTracker.tmp.") },
                "callback=\(callback.rawValue)"
            )
        }
    }

    func testExternalSourceChangeAfterInitialCASAndBeforeRenameIsNeverOverwritten() throws {
        let (_, root) = try makeScratch()
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        let h0 = Data("H0".utf8)
        let hx = Data("HX".utf8)
        try writePrivate(h0, to: primary)
        let writer = NativeDurableFileWriter(rootURL: root) { event in
            guard event.point == .afterFullFSync, event.role == .primary else { return }
            try hx.write(to: primary)
            guard Darwin.chmod(primary.path, 0o600) == 0 else {
                throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
            }
        }

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(h0)))
            return try locked.durableReplacePrimary(Data("H1".utf8), sourceProof: proof)
        })
        XCTAssertEqual(try Data(contentsOf: primary), hx)
    }

    func testSourceReplacementAtAfterSourceRevalidationIsNeverOverwritten() throws {
        for sourceExists in [true, false] {
            let (_, root) = try makeScratch("post-revalidation-\(sourceExists)")
            let primary = root.appendingPathComponent("AssetTrackerBook.json")
            let h0 = Data("H0".utf8)
            let hx = Data("HX".utf8)
            if sourceExists { try writePrivate(h0, to: primary) }
            let writer = NativeDurableFileWriter(rootURL: root) { event in
                guard event.point == .afterSourceRevalidation, event.role == .primary else { return }
                if FileManager.default.fileExists(atPath: primary.path) {
                    try FileManager.default.removeItem(at: primary)
                }
                try writePrivateForFault(hx, to: primary)
            }
            var returnedReceipt = false

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                let expected: ExpectedBookSource = sourceExists ? .sha256(hash(h0)) : .missing
                let proof = try locked.verifyPrimarySource(expectedSource: expected)
                _ = try locked.durableReplacePrimary(Data("H1".utf8), sourceProof: proof)
                returnedReceipt = true
            }, "sourceExists=\(sourceExists)")
            XCTAssertFalse(returnedReceipt)
            XCTAssertEqual(try Data(contentsOf: primary), hx)
        }
    }

    func testFinalPrimarySourceLeafProofIsImmediatelyFollowedByRename() throws {
        let (_, root) = try makeScratch()
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        let h0 = Data("H0".utf8)
        try writePrivate(h0, to: primary)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(h0)))
            _ = try locked.durableReplacePrimary(Data("H1".utf8), sourceProof: proof)
        }

        let calls = posix.snapshotCalls()
        let rename = try XCTUnwrap(calls.firstIndex {
            $0.hasPrefix("renameAt:.AssetTracker.tmp.")
                && $0.contains(":AssetTrackerBook.json:false")
        })
        let finalSourceLeafProof = try XCTUnwrap(
            calls[..<rename].lastIndex { $0 == "fstatAt:AssetTrackerBook.json:true" }
        )
        XCTAssertEqual(
            finalSourceLeafProof + 1,
            rename,
            "the final source name proof must have no hook or syscall window before rename"
        )
    }

    func testFinalReceiptRequiresOpenedTargetFDToRemainTheCanonicalLeaf() throws {
        for faultPoint in [NativeDurabilityFaultPoint.afterFinalReread, .afterHashVerified] {
            let (base, root) = try makeScratch("final-leaf-\(faultPoint.rawValue)")
            let primary = root.appendingPathComponent("AssetTrackerBook.json")
            let detached = base.appendingPathComponent("detached-primary")
            let h0 = Data("H0".utf8)
            let h1 = Data("H1".utf8)
            try writePrivate(h0, to: primary)
            let writer = NativeDurableFileWriter(rootURL: root) { event in
                guard event.point == faultPoint, event.role == .primary else { return }
                try FileManager.default.moveItem(at: primary, to: detached)
                try writePrivateForFault(h1, to: primary)
            }
            var returnedReceipt = false

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(h0)))
                _ = try locked.durableReplacePrimary(h1, sourceProof: proof)
                returnedReceipt = true
            }, "faultPoint=\(faultPoint.rawValue)")
            XCTAssertFalse(returnedReceipt)
            XCTAssertEqual(try Data(contentsOf: primary), h1)
        }
    }

    func testPreparedTempProofIsFollowedByCanonicalChainBeforeNonPrimaryRename() throws {
        let (base, root) = try makeScratch("prepared-temp-nested-swap")
        let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
        let ordinary = recovery.appendingPathComponent("ordinary", isDirectory: true)
        let detachedOrdinary = base.appendingPathComponent("detached-ordinary", isDirectory: true)
        try makeDirectory(recovery)
        try makeDirectory(ordinary)
        let bytes = Data("prepared index".utf8)
        let target = ordinary.appendingPathComponent("slots.json")
        let detachedTarget = detachedOrdinary.appendingPathComponent("slots.json")
        let posix = RecordingNativePOSIX(
            afterPositiveReadOfPathPrefix: ".AssetTracker.tmp.",
            afterPositiveReadOccurrence: 1,
            afterPositiveReadAction: {
                try swapDirectoryForFault(canonical: ordinary, detached: detachedOrdinary)
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returnedReceipt = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            _ = try locked.durableWrite(
                bytes,
                relativePath: "Recovery/ordinary/slots.json",
                disposition: .replace,
                role: .ordinaryPreparedIndex
            )
            returnedReceipt = true
        })
        XCTAssertFalse(returnedReceipt)
        XCTAssertFalse(fileManager.fileExists(atPath: target.path))
        XCTAssertFalse(fileManager.fileExists(atPath: detachedTarget.path))
        XCTAssertFalse(posix.snapshotCalls().contains {
            $0.hasPrefix("renameAt:.AssetTracker.tmp.") && $0.contains(":slots.json:")
        })
    }

    func testFinalExactLeafProofIsFollowedByCanonicalChainBeforeReceipt() throws {
        let (base, root) = try makeScratch("final-proof-nested-swap")
        let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
        let ordinary = recovery.appendingPathComponent("ordinary", isDirectory: true)
        let detachedOrdinary = base.appendingPathComponent("detached-ordinary", isDirectory: true)
        try makeDirectory(recovery)
        try makeDirectory(ordinary)
        let bytes = Data("committed index".utf8)
        let target = ordinary.appendingPathComponent("slots.json")
        let detachedTarget = detachedOrdinary.appendingPathComponent("slots.json")
        let posix = RecordingNativePOSIX(
            afterPositiveReadOfPathPrefix: "slots.json",
            afterPositiveReadOccurrence: 2,
            afterPositiveReadAction: {
                try swapDirectoryForFault(canonical: ordinary, detached: detachedOrdinary)
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returnedReceipt = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            _ = try locked.durableWrite(
                bytes,
                relativePath: "Recovery/ordinary/slots.json",
                disposition: .replace,
                role: .ordinaryCommittedIndex
            )
            returnedReceipt = true
        })
        XCTAssertFalse(returnedReceipt)
        XCTAssertFalse(fileManager.fileExists(atPath: target.path))
        XCTAssertTrue(fileManager.fileExists(atPath: detachedTarget.path))
    }

    func testFinalReceiptRejectsSameInodeContentMutationAtEveryFinalCallback() throws {
        for faultPoint in [NativeDurabilityFaultPoint.afterFinalReread, .afterHashVerified] {
            let (_, root) = try makeScratch("final-same-inode-\(faultPoint.rawValue)")
            let primary = root.appendingPathComponent("AssetTrackerBook.json")
            let h0 = Data("H0".utf8)
            let hx = Data("HX".utf8)
            try writePrivate(h0, to: primary)
            let writer = NativeDurableFileWriter(rootURL: root) { event in
                guard event.point == faultPoint, event.role == .primary else { return }
                var before = stat()
                XCTAssertEqual(Darwin.lstat(primary.path, &before), 0)
                try overwriteInPlaceForFault(hx, at: primary)
                var after = stat()
                XCTAssertEqual(Darwin.lstat(primary.path, &after), 0)
                XCTAssertEqual(before.st_dev, after.st_dev)
                XCTAssertEqual(before.st_ino, after.st_ino)
            }
            var returnedReceipt = false

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(h0)))
                _ = try locked.durableReplacePrimary(Data("H1".utf8), sourceProof: proof)
                returnedReceipt = true
            }, "faultPoint=\(faultPoint.rawValue)")
            XCTAssertFalse(returnedReceipt)
            XCTAssertEqual(try Data(contentsOf: primary), hx)
        }
    }

    func testUnchangedPrimaryReceiptRequiresOpenedFDToRemainTheCanonicalLeaf() throws {
        let (base, root) = try makeScratch()
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        let detached = base.appendingPathComponent("detached-primary")
        let bytes = Data("unchanged".utf8)
        try writePrivate(bytes, to: primary)
        let writer = NativeDurableFileWriter(rootURL: root) { event in
            guard event.point == .afterFinalReread, event.role == .primary else { return }
            try FileManager.default.moveItem(at: primary, to: detached)
            try writePrivateForFault(bytes, to: primary)
        }
        var returnedReceipt = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(bytes)))
            _ = try locked.durablyVerifyUnchangedPrimary(sourceProof: proof)
            returnedReceipt = true
        })
        XCTAssertFalse(returnedReceipt)
        XCTAssertEqual(try Data(contentsOf: primary), bytes)
    }

    func testUnchangedReceiptRejectsSameInodeContentMutationAtEveryFinalCallback() throws {
        for faultPoint in [NativeDurabilityFaultPoint.afterFinalReread, .afterHashVerified] {
            let (_, root) = try makeScratch("unchanged-same-inode-\(faultPoint.rawValue)")
            let primary = root.appendingPathComponent("AssetTrackerBook.json")
            let bytes = Data("unchanged".utf8)
            let hx = Data("mutated!!".utf8)
            try writePrivate(bytes, to: primary)
            let writer = NativeDurableFileWriter(rootURL: root) { event in
                guard event.point == faultPoint, event.role == .primary else { return }
                var before = stat()
                XCTAssertEqual(Darwin.lstat(primary.path, &before), 0)
                try overwriteInPlaceForFault(hx, at: primary)
                var after = stat()
                XCTAssertEqual(Darwin.lstat(primary.path, &after), 0)
                XCTAssertEqual(before.st_dev, after.st_dev)
                XCTAssertEqual(before.st_ino, after.st_ino)
            }
            var returnedReceipt = false

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(bytes)))
                _ = try locked.durablyVerifyUnchangedPrimary(sourceProof: proof)
                returnedReceipt = true
            }, "faultPoint=\(faultPoint.rawValue)")
            XCTAssertFalse(returnedReceipt)
            XCTAssertEqual(try Data(contentsOf: primary), hx)
        }
    }

    func testValidatedReadsRequireOpenedFDToRemainTheCanonicalLeaf() throws {
        do {
            let (base, root) = try makeScratch("managed-read-leaf")
            let ordinary = root.appendingPathComponent("Recovery/ordinary", isDirectory: true)
            try makeDirectory(root.appendingPathComponent("Recovery", isDirectory: true))
            try makeDirectory(ordinary)
            let canonical = ordinary.appendingPathComponent("slots.json")
            let detached = base.appendingPathComponent("detached-slots")
            let bytes = Data("index".utf8)
            try writePrivate(bytes, to: canonical)
            let posix = RecordingNativePOSIX(
                afterFirstReadOfPath: "slots.json",
                afterFirstReadAction: {
                try FileManager.default.moveItem(at: canonical, to: detached)
                XCTAssertTrue(FileManager.default.createFile(atPath: canonical.path, contents: bytes))
                guard Darwin.chmod(canonical.path, 0o600) == 0 else { throw POSIXError(.EIO) }
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                _ = try locked.readValidated(relativePath: "Recovery/ordinary/slots.json")
            })
        }

        do {
            let (base, root) = try makeScratch("primary-proof-leaf")
            let canonical = root.appendingPathComponent("AssetTrackerBook.json")
            let detached = base.appendingPathComponent("detached-primary")
            let bytes = Data("primary".utf8)
            try writePrivate(bytes, to: canonical)
            let posix = RecordingNativePOSIX(
                afterFirstReadOfPath: "AssetTrackerBook.json",
                afterFirstReadAction: {
                try FileManager.default.moveItem(at: canonical, to: detached)
                XCTAssertTrue(FileManager.default.createFile(atPath: canonical.path, contents: bytes))
                guard Darwin.chmod(canonical.path, 0o600) == 0 else { throw POSIXError(.EIO) }
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                _ = try locked.verifyPrimarySource(expectedSource: .sha256(hash(bytes)))
            })
        }
    }

    func testFinalCanonicalRevalidationRejectsRootLockAndBoundDirectoryACLChanges() throws {
        enum Target {
            case root, lock, bound
        }
        for target in [Target.root, .lock, .bound] {
            let (_, root) = try makeScratch("final-acl-\(target)")
            let blobs = try makeOrdinaryBlobs(in: root)
            let bytes = Data("acl-race-\(target)".utf8)
            let targetURL: URL
            switch target {
            case .root:
                targetURL = root
            case .lock:
                targetURL = root.appendingPathComponent(".AssetTracker.storage.lock")
            case .bound:
                targetURL = blobs
            }
            let writer = NativeDurableFileWriter(rootURL: root) { event in
                guard event.point == .afterHashVerified, event.role == .ordinaryBlob else { return }
                try addACLForFault("group:everyone allow write", to: targetURL)
            }
            var returnedReceipt = false

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                _ = try locked.durableWrite(
                    bytes,
                    relativePath: "Recovery/ordinary/blobs/\(hash(bytes)).json",
                    disposition: .createOnly,
                    role: .ordinaryBlob
                )
                returnedReceipt = true
            }, "target=\(target)")
            XCTAssertFalse(returnedReceipt)
        }
    }

    func testFinalCanonicalRevalidationRejectsBenignACLReintroducedOnManagedRoot() throws {
        let (_, root) = try makeScratch("final-benign-root-acl")
        let blobs = try makeOrdinaryBlobs(in: root)
        let bytes = Data("benign root acl race".utf8)
        let writer = NativeDurableFileWriter(rootURL: root) { event in
            guard event.point == .afterHashVerified, event.role == .ordinaryBlob else { return }
            try addACLForFault("user:\(NSUserName()) allow read", to: root)
        }
        var returnedReceipt = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            _ = try locked.durableWrite(
                bytes,
                relativePath: "Recovery/ordinary/blobs/\(hash(bytes)).json",
                disposition: .createOnly,
                role: .ordinaryBlob
            )
            returnedReceipt = true
        })
        XCTAssertFalse(returnedReceipt)
        XCTAssertEqual(
            try Data(contentsOf: blobs.appendingPathComponent("\(hash(bytes)).json")),
            bytes
        )
    }

    func testEscapedLockedDirectoryFailsBeforeAnySyscallAfterUnlock() throws {
        let (_, root) = try makeScratch()
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var escaped: NativeLockedBookDirectory?

        try writer.withExclusiveMutationLock { locked in
            escaped = locked
        }
        let before = posix.snapshotCalls().count
        XCTAssertThrowsError(try escaped?.readValidated(relativePath: "AssetTrackerBook.json")) { error in
            XCTAssertEqual(error as? NativeDurableFileWriterError, .leaseExpired)
        }
        XCTAssertEqual(posix.snapshotCalls().count, before)
    }

    func testMutationLockScopeRejectsRecursiveAcquisitionAndIsReusableByTask7() throws {
        let (_, root) = try makeScratch()
        let writer = NativeDurableFileWriter(rootURL: root)
        let peerWriter = NativeDurableFileWriter(rootURL: root)

        try writer.withExclusiveMutationLock { _ in
            XCTAssertThrowsError(try writer.withExclusiveMutationLock { _ in }) { error in
                XCTAssertEqual(error as? NativeDurableFileWriterError, .recursiveLock)
            }
        }
        try writer.withExclusiveMutationLock { locked in
            try locked.revalidateCanonicalIdentity()
        }

        let enteredFirst = expectation(description: "first lock entered")
        let releaseFirst = DispatchSemaphore(value: 0)
        let firstFinished = expectation(description: "first lock finished")
        let secondEntered = expectation(description: "second lock entered")
        let secondEnteredSignal = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            defer { firstFinished.fulfill() }
            try? writer.withExclusiveMutationLock { _ in
                enteredFirst.fulfill()
                _ = releaseFirst.wait(timeout: .now() + 3)
            }
        }
        wait(for: [enteredFirst], timeout: 2)
        DispatchQueue.global().async {
            try? peerWriter.withExclusiveMutationLock { _ in
                secondEnteredSignal.signal()
                secondEntered.fulfill()
            }
        }
        XCTAssertEqual(secondEnteredSignal.wait(timeout: .now() + 0.15), .timedOut)
        releaseFirst.signal()
        wait(for: [firstFinished, secondEntered], timeout: 3)
    }

    func testProcessRegistryRejectsSameRootSameThreadAcrossWriterInstancesBeforeFlock() throws {
        let (_, root) = try makeScratch()
        let firstWriter = NativeDurableFileWriter(rootURL: root)
        let secondWriter = NativeDurableFileWriter(rootURL: root)
        let finished = expectation(description: "nested acquisition returned")
        let errorRecorder = ErrorRecorder()

        DispatchQueue.global().async {
            defer { finished.fulfill() }
            do {
                try firstWriter.withExclusiveMutationLock { _ in
                    try secondWriter.withExclusiveMutationLock { _ in }
                }
            } catch {
                errorRecorder.record(error)
            }
        }

        XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 0.5), .completed)
        XCTAssertEqual(errorRecorder.snapshot() as? NativeDurableFileWriterError, .recursiveLock)
    }

    func testProcessRegistryAllowsSameThreadToNestDifferentRoots() throws {
        let (_, firstRoot) = try makeScratch("registry-first-root")
        let (_, secondRoot) = try makeScratch("registry-second-root")
        let firstWriter = NativeDurableFileWriter(rootURL: firstRoot)
        let secondWriter = NativeDurableFileWriter(rootURL: secondRoot)

        try firstWriter.withExclusiveMutationLock { _ in
            try secondWriter.withExclusiveMutationLock { locked in
                try locked.revalidateCanonicalIdentity()
            }
        }
    }

    func testUnchangedPrimaryVerificationRunsFileAndDirectoryDurabilityWithoutRename() throws {
        let (_, root) = try makeScratch()
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        let bytes = Data("unchanged".utf8)
        try writePrivate(bytes, to: primary)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        let receipt = try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(bytes)))
            return try locked.durablyVerifyUnchangedPrimary(sourceProof: proof)
        }

        XCTAssertEqual(receipt.sha256, hash(bytes))
        let calls = posix.snapshotCalls()
        XCTAssertTrue(calls.contains { $0.hasPrefix("syncFile:") })
        XCTAssertTrue(calls.contains { $0.hasPrefix("fullSyncFile:") })
        XCTAssertTrue(calls.contains { $0.hasPrefix("syncDirectory:") })
        XCTAssertFalse(calls.contains { $0.hasPrefix("renameAt:.AssetTracker.tmp.") })
        XCTAssertEqual(try Data(contentsOf: primary), bytes)
    }

    func testLegacy0644CandidateEqualsSourceNoOpIsAdmittedWithoutInventingAReplacement() throws {
        let (_, root) = try makeScratch()
        XCTAssertEqual(Darwin.chmod(root.path, 0o755), 0)
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        let bytes = Data("legacy unchanged".utf8)
        try writePrivate(bytes, to: primary)
        XCTAssertEqual(Darwin.chmod(primary.path, 0o644), 0)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        let receipt = try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(bytes)))
            return try locked.durablyVerifyUnchangedPrimary(sourceProof: proof)
        }

        XCTAssertEqual(receipt.sha256, hash(bytes))
        XCTAssertEqual(receipt.mode, 0o644)
        XCTAssertEqual(try permissions(root), 0o700)
        XCTAssertEqual(try permissions(primary), 0o644)
        XCTAssertFalse(posix.snapshotCalls().contains {
            $0.hasPrefix("renameAt:.AssetTracker.tmp.")
        })
    }

    func testManagedDirectorySyncRevalidatesBoundIdentityWithoutMutation() throws {
        let (_, root) = try makeScratch()
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            let beforeRecovery = posix.snapshotCalls().count
            try locked.createManagedDirectory(relativePath: "Recovery", role: .snapshotDirectory)
            let recoveryCreation = Array(posix.snapshotCalls().dropFirst(beforeRecovery))
            XCTAssertTrue(recoveryCreation.contains { $0.hasPrefix("makeDirectoryAt:Recovery:") })
            XCTAssertGreaterThanOrEqual(
                recoveryCreation.filter { $0.hasPrefix("syncDirectory:") }.count,
                2,
                "the created directory and its parent must both be synchronized"
            )

            let beforeSnapshots = posix.snapshotCalls().count
            try locked.createManagedDirectory(relativePath: "Recovery/snapshots", role: .snapshotDirectory)
            let snapshotCreation = Array(posix.snapshotCalls().dropFirst(beforeSnapshots))
            XCTAssertTrue(snapshotCreation.contains { $0.hasPrefix("makeDirectoryAt:snapshots:") })
            XCTAssertGreaterThanOrEqual(
                snapshotCreation.filter { $0.hasPrefix("syncDirectory:") }.count,
                2,
                "the created directory and its parent must both be synchronized"
            )
            try locked.durablySyncManagedDirectory(
                relativePath: "Recovery/snapshots",
                role: .snapshotFinalIndex
            )
            let entries = try locked.enumerate(relativePath: "Recovery/snapshots")
            XCTAssertTrue(entries.isEmpty)
        }

        let calls = posix.snapshotCalls()
        XCTAssertTrue(calls.contains { $0.hasPrefix("syncDirectory:") })
        XCTAssertTrue(calls.contains { $0.hasPrefix("directoryEntries:") })
        XCTAssertFalse(calls.contains { $0.hasPrefix("renameAt:.AssetTracker.tmp.") })
        XCTAssertFalse(calls.contains { $0.hasPrefix("write:") })
    }

    func testExistingManagedDirectoryRetryDurablySyncsChildAndParentAfterInterruptedCreation() throws {
        let (_, root) = try makeScratch("managed-dir-existing-retry")
        try NativeDurableFileWriter(rootURL: root).withExclusiveMutationLock { locked in
            try locked.createManagedDirectory(relativePath: "Recovery", role: .ordinaryDirectory)
        }
        let interruptedPOSIX = RecordingNativePOSIX(syncDirectoryFailurePath: "Recovery")
        let interruptedWriter = NativeDurableFileWriter(
            rootURL: root,
            posix: interruptedPOSIX,
            faultHandler: { _ in }
        )

        XCTAssertThrowsError(try interruptedWriter.withExclusiveMutationLock { locked in
            try locked.createManagedDirectory(
                relativePath: "Recovery/ordinary",
                role: .ordinaryDirectory
            )
        })
        XCTAssertTrue(fileManager.fileExists(atPath: root.appendingPathComponent("Recovery/ordinary").path))

        let freshPOSIX = RecordingNativePOSIX()
        let freshWriter = NativeDurableFileWriter(
            rootURL: root,
            posix: freshPOSIX,
            faultHandler: { _ in }
        )
        try freshWriter.withExclusiveMutationLock { locked in
            let before = freshPOSIX.snapshotCalls().count
            try locked.createManagedDirectory(
                relativePath: "Recovery/ordinary",
                role: .ordinaryDirectory
            )
            let retryCalls = Array(freshPOSIX.snapshotCalls().dropFirst(before))
            XCTAssertGreaterThanOrEqual(
                retryCalls.filter { $0.hasPrefix("syncDirectory:") }.count,
                2,
                "an existing canonical directory retry must durably converge its own and parent entries"
            )
        }
    }

    func testExistingManagedDirectoryRejectsSecondParentOpenSwapBeforeDurabilityClaim() throws {
        let (base, root) = try makeScratch("managed-dir-second-parent-swap")
        let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
        let ordinary = recovery.appendingPathComponent("ordinary", isDirectory: true)
        let detachedRecovery = base.appendingPathComponent("detached-recovery", isDirectory: true)
        try makeDirectory(recovery)
        try makeDirectory(ordinary)
        let posix = RecordingNativePOSIX(
            beforeFstatAtPath: "Recovery",
            beforeFstatAtOccurrence: 3,
            beforeFstatAtAction: {
                try swapDirectoryForFault(
                    canonical: recovery,
                    detached: detachedRecovery,
                    replacementChildren: ["ordinary"]
                )
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returnedSuccess = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            try locked.createManagedDirectory(
                relativePath: "Recovery/ordinary",
                role: .ordinaryDirectory
            )
            returnedSuccess = true
        })
        XCTAssertFalse(returnedSuccess)
        XCTAssertTrue(fileManager.fileExists(atPath: recovery.appendingPathComponent("ordinary").path))
        XCTAssertTrue(fileManager.fileExists(atPath: detachedRecovery.appendingPathComponent("ordinary").path))
    }

    func testCreatedManagedDirectoryRejectsCanonicalLeafSwapDuringSyncWindow() throws {
        let (base, root) = try makeScratch("managed-dir-created-leaf-swap")
        let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
        let ordinary = recovery.appendingPathComponent("ordinary", isDirectory: true)
        let detachedOrdinary = base.appendingPathComponent("detached-ordinary", isDirectory: true)
        try makeDirectory(recovery)
        let posix = RecordingNativePOSIX(
            afterSyncDirectoryPath: "ordinary",
            afterSyncDirectoryAction: {
                try swapDirectoryForFault(canonical: ordinary, detached: detachedOrdinary)
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returnedSuccess = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            try locked.createManagedDirectory(
                relativePath: "Recovery/ordinary",
                role: .ordinaryDirectory
            )
            returnedSuccess = true
        })
        XCTAssertFalse(returnedSuccess)
        XCTAssertTrue(fileManager.fileExists(atPath: ordinary.path))
        XCTAssertTrue(fileManager.fileExists(atPath: detachedOrdinary.path))
    }

    func testExistingManagedDirectoryDeletionAfterInitialProbeFailsClosedWithoutMkdir() throws {
        let (base, root) = try makeScratch("managed-dir-delete-after-probe")
        let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
        let ordinary = recovery.appendingPathComponent("ordinary", isDirectory: true)
        let detachedOrdinary = base.appendingPathComponent("detached-ordinary", isDirectory: true)
        try makeDirectory(recovery)
        try makeDirectory(ordinary)
        let posix = RecordingNativePOSIX(
            beforeFstatAtPath: "ordinary",
            beforeFstatAtOccurrence: 2,
            beforeFstatAtAction: {
                try FileManager.default.moveItem(at: ordinary, to: detachedOrdinary)
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returnedSuccess = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            try locked.createManagedDirectory(
                relativePath: "Recovery/ordinary",
                role: .ordinaryDirectory
            )
            returnedSuccess = true
        })
        XCTAssertFalse(returnedSuccess)
        XCTAssertFalse(fileManager.fileExists(atPath: ordinary.path))
        XCTAssertTrue(fileManager.fileExists(atPath: detachedOrdinary.path))
        XCTAssertFalse(posix.snapshotCalls().contains("makeDirectoryAt:ordinary:448"))
    }

    func testIllegalSemanticRoleAndManagedTargetPairFailsBeforeAnySyscall() throws {
        let (_, root) = try makeScratch()
        _ = try makeOrdinaryBlobs(in: root)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(try locked.durableWrite(
                Data("bad".utf8),
                relativePath: "Recovery/ordinary/slots.json",
                disposition: .replace,
                role: .snapshotFinalIndex
            ))
            XCTAssertThrowsError(try locked.durableWrite(
                Data("escape".utf8),
                relativePath: "../escape.json",
                disposition: .replace,
                role: .ordinaryCommittedIndex
            ))
            XCTAssertThrowsError(try locked.createManagedDirectory(
                relativePath: "Recovery/snapshots",
                role: .ordinaryDirectory
            ))
            XCTAssertThrowsError(try locked.durablySyncManagedDirectory(
                relativePath: "Recovery/ordinary",
                role: .snapshotFinalIndex
            ))
            XCTAssertEqual(posix.snapshotCalls().count, before)
        }
    }

    func testSnapshotPendingUnlinkFaultsBracketUnlinkAndDirectorySyncExactly() throws {
        let (_, root) = try makeScratch()
        let snapshots = try makeSnapshots(in: root)
        let bytes = Data("snapshot".utf8)
        let relativePath = "Recovery/snapshots/\(hash(bytes)).json"
        try writePrivate(bytes, to: snapshots.appendingPathComponent("\(hash(bytes)).json"))
        let events = FaultEventRecorder()
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix) { events.record($0) }

        try writer.withExclusiveMutationLock { locked in
            try locked.unlinkSnapshotPendingAndSync(relativePath: relativePath)
        }

        XCTAssertFalse(fileManager.fileExists(atPath: snapshots.appendingPathComponent("\(hash(bytes)).json").path))
        XCTAssertEqual(
            events.snapshot().filter {
                [.beforeRetentionUnlink, .afterRetentionUnlink, .afterRetentionDirectoryFSync].contains($0.point)
            }.map(\.point),
            [.beforeRetentionUnlink, .afterRetentionUnlink, .afterRetentionDirectoryFSync]
        )
        let calls = posix.snapshotCalls()
        let unlinkIndex = try XCTUnwrap(calls.firstIndex { $0.hasPrefix("unlinkAt:") })
        let syncIndex = try XCTUnwrap(calls.lastIndex { $0.hasPrefix("syncDirectory:") })
        XCTAssertLessThan(unlinkIndex, syncIndex)
    }

    func testSnapshotPendingUnlinkNeverDeletesAReplacementCanonicalLeaf() throws {
        let (base, root) = try makeScratch()
        let snapshots = try makeSnapshots(in: root)
        let retainedBytes = Data("retained snapshot".utf8)
        let replacement = Data("unknown replacement".utf8)
        let name = "\(hash(retainedBytes)).json"
        let canonical = snapshots.appendingPathComponent(name)
        let detached = base.appendingPathComponent("detached-snapshot")
        try writePrivate(retainedBytes, to: canonical)
        let writer = NativeDurableFileWriter(rootURL: root) { event in
            guard event.point == .beforeRetentionUnlink else { return }
            try FileManager.default.moveItem(at: canonical, to: detached)
            try writePrivateForFault(replacement, to: canonical)
        }

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            try locked.unlinkSnapshotPendingAndSync(relativePath: "Recovery/snapshots/\(name)")
        })
        XCTAssertEqual(try Data(contentsOf: canonical), replacement)
        XCTAssertEqual(try Data(contentsOf: detached), retainedBytes)
    }

    func testSnapshotPendingUnlinkDoesNotReportSuccessWhenCallbackRecreatesCanonicalLeaf() throws {
        for callback in [
            NativeDurabilityFaultPoint.afterRetentionUnlink,
            .afterRetentionDirectoryFSync,
        ] {
            let (_, root) = try makeScratch("retention-recreate-\(callback.rawValue)")
            let snapshots = try makeSnapshots(in: root)
            let retainedBytes = Data("retained snapshot".utf8)
            let replacement = Data("unknown recreated leaf".utf8)
            let name = "\(hash(retainedBytes)).json"
            let canonical = snapshots.appendingPathComponent(name)
            try writePrivate(retainedBytes, to: canonical)
            let writer = NativeDurableFileWriter(rootURL: root) { event in
                guard event.point == callback else { return }
                try writePrivateForFault(replacement, to: canonical)
            }
            var returnedSuccess = false

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                try locked.unlinkSnapshotPendingAndSync(
                    relativePath: "Recovery/snapshots/\(name)"
                )
                returnedSuccess = true
            }, "callback=\(callback.rawValue)")
            XCTAssertFalse(returnedSuccess, "callback=\(callback.rawValue)")
            XCTAssertEqual(try Data(contentsOf: canonical), replacement)
        }
    }

    func testOrdinaryPendingUnlinkNeverEmitsSnapshotRetentionFaultPoints() throws {
        let (_, root) = try makeScratch()
        let blobs = try makeOrdinaryBlobs(in: root)
        let bytes = Data("ordinary".utf8)
        let relativePath = "Recovery/ordinary/blobs/\(hash(bytes)).json"
        try writePrivate(bytes, to: blobs.appendingPathComponent("\(hash(bytes)).json"))
        let events = FaultEventRecorder()
        let writer = NativeDurableFileWriter(rootURL: root) { events.record($0) }

        try writer.withExclusiveMutationLock { locked in
            try locked.unlinkOrdinaryPendingAndSync(relativePath: relativePath)
        }

        XCTAssertFalse(fileManager.fileExists(atPath: blobs.appendingPathComponent("\(hash(bytes)).json").path))
        XCTAssertTrue(events.snapshot().allSatisfy {
            ![.beforeRetentionUnlink, .afterRetentionUnlink, .afterRetentionDirectoryFSync].contains($0.point)
        })
    }
}

private final class FaultEventRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [NativeDurabilityFaultEvent] = []

    func record(_ event: NativeDurabilityFaultEvent) {
        lock.lock()
        events.append(event)
        lock.unlock()
    }

    func snapshot() -> [NativeDurabilityFaultEvent] {
        lock.lock()
        defer { lock.unlock() }
        return events
    }
}

private final class URLRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var value: URL?

    func record(_ value: URL) {
        lock.lock()
        self.value = value
        lock.unlock()
    }

    func snapshot() -> URL? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

private final class ErrorRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Error?

    func record(_ value: Error) {
        lock.lock()
        self.value = value
        lock.unlock()
    }

    func snapshot() -> Error? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

private final class RecordingNativePOSIX: NativePOSIX, @unchecked Sendable {
    enum WriteStep {
        case interrupt
        case zero
        case limit(Int)
    }

    enum LockBootstrapFailure: CaseIterable {
        case clearACL, changeMode, syncFile, fullSyncFile, rename, directorySync
    }

    private let lock = NSLock()
    private let base = DarwinNativePOSIX()
    private var writeSteps: [WriteStep]
    private let overriddenUserID: uid_t?
    private let overriddenACLEntryCount: Int?
    private let rootCreationRaceURL: URL?
    private let afterFirstReadOfPath: String?
    private let afterFirstReadAction: (@Sendable () throws -> Void)?
    private let afterPositiveReadOfPathPrefix: String?
    private let afterPositiveReadOccurrence: Int
    private let afterPositiveReadAction: (@Sendable () throws -> Void)?
    private let lockBootstrapFailure: LockBootstrapFailure?
    private let clearACLFailurePathPrefix: String?
    private let simulateLockRenameRace: Bool
    private let newLockTempInitialMode: mode_t?
    private let syncDirectoryFailurePath: String?
    private let beforeFstatAtPath: String?
    private let beforeFstatAtOccurrence: Int
    private let beforeFstatAtAction: (@Sendable () throws -> Void)?
    private let afterSyncDirectoryPath: String?
    private let afterSyncDirectoryAction: (@Sendable () throws -> Void)?
    private var shouldReportRootMissing = true
    private var shouldLoseRootCreationRace = true
    private var shouldFailLockBootstrap = true
    private var shouldFailClearACL = true
    private var shouldFailDirectorySync = true
    private var fstatAtCounts: [String: Int] = [:]
    private var shouldRunAfterDirectorySync = true
    private var lockBootstrapWasPublished = false
    private var shouldSimulateLockRenameRace = true
    private var openedPaths: [Int32: String] = [:]
    private var injectedReadPaths: Set<String> = []
    private var positiveReadMatchCount = 0
    private(set) var calls: [String] = []

    init(
        writeSteps: [WriteStep] = [],
        effectiveUserID: uid_t? = nil,
        aclEntryCount: Int? = nil,
        rootCreationRaceURL: URL? = nil,
        afterFirstReadOfPath: String? = nil,
        afterFirstReadAction: (@Sendable () throws -> Void)? = nil,
        afterPositiveReadOfPathPrefix: String? = nil,
        afterPositiveReadOccurrence: Int = 1,
        afterPositiveReadAction: (@Sendable () throws -> Void)? = nil,
        lockBootstrapFailure: LockBootstrapFailure? = nil,
        clearACLFailurePathPrefix: String? = nil,
        simulateLockRenameRace: Bool = false,
        newLockTempInitialMode: mode_t? = nil,
        syncDirectoryFailurePath: String? = nil,
        beforeFstatAtPath: String? = nil,
        beforeFstatAtOccurrence: Int = 1,
        beforeFstatAtAction: (@Sendable () throws -> Void)? = nil,
        afterSyncDirectoryPath: String? = nil,
        afterSyncDirectoryAction: (@Sendable () throws -> Void)? = nil
    ) {
        self.writeSteps = writeSteps
        self.overriddenUserID = effectiveUserID
        self.overriddenACLEntryCount = aclEntryCount
        self.rootCreationRaceURL = rootCreationRaceURL
        self.afterFirstReadOfPath = afterFirstReadOfPath
        self.afterFirstReadAction = afterFirstReadAction
        self.afterPositiveReadOfPathPrefix = afterPositiveReadOfPathPrefix
        self.afterPositiveReadOccurrence = afterPositiveReadOccurrence
        self.afterPositiveReadAction = afterPositiveReadAction
        self.lockBootstrapFailure = lockBootstrapFailure
        self.clearACLFailurePathPrefix = clearACLFailurePathPrefix
        self.simulateLockRenameRace = simulateLockRenameRace
        self.newLockTempInitialMode = newLockTempInitialMode
        self.syncDirectoryFailurePath = syncDirectoryFailurePath
        self.beforeFstatAtPath = beforeFstatAtPath
        self.beforeFstatAtOccurrence = beforeFstatAtOccurrence
        self.beforeFstatAtAction = beforeFstatAtAction
        self.afterSyncDirectoryPath = afterSyncDirectoryPath
        self.afterSyncDirectoryAction = afterSyncDirectoryAction
    }

    func callCount(prefix: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return calls.count { $0.hasPrefix(prefix) }
    }

    func snapshotCalls() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return calls
    }

    private func record(_ call: String) {
        lock.lock()
        calls.append(call)
        lock.unlock()
    }

    private func path(for fileFD: Int32) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return openedPaths[fileFD]
    }

    private func consumeLockBootstrapFailure(
        _ step: LockBootstrapFailure,
        fileFD: Int32? = nil
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard shouldFailLockBootstrap, lockBootstrapFailure == step else { return false }
        if let fileFD,
           !(openedPaths[fileFD]?.hasPrefix(".AssetTracker.lock.tmp.") ?? false) {
            return false
        }
        if step == .directorySync, !lockBootstrapWasPublished { return false }
        shouldFailLockBootstrap = false
        return true
    }

    func effectiveUserID() -> uid_t {
        record("effectiveUserID")
        return overriddenUserID ?? base.effectiveUserID()
    }

    func openAt(directoryFD: Int32, path: String, flags: Int32, mode: mode_t) throws -> Int32 {
        record("openAt:\(path):\(flags)")
        let result = try base.openAt(directoryFD: directoryFD, path: path, flags: flags, mode: mode)
        if path.hasPrefix(".AssetTracker.lock.tmp."), let newLockTempInitialMode {
            try base.changeMode(fileFD: result, mode: newLockTempInitialMode)
        }
        lock.lock()
        openedPaths[result] = path
        lock.unlock()
        return result
    }

    func makeDirectoryAt(directoryFD: Int32, path: String, mode: mode_t) throws {
        record("makeDirectoryAt:\(path):\(mode)")
        var loseRace = false
        lock.lock()
        if rootCreationRaceURL?.lastPathComponent == path, shouldLoseRootCreationRace {
            shouldLoseRootCreationRace = false
            loseRace = true
        }
        lock.unlock()
        if loseRace {
            try base.makeDirectoryAt(directoryFD: directoryFD, path: path, mode: mode)
            guard let rootCreationRaceURL,
                  Darwin.chmod(rootCreationRaceURL.path, 0o700) == 0
            else {
                throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
            }
            throw POSIXError(.EEXIST)
        }
        try base.makeDirectoryAt(directoryFD: directoryFD, path: path, mode: mode)
    }

    func read(fileFD: Int32, bytes: UnsafeMutableRawBufferPointer) throws -> Int {
        record("read:\(fileFD):\(bytes.count)")
        let count = try base.read(fileFD: fileFD, bytes: bytes)
        var firstReadAction: (@Sendable () throws -> Void)?
        var positiveReadAction: (@Sendable () throws -> Void)?
        lock.lock()
        if count > 0,
           let path = openedPaths[fileFD],
           path == afterFirstReadOfPath,
           !injectedReadPaths.contains(path) {
            injectedReadPaths.insert(path)
            firstReadAction = afterFirstReadAction
        }
        if count > 0,
           let path = openedPaths[fileFD],
           let prefix = afterPositiveReadOfPathPrefix,
           path.hasPrefix(prefix) {
            positiveReadMatchCount += 1
            if positiveReadMatchCount == afterPositiveReadOccurrence {
                positiveReadAction = afterPositiveReadAction
            }
        }
        lock.unlock()
        try firstReadAction?()
        try positiveReadAction?()
        return count
    }

    func write(fileFD: Int32, bytes: UnsafeRawBufferPointer) throws -> Int {
        record("write:\(fileFD):\(bytes.count)")
        let step: WriteStep?
        lock.lock()
        step = writeSteps.isEmpty ? nil : writeSteps.removeFirst()
        lock.unlock()
        switch step {
        case .interrupt:
            throw POSIXError(.EINTR)
        case .zero:
            return 0
        case .limit(let count):
            let prefix = UnsafeRawBufferPointer(rebasing: bytes.prefix(min(count, bytes.count)))
            return try base.write(fileFD: fileFD, bytes: prefix)
        case nil:
            return try base.write(fileFD: fileFD, bytes: bytes)
        }
    }

    func flock(fileFD: Int32, operation: Int32) throws {
        record("flock:\(fileFD):\(operation)")
        try base.flock(fileFD: fileFD, operation: operation)
    }

    func fstat(fileFD: Int32) throws -> stat {
        record("fstat:\(fileFD)")
        return try base.fstat(fileFD: fileFD)
    }

    func syncFile(fileFD: Int32) throws {
        record("syncFile:\(fileFD)")
        if consumeLockBootstrapFailure(.syncFile, fileFD: fileFD) {
            throw InjectedWriterFault.stop
        }
        try base.syncFile(fileFD: fileFD)
    }

    func fullSyncFile(fileFD: Int32) throws {
        record("fullSyncFile:\(fileFD)")
        if consumeLockBootstrapFailure(.fullSyncFile, fileFD: fileFD) {
            throw InjectedWriterFault.stop
        }
        try base.fullSyncFile(fileFD: fileFD)
    }

    func changeMode(fileFD: Int32, mode: mode_t) throws {
        record("changeMode:\(fileFD):\(mode)")
        if consumeLockBootstrapFailure(.changeMode, fileFD: fileFD) {
            throw InjectedWriterFault.stop
        }
        try base.changeMode(fileFD: fileFD, mode: mode)
    }

    func renameAt(
        sourceDirectoryFD: Int32,
        source: String,
        destinationDirectoryFD: Int32,
        destination: String,
        exclusive: Bool
    ) throws {
        record("renameAt:\(source):\(destination):\(exclusive)")
        var simulateRace = false
        lock.lock()
        if simulateLockRenameRace,
           shouldSimulateLockRenameRace,
           source.hasPrefix(".AssetTracker.lock.tmp.") {
            shouldSimulateLockRenameRace = false
            simulateRace = true
        }
        lock.unlock()
        if simulateRace {
            let competingFD = try base.openAt(
                directoryFD: destinationDirectoryFD,
                path: destination,
                flags: O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                mode: 0o600
            )
            defer { base.close(fileFD: competingFD) }
            try base.clearExtendedACL(fileFD: competingFD)
            try base.changeMode(fileFD: competingFD, mode: 0o600)
            try base.syncFile(fileFD: competingFD)
            try base.fullSyncFile(fileFD: competingFD)
            try base.syncDirectory(directoryFD: destinationDirectoryFD)
            throw POSIXError(.EEXIST)
        }
        if source.hasPrefix(".AssetTracker.lock.tmp."),
           consumeLockBootstrapFailure(.rename) {
            throw InjectedWriterFault.stop
        }
        try base.renameAt(
            sourceDirectoryFD: sourceDirectoryFD,
            source: source,
            destinationDirectoryFD: destinationDirectoryFD,
            destination: destination,
            exclusive: exclusive
        )
        if source.hasPrefix(".AssetTracker.lock.tmp.") {
            lock.lock()
            lockBootstrapWasPublished = true
            lock.unlock()
        }
    }

    func syncDirectory(directoryFD: Int32) throws {
        record("syncDirectory:\(directoryFD)")
        if consumeLockBootstrapFailure(.directorySync) {
            throw InjectedWriterFault.stop
        }
        lock.lock()
        let failRequestedPath = shouldFailDirectorySync
            && openedPaths[directoryFD] == syncDirectoryFailurePath
        if failRequestedPath { shouldFailDirectorySync = false }
        lock.unlock()
        if failRequestedPath { throw InjectedWriterFault.stop }
        try base.syncDirectory(directoryFD: directoryFD)
        var action: (@Sendable () throws -> Void)?
        lock.lock()
        if shouldRunAfterDirectorySync,
           openedPaths[directoryFD] == afterSyncDirectoryPath {
            shouldRunAfterDirectorySync = false
            action = afterSyncDirectoryAction
        }
        lock.unlock()
        try action?()
    }

    func fstatAt(directoryFD: Int32, path: String, noFollow: Bool) throws -> stat {
        record("fstatAt:\(path):\(noFollow)")
        var action: (@Sendable () throws -> Void)?
        var reportMissing = false
        lock.lock()
        fstatAtCounts[path, default: 0] += 1
        if path == beforeFstatAtPath,
           fstatAtCounts[path] == beforeFstatAtOccurrence {
            action = beforeFstatAtAction
        }
        if rootCreationRaceURL?.lastPathComponent == path, shouldReportRootMissing {
            shouldReportRootMissing = false
            reportMissing = true
        }
        lock.unlock()
        try action?()
        if reportMissing { throw POSIXError(.ENOENT) }
        return try base.fstatAt(directoryFD: directoryFD, path: path, noFollow: noFollow)
    }

    func directoryEntries(directoryFD: Int32) throws -> [NativeDirectoryEntry] {
        record("directoryEntries:\(directoryFD)")
        return try base.directoryEntries(directoryFD: directoryFD)
    }

    func extendedACLEntryCount(fileFD: Int32) throws -> Int {
        record("extendedACLEntryCount:\(fileFD)")
        if let overriddenACLEntryCount { return overriddenACLEntryCount }
        return try base.extendedACLEntryCount(fileFD: fileFD)
    }

    func hasDangerousLegacyACL(fileFD: Int32, ownerUserID: uid_t) throws -> Bool {
        record("hasDangerousLegacyACL:\(fileFD):\(ownerUserID)")
        return try base.hasDangerousLegacyACL(fileFD: fileFD, ownerUserID: ownerUserID)
    }

    func clearExtendedACL(fileFD: Int32) throws {
        record("clearExtendedACL:\(fileFD)")
        let currentPath = path(for: fileFD)
        lock.lock()
        let failRequestedPath = shouldFailClearACL
            && currentPath?.hasPrefix(clearACLFailurePathPrefix ?? "\0") == true
        if failRequestedPath { shouldFailClearACL = false }
        lock.unlock()
        if failRequestedPath || consumeLockBootstrapFailure(.clearACL, fileFD: fileFD) {
            throw InjectedWriterFault.stop
        }
        try base.clearExtendedACL(fileFD: fileFD)
    }

    func unlinkAt(directoryFD: Int32, path: String) throws {
        record("unlinkAt:\(path)")
        try base.unlinkAt(directoryFD: directoryFD, path: path)
    }

    func close(fileFD: Int32) {
        record("close:\(fileFD)")
        lock.lock()
        openedPaths.removeValue(forKey: fileFD)
        lock.unlock()
        base.close(fileFD: fileFD)
    }
}

private enum InjectedWriterFault: Error {
    case stop
}
