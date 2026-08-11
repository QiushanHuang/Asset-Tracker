import AssetTrackerCore
import CoreFoundation
import Darwin
import Foundation

@main
enum AssetTrackerFaultHarnessMain {
    static func main() {
        do {
            try Harness().run(arguments: Array(CommandLine.arguments.dropFirst()))
        } catch {
            let message = "HARNESS_ERROR \(error)\n"
            FileHandle.standardError.write(Data(message.utf8))
            Darwin.exit(64)
        }
    }
}

private struct Harness {
    func run(arguments: [String]) throws {
        switch try HarnessCommand.parse(arguments) {
        case .mutate(let options):
            try mutate(options)
        case .verify(let rootURL):
            try verify(rootURL: rootURL)
        case .swap(let rootURL, let component):
            try swap(rootURL: rootURL, component: component)
        }
    }

    private func mutate(_ options: MutationOptions) throws {
        let request = try MutationRequest.read(from: options.requestURL)
        let pause = FaultPause(selector: options.selector)
        let hooks = AssetTrackerBookStoreDurabilityHooks { event in
            try pause.handle(event)
        }
        let store = AssetTrackerBookStore(
            storageDirectoryURL: options.rootURL,
            durabilityHooks: hooks
        )
        let load = store.load()
        guard load.recoveryHealthComplete else {
            throw HarnessError.incompleteRecoveryAudit
        }
        let gate = AssetTrackerLegacyWriteGate()
        let loadID = gate.registerLoad(load, retry: false)
        let confirmation: AssetTrackerLoadConfirmation
        switch load.status {
        case .missing:
            guard request.expectedHash == nil else {
                throw HarnessError.sourceDoesNotMatchRequest
            }
            confirmation = try gate.confirm(
                protocolVersion: 2,
                loadID: loadID,
                outcome: .missing,
                reason: nil,
                validatedSourceHash: nil
            )
        case .readableBytes:
            guard load.rawHash == request.expectedHash else {
                throw HarnessError.sourceDoesNotMatchRequest
            }
            confirmation = try gate.confirm(
                protocolVersion: 2,
                loadID: loadID,
                outcome: .valid,
                reason: nil,
                validatedSourceHash: load.rawHash
            )
        case .invalidUTF8, .ioError:
            throw HarnessError.sourceNotConfirmable
        }
        guard let token = confirmation.writeSessionToken else {
            throw HarnessError.missingWriteToken
        }
        let authorization = AssetTrackerSaveAuthorization(
            protocolVersion: 2,
            loadID: loadID,
            writeSessionToken: token,
            expectedHash: request.expectedHash,
            validatedSourceHash: request.expectedHash
        )
        try gate.preflightSave(authorization)

        if options.rendezvousAfterConfirm {
            try MarkerWriter.emit(request.readyMarker(sourceHash: load.rawHash))
            try readExactGO()
        }

        switch request {
        case .save(let value):
            let durableRequest = DurableBookSaveRequest(
                clientSaveID: value.clientSaveID,
                expectedSource: value.expectedHash.map(ExpectedBookSource.sha256) ?? .missing,
                payloadHash: AssetTrackerBookStore.sha256Hex(Data(value.stateJSON.utf8)),
                stateJSON: value.stateJSON,
                schemaVersion: 1,
                reason: value.reason,
                authorization: authorization
            )
            do {
                let receipt = try store.saveDurably(durableRequest)
                try gate.recordSuccessfulSave(newRawHash: receipt.stateHashAfter)
                try pause.requireSelectedEventReached()
                try MarkerWriter.emit([
                    "event": "receipt",
                    "clientSaveId": receipt.clientSaveID,
                    "stateHashAfter": receipt.stateHashAfter,
                    "durability": "native-durable",
                ])
            } catch let harnessError as HarnessError {
                throw harnessError
            } catch {
                try emitSaveError(
                    error,
                    request: durableRequest,
                    rootURL: options.rootURL
                )
            }
        case .snapshot(let value):
            guard let expectedHash = value.expectedHash,
                  let reason = NativeSnapshotReason(rawValue: value.reason) else {
                throw HarnessError.invalidRequest
            }
            let snapshotRequest = NativeSnapshotRequest(
                clientSnapshotID: value.clientSnapshotID,
                reason: reason,
                expectedHash: expectedHash,
                authorization: authorization
            )
            do {
                let receipt = try store.snapshot(snapshotRequest)
                try pause.requireSelectedEventReached()
                try MarkerWriter.emit([
                    "event": "receipt",
                    "clientSnapshotId": receipt.clientSnapshotID,
                    "sourceHash": receipt.sourceHash,
                    "snapshotHash": receipt.snapshotHash,
                    "ordinal": Int(receipt.ordinal),
                    "snapshotStatus": receipt.snapshotStatus.rawValue,
                    "durability": "native-durable",
                    "retainedCount": receipt.retainedCount,
                ])
            } catch let harnessError as HarnessError {
                throw harnessError
            } catch {
                try emitSnapshotError(
                    error,
                    request: snapshotRequest,
                    rootURL: options.rootURL
                )
            }
        }
    }

