import Darwin
import Foundation
import XCTest

final class ProcessKillRecoveryTests: XCTestCase {
    private let timeout: TimeInterval = 5

    func testHarnessStrictRequestAndReceiptMarker() throws {
        let fixture = try ProcessFixture()
        defer { fixture.remove() }

        let malformedURL = try fixture.writeRequest([
            "version": 1,
            "operation": "save",
            "clientSaveId": "malformed-save",
            "expectedHash": NSNull(),
            "stateJson": "{\"memo\":\"H0\"}",
            "reason": "manual",
            "extra": true,
        ])
        let malformed = try runHarness([
            "mutate", "--root", fixture.rootURL.path,
            "--request", malformedURL.path,
        ])
        XCTAssertNotEqual(malformed.status, 0)
        XCTAssertTrue(malformed.lines.isEmpty)

        let validURL = try fixture.writeSaveRequest(
            clientSaveID: "strict-save",
            expectedHash: nil,
            stateJSON: "{\"memo\":\"H0\"}"
        )
        let incompleteSelector = try runHarness([
            "mutate", "--root", fixture.rootURL.path,
            "--request", validURL.path,
            "--fault-point", "beforeRename",
        ])
        XCTAssertNotEqual(incompleteSelector.status, 0)
        XCTAssertTrue(incompleteSelector.lines.isEmpty)

        let receipt = try completeSave(
            fixture: fixture,
            clientSaveID: "strict-save",
            expectedHash: nil,
            stateJSON: "{\"memo\":\"H0\"}"
        )
        XCTAssertEqual(Set(receipt.keys), [
            "event", "clientSaveId", "stateHashAfter", "durability",
        ])
        XCTAssertEqual(receipt["event"] as? String, "receipt")
        XCTAssertEqual(receipt["clientSaveId"] as? String, "strict-save")
        XCTAssertEqual(receipt["durability"] as? String, "native-durable")
        let h0 = try XCTUnwrap(receipt["stateHashAfter"] as? String)
        try assertCanonicalHash(h0)

        let badGateURL = try fixture.writeSaveRequest(
            clientSaveID: "bad-gate",
            expectedHash: h0,
            stateJSON: "{\"memo\":\"not-written\"}"
        )
        let badGate = try launchHarness([
            "mutate", "--root", fixture.rootURL.path,
            "--request", badGateURL.path,
            "--rendezvous-after-confirm",
        ])
        defer { badGate.forceKill() }
        let ready = try badGate.nextMarker(timeout: timeout)
        try assertReady(ready, clientSaveID: "bad-gate", sourceHash: h0)
        try badGate.sendLine("NOT-GO\n")
        XCTAssertTrue(badGate.waitForExit(timeout: timeout), badGate.diagnostics)
        XCTAssertNotEqual(badGate.terminationStatus, 0)
        XCTAssertTrue(badGate.allLines().isEmpty)
        let verification = try verify(fixture)
        XCTAssertEqual(try markerObject(verification, "post")["primaryHash"] as? String, h0)
    }

