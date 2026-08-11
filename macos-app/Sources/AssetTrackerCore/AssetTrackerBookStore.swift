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
    public let recoveryHealthComplete: Bool
    public let ordinaryRecoveryHealth: NativeRecoveryHealth?
    public let snapshotRecoveryHealth: NativeRecoveryHealth?

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
        canRevealFolder: Bool = true,
        recoveryHealthComplete: Bool = false,
        ordinaryRecoveryHealth: NativeRecoveryHealth? = nil,
        snapshotRecoveryHealth: NativeRecoveryHealth? = nil
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
        self.recoveryHealthComplete = recoveryHealthComplete
        self.ordinaryRecoveryHealth = ordinaryRecoveryHealth
        self.snapshotRecoveryHealth = snapshotRecoveryHealth
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
    case invalidNativeEnvelope
    case invalidDurableReceipt

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
        case .invalidNativeEnvelope:
            return "无法生成可验证的本机账本封装"
        case .invalidDurableReceipt:
            return "本机持久化回执无效"
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

public enum NativeDurability: String, Codable, Sendable {
    case nativeDurable
}

public enum NativeSnapshotReason: String, Codable, Sendable {
    case manual
    case scheduled
}

public enum NativeSnapshotStatus: String, Codable, Sendable {
    case created
    case deduplicated
}

public enum NativeWriteOutcome: String, Codable, Sendable {
    case notCommitted
    case unknown
}

public enum NativeSnapshotOutcome: String, Codable, Sendable {
    case notCreated
    case unknown
}

public enum NativeOperationConflict: Equatable, Sendable {
    case none
    case sourceChanged
    case sessionInvalid
}

public struct DurableBookSaveRequest: Equatable, Sendable {
    public let clientSaveID: String
    public let expectedSource: ExpectedBookSource
    public let payloadHash: String
    public let stateJSON: String
    public let schemaVersion: Int
    public let reason: String
    public let authorization: AssetTrackerSaveAuthorization

    public init(
        clientSaveID: String,
        expectedSource: ExpectedBookSource,
        payloadHash: String,
        stateJSON: String,
        schemaVersion: Int,
        reason: String,
        authorization: AssetTrackerSaveAuthorization
    ) {
        self.clientSaveID = clientSaveID
        self.expectedSource = expectedSource
        self.payloadHash = payloadHash
        self.stateJSON = stateJSON
        self.schemaVersion = schemaVersion
        self.reason = reason
        self.authorization = authorization
    }
}

public struct NativeDurableSaveReceipt: Equatable, Sendable {
    public let clientSaveID: String
    public let sourceHashBefore: String?
    public let payloadHash: String
    public let stateHashAfter: String
    public let byteCount: Int
    public let durability: NativeDurability
    public let previousSlotHashes: [String]
    public let recoveryHealth: NativeRecoveryHealth
    public let updatedAt: Date
    public let storagePath: String

    public init(
        clientSaveID: String,
        sourceHashBefore: String?,
        payloadHash: String,
        stateHashAfter: String,
        byteCount: Int,
        durability: NativeDurability,
        previousSlotHashes: [String],
        recoveryHealth: NativeRecoveryHealth,
        updatedAt: Date,
        storagePath: String
    ) {
        self.clientSaveID = clientSaveID
        self.sourceHashBefore = sourceHashBefore
        self.payloadHash = payloadHash
        self.stateHashAfter = stateHashAfter
        self.byteCount = byteCount
        self.durability = durability
        self.previousSlotHashes = previousSlotHashes
        self.recoveryHealth = recoveryHealth
        self.updatedAt = updatedAt
        self.storagePath = storagePath
    }
}

public struct NativeSnapshotRequest: Equatable, Sendable {
    public let clientSnapshotID: String
    public let reason: NativeSnapshotReason
    public let expectedHash: String
    public let authorization: AssetTrackerSaveAuthorization

