#!/usr/bin/env bash
# Synapse media toolbox: Pillow for cutout-chromakey.py in a throwaway venv.
#
#   tools/media/setup.sh            # install into $SYNAPSE_MEDIA_HOME (default /tmp/synapse-media)
#   tools/media/setup.sh --check    # install + run the self-test
#   export PATH="/tmp/synapse-media/bin:$PATH"
#
# After that the following commands are on PATH:
#   cutout-chromakey  in.png out.png [--mode auto|color|flood|points] [--heal] ...
#
# Only pypi.org / files.pythonhosted.org are needed (no apt, no root).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${SYNAPSE_MEDIA_HOME:-/tmp/synapse-media}"
CHECK=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

if [ ! -x "$PREFIX/bin/python" ]; then
  echo "[media] creating venv $PREFIX"
  python3 -m venv "$PREFIX"
fi
if ! "$PREFIX/bin/python" -c "import PIL" 2>/dev/null; then
  echo "[media] pip install pillow"
  "$PREFIX/bin/pip" install -q --disable-pip-version-check --progress-bar off pillow
fi

# Wrappers always point at this checkout's scripts and the venv's python.
for pair in "cutout-chromakey:cutout-chromakey.py"; do
  name="${pair%%:*}"; script="${pair#*:}"
  cat > "$PREFIX/bin/$name" <<EOF
#!/usr/bin/env bash
exec "$PREFIX/bin/python" "$HERE/$script" "\$@"
EOF
  chmod +x "$PREFIX/bin/$name"
done

echo "[media] ready: $PREFIX/bin/cutout-chromakey"
echo "[media]   export PATH=\"$PREFIX/bin:\$PATH\""

if [ "$CHECK" = 1 ]; then
  "$PREFIX/bin/python" "$HERE/test_media_tools.py"
fi
