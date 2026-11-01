# AGENTS.md — Synapse

Instructions for AI coding agents working in this repository. Read this first.

Synapse is built with **Godot 4.7.2**. A prebuilt, patched Godot (editor build: 2D + 3D, all standard
modules, asset import) is stored **in this repo** at `tools/godot/dist/`, so you never need to download
or compile the engine. Installation takes a few seconds and needs no root and no internet.

## 1. Install Godot (every new session/sandbox)

```bash
tools/godot/install.sh --check        # install + end-to-end smoke test (~1 min)
export PATH="/tmp/synapse-godot/bin:$PATH"
godot --version                        # 4.7.2.stable.custom_build...
```

* Installs to `/tmp/synapse-godot` (override with `GODOT_HOME=...`). Re-running is a no-op if already installed.
* `--check` imports a test asset, renders a 3D scene, injects keyboard input and writes
  `/tmp/synapse-smoke/shot_1.png` / `shot_2.png`. **Open both images and look at them**: textured cube,
  sky, shadow and a text line must be visible; the cube must be rotated in `shot_2`.
* `/tmp` is not persistent in most sandboxes — just re-run `install.sh` at the start of a session.
* Requirements: Linux x86_64, glibc ≥ 2.35 (Ubuntu 22.04+/Debian 12+), `xz`, `tar`, `sha256sum`.
  No other system libraries are needed in offscreen mode (static libstdc++, X11/audio are optional dlopen).
* The repository is private: the agent needs GitHub access to `Creative36711/synapse` to clone it.

## 2. Running Godot — no GPU, no display needed

`godot` is a wrapper. `SYNAPSE_GODOT_MODE` selects how it runs:

| Mode | When | What happens |
|---|---|---|
| `auto` (default) | — | `native` if `$DISPLAY`/`$WAYLAND_DISPLAY` is set, else `offscreen` |
| `offscreen` | sandboxes, CI, no X11 | patched `offscreen` display driver + Vulkan on CPU (bundled SwiftShader). Real rendering, no window. |
| `native` | desktop with GPU | plain Godot, real window. Add `SYNAPSE_GODOT_SWIFTSHADER=1` to force CPU Vulkan (e.g. under Xvfb). |

Common commands (from the project directory or with `--path <dir>`):

```bash
godot --headless --path game --import              # import/re-import assets (needed after adding PNG/glTF/etc.)
godot --path game                                  # run the main scene (offscreen in sandboxes)
godot --path game res://levels/test.tscn           # run a specific scene
godot --headless --path game --script res://tools/x.gd   # run a SceneTree/MainLoop script (no rendering)
godot --headless --path game --quit                # parse/load check; GDScript errors appear in the output
godot --path game --write-movie /tmp/m.png --fixed-fps 30 --quit-after 90   # deterministic frame dump
```

Notes:
* `--headless` = no rendering at all (fast; use for import, scripts, tests). Without it, offscreen mode renders.
* Rendering on CPU is slow (a few to a few dozen FPS for simple 3D). Prefer the pause-and-step workflow
  below, or `--fixed-fps` so game time does not depend on render speed.
* Exporting games needs export templates, which are not bundled (build them with
  `TARGET=template_release tools/godot/build_from_source.sh` if required).

## 3. Seeing and playing the game: Agent Bridge

`tools/godot/agent_bridge/` lets you drive a running game from the shell and take screenshots.

1. Copy it into the project: `cp -r tools/godot/agent_bridge <project>/addons/agent_bridge`
2. Register the autoload in `project.godot`:
   ```ini
   [autoload]
   AgentBridge="*res://addons/agent_bridge/agent_bridge.gd"
   ```
   It is inert unless the game is launched with `-- --agent-bridge`, so it is safe to keep in the project.
3. Run and control:
   ```bash
   godot --path <project> -- --agent-bridge=/tmp/godot_agent &      # game starts PAUSED
   export GODOT_AGENT_DIR=/tmp/godot_agent
   tools/godot/agent_bridge/send.sh "frames 2" "shot /tmp/s0.png"   # look at /tmp/s0.png
   tools/godot/agent_bridge/send.sh "key Right 0.5" "key Up+Shift 0.3" "shot /tmp/s1.png"
   tools/godot/agent_bridge/send.sh "click 320 200" "action jump 0.1" "wait 1" "shot /tmp/s2.png"
   tools/godot/agent_bridge/send.sh "tree /tmp/tree.txt" "quit"
   ```
   The game only advances while a command runs, so you can inspect screenshots between moves.
   Full command list: header of `agent_bridge.gd` (key, tap, action, click, move, wait, frames, shot,
   tree, call, quit). Input is injected as real `InputEvent`s.

## 4. Media toolbox: images, chromakey, audio (tools/media)