    public init(
        clientSnapshotID: String,
        reason: NativeSnapshotReason,
        expectedHash: String,
        authorization: AssetTrackerSaveAuthorization
    ) {
        self.clientSnapshotID = clientSnapshotID
        self.reason = reason
        self.expectedHash = expectedHash
        self.authorization = authorization
    }
}

public struct NativeSnapshotReceipt: Equatable, Sendable {
    public let clientSnapshotID: String
    public let sourceHash: String
    public let snapshotHash: String
    public let ordinal: UInt64
    public let snapshotStatus: NativeSnapshotStatus
    public let durability: NativeDurability
    public let retainedCount: Int
    public let recoveryHealth: NativeRecoveryHealth

    public init(
        clientSnapshotID: String,
        sourceHash: String,
        snapshotHash: String,
        ordinal: UInt64,
        snapshotStatus: NativeSnapshotStatus,
        durability: NativeDurability,
        retainedCount: Int,
        recoveryHealth: NativeRecoveryHealth
    ) {
        self.clientSnapshotID = clientSnapshotID
        self.sourceHash = sourceHash
        self.snapshotHash = snapshotHash
        self.ordinal = ordinal
        self.snapshotStatus = snapshotStatus
        self.durability = durability
        self.retainedCount = retainedCount
        self.recoveryHealth = recoveryHealth
    }
}

public struct NativeDurableSaveErrorProof: Error, Equatable, Sendable {
    public let code: String
    public let message: String
    public let writeOutcome: NativeWriteOutcome
    public let conflict: NativeOperationConflict
    public let clientSaveID: String
    public let payloadHash: String
    public let sourceHashAfter: String?
    public let sourceReverified: Bool
    public let coordinatorReleased: Bool
    public let healthPersisted: Bool
    public let recoveryHealthEvidence: NativeRecoveryHealth?

    public init(
        code: String,
        message: String,
        writeOutcome: NativeWriteOutcome,
        conflict: NativeOperationConflict,
        clientSaveID: String,
        payloadHash: String,
        sourceHashAfter: String?,
        sourceReverified: Bool,
        coordinatorReleased: Bool,
        healthPersisted: Bool,
        recoveryHealthEvidence: NativeRecoveryHealth?
    ) {
        self.code = code
        self.message = message
        self.writeOutcome = writeOutcome
        self.conflict = conflict
        self.clientSaveID = clientSaveID
        self.payloadHash = payloadHash
        self.sourceHashAfter = sourceHashAfter
        self.sourceReverified = sourceReverified
        self.coordinatorReleased = coordinatorReleased
        self.healthPersisted = healthPersisted
        self.recoveryHealthEvidence = recoveryHealthEvidence
    }
}

public struct NativeSnapshotErrorProof: Error, Equatable, Sendable {
    public let code: String
    public let message: String
    public let snapshotOutcome: NativeSnapshotOutcome
    public let conflict: NativeOperationConflict
    public let clientSnapshotID: String
    public let sourceHashAfter: String?
    public let sourceReverified: Bool
    public let coordinatorReleased: Bool
    public let healthPersisted: Bool
    public let recoveryHealthEvidence: NativeRecoveryHealth?

    public init(
        code: String,
        message: String,
        snapshotOutcome: NativeSnapshotOutcome,
        conflict: NativeOperationConflict,
        clientSnapshotID: String,
        sourceHashAfter: String?,
        sourceReverified: Bool,
        coordinatorReleased: Bool,
        healthPersisted: Bool,
        recoveryHealthEvidence: NativeRecoveryHealth?
    ) {
        self.code = code
        self.message = message
        self.snapshotOutcome = snapshotOutcome
        self.conflict = conflict
        self.clientSnapshotID = clientSnapshotID
        self.sourceHashAfter = sourceHashAfter
        self.sourceReverified = sourceReverified
        self.coordinatorReleased = coordinatorReleased
        self.healthPersisted = healthPersisted
        self.recoveryHealthEvidence = recoveryHealthEvidence
    }
}

