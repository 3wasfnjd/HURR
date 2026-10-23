// HURR web — the "Naqsh" set: faceted dunes, an engraved sandstone escarpment, boulders,
// a perch pillar, dawn sky and a low grazing sun. Ported from scripts/world.gd; deterministic.
import * as THREE from 'three';

export const CLIFF_Z = -11.0;
const PANEL_HALF_W = 5.0;

const PALETTE = {
  sand: [0.86, 0.66, 0.50], sandShade: [0.76, 0.54, 0.44],
  stone: [0.84, 0.62, 0.52], stoneDark: [0.62, 0.42, 0.38],
  engrave: [0.40, 0.22, 0.20],
};

// Small seeded PRNG + 2-D value noise (no dependencies; same output on every device).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const r = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = r() * 2 - 1; }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const s = (t) => t * t * (3 - 2 * t);
  const v = (x, y) => vals[perm[(perm[x & 255] + y) & 255]];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    const u = s(xf), w = s(yf);
    return (a + (b - a) * u) * (1 - w) + (c + (d - c) * u) * w;
  };
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toLinear = (c) => c.map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));

// Collects flat-coloured triangles; every facet owns its 3 vertices (faceted look).
class FacetBuilder {
  constructor() { this.pos = []; this.col = []; }
  tri(a, b, c, srgb, toward = null) {
    const ab = new THREE.Vector3().subVectors(b, a), ac = new THREE.Vector3().subVectors(c, a);
    const n = new THREE.Vector3().crossVectors(ab, ac);
    if (n.lengthSq() < 1e-12) return;
    if (toward && n.dot(toward) < 0) [b, c] = [c, b];       // three.js front faces are counter-clockwise
    const lin = toLinear(srgb);
    for (const p of [a, b, c]) { this.pos.push(p.x, p.y, p.z); this.col.push(lin[0], lin[1], lin[2]); }
  }
  get triangles() { return this.pos.length / 9; }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
}

export function facetMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
}

export class World {
  constructor(seed = 1447) {
    this.seed = seed;
    this.noise = makeNoise(seed);
    this.rng = mulberry32(seed);
    this.group = new THREE.Group();
    this.group.name = 'World';
    this.triangles = 0;
    this.material = facetMaterial();
  }

  heightAt(x, z) {
    let h = 0.55 * Math.sin(x * 0.21 + 0.6) * Math.cos(z * 0.17) + 0.9 * this.noise(x * 0.08, z * 0.08);
    if (z > 0) h += 0.04 * z;
    const flat = THREE.MathUtils.clamp((Math.hypot(x, z + 2.0) - 4.0) / 5.0, 0, 1);
    return h * flat * flat;
  }

  build() {
    this._add(this._terrain(), 'Dunes');
    this._add(this._cliff(), 'Escarpment');
    this._add(this._engravings(), 'Engravings');
    for (let i = 0; i < 7; i++) {
      const b = this._boulder(0.35 + this.rng() * 0.75, i);
      const ang = (this.rng() * 2 - 1) * Math.PI, dist = 3.5 + this.rng() * 5.5;
      b.position.set(Math.cos(ang) * dist, -0.1, Math.sin(ang) * dist - 2.0);
      if (Math.abs(b.position.x) < 1.6 && b.position.z > -4.5) b.position.x += 3.0;
      this.group.add(b);
    }
    return this.group;
  }

  _add(fb, name) {
    const m = fb.mesh(this.material);
    m.name = name;
    m.castShadow = name !== 'Dunes';
    m.receiveShadow = true;
    this.group.add(m);
    this.triangles += fb.triangles;
    return m;
  }

  _sand() { return lerp3(PALETTE.sand, PALETTE.sandShade, this.rng() * 0.35); }

