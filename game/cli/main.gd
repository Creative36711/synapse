extends SceneTree

const VALIDATOR_SCRIPT := "res://validation/validator.mjs"


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() == 2 and args[0] == "validate":
		var project_dir := ProjectSettings.globalize_path("res://")
		var repo_root := project_dir.path_join("..").simplify_path()
		var spec_path: String = args[1]
		if spec_path.begins_with("res://"):
			spec_path = ProjectSettings.globalize_path(spec_path)
		elif not spec_path.is_absolute_path():
			spec_path = repo_root.path_join(spec_path).simplify_path()
		args[1] = spec_path

	var script_path := ProjectSettings.globalize_path(VALIDATOR_SCRIPT)
	var command := [script_path]
	command.append_array(args)
	var output: Array = []
	var exit_code := OS.execute("node", command, output, true)
	for line in output:
		print(line)
	quit(exit_code if exit_code >= 0 else 127)
