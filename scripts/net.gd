class_name HurrNet
extends Node3D
## A thrown trapping net. Flies straight at where the player's head WAS when it left the hand,
## so the player can dodge by stepping or leaning away. Spins open in flight.

signal hit_player

const SPEED := 6.5
const HIT_RADIUS := 0.42
const LIFE := 2.4

var player_head: Node3D
var _vel := Vector3.ZERO
var _life := LIFE
var _mesh: MeshInstance3D
var _open := 0.3


static func net_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.70, 0.60, 0.42)
	m.roughness = 1.0
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


static func net_mesh(radius: float) -> ArrayMesh:
	## A faceted rope web: rings and spokes as thin triangle strips.
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var w := 0.012
	var spokes := 8
	for i in spokes:
		var a := TAU * i / spokes
		var d := Vector3(cos(a), 0, sin(a))
		var side := Vector3(-d.z, 0, d.x) * w
		var tip := d * radius
		for p in [Vector3.ZERO - side, tip - side, tip + side, Vector3.ZERO - side, tip + side, Vector3.ZERO + side]:
			st.set_normal(Vector3.UP); st.add_vertex(p)
	for ring in [0.45, 0.8, 1.0]:
		for i in spokes:
			var a0 := TAU * i / spokes
			var a1 := TAU * (i + 1) / spokes
			var p0: Vector3 = Vector3(cos(a0), 0, sin(a0)) * radius * ring
			var p1: Vector3 = Vector3(cos(a1), 0, sin(a1)) * radius * ring
			var up := Vector3(0, w, 0)
			for p in [p0 - up, p1 - up, p1 + up, p0 - up, p1 + up, p0 + up]:
				st.set_normal((p0 + p1).normalized()); st.add_vertex(p)
	return st.commit()


func launch(from: Vector3, aim: Vector3) -> void:
	_mesh = MeshInstance3D.new()
	_mesh.mesh = net_mesh(0.5)
	_mesh.material_override = net_material()
	add_child(_mesh)
	global_position = from
	_vel = (aim - from).normalized() * SPEED
	look_at(aim, Vector3.UP)


func _process(delta: float) -> void:
	_life -= delta
	global_position += _vel * delta
	_open = minf(1.0, _open + delta * 1.6)
	_mesh.scale = Vector3.ONE * _open
	_mesh.rotation.y += delta * 7.0
	_mesh.rotation.x = -PI * 0.5      # face the player like an opening disc
	if player_head != null and global_position.distance_to(player_head.global_position) < HIT_RADIUS:
		hit_player.emit()
		queue_free()
		return
	if _life <= 0.0:
		queue_free()
