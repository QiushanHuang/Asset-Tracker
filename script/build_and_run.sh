#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="AssetTracker"
BUNDLE_NAME="AssetTracker.app"
BUNDLE_ID="com.qiushan.AssetTracker"
APP_VERSION="${ASSET_TRACKER_VERSION:-3.1.1}"
APP_BUILD="${ASSET_TRACKER_BUILD:-2}"
MIN_SYSTEM_VERSION="14.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/macos-app"
DIST_DIR="$ROOT_DIR/dist"
STAGING_WEB_DIR="$PACKAGE_DIR/Resources/Web"
APP_BUNDLE="$DIST_DIR/$BUNDLE_NAME"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_BINARY="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"

"$ROOT_DIR/script/sync_web_assets.sh"
pkill -x "$APP_NAME" >/dev/null 2>&1 || true

swift build --package-path "$PACKAGE_DIR" --product "$APP_NAME"
BUILD_BINARY="$(swift build --package-path "$PACKAGE_DIR" --show-bin-path)/$APP_NAME"

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_RESOURCES"
cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"
cp -R "$STAGING_WEB_DIR" "$APP_RESOURCES/Web"

cat >"$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>智能资产记账</string>
  <key>CFBundleDisplayName</key>
  <string>智能资产记账</string>
  <key>CFBundleShortVersionString</key>
  <string>$APP_VERSION</string>
  <key>CFBundleVersion</key>
  <string>$APP_BUILD</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --stage-only|stage-only)
    echo "Staged app bundle at: $APP_BUNDLE"
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 2
    pgrep -x "$APP_NAME" >/dev/null
    ;;
  *)
    echo "usage: $0 [run|--stage-only|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
