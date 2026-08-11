import Foundation
import CryptoKit
import Darwin
import XCTest
@testable import AssetTrackerCore

final class AssetTrackerRecoveryStoreTests: XCTestCase {
    func testSnapshotIndexEncodingIsExactDeterministicMillisecondsAndStrictSemantics() throws {
        let h0 = String(repeating: "0", count: 64)
        let point = SnapshotPoint(
            hash: h0,
            ordinal: 7,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000.123)
        )
        let index = SnapshotRecoveryIndex(
            format: SnapshotRecoveryIndex.expectedFormat,
            version: SnapshotRecoveryIndex.expectedVersion,
            retained: [point],
            nextOrdinal: 8,
            pendingCleanupHashes: [],
            lastHealthCode: nil
        )

        let encoded = try SnapshotRecoveryCodec.encode(index)
        let expected = #"{"format":"qiushan.asset-book.snapshot-recovery","lastHealthCode":null,"nextOrdinal":8,"pendingCleanupHashes":[],"retained":[{"createdAt":1700000000123,"hash":"0000000000000000000000000000000000000000000000000000000000000000","ordinal":7}],"version":1}"#

        XCTAssertEqual(encoded, Data(expected.utf8))
        XCTAssertEqual(try SnapshotRecoveryCodec.encode(index), encoded)
        XCTAssertEqual(try SnapshotRecoveryCodec.decode(encoded), index)

