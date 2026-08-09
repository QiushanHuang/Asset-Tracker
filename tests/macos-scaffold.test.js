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
    'script.js',
    'vendor/chart.umd.min.js',
    'vendor/xlsx.full.min.js'
];

function mustExist(relativePath) {
    const fullPath = path.join(root, relativePath);
    assert.ok(fs.existsSync(fullPath), `${relativePath} should exist`);
    return fs.readFileSync(fullPath, 'utf8');
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
