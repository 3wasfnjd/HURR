extends Node3D
## HURR art test. In the headset: OpenXR, walk around Nouf at true scale.
## On a desktop with `-- --preview`: a fixed camera renders one frame to build/preview.png.

const NOUF_NEAR := "res://assets/models/nouf_20k.glb"
const NOUF_FAR := "res://assets/models/nouf_10k.glb"
const NOUF_POS := Vector3(0.0, 0.0, -2.2)
const FALCON := "res://assets/models/falcon_8k.glb"
const PERCH_POS := Vector3(0.85, 0.0, -1.95)
const PERCH_HEIGHT := 0.9
const LOD_SWITCH_M := 6.0
const MOVE_SPEED := 1.6
const SNAP_DEG := 30.0
const FONT_AR := "res://assets/fonts/baloo-arabic.woff2"
const FONT_EN := "res://assets/fonts/baloo-latin.woff2"

var world: HurrWorld
var nouf: Node3D
var nouf_triangles := {}
var falcon: Node3D
var origin: XROrigin3D
var head: XRCamera3D
var left: XRController3D
var right: XRController3D
var stats: Label3D
var xr: OpenXRInterface
var preview := false
var _snap_ready := true
var _stats_visible := true
var _by_was := false


func _ready() -> void:
	preview = "--preview" in OS.get_cmdline_user_args()
	world = HurrWorld.new()
	world.name = "World"
	add_child(world)
	world.build()
	nouf = _load_nouf()
	add_child(nouf)
	falcon = _load_falcon(world.perch(PERCH_POS, PERCH_HEIGHT))
	add_child(falcon)
	_build_player()
	if preview:
		_render_preview()
		return
	xr = XRServer.find_interface("OpenXR") as OpenXRInterface
	if xr == null or (not xr.is_initialized() and not xr.initialize()):
		push_error("OpenXR could not start")
		return
	get_viewport().use_xr = true
	xr.environment_blend_mode = XRInterface.XR_ENV_BLEND_MODE_OPAQUE


func _load_nouf() -> Node3D:
	## Two levels of detail, same placement; the far one takes over beyond LOD_SWITCH_M.
	var root := Node3D.new()
	root.name = "Nouf"
	root.position = NOUF_POS
	for entry in [[NOUF_NEAR, 0.0, LOD_SWITCH_M], [NOUF_FAR, LOD_SWITCH_M, 0.0]]:
		var scene := (load(entry[0]) as PackedScene).instantiate()
		for mi in scene.find_children("*", "MeshInstance3D", true, false):
			var m := mi as MeshInstance3D
			m.material_override = HurrWorld.flat_material()
			m.visibility_range_begin = entry[1]
			m.visibility_range_end = entry[2]
			var tris := 0
			for s in m.mesh.get_surface_count():
				var a := m.mesh.surface_get_arrays(s)
				var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX]
				tris += (idx.size() if idx.size() > 0 else (a[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
			nouf_triangles[entry[0]] = nouf_triangles.get(entry[0], 0) + tris
		root.add_child(scene)
	return root


func _load_falcon(top: Vector3) -> Node3D:
	## The saker on her stone, standing on the pillar beside Nouf's gloved (left) side,
	## turned a little toward the player.
	var scene := (load(FALCON) as PackedScene).instantiate() as Node3D
	scene.name = "Falcon"
	for mi in scene.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).material_override = HurrWorld.flat_material()
	scene.position = top
	scene.rotation_degrees.y = -25.0
	return scene


func _build_player() -> void:
	origin = XROrigin3D.new()
	origin.name = "Player"
	origin.position = Vector3(0.0, 0.0, 0.6)
	add_child(origin)
	head = XRCamera3D.new()
	head.name = "Head"
	head.near = 0.05
	head.far = 200.0
	origin.add_child(head)
	left = _controller("left_hand", "Left")
	right = _controller("right_hand", "Right")
	stats = Label3D.new()
	stats.name = "Stats"
	stats.font = _font()
	stats.font_size = 40
	stats.pixel_size = 0.0006
	stats.outline_size = 8
	stats.modulate = Color(1, 0.96, 0.9)
	stats.position = Vector3(0.0, 0.07, -0.05)
	stats.rotation_degrees = Vector3(-35, 0, 0)
	stats.billboard = BaseMaterial3D.BILLBOARD_DISABLED
	left.add_child(stats)


func _font() -> Font:
	var en := load(FONT_EN) as Font
	var ar := (load(FONT_AR) as FontFile).duplicate() as FontFile
	ar.fallbacks = [en]
	return ar


func _controller(tracker: String, node_name: String) -> XRController3D:
	var c := XRController3D.new()
	c.name = node_name
	c.tracker = tracker
	c.pose = "grip_pose"
	origin.add_child(c)
	# A small faceted leather "glove block" so the hands read in the same style.
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.05, 0.03, 0.10)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.55, 0.36, 0.20) if node_name == "Left" else Color(0.82, 0.62, 0.48)
	mat.roughness = 1.0
	mi.material_override = mat
	c.add_child(mi)
	return c


