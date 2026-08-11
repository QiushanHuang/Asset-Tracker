import Foundation

public indirect enum AssetTrackerBridgeJSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case integer(Int)
    case string(String)
    case array([AssetTrackerBridgeJSONValue])
    case object([String: AssetTrackerBridgeJSONValue])

    fileprivate var foundationValue: Any {
        switch self {
        case .null:
            return NSNull()
        case .bool(let value):
            return value
        case .integer(let value):
            return value
        case .string(let value):
            return value
        case .array(let values):
            return values.map(\.foundationValue)
        case .object(let values):
            return values.mapValues(\.foundationValue)
        }
    }
}

public enum AssetTrackerNativeBridgeRequestValidationError: Error, Equatable, LocalizedError {
    case invalidPayload(String)

    public var errorDescription: String? {
        switch self {
        case .invalidPayload(let message):
            return message
        }
    }
}

public enum AssetTrackerNativeBridgeRequestParser {
    private static let saveKeys: Set<String> = [
        "protocolVersion",
        "loadId",
        "writeSessionToken",
        "clientSaveId",
        "stateJson",
        "payloadHash",
        "reason",
        "expectedHash",
        "validatedSourceHash",
        "schemaVersion",
    ]
    private static let snapshotKeys: Set<String> = [
        "protocolVersion",
        "loadId",
        "writeSessionToken",
        "clientSnapshotId",
        "reason",
        "expectedHash",
    ]

    public static func durableSave(payload: [String: Any]) throws -> DurableBookSaveRequest {
        try requireExactKeys(payload, expected: saveKeys)
        let protocolVersion = try integer(payload, key: "protocolVersion")
        let loadID = try string(payload, key: "loadId")
        let writeSessionToken = try string(payload, key: "writeSessionToken")
        let clientSaveID = try string(payload, key: "clientSaveId")
        let stateJSON = try string(payload, key: "stateJson")
        let payloadHash = try string(payload, key: "payloadHash")
        let reason = try string(payload, key: "reason")
        let expectedHash = try optionalString(payload, key: "expectedHash")
        let validatedSourceHash = try optionalString(
            payload,
            key: "validatedSourceHash"
        )
        let schemaVersion = try integer(payload, key: "schemaVersion")
        let authorization = AssetTrackerSaveAuthorization(
            protocolVersion: protocolVersion,
            loadID: loadID,
            writeSessionToken: writeSessionToken,
            expectedHash: expectedHash,
            validatedSourceHash: validatedSourceHash
        )
        let request = DurableBookSaveRequest(
            clientSaveID: clientSaveID,
            expectedSource: expectedHash.map(ExpectedBookSource.sha256) ?? .missing,
            payloadHash: payloadHash,
            stateJSON: stateJSON,
            schemaVersion: schemaVersion,
            reason: reason,
            authorization: authorization
        )
        try NativeDurableDTOValidator.validate(request)
        return request
    }

    public static func snapshot(payload: [String: Any]) throws -> NativeSnapshotRequest {
        try requireExactKeys(payload, expected: snapshotKeys)
        let protocolVersion = try integer(payload, key: "protocolVersion")
        let loadID = try string(payload, key: "loadId")
        let writeSessionToken = try string(payload, key: "writeSessionToken")
        let clientSnapshotID = try string(payload, key: "clientSnapshotId")
        let reasonValue = try string(payload, key: "reason")
        guard let reason = NativeSnapshotReason(rawValue: reasonValue) else {
            throw invalid("无效的 reason")
        }
        let expectedHash = try string(payload, key: "expectedHash")
        let request = NativeSnapshotRequest(
            clientSnapshotID: clientSnapshotID,
            reason: reason,
            expectedHash: expectedHash,
            authorization: AssetTrackerSaveAuthorization(
                protocolVersion: protocolVersion,
                loadID: loadID,
                writeSessionToken: writeSessionToken,
                expectedHash: expectedHash,
                validatedSourceHash: expectedHash
            )
        )
        try NativeDurableDTOValidator.validate(request)
        return request
    }