public enum NativeDurableDTOValidationError: Error, Equatable, Sendable {
    case emptyField(String)
    case invalidHash(String)
    case hashMismatch(String)
    case invalidStateJSON
    case unsupportedSchemaVersion(Int)
    case invalidAuthorization
    case invalidByteCount(Int)
    case invalidPreviousSlotHashes
    case invalidRetainedCount(Int)
    case invalidOrdinal(UInt64)
    case invalidDate
    case invalidStoragePath
    case invalidRecoveryHealth
    case invalidRecoveryHealthEvidence
    case receiptMismatch(String)
}

public enum NativeDurableDTOValidator {
    private static let supportedSchemaVersion = 1
    private static let maximumSnapshotRetainedCount = 24
    private static let maximumJavaScriptInteger = UInt64(9_007_199_254_740_991)

    public static func validate(_ request: DurableBookSaveRequest) throws {
        try requireNonempty(request.clientSaveID, field: "clientSaveID")
        try requireCanonicalHash(request.payloadHash, field: "payloadHash")
        guard !request.stateJSON.isEmpty else {
            throw NativeDurableDTOValidationError.emptyField("stateJSON")
        }
        guard AssetTrackerBookStore.sha256Hex(Data(request.stateJSON.utf8)) == request.payloadHash else {
            throw NativeDurableDTOValidationError.hashMismatch("payloadHash")
        }
        guard
            let object = try? JSONSerialization.jsonObject(with: Data(request.stateJSON.utf8)),
            object is [String: Any]
        else {
            throw NativeDurableDTOValidationError.invalidStateJSON
        }
        guard request.schemaVersion == supportedSchemaVersion else {
            throw NativeDurableDTOValidationError.unsupportedSchemaVersion(request.schemaVersion)
        }
        try requireNonempty(request.reason, field: "reason")
        try validateAuthorization(request.authorization, expectedSource: request.expectedSource)
    }

    public static func validate(_ request: NativeSnapshotRequest) throws {
        try requireNonempty(request.clientSnapshotID, field: "clientSnapshotID")
        try requireCanonicalHash(request.expectedHash, field: "expectedHash")
        try validateAuthorization(
            request.authorization,
            expectedSource: .sha256(request.expectedHash)
        )
    }

    public static func validate(_ receipt: NativeDurableSaveReceipt) throws {
        try requireNonempty(receipt.clientSaveID, field: "clientSaveID")
        if let sourceHashBefore = receipt.sourceHashBefore {
            try requireCanonicalHash(sourceHashBefore, field: "sourceHashBefore")
        }
        try requireCanonicalHash(receipt.payloadHash, field: "payloadHash")
        try requireCanonicalHash(receipt.stateHashAfter, field: "stateHashAfter")
        guard receipt.byteCount > 0,
              UInt64(receipt.byteCount) <= maximumJavaScriptInteger else {
            throw NativeDurableDTOValidationError.invalidByteCount(receipt.byteCount)
        }
        guard receipt.previousSlotHashes.count <= 2,
              Set(receipt.previousSlotHashes).count == receipt.previousSlotHashes.count,
              !receipt.previousSlotHashes.contains(receipt.stateHashAfter) else {
            throw NativeDurableDTOValidationError.invalidPreviousSlotHashes
        }
        for hash in receipt.previousSlotHashes {
            do {
                try requireCanonicalHash(hash, field: "previousSlotHashes")
            } catch {
                throw NativeDurableDTOValidationError.invalidPreviousSlotHashes
            }
        }
        try validateSuccessHealth(receipt.recoveryHealth, expectedDomain: .ordinary)
        guard receipt.updatedAt.timeIntervalSinceReferenceDate.isFinite else {
            throw NativeDurableDTOValidationError.invalidDate
        }
        try validateCanonicalStoragePath(receipt.storagePath)
    }

