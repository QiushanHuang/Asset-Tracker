const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function mustExist(relativePath) {
    const fullPath = path.join(root, relativePath);
    assert.ok(fs.existsSync(fullPath), `${relativePath} should exist`);
    return fs.readFileSync(fullPath, 'utf8');
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
