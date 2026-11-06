extends SceneTree

const VALIDATOR_SCRIPT := "res://validation/validator.mjs"
const RESOLVER_SCRIPT := "res://modules/resolver.mjs"
const RUNNER_SCRIPT := "res://runtime/render_game.gd"
const STATE_CAPTURE_ARG := "__capture_state"
const STATE_FORMAT := "synapse.world-state.v1"
const STATE_VIEW_SIZE := Vector2i(960, 540)
const SceneRegistry = preload("res://runtime/scene_registry.gd")
const MAX_RUN_FRAMES := 3600


func _initialize() -> void:
	var user_args := OS.get_cmdline_user_args()
	var args := PackedStringArray()
	var locale := "en"
	var locale_missing := false
	var index := 0
	while index < user_args.size():
		if user_args[index] in ["--locale", "--lang"]:
			if index + 1 < user_args.size() and not user_args[index + 1].begins_with("--"):
				locale = user_args[index + 1]
				index += 2
			else:
				locale_missing = true
				index += 1
		else:
			args.append(user_args[index])
			index += 1

	if not args.is_empty() and args[0] == STATE_CAPTURE_ARG:
		call_deferred("_capture_world_state", args.slice(1))
		return
	if not args.is_empty() and args[0] == "run":
		_run_game(args.slice(1), locale)
		return

	var helper_script := VALIDATOR_SCRIPT
	if args.size() >= 1 and args[0] == "resolve":
		helper_script = RESOLVER_SCRIPT

	if args.size() >= 2 and args[0] in ["validate", "resolve"]:
		args[1] = _absolute_spec_path(args[1])

	var command := [ProjectSettings.globalize_path(helper_script)]
	command.append_array(args)
	if helper_script == VALIDATOR_SCRIPT:
		command.append("--locale")
		if not locale_missing:
			command.append(locale)
	var output: Array = []
	var exit_code := OS.execute("node", command, output, true)
	for line in output:
		print(line)
	quit(exit_code if exit_code >= 0 else 127)


func _absolute_spec_path(path: String) -> String:
	if path.begins_with("res://"):
		return ProjectSettings.globalize_path(path)
	if path.is_absolute_path():
		return path.simplify_path()
	var repo_root := ProjectSettings.globalize_path("res://..").simplify_path()
	return repo_root.path_join(path).simplify_path()


