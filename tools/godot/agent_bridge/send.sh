#!/usr/bin/env bash
# Send a batch of commands to a game running with `-- --agent-bridge[=<dir>]` and wait for it.
#   tools/godot/agent_bridge/send.sh "key Right 0.5" "shot /tmp/s1.png"
# Env: GODOT_AGENT_DIR (default /tmp/godot_agent), SEND_TIMEOUT seconds (default 120).
set -u
DIR="${GODOT_AGENT_DIR:-/tmp/godot_agent}"
TIMEOUT="${SEND_TIMEOUT:-120}"
[ -f "$DIR/ack.txt" ] || { echo "agent_bridge not running (no $DIR/ack.txt)"; exit 2; }
before="$(cat "$DIR/ack.txt")"
printf '%s\n' "$@" > "$DIR/cmd.tmp" && mv "$DIR/cmd.tmp" "$DIR/cmd.txt"
end=$((SECONDS + TIMEOUT))
while [ $SECONDS -lt $end ]; do
	sleep 0.1
	now="$(cat "$DIR/ack.txt" 2>/dev/null)"
	if [ ! -e "$DIR/cmd.txt" ] && [ "$now" != "$before" ]; then
		echo "ack: $now"
		exit 0
	fi
done
echo "timeout: game did not acknowledge within ${TIMEOUT}s"
exit 1
