class_name HurrTrapper
extends Node3D
## A falcon trapper (the antagonists poach wild falcons; they are not falconers).
## Walks in, stops at throwing range, raises the net (telegraph), throws it at where the
## player's head is. First falcon strike stuns (and cancels a throw); a strike while stunned
## sends him running. Faceted primitives in the "Naqsh" style; identified by his net, not by
## a costume stereotype.

signal net_thrown(net: Node3D)
signal fled

enum S { APPROACH, WINDUP, RECOVER, STUNNED, FLEE }

const THROW_RANGE := 6.0
const WINDUP_TIME := 1.1
const RECOVER_TIME := 3.2
const STUN_TIME := 3.0
const FLEE_TIME := 2.6

var state := S.APPROACH
var world: HurrWorld
var player_head: Node3D
var speed := 1.1
var hits := 0
var _t := 0.0
var _arm: Node3D
var _net_held: MeshInstance3D
var _stars: Node3D
var _body: Node3D


func _ready() -> void:
	_body = Node3D.new()
	add_child(_body)
	# Dark earth tones so they read against the pale sand (silhouette first).
	var robe := Color(0.30, 0.24, 0.21)
	var vest := Color(0.17, 0.14, 0.13)
	var skin := Color(0.55, 0.38, 0.28)
	var wrap := Color(0.50, 0.29, 0.21)
	_part(_prism(0.30, 0.22, 1.0, 7), robe, Vector3(0, 0.0, 0))           # flared long robe
	_part(_prism(0.22, 0.30, 0.42, 7), vest, Vector3(0, 0.95, 0))         # chest widening to the shoulders
	_part(_prism(0.08, 0.08, 0.08, 6), skin, Vector3(0, 1.37, 0))         # neck
	_part(_prism(0.12, 0.11, 0.18, 7), skin, Vector3(0, 1.44, 0))         # face
	_part(_prism(0.14, 0.12, 0.12, 7), wrap, Vector3(0, 1.58, 0))         # head cloth
	_arm = Node3D.new()
	_arm.position = Vector3(0.31, 1.33, 0)
	_body.add_child(_arm)
	var arm_mesh := MeshInstance3D.new()
	arm_mesh.mesh = _prism(0.05, 0.06, 0.55, 5)
	arm_mesh.material_override = HurrWorld.flat_material()
	arm_mesh.rotation.x = PI      # hangs down from the shoulder
	_tint(arm_mesh, robe)
	_arm.add_child(arm_mesh)
	_net_held = MeshInstance3D.new()
	_net_held.mesh = HurrNet.net_mesh(0.22)
	_net_held.material_override = HurrNet.net_material()
	_net_held.position = Vector3(0, -0.58, 0)
	_arm.add_child(_net_held)
	_stars = Node3D.new()
	_stars.position = Vector3(0, 1.85, 0)
	for i in 3:
		var s := MeshInstance3D.new()
		var m := PrismMesh.new()
		m.size = Vector3(0.07, 0.07, 0.02)
		s.mesh = m
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color(1.0, 0.82, 0.30)
		mat.emission_enabled = true
		mat.emission = Color(1.0, 0.75, 0.2)
		s.material_override = mat
		var a := TAU * i / 3.0
		s.position = Vector3(cos(a) * 0.2, 0, sin(a) * 0.2)
		_stars.add_child(s)
	_stars.visible = false
	add_child(_stars)
	_snap_to_ground()


func _prism(r_bottom: float, r_top: float, h: float, sides: int) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in sides:
		var a0 := TAU * i / sides
		var a1 := TAU * (i + 1) / sides
		var b0 := Vector3(cos(a0) * r_bottom, 0, sin(a0) * r_bottom)
		var b1 := Vector3(cos(a1) * r_bottom, 0, sin(a1) * r_bottom)
		var t0 := Vector3(cos(a0) * r_top, h, sin(a0) * r_top)
		var t1 := Vector3(cos(a1) * r_top, h, sin(a1) * r_top)
		var shade := 0.85 + 0.15 * cos(a0 * 2.0)
		var n := (b1 - b0).cross(t0 - b0).normalized()
		if n.dot(Vector3(b0.x, 0, b0.z)) < 0:
			n = -n
		for p in [b0, t0, b1, b1, t0, t1]:
			st.set_normal(n); st.set_color(Color(shade, shade, shade)); st.add_vertex(p)
		var top := Vector3(0, h, 0)
		for p in [t0, top, t1]:
			st.set_normal(Vector3.UP); st.set_color(Color.WHITE); st.add_vertex(p)
	return st.commit()


