extends RefCounted

const REQUIRED_FAMILIES: Array[String] = [
	"Noto Sans",
	"Noto Sans JP",
	"Noto Sans KR",
	"Noto Sans SC",
]

const FONT_PATHS := {
	"Noto Sans": "res://theme/fonts/NotoSans_400Regular.ttf",
	"Noto Sans JP": "res://theme/fonts/NotoSansJP_400Regular.ttf",
	"Noto Sans KR": "res://theme/fonts/NotoSansKR_400Regular.ttf",
	"Noto Sans SC": "res://theme/fonts/NotoSansSC_400Regular.ttf",
}

const REQUIRED_LOCALES: Array[String] = ["ja", "ko", "zh-Hans", "en"]
const PREFERRED_CJK_BY_LOCALE := {
	"ja": "Noto Sans JP",
	"ko": "Noto Sans KR",
	"zh-Hans": "Noto Sans SC",
}

# Each locale prefers its own CJK face, then keeps the other CJK files as
# explicit fallback coverage. Noto Sans remains first for Latin and Cyrillic.
const FONT_STACKS := {
	"ja": ["Noto Sans", "Noto Sans JP", "Noto Sans KR", "Noto Sans SC"],
	"ko": ["Noto Sans", "Noto Sans KR", "Noto Sans JP", "Noto Sans SC"],
	"zh-Hans": ["Noto Sans", "Noto Sans SC", "Noto Sans KR", "Noto Sans JP"],
	"en": ["Noto Sans", "Noto Sans JP", "Noto Sans KR", "Noto Sans SC"],
}

const CONTROL_STRING := "こんにちは世界ゲーム안녕"
const PREFERRED_GLYPH_BY_LOCALE := {
	"ja": 0x3053,
	"ko": 0xC548,
	"zh-Hans": 0x7528,
}


static func validate_configuration(font_paths: Dictionary, locale_stacks: Dictionary) -> PackedStringArray:
	var issues := PackedStringArray()
	if font_paths.size() != REQUIRED_FAMILIES.size():
		issues.append("font asset map must contain exactly four families")

	for family in REQUIRED_FAMILIES:
		if not font_paths.has(family):
			issues.append("missing font mapping: " + family)
			continue
		var path := String(font_paths[family])
		if not FileAccess.file_exists(path):
			issues.append("font file does not exist: " + family + " at " + path)
			continue
		var font := _load_font(path)
		if font == null:
			issues.append("font file could not be parsed: " + family)
		elif font.get_font_name() != family:
			issues.append("font family mismatch: expected " + family + ", got " + font.get_font_name())

	for family in font_paths:
		if not REQUIRED_FAMILIES.has(String(family)):
			issues.append("unexpected font mapping: " + String(family))

	if locale_stacks.size() != REQUIRED_LOCALES.size():
		issues.append("font stack map must contain exactly ja, ko, zh-Hans, en")
	for locale in REQUIRED_LOCALES:
		if not locale_stacks.has(locale):
			issues.append("missing locale font stack: " + locale)
			continue
		var stack: Array = locale_stacks[locale]
		if stack.size() != REQUIRED_FAMILIES.size():
			issues.append("locale stack must reference all four font families: " + locale)
		if stack.is_empty() or String(stack[0]) != "Noto Sans":
			issues.append("Noto Sans must be the Latin/Cyrillic base: " + locale)
		for family in REQUIRED_FAMILIES:
			if not stack.has(family):
				issues.append("locale stack omits " + family + ": " + locale)
		for family in stack:
			if not font_paths.has(String(family)):
				issues.append("locale stack references an unmapped font " + String(family) + ": " + locale)
		if PREFERRED_CJK_BY_LOCALE.has(locale):
			var preferred := String(PREFERRED_CJK_BY_LOCALE[locale])
			if stack.size() < 2 or String(stack[1]) != preferred:
				issues.append("wrong preferred CJK font for " + locale + ": expected " + preferred)
	return issues


static func build_theme(locale: String) -> Theme:
	var issues := validate_configuration(FONT_PATHS, FONT_STACKS)
	if not issues.is_empty() or not REQUIRED_LOCALES.has(locale):
		return null

	var base := _load_font(FONT_PATHS["Noto Sans"])
	if base == null:
		return null
	var assembled := base.duplicate(true) as FontFile
	if assembled == null:
		return null

	var fallbacks: Array[Font] = []
	var stack: Array = FONT_STACKS[locale]
	for index in range(1, stack.size()):
		var family := String(stack[index])
		var fallback := _load_font(FONT_PATHS[family]) as Font
		if fallback == null:
			return null
		fallbacks.append(fallback)
	assembled.fallbacks = fallbacks
	ThemeDB.fallback_font = assembled

	var theme := Theme.new()
	theme.default_font = assembled
	theme.default_font_size = 42
	return theme


static func resolve_codepoint(locale: String, codepoint: int) -> String:
	if not FONT_STACKS.has(locale):
		return ""
	for family_variant in FONT_STACKS[locale]:
		var family := String(family_variant)
		var font := _load_font(FONT_PATHS[family])
		if font != null and font.has_char(codepoint):
			return family
	return ""


static func validate_control_string(locale: String) -> PackedStringArray:
	var issues := PackedStringArray()
	for index in range(CONTROL_STRING.length()):
		var codepoint := CONTROL_STRING.unicode_at(index)
		if resolve_codepoint(locale, codepoint).is_empty():
			issues.append("fallback stack misses U+%04X for %s" % [codepoint, locale])
	return issues


static func fallback_family_names(locale: String) -> PackedStringArray:
	var names := PackedStringArray()
	if not FONT_STACKS.has(locale):
		return names
	var stack: Array = FONT_STACKS[locale]
	for index in range(1, stack.size()):
		names.append(String(stack[index]))
	return names


static func _load_font(path: String) -> FontFile:
	var font := FontFile.new()
	if font.load_dynamic_font(path) != OK:
		return null
	return font
