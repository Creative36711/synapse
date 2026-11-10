extends RefCounted

const KEY_CODES := {
	"move_up": KEY_UP,
	"move_down": KEY_DOWN,
	"move_left": KEY_LEFT,
	"move_right": KEY_RIGHT,
}
const BUTTON_CENTERS := {
	"StartButton": Vector2(670, 40),
	"PauseButton": Vector2(774, 40),
	"RestartButton": Vector2(892, 40),
}


static func action_from_event(event: InputEvent) -> String:
	if not event is InputEventKey:
		return ""
	var key_event := event as InputEventKey
	if not key_event.pressed or key_event.echo:
		return ""
	var key_code := key_event.physical_keycode
	if key_code == 0:
		key_code = key_event.keycode
	for action in KEY_CODES:
		if int(KEY_CODES[action]) == key_code:
			return String(action)
	return ""


static func event_for_action(action: String) -> InputEventKey:
	if not KEY_CODES.has(action):
		return null
	var key_code: Key = KEY_CODES[action]
	var key_event := InputEventKey.new()
	key_event.keycode = key_code
	key_event.physical_keycode = key_code
	key_event.pressed = true
	return key_event


static func event_from_descriptor(descriptor: Dictionary) -> InputEvent:
	match String(descriptor.get("type", "")):
		"key":
			var key_name := String(descriptor.get("key", ""))
			var key_code := int(KEY_CODES.get(key_name, 0))
			if key_code == 0:
				return null
			var key_event := InputEventKey.new()
			key_event.keycode = key_code
			key_event.physical_keycode = key_code
			key_event.pressed = bool(descriptor.get("pressed", true))
			return key_event
		"mouse_button":
			var button_name := String(descriptor.get("button", ""))
			if not BUTTON_CENTERS.has(button_name):
				return null
			var mouse_event := InputEventMouseButton.new()
			mouse_event.button_index = MOUSE_BUTTON_LEFT
			mouse_event.pressed = bool(descriptor.get("pressed", false))
			mouse_event.position = BUTTON_CENTERS[button_name]
			mouse_event.global_position = mouse_event.position
			return mouse_event
	return null
