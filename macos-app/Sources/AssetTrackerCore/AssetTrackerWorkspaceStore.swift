import Darwin
import Foundation

@_silgen_name("flock")
private func workspaceDarwinFlock(_ descriptor: Int32, _ operation: Int32) -> Int32

public final class AssetTrackerWorkspaceStore {
    private let directory: URL
    public init(directoryURL: URL) { directory = directoryURL }
    private let fileName = "Workspace-v1.json"
    private let maximumBytes = 2 * 1024 * 1024

    private func failure(_ code: Int, _ message: String) -> NSError {
        NSError(domain: "Workspace", code: code, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func posixError() -> POSIXError { POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }

    private func validate(_ text: String) throws {
        guard let data = text.data(using: .utf8), data.count <= maximumBytes,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "Workspace", code: 1, userInfo: [NSLocalizedDescriptionKey: "工作区数据格式或大小无效"])
        }
        func hasSecret(_ value: Any) -> Bool {
            if let dictionary = value as? [String: Any] {
                if dictionary.keys.contains(where: { ["apikey", "authorization", "password", "secret"].contains($0.lowercased()) }) { return true }
                return dictionary.values.contains(where: hasSecret)
            }
            if let array = value as? [Any] { return array.contains(where: hasSecret) }
            return false
        }
        if hasSecret(object) { throw NSError(domain: "Workspace", code: 2, userInfo: [NSLocalizedDescriptionKey: "密钥不得写入工作区数据"] ) }
    }
    private func openDirectory(create: Bool) throws -> Int32? {
        if create {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        }
        let descriptor = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        if descriptor < 0 {
            if !create && errno == ENOENT { return nil }
            throw posixError()
        }
        return descriptor
    }

