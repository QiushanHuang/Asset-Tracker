import Foundation

public enum AssetTrackerAgentPolicy {
    public static func endpoint(baseURL: String, provider: String, location: String, operation: String) throws -> URL {
        func fail(_ text: String) -> NSError { NSError(domain: "AssetTrackerAgent", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
        guard ["ollama", "compatible"].contains(provider), ["device", "cloud"].contains(location), ["models", "chat"].contains(operation),
              let parts = URLComponents(string: baseURL), let scheme = parts.scheme?.lowercased(), let host = parts.host?.lowercased(),
              ["http", "https"].contains(scheme), parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil else {
            throw fail("模型连接地址或操作无效")
        }
        let loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)
        if location == "device" && !loopback { throw fail("本机模型仅允许回环地址") }
        let pieces = host.split(separator: ".").compactMap { Int($0) }
        let privateIP = pieces.count == 4 && (pieces[0] == 10 || pieces[0] == 127 || pieces[0] == 0 || pieces[0] == 169 && pieces[1] == 254 || pieces[0] == 192 && pieces[1] == 168 || pieces[0] == 172 && (16...31).contains(pieces[1]))
        if location == "cloud" && (scheme != "https" || loopback || privateIP || host.contains(":")) { throw fail("云端模型须使用公开 HTTPS 地址") }
        if provider == "ollama" && !["", "/"].contains(parts.path) { throw fail("Ollama 请填写服务根地址") }
        var result = parts
        var prefix = parts.path
        while prefix.hasSuffix("/") { prefix.removeLast() }
        if provider == "compatible" && prefix.isEmpty { prefix = "/v1" }
        result.path = prefix + (provider == "ollama" ? (operation == "models" ? "/api/tags" : "/api/chat") : (operation == "models" ? "/models" : "/chat/completions"))
        guard let url = result.url else { throw fail("模型地址无效") }
        return url
    }
}
