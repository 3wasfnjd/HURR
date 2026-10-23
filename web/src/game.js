// HURR — Level 1, slice 1 (mobile browsers first). Wires the deterministic simulation (sim.js)
// to three.js rendering, touch controls, procedural animation, audio and the Arabic UI.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Slice, DT } from './sim.js';
import * as LD from './level1_data.js';
import { buildLevel, buildNet, buildCage, buildWings, facetMaterial } from './level1_view.js';
import { Controls } from './input.js';
import * as A from './anim.js';
import { Autopilot } from './autopilot.js';
import { clamp, lerp } from './rand.js';

const params = new URLSearchParams(location.search);
const AUTO = params.has('auto');
const SHOW_STATS = params.has('stats');
const $ = (id) => document.getElementById(id);
const ui = {
  hint: $('hint'), sub: $('sub'), actBtn: $('actBtn'), falconBtn: $('falconBtn'), stickBase: $('stickBase'),
  stickKnob: $('stickKnob'), fade: $('fade'), title: $('title'), end: $('end'), stats: $('stats'), bar: document.querySelector('#bar i'),
};

const TEXT = {
  move: 'اسحب بإبهامك في يسار الشاشة لتمشي، وفي يمينها لتدير النظر',
  net: 'المس مطوّلًا «فكّ» لتحرير الصقر',
  falcon: 'الصقر يراقب من الأعلى — المس «انقضّ»',
  freed: 'طار… ولم يقترب.',
  shoutA: '— فكّت الطير! الحقوا عليها!',
  shoutB: '— على وين؟',
  giveup: '— خلّوها… الطير ما راح بعيد.',
  caught: 'أمسكوا بكِ…',
  endLine: '«هذي العلامة… حسبتها راحت من زمان.»',
};

function fail(msg) { const e = $('err'); e.textContent = msg; e.style.display = 'grid'; }
if (!window.WebGL2RenderingContext) fail('هذا المتصفح لا يدعم WebGL2، وهي مطلوبة لتشغيل اللعبة.');

// ---------------------------------------------------------------- renderer + scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.id = 'view';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 220);

const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0.35, 0.40, 0.62) }, horizon: { value: new THREE.Color(0.98, 0.72, 0.52) }, ground: { value: new THREE.Color(0.86, 0.60, 0.46) } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, ground, min(1.0, -h * 4.0)); gl_FragColor = vec4(c, 1.0); }',
}));
scene.add(sky);
scene.fog = new THREE.FogExp2(new THREE.Color(0.92, 0.78, 0.70), 0.016);
scene.add(new THREE.HemisphereLight(new THREE.Color(0.62, 0.60, 0.80), new THREE.Color(0.55, 0.42, 0.40), 0.95));
const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.86, 0.70), 2.6);
const SUN_OFFSET = new THREE.Vector3(24, 9, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 70 });
scene.add(sun, sun.target);

const level = buildLevel(scene);
const net = buildNet();
scene.add(net);

// ---------------------------------------------------------------- simulation + controls
let sim = new Slice();
let autopilot = AUTO ? new Autopilot(sim) : null;
const controls = new Controls(renderer.domElement, ui);

// ---------------------------------------------------------------- audio (unlocked on first touch)
class Audio {
  constructor() { this.ctx = null; this.buf = {}; this.ready = false; }
  async unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(this.ctx.destination);
    this.wind();
    const names = ['falcon_call', 'launch', 'strike', 'catch', 'player_hit', 'net_throw', 'flee', 'wave'];
    await Promise.all(names.map(async (n) => {
      try { const r = await fetch(`assets/sfx/${n}.wav`); this.buf[n] = await this.ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { /* sound is optional */ }
    }));
    this.ready = true;
  }
  wind() {      // looping filtered noise with a slow gust
    const c = this.ctx, len = c.sampleRate * 4, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = last * 6; }
    const src = c.createBufferSource(); src.buffer = b; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
    const g = c.createGain(); g.gain.value = 0.18;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 0.1; lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(this.master); src.start(); lfo.start();
  }
  play(name, vol = 1, rate = 1) {
    if (!this.ready || !this.buf[name]) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.buf[name]; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(g).connect(this.master); s.start();
  }
}
const audio = new Audio();