    private static func requireExactKeys(
        _ payload: [String: Any],
        expected: Set<String>
    ) throws {
        guard Set(payload.keys) == expected else {
            throw invalid("桥接请求字段不匹配")
        }
    }

    private static func string(_ payload: [String: Any], key: String) throws -> String {
        guard let value = payload[key] as? String else {
            throw invalid("无效的 \(key)")
        }
        return value
    }

    private static func optionalString(
        _ payload: [String: Any],
        key: String
    ) throws -> String? {
        guard let value = payload[key] else {
            throw invalid("缺少 \(key)")
        }
        if value is NSNull { return nil }
        guard let string = value as? String else {
            throw invalid("无效的 \(key)")
        }
        return string
    }

    private static func integer(_ payload: [String: Any], key: String) throws -> Int {
        guard let value = payload[key], !(value is Bool), let integer = value as? Int else {
            throw invalid("无效的 \(key)")
        }
        return integer
    }

    private static func invalid(
        _ message: String
    ) -> AssetTrackerNativeBridgeRequestValidationError {
        .invalidPayload(message)
    }
}

public enum AssetTrackerNativeBridgeDTOMapper {
    public static func saveReceipt(
        _ receipt: NativeDurableSaveReceipt
    ) throws -> AssetTrackerBridgeJSONValue {
        try NativeDurableDTOValidator.validate(receipt)
        return .object([
            "ok": .bool(true),
            "clientSaveId": .string(receipt.clientSaveID),
            "payloadHash": .string(receipt.payloadHash),
            "sourceHashBefore": receipt.sourceHashBefore.map(AssetTrackerBridgeJSONValue.string) ?? .null,
            "stateHashAfter": .string(receipt.stateHashAfter),
            "stateHash": .string(receipt.stateHashAfter),
            "byteCount": .integer(receipt.byteCount),
            "durability": .string(durability(receipt.durability)),
            "updatedAt": .string(verifiedTimestamp(receipt.updatedAt)),
            "storagePath": .string(receipt.storagePath),
            "recoveryHealth": recoveryHealth(receipt.recoveryHealth)
        ])
    }

    public static func snapshotReceipt(
        _ receipt: NativeSnapshotReceipt
    ) throws -> AssetTrackerBridgeJSONValue {
        try NativeDurableDTOValidator.validate(receipt)
        guard let ordinal = Int(exactly: receipt.ordinal) else {
            throw NativeDurableDTOValidationError.invalidOrdinal(receipt.ordinal)
        }
        return .object([
            "ok": .bool(true),
            "clientSnapshotId": .string(receipt.clientSnapshotID),
            "sourceHash": .string(receipt.sourceHash),
            "snapshotHash": .string(receipt.snapshotHash),
            "ordinal": .integer(ordinal),
            "snapshotStatus": .string(snapshotStatus(receipt.snapshotStatus)),
            "durability": .string(durability(receipt.durability)),
            "retainedCount": .integer(receipt.retainedCount),
            "recoveryHealth": recoveryHealth(receipt.recoveryHealth)
        ])
    }

    public static func terminalizationReceipt(
        request: AssetTrackerTerminalizationRequest,
        acknowledgement: AssetTrackerTerminalizationAcknowledgement
    ) throws -> AssetTrackerBridgeJSONValue {
        guard request.protocolVersion == 2,
              !request.loadID.isEmpty,
              AssetTrackerLegacyWriteGate.supportedTerminalizationReasons.contains(
                  acknowledgement.reason
              )
        else {
            throw AssetTrackerNativeBridgeRequestValidationError.invalidPayload(
                "本机终止回执无效"
            )
        }
        return .object([
            "ok": .bool(true),
            "protocolVersion": .integer(2),
            "loadId": .string(request.loadID),
            "reason": .string(acknowledgement.reason),
            "gateState": .string("terminal-locked")
        ])
    }