    private func verify(rootURL: URL) throws {
        let pre = observe(rootURL: rootURL)
        let recovery = AssetTrackerRecoveryStore(rootURL: rootURL)
        _ = try? recovery.reconcileOrdinary()
        let post = observe(rootURL: rootURL)
        try MarkerWriter.emit([
            "event": "verification",
            "pre": pre,
            "post": post,
        ])
    }

    private func observe(rootURL: URL) -> [String: Any] {
        let store = AssetTrackerBookStore(storageDirectoryURL: rootURL)
        let load = store.load()
        let primaryBytes = load.data
        let primaryJSONValid: Bool
        if let primaryBytes {
            primaryJSONValid = (try? JSONSerialization.jsonObject(with: primaryBytes)) is [String: Any]
        } else {
            primaryJSONValid = false
        }
        return [
            "primaryHash": load.rawHash ?? NSNull(),
            "primaryByteCount": primaryBytes?.count ?? NSNull(),
            "primaryJSONValid": primaryJSONValid,
            "recoveryHealthComplete": load.recoveryHealthComplete,
            "ordinaryHealth": load.ordinaryRecoveryHealth.map(healthObject) ?? NSNull(),
            "snapshotHealth": load.snapshotRecoveryHealth.map(healthObject) ?? NSNull(),
            "ordinaryIndexPresent": fileExists(
                rootURL.appendingPathComponent("Recovery/ordinary/slots.json")
            ),
            "snapshotIndexPresent": fileExists(
                rootURL.appendingPathComponent("Recovery/snapshots/index.json")
            ),
        ]
    }

    private func healthObject(_ health: NativeRecoveryHealth) -> [String: Any] {
        [
            "domain": health.domain.rawValue,
            "status": health.status.rawValue,
            "auditComplete": health.auditComplete,
            "code": health.code ?? NSNull(),
            "maintenancePendingCount": health.maintenancePendingCount,
            "detail": health.detail ?? NSNull(),
        ]
    }

    private func swap(rootURL: URL, component: SwapComponent) throws {
        let canonicalURL: URL
        switch component {
        case .root:
            canonicalURL = rootURL
        case .lock:
            canonicalURL = rootURL.appendingPathComponent(".AssetTracker.storage.lock")
        case .ordinary:
            canonicalURL = rootURL.appendingPathComponent("Recovery/ordinary", isDirectory: true)
        case .snapshot:
            canonicalURL = rootURL.appendingPathComponent("Recovery/snapshots", isDirectory: true)
        }
        let old = try fileIdentity(canonicalURL)
        guard old.userID == Darwin.geteuid() else { throw HarnessError.wrongOwner }
        let detachedURL = canonicalURL.deletingLastPathComponent().appendingPathComponent(
            ".\(canonicalURL.lastPathComponent).swapped.\(UUID().uuidString.lowercased())"
        )
        _ = Darwin.chflags(canonicalURL.path, 0)
        guard Darwin.rename(canonicalURL.path, detachedURL.path) == 0 else {
            throw currentPOSIXError()
        }
        switch component {
        case .lock:
            guard FileManager.default.createFile(atPath: canonicalURL.path, contents: Data()),
                  Darwin.chmod(canonicalURL.path, 0o600) == 0 else {
                throw currentPOSIXError()
            }
        case .root, .ordinary, .snapshot:
            guard Darwin.mkdir(canonicalURL.path, 0o700) == 0 else {
                throw currentPOSIXError()
            }
        }
        let new = try fileIdentity(canonicalURL)
        guard old.device != new.device || old.inode != new.inode else {
            throw HarnessError.identityDidNotChange
        }
        try MarkerWriter.emit([
            "event": "swap-complete",
            "component": component.rawValue,
            "oldDevice": Int(old.device),
            "oldInode": Int(old.inode),
            "newDevice": Int(new.device),
            "newInode": Int(new.inode),
            "oldLinkCount": Int(old.linkCount),
            "newLinkCount": Int(new.linkCount),
        ])
    }

