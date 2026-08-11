import CryptoKit
import Darwin
import Foundation

@_silgen_name("flock")
private func nativeDarwinFlock(_ fileDescriptor: Int32, _ operation: Int32) -> Int32

@_silgen_name("mbr_uid_to_uuid")
private func nativeMbrUIDToUUID(_ userID: uid_t, _ uuid: UnsafeMutablePointer<UInt8>) -> Int32

public enum NativeDurabilityFaultPoint: String, CaseIterable, Sendable {
    case afterLockAcquired, afterSourceCAS, afterSourceRevalidation
    case afterTempCreate, afterExactWrite, afterFileFSync, afterFullFSync
    case beforeRename, afterRename, afterParentDirectoryFSync
    case afterFinalReread, afterHashVerified, beforeACK, afterDurableReceiptReturned
    case afterOrdinaryDirectoryDurable, afterEmptyOrdinaryIndexDurable
    case afterOrdinaryBlobsDirectoryDurable, afterOrdinaryBlobDurable
    case afterPreparedOrdinaryIndexDurable, afterPrimaryDurableBeforeACK
    case afterCommittedOrdinaryIndexDurable, afterSnapshotDirectoryDurable
    case afterEmptySnapshotIndexDurable, afterSnapshotBlobDurable
    case afterSnapshotIndexDurable
    case beforeRetentionUnlink, afterRetentionUnlink, afterRetentionDirectoryFSync
    case beforeRecoveryHealthClear, afterRecoveryHealthClear
}

public enum NativeDurabilityRole: String, Sendable {
    case lock, primary, bookStore, ordinaryDirectory, ordinaryBlob
    case ordinaryEmptyIndex, ordinaryPreparedIndex, ordinaryCommittedIndex
    case ordinaryHealthIndex, snapshotDirectory, snapshotBlob
    case snapshotEmptyIndex, snapshotFinalIndex, snapshotHealthIndex
    case coordinator, harness
}

public struct NativeDurabilityFaultEvent: Sendable {
    public let point: NativeDurabilityFaultPoint
    public let role: NativeDurabilityRole
    public let targetName: String

    public init(
        point: NativeDurabilityFaultPoint,
        role: NativeDurabilityRole,
        targetName: String
    ) {
        self.point = point
        self.role = role
        self.targetName = targetName
    }
}

public typealias NativeDurabilityFaultHandler =
    @Sendable (NativeDurabilityFaultEvent) throws -> Void

public enum NativeDurableWriteDisposition: Sendable {
    case replace
    case createOnly
}

public enum ExpectedBookSource: Equatable, Sendable {
    case missing
    case sha256(String)
}

public struct NativeDurableFileReceipt: Equatable, Sendable {
    public let sha256: String
    public let byteCount: Int
    public let device: UInt64
    public let inode: UInt64
    public let mode: UInt16

    init(sha256: String, byteCount: Int, stat: stat) {
        self.sha256 = sha256
        self.byteCount = byteCount
        self.device = UInt64(stat.st_dev)
        self.inode = UInt64(stat.st_ino)
        self.mode = UInt16(stat.st_mode & mode_t(0o7777))
    }
}

enum NativeDurableFileWriterError: Error, Equatable {
    case invalidRoot
    case invalidManagedPath
    case invalidRoleTarget
    case invalidMetadata
    case identityChanged
    case sourceChanged
    case sourceMissing
    case contentMismatch
    case leaseExpired
    case recursiveLock
    case zeroProgress
}

protocol NativePOSIX: Sendable {
    func effectiveUserID() -> uid_t
    func openAt(directoryFD: Int32, path: String, flags: Int32, mode: mode_t) throws -> Int32
    func makeDirectoryAt(directoryFD: Int32, path: String, mode: mode_t) throws
    func read(fileFD: Int32, bytes: UnsafeMutableRawBufferPointer) throws -> Int
    func write(fileFD: Int32, bytes: UnsafeRawBufferPointer) throws -> Int
    func flock(fileFD: Int32, operation: Int32) throws
    func fstat(fileFD: Int32) throws -> stat
    func syncFile(fileFD: Int32) throws
    func fullSyncFile(fileFD: Int32) throws
    func changeMode(fileFD: Int32, mode: mode_t) throws
    func renameAt(
        sourceDirectoryFD: Int32,
        source: String,
        destinationDirectoryFD: Int32,
        destination: String,
        exclusive: Bool
    ) throws
    func syncDirectory(directoryFD: Int32) throws
    func fstatAt(directoryFD: Int32, path: String, noFollow: Bool) throws -> stat
    func directoryEntries(directoryFD: Int32) throws -> [NativeDirectoryEntry]
    func extendedACLEntryCount(fileFD: Int32) throws -> Int
    func hasDangerousLegacyACL(fileFD: Int32, ownerUserID: uid_t) throws -> Bool
    func clearExtendedACL(fileFD: Int32) throws
    func unlinkAt(directoryFD: Int32, path: String) throws
    func close(fileFD: Int32)
}

struct NativeDirectoryEntry: Equatable, Sendable {
    let name: String
    let fileType: NativeDirectoryEntryType
}

enum NativeDirectoryEntryType: Equatable, Sendable {
    case regular, directory, symbolicLink, other
}

enum NativeOrdinaryIndexNamespaceState: Equatable, Sendable {
    case absent
    case indexless(validatedTempCount: Int)
    case indexed
}

enum NativeSnapshotIndexNamespaceState: Equatable, Sendable {
    case absent
    case indexless(validatedTempCount: Int)
    case indexed(validatedTempCount: Int)
}

struct NativeOrdinaryBlobNamespaceAudit: Equatable, Sendable {
    let blobNames: [String]
    let validatedTempCount: Int
}

enum NativeOrdinaryPendingIndexDecision: Equatable, Sendable {
    case unlinkPending
    case preserveReferenced
    case notPending
}

enum NativeOrdinaryPendingCleanupDisposition: Equatable, Sendable {
    case unlinked
    case alreadyAbsent
    case preservedReferenced
    case notPending
}

enum NativeOrdinaryPendingCleanupIOError: Error, Equatable {
    case unlinkFailed
    case directorySyncFailed
}

struct NativeManagedFileProof: Equatable, Sendable {
    let bytes: Data
    let sha256: String
    let byteCount: Int

    fileprivate let leaseID: UInt64
    fileprivate let relativePath: String
    fileprivate let role: NativeDurabilityRole
    fileprivate let device: UInt64
    fileprivate let inode: UInt64

    fileprivate init(
        bytes: Data,
        leaseID: UInt64,
        relativePath: String,
        role: NativeDurabilityRole,
        device: UInt64,
        inode: UInt64
    ) {
        self.bytes = bytes
        self.sha256 = sha256Hex(bytes)
        self.byteCount = bytes.count
        self.leaseID = leaseID
        self.relativePath = relativePath
        self.role = role
        self.device = device
        self.inode = inode
    }
}

struct NativeOrdinaryPendingCleanupResult: Equatable, Sendable {
    let disposition: NativeOrdinaryPendingCleanupDisposition
    let latestIndexProof: NativeManagedFileProof
}

enum NativeSnapshotPendingIndexDecision: Equatable, Sendable {
    case unlinkPending
    case preserveReferenced
    case notPending
}

enum NativeSnapshotPendingCleanupDisposition: Equatable, Sendable {
    case unlinked
    case alreadyAbsent
    case preservedReferenced
    case notPending
}

enum NativeSnapshotPendingCleanupIOError: Error, Equatable {
    case unlinkFailed
    case directorySyncFailed
}

struct NativeSnapshotPendingCleanupResult: Equatable, Sendable {
    let disposition: NativeSnapshotPendingCleanupDisposition
    let latestIndexProof: NativeManagedFileProof
}

struct DarwinNativePOSIX: NativePOSIX {
    func effectiveUserID() -> uid_t {
        Darwin.geteuid()
    }

    func openAt(directoryFD: Int32, path: String, flags: Int32, mode: mode_t) throws -> Int32 {
        let result = Darwin.openat(directoryFD, path, flags, mode)
        guard result >= 0 else { throw currentPOSIXError() }
        return result
    }

    func makeDirectoryAt(directoryFD: Int32, path: String, mode: mode_t) throws {
        guard Darwin.mkdirat(directoryFD, path, mode) == 0 else { throw currentPOSIXError() }
    }

    func read(fileFD: Int32, bytes: UnsafeMutableRawBufferPointer) throws -> Int {
        let result = Darwin.read(fileFD, bytes.baseAddress, bytes.count)
        guard result >= 0 else { throw currentPOSIXError() }
        return result
    }

    func write(fileFD: Int32, bytes: UnsafeRawBufferPointer) throws -> Int {
        let result = Darwin.write(fileFD, bytes.baseAddress, bytes.count)
        guard result >= 0 else { throw currentPOSIXError() }
        return result
    }

    func flock(fileFD: Int32, operation: Int32) throws {
        while nativeDarwinFlock(fileFD, operation) != 0 {
            if errno == EINTR { continue }
            throw currentPOSIXError()
        }
    }

    func fstat(fileFD: Int32) throws -> stat {
        var value = stat()
        guard Darwin.fstat(fileFD, &value) == 0 else { throw currentPOSIXError() }
        return value
    }

    func syncFile(fileFD: Int32) throws {
        while Darwin.fsync(fileFD) != 0 {
            if errno == EINTR { continue }
            throw currentPOSIXError()
        }
    }

    func fullSyncFile(fileFD: Int32) throws {
        while Darwin.fcntl(fileFD, F_FULLFSYNC) != 0 {
            if errno == EINTR { continue }
            throw currentPOSIXError()
        }
    }

    func changeMode(fileFD: Int32, mode: mode_t) throws {
        guard Darwin.fchmod(fileFD, mode) == 0 else { throw currentPOSIXError() }
    }

    func renameAt(
        sourceDirectoryFD: Int32,
        source: String,
        destinationDirectoryFD: Int32,
        destination: String,
        exclusive: Bool
    ) throws {
        let result: Int32
        if exclusive {
            result = Darwin.renameatx_np(
                sourceDirectoryFD,
                source,
                destinationDirectoryFD,
                destination,
                UInt32(RENAME_EXCL | RENAME_NOFOLLOW_ANY)
            )
        } else {
            result = Darwin.renameat(
                sourceDirectoryFD,
                source,
                destinationDirectoryFD,
                destination
            )
        }
        guard result == 0 else { throw currentPOSIXError() }
    }

    func syncDirectory(directoryFD: Int32) throws {
        try syncFile(fileFD: directoryFD)
    }

    func fstatAt(directoryFD: Int32, path: String, noFollow: Bool) throws -> stat {
        var value = stat()
        let flags = noFollow ? AT_SYMLINK_NOFOLLOW : 0
        guard Darwin.fstatat(directoryFD, path, &value, flags) == 0 else {
            throw currentPOSIXError()
        }
        return value
    }

    func directoryEntries(directoryFD: Int32) throws -> [NativeDirectoryEntry] {
        let enumerationFD = Darwin.openat(
            directoryFD,
            ".",
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard enumerationFD >= 0 else { throw currentPOSIXError() }
        guard let directory = Darwin.fdopendir(enumerationFD) else {
            Darwin.close(enumerationFD)
            throw currentPOSIXError()
        }
        defer { Darwin.closedir(directory) }

        var entries: [NativeDirectoryEntry] = []
        errno = 0
        while let pointer = Darwin.readdir(directory) {
            let name = withUnsafePointer(to: &pointer.pointee.d_name) { namePointer in
                namePointer.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) {
                    String(cString: $0)
                }
            }
            guard name != ".", name != ".." else { continue }
            let type: NativeDirectoryEntryType
            switch Int32(pointer.pointee.d_type) {
            case DT_REG: type = .regular
            case DT_DIR: type = .directory
            case DT_LNK: type = .symbolicLink
            default: type = .other
            }
            entries.append(NativeDirectoryEntry(name: name, fileType: type))
            errno = 0
        }
        guard errno == 0 else { throw currentPOSIXError() }
        return entries.sorted { $0.name < $1.name }
    }

    func extendedACLEntryCount(fileFD: Int32) throws -> Int {
        errno = 0
        guard let acl = Darwin.acl_get_fd_np(fileFD, ACL_TYPE_EXTENDED) else {
            if errno == ENOENT { return 0 }
            throw currentPOSIXError()
        }
        defer { Darwin.acl_free(UnsafeMutableRawPointer(acl)) }

        var count = 0
        var entry: acl_entry_t?
        var selector = Int32(ACL_FIRST_ENTRY.rawValue)
        while Darwin.acl_get_entry(acl, selector, &entry) == 0 {
            count += 1
            selector = Int32(ACL_NEXT_ENTRY.rawValue)
        }
        return count
    }

    func hasDangerousLegacyACL(fileFD: Int32, ownerUserID: uid_t) throws -> Bool {
        errno = 0
        guard let acl = Darwin.acl_get_fd_np(fileFD, ACL_TYPE_EXTENDED) else {
            if errno == ENOENT { return false }
            throw currentPOSIXError()
        }
        defer { Darwin.acl_free(UnsafeMutableRawPointer(acl)) }

        var ownerUUID = [UInt8](repeating: 0, count: 16)
        let membershipResult = ownerUUID.withUnsafeMutableBufferPointer { buffer in
            nativeMbrUIDToUUID(ownerUserID, buffer.baseAddress!)
        }
        guard membershipResult == 0 else { throw POSIXError(.EINVAL) }

        let dangerousPermissions: [acl_perm_t] = [
            ACL_WRITE_DATA, ACL_APPEND_DATA, ACL_DELETE, ACL_DELETE_CHILD,
            ACL_WRITE_ATTRIBUTES, ACL_WRITE_EXTATTRIBUTES, ACL_WRITE_SECURITY,
            ACL_CHANGE_OWNER,
        ]

        var entry: acl_entry_t?
        var selector = Int32(ACL_FIRST_ENTRY.rawValue)
        while Darwin.acl_get_entry(acl, selector, &entry) == 0 {
            guard let entry else { throw POSIXError(.EINVAL) }
            selector = Int32(ACL_NEXT_ENTRY.rawValue)
            var tag = ACL_UNDEFINED_TAG
            guard Darwin.acl_get_tag_type(entry, &tag) == 0 else { throw currentPOSIXError() }
            if tag == ACL_EXTENDED_DENY { continue }
            guard tag == ACL_EXTENDED_ALLOW else { throw POSIXError(.EINVAL) }

            var permissionSet: acl_permset_t?
            guard Darwin.acl_get_permset(entry, &permissionSet) == 0,
                  let permissionSet
            else {
                throw currentPOSIXError()
            }
            var grantsDangerousPermission = false
            for permission in dangerousPermissions {
                let result = Darwin.acl_get_perm_np(permissionSet, permission)
                guard result >= 0 else { throw currentPOSIXError() }
                if result == 1 { grantsDangerousPermission = true }
            }
            guard grantsDangerousPermission else { continue }

            guard let qualifier = Darwin.acl_get_qualifier(entry) else {
                throw currentPOSIXError()
            }
            defer { Darwin.acl_free(qualifier) }
            let qualifierBytes = qualifier.assumingMemoryBound(to: UInt8.self)
            let belongsToOwner = ownerUUID.indices.allSatisfy { qualifierBytes[$0] == ownerUUID[$0] }
            if !belongsToOwner { return true }
        }
        return false
    }

    func clearExtendedACL(fileFD: Int32) throws {
        guard let emptyACL = Darwin.acl_init(0) else { throw currentPOSIXError() }
        defer { Darwin.acl_free(UnsafeMutableRawPointer(emptyACL)) }
        guard Darwin.acl_set_fd_np(fileFD, emptyACL, ACL_TYPE_EXTENDED) == 0 else {
            throw currentPOSIXError()
        }
    }

    func unlinkAt(directoryFD: Int32, path: String) throws {
        guard Darwin.unlinkat(directoryFD, path, 0) == 0 else { throw currentPOSIXError() }
    }

    func close(fileFD: Int32) {
        _ = Darwin.close(fileFD)
    }
}

private func currentPOSIXError() -> POSIXError {
    POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
}

private func isMissingPOSIXError(_ error: Error) -> Bool {
    (error as? POSIXError)?.code == .ENOENT
}

private func isAlreadyExistsPOSIXError(_ error: Error) -> Bool {
    (error as? POSIXError)?.code == .EEXIST
}

private struct NativeFileIdentity: Equatable, Sendable {
    let device: UInt64
    let inode: UInt64

