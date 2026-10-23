// HURR — Level 1, slice 1 (mobile browsers first). Wires the deterministic simulation (sim.js)
// to three.js rendering, touch controls, motion-captured animation, audio and the Arabic UI.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Slice, DT } from './sim.js';
import * as LD from './level1_data.js';
import { buildLevel, buildTrap, buildCage, buildWings, facetMaterial } from './level1_view.js';
import { Controls } from './input.js';
import { Animator } from './animator.js';
import { Autopilot } from './autopilot.js';
import { clamp, lerp } from './rand.js';

const params = new URLSearchParams(location.search);
const AUTO = params.has('auto');
const SHOW_STATS = params.has('stats');
const $ = (id) => document.getElementById(id);
const ui = {
  hint: $('hint'), sub: $('sub'), actBtn: $('actBtn'), actLabel: document.querySelector('#actBtn span'), falconBtn: $('falconBtn'), stickBase: $('stickBase'),
  stickKnob: $('stickKnob'), fade: $('fade'), title: $('title'), end: $('end'), stats: $('stats'), bar: document.querySelector('#bar i'),
};

const TEXT = {
  move: 'اسحب بإبهامك في يسار الشاشة لتمشي، وفي يمينها لتدير النظر',
  work: 'المس «فكّ» واجلس عنده',
  calm: 'لا تركض قربه… اقترب بهدوء وانتظر حتى يهدأ',
  pull: 'اسحب الخيط ببطء على طوله',
  slip: 'برفق…',
  thrash: 'فزِع الطير… والتفّ الخيط أكثر',
  pigeon: 'والحمامة؟ المس مطوّلًا لتحريرها',
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
// Camera presets: a distant, slightly telephoto view keeps the characters small (diorama feel)
// and hides close-up mesh flaws. ?cam=near restores the old close view, ?cam=high looks down more.
const CAM_PRESETS = {
  far: { fov: 40, dist: 9.5, pitch: 0.42, wide: 11.5, end: 15, lookUp: 1.0 },
  high: { fov: 36, dist: 13, pitch: 0.8, wide: 15, end: 18, lookUp: 0.8 },
  near: { fov: 55, dist: 4.4, pitch: 0.3, wide: 5.6, end: 7.5, lookUp: 1.45 },
};
const CAMP = CAM_PRESETS[params.get('cam')] || CAM_PRESETS.far;
const camera = new THREE.PerspectiveCamera(CAMP.fov, window.innerWidth / window.innerHeight, 0.1, 260);

const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0.35, 0.40, 0.62) }, horizon: { value: new THREE.Color(0.98, 0.72, 0.52) }, ground: { value: new THREE.Color(0.86, 0.60, 0.46) } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, ground, min(1.0, -h * 4.0)); gl_FragColor = vec4(c, 1.0); }',
}));
scene.add(sky);
scene.fog = new THREE.FogExp2(new THREE.Color(0.92, 0.78, 0.70), 0.012);
scene.add(new THREE.HemisphereLight(new THREE.Color(0.62, 0.60, 0.80), new THREE.Color(0.55, 0.42, 0.40), 0.95));
const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.86, 0.70), 2.6);
const SUN_OFFSET = new THREE.Vector3(24, 9, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 80 });
scene.add(sun, sun.target);