    public static func validate(
        _ receipt: NativeDurableSaveReceipt,
        matching request: DurableBookSaveRequest
    ) throws {
        try validate(request)
        try validate(receipt)
        guard receipt.clientSaveID == request.clientSaveID else {
            throw NativeDurableDTOValidationError.receiptMismatch("clientSaveID")
        }
        guard receipt.payloadHash == request.payloadHash else {
            throw NativeDurableDTOValidationError.receiptMismatch("payloadHash")
        }
        let expectedHash: String?
        switch request.expectedSource {
        case .missing:
            expectedHash = nil
        case .sha256(let hash):
            expectedHash = hash
        }
        guard receipt.sourceHashBefore == expectedHash else {
            throw NativeDurableDTOValidationError.receiptMismatch("sourceHashBefore")
        }
    }

    public static func validate(_ receipt: NativeSnapshotReceipt) throws {
        try requireNonempty(receipt.clientSnapshotID, field: "clientSnapshotID")
        try requireCanonicalHash(receipt.sourceHash, field: "sourceHash")
        try requireCanonicalHash(receipt.snapshotHash, field: "snapshotHash")
        guard receipt.sourceHash == receipt.snapshotHash else {
            throw NativeDurableDTOValidationError.hashMismatch("snapshotHash")
        }
        guard receipt.ordinal <= maximumJavaScriptInteger,
              receipt.ordinal <= UInt64(Int.max) else {
            throw NativeDurableDTOValidationError.invalidOrdinal(receipt.ordinal)
        }
        guard (1...maximumSnapshotRetainedCount).contains(receipt.retainedCount) else {
            throw NativeDurableDTOValidationError.invalidRetainedCount(receipt.retainedCount)
        }
        try validateSuccessHealth(receipt.recoveryHealth, expectedDomain: .snapshot)
    }

    public static func validate(
        _ receipt: NativeSnapshotReceipt,
        matching request: NativeSnapshotRequest
    ) throws {
        try validate(request)
        try validate(receipt)
        guard receipt.clientSnapshotID == request.clientSnapshotID else {
            throw NativeDurableDTOValidationError.receiptMismatch("clientSnapshotID")
        }
        guard receipt.sourceHash == request.expectedHash,
              receipt.snapshotHash == request.expectedHash else {
            throw NativeDurableDTOValidationError.receiptMismatch("expectedHash")
        }
    }

    public static func validate(_ proof: NativeDurableSaveErrorProof) throws {
        try requireNonempty(proof.code, field: "code")
        try requireNonempty(proof.message, field: "message")
        try requireNonempty(proof.clientSaveID, field: "clientSaveID")
        try requireCanonicalHash(proof.payloadHash, field: "payloadHash")
        if let sourceHashAfter = proof.sourceHashAfter {
            try requireCanonicalHash(sourceHashAfter, field: "sourceHashAfter")
        }
        try validateHealthEvidence(
            persisted: proof.healthPersisted,
            health: proof.recoveryHealthEvidence,
            expectedDomain: .ordinary
        )
    }

    public static func validate(_ proof: NativeSnapshotErrorProof) throws {
        try requireNonempty(proof.code, field: "code")
        try requireNonempty(proof.message, field: "message")
        try requireNonempty(proof.clientSnapshotID, field: "clientSnapshotID")
        if let sourceHashAfter = proof.sourceHashAfter {
            try requireCanonicalHash(sourceHashAfter, field: "sourceHashAfter")
        }
        try validateHealthEvidence(
            persisted: proof.healthPersisted,
            health: proof.recoveryHealthEvidence,
            expectedDomain: .snapshot
        )
    }

