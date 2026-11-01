extends Node
## Agent Bridge — lets an AI agent drive a running Godot game from the shell.
##
## Opt-in: does nothing unless the game is started with the user arg `--agent-bridge[=<dir>]`
## (after `--` on the Godot command line). Default <dir> is /tmp/godot_agent.
##
## Protocol: write commands (one per line) to <dir>/cmd.txt; the bridge executes them in order and
## writes "done <n>" to <dir>/ack.txt. tools/godot/agent_bridge/send.sh does this and waits.
## While no command is running the SceneTree is PAUSED, so the agent can look at screenshots and
## think without the game moving on. Input is injected as real InputEvents (full input pipeline).
##
## Commands:
##   key <keys> <seconds>      hold keys, e.g. "key Left 0.5", "key W+Shift 1.2" (Godot key names)
##   tap <keys>                press & release on consecutive frames
##   action <name> <seconds>   hold an Input Map action, e.g. "action jump 0.1"
##   click <x> <y> [button]    mouse click at viewport coords (button: left|right|middle)
##   move <x> <y>              mouse motion to viewport coords
##   wait <seconds>            run the game without input
##   frames <n>                run exactly n frames
##   shot <file.png>           save a screenshot of the main viewport
##   tree <file.txt>           dump the current scene tree (names, types, positions)
##   call <node_path> <method> [args...]   call a method (args parsed with str_to_var, fallback string)
##   quit

var ctl_dir := ""
var batch := 0


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a == "--agent-bridge":
			ctl_dir = "/tmp/godot_agent"
		elif a.begins_with("--agent-bridge="):
			ctl_dir = a.substr("--agent-bridge=".length())
	if ctl_dir.is_empty():
		queue_free() # Not requested: stay out of the way.
		return
	process_mode = Node.PROCESS_MODE_ALWAYS
	DirAccess.make_dir_recursive_absolute(ctl_dir)
	DirAccess.remove_absolute(ctl_dir + "/cmd.txt")
	get_tree().paused = true
	print("[agent_bridge] listening on ", ctl_dir)
	_ack("ready")
	_loop()


func _ack(msg: String) -> void:
	var f := FileAccess.open(ctl_dir + "/ack.txt", FileAccess.WRITE)
	f.store_string(msg + "\n")


func _keys(spec: String, pressed: bool) -> void:
	for name in spec.split("+"):
		var code := OS.find_keycode_from_string(name)
		if code == KEY_NONE:
			push_error("[agent_bridge] unknown key: " + name)
			continue
		var ev := InputEventKey.new()
		ev.keycode = code
		ev.physical_keycode = code
		ev.pressed = pressed
		Input.parse_input_event(ev)


func _action(name: String, pressed: bool) -> void:
	var ev := InputEventAction.new()
	ev.action = name
	ev.pressed = pressed
	ev.strength = 1.0 if pressed else 0.0
	Input.parse_input_event(ev)


func _mouse_button(pos: Vector2, button: String, pressed: bool) -> void:
	var ev := InputEventMouseButton.new()
	ev.position = pos
	ev.global_position = pos
	ev.button_index = {"left": MOUSE_BUTTON_LEFT, "right": MOUSE_BUTTON_RIGHT, "middle": MOUSE_BUTTON_MIDDLE}.get(button, MOUSE_BUTTON_LEFT)
	ev.pressed = pressed
	Input.parse_input_event(ev)


func _mouse_move(pos: Vector2) -> void:
	var ev := InputEventMouseMotion.new()
	ev.position = pos
	ev.global_position = pos
	Input.parse_input_event(ev)


func _run_seconds(seconds: float) -> void:
	get_tree().paused = false
	var left := seconds
	while left > 0.0:
		await get_tree().process_frame
		left -= get_process_delta_time()
	get_tree().paused = true


func _run_frames(n: int) -> void:
	get_tree().paused = false
	for i in n:
		await get_tree().process_frame
	get_tree().paused = true


func _dump_tree(node: Node, depth: int, out: PackedStringArray) -> void:
	var line := "  ".repeat(depth) + node.name + " (" + node.get_class() + ")"
	if node is Node2D:
		line += " pos=" + str(node.global_position)
	elif node is Node3D:
		line += " pos=" + str(node.global_position)
	elif node is Control:
		line += " rect=" + str(node.get_global_rect())
	out.append(line)
	for c in node.get_children():
		_dump_tree(c, depth + 1, out)


func _loop() -> void:
	while true:
		await get_tree().process_frame
		var path := ctl_dir + "/cmd.txt"
		if not FileAccess.file_exists(path):
			continue
		var text := FileAccess.get_file_as_string(path)
		DirAccess.remove_absolute(path)
		batch += 1
		for line in text.split("\n", false):
			var p := line.strip_edges().split(" ", false)
			if p.is_empty() or p[0].begins_with("#"):
				continue
			match p[0]:
				"key":
					_keys(p[1], true)
					await _run_seconds(float(p[2]))
					_keys(p[1], false)
					await _run_frames(1)
				"tap":
					_keys(p[1], true)
					await _run_frames(1)
					_keys(p[1], false)
					await _run_frames(1)
				"action":
					_action(p[1], true)
					await _run_seconds(float(p[2]))
					_action(p[1], false)
					await _run_frames(1)
				"click":
					var pos := Vector2(float(p[1]), float(p[2]))
					var btn := p[3] if p.size() > 3 else "left"
					_mouse_move(pos)
					_mouse_button(pos, btn, true)
					await _run_frames(1)
					_mouse_button(pos, btn, false)
					await _run_frames(1)
				"move":
					_mouse_move(Vector2(float(p[1]), float(p[2])))
					await _run_frames(1)
				"wait":
					await _run_seconds(float(p[1]))
				"frames":
					await _run_frames(int(p[1]))
				"shot":
					await RenderingServer.frame_post_draw
					var err := get_viewport().get_texture().get_image().save_png(p[1])
					print("[agent_bridge] screenshot ", p[1], " err=", err)
				"tree":
					var out := PackedStringArray()
					_dump_tree(get_tree().root, 0, out)
					var f := FileAccess.open(p[1], FileAccess.WRITE)
					f.store_string("\n".join(out) + "\n")
				"call":
					var node := get_tree().root.get_node_or_null(NodePath(p[1]))
					if node == null:
						push_error("[agent_bridge] no node at " + p[1])
					else:
						var args := []
						for i in range(3, p.size()):
							var v = str_to_var(p[i])
							args.append(p[i] if v == null else v)
						print("[agent_bridge] call -> ", node.callv(p[2], args))
				"quit":
					_ack("done %d" % batch)
					get_tree().quit()
					return
				_:
					push_error("[agent_bridge] unknown command: " + line)
		_ack("done %d" % batch)
