class_name HurrWorld
extends Node3D
## The art-test set: a faceted dune floor, an engraved sandstone escarpment, a few boulders,
## dawn sky and a low grazing sun ("Naqsh" direction). Everything is generated here so the
## build carries no heavy environment assets. Deterministic (fixed seed).

const SAND := Color(0.86, 0.66, 0.50)
const SAND_SHADE := Color(0.76, 0.54, 0.44)
const STONE := Color(0.84, 0.62, 0.52)
const STONE_DARK := Color(0.62, 0.42, 0.38)
const ENGRAVE := Color(0.40, 0.22, 0.20)
const CLIFF_Z := -11.0
const PANEL_HALF_W := 5.0

var triangles := 0
var _rng := RandomNumberGenerator.new()
var _noise := FastNoiseLite.new()


func build() -> void:
	_rng.seed = 1447
	_noise.seed = 1447
	_noise.frequency = 0.08
	_environment()
	_sun()
	_add(_terrain(), "Dunes")
	_add(_cliff(), "Escarpment")
	_engravings()
	for i in 7:
		var b := _boulder(_rng.randf_range(0.35, 1.1), i)
		var ang := _rng.randf_range(-PI, PI)
		var dist := _rng.randf_range(3.5, 9.0)
		b.position = Vector3(cos(ang) * dist, -0.1, sin(ang) * dist - 2.0)
		if absf(b.position.x) < 1.6 and b.position.z > -4.5:
			b.position.x += 3.0
		add_child(b)


static func flat_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.vertex_color_is_srgb = false
	m.roughness = 1.0
	m.metallic_specular = 0.2
	return m


func _add(mesh: ArrayMesh, node_name: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = node_name
	mi.mesh = mesh
	mi.material_override = flat_material()
	add_child(mi)
	return mi


func _environment() -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.35, 0.40, 0.62)
	sky_mat.sky_horizon_color = Color(0.98, 0.72, 0.52)
	sky_mat.ground_horizon_color = Color(0.86, 0.60, 0.46)
	sky_mat.ground_bottom_color = Color(0.30, 0.20, 0.24)
	sky_mat.sun_angle_max = 8.0
	var sky := Sky.new()
	sky.sky_material = sky_mat
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	# Cool violet fill for the shade side: the "Naqsh" palette keeps shadows violet.
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.60, 0.56, 0.74)
	env.ambient_light_energy = 0.55
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.0
	env.fog_enabled = true
	env.fog_light_color = Color(0.92, 0.78, 0.70)
	env.fog_density = 0.0025
	env.fog_sun_scatter = 0.25
	var we := WorldEnvironment.new()
	we.name = "Environment"
	we.environment = env
	add_child(we)


func _sun() -> void:
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.light_color = Color(1.0, 0.86, 0.70)
	sun.light_energy = 2.1
	sun.shadow_bias = 0.06
	sun.shadow_normal_bias = 2.5
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = 24.0
	add_child(sun)
	# Low dawn sun (14 degrees) from the right, nearly parallel to the cliff face so the
	# engravings catch light and shadow — the core idea of the "Naqsh" direction.
	var dir := Vector3(-0.96, -0.25, -0.12).normalized()
	sun.look_at_from_position(Vector3.ZERO, dir, Vector3.UP)


func height_at(x: float, z: float) -> float:
	return _height(x, z)


func _height(x: float, z: float) -> float:
	var h := 0.55 * sin(x * 0.21 + 0.6) * cos(z * 0.17) + 0.9 * _noise.get_noise_2d(x, z)
	h += 0.04 * z * (1.0 if z > 0.0 else 0.0)
	var flat := clampf((Vector2(x, z + 2.0).length() - 4.0) / 5.0, 0.0, 1.0)
	return h * flat * flat


func _terrain() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var size := 64.0
	var n := 40
	var step := size / n
	for iz in n:
		for ix in n:
			var x0 := -size / 2 + ix * step
			var z0 := -size / 2 + iz * step + 6.0
			if z0 + step < CLIFF_Z - 1.0:
				continue
			var p := [Vector3(x0, 0, z0), Vector3(x0 + step, 0, z0),
				Vector3(x0, 0, z0 + step), Vector3(x0 + step, 0, z0 + step)]
			for k in 4:
				p[k].y = _height(p[k].x, p[k].z)
			_tri(st, p[0], p[2], p[1], _sand(), Vector3.UP)
			_tri(st, p[1], p[2], p[3], _sand(), Vector3.UP)
	return st.commit()


