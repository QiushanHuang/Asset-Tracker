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

public struct AssetTrackerBridgeResponse: Equatable, Sendable {
    public let requestID: String
    public let ok: Bool
    public let result: AssetTrackerBridgeJSONValue?
    public let error: String?

    public init(
        requestID: String,
        ok: Bool,
        result: AssetTrackerBridgeJSONValue? = nil,
        error: String? = nil
    ) {
        self.requestID = requestID
        self.ok = ok
        self.result = result
        self.error = error
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
            "canRevealFolder": .bool(book.canRevealFolder)
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
            response["error"] = error
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