// ---------------------------------------------------------------- characters
const loader = new GLTFLoader(new THREE.LoadingManager());
loader.manager.onProgress = (_u, done, total) => { ui.bar.style.width = `${(done / total) * 100}%`; };
const load = (url) => new Promise((ok, no) => loader.load(url, ok, undefined, no));

const actors = {};
function prepChar(root, { doubleSide = false } = {}) {
  const mat = facetMaterial(doubleSide ? { side: THREE.DoubleSide } : {});
  root.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  return root;
}

async function loadActors() {
  const [najd, trapper, falcon] = await Promise.all([load('assets/models/najd.glb'), load('assets/models/trapper.glb'), load('assets/models/falcon_body.glb')]);
  const n = prepChar(najd.scene);
  const nRoot = new THREE.Group(); nRoot.add(n); scene.add(nRoot);
  actors.najd = { root: nRoot, rig: new A.Rig(n), phase: 0 };

  actors.men = sim.men.map((m, i) => {
    const t = prepChar(i === 0 ? trapper.scene : cloneSkinned(trapper.scene), { doubleSide: true });
    if (i === 1) t.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
    if (i === 1) t.traverse((o) => { if (o.isMesh) o.material.color.setRGB(0.82, 0.86, 0.95); });   // second man reads a shade cooler
    const root = new THREE.Group(); root.add(t); scene.add(root);
    const rig = new A.Rig(t), cage = buildCage();
    rig.bones.hand_R.add(cage); cage.position.set(-0.02, -0.26, 0.02);
    return { root, rig, cage, phase: i * 1.3, dropped: false, stunAge: 0 };
  });

  const fRoot = new THREE.Group(), body = new THREE.Group();
  const f = falcon.scene;
  f.traverse((o) => { if (o.isMesh) { o.material = facetMaterial(); o.castShadow = true; } });
  body.add(f); fRoot.add(body);
  const wings = buildWings();
  const wingPivot = new THREE.Group(); wingPivot.position.set(0, 0.07, 0.12);
  wingPivot.add(wings.L, wings.R); fRoot.add(wingPivot);
  fRoot.scale.setScalar(1.7);      // the real bird is ~0.5 m: read it at phone size
  scene.add(fRoot);
  actors.falcon = { root: fRoot, body, wings, wingPivot };
}

// ---------------------------------------------------------------- camera rig
const cam = { yaw: 0, pitch: 0.3, dist: 4.4, idle: 0, target: new THREE.Vector3(), shake: 0 };
function updateCamera(dt) {
  const p = sim.player;
  const [dx, dy] = controls.takeCamera();
  if (dx || dy) { cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.004, -0.05, 1.1); cam.idle = 0; } else cam.idle += dt;
  // drift behind Najd while she moves (never while the player is steering the camera)
  if (cam.idle > 1.2 && p.speed > 1.0 && p.mode === 'ground') {
    const want = p.yaw + Math.PI;
    let d = Math.atan2(Math.sin(want - cam.yaw), Math.cos(want - cam.yaw));
    if (Math.abs(d) < 2.2) cam.yaw += d * Math.min(1, dt * 0.9 * (p.speed / 5));
  }
  const B = sim.men[1];
  const wide = (B.state === 'block' || B.state === 'stepout') && Math.hypot(B.mover.x - p.x, B.mover.z - p.z) < 14;
  const wantDist = sim.phase === 'end' ? 7.5 : wide ? 5.6 : 4.4;
  cam.dist = lerp(cam.dist, wantDist, 1 - Math.exp(-dt * 2));
  const tgt = new THREE.Vector3(p.x, p.y + 1.45, p.z);
  cam.target.lerp(tgt, 1 - Math.exp(-dt * 10));
  let dist = cam.dist;
  const dir = new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
  for (let i = 1; i <= 8; i++) {             // keep the canyon walls out of the lens
    const s = (dist * i) / 8, q = cam.target.clone().addScaledVector(dir, s);
    const inCrown = LD.CAMERA_BLOCKERS.some((b) => Math.hypot(q.x - b.x, q.z - b.z) < b.r && q.y > b.y0 && q.y < b.y1);
    if (LD.heightAt(q.x, q.z) > q.y - 0.3 || inCrown) { dist = Math.max(1.2, s * 0.85); break; }
  }
  camera.position.copy(cam.target).addScaledVector(dir, dist);
  if (cam.shake > 0) { camera.position.x += (Math.random() - 0.5) * cam.shake; camera.position.y += (Math.random() - 0.5) * cam.shake; cam.shake *= 0.9; }
  camera.lookAt(cam.target);
  sun.position.copy(cam.target).add(SUN_OFFSET);
  sun.target.position.copy(cam.target);
}