    func testPrimaryPreAndPostRenameKillsReopenWithoutPartialBytes() throws {
        for point in ["beforeRename", "afterRename"] {
            let fixture = try ProcessFixture()
            defer { fixture.remove() }
            let initial = try completeSave(
                fixture: fixture,
                clientSaveID: "seed-\(point)",
                expectedHash: nil,
                stateJSON: "{\"memo\":\"H0\"}"
            )
            let h0 = try XCTUnwrap(initial["stateHashAfter"] as? String)
            let requestURL = try fixture.writeSaveRequest(
                clientSaveID: "save-\(point)",
                expectedHash: h0,
                stateJSON: "{\"memo\":\"H1-\(point)\"}"
            )
            let child = try launchHarness([
                "mutate", "--root", fixture.rootURL.path,
                "--request", requestURL.path,
                "--fault-point", point,
                "--fault-role", "primary",
            ])
            defer { child.forceKill() }

            let marker = try child.nextMarker(timeout: timeout)
            XCTAssertEqual(Set(marker.keys), ["event", "point", "role", "targetName"])
            XCTAssertEqual(marker["event"] as? String, "fault-point")
            XCTAssertEqual(marker["point"] as? String, point)
            XCTAssertEqual(marker["role"] as? String, "primary")
            XCTAssertEqual(marker["targetName"] as? String, "AssetTrackerBook.json")
            child.forceKill()
            XCTAssertTrue(child.waitForExit(timeout: timeout), child.diagnostics)
            XCTAssertEqual(child.terminationReason, .uncaughtSignal)
            XCTAssertEqual(child.terminationStatus, SIGKILL)

            let verification = try verify(fixture)
            let post = try markerObject(verification, "post")
            let primaryHash = try XCTUnwrap(post["primaryHash"] as? String)
            try assertCanonicalHash(primaryHash)
            XCTAssertEqual(post["primaryJSONValid"] as? Bool, true)
            XCTAssertGreaterThan(try XCTUnwrap(post["primaryByteCount"] as? Int), 0)
            if point == "beforeRename" {
                XCTAssertEqual(primaryHash, h0)
            } else {
                XCTAssertNotEqual(primaryHash, h0)
            }
            XCTAssertEqual(post["recoveryHealthComplete"] as? Bool, true)
        }
    }

    func testSnapshotFinalIndexKillKeepsPrimaryAndFreshAuditAvailable() throws {
        let fixture = try ProcessFixture()
        defer { fixture.remove() }
        let initial = try completeSave(
            fixture: fixture,
            clientSaveID: "snapshot-seed",
            expectedHash: nil,
            stateJSON: "{\"memo\":\"H0\"}"
        )
        let h0 = try XCTUnwrap(initial["stateHashAfter"] as? String)
        let requestURL = try fixture.writeSnapshotRequest(
            clientSnapshotID: "snapshot-kill",
            expectedHash: h0
        )
        let child = try launchHarness([
            "mutate", "--root", fixture.rootURL.path,
            "--request", requestURL.path,
            "--fault-point", "afterRename",
            "--fault-role", "snapshotFinalIndex",
        ])
        defer { child.forceKill() }

        let marker = try child.nextMarker(timeout: timeout)
        XCTAssertEqual(marker["event"] as? String, "fault-point")
        XCTAssertEqual(marker["point"] as? String, "afterRename")
        XCTAssertEqual(marker["role"] as? String, "snapshotFinalIndex")
        XCTAssertEqual(marker["targetName"] as? String, "Recovery/snapshots/index.json")
        child.forceKill()
        XCTAssertTrue(child.waitForExit(timeout: timeout), child.diagnostics)
        XCTAssertEqual(child.terminationReason, .uncaughtSignal)
        XCTAssertEqual(child.terminationStatus, SIGKILL)

        let verification = try verify(fixture)
        let post = try markerObject(verification, "post")
        XCTAssertEqual(post["primaryHash"] as? String, h0)
        XCTAssertEqual(post["primaryJSONValid"] as? Bool, true)
        XCTAssertEqual(post["recoveryHealthComplete"] as? Bool, true)
        let snapshotHealth = try markerObject(post, "snapshotHealth")
        XCTAssertEqual(snapshotHealth["domain"] as? String, "snapshot")
        XCTAssertEqual(snapshotHealth["auditComplete"] as? Bool, true)
        XCTAssertEqual(post["snapshotIndexPresent"] as? Bool, true)
    }