  _terrain() {
    const fb = new FacetBuilder(), size = 64, n = 40, step = size / n, up = new THREE.Vector3(0, 1, 0);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x0 = -size / 2 + ix * step, z0 = -size / 2 + iz * step + 6.0;
        if (z0 + step < CLIFF_Z - 1.0) continue;
        const p = [[x0, z0], [x0 + step, z0], [x0, z0 + step], [x0 + step, z0 + step]]
          .map(([x, z]) => new THREE.Vector3(x, this.heightAt(x, z), z));
        fb.tri(p[0], p[2], p[1], this._sand(), up);
        fb.tri(p[1], p[2], p[3], this._sand(), up);
      }
    }
    return fb;
  }

  _cliff() {
    const fb = new FacetBuilder(), nx = 36, ny = 12, w = 48, h = 13, out = new THREE.Vector3(0, 0, 1), grid = [];
    for (let iy = 0; iy <= ny; iy++) {
      const row = [];
      for (let ix = 0; ix <= nx; ix++) {
        const x = -w / 2 + (w * ix) / nx, y = -0.5 + (h * iy) / ny;
        let depth = 1.6 * this.noise(x * 0.14, y * 0.18) + (0.04 * x * x) / 10;
        if (Math.abs(x) < PANEL_HALF_W && y < 6) depth = 0;          // smooth panel for the engravings
        row.push(new THREE.Vector3(x, y, CLIFF_Z + depth - y * 0.08));
      }
      grid.push(row);
    }
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const a = grid[iy][ix], b = grid[iy][ix + 1], c = grid[iy + 1][ix], d = grid[iy + 1][ix + 1];
        const band = lerp3(PALETTE.stone, PALETTE.stoneDark, 0.25 + 0.25 * Math.sin(a.y * 2.1));
        const col = lerp3(band, PALETTE.stoneDark, this.rng() * 0.2);
        fb.tri(a, b, c, col, out);
        fb.tri(b, d, c, col, out);
      }
    }
    return fb;
  }

  _engravings() {
    // Original stylized figures in the manner of rock engravings (not copies of a real panel).
    const figures = [
      [[-3.0, 2.2], 1.0, [[[-0.6, 0], [-0.55, 0.45], [-0.3, 0.6], [-0.05, 0.85], [0.2, 0.6], [0.45, 0.55], [0.6, 0.8], [0.75, 0.95], [0.9, 0.9]],
        [[-0.45, 0.45], [-0.5, 0]], [[0.35, 0.5], [0.35, 0]], [[0.45, 0.5], [0.5, 0]], [[-0.6, 0.45], [-0.75, 0.3]]]],
      [[0.4, 3.4], 0.8, [[[-0.5, 0.4], [0.4, 0.45]], [[-0.4, 0.4], [-0.45, 0]], [[-0.25, 0.4], [-0.2, 0]],
        [[0.2, 0.42], [0.15, 0]], [[0.35, 0.44], [0.4, 0]], [[0.4, 0.45], [0.55, 0.65]], [[0.55, 0.65], [0.45, 0.95], [0.2, 1.1], [-0.05, 1.05]]]],
      [[3.0, 2.0], 1.1, [[[0, 1], [0, 0.35]], [[0, 0.35], [-0.18, 0]], [[0, 0.35], [0.18, 0]],
        [[0, 0.85], [0.3, 1.05], [0.38, 1.3]], [[0, 0.85], [-0.25, 0.6]], [[0.32, 1.32], [0.5, 1.5], [0.62, 1.42]], [[0.38, 1.36], [0.2, 1.52]]]],
    ];
    const fb = new FacetBuilder(), out = new THREE.Vector3(0, 0, 1);
    for (const [[ox, oy], s, lines] of figures) {
      for (const line of lines) {
        for (let i = 0; i < line.length - 1; i++) {
          const a = new THREE.Vector2(ox + line[i][0] * s, oy + line[i][1] * s);
          const b = new THREE.Vector2(ox + line[i + 1][0] * s, oy + line[i + 1][1] * s);
          const dir = b.clone().sub(a).normalize(), nrm = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(0.035);
          const za = CLIFF_Z - a.y * 0.08 + 0.02, zb = CLIFF_Z - b.y * 0.08 + 0.02;
          const p0 = new THREE.Vector3(a.x + nrm.x, a.y + nrm.y, za), p1 = new THREE.Vector3(b.x + nrm.x, b.y + nrm.y, zb);
          const p2 = new THREE.Vector3(b.x - nrm.x, b.y - nrm.y, zb), p3 = new THREE.Vector3(a.x - nrm.x, a.y - nrm.y, za);
          fb.tri(p0, p1, p2, PALETTE.engrave, out);
          fb.tri(p0, p2, p3, PALETTE.engrave, out);
        }
      }
    }
    return fb;
  }

  _boulder(radius, idx) {
    const geo = new THREE.SphereGeometry(radius, 9, 5).toNonIndexed();
    const p = geo.attributes.position, fb = new FacetBuilder();
    const col0 = lerp3(PALETTE.stone, PALETTE.stoneDark, 0.3 + 0.1 * (idx % 3));
    const v = (i) => {
      const x = p.getX(i), y = p.getY(i) * 0.7, z = p.getZ(i);
      const d = 1 + 0.28 * this.noise(x * 4 + idx * 10, z * 4 + y * 3);
      return new THREE.Vector3(x * d, y * d, z * d);
    };
    for (let i = 0; i < p.count; i += 3) {
      const a = v(i), b = v(i + 1), c = v(i + 2);
      const centre = a.clone().add(b).add(c).divideScalar(3);
      fb.tri(a, b, c, lerp3(col0, PALETTE.stoneDark, this.rng() * 0.25), centre);
    }
    geo.dispose();
    const m = fb.mesh(this.material);
    m.name = `Boulder${idx}`;
    m.castShadow = true;
    m.receiveShadow = true;
    m.rotation.y = this.rng() * Math.PI * 2;
    this.triangles += fb.triangles;
    return m;
  }

  perch(x, z, height) {
    // A faceted sandstone pillar; returns the flat top centre.
    const geo = new THREE.CylinderGeometry(0.2, 0.3, height, 7, 3).toNonIndexed();
    const p = geo.attributes.position, fb = new FacetBuilder();
    for (let i = 0; i < p.count; i += 3) {
      const tri = [0, 1, 2].map((k) => {
        let vx = p.getX(i + k), vy = p.getY(i + k), vz = p.getZ(i + k);
        if (vy < height * 0.49) {
          const d = 1 + 0.18 * this.noise(vx * 6 + vy * 3, vz * 6);
          vx *= d; vz *= d;
        }
        return new THREE.Vector3(vx, vy + height / 2, vz);
      });
      const c = tri[0].clone().add(tri[1]).add(tri[2]).divideScalar(3);
      const toward = Math.abs(c.y - height) < 0.01 ? new THREE.Vector3(0, 1, 0) : (c.y < 0.01 ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(c.x, 0, c.z));
      fb.tri(tri[0], tri[1], tri[2], lerp3(PALETTE.stone, PALETTE.stoneDark, 0.2 + 0.2 * Math.sin(c.y * 9)), toward);
    }
    geo.dispose();
    const m = fb.mesh(this.material);
    m.name = 'Perch';
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(x, this.heightAt(x, z), z);
    this.group.add(m);
    this.triangles += fb.triangles;
    return new THREE.Vector3(x, m.position.y + height, z);
  }
}

// Sky dome with a dawn gradient (top violet-blue, warm horizon) and the low sun.
export function addSkyAndLight(scene) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0.35, 0.40, 0.62) }, horizon: { value: new THREE.Color(0.98, 0.72, 0.52) },
        ground: { value: new THREE.Color(0.86, 0.60, 0.46) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, ground, min(1.0, -h * 4.0)); gl_FragColor = vec4(c, 1.0); }',
    }));
  sky.name = 'Sky';
  scene.add(sky);
  scene.fog = new THREE.FogExp2(new THREE.Color(0.92, 0.78, 0.70), 0.0125);
  // Cool violet fill for the shade side (the "Naqsh" palette keeps shadows violet).
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.62, 0.60, 0.80), new THREE.Color(0.55, 0.42, 0.40), 0.9));
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.86, 0.70), 2.6);
  sun.name = 'Sun';
  sun.position.set(24, 6.3, 3);          // ~14 degrees high, from the right: grazes the cliff face
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  const s = sun.shadow.camera;
  s.left = -16; s.right = 16; s.top = 14; s.bottom = -6; s.near = 1; s.far = 60;
  scene.add(sun);
  scene.add(sun.target);
  return sun;
}
