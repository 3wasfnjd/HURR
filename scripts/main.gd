extends Node3D
## HURR prototype. The saker comes to your left glove; point the glove at a trapper and pull
## the left trigger to send her. She strikes and flies back. Right trigger recalls her (lure).
## On a desktop with `-- --preview --shot=NAME`: a fixed camera renders one frame to build/.

const NOUF_NEAR := "res://assets/models/nouf_20k.glb"
const NOUF_FAR := "res://assets/models/nouf_10k.glb"
const NOUF_POS := Vector3(-2.4, 0.0, -1.3)    # beside the arena, not in the line of fire
const NOUF_YAW := 0.95                         # turned toward the player
const PERCH_POS := Vector3(-1.45, 0.0, -1.75)
const PERCH_HEIGHT := 0.9
const LOD_SWITCH_M := 6.0
const MOVE_SPEED := 1.6
const SNAP_DEG := 30.0
const FONT_AR := "res://assets/fonts/cairo-arabic-700-normal.woff2"
const FONT_EN := "res://assets/fonts/cairo-latin-500-normal.woff2"

var world: HurrWorld
var nouf: Node3D
var nouf_triangles := {}
var falcon: HurrFalcon
var arena: HurrArena
var left_aim: XRController3D
var glove_seat: Node3D
var aim_ray: MeshInstance3D
var target_ring: MeshInstance3D
var msg: Label3D
var flash: MeshInstance3D
var build_number := "dev"
var _msg_t := 0.0
var _flash_t := 0.0
var _lt_was := false
var _rt_was := false
var _intro_t := 2.5
var _aimed: HurrTrapper
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
	_build_player()
	falcon = HurrFalcon.new()
	falcon.name = "Falcon"
	add_child(falcon)
	falcon.perch_at(world.perch(PERCH_POS, PERCH_HEIGHT), atan2(PERCH_POS.x, PERCH_POS.z - 0.6))
	falcon.glove = glove_seat
	arena = HurrArena.new()
	arena.name = "Arena"
	arena.world = world
	arena.player_head = head
	arena.falcon = falcon
	add_child(arena)
	arena.message.connect(_show_message)
	arena.player_hit.connect(_on_player_hit)
	falcon.struck.connect(func(_t): arena.on_strike(); _pulse(left, 0.8, 0.10))
	falcon.caught.connect(_on_caught)
	if FileAccess.file_exists("res://build_number.txt"):
		build_number = FileAccess.get_file_as_string("res://build_number.txt").strip_edges()
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
	root.rotation.y = NOUF_YAW
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
	# Where the falcon stands: on top of the left glove block.
	glove_seat = Node3D.new()
	glove_seat.name = "GloveSeat"
	glove_seat.position = Vector3(0, 0.02, 0.0)
	left.add_child(glove_seat)
	# Pointing comes from the left hand's aim pose (the gloved arm sends the bird).
	left_aim = XRController3D.new()
	left_aim.name = "LeftAim"
	left_aim.tracker = "left_hand"
	left_aim.pose = "aim"
	origin.add_child(left_aim)
	aim_ray = MeshInstance3D.new()
	var ray := BoxMesh.new()
	ray.size = Vector3(0.006, 0.006, 1.6)
	aim_ray.mesh = ray
	aim_ray.position = Vector3(0, 0, -0.85)
	aim_ray.material_override = _glow(Color(1.0, 0.85, 0.45, 0.55))
	left_aim.add_child(aim_ray)
	target_ring = MeshInstance3D.new()
	var tor := TorusMesh.new()
	tor.inner_radius = 0.42
	tor.outer_radius = 0.50
	tor.rings = 12
	tor.ring_segments = 4
	target_ring.mesh = tor
	target_ring.material_override = _glow(Color(1.0, 0.80, 0.30, 0.9))
	target_ring.visible = false
	add_child(target_ring)
	msg = Label3D.new()
	msg.name = "Message"
	msg.font = _font()
	msg.font_size = 64
	msg.outline_size = 12
	msg.pixel_size = 0.0011
	msg.position = Vector3(0, 0.18, -1.6)
	msg.no_depth_test = true
	msg.render_priority = 11
	msg.modulate = Color(1, 0.95, 0.85, 0)
	head.add_child(msg)
	flash = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.6, 0.4)
	flash.mesh = q
	flash.position = Vector3(0, 0, -0.12)
	flash.material_override = _glow(Color(0.75, 0.10, 0.08, 0.0))
	flash.visible = false
	head.add_child(flash)
	stats = Label3D.new()
	stats.name = "Stats"
	stats.font = _font()
	stats.font_size = 40
	stats.outline_size = 8
	stats.modulate = Color(1, 0.96, 0.9)
	stats.pixel_size = 0.0006
	stats.position = Vector3(-0.34, -0.30, -0.9)
	stats.no_depth_test = true
	stats.render_priority = 10
	stats.billboard = BaseMaterial3D.BILLBOARD_DISABLED
	head.add_child(stats)


func _font() -> Font:
	var en := load(FONT_EN) as Font
	var ar := (load(FONT_AR) as FontFile).duplicate() as FontFile
	ar.fallbacks = [en]
	return ar