    public static func saveError(
        _ proof: NativeDurableSaveErrorProof
    ) throws -> AssetTrackerBridgeJSONValue {
        try NativeDurableDTOValidator.validate(proof)
        return .object([
            "code": .string(proof.code),
            "message": .string(proof.message),
            "writeOutcome": .string(writeOutcome(proof.writeOutcome)),
            "conflict": conflict(proof.conflict),
            "clientSaveId": .string(proof.clientSaveID),
            "payloadHash": .string(proof.payloadHash),
            "sourceHashAfter": proof.sourceHashAfter.map(AssetTrackerBridgeJSONValue.string) ?? .null,
            "sourceReverified": .bool(proof.sourceReverified),
            "coordinatorReleased": .bool(proof.coordinatorReleased),
            "healthPersisted": .bool(proof.healthPersisted),
            "recoveryHealthEvidence": proof.recoveryHealthEvidence.map(recoveryHealth) ?? .null
        ])
    }

    public static func snapshotError(
        _ proof: NativeSnapshotErrorProof
    ) throws -> AssetTrackerBridgeJSONValue {
        try NativeDurableDTOValidator.validate(proof)
        return .object([
            "code": .string(proof.code),
            "message": .string(proof.message),
            "snapshotOutcome": .string(snapshotOutcome(proof.snapshotOutcome)),
            "conflict": conflict(proof.conflict),
            "clientSnapshotId": .string(proof.clientSnapshotID),
            "sourceHashAfter": proof.sourceHashAfter.map(AssetTrackerBridgeJSONValue.string) ?? .null,
            "sourceReverified": .bool(proof.sourceReverified),
            "coordinatorReleased": .bool(proof.coordinatorReleased),
            "healthPersisted": .bool(proof.healthPersisted),
            "recoveryHealthEvidence": proof.recoveryHealthEvidence.map(recoveryHealth) ?? .null
        ])
    }

    private static func durability(_ value: NativeDurability) -> String {
        switch value {
        case .nativeDurable:
            return "native-durable"
        }
    }

    private static func verifiedTimestamp(_ value: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: value)
    }

    private static func snapshotStatus(_ value: NativeSnapshotStatus) -> String {
        switch value {
        case .created:
            return "created"
        case .deduplicated:
            return "deduplicated"
        }
    }

    private static func writeOutcome(_ value: NativeWriteOutcome) -> String {
        switch value {
        case .notCommitted:
            return "not-committed"
        case .unknown:
            return "unknown"
        }
    }

    private static func snapshotOutcome(_ value: NativeSnapshotOutcome) -> String {
        switch value {
        case .notCreated:
            return "not-created"
        case .unknown:
            return "unknown"
        }
    }

    private static func conflict(_ value: NativeOperationConflict) -> AssetTrackerBridgeJSONValue {
        switch value {
        case .none:
            return .bool(false)
        case .sourceChanged:
            return .string("source-changed")
        case .sessionInvalid:
            return .string("session-invalid")
        }
    }

    fileprivate static func recoveryHealth(
        _ health: NativeRecoveryHealth
    ) -> AssetTrackerBridgeJSONValue {
        let status: String
        switch health.status {
        case .healthy:
            status = "healthy"
        case .degraded:
            status = "degraded"
        case .notApplicable:
            status = "not-applicable"
        }
        return .object([
            "domain": .string(health.domain.rawValue),
            "status": .string(status),
            "auditComplete": .bool(health.auditComplete),
            "code": health.code.map(AssetTrackerBridgeJSONValue.string) ?? .null,
            "maintenancePendingCount": .integer(health.maintenancePendingCount),
            "detail": health.detail.map(AssetTrackerBridgeJSONValue.string) ?? .null
        ])
    }
}

public struct AssetTrackerBridgeResponse: Equatable, Sendable {
    public let requestID: String
    public let ok: Bool
    public let result: AssetTrackerBridgeJSONValue?
    public let error: AssetTrackerBridgeJSONValue?