func _run_game(args: PackedStringArray, locale: String) -> void:
	if args.is_empty():
		_emit_error("cli.run.usage", {"path": "/run", "expected": ["GameSpec", "--frames", "count", "--shot", "path"], "actual": []}, 2)
		return

	var spec_path := _absolute_spec_path(args[0])
	var frame_count := -1
	var shot_path := ""
	var state_path := ""
	var state_requested := false
	var index := 1
	while index < args.size():
		var option := args[index]
		if index + 1 >= args.size():
			_emit_error("cli.run.option.value_missing", {"path": "/run/" + option, "expected": {"value": true}, "actual": null}, 2)
			return
		var value := args[index + 1]
		match option:
			"--frames":
				if not value.is_valid_int():
					_emit_error("cli.run.frames.invalid", {"path": "/--frames", "expected": {"type": "integer", "minimum": 1, "maximum": MAX_RUN_FRAMES}, "actual": value}, 2)
					return
				frame_count = value.to_int()
			"--shot":
				shot_path = value
			"--state":
				state_requested = true
				state_path = value
			_:
				_emit_error("cli.run.option.unknown", {"path": "/run", "expected": ["--frames", "--shot", "--state"], "actual": option}, 2)
				return
		index += 2

	if frame_count < 1 or frame_count > MAX_RUN_FRAMES:
		_emit_error("cli.run.frames.invalid", {"path": "/--frames", "expected": {"type": "integer", "minimum": 1, "maximum": MAX_RUN_FRAMES}, "actual": frame_count}, 2)
		return
	if shot_path.is_empty() or not shot_path.is_absolute_path():
		_emit_error("cli.run.shot.invalid", {"path": "/--shot", "expected": {"absolute": true, "extension": ".png", "outside_repository": true}, "actual": shot_path}, 2)
		return
	shot_path = shot_path.simplify_path()
	if shot_path.get_extension().to_lower() != "png":
		_emit_error("cli.run.shot.invalid", {"path": "/--shot", "expected": {"extension": ".png"}, "actual": shot_path}, 2)
		return
	var repo_root := ProjectSettings.globalize_path("res://..").simplify_path()
	if shot_path == repo_root or shot_path.begins_with(repo_root + "/"):
		_emit_error("cli.run.shot.invalid", {"path": "/--shot", "expected": {"outside_repository": true}, "actual": shot_path}, 2)
		return
	if state_requested:
		var state_path_error := _state_path_error(state_path, repo_root)
		if not state_path_error.is_empty():
			_emit_error("cli.run.state.invalid", {"path": "/--state", "expected": {"absolute": true, "extension": ".json", "outside_repository": true}, "actual": state_path_error}, 2)
			return
		state_path = state_path.simplify_path()
	var directory_error := DirAccess.make_dir_recursive_absolute(shot_path.get_base_dir())
	if directory_error != OK:
		_emit_error("cli.run.shot.directory_failed", {"path": "/--shot", "expected": {"directory_writable": true}, "actual": directory_error}, 1)
		return

	var validator_command := [ProjectSettings.globalize_path(VALIDATOR_SCRIPT), "validate", spec_path, "--locale", locale]
	var validation_output: Array = []
	var validation_exit := OS.execute("node", validator_command, validation_output, true)
	var validation_result := _parse_json_output(validation_output)
	if validation_exit != 0 or validation_result.is_empty() or not bool(validation_result.get("ok", false)):
		for line in validation_output:
			print(line)
		quit(validation_exit if validation_exit > 0 else 1)
		return

	var scene_id := String(validation_result.get("entryScene", ""))
	var scene_path := String(SceneRegistry.SCENES.get(scene_id, ""))
	if scene_path.is_empty():
		var expected_scenes: Array = SceneRegistry.SCENES.keys()
		expected_scenes.sort()
		_emit_error("scene.id.unknown", {"path": "/entry/scene", "expected": expected_scenes, "actual": scene_id}, 1)
		return

	var renderer_command := [
		"SYNAPSE_GODOT_MODE=offscreen",
		"godot",
		"--path",
		ProjectSettings.globalize_path("res://"),
		"--script",
		RUNNER_SCRIPT,
		"--",
		scene_path,
		str(frame_count),
		shot_path,
	]
	var renderer_output: Array = []
	var renderer_exit := OS.execute("env", renderer_command, renderer_output, true)
	if renderer_exit != 0 or not _has_frame_marker(renderer_output, frame_count):
		_emit_error("cli.run.render_failed", {"path": "/--shot", "expected": {"exit_code": 0, "frames_marker": "frames=%d" % frame_count}, "actual": renderer_exit}, 1)
		return

	var png_info := _read_png_info(shot_path)
	if png_info.is_empty():
		_emit_error("cli.run.png.invalid", {"path": "/--shot", "expected": {"format": "PNG", "width_minimum": 1, "height_minimum": 1}, "actual": shot_path}, 1)
		return
	if state_requested and not _write_world_state(scene_id, frame_count, state_path):
		return
	var result := {}
	result["code"] = "cli.run.complete"
	result["params"] = {"scene": scene_id, "frames": frame_count, "shot": shot_path, "width": png_info.width, "height": png_info.height}
	result["marker"] = "frames=%d" % frame_count
	_emit_record(result, 0)


func _state_path_error(path: String, repo_root: String) -> String:
	if not path.is_absolute_path():
		return "absolute"
	var normalized := path.simplify_path()
	if normalized.get_extension().to_lower() != "json":
		return "extension"
	if normalized == repo_root or normalized.begins_with(repo_root + "/"):
		return "inside_repository"
	return ""


func _write_world_state(scene_id: String, frame_count: int, state_path: String) -> bool:
	var capture_command := [
		"SYNAPSE_GODOT_MODE=offscreen",
		"godot",
		"--headless",
		"--path",
		ProjectSettings.globalize_path("res://"),
		"--script",
		"res://cli/main.gd",
		"--",
		STATE_CAPTURE_ARG,
		scene_id,
		str(frame_count),
		state_path,
	]
	var capture_output: Array = []
	var capture_exit := OS.execute("env", capture_command, capture_output, true)
	if capture_exit != 0:
		for line in capture_output:
			print(line)
		quit(capture_exit if capture_exit > 0 else 1)
		return false
	var capture_record := _parse_json_output(capture_output)
	var state_bytes := FileAccess.get_file_as_bytes(state_path)
	if capture_record.get("code") != "cli.run.state.complete" or state_bytes.is_empty():
		_emit_error("cli.run.state.write_failed", {"path": "/--state", "expected": {"file_written": true}, "actual": "capture_output_or_file_missing"}, 1)
		return false
	return true