// ---------------------------------------------------------------- visuals from sim state
const wpos = new THREE.Vector3();
function updateActors(dt, t) {
  if (!actors.najd) return;
  const p = sim.player, nj = actors.najd;
  nj.root.position.set(p.x, p.y, p.z);
  nj.root.rotation.y = p.yaw;
  let pose;
  if (sim.phase === 'caught') pose = A.cower();
  else if (p.mode === 'climb') pose = A.climb(p.climb.t / p.climb.dur);
  else if (p.mode === 'air') pose = A.airborne();
  else if (sim.actionPose > 0.05) pose = A.kneel(t, sim.actionPose);
  else if (p.speed > 0.25) {
    const run = clamp((p.speed - 2.3) / 2.7, 0, 1);
    nj.phase += dt * p.speed * (2 * Math.PI / lerp(1.25, 2.3, run));
    pose = A.locomotion(nj.phase, run);
  } else pose = A.idle(t);
  pose.pose = A.layerCall(pose.pose, sim.callPose);
  nj.rig.apply(pose.pose, pose.drop, dt, p.mode === 'climb' ? 22 : 14);

  sim.men.forEach((m, i) => {
    const v = actors.men[i], mv = m.mover;
    v.root.visible = !(m.id === 'A' && (m.state === 'hidden'));
    v.root.position.set(mv.x, mv.y, mv.z);
    v.root.rotation.y = mv.yaw;
    let ps;
    if (m.state === 'stunned' || m.state === 'down') { v.stunAge = m.state === 'down' ? 9 : v.stunAge + dt; ps = A.stunned(v.stunAge); } else v.stunAge = 0;
    if (!ps) {
      if (m.state === 'hidden') ps = A.crouchHide(t + i);
      else if (m.state === 'giveup') ps = A.shakeFist(t);
      else if (m.state === 'block') ps = mv.speed > 0.3 ? A.locomotion((v.phase += dt * mv.speed * 4), 0) : A.blockArms(t);
      else if (mv.mode === 'climb') ps = A.climb(mv.climb.t / mv.climb.dur);
      else if (mv.speed > 0.25) { const run = clamp((mv.speed - 2.3) / 2.5, 0, 1); v.phase += dt * mv.speed * (2 * Math.PI / lerp(1.4, 2.5, run)); ps = A.locomotion(v.phase, run); }
      else ps = A.idle(t + i * 2);
      if (m.state === 'block' && mv.speed > 0.3) { const b = A.blockArms(t).pose; ps.pose.upperarm_L = b.upperarm_L; ps.pose.upperarm_R = b.upperarm_R; ps.pose.forearm_L = b.forearm_L; ps.pose.forearm_R = b.forearm_R; }
    }
    v.rig.apply(ps.pose, ps.drop, dt);
    // the cage drops when the falcon strikes
    if (!m.hasCage && !v.dropped) {
      v.cage.getWorldPosition(wpos); v.dropped = true;
      scene.attach(v.cage); v.cage.position.set(wpos.x, LD.heightAt(wpos.x, wpos.z) + 0.01, wpos.z);
      v.cage.rotation.set(0, Math.random() * 3, 0.35);
    } else if (m.hasCage && v.dropped) {
      v.dropped = false; v.rig.bones.hand_R.add(v.cage); v.cage.position.set(-0.02, -0.26, 0.02); v.cage.rotation.set(0, 0, 0);
    }
  });

  const f = sim.falcon, fa = actors.falcon;
  fa.root.position.set(f.x, f.y, f.z);
  let wingAmp = 0, wingBase = 0, pitch = 0;
  if (f.state === 'netted') { pitch = 0.9; wingAmp = Math.sin(f.flap) * 0.6; wingBase = 0.2; fa.root.rotation.y = 0.4; fa.root.rotation.z = 0.35; }
  else if (f.state === 'flying') {
    fa.root.rotation.z = 0;
    fa.root.rotation.y = f.yaw;
    const diving = f.purpose === 'dive' && f.flight.t / f.flight.dur > 0.55;
    pitch = diving ? 1.55 : 1.18;
    wingAmp = diving ? 0.1 : Math.sin(f.flap) * 0.75; wingBase = diving ? -0.9 : 0.05;
  } else {                                               // perched: watch Najd
    fa.root.rotation.z = 0;
    const want = Math.atan2(sim.player.x - f.x, sim.player.z - f.z);
    fa.root.rotation.y += Math.atan2(Math.sin(want - fa.root.rotation.y), Math.cos(want - fa.root.rotation.y)) * Math.min(1, dt * 3);
  }
  fa.body.rotation.x = lerp(fa.body.rotation.x, pitch, 1 - Math.exp(-dt * 10));
  const showWings = f.state !== 'perched';
  fa.wings.L.visible = fa.wings.R.visible = showWings;
  fa.wings.L.rotation.z = wingBase + wingAmp; fa.wings.R.rotation.z = -(wingBase + wingAmp);
  fa.wingPivot.position.set(0, lerp(0.22, 0.07, fa.body.rotation.x / 1.55), lerp(0.0, 0.12, fa.body.rotation.x / 1.55));

  // the net slumps to the ground once cut
  if (sim.phase !== 'explore' && net.position.y > -1.2) net.position.y -= dt * 2.5, net.rotation.x = Math.min(0.25, net.rotation.x + dt);
  if (sim.phase === 'explore' && net.position.y !== 0) { net.position.y = 0; net.rotation.x = 0; }
}

