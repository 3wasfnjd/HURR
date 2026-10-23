extends SceneTree
## Headless checks for the art-test build. Run:
## godot --headless --xr-mode off --path . --script res://tests/test_art_scene.gd

var failures := 0


func check(ok: bool, what: String) -> void:
	print(("PASS: " if ok else "FAIL: ") + what)
	if not ok:
		failures += 1


func _initialize() -> void:
	# Project: fully immersive VR, OpenXR on, Mobile renderer.
	check(ProjectSettings.get_setting("xr/openxr/enabled") == true, "OpenXR enabled")
	check(int(ProjectSettings.get_setting("xr/openxr/environment_blend_mode")) == 0, "opaque (no passthrough)")
	check(ProjectSettings.get_setting("rendering/renderer/rendering_method.mobile") == "mobile", "Mobile renderer on Android")
	check(ClassDB.class_exists("OpenXRFbPassthroughExtension"), "Meta OpenXR vendors extension loaded")

	var amap := load("res://config/openxr_action_map.tres") as OpenXRActionMap
	var names := []
	for s in amap.action_sets:
		for a in s.actions:
			names.append(a.resource_name)
	for need in ["thumbstick", "by_button", "grip_pose"]:
		check(need in names, "action map has '%s'" % need)

	# Nouf: exact triangle budgets, true scale, vertex colours present.
	for entry in [["res://assets/models/nouf_20k.glb", 20000], ["res://assets/models/nouf_10k.glb", 10000]]:
		var scene := (load(entry[0]) as PackedScene).instantiate()
		var tris := 0
		var has_color := true
		var aabb := AABB()
		var first := true
		for mi in scene.find_children("*", "MeshInstance3D", true, false):
			var m := mi as MeshInstance3D
			for s in m.mesh.get_surface_count():
				var a := m.mesh.surface_get_arrays(s)
				var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX]
				var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
				tris += (idx.size() if idx.size() > 0 else v.size()) / 3
				has_color = has_color and a[Mesh.ARRAY_COLOR] != null and (a[Mesh.ARRAY_COLOR] as PackedColorArray).size() == v.size()
			var box: AABB = m.mesh.get_aabb()
			aabb = box if first else aabb.merge(box)
			first = false
		check(tris == entry[1], "%s has %d triangles (got %d)" % [entry[0].get_file(), entry[1], tris])
		check(has_color, "%s carries vertex colours" % entry[0].get_file())
		check(absf(aabb.size.y - 1.65) < 0.01, "%s stands 1.65 m tall (got %.3f)" % [entry[0].get_file(), aabb.size.y])
		check(absf(aabb.position.y) < 0.01, "%s feet on the ground (min y %.3f)" % [entry[0].get_file(), aabb.position.y])
		scene.free()

	# Falcon body (stone cut away so she can fly): budget and true size.
	var f := (load("res://assets/models/falcon_body.glb") as PackedScene).instantiate()
	var ftris := 0
	var fbox := AABB()
	for mi in f.find_children("*", "MeshInstance3D", true, false):
		var fm := (mi as MeshInstance3D).mesh
		fbox = fm.get_aabb()
		for s in fm.get_surface_count():
			var a := fm.surface_get_arrays(s)
			var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX]
			ftris += (idx.size() if idx.size() > 0 else (a[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
	check(ftris > 5000 and ftris < 7000, "falcon_body.glb within budget (got %d)" % ftris)
	check(fbox.end.y > 0.31 and fbox.end.y < 0.37, "falcon stands ~0.34 m above her feet (got %.3f)" % fbox.end.y)
	f.free()

	# World: generated, deterministic, within its triangle budget.
	var w := HurrWorld.new()
	root.add_child(w)
	w.build()
	check(w.triangles > 2000 and w.triangles < 12000, "world triangles in budget (got %d)" % w.triangles)
	check(w.get_node_or_null("Sun") is DirectionalLight3D, "sun present")
	check(w.get_node_or_null("Engravings") is MeshInstance3D, "engravings present")
	var w2 := HurrWorld.new()
	root.add_child(w2)
	w2.build()
	check(w2.triangles == w.triangles, "world generation is deterministic")
	var top := w.perch(Vector3(1, 0, 0), 0.9)
	check(absf(top.y - 0.9) < 0.001, "perch top at 0.9 m")
	w.queue_free()
	w2.queue_free()

	# Main scene loads.
	var main := load("res://scenes/main.tscn") as PackedScene
	check(main != null and main.can_instantiate(), "main scene loads")
	check(FileAccess.file_exists("res://vr_splash.png"), "studio splash present")

	# Rig wiring (regression: an invalid pose name hid both hands and the stats card).
	var game := main.instantiate()
	root.add_child(game)
	await process_frame
	for side in ["Left", "Right"]:
		var c := game.get_node_or_null("Player/" + side) as XRController3D
		check(c != null and String(c.pose) in ["grip", "aim"], "%s controller uses a valid pose (got %s)" % [side, c.pose if c else "none"])
	var card := game.get_node_or_null("Player/Head/Stats") as Label3D
	check(card != null and card.visible, "stats card is pinned to the head and visible at start")
	game.queue_free()

	print("RESULT: %d failure(s)" % failures)
	quit(1 if failures > 0 else 0)