        let h1 = String(repeating: "1", count: 64)
        let invalid: [(String, SnapshotRecoveryIndex)] = [
            ("retained order", SnapshotRecoveryIndex(
                format: index.format,
                version: index.version,
                retained: [
                    SnapshotPoint(hash: h0, ordinal: 0, createdAt: point.createdAt),
                    SnapshotPoint(hash: h1, ordinal: 1, createdAt: point.createdAt),
                ],
                nextOrdinal: 2,
                pendingCleanupHashes: [],
                lastHealthCode: nil
            )),
            ("duplicate hash", SnapshotRecoveryIndex(
                format: index.format,
                version: index.version,
                retained: [
                    SnapshotPoint(hash: h0, ordinal: 1, createdAt: point.createdAt),
                    SnapshotPoint(hash: h0, ordinal: 0, createdAt: point.createdAt),
                ],
                nextOrdinal: 2,
                pendingCleanupHashes: [],
                lastHealthCode: nil
            )),
            ("duplicate ordinal", SnapshotRecoveryIndex(
                format: index.format,
                version: index.version,
                retained: [
                    SnapshotPoint(hash: h0, ordinal: 1, createdAt: point.createdAt),
                    SnapshotPoint(hash: h1, ordinal: 1, createdAt: point.createdAt),
                ],
                nextOrdinal: 2,
                pendingCleanupHashes: [],
                lastHealthCode: nil
            )),
            ("ordinal range", SnapshotRecoveryIndex(
                format: index.format,
                version: index.version,
                retained: [SnapshotPoint(hash: h0, ordinal: 8, createdAt: point.createdAt)],
                nextOrdinal: 8,
                pendingCleanupHashes: [],
                lastHealthCode: nil
            )),
            ("pending intersection", SnapshotRecoveryIndex(
                format: index.format,
                version: index.version,
                retained: [point],
                nextOrdinal: 8,
                pendingCleanupHashes: [h0],
                lastHealthCode: "cleanup-pending"
            )),
            ("pending without code", SnapshotRecoveryIndex(
                format: index.format,
                version: index.version,
                retained: [point],
                nextOrdinal: 8,
                pendingCleanupHashes: [h1],
                lastHealthCode: nil
            )),
            ("code without pending", SnapshotRecoveryIndex(
                format: index.format,
                version: index.version,
                retained: [point],
                nextOrdinal: 8,
                pendingCleanupHashes: [],
                lastHealthCode: "cleanup-pending"
            )),
        ]
        for (name, invalidIndex) in invalid {
            XCTAssertThrowsError(try SnapshotRecoveryCodec.encode(invalidIndex), name)
        }
    }

    func testMissingSnapshotIndexKeyAndWrongFormatOrVersionFailClosed() throws {
        let valid: [String: Any] = [
            "format": "qiushan.asset-book.snapshot-recovery",
            "version": 1,
            "retained": [],
            "nextOrdinal": 0,
            "pendingCleanupHashes": [],
            "lastHealthCode": NSNull(),
        ]
        for key in valid.keys {
            var object = valid
            object.removeValue(forKey: key)
            XCTAssertThrowsError(try SnapshotRecoveryCodec.decode(data(for: object)), key)
        }
        var extra = valid
        extra["unexpected"] = true
        XCTAssertThrowsError(try SnapshotRecoveryCodec.decode(data(for: extra)))
        var wrongFormat = valid
        wrongFormat["format"] = "qiushan.asset-book.snapshot-recovery.other"
        XCTAssertThrowsError(try SnapshotRecoveryCodec.decode(data(for: wrongFormat)))
        var wrongVersion = valid
        wrongVersion["version"] = 2
        XCTAssertThrowsError(try SnapshotRecoveryCodec.decode(data(for: wrongVersion)))

        let h0 = String(repeating: "0", count: 64)
        let retained: [[String: Any]] = [[
            "hash": h0,
            "ordinal": 0,
            "createdAt": 1_700_000_000_123,
        ]]
        for key in ["hash", "ordinal", "createdAt"] {
            var object = valid
            var point = retained[0]
            point.removeValue(forKey: key)
            object["retained"] = [point]
            object["nextOrdinal"] = 1
            XCTAssertThrowsError(try SnapshotRecoveryCodec.decode(data(for: object)), key)
        }
        var pointExtra = valid
        var point = retained[0]
        point["unexpected"] = true
        pointExtra["retained"] = [point]
        pointExtra["nextOrdinal"] = 1
        XCTAssertThrowsError(try SnapshotRecoveryCodec.decode(data(for: pointExtra)))
    }

    func testRetainedSameHashDeduplicatesWithoutChangingOrdinalOrCreatedAt() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let primaryBytes = Data(#"{"snapshot":"first"}"#.utf8)
        let primaryHash = sha256(primaryBytes)
        let createdAt = Date(timeIntervalSince1970: 1_700_000_000.125)
        try fixture.writeInitialPrimary(primaryBytes)
        let events = LockedOrdinaryFaultEvents()
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { events.append($0) }

        let created = try store.createSnapshot(
            expectedHash: primaryHash,
            createdAt: createdAt
        )

        XCTAssertEqual(created.sourceHash, primaryHash)
        XCTAssertEqual(created.snapshotHash, primaryHash)
        XCTAssertEqual(created.ordinal, 0)
        XCTAssertEqual(created.snapshotStatus, .created)
        XCTAssertEqual(created.retainedCount, 1)
        XCTAssertEqual(created.recoveryHealth, healthySnapshotHealth())
        XCTAssertEqual(try Data(contentsOf: fixture.snapshotBlobURL(primaryHash)), primaryBytes)
        let createdIndex = try fixture.readSnapshotIndex()
        XCTAssertEqual(createdIndex.retained, [
            SnapshotPoint(hash: primaryHash, ordinal: 0, createdAt: createdAt)
        ])
        XCTAssertEqual(createdIndex.nextOrdinal, 1)
        XCTAssertEqual(createdIndex.pendingCleanupHashes, [])
        XCTAssertNil(createdIndex.lastHealthCode)
        let indexBytes = try Data(contentsOf: fixture.snapshotIndexURL)
        let indexIdentity = try fileIdentity(of: fixture.snapshotIndexURL)

        let deduplicated = try store.createSnapshot(
            expectedHash: primaryHash,
            createdAt: createdAt.addingTimeInterval(5_000)
        )

        XCTAssertEqual(deduplicated.ordinal, 0)
        XCTAssertEqual(deduplicated.snapshotStatus, .deduplicated)
        XCTAssertEqual(deduplicated.retainedCount, 1)
        XCTAssertEqual(deduplicated.recoveryHealth, healthySnapshotHealth())
        XCTAssertEqual(try Data(contentsOf: fixture.snapshotIndexURL), indexBytes)
        XCTAssertEqual(try fileIdentity(of: fixture.snapshotIndexURL), indexIdentity)
        XCTAssertEqual(try fixture.readSnapshotIndex(), createdIndex)

        let policy = events.snapshot().filter {
            $0.point == .afterSnapshotDirectoryDurable
                || $0.point == .afterEmptySnapshotIndexDurable
                || $0.point == .afterSnapshotBlobDurable
                || $0.point == .afterSnapshotIndexDurable
        }
        XCTAssertEqual(policy.map(\.point), [
            .afterSnapshotDirectoryDurable,
            .afterEmptySnapshotIndexDurable,
            .afterSnapshotBlobDurable,
            .afterSnapshotIndexDurable,
            .afterSnapshotDirectoryDurable,
        ])
        XCTAssertEqual(policy.map(\.role), [
            .snapshotDirectory,
            .snapshotEmptyIndex,
            .snapshotBlob,
            .snapshotFinalIndex,
            .snapshotDirectory,
        ])
        XCTAssertEqual(policy.map(\.targetName), [
            "Recovery/snapshots",
            "Recovery/snapshots/index.json",
            "Recovery/snapshots/\(primaryHash).json",
            "Recovery/snapshots/index.json",
            "Recovery/snapshots",
        ])
    }

    func testPendingOrOrphanSameHashCreatesOneFreshLogicalPointAndOrdinal() throws {
        for kind in ["pending", "orphan"] {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            let bytes = Data("snapshot-rescue-\(kind)".utf8)
            let hash = sha256(bytes)
            let createdAt = Date(timeIntervalSince1970: 1_700_100_000.25)
            try fixture.writeInitialPrimary(bytes)
            try fixture.prepareSnapshots()
            try fixture.writeSnapshotBlob(bytes)
            let initialIndex = SnapshotRecoveryIndex(
                format: SnapshotRecoveryIndex.expectedFormat,
                version: SnapshotRecoveryIndex.expectedVersion,
                retained: [],
                nextOrdinal: kind == "pending" ? 5 : 2,
                pendingCleanupHashes: kind == "pending" ? [hash] : [],
                lastHealthCode: kind == "pending" ? "cleanup-pending" : nil
            )
            try fixture.writeSnapshotIndex(initialIndex)
            let freshStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            if kind == "orphan" {
                XCTAssertEqual(try freshStore.auditSnapshot(), managedOrphanSnapshotHealth([hash]))
            }

            let result = try freshStore.createSnapshot(
                expectedHash: hash,
                createdAt: createdAt
            )

            let expectedOrdinal: UInt64 = kind == "pending" ? 5 : 2
            XCTAssertEqual(result.snapshotStatus, .created, kind)
            XCTAssertEqual(result.ordinal, expectedOrdinal, kind)
            XCTAssertEqual(result.retainedCount, 1, kind)
            XCTAssertEqual(result.recoveryHealth, healthySnapshotHealth(), kind)
            XCTAssertEqual(try Data(contentsOf: fixture.snapshotBlobURL(hash)), bytes, kind)
            XCTAssertEqual(try fixture.readSnapshotIndex(), SnapshotRecoveryIndex(
                format: SnapshotRecoveryIndex.expectedFormat,
                version: SnapshotRecoveryIndex.expectedVersion,
                retained: [SnapshotPoint(hash: hash, ordinal: expectedOrdinal, createdAt: createdAt)],
                nextOrdinal: expectedOrdinal + 1,
                pendingCleanupHashes: [],
                lastHealthCode: nil
            ), kind)
            XCTAssertEqual(try freshStore.auditSnapshot(), healthySnapshotHealth(), kind)
        }
    }

    func testOrdinalUniquenessRangeAndOverflowFailBeforeBlobCreation() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let bytes = Data(#"{"snapshot":"overflow"}"#.utf8)
        let hash = sha256(bytes)
        try fixture.writeInitialPrimary(bytes)
        try fixture.prepareSnapshots()
        try fixture.writeSnapshotIndex(SnapshotRecoveryIndex(
            format: SnapshotRecoveryIndex.expectedFormat,
            version: SnapshotRecoveryIndex.expectedVersion,
            retained: [],
            nextOrdinal: UInt64.max,
            pendingCleanupHashes: [],
            lastHealthCode: nil
        ))
        let indexBytes = try Data(contentsOf: fixture.snapshotIndexURL)
        let indexIdentity = try fileIdentity(of: fixture.snapshotIndexURL)

        XCTAssertThrowsError(try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).createSnapshot(
            expectedHash: hash,
            createdAt: Date(timeIntervalSince1970: 1_700_200_000)
        )) { error in
            XCTAssertEqual(error as? AssetTrackerRecoveryStoreError, .snapshotOrdinalOverflow)
        }

        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.snapshotBlobURL(hash).path))
        XCTAssertEqual(try Data(contentsOf: fixture.snapshotIndexURL), indexBytes)
        XCTAssertEqual(try fileIdentity(of: fixture.snapshotIndexURL), indexIdentity)
    }

    func testSnapshotRejectsCorruptUnsupportedOrChangedPrimaryWithoutArtifact() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let actual = Data(#"{"snapshot":"actual"}"#.utf8)
        let expected = Data(#"{"snapshot":"expected"}"#.utf8)
        try fixture.writeInitialPrimary(actual)

        XCTAssertThrowsError(try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).createSnapshot(
            expectedHash: sha256(expected),
            createdAt: Date(timeIntervalSince1970: 1_700_300_000)
        ))
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.snapshotsURL.path))
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), actual)

        XCTAssertThrowsError(try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).createSnapshot(
            expectedHash: "NOT-A-SHA",
            createdAt: Date(timeIntervalSince1970: 1_700_300_001)
        )) { error in
            XCTAssertEqual(error as? AssetTrackerRecoveryStoreError, .invalidSnapshotHash)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.snapshotsURL.path))
    }

    func testTwentyFifthSnapshotCommitsAtMostTwentyFourAndPreservesNewestThree() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let existingBytes = (0 ..< 24).map { Data("retained-snapshot-\($0)".utf8) }
        let existingHashes = existingBytes.map(sha256)
        var points: [SnapshotPoint] = []
        for ordinal in 0 ..< 24 {
            points.append(SnapshotPoint(
                hash: existingHashes[ordinal],
                ordinal: UInt64(ordinal),
                createdAt: Date(timeIntervalSince1970: 1_700_000_000 + Double(ordinal))
            ))
        }
        points.sort { $0.ordinal == $1.ordinal ? $0.hash < $1.hash : $0.ordinal > $1.ordinal }
        let newestBytes = Data("retained-snapshot-24".utf8)
        let newestHash = sha256(newestBytes)
        try fixture.writeInitialPrimary(newestBytes)
        try fixture.prepareSnapshots()
        try fixture.writeSnapshotBlobs(existingBytes)
        try fixture.writeSnapshotIndex(SnapshotRecoveryIndex(
            format: SnapshotRecoveryIndex.expectedFormat,
            version: SnapshotRecoveryIndex.expectedVersion,
            retained: points,
            nextOrdinal: 24,
            pendingCleanupHashes: [],
            lastHealthCode: nil
        ))
        let observations = LockedSnapshotIndexBytes()
        let events = LockedOrdinaryFaultEvents()
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
            if event.point == .afterSnapshotIndexDurable {
                observations.append(try Data(contentsOf: fixture.snapshotIndexURL))
            }
        }

        let result = try store.createSnapshot(
            expectedHash: newestHash,
            createdAt: Date(timeIntervalSince1970: 1_700_000_024)
        )

        let committedPending = try SnapshotRecoveryCodec.decode(
            XCTUnwrap(observations.snapshot().first)
        )
        XCTAssertEqual(committedPending.retained.count, 24)
        XCTAssertEqual(committedPending.retained.map(\.ordinal), Array((1 ... 24).reversed()).map(UInt64.init))
        XCTAssertEqual(committedPending.pendingCleanupHashes, [existingHashes[0]])
        XCTAssertEqual(committedPending.lastHealthCode, "cleanup-pending")
        XCTAssertEqual(Set(committedPending.retained.prefix(3).map(\.ordinal)), [22, 23, 24])

        let finalIndex = try fixture.readSnapshotIndex()
        XCTAssertEqual(finalIndex.retained.map(\.ordinal), Array((1 ... 24).reversed()).map(UInt64.init))
        XCTAssertEqual(finalIndex.nextOrdinal, 25)
        XCTAssertEqual(finalIndex.pendingCleanupHashes, [])
        XCTAssertNil(finalIndex.lastHealthCode)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.snapshotBlobURL(existingHashes[0]).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.snapshotBlobURL(newestHash).path))
        XCTAssertEqual(result.ordinal, 24)
        XCTAssertEqual(result.retainedCount, 24)
        XCTAssertEqual(result.recoveryHealth, healthySnapshotHealth())

        let retention = events.snapshot().filter {
            $0.point == .beforeRetentionUnlink
                || $0.point == .afterRetentionUnlink
                || $0.point == .afterRetentionDirectoryFSync
        }
        XCTAssertEqual(retention.map(\.point), [
            .beforeRetentionUnlink,
            .afterRetentionUnlink,
            .afterRetentionDirectoryFSync,
        ])
        XCTAssertEqual(retention.map(\.role), [
            .snapshotFinalIndex,
            .snapshotFinalIndex,
            .snapshotFinalIndex,
        ])
        XCTAssertEqual(
            retention.map(\.targetName),
            Array(repeating: "Recovery/snapshots/\(existingHashes[0]).json", count: 3)
        )
    }

    func testClockRollbackAndEqualTimestampsCannotEvictTheNewestOrdinal() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let existingBytes = (0 ..< 24).map { Data("clock-snapshot-\($0)".utf8) }
        let existingHashes = existingBytes.map(sha256)
        let equalTime = Date(timeIntervalSince1970: 1_800_000_000)
        var points: [SnapshotPoint] = []
        for ordinal in 0 ..< 24 {
            points.append(SnapshotPoint(
                hash: existingHashes[ordinal],
                ordinal: UInt64(ordinal),
                createdAt: ordinal == 0
                    ? Date(timeIntervalSince1970: 2_000_000_000)
                    : equalTime
            ))
        }
        points.sort { $0.ordinal == $1.ordinal ? $0.hash < $1.hash : $0.ordinal > $1.ordinal }
        let newestBytes = Data("clock-snapshot-24".utf8)
        let newestHash = sha256(newestBytes)
        try fixture.writeInitialPrimary(newestBytes)
        try fixture.prepareSnapshots()
        try fixture.writeSnapshotBlobs(existingBytes)
        try fixture.writeSnapshotIndex(SnapshotRecoveryIndex(
            format: SnapshotRecoveryIndex.expectedFormat,
            version: SnapshotRecoveryIndex.expectedVersion,
            retained: points,
            nextOrdinal: 24,
            pendingCleanupHashes: [],
            lastHealthCode: nil
        ))

        let result = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).createSnapshot(
            expectedHash: newestHash,
            createdAt: Date(timeIntervalSince1970: 1_000_000_000)
        )

        let index = try fixture.readSnapshotIndex()
        XCTAssertEqual(index.retained.map(\.ordinal), Array((1 ... 24).reversed()).map(UInt64.init))
        XCTAssertEqual(index.retained.first?.hash, newestHash)
        XCTAssertFalse(index.retained.contains { $0.hash == existingHashes[0] })
        XCTAssertEqual(result.ordinal, 24)
        XCTAssertEqual(result.recoveryHealth, healthySnapshotHealth())
    }

    func testEveryRetainedBlobIsReverifiedBeforeIndexCommit() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let retainedBytes = Data("retained-before-final-commit".utf8)
        let retainedHash = sha256(retainedBytes)
        let newBytes = Data("new-before-final-commit".utf8)
        let newHash = sha256(newBytes)
        try fixture.writeInitialPrimary(newBytes)
        try fixture.prepareSnapshots()
        try fixture.writeSnapshotBlob(retainedBytes)
        try fixture.writeSnapshotIndex(SnapshotRecoveryIndex(
            format: SnapshotRecoveryIndex.expectedFormat,
            version: SnapshotRecoveryIndex.expectedVersion,
            retained: [SnapshotPoint(
                hash: retainedHash,
                ordinal: 0,
                createdAt: Date(timeIntervalSince1970: 1_700_000_000)
            )],
            nextOrdinal: 1,
            pendingCleanupHashes: [],
            lastHealthCode: nil
        ))
        let originalIndexBytes = try Data(contentsOf: fixture.snapshotIndexURL)
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            if event.point == .afterSnapshotBlobDurable,
               event.role == .snapshotBlob
            {
                try writePrivateTestFile(
                    Data("corrupt-retained-after-new-blob".utf8),
                    to: fixture.snapshotBlobURL(retainedHash)
                )
            }
        }

        XCTAssertThrowsError(try store.createSnapshot(
            expectedHash: newHash,
            createdAt: Date(timeIntervalSince1970: 1_700_000_001)
        ))

        XCTAssertEqual(try Data(contentsOf: fixture.snapshotIndexURL), originalIndexBytes)
        XCTAssertEqual(
            try Data(contentsOf: fixture.snapshotBlobURL(retainedHash)),
            Data("corrupt-retained-after-new-blob".utf8)
        )
        XCTAssertEqual(try Data(contentsOf: fixture.snapshotBlobURL(newHash)), newBytes)
    }

    func testCleanupFailureReturnsDurableDegradedOnlyAfterPendingHealthReverify() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let history = try seedTwentyFourSnapshotPoints(in: fixture, label: "cleanup-failure")
        let newestBytes = Data("cleanup-failure-24".utf8)
        let newestHash = sha256(newestBytes)
        try fixture.writeInitialPrimary(newestBytes)
        let posix = StorePostUnlinkFailureNativePOSIX()
        let events = LockedOrdinaryFaultEvents()
        let store = makeInjectedRecoveryStore(
            rootURL: fixture.rootURL,
            posix: posix,
            faultHandler: { events.append($0) }
        )

        let result = try store.createSnapshot(
            expectedHash: newestHash,
            createdAt: Date(timeIntervalSince1970: 1_700_400_024)
        )

        XCTAssertEqual(posix.unlinkCallCount(), 1)
        XCTAssertEqual(result.snapshotStatus, .created)
        XCTAssertEqual(result.ordinal, 24)
        XCTAssertEqual(result.retainedCount, 24)
        XCTAssertEqual(result.recoveryHealth, cleanupPendingSnapshotHealth(count: 1))
        let durableIndex = try fixture.readSnapshotIndex()
        XCTAssertEqual(durableIndex.retained.map(\.ordinal), Array((1 ... 24).reversed()).map(UInt64.init))
        XCTAssertEqual(durableIndex.pendingCleanupHashes, [history.hashes[0]])
        XCTAssertEqual(durableIndex.lastHealthCode, "cleanup-pending")
        XCTAssertEqual(try Data(contentsOf: fixture.snapshotBlobURL(history.hashes[0])), history.bytes[0])
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditSnapshot(),
            cleanupPendingSnapshotHealth(count: 1)
        )
        XCTAssertFalse(events.snapshot().contains {
            $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
        })

        let converged = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).createSnapshot(
            expectedHash: newestHash,
            createdAt: Date(timeIntervalSince1970: 1_700_400_999.9999)
        )
        XCTAssertEqual(converged.snapshotStatus, .deduplicated)
        XCTAssertEqual(converged.ordinal, 24)
        XCTAssertEqual(converged.retainedCount, 24)
        XCTAssertEqual(converged.recoveryHealth, healthySnapshotHealth())
        let convergedIndex = try fixture.readSnapshotIndex()
        XCTAssertEqual(convergedIndex.nextOrdinal, 25)
        XCTAssertEqual(convergedIndex.retained.first?.createdAt, durableIndex.retained.first?.createdAt)
        XCTAssertEqual(convergedIndex.pendingCleanupHashes, [])
        XCTAssertNil(convergedIndex.lastHealthCode)
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: fixture.snapshotBlobURL(history.hashes[0]).path
            )
        )
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditSnapshot(),
            healthySnapshotHealth()
        )
    }

    func testMaintenanceClearUncertaintyIsUnknownRatherThanFalseHealthy() throws {
        for faultPoint in [
            NativeDurabilityFaultPoint.beforeRecoveryHealthClear,
            .afterRecoveryHealthClear,
        ] {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            let primaryBytes = Data("health-clear-uncertain-\(faultPoint.rawValue)".utf8)
            let primaryHash = sha256(primaryBytes)
            let absentPending = sha256(Data("absent-\(faultPoint.rawValue)".utf8))
            try fixture.writeInitialPrimary(primaryBytes)
            try fixture.prepareSnapshots()
            try fixture.writeSnapshotIndex(SnapshotRecoveryIndex(
                format: SnapshotRecoveryIndex.expectedFormat,
                version: SnapshotRecoveryIndex.expectedVersion,
                retained: [],
                nextOrdinal: 0,
                pendingCleanupHashes: [absentPending],
                lastHealthCode: "cleanup-pending"
            ))
            let events = LockedOrdinaryFaultEvents()
            let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                events.append(event)
                if event.point == faultPoint,
                   event.role == .snapshotHealthIndex
                {
                    throw OrdinaryInjectedFailure.stop
                }
            }
            var result: NativeSnapshotRecoveryResult?

            XCTAssertThrowsError(result = try store.createSnapshot(
                expectedHash: primaryHash,
                createdAt: Date(timeIntervalSince1970: 1_700_500_000)
            ), faultPoint.rawValue)
            XCTAssertNil(result)
            XCTAssertEqual(events.snapshot().filter {
                $0.point == faultPoint && $0.role == .snapshotHealthIndex
            }.count, 1)
            let index = try fixture.readSnapshotIndex()
            XCTAssertEqual(index.retained.map(\.hash), [primaryHash])
            if faultPoint == .beforeRecoveryHealthClear {
                XCTAssertEqual(index.pendingCleanupHashes, [absentPending])
                XCTAssertEqual(index.lastHealthCode, "cleanup-pending")
                XCTAssertEqual(
                    try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditSnapshot(),
                    cleanupPendingSnapshotHealth(count: 1)
                )
            } else {
                XCTAssertEqual(index.pendingCleanupHashes, [])
                XCTAssertNil(index.lastHealthCode)
                XCTAssertEqual(
                    try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditSnapshot(),
                    healthySnapshotHealth()
                )
            }
        }
    }

    func testAfterSnapshotBlobDurableOrphanAuditsDegradedAndIsRescuedOrCleaned() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let bytes = Data("snapshot-after-blob-orphan".utf8)
        let hash = sha256(bytes)
        try fixture.writeInitialPrimary(bytes)
        let events = LockedOrdinaryFaultEvents()
        let interrupted = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
            if event.point == .afterSnapshotBlobDurable {
                throw OrdinaryInjectedFailure.stop
            }
        }

        XCTAssertThrowsError(try interrupted.createSnapshot(
            expectedHash: hash,
            createdAt: Date(timeIntervalSince1970: 1_700_600_000)
        ))
        XCTAssertEqual(events.snapshot().filter {
            $0.point == .afterSnapshotBlobDurable
                && $0.role == .snapshotBlob
                && $0.targetName == "Recovery/snapshots/\(hash).json"
        }.count, 1)
        XCTAssertEqual(try fixture.readSnapshotIndex().retained, [])
        XCTAssertEqual(try Data(contentsOf: fixture.snapshotBlobURL(hash)), bytes)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditSnapshot(),
            managedOrphanSnapshotHealth([hash])
        )

        let rescued = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).createSnapshot(
            expectedHash: hash,
            createdAt: Date(timeIntervalSince1970: 1_700_600_001)
        )

        XCTAssertEqual(rescued.snapshotStatus, .created)
        XCTAssertEqual(rescued.ordinal, 0)
        XCTAssertEqual(rescued.recoveryHealth, healthySnapshotHealth())
        XCTAssertEqual(try Data(contentsOf: fixture.snapshotBlobURL(hash)), bytes)
        XCTAssertEqual(try fixture.readSnapshotIndex().retained.map(\.hash), [hash])
    }

    func testSnapshotIndexAtomicallyCarriesPendingAndLastHealthCode() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let orphanBytes = Data("snapshot-atomic-orphan".utf8)
        let orphanHash = sha256(orphanBytes)
        let primaryBytes = Data("snapshot-atomic-primary".utf8)
        let primaryHash = sha256(primaryBytes)
        try fixture.writeInitialPrimary(primaryBytes)
        try fixture.prepareSnapshots()
        try fixture.writeSnapshotBlob(orphanBytes)
        try fixture.writeSnapshotIndex(emptySnapshotIndex())
        let observations = LockedSnapshotIndexBytes()
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            if event.point == .afterSnapshotIndexDurable
                || event.point == .afterRecoveryHealthClear
            {
                observations.append(try Data(contentsOf: fixture.snapshotIndexURL))
            }
        }

        let result = try store.createSnapshot(
            expectedHash: primaryHash,
            createdAt: Date(timeIntervalSince1970: 1_700_700_000)
        )

        let versions = try observations.snapshot().map(SnapshotRecoveryCodec.decode)
        XCTAssertEqual(versions.count, 2)
        XCTAssertEqual(versions[0].retained.map(\.hash), [primaryHash])
        XCTAssertEqual(versions[0].pendingCleanupHashes, [orphanHash])
        XCTAssertEqual(versions[0].lastHealthCode, "cleanup-pending")
        XCTAssertEqual(versions[1].pendingCleanupHashes, [])
        XCTAssertNil(versions[1].lastHealthCode)
        for version in versions {
            XCTAssertEqual(version.pendingCleanupHashes.isEmpty, version.lastHealthCode == nil)
        }
        XCTAssertEqual(result.recoveryHealth, healthySnapshotHealth())
    }

    func testSnapshotSuccessCannotClearOrdinaryDegradationAndOrdinarySuccessCannotClearSnapshotDegradation() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let primaryBytes = Data("dual-domain-primary".utf8)
        let primaryHash = sha256(primaryBytes)
        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .missing,
            operationID: "dual-domain-seed"
        )
        var ordinaryIndex = try fixture.readIndex()
        ordinaryIndex.committed.maintenance = OrdinaryMaintenanceState(
            pendingCleanupHashes: [sha256(Data("ordinary-absent-pending".utf8))],
            lastHealthCode: "cleanup-pending"
        )
        try fixture.writeIndex(ordinaryIndex, role: .ordinaryHealthIndex)
        let ordinaryBytesBeforeSnapshot = try Data(contentsOf: fixture.indexURL)
        let ordinaryIdentityBeforeSnapshot = try fileIdentity(of: fixture.indexURL)

        let snapshotResult = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).createSnapshot(
            expectedHash: primaryHash,
            createdAt: Date(timeIntervalSince1970: 1_700_800_000)
        )

        XCTAssertEqual(snapshotResult.recoveryHealth, healthySnapshotHealth())
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), ordinaryBytesBeforeSnapshot)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), ordinaryIdentityBeforeSnapshot)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            cleanupPendingOrdinaryHealth(count: 1)
        )

        var snapshotIndex = try fixture.readSnapshotIndex()
        snapshotIndex.pendingCleanupHashes = [sha256(Data("snapshot-absent-pending".utf8))]
        snapshotIndex.lastHealthCode = "cleanup-pending"
        try fixture.writeSnapshotIndex(snapshotIndex, role: .snapshotFinalIndex)
        let snapshotBytesBeforeOrdinary = try Data(contentsOf: fixture.snapshotIndexURL)
        let snapshotIdentityBeforeOrdinary = try fileIdentity(of: fixture.snapshotIndexURL)

        let ordinaryResult = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .sha256(primaryHash),
            operationID: "dual-domain-ordinary-converge"
        )

        XCTAssertEqual(ordinaryResult.recoveryHealth, healthyOrdinaryHealth())
        XCTAssertEqual(try Data(contentsOf: fixture.snapshotIndexURL), snapshotBytesBeforeOrdinary)
        XCTAssertEqual(try fileIdentity(of: fixture.snapshotIndexURL), snapshotIdentityBeforeOrdinary)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditSnapshot(),
            cleanupPendingSnapshotHealth(count: 1)
        )
    }

    func testFinalNamespaceSentinelSurvivesEveryAuditAndRetentionPass() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let primaryBytes = Data("final-sentinel-primary".utf8)
        let primaryHash = sha256(primaryBytes)
        try fixture.writeInitialPrimary(primaryBytes)
        try createPrivateTestDirectory(
            fixture.rootURL.appendingPathComponent("Recovery", isDirectory: true)
        )
        let finalURL = fixture.rootURL.appendingPathComponent("Recovery/final", isDirectory: true)
        try createPrivateTestDirectory(finalURL)
        let sentinelURL = finalURL.appendingPathComponent("sentinel.keep")
        let sentinelBytes = Data("Task7-must-never-enumerate-final".utf8)
        try writePrivateTestFile(sentinelBytes, to: sentinelURL)
        let sentinelIdentity = try fileIdentity(of: sentinelURL)
        try fixture.prepareSnapshots()
        let orphanBytes = Data("sentinel-retention-orphan".utf8)
        let orphanHash = sha256(orphanBytes)
        try fixture.writeSnapshotBlob(orphanBytes)
        try fixture.writeSnapshotIndex(emptySnapshotIndex())

        let result = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).createSnapshot(
            expectedHash: primaryHash,
            createdAt: Date(timeIntervalSince1970: 1_700_900_000)
        )

        XCTAssertEqual(result.recoveryHealth, healthySnapshotHealth())
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.snapshotBlobURL(orphanHash).path))
        XCTAssertEqual(try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditSnapshot(), healthySnapshotHealth())
        XCTAssertEqual(try Data(contentsOf: sentinelURL), sentinelBytes)
        XCTAssertEqual(try fileIdentity(of: sentinelURL), sentinelIdentity)
    }

    func testVirginSnapshotDirectoryAndEmptyIndexTempSurviveEveryInitFault() throws {
        let points: [NativeDurabilityFaultPoint] = [
            .afterTempCreate,
            .afterExactWrite,
            .afterFileFSync,
            .afterFullFSync,
            .beforeRename,
        ]
        for point in points {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            let primaryBytes = Data("snapshot-init-\(point.rawValue)".utf8)
            let primaryHash = sha256(primaryBytes)
            try fixture.writeInitialPrimary(primaryBytes)
            let events = LockedOrdinaryFaultEvents()
            let interrupted = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                events.append(event)
                if event.point == point,
                   event.role == .snapshotEmptyIndex
                {
                    throw OrdinaryInjectedFailure.stop
                }
            }

            XCTAssertThrowsError(try interrupted.createSnapshot(
                expectedHash: primaryHash,
                createdAt: Date(timeIntervalSince1970: 1_701_000_000)
            ), point.rawValue)
            XCTAssertEqual(events.snapshot().filter {
                $0.point == point
                    && $0.role == .snapshotEmptyIndex
                    && $0.targetName == "Recovery/snapshots/index.json"
            }.count, 1, point.rawValue)
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.snapshotIndexURL.path))

            let emptyBytes = try SnapshotRecoveryCodec.encode(emptySnapshotIndex())
            let tempName = ".AssetTracker.tmp.\(UUID().uuidString.lowercased())"
            let prefixCount = point == .afterTempCreate ? 0 : emptyBytes.count
            let tempURL = fixture.snapshotsURL.appendingPathComponent(tempName)
            try writePrivateTestFile(Data(emptyBytes.prefix(prefixCount)), to: tempURL)
            let tempIdentity = try fileIdentity(of: tempURL)

            XCTAssertEqual(
                try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditSnapshot(),
                notApplicableSnapshotHealth(),
                point.rawValue
            )
            XCTAssertEqual(try fileIdentity(of: tempURL), tempIdentity, point.rawValue)

            let recovered = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).createSnapshot(
                expectedHash: primaryHash,
                createdAt: Date(timeIntervalSince1970: 1_701_000_001)
            )

            XCTAssertEqual(recovered.snapshotStatus, .created, point.rawValue)
            XCTAssertEqual(recovered.recoveryHealth, healthySnapshotHealth(), point.rawValue)
            XCTAssertFalse(FileManager.default.fileExists(atPath: tempURL.path), point.rawValue)
            XCTAssertEqual(try fixture.readSnapshotIndex().retained.map(\.hash), [primaryHash])
        }
    }

    func testSnapshotDirectorySwapAfterIndexCommitReturnsNoReceipt() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let primaryBytes = Data("snapshot-directory-swap".utf8)
        let primaryHash = sha256(primaryBytes)
        try fixture.writeInitialPrimary(primaryBytes)
        let detached = fixture.parentURL.appendingPathComponent("detached-snapshots", isDirectory: true)
        let events = LockedOrdinaryFaultEvents()
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
            if event.point == .afterSnapshotIndexDurable,
               event.role == .snapshotFinalIndex
            {
                try FileManager.default.moveItem(at: fixture.snapshotsURL, to: detached)
                try createPrivateTestDirectory(fixture.snapshotsURL)
            }
        }
        var result: NativeSnapshotRecoveryResult?

        XCTAssertThrowsError(result = try store.createSnapshot(
            expectedHash: primaryHash,
            createdAt: Date(timeIntervalSince1970: 1_701_100_000)
        ))

        XCTAssertNil(result)
        XCTAssertEqual(events.snapshot().filter {
            $0.point == .afterSnapshotIndexDurable
                && $0.role == .snapshotFinalIndex
                && $0.targetName == "Recovery/snapshots/index.json"
        }.count, 1)
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytes)
        XCTAssertEqual(
            try Data(contentsOf: detached.appendingPathComponent("\(primaryHash).json")),
            primaryBytes
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: detached.appendingPathComponent("index.json").path))
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: fixture.snapshotsURL.path),
            []
        )
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditSnapshot(),
            notApplicableSnapshotHealth()
        )
    }

    func testOrdinaryIndexEncodingIsExactDeterministicBytes() throws {
        let index = OrdinaryRecoveryIndex(
            format: "qiushan.asset-book.ordinary-recovery",
            version: 1,
            committed: OrdinaryCommittedState(
                primaryHash: nil,
                slots: [],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [],
                    lastHealthCode: nil
                )
            ),
            prepared: nil
        )

        let encoded = try OrdinaryRecoveryCodec.encode(index)
        let expected = #"{"committed":{"maintenance":{"lastHealthCode":null,"pendingCleanupHashes":[]},"primaryHash":null,"slots":[]},"format":"qiushan.asset-book.ordinary-recovery","prepared":null,"version":1}"#

        XCTAssertEqual(encoded, Data(expected.utf8))
        XCTAssertEqual(try OrdinaryRecoveryCodec.encode(index), encoded)
        XCTAssertEqual(try OrdinaryRecoveryCodec.decode(encoded), index)
    }

    func testOrdinaryIndexPreparedRoundTripsEveryExactField() throws {
        let h0 = String(repeating: "0", count: 64)
        let h1 = String(repeating: "1", count: 64)
        let h2 = String(repeating: "2", count: 64)
        let index = OrdinaryRecoveryIndex(
            format: "qiushan.asset-book.ordinary-recovery",
            version: 1,
            committed: OrdinaryCommittedState(
                primaryHash: h1,
                slots: [h0],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [],
                    lastHealthCode: nil
                )
            ),
            prepared: OrdinaryPreparedState(
                operationId: "operation-1",
                sourceHash: h1,
                candidateHash: h2,
                committedSlots: [h0],
                nextSlots: [h1, h0]
            )
        )

        let encoded = try OrdinaryRecoveryCodec.encode(index)
        let expected = "{\"committed\":{\"maintenance\":{\"lastHealthCode\":null,\"pendingCleanupHashes\":[]},\"primaryHash\":\"\(h1)\",\"slots\":[\"\(h0)\"]},\"format\":\"qiushan.asset-book.ordinary-recovery\",\"prepared\":{\"candidateHash\":\"\(h2)\",\"committedSlots\":[\"\(h0)\"],\"nextSlots\":[\"\(h1)\",\"\(h0)\"],\"operationId\":\"operation-1\",\"sourceHash\":\"\(h1)\"},\"version\":1}"

        XCTAssertEqual(encoded, Data(expected.utf8))
        XCTAssertEqual(try OrdinaryRecoveryCodec.decode(encoded), index)
    }

    func testOrdinaryIndexStrictDecoderRejectsEveryTopLevelMissingExtraAndWrongConstantFixture() throws {
        let valid = try fixtureObject(prepared: false)

        for key in ["format", "version", "committed", "prepared"] {
            var fixture = valid
            fixture.removeValue(forKey: key)
            assertDecodeRejects(fixture, "missing top-level key \(key)")
        }

        var extra = valid
        extra["unexpected"] = true
        assertDecodeRejects(extra, "extra top-level key")

        var wrongFormat = valid
        wrongFormat["format"] = "qiushan.asset-book.ordinary-recovery.other"
        assertDecodeRejects(wrongFormat, "wrong format")

        var wrongVersion = valid
        wrongVersion["version"] = 2
        assertDecodeRejects(wrongVersion, "wrong version")

        XCTAssertNoThrow(try OrdinaryRecoveryCodec.decode(data(for: valid)))
    }

    func testOrdinaryIndexStrictDecoderRejectsEveryNestedMissingAndExtraKey() throws {
        let validPrepared = try fixtureObject(prepared: true)

        for key in ["primaryHash", "slots", "maintenance"] {
            var fixture = validPrepared
            var committed = try XCTUnwrap(fixture["committed"] as? [String: Any])
            committed.removeValue(forKey: key)
            fixture["committed"] = committed
            assertDecodeRejects(fixture, "missing committed key \(key)")
        }

        var committedExtra = validPrepared
        var committed = try XCTUnwrap(committedExtra["committed"] as? [String: Any])
        committed["unexpected"] = true
        committedExtra["committed"] = committed
        assertDecodeRejects(committedExtra, "extra committed key")

        for key in ["pendingCleanupHashes", "lastHealthCode"] {
            var fixture = validPrepared
            var committed = try XCTUnwrap(fixture["committed"] as? [String: Any])
            var maintenance = try XCTUnwrap(committed["maintenance"] as? [String: Any])
            maintenance.removeValue(forKey: key)
            committed["maintenance"] = maintenance
            fixture["committed"] = committed
            assertDecodeRejects(fixture, "missing maintenance key \(key)")
        }

        var maintenanceExtra = validPrepared
        var maintenanceCommitted = try XCTUnwrap(maintenanceExtra["committed"] as? [String: Any])
        var maintenance = try XCTUnwrap(maintenanceCommitted["maintenance"] as? [String: Any])
        maintenance["unexpected"] = true
        maintenanceCommitted["maintenance"] = maintenance
        maintenanceExtra["committed"] = maintenanceCommitted
        assertDecodeRejects(maintenanceExtra, "extra maintenance key")

        for key in ["operationId", "sourceHash", "candidateHash", "committedSlots", "nextSlots"] {
            var fixture = validPrepared
            var prepared = try XCTUnwrap(fixture["prepared"] as? [String: Any])
            prepared.removeValue(forKey: key)
            fixture["prepared"] = prepared
            assertDecodeRejects(fixture, "missing prepared key \(key)")
        }

        var preparedExtra = validPrepared
        var prepared = try XCTUnwrap(preparedExtra["prepared"] as? [String: Any])
        prepared["unexpected"] = true
        preparedExtra["prepared"] = prepared
        assertDecodeRejects(preparedExtra, "extra prepared key")
    }

    func testOrdinaryIndexRejectsEveryNoncanonicalSemanticRelationship() throws {
        let h0 = String(repeating: "0", count: 64)
        let h1 = String(repeating: "1", count: 64)
        let h2 = String(repeating: "2", count: 64)
        let h3 = String(repeating: "3", count: 64)
        let h4 = String(repeating: "4", count: 64)
        let nonASCIIHash = String(repeating: "١", count: 64)
        let healthy = OrdinaryMaintenanceState(pendingCleanupHashes: [], lastHealthCode: nil)
        let preparedIntersection = OrdinaryMaintenanceState(
            pendingCleanupHashes: [h2],
            lastHealthCode: "cleanup-pending"
        )
        let base = OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: h2,
                slots: [h1, h0],
                maintenance: healthy
            ),
            prepared: nil
        )
        let validPrepared = OrdinaryPreparedState(
            operationId: "operation-1",
            sourceHash: h2,
            candidateHash: h3,
            committedSlots: [h1, h0],
            nextSlots: [h2, h1]
        )

        var cases: [(String, OrdinaryRecoveryIndex)] = []
        cases.append(("non-ASCII primary hash", replacingCommitted(
            base,
            primaryHash: String(repeating: "١", count: 64)
        )))
        cases.append(("uppercase slot hash", replacingCommitted(
            base,
            slots: [String(repeating: "A", count: 64)]
        )))
        cases.append(("duplicate slots", replacingCommitted(base, slots: [h1, h1])))
        cases.append(("more than two slots", replacingCommitted(base, slots: [h2, h1, h0])))
        cases.append(("current primary in history", replacingCommitted(base, slots: [h2, h1])))
        cases.append(("unsorted pending", replacingCommitted(
            base,
            maintenance: .init(
                pendingCleanupHashes: [h4, h3],
                lastHealthCode: "cleanup-pending"
            )
        )))
        cases.append(("duplicate pending", replacingCommitted(
            base,
            maintenance: .init(
                pendingCleanupHashes: [h3, h3],
                lastHealthCode: "cleanup-pending"
            )
        )))
        cases.append(("pending intersects retained slot", replacingCommitted(
            base,
            maintenance: .init(
                pendingCleanupHashes: [h1],
                lastHealthCode: "cleanup-pending"
            )
        )))
        cases.append(("pending without health code", replacingCommitted(
            base,
            maintenance: .init(pendingCleanupHashes: [h3], lastHealthCode: nil)
        )))
        cases.append(("health code without pending", replacingCommitted(
            base,
            maintenance: .init(pendingCleanupHashes: [], lastHealthCode: "cleanup-pending")
        )))
        cases.append(("unknown persisted health code", replacingCommitted(
            base,
            maintenance: .init(pendingCleanupHashes: [h3], lastHealthCode: "other")
        )))
        cases.append(("non-ASCII pending hash", replacingCommitted(
            base,
            maintenance: .init(
                pendingCleanupHashes: [nonASCIIHash],
                lastHealthCode: "cleanup-pending"
            )
        )))
        cases.append(("missing primary cannot retain history", OrdinaryRecoveryIndex(
            format: base.format,
            version: base.version,
            committed: OrdinaryCommittedState(
                primaryHash: nil,
                slots: [h0],
                maintenance: healthy
            ),
            prepared: nil
        )))
        cases.append(("prepared source mismatch", replacingPrepared(
            base,
            validPrepared,
            sourceHash: h1
        )))
        cases.append(("prepared committed slots mismatch", replacingPrepared(
            base,
            validPrepared,
            committedSlots: [h1]
        )))
        cases.append(("prepared canonical next mismatch", replacingPrepared(
            base,
            validPrepared,
            nextSlots: [h2, h0]
        )))
        cases.append(("non-ASCII candidate hash", replacingPrepared(
            base,
            validPrepared,
            candidateHash: nonASCIIHash
        )))
        cases.append(("no-op manufactured a prepared transition", replacingPrepared(
            base,
            validPrepared,
            candidateHash: h2,
            nextSlots: [h1, h0]
        )))
        cases.append(("empty operation id", replacingPrepared(
            base,
            validPrepared,
            operationId: ""
        )))
        cases.append(("pending intersects prepared next", OrdinaryRecoveryIndex(
            format: base.format,
            version: base.version,
            committed: OrdinaryCommittedState(
                primaryHash: h2,
                slots: [h1, h0],
                maintenance: preparedIntersection
            ),
            prepared: validPrepared
        )))

        for (name, index) in cases {
            XCTAssertThrowsError(try OrdinaryRecoveryCodec.encode(index), name)
            let raw = try rawEncode(index)
            XCTAssertThrowsError(try OrdinaryRecoveryCodec.decode(raw), name)
        }

        let rewoundCandidate = OrdinaryRecoveryIndex(
            format: base.format,
            version: base.version,
            committed: OrdinaryCommittedState(
                primaryHash: h1,
                slots: [h0],
                maintenance: healthy
            ),
            prepared: OrdinaryPreparedState(
                operationId: "rewind",
                sourceHash: h1,
                candidateHash: h0,
                committedSlots: [h0],
                nextSlots: [h1]
            )
        )
        XCTAssertNoThrow(try OrdinaryRecoveryCodec.decode(rawEncode(rewoundCandidate)))
    }

    func testOrdinaryIndexStrictDecoderRejectsNullAndWrongTypeForRequiredFields() throws {
        let valid = try fixtureObject(prepared: true)
        let mutations: [(String, ([String: Any]) throws -> [String: Any])] = [
            ("null format", { var value = $0; value["format"] = NSNull(); return value }),
            ("string version", { var value = $0; value["version"] = "1"; return value }),
            ("null committed", { var value = $0; value["committed"] = NSNull(); return value }),
            ("null slots", { value in
                var value = value
                var committed = try XCTUnwrap(value["committed"] as? [String: Any])
                committed["slots"] = NSNull()
                value["committed"] = committed
                return value
            }),
            ("null pending", { value in
                var value = value
                var committed = try XCTUnwrap(value["committed"] as? [String: Any])
                var maintenance = try XCTUnwrap(committed["maintenance"] as? [String: Any])
                maintenance["pendingCleanupHashes"] = NSNull()
                committed["maintenance"] = maintenance
                value["committed"] = committed
                return value
            }),
            ("numeric health code", { value in
                var value = value
                var committed = try XCTUnwrap(value["committed"] as? [String: Any])
                var maintenance = try XCTUnwrap(committed["maintenance"] as? [String: Any])
                maintenance["lastHealthCode"] = 7
                committed["maintenance"] = maintenance
                value["committed"] = committed
                return value
            }),
            ("null prepared candidate", { value in
                var value = value
                var prepared = try XCTUnwrap(value["prepared"] as? [String: Any])
                prepared["candidateHash"] = NSNull()
                value["prepared"] = prepared
                return value
            })
        ]

        for (name, mutation) in mutations {
            assertDecodeRejects(try mutation(valid), name)
        }
    }

    func testVirginOrdinaryCreatesDirectoryThenDurableEmptyIndexThenBlobsDirectory() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let events = LockedOrdinaryFaultEvents()
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
        }
        let h0Bytes = Data("H0-primary".utf8)
        let h0 = sha256(h0Bytes)

        let result = try store.saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "virgin-H0"
        )

        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), h0Bytes)
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.ordinaryURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.blobsURL.path))
        let index = try fixture.readIndex()
        XCTAssertEqual(index.committed.primaryHash, h0)
        XCTAssertEqual(index.committed.slots, [])
        XCTAssertNil(index.prepared)
        XCTAssertEqual(result.primaryReceipt.sha256, h0)
        XCTAssertEqual(result.recoveryHealth, healthyOrdinaryHealth())

        let policyPoints = events.snapshot().compactMap { event -> NativeDurabilityFaultPoint? in
            switch event.point {
            case .afterOrdinaryDirectoryDurable,
                 .afterEmptyOrdinaryIndexDurable,
                 .afterOrdinaryBlobsDirectoryDurable:
                return event.point
            default:
                return nil
            }
        }
        XCTAssertEqual(policyPoints, [
            .afterOrdinaryDirectoryDurable,
            .afterEmptyOrdinaryIndexDurable,
            .afterOrdinaryBlobsDirectoryDurable
        ])
    }

    func testH0H1H2KeepsExactlyH1ThenH0AsDistinctPriorGenerations() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
        let h0Bytes = Data("H0".utf8)
        let h1Bytes = Data("H1".utf8)
        let h2Bytes = Data("H2".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let h2 = sha256(h2Bytes)

        _ = try store.saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "H0"
        )
        _ = try store.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "H1"
        )
        _ = try store.saveOrdinary(
            candidateBytes: h2Bytes,
            candidateHash: h2,
            expectedSource: .sha256(h1),
            operationID: "H2"
        )

        let index = try fixture.readIndex()
        XCTAssertEqual(index.committed.primaryHash, h2)
        XCTAssertEqual(index.committed.slots, [h1, h0])
        XCTAssertNil(index.prepared)
        XCTAssertEqual(try Data(contentsOf: fixture.blobURL(h1)), h1Bytes)
        XCTAssertEqual(try Data(contentsOf: fixture.blobURL(h0)), h0Bytes)
    }

    func testH0H1H0NeverKeepsCurrentH0AsHistory() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
        let h0Bytes = Data("H0".utf8)
        let h1Bytes = Data("H1".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)

        _ = try store.saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "H0-a"
        )
        _ = try store.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "H1"
        )
        _ = try store.saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .sha256(h1),
            operationID: "H0-b"
        )

        let index = try fixture.readIndex()
        XCTAssertEqual(index.committed.primaryHash, h0)
        XCTAssertEqual(index.committed.slots, [h1])
        XCTAssertFalse(index.committed.slots.contains(h0))
    }

    func testCandidateEqualToSourceIsVerifiedNoOpAndDoesNotRotate() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let events = LockedOrdinaryFaultEvents()
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
        }
        let bytes = Data("same-primary".utf8)
        let hash = sha256(bytes)

        _ = try store.saveOrdinary(
            candidateBytes: bytes,
            candidateHash: hash,
            expectedSource: .missing,
            operationID: "create"
        )
        let before = try fixture.readIndex()
        let preparedCount = events.count(point: .afterPreparedOrdinaryIndexDurable)
        let result = try store.saveOrdinary(
            candidateBytes: bytes,
            candidateHash: hash,
            expectedSource: .sha256(hash),
            operationID: "no-op"
        )

        XCTAssertEqual(try fixture.readIndex(), before)
        XCTAssertEqual(events.count(point: .afterPreparedOrdinaryIndexDurable), preparedCount)
        XCTAssertEqual(result.primaryReceipt.sha256, hash)
        XCTAssertEqual(result.recoveryHealth, healthyOrdinaryHealth())
    }

    func testCandidateEqualSourceFinalPublicCheckpointRejectsCorruptIndexReplacement() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let primaryBytes = Data("no-op-final-corrupt-primary".utf8)
        let primaryHash = sha256(primaryBytes)
        let corruptIndexBytes = Data("hostile-corrupt-slots".utf8)
        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .missing,
            operationID: "no-op-final-corrupt-seed"
        )
        let primaryIdentityBefore = try fileIdentity(of: fixture.primaryURL)
        let events = LockedOrdinaryFaultEvents()
        let attackedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
            if event.point == .afterPrimaryDurableBeforeACK,
               event.role == .primary
            {
                try writePrivateTestFile(corruptIndexBytes, to: fixture.indexURL)
            }
        }

        var result: NativeOrdinaryRecoverySaveResult?
        XCTAssertThrowsError(result = try attackedStore.saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .sha256(primaryHash),
            operationID: "no-op-final-corrupt-attack"
        ))

        XCTAssertNil(result)
        XCTAssertEqual(events.count(point: .afterPrimaryDurableBeforeACK), 1)
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytes)
        XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), corruptIndexBytes)
        XCTAssertThrowsError(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary()
        )
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), corruptIndexBytes)
    }

    func testCandidateEqualSourceFinalPublicCheckpointRejectsValidDifferentIndexReplacement() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let primaryBytes = Data("no-op-final-stale-primary".utf8)
        let staleBlobBytes = Data("no-op-final-stale-history".utf8)
        let primaryHash = sha256(primaryBytes)
        let staleBlobHash = sha256(staleBlobBytes)
        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .missing,
            operationID: "no-op-final-stale-seed"
        )
        let primaryIdentityBefore = try fileIdentity(of: fixture.primaryURL)
        let differentIndex = OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: primaryHash,
                slots: [staleBlobHash],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [],
                    lastHealthCode: nil
                )
            ),
            prepared: nil
        )
        let differentIndexBytes = try OrdinaryRecoveryCodec.encode(differentIndex)
        let events = LockedOrdinaryFaultEvents()
        let attackedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
            if event.point == .afterPrimaryDurableBeforeACK,
               event.role == .primary
            {
                try writePrivateTestFile(staleBlobBytes, to: fixture.blobURL(staleBlobHash))
                try writePrivateTestFile(differentIndexBytes, to: fixture.indexURL)
            }
        }

        var result: NativeOrdinaryRecoverySaveResult?
        XCTAssertThrowsError(result = try attackedStore.saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .sha256(primaryHash),
            operationID: "no-op-final-stale-attack"
        ))

        XCTAssertNil(result)
        XCTAssertEqual(events.count(point: .afterPrimaryDurableBeforeACK), 1)
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytes)
        XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), differentIndexBytes)
        XCTAssertEqual(try Data(contentsOf: fixture.blobURL(staleBlobHash)), staleBlobBytes)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), differentIndexBytes)
    }

    func testOrdinaryPreparedIndexWriterCheckpointFailuresKeepSourceExactAndFreshlyAbortCandidate() throws {
        for checkpoint in ordinaryWriterReplacementCheckpoints() {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            let history = try seedThreeDistinctOrdinaryGenerations(
                in: fixture,
                label: "prepared-writer-\(checkpoint.point.rawValue)"
            )
            let oldCommitted = OrdinaryRecoveryIndex(
                format: OrdinaryRecoveryIndex.expectedFormat,
                version: OrdinaryRecoveryIndex.expectedVersion,
                committed: OrdinaryCommittedState(
                    primaryHash: history.h2,
                    slots: [history.h1, history.h0],
                    maintenance: OrdinaryMaintenanceState(
                        pendingCleanupHashes: [],
                        lastHealthCode: nil
                    )
                ),
                prepared: nil
            )
            let prepared = OrdinaryRecoveryIndex(
                format: OrdinaryRecoveryIndex.expectedFormat,
                version: OrdinaryRecoveryIndex.expectedVersion,
                committed: oldCommitted.committed,
                prepared: OrdinaryPreparedState(
                    operationId: "prepared-writer-attempt",
                    sourceHash: history.h2,
                    candidateHash: history.h3,
                    committedSlots: [history.h1, history.h0],
                    nextSlots: [history.h2, history.h1]
                )
            )
            let oldCommittedBytes = try OrdinaryRecoveryCodec.encode(oldCommitted)
            let preparedBytes = try OrdinaryRecoveryCodec.encode(prepared)
            let primaryIdentityBefore = try fileIdentity(of: fixture.primaryURL)
            let indexIdentityBefore = try fileIdentity(of: fixture.indexURL)
            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), history.h2Bytes)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), oldCommittedBytes)

            let events = LockedOrdinaryFaultEvents()
            let faultedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                events.append(event)
                if event.point == checkpoint.point,
                   event.role == .ordinaryPreparedIndex,
                   event.targetName == "Recovery/ordinary/slots.json"
                {
                    throw OrdinaryInjectedFailure.stop
                }
            }
            var result: NativeOrdinaryRecoverySaveResult?

            XCTAssertThrowsError(
                result = try faultedStore.saveOrdinary(
                    candidateBytes: history.h3Bytes,
                    candidateHash: history.h3,
                    expectedSource: .sha256(history.h2),
                    operationID: "prepared-writer-attempt"
                ),
                "checkpoint=\(checkpoint.point.rawValue)"
            ) { error in
                XCTAssertTrue(
                    error is OrdinaryInjectedFailure,
                    "checkpoint=\(checkpoint.point.rawValue), error=\(error)"
                )
            }

            XCTAssertNil(result, "checkpoint=\(checkpoint.point.rawValue)")
            assertSelectedOrdinaryFaultEventReachedBeforeThrow(
                events.snapshot(),
                point: checkpoint.point,
                role: .ordinaryPreparedIndex,
                targetName: "Recovery/ordinary/slots.json"
            )
            XCTAssertEqual(
                try Data(contentsOf: fixture.primaryURL),
                history.h2Bytes,
                "checkpoint=\(checkpoint.point.rawValue)"
            )
            XCTAssertEqual(
                try fileIdentity(of: fixture.primaryURL),
                primaryIdentityBefore,
                "checkpoint=\(checkpoint.point.rawValue)"
            )
            XCTAssertFalse(
                FileManager.default.fileExists(atPath: fixture.blobURL(history.h3).path),
                "the uncommitted candidate must never become a recovery blob"
            )
            XCTAssertEqual(
                try ordinaryWriterTempNames(in: fixture.ordinaryURL),
                [],
                "exception unwind must remove only its owned prepared-index temp"
            )

            let failedIndexBytes = try Data(contentsOf: fixture.indexURL)
            if checkpoint.replacementPublished {
                XCTAssertEqual(
                    failedIndexBytes,
                    preparedBytes,
                    "checkpoint=\(checkpoint.point.rawValue)"
                )
                XCTAssertEqual(try fixture.readIndex(), prepared)
                XCTAssertEqual(
                    try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                    healthyOrdinaryHealth(),
                    "the complete prepared index references the source blob"
                )
            } else {
                XCTAssertEqual(
                    failedIndexBytes,
                    oldCommittedBytes,
                    "checkpoint=\(checkpoint.point.rawValue)"
                )
                XCTAssertEqual(
                    try fileIdentity(of: fixture.indexURL),
                    indexIdentityBefore,
                    "a pre-rename failure must preserve the exact old committed index inode"
                )
                XCTAssertEqual(try fixture.readIndex(), oldCommitted)
                XCTAssertEqual(
                    try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                    managedOrphanOrdinaryHealth([history.h2]),
                    "the durable previous-primary blob is an orphan until a fresh mutation"
                )
            }
            XCTAssertEqual(try Data(contentsOf: fixture.blobURL(history.h2)), history.h2Bytes)

            let firstFresh = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            XCTAssertEqual(
                try firstFresh.reconcileOrdinary(),
                healthyOrdinaryHealth(),
                "checkpoint=\(checkpoint.point.rawValue)"
            )
            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), history.h2Bytes)
            XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), oldCommittedBytes)
            XCTAssertEqual(try fixture.readIndex(), oldCommitted)
            XCTAssertNil(try fixture.readIndex().prepared)
            XCTAssertEqual(try fixture.readIndex().committed.slots, [history.h1, history.h0])
            XCTAssertFalse(try fixture.readIndex().committed.slots.contains(history.h3))
            XCTAssertEqual(try fixture.readIndex().committed.maintenance.pendingCleanupHashes, [])
            XCTAssertNil(try fixture.readIndex().committed.maintenance.lastHealthCode)
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(history.h2).path))
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(history.h3).path))
            XCTAssertEqual(try Data(contentsOf: fixture.blobURL(history.h1)), history.h1Bytes)
            XCTAssertEqual(try Data(contentsOf: fixture.blobURL(history.h0)), history.h0Bytes)
            let convergedIndexIdentity = try fileIdentity(of: fixture.indexURL)
            let convergedBlobEntries = try ordinaryBlobEntries(in: fixture)

            let secondFresh = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            XCTAssertEqual(
                try secondFresh.reconcileOrdinary(),
                healthyOrdinaryHealth(),
                "checkpoint=\(checkpoint.point.rawValue)"
            )
            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), history.h2Bytes)
            XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), oldCommittedBytes)
            XCTAssertEqual(try fileIdentity(of: fixture.indexURL), convergedIndexIdentity)
            XCTAssertEqual(try ordinaryBlobEntries(in: fixture), convergedBlobEntries)
            XCTAssertEqual(
                convergedBlobEntries,
                ["\(history.h0).json", "\(history.h1).json"].sorted()
            )
        }
    }

    func testOrdinaryCommittedIndexWriterCheckpointFailuresKeepCandidateAndFreshlyConvergeHistory() throws {
        for checkpoint in ordinaryCommittedIndexFailureCheckpoints() {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            let history = try seedThreeDistinctOrdinaryGenerations(
                in: fixture,
                label: "committed-writer-\(checkpoint.point.rawValue)"
            )
            let prepared = OrdinaryRecoveryIndex(
                format: OrdinaryRecoveryIndex.expectedFormat,
                version: OrdinaryRecoveryIndex.expectedVersion,
                committed: OrdinaryCommittedState(
                    primaryHash: history.h2,
                    slots: [history.h1, history.h0],
                    maintenance: OrdinaryMaintenanceState(
                        pendingCleanupHashes: [],
                        lastHealthCode: nil
                    )
                ),
                prepared: OrdinaryPreparedState(
                    operationId: "committed-writer-attempt",
                    sourceHash: history.h2,
                    candidateHash: history.h3,
                    committedSlots: [history.h1, history.h0],
                    nextSlots: [history.h2, history.h1]
                )
            )
            let committedPending = OrdinaryRecoveryIndex(
                format: OrdinaryRecoveryIndex.expectedFormat,
                version: OrdinaryRecoveryIndex.expectedVersion,
                committed: OrdinaryCommittedState(
                    primaryHash: history.h3,
                    slots: [history.h2, history.h1],
                    maintenance: OrdinaryMaintenanceState(
                        pendingCleanupHashes: [history.h0],
                        lastHealthCode: "cleanup-pending"
                    )
                ),
                prepared: nil
            )
            let converged = OrdinaryRecoveryIndex(
                format: OrdinaryRecoveryIndex.expectedFormat,
                version: OrdinaryRecoveryIndex.expectedVersion,
                committed: OrdinaryCommittedState(
                    primaryHash: history.h3,
                    slots: [history.h2, history.h1],
                    maintenance: OrdinaryMaintenanceState(
                        pendingCleanupHashes: [],
                        lastHealthCode: nil
                    )
                ),
                prepared: nil
            )
            let preparedBytes = try OrdinaryRecoveryCodec.encode(prepared)
            let committedPendingBytes = try OrdinaryRecoveryCodec.encode(committedPending)
            let convergedBytes = try OrdinaryRecoveryCodec.encode(converged)
            let h0BlobIdentityBefore = try fileIdentity(of: fixture.blobURL(history.h0))
            let h1BlobIdentityBefore = try fileIdentity(of: fixture.blobURL(history.h1))
            let events = LockedOrdinaryFaultEvents()
            let preparedIndexObservation = LockedOrdinaryCommittedIndexObservation()
            let faultedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                events.append(event)
                if event.point == .afterPreparedOrdinaryIndexDurable,
                   event.role == .ordinaryPreparedIndex,
                   event.targetName == "Recovery/ordinary/slots.json"
                {
                    preparedIndexObservation.record(
                        bytes: try Data(contentsOf: fixture.indexURL),
                        identity: try fileIdentity(of: fixture.indexURL)
                    )
                }
                if event.point == checkpoint.point,
                   event.role == .ordinaryCommittedIndex,
                   event.targetName == "Recovery/ordinary/slots.json"
                {
                    throw OrdinaryInjectedFailure.stop
                }
            }
            var result: NativeOrdinaryRecoverySaveResult?

            XCTAssertThrowsError(
                result = try faultedStore.saveOrdinary(
                    candidateBytes: history.h3Bytes,
                    candidateHash: history.h3,
                    expectedSource: .sha256(history.h2),
                    operationID: "committed-writer-attempt"
                ),
                "checkpoint=\(checkpoint.point.rawValue)"
            ) { error in
                XCTAssertTrue(
                    error is OrdinaryInjectedFailure,
                    "checkpoint=\(checkpoint.point.rawValue), error=\(error)"
                )
            }

            XCTAssertNil(result, "checkpoint=\(checkpoint.point.rawValue)")
            assertSelectedOrdinaryFaultEventReachedBeforeThrow(
                events.snapshot(),
                point: checkpoint.point,
                role: .ordinaryCommittedIndex,
                targetName: "Recovery/ordinary/slots.json"
            )
            let preparedObservation = try XCTUnwrap(
                preparedIndexObservation.snapshot(),
                "checkpoint=\(checkpoint.point.rawValue)"
            )
            XCTAssertEqual(
                preparedObservation.bytes,
                preparedBytes,
                "the committed writer must start from the exact durable prepared index"
            )
            XCTAssertEqual(
                events.snapshot().contains {
                    $0.point == .afterCommittedOrdinaryIndexDurable
                        && $0.role == .ordinaryCommittedIndex
                        && $0.targetName == "Recovery/ordinary/slots.json"
                },
                checkpoint.writerProofReturned,
                "only the Task 6 policy sentinel follows the writer's returned committed proof"
            )
            XCTAssertEqual(
                try Data(contentsOf: fixture.primaryURL),
                history.h3Bytes,
                "the authoritative candidate must never be rolled back"
            )
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(history.h3).path))
            XCTAssertEqual(
                try ordinaryWriterTempNames(in: fixture.ordinaryURL),
                [],
                "exception unwind must not leave a writer temp"
            )

            if checkpoint.replacementPublished {
                XCTAssertEqual(
                    try Data(contentsOf: fixture.indexURL),
                    committedPendingBytes,
                    "checkpoint=\(checkpoint.point.rawValue)"
                )
                XCTAssertEqual(try fixture.readIndex(), committedPending)
                XCTAssertNil(try fixture.readIndex().prepared)
                XCTAssertNotEqual(
                    try fileIdentity(of: fixture.indexURL),
                    preparedObservation.identity,
                    "a published committed index must be a newly renamed inode"
                )
                XCTAssertEqual(
                    try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                    cleanupPendingOrdinaryHealth(count: 1)
                )
            } else {
                XCTAssertEqual(
                    try Data(contentsOf: fixture.indexURL),
                    preparedBytes,
                    "checkpoint=\(checkpoint.point.rawValue)"
                )
                XCTAssertEqual(try fixture.readIndex(), prepared)
                XCTAssertNotNil(try fixture.readIndex().prepared)
                XCTAssertEqual(
                    try fileIdentity(of: fixture.indexURL),
                    preparedObservation.identity,
                    "a pre-rename committed failure must retain the exact prepared inode"
                )
                XCTAssertEqual(
                    try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                    healthyOrdinaryHealth()
                )
            }

            XCTAssertEqual(
                try Data(contentsOf: fixture.blobURL(history.h0)),
                history.h0Bytes,
                "cleanup must not start before the committed-index writer proof returns"
            )
            XCTAssertEqual(
                try fileIdentity(of: fixture.blobURL(history.h0)),
                h0BlobIdentityBefore,
                "the oldest pending blob must retain its exact inode before reconciliation"
            )
            XCTAssertEqual(try Data(contentsOf: fixture.blobURL(history.h1)), history.h1Bytes)
            XCTAssertEqual(
                try fileIdentity(of: fixture.blobURL(history.h1)),
                h1BlobIdentityBefore
            )
            XCTAssertEqual(try Data(contentsOf: fixture.blobURL(history.h2)), history.h2Bytes)
            let h2BlobIdentityBeforeReconcile = try fileIdentity(of: fixture.blobURL(history.h2))
            XCTAssertEqual(
                try ordinaryBlobEntries(in: fixture),
                [
                    "\(history.h0).json",
                    "\(history.h1).json",
                    "\(history.h2).json",
                ].sorted(),
                "no recovery generation may be cleaned before fresh reconciliation"
            )

            let primaryIdentityAfterFailure = try fileIdentity(of: fixture.primaryURL)
            let firstFresh = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            XCTAssertEqual(
                try firstFresh.reconcileOrdinary(),
                healthyOrdinaryHealth(),
                "checkpoint=\(checkpoint.point.rawValue)"
            )
            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), history.h3Bytes)
            XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityAfterFailure)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), convergedBytes)
            XCTAssertEqual(try fixture.readIndex(), converged)
            XCTAssertEqual(try fixture.readIndex().committed.slots, [history.h2, history.h1])
            XCTAssertEqual(try fixture.readIndex().committed.maintenance.pendingCleanupHashes, [])
            XCTAssertNil(try fixture.readIndex().committed.maintenance.lastHealthCode)
            XCTAssertNil(try fixture.readIndex().prepared)
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(history.h0).path))
            XCTAssertEqual(try Data(contentsOf: fixture.blobURL(history.h2)), history.h2Bytes)
            XCTAssertEqual(
                try fileIdentity(of: fixture.blobURL(history.h2)),
                h2BlobIdentityBeforeReconcile
            )
            XCTAssertEqual(try Data(contentsOf: fixture.blobURL(history.h1)), history.h1Bytes)
            XCTAssertEqual(
                try fileIdentity(of: fixture.blobURL(history.h1)),
                h1BlobIdentityBefore
            )
            let convergedIndexIdentity = try fileIdentity(of: fixture.indexURL)
            let convergedBlobEntries = try ordinaryBlobEntries(in: fixture)

            let secondFresh = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            XCTAssertEqual(
                try secondFresh.reconcileOrdinary(),
                healthyOrdinaryHealth(),
                "checkpoint=\(checkpoint.point.rawValue)"
            )
            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), history.h3Bytes)
            XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityAfterFailure)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), convergedBytes)
            XCTAssertEqual(try fileIdentity(of: fixture.indexURL), convergedIndexIdentity)
            XCTAssertEqual(try ordinaryBlobEntries(in: fixture), convergedBlobEntries)
            XCTAssertEqual(
                convergedBlobEntries,
                ["\(history.h1).json", "\(history.h2).json"].sorted()
            )
        }
    }

    func testPreviousPrimaryBlobWriterCheckpointFailuresNeverWriteCandidateAndFreshlyConvergeOrphan() throws {
        for checkpoint in ordinaryWriterReplacementCheckpoints() {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            let history = try seedThreeDistinctOrdinaryGenerations(
                in: fixture,
                label: "blob-writer-\(checkpoint.point.rawValue)"
            )
            let oldCommitted = OrdinaryRecoveryIndex(
                format: OrdinaryRecoveryIndex.expectedFormat,
                version: OrdinaryRecoveryIndex.expectedVersion,
                committed: OrdinaryCommittedState(
                    primaryHash: history.h2,
                    slots: [history.h1, history.h0],
                    maintenance: OrdinaryMaintenanceState(
                        pendingCleanupHashes: [],
                        lastHealthCode: nil
                    )
                ),
                prepared: nil
            )
            let oldCommittedBytes = try OrdinaryRecoveryCodec.encode(oldCommitted)
            let primaryIdentityBefore = try fileIdentity(of: fixture.primaryURL)
            let indexIdentityBefore = try fileIdentity(of: fixture.indexURL)
            let blobTarget = "Recovery/ordinary/blobs/\(history.h2).json"
            let events = LockedOrdinaryFaultEvents()
            let faultedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                events.append(event)
                if event.point == checkpoint.point,
                   event.role == .ordinaryBlob,
                   event.targetName == blobTarget
                {
                    throw OrdinaryInjectedFailure.stop
                }
            }
            var result: NativeOrdinaryRecoverySaveResult?

            XCTAssertThrowsError(
                result = try faultedStore.saveOrdinary(
                    candidateBytes: history.h3Bytes,
                    candidateHash: history.h3,
                    expectedSource: .sha256(history.h2),
                    operationID: "blob-writer-attempt"
                ),
                "checkpoint=\(checkpoint.point.rawValue)"
            ) { error in
                XCTAssertTrue(
                    error is OrdinaryInjectedFailure,
                    "checkpoint=\(checkpoint.point.rawValue), error=\(error)"
                )
            }

            XCTAssertNil(result, "checkpoint=\(checkpoint.point.rawValue)")
            assertSelectedOrdinaryFaultEventReachedBeforeThrow(
                events.snapshot(),
                point: checkpoint.point,
                role: .ordinaryBlob,
                targetName: blobTarget
            )
            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), history.h2Bytes)
            XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), oldCommittedBytes)
            XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore)
            XCTAssertEqual(try fixture.readIndex(), oldCommitted)
            XCTAssertNil(try fixture.readIndex().prepared)
            XCTAssertFalse(try fixture.readIndex().committed.slots.contains(history.h3))
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(history.h3).path))
            XCTAssertEqual(
                try ordinaryWriterTempNames(in: fixture.blobsURL),
                [],
                "exception unwind must remove only its owned blob temp"
            )

            if checkpoint.replacementPublished {
                XCTAssertEqual(
                    try Data(contentsOf: fixture.blobURL(history.h2)),
                    history.h2Bytes,
                    "checkpoint=\(checkpoint.point.rawValue)"
                )
                XCTAssertEqual(
                    try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                    managedOrphanOrdinaryHealth([history.h2]),
                    "a complete unindexed previous-primary blob must be visible as degraded"
                )
            } else {
                XCTAssertFalse(
                    FileManager.default.fileExists(atPath: fixture.blobURL(history.h2).path),
                    "a pre-rename failure must not publish the blob"
                )
                XCTAssertEqual(
                    try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                    healthyOrdinaryHealth()
                )
            }

            let firstFresh = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            XCTAssertEqual(
                try firstFresh.reconcileOrdinary(),
                healthyOrdinaryHealth(),
                "checkpoint=\(checkpoint.point.rawValue)"
            )
            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), history.h2Bytes)
            XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), oldCommittedBytes)
            XCTAssertEqual(try fixture.readIndex(), oldCommitted)
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(history.h2).path))
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(history.h3).path))
            XCTAssertEqual(try Data(contentsOf: fixture.blobURL(history.h1)), history.h1Bytes)
            XCTAssertEqual(try Data(contentsOf: fixture.blobURL(history.h0)), history.h0Bytes)
            let convergedIndexIdentity = try fileIdentity(of: fixture.indexURL)
            let convergedBlobEntries = try ordinaryBlobEntries(in: fixture)

            let secondFresh = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            XCTAssertEqual(
                try secondFresh.reconcileOrdinary(),
                healthyOrdinaryHealth(),
                "checkpoint=\(checkpoint.point.rawValue)"
            )
            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), history.h2Bytes)
            XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), oldCommittedBytes)
            XCTAssertEqual(try fileIdentity(of: fixture.indexURL), convergedIndexIdentity)
            XCTAssertEqual(try ordinaryBlobEntries(in: fixture), convergedBlobEntries)
            XCTAssertEqual(
                convergedBlobEntries,
                ["\(history.h0).json", "\(history.h1).json"].sorted()
            )
        }
    }

    func testCandidateEqualSourceFaultsBeforeAndAfterFinalVerificationReturnNoResultWithoutRotation() throws {
        for checkpoint in ordinaryNoOpVerificationCheckpoints() {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            let history = try seedThreeDistinctOrdinaryGenerations(
                in: fixture,
                label: "no-op-writer-\(checkpoint.point.rawValue)"
            )
            let stableIndex = OrdinaryRecoveryIndex(
                format: OrdinaryRecoveryIndex.expectedFormat,
                version: OrdinaryRecoveryIndex.expectedVersion,
                committed: OrdinaryCommittedState(
                    primaryHash: history.h2,
                    slots: [history.h1, history.h0],
                    maintenance: OrdinaryMaintenanceState(
                        pendingCleanupHashes: [],
                        lastHealthCode: nil
                    )
                ),
                prepared: nil
            )
            let stableIndexBytes = try OrdinaryRecoveryCodec.encode(stableIndex)
            let primaryIdentityBefore = try fileIdentity(of: fixture.primaryURL)
            let indexIdentityBefore = try fileIdentity(of: fixture.indexURL)
            let events = LockedOrdinaryFaultEvents()
            let faultedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                events.append(event)
                if event.point == checkpoint.point,
                   event.role == .primary,
                   event.targetName == "AssetTrackerBook.json"
                {
                    if checkpoint.writerReceiptCompleted,
                       ordinaryNoOpPrimaryTrace(in: events.snapshot())
                        != ordinaryNoOpPrimaryTracePoints
                    {
                        return
                    }
                    throw OrdinaryInjectedFailure.stop
                }
            }
            var result: NativeOrdinaryRecoverySaveResult?

            XCTAssertThrowsError(
                result = try faultedStore.saveOrdinary(
                    candidateBytes: history.h2Bytes,
                    candidateHash: history.h2,
                    expectedSource: .sha256(history.h2),
                    operationID: "no-op-writer-attempt"
                ),
                "checkpoint=\(checkpoint.point.rawValue)"
            ) { error in
                XCTAssertTrue(
                    error is OrdinaryInjectedFailure,
                    "checkpoint=\(checkpoint.point.rawValue), error=\(error)"
                )
            }

            XCTAssertNil(result, "checkpoint=\(checkpoint.point.rawValue)")
            assertSelectedOrdinaryFaultEventReachedBeforeThrow(
                events.snapshot(),
                point: checkpoint.point,
                role: .primary,
                targetName: "AssetTrackerBook.json"
            )
            assertOrdinaryNoOpPrimaryTrace(
                events.snapshot(),
                through: checkpoint.point
            )
            XCTAssertEqual(
                events.snapshot().contains {
                    $0.point == .afterPrimaryDurableBeforeACK
                        && $0.role == .primary
                        && $0.targetName == "AssetTrackerBook.json"
                },
                checkpoint.writerReceiptCompleted,
                "only the Task 6 policy hook is after the writer's full final verification"
            )
            XCTAssertFalse(events.snapshot().contains {
                $0.point == .afterRename && $0.role == .primary
            })
            XCTAssertFalse(events.snapshot().contains {
                $0.point == .afterPreparedOrdinaryIndexDurable
                    || $0.point == .afterCommittedOrdinaryIndexDurable
            })
            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), history.h2Bytes)
            XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), stableIndexBytes)
            XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore)
            XCTAssertEqual(try fixture.readIndex(), stableIndex)
            XCTAssertNil(try fixture.readIndex().prepared)
            XCTAssertEqual(try fixture.readIndex().committed.slots, [history.h1, history.h0])
            XCTAssertEqual(try fixture.readIndex().committed.maintenance.pendingCleanupHashes, [])
            XCTAssertNil(try fixture.readIndex().committed.maintenance.lastHealthCode)
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(history.h2).path))
            XCTAssertEqual(try ordinaryWriterTempNames(in: fixture.ordinaryURL), [])
            XCTAssertEqual(try ordinaryWriterTempNames(in: fixture.blobsURL), [])
            XCTAssertEqual(
                try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                healthyOrdinaryHealth()
            )

            let firstFresh = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            XCTAssertEqual(try firstFresh.reconcileOrdinary(), healthyOrdinaryHealth())
            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), history.h2Bytes)
            XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), stableIndexBytes)
            XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore)
            let stableBlobEntries = try ordinaryBlobEntries(in: fixture)

            let secondFresh = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            XCTAssertEqual(try secondFresh.reconcileOrdinary(), healthyOrdinaryHealth())
            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), history.h2Bytes)
            XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), stableIndexBytes)
            XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore)
            XCTAssertEqual(try ordinaryBlobEntries(in: fixture), stableBlobEntries)
            XCTAssertEqual(
                stableBlobEntries,
                ["\(history.h0).json", "\(history.h1).json"].sorted()
            )
        }
    }

    func testVirginAndDegradedCandidateEqualSourceFaultsBracketFinalVerificationWithoutRotation() throws {
        let boundaryCheckpoints = ordinaryNoOpVerificationCheckpoints().filter {
            $0.point == .afterHashVerified || $0.point == .afterPrimaryDurableBeforeACK
        }
        XCTAssertEqual(boundaryCheckpoints.count, 2)

        for state in OrdinaryNoOpBoundaryState.allCases {
            for checkpoint in boundaryCheckpoints {
                let fixture = try OrdinaryStoreFixture()
                var pendingURL: URL?
                defer {
                    if let pendingURL {
                        try? clearTestFileFlags(pendingURL)
                    }
                    fixture.remove()
                }
                let label = "no-op-boundary-\(state.rawValue)-\(checkpoint.point.rawValue)"
                let primaryBytes = Data("\(label)-primary".utf8)
                let primaryHash = sha256(primaryBytes)
                var pendingBytes: Data?
                var pendingHash: String?
                let expectedFaultIndex: OrdinaryRecoveryIndex
                let expectedFaultHealth: NativeRecoveryHealth
                let indexIdentityBeforeFault: TestFileIdentity?

                switch state {
                case .virgin:
                    try fixture.writeInitialPrimary(primaryBytes)
                    expectedFaultIndex = OrdinaryRecoveryIndex(
                        format: OrdinaryRecoveryIndex.expectedFormat,
                        version: OrdinaryRecoveryIndex.expectedVersion,
                        committed: OrdinaryCommittedState(
                            primaryHash: primaryHash,
                            slots: [],
                            maintenance: OrdinaryMaintenanceState(
                                pendingCleanupHashes: [],
                                lastHealthCode: nil
                            )
                        ),
                        prepared: nil
                    )
                    expectedFaultHealth = healthyOrdinaryHealth()
                    indexIdentityBeforeFault = nil
                    XCTAssertFalse(
                        FileManager.default.fileExists(atPath: fixture.ordinaryURL.path),
                        "the virgin fixture must begin without an ordinary namespace"
                    )
                case .degraded:
                    _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
                        candidateBytes: primaryBytes,
                        candidateHash: primaryHash,
                        expectedSource: .missing,
                        operationID: "\(label)-seed"
                    )
                    let bytes = Data("\(label)-pending".utf8)
                    let hash = sha256(bytes)
                    let url = fixture.blobURL(hash)
                    pendingURL = url
                    try fixture.writeBlob(bytes)
                    var index = try fixture.readIndex()
                    index.committed.maintenance = OrdinaryMaintenanceState(
                        pendingCleanupHashes: [hash],
                        lastHealthCode: "cleanup-pending"
                    )
                    try fixture.writeIndex(index, role: .ordinaryHealthIndex)
                    try setUserImmutable(url)
                    XCTAssertTrue(try hasUserImmutableFlag(url))
                    pendingBytes = bytes
                    pendingHash = hash
                    expectedFaultIndex = index
                    expectedFaultHealth = cleanupPendingOrdinaryHealth(count: 1)
                    indexIdentityBeforeFault = try fileIdentity(of: fixture.indexURL)
                }

                let expectedFaultIndexBytes = try OrdinaryRecoveryCodec.encode(
                    expectedFaultIndex
                )
                let primaryIdentityBefore = try fileIdentity(of: fixture.primaryURL)
                let events = LockedOrdinaryFaultEvents()
                let faultedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                    events.append(event)
                    if event.point == checkpoint.point,
                       event.role == .primary,
                       event.targetName == "AssetTrackerBook.json"
                    {
                        if checkpoint.writerReceiptCompleted,
                           ordinaryNoOpPrimaryTrace(in: events.snapshot())
                            != ordinaryNoOpPrimaryTracePoints
                        {
                            return
                        }
                        throw OrdinaryInjectedFailure.stop
                    }
                }
                var result: NativeOrdinaryRecoverySaveResult?

                XCTAssertThrowsError(
                    result = try faultedStore.saveOrdinary(
                        candidateBytes: primaryBytes,
                        candidateHash: primaryHash,
                        expectedSource: .sha256(primaryHash),
                        operationID: "\(label)-attempt"
                    ),
                    "state=\(state.rawValue), checkpoint=\(checkpoint.point.rawValue)"
                ) { error in
                    XCTAssertTrue(
                        error is OrdinaryInjectedFailure,
                        "state=\(state.rawValue), checkpoint=\(checkpoint.point.rawValue), error=\(error)"
                    )
                }

                XCTAssertNil(
                    result,
                    "state=\(state.rawValue), checkpoint=\(checkpoint.point.rawValue)"
                )
                assertSelectedOrdinaryFaultEventReachedBeforeThrow(
                    events.snapshot(),
                    point: checkpoint.point,
                    role: .primary,
                    targetName: "AssetTrackerBook.json"
                )
                assertOrdinaryNoOpPrimaryTrace(
                    events.snapshot(),
                    through: checkpoint.point
                )
                XCTAssertEqual(
                    events.snapshot().contains {
                        $0.point == .afterPrimaryDurableBeforeACK
                            && $0.role == .primary
                            && $0.targetName == "AssetTrackerBook.json"
                    },
                    checkpoint.writerReceiptCompleted,
                    "the selected points must bracket the writer's returned no-op receipt"
                )
                XCTAssertFalse(events.snapshot().contains {
                    $0.point == .afterRename && $0.role == .primary
                })
                XCTAssertFalse(events.snapshot().contains {
                    $0.point == .afterPreparedOrdinaryIndexDurable
                        || $0.point == .afterCommittedOrdinaryIndexDurable
                        || $0.point == .beforeRecoveryHealthClear
                        || $0.point == .afterRecoveryHealthClear
                })
                XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytes)
                XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
                XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.ordinaryURL.path))
                XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.blobsURL.path))
                XCTAssertEqual(try Data(contentsOf: fixture.indexURL), expectedFaultIndexBytes)
                XCTAssertEqual(try fixture.readIndex(), expectedFaultIndex)
                XCTAssertEqual(try fixture.readIndex().committed.primaryHash, primaryHash)
                XCTAssertEqual(try fixture.readIndex().committed.slots, [])
                XCTAssertNil(try fixture.readIndex().prepared)
                if let indexIdentityBeforeFault {
                    XCTAssertEqual(
                        try fileIdentity(of: fixture.indexURL),
                        indexIdentityBeforeFault,
                        "a degraded no-op fault must preserve the exact health-index inode"
                    )
                }
                let faultIndexIdentity = try fileIdentity(of: fixture.indexURL)
                XCTAssertFalse(
                    FileManager.default.fileExists(atPath: fixture.blobURL(primaryHash).path),
                    "candidate-equals-source must not manufacture a source generation"
                )
                XCTAssertEqual(try ordinaryWriterTempNames(in: fixture.ordinaryURL), [])
                XCTAssertEqual(try ordinaryWriterTempNames(in: fixture.blobsURL), [])
                XCTAssertEqual(
                    try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                    expectedFaultHealth
                )
                if let pendingURL,
                   let pendingBytes,
                   let pendingHash
                {
                    XCTAssertEqual(try Data(contentsOf: pendingURL), pendingBytes)
                    XCTAssertTrue(try hasUserImmutableFlag(pendingURL))
                    XCTAssertEqual(
                        try ordinaryBlobEntries(in: fixture),
                        ["\(pendingHash).json"]
                    )
                    XCTAssertEqual(
                        try fixture.readIndex().committed.maintenance.pendingCleanupHashes,
                        [pendingHash]
                    )
                    XCTAssertEqual(
                        try fixture.readIndex().committed.maintenance.lastHealthCode,
                        "cleanup-pending"
                    )
                    try clearTestFileFlags(pendingURL)
                } else {
                    XCTAssertEqual(try ordinaryBlobEntries(in: fixture), [])
                    XCTAssertEqual(
                        try fixture.readIndex().committed.maintenance.pendingCleanupHashes,
                        []
                    )
                    XCTAssertNil(try fixture.readIndex().committed.maintenance.lastHealthCode)
                }

                var convergedIndex = expectedFaultIndex
                convergedIndex.committed.maintenance = OrdinaryMaintenanceState(
                    pendingCleanupHashes: [],
                    lastHealthCode: nil
                )
                let convergedIndexBytes = try OrdinaryRecoveryCodec.encode(convergedIndex)
                let firstFresh = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
                XCTAssertEqual(
                    try firstFresh.reconcileOrdinary(),
                    healthyOrdinaryHealth(),
                    "state=\(state.rawValue), checkpoint=\(checkpoint.point.rawValue)"
                )
                XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytes)
                XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
                XCTAssertEqual(try Data(contentsOf: fixture.indexURL), convergedIndexBytes)
                XCTAssertEqual(try fixture.readIndex(), convergedIndex)
                XCTAssertEqual(try fixture.readIndex().committed.slots, [])
                XCTAssertNil(try fixture.readIndex().prepared)
                XCTAssertEqual(try ordinaryBlobEntries(in: fixture), [])
                XCTAssertEqual(
                    try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                    healthyOrdinaryHealth()
                )
                if state == .virgin {
                    XCTAssertEqual(
                        try fileIdentity(of: fixture.indexURL),
                        faultIndexIdentity,
                        "a healthy virgin reconcile must not rewrite its exact initialized index"
                    )
                }
                let convergedIndexIdentity = try fileIdentity(of: fixture.indexURL)

                let secondFresh = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
                XCTAssertEqual(try secondFresh.reconcileOrdinary(), healthyOrdinaryHealth())
                XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytes)
                XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
                XCTAssertEqual(try Data(contentsOf: fixture.indexURL), convergedIndexBytes)
                XCTAssertEqual(try fileIdentity(of: fixture.indexURL), convergedIndexIdentity)
                XCTAssertEqual(try ordinaryBlobEntries(in: fixture), [])
            }
        }
    }

    func testReconcileRejectsUnknownOrdinarySiblingWithoutMutatingCanonicalState() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let primaryBytes = Data("reconcile-unknown-ordinary-H0".utf8)
        let primaryHash = sha256(primaryBytes)
        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .missing,
            operationID: "reconcile-unknown-ordinary-seed"
        )
        let orphanBytes = Data("preserve-reconcile-managed-orphan".utf8)
        let orphanHash = sha256(orphanBytes)
        let orphanURL = fixture.blobURL(orphanHash)
        try fixture.writeBlob(orphanBytes)
        let primaryIdentityBefore = try fileIdentity(of: fixture.primaryURL)
        let indexBytesBefore = try Data(contentsOf: fixture.indexURL)
        let indexIdentityBefore = try fileIdentity(of: fixture.indexURL)
        let orphanIdentityBefore = try fileIdentity(of: orphanURL)
        let blobEntriesBefore = try ordinaryBlobEntries(in: fixture)
        let unknownURL = fixture.ordinaryURL.appendingPathComponent("unknown-sibling")
        let unknownBytes = Data("preserve-reconcile-unknown-sibling".utf8)
        try writePrivateTestFile(unknownBytes, to: unknownURL)
        let unknownIdentityBefore = try fileIdentity(of: unknownURL)
        let ordinaryEntriesBefore = try FileManager.default.contentsOfDirectory(
            atPath: fixture.ordinaryURL.path
        ).sorted()

        XCTAssertThrowsError(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).reconcileOrdinary()
        )

        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytes)
        XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBefore)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: unknownURL), unknownBytes)
        XCTAssertEqual(try fileIdentity(of: unknownURL), unknownIdentityBefore)
        XCTAssertEqual(try? Data(contentsOf: orphanURL), orphanBytes)
        XCTAssertEqual(try? fileIdentity(of: orphanURL), orphanIdentityBefore)
        XCTAssertEqual(try ordinaryBlobEntries(in: fixture), blobEntriesBefore)
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: fixture.ordinaryURL.path).sorted(),
            ordinaryEntriesBefore
        )

        XCTAssertThrowsError(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary()
        ) { error in
            XCTAssertTrue(error is AssetTrackerRecoveryStoreError, "error=\(error)")
        }
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytes)
        XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBefore)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: unknownURL), unknownBytes)
        XCTAssertEqual(try fileIdentity(of: unknownURL), unknownIdentityBefore)
        XCTAssertEqual(try? Data(contentsOf: orphanURL), orphanBytes)
        XCTAssertEqual(try? fileIdentity(of: orphanURL), orphanIdentityBefore)
        XCTAssertEqual(try ordinaryBlobEntries(in: fixture), blobEntriesBefore)
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: fixture.ordinaryURL.path).sorted(),
            ordinaryEntriesBefore
        )
    }

    func testCandidateEqualSourceRejectsUnknownOrdinarySiblingCreatedAfterPrimaryACKProof() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let primaryBytes = Data("no-op-unknown-ordinary-H0".utf8)
        let primaryHash = sha256(primaryBytes)
        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .missing,
            operationID: "no-op-unknown-ordinary-seed"
        )
        let primaryIdentityBefore = try fileIdentity(of: fixture.primaryURL)
        let indexBytesBefore = try Data(contentsOf: fixture.indexURL)
        let indexIdentityBefore = try fileIdentity(of: fixture.indexURL)
        let ordinaryEntriesBefore = try FileManager.default.contentsOfDirectory(
            atPath: fixture.ordinaryURL.path
        ).sorted()
        let unknownURL = fixture.ordinaryURL.appendingPathComponent("unknown-sibling")
        let unknownBytes = Data("preserve-no-op-unknown-sibling".utf8)
        let events = LockedOrdinaryFaultEvents()
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
            if event.point == .afterPrimaryDurableBeforeACK,
               event.role == .primary,
               event.targetName == "AssetTrackerBook.json"
            {
                try writePrivateTestFile(unknownBytes, to: unknownURL)
            }
        }
        var result: NativeOrdinaryRecoverySaveResult?

        XCTAssertThrowsError(
            result = try store.saveOrdinary(
                candidateBytes: primaryBytes,
                candidateHash: primaryHash,
                expectedSource: .sha256(primaryHash),
                operationID: "no-op-unknown-ordinary-attempt"
            )
        )

        XCTAssertNil(result, "namespace corruption must not return a save receipt")
        XCTAssertEqual(
            events.snapshot().filter {
                $0.point == .afterPrimaryDurableBeforeACK
                    && $0.role == .primary
                    && $0.targetName == "AssetTrackerBook.json"
            }.count,
            1,
            "the exact post-primary ACK-proof callback must create the unknown sibling"
        )
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytes)
        XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBefore)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: unknownURL), unknownBytes)
        let unknownIdentityBeforeAudit = try fileIdentity(of: unknownURL)
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: fixture.ordinaryURL.path).sorted(),
            (ordinaryEntriesBefore + ["unknown-sibling"]).sorted()
        )

        XCTAssertThrowsError(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary()
        ) { error in
            XCTAssertTrue(error is AssetTrackerRecoveryStoreError, "error=\(error)")
        }
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytes)
        XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBefore)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: unknownURL), unknownBytes)
        XCTAssertEqual(try fileIdentity(of: unknownURL), unknownIdentityBeforeAudit)
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: fixture.ordinaryURL.path).sorted(),
            (ordinaryEntriesBefore + ["unknown-sibling"]).sorted()
        )
    }

    func testPreparedCrashReconcilesAgainstOldAndNewPrimaryWithoutDuplicateHistory() throws {
        let oldFixture = try OrdinaryStoreFixture()
        defer { oldFixture.remove() }
        let h0Bytes = Data("H0".utf8)
        let h1Bytes = Data("H1".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let healthyStore = AssetTrackerRecoveryStore(rootURL: oldFixture.rootURL)
        _ = try healthyStore.saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "seed-old"
        )
        let failAfterPrepared = AssetTrackerRecoveryStore(rootURL: oldFixture.rootURL) { event in
            if event.point == .afterPreparedOrdinaryIndexDurable {
                throw OrdinaryInjectedFailure.stop
            }
        }
        XCTAssertThrowsError(try failAfterPrepared.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "prepared-old"
        ))
        XCTAssertEqual(try Data(contentsOf: oldFixture.primaryURL), h0Bytes)
        XCTAssertNotNil(try oldFixture.readIndex().prepared)

        let freshOld = AssetTrackerRecoveryStore(rootURL: oldFixture.rootURL)
        XCTAssertEqual(try freshOld.reconcileOrdinary(), healthyOrdinaryHealth())
        let cleared = try oldFixture.readIndex()
        XCTAssertEqual(cleared.committed.primaryHash, h0)
        XCTAssertEqual(cleared.committed.slots, [])
        XCTAssertNil(cleared.prepared)

        let newFixture = try OrdinaryStoreFixture()
        defer { newFixture.remove() }
        let newSeed = AssetTrackerRecoveryStore(rootURL: newFixture.rootURL)
        _ = try newSeed.saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "seed-new"
        )
        let failAfterPrimary = AssetTrackerRecoveryStore(rootURL: newFixture.rootURL) { event in
            if event.point == .afterPrimaryDurableBeforeACK {
                throw OrdinaryInjectedFailure.stop
            }
        }
        XCTAssertThrowsError(try failAfterPrimary.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "prepared-new"
        ))
        XCTAssertEqual(try Data(contentsOf: newFixture.primaryURL), h1Bytes)
        XCTAssertNotNil(try newFixture.readIndex().prepared)

        let freshNew = AssetTrackerRecoveryStore(rootURL: newFixture.rootURL)
        XCTAssertEqual(try freshNew.reconcileOrdinary(), healthyOrdinaryHealth())
        let promoted = try newFixture.readIndex()
        XCTAssertEqual(promoted.committed.primaryHash, h1)
        XCTAssertEqual(promoted.committed.slots, [h0])
        XCTAssertNil(promoted.prepared)
        XCTAssertEqual(try freshNew.reconcileOrdinary(), healthyOrdinaryHealth())
        XCTAssertEqual(try newFixture.readIndex(), promoted)
    }

    func testAfterOrdinaryBlobDurableAuditsDegradedAndRetryOrNoOpConverges() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let h0Bytes = Data("after-blob-H0".utf8)
        let h1Bytes = Data("after-blob-H1".utf8)
        let otherOrphanBytes = Data("after-blob-other-orphan".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let otherOrphanHash = sha256(otherOrphanBytes)

        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "after-blob-seed"
        )
        let primaryBytesBeforeCrash = try Data(contentsOf: fixture.primaryURL)
        let primaryIdentityBeforeCrash = try fileIdentity(of: fixture.primaryURL)
        let indexBytesBeforeCrash = try Data(contentsOf: fixture.indexURL)
        let indexIdentityBeforeCrash = try fileIdentity(of: fixture.indexURL)
        let crashEvents = LockedOrdinaryFaultEvents()
        let interrupted = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            crashEvents.append(event)
            if event.point == .afterOrdinaryBlobDurable {
                throw OrdinaryInjectedFailure.stop
            }
        }

        XCTAssertThrowsError(try interrupted.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "after-blob-interrupted"
        ))

        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytesBeforeCrash)
        XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBeforeCrash)
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBeforeCrash)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBeforeCrash)
        XCTAssertEqual(try Data(contentsOf: fixture.blobURL(h0)), h0Bytes)
        let blobCrashPoints = crashEvents.snapshot().filter {
            $0.point == .afterOrdinaryBlobDurable
        }
        XCTAssertEqual(blobCrashPoints.count, 1)
        XCTAssertEqual(blobCrashPoints.first?.role, .ordinaryBlob)
        XCTAssertEqual(
            blobCrashPoints.first?.targetName,
            "Recovery/ordinary/blobs/\(h0).json"
        )

        let freshAudit = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary()
        XCTAssertEqual(freshAudit, managedOrphanOrdinaryHealth([h0]))
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBeforeCrash)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBeforeCrash)

        try fixture.writeBlob(otherOrphanBytes)
        let observations = LockedOrdinaryIndexBoundaryObservations()
        let retryEvents = LockedOrdinaryFaultEvents()
        let retry = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            retryEvents.append(event)
            if event.point == .afterPreparedOrdinaryIndexDurable
                || event.point == .afterCommittedOrdinaryIndexDurable
            {
                observations.append(
                    event: event,
                    indexBytes: try Data(contentsOf: fixture.indexURL),
                    presentBlobHashes: [h0, otherOrphanHash].filter {
                        FileManager.default.fileExists(atPath: fixture.blobURL($0).path)
                    }.sorted()
                )
            }
        }

        let result = try retry.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "after-blob-distinct-retry"
        )

        let expectedPrepared = OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: h0,
                slots: [],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [otherOrphanHash],
                    lastHealthCode: "cleanup-pending"
                )
            ),
            prepared: OrdinaryPreparedState(
                operationId: "after-blob-distinct-retry",
                sourceHash: h0,
                candidateHash: h1,
                committedSlots: [],
                nextSlots: [h0]
            )
        )
        let expectedCommittedPending = OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: h1,
                slots: [h0],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [otherOrphanHash],
                    lastHealthCode: "cleanup-pending"
                )
            ),
            prepared: nil
        )
        let preparedObservation = try XCTUnwrap(
            observations.first(point: .afterPreparedOrdinaryIndexDurable)
        )
        XCTAssertEqual(preparedObservation.role, .ordinaryPreparedIndex)
        XCTAssertEqual(preparedObservation.targetName, "Recovery/ordinary/slots.json")
        XCTAssertEqual(
            preparedObservation.indexBytes,
            try OrdinaryRecoveryCodec.encode(expectedPrepared)
        )
        XCTAssertEqual(preparedObservation.presentBlobHashes, [h0, otherOrphanHash].sorted())
        let committedObservation = try XCTUnwrap(
            observations.first(point: .afterCommittedOrdinaryIndexDurable)
        )
        XCTAssertEqual(committedObservation.role, .ordinaryCommittedIndex)
        XCTAssertEqual(committedObservation.targetName, "Recovery/ordinary/slots.json")
        XCTAssertEqual(
            committedObservation.indexBytes,
            try OrdinaryRecoveryCodec.encode(expectedCommittedPending)
        )
        XCTAssertEqual(committedObservation.presentBlobHashes, [h0, otherOrphanHash].sorted())

        let policyEvents = retryEvents.snapshot().filter {
            $0.point == .afterPreparedOrdinaryIndexDurable
                || $0.point == .afterPrimaryDurableBeforeACK
                || $0.point == .afterCommittedOrdinaryIndexDurable
                || $0.point == .beforeRecoveryHealthClear
                || $0.point == .afterRecoveryHealthClear
        }
        XCTAssertEqual(policyEvents.map(\.point), [
            .afterPreparedOrdinaryIndexDurable,
            .afterPrimaryDurableBeforeACK,
            .afterCommittedOrdinaryIndexDurable,
            .beforeRecoveryHealthClear,
            .afterRecoveryHealthClear
        ])
        XCTAssertEqual(policyEvents.map(\.role), [
            .ordinaryPreparedIndex,
            .primary,
            .ordinaryCommittedIndex,
            .ordinaryHealthIndex,
            .ordinaryHealthIndex
        ])
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), h1Bytes)
        XCTAssertEqual(try Data(contentsOf: fixture.blobURL(h0)), h0Bytes)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(otherOrphanHash).path))
        XCTAssertEqual(
            try Data(contentsOf: fixture.indexURL),
            try OrdinaryRecoveryCodec.encode(OrdinaryRecoveryIndex(
                format: OrdinaryRecoveryIndex.expectedFormat,
                version: OrdinaryRecoveryIndex.expectedVersion,
                committed: OrdinaryCommittedState(
                    primaryHash: h1,
                    slots: [h0],
                    maintenance: OrdinaryMaintenanceState(
                        pendingCleanupHashes: [],
                        lastHealthCode: nil
                    )
                ),
                prepared: nil
            ))
        )
        XCTAssertEqual(result.previousSlotHashes, [h0])
        XCTAssertEqual(result.recoveryHealth, healthyOrdinaryHealth())
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
    }

    func testAfterOrdinaryBlobDurableNoOpPersistsEveryOrphanBeforeCleanupWithoutRotation() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let h0Bytes = Data("after-blob-no-op-H0".utf8)
        let attemptedBytes = Data("after-blob-no-op-attempt".utf8)
        let otherOrphanBytes = Data("after-blob-no-op-other".utf8)
        let h0 = sha256(h0Bytes)
        let attemptedHash = sha256(attemptedBytes)
        let otherOrphanHash = sha256(otherOrphanBytes)

        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "no-op-orphan-seed"
        )
        let interrupted = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            if event.point == .afterOrdinaryBlobDurable {
                throw OrdinaryInjectedFailure.stop
            }
        }
        XCTAssertThrowsError(try interrupted.saveOrdinary(
            candidateBytes: attemptedBytes,
            candidateHash: attemptedHash,
            expectedSource: .sha256(h0),
            operationID: "no-op-orphan-interrupted"
        ))
        try fixture.writeBlob(otherOrphanBytes)
        let initialIndexBytes = try Data(contentsOf: fixture.indexURL)
        let initialPrimaryIdentity = try fileIdentity(of: fixture.primaryURL)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            managedOrphanOrdinaryHealth([h0, otherOrphanHash])
        )

        let observations = LockedOrdinaryIndexBoundaryObservations()
        let events = LockedOrdinaryFaultEvents()
        let noOpStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
            if event.point == .afterHashVerified, event.role == .ordinaryHealthIndex {
                observations.append(
                    event: event,
                    indexBytes: try Data(contentsOf: fixture.indexURL),
                    presentBlobHashes: [h0, otherOrphanHash].filter {
                        FileManager.default.fileExists(atPath: fixture.blobURL($0).path)
                    }.sorted()
                )
            }
        }

        let result = try noOpStore.saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .sha256(h0),
            operationID: "no-op-orphan-converge"
        )

        let expectedPending = OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: h0,
                slots: [],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [h0, otherOrphanHash].sorted(),
                    lastHealthCode: "cleanup-pending"
                )
            ),
            prepared: nil
        )
        let expectedHealthy = OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: h0,
                slots: [],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [],
                    lastHealthCode: nil
                )
            ),
            prepared: nil
        )
        let healthIndexWrites = observations.snapshot().filter {
            $0.point == .afterHashVerified && $0.role == .ordinaryHealthIndex
        }
        XCTAssertEqual(healthIndexWrites.count, 2)
        XCTAssertEqual(
            healthIndexWrites.first?.indexBytes,
            try OrdinaryRecoveryCodec.encode(expectedPending)
        )
        XCTAssertEqual(
            healthIndexWrites.first?.presentBlobHashes,
            [h0, otherOrphanHash].sorted()
        )
        XCTAssertEqual(
            healthIndexWrites.last?.indexBytes,
            try OrdinaryRecoveryCodec.encode(expectedHealthy)
        )
        XCTAssertEqual(healthIndexWrites.last?.presentBlobHashes, [])
        XCTAssertEqual(
            events.snapshot().filter {
                $0.point == .beforeRecoveryHealthClear
                    || $0.point == .afterRecoveryHealthClear
                    || $0.point == .afterPrimaryDurableBeforeACK
            }.map(\.point),
            [
                .beforeRecoveryHealthClear,
                .afterRecoveryHealthClear,
                .afterPrimaryDurableBeforeACK
            ]
        )
        XCTAssertFalse(events.snapshot().contains {
            $0.point == .afterPreparedOrdinaryIndexDurable
                || $0.point == .afterCommittedOrdinaryIndexDurable
        })
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), h0Bytes)
        XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), initialPrimaryIdentity)
        XCTAssertNotEqual(initialIndexBytes, try OrdinaryRecoveryCodec.encode(expectedPending))
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), try OrdinaryRecoveryCodec.encode(expectedHealthy))
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(h0).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(otherOrphanHash).path))
        XCTAssertEqual(result.previousSlotHashes, [])
        XCTAssertEqual(result.recoveryHealth, healthyOrdinaryHealth())
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
    }

    func testPromoteAtomicallyRecordsEveryNewlyUnreferencedBlobAsPending() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let h0Bytes = Data("promote-pending-H0".utf8)
        let h1Bytes = Data("promote-pending-H1".utf8)
        let h2Bytes = Data("promote-pending-H2".utf8)
        let h3Bytes = Data("promote-pending-H3".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let h2 = sha256(h2Bytes)
        let h3 = sha256(h3Bytes)
        let seedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
        for save in [
            (h0Bytes, h0, ExpectedBookSource.missing, "promote-H0"),
            (h1Bytes, h1, ExpectedBookSource.sha256(h0), "promote-H1"),
            (h2Bytes, h2, ExpectedBookSource.sha256(h1), "promote-H2")
        ] {
            _ = try seedStore.saveOrdinary(
                candidateBytes: save.0,
                candidateHash: save.1,
                expectedSource: save.2,
                operationID: save.3
            )
        }
        XCTAssertEqual(try fixture.readIndex().committed.slots, [h1, h0])

        let observations = LockedOrdinaryIndexBoundaryObservations()
        let events = LockedOrdinaryFaultEvents()
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
            if event.point == .afterPreparedOrdinaryIndexDurable
                || event.point == .afterCommittedOrdinaryIndexDurable
            {
                observations.append(
                    event: event,
                    indexBytes: try Data(contentsOf: fixture.indexURL),
                    presentBlobHashes: [h0, h1, h2].filter {
                        FileManager.default.fileExists(atPath: fixture.blobURL($0).path)
                    }.sorted()
                )
            }
        }

        let result = try store.saveOrdinary(
            candidateBytes: h3Bytes,
            candidateHash: h3,
            expectedSource: .sha256(h2),
            operationID: "promote-H3"
        )

        let expectedPrepared = OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: h2,
                slots: [h1, h0],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [],
                    lastHealthCode: nil
                )
            ),
            prepared: OrdinaryPreparedState(
                operationId: "promote-H3",
                sourceHash: h2,
                candidateHash: h3,
                committedSlots: [h1, h0],
                nextSlots: [h2, h1]
            )
        )
        let expectedCommittedPending = OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: h3,
                slots: [h2, h1],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [h0],
                    lastHealthCode: "cleanup-pending"
                )
            ),
            prepared: nil
        )
        XCTAssertEqual(
            try XCTUnwrap(
                observations.first(point: .afterPreparedOrdinaryIndexDurable)
            ).indexBytes,
            try OrdinaryRecoveryCodec.encode(expectedPrepared)
        )
        let committedObservation = try XCTUnwrap(
            observations.first(point: .afterCommittedOrdinaryIndexDurable)
        )
        XCTAssertEqual(committedObservation.role, .ordinaryCommittedIndex)
        XCTAssertEqual(committedObservation.targetName, "Recovery/ordinary/slots.json")
        XCTAssertEqual(
            committedObservation.indexBytes,
            try OrdinaryRecoveryCodec.encode(expectedCommittedPending)
        )
        XCTAssertEqual(committedObservation.presentBlobHashes, [h0, h1, h2].sorted())
        XCTAssertEqual(events.snapshot().filter {
            $0.point == .afterCommittedOrdinaryIndexDurable
                || $0.point == .beforeRecoveryHealthClear
                || $0.point == .afterRecoveryHealthClear
        }.map(\.role), [
            .ordinaryCommittedIndex,
            .ordinaryHealthIndex,
            .ordinaryHealthIndex
        ])
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(h0).path))
        XCTAssertEqual(try Data(contentsOf: fixture.blobURL(h1)), h1Bytes)
        XCTAssertEqual(try Data(contentsOf: fixture.blobURL(h2)), h2Bytes)
        XCTAssertEqual(result.previousSlotHashes, [h2, h1])
        XCTAssertEqual(result.recoveryHealth, healthyOrdinaryHealth())
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
    }

    func testCleanupFailureAfterDurablePrimaryReturnsDegradedReceiptAndLaterOperationConverges() throws {
        let fixture = try OrdinaryStoreFixture()
        let h0Bytes = Data("cleanup-failure-H0".utf8)
        let h1Bytes = Data("cleanup-failure-H1".utf8)
        let h2Bytes = Data("cleanup-failure-H2".utf8)
        let h3Bytes = Data("cleanup-failure-H3".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let h2 = sha256(h2Bytes)
        let h3 = sha256(h3Bytes)
        let pendingURL = fixture.blobURL(h0)
        defer {
            try? clearTestFileFlags(pendingURL)
            fixture.remove()
        }

        let seedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
        for save in [
            (h0Bytes, h0, ExpectedBookSource.missing, "cleanup-failure-H0"),
            (h1Bytes, h1, ExpectedBookSource.sha256(h0), "cleanup-failure-H1"),
            (h2Bytes, h2, ExpectedBookSource.sha256(h1), "cleanup-failure-H2"),
        ] {
            _ = try seedStore.saveOrdinary(
                candidateBytes: save.0,
                candidateHash: save.1,
                expectedSource: save.2,
                operationID: save.3
            )
        }
        let pendingIdentityBefore = try fileIdentity(of: pendingURL)
        let events = LockedOrdinaryFaultEvents()
        let committedIndexObservation = LockedOrdinaryCommittedIndexObservation()
        let faultedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
            if event.point == .afterCommittedOrdinaryIndexDurable {
                committedIndexObservation.record(
                    bytes: try Data(contentsOf: fixture.indexURL),
                    identity: try fileIdentity(of: fixture.indexURL)
                )
                try setUserImmutable(pendingURL)
            }
        }

        let result = try faultedStore.saveOrdinary(
            candidateBytes: h3Bytes,
            candidateHash: h3,
            expectedSource: .sha256(h2),
            operationID: "cleanup-failure-H3"
        )

        XCTAssertEqual(events.count(point: .afterPrimaryDurableBeforeACK), 1)
        XCTAssertEqual(events.count(point: .afterCommittedOrdinaryIndexDurable), 1)
        XCTAssertFalse(events.snapshot().contains {
            $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
        })
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), h3Bytes)
        XCTAssertEqual(result.sourceHashBefore, h2)
        XCTAssertEqual(result.stateHashAfter, h3)
        XCTAssertEqual(result.primaryReceipt.sha256, h3)
        XCTAssertEqual(result.previousSlotHashes, [h2, h1])
        XCTAssertEqual(result.recoveryHealth, cleanupPendingOrdinaryHealth(count: 1))
        XCTAssertEqual(try Data(contentsOf: pendingURL), h0Bytes)
        XCTAssertEqual(try fileIdentity(of: pendingURL), pendingIdentityBefore)
        XCTAssertTrue(try hasUserImmutableFlag(pendingURL))

        let expectedPendingIndex = OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: h3,
                slots: [h2, h1],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [h0],
                    lastHealthCode: "cleanup-pending"
                )
            ),
            prepared: nil
        )
        let committedObservation = try XCTUnwrap(committedIndexObservation.snapshot())
        let expectedPendingBytes = try OrdinaryRecoveryCodec.encode(expectedPendingIndex)
        XCTAssertEqual(committedObservation.bytes, expectedPendingBytes)
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), committedObservation.bytes)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), committedObservation.identity)
        XCTAssertEqual(try fixture.readIndex(), expectedPendingIndex)
        XCTAssertNil(try fixture.readIndex().prepared)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            cleanupPendingOrdinaryHealth(count: 1)
        )

        try clearTestFileFlags(pendingURL)
        let convergenceEvents = LockedOrdinaryFaultEvents()
        let convergenceStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            convergenceEvents.append(event)
        }
        XCTAssertEqual(try convergenceStore.reconcileOrdinary(), healthyOrdinaryHealth())
        XCTAssertEqual(
            convergenceEvents.snapshot().filter {
                $0.point == .afterHashVerified && $0.role == .ordinaryHealthIndex
            }.count,
            1,
            "the final pending/code clear must be one proof-bound health-index CAS"
        )
        XCTAssertEqual(
            convergenceEvents.snapshot().filter {
                $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
            }.map(\.point),
            [.beforeRecoveryHealthClear, .afterRecoveryHealthClear]
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: pendingURL.path))
        let convergedIndex = try fixture.readIndex()
        XCTAssertEqual(convergedIndex.committed.primaryHash, h3)
        XCTAssertEqual(convergedIndex.committed.slots, [h2, h1])
        XCTAssertEqual(convergedIndex.committed.maintenance.pendingCleanupHashes, [])
        XCTAssertNil(convergedIndex.committed.maintenance.lastHealthCode)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
    }

    func testPartialCleanupFailureKeepsCompleteCanonicalPendingSetUntilLaterConvergence() throws {
        let fixture = try OrdinaryStoreFixture()
        let primaryBytes = Data("partial-cleanup-primary".utf8)
        let primaryHash = sha256(primaryBytes)
        let failedPendingBytes = Data("partial-cleanup-immutable".utf8)
        let failedPendingHash = sha256(failedPendingBytes)
        let absentPendingHash = String(repeating: "0", count: 64)
        let failedPendingURL = fixture.blobURL(failedPendingHash)
        defer {
            try? clearTestFileFlags(failedPendingURL)
            fixture.remove()
        }
        XCTAssertNotEqual(absentPendingHash, primaryHash)
        XCTAssertNotEqual(absentPendingHash, failedPendingHash)

        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .missing,
            operationID: "partial-cleanup-seed"
        )
        try fixture.writeBlob(failedPendingBytes)
        var pendingIndex = try fixture.readIndex()
        let exactPending = [absentPendingHash, failedPendingHash].sorted()
        pendingIndex.committed.maintenance = OrdinaryMaintenanceState(
            pendingCleanupHashes: exactPending,
            lastHealthCode: "cleanup-pending"
        )
        try fixture.writeIndex(pendingIndex, role: .ordinaryHealthIndex)
        let indexIdentityBefore = try fileIdentity(of: fixture.indexURL)
        let failedPendingIdentityBefore = try fileIdentity(of: failedPendingURL)
        try setUserImmutable(failedPendingURL)

        let failureEvents = LockedOrdinaryFaultEvents()
        let failureStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            failureEvents.append(event)
        }
        let health = try failureStore.reconcileOrdinary()

        XCTAssertEqual(health, cleanupPendingOrdinaryHealth(count: 2))
        XCTAssertEqual(
            failureEvents.snapshot().filter {
                $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
            }.count,
            0,
            "a retained partial pending set must not emit a health-clear boundary"
        )
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: fixture.blobURL(absentPendingHash).path),
            "proof-of-absence must not partially clear persisted maintenance"
        )
        XCTAssertEqual(try Data(contentsOf: failedPendingURL), failedPendingBytes)
        XCTAssertEqual(try fileIdentity(of: failedPendingURL), failedPendingIdentityBefore)
        XCTAssertTrue(try hasUserImmutableFlag(failedPendingURL))
        XCTAssertEqual(try fixture.readIndex(), pendingIndex)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            cleanupPendingOrdinaryHealth(count: 2)
        )

        try clearTestFileFlags(failedPendingURL)
        let convergenceEvents = LockedOrdinaryFaultEvents()
        let convergenceStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            convergenceEvents.append(event)
        }
        XCTAssertEqual(try convergenceStore.reconcileOrdinary(), healthyOrdinaryHealth())
        XCTAssertEqual(
            convergenceEvents.snapshot().filter {
                $0.point == .afterHashVerified && $0.role == .ordinaryHealthIndex
            }.count,
            1
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: failedPendingURL.path))
        let convergedIndex = try fixture.readIndex()
        XCTAssertEqual(convergedIndex.committed.maintenance.pendingCleanupHashes, [])
        XCTAssertNil(convergedIndex.committed.maintenance.lastHealthCode)
    }

    func testCleanupFailureCannotReturnDegradedReceiptWhenPrimaryIndexOrPendingCannotBeReverified() throws {
        enum AuthoritativeAttack: CaseIterable {
            case primary, index, indexSameBytesReplacementInode, pendingBlob
        }

        for attack in AuthoritativeAttack.allCases {
            let fixture = try OrdinaryStoreFixture()
            let h0Bytes = Data("cleanup-reverify-\(attack)-H0".utf8)
            let h1Bytes = Data("cleanup-reverify-\(attack)-H1".utf8)
            let h2Bytes = Data("cleanup-reverify-\(attack)-H2".utf8)
            let h3Bytes = Data("cleanup-reverify-\(attack)-H3".utf8)
            let h0 = sha256(h0Bytes)
            let h1 = sha256(h1Bytes)
            let h2 = sha256(h2Bytes)
            let h3 = sha256(h3Bytes)
            let pendingURL = fixture.blobURL(h0)
            let detachedIndexURL = fixture.parentURL.appendingPathComponent(
                "detached-committed-index-\(UUID().uuidString)"
            )
            defer {
                try? clearTestFileFlags(pendingURL)
                fixture.remove()
            }

            let seedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            for save in [
                (h0Bytes, h0, ExpectedBookSource.missing, "cleanup-reverify-H0"),
                (h1Bytes, h1, ExpectedBookSource.sha256(h0), "cleanup-reverify-H1"),
                (h2Bytes, h2, ExpectedBookSource.sha256(h1), "cleanup-reverify-H2"),
            ] {
                _ = try seedStore.saveOrdinary(
                    candidateBytes: save.0,
                    candidateHash: save.1,
                    expectedSource: save.2,
                    operationID: save.3
                )
            }

            let events = LockedOrdinaryFaultEvents()
            let attackedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                events.append(event)
                guard event.point == .afterCommittedOrdinaryIndexDurable else { return }

                switch attack {
                case .primary:
                    try writePrivateTestFile(
                        Data("unverifiable-primary-after-commit".utf8),
                        to: fixture.primaryURL
                    )
                case .index:
                    let additionalPending = String(repeating: "f", count: 64)
                    let replacement = OrdinaryRecoveryIndex(
                        format: OrdinaryRecoveryIndex.expectedFormat,
                        version: OrdinaryRecoveryIndex.expectedVersion,
                        committed: OrdinaryCommittedState(
                            primaryHash: h3,
                            slots: [h2, h1],
                            maintenance: OrdinaryMaintenanceState(
                                pendingCleanupHashes: [h0, additionalPending].sorted(),
                                lastHealthCode: "cleanup-pending"
                            )
                        ),
                        prepared: nil
                    )
                    try writePrivateTestFile(
                        OrdinaryRecoveryCodec.encode(replacement),
                        to: fixture.indexURL
                    )
                case .indexSameBytesReplacementInode:
                    let committedBytes = try Data(contentsOf: fixture.indexURL)
                    try FileManager.default.moveItem(
                        at: fixture.indexURL,
                        to: detachedIndexURL
                    )
                    try writePrivateTestFile(committedBytes, to: fixture.indexURL)
                case .pendingBlob:
                    try writePrivateTestFile(
                        Data("unverifiable-pending-after-commit".utf8),
                        to: pendingURL
                    )
                }
                try setUserImmutable(pendingURL)
            }

            var result: NativeOrdinaryRecoverySaveResult?
            XCTAssertThrowsError(
                result = try attackedStore.saveOrdinary(
                    candidateBytes: h3Bytes,
                    candidateHash: h3,
                    expectedSource: .sha256(h2),
                    operationID: "cleanup-reverify-\(attack)-H3"
                ),
                "attack=\(attack)"
            )

            XCTAssertNil(result, "attack=\(attack)")
            XCTAssertEqual(
                events.count(point: .afterPrimaryDurableBeforeACK),
                1,
                "attack=\(attack)"
            )
            XCTAssertEqual(
                events.count(point: .afterCommittedOrdinaryIndexDurable),
                1,
                "attack=\(attack)"
            )
            XCTAssertTrue(try hasUserImmutableFlag(pendingURL), "attack=\(attack)")
            if case .indexSameBytesReplacementInode = attack {
                XCTAssertEqual(
                    try Data(contentsOf: fixture.indexURL),
                    try Data(contentsOf: detachedIndexURL),
                    "same canonical bytes must not hide an authoritative inode replacement"
                )
                XCTAssertNotEqual(
                    try fileIdentity(of: fixture.indexURL),
                    try fileIdentity(of: detachedIndexURL),
                    "the negative fixture must actually publish a replacement inode"
                )
            }
        }
    }

    func testInjectedRawUnlinkFailureReturnsDegradedAfterOneAttemptAndExactReproof() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let h0Bytes = Data("injected-unlink-H0".utf8)
        let h1Bytes = Data("injected-unlink-H1".utf8)
        let h2Bytes = Data("injected-unlink-H2".utf8)
        let h3Bytes = Data("injected-unlink-H3".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let h2 = sha256(h2Bytes)
        let h3 = sha256(h3Bytes)
        let pendingURL = fixture.blobURL(h0)

        let seedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
        for save in [
            (h0Bytes, h0, ExpectedBookSource.missing, "injected-unlink-H0"),
            (h1Bytes, h1, ExpectedBookSource.sha256(h0), "injected-unlink-H1"),
            (h2Bytes, h2, ExpectedBookSource.sha256(h1), "injected-unlink-H2"),
        ] {
            _ = try seedStore.saveOrdinary(
                candidateBytes: save.0,
                candidateHash: save.1,
                expectedSource: save.2,
                operationID: save.3
            )
        }
        let pendingIdentityBefore = try fileIdentity(of: pendingURL)
        let posix = StorePostUnlinkFailureNativePOSIX()
        let events = LockedOrdinaryFaultEvents()
        let handler: NativeDurabilityFaultHandler = { event in events.append(event) }
        let store = makeInjectedRecoveryStore(
            rootURL: fixture.rootURL,
            posix: posix,
            faultHandler: handler
        )

        let result = try store.saveOrdinary(
            candidateBytes: h3Bytes,
            candidateHash: h3,
            expectedSource: .sha256(h2),
            operationID: "injected-unlink-H3"
        )

        XCTAssertEqual(posix.unlinkCallCount(), 1, "cleanup failure must not retry unlink")
        XCTAssertEqual(result.primaryReceipt.sha256, h3)
        XCTAssertEqual(result.stateHashAfter, h3)
        XCTAssertEqual(result.previousSlotHashes, [h2, h1])
        XCTAssertEqual(result.recoveryHealth, cleanupPendingOrdinaryHealth(count: 1))
        XCTAssertEqual(events.count(point: .afterCommittedOrdinaryIndexDurable), 1)
        XCTAssertFalse(events.snapshot().contains {
            $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
        })
        XCTAssertEqual(try Data(contentsOf: pendingURL), h0Bytes)
        XCTAssertEqual(try fileIdentity(of: pendingURL), pendingIdentityBefore)
        let index = try fixture.readIndex()
        XCTAssertEqual(index.committed.primaryHash, h3)
        XCTAssertEqual(index.committed.slots, [h2, h1])
        XCTAssertEqual(index.committed.maintenance.pendingCleanupHashes, [h0])
        XCTAssertEqual(index.committed.maintenance.lastHealthCode, "cleanup-pending")
        XCTAssertNil(index.prepared)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            cleanupPendingOrdinaryHealth(count: 1)
        )
    }

    func testAbsentPendingReconcileSyncsBlobsDirectoryBeforeClearingHealthAfterPriorUnlinkSyncFailure() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let primaryBytes = Data("absent-pending-sync-before-clear-primary".utf8)
        let pendingBytes = Data("absent-pending-sync-before-clear-pending".utf8)
        let primaryHash = sha256(primaryBytes)
        let pendingHash = sha256(pendingBytes)
        XCTAssertNotEqual(primaryHash, pendingHash)

        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .missing,
            operationID: "absent-pending-sync-before-clear-seed"
        )
        try fixture.writeBlob(pendingBytes)
        var pendingIndex = try fixture.readIndex()
        pendingIndex.committed.maintenance = OrdinaryMaintenanceState(
            pendingCleanupHashes: [pendingHash],
            lastHealthCode: "cleanup-pending"
        )
        try fixture.writeIndex(pendingIndex, role: .ordinaryHealthIndex)
        let pendingIndexBytes = try Data(contentsOf: fixture.indexURL)
        let posix = StorePostUnlinkFailureNativePOSIX(
            injectFirstUnlinkFailure: false,
            trackedBlobsDirectoryIdentity: try fileIdentity(of: fixture.blobsURL),
            trackedBlobsDirectorySyncFailureAttempts: [1]
        )

        let operationAEvents = LockedOrdinaryFaultEvents()
        let operationAStore = makeInjectedRecoveryStore(
            rootURL: fixture.rootURL,
            posix: posix,
            faultHandler: { event in operationAEvents.append(event) }
        )
        let operationAHealth = try operationAStore.reconcileOrdinary()

        XCTAssertEqual(operationAHealth, cleanupPendingOrdinaryHealth(count: 1))
        XCTAssertEqual(posix.unlinkCallCount(), 1, "operation A must perform one real raw unlink")
        XCTAssertEqual(posix.trackedBlobsDirectorySyncAttemptCount(), 1)
        XCTAssertEqual(posix.trackedBlobsDirectorySyncSuccessCount(), 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(pendingHash).path))
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), pendingIndexBytes)
        XCTAssertEqual(try fixture.readIndex(), pendingIndex)
        XCTAssertFalse(operationAEvents.snapshot().contains {
            $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
        })

        let operationBEvents = LockedOrdinaryFaultEvents()
        let operationBOrderStart = posix.trackedBlobsDirectoryOrder().count
        let operationBStore = makeInjectedRecoveryStore(
            rootURL: fixture.rootURL,
            posix: posix,
            faultHandler: { event in
                operationBEvents.append(event)
                posix.recordRecoveryHealthBoundary(event.point)
            }
        )
        let operationBHealth = try operationBStore.reconcileOrdinary()

        XCTAssertEqual(posix.unlinkCallCount(), 1, "an already-absent H must not be unlinked again")
        XCTAssertEqual(posix.trackedBlobsDirectorySyncAttemptCount(), 2)
        XCTAssertEqual(posix.trackedBlobsDirectorySyncSuccessCount(), 1)
        XCTAssertEqual(
            Array(posix.trackedBlobsDirectoryOrder().dropFirst(operationBOrderStart)),
            [
                "blobs-sync-attempt",
                "blobs-sync-success",
                "before-recovery-health-clear",
                "after-recovery-health-clear",
            ],
            "operation B must durably sync the bound blobs directory before its health CAS"
        )
        XCTAssertEqual(operationBEvents.snapshot().filter {
            $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
        }.map(\.point), [.beforeRecoveryHealthClear, .afterRecoveryHealthClear])
        XCTAssertEqual(operationBHealth, healthyOrdinaryHealth())
        let clearedIndex = try fixture.readIndex()
        XCTAssertEqual(clearedIndex.committed.primaryHash, primaryHash)
        XCTAssertEqual(clearedIndex.committed.slots, [])
        XCTAssertEqual(clearedIndex.committed.maintenance.pendingCleanupHashes, [])
        XCTAssertNil(clearedIndex.committed.maintenance.lastHealthCode)
        XCTAssertNil(clearedIndex.prepared)
    }

    func testAbsentPendingReconcileSyncFailureKeepsExactPendingHealthAndSkipsHealthClear() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let primaryBytes = Data("absent-pending-repeat-sync-failure-primary".utf8)
        let pendingBytes = Data("absent-pending-repeat-sync-failure-pending".utf8)
        let primaryHash = sha256(primaryBytes)
        let pendingHash = sha256(pendingBytes)
        XCTAssertNotEqual(primaryHash, pendingHash)

        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .missing,
            operationID: "absent-pending-repeat-sync-failure-seed"
        )
        try fixture.writeBlob(pendingBytes)
        var pendingIndex = try fixture.readIndex()
        pendingIndex.committed.maintenance = OrdinaryMaintenanceState(
            pendingCleanupHashes: [pendingHash],
            lastHealthCode: "cleanup-pending"
        )
        try fixture.writeIndex(pendingIndex, role: .ordinaryHealthIndex)
        let pendingIndexBytes = try Data(contentsOf: fixture.indexURL)
        let pendingIndexIdentity = try fileIdentity(of: fixture.indexURL)
        let posix = StorePostUnlinkFailureNativePOSIX(
            injectFirstUnlinkFailure: false,
            trackedBlobsDirectoryIdentity: try fileIdentity(of: fixture.blobsURL),
            trackedBlobsDirectorySyncFailureAttempts: [1, 2]
        )

        let operationAEvents = LockedOrdinaryFaultEvents()
        let operationAStore = makeInjectedRecoveryStore(
            rootURL: fixture.rootURL,
            posix: posix,
            faultHandler: { event in operationAEvents.append(event) }
        )
        XCTAssertEqual(
            try operationAStore.reconcileOrdinary(),
            cleanupPendingOrdinaryHealth(count: 1)
        )
        XCTAssertEqual(posix.unlinkCallCount(), 1)
        XCTAssertEqual(posix.trackedBlobsDirectorySyncAttemptCount(), 1)
        XCTAssertEqual(posix.trackedBlobsDirectorySyncSuccessCount(), 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(pendingHash).path))
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), pendingIndexBytes)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), pendingIndexIdentity)
        XCTAssertFalse(operationAEvents.snapshot().contains {
            $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
        })

        let operationBEvents = LockedOrdinaryFaultEvents()
        let operationBOrderStart = posix.trackedBlobsDirectoryOrder().count
        let operationBStore = makeInjectedRecoveryStore(
            rootURL: fixture.rootURL,
            posix: posix,
            faultHandler: { event in
                operationBEvents.append(event)
                posix.recordRecoveryHealthBoundary(event.point)
            }
        )
        let operationBHealth = try operationBStore.reconcileOrdinary()

        XCTAssertEqual(operationBHealth, cleanupPendingOrdinaryHealth(count: 1))
        XCTAssertEqual(posix.unlinkCallCount(), 1)
        XCTAssertEqual(posix.trackedBlobsDirectorySyncAttemptCount(), 2)
        XCTAssertEqual(posix.trackedBlobsDirectorySyncSuccessCount(), 0)
        XCTAssertEqual(
            Array(posix.trackedBlobsDirectoryOrder().dropFirst(operationBOrderStart)),
            ["blobs-sync-attempt", "blobs-sync-failure"]
        )
        XCTAssertFalse(operationBEvents.snapshot().contains {
            $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
        })
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), pendingIndexBytes)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), pendingIndexIdentity)
        let retainedIndex = try fixture.readIndex()
        XCTAssertEqual(retainedIndex, pendingIndex)
        XCTAssertEqual(retainedIndex.committed.maintenance.pendingCleanupHashes, [pendingHash])
        XCTAssertEqual(retainedIndex.committed.maintenance.lastHealthCode, "cleanup-pending")
        XCTAssertNil(retainedIndex.prepared)
    }

    func testPostUnlinkFailurePrimaryAndIndexRacesCannotReturnDegradedReceipt() throws {
        enum PostFailureAttack: CaseIterable, Sendable {
            case primary
            case indexDifferentBytes
            case indexSameBytesReplacementInode
        }

        for attack in PostFailureAttack.allCases {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            let h0Bytes = Data("post-unlink-\(attack)-H0".utf8)
            let h1Bytes = Data("post-unlink-\(attack)-H1".utf8)
            let h2Bytes = Data("post-unlink-\(attack)-H2".utf8)
            let h3Bytes = Data("post-unlink-\(attack)-H3".utf8)
            let h0 = sha256(h0Bytes)
            let h1 = sha256(h1Bytes)
            let h2 = sha256(h2Bytes)
            let h3 = sha256(h3Bytes)
            let pendingURL = fixture.blobURL(h0)
            let detachedIndexURL = fixture.parentURL.appendingPathComponent(
                "post-unlink-detached-index-\(UUID().uuidString)"
            )

            let seedStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            for save in [
                (h0Bytes, h0, ExpectedBookSource.missing, "post-unlink-H0"),
                (h1Bytes, h1, ExpectedBookSource.sha256(h0), "post-unlink-H1"),
                (h2Bytes, h2, ExpectedBookSource.sha256(h1), "post-unlink-H2"),
            ] {
                _ = try seedStore.saveOrdinary(
                    candidateBytes: save.0,
                    candidateHash: save.1,
                    expectedSource: save.2,
                    operationID: save.3
                )
            }
            let pendingIdentityBefore = try fileIdentity(of: pendingURL)
            let posix = StorePostUnlinkFailureNativePOSIX(postFailureAction: {
                switch attack {
                case .primary:
                    try writePrivateTestFile(
                        Data("post-unlink-primary-replacement".utf8),
                        to: fixture.primaryURL
                    )
                case .indexDifferentBytes:
                    let additionalPending = String(repeating: "f", count: 64)
                    let replacement = OrdinaryRecoveryIndex(
                        format: OrdinaryRecoveryIndex.expectedFormat,
                        version: OrdinaryRecoveryIndex.expectedVersion,
                        committed: OrdinaryCommittedState(
                            primaryHash: h3,
                            slots: [h2, h1],
                            maintenance: OrdinaryMaintenanceState(
                                pendingCleanupHashes: [h0, additionalPending].sorted(),
                                lastHealthCode: "cleanup-pending"
                            )
                        ),
                        prepared: nil
                    )
                    try writePrivateTestFile(
                        OrdinaryRecoveryCodec.encode(replacement),
                        to: fixture.indexURL
                    )
                case .indexSameBytesReplacementInode:
                    let committedBytes = try Data(contentsOf: fixture.indexURL)
                    try FileManager.default.moveItem(
                        at: fixture.indexURL,
                        to: detachedIndexURL
                    )
                    try writePrivateTestFile(committedBytes, to: fixture.indexURL)
                }
            })
            let events = LockedOrdinaryFaultEvents()
            let handler: NativeDurabilityFaultHandler = { event in events.append(event) }
            let store = makeInjectedRecoveryStore(
                rootURL: fixture.rootURL,
                posix: posix,
                faultHandler: handler
            )

            var result: NativeOrdinaryRecoverySaveResult?
            XCTAssertThrowsError(
                result = try store.saveOrdinary(
                    candidateBytes: h3Bytes,
                    candidateHash: h3,
                    expectedSource: .sha256(h2),
                    operationID: "post-unlink-\(attack)-H3"
                ),
                "attack=\(attack)"
            )

            XCTAssertNil(result, "attack=\(attack)")
            XCTAssertEqual(posix.unlinkCallCount(), 1, "attack=\(attack)")
            XCTAssertEqual(posix.postFailureActionCount(), 1, "attack=\(attack)")
            XCTAssertEqual(events.count(point: .afterCommittedOrdinaryIndexDurable), 1)
            XCTAssertFalse(events.snapshot().contains {
                $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
            })
            XCTAssertEqual(try Data(contentsOf: pendingURL), h0Bytes)
            XCTAssertEqual(try fileIdentity(of: pendingURL), pendingIdentityBefore)
            if case .indexSameBytesReplacementInode = attack {
                XCTAssertEqual(
                    try Data(contentsOf: fixture.indexURL),
                    try Data(contentsOf: detachedIndexURL)
                )
                XCTAssertNotEqual(
                    try fileIdentity(of: fixture.indexURL),
                    try fileIdentity(of: detachedIndexURL)
                )
            }
        }
    }

    func testNoOpCleanupFailureFinalACKReproofRejectsSourceAndExactIndexReplacement() throws {
        enum FinalReproofAttack: CaseIterable, Sendable {
            case source
            case indexSameBytesReplacementInode
        }

        for attack in FinalReproofAttack.allCases {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            let primaryBytes = Data("no-op-final-reproof-\(attack)-primary".utf8)
            let primaryHash = sha256(primaryBytes)
            let pendingBytes = Data("no-op-final-reproof-\(attack)-pending".utf8)
            let pendingHash = sha256(pendingBytes)
            let pendingURL = fixture.blobURL(pendingHash)
            let detachedIndexURL = fixture.parentURL.appendingPathComponent(
                "no-op-final-detached-index-\(UUID().uuidString)"
            )

            _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
                candidateBytes: primaryBytes,
                candidateHash: primaryHash,
                expectedSource: .missing,
                operationID: "no-op-final-reproof-seed"
            )
            try fixture.writeBlob(pendingBytes)
            var pendingIndex = try fixture.readIndex()
            pendingIndex.committed.maintenance = OrdinaryMaintenanceState(
                pendingCleanupHashes: [pendingHash],
                lastHealthCode: "cleanup-pending"
            )
            try fixture.writeIndex(pendingIndex, role: .ordinaryHealthIndex)
            let pendingIdentityBefore = try fileIdentity(of: pendingURL)
            let posix = StorePostUnlinkFailureNativePOSIX()
            let events = LockedOrdinaryFaultEvents()
            let handler: NativeDurabilityFaultHandler = { event in
                events.append(event)
                guard event.point == .afterPrimaryDurableBeforeACK else { return }
                switch attack {
                case .source:
                    try writePrivateTestFile(
                        Data("no-op-final-source-replacement".utf8),
                        to: fixture.primaryURL
                    )
                case .indexSameBytesReplacementInode:
                    let exactIndexBytes = try Data(contentsOf: fixture.indexURL)
                    try FileManager.default.moveItem(
                        at: fixture.indexURL,
                        to: detachedIndexURL
                    )
                    try writePrivateTestFile(exactIndexBytes, to: fixture.indexURL)
                }
            }
            let store = makeInjectedRecoveryStore(
                rootURL: fixture.rootURL,
                posix: posix,
                faultHandler: handler
            )

            var result: NativeOrdinaryRecoverySaveResult?
            XCTAssertThrowsError(
                result = try store.saveOrdinary(
                    candidateBytes: primaryBytes,
                    candidateHash: primaryHash,
                    expectedSource: .sha256(primaryHash),
                    operationID: "no-op-final-reproof-\(attack)"
                ),
                "attack=\(attack)"
            )

            XCTAssertNil(result, "attack=\(attack)")
            XCTAssertEqual(posix.unlinkCallCount(), 1, "attack=\(attack)")
            XCTAssertEqual(events.count(point: .afterPrimaryDurableBeforeACK), 1)
            XCTAssertFalse(events.snapshot().contains {
                $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
            })
            XCTAssertEqual(try Data(contentsOf: pendingURL), pendingBytes)
            XCTAssertEqual(try fileIdentity(of: pendingURL), pendingIdentityBefore)
            if case .indexSameBytesReplacementInode = attack {
                XCTAssertEqual(
                    try Data(contentsOf: fixture.indexURL),
                    try Data(contentsOf: detachedIndexURL)
                )
                XCTAssertNotEqual(
                    try fileIdentity(of: fixture.indexURL),
                    try fileIdentity(of: detachedIndexURL)
                )
            }
        }
    }

    func testNoOpCleanupFailureReturnsDegradedWithoutPrimaryOrSlotRotationAndLaterConverges() throws {
        let fixture = try OrdinaryStoreFixture()
        let primaryBytes = Data("no-op-cleanup-primary".utf8)
        let primaryHash = sha256(primaryBytes)
        let pendingBytes = Data("no-op-cleanup-pending".utf8)
        let pendingHash = sha256(pendingBytes)
        let pendingURL = fixture.blobURL(pendingHash)
        defer {
            try? clearTestFileFlags(pendingURL)
            fixture.remove()
        }

        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .missing,
            operationID: "no-op-cleanup-seed"
        )
        try fixture.writeBlob(pendingBytes)
        var pendingIndex = try fixture.readIndex()
        pendingIndex.committed.maintenance = OrdinaryMaintenanceState(
            pendingCleanupHashes: [pendingHash],
            lastHealthCode: "cleanup-pending"
        )
        try fixture.writeIndex(pendingIndex, role: .ordinaryHealthIndex)
        let primaryIdentityBefore = try fileIdentity(of: fixture.primaryURL)
        let indexIdentityBefore = try fileIdentity(of: fixture.indexURL)
        let pendingIdentityBefore = try fileIdentity(of: pendingURL)
        try setUserImmutable(pendingURL)
        let events = LockedOrdinaryFaultEvents()
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
        }

        let result = try store.saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .sha256(primaryHash),
            operationID: "no-op-cleanup-failure"
        )

        XCTAssertEqual(result.sourceHashBefore, primaryHash)
        XCTAssertEqual(result.stateHashAfter, primaryHash)
        XCTAssertEqual(result.primaryReceipt.sha256, primaryHash)
        XCTAssertEqual(result.previousSlotHashes, [])
        XCTAssertEqual(result.recoveryHealth, cleanupPendingOrdinaryHealth(count: 1))
        XCTAssertEqual(events.count(point: .afterPrimaryDurableBeforeACK), 1)
        XCTAssertFalse(events.snapshot().contains {
            $0.point == .afterPreparedOrdinaryIndexDurable
                || $0.point == .afterCommittedOrdinaryIndexDurable
                || ($0.point == .afterRename && $0.role == .primary)
                || $0.point == .beforeRecoveryHealthClear
                || $0.point == .afterRecoveryHealthClear
        })
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytes)
        XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: pendingURL), pendingBytes)
        XCTAssertEqual(try fileIdentity(of: pendingURL), pendingIdentityBefore)
        XCTAssertTrue(try hasUserImmutableFlag(pendingURL))
        XCTAssertEqual(try fixture.readIndex(), pendingIndex)
        XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            cleanupPendingOrdinaryHealth(count: 1)
        )

        try clearTestFileFlags(pendingURL)
        let convergenceEvents = LockedOrdinaryFaultEvents()
        let convergenceStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            convergenceEvents.append(event)
        }
        let converged = try convergenceStore.saveOrdinary(
            candidateBytes: primaryBytes,
            candidateHash: primaryHash,
            expectedSource: .sha256(primaryHash),
            operationID: "no-op-cleanup-converge"
        )
        XCTAssertEqual(converged.recoveryHealth, healthyOrdinaryHealth())
        XCTAssertEqual(converged.previousSlotHashes, [])
        XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore)
        XCTAssertFalse(convergenceEvents.snapshot().contains {
            $0.point == .afterPreparedOrdinaryIndexDurable
                || $0.point == .afterCommittedOrdinaryIndexDurable
                || ($0.point == .afterRename && $0.role == .primary)
        })
        XCTAssertFalse(FileManager.default.fileExists(atPath: pendingURL.path))
        XCTAssertEqual(try fixture.readIndex().committed.maintenance.pendingCleanupHashes, [])
        XCTAssertNil(try fixture.readIndex().committed.maintenance.lastHealthCode)
    }

    func testPreparedOldPrimaryClearAtomicallyPendsPreparedOnlySourceBeforeCleanup() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let h0Bytes = Data("prepared-old-pending-H0".utf8)
        let h1Bytes = Data("prepared-old-pending-H1".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "prepared-old-pending-seed"
        )
        let interrupted = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            if event.point == .afterPreparedOrdinaryIndexDurable {
                throw OrdinaryInjectedFailure.stop
            }
        }
        XCTAssertThrowsError(try interrupted.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "prepared-old-pending-interrupted"
        ))
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), h0Bytes)
        XCTAssertNotNil(try fixture.readIndex().prepared)
        XCTAssertEqual(try Data(contentsOf: fixture.blobURL(h0)), h0Bytes)

        let observations = LockedOrdinaryIndexBoundaryObservations()
        let events = LockedOrdinaryFaultEvents()
        let freshStore = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            events.append(event)
            if event.point == .afterCommittedOrdinaryIndexDurable {
                observations.append(
                    event: event,
                    indexBytes: try Data(contentsOf: fixture.indexURL),
                    presentBlobHashes: FileManager.default.fileExists(
                        atPath: fixture.blobURL(h0).path
                    ) ? [h0] : []
                )
            }
        }

        let health = try freshStore.reconcileOrdinary()

        let expectedPending = OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: h0,
                slots: [],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [h0],
                    lastHealthCode: "cleanup-pending"
                )
            ),
            prepared: nil
        )
        let committedObservation = try XCTUnwrap(
            observations.first(point: .afterCommittedOrdinaryIndexDurable)
        )
        XCTAssertEqual(committedObservation.role, .ordinaryCommittedIndex)
        XCTAssertEqual(
            committedObservation.indexBytes,
            try OrdinaryRecoveryCodec.encode(expectedPending)
        )
        XCTAssertEqual(committedObservation.presentBlobHashes, [h0])
        XCTAssertEqual(events.snapshot().filter {
            $0.point == .afterCommittedOrdinaryIndexDurable
                || $0.point == .beforeRecoveryHealthClear
                || $0.point == .afterRecoveryHealthClear
        }.map(\.role), [
            .ordinaryCommittedIndex,
            .ordinaryHealthIndex,
            .ordinaryHealthIndex
        ])
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobURL(h0).path))
        XCTAssertEqual(health, healthyOrdinaryHealth())
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
    }

    func testPreparedOldCleanupFailureThenDistinctRescueReturnsHealthyWithoutRetry() throws {
        let fixture = try OrdinaryStoreFixture()
        let h0Bytes = Data("prepared-rescue-H0".utf8)
        let h1Bytes = Data("prepared-rescue-H1".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let h0URL = fixture.blobURL(h0)
        defer {
            try? clearTestFileFlags(h0URL)
            fixture.remove()
        }

        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "prepared-rescue-seed"
        )
        let interrupted = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            if event.point == .afterPreparedOrdinaryIndexDurable {
                throw OrdinaryInjectedFailure.stop
            }
        }
        XCTAssertThrowsError(try interrupted.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "prepared-rescue-interrupted"
        ))
        let interruptedIndex = try fixture.readIndex()
        XCTAssertEqual(interruptedIndex.committed.primaryHash, h0)
        XCTAssertEqual(interruptedIndex.committed.slots, [])
        XCTAssertEqual(interruptedIndex.committed.maintenance.pendingCleanupHashes, [])
        XCTAssertNil(interruptedIndex.committed.maintenance.lastHealthCode)
        XCTAssertEqual(interruptedIndex.prepared?.sourceHash, h0)
        XCTAssertEqual(interruptedIndex.prepared?.candidateHash, h1)
        XCTAssertEqual(interruptedIndex.prepared?.committedSlots, [])
        XCTAssertEqual(interruptedIndex.prepared?.nextSlots, [h0])
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), h0Bytes)
        XCTAssertEqual(try Data(contentsOf: h0URL), h0Bytes)

        let h0IdentityBefore = try fileIdentity(of: h0URL)
        try setUserImmutable(h0URL)
        XCTAssertTrue(try hasUserImmutableFlag(h0URL))
        let posix = StorePostUnlinkFailureNativePOSIX(injectFirstUnlinkFailure: false)
        let events = LockedOrdinaryFaultEvents()
        let observations = LockedOrdinaryIndexBoundaryObservations()
        let handler: NativeDurabilityFaultHandler = { event in
            events.append(event)
            if event.point == .afterPreparedOrdinaryIndexDurable
                || event.point == .afterCommittedOrdinaryIndexDurable
            {
                observations.append(
                    event: event,
                    indexBytes: try Data(contentsOf: fixture.indexURL),
                    presentBlobHashes: [h0]
                )
            }
        }
        let freshStore = makeInjectedRecoveryStore(
            rootURL: fixture.rootURL,
            posix: posix,
            faultHandler: handler
        )

        let result = try freshStore.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "prepared-rescue-retry"
        )

        XCTAssertEqual(posix.unlinkCallCount(), 1, "the failed old-reconcile cleanup must not retry")
        XCTAssertEqual(events.count(point: .afterCommittedOrdinaryIndexDurable), 2)
        XCTAssertEqual(events.count(point: .afterPreparedOrdinaryIndexDurable), 1)
        XCTAssertFalse(events.snapshot().contains {
            $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
        })

        let boundaryIndexes = try observations.snapshot().map {
            try OrdinaryRecoveryCodec.decode($0.indexBytes)
        }
        XCTAssertEqual(boundaryIndexes.count, 3)
        XCTAssertEqual(boundaryIndexes[0].committed.primaryHash, h0)
        XCTAssertEqual(boundaryIndexes[0].committed.slots, [])
        XCTAssertEqual(boundaryIndexes[0].committed.maintenance.pendingCleanupHashes, [h0])
        XCTAssertEqual(boundaryIndexes[0].committed.maintenance.lastHealthCode, "cleanup-pending")
        XCTAssertNil(boundaryIndexes[0].prepared)
        XCTAssertEqual(boundaryIndexes[1].committed.maintenance.pendingCleanupHashes, [])
        XCTAssertNil(boundaryIndexes[1].committed.maintenance.lastHealthCode)
        XCTAssertEqual(boundaryIndexes[1].prepared?.nextSlots, [h0])
        XCTAssertEqual(boundaryIndexes[2].committed.primaryHash, h1)
        XCTAssertEqual(boundaryIndexes[2].committed.slots, [h0])
        XCTAssertEqual(boundaryIndexes[2].committed.maintenance.pendingCleanupHashes, [])
        XCTAssertNil(boundaryIndexes[2].committed.maintenance.lastHealthCode)
        XCTAssertNil(boundaryIndexes[2].prepared)

        XCTAssertEqual(result.sourceHashBefore, h0)
        XCTAssertEqual(result.stateHashAfter, h1)
        XCTAssertEqual(result.primaryReceipt.sha256, h1)
        XCTAssertEqual(result.previousSlotHashes, [h0])
        XCTAssertEqual(result.recoveryHealth, healthyOrdinaryHealth())
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), h1Bytes)
        XCTAssertEqual(try Data(contentsOf: h0URL), h0Bytes)
        XCTAssertEqual(try fileIdentity(of: h0URL), h0IdentityBefore)
        XCTAssertTrue(try hasUserImmutableFlag(h0URL))
        XCTAssertEqual(try fixture.readIndex(), boundaryIndexes[2])
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
    }

    func testPreparedOldCleanupDirectorySyncFailureRecreatesRescuedSourceAndReturnsHealthy() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let h0Bytes = Data("prepared-sync-rescue-H0".utf8)
        let h1Bytes = Data("prepared-sync-rescue-H1".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let h0URL = fixture.blobURL(h0)

        _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "prepared-sync-rescue-seed"
        )
        let interrupted = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
            if event.point == .afterPreparedOrdinaryIndexDurable {
                throw OrdinaryInjectedFailure.stop
            }
        }
        XCTAssertThrowsError(try interrupted.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "prepared-sync-rescue-interrupted"
        ))
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), h0Bytes)
        XCTAssertEqual(try Data(contentsOf: h0URL), h0Bytes)
        XCTAssertEqual(try fixture.readIndex().prepared?.nextSlots, [h0])
        let h0IdentityBefore = try fileIdentity(of: h0URL)

        let posix = StorePostUnlinkFailureNativePOSIX(
            injectFirstUnlinkFailure: false,
            injectDirectorySyncFailureAfterSuccessfulUnlink: true
        )
        let events = LockedOrdinaryFaultEvents()
        let observations = LockedOrdinaryIndexBoundaryObservations()
        let handler: NativeDurabilityFaultHandler = { event in
            events.append(event)
            if event.point == .afterPreparedOrdinaryIndexDurable
                || event.point == .afterCommittedOrdinaryIndexDurable
            {
                observations.append(
                    event: event,
                    indexBytes: try Data(contentsOf: fixture.indexURL),
                    presentBlobHashes: FileManager.default.fileExists(atPath: h0URL.path)
                        ? [h0]
                        : []
                )
            }
        }
        let freshStore = makeInjectedRecoveryStore(
            rootURL: fixture.rootURL,
            posix: posix,
            faultHandler: handler
        )

        let result = try freshStore.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "prepared-sync-rescue-retry"
        )

        XCTAssertEqual(posix.unlinkCallCount(), 1)
        XCTAssertEqual(posix.cleanupDirectorySyncCallCount(), 1)
        XCTAssertEqual(events.count(point: .afterCommittedOrdinaryIndexDurable), 2)
        XCTAssertEqual(events.count(point: .afterPreparedOrdinaryIndexDurable), 1)
        XCTAssertEqual(events.snapshot().filter {
            $0.point == .afterOrdinaryBlobDurable
                && $0.role == .ordinaryBlob
                && $0.targetName == "Recovery/ordinary/blobs/\(h0).json"
        }.count, 1, "the distinct transition must recreate the absent rescued source blob")
        XCTAssertFalse(events.snapshot().contains {
            $0.point == .beforeRecoveryHealthClear || $0.point == .afterRecoveryHealthClear
        })

        let boundaryIndexes = try observations.snapshot().map {
            try OrdinaryRecoveryCodec.decode($0.indexBytes)
        }
        XCTAssertEqual(boundaryIndexes.count, 3)
        XCTAssertEqual(boundaryIndexes[0].committed.maintenance.pendingCleanupHashes, [h0])
        XCTAssertEqual(boundaryIndexes[0].committed.maintenance.lastHealthCode, "cleanup-pending")
        XCTAssertNil(boundaryIndexes[0].prepared)
        XCTAssertEqual(boundaryIndexes[1].committed.maintenance.pendingCleanupHashes, [])
        XCTAssertNil(boundaryIndexes[1].committed.maintenance.lastHealthCode)
        XCTAssertEqual(boundaryIndexes[1].prepared?.nextSlots, [h0])
        XCTAssertEqual(boundaryIndexes[2].committed.primaryHash, h1)
        XCTAssertEqual(boundaryIndexes[2].committed.slots, [h0])
        XCTAssertEqual(boundaryIndexes[2].committed.maintenance.pendingCleanupHashes, [])
        XCTAssertNil(boundaryIndexes[2].committed.maintenance.lastHealthCode)
        XCTAssertNil(boundaryIndexes[2].prepared)

        XCTAssertEqual(result.sourceHashBefore, h0)
        XCTAssertEqual(result.stateHashAfter, h1)
        XCTAssertEqual(result.primaryReceipt.sha256, h1)
        XCTAssertEqual(result.previousSlotHashes, [h0])
        XCTAssertEqual(result.recoveryHealth, healthyOrdinaryHealth())
        XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), h1Bytes)
        XCTAssertEqual(try Data(contentsOf: h0URL), h0Bytes)
        XCTAssertNotEqual(
            try fileIdentity(of: h0URL),
            h0IdentityBefore,
            "successful unlink plus reconstruction must publish a new H0 inode"
        )
        XCTAssertEqual(try fixture.readIndex(), boundaryIndexes[2])
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
    }

    func testNativeLoadDistinguishesAbsentIndexlessEmptyValidatedTempAndApplicableEmptyDomains() throws {
        let absentRecovery = try OrdinaryStoreFixture()
        defer { absentRecovery.remove() }
        let absentParentListing = try FileManager.default.contentsOfDirectory(
            atPath: absentRecovery.parentURL.path
        )
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: absentRecovery.rootURL).auditOrdinary(),
            notApplicableOrdinaryHealth()
        )
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: absentRecovery.parentURL.path),
            absentParentListing
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: absentRecovery.rootURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: absentRecovery.ordinaryURL.path))

        let existingRootWithoutLock = try OrdinaryStoreFixture()
        defer { existingRootWithoutLock.remove() }
        try createPrivateTestDirectory(existingRootWithoutLock.rootURL)
        let rootInodeBefore = try inode(of: existingRootWithoutLock.rootURL)
        let rootListingBefore = try FileManager.default.contentsOfDirectory(
            atPath: existingRootWithoutLock.rootURL.path
        )
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: existingRootWithoutLock.rootURL).auditOrdinary(),
            notApplicableOrdinaryHealth()
        )
        XCTAssertEqual(try inode(of: existingRootWithoutLock.rootURL), rootInodeBefore)
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: existingRootWithoutLock.rootURL.path),
            rootListingBefore
        )
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: existingRootWithoutLock.rootURL
                    .appendingPathComponent(".AssetTracker.storage.lock")
                    .path
            )
        )

        let unlockedIndexed = try OrdinaryStoreFixture()
        defer { unlockedIndexed.remove() }
        try unlockedIndexed.prepareOrdinaryWithoutWriter()
        let unlockedIndexBytes = try OrdinaryRecoveryCodec.encode(emptyOrdinaryIndex())
        try writePrivateTestFile(unlockedIndexBytes, to: unlockedIndexed.indexURL)
        let unlockedIndexInode = try inode(of: unlockedIndexed.indexURL)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: unlockedIndexed.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
        XCTAssertEqual(try Data(contentsOf: unlockedIndexed.indexURL), unlockedIndexBytes)
        XCTAssertEqual(try inode(of: unlockedIndexed.indexURL), unlockedIndexInode)
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: unlockedIndexed.rootURL
                    .appendingPathComponent(".AssetTracker.storage.lock")
                    .path
            )
        )

        let unlockedCorrupt = try OrdinaryStoreFixture()
        defer { unlockedCorrupt.remove() }
        try unlockedCorrupt.prepareOrdinaryWithoutWriter()
        let unlockedUnknown = unlockedCorrupt.ordinaryURL.appendingPathComponent("unknown")
        try writePrivateTestFile(Data("unlocked-corruption".utf8), to: unlockedUnknown)
        XCTAssertThrowsError(
            try AssetTrackerRecoveryStore(rootURL: unlockedCorrupt.rootURL).auditOrdinary()
        )
        XCTAssertEqual(try Data(contentsOf: unlockedUnknown), Data("unlocked-corruption".utf8))
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: unlockedCorrupt.rootURL
                    .appendingPathComponent(".AssetTracker.storage.lock")
                    .path
            )
        )

        let absentOrdinary = try OrdinaryStoreFixture()
        defer { absentOrdinary.remove() }
        try absentOrdinary.prepareRecoveryOnly()
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: absentOrdinary.rootURL).auditOrdinary(),
            notApplicableOrdinaryHealth()
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: absentOrdinary.ordinaryURL.path))

        let indexlessEmpty = try OrdinaryStoreFixture()
        defer { indexlessEmpty.remove() }
        try indexlessEmpty.prepareOrdinary(includeBlobs: false)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: indexlessEmpty.rootURL).auditOrdinary(),
            notApplicableOrdinaryHealth()
        )
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: indexlessEmpty.ordinaryURL.path), [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: indexlessEmpty.indexURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: indexlessEmpty.blobsURL.path))

        let emptyIndexBytes = try OrdinaryRecoveryCodec.encode(emptyOrdinaryIndex())
        for prefixCount in [0, emptyIndexBytes.count / 2, emptyIndexBytes.count] {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            try fixture.prepareOrdinary(includeBlobs: false)
            let tempURL = fixture.ordinaryURL.appendingPathComponent(
                ".AssetTracker.tmp.123e4567-e89b-12d3-a456-426614174000"
            )
            let prefix = Data(emptyIndexBytes.prefix(prefixCount))
            try writePrivateTestFile(prefix, to: tempURL)
            let inodeBefore = try inode(of: tempURL)

            XCTAssertEqual(
                try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                notApplicableOrdinaryHealth(),
                "validated prefix count \(prefixCount)"
            )
            XCTAssertEqual(try Data(contentsOf: tempURL), prefix)
            XCTAssertEqual(try inode(of: tempURL), inodeBefore)
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.indexURL.path))
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.blobsURL.path))
        }

        for includeBlobs in [false, true] {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            try fixture.prepareOrdinary(includeBlobs: includeBlobs)
            try fixture.writeIndex(emptyOrdinaryIndex())
            let indexBytesBefore = try Data(contentsOf: fixture.indexURL)

            XCTAssertEqual(
                try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                healthyOrdinaryHealth(),
                "valid empty index, includeBlobs=\(includeBlobs)"
            )
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBefore)
            XCTAssertEqual(FileManager.default.fileExists(atPath: fixture.blobsURL.path), includeBlobs)
        }

        let indexedTemp = try OrdinaryStoreFixture()
        defer { indexedTemp.remove() }
        try indexedTemp.prepareOrdinary(includeBlobs: true)
        try indexedTemp.writeIndex(emptyOrdinaryIndex())
        let indexedTempURL = indexedTemp.ordinaryURL.appendingPathComponent(
            ".AssetTracker.tmp.123e4567-e89b-12d3-a456-426614174004"
        )
        let indexedTempBytes = Data("generic-in-flight-index-rewrite".utf8)
        try writePrivateTestFile(indexedTempBytes, to: indexedTempURL)
        let indexedTempInode = try inode(of: indexedTempURL)
        let indexedBytesBefore = try Data(contentsOf: indexedTemp.indexURL)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: indexedTemp.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
        XCTAssertEqual(try Data(contentsOf: indexedTempURL), indexedTempBytes)
        XCTAssertEqual(try inode(of: indexedTempURL), indexedTempInode)
        XCTAssertEqual(try Data(contentsOf: indexedTemp.indexURL), indexedBytesBefore)

        let primaryBytesForBlobTemp = Data("verified-current-primary-for-blob-temp".utf8)
        let primaryHashForBlobTemp = sha256(primaryBytesForBlobTemp)
        for prefixCount in [0, primaryBytesForBlobTemp.count / 2, primaryBytesForBlobTemp.count] {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
            _ = try store.saveOrdinary(
                candidateBytes: primaryBytesForBlobTemp,
                candidateHash: primaryHashForBlobTemp,
                expectedSource: .missing,
                operationID: "blob-temp-seed-\(prefixCount)"
            )
            let tempURL = fixture.blobsURL.appendingPathComponent(
                ".AssetTracker.tmp.123e4567-e89b-12d3-a456-426614174003"
            )
            let prefix = Data(primaryBytesForBlobTemp.prefix(prefixCount))
            try writePrivateTestFile(prefix, to: tempURL)
            let inodeBefore = try inode(of: tempURL)
            let indexBytesBefore = try Data(contentsOf: fixture.indexURL)

            XCTAssertEqual(try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(), healthyOrdinaryHealth())
            XCTAssertEqual(try Data(contentsOf: tempURL), prefix)
            XCTAssertEqual(try inode(of: tempURL), inodeBefore)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBefore)
        }

        let indexlessBlobs = try OrdinaryStoreFixture()
        defer { indexlessBlobs.remove() }
        try indexlessBlobs.prepareOrdinary(includeBlobs: true)
        XCTAssertThrowsError(
            try AssetTrackerRecoveryStore(rootURL: indexlessBlobs.rootURL).auditOrdinary()
        )
        XCTAssertTrue(FileManager.default.fileExists(atPath: indexlessBlobs.blobsURL.path))

        let indexlessBlob = try OrdinaryStoreFixture()
        defer { indexlessBlob.remove() }
        try indexlessBlob.prepareOrdinary(includeBlobs: true)
        let strandedBytes = Data("stranded-indexless-blob".utf8)
        let strandedHash = sha256(strandedBytes)
        try indexlessBlob.writeBlob(strandedBytes)
        XCTAssertThrowsError(
            try AssetTrackerRecoveryStore(rootURL: indexlessBlob.rootURL).auditOrdinary()
        )
        XCTAssertEqual(try Data(contentsOf: indexlessBlob.blobURL(strandedHash)), strandedBytes)

        let unknown = try OrdinaryStoreFixture()
        defer { unknown.remove() }
        try unknown.prepareOrdinary(includeBlobs: false)
        let unknownURL = unknown.ordinaryURL.appendingPathComponent("unknown")
        try writePrivateTestFile(Data("preserve-me".utf8), to: unknownURL)
        XCTAssertThrowsError(try AssetTrackerRecoveryStore(rootURL: unknown.rootURL).auditOrdinary())
        XCTAssertEqual(try Data(contentsOf: unknownURL), Data("preserve-me".utf8))

        let illegalTemp = try OrdinaryStoreFixture()
        defer { illegalTemp.remove() }
        try illegalTemp.prepareOrdinary(includeBlobs: false)
        let illegalTempURL = illegalTemp.ordinaryURL.appendingPathComponent(
            ".AssetTracker.tmp.123e4567-e89b-12d3-a456-426614174001"
        )
        let illegalTempBytes = Data("not-an-empty-index-prefix".utf8)
        try writePrivateTestFile(illegalTempBytes, to: illegalTempURL)
        XCTAssertThrowsError(
            try AssetTrackerRecoveryStore(rootURL: illegalTemp.rootURL).auditOrdinary()
        )
        XCTAssertEqual(try Data(contentsOf: illegalTempURL), illegalTempBytes)

        let symlink = try OrdinaryStoreFixture()
        defer { symlink.remove() }
        try symlink.prepareOrdinary(includeBlobs: false)
        let symlinkTarget = symlink.parentURL.appendingPathComponent("outside")
        let symlinkURL = symlink.ordinaryURL.appendingPathComponent("unknown-link")
        try writePrivateTestFile(Data("outside".utf8), to: symlinkTarget)
        try FileManager.default.createSymbolicLink(at: symlinkURL, withDestinationURL: symlinkTarget)
        XCTAssertThrowsError(try AssetTrackerRecoveryStore(rootURL: symlink.rootURL).auditOrdinary())
        XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: symlinkURL.path), symlinkTarget.path)

        let dangling = try OrdinaryStoreFixture()
        defer { dangling.remove() }
        let h0Bytes = Data("dangling-H0".utf8)
        let h1Bytes = Data("dangling-H1".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let danglingStore = AssetTrackerRecoveryStore(rootURL: dangling.rootURL)
        _ = try danglingStore.saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "dangling-H0"
        )
        _ = try danglingStore.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "dangling-H1"
        )
        let danglingIndexBytes = try Data(contentsOf: dangling.indexURL)
        try FileManager.default.removeItem(at: dangling.blobsURL)
        XCTAssertThrowsError(try AssetTrackerRecoveryStore(rootURL: dangling.rootURL).auditOrdinary())
        XCTAssertEqual(try Data(contentsOf: dangling.indexURL), danglingIndexBytes)
    }

    func testManagedOrdinaryOrphanMakesLoadDegradedWithoutMutatingIndex() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
        let h0Bytes = Data("orphan-H0".utf8)
        let h1Bytes = Data("orphan-H1".utf8)
        let orphanBytes = Data("managed-orphan".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let orphanHash = sha256(orphanBytes)
        _ = try store.saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "orphan-H0"
        )
        _ = try store.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "orphan-H1"
        )
        try fixture.writeBlob(orphanBytes)
        let indexBytesBefore = try Data(contentsOf: fixture.indexURL)

        let health = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary()

        XCTAssertEqual(health.domain, .ordinary)
        XCTAssertEqual(health.status, .degraded)
        XCTAssertTrue(health.auditComplete)
        XCTAssertEqual(health.code, "managed-orphan")
        XCTAssertEqual(health.maintenancePendingCount, 0)
        XCTAssertFalse(try XCTUnwrap(health.detail).isEmpty)
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBefore)
        XCTAssertEqual(try Data(contentsOf: fixture.blobURL(orphanHash)), orphanBytes)
        XCTAssertEqual(try fixture.readIndex().committed.slots, [h0])
        XCTAssertFalse(try fixture.readIndex().committed.slots.contains(orphanHash))

        for corruption in OrdinaryBlobCorruption.allCases {
            let corruptFixture = try OrdinaryStoreFixture()
            defer { corruptFixture.remove() }
            try corruptFixture.prepareOrdinary(includeBlobs: true)
            try corruptFixture.writeIndex(emptyOrdinaryIndex())
            let preservedURL = try corruption.install(in: corruptFixture)

            XCTAssertThrowsError(
                try AssetTrackerRecoveryStore(rootURL: corruptFixture.rootURL).auditOrdinary(),
                corruption.rawValue
            )
            XCTAssertTrue(FileManager.default.fileExists(atPath: preservedURL.path), corruption.rawValue)
        }
    }

    func testSaveAndReconcileRejectFullOrdinaryBlobNamespaceCorruptionBeforeMutation() throws {
        let h0Bytes = Data("full-blob-audit-H0".utf8)
        let h1Bytes = Data("full-blob-audit-H1".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)

        for operation in ["save", "reconcile"] {
            for corruption in OrdinaryBlobCorruption.allCases {
                let fixture = try OrdinaryStoreFixture()
                defer { fixture.remove() }
                _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
                    candidateBytes: h0Bytes,
                    candidateHash: h0,
                    expectedSource: .missing,
                    operationID: "full-blob-audit-seed"
                )
                if operation == "reconcile" {
                    let interrupted = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                        if event.point == .afterPreparedOrdinaryIndexDurable {
                            throw OrdinaryInjectedFailure.stop
                        }
                    }
                    XCTAssertThrowsError(try interrupted.saveOrdinary(
                        candidateBytes: h1Bytes,
                        candidateHash: h1,
                        expectedSource: .sha256(h0),
                        operationID: "full-blob-audit-prepare"
                    ))
                    XCTAssertNotNil(try fixture.readIndex().prepared)
                }

                let corruptURL = try corruption.install(in: fixture)
                let primaryBytesBefore = try Data(contentsOf: fixture.primaryURL)
                let primaryIdentityBefore = try fileIdentity(of: fixture.primaryURL)
                let indexBytesBefore = try Data(contentsOf: fixture.indexURL)
                let indexIdentityBefore = try fileIdentity(of: fixture.indexURL)
                let corruptIdentityBefore = try fileIdentity(of: corruptURL)
                let ordinaryEntriesBefore = try FileManager.default.contentsOfDirectory(
                    atPath: fixture.ordinaryURL.path
                ).sorted()
                let blobEntriesBefore = try FileManager.default.contentsOfDirectory(
                    atPath: fixture.blobsURL.path
                ).sorted()
                let corruptBytesBefore: Data? = corruption == .unknownDirectory
                    ? nil
                    : try Data(contentsOf: corruptURL)
                let symlinkDestinationBefore = corruption == .symbolicLink
                    ? try FileManager.default.destinationOfSymbolicLink(atPath: corruptURL.path)
                    : nil
                let message = "\(operation)-\(corruption.rawValue)"

                if operation == "save" {
                    var result: NativeOrdinaryRecoverySaveResult?
                    XCTAssertThrowsError(result = try AssetTrackerRecoveryStore(
                        rootURL: fixture.rootURL
                    ).saveOrdinary(
                        candidateBytes: h1Bytes,
                        candidateHash: h1,
                        expectedSource: .sha256(h0),
                        operationID: "reject-corrupt-blob-namespace"
                    ), message)
                    XCTAssertNil(result, message)
                } else {
                    var health: NativeRecoveryHealth?
                    XCTAssertThrowsError(health = try AssetTrackerRecoveryStore(
                        rootURL: fixture.rootURL
                    ).reconcileOrdinary(), message)
                    XCTAssertNil(health, message)
                }

                XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytesBefore, message)
                XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore, message)
                XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBefore, message)
                XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore, message)
                XCTAssertEqual(try fileIdentity(of: corruptURL), corruptIdentityBefore, message)
                XCTAssertEqual(
                    try FileManager.default.contentsOfDirectory(atPath: fixture.ordinaryURL.path).sorted(),
                    ordinaryEntriesBefore,
                    message
                )
                XCTAssertEqual(
                    try FileManager.default.contentsOfDirectory(atPath: fixture.blobsURL.path).sorted(),
                    blobEntriesBefore,
                    message
                )
                if let corruptBytesBefore {
                    XCTAssertEqual(try Data(contentsOf: corruptURL), corruptBytesBefore, message)
                }
                if let symlinkDestinationBefore {
                    XCTAssertEqual(
                        try FileManager.default.destinationOfSymbolicLink(atPath: corruptURL.path),
                        symlinkDestinationBefore,
                        message
                    )
                }
            }
        }

        for operation in ["save", "reconcile"] {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
                candidateBytes: h0Bytes,
                candidateHash: h0,
                expectedSource: .missing,
                operationID: "managed-orphan-control-seed"
            )
            if operation == "reconcile" {
                let interrupted = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                    if event.point == .afterPreparedOrdinaryIndexDurable {
                        throw OrdinaryInjectedFailure.stop
                    }
                }
                XCTAssertThrowsError(try interrupted.saveOrdinary(
                    candidateBytes: h1Bytes,
                    candidateHash: h1,
                    expectedSource: .sha256(h0),
                    operationID: "managed-orphan-control-prepare"
                ))
            }
            let orphanBytes = Data("valid-managed-orphan-\(operation)".utf8)
            let orphanHash = sha256(orphanBytes)
            try fixture.writeBlob(orphanBytes)

            if operation == "save" {
                _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
                    candidateBytes: h1Bytes,
                    candidateHash: h1,
                    expectedSource: .sha256(h0),
                    operationID: "managed-orphan-control-save"
                )
            } else {
                _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).reconcileOrdinary()
            }

            XCTAssertFalse(
                FileManager.default.fileExists(atPath: fixture.blobURL(orphanHash).path),
                operation
            )
            let convergedIndex = try fixture.readIndex()
            XCTAssertFalse(convergedIndex.committed.slots.contains(orphanHash), operation)
            XCTAssertEqual(convergedIndex.committed.maintenance.pendingCleanupHashes, [], operation)
            XCTAssertNil(convergedIndex.committed.maintenance.lastHealthCode, operation)
            XCTAssertEqual(
                try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                healthyOrdinaryHealth(),
                operation
            )
        }
    }

    func testMutationEntryPointsConvergeValidatedOrdinaryBlobCrashTempBeforeStateChange() throws {
        let h0Bytes = Data("blob-temp-convergence-H0".utf8)
        let h1Bytes = Data("blob-temp-convergence-H1".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let tempLeaf = ".AssetTracker.tmp.123e4567-e89b-12d3-a456-426614174088"

        let changed = try OrdinaryStoreFixture()
        defer { changed.remove() }
        _ = try AssetTrackerRecoveryStore(rootURL: changed.rootURL).saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "blob-temp-changed-seed"
        )
        let changedTemp = changed.blobsURL.appendingPathComponent(tempLeaf)
        try writePrivateTestFile(h0Bytes, to: changedTemp)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: changed.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
        let changedOrdering = LockedOrdinaryFaultEvents()
        let changedStore = AssetTrackerRecoveryStore(rootURL: changed.rootURL) { event in
            if event.point == .afterSourceRevalidation,
               event.role == .primary,
               event.targetName == "AssetTrackerBook.json",
               !FileManager.default.fileExists(atPath: changedTemp.path) {
                changedOrdering.append(event)
            }
        }

        let changedResult = try changedStore.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "blob-temp-changed-save"
        )

        XCTAssertEqual(changedResult.recoveryHealth, healthyOrdinaryHealth())
        XCTAssertEqual(changedOrdering.count(point: .afterSourceRevalidation), 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: changedTemp.path))
        XCTAssertEqual(
            try? AssetTrackerRecoveryStore(rootURL: changed.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )

        let noOp = try OrdinaryStoreFixture()
        defer { noOp.remove() }
        _ = try AssetTrackerRecoveryStore(rootURL: noOp.rootURL).saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "blob-temp-no-op-seed"
        )
        let noOpTemp = noOp.blobsURL.appendingPathComponent(tempLeaf)
        try writePrivateTestFile(h0Bytes, to: noOpTemp)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: noOp.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
        let noOpOrdering = LockedOrdinaryFaultEvents()
        let noOpStore = AssetTrackerRecoveryStore(rootURL: noOp.rootURL) { event in
            if event.point == .afterSourceRevalidation,
               event.role == .primary,
               event.targetName == "AssetTrackerBook.json",
               !FileManager.default.fileExists(atPath: noOpTemp.path) {
                noOpOrdering.append(event)
            }
        }

        let noOpResult = try noOpStore.saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .sha256(h0),
            operationID: "blob-temp-no-op-save"
        )

        XCTAssertEqual(noOpResult.recoveryHealth, healthyOrdinaryHealth())
        XCTAssertEqual(noOpOrdering.count(point: .afterSourceRevalidation), 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: noOpTemp.path))
        XCTAssertEqual(
            try? AssetTrackerRecoveryStore(rootURL: noOp.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )

        let reconciled = try OrdinaryStoreFixture()
        defer { reconciled.remove() }
        _ = try AssetTrackerRecoveryStore(rootURL: reconciled.rootURL).saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "blob-temp-reconcile-seed"
        )
        let interrupted = AssetTrackerRecoveryStore(rootURL: reconciled.rootURL) { event in
            if event.point == .afterPrimaryDurableBeforeACK {
                throw OrdinaryInjectedFailure.stop
            }
        }
        XCTAssertThrowsError(try interrupted.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "blob-temp-reconcile-prepare"
        ))
        XCTAssertNotNil(try reconciled.readIndex().prepared)
        let reconcileTemp = reconciled.blobsURL.appendingPathComponent(tempLeaf)
        try writePrivateTestFile(h1Bytes, to: reconcileTemp)
        XCTAssertEqual(
            try AssetTrackerRecoveryStore(rootURL: reconciled.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )
        let reconcileOrdering = LockedOrdinaryFaultEvents()
        let reconcileStore = AssetTrackerRecoveryStore(rootURL: reconciled.rootURL) { event in
            if event.point == .afterCommittedOrdinaryIndexDurable,
               !FileManager.default.fileExists(atPath: reconcileTemp.path) {
                reconcileOrdering.append(event)
            }
        }

        let reconciledHealth = try reconcileStore.reconcileOrdinary()

        XCTAssertEqual(reconciledHealth, healthyOrdinaryHealth())
        XCTAssertEqual(reconcileOrdering.count(point: .afterCommittedOrdinaryIndexDurable), 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: reconcileTemp.path))
        XCTAssertEqual(
            try? AssetTrackerRecoveryStore(rootURL: reconciled.rootURL).auditOrdinary(),
            healthyOrdinaryHealth()
        )

        let corrupt = try OrdinaryStoreFixture()
        defer { corrupt.remove() }
        _ = try AssetTrackerRecoveryStore(rootURL: corrupt.rootURL).saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "blob-temp-corrupt-seed"
        )
        let corruptTemp = corrupt.blobsURL.appendingPathComponent(tempLeaf)
        try writePrivateTestFile(h0Bytes, to: corruptTemp)
        let unknownURL = corrupt.blobsURL.appendingPathComponent("unknown-entry")
        let unknownBytes = Data("preserve-corrupt-neighbor".utf8)
        try writePrivateTestFile(unknownBytes, to: unknownURL)
        let tempIdentityBefore = try fileIdentity(of: corruptTemp)
        let unknownIdentityBefore = try fileIdentity(of: unknownURL)
        let primaryBytesBefore = try Data(contentsOf: corrupt.primaryURL)
        let indexBytesBefore = try Data(contentsOf: corrupt.indexURL)
        let entriesBefore = try FileManager.default.contentsOfDirectory(
            atPath: corrupt.blobsURL.path
        ).sorted()

        XCTAssertThrowsError(try AssetTrackerRecoveryStore(rootURL: corrupt.rootURL).saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "blob-temp-corrupt-reject"
        ))

        XCTAssertEqual(try Data(contentsOf: corrupt.primaryURL), primaryBytesBefore)
        XCTAssertEqual(try Data(contentsOf: corrupt.indexURL), indexBytesBefore)
        XCTAssertEqual(try? Data(contentsOf: corruptTemp), h0Bytes)
        XCTAssertEqual(try? fileIdentity(of: corruptTemp), tempIdentityBefore)
        XCTAssertEqual(try Data(contentsOf: unknownURL), unknownBytes)
        XCTAssertEqual(try fileIdentity(of: unknownURL), unknownIdentityBefore)
        XCTAssertEqual(
            try FileManager.default.contentsOfDirectory(atPath: corrupt.blobsURL.path).sorted(),
            entriesBefore
        )
    }

    func testOrdinaryAuditValidatesPreparedOldAndNewPrimaryWithoutMutatingIndex() throws {
        let h0Bytes = Data("audit-prepared-H0".utf8)
        let h1Bytes = Data("audit-prepared-H1".utf8)
        let h2Bytes = Data("audit-prepared-neither".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)

        for stopPoint in [
            NativeDurabilityFaultPoint.afterPreparedOrdinaryIndexDurable,
            .afterPrimaryDurableBeforeACK,
        ] {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
                candidateBytes: h0Bytes,
                candidateHash: h0,
                expectedSource: .missing,
                operationID: "audit-prepared-seed"
            )
            let interrupted = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                if event.point == stopPoint {
                    throw OrdinaryInjectedFailure.stop
                }
            }
            XCTAssertThrowsError(try interrupted.saveOrdinary(
                candidateBytes: h1Bytes,
                candidateHash: h1,
                expectedSource: .sha256(h0),
                operationID: "audit-prepared-transition"
            ))
            let bytesBefore = try Data(contentsOf: fixture.indexURL)
            let inodeBefore = try inode(of: fixture.indexURL)
            XCTAssertNotNil(try fixture.readIndex().prepared)

            XCTAssertEqual(
                try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary(),
                healthyOrdinaryHealth(),
                "stopPoint=\(stopPoint)"
            )
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), bytesBefore)
            XCTAssertEqual(try inode(of: fixture.indexURL), inodeBefore)
            XCTAssertNotNil(try fixture.readIndex().prepared)
        }

        let preparedMismatch = try OrdinaryStoreFixture()
        defer { preparedMismatch.remove() }
        _ = try AssetTrackerRecoveryStore(rootURL: preparedMismatch.rootURL).saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "prepared-mismatch-seed"
        )
        let interrupted = AssetTrackerRecoveryStore(rootURL: preparedMismatch.rootURL) { event in
            if event.point == .afterPreparedOrdinaryIndexDurable {
                throw OrdinaryInjectedFailure.stop
            }
        }
        XCTAssertThrowsError(try interrupted.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "prepared-mismatch-transition"
        ))
        let preparedMismatchBytes = try Data(contentsOf: preparedMismatch.indexURL)
        let preparedMismatchInode = try inode(of: preparedMismatch.indexURL)
        try preparedMismatch.replacePrimary(h2Bytes, expectedHash: h0)
        XCTAssertThrowsError(
            try AssetTrackerRecoveryStore(rootURL: preparedMismatch.rootURL).auditOrdinary()
        )
        XCTAssertEqual(try Data(contentsOf: preparedMismatch.indexURL), preparedMismatchBytes)
        XCTAssertEqual(try inode(of: preparedMismatch.indexURL), preparedMismatchInode)

        let committedMismatch = try OrdinaryStoreFixture()
        defer { committedMismatch.remove() }
        _ = try AssetTrackerRecoveryStore(rootURL: committedMismatch.rootURL).saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "committed-mismatch-seed"
        )
        let committedMismatchBytes = try Data(contentsOf: committedMismatch.indexURL)
        let committedMismatchInode = try inode(of: committedMismatch.indexURL)
        try committedMismatch.replacePrimary(h2Bytes, expectedHash: h0)
        XCTAssertThrowsError(
            try AssetTrackerRecoveryStore(rootURL: committedMismatch.rootURL).auditOrdinary()
        )
        XCTAssertEqual(try Data(contentsOf: committedMismatch.indexURL), committedMismatchBytes)
        XCTAssertEqual(try inode(of: committedMismatch.indexURL), committedMismatchInode)
    }

    func testPersistedOrdinaryPendingHealthDominatesManagedOrphanRuntimeDetail() throws {
        let fixture = try OrdinaryStoreFixture()
        defer { fixture.remove() }
        let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
        let h0Bytes = Data("pending-H0".utf8)
        let h1Bytes = Data("pending-H1".utf8)
        let pendingBytes = Data("pending-cleanup".utf8)
        let orphanBytes = Data("orphan-beside-pending".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let pendingHash = sha256(pendingBytes)
        let orphanHash = sha256(orphanBytes)
        _ = try store.saveOrdinary(
            candidateBytes: h0Bytes,
            candidateHash: h0,
            expectedSource: .missing,
            operationID: "pending-H0"
        )
        _ = try store.saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "pending-H1"
        )
        try fixture.writeBlob(pendingBytes)
        try fixture.writeBlob(orphanBytes)
        var index = try fixture.readIndex()
        index.committed.maintenance = OrdinaryMaintenanceState(
            pendingCleanupHashes: [pendingHash],
            lastHealthCode: "cleanup-pending"
        )
        try fixture.writeIndex(index, role: .ordinaryHealthIndex)
        let indexBytesBefore = try Data(contentsOf: fixture.indexURL)

        let health = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).auditOrdinary()

        XCTAssertEqual(health.domain, .ordinary)
        XCTAssertEqual(health.status, .degraded)
        XCTAssertTrue(health.auditComplete)
        XCTAssertEqual(health.code, "cleanup-pending")
        XCTAssertEqual(health.maintenancePendingCount, 1)
        XCTAssertFalse(try XCTUnwrap(health.detail).isEmpty)
        XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBefore)
        XCTAssertEqual(try Data(contentsOf: fixture.blobURL(pendingHash)), pendingBytes)
        XCTAssertEqual(try Data(contentsOf: fixture.blobURL(orphanHash)), orphanBytes)

        let absentPending = try OrdinaryStoreFixture()
        defer { absentPending.remove() }
        let absentPendingPrimaryBytes = Data("absent-pending-primary".utf8)
        let absentPendingPrimaryHash = sha256(absentPendingPrimaryBytes)
        _ = try AssetTrackerRecoveryStore(rootURL: absentPending.rootURL).saveOrdinary(
            candidateBytes: absentPendingPrimaryBytes,
            candidateHash: absentPendingPrimaryHash,
            expectedSource: .missing,
            operationID: "absent-pending-seed"
        )
        let missingPendingHash = String(repeating: "a", count: 64)
        XCTAssertNotEqual(missingPendingHash, absentPendingPrimaryHash)
        var absentPendingIndex = try absentPending.readIndex()
        absentPendingIndex.committed.maintenance = OrdinaryMaintenanceState(
            pendingCleanupHashes: [missingPendingHash],
            lastHealthCode: "cleanup-pending"
        )
        try absentPending.writeIndex(absentPendingIndex, role: .ordinaryHealthIndex)
        let absentPendingBytesBefore = try Data(contentsOf: absentPending.indexURL)
        let absentHealth = try AssetTrackerRecoveryStore(rootURL: absentPending.rootURL).auditOrdinary()
        XCTAssertEqual(absentHealth.status, .degraded)
        XCTAssertEqual(absentHealth.code, "cleanup-pending")
        XCTAssertEqual(absentHealth.maintenancePendingCount, 1)
        XCTAssertEqual(try Data(contentsOf: absentPending.indexURL), absentPendingBytesBefore)
        XCTAssertFalse(FileManager.default.fileExists(atPath: absentPending.blobURL(missingPendingHash).path))
    }

    func testOrdinaryMutationCleansValidatedIndexTempsBeforeInitializationAndRejectsIndexlessObjects() throws {
        let emptyIndexBytes = try OrdinaryRecoveryCodec.encode(emptyOrdinaryIndex())
        for indexed in [false, true] {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            try fixture.prepareOrdinary(includeBlobs: indexed)
            if indexed {
                try fixture.writeIndex(emptyOrdinaryIndex())
            }
            let tempURL = fixture.ordinaryURL.appendingPathComponent(
                ".AssetTracker.tmp.123e4567-e89b-12d3-a456-426614174005"
            )
            let tempBytes = indexed
                ? Data("generic-index-transition".utf8)
                : Data(emptyIndexBytes.prefix(emptyIndexBytes.count / 2))
            try writePrivateTestFile(tempBytes, to: tempURL)
            let candidateBytes = Data("mutation-after-temp-\(indexed)".utf8)
            let candidateHash = sha256(candidateBytes)

            _ = try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
                candidateBytes: candidateBytes,
                candidateHash: candidateHash,
                expectedSource: .missing,
                operationID: "mutation-after-temp-\(indexed)"
            )

            XCTAssertFalse(FileManager.default.fileExists(atPath: tempURL.path))
            XCTAssertEqual(try fixture.readIndex().committed.primaryHash, candidateHash)
            XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.blobsURL.path))
        }

        for illegalName in ["unknown", "blobs"] {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            try fixture.prepareOrdinary(includeBlobs: illegalName == "blobs")
            let illegalURL = fixture.ordinaryURL.appendingPathComponent(
                illegalName,
                isDirectory: illegalName == "blobs"
            )
            if illegalName == "unknown" {
                try writePrivateTestFile(Data("preserve-illegal".utf8), to: illegalURL)
            }
            let candidateBytes = Data("must-not-write-primary-\(illegalName)".utf8)

            XCTAssertThrowsError(try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
                candidateBytes: candidateBytes,
                candidateHash: sha256(candidateBytes),
                expectedSource: .missing,
                operationID: "reject-indexless-\(illegalName)"
            ))
            XCTAssertTrue(FileManager.default.fileExists(atPath: illegalURL.path))
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.indexURL.path))
            XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.primaryURL.path))
        }
    }

    func testOrdinaryMutationRejectsInvalidIndexedMissingBlobsBeforeAnyMutation() throws {
        let h0Bytes = Data("missing-blobs-H0".utf8)
        let h1Bytes = Data("missing-blobs-H1".utf8)
        let h2Bytes = Data("missing-blobs-H2".utf8)
        let h0 = sha256(h0Bytes)
        let h1 = sha256(h1Bytes)
        let h2 = sha256(h2Bytes)
        let indexTempLeaf = ".AssetTracker.tmp.123e4567-e89b-12d3-a456-426614174099"
        let healthy = OrdinaryMaintenanceState(
            pendingCleanupHashes: [],
            lastHealthCode: nil
        )
        let cases: [(name: String, primaryBytes: Data, index: OrdinaryRecoveryIndex)] = [
            (
                "dangling-slot",
                h1Bytes,
                OrdinaryRecoveryIndex(
                    format: OrdinaryRecoveryIndex.expectedFormat,
                    version: OrdinaryRecoveryIndex.expectedVersion,
                    committed: OrdinaryCommittedState(
                        primaryHash: h1,
                        slots: [h0],
                        maintenance: healthy
                    ),
                    prepared: nil
                )
            ),
            (
                "committed-primary-mismatch",
                h1Bytes,
                OrdinaryRecoveryIndex(
                    format: OrdinaryRecoveryIndex.expectedFormat,
                    version: OrdinaryRecoveryIndex.expectedVersion,
                    committed: OrdinaryCommittedState(
                        primaryHash: h0,
                        slots: [],
                        maintenance: healthy
                    ),
                    prepared: nil
                )
            ),
            (
                "pending-cleanup",
                h1Bytes,
                OrdinaryRecoveryIndex(
                    format: OrdinaryRecoveryIndex.expectedFormat,
                    version: OrdinaryRecoveryIndex.expectedVersion,
                    committed: OrdinaryCommittedState(
                        primaryHash: h1,
                        slots: [],
                        maintenance: OrdinaryMaintenanceState(
                            pendingCleanupHashes: [h2],
                            lastHealthCode: "cleanup-pending"
                        )
                    ),
                    prepared: nil
                )
            ),
            (
                "prepared-primary-old",
                h0Bytes,
                OrdinaryRecoveryIndex(
                    format: OrdinaryRecoveryIndex.expectedFormat,
                    version: OrdinaryRecoveryIndex.expectedVersion,
                    committed: OrdinaryCommittedState(
                        primaryHash: h0,
                        slots: [],
                        maintenance: healthy
                    ),
                    prepared: OrdinaryPreparedState(
                        operationId: "prepared-old",
                        sourceHash: h0,
                        candidateHash: h1,
                        committedSlots: [],
                        nextSlots: [h0]
                    )
                )
            ),
            (
                "prepared-primary-new",
                h1Bytes,
                OrdinaryRecoveryIndex(
                    format: OrdinaryRecoveryIndex.expectedFormat,
                    version: OrdinaryRecoveryIndex.expectedVersion,
                    committed: OrdinaryCommittedState(
                        primaryHash: h0,
                        slots: [],
                        maintenance: healthy
                    ),
                    prepared: OrdinaryPreparedState(
                        operationId: "prepared-new",
                        sourceHash: h0,
                        candidateHash: h1,
                        committedSlots: [],
                        nextSlots: [h0]
                    )
                )
            ),
            (
                "prepared-primary-neither",
                h2Bytes,
                OrdinaryRecoveryIndex(
                    format: OrdinaryRecoveryIndex.expectedFormat,
                    version: OrdinaryRecoveryIndex.expectedVersion,
                    committed: OrdinaryCommittedState(
                        primaryHash: h0,
                        slots: [],
                        maintenance: healthy
                    ),
                    prepared: OrdinaryPreparedState(
                        operationId: "prepared-neither",
                        sourceHash: h0,
                        candidateHash: h1,
                        committedSlots: [],
                        nextSlots: [h0]
                    )
                )
            ),
        ]

        for invalidCase in cases {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            try fixture.prepareOrdinary(includeBlobs: false)
            try fixture.writeInitialPrimary(invalidCase.primaryBytes)
            try fixture.writeIndex(invalidCase.index)
            let tempURL = fixture.ordinaryURL.appendingPathComponent(indexTempLeaf)
            let tempBytes = Data("validated-index-temp-\(invalidCase.name)".utf8)
            try writePrivateTestFile(tempBytes, to: tempURL)
            let tempIdentityBefore = try fileIdentity(of: tempURL)
            let primaryBytesBefore = try Data(contentsOf: fixture.primaryURL)
            let indexBytesBefore = try Data(contentsOf: fixture.indexURL)
            let ordinaryEntriesBefore = try FileManager.default.contentsOfDirectory(
                atPath: fixture.ordinaryURL.path
            )
            let events = LockedOrdinaryFaultEvents()
            let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL) { event in
                events.append(event)
            }
            let attemptedBytes = Data("attempt-\(invalidCase.name)".utf8)

            XCTAssertThrowsError(try store.saveOrdinary(
                candidateBytes: attemptedBytes,
                candidateHash: sha256(attemptedBytes),
                expectedSource: .sha256(sha256(invalidCase.primaryBytes)),
                operationID: "reject-\(invalidCase.name)"
            ), invalidCase.name)

            XCTAssertFalse(
                FileManager.default.fileExists(atPath: fixture.blobsURL.path),
                invalidCase.name
            )
            XCTAssertEqual(
                try Data(contentsOf: fixture.indexURL),
                indexBytesBefore,
                invalidCase.name
            )
            XCTAssertEqual(
                try Data(contentsOf: fixture.primaryURL),
                primaryBytesBefore,
                invalidCase.name
            )
            XCTAssertEqual(
                try FileManager.default.contentsOfDirectory(atPath: fixture.ordinaryURL.path),
                ordinaryEntriesBefore,
                invalidCase.name
            )
            XCTAssertEqual(try? Data(contentsOf: tempURL), tempBytes, invalidCase.name)
            XCTAssertEqual(try? fileIdentity(of: tempURL), tempIdentityBefore, invalidCase.name)
            let forbiddenPoints: Set<NativeDurabilityFaultPoint> = [
                .afterOrdinaryBlobsDirectoryDurable,
                .afterOrdinaryBlobDurable,
                .afterPreparedOrdinaryIndexDurable,
                .afterPrimaryDurableBeforeACK,
                .afterCommittedOrdinaryIndexDurable,
            ]
            XCTAssertTrue(
                events.snapshot().allSatisfy { !forbiddenPoints.contains($0.point) },
                invalidCase.name
            )
        }


        let allowed = try OrdinaryStoreFixture()
        defer { allowed.remove() }
        try allowed.prepareOrdinary(includeBlobs: false)
        try allowed.writeInitialPrimary(h0Bytes)
        try allowed.writeIndex(OrdinaryRecoveryIndex(
            format: OrdinaryRecoveryIndex.expectedFormat,
            version: OrdinaryRecoveryIndex.expectedVersion,
            committed: OrdinaryCommittedState(
                primaryHash: h0,
                slots: [],
                maintenance: healthy
            ),
            prepared: nil
        ))
        let allowedTempURL = allowed.ordinaryURL.appendingPathComponent(indexTempLeaf)
        try writePrivateTestFile(Data("safe-empty-index-temp".utf8), to: allowedTempURL)
        _ = try AssetTrackerRecoveryStore(rootURL: allowed.rootURL).saveOrdinary(
            candidateBytes: h1Bytes,
            candidateHash: h1,
            expectedSource: .sha256(h0),
            operationID: "allowed-empty-index-without-blobs"
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: allowedTempURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: allowed.blobsURL.path))
        XCTAssertEqual(try allowed.readIndex().committed.primaryHash, h1)

        let indexedWithBlobsCases: [(name: String, index: OrdinaryRecoveryIndex, unknownBlob: Bool)] = [
            (
                "indexed-blobs-primary-mismatch",
                OrdinaryRecoveryIndex(
                    format: OrdinaryRecoveryIndex.expectedFormat,
                    version: OrdinaryRecoveryIndex.expectedVersion,
                    committed: OrdinaryCommittedState(
                        primaryHash: h0,
                        slots: [],
                        maintenance: healthy
                    ),
                    prepared: nil
                ),
                false
            ),
            (
                "indexed-blobs-corrupt-namespace",
                OrdinaryRecoveryIndex(
                    format: OrdinaryRecoveryIndex.expectedFormat,
                    version: OrdinaryRecoveryIndex.expectedVersion,
                    committed: OrdinaryCommittedState(
                        primaryHash: h1,
                        slots: [],
                        maintenance: healthy
                    ),
                    prepared: nil
                ),
                true
            ),
        ]
        for invalidCase in indexedWithBlobsCases {
            let fixture = try OrdinaryStoreFixture()
            defer { fixture.remove() }
            try fixture.prepareOrdinary(includeBlobs: true)
            try fixture.writeInitialPrimary(h1Bytes)
            try fixture.writeIndex(invalidCase.index)
            if invalidCase.unknownBlob {
                try writePrivateTestFile(
                    Data("preserve-unknown-blob".utf8),
                    to: fixture.blobsURL.appendingPathComponent("unknown-entry")
                )
            }
            let tempURL = fixture.ordinaryURL.appendingPathComponent(indexTempLeaf)
            let tempBytes = Data("preserve-before-audit-\(invalidCase.name)".utf8)
            try writePrivateTestFile(tempBytes, to: tempURL)
            let tempIdentityBefore = try fileIdentity(of: tempURL)
            let primaryBytesBefore = try Data(contentsOf: fixture.primaryURL)
            let primaryIdentityBefore = try fileIdentity(of: fixture.primaryURL)
            let indexBytesBefore = try Data(contentsOf: fixture.indexURL)
            let indexIdentityBefore = try fileIdentity(of: fixture.indexURL)
            let ordinaryEntriesBefore = try FileManager.default.contentsOfDirectory(
                atPath: fixture.ordinaryURL.path
            ).sorted()
            let blobEntriesBefore = try FileManager.default.contentsOfDirectory(
                atPath: fixture.blobsURL.path
            ).sorted()

            XCTAssertThrowsError(try AssetTrackerRecoveryStore(rootURL: fixture.rootURL).saveOrdinary(
                candidateBytes: h2Bytes,
                candidateHash: h2,
                expectedSource: .sha256(h1),
                operationID: "reject-before-index-temp-cleanup-\(invalidCase.name)"
            ), invalidCase.name)

            XCTAssertEqual(try Data(contentsOf: fixture.primaryURL), primaryBytesBefore, invalidCase.name)
            XCTAssertEqual(try fileIdentity(of: fixture.primaryURL), primaryIdentityBefore, invalidCase.name)
            XCTAssertEqual(try Data(contentsOf: fixture.indexURL), indexBytesBefore, invalidCase.name)
            XCTAssertEqual(try fileIdentity(of: fixture.indexURL), indexIdentityBefore, invalidCase.name)
            XCTAssertEqual(
                try FileManager.default.contentsOfDirectory(atPath: fixture.ordinaryURL.path).sorted(),
                ordinaryEntriesBefore,
                invalidCase.name
            )
            XCTAssertEqual(
                try FileManager.default.contentsOfDirectory(atPath: fixture.blobsURL.path).sorted(),
                blobEntriesBefore,
                invalidCase.name
            )
            XCTAssertEqual(try? Data(contentsOf: tempURL), tempBytes, invalidCase.name)
            XCTAssertEqual(try? fileIdentity(of: tempURL), tempIdentityBefore, invalidCase.name)
        }
    }

    private func fixtureObject(prepared: Bool) throws -> [String: Any] {
        let h1 = String(repeating: "1", count: 64)
        let index = OrdinaryRecoveryIndex(
            format: "qiushan.asset-book.ordinary-recovery",
            version: 1,
            committed: OrdinaryCommittedState(
                primaryHash: nil,
                slots: [],
                maintenance: OrdinaryMaintenanceState(
                    pendingCleanupHashes: [],
                    lastHealthCode: nil
                )
            ),
            prepared: prepared ? OrdinaryPreparedState(
                operationId: "operation-1",
                sourceHash: nil,
                candidateHash: h1,
                committedSlots: [],
                nextSlots: []
            ) : nil
        )
        return try XCTUnwrap(
            JSONSerialization.jsonObject(with: OrdinaryRecoveryCodec.encode(index)) as? [String: Any]
        )
    }

    private func data(for object: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    private func rawEncode(_ index: OrdinaryRecoveryIndex) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(index)
    }

    private func replacingCommitted(
        _ index: OrdinaryRecoveryIndex,
        primaryHash: String? = nil,
        slots: [String]? = nil,
        maintenance: OrdinaryMaintenanceState? = nil
    ) -> OrdinaryRecoveryIndex {
        OrdinaryRecoveryIndex(
            format: index.format,
            version: index.version,
            committed: OrdinaryCommittedState(
                primaryHash: primaryHash ?? index.committed.primaryHash,
                slots: slots ?? index.committed.slots,
                maintenance: maintenance ?? index.committed.maintenance
            ),
            prepared: index.prepared
        )
    }

    private func replacingPrepared(
        _ index: OrdinaryRecoveryIndex,
        _ prepared: OrdinaryPreparedState,
        operationId: String? = nil,
        sourceHash: String? = nil,
        candidateHash: String? = nil,
        committedSlots: [String]? = nil,
        nextSlots: [String]? = nil
    ) -> OrdinaryRecoveryIndex {
        OrdinaryRecoveryIndex(
            format: index.format,
            version: index.version,
            committed: index.committed,
            prepared: OrdinaryPreparedState(
                operationId: operationId ?? prepared.operationId,
                sourceHash: sourceHash ?? prepared.sourceHash,
                candidateHash: candidateHash ?? prepared.candidateHash,
                committedSlots: committedSlots ?? prepared.committedSlots,
                nextSlots: nextSlots ?? prepared.nextSlots
            )
        )
    }

    private func assertDecodeRejects(
        _ object: [String: Any],
        _ message: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertThrowsError(
            try OrdinaryRecoveryCodec.decode(data(for: object)),
            message,
            file: file,
            line: line
        )
    }
}

