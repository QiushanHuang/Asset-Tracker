import Foundation

public protocol AssetTrackerBookStoreIO: Sendable {
    func load() -> AssetTrackerRawBookLoadResult
    func save(
        stateJson: String,
        schemaVersion: Int,
        reason: String
    ) throws -> AssetTrackerBookSaveResult
    func exportRawBook(
        expectedHash: String,
        to destinationURL: URL
    ) throws -> AssetTrackerRawExportResult
}

public protocol AssetTrackerRawIOExecuting: Sendable {
    func execute(_ work: @escaping @Sendable () -> Void)
}

public enum AssetTrackerStorageActivity: Equatable, Sendable {
    case idle
    case loading(operationID: String)
    case saveReading(operationID: String)
    case saveWriting(operationID: String)
    case exporting(operationID: String)
}

public enum AssetTrackerStorageCoordinatorError: Error, Equatable, LocalizedError {
    case busy
    case staleOperation
    case invalidOperationID
    case generationExhausted
    case cancelled

    public var errorDescription: String? {
        switch self {
        case .busy:
            return "另一个账本存储操作正在进行"
        case .staleOperation:
            return "账本存储操作已过期"
        case .invalidOperationID:
            return "账本存储操作标识无效"
        case .generationExhausted:
            return "账本存储操作世代已耗尽"
        case .cancelled:
            return "账本存储操作已取消"
        }
    }
}

public struct AssetTrackerStorageLoadResult: Equatable, Sendable {
    public let loadID: String
    public let book: AssetTrackerRawBookLoadResult

    public init(loadID: String, book: AssetTrackerRawBookLoadResult) {
        self.loadID = loadID
        self.book = book
    }
}

public struct AssetTrackerStorageSaveRequest: Equatable, Sendable {
    public let authorization: AssetTrackerSaveAuthorization
    public let stateJson: String
    public let schemaVersion: Int
    public let reason: String

    public init(
        authorization: AssetTrackerSaveAuthorization,
        stateJson: String,
        schemaVersion: Int,
        reason: String
    ) {
        self.authorization = authorization
        self.stateJson = stateJson
        self.schemaVersion = schemaVersion
        self.reason = reason
    }
}

public final class AssetTrackerSerialRawIOExecutor: AssetTrackerRawIOExecuting, @unchecked Sendable {
    private let queue: DispatchQueue

    public init(
        label: String = "com.qiushan.AssetTracker.raw-io",
        qos: DispatchQoS = .userInitiated
    ) {
        self.queue = DispatchQueue(label: label, qos: qos)
    }

    public func execute(_ work: @escaping @Sendable () -> Void) {
        queue.async(execute: work)
    }
}

private struct AssetTrackerUncheckedError: @unchecked Sendable {
    let value: Error
}

private struct AssetTrackerStorageOperation: Sendable {
    let operationID: String
    let generation: UInt64
}

@MainActor
public final class AssetTrackerStorageCoordinator {
    public typealias LoadCompletion = @MainActor (Result<AssetTrackerStorageLoadResult, Error>) -> Void
    public typealias SaveCompletion = @MainActor (Result<AssetTrackerBookSaveResult, Error>) -> Void
    public typealias ExportCompletion = @MainActor (Result<AssetTrackerRawExportResult, Error>) -> Void
    public typealias TerminalizationCompletion = @MainActor (
        Result<AssetTrackerTerminalizationAcknowledgement, Error>
    ) -> Void

    public private(set) var activity: AssetTrackerStorageActivity = .idle
    public let writeGate: AssetTrackerLegacyWriteGate

    private let store: AssetTrackerBookStoreIO
    private let rawIOExecutor: AssetTrackerRawIOExecuting
    private let operationIDGenerator: () -> String
    private var operationGeneration: UInt64
    private var activeOperationGeneration: UInt64?

