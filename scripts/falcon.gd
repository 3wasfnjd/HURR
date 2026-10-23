class_name HurrFalcon
extends Node3D
## The saker. Sits on the perch, comes to the player's glove, is launched at a target,
## strikes it and flies back. One launch at a time: while she is away the player is exposed.
## Placeholder flight: rigid body pitched forward + procedural faceted wings (no rig yet).

signal launched
signal struck(target: Node3D)
signal caught

enum S { PERCHED, TO_GLOVE, ON_GLOVE, OUTBOUND, STRIKING, RETURNING }

const BODY := "res://assets/models/falcon_body.glb"
const OUT_SPEED := 13.0       # m/s toward the target
const RETURN_SPEED := 8.5     # m/s back to the glove
const INTRO_SPEED := 3.2      # m/s: the first, unhurried flight from the perch to the glove
const STRIKE_TIME := 0.35     # s hovering on the hit
const CATCH_DIST := 0.14
const HALF_SPAN := 0.56       # saker wingspan ~1.0-1.26 m
const FLY_PITCH := deg_to_rad(-68.0)

var state := S.PERCHED
var glove: Node3D             # where she sits (the left controller)
var target: Node3D            # trapper being struck, or null for a free flight
var target_point := Vector3.ZERO
var time_away := 0.0
var flights := 0

var _pivot := Node3D.new()
var _wing_l: MeshInstance3D
var _wing_r: MeshInstance3D
var _trail: CPUParticles3D
var _p0 := Vector3.ZERO
var _s := 0.0
var _len := 1.0
var _strike_t := 0.0
var _flap := 0.0
var _pitch := 0.0


func _ready() -> void:
	add_child(_pivot)
	_pivot.position = Vector3(0, 0.17, 0)
	var body := (load(BODY) as PackedScene).instantiate() as Node3D
	for mi in body.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).material_override = HurrWorld.flat_material()
	body.position = Vector3(0, -0.17, 0)
	body.rotation.y = PI          # the model faces +Z; the node flies toward -Z
	_pivot.add_child(body)
	_wing_l = _wing(-1.0)
	_wing_r = _wing(1.0)
	_trail = HurrFx.trail()
	_trail.position = Vector3(0, 0.17, 0.12)
	add_child(_trail)
	_set_wings_visible(false)


func _wing(side: float) -> MeshInstance3D:
	## A faceted wing: brown coverts, dark blunt primaries (saker: broad wings, blunt dark tips).
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var brown := Color(0.42, 0.30, 0.22).srgb_to_linear()
	var rufous := Color(0.55, 0.38, 0.26).srgb_to_linear()
	var dark := Color(0.20, 0.15, 0.12).srgb_to_linear()
	# outline, root at x=0 (front edge z<0 is the leading edge)
	var pts := [Vector2(0.0, -0.07), Vector2(0.22, -0.09), Vector2(0.42, -0.06), Vector2(1.0, 0.0),
		Vector2(0.95, 0.06), Vector2(0.62, 0.11), Vector2(0.30, 0.13), Vector2(0.0, 0.10)]
	var cols := [brown, rufous, brown, dark, dark, dark, brown, brown]
	var c := Vector3(0.18 * HALF_SPAN, 0.012, 0.02)
	for i in pts.size():
		var a: Vector2 = pts[i]
		var b: Vector2 = pts[(i + 1) % pts.size()]
		var pa := Vector3(a.x * HALF_SPAN * side, 0.0, a.y * 1.4)
		var pb := Vector3(b.x * HALF_SPAN * side, 0.0, b.y * 1.4)
		var cc := Vector3(c.x * side, c.y, c.z)
		var n := Vector3.UP
		st.set_normal(n); st.set_color(cols[i]); st.add_vertex(cc)
		st.set_normal(n); st.set_color(cols[i]); st.add_vertex(pb if side > 0 else pa)
		st.set_normal(n); st.set_color(cols[i]); st.add_vertex(pa if side > 0 else pb)
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	var mat := HurrWorld.flat_material()
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mi.material_override = mat
	# Wings hang on the un-pitched node so they stay level while the body leans into the flight.
	mi.position = Vector3(0.035 * side, 0.19, 0.02)
	add_child(mi)
	return mi


func _set_wings_visible(v: bool) -> void:
	_wing_l.visible = v
	_wing_r.visible = v
	_trail.emitting = v


func perch_at(pos: Vector3, yaw: float) -> void:
	state = S.PERCHED
	global_position = pos
	rotation = Vector3(0, yaw, 0)


func call_to_glove() -> void:
	if state == S.PERCHED:
		state = S.TO_GLOVE
		_set_wings_visible(true)
		HurrFx.sound(get_parent(), "falcon_call", global_position, -2.0)