// ---------------------------------------------------------------- UI
let subTimer = 0;
function say(text, secs = 2.6) { ui.sub.textContent = text; ui.sub.classList.add('on'); subTimer = secs; }
let started = false, endShown = false;

function handleEvents() {
  for (const ev of sim.drainEvents()) {
    switch (ev.e) {
      case 'falconCry': {
        const d = Math.hypot(ev.x - sim.player.x, ev.z - sim.player.z);
        audio.play('falcon_call', clamp(1.3 - d / 40, 0.15, 1), 0.95 + Math.random() * 0.1);
        break;
      }
      case 'freed': audio.play('net_throw', 0.8); audio.play('falcon_call', 1); say(TEXT.freed, 2.2); break;
      case 'shout': say(ev.giveup ? TEXT.giveup : ev.man === 'A' ? TEXT.shoutA : TEXT.shoutB, 2.4); audio.play('flee', 0.5, ev.man === 'A' ? 0.8 : 0.7); break;
      case 'dive': audio.play('launch', 1); audio.play('falcon_call', 0.9, 1.1); navigator.vibrate?.(30); break;
      case 'strike': audio.play('strike', 1); cam.shake = 0.06; navigator.vibrate?.([20, 30, 40]); break;
      case 'caught': audio.play('player_hit', 1); say(TEXT.caught, 1.6); ui.fade.classList.add('on'); navigator.vibrate?.(120); break;
      case 'respawn': ui.fade.classList.remove('on'); break;
      case 'climb': break;
      case 'end': setTimeout(() => showEnd(), 2200); break;
    }
  }
}