private struct OrdinaryWriterCheckpointCase {
    let point: NativeDurabilityFaultPoint
    let replacementPublished: Bool
    let writerProofReturned: Bool

    init(
        point: NativeDurabilityFaultPoint,
        replacementPublished: Bool,
        writerProofReturned: Bool = false
    ) {
        self.point = point
        self.replacementPublished = replacementPublished
        self.writerProofReturned = writerProofReturned
    }
}

private func ordinaryWriterReplacementCheckpoints() -> [OrdinaryWriterCheckpointCase] {
    [
        .init(point: .afterTempCreate, replacementPublished: false),
        .init(point: .afterExactWrite, replacementPublished: false),
        .init(point: .afterFileFSync, replacementPublished: false),
        .init(point: .afterFullFSync, replacementPublished: false),
        .init(point: .beforeRename, replacementPublished: false),
        .init(point: .afterRename, replacementPublished: true),
        .init(point: .afterParentDirectoryFSync, replacementPublished: true),
        .init(point: .afterFinalReread, replacementPublished: true),
        .init(point: .afterHashVerified, replacementPublished: true),
    ]
}

private func ordinaryCommittedIndexFailureCheckpoints() -> [OrdinaryWriterCheckpointCase] {
    ordinaryWriterReplacementCheckpoints() + [
        .init(
            point: .afterCommittedOrdinaryIndexDurable,
            replacementPublished: true,
            writerProofReturned: true
        ),
    ]
}

