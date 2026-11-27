import { mix, packRGB, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { INK } from '../core/render-common';
import { clamp, hash2, mulberry32, noise2 } from '../core/math';
import { directionAngle, scenePrefs } from './prefs';
import { BaseScene, type Env } from './types';

interface Bird { x: number; y: number; vx: number; vy: number; k: number }

/**
 * A starling murmuration: hundreds of birds pulled toward drifting attractors
 * through a swirling flow field, so the flock folds, splits and merges.
 */
export class StarlingsScene extends BaseScene {
  readonly id = 'starlings' as const;
  skyInk = 0.4;
  private flock: Bird[] = [];
  private reeds = new Int16Array(0);
  private night = 0;
  private drift = 0;

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    this.sky = true;
    this.birds = false;
    this.horizonRow = Math.round(rows * 0.86);
    const r = mulberry32(55);
    const n = Math.round(Math.min(1400, (cols * rows) / 28) / Math.max(0.6, scenePrefs.animalSize));
    this.flock = Array.from({ length: n }, () => ({
      x: cols * (0.35 + r() * 0.3),
      y: rows * (0.3 + r() * 0.25),
      vx: 0,
      vy: 0,
      k: r(),
    }));
    this.reeds = new Int16Array(cols);
    for (let x = 0; x < cols; x++) {
      const h = noise2(x * 0.08, 1, 3) * rows * 0.06 + (hash2(x, 3) < 0.25 ? hash2(x, 9) * rows * 0.05 : 0);
      this.reeds[x] = Math.round(this.horizonRow - h);
    }
    this.surfaces = [];
  }

  stops(env: Env): Array<[number, RGB]> {
    this.night = clamp((env.pal.lights - 0.45) / 0.45);
    this.skyInk = 0.35 + 0.65 * this.night;
    return super.stops(env).map(([o, c]) => [o, mix(c, INK, this.night * 0.8)]);
  }

  draw(g: Grid, env: Env): void {
    const { t, dt, w } = env;
    const a = env.aspect;
    const { cols, rows } = this;
    const size = scenePrefs.animalSize;
    const dir = directionAngle(scenePrefs.animalDirection);
    // Directional mode drifts the whole flock across and wraps it around.
    if (dir !== null) this.drift += dt * 4;
    const ox = dir === null ? 0 : Math.cos(dir) * this.drift;
    const oy = dir === null ? 0 : (Math.sin(dir) * this.drift) / a;
    const wrapX = (x: number) => ((x % cols) + cols) % cols;
    const wrapY = (y: number) => ((y % (rows * 0.8)) + rows * 0.8) % (rows * 0.8);
    // Two attractors wander on slow Lissajous paths; birds split between them.
    const att = [0, 1].map((i) => {
      const px = cols * (0.5 + 0.3 * Math.sin(t * (0.07 + i * 0.03) + i * 2)) + ox;
      const py = rows * (0.38 + 0.18 * Math.sin(t * (0.11 + i * 0.02) + i)) + oy;
      return dir === null ? [px, py] : [wrapX(px), wrapY(py)];
    });
    const split = 0.5 + 0.5 * Math.sin(t * 0.05);
    for (const b of this.flock) {
      const [tx, ty] = b.k < split ? att[0] : att[1];
      let dx = tx - b.x;
      let dy = (ty - b.y) * a;
      if (dir !== null) {
        if (Math.abs(dx) > cols / 2) dx -= Math.sign(dx) * cols;
      }
      const d = Math.hypot(dx, dy) + 1;
      // Strong cohesion toward the attractor plus a broad, shared swirl, so the
      // flock stays dense and folds as one body.
      const n = noise2(b.x * 0.012 + t * 0.07, b.y * 0.02 - t * 0.05, 8) * Math.PI * 4;
      const pull = 42 * clamp(d / 26, 0.1, 1.4);
      const ax = (dx / d) * pull + Math.cos(n) * 20 + w.wind * 6;
      const ay = (dy / d) * pull + Math.sin(n) * 20;
      b.vx += ax * dt;
      b.vy += ay * dt;
      b.vx *= Math.exp(-dt * 0.6);
      b.vy *= Math.exp(-dt * 0.6);
      const sp = Math.hypot(b.vx, b.vy);
      const max = 30 * Math.sqrt(size);
      if (sp > max) {
        b.vx *= max / sp;
        b.vy *= max / sp;
      }
      b.x += b.vx * dt;
      b.y += (b.vy * dt) / a;
      if (dir !== null) b.x = wrapX(b.x);
    }
    // Dark solid birds against the day sky, silver flecks at night.
    const night = this.night;
    const dayBird = packRGB(16, 18, 26);
    const silver = packRGB(200, 212, 240);
    for (const b of this.flock) {
      if (night < 0.5) g.blank(b.x, b.y, dayBird);
      else {
        const ch = Math.abs(b.vx) > Math.abs(b.vy) * 2 ? '-' : b.vx * b.vy > 0 ? '\\' : '/';
        g.set(b.x, b.y, ch, silver);
      }
    }
    // Reed bed along the bottom, swaying.
    for (let x = 0; x < cols; x++) {
      const sway = Math.round(Math.sin(t * 0.9 + x * 0.15) * (0.6 + Math.abs(w.wind)));
      for (let y = this.reeds[x]; y < rows; y++) {
        const top = y - this.reeds[x] < 2;
        g.put(x + (top ? sway : 0), y, top ? (hash2(x, y) < 0.5 ? '|' : '/') : ' ', packRGB(30, 34, 28), 0);
      }
    }
  }
}
