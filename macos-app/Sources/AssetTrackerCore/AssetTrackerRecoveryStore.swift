import CryptoKit
import Foundation

public enum NativeRecoveryDomain: String, Codable, Sendable {
    case ordinary
    case snapshot
}

public enum NativeRecoveryStatus: String, Codable, Sendable {
    case healthy
    case degraded
    case notApplicable
}

public struct NativeRecoveryHealth: Codable, Equatable, Sendable {
    public let domain: NativeRecoveryDomain
    public let status: NativeRecoveryStatus
    public let auditComplete: Bool
    public let code: String?
    public let maintenancePendingCount: Int
    public let detail: String?

    public init(
        domain: NativeRecoveryDomain,
        status: NativeRecoveryStatus,
        auditComplete: Bool,
        code: String?,
        maintenancePendingCount: Int,
        detail: String?
    ) {
        self.domain = domain
        self.status = status
        self.auditComplete = auditComplete
        self.code = code
        self.maintenancePendingCount = maintenancePendingCount
        self.detail = detail
    }
}

struct SnapshotPoint: Codable, Equatable, Sendable {
    let hash: String
    let ordinal: UInt64
    let createdAt: Date

    init(hash: String, ordinal: UInt64, createdAt: Date) {
        self.hash = hash
        self.ordinal = ordinal
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        try requireExactKeys(
            container,
            expected: ["hash", "ordinal", "createdAt"],
            at: decoder.codingPath
        )
        hash = try container.decode(String.self, forKey: .key("hash"))
        ordinal = try container.decode(UInt64.self, forKey: .key("ordinal"))
        createdAt = try container.decode(Date.self, forKey: .key("createdAt"))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        try container.encode(hash, forKey: .key("hash"))
        try container.encode(ordinal, forKey: .key("ordinal"))
        try container.encode(createdAt, forKey: .key("createdAt"))
    }
}

struct SnapshotRecoveryIndex: Codable, Equatable, Sendable {
    static let expectedFormat = "qiushan.asset-book.snapshot-recovery"
    static let expectedVersion = 1
    static let maximumRetainedCount = 24

    let format: String
    let version: Int
    var retained: [SnapshotPoint]
    var nextOrdinal: UInt64
    var pendingCleanupHashes: [String]
    var lastHealthCode: String?

    init(
        format: String,
        version: Int,
        retained: [SnapshotPoint],
        nextOrdinal: UInt64,
        pendingCleanupHashes: [String],
        lastHealthCode: String?
    ) {
        self.format = format
        self.version = version
        self.retained = retained
        self.nextOrdinal = nextOrdinal
        self.pendingCleanupHashes = pendingCleanupHashes
        self.lastHealthCode = lastHealthCode
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        try requireExactKeys(
            container,
            expected: [
                "format",
                "version",
                "retained",
                "nextOrdinal",
                "pendingCleanupHashes",
                "lastHealthCode",
            ],
            at: decoder.codingPath
        )
        format = try container.decode(String.self, forKey: .key("format"))
        version = try container.decode(Int.self, forKey: .key("version"))
        guard format == Self.expectedFormat, version == Self.expectedVersion else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Unsupported snapshot recovery format or version"
            ))
        }
        retained = try container.decode([SnapshotPoint].self, forKey: .key("retained"))
        nextOrdinal = try container.decode(UInt64.self, forKey: .key("nextOrdinal"))
        pendingCleanupHashes = try container.decode(
            [String].self,
            forKey: .key("pendingCleanupHashes")
        )
        let healthKey = OrdinaryDynamicCodingKey.key("lastHealthCode")
        lastHealthCode = try container.decodeNil(forKey: healthKey)
            ? nil
            : container.decode(String.self, forKey: healthKey)
        try validateSnapshotIndex(self)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        try container.encode(format, forKey: .key("format"))
        try container.encode(version, forKey: .key("version"))
        try container.encode(retained, forKey: .key("retained"))
        try container.encode(nextOrdinal, forKey: .key("nextOrdinal"))
        try container.encode(pendingCleanupHashes, forKey: .key("pendingCleanupHashes"))
        if let lastHealthCode {
            try container.encode(lastHealthCode, forKey: .key("lastHealthCode"))
        } else {
            try container.encodeNil(forKey: .key("lastHealthCode"))
        }
    }
}

enum SnapshotRecoveryCodec {
    static func encode(_ index: SnapshotRecoveryIndex) throws -> Data {
        guard index.format == SnapshotRecoveryIndex.expectedFormat,
              index.version == SnapshotRecoveryIndex.expectedVersion
        else {
            throw SnapshotRecoveryCodecError.invalidConstants
        }
        try validateSnapshotIndex(index)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .millisecondsSince1970
        return try encoder.encode(index)
    }

    static func decode(_ data: Data) throws -> SnapshotRecoveryIndex {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return try decoder.decode(SnapshotRecoveryIndex.self, from: data)
    }
}

enum SnapshotRecoveryCodecError: Error, Equatable {
    case invalidConstants
    case invalidSemantics(String)
}

private func validateSnapshotIndex(_ index: SnapshotRecoveryIndex) throws {
    guard index.retained.count <= SnapshotRecoveryIndex.maximumRetainedCount else {
        throw SnapshotRecoveryCodecError.invalidSemantics("retained exceeds 24 entries")
    }

    var hashes = Set<String>()
    var ordinals = Set<UInt64>()
    for point in index.retained {
        try requireCanonicalSnapshotHash(point.hash, field: "retained.hash")
        guard hashes.insert(point.hash).inserted else {
            throw SnapshotRecoveryCodecError.invalidSemantics("retained hashes must be unique")
        }
        guard ordinals.insert(point.ordinal).inserted else {
            throw SnapshotRecoveryCodecError.invalidSemantics("retained ordinals must be unique")
        }
        guard point.ordinal < index.nextOrdinal else {
            throw SnapshotRecoveryCodecError.invalidSemantics("retained ordinal must precede nextOrdinal")
        }
        guard point.createdAt.timeIntervalSince1970.isFinite else {
            throw SnapshotRecoveryCodecError.invalidSemantics("createdAt must be finite")
        }
    }
    guard index.retained == index.retained.sorted(by: snapshotPointPrecedes) else {
        throw SnapshotRecoveryCodecError.invalidSemantics(
            "retained must be sorted by descending ordinal then ascending hash"
        )
    }

    var pending = Set<String>()
    for hash in index.pendingCleanupHashes {
        try requireCanonicalSnapshotHash(hash, field: "pendingCleanupHashes")
        guard pending.insert(hash).inserted else {
            throw SnapshotRecoveryCodecError.invalidSemantics("pending cleanup hashes must be unique")
        }
    }
    guard index.pendingCleanupHashes == index.pendingCleanupHashes.sorted() else {
        throw SnapshotRecoveryCodecError.invalidSemantics("pending cleanup hashes must be sorted")
    }
    guard hashes.isDisjoint(with: pending) else {
        throw SnapshotRecoveryCodecError.invalidSemantics("pending cleanup intersects retained snapshots")
    }
    if index.pendingCleanupHashes.isEmpty {
        guard index.lastHealthCode == nil else {
            throw SnapshotRecoveryCodecError.invalidSemantics(
                "healthy snapshot maintenance must encode a null code"
            )
        }
    } else {
        guard index.lastHealthCode == "cleanup-pending" else {
            throw SnapshotRecoveryCodecError.invalidSemantics(
                "pending snapshot cleanup requires cleanup-pending"
            )
        }
    }
}

private func snapshotPointPrecedes(_ lhs: SnapshotPoint, _ rhs: SnapshotPoint) -> Bool {
    lhs.ordinal == rhs.ordinal ? lhs.hash < rhs.hash : lhs.ordinal > rhs.ordinal
}

private func requireCanonicalSnapshotHash(_ hash: String, field: String) throws {
    let bytes = Array(hash.utf8)
    guard bytes.count == 64,
          bytes.allSatisfy({ byte in
              (48 ... 57).contains(byte) || (97 ... 102).contains(byte)
          })
    else {
        throw SnapshotRecoveryCodecError.invalidSemantics(
            "\(field) is not lowercase ASCII SHA-256"
        )
    }
}

struct OrdinaryRecoveryIndex: Codable, Equatable, Sendable {
    static let expectedFormat = "qiushan.asset-book.ordinary-recovery"
    static let expectedVersion = 1

    let format: String
    let version: Int
    var committed: OrdinaryCommittedState
    var prepared: OrdinaryPreparedState?

    init(
        format: String,
        version: Int,
        committed: OrdinaryCommittedState,
        prepared: OrdinaryPreparedState?
    ) {
        self.format = format
        self.version = version
        self.committed = committed
        self.prepared = prepared
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        try requireExactKeys(
            container,
            expected: ["format", "version", "committed", "prepared"],
            at: decoder.codingPath
        )
        format = try container.decode(String.self, forKey: .key("format"))
        version = try container.decode(Int.self, forKey: .key("version"))
        guard format == Self.expectedFormat, version == Self.expectedVersion else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Unsupported ordinary recovery format or version"
            ))
        }
        committed = try container.decode(OrdinaryCommittedState.self, forKey: .key("committed"))
        let preparedKey = OrdinaryDynamicCodingKey.key("prepared")
        prepared = try container.decodeNil(forKey: preparedKey)
            ? nil
            : container.decode(OrdinaryPreparedState.self, forKey: preparedKey)
        try validateOrdinaryIndex(self)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        try container.encode(format, forKey: .key("format"))
        try container.encode(version, forKey: .key("version"))
        try container.encode(committed, forKey: .key("committed"))
        if let prepared {
            try container.encode(prepared, forKey: .key("prepared"))
        } else {
            try container.encodeNil(forKey: .key("prepared"))
        }
    }
}

struct OrdinaryCommittedState: Codable, Equatable, Sendable {
    var primaryHash: String?
    var slots: [String]
    var maintenance: OrdinaryMaintenanceState

    init(primaryHash: String?, slots: [String], maintenance: OrdinaryMaintenanceState) {
        self.primaryHash = primaryHash
        self.slots = slots
        self.maintenance = maintenance
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        try requireExactKeys(
            container,
            expected: ["primaryHash", "slots", "maintenance"],
            at: decoder.codingPath
        )
        let primaryHashKey = OrdinaryDynamicCodingKey.key("primaryHash")
        primaryHash = try container.decodeNil(forKey: primaryHashKey)
            ? nil
            : container.decode(String.self, forKey: primaryHashKey)
        slots = try container.decode([String].self, forKey: .key("slots"))
        maintenance = try container.decode(OrdinaryMaintenanceState.self, forKey: .key("maintenance"))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        if let primaryHash {
            try container.encode(primaryHash, forKey: .key("primaryHash"))
        } else {
            try container.encodeNil(forKey: .key("primaryHash"))
        }
        try container.encode(slots, forKey: .key("slots"))
        try container.encode(maintenance, forKey: .key("maintenance"))
    }
}

struct OrdinaryMaintenanceState: Codable, Equatable, Sendable {
    var pendingCleanupHashes: [String]
    var lastHealthCode: String?

