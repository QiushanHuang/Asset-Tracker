import Foundation
import XCTest
@testable import AssetTrackerCore

final class AssetTrackerPagePolicyTests: XCTestCase {
    let entry = URL(fileURLWithPath: "/Applications/Asset Tracker.app/Contents/Resources/Web/index.html")

    func testOnlyBundledEntryCanAccessTheNativeBridge() {
        XCTAssertTrue(AssetTrackerPagePolicy.allows(entry, entryURL: entry))
        XCTAssertTrue(AssetTrackerPagePolicy.allows(URL(string: entry.absoluteString + "#transactions"), entryURL: entry))
        for candidate in ["https://example.com/index.html", "file:///tmp/index.html", "about:blank", "data:text/html,hello", "file:///Applications/Asset%20Tracker.app/Contents/Resources/Web/other.html"] {
            XCTAssertFalse(AssetTrackerPagePolicy.allows(URL(string: candidate), entryURL: entry))
        }
        XCTAssertFalse(AssetTrackerPagePolicy.allows(nil, entryURL: entry))
    }
}
