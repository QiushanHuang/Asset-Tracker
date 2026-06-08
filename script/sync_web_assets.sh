#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_STAGING_DIR="$ROOT_DIR/macos-app/Resources/Web"

rm -rf "$WEB_STAGING_DIR"
mkdir -p "$WEB_STAGING_DIR/vendor"

cp "$ROOT_DIR/index.html" "$WEB_STAGING_DIR/index.html"
cp "$ROOT_DIR/styles.css" "$WEB_STAGING_DIR/styles.css"
cp "$ROOT_DIR/script.js" "$WEB_STAGING_DIR/script.js"
cp "$ROOT_DIR/vendor/chart.umd.min.js" "$WEB_STAGING_DIR/vendor/chart.umd.min.js"
cp "$ROOT_DIR/vendor/xlsx.full.min.js" "$WEB_STAGING_DIR/vendor/xlsx.full.min.js"