    private static func validateAuthorization(
        _ authorization: AssetTrackerSaveAuthorization,
        expectedSource: ExpectedBookSource
    ) throws {
        guard authorization.protocolVersion == 2,
              !authorization.loadID.isEmpty,
              let token = authorization.writeSessionToken,
              !token.isEmpty else {
            throw NativeDurableDTOValidationError.invalidAuthorization
        }

        switch expectedSource {
        case .missing:
            guard authorization.expectedHash == nil,
                  authorization.validatedSourceHash == nil else {
                throw NativeDurableDTOValidationError.invalidAuthorization
            }
        case .sha256(let hash):
            try requireCanonicalHash(hash, field: "expectedSource")
            guard authorization.expectedHash == hash,
                  authorization.validatedSourceHash == hash else {
                throw NativeDurableDTOValidationError.invalidAuthorization
            }
        }
    }

    private static func validateSuccessHealth(
        _ health: NativeRecoveryHealth,
        expectedDomain: NativeRecoveryDomain
    ) throws {
        guard health.domain == expectedDomain,
              health.status != .notApplicable else {
            throw NativeDurableDTOValidationError.invalidRecoveryHealth
        }
        try validateHealthShape(health)
    }

    private static func validateHealthEvidence(
        persisted: Bool,
        health: NativeRecoveryHealth?,
        expectedDomain: NativeRecoveryDomain
    ) throws {
        if !persisted {
            guard health == nil else {
                throw NativeDurableDTOValidationError.invalidRecoveryHealthEvidence
            }
            return
        }

        guard let health,
              health.domain == expectedDomain,
              health.status != .notApplicable else {
            throw NativeDurableDTOValidationError.invalidRecoveryHealthEvidence
        }
        do {
            try validateHealthShape(health)
        } catch {
            throw NativeDurableDTOValidationError.invalidRecoveryHealthEvidence
        }
    }

    private static func validateHealthShape(_ health: NativeRecoveryHealth) throws {
        guard health.auditComplete,
              health.maintenancePendingCount >= 0,
              UInt64(health.maintenancePendingCount) <= maximumJavaScriptInteger else {
            throw NativeDurableDTOValidationError.invalidRecoveryHealth
        }
        switch health.status {
        case .healthy, .notApplicable:
            guard health.code == nil,
                  health.maintenancePendingCount == 0 else {
                throw NativeDurableDTOValidationError.invalidRecoveryHealth
            }
        case .degraded:
            guard let code = health.code, !code.isEmpty else {
                throw NativeDurableDTOValidationError.invalidRecoveryHealth
            }
        }
    }

    private static func validateCanonicalStoragePath(_ path: String) throws {
        guard !path.isEmpty,
              NSString(string: path).isAbsolutePath,
              URL(fileURLWithPath: path).standardizedFileURL.path == path,
              URL(fileURLWithPath: path).lastPathComponent == "AssetTrackerBook.json" else {
            throw NativeDurableDTOValidationError.invalidStoragePath
        }
    }

    private static func requireNonempty(_ value: String, field: String) throws {
        guard !value.isEmpty else {
            throw NativeDurableDTOValidationError.emptyField(field)
        }
    }

    private static func requireCanonicalHash(_ value: String, field: String) throws {
        guard value.utf8.count == 64,
              value.utf8.allSatisfy({ byte in
                  (48...57).contains(byte) || (97...102).contains(byte)
              }) else {
            throw NativeDurableDTOValidationError.invalidHash(field)
        }
    }
}

public protocol AssetTrackerDurableBookStoreIO: AssetTrackerBookStoreIO {
    func saveDurably(_ request: DurableBookSaveRequest) throws -> NativeDurableSaveReceipt
    func snapshot(_ request: NativeSnapshotRequest) throws -> NativeSnapshotReceipt
}

public struct AssetTrackerBookStoreDurabilityHooks: Sendable {
    fileprivate let faultHandler: NativeDurabilityFaultHandler

    public init(faultHandler: @escaping NativeDurabilityFaultHandler) {
        self.faultHandler = faultHandler
    }

    public static let none = Self(faultHandler: { _ in })
}

public final class AssetTrackerBookStore: AssetTrackerDurableBookStoreIO, @unchecked Sendable {
    public let storageDirectoryURL: URL
    public let storageFileURL: URL