    private var loadCompletion: LoadCompletion?
    private var saveCompletion: SaveCompletion?
    private var exportCompletion: ExportCompletion?
    private struct PendingTerminalization {
        let request: AssetTrackerTerminalizationRequest
        var completions: [TerminalizationCompletion]
    }
    private var pendingTerminalization: PendingTerminalization?

    public init(
        store: AssetTrackerBookStoreIO,
        rawIOExecutor: AssetTrackerRawIOExecuting = AssetTrackerSerialRawIOExecutor(),
        writeGate: AssetTrackerLegacyWriteGate = AssetTrackerLegacyWriteGate(),
        operationIDGenerator: @escaping () -> String = { UUID().uuidString.lowercased() },
        initialOperationGeneration: UInt64 = 0
    ) {
        self.store = store
        self.rawIOExecutor = rawIOExecutor
        self.writeGate = writeGate
        self.operationIDGenerator = operationIDGenerator
        self.operationGeneration = initialOperationGeneration
    }

    @discardableResult
    public func startLoad(
        retry: Bool,
        completion: @escaping LoadCompletion
    ) throws -> String {
        let operation = try beginOperation()
        loadCompletion = completion
        activity = .loading(operationID: operation.operationID)

        let store = self.store
        rawIOExecutor.execute { [weak self] in
            let result = store.load()
            Task { @MainActor [weak self] in
                self?.receiveLoad(result, retry: retry, operation: operation)
            }
        }
        return operation.operationID
    }

    public func confirmLoad(
        protocolVersion: Int?,
        loadID: String,
        outcome: AssetTrackerLoadConfirmationOutcome,
        reason: String?,
        validatedSourceHash: String?
    ) throws -> AssetTrackerLoadConfirmation {
        try requireAvailableForNewOperation()
        return try writeGate.confirm(
            protocolVersion: protocolVersion,
            loadID: loadID,
            outcome: outcome,
            reason: reason,
            validatedSourceHash: validatedSourceHash
        )
    }

    public func terminalize(
        _ request: AssetTrackerTerminalizationRequest,
        completion: @escaping TerminalizationCompletion
    ) throws {
        if let acknowledgement = try writeGate.preflightTerminalization(request) {
            completion(.success(acknowledgement))
            return
        }

        if pendingTerminalization != nil {
            pendingTerminalization?.completions.append(completion)
            finishPendingTerminalizationIfPossible()
            return
        }

        pendingTerminalization = PendingTerminalization(
            request: request,
            completions: [completion]
        )
        switch activity {
        case .idle:
            finishPendingTerminalizationIfPossible()
        case .loading:
            cancelLoadForPendingTerminalization()
        case .saveReading:
            cancelSaveReadForPendingTerminalization()
        case .saveWriting, .exporting:
            break
        }
    }

    @discardableResult
    public func startSave(
        request: AssetTrackerStorageSaveRequest,
        completion: @escaping SaveCompletion
    ) throws -> String {
        try requireAvailableForNewOperation()
        try writeGate.preflightSave(request.authorization)
        let operation = try beginOperation()
        saveCompletion = completion
        activity = .saveReading(operationID: operation.operationID)

        let store = self.store
        rawIOExecutor.execute { [weak self] in
            let currentSource = store.load()
            Task { @MainActor [weak self] in
                self?.receiveSaveRead(
                    currentSource,
                    request: request,
                    operation: operation
                )
            }
        }
        return operation.operationID
    }

    @discardableResult
    public func startRawExport(
        expectedHash: String,
        destinationURL: URL,
        completion: @escaping ExportCompletion
    ) throws -> String {
        let operation = try beginOperation(allowTerminalLock: true)
        exportCompletion = completion
        activity = .exporting(operationID: operation.operationID)

        let store = self.store
        rawIOExecutor.execute { [weak self] in
            do {
                let exported = try store.exportRawBook(
                    expectedHash: expectedHash,
                    to: destinationURL
                )
                Task { @MainActor [weak self] in
                    self?.receiveRawExportSuccess(exported, operation: operation)
                }
            } catch {
                let error = AssetTrackerUncheckedError(value: error)
                Task { @MainActor [weak self] in
                    self?.receiveRawExportFailure(error.value, operation: operation)
                }
            }
        }
        return operation.operationID
    }