func _physics_process(delta: float) -> void:
	if preview or left == null:
		return
	# Left stick: walk, relative to where the head looks (flattened to the ground).
	var stick := left.get_vector2("thumbstick")
	if stick.length() > 0.15:
		var fwd := -head.global_transform.basis.z
		fwd.y = 0.0
		fwd = fwd.normalized()
		var rgt := Vector3(-fwd.z, 0.0, fwd.x)
		origin.global_position += (fwd * stick.y + rgt * stick.x) * MOVE_SPEED * delta
	# Right stick: comfort snap turn around the head.
	var turn := right.get_vector2("thumbstick").x
	if absf(turn) > 0.7 and _snap_ready:
		_snap_ready = false
		var pivot := head.global_position
		var angle := deg_to_rad(-SNAP_DEG * signf(turn))
		var t := origin.global_transform
		t.origin -= pivot
		t = Transform3D(Basis(Vector3.UP, angle), Vector3.ZERO) * t
		t.origin += pivot
		origin.global_transform = t
	elif absf(turn) < 0.3:
		_snap_ready = true
	# Y / B toggles the stats card.
	var by := left.is_button_pressed("by_button") or right.is_button_pressed("by_button")
	if by and not _by_was:
		_stats_visible = not _stats_visible
		stats.visible = _stats_visible
	_by_was = by


func _process(_delta: float) -> void:
	if stats == null or not stats.visible:
		return
	var fps := Engine.get_frames_per_second()
	var hz := xr.display_refresh_rate if xr != null and xr.is_initialized() else 0.0
	stats.text = "إطارات/ث  %d / %d\nرسم  %d\nمثلثات  %dk\nمسافة نوف  %.1f م" % [
		fps, int(hz),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME) / 1000.0),
		(head.global_position * Vector3(1, 0, 1)).distance_to(NOUF_POS),
	]


func _render_preview() -> void:
	var cam := Camera3D.new()
	cam.fov = 60.0
	add_child(cam)
	var shot := "front"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			shot = a.trim_prefix("--shot=")
	match shot:
		"wide":
			cam.position = Vector3(3.2, 1.7, 4.0)
			cam.look_at(Vector3(-0.5, 2.0, -8.0))
		"falcon":
			cam.position = PERCH_POS + Vector3(-0.35, 1.25, 0.95)
			cam.look_at(PERCH_POS + Vector3(0.0, PERCH_HEIGHT + 0.22, 0.0))
		"face":
			cam.position = NOUF_POS + Vector3(0.25, 1.55, 0.75)
			cam.look_at(NOUF_POS + Vector3(0.0, 1.5, 0.0))
		_:
			cam.position = Vector3(0.6, 1.6, 0.6)
			cam.look_at(NOUF_POS + Vector3(0.0, 1.0, 0.0))
	cam.current = true
	stats.visible = false
	left.visible = false
	right.visible = false
	for i in 4:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
	var out := "res://build/preview_%s.png" % shot
	img.save_png(out)
	print("preview saved: ", out, " world tris: ", world.triangles, " nouf: ", nouf_triangles)
	get_tree().quit()