private struct OrdinaryNoOpVerificationCheckpointCase {
    let point: NativeDurabilityFaultPoint
    let writerReceiptCompleted: Bool
}

private func ordinaryNoOpVerificationCheckpoints() -> [OrdinaryNoOpVerificationCheckpointCase] {
    [
        .init(point: .afterSourceRevalidation, writerReceiptCompleted: false),
        .init(point: .afterFileFSync, writerReceiptCompleted: false),
        .init(point: .afterFullFSync, writerReceiptCompleted: false),
        .init(point: .afterParentDirectoryFSync, writerReceiptCompleted: false),
        .init(point: .afterFinalReread, writerReceiptCompleted: false),
        .init(point: .afterHashVerified, writerReceiptCompleted: false),
        .init(point: .afterPrimaryDurableBeforeACK, writerReceiptCompleted: true),
    ]
}

private let ordinaryNoOpPrimaryTracePoints: [NativeDurabilityFaultPoint] = [
    .afterSourceRevalidation,
    .afterFileFSync,
    .afterFullFSync,
    .afterParentDirectoryFSync,
    .afterFinalReread,
    .afterHashVerified,
    .afterPrimaryDurableBeforeACK,
]

private func ordinaryNoOpPrimaryTrace(
    in events: [NativeDurabilityFaultEvent]
) -> [NativeDurabilityFaultPoint] {
    events.compactMap { event in
        guard event.role == .primary,
              event.targetName == "AssetTrackerBook.json",
              ordinaryNoOpPrimaryTracePoints.contains(event.point)
        else {
            return nil
        }
        return event.point
    }
}

