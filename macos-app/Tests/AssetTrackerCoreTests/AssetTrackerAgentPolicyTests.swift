import XCTest
@testable import AssetTrackerCore

final class AssetTrackerAgentPolicyTests: XCTestCase {
    func testLoopbackEndpointsAreBoundedToProviderOperations() throws {
        XCTAssertEqual(try AssetTrackerAgentPolicy.endpoint(baseURL: "http://127.0.0.1:11434", provider: "ollama", location: "device", operation: "models").absoluteString, "http://127.0.0.1:11434/api/tags")
        XCTAssertEqual(try AssetTrackerAgentPolicy.endpoint(baseURL: "http://localhost:1234/v1", provider: "compatible", location: "device", operation: "chat").absoluteString, "http://localhost:1234/v1/chat/completions")
    }
    func testUnsafeTargetsAndArbitraryOperationsAreRejected() {
        for url in ["file:///etc/passwd", "http://192.168.1.1", "http://u:p@localhost", "http://localhost?token=x", "http://localhost/#x"] {
            XCTAssertThrowsError(try AssetTrackerAgentPolicy.endpoint(baseURL: url, provider: "ollama", location: "device", operation: "chat"))
        }
        XCTAssertThrowsError(try AssetTrackerAgentPolicy.endpoint(baseURL: "http://localhost", provider: "ollama", location: "device", operation: "delete"))
        XCTAssertThrowsError(try AssetTrackerAgentPolicy.endpoint(baseURL: "https://127.0.0.1", provider: "compatible", location: "cloud", operation: "chat"))
    }
    func testCloudRequiresHTTPSAndPreservesOnlyTheConfiguredPrefix() throws {
        XCTAssertEqual(try AssetTrackerAgentPolicy.endpoint(baseURL: "https://models.example.com/v1", provider: "compatible", location: "cloud", operation: "chat").path, "/v1/chat/completions")
        XCTAssertThrowsError(try AssetTrackerAgentPolicy.endpoint(baseURL: "http://models.example.com", provider: "compatible", location: "cloud", operation: "chat"))
    }
}
