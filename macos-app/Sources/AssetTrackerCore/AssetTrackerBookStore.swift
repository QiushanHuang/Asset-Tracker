import CryptoKit
import Foundation

public enum AssetTrackerRawBookStatus: String, Equatable, Sendable {
    case missing
    case readableBytes
    case invalidUTF8
    case ioError
}

public enum AssetTrackerRawBookIOReason: String, Equatable, Sendable {
    case permissionDenied
    case notRegularFile
    case readFailed
}

public struct AssetTrackerRawBookLoadResult: Equatable, Sendable {
    public let status: AssetTrackerRawBookStatus
    public let reason: AssetTrackerRawBookIOReason?
    public let data: Data?
    public let stateJson: String?
    public let rawHash: String?
    public let hashAlgorithm: String
    public let storagePath: String
    public let updatedAt: Date?
    public let canExportRaw: Bool
    public let canRevealFolder: Bool

    public init(
        status: AssetTrackerRawBookStatus,
        reason: AssetTrackerRawBookIOReason? = nil,
        data: Data? = nil,
        stateJson: String? = nil,
        rawHash: String? = nil,
        hashAlgorithm: String = "sha256",
        storagePath: String,
        updatedAt: Date? = nil,
        canExportRaw: Bool = false,
        canRevealFolder: Bool = true
    ) {
        self.status = status
        self.reason = reason
        self.data = data
        self.stateJson = stateJson
        self.rawHash = rawHash
        self.hashAlgorithm = hashAlgorithm
        self.storagePath = storagePath
        self.updatedAt = updatedAt
        self.canExportRaw = canExportRaw
        self.canRevealFolder = canRevealFolder
    }

    public static func missingResult(path: String) -> Self {
        Self(status: .missing, storagePath: path)
    }

    public static func readableResult(hash: String, path: String) -> Self {
        Self(
            status: .readableBytes,
            rawHash: hash,
            storagePath: path,
            canExportRaw: true
        )
    }

    public static func invalidUTF8Result(hash: String, path: String) -> Self {
        Self(
            status: .invalidUTF8,
            rawHash: hash,
            storagePath: path,
            canExportRaw: true
        )
    }

    public static func ioErrorResult(reason: AssetTrackerRawBookIOReason, path: String) -> Self {
        Self(status: .ioError, reason: reason, storagePath: path)
    }
}

public enum AssetTrackerBookStoreError: Error, Equatable, LocalizedError {
    case sourceMissing
    case sourceUnreadable
    case sourceHashMismatch
    case destinationMatchesSource
    case invalidStateJSON

    public var errorDescription: String? {
        switch self {
        case .sourceMissing:
            return "原始账本文件不存在"
        case .sourceUnreadable:
            return "无法读取原始账本文件"
        case .sourceHashMismatch:
            return "原始账本已发生变化，未执行导出"
        case .destinationMatchesSource:
            return "导出位置不能是原始账本或其链接"
        case .invalidStateJSON:
            return "待保存的账本 JSON 无效"
        }
    }
}

public struct AssetTrackerRawExportResult: Equatable, Sendable {
    public let rawHash: String
    public let byteCount: Int
    public let destinationPath: String
}

public struct AssetTrackerBookSaveResult: Equatable, Sendable {
    public let rawHash: String
    public let updatedAt: Date
    public let storagePath: String
}

public final class AssetTrackerBookStore: AssetTrackerBookStoreIO, @unchecked Sendable {
    public let storageDirectoryURL: URL
    public let storageFileURL: URL

    private let fileManager: FileManager
    private let readData: (URL) throws -> Data

    public init(
        storageDirectoryURL: URL,
        fileManager: FileManager = .default,
        readData: @escaping (URL) throws -> Data = { try Data(contentsOf: $0) }
    ) {
        self.storageDirectoryURL = storageDirectoryURL.standardizedFileURL
        self.storageFileURL = storageDirectoryURL.standardizedFileURL
            .appendingPathComponent("AssetTrackerBook.json", isDirectory: false)
        self.fileManager = fileManager
        self.readData = readData
    }

