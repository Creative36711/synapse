extends Node3D
## Smoke test scene: textured cube (imported PNG) on a plane, sun with shadows, procedural sky,
## a text label. Left/Right arrows rotate the cube (to verify input injection).

var cube: MeshInstance3D


func _ready() -> void:
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_SKY
	env.environment.sky = Sky.new()
	env.environment.sky.sky_material = ProceduralSkyMaterial.new()
	env.environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	add_child(env)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -30, 0)
	sun.shadow_enabled = true
	add_child(sun)

	var cam := Camera3D.new()
	cam.position = Vector3(0, 2.2, 4.5)
	cam.look_at_from_position(cam.position, Vector3(0, 0.5, 0))
	add_child(cam)

	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(12, 12)
	ground.mesh = plane
	var gmat := StandardMaterial3D.new()
	gmat.albedo_color = Color("6a994e")
	ground.material_override = gmat
	add_child(ground)

	cube = MeshInstance3D.new()
	cube.mesh = BoxMesh.new()
	cube.position = Vector3(0, 0.75, 0)
	cube.rotation_degrees = Vector3(0, 25, 0)
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = load("res://checker.png") # Requires the import step (--import).
	cube.material_override = mat
	add_child(cube)

	var label := Label.new()
	label.text = "Synapse Godot OK — %s" % Engine.get_version_info().string
	label.position = Vector2(12, 8)
	label.add_theme_font_size_override("font_size", 22)
	label.add_theme_color_override("font_outline_color", Color.BLACK)
	label.add_theme_constant_override("outline_size", 6)
	add_child(label)


func _process(delta: float) -> void:
	var dir := Input.get_axis("ui_left", "ui_right")
	cube.rotate_y(dir * 2.0 * delta)