    private let fileManager: FileManager
    private let readData: (URL) throws -> Data
    private let recoveryStore: AssetTrackerRecoveryStore

    public init(
        storageDirectoryURL: URL,
        fileManager: FileManager = .default,
        durabilityHooks: AssetTrackerBookStoreDurabilityHooks = .none,
        readData: @escaping (URL) throws -> Data = { try Data(contentsOf: $0) }
    ) {
        self.storageDirectoryURL = storageDirectoryURL.standardizedFileURL
        self.storageFileURL = storageDirectoryURL.standardizedFileURL
            .appendingPathComponent("AssetTrackerBook.json", isDirectory: false)
        self.fileManager = fileManager
        self.readData = readData
        self.recoveryStore = AssetTrackerRecoveryStore(
            rootURL: storageDirectoryURL,
            faultHandler: durabilityHooks.faultHandler
        )
    }

    public func load() -> AssetTrackerRawBookLoadResult {
        let raw = loadRawBook()
        do {
            let ordinary = try recoveryStore.auditOrdinary()
            let snapshot = try recoveryStore.auditSnapshot()
            return result(
                raw,
                recoveryHealthComplete: true,
                ordinaryRecoveryHealth: ordinary,
                snapshotRecoveryHealth: snapshot
            )
        } catch {
            return result(
                raw,
                recoveryHealthComplete: false,
                ordinaryRecoveryHealth: nil,
                snapshotRecoveryHealth: nil
            )
        }
    }