func _glow(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = c
	m.no_depth_test = false
	return m


func _pulse(c: XRController3D, amp: float, dur: float) -> void:
	if c != null and not preview:
		c.trigger_haptic_pulse("haptic", 0.0, amp, dur, 0.0)


func _show_message(text: String) -> void:
	msg.text = text
	_msg_t = 2.6


func _on_player_hit(lives_left: int) -> void:
	_flash_t = 0.45
	flash.visible = true
	_pulse(left, 1.0, 0.3)
	_pulse(right, 1.0, 0.3)
	if lives_left > 0:
		_show_message("أصابتك الشبكة — بقي %d" % lives_left)


func _on_caught() -> void:
	_pulse(left, 0.45, 0.08)
	if arena != null and not arena._running:
		arena.start(2.0)
		_show_message("الصقرة على يدك — وجّه الدس واضغط الزناد")


func _controller(tracker: String, node_name: String) -> XRController3D:
	var c := XRController3D.new()
	c.name = node_name
	c.tracker = tracker
	c.pose = "grip"   # pose names drop the "_pose" suffix (as in Mafateeh/SHADDA)
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
	# Falcon: intro call, aim, launch (left trigger), recall (right trigger).
	if _intro_t > 0.0:
		_intro_t -= delta
		if _intro_t <= 0.0:
			falcon.call_to_glove()
	var aim_o := left_aim.global_position
	var aim_d := -left_aim.global_transform.basis.z
	_aimed = arena.best_target(aim_o, aim_d) if falcon.is_home() else null
	aim_ray.visible = falcon.is_home()
	target_ring.visible = _aimed != null
	if _aimed != null:
		target_ring.global_position = _aimed.global_position + Vector3(0, 0.05, 0)
	var lt := left.get_float("trigger") > 0.6
	if lt and not _lt_was and falcon.is_home():
		var point := aim_o + aim_d * 12.0
		if aim_d.y < -0.05:
			point = aim_o + aim_d * minf(14.0, (aim_o.y - 0.2) / -aim_d.y)
		if falcon.launch(_aimed, point):
			_pulse(left, 0.6, 0.12)
	_lt_was = lt
	var rt := right.get_float("trigger") > 0.6
	if rt and not _rt_was:
		falcon.recall()
	_rt_was = rt
	# Y / B toggles the stats card.
	var by := left.is_button_pressed("by_button") or right.is_button_pressed("by_button")
	if by and not _by_was:
		_stats_visible = not _stats_visible
		stats.visible = _stats_visible
	_by_was = by


func _process(delta: float) -> void:
	if _msg_t > 0.0:
		_msg_t -= delta
		msg.modulate.a = clampf(_msg_t / 0.5, 0.0, 1.0)
	if _flash_t > 0.0:
		_flash_t -= delta
		(flash.material_override as StandardMaterial3D).albedo_color.a = clampf(_flash_t, 0.0, 0.45)
		flash.visible = _flash_t > 0.0
	if stats == null or not stats.visible:
		return
	var fps := Engine.get_frames_per_second()
	var hz := xr.display_refresh_rate if xr != null and xr.is_initialized() else 0.0
	var hands := "اليد اليسرى %s · اليمنى %s" % [
		"متصلة" if left.get_has_tracking_data() else "غير متصلة",
		"متصلة" if right.get_has_tracking_data() else "غير متصلة"]
	var game := "بناء %s · الموجة %d · الصحة %d · ضربات %d" % [
		build_number, arena.wave + 1, arena.lives, arena.strikes]
	stats.text = "%s\nإطارات/ث  %d / %d · رسم  %d · مثلثات  %dk\nمسافة نوف  %.1f م\n%s" % [
		game, fps, int(hz),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME) / 1000.0),
		(head.global_position * Vector3(1, 0, 1)).distance_to(NOUF_POS),
		hands,
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
		"action":
			# A frozen gameplay moment: two trappers (one winding up), falcon diving at one.
			cam.position = Vector3(0.0, 1.6, 0.6)
			cam.look_at(Vector3(0.6, 1.3, -6.0))
			for spot in [Vector3(-2.2, 0, -6.5), Vector3(2.4, 0, -7.5)]:
				var t := HurrTrapper.new()
				t.world = world
				t.player_head = cam
				t.position = spot
				arena.add_child(t)
			var tw: HurrTrapper = arena.get_child(1)
			tw.state = HurrTrapper.S.WINDUP
			tw.set("_t", 99.0)
			falcon.state = HurrFalcon.S.OUTBOUND
			falcon.set_process(false)
			falcon.global_position = Vector3(-1.0, 2.1, -3.6)
			falcon.rotation.y = atan2(1.2, 2.9)
			falcon._set_wings_visible(true)
			falcon._pivot.rotation.x = HurrFalcon.FLY_PITCH
			falcon._flap_wings(0.55)
		"face":
			var front := Vector3(sin(NOUF_YAW), 0, cos(NOUF_YAW))
			cam.position = NOUF_POS + front * 0.8 + Vector3(0, 1.55, 0)
			cam.look_at(NOUF_POS + Vector3(0.0, 1.5, 0.0))
		_:
			cam.position = Vector3(0.6, 1.6, 0.6)
			cam.look_at(NOUF_POS + Vector3(0.0, 1.0, 0.0))
	cam.current = true
	if shot == "hud":
		# What the player sees on start: head camera at standing height with the stats card.
		head.position = Vector3(0, 1.6, 0)
		head.current = true
		_process(0.0)
	else:
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
