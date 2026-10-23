class_name HurrArena
extends Node3D
## Waves of trappers around the player. Three nets and you are caught: the wave restarts.
## Clear a wave to start the next; after the last wave the cycle starts again.

signal message(text: String)
signal player_hit(lives_left: int)
signal wave_started(index: int)

const WAVES := [2, 3, 4]
const LIVES := 3
const SPAWN_GAP := 1.6

var world: HurrWorld
var player_head: Node3D
var falcon: HurrFalcon
var wave := 0
var lives := LIVES
var strikes := 0
var trappers: Array[HurrTrapper] = []
var _to_spawn := 0
var _spawn_t := 0.0
var _pause := 0.0
var _rng := RandomNumberGenerator.new()
var _running := false


func start(first_delay := 3.0) -> void:
	_rng.seed = 2026
	wave = 0
	lives = LIVES
	_running = true
	_begin_wave(first_delay)


func _begin_wave(delay: float) -> void:
	_clear()
	_to_spawn = WAVES[wave]
	_spawn_t = 0.0
	_pause = delay


func _clear() -> void:
	for t in trappers:
		if is_instance_valid(t):
			t.queue_free()
	trappers.clear()
	for n in get_children():
		if n is HurrNet:
			n.queue_free()


func alive() -> Array[HurrTrapper]:
	var out: Array[HurrTrapper] = []
	for t in trappers:
		if is_instance_valid(t) and t.state != HurrTrapper.S.FLEE:
			out.append(t)
	return out


func best_target(origin: Vector3, dir: Vector3, max_deg := 14.0, max_dist := 28.0) -> HurrTrapper:
	## Aim assist: the trapper closest to the pointing direction inside a cone.
	var best: HurrTrapper = null
	var best_ang := deg_to_rad(max_deg)
	for t in alive():
		var to := t.strike_point() - origin
		if to.length() > max_dist:
			continue
		var ang := dir.normalized().angle_to(to)
		if ang < best_ang:
			best_ang = ang
			best = t
	return best


func _process(delta: float) -> void:
	if not _running:
		return
	if _pause > 0.0:
		_pause -= delta
		if _pause <= 0.0 and _to_spawn > 0:
			message.emit("الموجة %d من %d" % [wave + 1, WAVES.size()])
			HurrFx.sound(self, "wave", player_head.global_position + Vector3(0, 0, -2), -3.0)
			wave_started.emit(wave)
		return
	if _to_spawn > 0:
		_spawn_t -= delta
		if _spawn_t <= 0.0:
			_spawn()
			_to_spawn -= 1
			_spawn_t = SPAWN_GAP
		return
	if alive().is_empty():
		if wave + 1 < WAVES.size():
			message.emit("أحسنت — أبعدتهم")
			wave += 1
			_begin_wave(3.0)
		else:
			message.emit("انتهت الموجات — تبدأ من جديد")
			wave = 0
			lives = LIVES
			_begin_wave(4.0)


func _spawn() -> void:
	var t := HurrTrapper.new()
	t.world = world
	t.player_head = player_head
	t.speed = 1.0 + 0.15 * wave
	var spread := deg_to_rad(65.0 + 25.0 * wave)
	var ang := _rng.randf_range(-spread, spread)          # 0 = straight ahead (toward the cliff)
	var r := _rng.randf_range(11.0, 13.5)
	var c := player_head.global_position
	var p := Vector3(c.x + sin(ang) * r, 0, c.z - cos(ang) * r)
	p.z = maxf(p.z, HurrWorld.CLIFF_Z + 1.8)
	t.position = p - global_position
	add_child(t)
	t.net_thrown.connect(_on_net)
	trappers.append(t)


func _on_net(net: HurrNet) -> void:
	net.hit_player.connect(_on_player_hit)


func _on_player_hit() -> void:
	lives -= 1
	player_hit.emit(lives)
	HurrFx.sound(self, "player_hit", player_head.global_position, 0.0)
	if lives <= 0:
		message.emit("وقعت في الشبكة — نعيد الموجة")
		lives = LIVES
		_begin_wave(3.0)


func on_strike() -> void:
	strikes += 1