private func assertOrdinaryNoOpPrimaryTrace(
    _ events: [NativeDurabilityFaultEvent],
    through selectedPoint: NativeDurabilityFaultPoint,
    file: StaticString = #filePath,
    line: UInt = #line
) {
    guard let selectedIndex = ordinaryNoOpPrimaryTracePoints.firstIndex(of: selectedPoint) else {
        XCTFail(
            "selected point is not part of the no-op primary verification trace",
            file: file,
            line: line
        )
        return
    }
    let expected = Array(ordinaryNoOpPrimaryTracePoints.prefix(selectedIndex + 1))
    XCTAssertEqual(
        ordinaryNoOpPrimaryTrace(in: events),
        expected,
        "the filtered no-op primary trace must be the exact prefix through the selected fault",
        file: file,
        line: line
    )
}

private enum OrdinaryNoOpBoundaryState: String, CaseIterable {
    case virgin
    case degraded
}

private struct SeededOrdinaryHistory {
    let h0Bytes: Data
    let h1Bytes: Data
    let h2Bytes: Data
    let h3Bytes: Data
    let h0: String
    let h1: String
    let h2: String
    let h3: String
}

private struct SeededSnapshotHistory {
    let bytes: [Data]
    let hashes: [String]
}

private func seedTwentyFourSnapshotPoints(
    in fixture: OrdinaryStoreFixture,
    label: String
) throws -> SeededSnapshotHistory {
    let bytes = (0 ..< 24).map { Data("\(label)-\($0)".utf8) }
    let hashes = bytes.map(sha256)
    var retained: [SnapshotPoint] = []
    for ordinal in 0 ..< 24 {
        retained.append(SnapshotPoint(
            hash: hashes[ordinal],
            ordinal: UInt64(ordinal),
            createdAt: Date(timeIntervalSince1970: 1_700_400_000 + Double(ordinal))
        ))
    }
    retained.sort { $0.ordinal == $1.ordinal ? $0.hash < $1.hash : $0.ordinal > $1.ordinal }
    try fixture.prepareSnapshots()
    try fixture.writeSnapshotBlobs(bytes)
    try fixture.writeSnapshotIndex(SnapshotRecoveryIndex(
        format: SnapshotRecoveryIndex.expectedFormat,
        version: SnapshotRecoveryIndex.expectedVersion,
        retained: retained,
        nextOrdinal: 24,
        pendingCleanupHashes: [],
        lastHealthCode: nil
    ))
    return SeededSnapshotHistory(bytes: bytes, hashes: hashes)
}

