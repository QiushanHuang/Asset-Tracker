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
        let duplicate = Darwin.dup(directoryFD)
        guard duplicate >= 0 else { throw currentPOSIXError() }
        guard let directory = Darwin.fdopendir(duplicate) else {
            Darwin.close(duplicate)
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
    private let lockFD: Int32
    private let lockName: String
    private let lockIdentity: NativeFileIdentity

    fileprivate init(
        posix: any NativePOSIX,
        faultHandler: @escaping NativeDurabilityFaultHandler,
        lease: NativeMutationLease,
        effectiveUserID: uid_t,
        parentFD: Int32,
        rootFD: Int32,
        rootName: String,
        rootIdentity: NativeFileIdentity,
        lockFD: Int32,
        lockName: String,
        lockIdentity: NativeFileIdentity
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
                try revalidateCanonicalIdentity(bounds: bounds)
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
        try validateWriteTarget(bytes: bytes, path: relativePath, disposition: disposition, role: role)
        return try durableWriteInternal(
            bytes,
            relativePath: relativePath,
            disposition: disposition,
            role: role,
            sourceProof: nil
        )
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

    func unlinkOrdinaryPendingAndSync(relativePath: String) throws {
        try unlinkPending(relativePath: relativePath, snapshot: false)
    }

    func unlinkSnapshotPendingAndSync(relativePath: String) throws {
        try unlinkPending(relativePath: relativePath, snapshot: true)
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
        sourceProof: NativeSourceProof?
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
                if let sourceProof {
                    try withRevalidatedSource(sourceProof) {
                        try posix.renameAt(
                            sourceDirectoryFD: parent,
                            source: tempName,
                            destinationDirectoryFD: parent,
                            destination: leaf,
                            exclusive: disposition == .createOnly
                        )
                    }
                } else {
                    try posix.renameAt(
                        sourceDirectoryFD: parent,
                        source: tempName,
                        destinationDirectoryFD: parent,
                        destination: leaf,
                        exclusive: disposition == .createOnly
                    )
                }
                renamed = true
                try emit(.afterRename, role: role, targetName: relativePath)
                try posix.syncDirectory(directoryFD: parent)
                try emit(.afterParentDirectoryFSync, role: role, targetName: relativePath)
                try revalidateCanonicalIdentity(bounds: bounds)

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
        case .snapshotEmptyIndex, .snapshotFinalIndex, .snapshotHealthIndex:
            guard path == "Recovery/snapshots/index.json", disposition == .replace else {
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
        guard hash.count == 64,
              hash.allSatisfy({ $0.isNumber || ("a" ... "f").contains(String($0)) })
        else {
            return nil
        }
        return hash
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
        guard hash.count == 64,
              hash.allSatisfy({ $0.isNumber || ("a" ... "f").contains(String($0)) })
        else {
            throw NativeDurableFileWriterError.sourceChanged
        }
    }

    private func validateSourceProof(_ proof: NativeSourceProof) throws {
        try lease.requireActive()
        guard proof.leaseID == lease.id, proof.targetName == primaryName else {
            throw NativeDurableFileWriterError.leaseExpired
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

    private func revalidateCanonicalIdentity(bounds: [BoundDirectory]) throws {
        try lease.requireActive()
        let rootByFD = try posix.fstat(fileFD: rootFD)
        let rootByName = try posix.fstatAt(directoryFD: parentFD, path: rootName, noFollow: true)
        let lockByFD = try posix.fstat(fileFD: lockFD)
        let lockByName = try posix.fstatAt(directoryFD: rootFD, path: lockName, noFollow: true)
        guard NativeFileIdentity(rootByFD) == rootIdentity,
              NativeFileIdentity(rootByName) == rootIdentity,
              isDirectory(rootByFD), rootByFD.st_nlink > 0,
              rootByFD.st_uid == effectiveUserID,
              permissionBits(rootByFD) == 0o700,
              try posix.extendedACLEntryCount(fileFD: rootFD) == 0,
              NativeFileIdentity(lockByFD) == lockIdentity,
              NativeFileIdentity(lockByName) == lockIdentity,
              isRegularFile(lockByFD), lockByFD.st_nlink == 1,
              lockByFD.st_uid == effectiveUserID,
              permissionBits(lockByFD) == 0o600,
              try posix.extendedACLEntryCount(fileFD: lockFD) == 0
        else {
            throw NativeDurableFileWriterError.identityChanged
        }
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

private func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
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