const level = buildLevel(scene);
const crownMesh = level.group.getObjectByName('AcaciaCrown');
const trap = buildTrap();
scene.add(trap.group);
const pigeonFly = { t: -1 };

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
  const clips = najd.animations;                       // CMU mocap, retargeted (tools/anim/retarget.py)
  const n = prepChar(najd.scene);
  const nRoot = new THREE.Group(); nRoot.add(n); scene.add(nRoot);
  actors.najd = { root: nRoot, anim: new Animator(n, clips) };

  actors.men = sim.men.map((m, i) => {
    const t = prepChar(i === 0 ? trapper.scene : cloneSkinned(trapper.scene));
    if (i === 1) t.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setRGB(0.86, 0.88, 0.95); } });
    const root = new THREE.Group(); root.add(t); root.scale.setScalar(1.07); scene.add(root);
    const anim = new Animator(t, clips), cage = buildCage();
    anim.bone('hand_R').add(cage); cage.position.set(-0.02, -0.24, 0.03);
    return { root, anim, cage, dropped: false, stunAge: 0 };
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
const cam = { yaw: 0, pitch: CAMP.pitch, dist: CAMP.dist, idle: 0, target: new THREE.Vector3(), shake: 0 };
function updateCamera(dt) {
  const p = sim.player;
  const [dx, dy] = controls.takeCamera();
  if (dx || dy) { cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.004, 0.1, 1.25); cam.idle = 0; } else cam.idle += dt;
  // drift behind Najd while she moves (never while the player is steering the camera)
  if (cam.idle > 1.2 && p.speed > 1.0 && p.mode === 'ground') {
    const want = p.yaw + Math.PI;
    let d = Math.atan2(Math.sin(want - cam.yaw), Math.cos(want - cam.yaw));
    if (Math.abs(d) < 2.2) cam.yaw += d * Math.min(1, dt * 0.9 * (p.speed / 5));
  }
  const B = sim.men[1];
  const wide = (B.state === 'block' || B.state === 'stepout') && Math.hypot(B.mover.x - p.x, B.mover.z - p.z) < 14;
  const working = sim.trap.mode === 'work' || (sim.canFreePigeon && sim.actionPose > 0.3);
  if (working) {          // swing round to a three-quarter view so the bird and her hands are both in shot
    const want = Math.atan2(p.x - LD.TRAP.x, p.z - LD.TRAP.z) + 1.25;
    cam.yaw += Math.atan2(Math.sin(want - cam.yaw), Math.cos(want - cam.yaw)) * Math.min(1, dt * 3);
    cam.pitch = lerp(cam.pitch, 0.62, Math.min(1, dt * 3));
  }
  const wantDist = sim.phase === 'end' ? CAMP.end : working ? 2.6 : wide ? CAMP.wide : CAMP.dist;
  cam.dist = lerp(cam.dist, wantDist, 1 - Math.exp(-dt * 2));
  const tgt = working ? new THREE.Vector3(p.x * 0.35 + LD.TRAP.x * 0.65, p.y + 0.35, p.z * 0.35 + LD.TRAP.z * 0.65) : new THREE.Vector3(p.x, p.y + CAMP.lookUp, p.z);
  cam.target.lerp(tgt, 1 - Math.exp(-dt * 10));
  let dist = cam.dist;
  const dir = new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
  for (let i = 1; i <= 8; i++) {             // keep the canyon walls out of the lens
    const s = (dist * i) / 8, q = cam.target.clone().addScaledVector(dir, s);
    if (LD.heightAt(q.x, q.z) > q.y - 0.3) { dist = Math.max(1.2, s * 0.85); break; }
  }
  camera.position.copy(cam.target).addScaledVector(dir, dist);
  if (cam.shake > 0) { camera.position.x += (Math.random() - 0.5) * cam.shake; camera.position.y += (Math.random() - 0.5) * cam.shake; cam.shake *= 0.9; }
  camera.lookAt(cam.target);
  // fade the acacia crown while it stands between the lens and Najd
  if (crownMesh) {
    const b = LD.CAMERA_BLOCKERS[0];
    let hit = false;
    for (let i = 1; i < 10 && !hit; i++) {
      const q = camera.position.clone().lerp(cam.target, i / 10);
      hit = Math.hypot(q.x - b.x, q.z - b.z) < b.r && q.y > b.y0 - 0.6 && q.y < b.y1;
    }
    const m = crownMesh.material;
    m.opacity = lerp(m.opacity, hit ? 0.22 : 1, 1 - Math.exp(-dt * 8));
    m.depthWrite = m.opacity > 0.95;
  }
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
  const A = nj.anim;
  if (sim.phase === 'caught') A.play('cower', 0.15);
  else if (p.mode === 'climb') A.play('climb', 0.12, A.duration('climb') / p.climb.dur, p.climb.t < dt * 1.5);
  else if (p.mode === 'air') { /* keep the stride going while dropping off a ledge */ }
  else if (sim.actionPose > 0.05) A.play('kneel', 0.3);
  else if (sim.phase === 'explore' && sim.trapDist < LD.TRAP.calmRadius && p.speed > 0.2 && p.speed < 2.4) A.play('sneak', 0.35, clamp(p.speed / 0.45, 0.8, 2.2));
  else if (p.speed > 2.8) A.play('run', 0.25, clamp(p.speed / 3.09, 0.8, 1.5));
  else if (p.speed > 0.25) A.play('walk', 0.25, clamp(p.speed / 1.25, 0.6, 1.5));
  else A.play('idle', 0.35);
  A.update(dt);
  A.layer('call', ['clavicle_L', 'upperarm_L', 'forearm_L', 'hand_L'], 0.55, sim.callPose);   // the gloved fist goes up

  sim.men.forEach((m, i) => {
    const v = actors.men[i], mv = m.mover, M = v.anim;
    v.root.visible = !(m.id === 'A' && (m.state === 'hidden'));
    v.root.position.set(mv.x, mv.y, mv.z);
    v.root.rotation.y = mv.yaw;
    if (m.state === 'stunned') { v.stunAge += dt; M.play(v.stunAge < 0.8 ? 'stumble' : 'cower', 0.2); }
    else if (m.state === 'down') M.play('cower', 0.2);
    else if (m.state === 'hidden') M.play('kneel', 0.3);
    else if (m.state === 'giveup') M.play('angry', 0.3);
    else if (mv.mode === 'climb') M.play('climb', 0.12, M.duration('climb') / mv.climb.dur, mv.climb.t < dt * 1.5);
    else if (m.state === 'block' && mv.speed < 0.3) M.play('angry', 0.3);
    else if (mv.speed > 2.8) M.play('run', 0.25, clamp(mv.speed / 3.09, 0.8, 1.5));
    else if (mv.speed > 0.25) M.play('walk', 0.25, clamp(mv.speed / 1.25, 0.6, 1.5));
    else M.play('idle', 0.35);
    if (m.state !== 'stunned') v.stunAge = 0;
    M.update(dt);
    // the cage drops when the falcon strikes
    if (!m.hasCage && !v.dropped) {
      v.cage.getWorldPosition(wpos); v.dropped = true;
      scene.attach(v.cage); v.cage.position.set(wpos.x, LD.heightAt(wpos.x, wpos.z) + 0.01, wpos.z);
      v.cage.rotation.set(0, Math.random() * 3, 0.35); v.cage.scale.setScalar(1.07);
    } else if (m.hasCage && v.dropped) {
      v.dropped = false; M.bone('hand_R').add(v.cage); v.cage.position.set(-0.02, -0.24, 0.03); v.cage.rotation.set(0, 0, 0); v.cage.scale.setScalar(1);
    }
  });

  const f = sim.falcon, fa = actors.falcon;
  fa.root.position.set(f.x, f.y, f.z);
  let wingAmp = 0, wingBase = 0, pitch = 0;
  if (f.state === 'trapped') {            // mantling over the pigeon, talons caught; panic grows with stress
    const st = sim.trap.stress;
    pitch = 0.45 + 0.25 * Math.sin(f.flap * 0.5) * st; fa.root.rotation.y = 2.3; fa.root.rotation.z = 0.15 * Math.sin(f.flap * 0.7) * st;
    wingBase = 0.35 + 0.25 * st; wingAmp = Math.sin(f.flap) * (0.12 + 0.75 * st);
  }
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
  // the pigeon: flutters while held; once freed it rights itself and flies off up the wadi
  const pg = trap.pigeon;
  if (sim.pigeon.state === 'free') {
    if (pigeonFly.t < 0) { pigeonFly.t = 0; trap.nooses.visible = false; }
    pigeonFly.t += dt;
    const u = pigeonFly.t;
    pg.rotation.set(0, Math.PI, 0);
    pg.position.set(LD.TRAP.x + u * 1.5, trap.ground + u * u * 2.2, LD.TRAP.z - u * 5);
    pg.visible = u < 4;
  } else {
    if (pigeonFly.t >= 0) { pigeonFly.t = -1; trap.nooses.visible = true; pg.visible = true; pg.position.set(LD.TRAP.x, trap.ground, LD.TRAP.z); }
    pg.rotation.set(0, 0.6, 0.9 + 0.12 * Math.sin(t * 9) * (sim.phase === 'explore' ? sim.trap.stress : 0.3));
  }
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
      case 'thrash': audio.play('falcon_call', 1, 1.25); say(TEXT.thrash, 2.0); navigator.vibrate?.([30, 40, 30]); break;
      case 'knot': audio.play('net_throw', 0.5, 1.4); navigator.vibrate?.(15); break;
      case 'slip': knotUI.slipFlash = 0.8; navigator.vibrate?.(40); break;
      case 'pigeonFreed': audio.play('launch', 0.6, 1.6); break;
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

