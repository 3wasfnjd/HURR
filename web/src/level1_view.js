// Level 1 slice — builds the faceted scene from level1_data.js (the "Naqsh" art direction:
// chiselled sandstone, warm sand, violet shade, low dawn sun).
import * as THREE from 'three';
import * as L from './level1_data.js';
import { mulberry32, makeNoise } from './rand.js';

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toLinear = (c) => c.map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
const PAL = {
  sand: [0.86, 0.66, 0.50], sandShade: [0.78, 0.56, 0.45], gravel: [0.70, 0.52, 0.42],
  stone: [0.80, 0.58, 0.48], stoneDark: [0.58, 0.39, 0.36], strata: [0.90, 0.70, 0.56],
  mud: [0.74, 0.55, 0.40], mudDark: [0.58, 0.42, 0.31], door: [0.24, 0.16, 0.12],
  olive: [0.47, 0.52, 0.38], oliveDark: [0.36, 0.41, 0.30], bark: [0.42, 0.34, 0.28],
  acacia: [0.42, 0.46, 0.27], acaciaDark: [0.32, 0.36, 0.21], wood: [0.55, 0.40, 0.26],
};

export class FacetBuilder {
  constructor() { this.pos = []; this.col = []; }
  tri(a, b, c, srgb, toward = null) {
    const ab = new THREE.Vector3().subVectors(b, a), ac = new THREE.Vector3().subVectors(c, a);
    const n = new THREE.Vector3().crossVectors(ab, ac);
    if (n.lengthSq() < 1e-14) return;
    if (toward && n.dot(toward) < 0) [b, c] = [c, b];
    const lin = toLinear(srgb);
    for (const p of [a, b, c]) { this.pos.push(p.x, p.y, p.z); this.col.push(lin[0], lin[1], lin[2]); }
  }
  quad(a, b, c, d, col, toward) { this.tri(a, b, c, col, toward); this.tri(a, c, d, col, toward); }
  get triangles() { return this.pos.length / 9; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export function facetMaterial(opts = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, ...opts });
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildLevel(scene) {
  const rng = mulberry32(2026), noise = makeNoise(77);
  const mat = facetMaterial();
  const group = new THREE.Group();
  group.name = 'Level1';
  let tris = 0;
  const add = (fb, name, cast = true) => {
    const m = new THREE.Mesh(fb.geometry(), mat);
    m.name = name; m.castShadow = cast; m.receiveShadow = true;
    group.add(m); tris += fb.triangles;
    return m;
  };

  // ---------------- terrain (ledge edges get duplicated sample lines -> crisp vertical faces)
  {
    const fb = new FacetBuilder(), up = V(0, 1, 0);
    const xs = [], zs = [];
    for (let x = -18; x <= 18.001; x += 0.8) xs.push(x);
    for (let z = 20; z >= -84; z -= 0.8) zs.push(z);
    for (const Lg of L.LEDGES) for (const e of [Lg.z0, Lg.z1]) if (e > -84) zs.push(e + 0.004, e - 0.004);
    zs.sort((a, b) => b - a);
    const H = zs.map((z) => xs.map((x) => L.heightAt(x, z)));
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < xs.length - 1; i++) {
        const p = [V(xs[i], H[j][i], zs[j]), V(xs[i + 1], H[j][i + 1], zs[j]), V(xs[i], H[j + 1][i], zs[j + 1]), V(xs[i + 1], H[j + 1][i + 1], zs[j + 1])];
        const dz = Math.abs(zs[j] - zs[j + 1]);
        for (const t of [[0, 2, 1], [1, 2, 3]]) {
          const a = p[t[0]], b = p[t[1]], c = p[t[2]];
          const ys = [a.y, b.y, c.y], rise = Math.max(...ys) - Math.min(...ys);
          const span = Math.max(0.01, Math.min(dz, 0.8));
          const steep = rise / span;
          const cy = (a.y + b.y + c.y) / 3;
          let col;
          if (steep > 1.2) {
            const band = 0.5 + 0.5 * Math.sin(cy * 3.1 + noise(a.x * 0.2, a.z * 0.2) * 1.5);
            col = lerp3(lerp3(PAL.stone, PAL.strata, band * 0.6), PAL.stoneDark, rng() * 0.22 + (cy < 1 ? 0.1 : 0));
          } else if (steep > 0.55) col = lerp3(PAL.gravel, PAL.stone, rng() * 0.5);
          else col = lerp3(PAL.sand, PAL.sandShade, rng() * 0.35 + (cy < 0.6 ? 0.15 : 0));
          // vertical ledge faces: face them outward (+z for a front face)
          const toward = dz < 0.05 ? V(0, 0, a.z > -40 ? (H[j][i] > H[j + 1][i] ? -1 : 1) : (H[j][i] > H[j + 1][i] ? -1 : 1)) : up;
          if (dz < 0.05) fb.tri(a, b, c, col, H[j][i] < H[j + 1][i] ? V(0, 0, 1) : V(0, 0, -1));
          else fb.tri(a, b, c, col, toward);
        }
      }
    }
    add(fb, 'Terrain', false);
  }

  // ---------------- boulders, cairn
  const boulder = (cx, cz, r, h, seed) => {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position, fb = new FacetBuilder();
    const g0 = L.baseHeight(cx, cz) - 0.15;
    const col0 = lerp3(PAL.stone, PAL.stoneDark, 0.2 + (seed % 3) * 0.1);
    const v = (i) => {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const d = 1 + 0.22 * noise(x * 2.5 + seed * 3, z * 2.5 + y * 2);
      return V(cx + x * r * d, g0 + Math.max(-0.2, (y * 0.5 + 0.5)) * h * d, cz + z * r * d);
    };
    for (let i = 0; i < p.count; i += 3) {
      const a = v(i), b = v(i + 1), c = v(i + 2), centre = V(cx, g0 + h * 0.4, cz);
      const mid = a.clone().add(b).add(c).divideScalar(3);
      const band = 0.5 + 0.5 * Math.sin(mid.y * 4.0);
      fb.tri(a, b, c, lerp3(lerp3(col0, PAL.strata, band * 0.35), PAL.stoneDark, rng() * 0.25), mid.sub(centre));
    }
    geo.dispose();
    return fb;
  };
  {
    const fb = new FacetBuilder();
    let k = 0;
    for (const c of L.CIRCLES) if (c.kind === 'boulder') { const b = boulder(c.x, c.z, c.r * 1.02, c.h, k++); fb.pos.push(...b.pos); fb.col.push(...b.col); }
    // small scatter along the terrace face and the exit face (handholds read as climbable rock)
    for (let i = 0; i < 14; i++) {
      const onExit = i >= 7, x = -6 + rng() * 12, z = onExit ? -56.7 : -22.7;
      const b = boulder(x, z + rng() * 0.3, 0.25 + rng() * 0.25, 0.3 + rng() * 0.4, 20 + i);
      fb.pos.push(...b.pos); fb.col.push(...b.col);
    }
    // cairn: stacked stones
    for (let i = 0; i < 6; i++) {
      const r = 0.55 - i * 0.07, b = boulder(L.CAIRN.x + (rng() - 0.5) * 0.1, L.CAIRN.z + (rng() - 0.5) * 0.1, r, 0.3, 40 + i);
      for (let q = 1; q < b.pos.length; q += 3) b.pos[q] += 2.4 - L.baseHeight(L.CAIRN.x, L.CAIRN.z) + 0.15 + i * 0.22;
      fb.pos.push(...b.pos); fb.col.push(...b.col);
    }
    add(fb, 'Rocks');
  }

  // ---------------- houses (mud brick, crenellated parapets, dark doors, small vents)
  {
    const fb = new FacetBuilder();
    for (const Hs of L.HOUSES) {
      const g = Math.min(L.baseHeight(Hs.x0, Hs.z0), L.baseHeight(Hs.x1, Hs.z1)) - 0.2;
      const top = g + 0.2 + Hs.h;
      const c = [V(Hs.x0, g, Hs.z0), V(Hs.x1, g, Hs.z0), V(Hs.x1, g, Hs.z1), V(Hs.x0, g, Hs.z1)];
      const t = c.map((p) => V(p.x, top, p.z));
      const centre = V((Hs.x0 + Hs.x1) / 2, (g + top) / 2, (Hs.z0 + Hs.z1) / 2);
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4], ta = t[i], tb = t[(i + 1) % 4];
        const out = a.clone().add(b).multiplyScalar(0.5).sub(centre).setY(0);
        // wall split into vertical strips so the facets catch light unevenly (hand-plastered)
        const n = Math.max(2, Math.round(a.distanceTo(b) / 0.9));
        for (let s = 0; s < n; s++) {
          const u0 = s / n, u1 = (s + 1) / n, j = (rng() - 0.5) * 0.05;
          const p0 = a.clone().lerp(b, u0), p1 = a.clone().lerp(b, u1);
          fb.quad(p0, p1, V(p1.x, top + j, p1.z), V(p0.x, top - j, p0.z), lerp3(PAL.mud, PAL.mudDark, rng() * 0.3), out);
        }
        // parapet teeth
        const m = Math.round(a.distanceTo(b) / 0.6);
        for (let s = 0; s < m; s += 2) {
          const p0 = ta.clone().lerp(tb, s / m), p1 = ta.clone().lerp(tb, (s + 1) / m), apex = p0.clone().lerp(p1, 0.5).setY(top + 0.35);
          fb.tri(p0, p1, apex, PAL.mud, out);
        }
        // door on the side facing the trail (+z faces = toward -z? the wadi lies at -z)
        if (out.z < -0.1) {
          const dm = a.clone().lerp(b, 0.35 + rng() * 0.3), dirv = b.clone().sub(a).normalize();
          const o = out.clone().normalize().multiplyScalar(0.02);
          const d0 = dm.clone().addScaledVector(dirv, -0.45).add(o), d1 = dm.clone().addScaledVector(dirv, 0.45).add(o);
          fb.quad(V(d0.x, g + 0.2, d0.z), V(d1.x, g + 0.2, d1.z), V(d1.x, g + 2.0, d1.z), V(d0.x, g + 2.0, d0.z), PAL.door, out);
          for (const vx of [-1.2, 1.2]) {     // triangular vents, a common mud-house detail
            const vm = dm.clone().addScaledVector(dirv, vx).add(o);
            fb.tri(V(vm.x - dirv.x * 0.15, top - 0.6, vm.z - dirv.z * 0.15), V(vm.x + dirv.x * 0.15, top - 0.6, vm.z + dirv.z * 0.15), V(vm.x, top - 0.32, vm.z), PAL.door, out);
          }
        }
      }
      fb.quad(t[0], t[1], t[2], t[3], lerp3(PAL.mud, PAL.mudDark, 0.4), V(0, 1, 0));
    }
    add(fb, 'Houses');
  }

  // ---------------- trees
  const blob = (fb, cx, cy, cz, rx, ry, rz, c0, c1, seed) => {
    const geo = new THREE.IcosahedronGeometry(1, 1), p = geo.attributes.position, centre = V(cx, cy, cz);
    for (let i = 0; i < p.count; i += 3) {
      const q = [0, 1, 2].map((k) => {
        const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k), d = 1 + 0.25 * noise(x * 3 + seed, z * 3 + y * 3);
        return V(cx + x * rx * d, cy + y * ry * d, cz + z * rz * d);
      });
      fb.tri(q[0], q[1], q[2], lerp3(c0, c1, rng()), q[0].clone().add(q[1]).add(q[2]).divideScalar(3).sub(centre));
    }
    geo.dispose();
  };
  const trunk = (fb, a, b, r0, r1, col) => {
    const geo = new THREE.CylinderGeometry(r1, r0, a.distanceTo(b), 6, 1, true).toNonIndexed();
    geo.translate(0, a.distanceTo(b) / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    geo.applyQuaternion(q); geo.translate(a.x, a.y, a.z);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const t = [0, 1, 2].map((k) => V(p.getX(i + k), p.getY(i + k), p.getZ(i + k)));
      const mid = t[0].clone().add(t[1]).add(t[2]).divideScalar(3);
      const axisP = a.clone().add(b.clone().sub(a).multiplyScalar(Math.max(0, Math.min(1, mid.clone().sub(a).dot(b.clone().sub(a)) / a.distanceToSquared(b)))));
      fb.tri(t[0], t[1], t[2], lerp3(col, PAL.stoneDark, rng() * 0.2), mid.sub(axisP));
    }
    geo.dispose();
  };
  {
    const fb = new FacetBuilder();
    for (const c of L.CIRCLES) {
      if (c.kind === 'olive') {
        const g = L.baseHeight(c.x, c.z);
        trunk(fb, V(c.x, g - 0.1, c.z), V(c.x + 0.25, g + 1.3, c.z - 0.1), 0.28, 0.16, PAL.bark);
        trunk(fb, V(c.x + 0.2, g + 1.1, c.z), V(c.x - 0.4, g + 1.9, c.z + 0.2), 0.12, 0.07, PAL.bark);
        for (let i = 0; i < 4; i++) {
          const a = i * 1.7 + c.x;
          blob(fb, c.x + Math.cos(a) * 0.7, g + 2.0 + rng() * 0.6, c.z + Math.sin(a) * 0.7, 0.9, 0.6, 0.9, PAL.olive, PAL.oliveDark, i + c.x * 10);
        }
      }
      if (c.kind === 'acacia') {
        const g = L.heightAt(c.x, c.z);
        trunk(fb, V(c.x, g - 0.1, c.z), V(c.x - 0.2, g + 1.6, c.z + 0.1), 0.22, 0.14, PAL.bark);
        trunk(fb, V(c.x - 0.2, g + 1.5, c.z + 0.1), V(c.x - 1.2, g + 2.6, c.z + 0.9), 0.1, 0.06, PAL.bark);   // the branch the net hangs from
        trunk(fb, V(c.x - 0.2, g + 1.5, c.z + 0.1), V(c.x + 0.9, g + 2.8, c.z - 0.6), 0.1, 0.06, PAL.bark);
        blob(fb, c.x - 0.3, g + 3.0, c.z + 0.1, 2.1, 0.4, 1.9, PAL.acacia, PAL.acaciaDark, 5);              // flat umbrella crown
        blob(fb, c.x + 0.6, g + 2.85, c.z - 0.5, 1.1, 0.28, 1.0, PAL.acacia, PAL.acaciaDark, 9);
      }
    }
    add(fb, 'Trees');
  }

  // ---------------- low desert shrubs and pebbles (break up the floor, never block movement)
  {
    const fb = new FacetBuilder(), r2 = mulberry32(99);
    let placed = 0;
    for (let i = 0; i < 400 && placed < 70; i++) {
      const x = (r2() * 2 - 1) * 9, z = 12 - r2() * 76;
      if (Math.abs(x) > L.canyonHalfWidth(z) - 0.6) continue;
      if (Math.abs(x) < 1.6 && z < -20 && z > -60) continue;                 // keep the main line readable
      if (L.CIRCLES.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 0.8)) continue;
      if (L.HOUSES.some((H) => x > H.x0 - 0.6 && x < H.x1 + 0.6 && z > H.z0 - 0.6 && z < H.z1 + 0.6)) continue;
      const g = L.heightAt(x, z);
      if (Math.abs(L.heightAt(x + 0.4, z) - g) > 0.2 || Math.abs(L.heightAt(x, z + 0.4) - g) > 0.2) continue;   // not on a ledge lip
      const s = 0.18 + r2() * 0.3;
      if (r2() < 0.65) blob(fb, x, g + s * 0.35, z, s, s * 0.7, s, [0.55, 0.52, 0.36], [0.45, 0.38, 0.27], i);
      else blob(fb, x, g + s * 0.1, z, s * 0.6, s * 0.35, s * 0.5, PAL.stone, PAL.stoneDark, i);
      placed++;
    }
    add(fb, 'Shrubs');
  }

  scene.add(group);
  return { group, triangles: () => tris };
}