Media generation and acceptance for game assets (image/audio). Russian agent guide:
`tools/media/GENERATION_GUIDE.md` (ported from narthex: quotas, prompt templates, chromakey rules).

```bash
tools/media/setup.sh --check                # venv /tmp/synapse-media: Pillow + ffmpeg + self-test
export PATH="/tmp/synapse-media/bin:$PATH"
```

* `cutout-chromakey in.png out.png [--mode auto|color|flood|points] [--crop] [--tol 70] [--allow-cyan] [--no-despill]`
  — removes a `#00FF00` background with a STRICT key (teal/cyan is NOT background — a lesson
  from narthex). `--heal damaged.png fixed.png` restores icons damaged by old cutouts.
* `media-check <dir-or-files...>` — acceptance gate: signature vs extension (catches HTML
  named .png), chroma residue (>0.5% opaque green = fail), weight (>4 MB image / >8 MB audio),
  duplicates by sha256. Run it on assets before committing.
* `ffmpeg` — static 7.0 (mp3/ogg/opus/wav, `loudnorm`, `silenceremove`).

The media-generation workflow itself (10 images + 10 voice clips per turn, chromakey pipeline,
prompt templates, voice registration, ledger) is in `tools/media/GENERATION_GUIDE.md` — read it
before generating the first asset. Look at results with your own eyes (read_file on images);
`media-check` does not judge beauty.

## 5. 3D models and renders: Blender headless (tools/modeling)

For 3D assets: Blender as a Python module (`bpy`), no display needed. Russian/English docs below.

```bash
tools/modeling/setup_bpy.sh --check         # venv /tmp/synapse-bpy: bpy 4.5.3 + stubs + smoke test
export SYNAPSE_BPY_PY=/tmp/synapse-bpy/bin/bpy-python
$SYNAPSE_BPY_PY my_script.py               # runs a Blender script headless
```

* `bpy` = Blender 4.5.3 LTS embedded (~370 MB from pypi.org). Needs python 3.11 (system python here).
* The wheel links X11/GL symbols; on a bare sandbox `setup_bpy.sh` builds empty stub libraries
  (gcc) so `import bpy` works. On a machine with real X/GL libs, no stubs are built.
* Wrapper `bpy-python` sets `LD_LIBRARY_PATH` only when stubs exist.

What works headless (verified by `--check`): mesh ops, materials, **GLB + .gltf export**
(baked transforms, Y-up conversion), and **Cycles CPU render** to PNG (works fully offscreen).
What does NOT work: EEVEE renderer (needs a real GL context), GPU rendering (CUDA/OptiX),
interactive UI.

Typical use: write a model script (cube → materials → `bpy.ops.export_scene.gltf`), run it with
`bpy-python`, put the GLB into the Godot project's `res://assets/`, then
`godot --headless --path <project> --import`. Cycles CPU renders give a verification image
(light a cube or your model, render, look at the PNG).

## 6. Engine details / rebuilding

* Version: Godot `4.7.2-stable` (official source) + patches in `tools/godot/patches/`:
  * `0001-offscreen-display-server.patch` — new `offscreen` display driver (Vulkan swapchain on
    `VK_EXT_headless_surface`, no X11/Wayland).
  * `0002-text-server-fb-kerning-26.6-fix.patch` — backport from upstream master (FreeType kerning
    was not divided by 64 in TextServerFallback → garbled text ≥ 24 px).
  * `0003-glibc-2.35-compat-arc4random.patch` — provides `arc4random()` so the binary (static libstdc++)
    does not require glibc 2.36; runs on glibc ≥ 2.35.
* Build: editor target, `x11=yes wayland=no vulkan=yes opengl3=yes accesskit=no sdl=no`.
* SwiftShader (Vulkan 1.3 on CPU, Apache-2.0) comes from Chromium as packaged in the npm package
  `@sparticuz/chromium@153.0.0` (`bin/swiftshader.tar.br`).
* Rebuild from source (~1–2 h on 2 cores): `tools/godot/build_from_source.sh`, then
  `tools/godot/package.sh <binary> <swiftshader_dir>` and commit `tools/godot/dist/`.
  Do not use Git LFS or GitHub Releases for binaries: many agent sandboxes can reach `github.com`
  but not the LFS/release download hosts.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `Checksum mismatch` in install.sh | Incomplete checkout; `git fetch` / re-clone. |
| `Your video card drivers seem not to support...` / Vulkan init errors | Use offscreen mode (unset `DISPLAY`) or `SYNAPSE_GODOT_SWIFTSHADER=1`. |
| `Could not load global script cache` | Harmless on a never-imported project; run `--import` once. |
| Textures/models fail to `load()` | Run `godot --headless --path <project> --import` after adding assets. |
| Screenshot file "not found" right after `shot` | Some tool sandboxes sync files with a delay; wait a second and retry. |
| `V-Sync mode Disabled is not available` warning | Harmless with SwiftShader. |