    init(pendingCleanupHashes: [String], lastHealthCode: String?) {
        self.pendingCleanupHashes = pendingCleanupHashes
        self.lastHealthCode = lastHealthCode
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        try requireExactKeys(
            container,
            expected: ["pendingCleanupHashes", "lastHealthCode"],
            at: decoder.codingPath
        )
        pendingCleanupHashes = try container.decode(
            [String].self,
            forKey: .key("pendingCleanupHashes")
        )
        let healthKey = OrdinaryDynamicCodingKey.key("lastHealthCode")
        lastHealthCode = try container.decodeNil(forKey: healthKey)
            ? nil
            : container.decode(String.self, forKey: healthKey)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        try container.encode(pendingCleanupHashes, forKey: .key("pendingCleanupHashes"))
        if let lastHealthCode {
            try container.encode(lastHealthCode, forKey: .key("lastHealthCode"))
        } else {
            try container.encodeNil(forKey: .key("lastHealthCode"))
        }
    }
}

struct OrdinaryPreparedState: Codable, Equatable, Sendable {
    let operationId: String
    let sourceHash: String?
    let candidateHash: String
    let committedSlots: [String]
    let nextSlots: [String]

    init(
        operationId: String,
        sourceHash: String?,
        candidateHash: String,
        committedSlots: [String],
        nextSlots: [String]
    ) {
        self.operationId = operationId
        self.sourceHash = sourceHash
        self.candidateHash = candidateHash
        self.committedSlots = committedSlots
        self.nextSlots = nextSlots
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        try requireExactKeys(
            container,
            expected: ["operationId", "sourceHash", "candidateHash", "committedSlots", "nextSlots"],
            at: decoder.codingPath
        )
        operationId = try container.decode(String.self, forKey: .key("operationId"))
        let sourceHashKey = OrdinaryDynamicCodingKey.key("sourceHash")
        sourceHash = try container.decodeNil(forKey: sourceHashKey)
            ? nil
            : container.decode(String.self, forKey: sourceHashKey)
        candidateHash = try container.decode(String.self, forKey: .key("candidateHash"))
        committedSlots = try container.decode([String].self, forKey: .key("committedSlots"))
        nextSlots = try container.decode([String].self, forKey: .key("nextSlots"))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: OrdinaryDynamicCodingKey.self)
        try container.encode(operationId, forKey: .key("operationId"))
        if let sourceHash {
            try container.encode(sourceHash, forKey: .key("sourceHash"))
        } else {
            try container.encodeNil(forKey: .key("sourceHash"))
        }
        try container.encode(candidateHash, forKey: .key("candidateHash"))
        try container.encode(committedSlots, forKey: .key("committedSlots"))
        try container.encode(nextSlots, forKey: .key("nextSlots"))
    }
}

enum OrdinaryRecoveryCodec {
    static func encode(_ index: OrdinaryRecoveryIndex) throws -> Data {
        guard index.format == OrdinaryRecoveryIndex.expectedFormat,
              index.version == OrdinaryRecoveryIndex.expectedVersion
        else {
            throw OrdinaryRecoveryCodecError.invalidConstants
        }
        try validateOrdinaryIndex(index)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(index)
    }

    static func decode(_ data: Data) throws -> OrdinaryRecoveryIndex {
        try JSONDecoder().decode(OrdinaryRecoveryIndex.self, from: data)
    }
}

enum OrdinaryRecoveryCodecError: Error, Equatable {
    case invalidConstants
    case invalidSemantics(String)
}

private func validateOrdinaryIndex(_ index: OrdinaryRecoveryIndex) throws {
    let committed = index.committed
    if let primaryHash = committed.primaryHash {
        try requireCanonicalHash(primaryHash, field: "committed.primaryHash")
    }
    try requireCanonicalHashList(committed.slots, field: "committed.slots", maximumCount: 2)
    if committed.primaryHash == nil, !committed.slots.isEmpty {
        throw OrdinaryRecoveryCodecError.invalidSemantics("missing primary cannot retain history")
    }
    if let primaryHash = committed.primaryHash, committed.slots.contains(primaryHash) {
        throw OrdinaryRecoveryCodecError.invalidSemantics("current primary cannot be a prior slot")
    }

    let maintenance = committed.maintenance
    try requireCanonicalHashList(
        maintenance.pendingCleanupHashes,
        field: "committed.maintenance.pendingCleanupHashes",
        maximumCount: nil
    )
    guard maintenance.pendingCleanupHashes == maintenance.pendingCleanupHashes.sorted() else {
        throw OrdinaryRecoveryCodecError.invalidSemantics("pending cleanup hashes must be sorted")
    }
    if maintenance.pendingCleanupHashes.isEmpty {
        guard maintenance.lastHealthCode == nil else {
            throw OrdinaryRecoveryCodecError.invalidSemantics("healthy maintenance must encode a null code")
        }
    } else {
        guard maintenance.lastHealthCode == "cleanup-pending" else {
            throw OrdinaryRecoveryCodecError.invalidSemantics("pending cleanup requires cleanup-pending")
        }
    }

    var referenced = Set(committed.slots)
    if let prepared = index.prepared {
        guard !prepared.operationId.isEmpty else {
            throw OrdinaryRecoveryCodecError.invalidSemantics("prepared operation id is empty")
        }
        if let sourceHash = prepared.sourceHash {
            try requireCanonicalHash(sourceHash, field: "prepared.sourceHash")
        }
        try requireCanonicalHash(prepared.candidateHash, field: "prepared.candidateHash")
        try requireCanonicalHashList(
            prepared.committedSlots,
            field: "prepared.committedSlots",
            maximumCount: 2
        )
        try requireCanonicalHashList(prepared.nextSlots, field: "prepared.nextSlots", maximumCount: 2)
        guard prepared.sourceHash == committed.primaryHash else {
            throw OrdinaryRecoveryCodecError.invalidSemantics("prepared source does not match committed primary")
        }
        guard prepared.committedSlots == committed.slots else {
            throw OrdinaryRecoveryCodecError.invalidSemantics("prepared committed slots do not match")
        }
        guard prepared.candidateHash != prepared.sourceHash else {
            throw OrdinaryRecoveryCodecError.invalidSemantics("no-op cannot have a prepared transition")
        }
        guard prepared.nextSlots == canonicalOrdinaryNextSlots(
            sourceHash: prepared.sourceHash,
            committedSlots: prepared.committedSlots,
            candidateHash: prepared.candidateHash
        ) else {
            throw OrdinaryRecoveryCodecError.invalidSemantics("prepared next slots are not canonical")
        }
        referenced.formUnion(prepared.committedSlots)
        referenced.formUnion(prepared.nextSlots)
    }

    guard referenced.isDisjoint(with: maintenance.pendingCleanupHashes) else {
        throw OrdinaryRecoveryCodecError.invalidSemantics("pending cleanup intersects referenced history")
    }
}

private func canonicalOrdinaryNextSlots(
    sourceHash: String?,
    committedSlots: [String],
    candidateHash: String
) -> [String] {
    var seen = Set<String>()
    var result: [String] = []
    for hash in ([sourceHash].compactMap { $0 } + committedSlots) where hash != candidateHash {
        if seen.insert(hash).inserted {
            result.append(hash)
            if result.count == 2 { break }
        }
    }
    return result
}

private func requireCanonicalHashList(
    _ hashes: [String],
    field: String,
    maximumCount: Int?
) throws {
    if let maximumCount, hashes.count > maximumCount {
        throw OrdinaryRecoveryCodecError.invalidSemantics("\(field) exceeds \(maximumCount) entries")
    }
    guard Set(hashes).count == hashes.count else {
        throw OrdinaryRecoveryCodecError.invalidSemantics("\(field) contains duplicates")
    }
    for hash in hashes {
        try requireCanonicalHash(hash, field: field)
    }
}

private func requireCanonicalHash(_ hash: String, field: String) throws {
    let bytes = Array(hash.utf8)
    guard bytes.count == 64,
          bytes.allSatisfy({ byte in
              (48 ... 57).contains(byte) || (97 ... 102).contains(byte)
          })
    else {
        throw OrdinaryRecoveryCodecError.invalidSemantics("\(field) is not lowercase ASCII SHA-256")
    }
}

private struct OrdinaryDynamicCodingKey: CodingKey, Hashable {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }

    static func key(_ value: String) -> Self {
        Self(stringValue: value)!
    }
}

private func requireExactKeys<T: KeyedDecodingContainerProtocol>(
    _ container: T,
    expected: Set<String>,
    at codingPath: [any CodingKey]
) throws where T.Key == OrdinaryDynamicCodingKey {
    let actual = Set(container.allKeys.map(\.stringValue))
    guard actual == expected else {
        throw DecodingError.dataCorrupted(.init(
            codingPath: codingPath,
            debugDescription: "Expected exact keys \(expected.sorted()), found \(actual.sorted())"
        ))
    }
}

public struct NativeOrdinaryRecoverySaveResult: Equatable, Sendable {
    public let sourceHashBefore: String?
    public let stateHashAfter: String
    public let primaryReceipt: NativeDurableFileReceipt
    public let previousSlotHashes: [String]
    public let recoveryHealth: NativeRecoveryHealth

    init(
        sourceHashBefore: String?,
        stateHashAfter: String,
        primaryReceipt: NativeDurableFileReceipt,
        previousSlotHashes: [String],
        recoveryHealth: NativeRecoveryHealth
    ) {
        self.sourceHashBefore = sourceHashBefore
        self.stateHashAfter = stateHashAfter
        self.primaryReceipt = primaryReceipt
        self.previousSlotHashes = previousSlotHashes
        self.recoveryHealth = recoveryHealth
    }
}

public struct NativeSnapshotRecoveryResult: Equatable, Sendable {
    public let sourceHash: String
    public let snapshotHash: String
    public let ordinal: UInt64
    public let snapshotStatus: NativeSnapshotStatus
    public let retainedCount: Int
    public let recoveryHealth: NativeRecoveryHealth

    init(
        sourceHash: String,
        snapshotHash: String,
        ordinal: UInt64,
        snapshotStatus: NativeSnapshotStatus,
        retainedCount: Int,
        recoveryHealth: NativeRecoveryHealth
    ) {
        self.sourceHash = sourceHash
        self.snapshotHash = snapshotHash
        self.ordinal = ordinal
        self.snapshotStatus = snapshotStatus
        self.retainedCount = retainedCount
        self.recoveryHealth = recoveryHealth
    }
}

enum AssetTrackerRecoveryStoreError: Error, Equatable {
    case invalidCandidateHash
    case invalidOperationID
    case corruptOrdinaryRecovery
    case invalidSnapshotHash
    case snapshotOrdinalOverflow
    case corruptSnapshotRecovery
}

public final class AssetTrackerRecoveryStore: @unchecked Sendable {
    private struct CompleteBlobNamespaceAudit {
        let orphanHashes: Set<String>
        let validatedTempCount: Int
    }

    private struct OrdinaryIndexMutation {
        let index: OrdinaryRecoveryIndex
        let authoritativeProof: NativeManagedFileProof?
    }

    private struct OrdinaryMaintenanceOutcome {
        let index: OrdinaryRecoveryIndex
        let authoritativeProof: NativeManagedFileProof
        let recoveryHealth: NativeRecoveryHealth

        var isDegraded: Bool {
            recoveryHealth.status == .degraded
        }
    }

    private struct SnapshotNamespaceAudit: Equatable {
        let presentHashes: Set<String>
        let orphanHashes: Set<String>
    }

    private struct SnapshotMaintenanceOutcome {
        let index: SnapshotRecoveryIndex
        let authoritativeProof: NativeManagedFileProof
        let recoveryHealth: NativeRecoveryHealth
    }

