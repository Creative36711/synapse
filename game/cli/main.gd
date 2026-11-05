extends SceneTree

const VALIDATOR_SCRIPT := "res://validation/validator.mjs"
const RESOLVER_SCRIPT := "res://modules/resolver.mjs"


func _initialize() -> void:
	var user_args := OS.get_cmdline_user_args()
	var args := PackedStringArray()
	var locale := "en"
	var locale_missing := false
	var index := 0
	while index < user_args.size():
		if user_args[index] == "--locale":
			if index + 1 < user_args.size() and not user_args[index + 1].begins_with("--"):
				locale = user_args[index + 1]
				index += 2
			else:
				locale_missing = true
				index += 1
		else:
			args.append(user_args[index])
			index += 1

	var helper_script := VALIDATOR_SCRIPT
	if args.size() >= 1 and args[0] == "resolve":
		helper_script = RESOLVER_SCRIPT

	if args.size() >= 2 and args[0] in ["validate", "resolve"]:
		var project_dir := ProjectSettings.globalize_path("res://")
		var repo_root := project_dir.path_join("..").simplify_path()
		var spec_path: String = args[1]
		if spec_path.begins_with("res://"):
			spec_path = ProjectSettings.globalize_path(spec_path)
		elif not spec_path.is_absolute_path():
			spec_path = repo_root.path_join(spec_path).simplify_path()
		args[1] = spec_path

	var script_path := ProjectSettings.globalize_path(helper_script)
	var command := [script_path]
	command.append_array(args)
	if helper_script == VALIDATOR_SCRIPT:
		command.append("--locale")
		if not locale_missing:
			command.append(locale)
	var output: Array = []
	var exit_code := OS.execute("node", command, output, true)
	for line in output:
		print(line)
	quit(exit_code if exit_code >= 0 else 127)