    public init(
        requestID: String,
        ok: Bool,
        result: AssetTrackerBridgeJSONValue? = nil,
        error: String? = nil
    ) {
        self.requestID = requestID
        self.ok = ok
        self.result = result
        self.error = error.map(AssetTrackerBridgeJSONValue.string)
    }

    private init(
        requestID: String,
        ok: Bool,
        result: AssetTrackerBridgeJSONValue?,
        structuredError: AssetTrackerBridgeJSONValue?
    ) {
        self.requestID = requestID
        self.ok = ok
        self.result = result
        self.error = structuredError
    }

    public static func success(
        requestID: String,
        result: AssetTrackerBridgeJSONValue
    ) -> Self {
        Self(requestID: requestID, ok: true, result: result)
    }

    public static func failure(requestID: String, error: String) -> Self {
        Self(requestID: requestID, ok: false, error: error)
    }

    public static func saveFailure(
        requestID: String,
        proof: NativeDurableSaveErrorProof
    ) throws -> Self {
        Self(
            requestID: requestID,
            ok: false,
            result: nil,
            structuredError: try AssetTrackerNativeBridgeDTOMapper.saveError(proof)
        )
    }

    public static func snapshotFailure(
        requestID: String,
        proof: NativeSnapshotErrorProof
    ) throws -> Self {
        Self(
            requestID: requestID,
            ok: false,
            result: nil,
            structuredError: try AssetTrackerNativeBridgeDTOMapper.snapshotError(proof)
        )
    }

    public static func terminalizationSuccess(
        requestID: String,
        request: AssetTrackerTerminalizationRequest,
        acknowledgement: AssetTrackerTerminalizationAcknowledgement
    ) throws -> Self {
        .success(
            requestID: requestID,
            result: try AssetTrackerNativeBridgeDTOMapper.terminalizationReceipt(
                request: request,
                acknowledgement: acknowledgement
            )
        )
    }

    public static func loadSuccess(
        requestID: String,
        loaded: AssetTrackerStorageLoadResult
    ) -> Self {
        let book = loaded.book
        return .success(requestID: requestID, result: .object([
            "protocolVersion": .integer(2),
            "loadId": .string(loaded.loadID),
            "status": .string(book.status.rawValue),
            "reason": book.reason.map { .string($0.rawValue) } ?? .null,
            "stateJson": book.stateJson.map(AssetTrackerBridgeJSONValue.string) ?? .null,
            "stateHash": .string(book.status == .readableBytes ? (book.rawHash ?? "") : ""),
            "rawHash": book.rawHash.map(AssetTrackerBridgeJSONValue.string) ?? .null,
            "hashAlgorithm": .string(book.hashAlgorithm),
            "storagePath": .string(book.storagePath),
            "updatedAt": book.updatedAt.map { .string($0.ISO8601Format()) } ?? .null,
            "canExportRaw": .bool(book.canExportRaw),
            "canRevealFolder": .bool(book.canRevealFolder),
            "recoveryHealthComplete": .bool(book.recoveryHealthComplete),
            "ordinaryRecoveryHealth": book.ordinaryRecoveryHealth
                .map(AssetTrackerNativeBridgeDTOMapper.recoveryHealth) ?? .null,
            "snapshotRecoveryHealth": book.snapshotRecoveryHealth
                .map(AssetTrackerNativeBridgeDTOMapper.recoveryHealth) ?? .null
        ]))
    }

    fileprivate var foundationObject: [String: Any] {
        var response: [String: Any] = [
            "id": requestID,
            "ok": ok
        ]
        if let result {
            response["result"] = result.foundationValue
        }
        if let error {
            response["error"] = error.foundationValue
        }
        return response
    }
}

public enum AssetTrackerBridgeResponseEncodingError: Error, Equatable {
    case invalidJSONObject
    case invalidUTF8
}

public protocol AssetTrackerBridgeResponseEncoding: Sendable {
    func javaScript(for response: AssetTrackerBridgeResponse) throws -> String
}

public struct AssetTrackerBridgeResponseEncoder: AssetTrackerBridgeResponseEncoding {
    private let threadObserver: @Sendable (Bool) -> Void