    init(_ value: stat) {
        device = UInt64(value.st_dev)
        inode = UInt64(value.st_ino)
    }
}

private final class NativeMutationLease: @unchecked Sendable {
    let id: UInt64
    private let lock = NSLock()
    private var active = true

    init(id: UInt64) {
        self.id = id
    }

    func requireActive() throws {
        lock.lock()
        defer { lock.unlock() }
        guard active else { throw NativeDurableFileWriterError.leaseExpired }
    }

    func invalidate() {
        lock.lock()
        active = false
        lock.unlock()
    }
}

struct NativeSourceProof: Sendable {
    fileprivate let leaseID: UInt64
    fileprivate let targetName: String
    fileprivate let expectedSource: ExpectedBookSource
    fileprivate let device: UInt64?
    fileprivate let inode: UInt64?
    fileprivate let byteCount: Int?
}

final class NativeDurableFileWriter: @unchecked Sendable {
    private struct RootRegistryKey: Hashable {
        let device: UInt64
        let inode: UInt64
    }

    private static let lockName = ".AssetTracker.storage.lock"
    private static let lockTempPrefix = ".AssetTracker.lock.tmp."
    private static let rootRegistryLock = NSLock()
    nonisolated(unsafe) private static var activeRootThreads: [RootRegistryKey: Set<UInt64>] = [:]

    private let rootURL: URL
    private let posix: any NativePOSIX
    private let faultHandler: NativeDurabilityFaultHandler
    private let recursionStateLock = NSLock()
    private var activeThreadID: UInt64?

    init(
        rootURL: URL,
        faultHandler: @escaping NativeDurabilityFaultHandler = { _ in }
    ) {
        self.rootURL = rootURL.standardizedFileURL
        self.posix = DarwinNativePOSIX()
        self.faultHandler = faultHandler
    }

    init(
        rootURL: URL,
        posix: any NativePOSIX,
        faultHandler: @escaping NativeDurabilityFaultHandler
    ) {
        self.rootURL = rootURL.standardizedFileURL
        self.posix = posix
        self.faultHandler = faultHandler
    }

    func withReadOnlyAudit<T>(
        _ body: (NativeReadOnlyBookDirectory) throws -> T
    ) throws -> T? {
        let threadID = currentThreadID()
        try rejectRecursiveAcquisition(threadID: threadID)

        let rootName = rootURL.lastPathComponent
        guard isSinglePathComponent(rootName) else {
            throw NativeDurableFileWriterError.invalidRoot
        }
        let parentPath = rootURL.deletingLastPathComponent().path
        let directoryFlags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        let parentFD = try posix.openAt(
            directoryFD: AT_FDCWD,
            path: parentPath,
            flags: directoryFlags,
            mode: 0
        )
        defer { posix.close(fileFD: parentFD) }
        let parentIdentity = NativeFileIdentity(try posix.fstat(fileFD: parentFD))
        try validateExternalDirectoryBinding(
            fileFD: parentFD,
            path: parentPath,
            expectedIdentity: parentIdentity
        )

        let namedRoot: stat
        do {
            namedRoot = try posix.fstatAt(
                directoryFD: parentFD,
                path: rootName,
                noFollow: true
            )
        } catch where isMissingPOSIXError(error) {
            try validateExternalDirectoryBinding(
                fileFD: parentFD,
                path: parentPath,
                expectedIdentity: parentIdentity
            )
            do {
                _ = try posix.fstatAt(
                    directoryFD: parentFD,
                    path: rootName,
                    noFollow: true
                )
                throw NativeDurableFileWriterError.identityChanged
            } catch where isMissingPOSIXError(error) {
                try validateExternalDirectoryBinding(
                    fileFD: parentFD,
                    path: parentPath,
                    expectedIdentity: parentIdentity
                )
                return nil
            }
        }

        let rootFD = try posix.openAt(
            directoryFD: parentFD,
            path: rootName,
            flags: directoryFlags,
            mode: 0
        )
        defer { posix.close(fileFD: rootFD) }
        let rootStat = try posix.fstat(fileFD: rootFD)
        let rootIdentity = NativeFileIdentity(rootStat)
        guard rootIdentity == NativeFileIdentity(namedRoot) else {
            throw NativeDurableFileWriterError.identityChanged
        }
        try admitRootBeforeLock(rootFD: rootFD, parentFD: parentFD, rootName: rootName)

        let firstLock = try statIfPresent(directoryFD: rootFD, leaf: Self.lockName)
        let firstRecovery = try statIfPresent(directoryFD: rootFD, leaf: "Recovery")
        try validateReadOnlyRootBinding(
            parentFD: parentFD,
            rootFD: rootFD,
            rootName: rootName,
            expectedIdentity: rootIdentity,
            strict: firstLock != nil || firstRecovery != nil
        )
        let secondLock = try statIfPresent(directoryFD: rootFD, leaf: Self.lockName)
        let secondRecovery = try statIfPresent(directoryFD: rootFD, leaf: "Recovery")
        guard sameOptionalIdentity(firstLock, secondLock),
              sameOptionalIdentity(firstRecovery, secondRecovery)
        else {
            throw NativeDurableFileWriterError.identityChanged
        }

        let rootRegistryKey = RootRegistryKey(
            device: rootIdentity.device,
            inode: rootIdentity.inode
        )
        try registerRootAcquisition(rootRegistryKey, threadID: threadID)
        defer { unregisterRootAcquisition(rootRegistryKey, threadID: threadID) }

        var recoveryFD: Int32?
        var recoveryIdentity: NativeFileIdentity?
        if let recoveryStat = firstRecovery {
            let openedRecovery = try posix.openAt(
                directoryFD: rootFD,
                path: "Recovery",
                flags: directoryFlags,
                mode: 0
            )
            do {
                let identity = NativeFileIdentity(recoveryStat)
                try validateReadOnlyManagedDirectory(
                    fileFD: openedRecovery,
                    parentDirectoryFD: rootFD,
                    leaf: "Recovery",
                    expectedIdentity: identity
                )
                recoveryFD = openedRecovery
                recoveryIdentity = identity
            } catch {
                posix.close(fileFD: openedRecovery)
                throw error
            }
        }
        defer {
            if let recoveryFD { posix.close(fileFD: recoveryFD) }
        }

        var lockFD: Int32?
        var lockIdentity: NativeFileIdentity?
        if let lockStat = firstLock {
            let openedLock = try posix.openAt(
                directoryFD: rootFD,
                path: Self.lockName,
                flags: O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC,
                mode: 0
            )
            do {
                try posix.flock(fileFD: openedLock, operation: LOCK_SH)
                try validateManagedFile(fileFD: openedLock, expectedModes: [0o600])
                let identity = NativeFileIdentity(lockStat)
                try validateCanonicalRootAndLock(
                    parentFD: parentFD,
                    rootFD: rootFD,
                    rootName: rootName,
                    rootIdentity: rootIdentity,
                    lockFD: openedLock,
                    lockIdentity: identity
                )
                lockFD = openedLock
                lockIdentity = identity
            } catch {
                try? posix.flock(fileFD: openedLock, operation: LOCK_UN)
                posix.close(fileFD: openedLock)
                throw error
            }
        }
        defer {
            if let lockFD {
                try? posix.flock(fileFD: lockFD, operation: LOCK_UN)
                posix.close(fileFD: lockFD)
            }
        }

        markActive(threadID: threadID)
        defer { clearActive(threadID: threadID) }
        let lease = NativeMutationLease(id: UInt64.random(in: 1 ... UInt64.max))
        defer { lease.invalidate() }
        let core = NativeLockedBookDirectory(
            posix: posix,
            faultHandler: faultHandler,
            lease: lease,
            effectiveUserID: posix.effectiveUserID(),
            parentFD: parentFD,
            rootFD: rootFD,
            rootName: rootName,
            rootIdentity: rootIdentity,
            lockFD: lockFD,
            lockName: Self.lockName,
            lockIdentity: lockIdentity,
            allowedRootModes: firstLock == nil && firstRecovery == nil ? [0o700, 0o755] : [0o700],
            requiresZeroRootACL: firstLock != nil || firstRecovery != nil,
            requiredAbsentRootNames: firstRecovery == nil ? ["Recovery"] : []
        )
        let readOnly = NativeReadOnlyBookDirectory(core: core)
        try core.revalidateCanonicalIdentity()
        let result = try body(readOnly)
        try core.revalidateCanonicalIdentity()
        if let recoveryFD, let recoveryIdentity {
            try validateReadOnlyManagedDirectory(
                fileFD: recoveryFD,
                parentDirectoryFD: rootFD,
                leaf: "Recovery",
                expectedIdentity: recoveryIdentity
            )
        }
        try validateExternalDirectoryBinding(
            fileFD: parentFD,
            path: parentPath,
            expectedIdentity: parentIdentity
        )
        return result
    }

    func withExclusiveMutationLock<T>(
        _ body: (NativeLockedBookDirectory) throws -> T
    ) throws -> T {
        let threadID = currentThreadID()
        try rejectRecursiveAcquisition(threadID: threadID)

        let rootName = rootURL.lastPathComponent
        guard isSinglePathComponent(rootName) else {
            throw NativeDurableFileWriterError.invalidRoot
        }
        let parentPath = rootURL.deletingLastPathComponent().path
        let directoryFlags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        let parentFD = try posix.openAt(
            directoryFD: AT_FDCWD,
            path: parentPath,
            flags: directoryFlags,
            mode: 0
        )
        defer { posix.close(fileFD: parentFD) }

        let rootWasCreated: Bool
        let rootIsNewlyObserved: Bool
        do {
            _ = try posix.fstatAt(directoryFD: parentFD, path: rootName, noFollow: true)
            rootWasCreated = false
            rootIsNewlyObserved = false
        } catch where isMissingPOSIXError(error) {
            do {
                try posix.makeDirectoryAt(directoryFD: parentFD, path: rootName, mode: 0o700)
                rootWasCreated = true
                rootIsNewlyObserved = true
            } catch where isAlreadyExistsPOSIXError(error) {
                rootWasCreated = false
                rootIsNewlyObserved = true
            }
        }

        let rootFD = try posix.openAt(
            directoryFD: parentFD,
            path: rootName,
            flags: directoryFlags,
            mode: 0
        )
        defer { posix.close(fileFD: rootFD) }
        if rootWasCreated {
            try posix.changeMode(fileFD: rootFD, mode: 0o700)
        }
        try admitRootBeforeLock(rootFD: rootFD, parentFD: parentFD, rootName: rootName)
        if rootIsNewlyObserved {
            try posix.syncDirectory(directoryFD: rootFD)
            try posix.syncDirectory(directoryFD: parentFD)
        }
        let rootIdentity = NativeFileIdentity(try posix.fstat(fileFD: rootFD))
        let rootRegistryKey = RootRegistryKey(
            device: rootIdentity.device,
            inode: rootIdentity.inode
        )
        try registerRootAcquisition(rootRegistryKey, threadID: threadID)
        defer { unregisterRootAcquisition(rootRegistryKey, threadID: threadID) }

        try ensureCanonicalLockExists(rootFD: rootFD)
        let lockFD = try posix.openAt(
            directoryFD: rootFD,
            path: Self.lockName,
            flags: O_RDWR | O_NOFOLLOW | O_CLOEXEC,
            mode: 0
        )
        defer { posix.close(fileFD: lockFD) }
        try posix.flock(fileFD: lockFD, operation: LOCK_EX)
        defer { try? posix.flock(fileFD: lockFD, operation: LOCK_UN) }
        try validateManagedFile(fileFD: lockFD, expectedModes: [0o600])
        try posix.syncFile(fileFD: lockFD)
        try posix.fullSyncFile(fileFD: lockFD)
        try posix.syncDirectory(directoryFD: rootFD)
        let lockIdentity = NativeFileIdentity(try posix.fstat(fileFD: lockFD))
        try prepareRootAfterLock(rootFD: rootFD, parentFD: parentFD, rootName: rootName)
        try validateCanonicalRootAndLock(
            parentFD: parentFD,
            rootFD: rootFD,
            rootName: rootName,
            rootIdentity: rootIdentity,
            lockFD: lockFD,
            lockIdentity: lockIdentity
        )

        markActive(threadID: threadID)
        defer { clearActive(threadID: threadID) }
        let lease = NativeMutationLease(id: UInt64.random(in: 1 ... UInt64.max))
        defer { lease.invalidate() }
        let locked = NativeLockedBookDirectory(
            posix: posix,
            faultHandler: faultHandler,
            lease: lease,
            effectiveUserID: posix.effectiveUserID(),
            parentFD: parentFD,
            rootFD: rootFD,
            rootName: rootName,
            rootIdentity: rootIdentity,
            lockFD: lockFD,
            lockName: Self.lockName,
            lockIdentity: lockIdentity
        )
        try faultHandler(NativeDurabilityFaultEvent(
            point: .afterLockAcquired,
            role: .lock,
            targetName: Self.lockName
        ))
        let result = try body(locked)
        try locked.revalidateCanonicalIdentity()
        return result
    }

    private func statIfPresent(directoryFD: Int32, leaf: String) throws -> stat? {
        do {
            return try posix.fstatAt(directoryFD: directoryFD, path: leaf, noFollow: true)
        } catch where isMissingPOSIXError(error) {
            return nil
        }
    }

    private func sameOptionalIdentity(_ lhs: stat?, _ rhs: stat?) -> Bool {
        switch (lhs, rhs) {
        case (.none, .none):
            return true
        case (.some(let lhs), .some(let rhs)):
            return NativeFileIdentity(lhs) == NativeFileIdentity(rhs)
        default:
            return false
        }
    }

    private func validateExternalDirectoryBinding(
        fileFD: Int32,
        path: String,
        expectedIdentity: NativeFileIdentity
    ) throws {
        let byFD = try posix.fstat(fileFD: fileFD)
        let byPath = try posix.fstatAt(directoryFD: AT_FDCWD, path: path, noFollow: true)
        guard NativeFileIdentity(byFD) == expectedIdentity,
              NativeFileIdentity(byPath) == expectedIdentity,
              isDirectory(byFD), byFD.st_nlink > 0
        else {
            throw NativeDurableFileWriterError.identityChanged
        }
    }

    private func validateReadOnlyRootBinding(
        parentFD: Int32,
        rootFD: Int32,
        rootName: String,
        expectedIdentity: NativeFileIdentity,
        strict: Bool
    ) throws {
        let byFD = try posix.fstat(fileFD: rootFD)
        let byName = try posix.fstatAt(directoryFD: parentFD, path: rootName, noFollow: true)
        guard NativeFileIdentity(byFD) == expectedIdentity,
              NativeFileIdentity(byName) == expectedIdentity,
              isDirectory(byFD), byFD.st_nlink > 0,
              byFD.st_uid == posix.effectiveUserID()
        else {
            throw NativeDurableFileWriterError.identityChanged
        }
        if strict {
            guard permissionBits(byFD) == 0o700,
                  try posix.extendedACLEntryCount(fileFD: rootFD) == 0
            else {
                throw NativeDurableFileWriterError.invalidMetadata
            }
        } else {
            guard [mode_t(0o700), mode_t(0o755)].contains(permissionBits(byFD)),
                  try !posix.hasDangerousLegacyACL(
                      fileFD: rootFD,
                      ownerUserID: posix.effectiveUserID()
                  )
            else {
                throw NativeDurableFileWriterError.invalidMetadata
            }
        }
    }

    private func validateReadOnlyManagedDirectory(
        fileFD: Int32,
        parentDirectoryFD: Int32,
        leaf: String,
        expectedIdentity: NativeFileIdentity
    ) throws {
        let byFD = try posix.fstat(fileFD: fileFD)
        let byName = try posix.fstatAt(
            directoryFD: parentDirectoryFD,
            path: leaf,
            noFollow: true
        )
        guard NativeFileIdentity(byFD) == expectedIdentity,
              NativeFileIdentity(byName) == expectedIdentity,
              isDirectory(byFD), byFD.st_nlink > 0,
              byFD.st_uid == posix.effectiveUserID(),
              permissionBits(byFD) == 0o700,
              try posix.extendedACLEntryCount(fileFD: fileFD) == 0
        else {
            throw NativeDurableFileWriterError.invalidMetadata
        }
    }

    private func rejectRecursiveAcquisition(threadID: UInt64) throws {
        recursionStateLock.lock()
        defer { recursionStateLock.unlock() }
        if activeThreadID == threadID {
            throw NativeDurableFileWriterError.recursiveLock
        }
    }