    public func cancelOperation(operationID: String) throws {
        switch activity {
        case .loading(let currentID) where currentID == operationID:
            let completion = loadCompletion
            loadCompletion = nil
            activeOperationGeneration = nil
            activity = .idle
            completion?(.failure(AssetTrackerStorageCoordinatorError.cancelled))
        case .saveReading(let currentID) where currentID == operationID:
            let completion = saveCompletion
            saveCompletion = nil
            activeOperationGeneration = nil
            activity = .idle
            completion?(.failure(AssetTrackerStorageCoordinatorError.cancelled))
        case .saveWriting(let currentID) where currentID == operationID,
             .exporting(let currentID) where currentID == operationID:
            throw AssetTrackerStorageCoordinatorError.busy
        default:
            throw AssetTrackerStorageCoordinatorError.staleOperation
        }
    }

    private func receiveLoad(
        _ result: AssetTrackerRawBookLoadResult,
        retry: Bool,
        operation: AssetTrackerStorageOperation
    ) {
        guard isActive(operation, activity: .loading(operationID: operation.operationID)) else { return }
        let completion = loadCompletion
        loadCompletion = nil
        let loadID = writeGate.registerLoad(result, retry: retry)
        activeOperationGeneration = nil
        activity = .idle
        completion?(.success(AssetTrackerStorageLoadResult(loadID: loadID, book: result)))
    }

    private func receiveSaveRead(
        _ currentSource: AssetTrackerRawBookLoadResult,
        request: AssetTrackerStorageSaveRequest,
        operation: AssetTrackerStorageOperation
    ) {
        guard isActive(operation, activity: .saveReading(operationID: operation.operationID)) else { return }

        do {
            try writeGate.authorizeSave(request.authorization, currentSource: currentSource)
        } catch {
            finishSaveFailure(error, operation: operation)
            return
        }

        activity = .saveWriting(operationID: operation.operationID)
        let store = self.store
        rawIOExecutor.execute { [weak self] in
            do {
                let result = try store.save(
                    stateJson: request.stateJson,
                    schemaVersion: request.schemaVersion,
                    reason: request.reason
                )
                Task { @MainActor [weak self] in
                    self?.receiveSaveSuccess(result, operation: operation)
                }
            } catch {
                let error = AssetTrackerUncheckedError(value: error)
                Task { @MainActor [weak self] in
                    self?.receiveSaveFailure(error.value, operation: operation)
                }
            }
        }
    }

    private func receiveSaveSuccess(
        _ result: AssetTrackerBookSaveResult,
        operation: AssetTrackerStorageOperation
    ) {
        guard isActive(operation, activity: .saveWriting(operationID: operation.operationID)) else { return }
        do {
            try writeGate.recordSuccessfulSave(newRawHash: result.rawHash)
        } catch {
            finishSaveFailure(error, operation: operation)
            return
        }

        let completion = saveCompletion
        saveCompletion = nil
        activeOperationGeneration = nil
        activity = .idle
        completion?(.success(result))
        finishPendingTerminalizationIfPossible()
    }

    private func receiveSaveFailure(_ error: Error, operation: AssetTrackerStorageOperation) {
        guard isActive(operation, activity: .saveWriting(operationID: operation.operationID)) else { return }
        finishSaveFailure(error, operation: operation)
    }

    private func finishSaveFailure(_ error: Error, operation: AssetTrackerStorageOperation) {
        let isCurrent: Bool
        switch activity {
        case .saveReading(let currentID), .saveWriting(let currentID):
            isCurrent = currentID == operation.operationID && activeOperationGeneration == operation.generation
        default:
            isCurrent = false
        }
        guard isCurrent else { return }

        let completion = saveCompletion
        saveCompletion = nil
        activeOperationGeneration = nil
        activity = .idle
        completion?(.failure(error))
        finishPendingTerminalizationIfPossible()
    }

