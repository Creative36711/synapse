extends Node
## Remote "gamepad" for playing the game from outside.
## Reads commands from <ctl_dir>/cmd.txt, sends REAL keyboard events into the engine,
## and pauses the game whenever there is nothing to do (so the player can think).
## Commands (one per line):
##   hold <keys> <seconds>   e.g. "hold right+down 0.4"  (keys: left right up down enter space)
##   tap <keys>              press & release on the next frame
##   wait <seconds>          let the game run without input
##   shot <file.png>         save a screenshot of the current frame
##   quit

const KEYS := {"left": KEY_LEFT, "right": KEY_RIGHT, "up": KEY_UP, "down": KEY_DOWN, "enter": KEY_ENTER, "space": KEY_SPACE}

var ctl_dir := "/tmp/game_ctl"
var queue: Array[String] = []
var busy := false
var batch := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--ctl="):
			ctl_dir = a.substr(6)
	DirAccess.make_dir_recursive_absolute(ctl_dir)
	get_tree().paused = true
	_ack("ready")
	_loop()


func _ack(msg: String) -> void:
	var f := FileAccess.open(ctl_dir + "/ack.txt", FileAccess.WRITE)
	f.store_string(msg + "\n")


func _set_keys(keys: String, pressed: bool) -> void:
	for k in keys.split("+"):
		if not KEYS.has(k):
			push_error("Unknown key: " + k)
			continue
		var ev := InputEventKey.new()
		ev.keycode = KEYS[k]
		ev.physical_keycode = KEYS[k]
		ev.pressed = pressed
		Input.parse_input_event(ev)


func _run_for(seconds: float) -> void:
	get_tree().paused = false
	var left := seconds
	while left > 0.0:
		await get_tree().process_frame
		left -= get_process_delta_time()
	get_tree().paused = true


func _loop() -> void:
	while true:
		await get_tree().process_frame
		var path := ctl_dir + "/cmd.txt"
		if not FileAccess.file_exists(path):
			continue
		var text := FileAccess.get_file_as_string(path)
		DirAccess.remove_absolute(path)
		batch += 1
		for line in text.split("\n", false):
			var p := line.strip_edges().split(" ", false)
			if p.is_empty():
				continue
			match p[0]:
				"hold":
					_set_keys(p[1], true)
					await _run_for(float(p[2]))
					_set_keys(p[1], false)
					await get_tree().process_frame
				"tap":
					_set_keys(p[1], true)
					get_tree().paused = false
					await get_tree().process_frame
					_set_keys(p[1], false)
					await get_tree().process_frame
					get_tree().paused = true
				"wait":
					await _run_for(float(p[1]))
				"shot":
					await RenderingServer.frame_post_draw
					var img := get_viewport().get_texture().get_image()
					img.save_png(p[1])
					print("screenshot saved: ", p[1])
				"quit":
					get_tree().quit()
					return
		_ack("done %d" % batch)