    private func emitSaveError(
        _ error: Error,
        request: DurableBookSaveRequest,
        rootURL: URL
    ) throws {
        let currentHash = primaryHash(rootURL: rootURL)
        let expectedHash: String?
        switch request.expectedSource {
        case .missing:
            expectedHash = nil
        case .sha256(let value):
            expectedHash = value
        }
        let sourceChanged = currentHash != expectedHash
        try MarkerWriter.emit([
            "event": "error",
            "operation": "save",
            "error": [
                "code": sourceChanged ? "source-conflict" : "mutation-failed",
                "message": sourceChanged ? "source changed" : String(describing: error),
                "writeOutcome": sourceChanged ? "not-committed" : "unknown",
                "conflict": sourceChanged ? "source-changed" : "none",
                "clientSaveId": request.clientSaveID,
                "payloadHash": request.payloadHash,
                "sourceHashAfter": jsonNullable(currentHash),
                "sourceReverified": true,
                "coordinatorReleased": true,
                "healthPersisted": false,
                "recoveryHealthEvidence": NSNull(),
            ],
        ])
    }

    private func emitSnapshotError(
        _ error: Error,
        request: NativeSnapshotRequest,
        rootURL: URL
    ) throws {
        let currentHash = primaryHash(rootURL: rootURL)
        let sourceChanged = currentHash != request.expectedHash
        try MarkerWriter.emit([
            "event": "error",
            "operation": "snapshot",
            "error": [
                "code": sourceChanged ? "snapshot-source-conflict" : "snapshot-failed",
                "message": sourceChanged ? "source changed" : String(describing: error),
                "snapshotOutcome": sourceChanged ? "not-created" : "unknown",
                "conflict": sourceChanged ? "source-changed" : "none",
                "clientSnapshotId": request.clientSnapshotID,
                "sourceHashAfter": jsonNullable(currentHash),
                "sourceReverified": true,
                "coordinatorReleased": true,
                "healthPersisted": false,
                "recoveryHealthEvidence": NSNull(),
            ],
        ])
    }

    private func primaryHash(rootURL: URL) -> String? {
        let url = rootURL.appendingPathComponent("AssetTrackerBook.json")
        guard let bytes = try? Data(contentsOf: url) else { return nil }
        return AssetTrackerBookStore.sha256Hex(bytes)
    }

    private func fileExists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }
}

private enum HarnessCommand {
    case mutate(MutationOptions)
    case verify(URL)
    case swap(URL, SwapComponent)