    /// All cooperating writers use a persistent lock inode. Never unlink this lock.
    private func withLock<T>(_ action: (Int32) throws -> T) throws -> T {
        guard let directoryFD = try openDirectory(create: true) else { throw CocoaError(.fileWriteNoPermission) }
        defer { Darwin.close(directoryFD) }
        let lockFD = Darwin.openat(directoryFD, ".Workspace-v1.lock", O_RDWR | O_CREAT | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard lockFD >= 0 else { throw posixError() }
        defer { Darwin.close(lockFD) }
        var metadata = stat()
        guard Darwin.fstat(lockFD, &metadata) == 0 else { throw posixError() }
        guard metadata.st_mode & S_IFMT == S_IFREG, metadata.st_nlink == 1 else { throw CocoaError(.fileWriteNoPermission) }
        guard workspaceDarwinFlock(lockFD, LOCK_EX | LOCK_NB) == 0 else {
            if errno == EWOULDBLOCK || errno == EAGAIN {
                throw failure(3, "工作区正在由其他窗口保存，请稍后重试")
            }
            throw posixError()
        }
        defer { _ = workspaceDarwinFlock(lockFD, LOCK_UN) }
        return try action(directoryFD)
    }

    private func readBytes(_ name: String, directoryFD: Int32) throws -> Data? {
        let descriptor = Darwin.openat(directoryFD, name, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        if descriptor < 0 {
            if errno == ENOENT { return nil }
            throw posixError()
        }
        defer { Darwin.close(descriptor) }
        var metadata = stat()
        guard Darwin.fstat(descriptor, &metadata) == 0 else { throw posixError() }
        guard metadata.st_mode & S_IFMT == S_IFREG, metadata.st_size >= 0, metadata.st_size <= maximumBytes else {
            throw CocoaError(.fileReadNoPermission)
        }
        var bytes = Data()
        var buffer = [UInt8](repeating: 0, count: 65536)
        while true {
            let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
            if count < 0 {
                if errno == EINTR { continue }
                throw posixError()
            }
            if count == 0 { return bytes }
            guard bytes.count + count <= maximumBytes else { throw CocoaError(.fileReadNoPermission) }
            bytes.append(contentsOf: buffer.prefix(count))
        }
    }

    private func text(from bytes: Data?) throws -> String {
        guard let bytes else { return "{}" }
        guard let text = String(data: bytes, encoding: .utf8) else { throw CocoaError(.fileReadInapplicableStringEncoding) }
        return text
    }

    private func compare(_ source: Data?, expected: String) throws {
        let actual = try text(from: source)
        // Swift String equality ignores canonical Unicode differences; the save gate must not.
        guard Data(actual.utf8) == Data(expected.utf8) else {
            throw failure(4, "工作区已在其他窗口改变，请重新读取后再保存")
        }
    }

    private func synchronize(_ descriptor: Int32) throws {
        while Darwin.fsync(descriptor) != 0 {
            if errno == EINTR { continue }
            throw posixError()
        }
    }

    private func writeNewFile(_ bytes: Data, name: String, directoryFD: Int32) throws {
        let descriptor = Darwin.openat(directoryFD, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw posixError() }
        var complete = false
        defer {
            Darwin.close(descriptor)
            if !complete { _ = Darwin.unlinkat(directoryFD, name, 0) }
        }
        try bytes.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let count = Darwin.write(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                if count < 0 {
                    if errno == EINTR { continue }
                    throw posixError()
                }
                guard count > 0 else { throw POSIXError(.EIO) }
                offset += count
            }
        }
        guard Darwin.fchmod(descriptor, 0o600) == 0 else { throw posixError() }
        try synchronize(descriptor)
        complete = true
    }

    private func replace(_ bytes: Data, directoryFD: Int32) throws {
        let temporaryName = ".Workspace-v1-\(UUID().uuidString).tmp"
        try writeNewFile(bytes, name: temporaryName, directoryFD: directoryFD)
        defer { _ = Darwin.unlinkat(directoryFD, temporaryName, 0) }
        // Refuse symlinks/nonregular targets immediately before replacement as well as at read.
        _ = try readBytes(fileName, directoryFD: directoryFD)
        guard Darwin.renameat(directoryFD, temporaryName, directoryFD, fileName) == 0 else { throw posixError() }
        try synchronize(directoryFD)
    }

    /// Returns unvalidated UTF-8 so a malformed workspace can be preserved and recovered.
    public func rawText() throws -> String {
        guard let directoryFD = try openDirectory(create: false) else { return "{}" }
        defer { Darwin.close(directoryFD) }
        return try text(from: readBytes(fileName, directoryFD: directoryFD))
    }

    public func load() throws -> String {
        let raw = try rawText()
        try validate(raw)
        return raw
    }

    public func compareAndSave(_ text: String, expected: String) throws {
        try withLock { directoryFD in
            try compare(readBytes(fileName, directoryFD: directoryFD), expected: expected)
            try validate(text)
            try replace(Data(text.utf8), directoryFD: directoryFD)
        }
    }

    /// Explicit recovery: a verified private copy is persisted before the original is replaced.
    public func resetPreservingOriginal(expected: String) throws -> String {
        try withLock { directoryFD in
            let original = try readBytes(fileName, directoryFD: directoryFD)
            try compare(original, expected: expected)
            var backupPath = ""
            if let original {
                let name = "Workspace-recovery-\(UUID().uuidString).json"
                try writeNewFile(original, name: name, directoryFD: directoryFD)
                guard try readBytes(name, directoryFD: directoryFD) == original else { throw POSIXError(.EIO) }
                try synchronize(directoryFD)
                backupPath = directory.appendingPathComponent(name).path
            }
            try replace(Data("{}".utf8), directoryFD: directoryFD)
            return backupPath
        }
    }

    /// Unconditional save is retained for trusted setup; normal bridge writes use compareAndSave.
    public func save(_ text: String) throws {
        try withLock { directoryFD in
            try validate(text)
            try replace(Data(text.utf8), directoryFD: directoryFD)
        }
    }
}
