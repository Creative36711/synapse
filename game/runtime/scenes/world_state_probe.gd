extends Control

@export var measure_translated_width := false


func _ready() -> void:
	var panel := ColorRect.new()
	panel.name = "LayoutPanel"
	panel.position = Vector2(32.0, 118.0)
	panel.color = Color(0.075, 0.12, 0.18, 1.0)
	add_child(panel)

	var text_control: Control
	if measure_translated_width:
		var label := Label.new()
		label.name = "TranslatedText"
		label.text = tr("ui.minigame.win_condition")
		text_control = label
	else:
		var text_edit := TextEdit.new()
		text_edit.name = "TranslatedText"
		text_edit.text = tr("ui.minigame.win_condition")
		text_edit.editable = false
		text_edit.context_menu_enabled = false
		text_control = text_edit
	text_control.position = Vector2(48.0, 132.0)
	text_control.add_theme_font_size_override("font_size", 24)
	text_control.add_theme_color_override("font_color", Color(0.92, 0.97, 0.98, 1.0))
	add_child(text_control)

	if measure_translated_width:
		var label := text_control as Label
		var font := label.get_theme_font("font")
		var measured_width := font.get_string_size(label.text, HORIZONTAL_ALIGNMENT_LEFT, -1.0, 24).x
		label.size = Vector2(measured_width, 36.0)
		panel.size = Vector2(measured_width + 32.0, 64.0)
	else:
		text_control.size = Vector2(420.0, 36.0)
		panel.size = Vector2(460.0, 64.0)
