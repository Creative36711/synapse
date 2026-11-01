#!/usr/bin/env bash
# End-to-end check of the Synapse Godot install:
#   import assets -> run a 3D scene offscreen -> inject input via agent_bridge -> screenshots.
# Output: /tmp/synapse-smoke/shot_1.png and shot_2.png (look at them: cube must be rotated in #2).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="$(cd "$HERE/.." && pwd)"
GODOT_HOME="${GODOT_HOME:-/tmp/synapse-godot}"
export PATH="$GODOT_HOME/bin:$PATH"
WORK=/tmp/synapse-smoke
export GODOT_AGENT_DIR="$WORK/ctl"

rm -rf "$WORK" && mkdir -p "$WORK"
cp -r "$HERE/project" "$WORK/project"
mkdir -p "$WORK/project/addons"
cp -r "$TOOLS/agent_bridge" "$WORK/project/addons/agent_bridge"

echo "== import"
godot --headless --path "$WORK/project" --import > "$WORK/import.log" 2>&1 || { cat "$WORK/import.log"; exit 1; }

echo "== run (log: $WORK/run.log)"
godot --path "$WORK/project" -- --agent-bridge="$GODOT_AGENT_DIR" > "$WORK/run.log" 2>&1 &
pid=$!
for i in $(seq 1 300); do [ -f "$GODOT_AGENT_DIR/ack.txt" ] && break; kill -0 $pid 2>/dev/null || break; sleep 0.2; done
[ -f "$GODOT_AGENT_DIR/ack.txt" ] || { echo "game did not start"; cat "$WORK/run.log"; exit 1; }

"$TOOLS/agent_bridge/send.sh" "frames 3" "shot $WORK/shot_1.png" "key Right 0.6" "shot $WORK/shot_2.png" "quit"
wait $pid || true
head -3 "$WORK/run.log"
for f in shot_1 shot_2; do [ -s "$WORK/$f.png" ] || { echo "FAIL: $f.png missing"; cat "$WORK/run.log"; exit 1; }; done
echo "SMOKE TEST OK -> $WORK/shot_1.png, $WORK/shot_2.png (check visually: textured cube, sky, text; cube rotated in shot_2)"
