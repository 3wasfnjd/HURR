// Node checks for the web build (no browser): world generation and the web models.
// Run: node tests/web/test_web.mjs   (CI links web/node_modules/three -> web/vendor/three)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { World, CLIFF_Z } from '../../web/src/world.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${what}`); if (!ok) failures++; };

// World: deterministic, inside its budget, flat where the characters stand.
const w1 = new World(); w1.build();
const w2 = new World(); w2.build();
check(w1.triangles > 2000 && w1.triangles < 12000, `world triangles in budget (${w1.triangles})`);
check(w1.triangles === w2.triangles, 'world generation is deterministic (triangle count)');
const a = w1.group.getObjectByName('Dunes').geometry.attributes.position.array;
const b = w2.group.getObjectByName('Dunes').geometry.attributes.position.array;
check(a.length === b.length && a.every((v, i) => v === b[i]), 'world generation is deterministic (vertices)');
check(Math.abs(w1.heightAt(0, -1.6)) < 1e-9, 'ground is flat where Nouf stands');
for (const name of ['Dunes', 'Escarpment', 'Engravings']) check(!!w1.group.getObjectByName(name), `${name} present`);
const top = w1.perch(0.9, -1.4, 0.9);
check(Math.abs(top.y - 0.9) < 1e-6, 'perch top at 0.9 m');
check(CLIFF_Z === -11, 'cliff placed as in the Godot set');

// Models: exact budgets, true scale, 16-bit vertex colour, no stored normals.
const loader = new GLTFLoader();
const parse = (file) => new Promise((ok, no) => {
  const buf = readFileSync(path.join(root, 'web/assets/models', file));
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', (g) => ok(g.scene), no);
});
for (const [file, tris, heightMin, heightMax] of [
  ['nouf_20k.glb', 20000, 1.64, 1.66], ['nouf_10k.glb', 10000, 1.64, 1.66], ['falcon_body.glb', 5807, 0.40, 0.50]]) {
  const scene = await parse(file);
  let t = 0, colorOk = true, noNormals = true;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    t += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const c = g.attributes.color;
    colorOk &&= !!c && c.normalized && c.array instanceof Uint16Array;
    noNormals &&= !g.attributes.normal;
  });
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  check(t === tris, `${file}: ${tris} triangles (got ${t})`);
  check(colorOk, `${file}: 16-bit normalized vertex colour`);
  check(noNormals, `${file}: no stored normals (flat shading in the material)`);
  check(size.y >= heightMin && size.y <= heightMax, `${file}: height ${size.y.toFixed(3)} m`);
}

// Page: Arabic RTL, import map points at the vendored three.js, official logo on the loader.
const html = readFileSync(path.join(root, 'web/index.html'), 'utf8');
check(/<html lang="ar" dir="rtl">/.test(html), 'page is Arabic and right-to-left');
check(html.includes('"three": "./vendor/three/three.module.js"'), 'import map uses the vendored three.js (no CDN at runtime)');
check(html.includes('assets/brand/aboden_logo.png'), 'loading screen shows the official studio logo');

console.log(`RESULT: ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
