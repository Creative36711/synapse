extends SceneTree

const FontStack = preload("res://theme/font_stack.gd")


func _initialize() -> void:
	var issues := FontStack.validate_configuration(FontStack.FONT_PATHS, FontStack.FONT_STACKS)
	if not issues.is_empty():
		_report_error("font.stack.configuration.invalid", {"issues": issues})
		quit(1)
		return

	var negative_checks := 0
	for family in FontStack.REQUIRED_FAMILIES:
		var missing_path_map: Dictionary = FontStack.FONT_PATHS.duplicate(true)
		missing_path_map.erase(family)
		if FontStack.validate_configuration(missing_path_map, FontStack.FONT_STACKS).is_empty():
			_report_error("font.stack.guard.failed", {"family": family, "case": "asset_map"})
			quit(1)
			return
		negative_checks += 1

		for locale in FontStack.REQUIRED_LOCALES:
			var missing_stack: Dictionary = FontStack.FONT_STACKS.duplicate(true)
			missing_stack[locale].erase(family)
			if FontStack.validate_configuration(FontStack.FONT_PATHS, missing_stack).is_empty():
				_report_error("font.stack.guard.failed", {"family": family, "locale": locale, "case": "locale_stack"})
				quit(1)
				return
			negative_checks += 1

	for family in FontStack.REQUIRED_FAMILIES:
		var raw_font := FontFile.new()
		if raw_font.load_dynamic_font(FontStack.FONT_PATHS[family]) != OK:
			_report_error("font.stack.cmap.load_failed", {"family": family})
			quit(1)
			return
		var missing_codepoints := PackedStringArray()
		for index in range(FontStack.CONTROL_STRING.length()):
			var codepoint := FontStack.CONTROL_STRING.unicode_at(index)
			if not raw_font.has_char(codepoint):
				missing_codepoints.append("U+%04X" % codepoint)
		_emit_record("font.stack.cmap.per_font", {"family": family, "control_string_missing": missing_codepoints})

	for locale in FontStack.REQUIRED_LOCALES:
		var theme: Theme = FontStack.build_theme(locale)
		if theme == null:
			_report_error("font.stack.theme.invalid", {"locale": locale})
			quit(1)
			return
		var fallback_font := ThemeDB.fallback_font as FontFile
		if fallback_font == null or fallback_font.get_font_name() != "Noto Sans":
			_report_error("font.stack.theme_db.not_replaced", {"locale": locale})
			quit(1)
			return
		if theme.default_font.get_font_name() != "Noto Sans":
			_report_error("font.stack.default.not_noto_sans", {"locale": locale})
			quit(1)
			return

		var expected_fallbacks := FontStack.fallback_family_names(locale)
		var actual_fallbacks := PackedStringArray()
		for fallback in fallback_font.fallbacks:
			actual_fallbacks.append(fallback.get_font_name())
		if actual_fallbacks != expected_fallbacks:
			_report_error("font.stack.fallback_order.invalid", {"locale": locale, "actual": actual_fallbacks})
			quit(1)
			return

		var sample_issues := FontStack.validate_control_string(locale)
		if not sample_issues.is_empty():
			_report_error("font.stack.control_string.missing", {"locale": locale, "issues": sample_issues})
			quit(1)
			return

		var latin_family := FontStack.resolve_codepoint(locale, 0x41)
		var cyrillic_family := FontStack.resolve_codepoint(locale, 0x416)
		if latin_family != "Noto Sans" or cyrillic_family != "Noto Sans":
			_report_error("font.stack.base_glyph.routed_wrong", {"locale": locale, "latin": latin_family, "cyrillic": cyrillic_family})
			quit(1)
			return
		_emit_record("font.stack.base_glyph.route", {"locale": locale, "codepoints": [0x41, 0x416], "family": "Noto Sans"})

		if FontStack.PREFERRED_GLYPH_BY_LOCALE.has(locale):
			var preferred_family := String(FontStack.PREFERRED_CJK_BY_LOCALE[locale])
			var preferred_codepoint := int(FontStack.PREFERRED_GLYPH_BY_LOCALE[locale])
			var actual_family := FontStack.resolve_codepoint(locale, preferred_codepoint)
			if actual_family != preferred_family:
				_report_error("font.stack.locale_glyph.routed_wrong", {"locale": locale, "actual": actual_family})
				quit(1)
				return
			_emit_record("font.stack.locale_glyph.route", {"locale": locale, "codepoint": preferred_codepoint, "family": actual_family})

		_emit_record("font.stack.configured", {"locale": locale, "theme_db": fallback_font.get_font_name(), "fallbacks": actual_fallbacks})

	_emit_record("font.stack.pass", {"locales": FontStack.REQUIRED_LOCALES.size(), "families": FontStack.REQUIRED_FAMILIES.size(), "negative_removal_guards": negative_checks})
	quit(0)


func _report_error(code: String, params: Dictionary) -> void:
	var diagnostic := {"code": code, "params": params}
	var serialized_diagnostic := JSON.stringify(diagnostic)
	push_error(serialized_diagnostic)


func _emit_record(code: String, params: Dictionary) -> void:
	var record := {"code": code, "params": params}
	var serialized_record := JSON.stringify(record)
	print(serialized_record)
