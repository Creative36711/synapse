extends SceneTree

const EntityInstance = preload("res://runtime/entity_instance.gd")


func _initialize() -> void:
	var definition := {
		"id": "entity.player",
		"properties": {"health": 100, "enabled": true},
	}
	var first = EntityInstance.new(definition)
	var second = EntityInstance.new(definition)
	first.properties["health"] = 25
	second.properties["enabled"] = false
	var independent: bool = (
		first.properties["health"] == 25
		and first.properties["enabled"] == true
		and second.properties["health"] == 100
		and second.properties["enabled"] == false
		and definition.properties["health"] == 100
		and definition.properties["enabled"] == true
	)
	if not independent:
		push_error("entity instance properties are shared with another instance or definition")
		first.free()
		second.free()
		quit(1)
		return
	print(JSON.stringify({
		"code": "test.runtime.entity_instances.independent",
		"params": {"instances": 2, "independent": true},
	}))
	first.free()
	second.free()
	quit(0)
