extends Node2D

const VIEW_SIZE := Vector2(960.0, 540.0)
const DEFAULT_PLAYER_POSITION := Vector2(120.0, 270.0)
const PLAYER_BOUNDS := Rect2(Vector2(24.0, 92.0), Vector2(912.0, 424.0))
const DIGIT_SEGMENTS := {
	0: [0, 1, 2, 4, 5, 6],
	1: [1, 2],
	2: [0, 1, 3, 4, 6],
	3: [0, 1, 2, 3, 6],
}
const SEGMENT_RECTS := [
	Rect2(Vector2(4, 0), Vector2(16, 4)),
	Rect2(Vector2(20, 4), Vector2(4, 13)),
	Rect2(Vector2(20, 21), Vector2(4, 13)),
	Rect2(Vector2(4, 34), Vector2(16, 4)),
	Rect2(Vector2(0, 21), Vector2(4, 13)),
	Rect2(Vector2(0, 4), Vector2(4, 13)),
	Rect2(Vector2(4, 17), Vector2(16, 4)),
]

var _player: Node
var _collectibles: Array[Node] = []
var _input_actions: Array = []
var _actions_by_frame: Dictionary = {}
var _explicit_input := false
var _frame_index := 0
var _input_action_count := 0


func configure_input(actions: Array) -> void:
	_input_actions = actions.duplicate(true)
	_explicit_input = true


func _ready() -> void:
	set_process(true)
	call_deferred("_bind_entities")


func _bind_entities() -> void:
	for child in get_children():
		if not child.has_method("runtime_entity_data"):
			continue
		var properties: Dictionary = child.get("properties")
		match String(properties.get("role", "")):
			"player":
				_player = child
				properties["x"] = float(properties.get("x", DEFAULT_PLAYER_POSITION.x))
				properties["y"] = float(properties.get("y", DEFAULT_PLAYER_POSITION.y))
				properties["score"] = 0
				properties["won"] = false
				child.set("properties", properties)
			"collectible":
				properties["collected"] = false
				child.set("properties", properties)
				_collectibles.append(child)
	if not _explicit_input:
		_input_actions = _default_demo_actions()
	for action in _input_actions:
		var frame := int(action.get("frame", -1))
		if not _actions_by_frame.has(frame):
			_actions_by_frame[frame] = []
		_actions_by_frame[frame].append(String(action.get("action", "")))
	_input_action_count = _input_actions.size()
	queue_redraw()


func _default_demo_actions() -> Array:
	var actions: Array = []
	for frame in range(1, 61):
		actions.append({"frame": frame, "action": "move_right"})
	for frame in range(61, 101):
		actions.append({"frame": frame, "action": "move_down"})
	return actions


func _process(_delta: float) -> void:
	for action in _actions_by_frame.get(_frame_index, []):
		_apply_action(String(action))
	_frame_index += 1
	queue_redraw()


func _apply_action(action: String) -> void:
	if _player == null:
		return
	var direction := Vector2.ZERO
	match action:
		"move_up": direction = Vector2.UP
		"move_down": direction = Vector2.DOWN
		"move_left": direction = Vector2.LEFT
		"move_right": direction = Vector2.RIGHT
		_:
			return
	var properties: Dictionary = _player.get("properties")
	var position := Vector2(float(properties.get("x", DEFAULT_PLAYER_POSITION.x)), float(properties.get("y", DEFAULT_PLAYER_POSITION.y)))
	position += direction * float(properties.get("speed", 4))
	position.x = clampf(position.x, PLAYER_BOUNDS.position.x, PLAYER_BOUNDS.end.x)
	position.y = clampf(position.y, PLAYER_BOUNDS.position.y, PLAYER_BOUNDS.end.y)
	properties["x"] = position.x
	properties["y"] = position.y
	for collectible in _collectibles:
		var item_properties: Dictionary = collectible.get("properties")
		if bool(item_properties.get("collected", false)):
			continue
		var item_position := Vector2(float(item_properties.get("x", 0)), float(item_properties.get("y", 0)))
		if position.distance_to(item_position) <= 12.0:
			item_properties["collected"] = true
			properties["score"] = int(properties.get("score", 0)) + int(item_properties.get("value", 1))
			collectible.set("properties", item_properties)
	properties["won"] = int(properties.get("score", 0)) >= int(properties.get("win_target", 3))
	_player.set("properties", properties)


