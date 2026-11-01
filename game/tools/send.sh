#!/bin/bash
# Usage: send.sh "hold right 0.5" "shot /path/x.png" ...
# Sends a batch of commands to the running game (bot.gd) and waits until it is processed.
CTL=${GAME_CTL:-/tmp/game_ctl}
before=$(cat "$CTL/ack.txt" 2>/dev/null)
printf '%s\n' "$@" > "$CTL/cmd.tmp" && mv "$CTL/cmd.tmp" "$CTL/cmd.txt"
for i in $(seq 1 600); do
  sleep 0.1
  now=$(cat "$CTL/ack.txt" 2>/dev/null)
  if [ ! -e "$CTL/cmd.txt" ] && [ "$now" != "$before" ]; then echo "ack: $now"; exit 0; fi
done
echo "timeout waiting for game"; exit 1
