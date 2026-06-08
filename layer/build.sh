#!/usr/bin/env bash
set -euo pipefail

# Builds the shared-code Lambda layer: production deps PLUS the cert-utils engine itself,
# laid out under nodejs/node_modules so the Lambda runtime resolves both via NODE_PATH
# (/opt/nodejs/node_modules). After this runs, point the template's DepsLayer ContentUri at
# layer/build (which contains nodejs/...).
#
# Run from anywhere: ./layer/build.sh
#
# Requirements: node + npm, and git (the @reso/reso-certification-etl dependency is a
# github: dep that needs git to install).

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/layer/build"
NODEJS_DIR="$BUILD_DIR/nodejs"
PKG_DIR="$NODEJS_DIR/node_modules/@reso/reso-certification-utils"

rm -rf "$BUILD_DIR"
mkdir -p "$NODEJS_DIR"

# 1) Install production deps into the layer's node_modules. Done in a temp dir so the repo's
#    own (dev-inclusive) node_modules is never copied in. --ignore-scripts skips the repo's
#    `prepare` (lefthook), which is a devDep and fails outside a git working tree.
TMP="$(mktemp -d)"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$TMP/"
( cd "$TMP" && npm ci --omit=dev --ignore-scripts )
mv "$TMP/node_modules" "$NODEJS_DIR/node_modules"
rm -rf "$TMP"

# 2) Lay the engine itself into the layer as @reso/reso-certification-utils so the wrappers
#    can `require('@reso/reso-certification-utils/lib/backup/...')`. Only the source the
#    backup paths need — no test/, lambda/, batch/, or nested node_modules.
mkdir -p "$PKG_DIR"
cp "$ROOT/package.json" "$ROOT/common.js" "$ROOT/index.js" "$PKG_DIR/"
cp -R "$ROOT/lib" "$PKG_DIR/lib"

echo "Layer built at $NODEJS_DIR"
du -sh "$NODEJS_DIR" 2>/dev/null || true