func is_home() -> bool:
	return state == S.ON_GLOVE


func launch(t: Node3D, point: Vector3) -> bool:
	## Send her off the glove. Returns false if she is not on the glove.
	if state != S.ON_GLOVE:
		return false
	target = t
	target_point = point
	_p0 = global_position
	_s = 0.0
	_len = maxf(_p0.distance_to(_aim_point()), 0.5)
	state = S.OUTBOUND
	time_away = 0.0
	flights += 1
	_set_wings_visible(true)
	HurrFx.sound(get_parent(), "launch", global_position)
	launched.emit()
	return true


func recall() -> void:
	## The lure: abort an outbound flight and come straight back.
	if state == S.OUTBOUND or state == S.STRIKING:
		state = S.RETURNING
		target = null


func _aim_point() -> Vector3:
	if target != null and is_instance_valid(target) and target.has_method("strike_point"):
		return target.strike_point()
	return target_point


func _process(delta: float) -> void:
	match state:
		S.PERCHED:
			_settle(delta)
		S.ON_GLOVE:
			if glove != null:
				global_transform = glove.global_transform.translated_local(Vector3(0, 0.02, 0.0))
			_settle(delta)
		S.TO_GLOVE, S.RETURNING:
			time_away += delta
			_home(delta)
		S.OUTBOUND:
			time_away += delta
			_outbound(delta)
		S.STRIKING:
			time_away += delta
			_strike_t -= delta
			_flap += delta * 16.0
			_flap_wings(0.9)
			if _strike_t <= 0.0:
				state = S.RETURNING
				target = null


func _settle(delta: float) -> void:
	_pitch = lerpf(_pitch, 0.0, minf(1.0, delta * 10.0))
	_pivot.rotation.x = _pitch
	_set_wings_visible(false)


func _outbound(delta: float) -> void:
	# Quadratic arc that climbs a little and dives onto the (moving) target.
	var p2 := _aim_point()
	var p1 := (_p0 + p2) * 0.5 + Vector3.UP * (0.18 * _len + 0.4)
	_s = minf(1.0, _s + OUT_SPEED * delta / _len)
	var a := _p0.lerp(p1, _s)
	var b := p1.lerp(p2, _s)
	var pos := a.lerp(b, _s)
	_face(pos - global_position, delta)
	global_position = pos
	_flap += delta * (11.0 if _s < 0.5 else 4.0)
	_flap_wings(0.65 if _s < 0.5 else 0.15)   # flapping climb, then a fast dive with wings half-closed
	if _s >= 1.0:
		_on_arrive()


func _on_arrive() -> void:
	var t := target
	state = S.STRIKING
	_strike_t = STRIKE_TIME
	if t != null and is_instance_valid(t) and t.has_method("hit"):
		t.hit()
		HurrFx.sound(get_parent(), "strike", global_position)
		HurrFx.burst(get_parent(), global_position, Color(0.42, 0.30, 0.22), 10, 1.6, 0.04, 0.9, -2.0)
		struck.emit(t)
	else:
		HurrFx.burst(get_parent(), global_position, Color(0.86, 0.70, 0.55), 14, 2.0)


func _home(delta: float) -> void:
	if glove == null:
		return
	var home := glove.global_position + Vector3(0, 0.02, 0)
	var to := home - global_position
	var d := to.length()
	if d < CATCH_DIST:
		state = S.ON_GLOVE
		_set_wings_visible(false)
		HurrFx.sound(get_parent(), "catch", global_position, -4.0)
		caught.emit()
		return
	var lift := Vector3.UP * clampf(d * 0.08, 0.0, 0.6) if d > 2.0 else Vector3.ZERO
	var spd := INTRO_SPEED if state == S.TO_GLOVE else RETURN_SPEED
	var step := (to.normalized() + lift).normalized() * minf(spd * delta, d)
	_face(step, delta)
	global_position += step
	_flap += delta * (9.0 if d > 1.2 else 13.0)
	_flap_wings(0.55 if d > 1.2 else 0.9)       # braking wingbeats when landing


func _face(dir: Vector3, delta: float) -> void:
	if dir.length_squared() < 1e-8:
		return
	var flat := Vector3(dir.x, 0, dir.z)
	if flat.length_squared() > 1e-6:
		var yaw := atan2(-flat.x, -flat.z)
		rotation.y = lerp_angle(rotation.y, yaw, minf(1.0, delta * 12.0))
		rotation.x = 0.0
		rotation.z = 0.0
	_pitch = lerpf(_pitch, FLY_PITCH, minf(1.0, delta * 8.0))
	_pivot.rotation.x = _pitch


func _flap_wings(amp: float) -> void:
	var a := sin(_flap) * amp
	_wing_l.rotation.z = -a
	_wing_r.rotation.z = a
