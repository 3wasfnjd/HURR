"""Check the exported APK before anyone installs it: manifest, Quest targeting, ABI, splash,
signature. Writes build/package-report.json. Proves the package, NOT that it runs on a Quest."""
import hashlib
import json
import os
import pathlib
import subprocess
import xml.etree.ElementTree as ET
import zipfile

p = pathlib.Path("build/HURR-ArtTest.apk")
sdk = pathlib.Path(os.environ["ANDROID_HOME"])
xml = subprocess.check_output([str(sdk / "cmdline-tools/latest/bin/apkanalyzer"), "manifest", "print", str(p)], text=True)
pathlib.Path("build/AndroidManifest.xml").write_text(xml)
r = ET.fromstring(xml)
a = "{http://schemas.android.com/apk/res/android}"
assert r.attrib["package"] == "com.abodengames.hurr", r.attrib["package"]
uses = r.find("uses-sdk")
assert uses.get(a + "targetSdkVersion") == "34" and uses.get(a + "minSdkVersion") == "29"
meta = {m.get(a + "name"): m.get(a + "value") for m in r.findall(".//meta-data")}
assert meta.get("com.oculus.supportedDevices") == "quest3|quest3s", meta
features = {f.get(a + "name"): f for f in r.findall("uses-feature")}
assert features["android.hardware.vr.headtracking"].get(a + "required") == "true"
pt = features.get("com.oculus.feature.PASSTHROUGH")
assert pt is None or pt.get(a + "required") != "true", "fully immersive build must not require passthrough"
perms = [m.get(a + "name") for m in r.findall("uses-permission")]
for banned in ("android.permission.RECORD_AUDIO", "android.permission.CAMERA", "android.permission.INTERNET"):
    assert banned not in perms, banned
with zipfile.ZipFile(p) as z:
    names = z.namelist()
    abis = {n.split("/")[1] for n in names if n.startswith("lib/") and n.endswith(".so")}
    assert abis == {"arm64-v8a"}, abis
    assert any(n.endswith("vr_splash.png") for n in names), "studio splash missing"
verified = subprocess.check_output([str(sdk / "build-tools/36.1.0/apksigner"), "verify", "--verbose", "--print-certs", str(p)], text=True)
cert = subprocess.check_output(["keytool", "-exportcert", "-keystore", str(pathlib.Path.home() / ".android/debug.keystore"),
                                "-storepass", "android", "-alias", "androiddebugkey"])
cert_sha = hashlib.sha256(cert).hexdigest()
assert cert_sha in verified.lower(), verified
sha = hashlib.sha256(p.read_bytes()).hexdigest()
report = {"apk_built": True, "package_verified": True, "automated_tests_passed": True,
          "installed_on_quest": False, "playtested_on_quest": False,
          "bytes": p.stat().st_size, "sha256": sha, "signing": "development",
          "target_sdk": 34, "abis": sorted(abis), "permissions": perms}
pathlib.Path("build/package-report.json").write_text(json.dumps(report, indent=2))
pathlib.Path(str(p) + ".sha256").write_text(sha + "  " + p.name + "\n")
print(json.dumps(report, indent=2))