func _sand() -> Color:
	return SAND.lerp(SAND_SHADE, _rng.randf_range(0.0, 0.35))


func _cliff() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var nx := 36
	var ny := 12
	var w := 48.0
	var h := 13.0
	var grid := []
	for iy in ny + 1:
		var row := []
		for ix in nx + 1:
			var x := -w / 2 + w * ix / nx
			var y := -0.5 + h * iy / ny
			var depth := 1.6 * _noise.get_noise_2d(x * 1.7, y * 2.3) + 0.04 * x * x / 10.0
			if absf(x) < PANEL_HALF_W and y < 6.0:
				depth = 0.0          # a smooth panel carries the engravings
			row.append(Vector3(x, y, CLIFF_Z + depth - (y * 0.08)))
		grid.append(row)
	for iy in ny:
		for ix in nx:
			var a: Vector3 = grid[iy][ix]
			var b: Vector3 = grid[iy][ix + 1]
			var c: Vector3 = grid[iy + 1][ix]
			var d: Vector3 = grid[iy + 1][ix + 1]
			var band := STONE.lerp(STONE_DARK, 0.25 + 0.25 * sin(a.y * 2.1))
			var col := band.lerp(STONE_DARK, _rng.randf_range(0.0, 0.2))
			_tri(st, a, b, c, col, Vector3.BACK)
			_tri(st, b, d, c, col, Vector3.BACK)
	return st.commit()


func _engravings() -> void:
	## Original stylized figures in the manner of ancient rock engravings (not copies of any
	## real panel): a camel, an ibex with swept horns, and a falconer with a bird on the arm.
	var figures := [
		[Vector2(-3.0, 2.2), 1.0, [  # camel
			[[-0.6, 0.0], [-0.55, 0.45], [-0.3, 0.6], [-0.05, 0.85], [0.2, 0.6], [0.45, 0.55], [0.6, 0.8], [0.75, 0.95], [0.9, 0.9]],
			[[-0.45, 0.45], [-0.5, 0.0]], [[0.35, 0.5], [0.35, 0.0]], [[0.45, 0.5], [0.5, 0.0]], [[-0.6, 0.45], [-0.75, 0.3]],
		]],
		[Vector2(0.4, 3.4), 0.8, [  # ibex
			[[-0.5, 0.4], [0.4, 0.45]], [[-0.4, 0.4], [-0.45, 0.0]], [[-0.25, 0.4], [-0.2, 0.0]],
			[[0.2, 0.42], [0.15, 0.0]], [[0.35, 0.44], [0.4, 0.0]], [[0.4, 0.45], [0.55, 0.65]],
			[[0.55, 0.65], [0.45, 0.95], [0.2, 1.1], [-0.05, 1.05]],
		]],
		[Vector2(3.0, 2.0), 1.1, [  # falconer
			[[0.0, 1.0], [0.0, 0.35]], [[0.0, 0.35], [-0.18, 0.0]], [[0.0, 0.35], [0.18, 0.0]],
			[[0.0, 0.85], [0.3, 1.05], [0.38, 1.3]], [[0.0, 0.85], [-0.25, 0.6]],
			[[0.32, 1.32], [0.5, 1.5], [0.62, 1.42]], [[0.38, 1.36], [0.2, 1.52]],
		]],
	]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for fig in figures:
		var origin: Vector2 = fig[0]
		var s: float = fig[1]
		for line in fig[2]:
			for i in line.size() - 1:
				var a := origin + Vector2(line[i][0], line[i][1]) * s
				var b := origin + Vector2(line[i + 1][0], line[i + 1][1]) * s
				_groove(st, a, b)
	_add(st.commit(), "Engravings")


