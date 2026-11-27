import { mix, packRGB, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { clamp, mulberry32, noise2 } from '../core/math';
import { AbyssScene, Specks } from './ink';
import { directionAngle, scenePrefs } from './prefs';
import type { Env } from './types';

interface Whale {
  pts: Array<[number, number]>;
  a: number;
  v: number;
  R: number;
  phase: number;
  seed: number;
  depth: number;
}

interface Bubble { x: number; y: number; age: number }

const BACK: RGB = [58, 76, 112];
const BELLY: RGB = [196, 210, 228];
const GLOW: RGB = [110, 200, 255];

/** Humpback whales drifting through the deep, trailing glowing plankton. */
export class WhalesScene extends AbyssScene {
  readonly id = 'whales' as const;
  private whales: Whale[] = [];
  private bubbles: Bubble[] = [];
  private snow = new Specks();
  private aspect = 1.2;

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const r = mulberry32(2024);
    const size = scenePrefs.animalSize;
    const n = Math.max(1, Math.min(4, Math.round((cols * rows) / (14000 * size * size))));
    this.whales = Array.from({ length: n }, (_, i) => {
      const len = Math.round((52 + r() * 18) * size * (i === 0 ? 1.15 : 1));
      const a = r() < 0.5 ? 0 : Math.PI;
      const x = r() * cols;
      // Spread whales into their own depth bands so they don't overlap.
      const y = rows * (0.18 + (0.64 * (i + 0.5)) / n + (r() - 0.5) * 0.08);
      return {
        pts: Array.from({ length: len }, (_, k) => [x - Math.cos(a) * k, y] as [number, number]),
        a,
        v: (3 + r() * 1.5) * Math.sqrt(size),
        R: len * 0.14,
        phase: r() * 6,
        seed: Math.floor(r() * 1000),
        depth: r() * 0.4,
      };
    });
    this.whales.sort((p, q) => q.depth - p.depth);
    this.bubbles = [];
    this.snow.place(cols, rows, Math.round((cols * rows) / 140), 12);
  }

  draw(g: Grid, env: Env): void {
    this.prep(env);
    this.aspect = env.aspect;
    const { t, dt } = env;
    this.snow.draw(g, env, [70, 110, 160], 0.3, 0.6);
    const dir = directionAngle(scenePrefs.animalDirection);
    for (const w of this.whales) {
      this.steer(w, t, dt, dir);
      this.splat(w);
      if (Math.random() < dt * 0.6) {
        const [hx, hy] = w.pts[2];
        this.bubbles.push({ x: hx, y: hy - (w.R * 0.6) / this.aspect, age: 0 });
      }
    }
    this.field.resolve(g, t, dt, { glow: 0.05, sparkle: 0.05 });
    for (const w of this.whales) this.eye(g, w);
    for (const b of this.bubbles) {
      b.age += dt;
      b.y -= dt * 3;
      b.x += Math.sin(b.age * 3 + b.y) * dt;
      const k = 1 - b.age / 4;
      if (k > 0) g.set(b.x, b.y, b.age < 1 ? 'o' : '°', packRGB(150 * k, 200 * k, 255 * k));
    }
    this.bubbles = this.bubbles.filter((b) => b.age < 4);
  }

  private steer(w: Whale, t: number, dt: number, dir: number | null): void {
    const a = this.aspect;
    // Mostly horizontal travel with gentle rises and dives.
    const base = dir ?? (Math.cos(w.a) >= 0 ? 0 : Math.PI);
    const want = base + (noise2(t * 0.05, w.seed, 3) - 0.5) * (dir === null ? 0.7 : 0.5);
    let da = want - w.a;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    w.a += clamp(da, -0.25 * dt, 0.25 * dt);
    w.phase += dt * 1.1;
    const [hx, hy] = w.pts[0];
    let nx = hx + Math.cos(w.a) * w.v * dt;
    let ny = hy + (Math.sin(w.a) * w.v * dt) / a;
    // Keep within the band of the screen vertically.
    if (ny < this.rows * 0.12 && Math.sin(w.a) < 0) w.a += 0.4 * dt;
    if (ny > this.rows * 0.88 && Math.sin(w.a) > 0) w.a -= 0.4 * dt;
    // Swim off one side, come back on the other.
    const L = w.pts.length + 4;
    let shift = 0;
    if (nx > this.cols + L && Math.cos(w.a) > 0) shift = -(this.cols + 2 * L);
    if (nx < -L && Math.cos(w.a) < 0) shift = this.cols + 2 * L;
    if (shift) {
      w.pts = w.pts.map(([x, y]) => [x + shift, y]);
      nx += shift;
    }
    if (dir !== null && (ny < -L / a || ny > this.rows + L / a)) {
      const dy = ny < 0 ? this.rows + L / a : -(this.rows + L / a);
      w.pts = w.pts.map(([x, y]) => [x, y + dy]);
      ny += dy;
    }
    w.pts[0] = [nx, ny];
    for (let i = 1; i < w.pts.length; i++) {
      const [px, py] = w.pts[i - 1];
      const [sx, sy] = w.pts[i];
      const ex = sx - px;
      const ey = (sy - py) * a;
      const len = Math.hypot(ex, ey) || 1;
      if (len > 1) w.pts[i] = [px + ex / len, py + ey / len / a];
    }
  }

  /** Side view: dark back, pale grooved belly, long white flippers, flukes. */
  private splat(w: Whale): void {
    const a = this.aspect;
    const F = this.field;
    const n = w.pts.length;
    const dim = 1 - w.depth * 0.5;
    let tail: [number, number, number] = [0, 0, 0];
    let fin: [number, number, number] = [0, 0, 0];
    for (let i = n - 1; i >= 0; i -= 2) {
      const s = i / (n - 1);
      const [x, y] = w.pts[i];
      const [qx, qy] = w.pts[Math.max(0, i - 1)];
      const [rx, ry] = w.pts[Math.min(n - 1, i + 1)];
      const ang = Math.atan2((qy - ry) * a, qx - rx || 1e-6);
      const ly = Math.cos(ang);
      // Up-and-down fluke stroke travels along the body.
      const sway = Math.sin(w.phase - s * 4) * Math.pow(s, 2) * w.R * 0.8;
      const px = x - Math.sin(ang) * sway;
      const py = y + (Math.cos(ang) * sway) / a;
      const prof = s < 0.12 ? 0.65 + s * 2.9 : s < 0.35 ? 1 : Math.max(0.1, 1 - Math.pow((s - 0.35) / 0.62, 1.4));
      const r = w.R * prof;
      F.oval(px, py, ang, Math.max(1.2, r * 1.2), Math.max(0.6, r), 1.3, (_u, v) => {
        const belly = v * ly > 0.15;
        const groove = belly && s < 0.42 && Math.abs(Math.sin(v * 14)) > 0.8;
        const c = belly ? (groove ? mix(BELLY, BACK, 0.45) : BELLY) : mix(BACK, [30, 40, 66], clamp(-v * ly));
        const spot = !belly && noise2(s * 30, v * 4, w.seed) > 0.78;
        const base = spot ? mix(c, BELLY, 0.5) : c;
        return [base[0] * dim, base[1] * dim, base[2] * dim];
      });
      if (i >= n - 2) tail = [px, py, ang];
      if (Math.abs(i - Math.round(n * 0.27)) <= 1) fin = [px, py, ang];
    }
    // Flukes: a wide tail seen edge-on, bending with the stroke.
    const [tx, ty, ta] = tail;
    const stroke = Math.cos(w.phase - 4) * 0.5;
    for (const side of [-1, 1]) {
      const ang = ta + Math.PI + side * 1.25 + stroke * 0.4;
      const len = w.R * 1.6;
      F.oval(tx + (Math.cos(ang) * len) / 2, ty + (Math.sin(ang) * len) / 2 / a, ang, len / 2, w.R * 0.22, 1.1, mix(BACK, [20, 30, 50], 0.3));
    }
    // Long pectoral flipper, belly side, slowly paddling.
    const [fx, fy, fa] = fin;
    const down = Math.cos(fa) >= 0 ? 1 : -1;
    // Points down and back from the belly side, gently paddling.
    const ang = fa + down * (Math.PI - 0.65 + Math.sin(w.phase * 0.7) * 0.15);
    const flen = w.R * 2.6;
    const ox = fx - Math.sin(fa) * down * w.R * 0.6;
    const oy = fy + (Math.cos(fa) * down * w.R * 0.6) / a;
    F.oval(ox + (Math.cos(ang) * flen) / 2, oy + (Math.sin(ang) * flen) / 2 / a, ang, flen / 2, w.R * 0.3, 1.5, mix(BELLY, [255, 255, 255], 0.2));
    // Bioluminescent plankton swirling in the wake.
    for (let k = 0; k < 6; k++) {
      const [x, y] = w.pts[Math.min(n - 1, n - 1 - Math.floor(Math.random() * n * 0.4))];
      F.add(Math.round(x + (Math.random() - 0.5) * 6), Math.round(y + (Math.random() - 0.5) * 4), 0.2, GLOW);
    }
  }

  private eye(g: Grid, w: Whale): void {
    const a = this.aspect;
    const [x, y] = w.pts[Math.round(w.pts.length * 0.1)];
    const [qx, qy] = w.pts[0];
    const ang = Math.atan2((qy - y) * a, qx - x || 1e-6);
    const down = Math.cos(ang) >= 0 ? 1 : -1;
    g.set(Math.round(x - Math.sin(ang) * down * w.R * 0.15), Math.round(y + (Math.cos(ang) * down * w.R * 0.15) / a), 'o', packRGB(230, 236, 246));
  }
}