    func testTwoConfirmedH0ChildrenRaceInsideMutationLock() throws {
        let fixture = try ProcessFixture()
        defer { fixture.remove() }
        let initial = try completeSave(
            fixture: fixture,
            clientSaveID: "race-seed",
            expectedHash: nil,
            stateJSON: "{\"memo\":\"H0\"}"
        )
        let h0 = try XCTUnwrap(initial["stateHashAfter"] as? String)
        let firstURL = try fixture.writeSaveRequest(
            clientSaveID: "race-a",
            expectedHash: h0,
            stateJSON: "{\"memo\":\"A\"}"
        )
        let secondURL = try fixture.writeSaveRequest(
            clientSaveID: "race-b",
            expectedHash: h0,
            stateJSON: "{\"memo\":\"B\"}"
        )
        let first = try launchHarness([
            "mutate", "--root", fixture.rootURL.path,
            "--request", firstURL.path,
            "--rendezvous-after-confirm",
        ])
        let second = try launchHarness([
            "mutate", "--root", fixture.rootURL.path,
            "--request", secondURL.path,
            "--rendezvous-after-confirm",
        ])
        defer {
            first.forceKill()
            second.forceKill()
        }

        let firstReady = try first.nextMarker(timeout: timeout)
        let secondReady = try second.nextMarker(timeout: timeout)
        try assertReady(firstReady, clientSaveID: "race-a", sourceHash: h0)
        try assertReady(secondReady, clientSaveID: "race-b", sourceHash: h0)

        try first.sendGO()
        try second.sendGO()
        let firstFinal = try first.nextMarker(timeout: timeout)
        let secondFinal = try second.nextMarker(timeout: timeout)
        XCTAssertTrue(first.waitForExit(timeout: timeout), first.diagnostics)
        XCTAssertTrue(second.waitForExit(timeout: timeout), second.diagnostics)

        let finals = [firstFinal, secondFinal]
        let receipts = finals.filter { $0["event"] as? String == "receipt" }
        let errors = finals.filter { $0["event"] as? String == "error" }
        XCTAssertEqual(receipts.count, 1)
        XCTAssertEqual(errors.count, 1)
        let winnerHash = try XCTUnwrap(receipts.first?["stateHashAfter"] as? String)
        try assertCanonicalHash(winnerHash)

        let error = try XCTUnwrap(errors.first)
        XCTAssertEqual(Set(error.keys), ["event", "operation", "error"])
        XCTAssertEqual(error["operation"] as? String, "save")
        let proof = try markerObject(error, "error")
        XCTAssertEqual(Set(proof.keys), [
            "code", "message", "writeOutcome", "conflict", "clientSaveId",
            "payloadHash", "sourceHashAfter", "sourceReverified",
            "coordinatorReleased", "healthPersisted", "recoveryHealthEvidence",
        ])
        XCTAssertEqual(proof["code"] as? String, "source-conflict")
        XCTAssertEqual(proof["writeOutcome"] as? String, "not-committed")
        XCTAssertEqual(proof["conflict"] as? String, "source-changed")
        XCTAssertEqual(proof["sourceHashAfter"] as? String, winnerHash)
        XCTAssertEqual(proof["sourceReverified"] as? Bool, true)
        XCTAssertEqual(proof["coordinatorReleased"] as? Bool, true)

        let verification = try verify(fixture)
        let post = try markerObject(verification, "post")
        XCTAssertEqual(post["primaryHash"] as? String, winnerHash)
        XCTAssertEqual(post["primaryJSONValid"] as? Bool, true)
        XCTAssertEqual(post["recoveryHealthComplete"] as? Bool, true)
    }

    private func assertReady(
        _ marker: [String: Any],
        clientSaveID: String,
        sourceHash: String
    ) throws {
        XCTAssertEqual(Set(marker.keys), [
            "event", "operation", "clientSaveId", "sourceHash",
        ])
        XCTAssertEqual(marker["event"] as? String, "ready-after-confirm")
        XCTAssertEqual(marker["operation"] as? String, "save")
        XCTAssertEqual(marker["clientSaveId"] as? String, clientSaveID)
        XCTAssertEqual(marker["sourceHash"] as? String, sourceHash)
    }

    private func completeSave(
        fixture: ProcessFixture,
        clientSaveID: String,
        expectedHash: String?,
        stateJSON: String
    ) throws -> [String: Any] {
        let requestURL = try fixture.writeSaveRequest(
            clientSaveID: clientSaveID,
            expectedHash: expectedHash,
            stateJSON: stateJSON
        )
        let result = try runHarness([
            "mutate", "--root", fixture.rootURL.path,
            "--request", requestURL.path,
        ])
        XCTAssertEqual(result.status, 0, result.stderr)
        XCTAssertEqual(result.lines.count, 1, result.stderr)
        return try decodeMarker(XCTUnwrap(result.lines.first))
    }