    private static let primaryPath = "AssetTrackerBook.json"
    private static let recoveryDirectoryPath = "Recovery"
    private static let ordinaryDirectoryPath = "Recovery/ordinary"
    private static let ordinaryIndexPath = "Recovery/ordinary/slots.json"
    private static let ordinaryBlobsDirectoryPath = "Recovery/ordinary/blobs"
    private static let snapshotDirectoryPath = "Recovery/snapshots"
    private static let snapshotIndexPath = "Recovery/snapshots/index.json"

    private let writer: NativeDurableFileWriter
    private let faultHandler: NativeDurabilityFaultHandler

    public convenience init(
        rootURL: URL,
        faultHandler: @escaping NativeDurabilityFaultHandler = { _ in }
    ) {
        self.init(
            writer: NativeDurableFileWriter(
                rootURL: rootURL,
                faultHandler: faultHandler
            ),
            faultHandler: faultHandler
        )
    }

    init(
        writer: NativeDurableFileWriter,
        faultHandler: @escaping NativeDurabilityFaultHandler
    ) {
        self.writer = writer
        self.faultHandler = faultHandler
    }

    public func saveOrdinary(
        candidateBytes: Data,
        candidateHash: String,
        expectedSource: ExpectedBookSource,
        operationID: String
    ) throws -> NativeOrdinaryRecoverySaveResult {
        guard !operationID.isEmpty else {
            throw AssetTrackerRecoveryStoreError.invalidOperationID
        }
        do {
            try requireCanonicalHash(candidateHash, field: "candidateHash")
        } catch {
            throw AssetTrackerRecoveryStoreError.invalidCandidateHash
        }
        guard ordinarySHA256(candidateBytes) == candidateHash else {
            throw AssetTrackerRecoveryStoreError.invalidCandidateHash
        }

        return try writer.withExclusiveMutationLock { locked in
            let sourceProof = try locked.verifyPrimarySource(expectedSource: expectedSource)
            try emit(
                .afterSourceCAS,
                role: .primary,
                targetName: Self.primaryPath
            )
            let sourceBytes = try locked.readValidated(relativePath: Self.primaryPath)
            let sourceHash = try verifiedSourceHash(
                expectedSource: expectedSource,
                sourceBytes: sourceBytes
            )

            var index = try initializeOrdinaryIfNeeded(
                locked: locked,
                currentPrimaryHash: sourceHash,
                currentPrimaryBytes: sourceBytes,
                sourceProof: sourceProof
            )
            var managedOrphans = try convergeOrdinaryBlobCrashTemps(
                index,
                primaryBytes: sourceBytes,
                sourceProof: sourceProof,
                locked: locked
            )
            var priorDegradedOutcome: OrdinaryMaintenanceOutcome?
            if index.prepared != nil {
                let reconciliation = try reconcilePreparedOrdinary(
                    index,
                    actualPrimaryHash: sourceHash,
                    actualPrimaryBytes: sourceBytes,
                    managedOrphans: managedOrphans,
                    sourceProof: sourceProof,
                    locked: locked
                )
                index = reconciliation.index
                if reconciliation.isDegraded {
                    priorDegradedOutcome = reconciliation
                }
                managedOrphans = []
            }

            guard index.committed.primaryHash == sourceHash else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
            try verifyReferencedBlobs(index, locked: locked)

            if candidateHash == sourceHash {
                let maintenance: OrdinaryMaintenanceOutcome
                if let priorDegradedOutcome {
                    maintenance = priorDegradedOutcome
                } else {
                    let mutation = try persistStandaloneOrdinaryMaintenance(
                        index,
                        managedOrphans: managedOrphans,
                        actualPrimaryHash: sourceHash,
                        sourceProof: sourceProof,
                        locked: locked
                    )
                    maintenance = try finishOrdinaryMaintenance(
                        mutation.index,
                        actualPrimaryHash: sourceHash,
                        actualPrimaryBytes: sourceBytes,
                        sourceProof: sourceProof,
                        authoritativeIndexProof: mutation.authoritativeProof,
                        locked: locked
                    )
                }
                let receipt = try locked.durablyVerifyUnchangedPrimary(sourceProof: sourceProof)
                try emit(
                    .afterPrimaryDurableBeforeACK,
                    role: .primary,
                    targetName: Self.primaryPath
                )
                let finalMaintenance: OrdinaryMaintenanceOutcome
                if maintenance.isDegraded {
                    finalMaintenance = try verifyDurableDegradedOrdinaryMaintenance(
                        maintenance.index,
                        authoritativeProof: maintenance.authoritativeProof,
                        actualPrimaryHash: sourceHash,
                        actualPrimaryBytes: sourceBytes,
                        sourceProof: sourceProof,
                        locked: locked
                    )
                } else {
                    finalMaintenance = try finishOrdinaryMaintenance(
                        maintenance.index,
                        actualPrimaryHash: sourceHash,
                        actualPrimaryBytes: sourceBytes,
                        sourceProof: sourceProof,
                        authoritativeIndexProof: maintenance.authoritativeProof,
                        locked: locked
                    )
                }
                return NativeOrdinaryRecoverySaveResult(
                    sourceHashBefore: sourceHash,
                    stateHashAfter: candidateHash,
                    primaryReceipt: receipt,
                    previousSlotHashes: finalMaintenance.index.committed.slots,
                    recoveryHealth: finalMaintenance.recoveryHealth
                )
            }

            if let sourceHash, let sourceBytes {
                try ensureOrdinaryBlob(
                    hash: sourceHash,
                    bytes: sourceBytes,
                    locked: locked
                )
            }
            try verifyReferencedBlobs(index, locked: locked)

            let nextSlots = canonicalOrdinaryNextSlots(
                sourceHash: sourceHash,
                committedSlots: index.committed.slots,
                candidateHash: candidateHash
            )
            let preparedPending = Set(index.committed.maintenance.pendingCleanupHashes)
                .union(managedOrphans)
                .subtracting(index.committed.slots)
                .subtracting(nextSlots)
            index.committed.maintenance = ordinaryMaintenance(for: preparedPending)
            index.prepared = OrdinaryPreparedState(
                operationId: operationID,
                sourceHash: sourceHash,
                candidateHash: candidateHash,
                committedSlots: index.committed.slots,
                nextSlots: nextSlots
            )
            _ = try writeIndex(index, role: .ordinaryPreparedIndex, locked: locked)
            try emit(
                .afterPreparedOrdinaryIndexDurable,
                role: .ordinaryPreparedIndex,
                targetName: Self.ordinaryIndexPath
            )

            let primaryReceipt = try locked.durableReplacePrimary(
                candidateBytes,
                sourceProof: sourceProof
            )
            try emit(
                .afterPrimaryDurableBeforeACK,
                role: .primary,
                targetName: Self.primaryPath
            )
            let currentSourceProof = try locked.verifyPrimarySource(
                expectedSource: .sha256(candidateHash)
            )

            let oldSlots = index.committed.slots
            let oldPending = Set(index.committed.maintenance.pendingCleanupHashes)
            index.committed.primaryHash = candidateHash
            index.committed.slots = nextSlots
            index.committed.maintenance = ordinaryMaintenance(
                for: oldPending
                    .union(Set(oldSlots).subtracting(nextSlots))
                    .subtracting(nextSlots)
            )
            index.prepared = nil
            let committedIndexProof = try writeIndex(
                index,
                role: .ordinaryCommittedIndex,
                locked: locked
            )
            try emit(
                .afterCommittedOrdinaryIndexDurable,
                role: .ordinaryCommittedIndex,
                targetName: Self.ordinaryIndexPath
            )
            let maintenance: OrdinaryMaintenanceOutcome
            if priorDegradedOutcome != nil,
               !index.committed.maintenance.pendingCleanupHashes.isEmpty
            {
                maintenance = try verifyDurableDegradedOrdinaryMaintenance(
                    index,
                    authoritativeProof: committedIndexProof,
                    actualPrimaryHash: candidateHash,
                    actualPrimaryBytes: candidateBytes,
                    sourceProof: currentSourceProof,
                    locked: locked
                )
            } else {
                maintenance = try finishOrdinaryMaintenance(
                    index,
                    actualPrimaryHash: candidateHash,
                    actualPrimaryBytes: candidateBytes,
                    sourceProof: currentSourceProof,
                    authoritativeIndexProof: committedIndexProof,
                    locked: locked
                )
            }

            return NativeOrdinaryRecoverySaveResult(
                sourceHashBefore: sourceHash,
                stateHashAfter: candidateHash,
                primaryReceipt: primaryReceipt,
                previousSlotHashes: nextSlots,
                recoveryHealth: maintenance.recoveryHealth
            )
        }
    }