    static func parse(_ arguments: [String]) throws -> Self {
        guard let mode = arguments.first else { throw HarnessError.usage }
        switch mode {
        case "mutate":
            var root: String?
            var request: String?
            var point: String?
            var role: String?
            var rendezvous = false
            var index = 1
            while index < arguments.count {
                let flag = arguments[index]
                if flag == "--rendezvous-after-confirm" {
                    guard !rendezvous else { throw HarnessError.usage }
                    rendezvous = true
                    index += 1
                    continue
                }
                guard index + 1 < arguments.count else { throw HarnessError.usage }
                let value = arguments[index + 1]
                guard !value.isEmpty, !value.hasPrefix("--") else { throw HarnessError.usage }
                switch flag {
                case "--root":
                    guard root == nil else { throw HarnessError.usage }
                    root = value
                case "--request":
                    guard request == nil else { throw HarnessError.usage }
                    request = value
                case "--fault-point":
                    guard point == nil else { throw HarnessError.usage }
                    point = value
                case "--fault-role":
                    guard role == nil else { throw HarnessError.usage }
                    role = value
                default:
                    throw HarnessError.usage
                }
                index += 2
            }
            guard let root, let request else { throw HarnessError.usage }
            let selector: FaultSelector?
            switch (point, role) {
            case (nil, nil):
                selector = nil
            case (.some(let point), .some(let role)):
                guard let faultPoint = NativeDurabilityFaultPoint(rawValue: point),
                      let faultRole = NativeDurabilityRole(rawValue: role) else {
                    throw HarnessError.usage
                }
                selector = FaultSelector(point: faultPoint, role: faultRole)
            default:
                throw HarnessError.usage
            }
            return .mutate(MutationOptions(
                rootURL: try strictFileURL(root),
                requestURL: try strictFileURL(request),
                selector: selector,
                rendezvousAfterConfirm: rendezvous
            ))
        case "verify":
            guard arguments.count == 3, arguments[1] == "--root" else {
                throw HarnessError.usage
            }
            return .verify(try strictFileURL(arguments[2]))
        case "swap":
            guard arguments.count == 5,
                  arguments[1] == "--root",
                  arguments[3] == "--component",
                  let component = SwapComponent(rawValue: arguments[4]) else {
                throw HarnessError.usage
            }
            return .swap(try strictFileURL(arguments[2]), component)
        default:
            throw HarnessError.usage
        }
    }
}

private struct MutationOptions {
    let rootURL: URL
    let requestURL: URL
    let selector: FaultSelector?
    let rendezvousAfterConfirm: Bool
}

private struct FaultSelector: Sendable {
    let point: NativeDurabilityFaultPoint
    let role: NativeDurabilityRole
}

private final class FaultPause: @unchecked Sendable {
    private let selector: FaultSelector?
    private let lock = NSLock()
    private var consumed = false

    init(selector: FaultSelector?) {
        self.selector = selector
    }

    func handle(_ event: NativeDurabilityFaultEvent) throws {
        guard let selector,
              selector.point == event.point,
              selector.role == event.role else { return }
        lock.lock()
        let shouldPause = !consumed
        consumed = true
        lock.unlock()
        guard shouldPause else { return }
        try MarkerWriter.emit([
            "event": "fault-point",
            "point": event.point.rawValue,
            "role": event.role.rawValue,
            "targetName": event.targetName,
        ])
        try readExactGO()
    }

    func requireSelectedEventReached() throws {
        guard selector != nil else { return }
        lock.lock()
        let reached = consumed
        lock.unlock()
        guard reached else { throw HarnessError.unreachedFaultPoint }
    }
}

private enum MutationRequest {
    case save(SaveRequest)
    case snapshot(SnapshotRequest)

    var expectedHash: String? {
        switch self {
        case .save(let value): value.expectedHash
        case .snapshot(let value): value.expectedHash
        }
    }

    static func read(from url: URL) throws -> Self {
        var metadata = stat()
        guard Darwin.lstat(url.path, &metadata) == 0,
              metadata.st_mode & S_IFMT == S_IFREG,
              metadata.st_nlink == 1 else {
            throw HarnessError.invalidRequestFile
        }
        let data = try Data(contentsOf: url)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              exactInteger(object["version"]) == 1,
              let operation = object["operation"] as? String else {
            throw HarnessError.invalidRequest
        }
        switch operation {
        case "save":
            guard Set(object.keys) == [
                "version", "operation", "clientSaveId", "expectedHash", "stateJson", "reason",
            ], let clientSaveID = nonemptyString(object["clientSaveId"]),
               let stateJSON = nonemptyString(object["stateJson"]),
               let reason = nonemptyString(object["reason"]),
               let expectedHash = optionalHash(object["expectedHash"]),
               (try? JSONSerialization.jsonObject(with: Data(stateJSON.utf8))) is [String: Any] else {
                throw HarnessError.invalidRequest
            }
            return .save(SaveRequest(
                clientSaveID: clientSaveID,
                expectedHash: expectedHash,
                stateJSON: stateJSON,
                reason: reason
            ))
        case "snapshot":
            guard Set(object.keys) == [
                "version", "operation", "clientSnapshotId", "expectedHash", "stateJson", "reason",
            ], let clientSnapshotID = nonemptyString(object["clientSnapshotId"]),
               object["stateJson"] is NSNull,
               let expectedHash = object["expectedHash"] as? String,
               isCanonicalHash(expectedHash),
               let reason = object["reason"] as? String,
               reason == "manual" || reason == "scheduled" else {
                throw HarnessError.invalidRequest
            }
            return .snapshot(SnapshotRequest(
                clientSnapshotID: clientSnapshotID,
                expectedHash: expectedHash,
                reason: reason
            ))
        default:
            throw HarnessError.invalidRequest
        }
    }

