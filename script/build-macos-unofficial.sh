#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/AssetTracker.app"
ZIP_PATH="$DIST_DIR/AssetTracker-unofficial.zip"

"$ROOT_DIR/script/build_and_run.sh" --stage-only

rm -f "$ZIP_PATH"
cd "$DIST_DIR"
/usr/bin/ditto -c -k --keepParent "AssetTracker.app" "$ZIP_PATH"

echo "Unsigned app: $APP_BUNDLE"
echo "Unsigned zip: $ZIP_PATH"

