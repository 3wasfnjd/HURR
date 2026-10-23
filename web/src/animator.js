// Plays the motion-captured clips (CMU mocap retargeted onto the HURR skeleton) with crossfades,
// plus a simple override layer (e.g. Najd raising her gloved fist to call the falcon).
import * as THREE from 'three';

const ONCE = new Set(['climb', 'kneel', 'call', 'stumble', 'cower']);

export class Animator {
  constructor(root, clips) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = Object.fromEntries(clips.map((c) => [c.name, c]));
    this.actions = {};
    for (const c of clips) {
      const a = this.mixer.clipAction(c);
      if (ONCE.has(c.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[c.name] = a;
    }
    this.current = null;
    this.bones = {};
    root.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.layerCache = {};
  }

  bone(name) { return this.bones[name]; }
  duration(name) { return this.clips[name].duration; }

  // Crossfade to a clip; restart forces a one-shot clip to begin again.
  play(name, fade = 0.25, timeScale = 1, restart = false) {
    const next = this.actions[name];
    if (!next) return;
    next.timeScale = timeScale;
    if (this.current === next && !restart) return;
    next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1).play();
    if (this.current && this.current !== next) {
      // keep footfalls in phase between walk and run
      if ((name === 'walk' || name === 'run') && (this.current.getClip().name === 'walk' || this.current.getClip().name === 'run')) {
        const c = this.current; next.time = (c.time / c.getClip().duration) * next.getClip().duration;
      }
      this.current.crossFadeTo(next, fade, false);
    }
    this.current = next;
  }

  update(dt) { this.mixer.update(dt); }

  // Blend the listed bones toward the pose of `clip` at time t (after the mixer has run).
  layer(clip, boneNames, t, weight) {
    if (weight <= 0.001) return;
    const key = `${clip}@${t}`;
    if (!this.layerCache[key]) {
      const pose = {};
      for (const tr of this.clips[clip].tracks) {
        const [bn, prop] = tr.name.split('.');
        if (prop !== 'quaternion' || !boneNames.includes(bn)) continue;
        const v = tr.createInterpolant().evaluate(t);
        pose[bn] = new THREE.Quaternion(v[0], v[1], v[2], v[3]);
      }
      this.layerCache[key] = pose;
    }
    const pose = this.layerCache[key], w = Math.min(1, weight * 1.4);
    for (const bn of boneNames) if (pose[bn]) this.bones[bn].quaternion.slerp(pose[bn], w);
  }
}