    private func registerRootAcquisition(
        _ key: RootRegistryKey,
        threadID: UInt64
    ) throws {
        Self.rootRegistryLock.lock()
        defer { Self.rootRegistryLock.unlock() }
        var threads = Self.activeRootThreads[key, default: []]
        guard !threads.contains(threadID) else {
            throw NativeDurableFileWriterError.recursiveLock
        }
        threads.insert(threadID)
        Self.activeRootThreads[key] = threads
    }

    private func unregisterRootAcquisition(_ key: RootRegistryKey, threadID: UInt64) {
        Self.rootRegistryLock.lock()
        defer { Self.rootRegistryLock.unlock() }
        guard var threads = Self.activeRootThreads[key] else { return }
        threads.remove(threadID)
        if threads.isEmpty {
            Self.activeRootThreads.removeValue(forKey: key)
        } else {
            Self.activeRootThreads[key] = threads
        }
    }

    private func markActive(threadID: UInt64) {
        recursionStateLock.lock()
        activeThreadID = threadID
        recursionStateLock.unlock()
    }

    private func clearActive(threadID: UInt64) {
        recursionStateLock.lock()
        if activeThreadID == threadID { activeThreadID = nil }
        recursionStateLock.unlock()
    }

    private func currentThreadID() -> UInt64 {
        var identifier: UInt64 = 0
        pthread_threadid_np(nil, &identifier)
        return identifier
    }

    private func admitRootBeforeLock(
        rootFD: Int32,
        parentFD: Int32,
        rootName: String
    ) throws {
        let rootStat = try posix.fstat(fileFD: rootFD)
        let entryStat = try posix.fstatAt(directoryFD: parentFD, path: rootName, noFollow: true)
        guard NativeFileIdentity(rootStat) == NativeFileIdentity(entryStat),
              isDirectory(rootStat), rootStat.st_nlink > 0,
              rootStat.st_uid == posix.effectiveUserID(),
              try !posix.hasDangerousLegacyACL(
                  fileFD: rootFD,
                  ownerUserID: posix.effectiveUserID()
              )
        else {
            throw NativeDurableFileWriterError.invalidMetadata
        }
        let mode = permissionBits(rootStat)
        guard mode == 0o700 || mode == 0o755 else {
            throw NativeDurableFileWriterError.invalidMetadata
        }
    }

    private func prepareRootAfterLock(rootFD: Int32, parentFD: Int32, rootName: String) throws {
        try posix.clearExtendedACL(fileFD: rootFD)
        try posix.changeMode(fileFD: rootFD, mode: 0o700)
        let byFD = try posix.fstat(fileFD: rootFD)
        let byName = try posix.fstatAt(directoryFD: parentFD, path: rootName, noFollow: true)
        guard NativeFileIdentity(byFD) == NativeFileIdentity(byName),
              isDirectory(byFD), byFD.st_nlink > 0,
              byFD.st_uid == posix.effectiveUserID(),
              permissionBits(byFD) == 0o700,
              try posix.extendedACLEntryCount(fileFD: rootFD) == 0
        else {
            throw NativeDurableFileWriterError.invalidMetadata
        }
        try posix.syncDirectory(directoryFD: rootFD)
        try posix.syncDirectory(directoryFD: parentFD)
    }

    private func admitLockBeforeModeChange(lockFD: Int32) throws {
        let value = try posix.fstat(fileFD: lockFD)
        guard isRegularFile(value), value.st_nlink == 1,
              value.st_uid == posix.effectiveUserID()
        else {
            throw NativeDurableFileWriterError.invalidMetadata
        }
    }

    private func ensureCanonicalLockExists(rootFD: Int32) throws {
        do {
            _ = try posix.fstatAt(directoryFD: rootFD, path: Self.lockName, noFollow: true)
            return
        } catch where isMissingPOSIXError(error) {
            // Publish a fully initialized private inode instead of exposing a half-built fixed lock.
        }

        let tempName = Self.lockTempPrefix + UUID().uuidString.lowercased()
        let tempFD = try posix.openAt(
            directoryFD: rootFD,
            path: tempName,
            flags: O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode: 0o600
        )
        defer { posix.close(fileFD: tempFD) }
        var published = false
        do {
            try admitLockBeforeModeChange(lockFD: tempFD)
            try posix.clearExtendedACL(fileFD: tempFD)
            try posix.changeMode(fileFD: tempFD, mode: 0o600)
            try validateManagedFile(fileFD: tempFD, expectedModes: [0o600])
            try posix.syncFile(fileFD: tempFD)
            try posix.fullSyncFile(fileFD: tempFD)
            do {
                try posix.renameAt(
                    sourceDirectoryFD: rootFD,
                    source: tempName,
                    destinationDirectoryFD: rootFD,
                    destination: Self.lockName,
                    exclusive: true
                )
                published = true
                try posix.syncDirectory(directoryFD: rootFD)
            } catch where isAlreadyExistsPOSIXError(error) {
                cleanupOwnedFileIfCanonical(
                    fileFD: tempFD,
                    parentDirectoryFD: rootFD,
                    leaf: tempName
                )
            }
        } catch {
            if !published {
                cleanupOwnedFileIfCanonical(
                    fileFD: tempFD,
                    parentDirectoryFD: rootFD,
                    leaf: tempName
                )
            }
            throw error
        }
    }

    private func validateManagedFile(fileFD: Int32, expectedModes: Set<mode_t>) throws {
        let value = try posix.fstat(fileFD: fileFD)
        guard isRegularFile(value), value.st_nlink == 1,
              value.st_uid == posix.effectiveUserID(),
              expectedModes.contains(permissionBits(value)),
              try posix.extendedACLEntryCount(fileFD: fileFD) == 0
        else {
            throw NativeDurableFileWriterError.invalidMetadata
        }
    }

    private func validateCanonicalRootAndLock(
        parentFD: Int32,
        rootFD: Int32,
        rootName: String,
        rootIdentity: NativeFileIdentity,
        lockFD: Int32,
        lockIdentity: NativeFileIdentity
    ) throws {
        let rootByFD = try posix.fstat(fileFD: rootFD)
        let rootByName = try posix.fstatAt(directoryFD: parentFD, path: rootName, noFollow: true)
        let lockByFD = try posix.fstat(fileFD: lockFD)
        let lockByName = try posix.fstatAt(directoryFD: rootFD, path: Self.lockName, noFollow: true)
        guard NativeFileIdentity(rootByFD) == rootIdentity,
              NativeFileIdentity(rootByName) == rootIdentity,
              isDirectory(rootByFD), rootByFD.st_nlink > 0,
              rootByFD.st_uid == posix.effectiveUserID(),
              permissionBits(rootByFD) == 0o700,
              try posix.extendedACLEntryCount(fileFD: rootFD) == 0,
              NativeFileIdentity(lockByFD) == lockIdentity,
              NativeFileIdentity(lockByName) == lockIdentity,
              isRegularFile(lockByFD), lockByFD.st_nlink == 1,
              lockByFD.st_uid == posix.effectiveUserID(),
              permissionBits(lockByFD) == 0o600,
              try posix.extendedACLEntryCount(fileFD: lockFD) == 0
        else {
            throw NativeDurableFileWriterError.identityChanged
        }
    }

    private func cleanupOwnedFileIfCanonical(
        fileFD: Int32,
        parentDirectoryFD: Int32,
        leaf: String
    ) {
        do {
            let byFD = try posix.fstat(fileFD: fileFD)
            let byName = try posix.fstatAt(
                directoryFD: parentDirectoryFD,
                path: leaf,
                noFollow: true
            )
            guard NativeFileIdentity(byFD) == NativeFileIdentity(byName),
                  isRegularFile(byFD), byFD.st_nlink == 1,
                  byFD.st_uid == posix.effectiveUserID()
            else {
                return
            }
            try posix.unlinkAt(directoryFD: parentDirectoryFD, path: leaf)
            try posix.syncDirectory(directoryFD: parentDirectoryFD)
        } catch {
            // Cleanup is best effort; never unlink a name that is no longer ours.
        }
    }
}

final class NativeLockedBookDirectory {
    private struct BoundDirectory {
        let fd: Int32
        let parentFD: Int32
        let name: String
        let identity: NativeFileIdentity
    }

    private let posix: any NativePOSIX
    private let faultHandler: NativeDurabilityFaultHandler
    private let lease: NativeMutationLease
    private let effectiveUserID: uid_t
    private let parentFD: Int32
    private let rootFD: Int32
    private let rootName: String
    private let rootIdentity: NativeFileIdentity
    private let lockFD: Int32?
    private let lockName: String
    private let lockIdentity: NativeFileIdentity?
    private let allowedRootModes: Set<mode_t>
    private let requiresZeroRootACL: Bool
    private let requiredAbsentRootNames: Set<String>

    fileprivate init(
        posix: any NativePOSIX,
        faultHandler: @escaping NativeDurabilityFaultHandler,
        lease: NativeMutationLease,
        effectiveUserID: uid_t,
        parentFD: Int32,
        rootFD: Int32,
        rootName: String,
        rootIdentity: NativeFileIdentity,
        lockFD: Int32?,
        lockName: String,
        lockIdentity: NativeFileIdentity?,
        allowedRootModes: Set<mode_t> = [0o700],
        requiresZeroRootACL: Bool = true,
        requiredAbsentRootNames: Set<String> = []
    ) {
        self.posix = posix
        self.faultHandler = faultHandler
        self.lease = lease
        self.effectiveUserID = effectiveUserID
        self.parentFD = parentFD
        self.rootFD = rootFD
        self.rootName = rootName
        self.rootIdentity = rootIdentity
        self.lockFD = lockFD
        self.lockName = lockName
        self.lockIdentity = lockIdentity
        self.allowedRootModes = allowedRootModes
        self.requiresZeroRootACL = requiresZeroRootACL
        self.requiredAbsentRootNames = requiredAbsentRootNames
    }

    func readValidated(relativePath: String) throws -> Data? {
        try lease.requireActive()
        let kind = try validateReadableFilePath(relativePath)
        let parts = try splitPath(relativePath)
        return try withBoundDirectory(components: Array(parts.dropLast())) { parent, bounds in
            let leaf = parts[parts.count - 1]
            let fd: Int32
            do {
                fd = try posix.openAt(
                    directoryFD: parent,
                    path: leaf,
                    flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
                    mode: 0
                )
            } catch where isMissingPOSIXError(error) {
                try proveCanonicalNameMissing(
                    parentDirectoryFD: parent,
                    leaf: leaf,
                    bounds: bounds
                )
                return nil
            }
            defer { posix.close(fileFD: fd) }
            try validateReadableFile(fileFD: fd, kind: kind)
            let openedIdentity = NativeFileIdentity(try posix.fstat(fileFD: fd))
            let data = try readAll(fileFD: fd)
            if case .blob(let expectedHash) = kind {
                guard sha256Hex(data) == expectedHash else {
                    throw NativeDurableFileWriterError.contentMismatch
                }
            }
            try validateReadableFile(fileFD: fd, kind: kind)
            try validateCanonicalLeaf(
                fileFD: fd,
                parentDirectoryFD: parent,
                leaf: leaf,
                expectedIdentity: openedIdentity
            )
            try revalidateCanonicalIdentity(bounds: bounds)
            return data
        }
    }

    func verifyPrimarySource(expectedSource: ExpectedBookSource) throws -> NativeSourceProof {
        try lease.requireActive()
        try validateHash(expectedSource)
        try revalidateCanonicalIdentity(bounds: [])
        switch expectedSource {
        case .missing:
            do {
                _ = try posix.fstatAt(directoryFD: rootFD, path: primaryName, noFollow: true)
                throw NativeDurableFileWriterError.sourceChanged
            } catch where isMissingPOSIXError(error) {
                try revalidateCanonicalIdentity(bounds: [])
                return NativeSourceProof(
                    leaseID: lease.id,
                    targetName: primaryName,
                    expectedSource: expectedSource,
                    device: nil,
                    inode: nil,
                    byteCount: nil
                )
            }
        case .sha256(let expectedHash):
            let result = try readPrimaryForProof()
            guard sha256Hex(result.data) == expectedHash else {
                throw NativeDurableFileWriterError.sourceChanged
            }
            try revalidateCanonicalIdentity(bounds: [])
            return NativeSourceProof(
                leaseID: lease.id,
                targetName: primaryName,
                expectedSource: expectedSource,
                device: UInt64(result.stat.st_dev),
                inode: UInt64(result.stat.st_ino),
                byteCount: result.data.count
            )
        }
    }

