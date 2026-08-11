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

private struct WriterTestFileIdentity: Equatable {
    let device: UInt64
    let inode: UInt64
}

private func writerTestFileIdentity(of url: URL) throws -> WriterTestFileIdentity {
    var value = stat()
    guard Darwin.lstat(url.path, &value) == 0 else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return WriterTestFileIdentity(
        device: UInt64(value.st_dev),
        inode: UInt64(value.st_ino)
    )
}

private func setWriterTestUserImmutable(_ url: URL) throws {
    guard Darwin.chflags(url.path, UInt32(UF_IMMUTABLE)) == 0 else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
}

private func clearWriterTestFileFlags(_ url: URL) throws {
    guard Darwin.chflags(url.path, 0) == 0 else {
        if errno == ENOENT { return }
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
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

    private func makeOrdinaryPendingFixture(
        _ name: String,
        sourceBytes: Data,
        indexBytes: Data,
        blobBytes: Data,
        blobPresent: Bool = true
    ) throws -> (
        base: URL,
        root: URL,
        ordinary: URL,
        blobs: URL,
        slots: URL,
        primary: URL,
        blob: URL,
        relativePath: String
    ) {
        let (base, root) = try makeScratch(name)
        let blobs = try makeOrdinaryBlobs(in: root)
        let ordinary = blobs.deletingLastPathComponent()
        let slots = ordinary.appendingPathComponent("slots.json")
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        let blobName = "\(hash(blobBytes)).json"
        let blob = blobs.appendingPathComponent(blobName)
        try writePrivate(indexBytes, to: slots)
        try writePrivate(sourceBytes, to: primary)
        if blobPresent {
            try writePrivate(blobBytes, to: blob)
        }
        return (
            base,
            root,
            ordinary,
            blobs,
            slots,
            primary,
            blob,
            "Recovery/ordinary/blobs/\(blobName)"
        )
    }

    private func makeIndexlessOrdinary(in root: URL) throws -> URL {
        let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
        let ordinary = recovery.appendingPathComponent("ordinary", isDirectory: true)
        try makeDirectory(recovery)
        try makeDirectory(ordinary)
        return ordinary
    }

    private func ordinaryEmptyIndexTempName(_ uuid: String) -> String {
        ".AssetTracker.tmp.\(uuid)"
    }

    private func assertReadOnlyWriterCalls(
        _ calls: [String],
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let mutationPrefixes = [
            "makeDirectoryAt:", "write:", "syncFile:", "fullSyncFile:",
            "changeMode:", "renameAt:", "syncDirectory:", "clearExtendedACL:",
            "unlinkAt:",
        ]
        XCTAssertFalse(
            calls.contains { call in mutationPrefixes.contains { call.hasPrefix($0) } },
            "audit issued a mutating syscall: \(calls)",
            file: file,
            line: line
        )
    }

    private func assertZeroWriteAuditCalls(
        _ calls: [String],
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        assertReadOnlyWriterCalls(calls, file: file, line: line)
        for call in calls where call.hasPrefix("openAt:") {
            guard let rawFlags = Int32(call.split(separator: ":").last ?? "") else {
                XCTFail("could not parse open flags: \(call)", file: file, line: line)
                continue
            }
            XCTAssertEqual(
                rawFlags & (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC),
                0,
                "read-only audit used write-capable open flags: \(call)",
                file: file,
                line: line
            )
        }
        XCTAssertFalse(
            calls.contains { $0.contains(".AssetTracker.lock.tmp.") },
            "read-only audit touched a lock temp: \(calls)",
            file: file,
            line: line
        )
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

    func testGenericDurableWriteRejectsProofRequiredOrdinaryHealthIndexBeforeAnyMutation() throws {
        let (_, root) = try makeScratch("proof-required-health-index")
        let blobs = try makeOrdinaryBlobs(in: root)
        let ordinary = blobs.deletingLastPathComponent()
        let slots = ordinary.appendingPathComponent("slots.json")
        let originalBytes = Data("newer-index-must-survive".utf8)
        let attemptedBytes = Data("proofless-health-clear-must-not-write".utf8)
        try writePrivate(originalBytes, to: slots)
        let entriesBefore = try fileManager.contentsOfDirectory(atPath: ordinary.path).sorted()
        var statBefore = stat()
        XCTAssertEqual(Darwin.lstat(slots.path, &statBefore), 0)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(
            rootURL: root,
            posix: posix,
            faultHandler: { _ in }
        )

        try writer.withExclusiveMutationLock { locked in
            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(
                try locked.durableWrite(
                    attemptedBytes,
                    relativePath: "Recovery/ordinary/slots.json",
                    disposition: .replace,
                    role: .ordinaryHealthIndex
                )
            ) { error in
                XCTAssertEqual(error as? NativeDurableFileWriterError, .invalidRoleTarget)
            }
            XCTAssertEqual(
                Array(posix.snapshotCalls().dropFirst(before)),
                [],
                "proof-required roles must be rejected before temp creation or any POSIX validation"
            )
        }

        XCTAssertEqual(try Data(contentsOf: slots), originalBytes)
        XCTAssertEqual(try fileManager.contentsOfDirectory(atPath: ordinary.path).sorted(), entriesBefore)
        var statAfter = stat()
        XCTAssertEqual(Darwin.lstat(slots.path, &statAfter), 0)
        XCTAssertEqual(UInt64(statBefore.st_dev), UInt64(statAfter.st_dev))
        XCTAssertEqual(UInt64(statBefore.st_ino), UInt64(statAfter.st_ino))
    }

    func testSnapshotIndexCreateFinalAndHealthWritesAreSourceBoundProofCAS() throws {
        let (_, root) = try makeScratch("snapshot-index-proof-cas")
        let snapshots = try makeSnapshots(in: root)
        let primaryBytes = Data("snapshot-index-proof-source".utf8)
        let emptyBytes = Data("snapshot-empty-index".utf8)
        let finalBytes = Data("snapshot-final-index".utf8)
        let healthyBytes = Data("snapshot-healthy-index".utf8)
        try writePrivate(primaryBytes, to: root.appendingPathComponent("AssetTrackerBook.json"))
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            let sourceProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(primaryBytes))
            )
            let emptyProof = try locked.durableCreateSnapshotIndex(
                emptyBytes,
                sourceProof: sourceProof
            )
            XCTAssertEqual(emptyProof.bytes, emptyBytes)
            try locked.revalidate(emptyProof)

            let finalProof = try locked.durableCompareAndSwapManaged(
                finalBytes,
                replacing: emptyProof,
                sourceProof: sourceProof,
                role: .snapshotFinalIndex
            )
            XCTAssertEqual(finalProof.bytes, finalBytes)
            try locked.revalidate(finalProof)

            let healthyProof = try locked.durableCompareAndSwapManaged(
                healthyBytes,
                replacing: finalProof,
                sourceProof: sourceProof,
                role: .snapshotHealthIndex
            )
            XCTAssertEqual(healthyProof.bytes, healthyBytes)
            try locked.revalidate(healthyProof)

            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(try locked.durableCompareAndSwapManaged(
                Data("stale-must-not-overwrite".utf8),
                replacing: emptyProof,
                sourceProof: sourceProof,
                role: .snapshotFinalIndex
            ))
            XCTAssertFalse(
                posix.snapshotCalls().dropFirst(before).contains { $0.hasPrefix("renameAt:") }
            )

            let beforeProofless = posix.snapshotCalls().count
            XCTAssertThrowsError(try locked.durableWrite(
                Data("proofless-must-not-overwrite".utf8),
                relativePath: "Recovery/snapshots/index.json",
                disposition: .replace,
                role: .snapshotHealthIndex
            )) { error in
                XCTAssertEqual(error as? NativeDurableFileWriterError, .invalidRoleTarget)
            }
            XCTAssertEqual(posix.snapshotCalls().count, beforeProofless)
        }

        XCTAssertEqual(
            try Data(contentsOf: snapshots.appendingPathComponent("index.json")),
            healthyBytes
        )
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

    func testSnapshotPendingCleanupUsesLatestIndexAuthorizationAndHandlesAbsentOrRescued() throws {
        let (_, root) = try makeScratch("snapshot-authorized-cleanup")
        let snapshots = try makeSnapshots(in: root)
        let sourceBytes = Data("snapshot-cleanup-source".utf8)
        let blobBytes = Data("snapshot-cleanup-blob".utf8)
        let blobHash = hash(blobBytes)
        let blobPath = "Recovery/snapshots/\(blobHash).json"
        let indexBytes = Data("authoritative-snapshot-index".utf8)
        try writePrivate(sourceBytes, to: root.appendingPathComponent("AssetTrackerBook.json"))
        try writePrivate(indexBytes, to: snapshots.appendingPathComponent("index.json"))
        try writePrivate(blobBytes, to: snapshots.appendingPathComponent("\(blobHash).json"))
        let events = FaultEventRecorder()
        let writer = NativeDurableFileWriter(rootURL: root) { events.record($0) }

        try writer.withExclusiveMutationLock { locked in
            let sourceProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            let rescued = try locked.unlinkSnapshotPendingAndSync(
                relativePath: blobPath,
                sourceProof: sourceProof,
                authorizeLatestIndex: { proof in
                    XCTAssertEqual(proof.bytes, indexBytes)
                    return .preserveReferenced
                }
            )
            XCTAssertEqual(rescued.disposition, .preservedReferenced)
            XCTAssertEqual(rescued.latestIndexProof.bytes, indexBytes)
            XCTAssertTrue(fileManager.fileExists(atPath: snapshots.appendingPathComponent("\(blobHash).json").path))

            let removed = try locked.unlinkSnapshotPendingAndSync(
                relativePath: blobPath,
                sourceProof: sourceProof,
                authorizeLatestIndex: { proof in
                    XCTAssertEqual(proof.bytes, indexBytes)
                    return .unlinkPending
                }
            )
            XCTAssertEqual(removed.disposition, .unlinked)
            XCTAssertEqual(removed.latestIndexProof.bytes, indexBytes)

            let absent = try locked.unlinkSnapshotPendingAndSync(
                relativePath: blobPath,
                sourceProof: sourceProof,
                authorizeLatestIndex: { _ in .unlinkPending }
            )
            XCTAssertEqual(absent.disposition, .alreadyAbsent)

            let notPending = try locked.unlinkSnapshotPendingAndSync(
                relativePath: blobPath,
                sourceProof: sourceProof,
                authorizeLatestIndex: { _ in .notPending }
            )
            XCTAssertEqual(notPending.disposition, .notPending)
        }

        XCTAssertFalse(fileManager.fileExists(atPath: snapshots.appendingPathComponent("\(blobHash).json").path))
        XCTAssertEqual(try Data(contentsOf: snapshots.appendingPathComponent("index.json")), indexBytes)
        XCTAssertEqual(events.snapshot().filter {
            $0.point == .beforeRetentionUnlink
                || $0.point == .afterRetentionUnlink
                || $0.point == .afterRetentionDirectoryFSync
        }.map(\.point), [
            .beforeRetentionUnlink,
            .afterRetentionUnlink,
            .afterRetentionDirectoryFSync,
        ])
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
        let sourceBytes = Data("source".utf8)
        let indexBytes = Data("latest slots".utf8)
        let blobBytes = Data("ordinary pending".utf8)
        let fixture = try makeOrdinaryPendingFixture(
            #function,
            sourceBytes: sourceBytes,
            indexBytes: indexBytes,
            blobBytes: blobBytes
        )
        let events = FaultEventRecorder()
        let writer = NativeDurableFileWriter(rootURL: fixture.root) { events.record($0) }

        try writer.withExclusiveMutationLock { locked in
            let sourceProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            let result = try locked.unlinkOrdinaryPendingAndSync(
                relativePath: fixture.relativePath,
                sourceProof: sourceProof,
                authorizeLatestIndex: { proof in
                    XCTAssertEqual(proof.bytes, indexBytes)
                    return .unlinkPending
                }
            )
            XCTAssertEqual(result.disposition, .unlinked)
        }

        XCTAssertFalse(fileManager.fileExists(atPath: fixture.blob.path))
        XCTAssertTrue(events.snapshot().allSatisfy {
            ![
                .beforeRetentionUnlink,
                .afterRetentionUnlink,
                .afterRetentionDirectoryFSync,
                .beforeRecoveryHealthClear,
                .afterRecoveryHealthClear,
            ].contains($0.point)
        })
    }

    func testOrdinaryPendingCleanupUnlinkFailureIsTypedAndSkipsDirectorySync() throws {
        let sourceBytes = Data("typed-unlink-source".utf8)
        let indexBytes = Data("typed-unlink-index".utf8)
        let blobBytes = Data("typed-unlink-pending".utf8)
        let fixture = try makeOrdinaryPendingFixture(
            #function,
            sourceBytes: sourceBytes,
            indexBytes: indexBytes,
            blobBytes: blobBytes
        )
        defer { try? clearWriterTestFileFlags(fixture.blob) }
        let blobIdentityBefore = try writerTestFileIdentity(of: fixture.blob)
        try setWriterTestUserImmutable(fixture.blob)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(
            rootURL: fixture.root,
            posix: posix,
            faultHandler: { _ in }
        )

        try writer.withExclusiveMutationLock { locked in
            let sourceProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(
                try locked.unlinkOrdinaryPendingAndSync(
                    relativePath: fixture.relativePath,
                    sourceProof: sourceProof,
                    authorizeLatestIndex: { _ in .unlinkPending }
                )
            ) { error in
                XCTAssertEqual(
                    error as? NativeOrdinaryPendingCleanupIOError,
                    .unlinkFailed
                )
            }
            let calls = Array(posix.snapshotCalls().dropFirst(before))
            XCTAssertEqual(
                calls.filter { $0 == "unlinkAt:\(fixture.blob.lastPathComponent)" }.count,
                1
            )
            XCTAssertFalse(
                calls.contains { $0.hasPrefix("syncDirectory:") },
                "an unlink failure must not claim or attempt blobs-directory synchronization"
            )
        }

        XCTAssertEqual(try Data(contentsOf: fixture.blob), blobBytes)
        XCTAssertEqual(try writerTestFileIdentity(of: fixture.blob), blobIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: fixture.slots), indexBytes)
    }

    func testOrdinaryPendingCleanupDirectorySyncFailureIsTypedAfterUnlink() throws {
        let sourceBytes = Data("typed-directory-sync-source".utf8)
        let indexBytes = Data("typed-directory-sync-index".utf8)
        let blobBytes = Data("typed-directory-sync-pending".utf8)
        let fixture = try makeOrdinaryPendingFixture(
            #function,
            sourceBytes: sourceBytes,
            indexBytes: indexBytes,
            blobBytes: blobBytes
        )
        let posix = RecordingNativePOSIX(syncDirectoryFailurePath: "blobs")
        let writer = NativeDurableFileWriter(
            rootURL: fixture.root,
            posix: posix,
            faultHandler: { _ in }
        )

        try writer.withExclusiveMutationLock { locked in
            let sourceProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(
                try locked.unlinkOrdinaryPendingAndSync(
                    relativePath: fixture.relativePath,
                    sourceProof: sourceProof,
                    authorizeLatestIndex: { _ in .unlinkPending }
                )
            ) { error in
                XCTAssertEqual(
                    error as? NativeOrdinaryPendingCleanupIOError,
                    .directorySyncFailed
                )
            }
            let calls = Array(posix.snapshotCalls().dropFirst(before))
            XCTAssertEqual(
                calls.filter { $0 == "unlinkAt:\(fixture.blob.lastPathComponent)" }.count,
                1
            )
            XCTAssertEqual(calls.filter { $0.hasPrefix("syncDirectory:") }.count, 1)
        }

        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blob.path))
        XCTAssertEqual(try Data(contentsOf: fixture.slots), indexBytes)
        XCTAssertEqual(try Data(contentsOf: fixture.primary), sourceBytes)
    }

    func testOrdinaryPendingCleanupProofIndexSourceMetadataAndCallbackErrorsAreNotTypedIO() throws {
        enum Failure: CaseIterable {
            case proof, index, source, metadata, callback
        }

        for failure in Failure.allCases {
            let sourceBytes = Data("non-io-\(failure)-source".utf8)
            let indexBytes = Data("non-io-\(failure)-index".utf8)
            let blobBytes = Data("non-io-\(failure)-pending".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-\(failure)",
                sourceBytes: sourceBytes,
                indexBytes: indexBytes,
                blobBytes: blobBytes
            )
            let detached = fixture.base.appendingPathComponent("detached-\(failure)")
            let replacement = Data("non-io-\(failure)-replacement".utf8)
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(
                rootURL: fixture.root,
                posix: posix,
                faultHandler: { _ in }
            )
            var staleProof: NativeSourceProof?
            if case .proof = failure {
                try writer.withExclusiveMutationLock { locked in
                    staleProof = try locked.verifyPrimarySource(
                        expectedSource: .sha256(hash(sourceBytes))
                    )
                }
            }
            if case .metadata = failure {
                XCTAssertEqual(Darwin.chmod(fixture.blob.path, 0o644), 0)
            }

            try writer.withExclusiveMutationLock { locked in
                let sourceProof: NativeSourceProof
                if case .proof = failure {
                    sourceProof = try XCTUnwrap(staleProof)
                } else {
                    sourceProof = try locked.verifyPrimarySource(
                        expectedSource: .sha256(hash(sourceBytes))
                    )
                }
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.unlinkOrdinaryPendingAndSync(
                        relativePath: fixture.relativePath,
                        sourceProof: sourceProof,
                        authorizeLatestIndex: { _ in
                            switch failure {
                            case .index:
                                try FileManager.default.moveItem(
                                    at: fixture.slots,
                                    to: detached
                                )
                                try writePrivateForFault(replacement, to: fixture.slots)
                            case .source:
                                try FileManager.default.moveItem(
                                    at: fixture.primary,
                                    to: detached
                                )
                                try writePrivateForFault(replacement, to: fixture.primary)
                            case .callback:
                                throw InjectedWriterFault.stop
                            case .proof, .metadata:
                                break
                            }
                            return .unlinkPending
                        }
                    ),
                    "failure=\(failure)"
                ) { error in
                    XCTAssertNil(
                        error as? NativeOrdinaryPendingCleanupIOError,
                        "proof/authority/metadata/callback failures must remain unknown, failure=\(failure)"
                    )
                }
                let calls = Array(posix.snapshotCalls().dropFirst(before))
                XCTAssertFalse(
                    calls.contains { $0.hasPrefix("unlinkAt:") },
                    "failure=\(failure)"
                )
                XCTAssertFalse(
                    calls.contains { $0.hasPrefix("syncDirectory:") },
                    "failure=\(failure)"
                )
            }

            XCTAssertEqual(try Data(contentsOf: fixture.blob), blobBytes)
        }
    }

    func testOrdinaryPendingCleanupCallbackThrowPreservesBlobWithoutUnlinkOrSync() throws {
        let sourceBytes = Data("source-before-callback-throw".utf8)
        let indexBytes = Data("slots-before-callback-throw".utf8)
        let blobBytes = Data("pending-before-callback-throw".utf8)
        let fixture = try makeOrdinaryPendingFixture(
            #function,
            sourceBytes: sourceBytes,
            indexBytes: indexBytes,
            blobBytes: blobBytes
        )
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(
            rootURL: fixture.root,
            posix: posix,
            faultHandler: { _ in }
        )

        try writer.withExclusiveMutationLock { locked in
            let sourceProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            let before = posix.snapshotCalls().count
            var callbackCount = 0
            XCTAssertThrowsError(
                try locked.unlinkOrdinaryPendingAndSync(
                    relativePath: fixture.relativePath,
                    sourceProof: sourceProof,
                    authorizeLatestIndex: { proof in
                        callbackCount += 1
                        XCTAssertEqual(proof.bytes, indexBytes)
                        XCTAssertEqual(proof.sha256, hash(indexBytes))
                        XCTAssertEqual(proof.byteCount, indexBytes.count)
                        throw InjectedWriterFault.stop
                    }
                )
            )
            XCTAssertEqual(callbackCount, 1)
            let calls = Array(posix.snapshotCalls().dropFirst(before))
            XCTAssertFalse(calls.contains { $0.hasPrefix("unlinkAt:") })
            XCTAssertFalse(calls.contains { $0.hasPrefix("syncDirectory:") })
        }

        XCTAssertEqual(try Data(contentsOf: fixture.blob), blobBytes)
        XCTAssertEqual(try Data(contentsOf: fixture.slots), indexBytes)
    }

    func testOrdinaryPendingCleanupPreserveDecisionsAreDistinctAndNeverDelete() throws {
        for preserveReferenced in [true, false] {
            let sourceBytes = Data("source-preserve-\(preserveReferenced)".utf8)
            let indexBytes = Data("slots-preserve-\(preserveReferenced)".utf8)
            let blobBytes = Data("pending-preserve-\(preserveReferenced)".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-\(preserveReferenced)",
                sourceBytes: sourceBytes,
                indexBytes: indexBytes,
                blobBytes: blobBytes
            )
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(
                rootURL: fixture.root,
                posix: posix,
                faultHandler: { _ in }
            )

            try writer.withExclusiveMutationLock { locked in
                let sourceProof = try locked.verifyPrimarySource(
                    expectedSource: .sha256(hash(sourceBytes))
                )
                let before = posix.snapshotCalls().count
                let result = try locked.unlinkOrdinaryPendingAndSync(
                    relativePath: fixture.relativePath,
                    sourceProof: sourceProof,
                    authorizeLatestIndex: { proof in
                        XCTAssertEqual(proof.bytes, indexBytes)
                        return preserveReferenced ? .preserveReferenced : .notPending
                    }
                )
                XCTAssertEqual(
                    result.disposition,
                    preserveReferenced ? .preservedReferenced : .notPending
                )
                XCTAssertEqual(result.latestIndexProof.bytes, indexBytes)
                try locked.revalidate(result.latestIndexProof)
                let calls = Array(posix.snapshotCalls().dropFirst(before))
                XCTAssertFalse(calls.contains { $0.hasPrefix("unlinkAt:") })
                XCTAssertFalse(calls.contains { $0.hasPrefix("syncDirectory:") })
            }

            XCTAssertEqual(try Data(contentsOf: fixture.blob), blobBytes)
            XCTAssertEqual(try Data(contentsOf: fixture.slots), indexBytes)
        }
    }

    func testOrdinaryPendingCleanupAlreadyAbsentStillAuthorizesLatestIndexAndRejectsLateAppearance() throws {
        for preserveReferenced in [true, false] {
            let sourceBytes = Data("source-absent-preserve-\(preserveReferenced)".utf8)
            let indexBytes = Data("slots-absent-preserve-\(preserveReferenced)".utf8)
            let blobBytes = Data("pending-absent-preserve-\(preserveReferenced)".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-preserve-\(preserveReferenced)",
                sourceBytes: sourceBytes,
                indexBytes: indexBytes,
                blobBytes: blobBytes,
                blobPresent: false
            )
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(
                rootURL: fixture.root,
                posix: posix,
                faultHandler: { _ in }
            )

            try writer.withExclusiveMutationLock { locked in
                let sourceProof = try locked.verifyPrimarySource(
                    expectedSource: .sha256(hash(sourceBytes))
                )
                let before = posix.snapshotCalls().count
                var callbackProof: NativeManagedFileProof?
                let result = try locked.unlinkOrdinaryPendingAndSync(
                    relativePath: fixture.relativePath,
                    sourceProof: sourceProof,
                    authorizeLatestIndex: { proof in
                        callbackProof = proof
                        XCTAssertEqual(proof.bytes, indexBytes)
                        return preserveReferenced ? .preserveReferenced : .notPending
                    }
                )
                XCTAssertEqual(
                    result.disposition,
                    preserveReferenced ? .preservedReferenced : .notPending
                )
                XCTAssertEqual(result.latestIndexProof, try XCTUnwrap(callbackProof))
                try locked.revalidate(result.latestIndexProof)
                let calls = Array(posix.snapshotCalls().dropFirst(before))
                XCTAssertFalse(calls.contains { $0.hasPrefix("unlinkAt:") })
                XCTAssertFalse(calls.contains { $0.hasPrefix("syncDirectory:") })
            }
            XCTAssertFalse(fileManager.fileExists(atPath: fixture.blob.path))
            XCTAssertEqual(try Data(contentsOf: fixture.slots), indexBytes)
        }

        do {
            let sourceBytes = Data("source-already-absent".utf8)
            let indexBytes = Data("slots-already-absent".utf8)
            let blobBytes = Data("pending-already-absent".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-stable",
                sourceBytes: sourceBytes,
                indexBytes: indexBytes,
                blobBytes: blobBytes,
                blobPresent: false
            )
            let writer = NativeDurableFileWriter(rootURL: fixture.root)

            try writer.withExclusiveMutationLock { locked in
                let sourceProof = try locked.verifyPrimarySource(
                    expectedSource: .sha256(hash(sourceBytes))
                )
                var callbackProof: NativeManagedFileProof?
                let result = try locked.unlinkOrdinaryPendingAndSync(
                    relativePath: fixture.relativePath,
                    sourceProof: sourceProof,
                    authorizeLatestIndex: { proof in
                        callbackProof = proof
                        XCTAssertEqual(proof.bytes, indexBytes)
                        return .unlinkPending
                    }
                )
                XCTAssertEqual(result.disposition, .alreadyAbsent)
                XCTAssertEqual(result.latestIndexProof, try XCTUnwrap(callbackProof))
                try locked.revalidate(result.latestIndexProof)
            }
            XCTAssertFalse(fileManager.fileExists(atPath: fixture.blob.path))
        }

        do {
            let sourceBytes = Data("source-late-appearance".utf8)
            let indexBytes = Data("slots-late-appearance".utf8)
            let blobBytes = Data("pending-late-appearance".utf8)
            let replacement = Data("late replacement must survive".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-late",
                sourceBytes: sourceBytes,
                indexBytes: indexBytes,
                blobBytes: blobBytes,
                blobPresent: false
            )
            let writer = NativeDurableFileWriter(rootURL: fixture.root)

            try writer.withExclusiveMutationLock { locked in
                let sourceProof = try locked.verifyPrimarySource(
                    expectedSource: .sha256(hash(sourceBytes))
                )
                var callbackCount = 0
                XCTAssertThrowsError(
                    try locked.unlinkOrdinaryPendingAndSync(
                        relativePath: fixture.relativePath,
                        sourceProof: sourceProof,
                        authorizeLatestIndex: { _ in
                            callbackCount += 1
                            try writePrivateForFault(replacement, to: fixture.blob)
                            return .unlinkPending
                        }
                    )
                )
                XCTAssertEqual(callbackCount, 1)
            }
            XCTAssertEqual(try Data(contentsOf: fixture.blob), replacement)
            XCTAssertEqual(try Data(contentsOf: fixture.slots), indexBytes)
        }
    }

    func testOrdinaryPendingCleanupAlreadyAbsentSyncsBoundBlobsDirectoryBeforeFinalReproof() throws {
        let sourceBytes = Data("source-already-absent-sync-order".utf8)
        let indexBytes = Data("slots-already-absent-sync-order".utf8)
        let blobBytes = Data("pending-already-absent-sync-order".utf8)
        let fixture = try makeOrdinaryPendingFixture(
            #function,
            sourceBytes: sourceBytes,
            indexBytes: indexBytes,
            blobBytes: blobBytes,
            blobPresent: false
        )
        let events = FaultEventRecorder()
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(
            rootURL: fixture.root,
            posix: posix,
            faultHandler: { events.record($0) }
        )

        try writer.withExclusiveMutationLock { locked in
            let sourceProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            let before = posix.snapshotCalls().count
            var callbackCount = 0
            var callbackOffset: Int?
            let result = try locked.unlinkOrdinaryPendingAndSync(
                relativePath: fixture.relativePath,
                sourceProof: sourceProof,
                authorizeLatestIndex: { proof in
                    callbackCount += 1
                    callbackOffset = posix.snapshotCalls().count - before
                    XCTAssertEqual(proof.bytes, indexBytes)
                    return .unlinkPending
                }
            )

            XCTAssertEqual(callbackCount, 1)
            XCTAssertEqual(result.disposition, .alreadyAbsent)
            let calls = Array(posix.snapshotCalls().dropFirst(before))
            XCTAssertFalse(calls.contains { $0.hasPrefix("unlinkAt:") })
            XCTAssertEqual(calls.filter { $0.hasPrefix("syncDirectory:") }.count, 1)
            guard let syncIndex = calls.firstIndex(where: { $0.hasPrefix("syncDirectory:") }) else {
                XCTFail("the bound blobs directory must be synchronized before alreadyAbsent returns")
                return
            }
            XCTAssertLessThan(try XCTUnwrap(callbackOffset), syncIndex)
            let afterSync = calls.dropFirst(syncIndex + 1)
            XCTAssertTrue(afterSync.contains {
                $0 == "fstatAt:\(fixture.blob.lastPathComponent):true"
            }, "final absence proof must follow the blobs-directory sync")
            XCTAssertTrue(afterSync.contains { $0.hasPrefix("openAt:slots.json:") })
            XCTAssertTrue(afterSync.contains { $0.hasPrefix("openAt:AssetTrackerBook.json:") })
            XCTAssertTrue(afterSync.contains { $0.hasPrefix("fstat:") })
        }

        XCTAssertFalse(fileManager.fileExists(atPath: fixture.blob.path))
        XCTAssertEqual(try Data(contentsOf: fixture.slots), indexBytes)
        XCTAssertFalse(events.snapshot().contains {
            $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
        })
    }

    func testOrdinaryPendingCleanupAlreadyAbsentDirectorySyncFailureIsTypedWithoutUnlinkOrHealthEvents() throws {
        let sourceBytes = Data("source-already-absent-sync-failure".utf8)
        let indexBytes = Data("slots-already-absent-sync-failure".utf8)
        let blobBytes = Data("pending-already-absent-sync-failure".utf8)
        let fixture = try makeOrdinaryPendingFixture(
            #function,
            sourceBytes: sourceBytes,
            indexBytes: indexBytes,
            blobBytes: blobBytes,
            blobPresent: false
        )
        let events = FaultEventRecorder()
        let posix = RecordingNativePOSIX(syncDirectoryFailurePath: "blobs")
        let writer = NativeDurableFileWriter(
            rootURL: fixture.root,
            posix: posix,
            faultHandler: { events.record($0) }
        )

        try writer.withExclusiveMutationLock { locked in
            let sourceProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            let before = posix.snapshotCalls().count
            var callbackCount = 0
            XCTAssertThrowsError(
                try locked.unlinkOrdinaryPendingAndSync(
                    relativePath: fixture.relativePath,
                    sourceProof: sourceProof,
                    authorizeLatestIndex: { proof in
                        callbackCount += 1
                        XCTAssertEqual(proof.bytes, indexBytes)
                        return .unlinkPending
                    }
                )
            ) { error in
                XCTAssertEqual(
                    error as? NativeOrdinaryPendingCleanupIOError,
                    .directorySyncFailed
                )
            }
            XCTAssertEqual(callbackCount, 1)
            let calls = Array(posix.snapshotCalls().dropFirst(before))
            XCTAssertFalse(calls.contains { $0.hasPrefix("unlinkAt:") })
            XCTAssertEqual(calls.filter { $0.hasPrefix("syncDirectory:") }.count, 1)
        }

        XCTAssertFalse(fileManager.fileExists(atPath: fixture.blob.path))
        XCTAssertEqual(try Data(contentsOf: fixture.slots), indexBytes)
        XCTAssertEqual(try Data(contentsOf: fixture.primary), sourceBytes)
        XCTAssertFalse(events.snapshot().contains {
            $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
        })
    }

    func testOrdinaryPendingCleanupAlreadyAbsentPostSyncProofFailuresRemainUntyped() throws {
        enum Failure: CaseIterable { case sourceProof, indexMetadata }

        for failure in Failure.allCases {
            let sourceBytes = Data("source-already-absent-post-sync-\(failure)".utf8)
            let indexBytes = Data("slots-already-absent-post-sync-\(failure)".utf8)
            let blobBytes = Data("pending-already-absent-post-sync-\(failure)".utf8)
            let replacement = Data("replacement-already-absent-post-sync-\(failure)".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-\(failure)",
                sourceBytes: sourceBytes,
                indexBytes: indexBytes,
                blobBytes: blobBytes,
                blobPresent: false
            )
            let action: @Sendable () throws -> Void = {
                switch failure {
                case .sourceProof:
                    try overwriteInPlaceForFault(replacement, at: fixture.primary)
                case .indexMetadata:
                    guard Darwin.chmod(fixture.slots.path, 0o644) == 0 else {
                        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
                    }
                }
            }
            let posix = RecordingNativePOSIX(
                afterSyncDirectoryPath: "blobs",
                afterSyncDirectoryAction: action
            )
            let writer = NativeDurableFileWriter(
                rootURL: fixture.root,
                posix: posix,
                faultHandler: { _ in }
            )

            try writer.withExclusiveMutationLock { locked in
                let sourceProof = try locked.verifyPrimarySource(
                    expectedSource: .sha256(hash(sourceBytes))
                )
                let before = posix.snapshotCalls().count
                var callbackCount = 0
                XCTAssertThrowsError(
                    try locked.unlinkOrdinaryPendingAndSync(
                        relativePath: fixture.relativePath,
                        sourceProof: sourceProof,
                        authorizeLatestIndex: { _ in
                            callbackCount += 1
                            return .unlinkPending
                        }
                    ),
                    "failure=\(failure)"
                ) { error in
                    XCTAssertNil(
                        error as? NativeOrdinaryPendingCleanupIOError,
                        "post-sync proof/metadata failures are not cleanup I/O, failure=\(failure)"
                    )
                }
                XCTAssertEqual(callbackCount, 1, "failure=\(failure)")
                let calls = Array(posix.snapshotCalls().dropFirst(before))
                XCTAssertFalse(calls.contains { $0.hasPrefix("unlinkAt:") }, "failure=\(failure)")
                XCTAssertEqual(
                    calls.filter { $0.hasPrefix("syncDirectory:") }.count,
                    1,
                    "failure=\(failure)"
                )
            }

            XCTAssertFalse(fileManager.fileExists(atPath: fixture.blob.path))
        }
    }

    func testOrdinaryPendingCleanupSuccessUsesFreshIndexProofAndFinalProofOrder() throws {
        let sourceBytes = Data("source-cleanup-success".utf8)
        let indexBytes = Data("slots-cleanup-success".utf8)
        let blobBytes = Data("pending-cleanup-success".utf8)
        let fixture = try makeOrdinaryPendingFixture(
            #function,
            sourceBytes: sourceBytes,
            indexBytes: indexBytes,
            blobBytes: blobBytes
        )
        let events = FaultEventRecorder()
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(
            rootURL: fixture.root,
            posix: posix,
            faultHandler: { events.record($0) }
        )

        try writer.withExclusiveMutationLock { locked in
            let sourceProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            let before = posix.snapshotCalls().count
            var callbackOffset: Int?
            var callbackProof: NativeManagedFileProof?
            let result = try locked.unlinkOrdinaryPendingAndSync(
                relativePath: fixture.relativePath,
                sourceProof: sourceProof,
                authorizeLatestIndex: { proof in
                    callbackOffset = posix.snapshotCalls().count - before
                    callbackProof = proof
                    XCTAssertEqual(proof.bytes, indexBytes)
                    XCTAssertEqual(proof.sha256, hash(indexBytes))
                    XCTAssertEqual(proof.byteCount, indexBytes.count)
                    return .unlinkPending
                }
            )
            XCTAssertEqual(result.disposition, .unlinked)
            XCTAssertEqual(result.latestIndexProof, try XCTUnwrap(callbackProof))
            try locked.revalidate(result.latestIndexProof)
            try locked.revalidatePrimarySource(sourceProof)

            let calls = Array(posix.snapshotCalls().dropFirst(before))
            let callbackIndex = try XCTUnwrap(callbackOffset)
            let unlinkIndex = try XCTUnwrap(calls.firstIndex { $0 == "unlinkAt:\(fixture.blob.lastPathComponent)" })
            let syncIndex = try XCTUnwrap(
                calls[unlinkIndex...].firstIndex { $0.hasPrefix("syncDirectory:") }
            )
            let finalSlotsProofIndex = try XCTUnwrap(
                calls[..<unlinkIndex].lastIndex { $0 == "fstatAt:slots.json:true" }
            )
            let finalSourceReadIndex = try XCTUnwrap(
                calls[callbackIndex..<finalSlotsProofIndex].lastIndex {
                    $0.hasPrefix("openAt:AssetTrackerBook.json:")
                }
            )
            let finalBlobProofIndex = try XCTUnwrap(
                calls[callbackIndex..<finalSlotsProofIndex].lastIndex {
                    $0 == "fstatAt:\(fixture.blob.lastPathComponent):true"
                }
            )
            XCTAssertLessThan(callbackIndex, unlinkIndex)
            XCTAssertTrue(calls[..<callbackIndex].contains { $0.hasPrefix("openAt:\(fixture.blob.lastPathComponent):") })
            XCTAssertTrue(calls[..<callbackIndex].contains { $0.hasPrefix("openAt:slots.json:") })
            XCTAssertLessThan(callbackIndex, finalSourceReadIndex)
            XCTAssertLessThan(callbackIndex, finalBlobProofIndex)
            XCTAssertLessThan(finalSourceReadIndex, finalSlotsProofIndex)
            XCTAssertLessThan(finalBlobProofIndex, finalSlotsProofIndex)
            XCTAssertEqual(
                finalSlotsProofIndex + 1,
                unlinkIndex,
                "the final exact slots bytes/inode leaf proof must be the syscall immediately before unlink"
            )
            XCTAssertGreaterThanOrEqual(
                calls[(unlinkIndex + 1)...].filter { $0 == "fstatAt:\(fixture.blob.lastPathComponent):true" }.count,
                2
            )
            XCTAssertTrue(calls[(syncIndex + 1)...].contains { $0.hasPrefix("openAt:slots.json:") })
            XCTAssertTrue(calls[(syncIndex + 1)...].contains { $0.hasPrefix("openAt:AssetTrackerBook.json:") })
        }

        XCTAssertFalse(fileManager.fileExists(atPath: fixture.blob.path))
        XCTAssertEqual(try Data(contentsOf: fixture.slots), indexBytes)
        XCTAssertTrue(events.snapshot().allSatisfy {
            ![
                .beforeRetentionUnlink,
                .afterRetentionUnlink,
                .afterRetentionDirectoryFSync,
                .beforeRecoveryHealthClear,
                .afterRecoveryHealthClear,
            ].contains($0.point)
        })
    }

    func testOrdinaryPendingCleanupRejectsPreUnlinkIndexSourceAndBlobReplacement() throws {
        enum Fixture: CaseIterable { case index, indexSameInode, source, blob }

        for race in Fixture.allCases {
            let sourceBytes = Data("source-pre-unlink-\(race)".utf8)
            let indexBytes = Data("slots-pre-unlink-\(race)".utf8)
            let blobBytes = Data("pending-pre-unlink-\(race)".utf8)
            let replacement = Data("replacement-pre-unlink-\(race)".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-\(race)",
                sourceBytes: sourceBytes,
                indexBytes: indexBytes,
                blobBytes: blobBytes
            )
            let detached = fixture.base.appendingPathComponent("detached-\(race)")
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(
                rootURL: fixture.root,
                posix: posix,
                faultHandler: { _ in }
            )

            try writer.withExclusiveMutationLock { locked in
                let sourceProof = try locked.verifyPrimarySource(
                    expectedSource: .sha256(hash(sourceBytes))
                )
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.unlinkOrdinaryPendingAndSync(
                        relativePath: fixture.relativePath,
                        sourceProof: sourceProof,
                        authorizeLatestIndex: { _ in
                            let target: URL
                            switch race {
                            case .index: target = fixture.slots
                            case .indexSameInode:
                                try overwriteInPlaceForFault(replacement, at: fixture.slots)
                                return .unlinkPending
                            case .source: target = fixture.primary
                            case .blob: target = fixture.blob
                            }
                            try FileManager.default.moveItem(at: target, to: detached)
                            try writePrivateForFault(replacement, to: target)
                            return .unlinkPending
                        }
                    ),
                    "race=\(race)"
                )
                XCTAssertFalse(
                    posix.snapshotCalls().dropFirst(before).contains {
                        $0 == "unlinkAt:\(fixture.blob.lastPathComponent)"
                    },
                    "race=\(race)"
                )
            }

            switch race {
            case .index, .indexSameInode:
                XCTAssertEqual(try Data(contentsOf: fixture.slots), replacement)
                XCTAssertEqual(try Data(contentsOf: fixture.blob), blobBytes)
            case .source:
                XCTAssertEqual(try Data(contentsOf: fixture.primary), replacement)
                XCTAssertEqual(try Data(contentsOf: fixture.blob), blobBytes)
            case .blob:
                XCTAssertEqual(try Data(contentsOf: fixture.blob), replacement)
            }
        }
    }

    func testOrdinaryPendingCleanupRejectsPostUnlinkBlobIndexAndSourceRaces() throws {
        enum Fixture: CaseIterable { case blobRecreated, indexReplaced, sourceReplaced }

        for race in Fixture.allCases {
            let sourceBytes = Data("source-post-unlink-\(race)".utf8)
            let indexBytes = Data("slots-post-unlink-\(race)".utf8)
            let blobBytes = Data("pending-post-unlink-\(race)".utf8)
            let replacement = Data("replacement-post-unlink-\(race)".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-\(race)",
                sourceBytes: sourceBytes,
                indexBytes: indexBytes,
                blobBytes: blobBytes
            )
            let detached = fixture.base.appendingPathComponent("detached-\(race)")
            let action: @Sendable () throws -> Void
            switch race {
            case .blobRecreated:
                action = { try writePrivateForFault(replacement, to: fixture.blob) }
            case .indexReplaced:
                action = {
                    try FileManager.default.moveItem(at: fixture.slots, to: detached)
                    try writePrivateForFault(replacement, to: fixture.slots)
                }
            case .sourceReplaced:
                action = {
                    try FileManager.default.moveItem(at: fixture.primary, to: detached)
                    try writePrivateForFault(replacement, to: fixture.primary)
                }
            }
            let posix = RecordingNativePOSIX(
                afterSyncDirectoryPath: "blobs",
                afterSyncDirectoryAction: action
            )
            let writer = NativeDurableFileWriter(
                rootURL: fixture.root,
                posix: posix,
                faultHandler: { _ in }
            )
            var returnedSuccess = false

            XCTAssertThrowsError(
                try writer.withExclusiveMutationLock { locked in
                    let sourceProof = try locked.verifyPrimarySource(
                        expectedSource: .sha256(hash(sourceBytes))
                    )
                    _ = try locked.unlinkOrdinaryPendingAndSync(
                        relativePath: fixture.relativePath,
                        sourceProof: sourceProof,
                        authorizeLatestIndex: { _ in .unlinkPending }
                    )
                    returnedSuccess = true
                },
                "race=\(race)"
            )
            XCTAssertFalse(returnedSuccess, "race=\(race)")
            switch race {
            case .blobRecreated:
                XCTAssertEqual(try Data(contentsOf: fixture.blob), replacement)
            case .indexReplaced:
                XCTAssertEqual(try Data(contentsOf: fixture.slots), replacement)
            case .sourceReplaced:
                XCTAssertEqual(try Data(contentsOf: fixture.primary), replacement)
            }
        }
    }

    func testOrdinaryPendingCleanupRejectsOldSourceProofAfterPrimaryRenameAndAcceptsFreshProof() throws {
        let sourceBytes = Data("source-before-primary-rename".utf8)
        let candidateBytes = Data("candidate-after-primary-rename".utf8)
        let indexBytes = Data("slots-across-primary-rename".utf8)
        let blobBytes = Data("pending-across-primary-rename".utf8)
        let fixture = try makeOrdinaryPendingFixture(
            #function,
            sourceBytes: sourceBytes,
            indexBytes: indexBytes,
            blobBytes: blobBytes
        )
        let writer = NativeDurableFileWriter(rootURL: fixture.root)

        try writer.withExclusiveMutationLock { locked in
            let oldProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            _ = try locked.durableReplacePrimary(candidateBytes, sourceProof: oldProof)
            XCTAssertThrowsError(
                try locked.unlinkOrdinaryPendingAndSync(
                    relativePath: fixture.relativePath,
                    sourceProof: oldProof,
                    authorizeLatestIndex: { _ in .unlinkPending }
                )
            )
            XCTAssertEqual(try Data(contentsOf: fixture.blob), blobBytes)

            let freshProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(candidateBytes))
            )
            let result = try locked.unlinkOrdinaryPendingAndSync(
                relativePath: fixture.relativePath,
                sourceProof: freshProof,
                authorizeLatestIndex: { proof in
                    XCTAssertEqual(proof.bytes, indexBytes)
                    return .unlinkPending
                }
            )
            XCTAssertEqual(result.disposition, .unlinked)
        }
        XCTAssertFalse(fileManager.fileExists(atPath: fixture.blob.path))
    }

    func testManagedIndexCASRejectsStaleReplacementAndLastPreRenameRaceWithoutOverwrite() throws {
        do {
            let sourceBytes = Data("source-pre-cas".utf8)
            let oldIndex = Data("old-index-pre-cas".utf8)
            let newerIndex = Data("newer-index-pre-cas".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-before-call",
                sourceBytes: sourceBytes,
                indexBytes: oldIndex,
                blobBytes: Data("unused-pending".utf8),
                blobPresent: false
            )
            let detached = fixture.base.appendingPathComponent("detached-old-index")
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(
                rootURL: fixture.root,
                posix: posix,
                faultHandler: { _ in }
            )

            try writer.withExclusiveMutationLock { locked in
                let sourceProof = try locked.verifyPrimarySource(
                    expectedSource: .sha256(hash(sourceBytes))
                )
                let expectedProof = try XCTUnwrap(
                    locked.readManagedFileProof(
                        relativePath: "Recovery/ordinary/slots.json",
                        role: .ordinaryHealthIndex
                    )
                )
                try FileManager.default.moveItem(at: fixture.slots, to: detached)
                try writePrivate(newerIndex, to: fixture.slots)
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.durableCompareAndSwapManaged(
                        Data("health-cleared".utf8),
                        replacing: expectedProof,
                        sourceProof: sourceProof,
                        role: .ordinaryHealthIndex
                    )
                )
                XCTAssertFalse(
                    posix.snapshotCalls().dropFirst(before).contains { $0.hasPrefix("renameAt:") }
                )
            }
            XCTAssertEqual(try Data(contentsOf: fixture.slots), newerIndex)
        }

        do {
            let sourceBytes = Data("source-same-inode-pre-cas".utf8)
            let oldIndex = Data("old-index-same-inode-pre-cas".utf8)
            let newerIndex = Data("newer-index-same-inode-pre-cas".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-same-inode",
                sourceBytes: sourceBytes,
                indexBytes: oldIndex,
                blobBytes: Data("unused-pending".utf8),
                blobPresent: false
            )
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(
                rootURL: fixture.root,
                posix: posix,
                faultHandler: { _ in }
            )

            try writer.withExclusiveMutationLock { locked in
                let sourceProof = try locked.verifyPrimarySource(
                    expectedSource: .sha256(hash(sourceBytes))
                )
                let expectedProof = try XCTUnwrap(
                    locked.readManagedFileProof(
                        relativePath: "Recovery/ordinary/slots.json",
                        role: .ordinaryHealthIndex
                    )
                )
                var beforeStat = stat()
                XCTAssertEqual(Darwin.lstat(fixture.slots.path, &beforeStat), 0)
                try overwriteInPlace(newerIndex, at: fixture.slots)
                var afterStat = stat()
                XCTAssertEqual(Darwin.lstat(fixture.slots.path, &afterStat), 0)
                XCTAssertEqual(UInt64(beforeStat.st_dev), UInt64(afterStat.st_dev))
                XCTAssertEqual(UInt64(beforeStat.st_ino), UInt64(afterStat.st_ino))

                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(try locked.revalidate(expectedProof))
                XCTAssertThrowsError(
                    try locked.durableCompareAndSwapManaged(
                        Data("must-not-overwrite-same-inode".utf8),
                        replacing: expectedProof,
                        sourceProof: sourceProof,
                        role: .ordinaryHealthIndex
                    )
                )
                XCTAssertFalse(
                    posix.snapshotCalls().dropFirst(before).contains { $0.hasPrefix("renameAt:") }
                )
            }
            XCTAssertEqual(try Data(contentsOf: fixture.slots), newerIndex)
        }

        do {
            let sourceBytes = Data("source-last-pre-rename".utf8)
            let oldIndex = Data("old-index-last-pre-rename".utf8)
            let newerIndex = Data("newer-index-last-pre-rename".utf8)
            let newBytes = Data("health-clear-last-pre-rename".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-before-rename",
                sourceBytes: sourceBytes,
                indexBytes: oldIndex,
                blobBytes: Data("unused-pending".utf8),
                blobPresent: false
            )
            let detached = fixture.base.appendingPathComponent("detached-old-index")
            let writer = NativeDurableFileWriter(rootURL: fixture.root) { event in
                guard event.point == .beforeRename, event.role == .ordinaryHealthIndex else { return }
                try FileManager.default.moveItem(at: fixture.slots, to: detached)
                try writePrivateForFault(newerIndex, to: fixture.slots)
            }

            try writer.withExclusiveMutationLock { locked in
                let sourceProof = try locked.verifyPrimarySource(
                    expectedSource: .sha256(hash(sourceBytes))
                )
                let expectedProof = try XCTUnwrap(
                    locked.readManagedFileProof(
                        relativePath: "Recovery/ordinary/slots.json",
                        role: .ordinaryHealthIndex
                    )
                )
                XCTAssertThrowsError(
                    try locked.durableCompareAndSwapManaged(
                        newBytes,
                        replacing: expectedProof,
                        sourceProof: sourceProof,
                        role: .ordinaryHealthIndex
                    )
                )
            }
            XCTAssertEqual(try Data(contentsOf: fixture.slots), newerIndex)
        }
    }

    func testManagedIndexCASProofIsLeasePathRoleBoundAndExpires() throws {
        let sourceBytes = Data("source-proof-binding".utf8)
        let oldIndex = Data("old-index-proof-binding".utf8)
        let newIndex = Data("new-index-proof-binding".utf8)
        let fixture = try makeOrdinaryPendingFixture(
            #function,
            sourceBytes: sourceBytes,
            indexBytes: oldIndex,
            blobBytes: Data("unused-pending".utf8),
            blobPresent: false
        )
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(
            rootURL: fixture.root,
            posix: posix,
            faultHandler: { _ in }
        )
        var escapedLocked: NativeLockedBookDirectory?
        var escapedProof: NativeManagedFileProof?

        try writer.withExclusiveMutationLock { locked in
            let sourceProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            let expectedProof = try XCTUnwrap(
                locked.readManagedFileProof(
                    relativePath: "Recovery/ordinary/slots.json",
                    role: .ordinaryHealthIndex
                )
            )
            let beforeWrongRole = posix.snapshotCalls().count
            XCTAssertThrowsError(
                try locked.durableCompareAndSwapManaged(
                    newIndex,
                    replacing: expectedProof,
                    sourceProof: sourceProof,
                    role: .ordinaryCommittedIndex
                )
            )
            XCTAssertFalse(
                posix.snapshotCalls().dropFirst(beforeWrongRole).contains { $0.hasPrefix("renameAt:") }
            )

            let proof = try locked.durableCompareAndSwapManaged(
                newIndex,
                replacing: expectedProof,
                sourceProof: sourceProof,
                role: .ordinaryHealthIndex
            )
            XCTAssertEqual(proof.bytes, newIndex)
            XCTAssertEqual(proof.sha256, hash(newIndex))
            XCTAssertEqual(proof.byteCount, newIndex.count)
            try locked.revalidate(proof)
            try locked.revalidatePrimarySource(sourceProof)
            escapedLocked = locked
            escapedProof = proof
        }

        XCTAssertEqual(try Data(contentsOf: fixture.slots), newIndex)
        XCTAssertThrowsError(
            try XCTUnwrap(escapedLocked).revalidate(try XCTUnwrap(escapedProof))
        ) { error in
            XCTAssertEqual(error as? NativeDurableFileWriterError, .leaseExpired)
        }

        try writer.withExclusiveMutationLock { secondLease in
            let staleProof = try XCTUnwrap(escapedProof)
            let freshSource = try secondLease.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(try secondLease.revalidate(staleProof))
            XCTAssertThrowsError(
                try secondLease.durableCompareAndSwapManaged(
                    Data("must-not-overwrite".utf8),
                    replacing: staleProof,
                    sourceProof: freshSource,
                    role: .ordinaryHealthIndex
                )
            )
            XCTAssertFalse(
                posix.snapshotCalls().dropFirst(before).contains { $0.hasPrefix("renameAt:") }
            )
        }
        XCTAssertEqual(try Data(contentsOf: fixture.slots), newIndex)
    }

    func testManagedIndexCASPostRenameRacesNeverReturnSuccess() throws {
        enum Fixture: CaseIterable { case index, source, ordinaryDirectory }

        for race in Fixture.allCases {
            let sourceBytes = Data("source-post-cas-\(race)".utf8)
            let oldIndex = Data("old-index-post-cas-\(race)".utf8)
            let newIndex = Data("new-index-post-cas-\(race)".utf8)
            let replacement = Data("replacement-post-cas-\(race)".utf8)
            let fixture = try makeOrdinaryPendingFixture(
                "\(#function)-\(race)",
                sourceBytes: sourceBytes,
                indexBytes: oldIndex,
                blobBytes: Data("unused-pending".utf8),
                blobPresent: false
            )
            let detached = fixture.base.appendingPathComponent("detached-\(race)")
            let writer = NativeDurableFileWriter(rootURL: fixture.root) { event in
                switch race {
                case .index where event.point == .afterRename && event.role == .ordinaryHealthIndex:
                    try FileManager.default.moveItem(at: fixture.slots, to: detached)
                    try writePrivateForFault(replacement, to: fixture.slots)
                case .source where event.point == .afterParentDirectoryFSync
                    && event.role == .ordinaryHealthIndex:
                    try FileManager.default.moveItem(at: fixture.primary, to: detached)
                    try writePrivateForFault(replacement, to: fixture.primary)
                case .ordinaryDirectory where event.point == .afterHashVerified
                    && event.role == .ordinaryHealthIndex:
                    try swapDirectoryForFault(
                        canonical: fixture.ordinary,
                        detached: detached,
                        replacementChildren: ["blobs"]
                    )
                default:
                    break
                }
            }
            var returnedSuccess = false

            XCTAssertThrowsError(
                try writer.withExclusiveMutationLock { locked in
                    let sourceProof = try locked.verifyPrimarySource(
                        expectedSource: .sha256(hash(sourceBytes))
                    )
                    let expectedProof = try XCTUnwrap(
                        locked.readManagedFileProof(
                            relativePath: "Recovery/ordinary/slots.json",
                            role: .ordinaryHealthIndex
                        )
                    )
                    _ = try locked.durableCompareAndSwapManaged(
                        newIndex,
                        replacing: expectedProof,
                        sourceProof: sourceProof,
                        role: .ordinaryHealthIndex
                    )
                    returnedSuccess = true
                },
                "race=\(race)"
            )
            XCTAssertFalse(returnedSuccess, "race=\(race)")
            switch race {
            case .index:
                XCTAssertEqual(try Data(contentsOf: fixture.slots), replacement)
            case .source:
                XCTAssertEqual(try Data(contentsOf: fixture.primary), replacement)
            case .ordinaryDirectory:
                XCTAssertTrue(fileManager.fileExists(atPath: fixture.ordinary.path))
                XCTAssertTrue(fileManager.fileExists(atPath: detached.path))
            }
        }
    }

    func testEnumerateIfPresentBindsEveryComponentNoFollowAndValidatesPresentDirectory() throws {
        let (_, root) = try makeScratch("enumerate-if-present")
        let ordinary = try makeIndexlessOrdinary(in: root)
        try writePrivate(Data("temp".utf8), to: ordinary.appendingPathComponent("marker"))
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        let entries = try writer.withExclusiveMutationLock { locked in
            try locked.enumerateIfPresent(relativePath: "Recovery/ordinary")
        }

        XCTAssertEqual(entries, [NativeDirectoryEntry(name: "marker", fileType: .regular)])
        let directoryFlags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        let calls = posix.snapshotCalls()
        XCTAssertTrue(calls.contains("openAt:Recovery:\(directoryFlags)"))
        XCTAssertTrue(calls.contains("openAt:ordinary:\(directoryFlags)"))
        XCTAssertGreaterThanOrEqual(calls.filter { $0 == "fstatAt:Recovery:true" }.count, 2)
        XCTAssertGreaterThanOrEqual(calls.filter { $0 == "fstatAt:ordinary:true" }.count, 2)
        XCTAssertTrue(calls.contains { $0.hasPrefix("directoryEntries:") })
    }

    func testEnumerateIfPresentReturnsNilOnlyAfterSameNameENOENTReproof() throws {
        let (_, root) = try makeScratch("enumerate-if-present-missing")
        let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
        try makeDirectory(recovery)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        let entries = try writer.withExclusiveMutationLock { locked in
            try locked.enumerateIfPresent(relativePath: "Recovery/ordinary")
        }

        XCTAssertNil(entries)
        let calls = posix.snapshotCalls()
        XCTAssertEqual(calls.filter { $0 == "fstatAt:ordinary:true" }.count, 2)
        XCTAssertGreaterThanOrEqual(calls.filter { $0 == "fstatAt:Recovery:true" }.count, 2)
        XCTAssertFalse(calls.contains { $0.hasPrefix("openAt:ordinary:") })
        XCTAssertFalse(calls.contains { $0.hasPrefix("directoryEntries:") })
    }

    func testEnumerateIfPresentReturnsNilOnlyAfterTopLevelRecoveryENOENTReproof() throws {
        let (_, root) = try makeScratch("enumerate-if-present-top-level-missing")
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        let entries = try writer.withExclusiveMutationLock { locked in
            try locked.enumerateIfPresent(relativePath: "Recovery/ordinary")
        }

        XCTAssertNil(entries)
        let calls = posix.snapshotCalls()
        XCTAssertEqual(calls.filter { $0 == "fstatAt:Recovery:true" }.count, 2)
        XCTAssertFalse(calls.contains { $0.hasPrefix("openAt:Recovery:") })
        XCTAssertFalse(calls.contains { $0 == "fstatAt:ordinary:true" })
        XCTAssertFalse(calls.contains { $0.hasPrefix("directoryEntries:") })
    }

    func testEnumerateIfPresentTopLevelRecoveryAppearanceDuringReproofThrows() throws {
        let (_, root) = try makeScratch("enumerate-if-present-top-level-appearance-race")
        let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
        let posix = RecordingNativePOSIX(
            beforeFstatAtPath: "Recovery",
            beforeFstatAtOccurrence: 2,
            beforeFstatAtAction: {
                try FileManager.default.createDirectory(at: recovery, withIntermediateDirectories: false)
                guard Darwin.chmod(recovery.path, 0o700) == 0 else {
                    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
                }
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returnedNil = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            returnedNil = try locked.enumerateIfPresent(
                relativePath: "Recovery/ordinary"
            ) == nil
        })
        XCTAssertFalse(returnedNil)
        XCTAssertTrue(fileManager.fileExists(atPath: recovery.path))
    }

    func testEnumerateIfPresentMissingNameAppearanceDuringReproofThrows() throws {
        let (_, root) = try makeScratch("enumerate-if-present-appearance-race")
        let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
        let ordinary = recovery.appendingPathComponent("ordinary", isDirectory: true)
        try makeDirectory(recovery)
        let posix = RecordingNativePOSIX(
            beforeFstatAtPath: "ordinary",
            beforeFstatAtOccurrence: 2,
            beforeFstatAtAction: {
                try FileManager.default.createDirectory(at: ordinary, withIntermediateDirectories: false)
                guard Darwin.chmod(ordinary.path, 0o700) == 0 else {
                    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
                }
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returned = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            _ = try locked.enumerateIfPresent(relativePath: "Recovery/ordinary")
            returned = true
        })
        XCTAssertFalse(returned)
        XCTAssertTrue(fileManager.fileExists(atPath: ordinary.path))
    }

    func testReadValidatedNeverReturnsNilWhenLeafAppearsAfterOpenENOENT() throws {
        let (_, root) = try makeScratch("read-validated-appearance-race")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let slots = ordinary.appendingPathComponent("slots.json")
        let bytes = Data("appeared-index".utf8)
        let posix = RecordingNativePOSIX(
            afterMissingOpenAtPath: "slots.json",
            afterMissingOpenAtAction: {
                try writePrivateForFault(bytes, to: slots)
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returnedNil = false

        do {
            let result = try writer.withExclusiveMutationLock { locked in
                try locked.readValidated(relativePath: "Recovery/ordinary/slots.json")
            }
            returnedNil = result == nil
        } catch {
            // Failing closed is allowed; only a false absent result is forbidden.
        }

        XCTAssertFalse(returnedNil)
        XCTAssertEqual(try Data(contentsOf: slots), bytes)
    }

    func testEnumerateIfPresentRejectsPostEnumerationIdentitySwap() throws {
        let (base, root) = try makeScratch("enumerate-if-present-swap")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let detached = base.appendingPathComponent("detached-ordinary", isDirectory: true)
        let posix = RecordingNativePOSIX(
            beforeFstatAtPath: "ordinary",
            beforeFstatAtOccurrence: 3,
            beforeFstatAtAction: {
                try swapDirectoryForFault(canonical: ordinary, detached: detached)
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returned = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            _ = try locked.enumerateIfPresent(relativePath: "Recovery/ordinary")
            returned = true
        })
        XCTAssertFalse(returned)
        XCTAssertTrue(fileManager.fileExists(atPath: ordinary.path))
        XCTAssertTrue(fileManager.fileExists(atPath: detached.path))
    }

    func testEnumerateIfPresentRejectsInvalidTypeOwnerModeAndACL() throws {
        do {
            let (base, root) = try makeScratch("enumerate-if-present-symlink")
            let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
            let outside = base.appendingPathComponent("outside", isDirectory: true)
            try makeDirectory(recovery)
            try makeDirectory(outside)
            try fileManager.createSymbolicLink(
                at: recovery.appendingPathComponent("ordinary"),
                withDestinationURL: outside
            )
            XCTAssertThrowsError(try NativeDurableFileWriter(rootURL: root).withExclusiveMutationLock {
                _ = try $0.enumerateIfPresent(relativePath: "Recovery/ordinary")
            })
        }

        do {
            let (_, root) = try makeScratch("enumerate-if-present-file")
            let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
            try makeDirectory(recovery)
            try writePrivate(Data(), to: recovery.appendingPathComponent("ordinary"))
            XCTAssertThrowsError(try NativeDurableFileWriter(rootURL: root).withExclusiveMutationLock {
                _ = try $0.enumerateIfPresent(relativePath: "Recovery/ordinary")
            })
        }

        do {
            let (_, root) = try makeScratch("enumerate-if-present-mode")
            let ordinary = try makeIndexlessOrdinary(in: root)
            XCTAssertEqual(Darwin.chmod(ordinary.path, 0o755), 0)
            XCTAssertThrowsError(try NativeDurableFileWriter(rootURL: root).withExclusiveMutationLock {
                _ = try $0.enumerateIfPresent(relativePath: "Recovery/ordinary")
            })
        }

        do {
            let (_, root) = try makeScratch("enumerate-if-present-owner")
            _ = try makeIndexlessOrdinary(in: root)
            let posix = RecordingNativePOSIX(wrongOwnerPath: "ordinary")
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            XCTAssertThrowsError(try writer.withExclusiveMutationLock {
                _ = try $0.enumerateIfPresent(relativePath: "Recovery/ordinary")
            })
        }

        do {
            let (_, root) = try makeScratch("enumerate-if-present-acl")
            let ordinary = try makeIndexlessOrdinary(in: root)
            try addACL("user:\(NSUserName()) allow read", to: ordinary)
            XCTAssertThrowsError(try NativeDurableFileWriter(rootURL: root).withExclusiveMutationLock {
                _ = try $0.enumerateIfPresent(relativePath: "Recovery/ordinary")
            })
        }
    }

    func testOrdinaryEmptyIndexCleanupUnlinksOnlyExactEmptyPartialAndFullPrefixesDurably() throws {
        let (_, root) = try makeScratch("ordinary-empty-index-prefix-temps")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let expected = Data("{\"committed\":{\"maintenance\":{\"lastHealthCode\":null}}}".utf8)
        let namesAndBytes = [
            (ordinaryEmptyIndexTempName("00000000-0000-0000-0000-000000000000"), Data()),
            (
                ordinaryEmptyIndexTempName("11111111-1111-1111-1111-111111111111"),
                Data(expected.prefix(expected.count / 2))
            ),
            (ordinaryEmptyIndexTempName("22222222-2222-2222-2222-222222222222"), expected),
        ]
        for (name, bytes) in namesAndBytes {
            try writePrivate(bytes, to: ordinary.appendingPathComponent(name))
        }
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            try locked.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
        }

        for (name, _) in namesAndBytes {
            XCTAssertFalse(fileManager.fileExists(atPath: ordinary.appendingPathComponent(name).path))
        }
        let calls = posix.snapshotCalls()
        for (name, _) in namesAndBytes {
            let unlink = try XCTUnwrap(calls.firstIndex(of: "unlinkAt:\(name)"))
            let sync = try XCTUnwrap(calls[unlink...].firstIndex { $0.hasPrefix("syncDirectory:") })
            let absence = try XCTUnwrap(calls[sync...].firstIndex(of: "fstatAt:\(name):true"))
            XCTAssertLessThan(unlink, sync)
            XCTAssertLessThan(sync, absence)
        }
        let finalAbsence = try XCTUnwrap(calls.lastIndex { call in
            namesAndBytes.contains { call == "fstatAt:\($0.0):true" }
        })
        let recoveryReproof = try XCTUnwrap(calls[finalAbsence...].firstIndex(of: "fstatAt:Recovery:true"))
        let ordinaryReproof = try XCTUnwrap(calls[recoveryReproof...].firstIndex(of: "fstatAt:ordinary:true"))
        XCTAssertLessThan(finalAbsence, recoveryReproof)
        XCTAssertLessThan(recoveryReproof, ordinaryReproof)
    }

    func testOrdinaryEmptyIndexCleanupRejectsAlteredAndOverlongBytesWithoutUnlink() throws {
        let expected = Data("deterministic-empty-index".utf8)
        let invalidContents: [(String, Data)] = [
            ("altered", Data("deterministic-Xmpty-index".utf8)),
            ("overlong", expected + Data("x".utf8)),
        ]

        for (label, bytes) in invalidContents {
            let (_, root) = try makeScratch("ordinary-empty-index-\(label)")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let name = ordinaryEmptyIndexTempName("33333333-3333-3333-3333-333333333333")
            let temp = ordinary.appendingPathComponent(name)
            try writePrivate(bytes, to: temp)
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                try locked.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
            }, label)
            XCTAssertEqual(try Data(contentsOf: temp), bytes, label)
            XCTAssertFalse(posix.snapshotCalls().contains("unlinkAt:\(name)"), label)
        }
    }

    func testOrdinaryEmptyIndexCleanupRejectsNoncanonicalLockBlobAndUnknownEntriesWithoutTouchingThem() throws {
        let expected = Data("empty-index".utf8)
        let names = [
            ".AssetTracker.tmp.AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
            ".AssetTracker.storage.lock",
            "\(String(repeating: "0", count: 64)).json",
            "unknown",
        ]

        for name in names {
            let (_, root) = try makeScratch("ordinary-empty-index-name-\(name.hashValue)")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let entry = ordinary.appendingPathComponent(name)
            try writePrivate(expected, to: entry)
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                try locked.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
            }, name)
            XCTAssertEqual(try Data(contentsOf: entry), expected, name)
            XCTAssertFalse(posix.snapshotCalls().contains("unlinkAt:\(name)"), name)
        }

        do {
            let (_, root) = try makeScratch("ordinary-empty-index-blobs-directory")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let blobs = ordinary.appendingPathComponent("blobs", isDirectory: true)
            try makeDirectory(blobs)
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
                try locked.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
            })
            XCTAssertTrue(fileManager.fileExists(atPath: blobs.path))
            XCTAssertFalse(posix.snapshotCalls().contains("unlinkAt:blobs"))
        }
    }

    func testOrdinaryEmptyIndexCleanupRejectsWrongMetadataSymlinkAndDirectoryWithoutUnlink() throws {
        let expected = Data("empty-index".utf8)
        let canonicalName = ordinaryEmptyIndexTempName("44444444-4444-4444-4444-444444444444")

        do {
            let (_, root) = try makeScratch("ordinary-empty-index-wrong-mode")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let temp = ordinary.appendingPathComponent(canonicalName)
            try writePrivate(expected, to: temp)
            XCTAssertEqual(Darwin.chmod(temp.path, 0o644), 0)
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            XCTAssertThrowsError(try writer.withExclusiveMutationLock {
                try $0.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
            })
            XCTAssertTrue(fileManager.fileExists(atPath: temp.path))
            XCTAssertFalse(posix.snapshotCalls().contains("unlinkAt:\(canonicalName)"))
        }

        do {
            let (base, root) = try makeScratch("ordinary-empty-index-hardlink")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let temp = ordinary.appendingPathComponent(canonicalName)
            let secondLink = base.appendingPathComponent("second-link")
            try writePrivate(expected, to: temp)
            try fileManager.linkItem(at: temp, to: secondLink)
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            XCTAssertThrowsError(try writer.withExclusiveMutationLock {
                try $0.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
            })
            XCTAssertTrue(fileManager.fileExists(atPath: temp.path))
            XCTAssertFalse(posix.snapshotCalls().contains("unlinkAt:\(canonicalName)"))
        }

        do {
            let (_, root) = try makeScratch("ordinary-empty-index-owner")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let temp = ordinary.appendingPathComponent(canonicalName)
            try writePrivate(expected, to: temp)
            let posix = RecordingNativePOSIX(wrongOwnerPath: canonicalName)
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            XCTAssertThrowsError(try writer.withExclusiveMutationLock {
                try $0.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
            })
            XCTAssertTrue(fileManager.fileExists(atPath: temp.path))
            XCTAssertFalse(posix.snapshotCalls().contains("unlinkAt:\(canonicalName)"))
        }

        do {
            let (_, root) = try makeScratch("ordinary-empty-index-acl")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let temp = ordinary.appendingPathComponent(canonicalName)
            try writePrivate(expected, to: temp)
            try addACL("user:\(NSUserName()) allow read", to: temp)
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            XCTAssertThrowsError(try writer.withExclusiveMutationLock {
                try $0.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
            })
            XCTAssertTrue(fileManager.fileExists(atPath: temp.path))
            XCTAssertFalse(posix.snapshotCalls().contains("unlinkAt:\(canonicalName)"))
        }

        do {
            let (base, root) = try makeScratch("ordinary-empty-index-symlink")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let target = base.appendingPathComponent("target")
            try writePrivate(expected, to: target)
            let temp = ordinary.appendingPathComponent(canonicalName)
            try fileManager.createSymbolicLink(at: temp, withDestinationURL: target)
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            XCTAssertThrowsError(try writer.withExclusiveMutationLock {
                try $0.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
            })
            var value = stat()
            XCTAssertEqual(Darwin.lstat(temp.path, &value), 0)
            XCTAssertEqual(value.st_mode & mode_t(S_IFMT), mode_t(S_IFLNK))
            XCTAssertFalse(posix.snapshotCalls().contains("unlinkAt:\(canonicalName)"))
        }

        do {
            let (_, root) = try makeScratch("ordinary-empty-index-directory")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let temp = ordinary.appendingPathComponent(canonicalName, isDirectory: true)
            try makeDirectory(temp)
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            XCTAssertThrowsError(try writer.withExclusiveMutationLock {
                try $0.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
            })
            XCTAssertTrue(fileManager.fileExists(atPath: temp.path))
            XCTAssertFalse(posix.snapshotCalls().contains("unlinkAt:\(canonicalName)"))
        }
    }

    func testOrdinaryEmptyIndexCleanupPreservesCanonicalReplacementBeforeUnlink() throws {
        let (base, root) = try makeScratch("ordinary-empty-index-replacement")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let expected = Data("empty-index".utf8)
        let replacement = Data("replacement".utf8)
        let name = ordinaryEmptyIndexTempName("55555555-5555-5555-5555-555555555555")
        let temp = ordinary.appendingPathComponent(name)
        let detached = base.appendingPathComponent("detached-temp")
        try writePrivate(expected, to: temp)
        let posix = RecordingNativePOSIX(
            afterFirstReadOfPath: name,
            afterFirstReadAction: {
                try FileManager.default.moveItem(at: temp, to: detached)
                try writePrivateForFault(replacement, to: temp)
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            try locked.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
        })
        XCTAssertEqual(try Data(contentsOf: temp), replacement)
        XCTAssertEqual(try Data(contentsOf: detached), expected)
        XCTAssertFalse(posix.snapshotCalls().contains("unlinkAt:\(name)"))
    }

    func testOrdinaryEmptyIndexCleanupRejectsRecreationAfterDirectorySync() throws {
        let (_, root) = try makeScratch("ordinary-empty-index-recreated")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let expected = Data("empty-index".utf8)
        let replacement = Data("replacement-after-sync".utf8)
        let name = ordinaryEmptyIndexTempName("66666666-6666-6666-6666-666666666666")
        let temp = ordinary.appendingPathComponent(name)
        try writePrivate(expected, to: temp)
        let posix = RecordingNativePOSIX(
            afterSyncDirectoryPath: "ordinary",
            afterSyncDirectoryAction: {
                try writePrivateForFault(replacement, to: temp)
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returned = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            try locked.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
            returned = true
        })
        XCTAssertFalse(returned)
        XCTAssertEqual(try Data(contentsOf: temp), replacement)
    }

    func testOrdinaryEmptyIndexCleanupRejectsDirectoryChainSwapAfterSync() throws {
        let (base, root) = try makeScratch("ordinary-empty-index-chain-swap")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let expected = Data("empty-index".utf8)
        let name = ordinaryEmptyIndexTempName("77777777-7777-7777-7777-777777777777")
        let temp = ordinary.appendingPathComponent(name)
        let detached = base.appendingPathComponent("detached-ordinary", isDirectory: true)
        try writePrivate(expected, to: temp)
        let posix = RecordingNativePOSIX(
            afterSyncDirectoryPath: "ordinary",
            afterSyncDirectoryAction: {
                try swapDirectoryForFault(canonical: ordinary, detached: detached)
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
        var returned = false

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            try locked.cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: expected)
            returned = true
        })
        XCTAssertFalse(returned)
        XCTAssertTrue(fileManager.fileExists(atPath: ordinary.path))
        XCTAssertTrue(fileManager.fileExists(atPath: detached.path))
        XCTAssertFalse(fileManager.fileExists(atPath: detached.appendingPathComponent(name).path))
    }

    func testOrdinaryIndexCleanupPreservesCanonicalSlotsAndRemovesAllWriterRoleCrashTemps() throws {
        let (_, root) = try makeScratch("ordinary-index-present-crash-temps")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let canonicalIndex = Data("canonical-old-slots".utf8)
        let slots = ordinary.appendingPathComponent("slots.json")
        try writePrivate(canonicalIndex, to: slots)
        let blobs = ordinary.appendingPathComponent("blobs", isDirectory: true)
        try makeDirectory(blobs)

        let prepared = Data("prepared-index-target".utf8)
        let committed = Data("committed-index-target".utf8)
        let health = Data("health-index-target".utf8)
        let namesAndBytes = [
            (
                ordinaryEmptyIndexTempName("88888888-8888-8888-8888-888888888888"),
                Data(prepared.prefix(0))
            ),
            (
                ordinaryEmptyIndexTempName("99999999-9999-9999-9999-999999999999"),
                Data(committed.prefix(committed.count / 2))
            ),
            (ordinaryEmptyIndexTempName("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), health),
        ]
        for (name, bytes) in namesAndBytes {
            try writePrivate(bytes, to: ordinary.appendingPathComponent(name))
        }
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            try locked.cleanupOrdinaryIndexCrashTemps(
                expectedEmptyIndexBytes: Data("different-virgin-empty-index".utf8)
            )
        }

        XCTAssertEqual(try Data(contentsOf: slots), canonicalIndex)
        XCTAssertTrue(fileManager.fileExists(atPath: blobs.path))
        for (name, _) in namesAndBytes {
            XCTAssertFalse(fileManager.fileExists(atPath: ordinary.appendingPathComponent(name).path))
        }
        let calls = posix.snapshotCalls()
        XCTAssertFalse(calls.contains("unlinkAt:slots.json"))
        XCTAssertFalse(calls.contains("unlinkAt:blobs"))
    }

    func testOrdinaryIndexCleanupWithCanonicalSlotsFailsClosedBeforeTouchingUnknownOrTemp() throws {
        let (_, root) = try makeScratch("ordinary-index-present-unknown")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let canonicalIndex = Data("canonical-old-slots".utf8)
        let slots = ordinary.appendingPathComponent("slots.json")
        try writePrivate(canonicalIndex, to: slots)
        let tempName = ordinaryEmptyIndexTempName("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
        let temp = ordinary.appendingPathComponent(tempName)
        let tempBytes = Data("prepared-index-target".utf8)
        try writePrivate(tempBytes, to: temp)
        let unknown = ordinary.appendingPathComponent("unknown-sentinel")
        let unknownBytes = Data("preserve-me".utf8)
        try writePrivate(unknownBytes, to: unknown)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        XCTAssertThrowsError(try writer.withExclusiveMutationLock { locked in
            try locked.cleanupOrdinaryIndexCrashTemps(
                expectedEmptyIndexBytes: Data("virgin-empty-index".utf8)
            )
        })

        XCTAssertEqual(try Data(contentsOf: slots), canonicalIndex)
        XCTAssertEqual(try Data(contentsOf: temp), tempBytes)
        XCTAssertEqual(try Data(contentsOf: unknown), unknownBytes)
        let calls = posix.snapshotCalls()
        XCTAssertFalse(calls.contains("unlinkAt:slots.json"))
        XCTAssertFalse(calls.contains("unlinkAt:\(tempName)"))
        XCTAssertFalse(calls.contains("unlinkAt:unknown-sentinel"))
    }

    func testWriterHashSyntaxRejectsArabicIndicAndFullwidthDigitsAsNonASCII() throws {
        let invalidHashes = [
            String(repeating: "٠", count: 64),
            String(repeating: "０", count: 64),
        ]

        for (index, invalidHash) in invalidHashes.enumerated() {
            let (_, root) = try makeScratch("non-ascii-hash-\(index)")
            _ = try makeOrdinaryBlobs(in: root)
            let writer = NativeDurableFileWriter(rootURL: root)
            try writer.withExclusiveMutationLock { locked in
                XCTAssertThrowsError(
                    try locked.verifyPrimarySource(expectedSource: .sha256(invalidHash))
                ) { error in
                    XCTAssertEqual(error as? NativeDurableFileWriterError, .sourceChanged)
                }
                XCTAssertThrowsError(
                    try locked.readValidated(
                        relativePath: "Recovery/ordinary/blobs/\(invalidHash).json"
                    )
                ) { error in
                    XCTAssertEqual(error as? NativeDurableFileWriterError, .invalidManagedPath)
                }
                let sourceProof = try locked.verifyPrimarySource(expectedSource: .missing)
                XCTAssertThrowsError(
                    try locked.unlinkOrdinaryPendingAndSync(
                        relativePath: "Recovery/ordinary/blobs/\(invalidHash).json",
                        sourceProof: sourceProof,
                        authorizeLatestIndex: { _ in
                            XCTFail("invalid hash must fail before index authorization")
                            return .unlinkPending
                        }
                    )
                ) { error in
                    XCTAssertEqual(error as? NativeDurableFileWriterError, .invalidRoleTarget)
                }
            }
        }
    }

    func testOrdinaryNamespaceAuditDistinguishesProvenTopLevelAndNestedAbsence() throws {
        do {
            let (_, root) = try makeScratch("ordinary-audit-top-level-absent")
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let before = posix.snapshotCalls().count
                XCTAssertEqual(
                    try locked.auditOrdinaryIndexNamespace(
                        expectedEmptyIndexBytes: Data("empty-index".utf8)
                    ),
                    .absent
                )
                let calls = Array(posix.snapshotCalls().dropFirst(before))
                XCTAssertEqual(calls.filter { $0 == "fstatAt:Recovery:true" }.count, 2)
                assertReadOnlyWriterCalls(calls)
            }
        }

        do {
            let (_, root) = try makeScratch("ordinary-audit-nested-absent")
            let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
            try makeDirectory(recovery)
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let before = posix.snapshotCalls().count
                XCTAssertEqual(
                    try locked.auditOrdinaryIndexNamespace(
                        expectedEmptyIndexBytes: Data("empty-index".utf8)
                    ),
                    .absent
                )
                let calls = Array(posix.snapshotCalls().dropFirst(before))
                XCTAssertEqual(calls.filter { $0 == "fstatAt:ordinary:true" }.count, 2)
                assertReadOnlyWriterCalls(calls)
            }
        }
    }

    func testOrdinaryNamespaceAuditRejectsTopLevelAndNestedAppearanceDuringAbsenceReproof() throws {
        for topLevel in [true, false] {
            let (_, root) = try makeScratch(
                "ordinary-audit-absence-appearance-\(topLevel ? "top" : "nested")"
            )
            let recovery = root.appendingPathComponent("Recovery", isDirectory: true)
            let ordinary = recovery.appendingPathComponent("ordinary", isDirectory: true)
            if !topLevel { try makeDirectory(recovery) }
            let missingName = topLevel ? "Recovery" : "ordinary"
            let missingURL = topLevel ? recovery : ordinary
            let posix = RecordingNativePOSIX(
                beforeFstatAtPath: missingName,
                beforeFstatAtOccurrence: 2,
                beforeFstatAtAction: {
                    try FileManager.default.createDirectory(
                        at: missingURL,
                        withIntermediateDirectories: false
                    )
                    guard Darwin.chmod(missingURL.path, 0o700) == 0 else {
                        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
                    }
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.auditOrdinaryIndexNamespace(
                        expectedEmptyIndexBytes: Data("empty-index".utf8)
                    )
                )
                assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
            }
            XCTAssertTrue(fileManager.fileExists(atPath: missingURL.path))
        }
    }

    func testOrdinaryNamespaceAuditReportsEmptyIndexlessWithoutMutation() throws {
        let (_, root) = try makeScratch("ordinary-audit-indexless-empty")
        _ = try makeIndexlessOrdinary(in: root)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            let before = posix.snapshotCalls().count
            XCTAssertEqual(
                try locked.auditOrdinaryIndexNamespace(
                    expectedEmptyIndexBytes: Data("empty-index".utf8)
                ),
                .indexless(validatedTempCount: 0)
            )
            let calls = Array(posix.snapshotCalls().dropFirst(before))
            XCTAssertGreaterThanOrEqual(calls.filter { $0.hasPrefix("directoryEntries:") }.count, 2)
            assertReadOnlyWriterCalls(calls)
        }
    }

    func testOrdinaryNamespaceAuditPreservesExactEmptyPartialAndFullIndexlessTemps() throws {
        let (_, root) = try makeScratch("ordinary-audit-indexless-temps")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let expected = Data("deterministic-empty-index-bytes".utf8)
        let namesAndBytes = [
            (ordinaryEmptyIndexTempName("cccccccc-cccc-cccc-cccc-cccccccccccc"), Data()),
            (
                ordinaryEmptyIndexTempName("dddddddd-dddd-dddd-dddd-dddddddddddd"),
                Data(expected.prefix(expected.count / 2))
            ),
            (ordinaryEmptyIndexTempName("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"), expected),
        ]
        var identities: [String: (UInt64, UInt64)] = [:]
        for (name, bytes) in namesAndBytes {
            let url = ordinary.appendingPathComponent(name)
            try writePrivate(bytes, to: url)
            var value = stat()
            XCTAssertEqual(Darwin.lstat(url.path, &value), 0)
            identities[name] = (UInt64(value.st_dev), UInt64(value.st_ino))
        }
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            let before = posix.snapshotCalls().count
            XCTAssertEqual(
                try locked.auditOrdinaryIndexNamespace(expectedEmptyIndexBytes: expected),
                .indexless(validatedTempCount: 3)
            )
            assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
        }

        for (name, bytes) in namesAndBytes {
            let url = ordinary.appendingPathComponent(name)
            XCTAssertEqual(try Data(contentsOf: url), bytes)
            var value = stat()
            XCTAssertEqual(Darwin.lstat(url.path, &value), 0)
            XCTAssertEqual(identities[name]?.0, UInt64(value.st_dev))
            XCTAssertEqual(identities[name]?.1, UInt64(value.st_ino))
        }
    }

    func testOrdinaryNamespaceAuditRejectsAndPreservesEveryIllegalIndexlessEntryClass() throws {
        enum Fixture: CaseIterable {
            case blobsDirectory, blob, unknown, noncanonicalTemp
            case alteredTemp, overlongTemp, symlinkTemp, directoryTemp
            case wrongModeTemp, hardLinkedTemp, wrongOwnerTemp, aclTemp
        }

        let expected = Data("deterministic-empty-index".utf8)
        let canonicalName = ordinaryEmptyIndexTempName("ffffffff-ffff-ffff-ffff-ffffffffffff")
        for fixture in Fixture.allCases {
            let (base, root) = try makeScratch("ordinary-audit-illegal-\(fixture)")
            let ordinary = try makeIndexlessOrdinary(in: root)
            var protectedURL = ordinary.appendingPathComponent(canonicalName)
            var posix = RecordingNativePOSIX()

            switch fixture {
            case .blobsDirectory:
                protectedURL = ordinary.appendingPathComponent("blobs", isDirectory: true)
                try makeDirectory(protectedURL)
            case .blob:
                protectedURL = ordinary.appendingPathComponent(
                    "\(String(repeating: "0", count: 64)).json"
                )
                try writePrivate(expected, to: protectedURL)
            case .unknown:
                protectedURL = ordinary.appendingPathComponent("unknown")
                try writePrivate(expected, to: protectedURL)
            case .noncanonicalTemp:
                protectedURL = ordinary.appendingPathComponent(
                    ".AssetTracker.tmp.FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"
                )
                try writePrivate(expected, to: protectedURL)
            case .alteredTemp:
                try writePrivate(Data("X".utf8) + Data(expected.dropFirst()), to: protectedURL)
            case .overlongTemp:
                try writePrivate(expected + Data("x".utf8), to: protectedURL)
            case .symlinkTemp:
                let target = base.appendingPathComponent("target")
                try writePrivate(expected, to: target)
                try fileManager.createSymbolicLink(at: protectedURL, withDestinationURL: target)
            case .directoryTemp:
                try makeDirectory(protectedURL)
            case .wrongModeTemp:
                try writePrivate(expected, to: protectedURL)
                XCTAssertEqual(Darwin.chmod(protectedURL.path, 0o644), 0)
            case .hardLinkedTemp:
                try writePrivate(expected, to: protectedURL)
                try fileManager.linkItem(
                    at: protectedURL,
                    to: base.appendingPathComponent("second-link")
                )
            case .wrongOwnerTemp:
                try writePrivate(expected, to: protectedURL)
                posix = RecordingNativePOSIX(wrongOwnerPath: canonicalName)
            case .aclTemp:
                try writePrivate(expected, to: protectedURL)
                try addACL("user:\(NSUserName()) allow read", to: protectedURL)
            }

            var beforeStat = stat()
            XCTAssertEqual(Darwin.lstat(protectedURL.path, &beforeStat), 0)
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            try writer.withExclusiveMutationLock { locked in
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.auditOrdinaryIndexNamespace(expectedEmptyIndexBytes: expected),
                    "fixture=\(fixture)"
                )
                assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
            }
            var afterStat = stat()
            XCTAssertEqual(Darwin.lstat(protectedURL.path, &afterStat), 0)
            XCTAssertEqual(UInt64(beforeStat.st_dev), UInt64(afterStat.st_dev), "fixture=\(fixture)")
            XCTAssertEqual(UInt64(beforeStat.st_ino), UInt64(afterStat.st_ino), "fixture=\(fixture)")
        }
    }

    func testOrdinaryNamespaceAuditReportsIndexedAndPreservesGenericTempsAndBlobsDirectory() throws {
        let (_, root) = try makeScratch("ordinary-audit-indexed")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let slots = ordinary.appendingPathComponent("slots.json")
        let indexBytes = Data("canonical-index".utf8)
        try writePrivate(indexBytes, to: slots)
        let blobs = ordinary.appendingPathComponent("blobs", isDirectory: true)
        try makeDirectory(blobs)
        let namesAndBytes = [
            (ordinaryEmptyIndexTempName("12121212-1212-1212-1212-121212121212"), Data()),
            (
                ordinaryEmptyIndexTempName("13131313-1313-1313-1313-131313131313"),
                Data("unrelated-partial-prepared".utf8)
            ),
            (
                ordinaryEmptyIndexTempName("14141414-1414-1414-1414-141414141414"),
                Data("unrelated-full-health-index".utf8)
            ),
        ]
        for (name, bytes) in namesAndBytes {
            try writePrivate(bytes, to: ordinary.appendingPathComponent(name))
        }
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            let before = posix.snapshotCalls().count
            XCTAssertEqual(
                try locked.auditOrdinaryIndexNamespace(
                    expectedEmptyIndexBytes: Data("different-empty-index".utf8)
                ),
                .indexed
            )
            assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
        }

        XCTAssertEqual(try Data(contentsOf: slots), indexBytes)
        XCTAssertTrue(fileManager.fileExists(atPath: blobs.path))
        for (name, bytes) in namesAndBytes {
            XCTAssertEqual(try Data(contentsOf: ordinary.appendingPathComponent(name)), bytes)
        }
    }

    func testOrdinaryNamespaceAuditIndexedModeRejectsUnknownAndInvalidGenericTempReadOnly() throws {
        for invalidTemp in [false, true] {
            let (_, root) = try makeScratch("ordinary-audit-indexed-illegal-\(invalidTemp)")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let slots = ordinary.appendingPathComponent("slots.json")
            try writePrivate(Data("canonical-index".utf8), to: slots)
            let protectedURL: URL
            if invalidTemp {
                let name = ordinaryEmptyIndexTempName("15151515-1515-1515-1515-151515151515")
                protectedURL = ordinary.appendingPathComponent(name)
                try writePrivate(Data("generic-temp".utf8), to: protectedURL)
                XCTAssertEqual(Darwin.chmod(protectedURL.path, 0o644), 0)
            } else {
                protectedURL = ordinary.appendingPathComponent("unknown")
                try writePrivate(Data("unknown".utf8), to: protectedURL)
            }
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.auditOrdinaryIndexNamespace(
                        expectedEmptyIndexBytes: Data("empty-index".utf8)
                    )
                )
                assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
            }
            XCTAssertTrue(fileManager.fileExists(atPath: protectedURL.path))
            XCTAssertEqual(try Data(contentsOf: slots), Data("canonical-index".utf8))
        }
    }

    func testOrdinaryNamespaceAuditFinalEnumerationRejectsLateAppearance() throws {
        let (_, root) = try makeScratch("ordinary-audit-late-appearance")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let appeared = ordinary.appendingPathComponent("unknown")
        let posix = RecordingNativePOSIX(
            afterDirectoryEntriesPath: "ordinary",
            afterDirectoryEntriesOccurrence: 1,
            afterDirectoryEntriesAction: {
                try writePrivateForFault(Data("appeared".utf8), to: appeared)
            }
        )
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(
                try locked.auditOrdinaryIndexNamespace(
                    expectedEmptyIndexBytes: Data("empty-index".utf8)
                )
            )
            assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
        }
        XCTAssertEqual(try Data(contentsOf: appeared), Data("appeared".utf8))
    }

    func testOrdinaryNamespaceAuditFinalRereadRejectsTempDisappearanceAndIndexReplacement() throws {
        do {
            let (base, root) = try makeScratch("ordinary-audit-temp-disappearance")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let expected = Data("empty-index".utf8)
            let name = ordinaryEmptyIndexTempName("16161616-1616-1616-1616-161616161616")
            let temp = ordinary.appendingPathComponent(name)
            let detached = base.appendingPathComponent("detached-temp")
            try writePrivate(expected, to: temp)
            let posix = RecordingNativePOSIX(
                afterPositiveReadOfPathPrefix: name,
                afterPositiveReadOccurrence: 2,
                afterPositiveReadAction: {
                    try FileManager.default.moveItem(at: temp, to: detached)
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.auditOrdinaryIndexNamespace(expectedEmptyIndexBytes: expected)
                )
                assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
            }
            XCTAssertEqual(try Data(contentsOf: detached), expected)
        }

        do {
            let (base, root) = try makeScratch("ordinary-audit-index-replacement")
            let ordinary = try makeIndexlessOrdinary(in: root)
            let slots = ordinary.appendingPathComponent("slots.json")
            let detached = base.appendingPathComponent("detached-slots")
            let original = Data("canonical-index".utf8)
            let replacement = Data("replacement-index".utf8)
            try writePrivate(original, to: slots)
            let posix = RecordingNativePOSIX(
                afterPositiveReadOfPathPrefix: "slots.json",
                afterPositiveReadOccurrence: 2,
                afterPositiveReadAction: {
                    try FileManager.default.moveItem(at: slots, to: detached)
                    try writePrivateForFault(replacement, to: slots)
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.auditOrdinaryIndexNamespace(
                        expectedEmptyIndexBytes: Data("empty-index".utf8)
                    )
                )
                assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
            }
            XCTAssertEqual(try Data(contentsOf: detached), original)
            XCTAssertEqual(try Data(contentsOf: slots), replacement)
        }
    }

    func testOrdinaryBlobNamespaceAuditPreservesCrashTempsAndReturnsOnlyCanonicalBlobs() throws {
        let (_, root) = try makeScratch("ordinary-blob-audit-valid-temps")
        let blobs = try makeOrdinaryBlobs(in: root)
        try writePrivate(
            Data("canonical-index".utf8),
            to: blobs.deletingLastPathComponent().appendingPathComponent("slots.json")
        )
        let sourceBytes = Data("verified-current-primary-source".utf8)
        try writePrivate(sourceBytes, to: root.appendingPathComponent("AssetTrackerBook.json"))
        let blobBytes = Data("committed-generation".utf8)
        let blobName = "\(hash(blobBytes)).json"
        try writePrivate(blobBytes, to: blobs.appendingPathComponent(blobName))
        let namesAndBytes = [
            (ordinaryEmptyIndexTempName("21212121-2121-2121-2121-212121212121"), Data()),
            (
                ordinaryEmptyIndexTempName("22222222-2222-2222-2222-222222222222"),
                Data(sourceBytes.prefix(sourceBytes.count / 2))
            ),
            (ordinaryEmptyIndexTempName("23232323-2323-2323-2323-232323232323"), sourceBytes),
        ]
        var identities: [String: (UInt64, UInt64)] = [:]
        for (name, bytes) in namesAndBytes {
            let url = blobs.appendingPathComponent(name)
            try writePrivate(bytes, to: url)
            var value = stat()
            XCTAssertEqual(Darwin.lstat(url.path, &value), 0)
            identities[name] = (UInt64(value.st_dev), UInt64(value.st_ino))
        }
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(sourceBytes)))
            let before = posix.snapshotCalls().count
            XCTAssertEqual(
                try locked.auditOrdinaryBlobNamespace(
                    expectedSourceBytes: sourceBytes,
                    sourceProof: proof
                ),
                NativeOrdinaryBlobNamespaceAudit(
                    blobNames: [blobName],
                    validatedTempCount: 3
                )
            )
            assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
        }

        XCTAssertEqual(try Data(contentsOf: blobs.appendingPathComponent(blobName)), blobBytes)
        for (name, bytes) in namesAndBytes {
            let url = blobs.appendingPathComponent(name)
            XCTAssertEqual(try Data(contentsOf: url), bytes)
            var value = stat()
            XCTAssertEqual(Darwin.lstat(url.path, &value), 0)
            XCTAssertEqual(identities[name]?.0, UInt64(value.st_dev))
            XCTAssertEqual(identities[name]?.1, UInt64(value.st_ino))
        }
    }

    func testOrdinaryBlobNamespaceAuditRejectsEveryInvalidCrashTempAndMissingSource() throws {
        enum Fixture: CaseIterable {
            case malformedName, altered, overlong, wrongMode, hardLinked
            case wrongOwner, acl, symbolicLink, directory, missingSource
        }

        let sourceBytes = Data("verified-current-primary-source".utf8)
        let canonicalName = ordinaryEmptyIndexTempName("24242424-2424-2424-2424-242424242424")
        for fixture in Fixture.allCases {
            let (base, root) = try makeScratch("ordinary-blob-audit-invalid-\(fixture)")
            let blobs = try makeOrdinaryBlobs(in: root)
            try writePrivate(
                Data("canonical-index".utf8),
                to: blobs.deletingLastPathComponent().appendingPathComponent("slots.json")
            )
            if fixture != .missingSource {
                try writePrivate(sourceBytes, to: root.appendingPathComponent("AssetTrackerBook.json"))
            }
            let name = fixture == .malformedName
                ? ".AssetTracker.tmp.24242424-2424-2424-2424-24242424242A"
                : canonicalName
            let protectedURL = blobs.appendingPathComponent(name)
            var posix = RecordingNativePOSIX()

            switch fixture {
            case .malformedName:
                try writePrivate(sourceBytes, to: protectedURL)
            case .altered:
                try writePrivate(Data("X".utf8) + Data(sourceBytes.dropFirst()), to: protectedURL)
            case .overlong:
                try writePrivate(sourceBytes + Data("x".utf8), to: protectedURL)
            case .wrongMode:
                try writePrivate(sourceBytes, to: protectedURL)
                XCTAssertEqual(Darwin.chmod(protectedURL.path, 0o644), 0)
            case .hardLinked:
                try writePrivate(sourceBytes, to: protectedURL)
                try fileManager.linkItem(
                    at: protectedURL,
                    to: base.appendingPathComponent("second-link")
                )
            case .wrongOwner:
                try writePrivate(sourceBytes, to: protectedURL)
                posix = RecordingNativePOSIX(wrongOwnerPath: canonicalName)
            case .acl:
                try writePrivate(sourceBytes, to: protectedURL)
                try addACL("user:\(NSUserName()) allow read", to: protectedURL)
            case .symbolicLink:
                let target = base.appendingPathComponent("target")
                try writePrivate(sourceBytes, to: target)
                try fileManager.createSymbolicLink(at: protectedURL, withDestinationURL: target)
            case .directory:
                try makeDirectory(protectedURL)
            case .missingSource:
                try writePrivate(sourceBytes, to: protectedURL)
            }

            var beforeStat = stat()
            XCTAssertEqual(Darwin.lstat(protectedURL.path, &beforeStat), 0)
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            try writer.withExclusiveMutationLock { locked in
                let expectedSource: ExpectedBookSource = fixture == .missingSource
                    ? .missing
                    : .sha256(hash(sourceBytes))
                let proof = try locked.verifyPrimarySource(expectedSource: expectedSource)
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.auditOrdinaryBlobNamespace(
                        expectedSourceBytes: fixture == .missingSource ? nil : sourceBytes,
                        sourceProof: proof
                    ),
                    "fixture=\(fixture)"
                )
                assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
            }
            var afterStat = stat()
            XCTAssertEqual(Darwin.lstat(protectedURL.path, &afterStat), 0)
            XCTAssertEqual(UInt64(beforeStat.st_dev), UInt64(afterStat.st_dev), "fixture=\(fixture)")
            XCTAssertEqual(UInt64(beforeStat.st_ino), UInt64(afterStat.st_ino), "fixture=\(fixture)")
        }
    }

    func testOrdinaryBlobNamespaceAuditRejectsLateTempAppearanceAndTempReplacementReadOnly() throws {
        do {
            let (_, root) = try makeScratch("ordinary-blob-audit-late-appearance")
            let blobs = try makeOrdinaryBlobs(in: root)
            try writePrivate(
                Data("canonical-index".utf8),
                to: blobs.deletingLastPathComponent().appendingPathComponent("slots.json")
            )
            let sourceBytes = Data("verified-source".utf8)
            try writePrivate(sourceBytes, to: root.appendingPathComponent("AssetTrackerBook.json"))
            let appeared = blobs.appendingPathComponent("unknown-late-entry")
            let posix = RecordingNativePOSIX(
                afterDirectoryEntriesPath: "blobs",
                afterDirectoryEntriesOccurrence: 1,
                afterDirectoryEntriesAction: {
                    try writePrivateForFault(Data("late".utf8), to: appeared)
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(sourceBytes)))
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.auditOrdinaryBlobNamespace(
                        expectedSourceBytes: sourceBytes,
                        sourceProof: proof
                    )
                )
                assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
            }
            XCTAssertEqual(try Data(contentsOf: appeared), Data("late".utf8))
        }

        do {
            let (base, root) = try makeScratch("ordinary-blob-audit-temp-replacement")
            let blobs = try makeOrdinaryBlobs(in: root)
            try writePrivate(
                Data("canonical-index".utf8),
                to: blobs.deletingLastPathComponent().appendingPathComponent("slots.json")
            )
            let sourceBytes = Data("verified-source".utf8)
            try writePrivate(sourceBytes, to: root.appendingPathComponent("AssetTrackerBook.json"))
            let name = ordinaryEmptyIndexTempName("25252525-2525-2525-2525-252525252525")
            let temp = blobs.appendingPathComponent(name)
            let detached = base.appendingPathComponent("detached-temp")
            let replacement = Data(sourceBytes.prefix(1))
            try writePrivate(sourceBytes, to: temp)
            let posix = RecordingNativePOSIX(
                afterPositiveReadOfPathPrefix: name,
                afterPositiveReadOccurrence: 2,
                afterPositiveReadAction: {
                    try FileManager.default.moveItem(at: temp, to: detached)
                    try writePrivateForFault(replacement, to: temp)
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(sourceBytes)))
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.auditOrdinaryBlobNamespace(
                        expectedSourceBytes: sourceBytes,
                        sourceProof: proof
                    )
                )
                assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
            }
            XCTAssertEqual(try Data(contentsOf: detached), sourceBytes)
            XCTAssertEqual(try Data(contentsOf: temp), replacement)
        }

        do {
            let (base, root) = try makeScratch("ordinary-blob-audit-source-replacement")
            let blobs = try makeOrdinaryBlobs(in: root)
            try writePrivate(
                Data("canonical-index".utf8),
                to: blobs.deletingLastPathComponent().appendingPathComponent("slots.json")
            )
            let sourceBytes = Data("verified-source".utf8)
            let primary = root.appendingPathComponent("AssetTrackerBook.json")
            let detached = base.appendingPathComponent("detached-primary")
            let replacement = Data("replacement-primary".utf8)
            try writePrivate(sourceBytes, to: primary)
            let name = ordinaryEmptyIndexTempName("32323232-3232-3232-3232-323232323232")
            let temp = blobs.appendingPathComponent(name)
            try writePrivate(sourceBytes, to: temp)
            let posix = RecordingNativePOSIX(
                afterDirectoryEntriesPath: "blobs",
                afterDirectoryEntriesOccurrence: 2,
                afterDirectoryEntriesAction: {
                    try FileManager.default.moveItem(at: primary, to: detached)
                    try writePrivateForFault(replacement, to: primary)
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(sourceBytes)))
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.auditOrdinaryBlobNamespace(
                        expectedSourceBytes: sourceBytes,
                        sourceProof: proof
                    )
                )
                assertReadOnlyWriterCalls(Array(posix.snapshotCalls().dropFirst(before)))
            }
            XCTAssertEqual(try Data(contentsOf: detached), sourceBytes)
            XCTAssertEqual(try Data(contentsOf: primary), replacement)
            XCTAssertEqual(try Data(contentsOf: temp), sourceBytes)
        }
    }

    func testOrdinaryBlobCrashTempCleanupDeletesOnlyValidatedTempsAndSyncsBlobDirectory() throws {
        let (_, root) = try makeScratch("ordinary-blob-cleanup-valid")
        let blobs = try makeOrdinaryBlobs(in: root)
        try writePrivate(
            Data("canonical-index".utf8),
            to: blobs.deletingLastPathComponent().appendingPathComponent("slots.json")
        )
        let sourceBytes = Data("verified-current-primary-source".utf8)
        try writePrivate(sourceBytes, to: root.appendingPathComponent("AssetTrackerBook.json"))
        let blobBytes = Data("canonical-blob".utf8)
        let blob = blobs.appendingPathComponent("\(hash(blobBytes)).json")
        try writePrivate(blobBytes, to: blob)
        let unknownBytes = Data("unknown-preserved".utf8)
        let unknown = blobs.appendingPathComponent("unknown-sentinel")
        try writePrivate(unknownBytes, to: unknown)
        let namesAndBytes = [
            (ordinaryEmptyIndexTempName("26262626-2626-2626-2626-262626262626"), Data()),
            (
                ordinaryEmptyIndexTempName("27272727-2727-2727-2727-272727272727"),
                Data(sourceBytes.prefix(sourceBytes.count / 2))
            ),
            (ordinaryEmptyIndexTempName("28282828-2828-2828-2828-282828282828"), sourceBytes),
        ]
        for (name, bytes) in namesAndBytes {
            try writePrivate(bytes, to: blobs.appendingPathComponent(name))
        }
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(sourceBytes)))
            let before = posix.snapshotCalls().count
            try locked.cleanupOrdinaryBlobCrashTemps(
                expectedSourceBytes: sourceBytes,
                sourceProof: proof
            )
            let calls = Array(posix.snapshotCalls().dropFirst(before))
            XCTAssertEqual(calls.filter { $0.hasPrefix("syncDirectory:") }.count, 1)
            for (name, _) in namesAndBytes {
                XCTAssertEqual(calls.filter { $0 == "unlinkAt:\(name)" }.count, 1)
            }
            XCTAssertFalse(calls.contains("unlinkAt:\(blob.lastPathComponent)"))
            XCTAssertFalse(calls.contains("unlinkAt:unknown-sentinel"))
        }

        XCTAssertEqual(try Data(contentsOf: blob), blobBytes)
        XCTAssertEqual(try Data(contentsOf: unknown), unknownBytes)
        for (name, _) in namesAndBytes {
            XCTAssertFalse(fileManager.fileExists(atPath: blobs.appendingPathComponent(name).path))
        }
    }

    func testOrdinaryBlobCrashTempCleanupFailsClosedAndPreservesInvalidOrRacedTemps() throws {
        enum Fixture: CaseIterable {
            case malformedName, altered, wrongMode, symbolicLink, directory, missingSource
        }

        let sourceBytes = Data("verified-current-primary-source".utf8)
        let canonicalName = ordinaryEmptyIndexTempName("29292929-2929-2929-2929-292929292929")
        for fixture in Fixture.allCases {
            let (base, root) = try makeScratch("ordinary-blob-cleanup-invalid-\(fixture)")
            let blobs = try makeOrdinaryBlobs(in: root)
            try writePrivate(
                Data("canonical-index".utf8),
                to: blobs.deletingLastPathComponent().appendingPathComponent("slots.json")
            )
            if fixture != .missingSource {
                try writePrivate(sourceBytes, to: root.appendingPathComponent("AssetTrackerBook.json"))
            }
            let name = fixture == .malformedName
                ? ".AssetTracker.tmp.29292929-2929-2929-2929-29292929292A"
                : canonicalName
            let protectedURL = blobs.appendingPathComponent(name)
            switch fixture {
            case .malformedName:
                try writePrivate(sourceBytes, to: protectedURL)
            case .altered:
                try writePrivate(Data("altered".utf8), to: protectedURL)
            case .wrongMode:
                try writePrivate(sourceBytes, to: protectedURL)
                XCTAssertEqual(Darwin.chmod(protectedURL.path, 0o644), 0)
            case .symbolicLink:
                let target = base.appendingPathComponent("target")
                try writePrivate(sourceBytes, to: target)
                try fileManager.createSymbolicLink(at: protectedURL, withDestinationURL: target)
            case .directory:
                try makeDirectory(protectedURL)
            case .missingSource:
                try writePrivate(sourceBytes, to: protectedURL)
            }
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let expectedSource: ExpectedBookSource = fixture == .missingSource
                    ? .missing
                    : .sha256(hash(sourceBytes))
                let proof = try locked.verifyPrimarySource(expectedSource: expectedSource)
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.cleanupOrdinaryBlobCrashTemps(
                        expectedSourceBytes: fixture == .missingSource ? nil : sourceBytes,
                        sourceProof: proof
                    ),
                    "fixture=\(fixture)"
                )
                XCTAssertFalse(
                    posix.snapshotCalls().dropFirst(before).contains { $0.hasPrefix("unlinkAt:") },
                    "fixture=\(fixture)"
                )
            }
            XCTAssertTrue(fileManager.fileExists(atPath: protectedURL.path), "fixture=\(fixture)")
        }

        do {
            let (base, root) = try makeScratch("ordinary-blob-cleanup-source-replacement")
            let blobs = try makeOrdinaryBlobs(in: root)
            try writePrivate(
                Data("canonical-index".utf8),
                to: blobs.deletingLastPathComponent().appendingPathComponent("slots.json")
            )
            let sourceBytes = Data("verified-source".utf8)
            let primary = root.appendingPathComponent("AssetTrackerBook.json")
            let detached = base.appendingPathComponent("detached-primary")
            let replacement = Data("replacement-primary".utf8)
            try writePrivate(sourceBytes, to: primary)
            let name = ordinaryEmptyIndexTempName("33333333-3333-3333-3333-333333333333")
            let temp = blobs.appendingPathComponent(name)
            try writePrivate(sourceBytes, to: temp)
            let posix = RecordingNativePOSIX(
                afterPositiveReadOfPathPrefix: "AssetTrackerBook.json",
                afterPositiveReadOccurrence: 3,
                afterPositiveReadAction: {
                    try FileManager.default.moveItem(at: primary, to: detached)
                    try writePrivateForFault(replacement, to: primary)
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(sourceBytes)))
                let before = posix.snapshotCalls().count
                XCTAssertThrowsError(
                    try locked.cleanupOrdinaryBlobCrashTemps(
                        expectedSourceBytes: sourceBytes,
                        sourceProof: proof
                    )
                )
                XCTAssertFalse(
                    posix.snapshotCalls().dropFirst(before).contains { $0.hasPrefix("unlinkAt:") }
                )
            }
            XCTAssertEqual(try Data(contentsOf: detached), sourceBytes)
            XCTAssertEqual(try Data(contentsOf: primary), replacement)
            XCTAssertEqual(try Data(contentsOf: temp), sourceBytes)
        }

        do {
            let (base, root) = try makeScratch("ordinary-blob-cleanup-replacement")
            let blobs = try makeOrdinaryBlobs(in: root)
            try writePrivate(
                Data("canonical-index".utf8),
                to: blobs.deletingLastPathComponent().appendingPathComponent("slots.json")
            )
            let sourceBytes = Data("verified-source".utf8)
            try writePrivate(sourceBytes, to: root.appendingPathComponent("AssetTrackerBook.json"))
            let name = ordinaryEmptyIndexTempName("30303030-3030-3030-3030-303030303030")
            let temp = blobs.appendingPathComponent(name)
            let detached = base.appendingPathComponent("detached-temp")
            let replacement = Data(sourceBytes.prefix(1))
            try writePrivate(sourceBytes, to: temp)
            let posix = RecordingNativePOSIX(
                afterPositiveReadOfPathPrefix: name,
                afterPositiveReadOccurrence: 2,
                afterPositiveReadAction: {
                    try FileManager.default.moveItem(at: temp, to: detached)
                    try writePrivateForFault(replacement, to: temp)
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(sourceBytes)))
                XCTAssertThrowsError(
                    try locked.cleanupOrdinaryBlobCrashTemps(
                        expectedSourceBytes: sourceBytes,
                        sourceProof: proof
                    )
                )
            }
            XCTAssertEqual(try Data(contentsOf: detached), sourceBytes)
            XCTAssertEqual(try Data(contentsOf: temp), replacement)
        }

        do {
            let (_, root) = try makeScratch("ordinary-blob-cleanup-name-reappearance")
            let blobs = try makeOrdinaryBlobs(in: root)
            try writePrivate(
                Data("canonical-index".utf8),
                to: blobs.deletingLastPathComponent().appendingPathComponent("slots.json")
            )
            let sourceBytes = Data("verified-source".utf8)
            try writePrivate(sourceBytes, to: root.appendingPathComponent("AssetTrackerBook.json"))
            let name = ordinaryEmptyIndexTempName("31313131-3131-3131-3131-313131313131")
            let temp = blobs.appendingPathComponent(name)
            let replacement = Data(sourceBytes.prefix(1))
            try writePrivate(sourceBytes, to: temp)
            let posix = RecordingNativePOSIX(
                afterSyncDirectoryPath: "blobs",
                afterSyncDirectoryAction: {
                    try writePrivateForFault(replacement, to: temp)
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            try writer.withExclusiveMutationLock { locked in
                let proof = try locked.verifyPrimarySource(expectedSource: .sha256(hash(sourceBytes)))
                XCTAssertThrowsError(
                    try locked.cleanupOrdinaryBlobCrashTemps(
                        expectedSourceBytes: sourceBytes,
                        sourceProof: proof
                    )
                )
            }
            XCTAssertEqual(try Data(contentsOf: temp), replacement)
        }
    }

    func testReadOnlyAuditProvesAbsentRootWithoutCreatingOrChangingAnything() throws {
        let (base, root) = try makeScratch("read-only-root-absent")
        try fileManager.removeItem(at: root)
        let sibling = base.appendingPathComponent("sibling")
        let siblingBytes = Data("untouched".utf8)
        try writePrivate(siblingBytes, to: sibling)
        let parentEntriesBefore = try fileManager.contentsOfDirectory(atPath: base.path).sorted()
        var siblingBefore = stat()
        XCTAssertEqual(Darwin.lstat(sibling.path, &siblingBefore), 0)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        let before = posix.snapshotCalls().count
        let result: Bool? = try writer.withReadOnlyAudit { _ in
            XCTFail("absent roots must not expose a read context")
            return true
        }
        XCTAssertNil(result)
        let calls = Array(posix.snapshotCalls().dropFirst(before))
        assertZeroWriteAuditCalls(calls)
        XCTAssertEqual(calls.filter { $0 == "fstatAt:\(root.lastPathComponent):true" }.count, 2)
        XCTAssertFalse(fileManager.fileExists(atPath: root.path))
        XCTAssertEqual(try fileManager.contentsOfDirectory(atPath: base.path).sorted(), parentEntriesBefore)
        XCTAssertEqual(try Data(contentsOf: sibling), siblingBytes)
        var siblingAfter = stat()
        XCTAssertEqual(Darwin.lstat(sibling.path, &siblingAfter), 0)
        XCTAssertEqual(UInt64(siblingBefore.st_dev), UInt64(siblingAfter.st_dev))
        XCTAssertEqual(UInt64(siblingBefore.st_ino), UInt64(siblingAfter.st_ino))
    }

    func testReadOnlyAuditExposesLegacyRootWithoutLockOrRecoveryAndPreservesItExactly() throws {
        let (_, root) = try makeScratch("read-only-legacy-unmanaged")
        XCTAssertEqual(Darwin.chmod(root.path, 0o755), 0)
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        let primaryBytes = Data("legacy-primary".utf8)
        try writePrivate(primaryBytes, to: primary)
        let entriesBefore = try fileManager.contentsOfDirectory(atPath: root.path).sorted()
        var rootBefore = stat()
        var primaryBefore = stat()
        XCTAssertEqual(Darwin.lstat(root.path, &rootBefore), 0)
        XCTAssertEqual(Darwin.lstat(primary.path, &primaryBefore), 0)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        let before = posix.snapshotCalls().count
        let result = try writer.withReadOnlyAudit { readOnly in
            XCTAssertEqual(
                try readOnly.readValidated(relativePath: "AssetTrackerBook.json"),
                primaryBytes
            )
            XCTAssertEqual(
                try readOnly.auditOrdinaryIndexNamespace(
                    expectedEmptyIndexBytes: Data("empty-index".utf8)
                ),
                .absent
            )
            try readOnly.revalidateCanonicalIdentity()
            return "legacy"
        }
        XCTAssertEqual(result, "legacy")
        assertZeroWriteAuditCalls(Array(posix.snapshotCalls().dropFirst(before)))
        XCTAssertEqual(try fileManager.contentsOfDirectory(atPath: root.path).sorted(), entriesBefore)
        XCTAssertFalse(
            fileManager.fileExists(atPath: root.appendingPathComponent(".AssetTracker.storage.lock").path)
        )
        XCTAssertEqual(try permissions(root), 0o755)
        XCTAssertEqual(try Data(contentsOf: primary), primaryBytes)
        var rootAfter = stat()
        var primaryAfter = stat()
        XCTAssertEqual(Darwin.lstat(root.path, &rootAfter), 0)
        XCTAssertEqual(Darwin.lstat(primary.path, &primaryAfter), 0)
        XCTAssertEqual(UInt64(rootBefore.st_ino), UInt64(rootAfter.st_ino))
        XCTAssertEqual(UInt64(primaryBefore.st_ino), UInt64(primaryAfter.st_ino))
    }

    func testReadOnlyAuditWithoutLockAuditsExistingStrictRecoveryAndCreatesNoLock() throws {
        let (_, root) = try makeScratch("read-only-recovery-without-lock")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let slots = ordinary.appendingPathComponent("slots.json")
        let indexBytes = Data("canonical-index".utf8)
        try writePrivate(indexBytes, to: slots)
        let entriesBefore = try fileManager.contentsOfDirectory(atPath: root.path).sorted()
        let ordinaryEntriesBefore = try fileManager.contentsOfDirectory(atPath: ordinary.path).sorted()
        var slotsBefore = stat()
        XCTAssertEqual(Darwin.lstat(slots.path, &slotsBefore), 0)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        let before = posix.snapshotCalls().count
        let result = try writer.withReadOnlyAudit { readOnly in
            XCTAssertEqual(
                try readOnly.auditOrdinaryIndexNamespace(
                    expectedEmptyIndexBytes: Data("different-empty-index".utf8)
                ),
                .indexed
            )
            return "healthy"
        }
        XCTAssertEqual(result, "healthy")
        assertZeroWriteAuditCalls(Array(posix.snapshotCalls().dropFirst(before)))
        XCTAssertEqual(try fileManager.contentsOfDirectory(atPath: root.path).sorted(), entriesBefore)
        XCTAssertEqual(
            try fileManager.contentsOfDirectory(atPath: ordinary.path).sorted(),
            ordinaryEntriesBefore
        )
        XCTAssertFalse(
            fileManager.fileExists(atPath: root.appendingPathComponent(".AssetTracker.storage.lock").path)
        )
        XCTAssertEqual(try Data(contentsOf: slots), indexBytes)
        var slotsAfter = stat()
        XCTAssertEqual(Darwin.lstat(slots.path, &slotsAfter), 0)
        XCTAssertEqual(UInt64(slotsBefore.st_ino), UInt64(slotsAfter.st_ino))
    }

    func testReadOnlyAuditWithoutLockRejectsUnknownManagedEntryAndPreservesIt() throws {
        let (_, root) = try makeScratch("read-only-recovery-unknown-without-lock")
        let ordinary = try makeIndexlessOrdinary(in: root)
        let unknown = ordinary.appendingPathComponent("unknown")
        let unknownBytes = Data("preserve".utf8)
        try writePrivate(unknownBytes, to: unknown)
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        let before = posix.snapshotCalls().count
        XCTAssertThrowsError(
            try writer.withReadOnlyAudit { readOnly in
                try readOnly.auditOrdinaryIndexNamespace(
                    expectedEmptyIndexBytes: Data("empty-index".utf8)
                )
            }
        )
        assertZeroWriteAuditCalls(Array(posix.snapshotCalls().dropFirst(before)))
        XCTAssertEqual(try Data(contentsOf: unknown), unknownBytes)
        XCTAssertFalse(
            fileManager.fileExists(atPath: root.appendingPathComponent(".AssetTracker.storage.lock").path)
        )
    }

    func testReadOnlyAuditUsesSharedLockAndExposesOnlyReadPrimitivesWithoutMutation() throws {
        let (_, root) = try makeScratch("read-only-managed")
        let lock = root.appendingPathComponent(".AssetTracker.storage.lock")
        try writePrivate(Data(), to: lock)
        let blobs = try makeOrdinaryBlobs(in: root)
        let slots = blobs.deletingLastPathComponent().appendingPathComponent("slots.json")
        let indexBytes = Data("canonical-index".utf8)
        try writePrivate(indexBytes, to: slots)
        let sourceBytes = Data("verified-current-primary".utf8)
        let primary = root.appendingPathComponent("AssetTrackerBook.json")
        try writePrivate(sourceBytes, to: primary)
        let entriesBefore = try fileManager.contentsOfDirectory(atPath: root.path).sorted()
        let ordinaryEntriesBefore = try fileManager.contentsOfDirectory(
            atPath: blobs.deletingLastPathComponent().path
        ).sorted()
        var identitiesBefore: [String: UInt64] = [:]
        for url in [root, lock, primary, slots, blobs] {
            var value = stat()
            XCTAssertEqual(Darwin.lstat(url.path, &value), 0)
            identitiesBefore[url.path] = UInt64(value.st_ino)
        }
        let posix = RecordingNativePOSIX()
        let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

        let before = posix.snapshotCalls().count
        let result = try writer.withReadOnlyAudit { readOnly in
            XCTAssertEqual(
                try readOnly.readValidated(relativePath: "AssetTrackerBook.json"),
                sourceBytes
            )
            let proof = try readOnly.verifyPrimarySource(
                expectedSource: .sha256(hash(sourceBytes))
            )
            XCTAssertEqual(
                try readOnly.enumerateIfPresent(relativePath: "Recovery/ordinary")?.map(\.name),
                ["blobs", "slots.json"]
            )
            XCTAssertEqual(
                try readOnly.auditOrdinaryIndexNamespace(
                    expectedEmptyIndexBytes: Data("different-empty-index".utf8)
                ),
                .indexed
            )
            XCTAssertEqual(
                try readOnly.auditOrdinaryBlobNamespace(
                    expectedSourceBytes: sourceBytes,
                    sourceProof: proof
                ),
                NativeOrdinaryBlobNamespaceAudit(blobNames: [], validatedTempCount: 0)
            )
            try readOnly.revalidateCanonicalIdentity()
            return "audited"
        }
        XCTAssertEqual(result, "audited")
        let calls = Array(posix.snapshotCalls().dropFirst(before))
        assertZeroWriteAuditCalls(calls)
        XCTAssertTrue(calls.contains { call in
            call.hasPrefix("flock:") && call.hasSuffix(":\(LOCK_SH)")
        })
        XCTAssertEqual(try fileManager.contentsOfDirectory(atPath: root.path).sorted(), entriesBefore)
        XCTAssertEqual(
            try fileManager.contentsOfDirectory(atPath: blobs.deletingLastPathComponent().path).sorted(),
            ordinaryEntriesBefore
        )
        XCTAssertEqual(try Data(contentsOf: primary), sourceBytes)
        XCTAssertEqual(try Data(contentsOf: slots), indexBytes)
        for url in [root, lock, primary, slots, blobs] {
            var value = stat()
            XCTAssertEqual(Darwin.lstat(url.path, &value), 0)
            XCTAssertEqual(identitiesBefore[url.path], UInt64(value.st_ino))
        }
    }

    func testReadOnlyAuditRejectsRootLockAndRecoveryAbsenceRacesWithoutMutation() throws {
        do {
            let (_, root) = try makeScratch("read-only-root-appearance")
            try fileManager.removeItem(at: root)
            let posix = RecordingNativePOSIX(
                beforeFstatAtPath: root.lastPathComponent,
                beforeFstatAtOccurrence: 2,
                beforeFstatAtAction: {
                    try FileManager.default.createDirectory(
                        at: root,
                        withIntermediateDirectories: false
                    )
                    guard Darwin.chmod(root.path, 0o700) == 0 else {
                        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
                    }
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(try writer.withReadOnlyAudit { _ in true })
            assertZeroWriteAuditCalls(Array(posix.snapshotCalls().dropFirst(before)))
            XCTAssertTrue(fileManager.fileExists(atPath: root.path))
        }

        for appearingName in ["Recovery", ".AssetTracker.storage.lock"] {
            let (_, root) = try makeScratch("read-only-child-appearance-\(appearingName)")
            let appeared = root.appendingPathComponent(
                appearingName,
                isDirectory: appearingName == "Recovery"
            )
            let posix = RecordingNativePOSIX(
                beforeFstatAtPath: appearingName,
                beforeFstatAtOccurrence: 2,
                beforeFstatAtAction: {
                    if appearingName == "Recovery" {
                        try FileManager.default.createDirectory(
                            at: appeared,
                            withIntermediateDirectories: false
                        )
                        guard Darwin.chmod(appeared.path, 0o700) == 0 else {
                            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
                        }
                    } else {
                        try writePrivateForFault(Data(), to: appeared)
                    }
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(try writer.withReadOnlyAudit { _ in true })
            assertZeroWriteAuditCalls(Array(posix.snapshotCalls().dropFirst(before)))
            XCTAssertTrue(fileManager.fileExists(atPath: appeared.path))
        }
    }

    func testReadOnlyAuditRejectsCanonicalRootOrLockIdentityReplacement() throws {
        do {
            let (base, root) = try makeScratch("read-only-root-replacement")
            let detached = base.appendingPathComponent("detached-root")
            let posix = RecordingNativePOSIX(
                beforeFstatAtPath: root.lastPathComponent,
                beforeFstatAtOccurrence: 2,
                beforeFstatAtAction: {
                    try swapDirectoryForFault(canonical: root, detached: detached)
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(try writer.withReadOnlyAudit { _ in true })
            assertZeroWriteAuditCalls(Array(posix.snapshotCalls().dropFirst(before)))
            XCTAssertTrue(fileManager.fileExists(atPath: detached.path))
            XCTAssertTrue(fileManager.fileExists(atPath: root.path))
        }

        do {
            let (base, root) = try makeScratch("read-only-lock-replacement")
            let lock = root.appendingPathComponent(".AssetTracker.storage.lock")
            let detached = base.appendingPathComponent("detached-lock")
            try writePrivate(Data(), to: lock)
            let posix = RecordingNativePOSIX(
                beforeFstatAtPath: ".AssetTracker.storage.lock",
                beforeFstatAtOccurrence: 2,
                beforeFstatAtAction: {
                    try FileManager.default.moveItem(at: lock, to: detached)
                    try writePrivateForFault(Data(), to: lock)
                }
            )
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })
            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(try writer.withReadOnlyAudit { _ in true })
            assertZeroWriteAuditCalls(Array(posix.snapshotCalls().dropFirst(before)))
            XCTAssertTrue(fileManager.fileExists(atPath: detached.path))
            XCTAssertTrue(fileManager.fileExists(atPath: lock.path))
        }
    }

    func testReadOnlyAuditRejectsEveryInvalidCanonicalLockWithoutRepairingIt() throws {
        enum Fixture: CaseIterable {
            case directory, symbolicLink, wrongMode, hardLinked, wrongOwner, acl
        }

        for fixture in Fixture.allCases {
            let (base, root) = try makeScratch("read-only-invalid-lock-\(fixture)")
            let lock = root.appendingPathComponent(".AssetTracker.storage.lock")
            var posix = RecordingNativePOSIX()
            switch fixture {
            case .directory:
                try makeDirectory(lock)
            case .symbolicLink:
                let target = base.appendingPathComponent("target")
                try writePrivate(Data(), to: target)
                try fileManager.createSymbolicLink(at: lock, withDestinationURL: target)
            case .wrongMode:
                try writePrivate(Data(), to: lock)
                XCTAssertEqual(Darwin.chmod(lock.path, 0o644), 0)
            case .hardLinked:
                try writePrivate(Data(), to: lock)
                try fileManager.linkItem(at: lock, to: base.appendingPathComponent("second-link"))
            case .wrongOwner:
                try writePrivate(Data(), to: lock)
                posix = RecordingNativePOSIX(wrongOwnerPath: ".AssetTracker.storage.lock")
            case .acl:
                try writePrivate(Data(), to: lock)
                try addACL("user:\(NSUserName()) allow read", to: lock)
            }
            var beforeStat = stat()
            XCTAssertEqual(Darwin.lstat(lock.path, &beforeStat), 0)
            let entriesBefore = try fileManager.contentsOfDirectory(atPath: root.path).sorted()
            let writer = NativeDurableFileWriter(rootURL: root, posix: posix, faultHandler: { _ in })

            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(
                try writer.withReadOnlyAudit { _ in true },
                "fixture=\(fixture)"
            )
            assertZeroWriteAuditCalls(Array(posix.snapshotCalls().dropFirst(before)))
            XCTAssertEqual(try fileManager.contentsOfDirectory(atPath: root.path).sorted(), entriesBefore)
            var afterStat = stat()
            XCTAssertEqual(Darwin.lstat(lock.path, &afterStat), 0)
            XCTAssertEqual(UInt64(beforeStat.st_dev), UInt64(afterStat.st_dev), "fixture=\(fixture)")
            XCTAssertEqual(UInt64(beforeStat.st_ino), UInt64(afterStat.st_ino), "fixture=\(fixture)")
        }
    }

    func testReadOnlyAuditRejectsFIFOCanonicalLockPromptlyWithoutMutation() throws {
        let childMarker = "ASSET_TRACKER_FIFO_LOCK_CHILD"
        let childRootKey = "ASSET_TRACKER_FIFO_LOCK_ROOT"
        let lockName = ".AssetTracker.storage.lock"

        if ProcessInfo.processInfo.environment[childMarker] == "1" {
            let rootPath = try XCTUnwrap(ProcessInfo.processInfo.environment[childRootKey])
            let root = URL(fileURLWithPath: rootPath, isDirectory: true)
            let lock = root.appendingPathComponent(lockName)
            var beforeStat = stat()
            XCTAssertEqual(Darwin.lstat(lock.path, &beforeStat), 0)
            XCTAssertEqual(beforeStat.st_mode & mode_t(S_IFMT), mode_t(S_IFIFO))
            let posix = RecordingNativePOSIX()
            let writer = NativeDurableFileWriter(
                rootURL: root,
                posix: posix,
                faultHandler: { _ in }
            )

            let before = posix.snapshotCalls().count
            XCTAssertThrowsError(try writer.withReadOnlyAudit { _ in true })
            let calls = Array(posix.snapshotCalls().dropFirst(before))
            let lockOpen = try XCTUnwrap(
                calls.first { $0.hasPrefix("openAt:\(lockName):") }
            )
            let flags = try XCTUnwrap(Int32(lockOpen.split(separator: ":").last ?? ""))
            XCTAssertNotEqual(flags & O_NONBLOCK, 0)
            assertZeroWriteAuditCalls(calls)

            var afterStat = stat()
            XCTAssertEqual(Darwin.lstat(lock.path, &afterStat), 0)
            XCTAssertEqual(afterStat.st_mode & mode_t(S_IFMT), mode_t(S_IFIFO))
            XCTAssertEqual(UInt64(beforeStat.st_dev), UInt64(afterStat.st_dev))
            XCTAssertEqual(UInt64(beforeStat.st_ino), UInt64(afterStat.st_ino))
            return
        }

        let (_, root) = try makeScratch("read-only-fifo-lock")
        let lock = root.appendingPathComponent(lockName)
        XCTAssertEqual(Darwin.mkfifo(lock.path, 0o600), 0)
        XCTAssertEqual(Darwin.chmod(lock.path, 0o600), 0)
        let entriesBefore = try fileManager.contentsOfDirectory(atPath: root.path).sorted()
        var beforeStat = stat()
        XCTAssertEqual(Darwin.lstat(lock.path, &beforeStat), 0)
        XCTAssertEqual(beforeStat.st_mode & mode_t(S_IFMT), mode_t(S_IFIFO))

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = [
            "xctest",
            "-XCTest",
            "NativeDurableFileWriterTests/testReadOnlyAuditRejectsFIFOCanonicalLockPromptlyWithoutMutation",
            Bundle(for: NativeDurableFileWriterTests.self).bundleURL.path,
        ]
        var environment = ProcessInfo.processInfo.environment
        environment[childMarker] = "1"
        environment[childRootKey] = root.path
        process.environment = environment
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        try process.run()

        let deadline = Date().addingTimeInterval(1)
        while process.isRunning, Date() < deadline {
            Darwin.usleep(10_000)
        }
        let timedOut = process.isRunning
        if timedOut {
            process.terminate()
            let terminationDeadline = Date().addingTimeInterval(0.5)
            while process.isRunning, Date() < terminationDeadline {
                Darwin.usleep(10_000)
            }
            if process.isRunning {
                _ = Darwin.kill(process.processIdentifier, SIGKILL)
            }
        }
        process.waitUntilExit()
        let childOutput = String(
            data: output.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? "<non-UTF8 child output>"

        XCTAssertFalse(timedOut, "read-only FIFO audit child hung:\n\(childOutput)")
        if !timedOut {
            XCTAssertEqual(
                process.terminationStatus,
                0,
                "read-only FIFO audit child failed:\n\(childOutput)"
            )
        }
        XCTAssertEqual(try fileManager.contentsOfDirectory(atPath: root.path).sorted(), entriesBefore)
        var afterStat = stat()
        XCTAssertEqual(Darwin.lstat(lock.path, &afterStat), 0)
        XCTAssertEqual(afterStat.st_mode & mode_t(S_IFMT), mode_t(S_IFIFO))
        XCTAssertEqual(UInt64(beforeStat.st_dev), UInt64(afterStat.st_dev))
        XCTAssertEqual(UInt64(beforeStat.st_ino), UInt64(afterStat.st_ino))
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
    private let wrongOwnerPath: String?
    private let afterMissingOpenAtPath: String?
    private let afterMissingOpenAtAction: (@Sendable () throws -> Void)?
    private let afterDirectoryEntriesPath: String?
    private let afterDirectoryEntriesOccurrence: Int
    private let afterDirectoryEntriesAction: (@Sendable () throws -> Void)?
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
    private var directoryEntriesMatchCount = 0
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
        afterSyncDirectoryAction: (@Sendable () throws -> Void)? = nil,
        wrongOwnerPath: String? = nil,
        afterMissingOpenAtPath: String? = nil,
        afterMissingOpenAtAction: (@Sendable () throws -> Void)? = nil,
        afterDirectoryEntriesPath: String? = nil,
        afterDirectoryEntriesOccurrence: Int = 1,
        afterDirectoryEntriesAction: (@Sendable () throws -> Void)? = nil
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
        self.wrongOwnerPath = wrongOwnerPath
        self.afterMissingOpenAtPath = afterMissingOpenAtPath
        self.afterMissingOpenAtAction = afterMissingOpenAtAction
        self.afterDirectoryEntriesPath = afterDirectoryEntriesPath
        self.afterDirectoryEntriesOccurrence = afterDirectoryEntriesOccurrence
        self.afterDirectoryEntriesAction = afterDirectoryEntriesAction
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
        let result: Int32
        do {
            result = try base.openAt(directoryFD: directoryFD, path: path, flags: flags, mode: mode)
        } catch let error as POSIXError where error.code == .ENOENT {
            if path == afterMissingOpenAtPath {
                try afterMissingOpenAtAction?()
            }
            throw error
        }
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
        var value = try base.fstat(fileFD: fileFD)
        if path(for: fileFD) == wrongOwnerPath {
            value.st_uid = value.st_uid &+ 1
        }
        return value
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
        var value = try base.fstatAt(directoryFD: directoryFD, path: path, noFollow: noFollow)
        if path == wrongOwnerPath {
            value.st_uid = value.st_uid &+ 1
        }
        return value
    }

    func directoryEntries(directoryFD: Int32) throws -> [NativeDirectoryEntry] {
        record("directoryEntries:\(directoryFD)")
        let entries = try base.directoryEntries(directoryFD: directoryFD)
        let currentPath = path(for: directoryFD)
        var action: (@Sendable () throws -> Void)?
        lock.lock()
        if currentPath == afterDirectoryEntriesPath {
            directoryEntriesMatchCount += 1
            if directoryEntriesMatchCount == afterDirectoryEntriesOccurrence {
                action = afterDirectoryEntriesAction
            }
        }
        lock.unlock()
        try action?()
        return entries
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