    public func load() -> AssetTrackerRawBookLoadResult {
        let path = storageFileURL.path
        let attributes: [FileAttributeKey: Any]
        do {
            attributes = try fileManager.attributesOfItem(atPath: path)
        } catch let error as NSError where isMissingFileError(error) {
            return .missingResult(path: path)
        } catch let error as NSError {
            return ioErrorResult(for: error, path: path)
        }

        guard attributes[.type] as? FileAttributeType == .typeRegular else {
            return .ioErrorResult(reason: .notRegularFile, path: path)
        }

        do {
            let data = try readData(storageFileURL)
            let rawHash = Self.sha256Hex(data)
            let updatedAt = attributes[.modificationDate] as? Date
            guard let stateJson = String(data: data, encoding: .utf8) else {
                return AssetTrackerRawBookLoadResult(
                    status: .invalidUTF8,
                    data: data,
                    rawHash: rawHash,
                    storagePath: path,
                    updatedAt: updatedAt,
                    canExportRaw: true
                )
            }
            return AssetTrackerRawBookLoadResult(
                status: .readableBytes,
                data: data,
                stateJson: stateJson,
                rawHash: rawHash,
                storagePath: path,
                updatedAt: updatedAt,
                canExportRaw: true
            )
        } catch let error as NSError {
            return ioErrorResult(for: error, path: path)
        }
    }

    public func exportRawBook(expectedHash: String, to destinationURL: URL) throws -> AssetTrackerRawExportResult {
        let destination = destinationURL.standardizedFileURL
        guard fileManager.fileExists(atPath: storageFileURL.path) else {
            throw AssetTrackerBookStoreError.sourceMissing
        }
        try rejectSourceIdentity(destination)

        let data: Data
        do {
            data = try readData(storageFileURL)
        } catch {
            throw AssetTrackerBookStoreError.sourceUnreadable
        }
        let currentHash = Self.sha256Hex(data)
        guard currentHash == expectedHash else {
            throw AssetTrackerBookStoreError.sourceHashMismatch
        }

        try fileManager.createDirectory(
            at: destination.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: destination, options: .atomic)
        return AssetTrackerRawExportResult(
            rawHash: currentHash,
            byteCount: data.count,
            destinationPath: destination.path
        )
    }

    public func save(
        stateJson: String,
        schemaVersion: Int,
        reason: String
    ) throws -> AssetTrackerBookSaveResult {
        let payloadData = Data(stateJson.utf8)
        let payloadObject: Any
        do {
            payloadObject = try JSONSerialization.jsonObject(with: payloadData)
        } catch {
            throw AssetTrackerBookStoreError.invalidStateJSON
        }
        guard payloadObject is [String: Any] else {
            throw AssetTrackerBookStoreError.invalidStateJSON
        }

        let updatedAt = Date()
        let envelope: [String: Any] = [
            "format": "qiushan.asset-book",
            "formatVersion": 1,
            "schemaVersion": schemaVersion,
            "domainCapabilityVersion": 1,
            "minimumReaderVersion": 1,
            "exportedAt": Self.iso8601String(updatedAt),
            "source": "macos-app",
            "reason": reason,
            "payload": payloadObject
        ]
        let data = try JSONSerialization.data(withJSONObject: envelope, options: [.prettyPrinted, .sortedKeys])
        try fileManager.createDirectory(
            at: storageDirectoryURL,
            withIntermediateDirectories: true,
            attributes: nil
        )
        try data.write(to: storageFileURL, options: .atomic)
        return AssetTrackerBookSaveResult(
            rawHash: Self.sha256Hex(data),
            updatedAt: updatedAt,
            storagePath: storageFileURL.path
        )
    }

    public static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func iso8601String(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func ioErrorResult(for error: NSError, path: String) -> AssetTrackerRawBookLoadResult {
        let permissionCodes = [
            NSFileReadNoPermissionError,
            NSFileWriteNoPermissionError
        ]
        let reason: AssetTrackerRawBookIOReason = error.domain == NSCocoaErrorDomain && permissionCodes.contains(error.code)
            ? .permissionDenied
            : .readFailed
        return .ioErrorResult(reason: reason, path: path)
    }

    private func isMissingFileError(_ error: NSError) -> Bool {
        error.domain == NSCocoaErrorDomain && [
            NSFileNoSuchFileError,
            NSFileReadNoSuchFileError
        ].contains(error.code)
    }

    private func rejectSourceIdentity(_ destination: URL) throws {
        let sourceStandardized = storageFileURL.standardizedFileURL
        let destinationStandardized = destination.standardizedFileURL
        if sourceStandardized == destinationStandardized {
            throw AssetTrackerBookStoreError.destinationMatchesSource
        }

        let sourceResolved = sourceStandardized.resolvingSymlinksInPath()
        let destinationResolved = destinationStandardized.resolvingSymlinksInPath()
        if sourceResolved == destinationResolved {
            throw AssetTrackerBookStoreError.destinationMatchesSource
        }

        guard fileManager.fileExists(atPath: destinationStandardized.path) else { return }
        let sourceAttributes = try fileManager.attributesOfItem(atPath: sourceStandardized.path)
        let destinationAttributes = try fileManager.attributesOfItem(atPath: destinationStandardized.path)
        let sameSystem = (sourceAttributes[.systemNumber] as? NSNumber) == (destinationAttributes[.systemNumber] as? NSNumber)
        let sameFile = (sourceAttributes[.systemFileNumber] as? NSNumber) == (destinationAttributes[.systemFileNumber] as? NSNumber)
        if sameSystem && sameFile {
            throw AssetTrackerBookStoreError.destinationMatchesSource
        }
    }
}

public enum AssetTrackerLegacyWriteGateState: Equatable, Sendable {
    case neverLoaded
    case candidateMissing(loadID: String)
    case candidateExisting(loadID: String, rawHash: String)
    case retryCandidateExisting(loadID: String, rawHash: String)
    case validatedMissing(loadID: String, token: String)
    case validatedExisting(loadID: String, rawHash: String, token: String)
    case recoverableLocked(reason: String)
    case terminalLocked(reason: String)
}

public enum AssetTrackerLoadConfirmationOutcome: String, Equatable, Sendable {
    case missing
    case valid
    case recovery
}

public struct AssetTrackerLoadConfirmation: Equatable, Sendable {
    public let writeSessionToken: String?
}

public struct AssetTrackerSaveAuthorization: Equatable, Sendable {
    public let protocolVersion: Int?
    public let loadID: String
    public let writeSessionToken: String?
    public let expectedHash: String?
    public let validatedSourceHash: String?

