extends Node2D
## Coin Rush: collect 10 coins, avoid the red blobs. Arrow keys to move, Enter to restart.

const W := 800.0
const H := 600.0
const HUD_H := 48.0
const PLAYER_SIZE := 30.0
const PLAYER_SPEED := 240.0
const COIN_R := 11.0
const ENEMY_R := 16.0
const GOAL := 10

var player := Vector2()
var coins: Array[Vector2] = []
var enemies: Array = [] # [{pos, vel}]
var score := 0
var lives := 3
var invuln := 0.0
var state := "play" # play / win / over
var t := 0.0
var rng := RandomNumberGenerator.new()
var font: Font


func _ready() -> void:
	# Load a TTF at runtime (no editor import step needed).
	var ff := FontFile.new()
	if ff.load_dynamic_font("res://DejaVuSans-Bold.ttf") == OK:
		font = ff
	else:
		font = ThemeDB.fallback_font
	restart()


func restart() -> void:
	rng.seed = 12345
	player = Vector2(W / 2, (H + HUD_H) / 2)
	score = 0
	lives = 3
	invuln = 1.0
	state = "play"
	coins.clear()
	for i in 4:
		coins.append(_random_free_pos())
	enemies.clear()
	var starts := [Vector2(90, 120), Vector2(710, 540), Vector2(700, 130)]
	var vels := [Vector2(110, 70), Vector2(-90, -100), Vector2(-70, 120)]
	for i in 3:
		enemies.append({"pos": starts[i], "vel": vels[i]})


func _random_free_pos() -> Vector2:
	for attempt in 50:
		var p := Vector2(rng.randf_range(40, W - 40), rng.randf_range(HUD_H + 40, H - 40))
		if p.distance_to(player) > 120:
			return p
	return Vector2(60, H - 60)


func _process(delta: float) -> void:
	t += delta
	if state != "play":
		if Input.is_action_just_pressed("ui_accept"):
			restart()
		queue_redraw()
		return

	var dir := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	player += dir * PLAYER_SPEED * delta
	player.x = clampf(player.x, PLAYER_SIZE / 2, W - PLAYER_SIZE / 2)
	player.y = clampf(player.y, HUD_H + PLAYER_SIZE / 2, H - PLAYER_SIZE / 2)

	for i in coins.size():
		if coins[i].distance_to(player) < COIN_R + PLAYER_SIZE / 2:
			score += 1
			coins[i] = _random_free_pos()
	if score >= GOAL:
		state = "win"

	invuln = maxf(0.0, invuln - delta)
	for e in enemies:
		e.pos += e.vel * delta
		if e.pos.x < ENEMY_R or e.pos.x > W - ENEMY_R:
			e.vel.x = -e.vel.x
		if e.pos.y < HUD_H + ENEMY_R or e.pos.y > H - ENEMY_R:
			e.vel.y = -e.vel.y
		e.pos.x = clampf(e.pos.x, ENEMY_R, W - ENEMY_R)
		e.pos.y = clampf(e.pos.y, HUD_H + ENEMY_R, H - ENEMY_R)
		if invuln <= 0.0 and e.pos.distance_to(player) < ENEMY_R + PLAYER_SIZE / 2 - 2:
			lives -= 1
			invuln = 1.5
			if lives <= 0:
				state = "over"
	queue_redraw()


func _draw() -> void:
	# Background + grid.
	draw_rect(Rect2(0, 0, W, H), Color("1d2333"))
	for x in range(0, int(W), 40):
		draw_line(Vector2(x, HUD_H), Vector2(x, H), Color(1, 1, 1, 0.04))
	for y in range(int(HUD_H), int(H), 40):
		draw_line(Vector2(0, y), Vector2(W, y), Color(1, 1, 1, 0.04))

	# Coins.
	for c in coins:
		var pulse := 1.0 + 0.12 * sin(t * 6.0 + c.x)
		draw_circle(c, COIN_R * pulse + 2, Color("8a6d00"))
		draw_circle(c, COIN_R * pulse, Color("ffd23f"))
		draw_circle(c + Vector2(-3, -3), COIN_R * 0.3, Color(1, 1, 1, 0.7))

	# Enemies.
	for e in enemies:
		draw_circle(e.pos, ENEMY_R, Color("e63946"))
		var look: Vector2 = (player - e.pos).normalized() * 2.5
		for s in [-1, 1]:
			var eye: Vector2 = e.pos + Vector2(6 * s, -4)
			draw_circle(eye, 4.5, Color.WHITE)
			draw_circle(eye + look, 2.2, Color.BLACK)

	# Player (blinks while invulnerable).
	if invuln <= 0.0 or int(t * 10) % 2 == 0:
		var r := Rect2(player - Vector2.ONE * PLAYER_SIZE / 2, Vector2.ONE * PLAYER_SIZE)
		draw_rect(r, Color("4cc9f0"))
		draw_rect(r, Color("1b6f8a"), false, 3.0)
		for s in [-1, 1]:
			draw_circle(player + Vector2(6 * s, -3), 4, Color.WHITE)
			draw_circle(player + Vector2(6 * s, -3), 2, Color("101010"))

	# HUD.
	draw_rect(Rect2(0, 0, W, HUD_H), Color("10141f"))
	draw_string(font, Vector2(16, 32), "COINS: %d / %d" % [score, GOAL], HORIZONTAL_ALIGNMENT_LEFT, -1, 24, Color("ffd23f"))
	draw_string(font, Vector2(320, 32), "COIN RUSH", HORIZONTAL_ALIGNMENT_LEFT, -1, 24, Color.WHITE)
	draw_string(font, Vector2(620, 32), "LIVES: %d" % lives, HORIZONTAL_ALIGNMENT_LEFT, -1, 24, Color("ff6b6b"))

	if state != "play":
		draw_rect(Rect2(0, 0, W, H), Color(0, 0, 0, 0.55))
		var msg := "YOU WIN!" if state == "win" else "GAME OVER"
		draw_string(font, Vector2(0, 280), msg, HORIZONTAL_ALIGNMENT_CENTER, W, 64, Color("ffd23f") if state == "win" else Color("ff6b6b"))
		draw_string(font, Vector2(0, 340), "Press Enter to play again", HORIZONTAL_ALIGNMENT_CENTER, W, 24, Color.WHITE)