    func readManagedFileProof(
        relativePath: String,
        role: NativeDurabilityRole
    ) throws -> NativeManagedFileProof? {
        try lease.requireActive()
        guard (relativePath == ordinaryIndexPath && role == .ordinaryHealthIndex)
                || (relativePath == snapshotIndexPath && role == .snapshotHealthIndex)
        else {
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
        let parts = try splitPath(relativePath)
        return try withBoundDirectory(components: Array(parts.dropLast())) { parent, bounds in
            let leaf = parts[parts.count - 1]
            do {
                _ = try posix.fstatAt(directoryFD: parent, path: leaf, noFollow: true)
            } catch where isMissingPOSIXError(error) {
                try proveCanonicalNameMissing(
                    parentDirectoryFD: parent,
                    leaf: leaf,
                    bounds: bounds
                )
                return nil
            }
            let value = try readCanonicalManagedFile(
                parentDirectoryFD: parent,
                leaf: leaf,
                bounds: bounds
            )
            return makeManagedFileProof(
                bytes: value.data,
                relativePath: relativePath,
                role: role,
                identity: value.identity
            )
        }
    }

    func revalidate(_ proof: NativeManagedFileProof) throws {
        try validateManagedProof(proof)
        let parts = try splitPath(proof.relativePath)
        try withBoundDirectory(components: Array(parts.dropLast())) { parent, bounds in
            let leaf = parts[parts.count - 1]
            try withRevalidatedManagedProof(
                proof,
                parentDirectoryFD: parent,
                leaf: leaf,
                bounds: bounds
            ) {}
        }
    }

    func revalidatePrimarySource(_ proof: NativeSourceProof) throws {
        try revalidateSource(proof)
    }

    func durableReplacePrimary(
        _ bytes: Data,
        sourceProof: NativeSourceProof
    ) throws -> NativeDurableFileReceipt {
        try validateSourceProof(sourceProof)
        return try durableWriteInternal(
            bytes,
            relativePath: primaryName,
            disposition: .replace,
            role: .primary,
            sourceProof: sourceProof
        )
    }

    func durablyVerifyUnchangedPrimary(
        sourceProof: NativeSourceProof
    ) throws -> NativeDurableFileReceipt {
        try validateSourceProof(sourceProof)
        guard case .sha256(let expectedHash) = sourceProof.expectedSource else {
            throw NativeDurableFileWriterError.sourceMissing
        }
        try revalidateCanonicalIdentity(bounds: [])
        try revalidateSource(sourceProof)
        try emit(.afterSourceRevalidation, role: .primary, targetName: primaryName)

        let fileFD = try posix.openAt(
            directoryFD: rootFD,
            path: primaryName,
            flags: O_RDWR | O_NOFOLLOW | O_CLOEXEC,
            mode: 0
        )
        defer { posix.close(fileFD: fileFD) }
        try validateReadableFile(fileFD: fileFD, kind: .primary)
        try posix.syncFile(fileFD: fileFD)
        try emit(.afterFileFSync, role: .primary, targetName: primaryName)
        try posix.fullSyncFile(fileFD: fileFD)
        try emit(.afterFullFSync, role: .primary, targetName: primaryName)
        try revalidateCanonicalIdentity(bounds: [])
        try posix.syncDirectory(directoryFD: rootFD)
        try emit(.afterParentDirectoryFSync, role: .primary, targetName: primaryName)

        let result = try readPrimaryForProof()
        try emit(.afterFinalReread, role: .primary, targetName: primaryName)
        let actualHash = sha256Hex(result.data)
        guard actualHash == expectedHash,
              result.data.count == sourceProof.byteCount,
              UInt64(result.stat.st_dev) == sourceProof.device,
              UInt64(result.stat.st_ino) == sourceProof.inode
        else {
            throw NativeDurableFileWriterError.sourceChanged
        }
        try emit(.afterHashVerified, role: .primary, targetName: primaryName)
        try revalidateCanonicalIdentity(bounds: [])
        try revalidateSource(sourceProof)
        return NativeDurableFileReceipt(sha256: actualHash, byteCount: result.data.count, stat: result.stat)
    }

    func durableWrite(
        _ bytes: Data,
        relativePath: String,
        disposition: NativeDurableWriteDisposition,
        role: NativeDurabilityRole
    ) throws -> NativeDurableFileReceipt {
        try lease.requireActive()
        guard role != .ordinaryHealthIndex, role != .snapshotHealthIndex else {
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
        try validateWriteTarget(bytes: bytes, path: relativePath, disposition: disposition, role: role)
        return try durableWriteInternal(
            bytes,
            relativePath: relativePath,
            disposition: disposition,
            role: role,
            sourceProof: nil
        )
    }

    func durableWriteOrdinaryIndex(
        _ bytes: Data,
        role: NativeDurabilityRole
    ) throws -> NativeManagedFileProof {
        try lease.requireActive()
        guard role == .ordinaryEmptyIndex
                || role == .ordinaryPreparedIndex
                || role == .ordinaryCommittedIndex
        else {
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
        try validateWriteTarget(
            bytes: bytes,
            path: ordinaryIndexPath,
            disposition: .replace,
            role: role
        )
        let receipt = try durableWriteInternal(
            bytes,
            relativePath: ordinaryIndexPath,
            disposition: .replace,
            role: role,
            sourceProof: nil
        )
        let proof = NativeManagedFileProof(
            bytes: bytes,
            leaseID: lease.id,
            relativePath: ordinaryIndexPath,
            role: .ordinaryHealthIndex,
            device: receipt.device,
            inode: receipt.inode
        )
        try revalidate(proof)
        try revalidateCanonicalIdentity(bounds: [])
        return proof
    }

    func durableCreateSnapshotIndex(
        _ bytes: Data,
        sourceProof: NativeSourceProof
    ) throws -> NativeManagedFileProof {
        try lease.requireActive()
        try validateSourceProof(sourceProof)
        try revalidateSource(sourceProof)
        try validateWriteTarget(
            bytes: bytes,
            path: snapshotIndexPath,
            disposition: .createOnly,
            role: .snapshotEmptyIndex
        )
        let receipt = try durableWriteInternal(
            bytes,
            relativePath: snapshotIndexPath,
            disposition: .createOnly,
            role: .snapshotEmptyIndex,
            sourceProof: sourceProof,
            revalidateSourceAfterRename: true
        )
        let proof = NativeManagedFileProof(
            bytes: bytes,
            leaseID: lease.id,
            relativePath: snapshotIndexPath,
            role: .snapshotHealthIndex,
            device: receipt.device,
            inode: receipt.inode
        )
        try revalidate(proof)
        try revalidateSource(sourceProof)
        try revalidateCanonicalIdentity(bounds: [])
        return proof
    }

    func durableCompareAndSwapManaged(
        _ newBytes: Data,
        replacing expectedProof: NativeManagedFileProof,
        sourceProof: NativeSourceProof,
        role: NativeDurabilityRole
    ) throws -> NativeManagedFileProof {
        try lease.requireActive()
        let isOrdinary = role == .ordinaryHealthIndex
            && expectedProof.role == .ordinaryHealthIndex
            && expectedProof.relativePath == ordinaryIndexPath
        let isSnapshot = (role == .snapshotFinalIndex || role == .snapshotHealthIndex)
            && expectedProof.role == .snapshotHealthIndex
            && expectedProof.relativePath == snapshotIndexPath
        guard isOrdinary || isSnapshot
        else {
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
        try validateManagedProof(expectedProof)
        try validateSourceProof(sourceProof)
        try revalidate(expectedProof)
        try revalidateSource(sourceProof)
        try validateWriteTarget(
            bytes: newBytes,
            path: expectedProof.relativePath,
            disposition: .replace,
            role: role
        )

        let receipt = try durableWriteInternal(
            newBytes,
            relativePath: expectedProof.relativePath,
            disposition: .replace,
            role: role,
            sourceProof: sourceProof,
            expectedManagedProof: expectedProof,
            revalidateSourceAfterRename: true
        )
        let newProof = NativeManagedFileProof(
            bytes: newBytes,
            leaseID: lease.id,
            relativePath: expectedProof.relativePath,
            role: isSnapshot ? .snapshotHealthIndex : role,
            device: receipt.device,
            inode: receipt.inode
        )
        try revalidate(newProof)
        try revalidateSource(sourceProof)
        try revalidateCanonicalIdentity(bounds: [])
        return newProof
    }

    func durablySyncManagedDirectory(
        relativePath: String,
        role: NativeDurabilityRole
    ) throws {
        try lease.requireActive()
        guard isAllowedDirectorySync(path: relativePath, role: role) else {
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
        let parts = try splitPath(relativePath)
        try withBoundDirectory(components: parts) { directoryFD, bounds in
            try revalidateCanonicalIdentity(bounds: bounds)
            try posix.syncDirectory(directoryFD: directoryFD)
            try revalidateCanonicalIdentity(bounds: bounds)
        }
    }

    func createManagedDirectory(
        relativePath: String,
        role: NativeDurabilityRole
    ) throws {
        try lease.requireActive()
        guard isAllowedDirectoryCreation(path: relativePath, role: role) else {
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
        let parts = try splitPath(relativePath)
        let parentParts = Array(parts.dropLast())
        let leaf = parts[parts.count - 1]
        try withBoundDirectory(components: parentParts) { parent, bounds in
            let existingStat: stat?
            do {
                existingStat = try posix.fstatAt(
                    directoryFD: parent,
                    path: leaf,
                    noFollow: true
                )
            } catch where isMissingPOSIXError(error) {
                existingStat = nil
            }
            if let existingStat {
                let directoryFD = try posix.openAt(
                    directoryFD: parent,
                    path: leaf,
                    flags: O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC,
                    mode: 0
                )
                defer { posix.close(fileFD: directoryFD) }
                let identity = NativeFileIdentity(existingStat)
                try validateCanonicalManagedDirectory(
                    fileFD: directoryFD,
                    parentDirectoryFD: parent,
                    leaf: leaf,
                    expectedIdentity: identity
                )
                try revalidateCanonicalIdentity(bounds: bounds)
                try validateCanonicalManagedDirectory(
                    fileFD: directoryFD,
                    parentDirectoryFD: parent,
                    leaf: leaf,
                    expectedIdentity: identity
                )
                try posix.syncDirectory(directoryFD: directoryFD)
                try posix.syncDirectory(directoryFD: parent)
                try validateCanonicalManagedDirectory(
                    fileFD: directoryFD,
                    parentDirectoryFD: parent,
                    leaf: leaf,
                    expectedIdentity: identity
                )
                try revalidateCanonicalIdentity(bounds: bounds)
                try validateCanonicalManagedDirectory(
                    fileFD: directoryFD,
                    parentDirectoryFD: parent,
                    leaf: leaf,
                    expectedIdentity: identity
                )
                return
            }
            try posix.makeDirectoryAt(directoryFD: parent, path: leaf, mode: 0o700)
            let createdFD = try posix.openAt(
                directoryFD: parent,
                path: leaf,
                flags: O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC,
                mode: 0
            )
            defer { posix.close(fileFD: createdFD) }
            try posix.clearExtendedACL(fileFD: createdFD)
            try posix.changeMode(fileFD: createdFD, mode: 0o700)
            let createdStat = try posix.fstat(fileFD: createdFD)
            let identity = NativeFileIdentity(createdStat)
            try validateCanonicalManagedDirectory(
                fileFD: createdFD,
                parentDirectoryFD: parent,
                leaf: leaf,
                expectedIdentity: identity
            )
            try revalidateCanonicalIdentity(bounds: bounds)
            try validateCanonicalManagedDirectory(
                fileFD: createdFD,
                parentDirectoryFD: parent,
                leaf: leaf,
                expectedIdentity: identity
            )
            try posix.syncDirectory(directoryFD: createdFD)
            try posix.syncDirectory(directoryFD: parent)
            try validateCanonicalManagedDirectory(
                fileFD: createdFD,
                parentDirectoryFD: parent,
                leaf: leaf,
                expectedIdentity: identity
            )
            try revalidateCanonicalIdentity(bounds: bounds)
            try validateCanonicalManagedDirectory(
                fileFD: createdFD,
                parentDirectoryFD: parent,
                leaf: leaf,
                expectedIdentity: identity
            )
        }
    }

    func enumerate(relativePath: String) throws -> [NativeDirectoryEntry] {
        try lease.requireActive()
        guard isKnownManagedDirectory(relativePath) else {
            throw NativeDurableFileWriterError.invalidManagedPath
        }
        let parts = try splitPath(relativePath)
        return try withBoundDirectory(components: parts) { directoryFD, bounds in
            let entries = try posix.directoryEntries(directoryFD: directoryFD)
            try revalidateCanonicalIdentity(bounds: bounds)
            return entries
        }
    }

    func enumerateIfPresent(relativePath: String) throws -> [NativeDirectoryEntry]? {
        try lease.requireActive()
        guard isKnownManagedDirectory(relativePath) else {
            throw NativeDurableFileWriterError.invalidManagedPath
        }
        let parts = try splitPath(relativePath)
        return try withBoundDirectoryIfPresent(components: parts) { directoryFD, _ in
            try posix.directoryEntries(directoryFD: directoryFD)
        }
    }

    func auditOrdinaryIndexNamespace(
        expectedEmptyIndexBytes: Data
    ) throws -> NativeOrdinaryIndexNamespaceState {
        try lease.requireActive()
        let result: NativeOrdinaryIndexNamespaceState? = try withBoundDirectoryIfPresent(
            components: ["Recovery", "ordinary"]
        ) { directoryFD, bounds in
            let initialEntries = try posix.directoryEntries(directoryFD: directoryFD)
            guard Set(initialEntries.map(\.name)).count == initialEntries.count else {
                throw NativeDurableFileWriterError.identityChanged
            }

            let indexEntry = initialEntries.first { $0.name == "slots.json" }
            let indexProof: (data: Data, identity: NativeFileIdentity)?
            if let indexEntry {
                guard indexEntry.fileType == .regular else {
                    throw NativeDurableFileWriterError.invalidMetadata
                }
                indexProof = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: indexEntry.name,
                    bounds: bounds
                )
            } else {
                indexProof = nil
            }

            var blobsIdentity: NativeFileIdentity?
            var tempProofs: [String: (data: Data, identity: NativeFileIdentity)] = [:]
            for entry in initialEntries {
                if entry.name == "slots.json" { continue }
                if indexProof != nil, entry.name == "blobs" {
                    guard entry.fileType == .directory else {
                        throw NativeDurableFileWriterError.invalidMetadata
                    }
                    blobsIdentity = try readCanonicalManagedDirectory(
                        parentDirectoryFD: directoryFD,
                        leaf: entry.name,
                        bounds: bounds
                    )
                    continue
                }
                guard isCanonicalWriterTempName(entry.name),
                      entry.fileType == .regular
                else {
                    throw NativeDurableFileWriterError.invalidManagedPath
                }
                tempProofs[entry.name] = try withValidatedCrashTemp(
                    expectedPrefix: indexProof == nil ? expectedEmptyIndexBytes : nil,
                    parentDirectoryFD: directoryFD,
                    leaf: entry.name,
                    bounds: bounds
                ) { data, identity in
                    (data: data, identity: identity)
                }
            }

            for name in tempProofs.keys.sorted() {
                guard let expected = tempProofs[name] else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                let actual = try withValidatedCrashTemp(
                    expectedPrefix: indexProof == nil ? expectedEmptyIndexBytes : nil,
                    parentDirectoryFD: directoryFD,
                    leaf: name,
                    bounds: bounds
                ) { data, identity in
                    (data: data, identity: identity)
                }
                guard actual.identity == expected.identity else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                guard actual.data == expected.data else {
                    throw NativeDurableFileWriterError.contentMismatch
                }
            }

            if let indexProof {
                let finalIndex = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: "slots.json",
                    bounds: bounds
                )
                guard finalIndex.identity == indexProof.identity else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                guard finalIndex.data == indexProof.data else {
                    throw NativeDurableFileWriterError.contentMismatch
                }
            }
            if let blobsIdentity {
                let finalBlobsIdentity = try readCanonicalManagedDirectory(
                    parentDirectoryFD: directoryFD,
                    leaf: "blobs",
                    bounds: bounds
                )
                guard finalBlobsIdentity == blobsIdentity else {
                    throw NativeDurableFileWriterError.identityChanged
                }
            }
            guard try posix.directoryEntries(directoryFD: directoryFD) == initialEntries else {
                throw NativeDurableFileWriterError.identityChanged
            }

            if indexProof != nil { return NativeOrdinaryIndexNamespaceState.indexed }
            return .indexless(validatedTempCount: tempProofs.count)
        }
        return result ?? .absent
    }

    func auditOrdinaryBlobNamespace(
        expectedSourceBytes: Data?,
        sourceProof: NativeSourceProof
    ) throws -> NativeOrdinaryBlobNamespaceAudit {
        try validateExpectedSourceBytes(expectedSourceBytes, sourceProof: sourceProof)
        try revalidateSource(sourceProof)
        let result: NativeOrdinaryBlobNamespaceAudit? = try withBoundDirectoryIfPresent(
            components: ["Recovery", "ordinary", "blobs"]
        ) { directoryFD, bounds in
            let initialEntries = try posix.directoryEntries(directoryFD: directoryFD)
            guard Set(initialEntries.map(\.name)).count == initialEntries.count else {
                throw NativeDurableFileWriterError.identityChanged
            }
            var blobProofs: [String: (data: Data, identity: NativeFileIdentity)] = [:]
            var tempProofs: [String: (data: Data, identity: NativeFileIdentity)] = [:]

            for entry in initialEntries {
                if isCanonicalWriterTempName(entry.name) {
                    guard let expectedSourceBytes, entry.fileType == .regular else {
                        throw NativeDurableFileWriterError.invalidMetadata
                    }
                    tempProofs[entry.name] = try withValidatedCrashTemp(
                        expectedPrefix: expectedSourceBytes,
                        parentDirectoryFD: directoryFD,
                        leaf: entry.name,
                        bounds: bounds
                    ) { data, identity in
                        (data: data, identity: identity)
                    }
                    continue
                }
                guard !entry.name.hasPrefix(writerTempPrefix),
                      ordinaryBlobHash(fromLeaf: entry.name) != nil,
                      entry.fileType == .regular
                else {
                    throw NativeDurableFileWriterError.invalidManagedPath
                }
                blobProofs[entry.name] = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: entry.name,
                    bounds: bounds
                )
            }

            for name in tempProofs.keys.sorted() {
                guard let expected = tempProofs[name], let expectedSourceBytes else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                let actual = try withValidatedCrashTemp(
                    expectedPrefix: expectedSourceBytes,
                    parentDirectoryFD: directoryFD,
                    leaf: name,
                    bounds: bounds
                ) { data, identity in
                    (data: data, identity: identity)
                }
                guard actual.identity == expected.identity else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                guard actual.data == expected.data else {
                    throw NativeDurableFileWriterError.contentMismatch
                }
            }
            for name in blobProofs.keys.sorted() {
                guard let expected = blobProofs[name] else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                let actual = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: name,
                    bounds: bounds
                )
                guard actual.identity == expected.identity else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                guard actual.data == expected.data else {
                    throw NativeDurableFileWriterError.contentMismatch
                }
            }
            guard try posix.directoryEntries(directoryFD: directoryFD) == initialEntries else {
                throw NativeDurableFileWriterError.identityChanged
            }
            return NativeOrdinaryBlobNamespaceAudit(
                blobNames: blobProofs.keys.sorted(),
                validatedTempCount: tempProofs.count
            )
        }
        try revalidateSource(sourceProof)
        return result ?? NativeOrdinaryBlobNamespaceAudit(blobNames: [], validatedTempCount: 0)
    }

    func auditSnapshotIndexNamespace(
        expectedEmptyIndexBytes: Data
    ) throws -> NativeSnapshotIndexNamespaceState {
        try lease.requireActive()
        let result: NativeSnapshotIndexNamespaceState? = try withBoundDirectoryIfPresent(
            components: ["Recovery", "snapshots"]
        ) { directoryFD, bounds in
            let initialEntries = try posix.directoryEntries(directoryFD: directoryFD)
            guard Set(initialEntries.map(\.name)).count == initialEntries.count else {
                throw NativeDurableFileWriterError.identityChanged
            }

            let indexEntry = initialEntries.first { $0.name == "index.json" }
            let indexProof: (data: Data, identity: NativeFileIdentity)?
            if let indexEntry {
                guard indexEntry.fileType == .regular else {
                    throw NativeDurableFileWriterError.invalidMetadata
                }
                indexProof = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: indexEntry.name,
                    bounds: bounds
                )
            } else {
                indexProof = nil
            }

            var tempProofs: [String: (data: Data, identity: NativeFileIdentity)] = [:]
            var blobProofs: [String: (data: Data, identity: NativeFileIdentity)] = [:]
            for entry in initialEntries {
                if entry.name == "index.json" { continue }
                if isCanonicalWriterTempName(entry.name) {
                    guard entry.fileType == .regular else {
                        throw NativeDurableFileWriterError.invalidMetadata
                    }
                    tempProofs[entry.name] = try withValidatedCrashTemp(
                        expectedPrefix: indexProof == nil ? expectedEmptyIndexBytes : nil,
                        parentDirectoryFD: directoryFD,
                        leaf: entry.name,
                        bounds: bounds
                    ) { data, identity in
                        (data: data, identity: identity)
                    }
                    continue
                }
                guard indexProof != nil,
                      entry.fileType == .regular,
                      let hash = blobHash(
                        from: "Recovery/snapshots/\(entry.name)",
                        prefix: "Recovery/snapshots/"
                      )
                else {
                    throw NativeDurableFileWriterError.invalidManagedPath
                }
                let proof = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: entry.name,
                    bounds: bounds
                )
                guard sha256Hex(proof.data) == hash else {
                    throw NativeDurableFileWriterError.contentMismatch
                }
                blobProofs[entry.name] = proof
            }

            for name in tempProofs.keys.sorted() {
                guard let expected = tempProofs[name] else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                let actual = try withValidatedCrashTemp(
                    expectedPrefix: indexProof == nil ? expectedEmptyIndexBytes : nil,
                    parentDirectoryFD: directoryFD,
                    leaf: name,
                    bounds: bounds
                ) { data, identity in
                    (data: data, identity: identity)
                }
                guard actual.data == expected.data, actual.identity == expected.identity else {
                    throw NativeDurableFileWriterError.identityChanged
                }
            }
            for name in blobProofs.keys.sorted() {
                guard let expected = blobProofs[name] else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                let actual = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: name,
                    bounds: bounds
                )
                guard actual.data == expected.data, actual.identity == expected.identity else {
                    throw NativeDurableFileWriterError.identityChanged
                }
            }
            if let indexProof {
                let finalIndex = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: "index.json",
                    bounds: bounds
                )
                guard finalIndex.data == indexProof.data,
                      finalIndex.identity == indexProof.identity
                else {
                    throw NativeDurableFileWriterError.identityChanged
                }
            }
            guard try posix.directoryEntries(directoryFD: directoryFD) == initialEntries else {
                throw NativeDurableFileWriterError.identityChanged
            }
            if indexProof != nil {
                return .indexed(validatedTempCount: tempProofs.count)
            }
            return .indexless(validatedTempCount: tempProofs.count)
        }
        return result ?? .absent
    }

    func cleanupSnapshotIndexCrashTemps(expectedEmptyIndexBytes: Data) throws {
        try lease.requireActive()
        _ = try withBoundDirectoryIfPresent(
            components: ["Recovery", "snapshots"]
        ) { directoryFD, bounds in
            let entries = try posix.directoryEntries(directoryFD: directoryFD)
            let indexEntry = entries.first { $0.name == "index.json" }
            let canonicalIndex: (data: Data, identity: NativeFileIdentity)?
            if let indexEntry {
                guard indexEntry.fileType == .regular else {
                    throw NativeDurableFileWriterError.invalidMetadata
                }
                canonicalIndex = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: indexEntry.name,
                    bounds: bounds
                )
            } else {
                canonicalIndex = nil
            }
            var tempProofs: [String: (data: Data, identity: NativeFileIdentity)] = [:]
            for entry in entries {
                if entry.name == "index.json" { continue }
                if isCanonicalWriterTempName(entry.name) {
                    guard entry.fileType == .regular else {
                        throw NativeDurableFileWriterError.invalidMetadata
                    }
                    tempProofs[entry.name] = try withValidatedCrashTemp(
                        expectedPrefix: canonicalIndex == nil ? expectedEmptyIndexBytes : nil,
                        parentDirectoryFD: directoryFD,
                        leaf: entry.name,
                        bounds: bounds
                    ) { data, identity in
                        (data: data, identity: identity)
                    }
                    continue
                }
                guard canonicalIndex != nil,
                      entry.fileType == .regular,
                      blobHash(
                        from: "Recovery/snapshots/\(entry.name)",
                        prefix: "Recovery/snapshots/"
                      ) != nil
                else {
                    throw NativeDurableFileWriterError.invalidManagedPath
                }
            }

            try revalidateCanonicalIdentity(bounds: bounds)
            for name in tempProofs.keys.sorted() {
                guard let expected = tempProofs[name] else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                try withValidatedCrashTemp(
                    expectedPrefix: canonicalIndex == nil ? expectedEmptyIndexBytes : nil,
                    parentDirectoryFD: directoryFD,
                    leaf: name,
                    bounds: bounds
                ) { data, identity in
                    guard data == expected.data, identity == expected.identity else {
                        throw NativeDurableFileWriterError.identityChanged
                    }
                    try posix.unlinkAt(directoryFD: directoryFD, path: name)
                }
            }
            if !tempProofs.isEmpty {
                try posix.syncDirectory(directoryFD: directoryFD)
                for name in tempProofs.keys.sorted() {
                    try proveCanonicalNameMissing(
                        parentDirectoryFD: directoryFD,
                        leaf: name,
                        bounds: bounds
                    )
                }
            }
            if let canonicalIndex {
                let finalIndex = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: "index.json",
                    bounds: bounds
                )
                guard finalIndex.data == canonicalIndex.data,
                      finalIndex.identity == canonicalIndex.identity
                else {
                    throw NativeDurableFileWriterError.identityChanged
                }
            }
        }
    }

    func cleanupOrdinaryBlobCrashTemps(
        expectedSourceBytes: Data?,
        sourceProof: NativeSourceProof
    ) throws {
        try validateExpectedSourceBytes(expectedSourceBytes, sourceProof: sourceProof)
        try revalidateSource(sourceProof)
        _ = try withBoundDirectoryIfPresent(
            components: ["Recovery", "ordinary", "blobs"]
        ) { directoryFD, bounds in
            let entries = try posix.directoryEntries(directoryFD: directoryFD)
            var tempProofs: [String: (data: Data, identity: NativeFileIdentity)] = [:]
            for entry in entries {
                if isCanonicalWriterTempName(entry.name) {
                    guard let expectedSourceBytes, entry.fileType == .regular else {
                        throw NativeDurableFileWriterError.invalidMetadata
                    }
                    tempProofs[entry.name] = try withValidatedCrashTemp(
                        expectedPrefix: expectedSourceBytes,
                        parentDirectoryFD: directoryFD,
                        leaf: entry.name,
                        bounds: bounds
                    ) { data, identity in
                        (data: data, identity: identity)
                    }
                } else if entry.name.hasPrefix(writerTempPrefix) {
                    throw NativeDurableFileWriterError.invalidManagedPath
                }
            }

            try revalidateSource(sourceProof)
            for name in tempProofs.keys.sorted() {
                guard let expected = tempProofs[name], let expectedSourceBytes else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                try revalidateSource(sourceProof)
                try withValidatedCrashTemp(
                    expectedPrefix: expectedSourceBytes,
                    parentDirectoryFD: directoryFD,
                    leaf: name,
                    bounds: bounds
                ) { data, identity in
                    guard identity == expected.identity else {
                        throw NativeDurableFileWriterError.identityChanged
                    }
                    guard data == expected.data else {
                        throw NativeDurableFileWriterError.contentMismatch
                    }
                    try posix.unlinkAt(directoryFD: directoryFD, path: name)
                }
            }
            if !tempProofs.isEmpty {
                try posix.syncDirectory(directoryFD: directoryFD)
                for name in tempProofs.keys.sorted() {
                    try proveCanonicalNameMissing(
                        parentDirectoryFD: directoryFD,
                        leaf: name,
                        bounds: bounds
                    )
                }
            }
            try revalidateSource(sourceProof)
        }
        try revalidateSource(sourceProof)
    }

    func cleanupOrdinaryIndexCrashTemps(expectedEmptyIndexBytes: Data) throws {
        try lease.requireActive()
        let parts = ["Recovery", "ordinary"]
        _ = try withBoundDirectoryIfPresent(components: parts) { directoryFD, bounds in
            let entries = try posix.directoryEntries(directoryFD: directoryFD)
            let indexEntry = entries.first { $0.name == "slots.json" }
            let canonicalIndex: (data: Data, identity: NativeFileIdentity)?
            if let indexEntry {
                guard indexEntry.fileType == .regular else {
                    throw NativeDurableFileWriterError.invalidMetadata
                }
                canonicalIndex = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: indexEntry.name,
                    bounds: bounds
                )
            } else {
                canonicalIndex = nil
            }
            var tempNames: [String] = []

            for entry in entries {
                if entry.name == "slots.json" { continue }
                if canonicalIndex != nil,
                   entry.name == "blobs",
                   entry.fileType == .directory {
                    continue
                }
                guard isCanonicalWriterTempName(entry.name),
                      entry.fileType == .regular
                else {
                    throw NativeDurableFileWriterError.invalidManagedPath
                }
                try withValidatedCrashTemp(
                    expectedPrefix: canonicalIndex == nil ? expectedEmptyIndexBytes : nil,
                    parentDirectoryFD: directoryFD,
                    leaf: entry.name,
                    bounds: bounds
                ) { _, _ in }
                tempNames.append(entry.name)
            }

            try revalidateCanonicalIdentity(bounds: bounds)
            for name in tempNames {
                try withValidatedCrashTemp(
                    expectedPrefix: canonicalIndex == nil ? expectedEmptyIndexBytes : nil,
                    parentDirectoryFD: directoryFD,
                    leaf: name,
                    bounds: bounds
                ) { _, _ in
                    try posix.unlinkAt(directoryFD: directoryFD, path: name)
                }
            }

            if !tempNames.isEmpty {
                try posix.syncDirectory(directoryFD: directoryFD)
                for name in tempNames {
                    try proveCanonicalNameMissing(
                        parentDirectoryFD: directoryFD,
                        leaf: name,
                        bounds: bounds
                    )
                }
            }

            if let canonicalIndex {
                let finalIndex = try readCanonicalManagedFile(
                    parentDirectoryFD: directoryFD,
                    leaf: "slots.json",
                    bounds: bounds
                )
                guard finalIndex.identity == canonicalIndex.identity else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                guard finalIndex.data == canonicalIndex.data else {
                    throw NativeDurableFileWriterError.contentMismatch
                }
            }
        }
    }

    func unlinkOrdinaryPendingAndSync(
        relativePath: String,
        sourceProof: NativeSourceProof,
        authorizeLatestIndex: (NativeManagedFileProof) throws -> NativeOrdinaryPendingIndexDecision
    ) throws -> NativeOrdinaryPendingCleanupResult {
        try lease.requireActive()
        guard let expectedBlobHash = blobHash(
            from: relativePath,
            prefix: "Recovery/ordinary/blobs/"
        ) else {
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
        try validateSourceProof(sourceProof)
        try revalidateSource(sourceProof)

        let parts = try splitPath(relativePath)
        return try withBoundDirectory(components: Array(parts.dropLast())) { blobsFD, bounds in
            let leaf = parts[parts.count - 1]
            guard let ordinaryBound = bounds.first(where: { $0.name == "ordinary" }) else {
                throw NativeDurableFileWriterError.invalidManagedPath
            }

            let blobFD: Int32?
            let blobBytes: Data?
            let blobIdentity: NativeFileIdentity?
            do {
                let openedFD = try posix.openAt(
                    directoryFD: blobsFD,
                    path: leaf,
                    flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
                    mode: 0
                )
                do {
                    try validateManagedFile(fileFD: openedFD, expectedModes: [0o600])
                    let value = try posix.fstat(fileFD: openedFD)
                    let bytes = try readAll(fileFD: openedFD)
                    guard sha256Hex(bytes) == expectedBlobHash else {
                        throw NativeDurableFileWriterError.contentMismatch
                    }
                    try validateManagedFile(fileFD: openedFD, expectedModes: [0o600])
                    try validateCanonicalLeaf(
                        fileFD: openedFD,
                        parentDirectoryFD: blobsFD,
                        leaf: leaf,
                        expectedIdentity: NativeFileIdentity(value)
                    )
                    try revalidateCanonicalIdentity(bounds: bounds)
                    blobFD = openedFD
                    blobBytes = bytes
                    blobIdentity = NativeFileIdentity(value)
                } catch {
                    posix.close(fileFD: openedFD)
                    throw error
                }
            } catch where isMissingPOSIXError(error) {
                try proveCanonicalNameMissing(
                    parentDirectoryFD: blobsFD,
                    leaf: leaf,
                    bounds: bounds
                )
                blobFD = nil
                blobBytes = nil
                blobIdentity = nil
            }
            defer {
                if let blobFD { posix.close(fileFD: blobFD) }
            }

            let indexValue = try readCanonicalManagedFile(
                parentDirectoryFD: ordinaryBound.fd,
                leaf: "slots.json",
                bounds: bounds
            )
            let latestIndexProof = makeManagedFileProof(
                bytes: indexValue.data,
                relativePath: ordinaryIndexPath,
                role: .ordinaryHealthIndex,
                identity: indexValue.identity
            )
            let decision = try authorizeLatestIndex(latestIndexProof)

            func revalidateBlobOrAbsence() throws {
                guard let blobFD, let blobBytes, let blobIdentity else {
                    try proveCanonicalNameMissing(
                        parentDirectoryFD: blobsFD,
                        leaf: leaf,
                        bounds: bounds
                    )
                    return
                }
                let actual = try readCanonicalManagedFile(
                    parentDirectoryFD: blobsFD,
                    leaf: leaf,
                    bounds: bounds
                )
                guard actual.identity == blobIdentity else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                guard actual.data == blobBytes,
                      actual.data.count == blobBytes.count,
                      sha256Hex(actual.data) == expectedBlobHash
                else {
                    throw NativeDurableFileWriterError.contentMismatch
                }
                try validateManagedFile(fileFD: blobFD, expectedModes: [0o600])
                try validateCanonicalLeaf(
                    fileFD: blobFD,
                    parentDirectoryFD: blobsFD,
                    leaf: leaf,
                    expectedIdentity: blobIdentity
                )
            }

            func revalidateLatestIndex(
                perform body: () throws -> Void = {}
            ) throws {
                try withRevalidatedManagedProof(
                    latestIndexProof,
                    parentDirectoryFD: ordinaryBound.fd,
                    leaf: "slots.json",
                    bounds: bounds,
                    perform: body
                )
            }

            switch decision {
            case .preserveReferenced, .notPending:
                try revalidateBlobOrAbsence()
                try revalidateSource(sourceProof)
                try revalidateLatestIndex()
                try revalidateCanonicalIdentity(bounds: bounds)
                return NativeOrdinaryPendingCleanupResult(
                    disposition: decision == .preserveReferenced
                        ? .preservedReferenced
                        : .notPending,
                    latestIndexProof: latestIndexProof
                )

            case .unlinkPending:
                guard blobFD != nil else {
                    try proveCanonicalNameMissing(
                        parentDirectoryFD: blobsFD,
                        leaf: leaf,
                        bounds: bounds
                    )
                    try proveCanonicalNameMissing(
                        parentDirectoryFD: blobsFD,
                        leaf: leaf,
                        bounds: bounds
                    )
                    try revalidateSource(sourceProof)
                    try revalidateLatestIndex()
                    try revalidateCanonicalIdentity(bounds: bounds)
                    do {
                        try posix.syncDirectory(directoryFD: blobsFD)
                    } catch {
                        throw NativeOrdinaryPendingCleanupIOError.directorySyncFailed
                    }
                    try proveCanonicalNameMissing(
                        parentDirectoryFD: blobsFD,
                        leaf: leaf,
                        bounds: bounds
                    )
                    try revalidateSource(sourceProof)
                    try revalidateLatestIndex()
                    try revalidateCanonicalIdentity(bounds: bounds)
                    return NativeOrdinaryPendingCleanupResult(
                        disposition: .alreadyAbsent,
                        latestIndexProof: latestIndexProof
                    )
                }

                try revalidateBlobOrAbsence()
                try revalidateSource(sourceProof)
                try revalidateCanonicalIdentity(bounds: bounds)
                try revalidateLatestIndex {
                    do {
                        try posix.unlinkAt(directoryFD: blobsFD, path: leaf)
                    } catch {
                        throw NativeOrdinaryPendingCleanupIOError.unlinkFailed
                    }
                }
                do {
                    try posix.syncDirectory(directoryFD: blobsFD)
                } catch {
                    throw NativeOrdinaryPendingCleanupIOError.directorySyncFailed
                }

                try proveCanonicalNameMissing(
                    parentDirectoryFD: blobsFD,
                    leaf: leaf,
                    bounds: bounds
                )
                try proveCanonicalNameMissing(
                    parentDirectoryFD: blobsFD,
                    leaf: leaf,
                    bounds: bounds
                )
                try revalidateSource(sourceProof)
                try revalidateLatestIndex()
                try revalidateCanonicalIdentity(bounds: bounds)
                try proveCanonicalNameMissing(
                    parentDirectoryFD: blobsFD,
                    leaf: leaf,
                    bounds: bounds
                )
                try revalidateSource(sourceProof)
                try revalidateLatestIndex()
                try revalidateCanonicalIdentity(bounds: bounds)
                return NativeOrdinaryPendingCleanupResult(
                    disposition: .unlinked,
                    latestIndexProof: latestIndexProof
                )
            }
        }
    }

    func unlinkSnapshotPendingAndSync(relativePath: String) throws {
        try unlinkPending(relativePath: relativePath, snapshot: true)
    }

    func unlinkSnapshotPendingAndSync(
        relativePath: String,
        sourceProof: NativeSourceProof,
        authorizeLatestIndex: (NativeManagedFileProof) throws -> NativeSnapshotPendingIndexDecision
    ) throws -> NativeSnapshotPendingCleanupResult {
        try lease.requireActive()
        guard let expectedBlobHash = blobHash(
            from: relativePath,
            prefix: "Recovery/snapshots/"
        ) else {
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
        try validateSourceProof(sourceProof)
        try revalidateSource(sourceProof)

        let parts = try splitPath(relativePath)
        return try withBoundDirectory(components: Array(parts.dropLast())) { snapshotsFD, bounds in
            let leaf = parts[parts.count - 1]
            let blobFD: Int32?
            let blobBytes: Data?
            let blobIdentity: NativeFileIdentity?
            do {
                let openedFD = try posix.openAt(
                    directoryFD: snapshotsFD,
                    path: leaf,
                    flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
                    mode: 0
                )
                do {
                    try validateManagedFile(fileFD: openedFD, expectedModes: [0o600])
                    let value = try posix.fstat(fileFD: openedFD)
                    let bytes = try readAll(fileFD: openedFD)
                    guard sha256Hex(bytes) == expectedBlobHash else {
                        throw NativeDurableFileWriterError.contentMismatch
                    }
                    try validateManagedFile(fileFD: openedFD, expectedModes: [0o600])
                    try validateCanonicalLeaf(
                        fileFD: openedFD,
                        parentDirectoryFD: snapshotsFD,
                        leaf: leaf,
                        expectedIdentity: NativeFileIdentity(value)
                    )
                    try revalidateCanonicalIdentity(bounds: bounds)
                    blobFD = openedFD
                    blobBytes = bytes
                    blobIdentity = NativeFileIdentity(value)
                } catch {
                    posix.close(fileFD: openedFD)
                    throw error
                }
            } catch where isMissingPOSIXError(error) {
                try proveCanonicalNameMissing(
                    parentDirectoryFD: snapshotsFD,
                    leaf: leaf,
                    bounds: bounds
                )
                blobFD = nil
                blobBytes = nil
                blobIdentity = nil
            }
            defer {
                if let blobFD { posix.close(fileFD: blobFD) }
            }

            let indexValue = try readCanonicalManagedFile(
                parentDirectoryFD: snapshotsFD,
                leaf: "index.json",
                bounds: bounds
            )
            let latestIndexProof = makeManagedFileProof(
                bytes: indexValue.data,
                relativePath: snapshotIndexPath,
                role: .snapshotHealthIndex,
                identity: indexValue.identity
            )
            let decision = try authorizeLatestIndex(latestIndexProof)

            func revalidateBlobOrAbsence() throws {
                guard let blobFD, let blobBytes, let blobIdentity else {
                    try proveCanonicalNameMissing(
                        parentDirectoryFD: snapshotsFD,
                        leaf: leaf,
                        bounds: bounds
                    )
                    return
                }
                let actual = try readCanonicalManagedFile(
                    parentDirectoryFD: snapshotsFD,
                    leaf: leaf,
                    bounds: bounds
                )
                guard actual.identity == blobIdentity else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                guard actual.data == blobBytes,
                      actual.data.count == blobBytes.count,
                      sha256Hex(actual.data) == expectedBlobHash
                else {
                    throw NativeDurableFileWriterError.contentMismatch
                }
                try validateManagedFile(fileFD: blobFD, expectedModes: [0o600])
                try validateCanonicalLeaf(
                    fileFD: blobFD,
                    parentDirectoryFD: snapshotsFD,
                    leaf: leaf,
                    expectedIdentity: blobIdentity
                )
            }

            func revalidateLatestIndex(
                perform body: () throws -> Void = {}
            ) throws {
                try withRevalidatedManagedProof(
                    latestIndexProof,
                    parentDirectoryFD: snapshotsFD,
                    leaf: "index.json",
                    bounds: bounds,
                    perform: body
                )
            }

            switch decision {
            case .preserveReferenced, .notPending:
                try revalidateBlobOrAbsence()
                try revalidateSource(sourceProof)
                try revalidateLatestIndex()
                try revalidateCanonicalIdentity(bounds: bounds)
                return NativeSnapshotPendingCleanupResult(
                    disposition: decision == .preserveReferenced
                        ? .preservedReferenced
                        : .notPending,
                    latestIndexProof: latestIndexProof
                )

            case .unlinkPending:
                guard blobFD != nil else {
                    try proveCanonicalNameMissing(
                        parentDirectoryFD: snapshotsFD,
                        leaf: leaf,
                        bounds: bounds
                    )
                    try revalidateSource(sourceProof)
                    try revalidateLatestIndex()
                    try revalidateCanonicalIdentity(bounds: bounds)
                    do {
                        try posix.syncDirectory(directoryFD: snapshotsFD)
                    } catch {
                        throw NativeSnapshotPendingCleanupIOError.directorySyncFailed
                    }
                    try proveCanonicalNameMissing(
                        parentDirectoryFD: snapshotsFD,
                        leaf: leaf,
                        bounds: bounds
                    )
                    try revalidateSource(sourceProof)
                    try revalidateLatestIndex()
                    try revalidateCanonicalIdentity(bounds: bounds)
                    return NativeSnapshotPendingCleanupResult(
                        disposition: .alreadyAbsent,
                        latestIndexProof: latestIndexProof
                    )
                }

                try revalidateBlobOrAbsence()
                try revalidateSource(sourceProof)
                try revalidateCanonicalIdentity(bounds: bounds)
                try revalidateLatestIndex {
                    try emit(
                        .beforeRetentionUnlink,
                        role: .snapshotFinalIndex,
                        targetName: relativePath
                    )
                    try revalidateBlobOrAbsence()
                    try revalidateSource(sourceProof)
                    do {
                        try posix.unlinkAt(directoryFD: snapshotsFD, path: leaf)
                    } catch {
                        throw NativeSnapshotPendingCleanupIOError.unlinkFailed
                    }
                }
                try emit(
                    .afterRetentionUnlink,
                    role: .snapshotFinalIndex,
                    targetName: relativePath
                )
                do {
                    try posix.syncDirectory(directoryFD: snapshotsFD)
                } catch {
                    throw NativeSnapshotPendingCleanupIOError.directorySyncFailed
                }
                try emit(
                    .afterRetentionDirectoryFSync,
                    role: .snapshotFinalIndex,
                    targetName: relativePath
                )

                try proveCanonicalNameMissing(
                    parentDirectoryFD: snapshotsFD,
                    leaf: leaf,
                    bounds: bounds
                )
                try revalidateSource(sourceProof)
                try revalidateLatestIndex()
                try revalidateCanonicalIdentity(bounds: bounds)
                try proveCanonicalNameMissing(
                    parentDirectoryFD: snapshotsFD,
                    leaf: leaf,
                    bounds: bounds
                )
                return NativeSnapshotPendingCleanupResult(
                    disposition: .unlinked,
                    latestIndexProof: latestIndexProof
                )
            }
        }
    }

    func revalidateCanonicalIdentity() throws {
        try lease.requireActive()
        try revalidateCanonicalIdentity(bounds: [])
    }

    private func durableWriteInternal(
        _ bytes: Data,
        relativePath: String,
        disposition: NativeDurableWriteDisposition,
        role: NativeDurabilityRole,
        sourceProof: NativeSourceProof?,
        expectedManagedProof: NativeManagedFileProof? = nil,
        revalidateSourceAfterRename: Bool = false
    ) throws -> NativeDurableFileReceipt {
        try lease.requireActive()
        let parts = try splitPath(relativePath)
        return try withBoundDirectory(components: Array(parts.dropLast())) { parent, bounds in
            let leaf = parts[parts.count - 1]
            let tempName = ".AssetTracker.tmp.\(UUID().uuidString.lowercased())"
            let tempFD = try posix.openAt(
                directoryFD: parent,
                path: tempName,
                flags: O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                mode: 0o600
            )
            var renamed = false
            defer { posix.close(fileFD: tempFD) }

            do {
                try posix.clearExtendedACL(fileFD: tempFD)
                try posix.changeMode(fileFD: tempFD, mode: 0o600)
                try validateManagedFile(fileFD: tempFD, expectedModes: [0o600])
                let tempIdentity = NativeFileIdentity(try posix.fstat(fileFD: tempFD))
                try emit(.afterTempCreate, role: role, targetName: relativePath)
                try writeAll(bytes, fileFD: tempFD)
                try emit(.afterExactWrite, role: role, targetName: relativePath)
                try posix.syncFile(fileFD: tempFD)
                try emit(.afterFileFSync, role: role, targetName: relativePath)
                try posix.fullSyncFile(fileFD: tempFD)
                try emit(.afterFullFSync, role: role, targetName: relativePath)
                try revalidateCanonicalIdentity(bounds: bounds)
                if let sourceProof {
                    try revalidateSource(sourceProof)
                    try emit(.afterSourceRevalidation, role: role, targetName: relativePath)
                }
                try revalidateCanonicalIdentity(bounds: bounds)
                try emit(.beforeRename, role: role, targetName: relativePath)
                try verifyPreparedTemp(
                    expectedBytes: bytes,
                    heldFileFD: tempFD,
                    parentDirectoryFD: parent,
                    leaf: tempName,
                    expectedIdentity: tempIdentity
                )
                try revalidateCanonicalIdentity(bounds: bounds)
                let renamePreparedTemp = {
                    try self.posix.renameAt(
                        sourceDirectoryFD: parent,
                        source: tempName,
                        destinationDirectoryFD: parent,
                        destination: leaf,
                        exclusive: disposition == .createOnly
                    )
                }
                if let expectedManagedProof {
                    guard let sourceProof else {
                        throw NativeDurableFileWriterError.sourceMissing
                    }
                    try withRevalidatedSource(sourceProof) {
                        try withRevalidatedManagedProof(
                            expectedManagedProof,
                            parentDirectoryFD: parent,
                            leaf: leaf,
                            bounds: bounds,
                            perform: renamePreparedTemp
                        )
                    }
                } else if let sourceProof {
                    try withRevalidatedSource(sourceProof, perform: renamePreparedTemp)
                } else {
                    try renamePreparedTemp()
                }
                renamed = true
                try emit(.afterRename, role: role, targetName: relativePath)
                if revalidateSourceAfterRename, let sourceProof {
                    try revalidateSource(sourceProof)
                }
                try posix.syncDirectory(directoryFD: parent)
                try emit(.afterParentDirectoryFSync, role: role, targetName: relativePath)
                try revalidateCanonicalIdentity(bounds: bounds)
                if revalidateSourceAfterRename, let sourceProof {
                    try revalidateSource(sourceProof)
                }

                let finalFD = try posix.openAt(
                    directoryFD: parent,
                    path: leaf,
                    flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
                    mode: 0
                )
                defer { posix.close(fileFD: finalFD) }
                try validateManagedFile(fileFD: finalFD, expectedModes: [0o600])
                let finalStat = try posix.fstat(fileFD: finalFD)
                let finalBytes = try readAll(fileFD: finalFD)
                try emit(.afterFinalReread, role: role, targetName: relativePath)
                guard finalBytes == bytes else {
                    throw NativeDurableFileWriterError.contentMismatch
                }
                let finalHash = sha256Hex(finalBytes)
                guard finalHash == sha256Hex(bytes), finalBytes.count == bytes.count else {
                    throw NativeDurableFileWriterError.contentMismatch
                }
                try emit(.afterHashVerified, role: role, targetName: relativePath)
                let receipt = try verifyFinalManagedFile(
                    expectedBytes: bytes,
                    parentDirectoryFD: parent,
                    leaf: leaf,
                    expectedIdentity: NativeFileIdentity(finalStat)
                )
                try revalidateCanonicalIdentity(bounds: bounds)
                if revalidateSourceAfterRename, let sourceProof {
                    try revalidateSource(sourceProof)
                }
                return receipt
            } catch {
                if !renamed {
                    cleanupOwnedFileIfCanonical(
                        fileFD: tempFD,
                        parentDirectoryFD: parent,
                        leaf: tempName
                    )
                }
                throw error
            }
        }
    }

    private func verifyPreparedTemp(
        expectedBytes: Data,
        heldFileFD: Int32,
        parentDirectoryFD: Int32,
        leaf: String,
        expectedIdentity: NativeFileIdentity
    ) throws {
        try validateManagedFile(fileFD: heldFileFD, expectedModes: [0o600])
        try validateCanonicalLeaf(
            fileFD: heldFileFD,
            parentDirectoryFD: parentDirectoryFD,
            leaf: leaf,
            expectedIdentity: expectedIdentity
        )
        try posix.syncFile(fileFD: heldFileFD)
        try posix.fullSyncFile(fileFD: heldFileFD)

        let readableFD = try posix.openAt(
            directoryFD: parentDirectoryFD,
            path: leaf,
            flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
            mode: 0
        )
        defer { posix.close(fileFD: readableFD) }
        try validateManagedFile(fileFD: readableFD, expectedModes: [0o600])
        guard NativeFileIdentity(try posix.fstat(fileFD: readableFD)) == expectedIdentity else {
            throw NativeDurableFileWriterError.identityChanged
        }
        let actualBytes = try readAll(fileFD: readableFD)
        guard actualBytes == expectedBytes,
              actualBytes.count == expectedBytes.count,
              sha256Hex(actualBytes) == sha256Hex(expectedBytes)
        else {
            throw NativeDurableFileWriterError.contentMismatch
        }
        try validateManagedFile(fileFD: readableFD, expectedModes: [0o600])
        try validateCanonicalLeaf(
            fileFD: readableFD,
            parentDirectoryFD: parentDirectoryFD,
            leaf: leaf,
            expectedIdentity: expectedIdentity
        )
    }

    private func unlinkPending(relativePath: String, snapshot: Bool) throws {
        try lease.requireActive()
        let expectedPrefix = snapshot ? "Recovery/snapshots/" : "Recovery/ordinary/blobs/"
        guard relativePath.hasPrefix(expectedPrefix),
              blobHash(from: relativePath, prefix: expectedPrefix) != nil
        else {
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
        let parts = try splitPath(relativePath)
        try withBoundDirectory(components: Array(parts.dropLast())) { parent, bounds in
            let leaf = parts[parts.count - 1]
            let fd = try posix.openAt(
                directoryFD: parent,
                path: leaf,
                flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
                mode: 0
            )
            defer { posix.close(fileFD: fd) }
            try validateManagedFile(fileFD: fd, expectedModes: [0o600])
            let openedIdentity = NativeFileIdentity(try posix.fstat(fileFD: fd))
            let bytes = try readAll(fileFD: fd)
            guard sha256Hex(bytes) == blobHash(from: relativePath, prefix: expectedPrefix) else {
                throw NativeDurableFileWriterError.contentMismatch
            }
            try revalidateCanonicalIdentity(bounds: bounds)
            if snapshot {
                try emit(.beforeRetentionUnlink, role: .snapshotFinalIndex, targetName: relativePath)
            }
            try validateManagedFile(fileFD: fd, expectedModes: [0o600])
            try validateCanonicalLeaf(
                fileFD: fd,
                parentDirectoryFD: parent,
                leaf: leaf,
                expectedIdentity: openedIdentity
            )
            try posix.unlinkAt(directoryFD: parent, path: leaf)
            if snapshot {
                try emit(.afterRetentionUnlink, role: .snapshotFinalIndex, targetName: relativePath)
            }
            try posix.syncDirectory(directoryFD: parent)
            if snapshot {
                try emit(.afterRetentionDirectoryFSync, role: .snapshotFinalIndex, targetName: relativePath)
            }
            try revalidateCanonicalIdentity(bounds: bounds)
            do {
                _ = try posix.fstatAt(directoryFD: parent, path: leaf, noFollow: true)
                throw NativeDurableFileWriterError.identityChanged
            } catch where isMissingPOSIXError(error) {
                // The deletion is authoritative only when the canonical name is still absent.
            }
        }
    }

    private enum ReadableFileKind {
        case primary
        case managed
        case blob(String)

        var isPrimary: Bool {
            if case .primary = self { return true }
            return false
        }
    }

    private var primaryName: String { "AssetTrackerBook.json" }
    private var ordinaryIndexPath: String { "Recovery/ordinary/slots.json" }
    private var snapshotIndexPath: String { "Recovery/snapshots/index.json" }

    private func validateReadableFilePath(_ path: String) throws -> ReadableFileKind {
        if path == primaryName { return .primary }
        if path == "Recovery/ordinary/slots.json" || path == "Recovery/snapshots/index.json" {
            return .managed
        }
        if let hash = blobHash(from: path, prefix: "Recovery/ordinary/blobs/") {
            return .blob(hash)
        }
        if let hash = blobHash(from: path, prefix: "Recovery/snapshots/") {
            return .blob(hash)
        }
        throw NativeDurableFileWriterError.invalidManagedPath
    }

    private func validateWriteTarget(
        bytes: Data,
        path: String,
        disposition: NativeDurableWriteDisposition,
        role: NativeDurabilityRole
    ) throws {
        _ = try splitPath(path)
        switch role {
        case .ordinaryEmptyIndex, .ordinaryPreparedIndex, .ordinaryCommittedIndex, .ordinaryHealthIndex:
            guard path == "Recovery/ordinary/slots.json", disposition == .replace else {
                throw NativeDurableFileWriterError.invalidRoleTarget
            }
        case .snapshotEmptyIndex:
            guard path == snapshotIndexPath,
                  disposition == .replace || disposition == .createOnly
            else {
                throw NativeDurableFileWriterError.invalidRoleTarget
            }
        case .snapshotFinalIndex, .snapshotHealthIndex:
            guard path == snapshotIndexPath, disposition == .replace else {
                throw NativeDurableFileWriterError.invalidRoleTarget
            }
        case .ordinaryBlob:
            guard disposition == .createOnly,
                  blobHash(from: path, prefix: "Recovery/ordinary/blobs/") == sha256Hex(bytes)
            else {
                throw NativeDurableFileWriterError.invalidRoleTarget
            }
        case .snapshotBlob:
            guard disposition == .createOnly,
                  blobHash(from: path, prefix: "Recovery/snapshots/") == sha256Hex(bytes)
            else {
                throw NativeDurableFileWriterError.invalidRoleTarget
            }
        default:
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
    }

    private func isAllowedDirectoryCreation(path: String, role: NativeDurabilityRole) -> Bool {
        switch role {
        case .ordinaryDirectory:
            return ["Recovery", "Recovery/ordinary", "Recovery/ordinary/blobs"].contains(path)
        case .snapshotDirectory:
            return ["Recovery", "Recovery/snapshots"].contains(path)
        default:
            return false
        }
    }

    private func isAllowedDirectorySync(path: String, role: NativeDurabilityRole) -> Bool {
        switch role {
        case .ordinaryDirectory:
            return ["Recovery", "Recovery/ordinary", "Recovery/ordinary/blobs"].contains(path)
        case .snapshotDirectory:
            return ["Recovery", "Recovery/snapshots"].contains(path)
        case .ordinaryEmptyIndex, .ordinaryPreparedIndex, .ordinaryCommittedIndex, .ordinaryHealthIndex:
            return path == "Recovery/ordinary"
        case .snapshotEmptyIndex, .snapshotFinalIndex, .snapshotHealthIndex:
            return path == "Recovery/snapshots"
        default:
            return false
        }
    }

    private func isKnownManagedDirectory(_ path: String) -> Bool {
        ["Recovery", "Recovery/ordinary", "Recovery/ordinary/blobs", "Recovery/snapshots"].contains(path)
    }

    private func blobHash(from path: String, prefix: String) -> String? {
        guard path.hasPrefix(prefix) else { return nil }
        let name = String(path.dropFirst(prefix.count))
        guard !name.contains("/"), name.hasSuffix(".json") else { return nil }
        let hash = String(name.dropLast(5))
        guard isLowercaseASCIIHash(hash) else {
            return nil
        }
        return hash
    }

    private func ordinaryBlobHash(fromLeaf leaf: String) -> String? {
        blobHash(from: "Recovery/ordinary/blobs/\(leaf)", prefix: "Recovery/ordinary/blobs/")
    }

    private func splitPath(_ path: String) throws -> [String] {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\0") else {
            throw NativeDurableFileWriterError.invalidManagedPath
        }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !parts.isEmpty, parts.allSatisfy(isSinglePathComponent) else {
            throw NativeDurableFileWriterError.invalidManagedPath
        }
        return parts
    }

    private func validateHash(_ source: ExpectedBookSource) throws {
        guard case .sha256(let hash) = source else { return }
        guard isLowercaseASCIIHash(hash) else {
            throw NativeDurableFileWriterError.sourceChanged
        }
    }

    private func validateSourceProof(_ proof: NativeSourceProof) throws {
        try lease.requireActive()
        guard proof.leaseID == lease.id, proof.targetName == primaryName else {
            throw NativeDurableFileWriterError.leaseExpired
        }
    }

    private func makeManagedFileProof(
        bytes: Data,
        relativePath: String,
        role: NativeDurabilityRole,
        identity: NativeFileIdentity
    ) -> NativeManagedFileProof {
        NativeManagedFileProof(
            bytes: bytes,
            leaseID: lease.id,
            relativePath: relativePath,
            role: role,
            device: identity.device,
            inode: identity.inode
        )
    }

    private func validateManagedProof(_ proof: NativeManagedFileProof) throws {
        try lease.requireActive()
        guard proof.leaseID == lease.id else {
            throw NativeDurableFileWriterError.leaseExpired
        }
        guard (proof.relativePath == ordinaryIndexPath && proof.role == .ordinaryHealthIndex)
                || (proof.relativePath == snapshotIndexPath && proof.role == .snapshotHealthIndex)
        else {
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
        guard proof.byteCount == proof.bytes.count,
              proof.sha256 == sha256Hex(proof.bytes)
        else {
            throw NativeDurableFileWriterError.contentMismatch
        }
    }

    private func withRevalidatedManagedProof<T>(
        _ proof: NativeManagedFileProof,
        parentDirectoryFD: Int32,
        leaf: String,
        bounds: [BoundDirectory],
        perform body: () throws -> T
    ) throws -> T {
        try validateManagedProof(proof)
        guard proof.relativePath.split(separator: "/").last.map(String.init) == leaf else {
            throw NativeDurableFileWriterError.invalidRoleTarget
        }
        let fileFD: Int32
        do {
            fileFD = try posix.openAt(
                directoryFD: parentDirectoryFD,
                path: leaf,
                flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
                mode: 0
            )
        } catch where isMissingPOSIXError(error) {
            try proveCanonicalNameMissing(
                parentDirectoryFD: parentDirectoryFD,
                leaf: leaf,
                bounds: bounds
            )
            throw NativeDurableFileWriterError.identityChanged
        }
        defer { posix.close(fileFD: fileFD) }

        try validateManagedFile(fileFD: fileFD, expectedModes: [0o600])
        let value = try posix.fstat(fileFD: fileFD)
        let identity = NativeFileIdentity(value)
        let bytes = try readAll(fileFD: fileFD)
        guard identity.device == proof.device,
              identity.inode == proof.inode
        else {
            throw NativeDurableFileWriterError.identityChanged
        }
        guard bytes == proof.bytes,
              bytes.count == proof.byteCount,
              sha256Hex(bytes) == proof.sha256
        else {
            throw NativeDurableFileWriterError.contentMismatch
        }
        try validateManagedFile(fileFD: fileFD, expectedModes: [0o600])
        try validateCanonicalLeaf(
            fileFD: fileFD,
            parentDirectoryFD: parentDirectoryFD,
            leaf: leaf,
            expectedIdentity: identity
        )
        try revalidateCanonicalIdentity(bounds: bounds)
        try validateManagedFile(fileFD: fileFD, expectedModes: [0o600])
        try validateCanonicalLeaf(
            fileFD: fileFD,
            parentDirectoryFD: parentDirectoryFD,
            leaf: leaf,
            expectedIdentity: identity
        )
        return try body()
    }

    private func validateExpectedSourceBytes(
        _ expectedSourceBytes: Data?,
        sourceProof: NativeSourceProof
    ) throws {
        try validateSourceProof(sourceProof)
        switch sourceProof.expectedSource {
        case .missing:
            guard expectedSourceBytes == nil else {
                throw NativeDurableFileWriterError.sourceChanged
            }
        case .sha256(let expectedHash):
            guard let expectedSourceBytes,
                  sha256Hex(expectedSourceBytes) == expectedHash,
                  expectedSourceBytes.count == sourceProof.byteCount
            else {
                throw NativeDurableFileWriterError.sourceChanged
            }
        }
    }

    private func revalidateSource(_ proof: NativeSourceProof) throws {
        try withRevalidatedSource(proof) {}
    }

    private func withRevalidatedSource<T>(
        _ proof: NativeSourceProof,
        perform body: () throws -> T
    ) throws -> T {
        try validateSourceProof(proof)
        switch proof.expectedSource {
        case .missing:
            do {
                _ = try posix.fstatAt(directoryFD: rootFD, path: primaryName, noFollow: true)
                throw NativeDurableFileWriterError.sourceChanged
            } catch where isMissingPOSIXError(error) {
                return try body()
            }
        case .sha256(let expectedHash):
            let fd: Int32
            do {
                fd = try posix.openAt(
                    directoryFD: rootFD,
                    path: primaryName,
                    flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
                    mode: 0
                )
            } catch where isMissingPOSIXError(error) {
                throw NativeDurableFileWriterError.sourceChanged
            }
            defer { posix.close(fileFD: fd) }
            try validateReadableFile(fileFD: fd, kind: .primary)
            let value = try posix.fstat(fileFD: fd)
            let data = try readAll(fileFD: fd)
            try validateReadableFile(fileFD: fd, kind: .primary)
            try validateCanonicalLeaf(
                fileFD: fd,
                parentDirectoryFD: rootFD,
                leaf: primaryName,
                expectedIdentity: NativeFileIdentity(value)
            )
            guard sha256Hex(data) == expectedHash,
                  data.count == proof.byteCount,
                  UInt64(value.st_dev) == proof.device,
                  UInt64(value.st_ino) == proof.inode
            else {
                throw NativeDurableFileWriterError.sourceChanged
            }
            return try body()
        }
    }

    private func readPrimaryForProof() throws -> (data: Data, stat: stat) {
        let fd: Int32
        do {
            fd = try posix.openAt(
                directoryFD: rootFD,
                path: primaryName,
                flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
                mode: 0
            )
        } catch where isMissingPOSIXError(error) {
            throw NativeDurableFileWriterError.sourceMissing
        }
        defer { posix.close(fileFD: fd) }
        try validateReadableFile(fileFD: fd, kind: .primary)
        let value = try posix.fstat(fileFD: fd)
        let data = try readAll(fileFD: fd)
        try validateReadableFile(fileFD: fd, kind: .primary)
        try validateCanonicalLeaf(
            fileFD: fd,
            parentDirectoryFD: rootFD,
            leaf: primaryName,
            expectedIdentity: NativeFileIdentity(value)
        )
        return (data, value)
    }

    private func validateCanonicalLeaf(
        fileFD: Int32,
        parentDirectoryFD: Int32,
        leaf: String,
        expectedIdentity: NativeFileIdentity
    ) throws {
        let byFD = try posix.fstat(fileFD: fileFD)
        let byName = try posix.fstatAt(directoryFD: parentDirectoryFD, path: leaf, noFollow: true)
        guard NativeFileIdentity(byFD) == expectedIdentity,
              NativeFileIdentity(byName) == expectedIdentity
        else {
            throw NativeDurableFileWriterError.identityChanged
        }
    }

    private func withValidatedCrashTemp<T>(
        expectedPrefix: Data?,
        parentDirectoryFD: Int32,
        leaf: String,
        bounds: [BoundDirectory],
        _ body: (Data, NativeFileIdentity) throws -> T
    ) throws -> T {
        let fileFD: Int32
        do {
            fileFD = try posix.openAt(
                directoryFD: parentDirectoryFD,
                path: leaf,
                flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
                mode: 0
            )
        } catch where isMissingPOSIXError(error) {
            try proveCanonicalNameMissing(
                parentDirectoryFD: parentDirectoryFD,
                leaf: leaf,
                bounds: bounds
            )
            throw NativeDurableFileWriterError.identityChanged
        }
        defer { posix.close(fileFD: fileFD) }

        try validateManagedFile(fileFD: fileFD, expectedModes: [0o600])
        let identity = NativeFileIdentity(try posix.fstat(fileFD: fileFD))
        let bytes = try readAll(fileFD: fileFD)
        if let expectedPrefix {
            guard bytes.count <= expectedPrefix.count,
                  expectedPrefix.starts(with: bytes)
            else {
                throw NativeDurableFileWriterError.contentMismatch
            }
        }
        try validateManagedFile(fileFD: fileFD, expectedModes: [0o600])
        try validateCanonicalLeaf(
            fileFD: fileFD,
            parentDirectoryFD: parentDirectoryFD,
            leaf: leaf,
            expectedIdentity: identity
        )
        try revalidateCanonicalIdentity(bounds: bounds)
        try validateManagedFile(fileFD: fileFD, expectedModes: [0o600])
        try validateCanonicalLeaf(
            fileFD: fileFD,
            parentDirectoryFD: parentDirectoryFD,
            leaf: leaf,
            expectedIdentity: identity
        )
        return try body(bytes, identity)
    }

    private func readCanonicalManagedFile(
        parentDirectoryFD: Int32,
        leaf: String,
        bounds: [BoundDirectory]
    ) throws -> (data: Data, identity: NativeFileIdentity) {
        let fileFD: Int32
        do {
            fileFD = try posix.openAt(
                directoryFD: parentDirectoryFD,
                path: leaf,
                flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
                mode: 0
            )
        } catch where isMissingPOSIXError(error) {
            try proveCanonicalNameMissing(
                parentDirectoryFD: parentDirectoryFD,
                leaf: leaf,
                bounds: bounds
            )
            throw NativeDurableFileWriterError.identityChanged
        }
        defer { posix.close(fileFD: fileFD) }

        try validateManagedFile(fileFD: fileFD, expectedModes: [0o600])
        let identity = NativeFileIdentity(try posix.fstat(fileFD: fileFD))
        let data = try readAll(fileFD: fileFD)
        try validateManagedFile(fileFD: fileFD, expectedModes: [0o600])
        try validateCanonicalLeaf(
            fileFD: fileFD,
            parentDirectoryFD: parentDirectoryFD,
            leaf: leaf,
            expectedIdentity: identity
        )
        try revalidateCanonicalIdentity(bounds: bounds)
        try validateCanonicalLeaf(
            fileFD: fileFD,
            parentDirectoryFD: parentDirectoryFD,
            leaf: leaf,
            expectedIdentity: identity
        )
        return (data, identity)
    }

    private func readCanonicalManagedDirectory(
        parentDirectoryFD: Int32,
        leaf: String,
        bounds: [BoundDirectory]
    ) throws -> NativeFileIdentity {
        let namedStat: stat
        do {
            namedStat = try posix.fstatAt(
                directoryFD: parentDirectoryFD,
                path: leaf,
                noFollow: true
            )
        } catch where isMissingPOSIXError(error) {
            try proveCanonicalNameMissing(
                parentDirectoryFD: parentDirectoryFD,
                leaf: leaf,
                bounds: bounds
            )
            throw NativeDurableFileWriterError.identityChanged
        }
        let directoryFD: Int32
        do {
            directoryFD = try posix.openAt(
                directoryFD: parentDirectoryFD,
                path: leaf,
                flags: O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC,
                mode: 0
            )
        } catch where isMissingPOSIXError(error) {
            try proveCanonicalNameMissing(
                parentDirectoryFD: parentDirectoryFD,
                leaf: leaf,
                bounds: bounds
            )
            throw NativeDurableFileWriterError.identityChanged
        }
        defer { posix.close(fileFD: directoryFD) }

        let identity = NativeFileIdentity(namedStat)
        try validateCanonicalManagedDirectory(
            fileFD: directoryFD,
            parentDirectoryFD: parentDirectoryFD,
            leaf: leaf,
            expectedIdentity: identity
        )
        try revalidateCanonicalIdentity(bounds: bounds)
        try validateCanonicalManagedDirectory(
            fileFD: directoryFD,
            parentDirectoryFD: parentDirectoryFD,
            leaf: leaf,
            expectedIdentity: identity
        )
        return identity
    }

    private func proveCanonicalNameMissing(
        parentDirectoryFD: Int32,
        leaf: String,
        bounds: [BoundDirectory]
    ) throws {
        try revalidateCanonicalIdentity(bounds: bounds)
        do {
            _ = try posix.fstatAt(
                directoryFD: parentDirectoryFD,
                path: leaf,
                noFollow: true
            )
            throw NativeDurableFileWriterError.identityChanged
        } catch where isMissingPOSIXError(error) {
            try revalidateCanonicalIdentity(bounds: bounds)
        }
    }

    private func cleanupOwnedFileIfCanonical(
        fileFD: Int32,
        parentDirectoryFD: Int32,
        leaf: String
    ) {
        do {
            let byFD = try posix.fstat(fileFD: fileFD)
            let byName = try posix.fstatAt(
                directoryFD: parentDirectoryFD,
                path: leaf,
                noFollow: true
            )
            guard NativeFileIdentity(byFD) == NativeFileIdentity(byName),
                  isRegularFile(byFD), byFD.st_nlink == 1,
                  byFD.st_uid == effectiveUserID
            else {
                return
            }
            try posix.unlinkAt(directoryFD: parentDirectoryFD, path: leaf)
            try posix.syncDirectory(directoryFD: parentDirectoryFD)
        } catch {
            // A missing/replaced temp name is not ours to remove.
        }
    }

    private func verifyFinalManagedFile(
        expectedBytes: Data,
        parentDirectoryFD: Int32,
        leaf: String,
        expectedIdentity: NativeFileIdentity
    ) throws -> NativeDurableFileReceipt {
        let fileFD = try posix.openAt(
            directoryFD: parentDirectoryFD,
            path: leaf,
            flags: O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
            mode: 0
        )
        defer { posix.close(fileFD: fileFD) }
        try validateManagedFile(fileFD: fileFD, expectedModes: [0o600])
        let value = try posix.fstat(fileFD: fileFD)
        let data = try readAll(fileFD: fileFD)
        try validateManagedFile(fileFD: fileFD, expectedModes: [0o600])
        try validateCanonicalLeaf(
            fileFD: fileFD,
            parentDirectoryFD: parentDirectoryFD,
            leaf: leaf,
            expectedIdentity: expectedIdentity
        )
        let actualHash = sha256Hex(data)
        guard data == expectedBytes,
              data.count == expectedBytes.count,
              actualHash == sha256Hex(expectedBytes),
              NativeFileIdentity(value) == expectedIdentity
        else {
            throw NativeDurableFileWriterError.contentMismatch
        }
        return NativeDurableFileReceipt(sha256: actualHash, byteCount: data.count, stat: value)
    }

    private func validateReadableFile(fileFD: Int32, kind: ReadableFileKind) throws {
        guard kind.isPrimary else {
            try validateManagedFile(fileFD: fileFD, expectedModes: [0o600])
            return
        }
        let value = try posix.fstat(fileFD: fileFD)
        guard isRegularFile(value), value.st_nlink == 1,
              value.st_uid == effectiveUserID,
              [mode_t(0o600), mode_t(0o644)].contains(permissionBits(value)),
              try !posix.hasDangerousLegacyACL(fileFD: fileFD, ownerUserID: effectiveUserID)
        else {
            throw NativeDurableFileWriterError.invalidMetadata
        }
    }

    private func validateManagedFile(fileFD: Int32, expectedModes: Set<mode_t>) throws {
        let value = try posix.fstat(fileFD: fileFD)
        guard isRegularFile(value), value.st_nlink == 1,
              value.st_uid == effectiveUserID,
              expectedModes.contains(permissionBits(value)),
              try posix.extendedACLEntryCount(fileFD: fileFD) == 0
        else {
            throw NativeDurableFileWriterError.invalidMetadata
        }
    }

    private func validateManagedDirectory(stat value: stat, fileFD: Int32) throws {
        guard isDirectory(value), value.st_nlink > 0,
              value.st_uid == effectiveUserID,
              permissionBits(value) == 0o700,
              try posix.extendedACLEntryCount(fileFD: fileFD) == 0
        else {
            throw NativeDurableFileWriterError.invalidMetadata
        }
    }

    private func validateCanonicalManagedDirectory(
        fileFD: Int32,
        parentDirectoryFD: Int32,
        leaf: String,
        expectedIdentity: NativeFileIdentity
    ) throws {
        let byFD = try posix.fstat(fileFD: fileFD)
        try validateManagedDirectory(stat: byFD, fileFD: fileFD)
        let byName = try posix.fstatAt(
            directoryFD: parentDirectoryFD,
            path: leaf,
            noFollow: true
        )
        guard NativeFileIdentity(byFD) == expectedIdentity,
              NativeFileIdentity(byName) == expectedIdentity
        else {
            throw NativeDurableFileWriterError.identityChanged
        }
    }

    private func withBoundDirectory<T>(
        components: [String],
        _ body: (Int32, [BoundDirectory]) throws -> T
    ) throws -> T {
        var currentFD = rootFD
        var bounds: [BoundDirectory] = []
        defer {
            for bound in bounds.reversed() {
                posix.close(fileFD: bound.fd)
            }
        }
        for component in components {
            let namedStat = try posix.fstatAt(directoryFD: currentFD, path: component, noFollow: true)
            let fd = try posix.openAt(
                directoryFD: currentFD,
                path: component,
                flags: O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC,
                mode: 0
            )
            do {
                let fdStat = try posix.fstat(fileFD: fd)
                try validateManagedDirectory(stat: fdStat, fileFD: fd)
                guard NativeFileIdentity(fdStat) == NativeFileIdentity(namedStat) else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                bounds.append(BoundDirectory(
                    fd: fd,
                    parentFD: currentFD,
                    name: component,
                    identity: NativeFileIdentity(fdStat)
                ))
                currentFD = fd
            } catch {
                posix.close(fileFD: fd)
                throw error
            }
        }
        try revalidateCanonicalIdentity(bounds: bounds)
        return try body(currentFD, bounds)
    }

    private func withBoundDirectoryIfPresent<T>(
        components: [String],
        _ body: (Int32, [BoundDirectory]) throws -> T
    ) throws -> T? {
        var currentFD = rootFD
        var bounds: [BoundDirectory] = []
        defer {
            for bound in bounds.reversed() {
                posix.close(fileFD: bound.fd)
            }
        }

        for component in components {
            let namedStat: stat
            do {
                namedStat = try posix.fstatAt(
                    directoryFD: currentFD,
                    path: component,
                    noFollow: true
                )
            } catch where isMissingPOSIXError(error) {
                try proveCanonicalNameMissing(
                    parentDirectoryFD: currentFD,
                    leaf: component,
                    bounds: bounds
                )
                return nil
            }

            let fd: Int32
            do {
                fd = try posix.openAt(
                    directoryFD: currentFD,
                    path: component,
                    flags: O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC,
                    mode: 0
                )
            } catch where isMissingPOSIXError(error) {
                try proveCanonicalNameMissing(
                    parentDirectoryFD: currentFD,
                    leaf: component,
                    bounds: bounds
                )
                throw NativeDurableFileWriterError.identityChanged
            }

            do {
                let fdStat = try posix.fstat(fileFD: fd)
                try validateManagedDirectory(stat: fdStat, fileFD: fd)
                guard NativeFileIdentity(fdStat) == NativeFileIdentity(namedStat) else {
                    throw NativeDurableFileWriterError.identityChanged
                }
                bounds.append(BoundDirectory(
                    fd: fd,
                    parentFD: currentFD,
                    name: component,
                    identity: NativeFileIdentity(fdStat)
                ))
                currentFD = fd
            } catch {
                posix.close(fileFD: fd)
                throw error
            }
        }

        try revalidateCanonicalIdentity(bounds: bounds)
        let value = try body(currentFD, bounds)
        try revalidateCanonicalIdentity(bounds: bounds)
        return value
    }

    private func revalidateCanonicalIdentity(bounds: [BoundDirectory]) throws {
        try lease.requireActive()
        try validateRootAndLockBinding()
        for bound in bounds {
            let byFD = try posix.fstat(fileFD: bound.fd)
            let byName = try posix.fstatAt(directoryFD: bound.parentFD, path: bound.name, noFollow: true)
            guard NativeFileIdentity(byFD) == bound.identity,
                  NativeFileIdentity(byName) == bound.identity,
                  isDirectory(byFD), byFD.st_nlink > 0,
                  byFD.st_uid == effectiveUserID,
                  permissionBits(byFD) == 0o700,
                  try posix.extendedACLEntryCount(fileFD: bound.fd) == 0
            else {
                throw NativeDurableFileWriterError.identityChanged
            }
        }
        try validateRootAndLockBinding()
    }

    private func validateRootAndLockBinding() throws {
        let rootByFD = try posix.fstat(fileFD: rootFD)
        let rootByName = try posix.fstatAt(directoryFD: parentFD, path: rootName, noFollow: true)
        guard NativeFileIdentity(rootByFD) == rootIdentity,
              NativeFileIdentity(rootByName) == rootIdentity,
              isDirectory(rootByFD), rootByFD.st_nlink > 0,
              rootByFD.st_uid == effectiveUserID,
              allowedRootModes.contains(permissionBits(rootByFD))
        else {
            throw NativeDurableFileWriterError.identityChanged
        }
        if requiresZeroRootACL {
            guard try posix.extendedACLEntryCount(fileFD: rootFD) == 0 else {
                throw NativeDurableFileWriterError.identityChanged
            }
        } else {
            guard try !posix.hasDangerousLegacyACL(
                fileFD: rootFD,
                ownerUserID: effectiveUserID
            ) else {
                throw NativeDurableFileWriterError.identityChanged
            }
        }

        switch (lockFD, lockIdentity) {
        case (.some(let lockFD), .some(let lockIdentity)):
            let lockByFD = try posix.fstat(fileFD: lockFD)
            let lockByName = try posix.fstatAt(
                directoryFD: rootFD,
                path: lockName,
                noFollow: true
            )
            guard NativeFileIdentity(lockByFD) == lockIdentity,
                  NativeFileIdentity(lockByName) == lockIdentity,
                  isRegularFile(lockByFD), lockByFD.st_nlink == 1,
                  lockByFD.st_uid == effectiveUserID,
                  permissionBits(lockByFD) == 0o600,
                  try posix.extendedACLEntryCount(fileFD: lockFD) == 0
            else {
                throw NativeDurableFileWriterError.identityChanged
            }
        case (.none, .none):
            do {
                _ = try posix.fstatAt(directoryFD: rootFD, path: lockName, noFollow: true)
                throw NativeDurableFileWriterError.identityChanged
            } catch where isMissingPOSIXError(error) {
                break
            }
        default:
            throw NativeDurableFileWriterError.identityChanged
        }

        for name in requiredAbsentRootNames {
            do {
                _ = try posix.fstatAt(directoryFD: rootFD, path: name, noFollow: true)
                throw NativeDurableFileWriterError.identityChanged
            } catch where isMissingPOSIXError(error) {
                continue
            }
        }
    }

    private func writeAll(_ data: Data, fileFD: Int32) throws {
        var offset = 0
        var zeroProgressCount = 0
        try data.withUnsafeBytes { rawBytes in
            while offset < rawBytes.count {
                let remainder = UnsafeRawBufferPointer(rebasing: rawBytes[offset...])
                do {
                    let count = try posix.write(fileFD: fileFD, bytes: remainder)
                    if count == 0 {
                        zeroProgressCount += 1
                        guard zeroProgressCount < 16 else {
                            throw NativeDurableFileWriterError.zeroProgress
                        }
                        continue
                    }
                    guard count > 0, count <= remainder.count else {
                        throw NativeDurableFileWriterError.contentMismatch
                    }
                    zeroProgressCount = 0
                    offset += count
                } catch let error as POSIXError where error.code == .EINTR {
                    continue
                }
            }
        }
    }

    private func readAll(fileFD: Int32) throws -> Data {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count: Int
            do {
                count = try buffer.withUnsafeMutableBytes {
                    try posix.read(fileFD: fileFD, bytes: $0)
                }
            } catch let error as POSIXError where error.code == .EINTR {
                continue
            }
            if count == 0 { return data }
            guard count > 0, count <= buffer.count else {
                throw NativeDurableFileWriterError.contentMismatch
            }
            data.append(contentsOf: buffer[0 ..< count])
        }
    }

    private func emit(
        _ point: NativeDurabilityFaultPoint,
        role: NativeDurabilityRole,
        targetName: String
    ) throws {
        try faultHandler(NativeDurabilityFaultEvent(point: point, role: role, targetName: targetName))
    }
}

final class NativeReadOnlyBookDirectory {
    private let core: NativeLockedBookDirectory

    fileprivate init(core: NativeLockedBookDirectory) {
        self.core = core
    }

    func readValidated(relativePath: String) throws -> Data? {
        try core.readValidated(relativePath: relativePath)
    }

    func verifyPrimarySource(expectedSource: ExpectedBookSource) throws -> NativeSourceProof {
        try core.verifyPrimarySource(expectedSource: expectedSource)
    }

    func enumerateIfPresent(relativePath: String) throws -> [NativeDirectoryEntry]? {
        try core.enumerateIfPresent(relativePath: relativePath)
    }

    func auditOrdinaryIndexNamespace(
        expectedEmptyIndexBytes: Data
    ) throws -> NativeOrdinaryIndexNamespaceState {
        try core.auditOrdinaryIndexNamespace(expectedEmptyIndexBytes: expectedEmptyIndexBytes)
    }

    func auditSnapshotIndexNamespace(
        expectedEmptyIndexBytes: Data
    ) throws -> NativeSnapshotIndexNamespaceState {
        try core.auditSnapshotIndexNamespace(expectedEmptyIndexBytes: expectedEmptyIndexBytes)
    }

    func auditOrdinaryBlobNamespace(
        expectedSourceBytes: Data?,
        sourceProof: NativeSourceProof
    ) throws -> NativeOrdinaryBlobNamespaceAudit {
        try core.auditOrdinaryBlobNamespace(
            expectedSourceBytes: expectedSourceBytes,
            sourceProof: sourceProof
        )
    }

    func revalidateCanonicalIdentity() throws {
        try core.revalidateCanonicalIdentity()
    }
}

private func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func isLowercaseASCIIHash(_ value: String) -> Bool {
    let bytes = value.utf8
    guard bytes.count == 64 else { return false }
    return bytes.allSatisfy { byte in
        (48 ... 57).contains(byte) || (97 ... 102).contains(byte)
    }
}

private let writerTempPrefix = ".AssetTracker.tmp."

private func isCanonicalWriterTempName(_ value: String) -> Bool {
    guard value.hasPrefix(writerTempPrefix) else { return false }
    let suffix = String(value.dropFirst(writerTempPrefix.count))
    guard suffix.utf8.count == 36,
          suffix == suffix.lowercased(),
          let uuid = UUID(uuidString: suffix)
    else {
        return false
    }
    return uuid.uuidString.lowercased() == suffix
}

private func permissionBits(_ value: stat) -> mode_t {
    value.st_mode & mode_t(0o7777)
}

private func isRegularFile(_ value: stat) -> Bool {
    (value.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG)
}

private func isDirectory(_ value: stat) -> Bool {
    (value.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR)
}

private func isSinglePathComponent(_ value: String) -> Bool {
    !value.isEmpty && value != "." && value != ".." &&
        !value.contains("/") && !value.contains("\0")
}
