#!/usr/bin/env bash
# Install the exact package-lock tree from repository-vendored npm tarballs.
# This script never invokes npm or accesses the network.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON="${PYTHON:-python3}"

"$PYTHON" "$ROOT/tools/deps/vendor.py" verify
STAGE="$(mktemp -d "$ROOT/.k15-node-modules.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
"$PYTHON" "$ROOT/tools/deps/vendor.py" install --stage "$STAGE/node_modules"

# Replace only the ignored dependency directory, and do so after full validation/extraction.
rm -rf "$ROOT/node_modules"
mv "$STAGE/node_modules" "$ROOT/node_modules"
printf 'offline-install: installed package-lock.json tree without network access\n'
