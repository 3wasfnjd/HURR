class_name HurrFx
extends RefCounted
## Small one-shot effects and sounds, built from primitives (mobile-friendly CPU particles).

static var _sounds := {}


static func sound(parent: Node, sfx: String, pos: Vector3, volume_db := 0.0, pitch := 1.0) -> void:
	if not _sounds.has(sfx):
		_sounds[sfx] = load("res://assets/sfx/%s.wav" % sfx)
	var p := AudioStreamPlayer3D.new()
	p.stream = _sounds[sfx]
	p.volume_db = volume_db
	p.pitch_scale = pitch
	p.unit_size = 4.0
	parent.add_child(p)
	p.global_position = pos
	p.play()
	p.finished.connect(p.queue_free)


static func burst(parent: Node, pos: Vector3, color: Color, amount := 18, speed := 2.2,
		size := 0.05, life := 0.7, gravity := -4.0) -> void:
	## Faceted chips flying out and falling: sand dust, feathers.
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.explosiveness = 0.95
	p.amount = amount
	p.lifetime = life
	p.direction = Vector3.UP
	p.spread = 70.0
	p.initial_velocity_min = speed * 0.5
	p.initial_velocity_max = speed
	p.gravity = Vector3(0, gravity, 0)
	p.angular_velocity_min = -360.0
	p.angular_velocity_max = 360.0
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.2
	var m := BoxMesh.new()
	m.size = Vector3(size, size * 0.4, size)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 1.0
	m.material = mat
	p.mesh = m
	parent.add_child(p)
	p.global_position = pos
	p.emitting = true
	p.finished.connect(p.queue_free)


static func trail() -> CPUParticles3D:
	## Pale air streak left behind the falcon while she flies (attach to the falcon).
	var p := CPUParticles3D.new()
	p.amount = 24
	p.lifetime = 0.35
	p.local_coords = false
	p.gravity = Vector3.ZERO
	p.initial_velocity_min = 0.0
	p.initial_velocity_max = 0.1
	p.scale_amount_min = 0.5
	p.scale_amount_max = 1.0
	var m := QuadMesh.new()
	m.size = Vector2(0.03, 0.03)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.albedo_color = Color(1.0, 0.95, 0.88, 0.55)
	m.material = mat
	p.mesh = m
	p.emitting = false
	return p
