extends RefCounted

const FontStack = preload("res://theme/font_stack.gd")
const SUPPORTED_LOCALES := ["en", "ru", "zh-Hans", "ja", "pt-BR", "de", "fr", "ko"]
const REQUIRED_MINIGAME_KEYS := [
	"ui.minigame.score",
	"ui.minigame.win_condition",
	"ui.minigame.controls_hint",
	"ui.minigame.button.start",
	"ui.minigame.button.pause",
	"ui.minigame.button.restart",
]


static func install(locale: String) -> Dictionary:
	if locale not in SUPPORTED_LOCALES:
		return {"ok": false, "key": REQUIRED_MINIGAME_KEYS[0]}
	var catalog_path := ProjectSettings.globalize_path("res://../locales/%s.json" % locale).simplify_path()
	if not FileAccess.file_exists(catalog_path):
		return {"ok": false, "key": REQUIRED_MINIGAME_KEYS[0]}
	var catalog_file := FileAccess.open(catalog_path, FileAccess.READ)
	if catalog_file == null:
		return {"ok": false, "key": REQUIRED_MINIGAME_KEYS[0]}
	var catalog_value = JSON.parse_string(catalog_file.get_as_text())
	catalog_file.close()
	if typeof(catalog_value) != TYPE_DICTIONARY:
		return {"ok": false, "key": REQUIRED_MINIGAME_KEYS[0]}
	var translation := Translation.new()
	translation.locale = locale
	for key in REQUIRED_MINIGAME_KEYS:
		var translated_value: Variant = catalog_value.get(key, null)
		if typeof(translated_value) != TYPE_STRING:
			return {"ok": false, "key": key}
		translation.add_message(StringName(key), String(translated_value))
	var theme_locale := locale if FontStack.FONT_STACKS.has(locale) else "en"
	var theme: Theme = FontStack.build_theme(theme_locale)
	if theme == null:
		return {"ok": false, "key": REQUIRED_MINIGAME_KEYS[0]}
	TranslationServer.add_translation(translation)
	TranslationServer.set_locale(locale)
	return {"ok": true, "theme": theme}