    public init(
        protocolVersion: Int?,
        loadID: String,
        writeSessionToken: String?,
        expectedHash: String?,
        validatedSourceHash: String?
    ) {
        self.protocolVersion = protocolVersion
        self.loadID = loadID
        self.writeSessionToken = writeSessionToken
        self.expectedHash = expectedHash
        self.validatedSourceHash = validatedSourceHash
    }
}

public struct AssetTrackerTerminalizationRequest: Equatable, Sendable {
    public let protocolVersion: Int?
    public let loadID: String
    public let writeSessionToken: String?
    public let reason: String

    public init(
        protocolVersion: Int?,
        loadID: String,
        writeSessionToken: String?,
        reason: String
    ) {
        self.protocolVersion = protocolVersion
        self.loadID = loadID
        self.writeSessionToken = writeSessionToken
        self.reason = reason
    }
}

public struct AssetTrackerTerminalizationAcknowledgement: Equatable, Sendable {
    public let reason: String

    public init(reason: String) {
        self.reason = reason
    }
}

public enum AssetTrackerWriteGateError: Error, Equatable, LocalizedError {
    case unsupportedProtocol
    case illegalTransition
    case staleLoadID
    case sourceHashMismatch
    case missingWriteSessionToken
    case invalidWriteSessionToken
    case sourceChanged
    case notValidated
    case terminalLocked

    public var errorDescription: String? {
        switch self {
        case .unsupportedProtocol:
            return "不支持旧版本存储协议"
        case .illegalTransition:
            return "账本打开确认状态无效"
        case .staleLoadID:
            return "账本读取标识已过期"
        case .sourceHashMismatch:
            return "账本原始哈希不匹配"
        case .missingWriteSessionToken:
            return "缺少本次安全打开的写入令牌"
        case .invalidWriteSessionToken:
            return "写入令牌无效"
        case .sourceChanged:
            return "验证后的原始账本已变化"
        case .notValidated:
            return "账本未完成安全打开确认"
        case .terminalLocked:
            return "本次进程已终止写入，请重新启动"
        }
    }
}

public final class AssetTrackerLegacyWriteGate {
    public private(set) var state: AssetTrackerLegacyWriteGateState = .neverLoaded

    private let loadIDGenerator: () -> String
    private let tokenGenerator: () -> String
    private var terminalizedLoadID: String?
    private var terminalizedToken: String?

    public init(
        loadIDGenerator: @escaping () -> String = { UUID().uuidString.lowercased() },
        tokenGenerator: @escaping () -> String = {
            "\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))".lowercased()
        }
    ) {
        self.loadIDGenerator = loadIDGenerator
        self.tokenGenerator = tokenGenerator
    }

