import Darwin
import XCTest
@testable import AssetTrackerCore

@_silgen_name("flock")
private func workspaceTestFlock(_ descriptor: Int32, _ operation: Int32) -> Int32

final class AssetTrackerWorkspaceStoreTests: XCTestCase {
    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory
    }

    func testCompareAndSaveRejectsStaleOtherStoreSnapshot() throws {
        let directory = try temporaryDirectory()
        let first = AssetTrackerWorkspaceStore(directoryURL: directory)
        let second = AssetTrackerWorkspaceStore(directoryURL: directory)
        let firstSource = try first.rawText()
        let secondSource = try second.rawText()
        let saved = "{\"drafts\":[{\"id\":\"pending-one\"}]}"

        try first.compareAndSave(saved, expected: firstSource)
        XCTAssertThrowsError(try second.compareAndSave("{\"prefs\":{\"theme\":\"dark\"}}", expected: secondSource))
        XCTAssertEqual(try second.rawText(), saved)
    }

    func testResetPreservesMalformedRawBytesBeforeReplacingWorkspace() throws {
        let directory = try temporaryDirectory()
        let file = directory.appendingPathComponent("Workspace-v1.json")
        let original = Data("{\r\n\"drafts\":[\"e\u{301}\"],\"broken\":".utf8)
        try original.write(to: file)
        let ledger = directory.appendingPathComponent("AssetTrackerBook.json")
        let ledgerBytes = Data("formal-ledger-must-stay-exact".utf8)
        try ledgerBytes.write(to: ledger)
        let store = AssetTrackerWorkspaceStore(directoryURL: directory)
        let raw = try store.rawText()
        XCTAssertEqual(Data(raw.utf8), original)
        XCTAssertThrowsError(try store.load())

        let backup = try store.resetPreservingOriginal(expected: raw)
        XCTAssertFalse(backup.isEmpty)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: backup)), original)
        XCTAssertEqual(try store.load(), "{}")
        XCTAssertEqual(try Data(contentsOf: ledger), ledgerBytes)
        let permissions = try FileManager.default.attributesOfItem(atPath: backup)[.posixPermissions] as? NSNumber
        XCTAssertEqual(permissions?.intValue, 0o600)

        try original.write(to: file)
        let secondBackup = try store.resetPreservingOriginal(expected: raw)
        XCTAssertNotEqual(backup, secondBackup)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: backup)), original)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: secondBackup)), original)
    }

    func testResetRejectsStaleSourceWithoutCreatingRecoveryCopy() throws {
        let directory = try temporaryDirectory()
        let file = directory.appendingPathComponent("Workspace-v1.json")
        try Data("{broken".utf8).write(to: file)
        let store = AssetTrackerWorkspaceStore(directoryURL: directory)
        XCTAssertThrowsError(try store.resetPreservingOriginal(expected: "{}"))
        XCTAssertEqual(try store.rawText(), "{broken")
        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertFalse(files.contains { $0.hasPrefix("Workspace-recovery-") })
    }

    func testComparisonUsesExactUTF8NotCanonicalUnicodeEquivalence() throws {
        let directory = try temporaryDirectory()
        let store = AssetTrackerWorkspaceStore(directoryURL: directory)
        let saved = "{\"memo\":\"\u{e9}\"}"
        let differentBytes = "{\"memo\":\"e\u{301}\"}"
        XCTAssertEqual(saved, differentBytes)
        XCTAssertNotEqual(Data(saved.utf8), Data(differentBytes.utf8))
        try store.save(saved)
        XCTAssertThrowsError(try store.compareAndSave("{}", expected: differentBytes))
        XCTAssertThrowsError(try store.resetPreservingOriginal(expected: differentBytes))
        XCTAssertEqual(Data(try store.rawText().utf8), Data(saved.utf8))
    }

    func testWorkspaceAndLockSymlinksCannotRedirectReadsOrWrites() throws {
        let directory = try temporaryDirectory()
        let protectedFile = directory.appendingPathComponent("protected.json")
        let protectedBytes = Data("{\"protected\":true}".utf8)
        try protectedBytes.write(to: protectedFile)
        let file = directory.appendingPathComponent("Workspace-v1.json")
        let store = AssetTrackerWorkspaceStore(directoryURL: directory)
        try FileManager.default.createSymbolicLink(at: file, withDestinationURL: protectedFile)
        XCTAssertThrowsError(try store.rawText())
        XCTAssertThrowsError(try store.compareAndSave("{}", expected: String(decoding: protectedBytes, as: UTF8.self)))
        XCTAssertThrowsError(try store.resetPreservingOriginal(expected: "{}"))
        XCTAssertEqual(try Data(contentsOf: protectedFile), protectedBytes)

        try FileManager.default.removeItem(at: file)
        let lock = directory.appendingPathComponent(".Workspace-v1.lock")
        if FileManager.default.fileExists(atPath: lock.path) { try FileManager.default.removeItem(at: lock) }
        try FileManager.default.createSymbolicLink(at: lock, withDestinationURL: protectedFile)
        XCTAssertThrowsError(try store.compareAndSave("{}", expected: "{}"))
        XCTAssertThrowsError(try store.resetPreservingOriginal(expected: "{}"))
        XCTAssertEqual(try Data(contentsOf: protectedFile), protectedBytes)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testContendedFilesystemLockFailsPromptlyWithoutChangingWorkspace() throws {
        let directory = try temporaryDirectory()
        let store = AssetTrackerWorkspaceStore(directoryURL: directory)
        try store.save("{}")
        let lock = directory.appendingPathComponent(".Workspace-v1.lock")
        let descriptor = Darwin.open(lock.path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        XCTAssertGreaterThanOrEqual(descriptor, 0)
        guard descriptor >= 0 else { return }
        defer { _ = workspaceTestFlock(descriptor, LOCK_UN); Darwin.close(descriptor) }
        XCTAssertEqual(workspaceTestFlock(descriptor, LOCK_EX | LOCK_NB), 0)
        let start = Date()
        XCTAssertThrowsError(try store.compareAndSave("{\"drafts\":[]}", expected: "{}"))
        XCTAssertThrowsError(try store.resetPreservingOriginal(expected: "{}"))
        XCTAssertLessThan(Date().timeIntervalSince(start), 2)
        XCTAssertEqual(try store.rawText(), "{}")
    }

    func testUnreadableUTF8AndOversizedSourcesAreNeverReplaced() throws {
        let directory = try temporaryDirectory()
        let file = directory.appendingPathComponent("Workspace-v1.json")
        let store = AssetTrackerWorkspaceStore(directoryURL: directory)
        for bytes in [Data([0xff]), Data(repeating: 0x20, count: 2 * 1024 * 1024 + 1)] {
            try bytes.write(to: file)
            XCTAssertThrowsError(try store.rawText())
            XCTAssertThrowsError(try store.compareAndSave("{}", expected: "{}"))
            XCTAssertThrowsError(try store.resetPreservingOriginal(expected: "{}"))
            XCTAssertEqual(try Data(contentsOf: file), bytes)
        }
    }

    func testAuxiliaryStateSurvivesReopenWithoutTouchingBook() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let ledger = directory.appendingPathComponent("AssetTrackerBook.json")
        try Data("formal-book".utf8).write(to: ledger)
        let store = AssetTrackerWorkspaceStore(directoryURL: directory)
        let json = "{\"prefs\":{\"theme\":\"dark\"},\"drafts\":[]}"
        try store.save(json)
        XCTAssertEqual(try AssetTrackerWorkspaceStore(directoryURL: directory).load(), json)
        XCTAssertEqual(try String(contentsOf: ledger), "formal-book")
    }
    func testSecretAndMalformedPayloadCannotReplaceSavedState() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = AssetTrackerWorkspaceStore(directoryURL: directory)
        try store.save("{}")
        XCTAssertThrowsError(try store.save("{\"connection\":{\"apiKey\":\"secret\"}}"))
        XCTAssertThrowsError(try store.save("not-json"))
        XCTAssertEqual(try store.load(), "{}")
    }
}
