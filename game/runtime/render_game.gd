extends SceneTree

const VIEW_SIZE := Vector2i(960, 540)
const EntityInstance = preload("res://runtime/entity_instance.gd")


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() not in [3, 4, 5]:
		_emit_error("runtime.arguments.invalid", {"expected": [3, 4, 5], "actual": args.size()})
		return
	var frame_count_text := args[1]
	if not frame_count_text.is_valid_int() or frame_count_text.to_int() < 1:
		_emit_error("runtime.frames.invalid", {"expected": "positive integer", "actual": frame_count_text})
		return
	var entity_definitions: Array = []
	if args.size() >= 4:
		var entity_json := Marshalls.base64_to_raw(args[3]).get_string_from_utf8()
		var parsed_entities = JSON.parse_string(entity_json)
		if typeof(parsed_entities) != TYPE_ARRAY:
			_emit_error("runtime.arguments.invalid", {"expected": "entity definitions array", "actual": typeof(parsed_entities)})
			return
		entity_definitions = parsed_entities
	var input_actions: Array = []
	if args.size() == 5:
		var input_path := args[4]
		if not input_path.is_absolute_path():
			_emit_error("runtime.input.invalid", {"expected": {"absolute": true}, "actual": input_path})
			return
		if not FileAccess.file_exists(input_path):
			_emit_error("runtime.input.read_failed", {"path": input_path, "actual": "file_not_found"})
			return
		var input_file := FileAccess.open(input_path, FileAccess.READ)
		if input_file == null:
			_emit_error("runtime.input.read_failed", {"path": input_path, "actual": FileAccess.get_open_error()})
			return
		var parsed_input = JSON.parse_string(input_file.get_as_text())
		input_file.close()
		if typeof(parsed_input) != TYPE_DICTIONARY or typeof(parsed_input.get("actions")) != TYPE_ARRAY:
			_emit_error("runtime.input.invalid", {"expected": {"actions": "array"}, "actual": "invalid_document"})
			return
		for action in parsed_input.actions:
			if typeof(action) != TYPE_DICTIONARY:
				_emit_error("runtime.input.invalid", {"expected": "non-negative frame and supported action", "actual": action})
				return
			var action_frame: Variant = action.get("frame", null)
			if typeof(action_frame) not in [TYPE_INT, TYPE_FLOAT] or not is_equal_approx(float(action_frame), roundf(float(action_frame))) or int(action_frame) < 0 or String(action.get("action", "")) not in ["move_up", "move_down", "move_left", "move_right"]:
				_emit_error("runtime.input.invalid", {"expected": "non-negative frame and supported action", "actual": action})
				return
			var normalized_action: Dictionary = action.duplicate(true)
			normalized_action["frame"] = int(action_frame)
			input_actions.append(normalized_action)
	call_deferred("_render", args[0], frame_count_text.to_int(), args[2], entity_definitions, input_actions, args.size() == 5)


func _render(scene_path: String, frame_count: int, output_path: String, entity_definitions: Array, input_actions: Array, explicit_input: bool) -> void:
	root.size = VIEW_SIZE
	var packed_scene := load(scene_path) as PackedScene
	if packed_scene == null:
		_emit_error("runtime.scene.load_failed", {"actual": scene_path})
		return
	var scene := packed_scene.instantiate()
	if scene == null:
		_emit_error("runtime.scene.instantiate_failed", {"actual": scene_path})
		return
	if explicit_input and scene.has_method("configure_input"):
		scene.call("configure_input", input_actions)
	root.add_child(scene)
	for index in range(entity_definitions.size()):
		var definition: Variant = entity_definitions[index]
		if typeof(definition) != TYPE_DICTIONARY:
			continue
		var entity_instance = EntityInstance.new(definition)
		entity_instance.name = "Entity_%d" % index
		scene.add_child(entity_instance)
	var processed_frames := 0
	while processed_frames < frame_count:
		await process_frame
		await RenderingServer.frame_post_draw
		processed_frames += 1
	var image := root.get_texture().get_image()
	if image.is_empty() or image.get_width() < 1 or image.get_height() < 1:
		_emit_error("runtime.render.empty", {"frames": processed_frames, "width": image.get_width(), "height": image.get_height()})
		return
	var save_error := image.save_png(output_path)
	if save_error != OK:
		_emit_error("runtime.png.save_failed", {"path": output_path, "actual": save_error})
		return
	var completion_record := {}
	completion_record["code"] = "game.run.frames_complete"
	completion_record["params"] = {"frames": processed_frames}
	_emit_record(completion_record, 0)


func _emit_error(code: String, params: Dictionary) -> void:
	var record := {}
	record["code"] = code
	record["params"] = params
	_emit_record(record, 1)


func _emit_record(record: Dictionary, exit_code: int) -> void:
	print(JSON.stringify(record))
	quit(exit_code)
