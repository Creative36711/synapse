extends Node

var entity_id: String = ""
var properties: Dictionary = {}


func _init(definition: Dictionary = {}) -> void:
	entity_id = String(definition.get("id", ""))
	var definition_properties: Variant = definition.get("properties", {})
	if typeof(definition_properties) == TYPE_DICTIONARY:
		properties = definition_properties.duplicate(true)


func runtime_entity_data() -> Dictionary:
	return {
		"id": entity_id,
		"properties": properties.duplicate(true),
	}
