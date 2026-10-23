extends SceneTree
## Deterministic gameplay checks (no headset). Run with a fixed frame rate:
## godot --headless --xr-mode off --fixed-fps 72 --path . --script res://tests/test_gameplay.gd

var failures := 0
var world: HurrWorld
var head: Node3D
var glove: Node3D


func check(ok: bool, what: String) -> void:
	print(("PASS: " if ok else "FAIL: ") + what)
	if not ok:
		failures += 1


func frames(seconds: float) -> void:
	for i in int(seconds * 72.0):
		await process_frame


func until(cond: Callable, max_seconds: float) -> float:
	## Steps frames until cond() is true; returns elapsed seconds, or -1 on timeout.
	var n := int(max_seconds * 72.0)
	for i in n:
		if cond.call():
			return i / 72.0
		await process_frame
	return -1.0


func _initialize() -> void:
	world = HurrWorld.new()
	root.add_child(world)
	world.build()
	head = Node3D.new()
	root.add_child(head)
	head.global_position = Vector3(0, 1.6, 0.6)
	glove = Node3D.new()
	root.add_child(glove)
	glove.global_position = Vector3(-0.25, 1.15, 0.35)

	var falcon := HurrFalcon.new()
	root.add_child(falcon)
	falcon.perch_at(Vector3(-1.45, 0.9, -1.75), 0.0)
	falcon.glove = glove
	await process_frame

	# 1. Intro: perch -> glove.
	falcon.call_to_glove()
	var t := await until(func(): return falcon.is_home(), 3.0)
	check(t > 0.5 and t < 2.5, "falcon glides from the perch to the glove (%.2f s)" % t)

	# 2. Strike: first hit stuns a trapper.
	var tr := HurrTrapper.new()
	tr.world = world
	tr.player_head = head
	tr.position = Vector3(1.0, 0, -9.0)
	root.add_child(tr)
	await process_frame
	check(falcon.launch(tr, Vector3.ZERO), "falcon launches from the glove at a trapper")
	check(not falcon.launch(tr, Vector3.ZERO), "cannot launch again while she is away")
	t = await until(func(): return tr.state == HurrTrapper.S.STUNNED, 2.0)
	check(t > 0.0 and t < 1.5, "first strike stuns the trapper (%.2f s after launch)" % t)
	t = await until(func(): return falcon.is_home(), 4.0)
	check(t > 0.0, "falcon returns to the glove after the strike (%.2f s)" % t)

	# 3. Second strike while stunned sends him running, and he leaves the arena.
	falcon.launch(tr, Vector3.ZERO)
	t = await until(func(): return not is_instance_valid(tr) or tr.state == HurrTrapper.S.FLEE, 2.0)
	check(t > 0.0, "second strike while stunned makes him flee")
	t = await until(func(): return not is_instance_valid(tr), 4.0)
	check(t >= 0.0, "fleeing trapper leaves the arena")
	await until(func(): return falcon.is_home(), 4.0)

	# 4. A trapper left alone throws a net that reaches the player.
	var tr2 := HurrTrapper.new()
	tr2.world = world
	tr2.player_head = head
	tr2.position = Vector3(0.0, 0, -7.0)
	root.add_child(tr2)
	var hits := [0]
	tr2.net_thrown.connect(func(n: HurrNet): n.hit_player.connect(func(): hits[0] += 1))
	t = await until(func(): return hits[0] > 0, 8.0)
	check(t > 0.0, "net thrown by an unopposed trapper hits the player (%.2f s)" % t)

	# 5. Dodging: step sideways after the throw and the net misses.
	var dodge_hits := [0]
	var thrown := [false]
	tr2.net_thrown.connect(func(n: HurrNet):
		thrown[0] = true
		n.hit_player.connect(func(): dodge_hits[0] += 1))
	await until(func(): return thrown[0], 8.0)
	head.global_position += Vector3(0.9, 0, 0)       # lean/step out of the way
	await frames(2.0)
	check(thrown[0] and dodge_hits[0] == 0, "stepping aside dodges the net")
	head.global_position -= Vector3(0.9, 0, 0)

	# 6. Striking during the wind-up cancels the throw.
	await until(func(): return tr2.state == HurrTrapper.S.WINDUP, 6.0)
	var cancel_thrown := [false]
	tr2.net_thrown.connect(func(_n): cancel_thrown[0] = true)
	falcon.launch(tr2, Vector3.ZERO)
	await until(func(): return tr2.state == HurrTrapper.S.STUNNED, 2.0)
	check(tr2.state == HurrTrapper.S.STUNNED and not cancel_thrown[0], "a strike during the wind-up cancels the throw")
	await until(func(): return falcon.is_home(), 4.0)

	# 7. Recall (the lure) aborts an outbound flight.
	falcon.launch(null, Vector3(0, 0.3, -12))
	await frames(0.2)
	falcon.recall()
	t = await until(func(): return falcon.is_home(), 3.0)
	check(t > 0.0, "recall brings her straight back (%.2f s)" % t)

	# 8. Arena: wave 1 spawns 2 trappers; clearing it starts wave 2; three nets reset the wave.
	tr2.queue_free()
	var arena := HurrArena.new()
	arena.world = world
	arena.player_head = head
	arena.falcon = falcon
	root.add_child(arena)
	arena.start(0.1)
	await frames(0.3 + HurrArena.SPAWN_GAP * 2)
	check(arena.alive().size() == 2, "wave 1 spawns 2 trappers (got %d)" % arena.alive().size())
	var aim_hit := arena.best_target(head.global_position, arena.alive()[0].strike_point() - head.global_position)
	check(aim_hit == arena.alive()[0], "aim assist picks the trapper you point at")
	for x in arena.alive():
		x.hit()
		x.hit()
	await frames(3.0 + 0.3)
	check(arena.wave == 1, "clearing wave 1 starts wave 2 (wave index %d)" % arena.wave)
	for i in 3:
		arena._on_player_hit()
	check(arena.lives == HurrArena.LIVES and arena.wave == 1, "three nets reset the current wave with full health")

	print("RESULT: %d failure(s)" % failures)
	quit(1 if failures > 0 else 0)