// ---------------- the net (a draped mesh of cords between the acacia branch and two stakes)
export function buildNet() {
  const g = L.heightAt(L.NET.x, L.NET.z);
  const top = [V(L.NET.x - 0.7, g + 2.1, L.NET.z - 0.5), V(L.NET.x + 0.8, g + 2.0, L.NET.z - 0.9)];
  const bot = [V(L.NET.x - 0.8, g + 0.02, L.NET.z + 0.45), V(L.NET.x + 0.9, g + 0.02, L.NET.z + 0.05)];
  const N = 9, pts = [];
  for (let i = 0; i <= N; i++) {
    const row = [];
    for (let j = 0; j <= N; j++) {
      const u = j / N, v = i / N;
      const a = top[0].clone().lerp(top[1], u), b = bot[0].clone().lerp(bot[1], u);
      const p = a.clone().lerp(b, v);
      p.z -= Math.sin(Math.PI * v) * 0.45 * Math.sin(Math.PI * u); p.y -= Math.sin(Math.PI * v) * 0.15;      // belly where the bird pushed in
      row.push(p);
    }
    pts.push(row);
  }
  const seg = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    if (j < N) seg.push(pts[i][j], pts[i][j + 1]);
    if (i < N) seg.push(pts[i][j], pts[i + 1][j]);
  }
  const geo = new THREE.BufferGeometry().setFromPoints(seg);
  const net = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x3a2a22 }));
  net.name = 'Net';
  return net;
}