function updateUI(dt) {
  const near = sim.nearNet;
  ui.actBtn.classList.toggle('show', near);
  ui.actBtn.style.setProperty('--p', `${(sim.netHold / LD.NET.holdTime) * 100}%`);
  const tgt = sim.diveTarget();
  ui.falconBtn.classList.toggle('show', !!tgt);
  ui.falconBtn.classList.toggle('pulse', sim.slowMo);
  let h = null;
  if (sim.hint === 'move' && started && !controls.touched && !AUTO) h = TEXT.move;
  else if (sim.hint === 'move' && started && sim.movedDist < 3 && !AUTO) h = TEXT.move;
  if (near && sim.netHold === 0) h = TEXT.net;
  if (sim.hint === 'falcon' && sim.slowMo) h = TEXT.falcon;
  ui.hint.textContent = h || '';
  ui.hint.classList.toggle('on', !!h);
  if (subTimer > 0) { subTimer -= dt; if (subTimer <= 0) ui.sub.classList.remove('on'); }
}

function showEnd() {
  if (endShown) return;
  endShown = true;
  ui.fade.classList.add('on', 'slow');
  setTimeout(() => {
    $('endLine').textContent = TEXT.endLine;
    $('endTime').textContent = `الزمن ${Math.floor(sim.time / 60)}:${String(Math.floor(sim.time % 60)).padStart(2, '0')} · مرات الإمساك ${sim.deaths}`;
    ui.end.classList.add('on');
  }, 1300);
}

$('again').addEventListener('click', () => {
  sim = new Slice(); if (AUTO) autopilot = new Autopilot(sim);
  endShown = false; ui.end.classList.remove('on'); ui.fade.classList.remove('on', 'slow');
  cam.yaw = 0; cam.pitch = 0.3;
  for (const v of actors.men) { v.dropped = true; }
});

// ---------------------------------------------------------------- main loop (fixed 60 Hz sim, render every frame)
let acc = 0, last = performance.now(), frames = 0, fpsT = 0, fps = 0;
const build = document.querySelector('meta[name="hurr-build"]')?.content || 'dev';
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (started && actors.najd && !window.__dbg?.pause) {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 5) {
      const c = controls.sample();
      const input = AUTO ? autopilot.input(cam.yaw) : { ...c, camYaw: cam.yaw };
      sim.tick(input);
      acc -= DT; steps++;
    }
    if (steps === 5) acc = 0;
    handleEvents();
  }
  const simDt = dt * sim.timeScale;
  updateActors(simDt, sim.time);
  updateCamera(dt);
  updateUI(dt);
  renderer.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 0.5) {
    fps = Math.round(frames / fpsT); frames = 0; fpsT = 0;
    if (SHOW_STATS) ui.stats.textContent = `${build} · ${fps} fps · ${(renderer.info.render.triangles / 1000).toFixed(0)}k · ${renderer.info.render.calls} dc`;
    window.__hurr = { fps, phase: sim.phase, time: sim.time, deaths: sim.deaths, tris: renderer.info.render.triangles, calls: renderer.info.render.calls, checkpoint: sim.checkpoint, player: { x: sim.player.x, y: sim.player.y, z: sim.player.z } };
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (params.has('debug')) window.__dbg = { THREE, scene, camera, actors, cam, get sim() { return sim; } };
loadActors().then(() => {
  $('loading').classList.add('gone');
  const start = () => {
    if (started) return;
    started = true; ui.title.classList.add('gone'); audio.unlock();
  };
  ui.title.addEventListener('pointerdown', start);
  window.addEventListener('keydown', start, { once: true });
  if (AUTO || params.has('play')) start();
  updateCamera(1);
  requestAnimationFrame(frame);
}).catch((e) => fail('تعذّر تحميل المجسمات. تحقق من الاتصال ثم أعد تحميل الصفحة.\n' + e));
