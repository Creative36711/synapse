#!/usr/bin/env bash
# Install the prebuilt Synapse Godot (from tools/godot/dist/) in a few seconds — no download,
# no compilation, no root. Safe to re-run (skips if already installed).
#
#   tools/godot/install.sh            # install to $GODOT_HOME (default /tmp/synapse-godot)
#   tools/godot/install.sh --check    # install + run the 3D smoke test (renders a screenshot)
#
# Afterwards:  export PATH="/tmp/synapse-godot/bin:$PATH"   and use `godot` as usual.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$HERE/dist"
GODOT_HOME="${GODOT_HOME:-/tmp/synapse-godot}"
NAME="godot-linux-x86_64"

[ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || { echo "Only Linux x86_64 is supported by the prebuilt binary." >&2; exit 1; }

want_sha="$(awk '/godot \(uncompressed\)/{print $1}' "$DIST/SHA256SUMS")"
have_sha=""
[ -x "$GODOT_HOME/godot.bin" ] && have_sha="$(sha256sum "$GODOT_HOME/godot.bin" | cut -d' ' -f1)"

if [ "$have_sha" != "$want_sha" ]; then
	echo "Installing Godot to $GODOT_HOME ..."
	mkdir -p "$GODOT_HOME/bin" "$GODOT_HOME/swiftshader"
	if [ -f "$DIST/$NAME.xz" ]; then
		xz -dc "$DIST/$NAME.xz" > "$GODOT_HOME/godot.bin.tmp"
	else
		cat "$DIST/$NAME.xz.part-"* | xz -dc > "$GODOT_HOME/godot.bin.tmp"
	fi
	got="$(sha256sum "$GODOT_HOME/godot.bin.tmp" | cut -d' ' -f1)"
	if [ "$got" != "$want_sha" ]; then
		echo "Checksum mismatch ($got != $want_sha). Is the repo fully checked out (no LFS pointers)?" >&2
		exit 1
	fi
	chmod +x "$GODOT_HOME/godot.bin.tmp"
	mv "$GODOT_HOME/godot.bin.tmp" "$GODOT_HOME/godot.bin"
	tar -C "$GODOT_HOME/swiftshader" -xJf "$DIST/swiftshader-linux-x86_64.tar.xz"
else
	echo "Godot already installed in $GODOT_HOME"
fi

# Wrapper: picks the right display/rendering setup automatically.
cat > "$GODOT_HOME/bin/godot" <<'WRAP'
#!/usr/bin/env bash
# Synapse Godot wrapper.
#   SYNAPSE_GODOT_MODE=auto (default) | offscreen | native
#     auto      -> native if $DISPLAY/$WAYLAND_DISPLAY is set, otherwise offscreen
#     offscreen -> no window: patched "offscreen" display driver + Vulkan via bundled SwiftShader (CPU)
#     native    -> plain Godot (real window, system GPU drivers)
#   SYNAPSE_GODOT_SWIFTSHADER=1 forces the bundled SwiftShader even in native mode (no GPU, e.g. Xvfb).
GODOT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${SYNAPSE_GODOT_MODE:-auto}"
if [ "$mode" = auto ]; then
	if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then mode=native; else mode=offscreen; fi
fi
use_ss="${SYNAPSE_GODOT_SWIFTSHADER:-0}"
[ "$mode" = offscreen ] && use_ss=1
if [ "$use_ss" = 1 ]; then
	export VK_ICD_FILENAMES="$GODOT_HOME/swiftshader/vk_swiftshader_icd.json"
	export VK_DRIVER_FILES="$VK_ICD_FILENAMES"
	export LD_LIBRARY_PATH="$GODOT_HOME/swiftshader${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
extra=()
if [ "$mode" = offscreen ]; then
	has() { local f="$1"; shift; for a in "$@"; do [ "$a" = "--" ] && return 1; case "$a" in "$f"|"$f="*) return 0;; esac; done; return 1; }
	if ! has --headless "$@" && ! has --display-driver "$@"; then
		extra+=(--display-driver offscreen)
		has --rendering-driver "$@" || extra+=(--rendering-driver vulkan)
	fi
	has --audio-driver "$@" || extra+=(--audio-driver Dummy)
fi
exec "$GODOT_HOME/godot.bin" "${extra[@]}" "$@"
WRAP
chmod +x "$GODOT_HOME/bin/godot"

"$GODOT_HOME/bin/godot" --version
echo
echo "OK. Use:  export PATH=\"$GODOT_HOME/bin:\$PATH\"   then   godot ..."

if [ "${1:-}" = "--check" ]; then
	exec "$HERE/smoke_test/run.sh"
fi