func _capture_world_state(args: PackedStringArray) -> void:
	if args.size() != 3:
		_emit_error("cli.run.state.capture_failed", {"path": "/--state", "expected": {"arguments": 3}, "actual": args.size()}, 1)
		return
	var scene_id := String(args[0])
	var frame_text := String(args[1])
	var state_path := String(args[2])
	if not frame_text.is_valid_int():
		_emit_error("cli.run.state.capture_failed", {"path": "/--frames", "expected": {"type": "integer"}, "actual": frame_text}, 1)
		return
	var frame_count := frame_text.to_int()
	if frame_count < 1 or frame_count > MAX_RUN_FRAMES:
		_emit_error("cli.run.state.capture_failed", {"path": "/--frames", "expected": {"minimum": 1, "maximum": MAX_RUN_FRAMES}, "actual": frame_count}, 1)
		return
	var repo_root := ProjectSettings.globalize_path("res://..").simplify_path()
	var state_path_error := _state_path_error(state_path, repo_root)
	if not state_path_error.is_empty():
		_emit_error("cli.run.state.invalid", {"path": "/--state", "expected": {"absolute": true, "extension": ".json", "outside_repository": true}, "actual": state_path_error}, 2)
		return
	state_path = state_path.simplify_path()
	var scene_path := String(SceneRegistry.SCENES.get(scene_id, ""))
	if scene_path.is_empty():
		_emit_error("cli.run.state.capture_failed", {"path": "/entry/scene", "expected": SceneRegistry.SCENES.keys(), "actual": scene_id}, 1)
		return
	var packed_scene := load(scene_path) as PackedScene
	if packed_scene == null:
		_emit_error("cli.run.state.capture_failed", {"path": "/entry/scene", "expected": {"loadable": true}, "actual": scene_id}, 1)
		return
	var scene_root := packed_scene.instantiate()
	if scene_root == null:
		_emit_error("cli.run.state.capture_failed", {"path": "/entry/scene", "expected": {"instantiable": true}, "actual": scene_id}, 1)
		return
	root.size = STATE_VIEW_SIZE
	root.add_child(scene_root)
	for _frame in range(frame_count):
		await process_frame

	var state_document := {
		"format": STATE_FORMAT,
		"scene": scene_id,
		"nodes": _snapshot_node(scene_root, scene_root),
	}
	var state_text := _canonical_json(state_document) + "\n"
	var directory_error := DirAccess.make_dir_recursive_absolute(state_path.get_base_dir())
	if directory_error != OK:
		_emit_error("cli.run.state.write_failed", {"path": "/--state", "expected": {"directory_writable": true}, "actual": directory_error}, 1)
		return
	var state_file := FileAccess.open(state_path, FileAccess.WRITE)
	if state_file == null:
		_emit_error("cli.run.state.write_failed", {"path": "/--state", "expected": {"file_writable": true}, "actual": FileAccess.get_open_error()}, 1)
		return
	state_file.store_string(state_text)
	var write_error := state_file.get_error()
	state_file.close()
	if write_error != OK:
		_emit_error("cli.run.state.write_failed", {"path": "/--state", "expected": {"write_error": OK}, "actual": write_error}, 1)
		return
	var completion := {
		"code": "cli.run.state.complete",
		"params": {"frames": frame_count, "nodes": _count_snapshot_nodes(state_document["nodes"])},
	}
	_emit_record(completion, 0)


