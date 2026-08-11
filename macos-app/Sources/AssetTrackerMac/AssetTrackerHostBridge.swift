import AppKit
import AssetTrackerCore
import Foundation
import UniformTypeIdentifiers
import WebKit

private enum AssetTrackerBridgeError: LocalizedError {
    case unsupportedMessage(String)
    case invalidPayload(String)
    case cancelled
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .unsupportedMessage(let type):
            return "不支持的桥接消息类型: \(type)"
        case .invalidPayload(let message):
            return message
        case .cancelled:
            return "用户取消了操作"
        case .encodingFailed:
            return "文件编码处理失败"
        }
    }
}

@MainActor
final class AssetTrackerHostBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private weak var hostWindow: NSWindow?
    private let bookStore: AssetTrackerBookStore
    private let rawIOExecutor: AssetTrackerSerialRawIOExecutor
    private let storageCoordinator: AssetTrackerStorageCoordinator
    private let responsePipeline: AssetTrackerBridgeResponsePipeline

    init(
        webView: WKWebView,
        hostWindow: NSWindow?,
        bookStore: AssetTrackerBookStore,
        rawIOExecutor: AssetTrackerSerialRawIOExecutor = AssetTrackerSerialRawIOExecutor()
    ) {
        self.webView = webView
        self.hostWindow = hostWindow
        self.bookStore = bookStore
        self.rawIOExecutor = rawIOExecutor
        self.storageCoordinator = AssetTrackerStorageCoordinator(
            store: bookStore,
            rawIOExecutor: rawIOExecutor
        )
        self.responsePipeline = AssetTrackerBridgeResponsePipeline(
            rawIOExecutor: rawIOExecutor
        ) { [weak webView] javascript in
            webView?.evaluateJavaScript(javascript)
        }
        super.init()
    }

    static func attach(
        to userContentController: WKUserContentController,
        webView: WKWebView,
        hostWindow: NSWindow?,
        bookStore: AssetTrackerBookStore
    ) -> AssetTrackerHostBridge {
        let bridge = AssetTrackerHostBridge(
            webView: webView,
            hostWindow: hostWindow,
            bookStore: bookStore
        )
        userContentController.add(bridge, name: "assetTrackerHost")
        return bridge
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            message.name == "assetTrackerHost",
            let body = message.body as? [String: Any],
            let requestID = body["id"] as? String,
            let type = body["type"] as? String
        else {
            return
        }

        let payload = body["payload"] as? [String: Any] ?? [:]
        switch type {
        case "storage.load":
            handleStorageLoad(requestID: requestID, payload: payload)
        case "storage.confirmLoad":
            do {
                let result = try confirmStorageLoad(payload: payload)
                sendResponse(id: requestID, ok: true, result: result, error: nil)
            } catch {
                sendResponse(id: requestID, ok: false, result: nil, error: error.localizedDescription)
            }
        case "storage.terminalize":
            handleStorageTerminalize(requestID: requestID, payload: payload)
        case "storage.save":
            handleStorageSave(requestID: requestID, payload: payload)
        case "storage.snapshot":
            handleStorageSnapshot(requestID: requestID, payload: payload)
        case "file.saveRawBook":
            handleRawBookExport(requestID: requestID, payload: payload)
        default:
            do {
                let result = try handleMainThreadMessage(type: type, payload: payload)
                sendResponse(id: requestID, ok: true, result: result, error: nil)
            } catch {
                sendResponse(id: requestID, ok: false, result: nil, error: error.localizedDescription)
            }
        }
    }

    private func handleStorageLoad(requestID: String, payload: [String: Any]) {
        guard payload["protocolVersion"] as? Int == 2 else {
            sendResponse(id: requestID, ok: false, result: nil, error: AssetTrackerWriteGateError.unsupportedProtocol.localizedDescription)
            return
        }
        let retry = payload["retry"] as? Bool ?? false

        do {
            try storageCoordinator.startLoad(retry: retry) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let loaded):
                    self.responsePipeline.send(.loadSuccess(requestID: requestID, loaded: loaded))
                case .failure(let error):
                    self.sendResponse(id: requestID, ok: false, result: nil, error: error.localizedDescription)
                }
            }
        } catch {
            sendResponse(id: requestID, ok: false, result: nil, error: error.localizedDescription)
        }
    }

    private func handleRawBookExport(requestID: String, payload: [String: Any]) {
        guard payload["protocolVersion"] as? Int == 2 else {
            sendResponse(id: requestID, ok: false, result: nil, error: AssetTrackerWriteGateError.unsupportedProtocol.localizedDescription)
            return
        }
        guard let expectedHash = payload["expectedHash"] as? String, !expectedHash.isEmpty else {
            sendResponse(id: requestID, ok: false, result: nil, error: "缺少原始账本哈希")
            return
        }

        let panel = NSSavePanel()
        panel.nameFieldStringValue = (payload["suggestedName"] as? String) ?? "AssetTrackerBook.raw"
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let destinationURL = panel.url else {
            sendResponse(id: requestID, ok: false, result: nil, error: AssetTrackerBridgeError.cancelled.localizedDescription)
            return
        }

        do {
            try storageCoordinator.startRawExport(
                expectedHash: expectedHash,
                destinationURL: destinationURL
            ) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let exported):
                    self.sendResponse(
                        id: requestID,
                        ok: true,
                        result: .object([
                            "ok": .bool(true),
                            "rawHash": .string(exported.rawHash),
                            "byteCount": .integer(exported.byteCount),
                            "path": .string(exported.destinationPath)
                        ]),
                        error: nil
                    )
                case .failure(let error):
                    self.sendResponse(id: requestID, ok: false, result: nil, error: error.localizedDescription)
                }
            }
        } catch {
            sendResponse(id: requestID, ok: false, result: nil, error: error.localizedDescription)
        }
    }

    private func handleMainThreadMessage(type: String, payload: [String: Any]) throws -> AssetTrackerBridgeJSONValue {
        switch type {
        case "file.openImport":
            return try openImportPanel(payload: payload)
        case "file.saveExport":
            return try saveExportFile(payload: payload)
        case "file.revealFolder":
            return try revealStorageDirectory()
        default:
            throw AssetTrackerBridgeError.unsupportedMessage(type)
        }
    }

    private func confirmStorageLoad(payload: [String: Any]) throws -> AssetTrackerBridgeJSONValue {
        let protocolVersion = payload["protocolVersion"] as? Int
        guard let loadID = payload["loadId"] as? String else {
            throw AssetTrackerBridgeError.invalidPayload("缺少 loadId")
        }
        guard
            let outcomeValue = payload["outcome"] as? String,
            let outcome = AssetTrackerLoadConfirmationOutcome(rawValue: outcomeValue)
        else {
            throw AssetTrackerBridgeError.invalidPayload("无效的 outcome")
        }
        let reason = try optionalString(payload, key: "reason")
        let validatedSourceHash = try optionalString(payload, key: "validatedSourceHash")
        let acknowledgement = try storageCoordinator.confirmLoad(
            protocolVersion: protocolVersion,
            loadID: loadID,
            outcome: outcome,
            reason: reason,
            validatedSourceHash: validatedSourceHash
        )
        return .object([
            "ok": .bool(true),
            "writeSessionToken": acknowledgement.writeSessionToken
                .map(AssetTrackerBridgeJSONValue.string) ?? .null
        ])
    }

    private func handleStorageSave(requestID: String, payload: [String: Any]) {
        do {
            let request = try AssetTrackerNativeBridgeRequestParser.durableSave(
                payload: payload
            )
            try storageCoordinator.startSave(request: request) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let saved):
                    do {
                        self.responsePipeline.send(.success(
                            requestID: requestID,
                            result: try AssetTrackerNativeBridgeDTOMapper.saveReceipt(saved)
                        ))
                    } catch {
                        self.sendResponse(
                            id: requestID,
                            ok: false,
                            result: nil,
                            error: error.localizedDescription
                        )
                    }
                case .failure(let proof as NativeDurableSaveErrorProof):
                    do {
                        self.responsePipeline.send(try .saveFailure(
                            requestID: requestID,
                            proof: proof
                        ))
                    } catch {
                        self.sendResponse(
                            id: requestID,
                            ok: false,
                            result: nil,
                            error: error.localizedDescription
                        )
                    }
                case .failure(let error):
                    self.sendResponse(id: requestID, ok: false, result: nil, error: error.localizedDescription)
                }
            }
        } catch {
            sendResponse(id: requestID, ok: false, result: nil, error: error.localizedDescription)
        }
    }

    private func handleStorageSnapshot(requestID: String, payload: [String: Any]) {
        do {
            let request = try AssetTrackerNativeBridgeRequestParser.snapshot(
                payload: payload
            )
            try storageCoordinator.startSnapshot(request: request) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let receipt):
                    do {
                        self.responsePipeline.send(.success(
                            requestID: requestID,
                            result: try AssetTrackerNativeBridgeDTOMapper.snapshotReceipt(receipt)
                        ))
                    } catch {
                        self.sendResponse(
                            id: requestID,
                            ok: false,
                            result: nil,
                            error: error.localizedDescription
                        )
                    }
                case .failure(let proof as NativeSnapshotErrorProof):
                    do {
                        self.responsePipeline.send(try .snapshotFailure(
                            requestID: requestID,
                            proof: proof
                        ))
                    } catch {
                        self.sendResponse(
                            id: requestID,
                            ok: false,
                            result: nil,
                            error: error.localizedDescription
                        )
                    }
                case .failure(let error):
                    self.sendResponse(
                        id: requestID,
                        ok: false,
                        result: nil,
                        error: error.localizedDescription
                    )
                }
            }
        } catch {
            sendResponse(
                id: requestID,
                ok: false,
                result: nil,
                error: error.localizedDescription
            )
        }
    }

    private func handleStorageTerminalize(requestID: String, payload: [String: Any]) {
        do {
            let request = try storageTerminalizationRequest(payload: payload)
            try storageCoordinator.terminalize(request) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let acknowledgement):
                    do {
                        self.responsePipeline.send(try .terminalizationSuccess(
                            requestID: requestID,
                            request: request,
                            acknowledgement: acknowledgement
                        ))
                    } catch {
                        self.sendResponse(
                            id: requestID,
                            ok: false,
                            result: nil,
                            error: error.localizedDescription
                        )
                    }
                case .failure(let error):
                    self.sendResponse(id: requestID, ok: false, result: nil, error: error.localizedDescription)
                }
            }
        } catch {
            sendResponse(id: requestID, ok: false, result: nil, error: error.localizedDescription)
        }
    }

    private func storageTerminalizationRequest(
        payload: [String: Any]
    ) throws -> AssetTrackerTerminalizationRequest {
        guard let loadID = payload["loadId"] as? String else {
            throw AssetTrackerBridgeError.invalidPayload("缺少 loadId")
        }
        guard let reason = payload["reason"] as? String else {
            throw AssetTrackerBridgeError.invalidPayload("缺少 reason")
        }
        return AssetTrackerTerminalizationRequest(
            protocolVersion: payload["protocolVersion"] as? Int,
            loadID: loadID,
            writeSessionToken: try optionalString(payload, key: "writeSessionToken"),
            reason: reason
        )
    }

    private func revealStorageDirectory() throws -> AssetTrackerBridgeJSONValue {
        try FileManager.default.createDirectory(
            at: bookStore.storageDirectoryURL,
            withIntermediateDirectories: true,
            attributes: nil
        )
        NSWorkspace.shared.activateFileViewerSelecting([bookStore.storageDirectoryURL])
        return .object(["path": .string(bookStore.storageDirectoryURL.path)])
    }

    private func optionalString(_ payload: [String: Any], key: String) throws -> String? {
        guard let value = payload[key], !(value is NSNull) else { return nil }
        guard let string = value as? String else {
            throw AssetTrackerBridgeError.invalidPayload("无效的 \(key)")
        }
        return string
    }

    private func openImportPanel(payload: [String: Any]) throws -> AssetTrackerBridgeJSONValue {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false

        if let acceptedTypes = payload["acceptedTypes"] as? String {
            let extensions = acceptedTypes
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .map { $0.replacingOccurrences(of: ".", with: "") }
                .filter { !$0.isEmpty }
            let contentTypes = extensions.compactMap { UTType(filenameExtension: $0) }
            if !contentTypes.isEmpty {
                panel.allowedContentTypes = contentTypes
            }
        }

        guard panel.runModal() == .OK, let url = panel.url else {
            throw AssetTrackerBridgeError.cancelled
        }
        let readAs = (payload["readAs"] as? String) ?? "text"
        let fileData = try Data(contentsOf: url)
        if readAs == "binary" {
            return .object([
                "fileName": .string(url.lastPathComponent),
                "mime": .string(mimeType(for: url)),
                "text": .string(fileData.base64EncodedString()),
                "encoding": .string("base64")
            ])
        }
        guard let text = String(data: fileData, encoding: .utf8) else {
            throw AssetTrackerBridgeError.encodingFailed
        }
        return .object([
            "fileName": .string(url.lastPathComponent),
            "mime": .string(mimeType(for: url)),
            "text": .string(text),
            "encoding": .string("text")
        ])
    }

    private func saveExportFile(payload: [String: Any]) throws -> AssetTrackerBridgeJSONValue {
        guard let suggestedName = payload["suggestedName"] as? String else {
            throw AssetTrackerBridgeError.invalidPayload("缺少 suggestedName")
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let destinationURL = panel.url else {
            throw AssetTrackerBridgeError.cancelled
        }

        let encoding = (payload["encoding"] as? String) ?? "text"
        let text = (payload["text"] as? String) ?? ""
        let fileData: Data
        if encoding == "base64" {
            guard let decoded = Data(base64Encoded: text) else {
                throw AssetTrackerBridgeError.encodingFailed
            }
            fileData = decoded
        } else {
            fileData = Data(text.utf8)
        }
        try FileManager.default.createDirectory(
            at: destinationURL.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: nil
        )
        try fileData.write(to: destinationURL, options: .atomic)
        return .object([
            "ok": .bool(true),
            "fileName": .string(destinationURL.lastPathComponent),
            "path": .string(destinationURL.path)
        ])
    }

    private func sendResponse(
        id: String,
        ok: Bool,
        result: AssetTrackerBridgeJSONValue?,
        error: String?
    ) {
        responsePipeline.send(AssetTrackerBridgeResponse(
            requestID: id,
            ok: ok,
            result: result,
            error: error
        ))
    }

    private func mimeType(for url: URL) -> String {
        if let type = UTType(filenameExtension: url.pathExtension), let mimeType = type.preferredMIMEType {
            return mimeType
        }
        return "application/octet-stream"
    }
}
