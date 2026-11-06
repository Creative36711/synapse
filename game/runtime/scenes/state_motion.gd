extends Node2D

const FRAME_STEP := 1.5


func _ready() -> void:
	set_process(true)


func _process(_delta: float) -> void:
	position.x += FRAME_STEP
