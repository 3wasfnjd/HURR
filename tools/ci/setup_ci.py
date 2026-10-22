"""Install a verified Godot 4.7.2 + export templates + OpenXR Vendors 5.1.0 for CI (or locally).
Adapted from ABODEN's SHADDA pipeline. Pins and checksums are checked before anything is used.
Env: RUNNER_TEMP (cache dir), ANDROID_HOME / JAVA_HOME (CI only), GITHUB_PATH, GITHUB_RUN_NUMBER.
"""
import hashlib
import os
import pathlib
import shutil
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = pathlib.Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "hurr-deps"
CACHE.mkdir(parents=True, exist_ok=True)
VERSION = "4.7.2-stable"
BASE = f"https://github.com/godotengine/godot-builds/releases/download/{VERSION}/"
SUMS_SHA256 = "b8bdff6704f833e7a021df16ec08e1478edd5a285c1f894929b91a7f74a5c7c0"
VENDORS_URL = "https://github.com/GodotVR/godot_openxr_vendors/releases/download/5.1.0-stable/godotopenxrvendorsaddon.zip"
VENDORS_SHA256 = "6a838dbdf4115549e4511ebee0da9a5dcc8f9f6258d4cc2f2ee57a907a3e2911"
EDITOR_ONLY = "--editor-only" in sys.argv   # local test: no Android templates


def download(url, name):
    p = CACHE / name
    if not p.exists():
        with urllib.request.urlopen(url, timeout=300) as r, p.open("wb") as f:
            shutil.copyfileobj(r, f)
    return p


def digest(p, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


sums = download(BASE + "SHA512-SUMS.txt", "SHA512-SUMS.txt")
assert digest(sums) == SUMS_SHA256, "Official Godot checksum list changed"
checksums = {l.split()[-1].lstrip("*"): l.split()[0] for l in sums.read_text().splitlines() if l.strip()}
names = ["Godot_v4.7.2-stable_linux.x86_64.zip"]
if not EDITOR_ONLY:
    names.append("Godot_v4.7.2-stable_export_templates.tpz")
for name in names:
    p = download(BASE + name, name)
    assert digest(p, "sha512") == checksums[name], f"SHA-512 mismatch: {name}"
    with zipfile.ZipFile(p) as z:
        if name.endswith(".zip"):
            z.extractall(CACHE)
        else:
            target = pathlib.Path.home() / ".local/share/godot/export_templates/4.7.2.stable"
            target.mkdir(parents=True, exist_ok=True)
            for m in z.infolist():
                if not m.is_dir():
                    with z.open(m) as r, (target / pathlib.Path(m.filename).name).open("wb") as f:
                        shutil.copyfileobj(r, f)
engine = CACHE / "Godot_v4.7.2-stable_linux.x86_64"
engine.chmod(0o755)
shutil.copy2(engine, CACHE / "godot")

if not EDITOR_ONLY:
    # Headset-only title: make head tracking a required feature in the app manifest
    # (the vendor library defaults it to optional). Done on the verified template copy.
    src = pathlib.Path.home() / ".local/share/godot/export_templates/4.7.2.stable/android_source.zip"
    out = src.with_suffix(".configured.zip")
    patched = 0
    A, T = "http://schemas.android.com/apk/res/android", "http://schemas.android.com/tools"
    with zipfile.ZipFile(src) as s, zipfile.ZipFile(out, "w") as o:
        for m in s.infolist():
            data = s.read(m.filename)
            if m.filename.endswith("AndroidManifest.xml") and b".GodotApp" in data and b"<application" in data:
                ET.register_namespace("android", A)
                ET.register_namespace("tools", T)
                man = ET.fromstring(data)
                for e in list(man.findall("uses-feature")):
                    if e.get("{%s}name" % A) == "android.hardware.vr.headtracking":
                        man.remove(e)
                man.insert(0, ET.Element("uses-feature", {
                    "{%s}name" % A: "android.hardware.vr.headtracking",
                    "{%s}required" % A: "true", "{%s}version" % A: "1", "{%s}node" % T: "replace"}))
                data = ET.tostring(man, encoding="utf-8", xml_declaration=True)
                patched += 1
            o.writestr(m, data)
    assert patched >= 1, "No app manifest found in the verified Android template"
    out.replace(src)

plugin = download(VENDORS_URL, "vendors.zip")
assert digest(plugin) == VENDORS_SHA256, "OpenXR Vendors archive checksum mismatch"
unpack = CACHE / "vendor-unpack"
with zipfile.ZipFile(plugin) as z:
    z.extractall(unpack)
addon = next(unpack.glob("**/addons/godotopenxrvendors"))
shutil.copytree(addon, ROOT / "addons/godotopenxrvendors", dirs_exist_ok=True)
assert (ROOT / "addons/godotopenxrvendors/plugin.gdextension").is_file()

if not EDITOR_ONLY:
    settings = pathlib.Path.home() / ".config/godot/editor_settings-4.7.tres"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(
        '[gd_resource type="EditorSettings" format=3]\n[resource]\n'
        f'export/android/android_sdk_path = "{os.environ["ANDROID_HOME"]}"\n'
        f'export/android/java_sdk_path = "{os.environ["JAVA_HOME"]}"\n'
        f'export/android/debug_keystore = "{pathlib.Path.home()}/.android/debug.keystore"\n'
        'export/android/debug_keystore_user = "androiddebugkey"\n'
        'export/android/debug_keystore_pass = "android"\n')
    preset = ROOT / "export_presets.cfg"
    preset.write_text(preset.read_text().replace(
        "version/code=1", "version/code=" + os.environ.get("GITHUB_RUN_NUMBER", "1")))

if os.environ.get("GITHUB_PATH"):
    with open(os.environ["GITHUB_PATH"], "a") as f:
        f.write(str(CACHE) + "\n")
(ROOT / "build").mkdir(exist_ok=True)
(ROOT / "build/.gdignore").write_text("")
(ROOT / "build/versions.txt").write_text(
    "Godot 4.7.2-stable\nOpenXR Vendors 5.1.0-stable\nJDK 17\nSDK compile 36 / target 34 / min 29\n"
    "Mobile renderer (Vulkan)\nDevelopment signature; NOT yet tested on Quest 3\n")
print("Verified: Godot SHA-512, OpenXR Vendors SHA-256. Engine at", CACHE / "godot")