func _groove(st: SurfaceTool, a: Vector2, b: Vector2) -> void:
	## A pecked groove: a thin raised-edge strip a few cm off the panel, so the low sun
	## draws a shadow line beside it.
	var z := CLIFF_Z - a.y * 0.08 + 0.02
	var z2 := CLIFF_Z - b.y * 0.08 + 0.02
	var dir := (b - a).normalized()
	var nrm := Vector2(-dir.y, dir.x) * 0.035
	var p0 := Vector3(a.x + nrm.x, a.y + nrm.y, z)
	var p1 := Vector3(b.x + nrm.x, b.y + nrm.y, z2)
	var p2 := Vector3(b.x - nrm.x, b.y - nrm.y, z2)
	var p3 := Vector3(a.x - nrm.x, a.y - nrm.y, z)
	var back := Vector3(0, 0, -0.02)
	var side := Vector3(nrm.x, nrm.y, 0.0)
	_tri(st, p0, p1, p2, ENGRAVE, Vector3.BACK)
	_tri(st, p0, p2, p3, ENGRAVE, Vector3.BACK)
	_tri(st, p0 + back, p1 + back, p1, ENGRAVE.lightened(0.2), side)
	_tri(st, p0 + back, p1, p0, ENGRAVE.lightened(0.2), side)
	_tri(st, p3, p2, p2 + back, ENGRAVE.darkened(0.3), -side)
	_tri(st, p3, p2 + back, p3 + back, ENGRAVE.darkened(0.3), -side)


func perch(at: Vector3, height: float) -> Vector3:
	## A faceted sandstone pillar the falcon stands on; returns the flat top centre.
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.2
	cyl.bottom_radius = 0.3
	cyl.height = height
	cyl.radial_segments = 7
	cyl.rings = 3
	var arr := cyl.get_mesh_arrays()
	var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var idxs: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in range(0, idxs.size(), 3):
		var p := []
		for k in 3:
			var v: Vector3 = verts[idxs[i + k]]
			if v.y < height * 0.49:   # keep the top flat, roughen the sides
				var d := 1.0 + 0.18 * _noise.get_noise_3d(v.x * 6.0, v.y * 6.0, v.z * 6.0)
				v = Vector3(v.x * d, v.y, v.z * d)
			p.append(v + Vector3(0, height / 2.0, 0))
		var c: Vector3 = (p[0] + p[1] + p[2]) / 3.0
		var face_out := Vector3(c.x, 0.0, c.z) if absf(c.y - height) > 0.01 else Vector3.UP
		if c.y < 0.01:
			face_out = Vector3.DOWN
		_tri(st, p[0], p[1], p[2], STONE.lerp(STONE_DARK, 0.2 + 0.2 * sin(c.y * 9.0)), face_out)
	var mi := MeshInstance3D.new()
	mi.name = "Perch"
	mi.mesh = st.commit()
	mi.material_override = flat_material()
	mi.position = at
	add_child(mi)
	return at + Vector3(0, height, 0)


func _boulder(radius: float, idx: int) -> MeshInstance3D:
	var sphere := SphereMesh.new()
	sphere.radius = radius
	sphere.height = radius * 1.4
	sphere.radial_segments = 9
	sphere.rings = 5
	var arr := sphere.get_mesh_arrays()
	var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var idxs: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var col := STONE.lerp(STONE_DARK, 0.3 + 0.1 * (idx % 3))
	for i in range(0, idxs.size(), 3):
		var p := []
		for k in 3:
			var v: Vector3 = verts[idxs[i + k]]
			var d := 1.0 + 0.28 * _noise.get_noise_3d(v.x * 4.0 + idx * 10.0, v.y * 4.0, v.z * 4.0)
			p.append(v * d)
		_tri(st, p[0], p[1], p[2], col.lerp(STONE_DARK, _rng.randf_range(0.0, 0.25)),
			(p[0] + p[1] + p[2]) / 3.0)
	var mi := MeshInstance3D.new()
	mi.name = "Boulder%d" % idx
	mi.mesh = st.commit()
	mi.material_override = flat_material()
	mi.rotation.y = _rng.randf_range(0, TAU)
	return mi


func _tri(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, col: Color,
		toward := Vector3.ZERO) -> void:
	## Flat-shaded triangle with its own vertices, normal and (linear) colour.
	## `toward`: the side the face should look at (zero = keep the given winding).
	var n := (b - a).cross(c - a)
	if n.length_squared() < 1e-12:
		return
	n = n.normalized()
	if toward != Vector3.ZERO and n.dot(toward) < 0.0:
		n = -n
		var t := b
		b = c
		c = t
	var lin := col.srgb_to_linear()
	# Godot treats clockwise triangles as front faces: emit a, c, b.
	for p in [a, c, b]:
		st.set_normal(n)
		st.set_color(lin)
		st.add_vertex(p)
	triangles += 1