func _part(mesh: ArrayMesh, color: Color, pos: Vector3) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = HurrWorld.flat_material()
	_tint(mi, color)
	mi.position = pos
	_body.add_child(mi)


func _tint(mi: MeshInstance3D, color: Color) -> void:
	var m := mi.material_override as StandardMaterial3D
	m.albedo_color = color


func strike_point() -> Vector3:
	return global_position + Vector3(0, 1.5, 0)


func is_threat() -> bool:
	return state == S.APPROACH or state == S.WINDUP or state == S.RECOVER


func hit() -> void:
	hits += 1
	if state == S.STUNNED:
		_start_flee()
		return
	state = S.STUNNED          # also cancels a throw in progress
	_t = STUN_TIME
	_arm.rotation.x = 0.0
	_stars.visible = true
	HurrFx.burst(get_parent(), global_position + Vector3(0, 1.6, 0), Color(0.86, 0.72, 0.58), 12, 1.2, 0.035, 0.6)


func _start_flee() -> void:
	state = S.FLEE
	_t = FLEE_TIME
	_stars.visible = false
	_net_held.visible = false
	HurrFx.sound(get_parent(), "flee", global_position, -3.0)
	HurrFx.burst(get_parent(), global_position + Vector3(0, 0.1, 0), Color(0.86, 0.66, 0.50), 20, 2.0)
	fled.emit()


func _process(delta: float) -> void:
	if player_head == null:
		return
	var me := Vector3(global_position.x, 0, global_position.z)
	var them := Vector3(player_head.global_position.x, 0, player_head.global_position.z)
	var to := them - me
	var dist := to.length()
	match state:
		S.APPROACH:
			_look(to, delta)
			if dist > THROW_RANGE:
				global_position += to.normalized() * speed * delta
				_walk_cycle(delta, 1.0)
				_snap_to_ground()
			else:
				state = S.WINDUP
				_t = WINDUP_TIME
		S.WINDUP:
			_look(to, delta)
			_t -= delta
			# raise the net overhead and wind it round: the readable telegraph
			_arm.rotation.x = lerpf(_arm.rotation.x, PI * 0.95, minf(1.0, delta * 4.0))
			_arm.rotation.y += delta * 9.0
			if _t <= 0.0:
				_throw()
		S.RECOVER:
			_look(to, delta)
			_t -= delta
			_arm.rotation.x = lerpf(_arm.rotation.x, 0.0, minf(1.0, delta * 3.0))
			if _t <= 0.0:
				_net_held.visible = true
				state = S.APPROACH
		S.STUNNED:
			_t -= delta
			_stars.rotation.y += delta * 5.0
			_body.rotation.z = sin(_t * 6.0) * 0.12
			if _t <= 0.0:
				_stars.visible = false
				_body.rotation.z = 0.0
				state = S.APPROACH
		S.FLEE:
			_t -= delta
			_look(-to, delta)
			global_position -= to.normalized() * 3.2 * delta
			_walk_cycle(delta, 2.2)
			_snap_to_ground()
			if _t <= 0.0:
				queue_free()


func _throw() -> void:
	state = S.RECOVER
	_t = RECOVER_TIME
	_arm.rotation.y = 0.0
	_net_held.visible = false
	var net := HurrNet.new()
	net.player_head = player_head
	get_parent().add_child(net)
	var from := global_position + Vector3(0, 1.9, 0)
	net.launch(from, player_head.global_position)
	HurrFx.sound(get_parent(), "net_throw", from, -2.0)
	net_thrown.emit(net)


func _look(dir: Vector3, delta: float) -> void:
	if dir.length_squared() < 1e-6:
		return
	var yaw := atan2(dir.x, dir.z)
	rotation.y = lerp_angle(rotation.y, yaw, minf(1.0, delta * 6.0))


var _walk := 0.0


func _walk_cycle(delta: float, rate: float) -> void:
	_walk += delta * 7.0 * rate
	_body.position.y = absf(sin(_walk)) * 0.04
	_body.rotation.x = 0.05 * rate


func _snap_to_ground() -> void:
	if world != null:
		global_position.y = world.height_at(global_position.x, global_position.z)