func runtime_summary() -> Dictionary:
	if _player == null:
		return {"frame": _frame_index, "score": 0, "player_position": []}
	var properties: Dictionary = _player.get("properties")
	return {
		"frame": _frame_index,
		"score": int(properties.get("score", 0)),
		"player_position": [properties.get("x", 0), properties.get("y", 0)],
		"won": bool(properties.get("won", false)),
		"input_actions": _input_action_count,
	}


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, VIEW_SIZE), Color(0.035, 0.055, 0.09, 1.0))
	draw_rect(Rect2(Vector2(24, 92), Vector2(912, 424)), Color(0.07, 0.12, 0.18, 1.0))
	draw_rect(Rect2(Vector2(24, 92), Vector2(912, 424)), Color(0.18, 0.28, 0.36, 1.0), false, 2.0)
	for x in range(64, 896, 48):
		draw_line(Vector2(x, 94), Vector2(x, 514), Color(0.10, 0.16, 0.22, 1.0), 1.0)
	for y in range(126, 500, 48):
		draw_line(Vector2(26, y), Vector2(934, y), Color(0.10, 0.16, 0.22, 1.0), 1.0)
	_draw_hud()
	for collectible in _collectibles:
		var item_properties: Dictionary = collectible.get("properties")
		if bool(item_properties.get("collected", false)):
			continue
		var item_position := Vector2(float(item_properties.get("x", 0)), float(item_properties.get("y", 0)))
		draw_circle(item_position, 12.0, Color(0.98, 0.68, 0.28, 1.0))
		draw_circle(item_position, 5.0, Color(1.0, 0.90, 0.60, 1.0))
	if _player != null:
		var player_properties: Dictionary = _player.get("properties")
		var player_position := Vector2(float(player_properties.get("x", DEFAULT_PLAYER_POSITION.x)), float(player_properties.get("y", DEFAULT_PLAYER_POSITION.y)))
		draw_rect(Rect2(player_position - Vector2(13, 13), Vector2(26, 26)), Color(0.20, 0.82, 0.76, 1.0))
		draw_rect(Rect2(player_position - Vector2(6, 6), Vector2(12, 12)), Color(0.88, 0.98, 0.95, 1.0))


func _draw_hud() -> void:
	var score := 0
	var target := 3
	if _player != null:
		var properties: Dictionary = _player.get("properties")
		score = int(properties.get("score", 0))
		target = int(properties.get("win_target", 3))
	_draw_digit(mini(score, 3), Vector2(36, 28), Color(0.36, 0.88, 0.82, 1.0))
	for index in range(target):
		var pip := Rect2(Vector2(80 + index * 24, 30), Vector2(16, 34))
		var pip_color := Color(0.28, 0.78, 0.71, 1.0) if index < score else Color(0.16, 0.24, 0.30, 1.0)
		draw_rect(pip, pip_color)
		draw_rect(pip, Color(0.42, 0.55, 0.62, 1.0), false, 1.0)
	var victory_fill := Color(0.26, 0.76, 0.46, 1.0) if score >= target else Color(0.15, 0.22, 0.28, 1.0)
	draw_rect(Rect2(Vector2(164, 30), Vector2(120, 34)), victory_fill)
	draw_rect(Rect2(Vector2(164, 30), Vector2(120, 34)), Color(0.42, 0.55, 0.62, 1.0), false, 1.0)


func _draw_digit(value: int, origin: Vector2, color: Color) -> void:
	for segment_index in DIGIT_SEGMENTS.get(value, []):
		var segment: Rect2 = SEGMENT_RECTS[segment_index]
		draw_rect(Rect2(origin + segment.position, segment.size), color)