private func seedThreeDistinctOrdinaryGenerations(
    in fixture: OrdinaryStoreFixture,
    label: String
) throws -> SeededOrdinaryHistory {
    let h0Bytes = Data("\(label)-H0".utf8)
    let h1Bytes = Data("\(label)-H1".utf8)
    let h2Bytes = Data("\(label)-H2".utf8)
    let h3Bytes = Data("\(label)-H3".utf8)
    let h0 = sha256(h0Bytes)
    let h1 = sha256(h1Bytes)
    let h2 = sha256(h2Bytes)
    let h3 = sha256(h3Bytes)
    let store = AssetTrackerRecoveryStore(rootURL: fixture.rootURL)
    _ = try store.saveOrdinary(
        candidateBytes: h0Bytes,
        candidateHash: h0,
        expectedSource: .missing,
        operationID: "\(label)-seed-H0"
    )
    _ = try store.saveOrdinary(
        candidateBytes: h1Bytes,
        candidateHash: h1,
        expectedSource: .sha256(h0),
        operationID: "\(label)-seed-H1"
    )
    _ = try store.saveOrdinary(
        candidateBytes: h2Bytes,
        candidateHash: h2,
        expectedSource: .sha256(h1),
        operationID: "\(label)-seed-H2"
    )
    return SeededOrdinaryHistory(
        h0Bytes: h0Bytes,
        h1Bytes: h1Bytes,
        h2Bytes: h2Bytes,
        h3Bytes: h3Bytes,
        h0: h0,
        h1: h1,
        h2: h2,
        h3: h3
    )
}