    private func receiveRawExportSuccess(
        _ result: AssetTrackerRawExportResult,
        operation: AssetTrackerStorageOperation
    ) {
        guard isActive(operation, activity: .exporting(operationID: operation.operationID)) else { return }
        let completion = exportCompletion
        exportCompletion = nil
        activeOperationGeneration = nil
        activity = .idle
        completion?(.success(result))
        finishPendingTerminalizationIfPossible()
    }

    private func receiveRawExportFailure(_ error: Error, operation: AssetTrackerStorageOperation) {
        guard isActive(operation, activity: .exporting(operationID: operation.operationID)) else { return }
        let completion = exportCompletion
        exportCompletion = nil
        activeOperationGeneration = nil
        activity = .idle
        completion?(.failure(error))
        finishPendingTerminalizationIfPossible()
    }

    private func beginOperation(
        allowTerminalLock: Bool = false
    ) throws -> AssetTrackerStorageOperation {
        if allowTerminalLock {
            try requireIdleWithoutPendingTerminalization()
        } else {
            try requireAvailableForNewOperation()
        }
        let operationID = operationIDGenerator()
        guard !operationID.isEmpty else {
            throw AssetTrackerStorageCoordinatorError.invalidOperationID
        }
        guard operationGeneration < .max else {
            throw AssetTrackerStorageCoordinatorError.generationExhausted
        }
        operationGeneration += 1
        activeOperationGeneration = operationGeneration
        return AssetTrackerStorageOperation(
            operationID: operationID,
            generation: operationGeneration
        )
    }

    private func requireIdle() throws {
        guard activity == .idle, activeOperationGeneration == nil else {
            throw AssetTrackerStorageCoordinatorError.busy
        }
    }

    private func requireAvailableForNewOperation() throws {
        try requireIdleWithoutPendingTerminalization()
        if case .terminalLocked = writeGate.state {
            throw AssetTrackerWriteGateError.terminalLocked
        }
    }

    private func requireIdleWithoutPendingTerminalization() throws {
        guard pendingTerminalization == nil else {
            throw AssetTrackerStorageCoordinatorError.busy
        }
        try requireIdle()
    }

    private func cancelLoadForPendingTerminalization() {
        guard case .loading = activity else { return }
        let completion = loadCompletion
        loadCompletion = nil
        activeOperationGeneration = nil
        activity = .idle
        completion?(.failure(AssetTrackerStorageCoordinatorError.cancelled))
        finishPendingTerminalizationIfPossible()
    }

    private func cancelSaveReadForPendingTerminalization() {
        guard case .saveReading = activity else { return }
        let completion = saveCompletion
        saveCompletion = nil
        activeOperationGeneration = nil
        activity = .idle
        completion?(.failure(AssetTrackerStorageCoordinatorError.cancelled))
        finishPendingTerminalizationIfPossible()
    }

    private func finishPendingTerminalizationIfPossible() {
        guard
            activity == .idle,
            activeOperationGeneration == nil,
            let pending = pendingTerminalization,
            !pending.completions.isEmpty
        else {
            return
        }

        do {
            let acknowledgement = try writeGate.terminalize(pending.request)
            pendingTerminalization = nil
            for completion in pending.completions {
                completion(.success(acknowledgement))
            }
        } catch {
            pendingTerminalization?.completions.removeAll()
            for completion in pending.completions {
                completion(.failure(error))
            }
        }
    }

    private func isActive(
        _ operation: AssetTrackerStorageOperation,
        activity expectedActivity: AssetTrackerStorageActivity
    ) -> Bool {
        activity == expectedActivity && activeOperationGeneration == operation.generation
    }
}
