extends Control

const FontStack = preload("res://theme/font_stack.gd")
const SUPPORTED_LOCALES: Array[String] = ["ja", "ko", "zh-Hans", "en"]


func _ready() -> void:
	var locale := OS.get_environment("K30_LOCALE")
	var output_path := OS.get_environment("K30_OUTPUT")
	if not SUPPORTED_LOCALES.has(locale):
		_fail("font.render.locale.unsupported", {"locale": locale})
		return
	if output_path.is_empty() or not output_path.is_absolute_path():
		_fail("font.render.output.invalid", {"output": output_path})
		return

	var catalog_text := _load_usage_translation(locale)
	if catalog_text.is_empty():
		_fail("locale.key.missing", {"locale": locale, "key": "errors.cli.usage"})
		return

	var font_theme := FontStack.build_theme(locale)
	if font_theme == null:
		_fail("font.stack.theme.invalid", {"locale": locale})
		return
	var sample_issues := FontStack.validate_control_string(locale)
	if not sample_issues.is_empty():
		_fail("font.stack.control_string.missing", {"locale": locale, "issues": sample_issues})
		return

	theme = font_theme
	get_window().size = Vector2i(1440, 360)

	var background := ColorRect.new()
	background.color = Color("#111827")
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(background)

	var label := Label.new()
	label.text = catalog_text
	label.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	label.offset_left = 36
	label.offset_top = 24
	label.offset_right = -36
	label.offset_bottom = -24
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.autowrap_mode = TextServer.AUTOWRAP_OFF
	label.add_theme_color_override("font_color", Color("#F9FAFB"))
	label.add_theme_font_size_override("font_size", 48)
	add_child(label)

	await get_tree().process_frame
	await get_tree().process_frame
	var image := get_viewport().get_texture().get_image()
	if image == null or image.is_empty():
		_fail("font.render.image.empty", {"locale": locale})
		return
	var save_error := image.save_png(output_path)
	if save_error != OK:
		_fail("font.render.png.write_failed", {"locale": locale, "error": save_error})
		return

	var fallback_font := ThemeDB.fallback_font as FontFile
	var fallback_names := PackedStringArray()
	for fallback in fallback_font.fallbacks:
		fallback_names.append(fallback.get_font_name())
	var result := {
		"code": "font.render.ok",
		"params": {
			"locale": locale,
			"key": "errors.cli.usage",
			"theme_db": fallback_font.get_font_name(),
			"fallbacks": fallback_names,
			"output": output_path,
			"width": image.get_width(),
			"height": image.get_height(),
		},
	}
	var serialized_result := JSON.stringify(result)
	print(serialized_result)
	get_tree().quit(0)


func _load_usage_translation(locale: String) -> String:
	var project_dir := ProjectSettings.globalize_path("res://")
	var catalog_path := project_dir.path_join("../locales/" + locale + ".json").simplify_path()
	var file := FileAccess.open(catalog_path, FileAccess.READ)
	if file == null:
		return ""
	var catalog: Variant = JSON.parse_string(file.get_as_text())
	if not (catalog is Dictionary):
		return ""
	return String(catalog.get("errors.cli.usage", ""))


func _fail(code: String, params: Dictionary) -> void:
	var diagnostic := {"code": code, "params": params}
	var serialized_diagnostic := JSON.stringify(diagnostic)
	push_error(serialized_diagnostic)
	get_tree().quit(1)