private func assertSelectedOrdinaryFaultEventReachedBeforeThrow(
    _ events: [NativeDurabilityFaultEvent],
    point: NativeDurabilityFaultPoint,
    role: NativeDurabilityRole,
    targetName: String,
    file: StaticString = #filePath,
    line: UInt = #line
) {
    let exact = events.filter {
        $0.point == point && $0.role == role && $0.targetName == targetName
    }
    XCTAssertEqual(
        exact.count,
        1,
        "expected the selected event exactly once before throw: point=\(point.rawValue) role=\(role.rawValue) target=\(targetName)",
        file: file,
        line: line
    )
}

private func ordinaryWriterTempNames(in directoryURL: URL) throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: directoryURL.path)
        .filter { $0.hasPrefix(".AssetTracker.tmp.") }
        .sorted()
}

private func ordinaryBlobEntries(in fixture: OrdinaryStoreFixture) throws -> [String] {
    try FileManager.default.contentsOfDirectory(atPath: fixture.blobsURL.path).sorted()
}

private enum OrdinaryInjectedFailure: Error {
    case stop
}

private final class LockedOrdinaryFaultEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [NativeDurabilityFaultEvent] = []

    func append(_ event: NativeDurabilityFaultEvent) {
        lock.lock()
        events.append(event)
        lock.unlock()
    }

    func snapshot() -> [NativeDurabilityFaultEvent] {
        lock.lock()
        defer { lock.unlock() }
        return events
    }

    func count(point: NativeDurabilityFaultPoint) -> Int {
        snapshot().filter { $0.point == point }.count
    }
}

