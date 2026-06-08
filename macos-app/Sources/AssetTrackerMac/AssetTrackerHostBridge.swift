import AppKit
import Foundation
import UniformTypeIdentifiers
import WebKit

private enum AssetTrackerBridgeError: LocalizedError {
    case invalidRequest
    case unsupportedMessage(String)
    case invalidPayload(String)
    case cancelled
    case encodingFailed
    case staleWrite

    var errorDescription: String? {
        switch self {
        case .invalidRequest:
            return "无效的原生桥接请求"
        case .unsupportedMessage(let type):
            return "不支持的桥接消息类型: \(type)"
        case .invalidPayload(let message):
            return message
        case .cancelled:
            return "用户取消了操作"
        case .encodingFailed:
            return "文件编码处理失败"
        case .staleWrite:
            return "账本文件已被外部修改，请重新载入后再保存"
        }
    }
}

final class AssetTrackerHostBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private weak var hostWindow: NSWindow?
    private let bookStore = AssetTrackerBookStore()

    init(webView: WKWebView, hostWindow: NSWindow?) {
        self.webView = webView
        self.hostWindow = hostWindow
        super.init()
    }

    static func attach(
        to userContentController: WKUserContentController,
        webView: WKWebView,
        hostWindow: NSWindow?
    ) -> AssetTrackerHostBridge {
        let bridge = AssetTrackerHostBridge(webView: webView, hostWindow: hostWindow)
        userContentController.add(bridge, name: "assetTrackerHost")
        return bridge
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            message.name == "assetTrackerHost",
            let body = message.body as? [String: Any],
            let requestId = body["id"] as? String,
            let type = body["type"] as? String
        else {
            return
        }

        let payload = body["payload"] as? [String: Any] ?? [:]

        do {
            let result = try handleMessage(type: type, payload: payload)
            sendResponse(id: requestId, ok: true, result: result, error: nil)
        } catch {
            sendResponse(id: requestId, ok: false, result: nil, error: error.localizedDescription)
        }
    }

    private func handleMessage(type: String, payload: [String: Any]) throws -> [String: Any] {
        switch type {
        case "storage.load":
            return try bookStore.load()
        case "storage.save":
            guard let stateJson = payload["stateJson"] as? String else {
                throw AssetTrackerBridgeError.invalidPayload("缺少 stateJson")
            }
            let expectedHash = payload["expectedHash"] as? String
            let schemaVersion = payload["schemaVersion"] as? Int ?? 1
            let reason = payload["reason"] as? String ?? "manual"
            return try bookStore.save(
                stateJson: stateJson,
                expectedHash: expectedHash,
                schemaVersion: schemaVersion,
                reason: reason
            )
        case "file.openImport":
            return try openImportPanel(payload: payload)
        case "file.saveExport":
            return try saveExportFile(payload: payload)
        case "file.revealFolder":
            return try bookStore.revealStorageDirectory()
        default:
            throw AssetTrackerBridgeError.unsupportedMessage(type)
        }
    }

    private func openImportPanel(payload: [String: Any]) throws -> [String: Any] {
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
            return [
                "fileName": url.lastPathComponent,
                "mime": mimeType(for: url),
                "text": fileData.base64EncodedString(),
                "encoding": "base64"
            ]
        }

        guard let text = String(data: fileData, encoding: .utf8) else {
            throw AssetTrackerBridgeError.encodingFailed
        }

        return [
            "fileName": url.lastPathComponent,
            "mime": mimeType(for: url),
            "text": text,
            "encoding": "text"
        ]
    }

    private func saveExportFile(payload: [String: Any]) throws -> [String: Any] {
        guard let suggestedName = payload["suggestedName"] as? String else {
            throw AssetTrackerBridgeError.invalidPayload("缺少 suggestedName")
        }

        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.canCreateDirectories = true

        if panel.runModal() != .OK || panel.url == nil {
            throw AssetTrackerBridgeError.cancelled
        }

        guard let destinationURL = panel.url else {
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

        return [
            "ok": true,
            "fileName": destinationURL.lastPathComponent,
            "path": destinationURL.path
        ]
    }

    private func sendResponse(id: String, ok: Bool, result: [String: Any]?, error: String?) {
        guard let webView else {
            return
        }

        var response: [String: Any] = [
            "id": id,
            "ok": ok
        ]

        if let result {
            response["result"] = result
        }

        if let error {
            response["error"] = error
        }

        guard
            let responseData = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
            let responseJson = String(data: responseData, encoding: .utf8)
        else {
            return
        }

        let javascript = "window.AssetTrackerHost && window.AssetTrackerHost.__handleResponse(\(responseJson));"
        DispatchQueue.main.async {
            webView.evaluateJavaScript(javascript)
        }
    }

    private func mimeType(for url: URL) -> String {
        if let type = UTType(filenameExtension: url.pathExtension), let mimeType = type.preferredMIMEType {
            return mimeType
        }
        return "application/octet-stream"
    }
}

