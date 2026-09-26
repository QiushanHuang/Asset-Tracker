import AssetTrackerCore
import Foundation
import LocalAuthentication
import Security

private final class AgentNoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor
final class AssetTrackerAgentService {
    private let credentialScope: String
    private var tasks: [String: Task<String, Error>] = [:]
    private var earlyCancellations: Set<String> = []
    init(credentialScope: String) { self.credentialScope = credentialScope }
    private func failure(_ text: String) -> Error { NSError(domain: "AssetTrackerAgent", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    private func endpoint(_ connection: [String: Any], operation: String) throws -> URL {
        try AssetTrackerAgentPolicy.endpoint(baseURL: connection["baseURL"] as? String ?? "", provider: connection["provider"] as? String ?? "", location: connection["location"] as? String ?? "", operation: operation)
    }
    private func keyQuery(_ connection: [String: Any]) throws -> [String: Any] {
        let url = try endpoint(connection, operation: "models")
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.qiushan.AssetTracker.agent", kSecAttrAccount as String: credentialScope + "|" + url.absoluteString]
    }
    func storeKey(connection: [String: Any], key: String) throws {
        guard key.utf8.count <= 8192, !key.contains("\n"), !key.contains("\r") else { throw failure("API 密钥格式无效") }
        let query = try keyQuery(connection)
        if key.isEmpty { let status = SecItemDelete(query as CFDictionary); if status != errSecSuccess && status != errSecItemNotFound { throw failure("无法清除钥匙串密钥") }; return }
        let data = Data(key.utf8)
        let updated = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if updated == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw failure("无法保存钥匙串密钥") }
        } else if updated != errSecSuccess { throw failure("无法更新钥匙串密钥") }
    }
    private func readKey(connection: [String: Any]) throws -> String? {
        var query = try keyQuery(connection)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        // A request may not trigger a background Keychain authentication dialog.
        let authentication = LAContext()
        authentication.interactionNotAllowed = true
        query[kSecUseAuthenticationContext as String] = authentication
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw failure("钥匙串当前不可用，请在连接设置中重新保存密钥") }
        return String(data: data, encoding: .utf8)
    }
    func cancel(_ runID: String) {
        if let task = tasks[runID] { task.cancel() }
        else if earlyCancellations.count < 100 { earlyCancellations.insert(runID) }
    }
    func request(_ payload: [String: Any]) async throws -> String {
        guard let connection = payload["connection"] as? [String: Any], let operation = payload["operation"] as? String,
              let runID = payload["runId"] as? String, runID.count <= 180, !runID.isEmpty, tasks[runID] == nil else { throw failure("模型请求参数无效") }
        if earlyCancellations.remove(runID) != nil { throw failure("已取消") }
        guard tasks.count < 2 else { throw failure("已有模型任务正在执行") }
        let url = try endpoint(connection, operation: operation)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25)
        request.httpMethod = operation == "models" ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let key = try readKey(connection: connection), !key.isEmpty { request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization") }
        if operation == "chat" {
            guard let body = payload["body"] as? [String: Any], body["stream"] as? Bool == false,
                  let model = body["model"] as? String, !model.isEmpty, model.count <= 160,
                  let messages = body["messages"] as? [[String: Any]], (1...8).contains(messages.count), body["tools"] == nil else { throw failure("模型任务结构无效") }
            let data = try JSONSerialization.data(withJSONObject: body)
            guard data.count <= 65536 else { throw failure("模型输入过大，请缩小范围") }
            request.httpBody = data
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 25
        configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration, delegate: AgentNoRedirect(), delegateQueue: nil)
        let task = Task<String, Error> {
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw self.failure("模型服务返回 \((response as? HTTPURLResponse)?.statusCode ?? 0)，请检查连接与授权")
            }
            var data = Data()
            for try await byte in bytes {
                try Task.checkCancellation()
                guard data.count < 2 * 1024 * 1024 else { throw self.failure("模型响应过大") }
                data.append(byte)
            }
            _ = try JSONSerialization.jsonObject(with: data)
            guard let text = String(data: data, encoding: .utf8) else { throw self.failure("模型响应编码无效") }
            return text
        }
        tasks[runID] = task
        defer { tasks.removeValue(forKey: runID); session.invalidateAndCancel() }
        do { return try await task.value }
        catch is CancellationError { throw failure("已取消") }
        catch let error as URLError where error.code == .cancelled { throw failure("已取消") }
        catch let error as URLError where error.code == .timedOut { throw failure("模型响应超时，草稿尚未入账") }
        catch { throw error }
    }
}
