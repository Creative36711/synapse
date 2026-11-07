extends SceneTree

const VIEW_SIZE := Vector2i(960, 540)
const EntityInstance = preload("res://runtime/entity_instance.gd")


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() not in [3, 4]:
		_emit_error("runtime.arguments.invalid", {"expected": [3, 4], "actual": args.size()})
		return
	var frame_count_text := args[1]
	if not frame_count_text.is_valid_int() or frame_count_text.to_int() < 1:
		_emit_error("runtime.frames.invalid", {"expected": "positive integer", "actual": frame_count_text})
		return
	var entity_definitions: Array = []
	if args.size() == 4:
		var entity_json := Marshalls.base64_to_raw(args[3]).get_string_from_utf8()
		var parsed_entities = JSON.parse_string(entity_json)
		if typeof(parsed_entities) != TYPE_ARRAY:
			_emit_error("runtime.arguments.invalid", {"expected": "entity definitions array", "actual": typeof(parsed_entities)})
			return
		entity_definitions = parsed_entities
	call_deferred("_render", args[0], frame_count_text.to_int(), args[2], entity_definitions)


func _render(scene_path: String, frame_count: int, output_path: String, entity_definitions: Array) -> void:
	root.size = VIEW_SIZE
	var packed_scene := load(scene_path) as PackedScene
	if packed_scene == null:
		_emit_error("runtime.scene.load_failed", {"actual": scene_path})
		return
	var scene := packed_scene.instantiate()
	if scene == null:
		_emit_error("runtime.scene.instantiate_failed", {"actual": scene_path})
		return
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