func _snapshot_node(node: Node, scene_root: Node) -> Dictionary:
	var properties := {"process_mode": node.process_mode}
	if node is CanvasItem:
		var canvas_item := node as CanvasItem
		properties["visible"] = canvas_item.visible
		properties["z_index"] = canvas_item.z_index
		properties["modulate"] = _color_array(canvas_item.modulate)
		properties["self_modulate"] = _color_array(canvas_item.self_modulate)
	if node is Node2D:
		var node_2d := node as Node2D
		properties["position"] = _vector2_array(node_2d.position)
		properties["rotation"] = node_2d.rotation
		properties["scale"] = _vector2_array(node_2d.scale)
		properties["skew"] = node_2d.skew
	if node is Control:
		var control := node as Control
		properties["anchors"] = [control.anchor_left, control.anchor_top, control.anchor_right, control.anchor_bottom]
		properties["offsets"] = [control.offset_left, control.offset_top, control.offset_right, control.offset_bottom]
		properties["position"] = _vector2_array(control.position)
		properties["size"] = _vector2_array(control.size)
		properties["pivot_offset"] = _vector2_array(control.pivot_offset)
		properties["rotation"] = control.rotation
		properties["scale"] = _vector2_array(control.scale)
		properties["mouse_filter"] = control.mouse_filter
		properties["clip_contents"] = control.clip_contents
	if node is ColorRect:
		properties["color"] = _color_array((node as ColorRect).color)
	if node is Polygon2D:
		var polygon_node := node as Polygon2D
		var polygon_points: Array = []
		for point in polygon_node.polygon:
			polygon_points.append(_vector2_array(point))
		properties["color"] = _color_array(polygon_node.color)
		properties["polygon"] = polygon_points
	var children: Array = []
	for child in node.get_children():
		children.append(_snapshot_node(child, scene_root))
	return {
		"class": node.get_class(),
		"path": String(scene_root.get_path_to(node)),
		"properties": properties,
		"children": children,
	}


func _vector2_array(value: Vector2) -> Array:
	return [value.x, value.y]


func _color_array(value: Color) -> Array:
	return [value.r, value.g, value.b, value.a]


func _count_snapshot_nodes(snapshot: Dictionary) -> int:
	var count := 1
	for child in snapshot["children"]:
		count += _count_snapshot_nodes(child)
	return count


func _canonical_json(value: Variant) -> String:
	match typeof(value):
		TYPE_DICTIONARY:
			var keys: Array = value.keys()
			keys.sort()
			var members: Array[String] = []
			for key in keys:
				members.append(JSON.stringify(String(key)) + ":" + _canonical_json(value[key]))
			return "{" + ",".join(members) + "}"
		TYPE_ARRAY:
			var values: Array[String] = []
			for item in value:
				values.append(_canonical_json(item))
			return "[" + ",".join(values) + "]"
		TYPE_STRING:
			return JSON.stringify(value)
		TYPE_BOOL:
			return "true" if value else "false"
		TYPE_INT, TYPE_FLOAT:
			return JSON.stringify(value)
		TYPE_NIL:
			return "null"
		_:
			return JSON.stringify(String(value))


func _emit_error(code: String, params: Dictionary, exit_code: int) -> void:
	var record := {}
	record["code"] = code
	record["params"] = params
	_emit_record(record, exit_code)


func _emit_record(record: Dictionary, exit_code: int) -> void:
	print(JSON.stringify(record))
	quit(exit_code)


func _parse_json_output(output: Array) -> Dictionary:
	for item in output:
		for line in String(item).split("\n", false):
			var candidate := line.strip_edges()
			if not candidate.begins_with("{"):
				continue
			var parsed = JSON.parse_string(candidate)
			if typeof(parsed) == TYPE_DICTIONARY:
				return parsed
	return {}


func _has_frame_marker(output: Array, expected_frames: int) -> bool:
	for item in output:
		for line in String(item).split("\n", false):
			var candidate := line.strip_edges()
			if not candidate.begins_with("{"):
				continue
			var parsed = JSON.parse_string(candidate)
			if typeof(parsed) == TYPE_DICTIONARY and parsed.get("code") == "game.run.frames_complete":
				return int(parsed.get("params", {}).get("frames", -1)) == expected_frames
	return false


func _read_png_info(path: String) -> Dictionary:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.size() < 24:
		return {}
	var signature := PackedByteArray([137, 80, 78, 71, 13, 10, 26, 10])
	for offset in range(signature.size()):
		if bytes[offset] != signature[offset]:
			return {}
	var image := Image.new()
	if image.load_png_from_buffer(bytes) != OK:
		return {}
	if image.get_width() < 1 or image.get_height() < 1:
		return {}
	return {"width": image.get_width(), "height": image.get_height()}