    @discardableResult
    public func registerLoad(_ result: AssetTrackerRawBookLoadResult, retry: Bool) -> String {
        let loadID = loadIDGenerator()
        if case .terminalLocked = state {
            return loadID
        }

        switch (state, retry, result.status) {
        case (.neverLoaded, false, .missing):
            state = .candidateMissing(loadID: loadID)
        case (.neverLoaded, false, .readableBytes):
            if let rawHash = result.rawHash {
                state = .candidateExisting(loadID: loadID, rawHash: rawHash)
            } else {
                state = .recoverableLocked(reason: "missingRawHash")
            }
        case (.neverLoaded, false, .invalidUTF8):
            state = .recoverableLocked(reason: "invalidUTF8")
        case (.neverLoaded, false, .ioError):
            state = .recoverableLocked(reason: result.reason?.rawValue ?? "readFailed")
        case (.recoverableLocked, true, .missing):
            state = .recoverableLocked(reason: "sourceMissingDuringRetry")
        case (.recoverableLocked, true, .readableBytes):
            if let rawHash = result.rawHash {
                state = .retryCandidateExisting(loadID: loadID, rawHash: rawHash)
            } else {
                state = .recoverableLocked(reason: "missingRawHash")
            }
        case (.recoverableLocked, true, .invalidUTF8):
            state = .recoverableLocked(reason: "invalidUTF8")
        case (.recoverableLocked, true, .ioError):
            state = .recoverableLocked(reason: result.reason?.rawValue ?? "readFailed")
        default:
            state = .recoverableLocked(reason: "illegalLoadTransition")
        }
        return loadID
    }

    public func confirm(
        protocolVersion: Int?,
        loadID: String,
        outcome: AssetTrackerLoadConfirmationOutcome,
        reason: String?,
        validatedSourceHash: String?
    ) throws -> AssetTrackerLoadConfirmation {
        guard protocolVersion == 2 else { throw AssetTrackerWriteGateError.unsupportedProtocol }
        if case .terminalLocked = state { throw AssetTrackerWriteGateError.terminalLocked }

        switch state {
        case .candidateMissing(let candidateLoadID):
            guard candidateLoadID == loadID else { throw AssetTrackerWriteGateError.staleLoadID }
            switch outcome {
            case .missing:
                guard validatedSourceHash == nil else { throw AssetTrackerWriteGateError.sourceHashMismatch }
                return try validateMissing(loadID: loadID)
            case .recovery:
                guard validatedSourceHash == nil else { throw AssetTrackerWriteGateError.sourceHashMismatch }
                return lockRecovery(reason: reason, loadID: candidateLoadID)
            case .valid:
                throw AssetTrackerWriteGateError.illegalTransition
            }
        case .candidateExisting(let candidateLoadID, let rawHash),
             .retryCandidateExisting(let candidateLoadID, let rawHash):
            guard candidateLoadID == loadID else { throw AssetTrackerWriteGateError.staleLoadID }
            guard validatedSourceHash == rawHash else { throw AssetTrackerWriteGateError.sourceHashMismatch }
            switch outcome {
            case .valid:
                return try validateExisting(loadID: loadID, rawHash: rawHash)
            case .recovery:
                return lockRecovery(reason: reason, loadID: candidateLoadID)
            case .missing:
                throw AssetTrackerWriteGateError.illegalTransition
            }
        default:
            throw AssetTrackerWriteGateError.illegalTransition
        }
    }

    public func authorizeSave(
        _ request: AssetTrackerSaveAuthorization,
        currentSource: AssetTrackerRawBookLoadResult
    ) throws {
        try preflightSave(request)

        switch state {
        case .validatedMissing:
            guard currentSource.status == .missing else { throw AssetTrackerWriteGateError.sourceChanged }
        case .validatedExisting(_, let rawHash, _):
            guard currentSource.status == .readableBytes, currentSource.rawHash == rawHash else {
                throw AssetTrackerWriteGateError.sourceChanged
            }
        default:
            throw AssetTrackerWriteGateError.notValidated
        }
    }

    public func preflightSave(_ request: AssetTrackerSaveAuthorization) throws {
        guard request.protocolVersion == 2 else { throw AssetTrackerWriteGateError.unsupportedProtocol }
        if case .terminalLocked = state { throw AssetTrackerWriteGateError.terminalLocked }

        switch state {
        case .validatedMissing(let loadID, let token):
            try validateSession(request, loadID: loadID, token: token)
            guard request.expectedHash == nil, request.validatedSourceHash == nil else {
                throw AssetTrackerWriteGateError.sourceHashMismatch
            }
        case .validatedExisting(let loadID, let rawHash, let token):
            try validateSession(request, loadID: loadID, token: token)
            guard request.expectedHash == rawHash, request.validatedSourceHash == rawHash else {
                throw AssetTrackerWriteGateError.sourceHashMismatch
            }
        default:
            throw AssetTrackerWriteGateError.notValidated
        }
    }

