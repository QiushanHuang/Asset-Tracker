const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const expectedWebAssets = [
    'index.html',
    'styles.css',
    'legacy-safety.js',
    'script.js',
    'vendor/chart.umd.min.js',
    'vendor/xlsx.full.min.js'
];

function mustExist(relativePath) {
    const fullPath = path.join(root, relativePath);
    assert.ok(fs.existsSync(fullPath), `${relativePath} should exist`);
    return fs.readFileSync(fullPath, 'utf8');
}

function sourceBetween(source, startToken, endToken) {
    const start = source.indexOf(startToken);
    const end = source.indexOf(endToken, start + startToken.length);
    assert.notEqual(start, -1, `${startToken} should exist`);
    assert.notEqual(end, -1, `${endToken} should follow ${startToken}`);
    return source.slice(start, end);
}

function readBytes(relativePath) {
    return fs.readFileSync(path.join(root, relativePath));
}

function readManifestEntries() {
    const manifest = mustExist('script/web-assets.manifest');
    const entries = manifest.split(/\r?\n/);
    if (entries.at(-1) === '') {
        entries.pop();
    }
    return entries;
}

function listRelativeFiles(directory, prefix = '') {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        assert.equal(entry.isSymbolicLink(), false, `${relativePath} must not be a symlink`);
        if (entry.isDirectory()) {
            files.push(...listRelativeFiles(path.join(directory, entry.name), relativePath));
        } else {
            files.push(relativePath);
        }
    }
    return files;
}

function writeFixtureFile(fixtureRoot, relativePath, contents) {
    const fullPath = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
}

function createSyncFixture(t, { manifestEntries, sources, targetFiles = [] }) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-tracker-web-sync-'));
    t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

    const fixtureScript = path.join(fixtureRoot, 'script/sync_web_assets.sh');
    fs.mkdirSync(path.dirname(fixtureScript), { recursive: true });
    fs.copyFileSync(path.join(root, 'script/sync_web_assets.sh'), fixtureScript);

    writeFixtureFile(
        fixtureRoot,
        'script/web-assets.manifest',
        `${manifestEntries.join('\n')}\n`
    );
    for (const [relativePath, contents] of sources) {
        writeFixtureFile(fixtureRoot, relativePath, contents);
    }
    for (const [relativePath, contents] of targetFiles) {
        writeFixtureFile(fixtureRoot, `macos-app/Resources/Web/${relativePath}`, contents);
    }

    const stagingRoot = path.join(fixtureRoot, 'macos-app/Resources/Web');
    fs.mkdirSync(stagingRoot, { recursive: true });
    return { fixtureRoot, fixtureScript, stagingRoot };
}

test('macOS wrapper scaffold exists', () => {
    const packageManifest = mustExist('macos-app/Package.swift');
    const appSource = mustExist('macos-app/Sources/AssetTrackerMac/main.swift');
    const bridgeSource = mustExist('macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift');
    const runtimeScript = mustExist('script/build_and_run.sh');
    const distScript = mustExist('script/build-macos-unofficial.sh');
    const envConfig = mustExist('.codex/environments/environment.toml');

    assert.match(packageManifest, /name:\s*"AssetTrackerMac"/);
    assert.match(appSource, /WKWebView/);
    assert.match(bridgeSource, /storage\.load/);
    assert.match(bridgeSource, /file\.saveExport/);
    assert.match(runtimeScript, /swift build/);
    assert.match(distScript, /AssetTracker\.app/);
    assert.match(envConfig, /build_and_run\.sh/);
});

test('the legacy safety module loads before the application runtime', () => {
    const indexHtml = mustExist('index.html');
    const safetyIndex = indexHtml.indexOf('<script src="legacy-safety.js"></script>');
    const applicationIndex = indexHtml.indexOf('<script src="script.js"></script>');

    assert.notEqual(safetyIndex, -1);
    assert.notEqual(applicationIndex, -1);
    assert.ok(safetyIndex < applicationIndex);
});