private final class AssetTrackerBookStore {
    private let bundleIdentifier = "com.qiushan.AssetTracker"
    private let fileName = "AssetTrackerBook.json"

    private var storageDirectoryURL: URL {
        let baseURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return baseURL.appendingPathComponent(bundleIdentifier, isDirectory: true)
    }

    private var storageFileURL: URL {
        storageDirectoryURL.appendingPathComponent(fileName, isDirectory: false)
    }

    func load() throws -> [String: Any] {
        try ensureStorageDirectory()

        guard FileManager.default.fileExists(atPath: storageFileURL.path) else {
            return [
                "stateJson": NSNull(),
                "stateHash": "",
                "schemaVersion": 1,
                "updatedAt": NSNull(),
                "storagePath": storageFileURL.path
            ]
        }

        let data = try Data(contentsOf: storageFileURL)
        let stateJson = String(decoding: data, as: UTF8.self)
        let fileAttributes = try FileManager.default.attributesOfItem(atPath: storageFileURL.path)
        let updatedAt = (fileAttributes[.modificationDate] as? Date)?.ISO8601Format()

        return [
            "stateJson": stateJson,
            "stateHash": safeComputeHash(stateJson),
            "schemaVersion": schemaVersion(from: data) ?? 1,
            "updatedAt": updatedAt ?? NSNull(),
            "storagePath": storageFileURL.path
        ]
    }

    func save(
        stateJson: String,
        expectedHash: String?,
        schemaVersion: Int,
        reason: String
    ) throws -> [String: Any] {
        try ensureStorageDirectory()

        if FileManager.default.fileExists(atPath: storageFileURL.path) {
            let currentText = try String(contentsOf: storageFileURL, encoding: .utf8)
            let currentHash = safeComputeHash(currentText)
            if
                let expectedHash,
                !expectedHash.isEmpty,
                currentHash != expectedHash
            {
                throw AssetTrackerBridgeError.staleWrite
            }
        }

        let payloadData = Data(stateJson.utf8)
        let payloadObject = try JSONSerialization.jsonObject(with: payloadData)
        let timestamp = Date().ISO8601Format()
        let storedEnvelope: [String: Any] = [
            "format": "qiushan.asset-book",
            "formatVersion": 1,
            "schemaVersion": schemaVersion,
            "exportedAt": timestamp,
            "source": "macos-app",
            "reason": reason,
            "payload": payloadObject
        ]

        let data = try JSONSerialization.data(withJSONObject: storedEnvelope, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: storageFileURL, options: .atomic)
        let storedText = String(decoding: data, as: UTF8.self)

        return [
            "ok": true,
            "stateHash": safeComputeHash(storedText),
            "updatedAt": timestamp,
            "storagePath": storageFileURL.path
        ]
    }

    func revealStorageDirectory() throws -> [String: Any] {
        try ensureStorageDirectory()
        NSWorkspace.shared.activateFileViewerSelecting([storageDirectoryURL])
        return [
            "path": storageDirectoryURL.path
        ]
    }

    private func ensureStorageDirectory() throws {
        try FileManager.default.createDirectory(
            at: storageDirectoryURL,
            withIntermediateDirectories: true,
            attributes: nil
        )
    }

    private func schemaVersion(from data: Data) -> Int? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let schemaVersion = object["schemaVersion"] as? Int
        else {
            return nil
        }

        return schemaVersion
    }

    private func safeComputeHash(_ text: String) -> String {
        var hash: UInt32 = 2_166_136_261
        for scalar in text.unicodeScalars {
            hash ^= UInt32(scalar.value)
            hash = hash &+ (hash << 1)
            hash = hash &+ (hash << 4)
            hash = hash &+ (hash << 7)
            hash = hash &+ (hash << 8)
            hash = hash &+ (hash << 24)
        }
        return "h" + String(hash, radix: 16)
    }
}
