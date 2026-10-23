// HURR web (mobile browsers first) — model and world preview. Touch: drag to orbit Nouf,
// pinch to zoom, double-tap to reset. The game loop comes after the story and levels are agreed.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { World, addSkyAndLight, facetMaterial } from './world.js';
import { OrbitTouch } from './orbit_touch.js';

const NOUF_POS = new THREE.Vector3(0, 0, -1.6);
const PERCH = { x: 0.9, z: -1.4, h: 0.9 };

const bar = document.querySelector('#bar i');
const statsEl = document.getElementById('stats');

function fail(msg) {
  const e = document.getElementById('err');
  e.textContent = msg;
  e.style.display = 'grid';
}

if (!window.WebGL2RenderingContext) fail('هذا المتصفح لا يدعم WebGL2، وهي مطلوبة لتشغيل اللعبة.');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));       // phones: cap at 2x for fill rate
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 300);
addSkyAndLight(scene);
const world = new World();
scene.add(world.build());
const perchTop = world.perch(PERCH.x, PERCH.z, PERCH.h);

const orbit = new OrbitTouch(camera, renderer.domElement, NOUF_POS.clone().add(new THREE.Vector3(0, 1.1, 0)));

// Models: faceted, vertex-coloured; the material lights each facet flat.
const manager = new THREE.LoadingManager();
manager.onProgress = (_url, done, total) => { bar.style.width = `${(done / total) * 100}%`; };
const loader = new GLTFLoader(manager);
const load = (url) => new Promise((ok, no) => loader.load(url, (g) => ok(g.scene), undefined, no));

function prepare(root) {
  const mat = facetMaterial();
  root.traverse((o) => {
    if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; }
  });
  return root;
}

let triangles = 0;
Promise.all([load('assets/models/nouf_20k.glb'), load('assets/models/nouf_10k.glb'), load('assets/models/falcon_body.glb')])
  .then(([near, far, falcon]) => {
    const nouf = new THREE.LOD();
    nouf.name = 'Nouf';
    nouf.addLevel(prepare(near), 0);
    nouf.addLevel(prepare(far), 6);
    nouf.position.copy(NOUF_POS);
    scene.add(nouf);
    const saker = prepare(falcon);
    saker.name = 'Saker';
    saker.position.copy(perchTop);
    saker.rotation.y = -0.35;   // the model faces +Z; turned a little toward Nouf and the viewer
    scene.add(saker);
    document.getElementById('loading').style.opacity = 0;
    setTimeout(() => document.getElementById('loading').remove(), 700);
  })
  .catch((e) => fail('تعذّر تحميل المجسمات. تحقق من الاتصال ثم أعد تحميل الصفحة.\n' + e));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Frame stats (smoothed) so phone performance can be read straight off the screen.
let frames = 0, last = performance.now(), fps = 0;
const build = document.querySelector('meta[name="hurr-build"]')?.content || 'dev';
renderer.setAnimationLoop(() => {
  orbit.update();
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - last > 500) {
    fps = Math.round((frames * 1000) / (now - last));
    frames = 0;
    last = now;
    triangles = renderer.info.render.triangles;
    statsEl.textContent = `بناء ${build} · ${fps} إطار/ث · ${(triangles / 1000).toFixed(0)}k مثلث · ${renderer.info.render.calls} رسم`;
  }
});