    private func verify(_ fixture: ProcessFixture) throws -> [String: Any] {
        let result = try runHarness(["verify", "--root", fixture.rootURL.path])
        XCTAssertEqual(result.status, 0, result.stderr)
        XCTAssertEqual(result.lines.count, 1, result.stderr)
        let marker = try decodeMarker(XCTUnwrap(result.lines.first))
        XCTAssertEqual(Set(marker.keys), ["event", "pre", "post"])
        XCTAssertEqual(marker["event"] as? String, "verification")
        return marker
    }

    private func launchHarness(_ arguments: [String]) throws -> HarnessProcess {
        try HarnessProcess(executableURL: try harnessURL(), arguments: arguments)
    }

    private func runHarness(_ arguments: [String]) throws -> HarnessResult {
        let child = try launchHarness(arguments)
        defer { child.forceKill() }
        let exited = child.waitForExit(timeout: timeout)
        if !exited {
            let diagnostics = child.diagnostics
            child.forceKill()
            XCTFail("UNREACHED_FAULT_POINT \(diagnostics)")
        }
        return HarnessResult(
            status: child.terminationStatus,
            lines: child.allLines(),
            stderr: child.stderrText
        )
    }

    private func harnessURL() throws -> URL {
        let path = try XCTUnwrap(
            ProcessInfo.processInfo.environment["ASSET_TRACKER_FAULT_HARNESS"],
            "ASSET_TRACKER_FAULT_HARNESS must name the built harness"
        )
        let url = URL(fileURLWithPath: path)
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: path), path)
        return url
    }
}

private struct HarnessResult {
    let status: Int32
    let lines: [String]
    let stderr: String
}

private final class HarnessProcess {
    private let process = Process()
    private let input = Pipe()
    private let output = Pipe()
    private let error = Pipe()
    private let reader: LineReader

    init(executableURL: URL, arguments: [String]) throws {
        reader = LineReader(handle: output.fileHandleForReading)
        process.executableURL = executableURL
        process.arguments = arguments
        process.standardInput = input
        process.standardOutput = output
        process.standardError = error
        try process.run()
        output.fileHandleForWriting.closeFile()
        error.fileHandleForWriting.closeFile()
    }

    var terminationStatus: Int32 { process.terminationStatus }
    var terminationReason: Process.TerminationReason { process.terminationReason }

    var diagnostics: String {
        "pid=\(process.processIdentifier) running=\(process.isRunning) stdout=\(reader.snapshot())"
    }

    var stderrText: String {
        String(data: error.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    }

    func nextMarker(timeout: TimeInterval) throws -> [String: Any] {
        guard let line = reader.nextLine(timeout: timeout) else {
            throw ProcessHarnessTestError.markerTimeout(diagnostics)
        }
        return try decodeMarker(line)
    }

    func sendGO() throws {
        try sendLine("GO\n")
    }

    func sendLine(_ line: String) throws {
        try input.fileHandleForWriting.write(contentsOf: Data(line.utf8))
    }

    func waitForExit(timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning, Date() < deadline {
            usleep(10_000)
        }
        return !process.isRunning
    }

    func forceKill() {
        if process.isRunning {
            Darwin.kill(process.processIdentifier, SIGKILL)
            _ = waitForExit(timeout: 1)
        }
        try? input.fileHandleForWriting.close()
    }

    func allLines() -> [String] {
        reader.waitForEOF(timeout: 1)
        return reader.snapshot()
    }
}

private final class LineReader: @unchecked Sendable {
    private let condition = NSCondition()
    private var lines: [String] = []
    private var reachedEOF = false

