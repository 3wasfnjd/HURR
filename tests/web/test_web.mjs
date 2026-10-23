// Node checks for the web build (no browser): level geometry, the game logic played by the
// autopilot, the rigged models and the page. Run: node tests/web/test_web.mjs
// (CI links web/node_modules/three -> web/vendor/three)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as L from '../../web/src/level1_data.js';
import { Slice, TUNING } from '../../web/src/sim.js';
import { runBot } from '../../web/src/autopilot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${what}`); if (!ok) failures++; };

// ---- level geometry
check(Math.abs(L.heightAt(0, 8) - L.PLATEAU_H) < 0.3, `village plateau ~${L.PLATEAU_H} m`);
check(Math.abs(L.heightAt(0, -18) - L.FLOOR_H) < 0.3, 'wadi floor ~0.3 m');
const terraceStep = L.heightAt(0, -23.2) - L.heightAt(0, -22.6);
check(terraceStep > TUNING.step && terraceStep < TUNING.climbMax, `terrace face needs a climb (${terraceStep.toFixed(2)} m)`);
const exitStep = L.heightAt(0, -57.2) - L.heightAt(0, -56.6);
check(exitStep > TUNING.step && exitStep < TUNING.climbMax, `exit face needs a climb (${exitStep.toFixed(2)} m)`);
const passGap = (L.CIRCLES[1].x - L.CIRCLES[1].r) - (L.CIRCLES[0].x + L.CIRCLES[0].r);
check(passGap > 2 * TUNING.radius + 0.5 && passGap < 3.2, `the pass is narrow but passable (${passGap.toFixed(2)} m)`);
check(L.CIRCLES[0].x - L.CIRCLES[0].r < -L.canyonHalfWidth(-45) + 0.4, 'no way around the left boulder');

// ---- game logic, played by the autopilot
const run = runBot();
check(run.result === 'end', `autopilot finishes the slice (${run.seconds.toFixed(1)} s)`);
check(run.slice.deaths === 0, 'clean run: never caught');
check(run.slice.dives >= 1 && run.slice.falconTaught, 'the falcon dive is used and taught');
const run2 = runBot();
check(run2.seconds === run.seconds && run2.slice.player.x === run.slice.player.x, 'simulation is deterministic');
const noFalcon = runBot({ pressFalcon: false, maxSeconds: 60 });
check(noFalcon.result !== 'end' && noFalcon.slice.deaths > 0, `without the falcon the second man stops you (${noFalcon.slice.deaths} catches)`);
const dawdle = runBot({ idleAfterFree: 3, maxSeconds: 90 });
check(dawdle.slice.deaths >= 1, 'waiting after freeing the falcon gets you caught by the first man');
check(dawdle.result === 'end', 'and the checkpoint lets you finish afterwards');
{
  const s = new Slice();
  for (let i = 0; i < 360; i++) s.tick({ mx: 1, my: 0, camYaw: 0, action: false, falcon: false });  // push into the east wall
  check(s.player.x < 9.0, `canyon walls cannot be climbed (x=${s.player.x.toFixed(2)})`);
}
{
  let gaveUp = false;
  runBot({ onTick: (s) => { if (s.men[0].state === 'giveup') gaveUp = true; } });
  check(gaveUp, 'the men do not follow onto the exit shelf');
}
{
  const s = new Slice();
  for (let i = 0; i < 600; i++) s.tick({ mx: 0, my: 0, camYaw: 0, action: true, falcon: false });
  check(s.phase === 'explore', 'holding the action away from the net does nothing');
}

// ---- models
const loader = new GLTFLoader();
const parse = (file) => new Promise((ok, no) => {
  const buf = readFileSync(path.join(root, 'web/assets/models', file));
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', (g) => ok(g.scene), no);
});
for (const [file, trisMin, trisMax, hMin, hMax, skinned] of [
  ['najd.glb', 20000, 20000, 1.64, 1.66, true], ['trapper.glb', 600, 2000, 1.75, 1.9, true], ['falcon_body.glb', 5807, 5807, 0.40, 0.50, false]]) {
  const scene = await parse(file);
  let t = 0, colorOk = true, noNormals = true, skin = null, wOk = true;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    t += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const c = g.attributes.color;
    colorOk &&= !!c && c.normalized && c.array instanceof Uint16Array;
    noNormals &&= !g.attributes.normal;
    if (o.isSkinnedMesh) {
      skin = o.skeleton;
      const w = g.attributes.skinWeight;
      for (let i = 0; i < w.count; i += 97) { const s = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i); if (Math.abs(s - 1) > 0.01) wOk = false; }
    }
  });
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  check(t >= trisMin && t <= trisMax, `${file}: ${t} triangles`);
  check(colorOk && noNormals, `${file}: 16-bit colour, no stored normals`);
  check(size.y >= hMin && size.y <= hMax, `${file}: height ${size.y.toFixed(3)} m`);
  if (skinned) {
    check(skin && skin.bones.length === 17, `${file}: 17-bone skeleton`);
    check(wOk, `${file}: skin weights sum to 1`);
    for (const b of ['hips', 'upperarm_L', 'hand_R', 'thigh_L', 'foot_R', 'head']) if (!scene.getObjectByName(b)) check(false, `${file}: bone ${b}`);
  }
}

// ---- page + text
const html = readFileSync(path.join(root, 'web/index.html'), 'utf8');
check(/<html lang="ar" dir="rtl">/.test(html), 'page is Arabic and right-to-left');
check(html.includes('"three": "./vendor/three/three.module.js"'), 'import map uses the vendored three.js (no CDN at runtime)');
check(html.includes('assets/brand/aboden_logo.png'), 'loading screen shows the official studio logo');
for (const id of ['actBtn', 'falconBtn', 'stickBase', 'title', 'end']) check(html.includes(`id="${id}"`), `UI element #${id}`);
const src = readdirSync(path.join(root, 'web/src')).map((f) => readFileSync(path.join(root, 'web/src', f), 'utf8')).join('\n') + html;
check(!src.includes('صقرة'), 'the falcon is never called «صقرة»');

console.log(`RESULT: ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
