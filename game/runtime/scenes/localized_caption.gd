extends Node

@export var caption_position := Vector2(184.0, 184.0)
@export var caption_size := Vector2(320.0, 40.0)
@export var caption_font_size := 24
@export var translation_key := "ui.minigame.button.restart"


func _ready() -> void:
	var label := Label.new()
	label.name = "LocalizedCaptionLabel"
	label.position = caption_position
	label.size = caption_size
	label.text = tr(translation_key)
	label.add_theme_font_size_override("font_size", caption_font_size)
	label.add_theme_color_override("font_color", Color(0.92, 0.97, 0.98, 1.0))
	add_child(label)
