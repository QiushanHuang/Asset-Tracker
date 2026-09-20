#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT_DIR/assets/asset-tracker-logo-v3.png"
ICON_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/asset-tracker-icon.XXXXXX")"
trap 'rm -rf "$ICON_TEMP"' EXIT
ICONSET="$ICON_TEMP/AssetTracker.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$SOURCE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  retina=$((size * 2))
  sips -z "$retina" "$retina" "$SOURCE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$ROOT_DIR/macos-app/Resources/AssetTracker-v3.icns"
echo 'Generated the macOS icon from the versioned logo source.'