// ---------------------------------------------------------------- the knot gesture
// While Najd works the nooses, a strand is drawn across the screen: drag its bead from one end to
// the other. Slow and steady loosens the noose; a fast jerk slips and frightens the bird.
const knotUI = {
  el: $('knot'), path: $('knotPath'), bead: $('knotBead'), count: $('knotCount'),
  pts: [], t: 0, lastT: 0, drag: null, cur: -1, slipFlash: 0, pending: 0, fast: false, speed: 0,
  layout() {
    const w = window.innerWidth, h = window.innerHeight;
    const a = [w * 0.24, h * 0.58], c = [w * 0.5, h * 0.36], b = [w * 0.76, h * 0.58];
    this.pts = [];
    for (let i = 0; i <= 48; i++) {
      const u = i / 48, x = (1 - u) * (1 - u) * a[0] + 2 * u * (1 - u) * c[0] + u * u * b[0], y = (1 - u) * (1 - u) * a[1] + 2 * u * (1 - u) * c[1] + u * u * b[1];
      this.pts.push([x, y]);
    }
    this.path.setAttribute('d', `M${a[0]},${a[1]} Q${c[0]},${c[1]} ${b[0]},${b[1]}`);
    this.el.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.len = this.pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - this.pts[i - 1][0], p[1] - this.pts[i - 1][1]) : 0), 0);
  },
  nearestT(x, y) {
    let best = 0, bd = 1e9;
    this.pts.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = i / 48; } });
    return { t: best, d: bd };
  },
  init() {
    this.layout();
    window.addEventListener('resize', () => this.layout());
    this.el.addEventListener('pointerdown', (e) => {
      const { d } = this.nearestT(e.clientX, e.clientY);
      if (d < 70) { this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tm: performance.now() }; this.el.setPointerCapture(e.pointerId); }
      e.stopPropagation();
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const now = performance.now(), dtm = Math.max(1, now - this.drag.tm);
      const v = Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) / (dtm / 1000);
      this.speed = this.speed * 0.6 + v * 0.4;
      Object.assign(this.drag, { x: e.clientX, y: e.clientY, tm: now });
      const { t } = this.nearestT(e.clientX, e.clientY);
      // too fast: more than ~1.3 strand-lengths per second
      if (this.speed > this.len * 1.3) { this.fast = true; return; }
      if (t > this.t) { this.pending += t - this.t; this.t = t; }
    });
    for (const ev of ['pointerup', 'pointercancel']) this.el.addEventListener(ev, () => { this.drag = null; this.speed = 0; });
  },
  // called once per sim tick: what the gesture did since the last tick
  take(sim, c) {
    if (sim.trap.mode !== 'work') { this.pending = 0; this.fast = false; return {}; }
    let pull = this.pending, fast = this.fast;
    if (c.keyPull) pull += 0.012;                       // desktop testing: hold E
    this.pending = 0; this.fast = false;
    return { pull, pullFast: fast };
  },
  update(work, sim) {
    this.el.classList.toggle('on', work);
    if (!work) { this.cur = -1; return; }
    const T = sim.trap;
    if (T.cur !== this.cur) { this.cur = T.cur; this.t = T.knots[T.cur] || 0; }
    this.t = Math.max(this.t, T.knots[T.cur] || 0);
    if (T.knots[T.cur] < this.t - 0.3) this.t = T.knots[T.cur];       // a panic undid part of it
    const i = Math.min(48, Math.round(this.t * 48)), p = this.pts[i] || this.pts[0];
    this.bead.setAttribute('cx', p[0]); this.bead.setAttribute('cy', p[1]);
    this.count.textContent = `العقدة ${Math.min(T.cur + 1, T.knots.length)} من ${T.knots.length}`;
    this.el.classList.toggle('slip', this.slipFlash > 0);
    this.slipFlash = Math.max(0, this.slipFlash - 1 / 60);
  },
};
knotUI.init();

