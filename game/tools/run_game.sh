#!/bin/bash
# Run Coin Rush with the patched Godot build, software Vulkan (SwiftShader) and no X11/Wayland.
# Control it with tools/send.sh (see bot.gd for the command list).
export VK_ICD_FILENAMES=${VK_ICD_FILENAMES:-/tmp/vk/vk_swiftshader_icd.json}
export LD_LIBRARY_PATH=${VK_DIR:-/tmp/vk}:$LD_LIBRARY_PATH
GODOT=${GODOT:-/tmp/godot-src/bin/godot.linuxbsd.template_debug.x86_64}
exec "$GODOT" --path "$(dirname "$0")/.." --display-driver offscreen --rendering-driver vulkan \
  --audio-driver Dummy --max-fps 30 -- --ctl=${GAME_CTL:-/tmp/game_ctl}
