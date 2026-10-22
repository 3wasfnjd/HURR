extends SceneTree
## Studio splash (vr_splash.png): the ABODEN GAMES wordmark — «عبودين قيمز» above
## "ABODEN GAMES", plain white on transparency, set in Baloo Bhaijaan 2 / Baloo 2.
## godot --rendering-driver opengl3 --path . --script res://tools/brand/make_splash.gd

const W := 2048
const H := 1024


func _initialize() -> void:
	DisplayServer.window_set_size(Vector2i(W, H))
	root.size = Vector2i(W, H)
	root.transparent_bg = true
	var tag := TextServerManager.get_primary_interface().name_to_tag("wght")
	var en := FontVariation.new()
	en.base_font = load("res://assets/fonts/baloo-latin.woff2")
	en.variation_opentype = {tag: 600}
	var ar := FontVariation.new()
	ar.base_font = load("res://assets/fonts/baloo-arabic.woff2")
	ar.variation_opentype = {tag: 700}
	ar.fallbacks = [en]
	_line("عبودين قيمز", ar, 250, H * 0.5 - 70, TextServer.DIRECTION_RTL)
	_line("ABODEN GAMES", en, 104, H * 0.5 + 170, TextServer.DIRECTION_LTR)
	for i in 3:
		await process_frame
	await RenderingServer.frame_post_draw
	var img := root.get_texture().get_image()
	img.save_png("res://vr_splash.png")
	print("splash written ", img.get_size())
	quit()


func _line(txt: String, font: Font, px: int, center_y: float, dir: int) -> void:
	var l := Label.new()
	l.text = txt
	l.text_direction = Control.TEXT_DIRECTION_RTL if dir == TextServer.DIRECTION_RTL else Control.TEXT_DIRECTION_LTR
	l.add_theme_font_override("font", font)
	l.add_theme_font_size_override("font_size", px)
	l.add_theme_color_override("font_color", Color.WHITE)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.size = Vector2(W, px * 1.6)
	l.position = Vector2(0, center_y - px * 0.8)
	root.add_child(l)
