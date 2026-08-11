// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "AssetTrackerMac",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "AssetTrackerCore",
            targets: ["AssetTrackerCore"]
        ),
        .executable(
            name: "AssetTracker",
            targets: ["AssetTrackerMac"]
        ),
        .executable(
            name: "AssetTrackerFaultHarness",
            targets: ["AssetTrackerFaultHarness"]
        )
    ],
    targets: [
        .target(
            name: "AssetTrackerCore",
            path: "Sources/AssetTrackerCore"
        ),
        .executableTarget(
            name: "AssetTrackerMac",
            dependencies: ["AssetTrackerCore"],
            path: "Sources/AssetTrackerMac"
        ),
        .executableTarget(
            name: "AssetTrackerFaultHarness",
            dependencies: ["AssetTrackerCore"],
            path: "Sources/AssetTrackerFaultHarness"
        ),
        .testTarget(
            name: "AssetTrackerCoreTests",
            dependencies: ["AssetTrackerCore"],
            path: "Tests/AssetTrackerCoreTests"
        )
    ]
)
