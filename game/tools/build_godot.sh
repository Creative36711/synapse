#!/bin/bash
export PATH=/tmp/bin:/tmp/venv/bin:$PATH
cd /tmp/godot-src
exec scons platform=linuxbsd target=template_debug arch=x86_64 \
  x11=no wayland=no opengl3=no vulkan=yes accesskit=no sdl=no \
  alsa=no pulseaudio=no dbus=no speechd=no fontconfig=no udev=no touch=no \
  modules_enabled_by_default=no module_gdscript_enabled=yes module_freetype_enabled=yes \
  module_text_server_fb_enabled=yes module_glslang_enabled=yes module_godot_physics_2d_enabled=yes \
  disable_3d=yes disable_physics_3d=yes disable_navigation_2d=yes disable_navigation_3d=yes disable_xr=yes \
  deprecated=no minizip=no brotli=no optimize=debug debug_symbols=no progress=no disable_path_overrides=no -j2 "$@"