    func readyMarker(sourceHash: String?) -> [String: Any] {
        switch self {
        case .save(let value):
            return [
                "event": "ready-after-confirm",
                "operation": "save",
                "clientSaveId": value.clientSaveID,
                "sourceHash": sourceHash ?? NSNull(),
            ]
        case .snapshot(let value):
            return [
                "event": "ready-after-confirm",
                "operation": "snapshot",
                "clientSnapshotId": value.clientSnapshotID,
                "sourceHash": sourceHash ?? NSNull(),
            ]
        }
    }
}

private struct SaveRequest {
    let clientSaveID: String
    let expectedHash: String?
    let stateJSON: String
    let reason: String
}

private struct SnapshotRequest {
    let clientSnapshotID: String
    let expectedHash: String?
    let reason: String
}

private enum SwapComponent: String {
    case root, lock, ordinary, snapshot
}

private struct FileIdentity {
    let device: UInt64
    let inode: UInt64
    let linkCount: UInt64
    let userID: uid_t
}

private enum MarkerWriter {
    private static let lock = NSLock()

    static func emit(_ object: [String: Any]) throws {
        guard JSONSerialization.isValidJSONObject(object) else {
            throw HarnessError.invalidMarker
        }
        var data = try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        data.append(0x0a)
        lock.lock()
        FileHandle.standardOutput.write(data)
        Darwin.fflush(Darwin.stdout)
        lock.unlock()
    }
}

private enum HarnessError: Error {
    case usage
    case invalidPath
    case invalidRequestFile
    case invalidRequest
    case invalidMarker
    case invalidGateInput
    case incompleteRecoveryAudit
    case sourceDoesNotMatchRequest
    case sourceNotConfirmable
    case missingWriteToken
    case wrongOwner
    case identityDidNotChange
    case unreachedFaultPoint
}

private func strictFileURL(_ path: String) throws -> URL {
    guard path.hasPrefix("/"), !path.isEmpty else { throw HarnessError.invalidPath }
    let url = URL(fileURLWithPath: path).standardizedFileURL
    guard url.path == path else { throw HarnessError.invalidPath }
    return url
}

private func readExactGO() throws {
    var line = Data()
    while line.count <= 3 {
        guard let byte = try FileHandle.standardInput.read(upToCount: 1), !byte.isEmpty else {
            throw HarnessError.invalidGateInput
        }
        line.append(byte)
        if byte[byte.startIndex] == 0x0a { break }
    }
    guard line == Data("GO\n".utf8) else { throw HarnessError.invalidGateInput }
}

private func exactInteger(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let double = number.doubleValue
    guard double.isFinite, double.rounded() == double,
          double >= Double(Int.min), double <= Double(Int.max) else { return nil }
    return Int(double)
}

private func nonemptyString(_ value: Any?) -> String? {
    guard let string = value as? String, !string.isEmpty else { return nil }
    return string
}

private func jsonNullable(_ value: String?) -> Any {
    value.map { $0 as Any } ?? NSNull()
}

private func optionalHash(_ value: Any?) -> String?? {
    if value is NSNull { return .some(nil) }
    guard let string = value as? String, isCanonicalHash(string) else { return nil }
    return .some(.some(string))
}

private func isCanonicalHash(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { byte in
        (48...57).contains(byte) || (97...102).contains(byte)
    }
}

private func fileIdentity(_ url: URL) throws -> FileIdentity {
    var value = stat()
    guard Darwin.lstat(url.path, &value) == 0 else { throw currentPOSIXError() }
    return FileIdentity(
        device: UInt64(value.st_dev),
        inode: UInt64(value.st_ino),
        linkCount: UInt64(value.st_nlink),
        userID: value.st_uid
    )
}

private func currentPOSIXError() -> POSIXError {
    POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
}