test('Swift package exposes a core library and a real test target', () => {
    const packageManifest = mustExist('macos-app/Package.swift');
    const coreSource = mustExist('macos-app/Sources/AssetTrackerCore/AssetTrackerCore.swift');
    const coreTests = mustExist('macos-app/Tests/AssetTrackerCoreTests/AssetTrackerCoreTests.swift');

    assert.match(packageManifest, /\.library\(\s*name:\s*"AssetTrackerCore"/s);
    assert.match(packageManifest, /\.executableTarget\(\s*name:\s*"AssetTrackerMac",\s*dependencies:\s*\["AssetTrackerCore"\]/s);
    assert.match(packageManifest, /\.testTarget\(\s*name:\s*"AssetTrackerCoreTests",\s*dependencies:\s*\["AssetTrackerCore"\]/s);
    assert.doesNotMatch(coreSource, /\bmoduleName\b/);
    assert.match(coreTests, /^import AssetTrackerCore$/m);
    assert.doesNotMatch(coreTests, /@testable import|\bmoduleName\b/);
});

test('the native raw book store and protocol-v2 write gate live in Core', () => {
    const storeSource = mustExist('macos-app/Sources/AssetTrackerCore/AssetTrackerBookStore.swift');

    assert.match(storeSource, /public (?:final )?(?:class|struct) AssetTrackerBookStore/);
    assert.match(storeSource, /public final class AssetTrackerLegacyWriteGate/);
    assert.match(storeSource, /import CryptoKit/);
});

test('the macOS bridge owns the Core protocol-v2 gate and receives an explicit final storage root', () => {
    const bridgeSource = mustExist('macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift');
    const appSource = mustExist('macos-app/Sources/AssetTrackerMac/main.swift');

    assert.match(bridgeSource, /^import AssetTrackerCore$/m);
    assert.doesNotMatch(bridgeSource, /private final class AssetTrackerBookStore/);
    assert.match(bridgeSource, /private let bookStore: AssetTrackerBookStore/);
    assert.match(bridgeSource, /private let storageCoordinator: AssetTrackerStorageCoordinator/);
    assert.match(bridgeSource, /private let rawIOExecutor: AssetTrackerSerialRawIOExecutor/);
    assert.doesNotMatch(bridgeSource, /private let writeGate: AssetTrackerLegacyWriteGate/);
    assert.match(bridgeSource, /@MainActor\s+final class AssetTrackerHostBridge/);
    assert.match(bridgeSource, /AssetTrackerStorageCoordinator\(\s*store:\s*bookStore,\s*rawIOExecutor:\s*rawIOExecutor/s);
    assert.match(bridgeSource, /case "storage\.confirmLoad":/);
    assert.match(bridgeSource, /case "storage\.save":\s*handleStorageSave/);
    assert.match(bridgeSource, /case "file\.saveRawBook":\s*handleRawBookExport/);
    assert.match(bridgeSource, /protocolVersion:\s*protocolVersion/);
    assert.match(bridgeSource, /storageCoordinator\.startLoad/);
    assert.match(bridgeSource, /storageCoordinator\.startSave/);
    assert.match(bridgeSource, /storageCoordinator\.startRawExport/);
    assert.match(bridgeSource, /storageCoordinator\.confirmLoad/);
    assert.match(bridgeSource, /AssetTrackerBridgeResponsePipeline/);
    assert.doesNotMatch(bridgeSource, /rawIOExecutor\.execute/);
    assert.doesNotMatch(bridgeSource, /bookStore\.(?:load|save|exportRawBook)\(/);
    assert.doesNotMatch(bridgeSource, /JSONSerialization\.data\(withJSONObject:/);
    assert.match(bridgeSource, /webView\?\.evaluateJavaScript\(javascript\)/);

    assert.match(appSource, /^import AssetTrackerCore$/m);
    assert.match(appSource, /for:\s*\.applicationSupportDirectory/);
    assert.match(appSource, /appendingPathComponent\(\s*"com\.qiushan\.AssetTracker",\s*isDirectory:\s*true\s*\)/);
    assert.match(appSource, /AssetTrackerBookStore\(storageDirectoryURL:\s*storageDirectoryURL\)/);
    assert.match(appSource, /bookStore:\s*bookStore/);
});

test('macOS bridge routes strict durable save and snapshot requests through the coordinator', () => {
    const bridgeSource = mustExist('macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift');

    assert.match(bridgeSource, /case "storage\.save":\s*handleStorageSave/);
    assert.match(bridgeSource, /case "storage\.snapshot":\s*handleStorageSnapshot/);
    assert.match(bridgeSource, /AssetTrackerNativeBridgeRequestParser\.durableSave/);
    assert.match(bridgeSource, /AssetTrackerNativeBridgeRequestParser\.snapshot/);
    assert.match(bridgeSource, /storageCoordinator\.startSave\(request:\s*request\)/);
    assert.match(bridgeSource, /storageCoordinator\.startSnapshot\(request:\s*request\)/);
    assert.match(bridgeSource, /AssetTrackerNativeBridgeDTOMapper\.saveReceipt/);
    assert.match(bridgeSource, /AssetTrackerNativeBridgeDTOMapper\.snapshotReceipt/);
    assert.match(bridgeSource, /\.saveFailure\(/);
    assert.match(bridgeSource, /\.snapshotFailure\(/);
    assert.doesNotMatch(bridgeSource, /storageSaveRequest\(/);
    assert.doesNotMatch(bridgeSource, /schemaVersion.*\?\?\s*1/);
    assert.doesNotMatch(bridgeSource, /case\s+\.final/);
});

test('macOS bridge routes storage.snapshot through the shared coordinator', () => {
    const host = mustExist('macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift');
    const coordinator = mustExist('macos-app/Sources/AssetTrackerCore/AssetTrackerStorageCoordinator.swift');
    const snapshotHandler = sourceBetween(
        host,
        'private func handleStorageSnapshot',
        'private func handleStorageTerminalize'
    );

    assert.match(host, /case "storage\.snapshot":\s*handleStorageSnapshot/);
    assert.equal((host.match(/AssetTrackerStorageCoordinator\(/g) || []).length, 1);
    assert.match(snapshotHandler, /AssetTrackerNativeBridgeRequestParser\.snapshot/);
    assert.match(snapshotHandler, /storageCoordinator\.startSnapshot\(request:\s*request\)/);
    assert.doesNotMatch(snapshotHandler, /bookStore\.snapshot|AssetTrackerStorageCoordinator\(/);
    assert.match(coordinator, /public func startSnapshot\(/);
    assert.match(coordinator, /let result = try store\.snapshot\(request\)/);
    assert.doesNotMatch(host, /case\s+\.final\b/);
});

test('macOS bridge maps save snapshot health and terminal DTOs without defaults', () => {
    const bridge = mustExist('macos-app/Sources/AssetTrackerCore/AssetTrackerBridgeResponse.swift');
    const host = mustExist('macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift');

    assert.match(bridge, /public static func saveReceipt\(/);
    assert.match(bridge, /public static func snapshotReceipt\(/);
    assert.match(bridge, /public static func saveFailure\(/);
    assert.match(bridge, /public static func snapshotFailure\(/);
    assert.match(bridge, /public static func loadSuccess\(/);
    assert.match(bridge, /public static func terminalizationSuccess\(/);
    for (const field of [
        'domain',
        'status',
        'auditComplete',
        'code',
        'maintenancePendingCount',
        'detail'
    ]) {
        assert.match(bridge, new RegExp(`"${field}"`));
    }
    assert.match(host, /AssetTrackerNativeBridgeDTOMapper\.saveReceipt/);
    assert.match(host, /AssetTrackerNativeBridgeDTOMapper\.snapshotReceipt/);
    assert.match(host, /\.loadSuccess\(requestID:\s*requestID,\s*loaded:\s*loaded\)/s);
    assert.match(
        host,
        /\.terminalizationSuccess\(\s*requestID:\s*requestID,\s*request:\s*request,\s*acknowledgement:/s
    );
    assert.doesNotMatch(host, /schemaVersion.*\?\?\s*1/);
    assert.doesNotMatch(host, /NativeSnapshotReason[^\n]*\?\?/);
});

test('macOS bridge preserves updatedAt and canonical storagePath as metadata only', () => {
    const bridge = mustExist('macos-app/Sources/AssetTrackerCore/AssetTrackerBridgeResponse.swift');
    const coreTests = mustExist('macos-app/Tests/AssetTrackerCoreTests/AssetTrackerBookStoreTests.swift');
    const jsTests = mustExist('tests/data-recovery.test.js');
    const saveMapper = sourceBetween(
        bridge,
        'public static func saveReceipt',
        'public static func snapshotReceipt'
    );

    assert.match(saveMapper, /"updatedAt":\s*\.string\(verifiedTimestamp\(receipt\.updatedAt\)\)/);
    assert.match(saveMapper, /"storagePath":\s*\.string\(receipt\.storagePath\)/);
    assert.match(saveMapper, /"sourceHashBefore":\s*receipt\.sourceHashBefore/);
    assert.match(saveMapper, /"stateHashAfter":\s*\.string\(receipt\.stateHashAfter\)/);
    assert.doesNotMatch(saveMapper, /Date\(\)|storagePath[^\n]*\?\?|updatedAt[^\n]*\?\?/);
    assert.match(coreTests, /testNativeBridgeDTOMapperPreservesReceiptsAndStructuredErrorProofsWithoutDefaults/);
    assert.match(jsTests, /native strict save maps only queue-owned fields and returns a protected exact receipt without fallback/);
    assert.match(jsTests, /updatedAt:\s*'native-wire-time'/);
    assert.match(jsTests, /storagePath:\s*'\/native\/wire\/path'/);
});

test('snapshot classification uses operation-specific index commit points rather than primary rename', () => {
    const writer = mustExist('macos-app/Sources/AssetTrackerCore/NativeDurableFileWriter.swift');
    const recovery = mustExist('macos-app/Sources/AssetTrackerCore/AssetTrackerRecoveryStore.swift');
    const host = mustExist('macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift');
    const snapshotImplementation = sourceBetween(
        recovery,
        'public func createSnapshot',
        'public func auditSnapshot'
    );

    assert.match(writer, /case afterSnapshotIndexDurable/);
    assert.match(writer, /case snapshotEmptyIndex, snapshotFinalIndex, snapshotHealthIndex/);
    assert.match(snapshotImplementation, /\.afterSnapshotBlobDurable/);
    assert.match(snapshotImplementation, /\.afterSnapshotIndexDurable/);
    assert.match(snapshotImplementation, /role:\s*\.snapshotFinalIndex/);
    assert.match(snapshotImplementation, /targetName:\s*Self\.snapshotIndexPath/);
    assert.doesNotMatch(snapshotImplementation, /primaryRenamed|afterPrimaryRename/);
    assert.doesNotMatch(host, /primaryRenamed|afterPrimaryRename/);
});

test('cross-layer item 55 binds terminal ACK delivery to the already-locked gate', () => {
    const jsTests = mustExist('tests/data-recovery.test.js');
    const coreTests = mustExist('macos-app/Tests/AssetTrackerCoreTests/AssetTrackerBookStoreTests.swift');
    const bookStore = mustExist('macos-app/Sources/AssetTrackerCore/AssetTrackerBookStore.swift');
    const coordinator = mustExist('macos-app/Sources/AssetTrackerCore/AssetTrackerStorageCoordinator.swift');
    const bridge = mustExist('macos-app/Sources/AssetTrackerCore/AssetTrackerBridgeResponse.swift');
    const host = mustExist('macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift');
    const terminalFinish = sourceBetween(
        coordinator,
        'private func finishPendingTerminalizationIfPossible',
        'private func isActive'
    );

    assert.match(jsTests, /queue strict terminalize maps session fields and returns only the protected exact receipt/);
    assert.match(jsTests, /strict terminal receipt binds load and stable reason taxonomy without requiring current reason equality/);
    assert.match(coreTests, /testTerminalizeDuringSaveWritingWaitsForSuccessfulWriteThenACKsFirstReason/);
    for (const reason of [
        'save-not-committed',
        'save-outcome-unknown',
        'save-conflict',
        'snapshot-outcome-unknown',
        'snapshot-conflict',
        'candidate-invalid',
        'queue-callback-failed'
    ]) {
        assert.match(bookStore, new RegExp(`"${reason}"`));
    }
    assert.ok(
        terminalFinish.indexOf('writeGate.terminalize(pending.request)')
            < terminalFinish.indexOf('completion(.success(acknowledgement))')
    );
    for (const field of ['protocolVersion', 'loadId', 'reason', 'gateState']) {
        assert.match(bridge, new RegExp(`"${field}"`));
    }
    assert.match(bridge, /"gateState":\s*\.string\("terminal-locked"\)/);
    assert.match(host, /\.terminalizationSuccess\(/);
});

test('cross-layer item 56 binds dual audited native load health to strict JS confirmation', () => {
    const jsTests = mustExist('tests/data-recovery.test.js');
    const coreTests = mustExist('macos-app/Tests/AssetTrackerCoreTests/AssetTrackerBookStoreTests.swift');
    const bridge = mustExist('macos-app/Sources/AssetTrackerCore/AssetTrackerBridgeResponse.swift');
    const host = mustExist('macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift');

    assert.match(jsTests, /native load round-trips complete dual health and exact hash time and path evidence/);
    assert.match(jsTests, /native load permits false plus both null and rejects missing malformed or contradictory health/);
    assert.match(coreTests, /testLoadReturnsBothAuditedHealthDomainsOrMarksBothUnavailable/);
    assert.match(coreTests, /testLoadBridgeResponseCarriesCompleteDualHealthWithoutDefaults/);
    assert.match(bridge, /"recoveryHealthComplete":\s*\.bool\(book\.recoveryHealthComplete\)/);
    assert.match(bridge, /"ordinaryRecoveryHealth":\s*book\.ordinaryRecoveryHealth/);
    assert.match(bridge, /"snapshotRecoveryHealth":\s*book\.snapshotRecoveryHealth/);
    assert.match(host, /responsePipeline\.send\(\.loadSuccess\(requestID:\s*requestID,\s*loaded:\s*loaded\)\)/);
});

test('cross-layer item 57 binds Core receipt metadata through Bridge to JS without defaults', () => {
    const jsTests = mustExist('tests/data-recovery.test.js');
    const coreTests = mustExist('macos-app/Tests/AssetTrackerCoreTests/AssetTrackerBookStoreTests.swift');
    const bridge = mustExist('macos-app/Sources/AssetTrackerCore/AssetTrackerBridgeResponse.swift');
    const host = mustExist('macos-app/Sources/AssetTrackerMac/AssetTrackerHostBridge.swift');
    const saveMapper = sourceBetween(
        bridge,
        'public static func saveReceipt',
        'public static func snapshotReceipt'
    );

    assert.match(jsTests, /native strict save maps only queue-owned fields and returns a protected exact receipt without fallback/);
    assert.match(jsTests, /native adapter rejects success receipts that are not correlated to their strict request/);
    assert.match(coreTests, /testNativeBridgeDTOMapperPreservesReceiptsAndStructuredErrorProofsWithoutDefaults/);
    assert.match(coreTests, /"updatedAt":\s*\.string\("2024-08-30T06:40:00\.125Z"\)/);
    assert.match(coreTests, /"storagePath":\s*\.string\("\/tmp\/AssetTrackerBook\.json"\)/);
    assert.match(saveMapper, /"updatedAt":\s*\.string\(verifiedTimestamp\(receipt\.updatedAt\)\)/);
    assert.match(saveMapper, /"storagePath":\s*\.string\(receipt\.storagePath\)/);
    assert.match(host, /AssetTrackerNativeBridgeDTOMapper\.saveReceipt\(saved\)/);
    assert.doesNotMatch(saveMapper, /updatedAt[^\n]*\?\?|storagePath[^\n]*\?\?|Date\(\)/);
});

test('the Web asset manifest is explicit, unique, relative, and complete', () => {
    const manifestPath = path.join(root, 'script/web-assets.manifest');
    const entries = readManifestEntries();

    assert.equal(fs.lstatSync(manifestPath).isSymbolicLink(), false);
    assert.deepEqual(entries, expectedWebAssets);
    assert.equal(new Set(entries).size, entries.length);

    for (const entry of entries) {
        assert.notEqual(entry, '');
        assert.doesNotMatch(entry, /\s/);
        assert.equal(path.isAbsolute(entry), false);
        assert.equal(entry.split('/').includes('..'), false);

        const sourcePath = path.resolve(root, entry);
        assert.equal(sourcePath.startsWith(`${path.resolve(root)}${path.sep}`), true);
        assert.equal(fs.existsSync(sourcePath), true, `${entry} should exist at the project root`);
        const sourceStats = fs.lstatSync(sourcePath);
        assert.equal(sourceStats.isSymbolicLink(), false, `${entry} must not be a symlink`);
        assert.equal(sourceStats.isFile(), true, `${entry} must be a regular file`);
    }
});

test('the Web asset sync validates its manifest and exact local target before cleanup', () => {
    const syncPath = path.join(root, 'script/sync_web_assets.sh');
    const syncScript = mustExist('script/sync_web_assets.sh');
    const syntaxCheck = spawnSync('bash', ['-n', syncPath], { encoding: 'utf8' });

    assert.equal(syntaxCheck.status, 0, syntaxCheck.stderr);
    assert.match(syncScript, /MANIFEST_PATH="\$ROOT_DIR\/script\/web-assets\.manifest"/);
    assert.match(syncScript, /WEB_STAGING_DIR="\$ROOT_DIR\/macos-app\/Resources\/Web"/);
    assert.match(syncScript, /while IFS= read -r asset/);
    assert.match(syncScript, /for asset in "\$\{ASSETS\[@\]\}"/);
    assert.match(syncScript, /mkdir -p "\$\(dirname "\$destination"\)"/);

    const cleanupIndex = syncScript.indexOf('rm -rf "$WEB_STAGING_DIR"');
    const manifestValidationIndex = syncScript.indexOf('while IFS= read -r asset');
    const symlinkGuardIndex = syncScript.indexOf('if [[ -L "$WEB_STAGING_DIR" ]]');
    const containmentGuardIndex = syncScript.indexOf('if [[ "$RESOLVED_WEB_STAGING_DIR" != "$WEB_STAGING_DIR" ]]');

    assert.notEqual(cleanupIndex, -1);
    assert.ok(manifestValidationIndex >= 0 && manifestValidationIndex < cleanupIndex);
    assert.ok(symlinkGuardIndex >= 0 && symlinkGuardIndex < cleanupIndex);
    assert.ok(containmentGuardIndex >= 0 && containmentGuardIndex < cleanupIndex);
});

test('the Web asset sync runs under system Bash and copies the exact isolated fixture', (t) => {
    const indexBytes = Buffer.from('<!doctype html>\nfixture\n');
    const vendorBytes = Buffer.from([0x00, 0x01, 0x7f, 0xff]);
    const { fixtureScript, stagingRoot } = createSyncFixture(t, {
        manifestEntries: ['index.html', 'vendor/app.bin'],
        sources: [
            ['index.html', indexBytes],
            ['vendor/app.bin', vendorBytes]
        ],
        targetFiles: [['obsolete.txt', Buffer.from('remove me')]]
    });

    const result = spawnSync('/bin/bash', [fixtureScript], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(listRelativeFiles(stagingRoot).sort(), ['index.html', 'vendor/app.bin']);
    assert.deepEqual(fs.readFileSync(path.join(stagingRoot, 'index.html')), indexBytes);
    assert.deepEqual(fs.readFileSync(path.join(stagingRoot, 'vendor/app.bin')), vendorBytes);
});

test('the Web asset sync rejects a duplicate manifest before changing isolated target bytes', (t) => {
    const sentinelBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const { fixtureScript, stagingRoot } = createSyncFixture(t, {
        manifestEntries: ['index.html', 'index.html'],
        sources: [['index.html', Buffer.from('fixture source')]],
        targetFiles: [['sentinel.bin', sentinelBytes]]
    });

    const result = spawnSync('/bin/bash', [fixtureScript], { encoding: 'utf8' });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /manifest contains duplicate entry: index\.html/);
    assert.deepEqual(listRelativeFiles(stagingRoot), ['sentinel.bin']);
    assert.deepEqual(fs.readFileSync(path.join(stagingRoot, 'sentinel.bin')), sentinelBytes);
});

test('release verification matches the exact staged Web file set and bytes', {
    skip: process.env.ASSET_TRACKER_VERIFY_STAGED === '1'
        ? false
        : 'set ASSET_TRACKER_VERIFY_STAGED=1 for release verification'
}, () => {
    const manifestEntries = readManifestEntries();
    const stagedRoot = path.join(root, 'macos-app/Resources/Web');
    assert.deepEqual(
        listRelativeFiles(stagedRoot).sort(),
        [...manifestEntries].sort()
    );

    for (const file of manifestEntries) {
        assert.deepEqual(
            readBytes(`macos-app/Resources/Web/${file}`),
            readBytes(file),
            `${file} should byte-match its staged macOS copy`
        );
    }
});
