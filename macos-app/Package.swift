// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "AssetTrackerMac",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "AssetTracker",
            targets: ["AssetTrackerMac"]
        )
    ],
    targets: [
        .executableTarget(
            name: "AssetTrackerMac",
            path: "Sources/AssetTrackerMac"
        )
    ]
)