private final class LockedSnapshotIndexBytes: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Data] = []

    func append(_ value: Data) {
        lock.lock()
        values.append(value)
        lock.unlock()
    }

    func snapshot() -> [Data] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }
}

private struct OrdinaryCommittedIndexObservation: Sendable {
    let bytes: Data
    let identity: TestFileIdentity
}

private final class LockedOrdinaryCommittedIndexObservation: @unchecked Sendable {
    private let lock = NSLock()
    private var observation: OrdinaryCommittedIndexObservation?

    func record(bytes: Data, identity: TestFileIdentity) {
        lock.lock()
        observation = OrdinaryCommittedIndexObservation(bytes: bytes, identity: identity)
        lock.unlock()
    }

    func snapshot() -> OrdinaryCommittedIndexObservation? {
        lock.lock()
        defer { lock.unlock() }
        return observation
    }
}

private struct OrdinaryIndexBoundaryObservation: Sendable {
    let point: NativeDurabilityFaultPoint
    let role: NativeDurabilityRole
    let targetName: String
    let indexBytes: Data
    let presentBlobHashes: [String]
}

private final class LockedOrdinaryIndexBoundaryObservations: @unchecked Sendable {
    private let lock = NSLock()
    private var observations: [OrdinaryIndexBoundaryObservation] = []

    func append(
        event: NativeDurabilityFaultEvent,
        indexBytes: Data,
        presentBlobHashes: [String]
    ) {
        lock.lock()
        observations.append(OrdinaryIndexBoundaryObservation(
            point: event.point,
            role: event.role,
            targetName: event.targetName,
            indexBytes: indexBytes,
            presentBlobHashes: presentBlobHashes
        ))
        lock.unlock()
    }

    func snapshot() -> [OrdinaryIndexBoundaryObservation] {
        lock.lock()
        defer { lock.unlock() }
        return observations
    }

    func first(point: NativeDurabilityFaultPoint) -> OrdinaryIndexBoundaryObservation? {
        snapshot().first { $0.point == point }
    }
}

private func makeInjectedRecoveryStore(
    rootURL: URL,
    posix: any NativePOSIX,
    faultHandler: @escaping NativeDurabilityFaultHandler
) -> AssetTrackerRecoveryStore {
    let writer = NativeDurableFileWriter(
        rootURL: rootURL,
        posix: posix,
        faultHandler: faultHandler
    )
    return AssetTrackerRecoveryStore(
        writer: writer,
        faultHandler: faultHandler
    )
}

private final class StorePostUnlinkFailureNativePOSIX: NativePOSIX, @unchecked Sendable {
    private let base = DarwinNativePOSIX()
    private let lock = NSLock()
    private let injectFirstUnlinkFailure: Bool
    private let injectDirectorySyncFailureAfterSuccessfulUnlink: Bool
    private let postFailureAction: (@Sendable () throws -> Void)?
    private let trackedBlobsDirectoryIdentity: TestFileIdentity?
    private let trackedBlobsDirectorySyncFailureAttempts: Set<Int>
    private var shouldFailUnlink = true
    private var shouldFailCleanupDirectorySync = false
    private var unlinkCalls = 0
    private var cleanupDirectorySyncCalls = 0
    private var actionCalls = 0
    private var trackedBlobsDirectorySyncAttempts = 0
    private var trackedBlobsDirectorySyncSuccesses = 0
    private var trackedBlobsDirectoryOrderValues: [String] = []

    init(
        injectFirstUnlinkFailure: Bool = true,
        injectDirectorySyncFailureAfterSuccessfulUnlink: Bool = false,
        postFailureAction: (@Sendable () throws -> Void)? = nil,
        trackedBlobsDirectoryIdentity: TestFileIdentity? = nil,
        trackedBlobsDirectorySyncFailureAttempts: Set<Int> = []
    ) {
        self.injectFirstUnlinkFailure = injectFirstUnlinkFailure
        self.injectDirectorySyncFailureAfterSuccessfulUnlink =
            injectDirectorySyncFailureAfterSuccessfulUnlink
        self.postFailureAction = postFailureAction
        self.trackedBlobsDirectoryIdentity = trackedBlobsDirectoryIdentity
        self.trackedBlobsDirectorySyncFailureAttempts =
            trackedBlobsDirectorySyncFailureAttempts
    }

    func unlinkCallCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return unlinkCalls
    }

    func postFailureActionCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return actionCalls
    }

    func cleanupDirectorySyncCallCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return cleanupDirectorySyncCalls
    }

    func trackedBlobsDirectorySyncAttemptCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return trackedBlobsDirectorySyncAttempts
    }

    func trackedBlobsDirectorySyncSuccessCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return trackedBlobsDirectorySyncSuccesses
    }

    func trackedBlobsDirectoryOrder() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return trackedBlobsDirectoryOrderValues
    }

    func recordRecoveryHealthBoundary(_ point: NativeDurabilityFaultPoint) {
        let value: String
        switch point {
        case .beforeRecoveryHealthClear:
            value = "before-recovery-health-clear"
        case .afterRecoveryHealthClear:
            value = "after-recovery-health-clear"
        default:
            return
        }
        lock.lock()
        trackedBlobsDirectoryOrderValues.append(value)
        lock.unlock()
    }

    func effectiveUserID() -> uid_t {
        base.effectiveUserID()
    }

    func openAt(
        directoryFD: Int32,
        path: String,
        flags: Int32,
        mode: mode_t
    ) throws -> Int32 {
        try base.openAt(directoryFD: directoryFD, path: path, flags: flags, mode: mode)
    }

    func makeDirectoryAt(directoryFD: Int32, path: String, mode: mode_t) throws {
        try base.makeDirectoryAt(directoryFD: directoryFD, path: path, mode: mode)
    }

    func read(fileFD: Int32, bytes: UnsafeMutableRawBufferPointer) throws -> Int {
        try base.read(fileFD: fileFD, bytes: bytes)
    }

    func write(fileFD: Int32, bytes: UnsafeRawBufferPointer) throws -> Int {
        try base.write(fileFD: fileFD, bytes: bytes)
    }

    func flock(fileFD: Int32, operation: Int32) throws {
        try base.flock(fileFD: fileFD, operation: operation)
    }

    func fstat(fileFD: Int32) throws -> stat {
        try base.fstat(fileFD: fileFD)
    }

    func syncFile(fileFD: Int32) throws {
        try base.syncFile(fileFD: fileFD)
    }

    func fullSyncFile(fileFD: Int32) throws {
        try base.fullSyncFile(fileFD: fileFD)
    }

    func changeMode(fileFD: Int32, mode: mode_t) throws {
        try base.changeMode(fileFD: fileFD, mode: mode)
    }

    func renameAt(
        sourceDirectoryFD: Int32,
        source: String,
        destinationDirectoryFD: Int32,
        destination: String,
        exclusive: Bool
    ) throws {
        try base.renameAt(
            sourceDirectoryFD: sourceDirectoryFD,
            source: source,
            destinationDirectoryFD: destinationDirectoryFD,
            destination: destination,
            exclusive: exclusive
        )
    }

    func syncDirectory(directoryFD: Int32) throws {
        let isTrackedBlobsDirectory: Bool
        if let trackedBlobsDirectoryIdentity {
            let value = try base.fstat(fileFD: directoryFD)
            isTrackedBlobsDirectory = TestFileIdentity(
                device: UInt64(value.st_dev),
                inode: UInt64(value.st_ino)
            ) == trackedBlobsDirectoryIdentity
        } else {
            isTrackedBlobsDirectory = false
        }

        let shouldFail: Bool
        let shouldFailTrackedBlobsDirectory: Bool
        lock.lock()
        shouldFail = shouldFailCleanupDirectorySync
        if shouldFailCleanupDirectorySync {
            shouldFailCleanupDirectorySync = false
            cleanupDirectorySyncCalls += 1
        }
        if isTrackedBlobsDirectory {
            trackedBlobsDirectorySyncAttempts += 1
            trackedBlobsDirectoryOrderValues.append("blobs-sync-attempt")
        }
        shouldFailTrackedBlobsDirectory = isTrackedBlobsDirectory
            && trackedBlobsDirectorySyncFailureAttempts.contains(
                trackedBlobsDirectorySyncAttempts
            )
        if shouldFailTrackedBlobsDirectory {
            trackedBlobsDirectoryOrderValues.append("blobs-sync-failure")
        }
        lock.unlock()
        if shouldFail || shouldFailTrackedBlobsDirectory {
            throw POSIXError(.EIO)
        }
        try base.syncDirectory(directoryFD: directoryFD)
        if isTrackedBlobsDirectory {
            lock.lock()
            trackedBlobsDirectorySyncSuccesses += 1
            trackedBlobsDirectoryOrderValues.append("blobs-sync-success")
            lock.unlock()
        }
    }

    func fstatAt(directoryFD: Int32, path: String, noFollow: Bool) throws -> stat {
        try base.fstatAt(directoryFD: directoryFD, path: path, noFollow: noFollow)
    }

    func directoryEntries(directoryFD: Int32) throws -> [NativeDirectoryEntry] {
        try base.directoryEntries(directoryFD: directoryFD)
    }

    func extendedACLEntryCount(fileFD: Int32) throws -> Int {
        try base.extendedACLEntryCount(fileFD: fileFD)
    }

    func hasDangerousLegacyACL(fileFD: Int32, ownerUserID: uid_t) throws -> Bool {
        try base.hasDangerousLegacyACL(fileFD: fileFD, ownerUserID: ownerUserID)
    }

    func clearExtendedACL(fileFD: Int32) throws {
        try base.clearExtendedACL(fileFD: fileFD)
    }

    func unlinkAt(directoryFD: Int32, path: String) throws {
        let shouldFail: Bool
        let action: (@Sendable () throws -> Void)?
        lock.lock()
        unlinkCalls += 1
        shouldFail = injectFirstUnlinkFailure && shouldFailUnlink
        if shouldFail { shouldFailUnlink = false }
        action = shouldFail ? postFailureAction : nil
        if action != nil { actionCalls += 1 }
        lock.unlock()

        if shouldFail {
            try action?()
            throw POSIXError(.EPERM)
        }
        try base.unlinkAt(directoryFD: directoryFD, path: path)
        if injectDirectorySyncFailureAfterSuccessfulUnlink {
            lock.lock()
            shouldFailCleanupDirectorySync = true
            lock.unlock()
        }
    }

    func close(fileFD: Int32) {
        base.close(fileFD: fileFD)
    }
}

private struct OrdinaryStoreFixture {
    let parentURL: URL
    let rootURL: URL

    init() throws {
        parentURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("AssetTrackerRecoveryStoreTests-\(UUID().uuidString)", isDirectory: true)
        rootURL = parentURL.appendingPathComponent("Storage", isDirectory: true)
        try FileManager.default.createDirectory(at: parentURL, withIntermediateDirectories: false)
    }

    var primaryURL: URL { rootURL.appendingPathComponent("AssetTrackerBook.json") }
    var ordinaryURL: URL { rootURL.appendingPathComponent("Recovery/ordinary", isDirectory: true) }
    var blobsURL: URL { ordinaryURL.appendingPathComponent("blobs", isDirectory: true) }
    var indexURL: URL { ordinaryURL.appendingPathComponent("slots.json") }
    var snapshotsURL: URL { rootURL.appendingPathComponent("Recovery/snapshots", isDirectory: true) }
    var snapshotIndexURL: URL { snapshotsURL.appendingPathComponent("index.json") }

    func blobURL(_ hash: String) -> URL {
        blobsURL.appendingPathComponent("\(hash).json")
    }

    func snapshotBlobURL(_ hash: String) -> URL {
        snapshotsURL.appendingPathComponent("\(hash).json")
    }

    func readIndex() throws -> OrdinaryRecoveryIndex {
        try OrdinaryRecoveryCodec.decode(Data(contentsOf: indexURL))
    }

    func readSnapshotIndex() throws -> SnapshotRecoveryIndex {
        try SnapshotRecoveryCodec.decode(Data(contentsOf: snapshotIndexURL))
    }

    func prepareSnapshots() throws {
        let writer = NativeDurableFileWriter(rootURL: rootURL)
        try writer.withExclusiveMutationLock { locked in
            try locked.createManagedDirectory(
                relativePath: "Recovery",
                role: .snapshotDirectory
            )
            try locked.createManagedDirectory(
                relativePath: "Recovery/snapshots",
                role: .snapshotDirectory
            )
        }
    }

    func writeSnapshotIndex(
        _ index: SnapshotRecoveryIndex,
        role: NativeDurabilityRole = .snapshotEmptyIndex
    ) throws {
        let bytes = try SnapshotRecoveryCodec.encode(index)
        let writer = NativeDurableFileWriter(rootURL: rootURL)
        try writer.withExclusiveMutationLock { locked in
            _ = try locked.durableWrite(
                bytes,
                relativePath: "Recovery/snapshots/index.json",
                disposition: .replace,
                role: role
            )
        }
    }

    func writeSnapshotBlob(_ bytes: Data) throws {
        let hash = sha256(bytes)
        let writer = NativeDurableFileWriter(rootURL: rootURL)
        try writer.withExclusiveMutationLock { locked in
            _ = try locked.durableWrite(
                bytes,
                relativePath: "Recovery/snapshots/\(hash).json",
                disposition: .createOnly,
                role: .snapshotBlob
            )
        }
    }

    func writeSnapshotBlobs(_ values: [Data]) throws {
        let writer = NativeDurableFileWriter(rootURL: rootURL)
        try writer.withExclusiveMutationLock { locked in
            for bytes in values {
                let hash = sha256(bytes)
                _ = try locked.durableWrite(
                    bytes,
                    relativePath: "Recovery/snapshots/\(hash).json",
                    disposition: .createOnly,
                    role: .snapshotBlob
                )
            }
        }
    }

    func prepareRecoveryOnly() throws {
        let writer = NativeDurableFileWriter(rootURL: rootURL)
        try writer.withExclusiveMutationLock { locked in
            try locked.createManagedDirectory(
                relativePath: "Recovery",
                role: .ordinaryDirectory
            )
        }
    }

    func prepareOrdinaryWithoutWriter() throws {
        try createPrivateTestDirectory(rootURL)
        try createPrivateTestDirectory(rootURL.appendingPathComponent("Recovery", isDirectory: true))
        try createPrivateTestDirectory(ordinaryURL)
    }

    func prepareOrdinary(includeBlobs: Bool) throws {
        let writer = NativeDurableFileWriter(rootURL: rootURL)
        try writer.withExclusiveMutationLock { locked in
            try locked.createManagedDirectory(
                relativePath: "Recovery",
                role: .ordinaryDirectory
            )
            try locked.createManagedDirectory(
                relativePath: "Recovery/ordinary",
                role: .ordinaryDirectory
            )
            if includeBlobs {
                try locked.createManagedDirectory(
                    relativePath: "Recovery/ordinary/blobs",
                    role: .ordinaryDirectory
                )
            }
        }
    }

    func writeIndex(
        _ index: OrdinaryRecoveryIndex,
        role: NativeDurabilityRole = .ordinaryEmptyIndex
    ) throws {
        let bytes = try OrdinaryRecoveryCodec.encode(index)
        let writer = NativeDurableFileWriter(rootURL: rootURL)
        try writer.withExclusiveMutationLock { locked in
            if role == .ordinaryHealthIndex {
                let primaryBytes = try locked.readValidated(
                    relativePath: "AssetTrackerBook.json"
                )
                let sourceProof = try locked.verifyPrimarySource(
                    expectedSource: primaryBytes.map {
                        .sha256(sha256($0))
                    } ?? .missing
                )
                let expectedProof = try XCTUnwrap(locked.readManagedFileProof(
                    relativePath: "Recovery/ordinary/slots.json",
                    role: .ordinaryHealthIndex
                ))
                _ = try locked.durableCompareAndSwapManaged(
                    bytes,
                    replacing: expectedProof,
                    sourceProof: sourceProof,
                    role: .ordinaryHealthIndex
                )
            } else {
                _ = try locked.durableWrite(
                    bytes,
                    relativePath: "Recovery/ordinary/slots.json",
                    disposition: .replace,
                    role: role
                )
            }
        }
    }

    func writeBlob(_ bytes: Data) throws {
        let hash = sha256(bytes)
        let writer = NativeDurableFileWriter(rootURL: rootURL)
        try writer.withExclusiveMutationLock { locked in
            _ = try locked.durableWrite(
                bytes,
                relativePath: "Recovery/ordinary/blobs/\(hash).json",
                disposition: .createOnly,
                role: .ordinaryBlob
            )
        }
    }

    func writeInitialPrimary(_ bytes: Data) throws {
        let writer = NativeDurableFileWriter(rootURL: rootURL)
        try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .missing)
            _ = try locked.durableReplacePrimary(bytes, sourceProof: proof)
        }
    }

    func replacePrimary(_ bytes: Data, expectedHash: String) throws {
        let writer = NativeDurableFileWriter(rootURL: rootURL)
        try writer.withExclusiveMutationLock { locked in
            let proof = try locked.verifyPrimarySource(expectedSource: .sha256(expectedHash))
            _ = try locked.durableReplacePrimary(bytes, sourceProof: proof)
        }
    }

    func remove() {
        try? FileManager.default.removeItem(at: parentURL)
    }
}

private func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
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

private func cleanupPendingSnapshotHealth(count: Int) -> NativeRecoveryHealth {
    NativeRecoveryHealth(
        domain: .snapshot,
        status: .degraded,
        auditComplete: true,
        code: "cleanup-pending",
        maintenancePendingCount: count,
        detail: nil
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

private func emptySnapshotIndex() -> SnapshotRecoveryIndex {
    SnapshotRecoveryIndex(
        format: SnapshotRecoveryIndex.expectedFormat,
        version: SnapshotRecoveryIndex.expectedVersion,
        retained: [],
        nextOrdinal: 0,
        pendingCleanupHashes: [],
        lastHealthCode: nil
    )
}

private func managedOrphanSnapshotHealth(_ hashes: [String]) -> NativeRecoveryHealth {
    NativeRecoveryHealth(
        domain: .snapshot,
        status: .degraded,
        auditComplete: true,
        code: "managed-orphan",
        maintenancePendingCount: 0,
        detail: "managed orphans: \(hashes.sorted().joined(separator: ","))"
    )
}

private func cleanupPendingOrdinaryHealth(count: Int) -> NativeRecoveryHealth {
    NativeRecoveryHealth(
        domain: .ordinary,
        status: .degraded,
        auditComplete: true,
        code: "cleanup-pending",
        maintenancePendingCount: count,
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

private func managedOrphanOrdinaryHealth(_ hashes: [String]) -> NativeRecoveryHealth {
    NativeRecoveryHealth(
        domain: .ordinary,
        status: .degraded,
        auditComplete: true,
        code: "managed-orphan",
        maintenancePendingCount: 0,
        detail: "managed orphans: \(hashes.sorted().joined(separator: ","))"
    )
}

private func emptyOrdinaryIndex() -> OrdinaryRecoveryIndex {
    OrdinaryRecoveryIndex(
        format: OrdinaryRecoveryIndex.expectedFormat,
        version: OrdinaryRecoveryIndex.expectedVersion,
        committed: OrdinaryCommittedState(
            primaryHash: nil,
            slots: [],
            maintenance: OrdinaryMaintenanceState(
                pendingCleanupHashes: [],
                lastHealthCode: nil
            )
        ),
        prepared: nil
    )
}

private func writePrivateTestFile(_ bytes: Data, to url: URL) throws {
    try bytes.write(to: url)
    try FileManager.default.setAttributes(
        [.posixPermissions: NSNumber(value: Int16(0o600))],
        ofItemAtPath: url.path
    )
}

private func createPrivateTestDirectory(_ url: URL) throws {
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
    try FileManager.default.setAttributes(
        [.posixPermissions: NSNumber(value: Int16(0o700))],
        ofItemAtPath: url.path
    )
}

private func setUserImmutable(_ url: URL) throws {
    guard Darwin.chflags(url.path, UInt32(UF_IMMUTABLE)) == 0 else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
}

private func clearTestFileFlags(_ url: URL) throws {
    guard Darwin.chflags(url.path, 0) == 0 else {
        if errno == ENOENT { return }
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
}

private func hasUserImmutableFlag(_ url: URL) throws -> Bool {
    var value = stat()
    guard Darwin.lstat(url.path, &value) == 0 else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return value.st_flags & UInt32(UF_IMMUTABLE) != 0
}

private func inode(of url: URL) throws -> UInt64 {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    return try XCTUnwrap((attributes[.systemFileNumber] as? NSNumber)?.uint64Value)
}

private struct TestFileIdentity: Equatable, Sendable {
    let device: UInt64
    let inode: UInt64
}

private func fileIdentity(of url: URL) throws -> TestFileIdentity {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    return TestFileIdentity(
        device: try XCTUnwrap((attributes[.systemNumber] as? NSNumber)?.uint64Value),
        inode: try XCTUnwrap((attributes[.systemFileNumber] as? NSNumber)?.uint64Value)
    )
}

private enum OrdinaryBlobCorruption: String, CaseIterable {
    case invalidCanonicalContent
    case noncanonicalName
    case symbolicLink
    case malformedWriterTemp
    case unknownDirectory

    func install(in fixture: OrdinaryStoreFixture) throws -> URL {
        switch self {
        case .invalidCanonicalContent:
            let claimedHash = sha256(Data("claimed-content".utf8))
            let url = fixture.blobURL(claimedHash)
            try writePrivateTestFile(Data("different-content".utf8), to: url)
            return url
        case .noncanonicalName:
            let url = fixture.blobsURL.appendingPathComponent("not-a-canonical-hash.json")
            try writePrivateTestFile(Data("noncanonical".utf8), to: url)
            return url
        case .symbolicLink:
            let target = fixture.parentURL.appendingPathComponent("blob-link-target")
            try writePrivateTestFile(Data("link-target".utf8), to: target)
            let link = fixture.blobURL(String(repeating: "b", count: 64))
            try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
            return link
        case .malformedWriterTemp:
            let url = fixture.blobsURL.appendingPathComponent(
                ".AssetTracker.tmp.123e4567-e89b-12d3-a456-426614174002"
            )
            try writePrivateTestFile(Data("not-provable-from-current-primary".utf8), to: url)
            return url
        case .unknownDirectory:
            let url = fixture.blobsURL.appendingPathComponent("unknown-directory", isDirectory: true)
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
            return url
        }
    }
}
