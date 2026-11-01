#!/usr/bin/env bash
# Pack a freshly built Godot binary (and SwiftShader) into tools/godot/dist/ for committing.
#   tools/godot/package.sh [/tmp/godot-src/bin/godot.linuxbsd.editor.x86_64] [swiftshader_dir]
# Archives > 45 MB are split into parts (GitHub rejects files > 100 MB, warns > 50 MB).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$HERE/dist"
BIN="${1:-/tmp/godot-src/bin/godot.linuxbsd.editor.x86_64}"
SS_DIR="${2:-}"
NAME="godot-linux-x86_64"

mkdir -p "$DIST"
rm -f "$DIST/$NAME.xz" "$DIST/$NAME.xz.part-"*
echo "compressing $BIN ..."
xz -T0 -9 -c "$BIN" > "$DIST/$NAME.xz"
if [ "$(stat -c %s "$DIST/$NAME.xz")" -gt $((45 * 1024 * 1024)) ]; then
	split -b 45M -d -a 2 "$DIST/$NAME.xz" "$DIST/$NAME.xz.part-"
	rm "$DIST/$NAME.xz"
fi

if [ -n "$SS_DIR" ]; then
	tar -C "$SS_DIR" -cJf "$DIST/swiftshader-linux-x86_64.tar.xz" libvulkan.so.1 libvk_swiftshader.so vk_swiftshader_icd.json
fi

"$BIN" --version > "$DIST/VERSION" 2>/dev/null || true
{
	echo "# sha256 of the UNCOMPRESSED godot binary, then of each archive file"
	echo "$(sha256sum "$BIN" | cut -d' ' -f1)  godot (uncompressed)"
	(cd "$DIST" && sha256sum $NAME.xz* swiftshader-linux-x86_64.tar.xz 2>/dev/null)
} > "$DIST/SHA256SUMS"
ls -la "$DIST"
