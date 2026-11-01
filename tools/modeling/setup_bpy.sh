#!/usr/bin/env bash
# Synapse Blender toolkit (headless): the `bpy` Python package (Blender as a
# module) + empty stubs for missing X/GL libs + a smoke test.
#
#   tools/modeling/setup_bpy.sh           # install into $SYNAPSE_BPY_HOME (default /tmp/synapse-bpy)
#   tools/modeling/setup_bpy.sh --check   # install + run the cube/GLB smoke test
#
# Requires: python3.11+ (bpy 4.5.x needs ==3.11), gcc only if the sandbox
# lacks X/GL libs (stubs). ~370 MB wheel from pypi.org.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${SYNAPSE_BPY_HOME:-/tmp/synapse-bpy}"
VERSION="${SYNAPSE_BPY_VERSION:-4.5.3}"
CHECK=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

if [ ! -x "$PREFIX/bin/python" ]; then
  echo "[bpy] creating venv $PREFIX"
  python3 -m venv "$PREFIX"
fi
# The bpy wheel links X11/GL symbols; on a bare sandbox import fails until the
# stubs exist — so install by package presence, not by import.
if ! ls -d "$PREFIX"/lib/python*/site-packages/bpy >/dev/null 2>&1; then
  echo "[bpy] pip install bpy==$VERSION (downloads ~370 MB once)"
  "$PREFIX/bin/pip" install -q --disable-pip-version-check --progress-bar off "bpy==$VERSION"
fi

# Locate the bpy package by path (importing it may fail before stubs exist).
PKG="$(ls -d "$PREFIX"/lib/python*/site-packages/bpy 2>/dev/null | head -1)"
if [ -z "$PKG" ]; then
  echo "[bpy] cannot locate the bpy package — install failed?" >&2
  exit 1
fi

mkdir -p "$PREFIX/stubs"
"$PREFIX/bin/python" "$HERE/bpy_stubs.py" "$PKG" "$PREFIX/stubs" || exit 1

# Wrapper: adds the stub dir to LD_LIBRARY_PATH only when stubs were needed.
cat > "$PREFIX/bin/bpy-python" <<EOF
#!/usr/bin/env bash
if [ -f "$PREFIX/stubs/USE" ]; then
  export LD_LIBRARY_PATH="$PREFIX/stubs:\$LD_LIBRARY_PATH"
fi
exec "$PREFIX/bin/python" "\$@"
EOF
chmod +x "$PREFIX/bin/bpy-python"

BVER="$("$PREFIX/bin/bpy-python" -c 'import bpy; print(bpy.app.version_string)' 2>/dev/null || echo '?')"
echo "[bpy] ready: $PREFIX/bin/bpy-python  (Blender $BVER)"
echo "[bpy]   model scripts: \$SYNAPSE_BPY_PY \"$HERE/<script>.py\""

if [ "$CHECK" = 1 ]; then
  "$PREFIX/bin/bpy-python" "$HERE/test_bpy.py"
fi