    init(handle: FileHandle) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            var buffer = Data()
            do {
                while let byte = try handle.read(upToCount: 1), !byte.isEmpty {
                    if byte[byte.startIndex] == 0x0a {
                        guard let line = String(data: buffer, encoding: .utf8) else {
                            self.finishEOF()
                            return
                        }
                        self.append(line)
                        buffer.removeAll(keepingCapacity: true)
                    } else {
                        buffer.append(byte)
                    }
                }
            } catch {
                // The process diagnostic path owns reporting malformed/closed output.
            }
            self.finishEOF()
        }
    }

    func nextLine(timeout: TimeInterval) -> String? {
        let deadline = Date().addingTimeInterval(timeout)
        condition.lock()
        defer { condition.unlock() }
        while lines.isEmpty, !reachedEOF {
            guard condition.wait(until: deadline) else { return nil }
        }
        return lines.isEmpty ? nil : lines.removeFirst()
    }

    func waitForEOF(timeout: TimeInterval) {
        let deadline = Date().addingTimeInterval(timeout)
        condition.lock()
        defer { condition.unlock() }
        while !reachedEOF {
            guard condition.wait(until: deadline) else { return }
        }
    }

    func snapshot() -> [String] {
        condition.lock()
        defer { condition.unlock() }
        return lines
    }

    private func append(_ line: String) {
        condition.lock()
        lines.append(line)
        condition.broadcast()
        condition.unlock()
    }

    private func finishEOF() {
        condition.lock()
        reachedEOF = true
        condition.broadcast()
        condition.unlock()
    }
}

private struct ProcessFixture {
    let baseURL: URL
    let rootURL: URL

    init() throws {
        baseURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("AssetTrackerProcessKillTests-\(UUID().uuidString)", isDirectory: true)
        rootURL = baseURL.appendingPathComponent("Storage", isDirectory: true)
        try FileManager.default.createDirectory(at: baseURL, withIntermediateDirectories: false)
    }

    func writeSaveRequest(
        clientSaveID: String,
        expectedHash: String?,
        stateJSON: String
    ) throws -> URL {
        try writeRequest([
            "version": 1,
            "operation": "save",
            "clientSaveId": clientSaveID,
            "expectedHash": expectedHash ?? NSNull(),
            "stateJson": stateJSON,
            "reason": "manual",
        ])
    }

    func writeSnapshotRequest(clientSnapshotID: String, expectedHash: String) throws -> URL {
        try writeRequest([
            "version": 1,
            "operation": "snapshot",
            "clientSnapshotId": clientSnapshotID,
            "expectedHash": expectedHash,
            "stateJson": NSNull(),
            "reason": "manual",
        ])
    }

    func writeRequest(_ object: [String: Any]) throws -> URL {
        let url = baseURL.appendingPathComponent("request-\(UUID().uuidString).json")
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        try data.write(to: url)
        return url
    }

    func remove() {
        guard FileManager.default.fileExists(atPath: baseURL.path) else { return }
        if let enumerator = FileManager.default.enumerator(
            at: baseURL,
            includingPropertiesForKeys: nil,
            options: [],
            errorHandler: nil
        ) {
            for case let url as URL in enumerator {
                _ = Darwin.chflags(url.path, 0)
            }
        }
        _ = Darwin.chflags(baseURL.path, 0)
        try? FileManager.default.removeItem(at: baseURL)
    }
}

private enum ProcessHarnessTestError: Error {
    case markerTimeout(String)
    case invalidMarker(String)
}

private func decodeMarker(_ line: String) throws -> [String: Any] {
    guard let data = line.data(using: .utf8),
          let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          object["event"] is String else {
        throw ProcessHarnessTestError.invalidMarker(line)
    }
    return object
}

private func markerObject(_ marker: [String: Any], _ key: String) throws -> [String: Any] {
    guard let object = marker[key] as? [String: Any] else {
        throw ProcessHarnessTestError.invalidMarker("missing object \(key): \(marker)")
    }
    return object
}

private func assertCanonicalHash(_ value: String) throws {
    XCTAssertEqual(value.utf8.count, 64)
    XCTAssertTrue(value.utf8.allSatisfy { byte in
        (48...57).contains(byte) || (97...102).contains(byte)
    })
}