    public func createSnapshot(
        expectedHash: String,
        createdAt: Date
    ) throws -> NativeSnapshotRecoveryResult {
        do {
            try requireCanonicalSnapshotHash(expectedHash, field: "expectedHash")
        } catch {
            throw AssetTrackerRecoveryStoreError.invalidSnapshotHash
        }
        let createdAtMilliseconds = createdAt.timeIntervalSince1970 * 1_000
        guard createdAt.timeIntervalSince1970.isFinite,
              createdAtMilliseconds.isFinite
        else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        let canonicalCreatedAt = Date(
            timeIntervalSince1970: createdAtMilliseconds.rounded() / 1_000
        )

        do {
            return try writer.withExclusiveMutationLock { locked in
                let sourceProof = try locked.verifyPrimarySource(
                    expectedSource: .sha256(expectedHash)
                )
                try emit(.afterSourceCAS, role: .primary, targetName: Self.primaryPath)
                guard let sourceBytes = try locked.readValidated(relativePath: Self.primaryPath),
                      ordinarySHA256(sourceBytes) == expectedHash
                else {
                    throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
                }

                let initialized = try initializeSnapshotIfNeeded(
                    sourceBytes: sourceBytes,
                    sourceProof: sourceProof,
                    locked: locked
                )
                var index = initialized.index
                var authoritativeProof = initialized.proof
                let namespace = try verifySnapshotNamespace(index, locked: locked)

                if let existing = index.retained.first(where: { $0.hash == expectedHash }) {
                    let retainedHashes = Set(index.retained.map(\.hash))
                    let requiredPending = Set(index.pendingCleanupHashes)
                        .union(namespace.orphanHashes)
                        .subtracting(retainedHashes)
                        .sorted()
                    if requiredPending != index.pendingCleanupHashes {
                        index.pendingCleanupHashes = requiredPending
                        index.lastHealthCode = requiredPending.isEmpty
                            ? nil
                            : "cleanup-pending"
                        try validateSnapshotIndex(index)
                        try locked.revalidatePrimarySource(sourceProof)
                        authoritativeProof = try locked.durableCompareAndSwapManaged(
                            SnapshotRecoveryCodec.encode(index),
                            replacing: authoritativeProof,
                            sourceProof: sourceProof,
                            role: .snapshotFinalIndex
                        )
                        try emit(
                            .afterSnapshotIndexDurable,
                            role: .snapshotFinalIndex,
                            targetName: Self.snapshotIndexPath
                        )
                    }

                    let maintenance = try finishSnapshotMaintenance(
                        index,
                        sourceProof: sourceProof,
                        authoritativeProof: authoritativeProof,
                        locked: locked
                    )
                    _ = try locked.durablyVerifyUnchangedPrimary(sourceProof: sourceProof)
                    try locked.durablySyncManagedDirectory(
                        relativePath: Self.snapshotDirectoryPath,
                        role: .snapshotFinalIndex
                    )
                    try locked.revalidate(maintenance.authoritativeProof)
                    try locked.revalidatePrimarySource(sourceProof)
                    guard try verifySnapshotNamespace(maintenance.index, locked: locked)
                            .orphanHashes.isEmpty,
                          try locked.readValidated(relativePath: Self.snapshotIndexPath)
                            == maintenance.authoritativeProof.bytes,
                          try decodeSnapshotIndex(maintenance.authoritativeProof.bytes)
                            == maintenance.index
                    else {
                        throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
                    }
                    try locked.revalidateCanonicalIdentity()
                    return NativeSnapshotRecoveryResult(
                        sourceHash: expectedHash,
                        snapshotHash: expectedHash,
                        ordinal: existing.ordinal,
                        snapshotStatus: .deduplicated,
                        retainedCount: maintenance.index.retained.count,
                        recoveryHealth: maintenance.recoveryHealth
                    )
                }

                guard index.nextOrdinal < UInt64.max else {
                    throw AssetTrackerRecoveryStoreError.snapshotOrdinalOverflow
                }
                let ordinal = index.nextOrdinal
                let blobPath = snapshotBlobPath(expectedHash)
                if let existingBytes = try locked.readValidated(relativePath: blobPath) {
                    guard existingBytes == sourceBytes else {
                        throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
                    }
                } else {
                    _ = try locked.durableWrite(
                        sourceBytes,
                        relativePath: blobPath,
                        disposition: .createOnly,
                        role: .snapshotBlob
                    )
                    try emit(
                        .afterSnapshotBlobDurable,
                        role: .snapshotBlob,
                        targetName: blobPath
                    )
                }

                index.retained.append(SnapshotPoint(
                    hash: expectedHash,
                    ordinal: ordinal,
                    createdAt: canonicalCreatedAt
                ))
                index.retained.sort(by: snapshotPointPrecedes)
                index.nextOrdinal = ordinal + 1
                let evicted = Set(index.retained.dropFirst(
                    SnapshotRecoveryIndex.maximumRetainedCount
                ).map(\.hash))
                index.retained = Array(index.retained.prefix(
                    SnapshotRecoveryIndex.maximumRetainedCount
                ))
                let retainedHashes = Set(index.retained.map(\.hash))
                index.pendingCleanupHashes = Set(index.pendingCleanupHashes)
                    .union(evicted)
                    .union(namespace.orphanHashes)
                    .subtracting(retainedHashes)
                    .sorted()
                index.lastHealthCode = index.pendingCleanupHashes.isEmpty
                    ? nil
                    : "cleanup-pending"
                try validateSnapshotIndex(index)

                _ = try verifySnapshotNamespace(index, locked: locked)
                try locked.revalidatePrimarySource(sourceProof)
                authoritativeProof = try locked.durableCompareAndSwapManaged(
                    SnapshotRecoveryCodec.encode(index),
                    replacing: authoritativeProof,
                    sourceProof: sourceProof,
                    role: .snapshotFinalIndex
                )
                try emit(
                    .afterSnapshotIndexDurable,
                    role: .snapshotFinalIndex,
                    targetName: Self.snapshotIndexPath
                )
                let maintenance = try finishSnapshotMaintenance(
                    index,
                    sourceProof: sourceProof,
                    authoritativeProof: authoritativeProof,
                    locked: locked
                )
                return NativeSnapshotRecoveryResult(
                    sourceHash: expectedHash,
                    snapshotHash: expectedHash,
                    ordinal: ordinal,
                    snapshotStatus: .created,
                    retainedCount: maintenance.index.retained.count,
                    recoveryHealth: maintenance.recoveryHealth
                )
            }
        } catch let error as AssetTrackerRecoveryStoreError {
            throw error
        } catch {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
    }

    public func auditSnapshot() throws -> NativeRecoveryHealth {
        do {
            let health = try writer.withReadOnlyAudit { directory in
                let sourceBytes = try directory.readValidated(relativePath: Self.primaryPath)
                let sourceHash = sourceBytes.map(ordinarySHA256)
                let expectedSource = sourceHash.map(ExpectedBookSource.sha256) ?? .missing
                _ = try directory.verifyPrimarySource(expectedSource: expectedSource)
                let emptyIndexBytes = try SnapshotRecoveryCodec.encode(
                    emptySnapshotRecoveryIndex()
                )

                let firstNamespace = try directory.auditSnapshotIndexNamespace(
                    expectedEmptyIndexBytes: emptyIndexBytes
                )
                switch firstNamespace {
                case .absent, .indexless:
                    guard try directory.auditSnapshotIndexNamespace(
                        expectedEmptyIndexBytes: emptyIndexBytes
                    ) == firstNamespace else {
                        throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
                    }
                    _ = try directory.verifyPrimarySource(expectedSource: expectedSource)
                    try directory.revalidateCanonicalIdentity()
                    return notApplicableSnapshotHealth()
                case .indexed:
                    break
                }

                guard case .indexed(let validatedTempCount) = firstNamespace,
                      let firstIndexBytes = try directory.readValidated(
                        relativePath: Self.snapshotIndexPath
                      ),
                      let entries = try directory.enumerateIfPresent(
                        relativePath: Self.snapshotDirectoryPath
                      ),
                      try directory.auditSnapshotIndexNamespace(
                        expectedEmptyIndexBytes: emptyIndexBytes
                      ) == firstNamespace,
                      try directory.readValidated(relativePath: Self.snapshotIndexPath)
                        == firstIndexBytes,
                      try directory.enumerateIfPresent(relativePath: Self.snapshotDirectoryPath)
                        == entries
                else {
                    throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
                }
                let index = try decodeSnapshotIndex(firstIndexBytes)
                let semanticEntries = try snapshotEntriesWithoutValidatedTemps(
                    entries,
                    validatedTempCount: validatedTempCount
                )
                let firstAudit = try verifySnapshotNamespace(
                    index,
                    entries: semanticEntries,
                    directory: directory
                )
                guard try directory.readValidated(relativePath: Self.snapshotIndexPath)
                        == firstIndexBytes,
                      try directory.enumerateIfPresent(relativePath: Self.snapshotDirectoryPath)
                        == entries,
                      try directory.auditSnapshotIndexNamespace(
                        expectedEmptyIndexBytes: emptyIndexBytes
                      ) == firstNamespace,
                      try verifySnapshotNamespace(
                        index,
                        entries: semanticEntries,
                        directory: directory
                      ) == firstAudit
                else {
                    throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
                }
                _ = try directory.verifyPrimarySource(expectedSource: expectedSource)
                try directory.revalidateCanonicalIdentity()
                if !firstAudit.orphanHashes.isEmpty {
                    return managedOrphanSnapshotHealth(firstAudit.orphanHashes)
                }
                if !index.pendingCleanupHashes.isEmpty {
                    return degradedSnapshotHealth(pendingCount: index.pendingCleanupHashes.count)
                }
                return healthySnapshotHealth()
            }
            return health ?? notApplicableSnapshotHealth()
        } catch let error as AssetTrackerRecoveryStoreError {
            throw error
        } catch {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
    }

    public func reconcileOrdinary() throws -> NativeRecoveryHealth {
        try writer.withExclusiveMutationLock { locked in
            let primaryBytes = try locked.readValidated(relativePath: Self.primaryPath)
            let primaryHash = primaryBytes.map(ordinarySHA256)
            let sourceProof = try locked.verifyPrimarySource(
                expectedSource: primaryHash.map(ExpectedBookSource.sha256) ?? .missing
            )
            try verifyIndexedOrdinaryNamespace(
                actualPrimaryHash: primaryHash,
                locked: locked
            )

            guard let indexBytes = try locked.readValidated(relativePath: Self.ordinaryIndexPath)
            else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
            var index = try decodeIndex(indexBytes)
            let managedOrphans = try convergeOrdinaryBlobCrashTemps(
                index,
                primaryBytes: primaryBytes,
                sourceProof: sourceProof,
                locked: locked
            )
            let maintenance: OrdinaryMaintenanceOutcome
            if index.prepared != nil {
                maintenance = try reconcilePreparedOrdinary(
                    index,
                    actualPrimaryHash: primaryHash,
                    actualPrimaryBytes: primaryBytes,
                    managedOrphans: managedOrphans,
                    sourceProof: sourceProof,
                    locked: locked
                )
            } else {
                let mutation = try persistStandaloneOrdinaryMaintenance(
                    index,
                    managedOrphans: managedOrphans,
                    actualPrimaryHash: primaryHash,
                    sourceProof: sourceProof,
                    locked: locked
                )
                maintenance = try finishOrdinaryMaintenance(
                    mutation.index,
                    actualPrimaryHash: primaryHash,
                    actualPrimaryBytes: primaryBytes,
                    sourceProof: sourceProof,
                    authoritativeIndexProof: mutation.authoritativeProof,
                    locked: locked
                )
            }
            index = maintenance.index
            guard index.committed.primaryHash == primaryHash else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
            try verifyReferencedBlobs(index, locked: locked)
            return maintenance.recoveryHealth
        }
    }

    public func auditOrdinary() throws -> NativeRecoveryHealth {
        do {
            let health = try writer.withReadOnlyAudit { directory in
                let primaryBytes = try directory.readValidated(relativePath: Self.primaryPath)
                let primaryHash = primaryBytes.map(ordinarySHA256)
                let expectedSource = primaryHash.map(ExpectedBookSource.sha256) ?? .missing
                let sourceProof = try directory.verifyPrimarySource(expectedSource: expectedSource)
                let emptyIndexBytes = try OrdinaryRecoveryCodec.encode(
                    emptyOrdinaryIndex(currentPrimaryHash: primaryHash)
                )

                let firstNamespace = try directory.auditOrdinaryIndexNamespace(
                    expectedEmptyIndexBytes: emptyIndexBytes
                )
                switch firstNamespace {
                case .absent, .indexless:
                    guard try directory.auditOrdinaryIndexNamespace(
                        expectedEmptyIndexBytes: emptyIndexBytes
                    ) == firstNamespace else {
                        throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
                    }
                    _ = try directory.verifyPrimarySource(expectedSource: expectedSource)
                    try directory.revalidateCanonicalIdentity()
                    return notApplicableOrdinaryHealth()
                case .indexed:
                    break
                }

                guard let firstIndexBytes = try directory.readValidated(
                    relativePath: Self.ordinaryIndexPath
                ) else {
                    throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
                }
                _ = try decodeIndex(firstIndexBytes)
                guard try directory.auditOrdinaryIndexNamespace(
                    expectedEmptyIndexBytes: emptyIndexBytes
                ) == .indexed,
                    let finalIndexBytes = try directory.readValidated(
                        relativePath: Self.ordinaryIndexPath
                    ),
                    finalIndexBytes == firstIndexBytes
                else {
                    throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
                }

                let index = try decodeIndex(finalIndexBytes)
                try validateReadOnlyPrimaryRelationship(
                    index,
                    actualPrimaryHash: primaryHash
                )
                let result = try auditIndexedOrdinary(
                    index,
                    primaryBytes: primaryBytes,
                    sourceProof: sourceProof,
                    directory: directory
                )
                guard try directory.auditOrdinaryIndexNamespace(
                    expectedEmptyIndexBytes: emptyIndexBytes
                ) == .indexed,
                    try directory.readValidated(
                        relativePath: Self.ordinaryIndexPath
                    ) == finalIndexBytes
                else {
                    throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
                }
                _ = try directory.verifyPrimarySource(expectedSource: expectedSource)
                try directory.revalidateCanonicalIdentity()
                return result
            }
            return health ?? notApplicableOrdinaryHealth()
        } catch let error as AssetTrackerRecoveryStoreError {
            throw error
        } catch {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
    }

    private func initializeOrdinaryIfNeeded(
        locked: NativeLockedBookDirectory,
        currentPrimaryHash: String?,
        currentPrimaryBytes: Data?,
        sourceProof: NativeSourceProof
    ) throws -> OrdinaryRecoveryIndex {
        try locked.createManagedDirectory(
            relativePath: Self.recoveryDirectoryPath,
            role: .ordinaryDirectory
        )
        try locked.createManagedDirectory(
            relativePath: Self.ordinaryDirectoryPath,
            role: .ordinaryDirectory
        )
        try emit(
            .afterOrdinaryDirectoryDurable,
            role: .ordinaryDirectory,
            targetName: Self.ordinaryDirectoryPath
        )

        let emptyIndex = emptyOrdinaryIndex(currentPrimaryHash: currentPrimaryHash)
        let emptyIndexBytes = try OrdinaryRecoveryCodec.encode(emptyIndex)
        let auditedNamespace = try locked.auditOrdinaryIndexNamespace(
            expectedEmptyIndexBytes: emptyIndexBytes
        )
        let auditedIndexBytes = try locked.readValidated(relativePath: Self.ordinaryIndexPath)
        let auditedEntries = try locked.enumerate(relativePath: Self.ordinaryDirectoryPath)
        guard try locked.auditOrdinaryIndexNamespace(
            expectedEmptyIndexBytes: emptyIndexBytes
        ) == auditedNamespace,
            try locked.readValidated(relativePath: Self.ordinaryIndexPath) == auditedIndexBytes,
            try locked.enumerate(relativePath: Self.ordinaryDirectoryPath) == auditedEntries
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }

        switch auditedNamespace {
        case .absent:
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        case .indexless:
            guard auditedIndexBytes == nil else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
        case .indexed:
            guard let auditedIndexBytes else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
            let auditedIndex = try decodeIndex(auditedIndexBytes)
            try validateReadOnlyPrimaryRelationship(
                auditedIndex,
                actualPrimaryHash: currentPrimaryHash
            )
            let blobsExist = auditedEntries.contains {
                $0.name == "blobs" && $0.fileType == .directory
            }
            if !blobsExist {
                guard auditedIndex.committed.primaryHash == currentPrimaryHash,
                      auditedIndex.committed.slots.isEmpty,
                      auditedIndex.committed.maintenance.pendingCleanupHashes.isEmpty,
                      auditedIndex.committed.maintenance.lastHealthCode == nil,
                      auditedIndex.prepared == nil
                else {
                    throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
                }
            }
            _ = try verifyCompleteBlobNamespace(
                auditedIndex,
                primaryBytes: currentPrimaryBytes,
                sourceProof: sourceProof,
                locked: locked
            )
        }

        guard try locked.auditOrdinaryIndexNamespace(
            expectedEmptyIndexBytes: emptyIndexBytes
        ) == auditedNamespace,
            try locked.readValidated(relativePath: Self.ordinaryIndexPath) == auditedIndexBytes,
            try locked.enumerate(relativePath: Self.ordinaryDirectoryPath) == auditedEntries
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }

        try locked.cleanupOrdinaryIndexCrashTemps(
            expectedEmptyIndexBytes: emptyIndexBytes
        )
        let firstIndexBytes = try locked.readValidated(relativePath: Self.ordinaryIndexPath)
        let firstEntries = try locked.enumerate(relativePath: Self.ordinaryDirectoryPath)
        try validateMutationOrdinaryNamespace(
            firstEntries,
            indexExists: firstIndexBytes != nil
        )
        let finalIndexBytes = try locked.readValidated(relativePath: Self.ordinaryIndexPath)
        let finalEntries = try locked.enumerate(relativePath: Self.ordinaryDirectoryPath)
        guard firstIndexBytes == finalIndexBytes, firstEntries == finalEntries else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        if auditedNamespace == .indexed, finalIndexBytes != auditedIndexBytes {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }

        let index: OrdinaryRecoveryIndex
        if let bytes = finalIndexBytes {
            index = try decodeIndex(bytes)
        } else {
            index = emptyIndex
            _ = try writeIndex(index, role: .ordinaryEmptyIndex, locked: locked)
            try emit(
                .afterEmptyOrdinaryIndexDurable,
                role: .ordinaryEmptyIndex,
                targetName: Self.ordinaryIndexPath
            )
        }

        let blobsExist = finalEntries.contains {
            $0.name == "blobs" && $0.fileType == .directory
        }
        if !blobsExist {
            guard index.committed.primaryHash == currentPrimaryHash,
                  index.committed.slots.isEmpty,
                  index.committed.maintenance.pendingCleanupHashes.isEmpty,
                  index.committed.maintenance.lastHealthCode == nil,
                  index.prepared == nil
            else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
        }

        try locked.createManagedDirectory(
            relativePath: Self.ordinaryBlobsDirectoryPath,
            role: .ordinaryDirectory
        )
        try emit(
            .afterOrdinaryBlobsDirectoryDurable,
            role: .ordinaryDirectory,
            targetName: Self.ordinaryBlobsDirectoryPath
        )
        return index
    }

    private func validateMutationOrdinaryNamespace(
        _ entries: [NativeDirectoryEntry],
        indexExists: Bool
    ) throws {
        if !indexExists {
            guard entries.isEmpty else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
            return
        }

        guard entries.contains(where: {
            $0.name == "slots.json" && $0.fileType == .regular
        }),
            entries.allSatisfy({ entry in
                (entry.name == "slots.json" && entry.fileType == .regular)
                    || (entry.name == "blobs" && entry.fileType == .directory)
            }),
            Set(entries.map(\.name)).count == entries.count
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
    }

    private func verifyIndexedOrdinaryNamespace(
        actualPrimaryHash: String?,
        locked: NativeLockedBookDirectory
    ) throws {
        let expectedEmptyIndexBytes = try OrdinaryRecoveryCodec.encode(
            emptyOrdinaryIndex(currentPrimaryHash: actualPrimaryHash)
        )
        guard try locked.auditOrdinaryIndexNamespace(
            expectedEmptyIndexBytes: expectedEmptyIndexBytes
        ) == .indexed else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
    }

    private func emptyOrdinaryIndex(currentPrimaryHash: String?) -> OrdinaryRecoveryIndex {
        OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: currentPrimaryHash,
                slots: [],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [],
                    lastHealthCode: nil
                )
            ),
            prepared: nil
        )
    }

    private func validateReadOnlyPrimaryRelationship(
        _ index: OrdinaryRecoveryIndex,
        actualPrimaryHash: String?
    ) throws {
        if let prepared = index.prepared {
            guard actualPrimaryHash == prepared.sourceHash
                    || actualPrimaryHash == prepared.candidateHash
            else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
        } else if index.committed.primaryHash != actualPrimaryHash {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
    }

    private func auditIndexedOrdinary(
        _ index: OrdinaryRecoveryIndex,
        primaryBytes: Data?,
        sourceProof: NativeSourceProof,
        directory: NativeReadOnlyBookDirectory
    ) throws -> NativeRecoveryHealth {
        let blobsBefore = try directory.enumerateIfPresent(
            relativePath: Self.ordinaryBlobsDirectoryPath
        )
        let blobAudit = try directory.auditOrdinaryBlobNamespace(
            expectedSourceBytes: primaryBytes,
            sourceProof: sourceProof
        )

        guard let blobsBefore else {
            guard try directory.enumerateIfPresent(
                relativePath: Self.ordinaryBlobsDirectoryPath
            ) == nil,
                index.committed.slots.isEmpty,
                index.committed.maintenance.pendingCleanupHashes.isEmpty,
                index.prepared == nil,
                blobAudit.blobNames.isEmpty,
                blobAudit.validatedTempCount == 0
            else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
            return healthyOrdinaryHealth()
        }

        var presentHashes = Set<String>()
        for name in blobAudit.blobNames {
            guard let hash = ordinaryBlobHash(fromLeaf: name),
                  presentHashes.insert(hash).inserted,
                  try directory.readValidated(relativePath: ordinaryBlobPath(hash)) != nil
            else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
        }

        var referencedHashes = Set(index.committed.slots)
        if let prepared = index.prepared {
            referencedHashes.formUnion(prepared.committedSlots)
            referencedHashes.formUnion(prepared.nextSlots)
        }
        for hash in referencedHashes {
            guard try directory.readValidated(relativePath: ordinaryBlobPath(hash)) != nil else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
        }

        let pendingHashes = Set(index.committed.maintenance.pendingCleanupHashes)
        for hash in pendingHashes {
            if let bytes = try directory.readValidated(relativePath: ordinaryBlobPath(hash)) {
                guard ordinarySHA256(bytes) == hash else {
                    throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
                }
            }
        }

        guard try directory.enumerateIfPresent(
            relativePath: Self.ordinaryBlobsDirectoryPath
        ) == blobsBefore else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }

        let orphanHashes = presentHashes
            .subtracting(referencedHashes)
            .subtracting(pendingHashes)
            .sorted()
        if !pendingHashes.isEmpty {
            return NativeRecoveryHealth(
                domain: .ordinary,
                status: .degraded,
                auditComplete: true,
                code: "cleanup-pending",
                maintenancePendingCount: pendingHashes.count,
                detail: orphanHashes.isEmpty
                    ? nil
                    : "managed orphans: \(orphanHashes.joined(separator: ","))"
            )
        }
        if !orphanHashes.isEmpty {
            return NativeRecoveryHealth(
                domain: .ordinary,
                status: .degraded,
                auditComplete: true,
                code: "managed-orphan",
                maintenancePendingCount: 0,
                detail: "managed orphans: \(orphanHashes.joined(separator: ","))"
            )
        }
        return healthyOrdinaryHealth()
    }

    private func reconcilePreparedOrdinary(
        _ original: OrdinaryRecoveryIndex,
        actualPrimaryHash: String?,
        actualPrimaryBytes: Data?,
        managedOrphans: Set<String>,
        sourceProof: NativeSourceProof,
        locked: NativeLockedBookDirectory
    ) throws -> OrdinaryMaintenanceOutcome {
        var index = original
        guard let prepared = index.prepared else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }

        try verifyReferencedBlobs(index, locked: locked)
        let oldPending = Set(index.committed.maintenance.pendingCleanupHashes)
        if actualPrimaryHash == prepared.sourceHash {
            let finalSlots = Set(index.committed.slots)
            let preparedReferences = Set(prepared.committedSlots).union(prepared.nextSlots)
            index.committed.maintenance = ordinaryMaintenance(
                for: oldPending
                    .union(managedOrphans)
                    .union(preparedReferences.subtracting(finalSlots))
                    .subtracting(finalSlots)
            )
            index.prepared = nil
        } else if actualPrimaryHash == prepared.candidateHash {
            let finalSlots = Set(prepared.nextSlots)
            index.committed.primaryHash = prepared.candidateHash
            index.committed.slots = prepared.nextSlots
            index.committed.maintenance = ordinaryMaintenance(
                for: oldPending
                    .union(managedOrphans)
                    .union(Set(prepared.committedSlots).subtracting(finalSlots))
                    .subtracting(finalSlots)
            )
            index.prepared = nil
        } else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }

        let committedIndexProof = try writeIndex(
            index,
            role: .ordinaryCommittedIndex,
            locked: locked
        )
        try emit(
            .afterCommittedOrdinaryIndexDurable,
            role: .ordinaryCommittedIndex,
            targetName: Self.ordinaryIndexPath
        )
        return try finishOrdinaryMaintenance(
            index,
            actualPrimaryHash: actualPrimaryHash,
            actualPrimaryBytes: actualPrimaryBytes,
            sourceProof: sourceProof,
            authoritativeIndexProof: committedIndexProof,
            locked: locked
        )
    }

    private func persistStandaloneOrdinaryMaintenance(
        _ original: OrdinaryRecoveryIndex,
        managedOrphans: Set<String>,
        actualPrimaryHash: String?,
        sourceProof: NativeSourceProof,
        locked: NativeLockedBookDirectory
    ) throws -> OrdinaryIndexMutation {
        guard original.prepared == nil,
              original.committed.primaryHash == actualPrimaryHash
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        var index = original
        let referenced = Set(index.committed.slots)
        let pending = Set(index.committed.maintenance.pendingCleanupHashes)
            .union(managedOrphans)
            .subtracting(referenced)
        index.committed.maintenance = ordinaryMaintenance(for: pending)
        guard index != original else {
            return OrdinaryIndexMutation(index: index, authoritativeProof: nil)
        }

        let expectedProof = try exactOrdinaryIndexProof(
            matching: original,
            locked: locked
        )
        let newBytes = try OrdinaryRecoveryCodec.encode(index)
        let newProof = try locked.durableCompareAndSwapManaged(
            newBytes,
            replacing: expectedProof,
            sourceProof: sourceProof,
            role: .ordinaryHealthIndex
        )
        guard newProof.bytes == newBytes,
              try decodeCanonicalIndexProof(newProof) == index
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        try locked.revalidate(newProof)
        try locked.revalidatePrimarySource(sourceProof)
        return OrdinaryIndexMutation(index: index, authoritativeProof: newProof)
    }

    private func finishOrdinaryMaintenance(
        _ original: OrdinaryRecoveryIndex,
        actualPrimaryHash: String?,
        actualPrimaryBytes: Data?,
        sourceProof: NativeSourceProof,
        authoritativeIndexProof: NativeManagedFileProof? = nil,
        locked: NativeLockedBookDirectory
    ) throws -> OrdinaryMaintenanceOutcome {
        guard original.prepared == nil,
              original.committed.primaryHash == actualPrimaryHash
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }

        var index = original
        var latestProof: NativeManagedFileProof
        if let authoritativeIndexProof {
            guard try decodeCanonicalIndexProof(authoritativeIndexProof) == index else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
            try locked.revalidate(authoritativeIndexProof)
            latestProof = authoritativeIndexProof
        } else {
            latestProof = try exactOrdinaryIndexProof(matching: index, locked: locked)
        }
        let initialAudit = try verifyCompleteBlobNamespace(
            index,
            primaryBytes: actualPrimaryBytes,
            sourceProof: sourceProof,
            locked: locked
        )
        guard initialAudit.validatedTempCount == 0,
              initialAudit.orphanHashes.isEmpty
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }

        var attempted = Set<String>()
        while let targetHash = index.committed.maintenance.pendingCleanupHashes.first(
            where: { !attempted.contains($0) }
        ) {
            let result: NativeOrdinaryPendingCleanupResult
            do {
                result = try locked.unlinkOrdinaryPendingAndSync(
                    relativePath: ordinaryBlobPath(targetHash),
                    sourceProof: sourceProof,
                    authorizeLatestIndex: { proof in
                        let latest = try self.decodeCanonicalIndexProof(proof)
                        guard proof == latestProof else {
                            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
                        }
                        try self.validateReadOnlyPrimaryRelationship(
                            latest,
                            actualPrimaryHash: actualPrimaryHash
                        )
                        let referenced = self.ordinaryReferencedHashes(latest)
                        if referenced.contains(targetHash) {
                            return .preserveReferenced
                        }
                        if latest.committed.maintenance.pendingCleanupHashes.contains(targetHash) {
                            return .unlinkPending
                        }
                        return .notPending
                    }
                )
            } catch is NativeOrdinaryPendingCleanupIOError {
                return try verifyDurableDegradedOrdinaryMaintenance(
                    index,
                    authoritativeProof: latestProof,
                    actualPrimaryHash: actualPrimaryHash,
                    actualPrimaryBytes: actualPrimaryBytes,
                    sourceProof: sourceProof,
                    locked: locked
                )
            }
            latestProof = result.latestIndexProof
            index = try decodeCanonicalIndexProof(latestProof)
            try validateReadOnlyPrimaryRelationship(
                index,
                actualPrimaryHash: actualPrimaryHash
            )
            switch result.disposition {
            case .unlinked, .alreadyAbsent, .preservedReferenced, .notPending:
                attempted.insert(targetHash)
            }
        }

        for pendingHash in index.committed.maintenance.pendingCleanupHashes {
            guard try locked.readValidated(
                relativePath: ordinaryBlobPath(pendingHash)
            ) == nil else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
        }
        let preClearAudit = try verifyCompleteBlobNamespace(
            index,
            primaryBytes: actualPrimaryBytes,
            sourceProof: sourceProof,
            locked: locked
        )
        guard preClearAudit.validatedTempCount == 0,
              preClearAudit.orphanHashes.isEmpty
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        try locked.revalidate(latestProof)
        try locked.revalidatePrimarySource(sourceProof)

        if !index.committed.maintenance.pendingCleanupHashes.isEmpty {
            try emit(
                .beforeRecoveryHealthClear,
                role: .ordinaryHealthIndex,
                targetName: Self.ordinaryIndexPath
            )
            var cleared = index
            cleared.committed.maintenance = ordinaryMaintenance(for: [])
            let clearedBytes = try OrdinaryRecoveryCodec.encode(cleared)
            let clearedProof = try locked.durableCompareAndSwapManaged(
                clearedBytes,
                replacing: latestProof,
                sourceProof: sourceProof,
                role: .ordinaryHealthIndex
            )
            try emit(
                .afterRecoveryHealthClear,
                role: .ordinaryHealthIndex,
                targetName: Self.ordinaryIndexPath
            )
            guard clearedProof.bytes == clearedBytes,
                  try decodeCanonicalIndexProof(clearedProof) == cleared
            else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
            latestProof = clearedProof
            index = cleared
        }

        try locked.revalidate(latestProof)
        try locked.revalidatePrimarySource(sourceProof)
        let finalAudit = try verifyCompleteBlobNamespace(
            index,
            primaryBytes: actualPrimaryBytes,
            sourceProof: sourceProof,
            locked: locked
        )
        guard finalAudit.validatedTempCount == 0,
              finalAudit.orphanHashes.isEmpty,
              index.committed.maintenance.pendingCleanupHashes.isEmpty,
              index.committed.maintenance.lastHealthCode == nil,
              try locked.readManagedFileProof(
                  relativePath: Self.ordinaryIndexPath,
                  role: .ordinaryHealthIndex
              ) == latestProof
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        try verifyReferencedBlobs(index, locked: locked)
        try locked.revalidate(latestProof)
        try locked.revalidatePrimarySource(sourceProof)
        try locked.revalidateCanonicalIdentity()
        try verifyIndexedOrdinaryNamespace(
            actualPrimaryHash: actualPrimaryHash,
            locked: locked
        )
        return OrdinaryMaintenanceOutcome(
            index: index,
            authoritativeProof: latestProof,
            recoveryHealth: healthyOrdinaryHealth()
        )
    }

    private func verifyDurableDegradedOrdinaryMaintenance(
        _ index: OrdinaryRecoveryIndex,
        authoritativeProof: NativeManagedFileProof,
        actualPrimaryHash: String?,
        actualPrimaryBytes: Data?,
        sourceProof: NativeSourceProof,
        locked: NativeLockedBookDirectory
    ) throws -> OrdinaryMaintenanceOutcome {
        let pending = index.committed.maintenance.pendingCleanupHashes
        let canonicalIndexBytes = try OrdinaryRecoveryCodec.encode(index)
        guard index.prepared == nil,
              index.committed.primaryHash == actualPrimaryHash,
              actualPrimaryBytes.map(ordinarySHA256) == actualPrimaryHash,
              !pending.isEmpty,
              pending == pending.sorted(),
              Set(pending).count == pending.count,
              index.committed.maintenance.lastHealthCode == "cleanup-pending",
              authoritativeProof.bytes == canonicalIndexBytes,
              try decodeCanonicalIndexProof(authoritativeProof) == index
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }

        try locked.revalidate(authoritativeProof)
        try locked.revalidatePrimarySource(sourceProof)
        guard try locked.readManagedFileProof(
            relativePath: Self.ordinaryIndexPath,
            role: .ordinaryHealthIndex
        ) == authoritativeProof else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }

        let expectedSource = actualPrimaryHash.map(ExpectedBookSource.sha256) ?? .missing
        let freshSourceProof = try locked.verifyPrimarySource(expectedSource: expectedSource)
        let firstAudit = try verifyCompleteBlobNamespace(
            index,
            primaryBytes: actualPrimaryBytes,
            sourceProof: freshSourceProof,
            locked: locked
        )
        guard firstAudit.validatedTempCount == 0,
              firstAudit.orphanHashes.isEmpty
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        for pendingHash in pending {
            if let bytes = try locked.readValidated(
                relativePath: ordinaryBlobPath(pendingHash)
            ), ordinarySHA256(bytes) != pendingHash {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
        }
        try verifyReferencedBlobs(index, locked: locked)
        try locked.revalidate(authoritativeProof)
        try locked.revalidatePrimarySource(sourceProof)
        try locked.revalidatePrimarySource(freshSourceProof)
        try locked.revalidateCanonicalIdentity()

        guard try locked.readManagedFileProof(
            relativePath: Self.ordinaryIndexPath,
            role: .ordinaryHealthIndex
        ) == authoritativeProof else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        let finalAudit = try verifyCompleteBlobNamespace(
            index,
            primaryBytes: actualPrimaryBytes,
            sourceProof: freshSourceProof,
            locked: locked
        )
        guard finalAudit.validatedTempCount == 0,
              finalAudit.orphanHashes.isEmpty
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        try verifyReferencedBlobs(index, locked: locked)
        try locked.revalidate(authoritativeProof)
        try locked.revalidatePrimarySource(sourceProof)
        try locked.revalidatePrimarySource(freshSourceProof)
        try locked.revalidateCanonicalIdentity()
        guard try locked.readManagedFileProof(
            relativePath: Self.ordinaryIndexPath,
            role: .ordinaryHealthIndex
        ) == authoritativeProof else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        try locked.revalidate(authoritativeProof)
        try locked.revalidatePrimarySource(sourceProof)
        try locked.revalidatePrimarySource(freshSourceProof)
        try locked.revalidateCanonicalIdentity()
        try verifyIndexedOrdinaryNamespace(
            actualPrimaryHash: actualPrimaryHash,
            locked: locked
        )

        return OrdinaryMaintenanceOutcome(
            index: index,
            authoritativeProof: authoritativeProof,
            recoveryHealth: degradedOrdinaryHealth(pendingCount: pending.count)
        )
    }

    private func exactOrdinaryIndexProof(
        matching expected: OrdinaryRecoveryIndex,
        locked: NativeLockedBookDirectory
    ) throws -> NativeManagedFileProof {
        guard let proof = try locked.readManagedFileProof(
            relativePath: Self.ordinaryIndexPath,
            role: .ordinaryHealthIndex
        ), try decodeCanonicalIndexProof(proof) == expected else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        return proof
    }

    private func decodeCanonicalIndexProof(
        _ proof: NativeManagedFileProof
    ) throws -> OrdinaryRecoveryIndex {
        let index = try decodeIndex(proof.bytes)
        guard try OrdinaryRecoveryCodec.encode(index) == proof.bytes else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        return index
    }

    private func ordinaryReferencedHashes(_ index: OrdinaryRecoveryIndex) -> Set<String> {
        var hashes = Set(index.committed.slots)
        if let prepared = index.prepared {
            hashes.formUnion(prepared.committedSlots)
            hashes.formUnion(prepared.nextSlots)
        }
        return hashes
    }

    private func ordinaryMaintenance(for pending: Set<String>) -> OrdinaryMaintenanceState {
        OrdinaryMaintenanceState(
            pendingCleanupHashes: pending.sorted(),
            lastHealthCode: pending.isEmpty ? nil : "cleanup-pending"
        )
    }

    private func ensureOrdinaryBlob(
        hash: String,
        bytes: Data,
        locked: NativeLockedBookDirectory
    ) throws {
        let path = ordinaryBlobPath(hash)
        if let existing = try locked.readValidated(relativePath: path) {
            guard existing == bytes else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
            return
        }
        _ = try locked.durableWrite(
            bytes,
            relativePath: path,
            disposition: .createOnly,
            role: .ordinaryBlob
        )
        try emit(
            .afterOrdinaryBlobDurable,
            role: .ordinaryBlob,
            targetName: path
        )
    }

    private func verifyReferencedBlobs(
        _ index: OrdinaryRecoveryIndex,
        locked: NativeLockedBookDirectory
    ) throws {
        var hashes = Set(index.committed.slots)
        if let prepared = index.prepared {
            hashes.formUnion(prepared.committedSlots)
            hashes.formUnion(prepared.nextSlots)
        }
        for hash in hashes {
            guard try locked.readValidated(relativePath: ordinaryBlobPath(hash)) != nil else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
        }
    }

    private func verifyCompleteBlobNamespace(
        _ index: OrdinaryRecoveryIndex,
        primaryBytes: Data?,
        sourceProof: NativeSourceProof,
        locked: NativeLockedBookDirectory
    ) throws -> CompleteBlobNamespaceAudit {
        let firstEntries = try locked.enumerateIfPresent(
            relativePath: Self.ordinaryBlobsDirectoryPath
        )
        let firstAudit = try locked.auditOrdinaryBlobNamespace(
            expectedSourceBytes: primaryBytes,
            sourceProof: sourceProof
        )
        _ = try verifyCanonicalBlobContents(firstAudit.blobNames, locked: locked)
        let finalAudit = try locked.auditOrdinaryBlobNamespace(
            expectedSourceBytes: primaryBytes,
            sourceProof: sourceProof
        )
        let finalEntries = try locked.enumerateIfPresent(
            relativePath: Self.ordinaryBlobsDirectoryPath
        )
        guard finalAudit == firstAudit, finalEntries == firstEntries else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        let presentHashes = try verifyCanonicalBlobContents(
            finalAudit.blobNames,
            locked: locked
        )
        guard try locked.auditOrdinaryBlobNamespace(
            expectedSourceBytes: primaryBytes,
            sourceProof: sourceProof
        ) == finalAudit,
            try locked.enumerateIfPresent(
                relativePath: Self.ordinaryBlobsDirectoryPath
            ) == finalEntries
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        try verifyReferencedBlobs(index, locked: locked)

        var referencedHashes = Set(index.committed.slots)
        if let prepared = index.prepared {
            referencedHashes.formUnion(prepared.committedSlots)
            referencedHashes.formUnion(prepared.nextSlots)
        }
        return CompleteBlobNamespaceAudit(
            orphanHashes: presentHashes
                .subtracting(referencedHashes)
                .subtracting(index.committed.maintenance.pendingCleanupHashes),
            validatedTempCount: finalAudit.validatedTempCount
        )
    }

    private func convergeOrdinaryBlobCrashTemps(
        _ index: OrdinaryRecoveryIndex,
        primaryBytes: Data?,
        sourceProof: NativeSourceProof,
        locked: NativeLockedBookDirectory
    ) throws -> Set<String> {
        let initialAudit = try verifyCompleteBlobNamespace(
            index,
            primaryBytes: primaryBytes,
            sourceProof: sourceProof,
            locked: locked
        )
        try locked.cleanupOrdinaryBlobCrashTemps(
            expectedSourceBytes: primaryBytes,
            sourceProof: sourceProof
        )
        let finalAudit = try verifyCompleteBlobNamespace(
            index,
            primaryBytes: primaryBytes,
            sourceProof: sourceProof,
            locked: locked
        )
        guard finalAudit.validatedTempCount == 0,
              finalAudit.orphanHashes == initialAudit.orphanHashes
        else {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
        return finalAudit.orphanHashes
    }

    private func verifyCanonicalBlobContents(
        _ names: [String],
        locked: NativeLockedBookDirectory
    ) throws -> Set<String> {
        var hashes = Set<String>()
        for name in names {
            guard let hash = ordinaryBlobHash(fromLeaf: name),
                  hashes.insert(hash).inserted,
                  let bytes = try locked.readValidated(relativePath: ordinaryBlobPath(hash)),
                  ordinarySHA256(bytes) == hash
            else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
        }
        return hashes
    }

    private func initializeSnapshotIfNeeded(
        sourceBytes: Data,
        sourceProof: NativeSourceProof,
        locked: NativeLockedBookDirectory
    ) throws -> (index: SnapshotRecoveryIndex, proof: NativeManagedFileProof) {
        try locked.createManagedDirectory(
            relativePath: Self.recoveryDirectoryPath,
            role: .snapshotDirectory
        )
        try locked.createManagedDirectory(
            relativePath: Self.snapshotDirectoryPath,
            role: .snapshotDirectory
        )
        try emit(
            .afterSnapshotDirectoryDurable,
            role: .snapshotDirectory,
            targetName: Self.snapshotDirectoryPath
        )
        try locked.revalidatePrimarySource(sourceProof)

        let empty = emptySnapshotRecoveryIndex()
        let emptyBytes = try SnapshotRecoveryCodec.encode(empty)
        let initialNamespace = try locked.auditSnapshotIndexNamespace(
            expectedEmptyIndexBytes: emptyBytes
        )
        let initialIndexBytes = try locked.readValidated(relativePath: Self.snapshotIndexPath)
        let initialEntries = try locked.enumerate(relativePath: Self.snapshotDirectoryPath)
        guard try locked.auditSnapshotIndexNamespace(
            expectedEmptyIndexBytes: emptyBytes
        ) == initialNamespace,
            try locked.readValidated(relativePath: Self.snapshotIndexPath) == initialIndexBytes,
            try locked.enumerate(relativePath: Self.snapshotDirectoryPath) == initialEntries
        else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        switch initialNamespace {
        case .absent:
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        case .indexless:
            guard initialIndexBytes == nil else {
                throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
            }
        case .indexed:
            guard let initialIndexBytes else {
                throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
            }
            _ = try decodeSnapshotIndex(initialIndexBytes)
        }

        try locked.cleanupSnapshotIndexCrashTemps(expectedEmptyIndexBytes: emptyBytes)
        let finalNamespace = try locked.auditSnapshotIndexNamespace(
            expectedEmptyIndexBytes: emptyBytes
        )
        let finalIndexBytes = try locked.readValidated(relativePath: Self.snapshotIndexPath)
        let finalEntries = try locked.enumerate(relativePath: Self.snapshotDirectoryPath)
        guard try locked.auditSnapshotIndexNamespace(
            expectedEmptyIndexBytes: emptyBytes
        ) == finalNamespace,
            try locked.readValidated(relativePath: Self.snapshotIndexPath) == finalIndexBytes,
            try locked.enumerate(relativePath: Self.snapshotDirectoryPath) == finalEntries
        else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        switch (initialNamespace, finalNamespace) {
        case (.indexless, .indexless(validatedTempCount: 0)),
             (.indexed, .indexed(validatedTempCount: 0)):
            break
        default:
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }

        if let finalIndexBytes {
            let index = try decodeSnapshotIndex(finalIndexBytes)
            guard let proof = try locked.readManagedFileProof(
                relativePath: Self.snapshotIndexPath,
                role: .snapshotHealthIndex
            ), proof.bytes == finalIndexBytes else {
                throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
            }
            _ = try verifySnapshotNamespace(index, locked: locked)
            try locked.revalidatePrimarySource(sourceProof)
            return (index, proof)
        }

        guard finalEntries.isEmpty else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        let proof = try locked.durableCreateSnapshotIndex(
            emptyBytes,
            sourceProof: sourceProof
        )
        try emit(
            .afterEmptySnapshotIndexDurable,
            role: .snapshotEmptyIndex,
            targetName: Self.snapshotIndexPath
        )
        try locked.revalidate(proof)
        try locked.revalidatePrimarySource(sourceProof)
        guard try locked.readValidated(relativePath: Self.snapshotIndexPath) == proof.bytes,
              try locked.enumerate(relativePath: Self.snapshotDirectoryPath).count == 1,
              try locked.auditSnapshotIndexNamespace(
                expectedEmptyIndexBytes: emptyBytes
              ) == .indexed(validatedTempCount: 0)
        else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        return (empty, proof)
    }

    private func finishSnapshotMaintenance(
        _ startingIndex: SnapshotRecoveryIndex,
        sourceProof: NativeSourceProof,
        authoritativeProof: NativeManagedFileProof,
        locked: NativeLockedBookDirectory
    ) throws -> SnapshotMaintenanceOutcome {
        var index = startingIndex
        var currentProof = authoritativeProof
        try locked.revalidate(currentProof)
        try locked.revalidatePrimarySource(sourceProof)
        _ = try verifySnapshotNamespace(index, locked: locked)

        do {
            for hash in index.pendingCleanupHashes {
                let cleanup = try locked.unlinkSnapshotPendingAndSync(
                    relativePath: snapshotBlobPath(hash),
                    sourceProof: sourceProof,
                    authorizeLatestIndex: { proof in
                        let latest = try self.decodeSnapshotIndex(proof.bytes)
                        let retained = Set(latest.retained.map(\.hash))
                        if retained.contains(hash) {
                            return .preserveReferenced
                        }
                        if latest.pendingCleanupHashes.contains(hash) {
                            return .unlinkPending
                        }
                        return .notPending
                    }
                )
                let latest = try decodeSnapshotIndex(cleanup.latestIndexProof.bytes)
                switch cleanup.disposition {
                case .unlinked, .alreadyAbsent:
                    guard latest.pendingCleanupHashes.contains(hash),
                          !latest.retained.contains(where: { $0.hash == hash })
                    else {
                        throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
                    }
                case .preservedReferenced:
                    guard latest.retained.contains(where: { $0.hash == hash }),
                          !latest.pendingCleanupHashes.contains(hash)
                    else {
                        throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
                    }
                case .notPending:
                    throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
                }
                index = latest
                currentProof = cleanup.latestIndexProof
                try locked.revalidate(currentProof)
                try locked.revalidatePrimarySource(sourceProof)
            }
        } catch is NativeSnapshotPendingCleanupIOError {
            return try verifyDurableDegradedSnapshotMaintenance(
                index,
                sourceProof: sourceProof,
                authoritativeProof: currentProof,
                locked: locked
            )
        }

        let beforeClearAudit = try verifySnapshotNamespace(index, locked: locked)
        guard beforeClearAudit.orphanHashes.isEmpty else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        for hash in index.pendingCleanupHashes {
            guard !beforeClearAudit.presentHashes.contains(hash) else {
                throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
            }
        }

        if !index.pendingCleanupHashes.isEmpty {
            index.pendingCleanupHashes = []
            index.lastHealthCode = nil
            let finalBytes = try SnapshotRecoveryCodec.encode(index)
            try emit(
                .beforeRecoveryHealthClear,
                role: .snapshotHealthIndex,
                targetName: Self.snapshotIndexPath
            )
            currentProof = try locked.durableCompareAndSwapManaged(
                finalBytes,
                replacing: currentProof,
                sourceProof: sourceProof,
                role: .snapshotHealthIndex
            )
            try emit(
                .afterRecoveryHealthClear,
                role: .snapshotHealthIndex,
                targetName: Self.snapshotIndexPath
            )
        }

        try locked.revalidate(currentProof)
        try locked.revalidatePrimarySource(sourceProof)
        let finalAudit = try verifySnapshotNamespace(index, locked: locked)
        guard finalAudit.orphanHashes.isEmpty,
              index.pendingCleanupHashes.isEmpty,
              index.lastHealthCode == nil,
              try locked.readValidated(relativePath: Self.snapshotIndexPath) == currentProof.bytes,
              try decodeSnapshotIndex(currentProof.bytes) == index
        else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        try locked.revalidateCanonicalIdentity()
        _ = try verifySnapshotNamespace(index, locked: locked)
        try locked.revalidate(currentProof)
        try locked.revalidatePrimarySource(sourceProof)
        return SnapshotMaintenanceOutcome(
            index: index,
            authoritativeProof: currentProof,
            recoveryHealth: healthySnapshotHealth()
        )
    }

    private func verifyDurableDegradedSnapshotMaintenance(
        _ index: SnapshotRecoveryIndex,
        sourceProof: NativeSourceProof,
        authoritativeProof: NativeManagedFileProof,
        locked: NativeLockedBookDirectory
    ) throws -> SnapshotMaintenanceOutcome {
        guard !index.pendingCleanupHashes.isEmpty,
              index.lastHealthCode == "cleanup-pending",
              let firstProof = try locked.readManagedFileProof(
                relativePath: Self.snapshotIndexPath,
                role: .snapshotHealthIndex
              ),
              firstProof == authoritativeProof,
              try decodeSnapshotIndex(firstProof.bytes) == index
        else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        try locked.revalidate(firstProof)
        try locked.revalidatePrimarySource(sourceProof)
        let firstAudit = try verifySnapshotNamespace(index, locked: locked)
        guard firstAudit.orphanHashes.isEmpty,
              let finalProof = try locked.readManagedFileProof(
                relativePath: Self.snapshotIndexPath,
                role: .snapshotHealthIndex
              ),
              finalProof == firstProof,
              try decodeSnapshotIndex(finalProof.bytes) == index,
              try verifySnapshotNamespace(index, locked: locked) == firstAudit
        else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        try locked.revalidate(finalProof)
        try locked.revalidatePrimarySource(sourceProof)
        try locked.revalidateCanonicalIdentity()
        return SnapshotMaintenanceOutcome(
            index: index,
            authoritativeProof: finalProof,
            recoveryHealth: degradedSnapshotHealth(
                pendingCount: index.pendingCleanupHashes.count
            )
        )
    }

    private func verifySnapshotNamespace(
        _ index: SnapshotRecoveryIndex,
        locked: NativeLockedBookDirectory
    ) throws -> SnapshotNamespaceAudit {
        let entries = try locked.enumerate(relativePath: Self.snapshotDirectoryPath)
        guard Set(entries.map(\.name)).count == entries.count else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        var present = Set<String>()
        var foundIndex = false
        for entry in entries {
            if entry.name == "index.json" {
                guard entry.fileType == .regular, !foundIndex else {
                    throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
                }
                foundIndex = true
                continue
            }
            guard entry.fileType == .regular,
                  let hash = snapshotBlobHash(fromLeaf: entry.name),
                  present.insert(hash).inserted,
                  let bytes = try locked.readValidated(
                    relativePath: snapshotBlobPath(hash)
                  ),
                  ordinarySHA256(bytes) == hash
            else {
                throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
            }
        }
        let retained = Set(index.retained.map(\.hash))
        guard foundIndex, retained.isSubset(of: present) else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        for hash in index.pendingCleanupHashes where present.contains(hash) {
            guard let bytes = try locked.readValidated(relativePath: snapshotBlobPath(hash)),
                  ordinarySHA256(bytes) == hash
            else {
                throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
            }
        }
        guard try locked.enumerate(relativePath: Self.snapshotDirectoryPath) == entries else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        return SnapshotNamespaceAudit(
            presentHashes: present,
            orphanHashes: present
                .subtracting(retained)
                .subtracting(index.pendingCleanupHashes)
        )
    }

    private func verifySnapshotNamespace(
        _ index: SnapshotRecoveryIndex,
        entries: [NativeDirectoryEntry],
        directory: NativeReadOnlyBookDirectory
    ) throws -> SnapshotNamespaceAudit {
        guard Set(entries.map(\.name)).count == entries.count else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        var present = Set<String>()
        var foundIndex = false
        for entry in entries {
            if entry.name == "index.json" {
                guard entry.fileType == .regular, !foundIndex else {
                    throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
                }
                foundIndex = true
                continue
            }
            guard entry.fileType == .regular,
                  let hash = snapshotBlobHash(fromLeaf: entry.name),
                  present.insert(hash).inserted,
                  let bytes = try directory.readValidated(
                    relativePath: snapshotBlobPath(hash)
                  ),
                  ordinarySHA256(bytes) == hash
            else {
                throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
            }
        }
        let retained = Set(index.retained.map(\.hash))
        guard foundIndex, retained.isSubset(of: present) else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        for hash in index.pendingCleanupHashes where present.contains(hash) {
            guard let bytes = try directory.readValidated(relativePath: snapshotBlobPath(hash)),
                  ordinarySHA256(bytes) == hash
            else {
                throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
            }
        }
        return SnapshotNamespaceAudit(
            presentHashes: present,
            orphanHashes: present
                .subtracting(retained)
                .subtracting(index.pendingCleanupHashes)
        )
    }

    private func decodeSnapshotIndex(_ data: Data) throws -> SnapshotRecoveryIndex {
        do {
            return try SnapshotRecoveryCodec.decode(data)
        } catch {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
    }

    private func emptySnapshotRecoveryIndex() -> SnapshotRecoveryIndex {
        SnapshotRecoveryIndex(
            format: SnapshotRecoveryIndex.expectedFormat,
            version: SnapshotRecoveryIndex.expectedVersion,
            retained: [],
            nextOrdinal: 0,
            pendingCleanupHashes: [],
            lastHealthCode: nil
        )
    }

    private func snapshotEntriesWithoutValidatedTemps(
        _ entries: [NativeDirectoryEntry],
        validatedTempCount: Int
    ) throws -> [NativeDirectoryEntry] {
        let semanticEntries = entries.filter {
            !$0.name.hasPrefix(".AssetTracker.tmp.")
        }
        guard entries.count - semanticEntries.count == validatedTempCount else {
            throw AssetTrackerRecoveryStoreError.corruptSnapshotRecovery
        }
        return semanticEntries
    }

    private func snapshotBlobPath(_ hash: String) -> String {
        "\(Self.snapshotDirectoryPath)/\(hash).json"
    }

    private func snapshotBlobHash(fromLeaf name: String) -> String? {
        guard name.hasSuffix(".json"), name != "index.json" else { return nil }
        let hash = String(name.dropLast(5))
        do {
            try requireCanonicalSnapshotHash(hash, field: "snapshot blob")
            return hash
        } catch {
            return nil
        }
    }

    private func writeIndex(
        _ index: OrdinaryRecoveryIndex,
        role: NativeDurabilityRole,
        locked: NativeLockedBookDirectory
    ) throws -> NativeManagedFileProof {
        try locked.durableWriteOrdinaryIndex(
            OrdinaryRecoveryCodec.encode(index),
            role: role
        )
    }

    private func decodeIndex(_ data: Data) throws -> OrdinaryRecoveryIndex {
        do {
            return try OrdinaryRecoveryCodec.decode(data)
        } catch {
            throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
        }
    }

    private func verifiedSourceHash(
        expectedSource: ExpectedBookSource,
        sourceBytes: Data?
    ) throws -> String? {
        switch expectedSource {
        case .missing:
            guard sourceBytes == nil else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
            return nil
        case .sha256(let expectedHash):
            guard let sourceBytes, ordinarySHA256(sourceBytes) == expectedHash else {
                throw AssetTrackerRecoveryStoreError.corruptOrdinaryRecovery
            }
            return expectedHash
        }
    }

    private func ordinaryBlobPath(_ hash: String) -> String {
        "\(Self.ordinaryBlobsDirectoryPath)/\(hash).json"
    }

    private func ordinaryBlobHash(fromLeaf name: String) -> String? {
        guard name.hasSuffix(".json") else { return nil }
        let hash = String(name.dropLast(5))
        do {
            try requireCanonicalHash(hash, field: "ordinary blob")
            return hash
        } catch {
            return nil
        }
    }

    private func emit(
        _ point: NativeDurabilityFaultPoint,
        role: NativeDurabilityRole,
        targetName: String
    ) throws {
        try faultHandler(NativeDurabilityFaultEvent(
            point: point,
            role: role,
            targetName: targetName
        ))
    }

    private func healthyOrdinaryHealth() -> NativeRecoveryHealth {
        NativeRecoveryHealth(
            domain: .ordinary,
            status: .healthy,
            auditComplete: true,
            code: nil,
            maintenancePendingCount: 0,
            detail: nil
        )
    }

    private func degradedOrdinaryHealth(pendingCount: Int) -> NativeRecoveryHealth {
        NativeRecoveryHealth(
            domain: .ordinary,
            status: .degraded,
            auditComplete: true,
            code: "cleanup-pending",
            maintenancePendingCount: pendingCount,
            detail: nil
        )
    }

    private func notApplicableOrdinaryHealth() -> NativeRecoveryHealth {
        NativeRecoveryHealth(
            domain: .ordinary,
            status: .notApplicable,
            auditComplete: true,
            code: nil,
            maintenancePendingCount: 0,
            detail: nil
        )
    }

    private func healthySnapshotHealth() -> NativeRecoveryHealth {
        NativeRecoveryHealth(
            domain: .snapshot,
            status: .healthy,
            auditComplete: true,
            code: nil,
            maintenancePendingCount: 0,
            detail: nil
        )
    }

    private func degradedSnapshotHealth(pendingCount: Int) -> NativeRecoveryHealth {
        NativeRecoveryHealth(
            domain: .snapshot,
            status: .degraded,
            auditComplete: true,
            code: "cleanup-pending",
            maintenancePendingCount: pendingCount,
            detail: nil
        )
    }

    private func managedOrphanSnapshotHealth(_ hashes: Set<String>) -> NativeRecoveryHealth {
        NativeRecoveryHealth(
            domain: .snapshot,
            status: .degraded,
            auditComplete: true,
            code: "managed-orphan",
            maintenancePendingCount: 0,
            detail: "managed orphans: \(hashes.sorted().joined(separator: ","))"
        )
    }

    private func notApplicableSnapshotHealth() -> NativeRecoveryHealth {
        NativeRecoveryHealth(
            domain: .snapshot,
            status: .notApplicable,
            auditComplete: true,
            code: nil,
            maintenancePendingCount: 0,
            detail: nil
        )
    }
}

private func ordinarySHA256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}