    private func loadRawBook() -> AssetTrackerRawBookLoadResult {
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

    public func saveDurably(
        _ request: DurableBookSaveRequest
    ) throws -> NativeDurableSaveReceipt {
        try NativeDurableDTOValidator.validate(request)
        let payloadData = Data(request.stateJSON.utf8)
        guard let payload = try JSONSerialization.jsonObject(with: payloadData) as? [String: Any]
        else {
            throw AssetTrackerBookStoreError.invalidStateJSON
        }

        let timestamp = try Self.canonicalTimestamp(Date())
        let envelope: [String: Any] = [
            "format": "qiushan.asset-book",
            "formatVersion": 1,
            "schemaVersion": request.schemaVersion,
            "domainCapabilityVersion": 1,
            "minimumReaderVersion": 1,
            "exportedAt": timestamp.string,
            "source": "macos-app",
            "reason": request.reason,
            "payload": payload
        ]
        guard JSONSerialization.isValidJSONObject(envelope) else {
            throw AssetTrackerBookStoreError.invalidNativeEnvelope
        }
        let candidateBytes: Data
        do {
            candidateBytes = try JSONSerialization.data(
                withJSONObject: envelope,
                options: [.prettyPrinted, .sortedKeys]
            )
        } catch {
            throw AssetTrackerBookStoreError.invalidNativeEnvelope
        }
        try Self.validateEnvelope(
            candidateBytes,
            request: request,
            timestamp: timestamp.string
        )

        let candidateHash = Self.sha256Hex(candidateBytes)
        let saved = try recoveryStore.saveOrdinary(
            candidateBytes: candidateBytes,
            candidateHash: candidateHash,
            expectedSource: request.expectedSource,
            operationID: request.clientSaveID
        )
        guard saved.stateHashAfter == candidateHash,
              saved.primaryReceipt.sha256 == candidateHash,
              saved.primaryReceipt.byteCount == candidateBytes.count else {
            throw AssetTrackerBookStoreError.invalidDurableReceipt
        }
        let receipt = NativeDurableSaveReceipt(
            clientSaveID: request.clientSaveID,
            sourceHashBefore: saved.sourceHashBefore,
            payloadHash: request.payloadHash,
            stateHashAfter: saved.stateHashAfter,
            byteCount: saved.primaryReceipt.byteCount,
            durability: .nativeDurable,
            previousSlotHashes: saved.previousSlotHashes,
            recoveryHealth: saved.recoveryHealth,
            updatedAt: timestamp.date,
            storagePath: storageFileURL.path
        )
        try NativeDurableDTOValidator.validate(receipt, matching: request)
        return receipt
    }

    public func snapshot(
        _ request: NativeSnapshotRequest
    ) throws -> NativeSnapshotReceipt {
        try NativeDurableDTOValidator.validate(request)
        let created = try recoveryStore.createSnapshot(
            expectedHash: request.expectedHash,
            createdAt: Date()
        )
        let receipt = NativeSnapshotReceipt(
            clientSnapshotID: request.clientSnapshotID,
            sourceHash: created.sourceHash,
            snapshotHash: created.snapshotHash,
            ordinal: created.ordinal,
            snapshotStatus: created.snapshotStatus,
            durability: .nativeDurable,
            retainedCount: created.retainedCount,
            recoveryHealth: created.recoveryHealth
        )
        try NativeDurableDTOValidator.validate(receipt, matching: request)
        return receipt
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

    private static func canonicalTimestamp(_ date: Date) throws -> (date: Date, string: String) {
        let string = iso8601String(date)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let canonicalDate = formatter.date(from: string) else {
            throw AssetTrackerBookStoreError.invalidNativeEnvelope
        }
        return (canonicalDate, string)
    }

    private static func validateEnvelope(
        _ data: Data,
        request: DurableBookSaveRequest,
        timestamp: String
    ) throws {
        guard
            let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            Set(envelope.keys) == [
                "format",
                "formatVersion",
                "schemaVersion",
                "domainCapabilityVersion",
                "minimumReaderVersion",
                "exportedAt",
                "source",
                "reason",
                "payload"
            ],
            envelope["format"] as? String == "qiushan.asset-book",
            envelope["formatVersion"] as? Int == 1,
            envelope["schemaVersion"] as? Int == request.schemaVersion,
            envelope["domainCapabilityVersion"] as? Int == 1,
            envelope["minimumReaderVersion"] as? Int == 1,
            envelope["exportedAt"] as? String == timestamp,
            envelope["source"] as? String == "macos-app",
            envelope["reason"] as? String == request.reason,
            let encodedPayload = envelope["payload"] as? [String: Any],
            let requestedPayload = try JSONSerialization.jsonObject(
                with: Data(request.stateJSON.utf8)
            ) as? [String: Any],
            NSDictionary(dictionary: encodedPayload).isEqual(
                to: requestedPayload
            )
        else {
            throw AssetTrackerBookStoreError.invalidNativeEnvelope
        }
    }

    private func result(
        _ raw: AssetTrackerRawBookLoadResult,
        recoveryHealthComplete: Bool,
        ordinaryRecoveryHealth: NativeRecoveryHealth?,
        snapshotRecoveryHealth: NativeRecoveryHealth?
    ) -> AssetTrackerRawBookLoadResult {
        AssetTrackerRawBookLoadResult(
            status: raw.status,
            reason: raw.reason,
            data: raw.data,
            stateJson: raw.stateJson,
            rawHash: raw.rawHash,
            hashAlgorithm: raw.hashAlgorithm,
            storagePath: raw.storagePath,
            updatedAt: raw.updatedAt,
            canExportRaw: raw.canExportRaw,
            canRevealFolder: raw.canRevealFolder,
            recoveryHealthComplete: recoveryHealthComplete,
            ordinaryRecoveryHealth: ordinaryRecoveryHealth,
            snapshotRecoveryHealth: snapshotRecoveryHealth
        )
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

    static let supportedTerminalizationReasons: Set<String> = [
        "save-not-committed",
        "save-outcome-unknown",
        "save-conflict",
        "snapshot-outcome-unknown",
        "snapshot-conflict",
        "candidate-invalid",
        "queue-callback-failed",
        "internalError.postRender",
        "renderError.postRender",
    ]

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
        guard Self.supportedTerminalizationReasons.contains(request.reason) else {
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