// ---------------- a wooden cage the men carry
export function buildCage() {
  const fb = new FacetBuilder();
  const bar = (a, b, w) => {
    const d = b.clone().sub(a), len = d.length();
    const geo = new THREE.BoxGeometry(w, len, w).toNonIndexed();
    geo.translate(0, len / 2, 0);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
    geo.translate(a.x, a.y, a.z);
    const p = geo.attributes.position;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    for (let i = 0; i < p.count; i += 3) {
      const t = [0, 1, 2].map((k) => V(p.getX(i + k), p.getY(i + k), p.getZ(i + k)));
      fb.tri(t[0], t[1], t[2], PAL.wood, t[0].clone().add(t[1]).add(t[2]).divideScalar(3).sub(mid));
    }
    geo.dispose();
  };
  const w = 0.2, h = 0.34, d = 0.2;
  for (const x of [-w, w]) for (const z of [-d, d]) bar(V(x, 0, z), V(x, h, z), 0.025);
  for (const y of [0, h]) {
    bar(V(-w, y, -d), V(w, y, -d), 0.025); bar(V(-w, y, d), V(w, y, d), 0.025);
    bar(V(-w, y, -d), V(-w, y, d), 0.025); bar(V(w, y, -d), V(w, y, d), 0.025);
  }
  for (const x of [-0.1, 0, 0.1]) { bar(V(x, 0, -d), V(x, h, -d), 0.012); bar(V(x, 0, d), V(x, h, d), 0.012); }
  bar(V(0, h, 0), V(0, h + 0.1, 0), 0.02);
  const m = new THREE.Mesh(fb.geometry(), facetMaterial());
  m.castShadow = true;
  m.name = 'Cage';
  return m;
}

// ---------------- procedural wings for the saker (the scanned body has folded wings only)
export function buildWings() {
  const make = (side) => {
    const fb = new FacetBuilder();
    // inner arm, outer hand with primaries, as a fan of facets; span ~0.5 m per wing
    const pts = [V(0, 0, 0.04), V(side * 0.16, 0.01, 0.07), V(side * 0.34, 0.0, 0.03), V(side * 0.5, -0.01, -0.06),
      V(side * 0.44, 0, -0.14), V(side * 0.3, 0, -0.16), V(side * 0.14, 0, -0.13), V(0, 0, -0.09)];
    const cols = [[0.47, 0.34, 0.24], [0.40, 0.29, 0.21], [0.30, 0.22, 0.17]];
    const c = V(side * 0.14, 0, -0.04);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      fb.tri(c, a, b, cols[i % 3], V(0, 1, 0));
      fb.tri(c, b, a, lerp3(cols[i % 3], [0.75, 0.65, 0.55], 0.4), V(0, -1, 0));   // paler underwing
    }
    const m = new THREE.Mesh(fb.geometry(), facetMaterial());
    m.castShadow = true;
    return m;
  };
  return { L: make(1), R: make(-1) };
}
