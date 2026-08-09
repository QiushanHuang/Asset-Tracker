#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
MANIFEST_PATH="$ROOT_DIR/script/web-assets.manifest"
WEB_STAGING_DIR="$ROOT_DIR/macos-app/Resources/Web"

fail() {
    echo "Web asset sync refused: $1" >&2
    exit 1
}

if [[ ! -f "$MANIFEST_PATH" || -L "$MANIFEST_PATH" ]]; then
    fail "manifest must be a regular non-symlink file"
fi

ASSETS=()
while IFS= read -r asset || [[ -n "$asset" ]]; do
    if [[ -z "$asset" || "$asset" =~ [[:space:]] ]]; then
        fail "manifest contains a blank or whitespace-bearing entry"
    fi
    if [[ "$asset" == /* ]]; then
        fail "manifest entries must be relative"
    fi
    if [[ "$asset" == ".." || "$asset" == ../* || "$asset" == */../* || "$asset" == */.. ]]; then
        fail "manifest entries must not contain .. components"
    fi

    if [[ ${#ASSETS[@]} -gt 0 ]]; then
        for existing in "${ASSETS[@]}"; do
            if [[ "$existing" == "$asset" ]]; then
                fail "manifest contains duplicate entry: $asset"
            fi
        done
    fi

    source="$ROOT_DIR/$asset"
    if [[ ! -f "$source" || -L "$source" ]]; then
        fail "source must be a regular non-symlink file: $asset"
    fi

    source_parent="$(cd "$(dirname "$source")" && pwd -P)"
    resolved_source="$source_parent/$(basename "$source")"
    case "$resolved_source" in
        "$ROOT_DIR"/*) ;;
        *) fail "source resolves outside the worktree: $asset" ;;
    esac

    ASSETS+=("$asset")
done < "$MANIFEST_PATH"

if [[ ${#ASSETS[@]} -eq 0 ]]; then
    fail "manifest must contain at least one asset"
fi

if [[ -L "$WEB_STAGING_DIR" ]]; then
    fail "Web staging target must not be a symlink"
fi
if [[ -e "$WEB_STAGING_DIR" && ! -d "$WEB_STAGING_DIR" ]]; then
    fail "Web staging target must be a directory"
fi

resources_dir="$ROOT_DIR/macos-app/Resources"
if [[ ! -d "$resources_dir" || -L "$resources_dir" ]]; then
    fail "Resources parent must be a regular directory"
fi

resources_dir_real="$(cd "$resources_dir" && pwd -P)"
RESOLVED_WEB_STAGING_DIR="$resources_dir_real/Web"
if [[ "$RESOLVED_WEB_STAGING_DIR" != "$WEB_STAGING_DIR" ]]; then
    fail "Web staging target resolves outside the exact worktree location"
fi
case "$RESOLVED_WEB_STAGING_DIR" in
    "$ROOT_DIR"/*) ;;
    *) fail "Web staging target resolves outside the worktree" ;;
esac

rm -rf "$WEB_STAGING_DIR"
mkdir -p "$WEB_STAGING_DIR"

for asset in "${ASSETS[@]}"; do
    destination="$WEB_STAGING_DIR/$asset"
    mkdir -p "$(dirname "$destination")"
    cp "$ROOT_DIR/$asset" "$destination"
done
