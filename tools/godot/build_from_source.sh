#!/usr/bin/env bash
# Rebuild the Synapse Godot binary from official sources (only needed if the prebuilt
# archive in tools/godot/dist/ is missing or the engine must be changed).
#
#   tools/godot/build_from_source.sh            # editor build (default, what dist/ contains)
#   TARGET=template_release tools/godot/build_from_source.sh
#
# Needs: git, gcc/g++ (C++17), python3 (+venv), ~6 GB disk, ~3 GB RAM. No root, no X11 dev
# packages, no pkg-config (a stub is created) — everything else is bundled in Godot's thirdparty/.
# Time: ~1 h on 2 cores for the editor target.
set -euo pipefail

GODOT_TAG="${GODOT_TAG:-4.7.2-stable}"
SRC="${GODOT_SRC:-/tmp/godot-src}"
TARGET="${TARGET:-editor}"
JOBS="${JOBS:-$(nproc)}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="${GODOT_BUILD_TOOLS:-/tmp/godot-build-tools}"

# 1. Sources.
if [ ! -d "$SRC/.git" ]; then
	git clone --depth 1 --branch "$GODOT_TAG" https://github.com/godotengine/godot.git "$SRC"
fi

# 2. Patches (idempotent: a stamp file records which patch set was applied).
STAMP="$SRC/.synapse_patches"
WANT="$(cat "$HERE"/patches/*.patch | sha256sum | cut -d' ' -f1)"
if [ "$(cat "$STAMP" 2>/dev/null)" = "$WANT" ]; then
	echo "patches already applied"
elif [ -z "$(git -C "$SRC" status --porcelain --untracked-files=no)" ]; then
	for p in "$HERE"/patches/*.patch; do
		git -C "$SRC" apply "$p"
		echo "applied: $(basename "$p")"
	done
	echo "$WANT" > "$STAMP"
else
	echo "ERROR: $SRC has local changes but no matching patch stamp." >&2
	echo "Use a fresh clone (rm -rf $SRC) or set GODOT_SRC to another directory." >&2
	exit 1
fi

# 3. Build tools: scons in a venv, pkg-config stub if the system has none.
if [ ! -x "$TOOLS/venv/bin/scons" ]; then
	python3 -m venv "$TOOLS/venv"
	"$TOOLS/venv/bin/pip" install -q scons
fi
mkdir -p "$TOOLS/bin"
if ! command -v pkg-config >/dev/null; then
	printf '#!/bin/sh\ncase "$1" in --version) echo 1.8.1; exit 0;; esac\nexit 1\n' > "$TOOLS/bin/pkg-config"
	chmod +x "$TOOLS/bin/pkg-config"
fi
export PATH="$TOOLS/bin:$TOOLS/venv/bin:$PATH"

# 4. Build. use_sowrap (default) = X11/ALSA/PulseAudio/etc. are dlopen()ed at runtime, headers are bundled.
cd "$SRC"
scons platform=linuxbsd target="$TARGET" arch=x86_64 \
	x11=yes wayland=no vulkan=yes opengl3=yes \
	accesskit=no sdl=no debug_symbols=no progress=no \
	-j"$JOBS" "$@"

ls -la "$SRC"/bin/godot.linuxbsd.*
echo "Done. To refresh the archive in the repo: tools/godot/package.sh"