function updateUI(dt) {
  const work = sim.trap.mode === 'work';
  const showAct = sim.canWork || sim.canFreePigeon;
  ui.actBtn.classList.toggle('show', showAct && !work);
  ui.actLabel.textContent = sim.canFreePigeon ? 'الحمامة' : 'فكّ';
  ui.actBtn.style.setProperty('--p', `${sim.canFreePigeon ? (sim.pigeon.hold / 1.0) * 100 : 0}%`);
  knotUI.update(work, sim);
  const tgt = sim.diveTarget();
  ui.falconBtn.classList.toggle('show', !!tgt);
  ui.falconBtn.classList.toggle('pulse', sim.slowMo);
  let h = null;
  if (sim.hint === 'move' && started && !controls.touched && !AUTO) h = TEXT.move;
  else if (sim.hint === 'move' && started && sim.movedDist < 3 && !AUTO) h = TEXT.move;
  if (sim.canWork) h = TEXT.work;
  if (sim.tooRestless || sim.hint === 'calm') h = TEXT.calm;
  if (work) h = knotUI.slipFlash > 0 ? TEXT.slip : TEXT.pull;
  if (sim.canFreePigeon) h = TEXT.pigeon;
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
  cam.yaw = 0; cam.pitch = CAMP.pitch;
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
      const k = knotUI.take(sim, c);
      const input = AUTO ? autopilot.input(cam.yaw) : { ...c, ...k, camYaw: cam.yaw };
      sim.tick(input);
      acc -= DT; steps++;
    }
    if (steps === 5) acc = 0;
    handleEvents();
  }
  const simDt = dt * sim.timeScale;
  if (!window.__dbg?.freeze) { updateActors(simDt, sim.time); updateCamera(dt); }
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