    public func preflightTerminalization(
        _ request: AssetTrackerTerminalizationRequest
    ) throws -> AssetTrackerTerminalizationAcknowledgement? {
        guard request.protocolVersion == 2 else { throw AssetTrackerWriteGateError.unsupportedProtocol }
        guard request.reason == "internalError.postRender" || request.reason == "renderError.postRender" else {
            throw AssetTrackerWriteGateError.illegalTransition
        }

        if case .terminalLocked(let firstReason) = state {
            try validateTerminalizedSession(request)
            return AssetTrackerTerminalizationAcknowledgement(reason: firstReason)
        }

        let (loadID, token) = try terminalizationSession()
        try validateTerminalizationRequest(request, loadID: loadID, token: token)
        return nil
    }

    @discardableResult
    public func terminalize(
        _ request: AssetTrackerTerminalizationRequest
    ) throws -> AssetTrackerTerminalizationAcknowledgement {
        if let acknowledgement = try preflightTerminalization(request) {
            return acknowledgement
        }

        let (loadID, token) = try terminalizationSession()
        terminalizedLoadID = loadID
        terminalizedToken = token
        state = .terminalLocked(reason: request.reason)
        return AssetTrackerTerminalizationAcknowledgement(reason: request.reason)
    }

    public func recordSuccessfulSave(newRawHash: String) throws {
        guard !newRawHash.isEmpty else { throw AssetTrackerWriteGateError.sourceHashMismatch }
        switch state {
        case .validatedMissing(let loadID, let token):
            state = .validatedExisting(loadID: loadID, rawHash: newRawHash, token: token)
        case .validatedExisting(let loadID, _, let token):
            state = .validatedExisting(loadID: loadID, rawHash: newRawHash, token: token)
        case .terminalLocked:
            throw AssetTrackerWriteGateError.terminalLocked
        default:
            throw AssetTrackerWriteGateError.notValidated
        }
    }

    private func validateMissing(loadID: String) throws -> AssetTrackerLoadConfirmation {
        let token = tokenGenerator()
        guard !token.isEmpty else { throw AssetTrackerWriteGateError.illegalTransition }
        state = .validatedMissing(loadID: loadID, token: token)
        return AssetTrackerLoadConfirmation(writeSessionToken: token)
    }

    private func validateExisting(loadID: String, rawHash: String) throws -> AssetTrackerLoadConfirmation {
        let token = tokenGenerator()
        guard !token.isEmpty else { throw AssetTrackerWriteGateError.illegalTransition }
        state = .validatedExisting(loadID: loadID, rawHash: rawHash, token: token)
        return AssetTrackerLoadConfirmation(writeSessionToken: token)
    }

    private func lockRecovery(reason: String?, loadID: String) -> AssetTrackerLoadConfirmation {
        let stableReason = reason ?? "recovery"
        if stableReason.hasSuffix(".postRender") || stableReason.hasPrefix("renderError") {
            terminalizedLoadID = loadID
            terminalizedToken = nil
            state = .terminalLocked(reason: stableReason)
        } else {
            state = .recoverableLocked(reason: stableReason)
        }
        return AssetTrackerLoadConfirmation(writeSessionToken: nil)
    }

    private func validateSession(
        _ request: AssetTrackerSaveAuthorization,
        loadID: String,
        token: String
    ) throws {
        guard request.loadID == loadID else { throw AssetTrackerWriteGateError.staleLoadID }
        guard let requestToken = request.writeSessionToken else {
            throw AssetTrackerWriteGateError.missingWriteSessionToken
        }
        guard requestToken == token else { throw AssetTrackerWriteGateError.invalidWriteSessionToken }
    }

    private func validateTerminalizationRequest(
        _ request: AssetTrackerTerminalizationRequest,
        loadID: String,
        token: String?
    ) throws {
        guard request.loadID == loadID else { throw AssetTrackerWriteGateError.staleLoadID }
        if let requestToken = request.writeSessionToken {
            guard let token, requestToken == token else {
                throw AssetTrackerWriteGateError.invalidWriteSessionToken
            }
        }
    }

    private func validateTerminalizedSession(_ request: AssetTrackerTerminalizationRequest) throws {
        guard let loadID = terminalizedLoadID else {
            throw AssetTrackerWriteGateError.terminalLocked
        }
        try validateTerminalizationRequest(request, loadID: loadID, token: terminalizedToken)
    }

    private func terminalizationSession() throws -> (loadID: String, token: String?) {
        switch state {
        case .candidateMissing(let loadID),
             .candidateExisting(let loadID, _),
             .retryCandidateExisting(let loadID, _):
            return (loadID, nil)
        case .validatedMissing(let loadID, let token),
             .validatedExisting(let loadID, _, let token):
            return (loadID, token)
        default:
            throw AssetTrackerWriteGateError.notValidated
        }
    }
}