    public init(threadObserver: @escaping @Sendable (Bool) -> Void = { _ in }) {
        self.threadObserver = threadObserver
    }

    public func javaScript(for response: AssetTrackerBridgeResponse) throws -> String {
        threadObserver(Thread.isMainThread)
        let object = response.foundationObject
        guard JSONSerialization.isValidJSONObject(object) else {
            throw AssetTrackerBridgeResponseEncodingError.invalidJSONObject
        }
        let responseData = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard let responseJSON = String(data: responseData, encoding: .utf8) else {
            throw AssetTrackerBridgeResponseEncodingError.invalidUTF8
        }
        let literalData = try JSONEncoder().encode(responseJSON)
        guard var responseJSONLiteral = String(data: literalData, encoding: .utf8) else {
            throw AssetTrackerBridgeResponseEncodingError.invalidUTF8
        }
        responseJSONLiteral = responseJSONLiteral
            .replacingOccurrences(of: "<", with: "\\u003c")
            .replacingOccurrences(of: ">", with: "\\u003e")
            .replacingOccurrences(of: "&", with: "\\u0026")
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        return "window.AssetTrackerHost && window.AssetTrackerHost.__handleResponse(JSON.parse(\(responseJSONLiteral)));"
    }
}

@MainActor
public final class AssetTrackerBridgeResponsePipeline {
    public typealias Delivery = @MainActor @Sendable (String) -> Void

    private let rawIOExecutor: AssetTrackerRawIOExecuting
    private let encoder: any AssetTrackerBridgeResponseEncoding
    private let delivery: Delivery

    public init(
        rawIOExecutor: AssetTrackerRawIOExecuting,
        encoder: any AssetTrackerBridgeResponseEncoding = AssetTrackerBridgeResponseEncoder(),
        delivery: @escaping Delivery
    ) {
        self.rawIOExecutor = rawIOExecutor
        self.encoder = encoder
        self.delivery = delivery
    }

    public func send(_ response: AssetTrackerBridgeResponse) {
        let encoder = self.encoder
        let delivery = self.delivery
        rawIOExecutor.execute {
            let javascript: String
            do {
                javascript = try encoder.javaScript(for: response)
            } catch {
                javascript = AssetTrackerBridgeMinimalFallback.javaScript(
                    requestID: response.requestID
                )
            }
            Task { @MainActor in
                delivery(javascript)
            }
        }
    }
}

private enum AssetTrackerBridgeMinimalFallback {
    static func javaScript(requestID: String) -> String {
        let requestIDLiteral = jsonStringLiteral(requestID)
        return "window.AssetTrackerHost && window.AssetTrackerHost.__handleResponse({\"id\":\(requestIDLiteral),\"ok\":false,\"error\":\"Native response encoding failed\"});"
    }

    private static func jsonStringLiteral(_ value: String) -> String {
        var literal = "\""
        for scalar in value.unicodeScalars {
            switch scalar.value {
            case 0x22:
                literal += "\\\""
            case 0x5c:
                literal += "\\\\"
            case 0x08:
                literal += "\\b"
            case 0x0c:
                literal += "\\f"
            case 0x0a:
                literal += "\\n"
            case 0x0d:
                literal += "\\r"
            case 0x09:
                literal += "\\t"
            case 0x20...0x21, 0x23...0x25, 0x28...0x3b, 0x3d, 0x3f...0x5b, 0x5d...0x7e:
                literal.unicodeScalars.append(scalar)
            case 0x00...0xffff:
                literal += String(format: "\\u%04x", scalar.value)
            default:
                let supplementary = scalar.value - 0x10000
                let highSurrogate = 0xd800 + (supplementary >> 10)
                let lowSurrogate = 0xdc00 + (supplementary & 0x3ff)
                literal += String(format: "\\u%04x\\u%04x", highSurrogate, lowSurrogate)
            }
        }
        literal += "\""
        return literal
    }
}
