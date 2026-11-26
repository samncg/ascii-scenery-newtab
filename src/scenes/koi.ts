import { hex, mix, packRGB, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { clamp, mulberry32, noise2, type Rng } from '../core/math';
import { AbyssScene } from './ink';
import { directionAngle, type KoiVariety, scenePrefs } from './prefs';
import type { Env } from './types';

const WHITE = hex('#f6f3ec');
const RED = hex('#e6421f');
const ORANGE = hex('#f28a2e');
const GOLD = hex('#f2bf45');
const PALE = hex('#fff1b8');
const BLACK = hex('#2c2e36');
const BLUEGRAY = hex('#7f98c0');
const NAVY = hex('#2c3a5c');
const BRONZE = hex('#b47a46');
const YELLOW = hex('#f5d24a');

/** Base color at (s: 0 head → 1 tail, v: -1 … 1 across the back). */
type Pattern = (s: number, v: number, seed: number) => RGB;

const n2 = (s: number, v: number, seed: number, fs = 6, fv = 1.3) => noise2(s * fs + seed, v * fv + seed * 3.1, 5);

const PATTERNS: Record<KoiVariety, Pattern> = {
  kohaku: (s, v, k) => (n2(s, v, k) > 0.52 ? RED : WHITE),
  sanke: (s, v, k) => (n2(s, v, k, 14, 3) > 0.76 ? BLACK : n2(s, v, k) > 0.54 ? RED : WHITE),
  showa: (s, v, k) => (n2(s, v, k + 9) > 0.6 ? WHITE : n2(s, v, k) > 0.48 ? RED : BLACK),
  ogon: (_s, v) => mix(GOLD, PALE, clamp(0.6 - Math.abs(v)) * 0.7),
  tancho: (s, v) => (s < 0.13 && Math.abs(v) < 0.7 ? RED : WHITE),
  asagi: (s, v) => (Math.abs(v) > 0.62 ? ORANGE : (s * 18) % 1 < 0.18 ? NAVY : BLUEGRAY),
  chagoi: (s) => ((s * 18) % 1 < 0.15 ? mix(BRONZE, BLACK, 0.35) : BRONZE),
  yamabuki: (_s, v) => mix(YELLOW, PALE, clamp(0.5 - Math.abs(v)) * 0.6),
  utsuri: (s, v, k) => (n2(s, v, k) > 0.5 ? BLACK : WHITE),
  kiutsuri: (s, v, k) => (n2(s, v, k) > 0.48 ? BLACK : YELLOW),
  kumonryu: (s, v, k) => (n2(s, v, k, 11, 2.4) > 0.5 ? BLACK : WHITE),
  goshiki: (s, v, k) => (n2(s, v, k) > 0.55 ? RED : (s * 16 + v * 2) % 1 < 0.3 ? BLACK : mix(NAVY, WHITE, 0.45)),
};

interface Koi {
  pts: Array<[number, number]>;
  a: number;
  v: number;
  tx: number;
  ty: number;
  R: number;
  pattern: Pattern;
  seed: number;
  phase: number;
  depth: number;
}

interface Ring { x: number; y: number; r: number; max: number }

// Light from the top-left, above the water (screen x, screen y, toward viewer).
const LIGHT = (() => {
  const v = [-0.45, -0.55, 0.7];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / l) as [number, number, number];
})();
const HALF = (() => {
  const v = [LIGHT[0], LIGHT[1], LIGHT[2] + 1];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / l) as [number, number, number];
})();

/** Koi gliding over black water — the whole screen is the pond. */
export class KoiScene extends AbyssScene {
  readonly id = 'koi' as const;
  private fish: Koi[] = [];
  private rings: Ring[] = [];
  private rng: Rng = mulberry32(8);
  private aspect = 1.2;

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const r = (this.rng = mulberry32(88));
    const size = scenePrefs.animalSize;
    const kinds = scenePrefs.koiVarieties.length ? scenePrefs.koiVarieties : (Object.keys(PATTERNS) as KoiVariety[]);
    const count = Math.max(4, Math.min(16, Math.round((cols * rows) / (2600 * size * size))));
    this.fish = Array.from({ length: count }, (_, i) => {
      const [x, y] = this.point();
      const depth = r();
      const n = Math.round((14 + r() * 9) * size * (0.8 + 0.3 * (1 - depth)));
      const a = r() * Math.PI * 2;
      return {
        pts: Array.from({ length: n }, (_, k) => [x - Math.cos(a) * k, y - (Math.sin(a) * k) / this.aspect] as [number, number]),
        a,
        v: (4.5 + r() * 4) * Math.sqrt(size),
        tx: x,
        ty: y,
        R: n * (0.17 + r() * 0.04),
        pattern: PATTERNS[kinds[i % kinds.length]],
        seed: Math.floor(r() * 1000),
        phase: r() * 6,
        depth,
      };
    });
    // Deep fish first, so shallow ones swim over them.
    this.fish.sort((p, q) => q.depth - p.depth);
    this.rings = [];
  }

  private point(): [number, number] {
    const m = 6;
    return [m + this.rng() * (this.cols - 2 * m), m / 2 + this.rng() * (this.rows - m)];
  }

  draw(g: Grid, env: Env): void {
    this.prep(env);
    this.aspect = env.aspect;
    const { dt, t, w } = env;
    // Rain rings only when it is actually raining.
    const wet = w.rain + w.drizzle * 0.6;
    let spawn = wet * this.cols * this.rows * 0.0006 * dt;
    while (spawn > 0) {
      if (this.rng() < spawn) {
        const [x, y] = this.point();
        this.rings.push({ x, y, r: 0, max: 1.2 + this.rng() * 2 });
      }
      spawn -= 1;
    }
    const dir = directionAngle(scenePrefs.animalDirection);
    for (const f of this.fish) {
      this.steer(f, dt, t, dir);
      this.splat(f);
    }
    this.field.resolve(g, t, dt, { sparkle: 0.25 });
    for (const f of this.fish) this.eyes(g, f);
    this.drawRings(g, env);
  }

  private steer(f: Koi, dt: number, t: number, dir: number | null): void {
    const a = this.aspect;
    const [hx, hy] = f.pts[0];
    let want: number;
    if (dir === null) {
      const dx = f.tx - hx;
      const dy = (f.ty - hy) * a;
      if (dx * dx + dy * dy < 16) [f.tx, f.ty] = this.point();
      want = Math.atan2(dy, dx);
    } else {
      want = dir + Math.sin(t * 0.25 + f.seed) * 0.55;
    }
    let da = want - f.a;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    f.a += clamp(da, -1.1 * dt, 1.1 * dt);
    const v = f.v * (0.8 + 0.2 * Math.sin(f.phase * 0.2));
    f.phase += dt * (3 + v * 0.35);
    f.pts[0] = [hx + Math.cos(f.a) * v * dt, hy + (Math.sin(f.a) * v * dt) / a];
    for (let i = 1; i < f.pts.length; i++) {
      const [px, py] = f.pts[i - 1];
      const [sx, sy] = f.pts[i];
      const ex = sx - px;
      const ey = (sy - py) * a;
      const len = Math.hypot(ex, ey) || 1;
      if (len > 1) f.pts[i] = [px + ex / len, py + ey / len / a];
    }
    // Directional travel: once the whole fish has left, bring it back in on the far side.
    if (dir !== null) {
      const m = f.pts.length + f.R * 3;
      const tail = f.pts[f.pts.length - 1];
      const off = (p: [number, number]) => p[0] < -m || p[0] > this.cols + m || p[1] < -m / a || p[1] > this.rows + m / a;
      if (off(f.pts[0]) && off(tail)) {
        const nx = Math.cos(dir) > 0.5 ? -m * 0.6 : Math.cos(dir) < -0.5 ? this.cols + m * 0.6 : this.rng() * this.cols;
        const ny = Math.sin(dir) > 0.5 ? -m * 0.6 / a : Math.sin(dir) < -0.5 ? this.rows + (m * 0.6) / a : this.rng() * this.rows;
        const dx = nx - f.pts[0][0];
        const dy = ny - f.pts[0][1];
        f.pts = f.pts.map(([x, y]) => [x + dx, y + dy]);
        f.a = dir;
      }
    }
  }

  /** Lit, rounded body along a swaying spine, then translucent fins. */
  private splat(f: Koi): void {
    const a = this.aspect;
    const n = f.pts.length;
    const F = this.field;
    const dim = 0.62 + 0.38 * (1 - f.depth);
    let tail: [number, number, number] = [0, 0, 0];
    let fin: [number, number, number] = [0, 0, 0];
    let head: [number, number, number] = [0, 0, 0];
    for (let i = n - 1; i >= 0; i--) {
      const s = i / (n - 1);
      const [x, y] = f.pts[i];
      const [qx, qy] = f.pts[Math.max(0, i - 1)];
      const [rx, ry] = f.pts[Math.min(n - 1, i + 1)];
      const ang = Math.atan2((qy - ry) * a, qx - rx || 1e-6);
      const sway = Math.sin(f.phase - s * 5.5) * (0.1 + s) * 0.7;
      const px = x - Math.sin(ang) * sway;
      const py = y + (Math.cos(ang) * sway) / a;
      const prof = s < 0.2 ? 0.62 + s * 1.9 : Math.max(0.12, 1 - Math.pow((s - 0.2) / 0.8, 1.1) * 0.9);
      const r = f.R * prof;
      // Lateral unit vector in screen space (for lighting).
      const lx = -Math.sin(ang);
      const ly = Math.cos(ang);
      F.oval(px, py, ang, Math.max(0.9, r * 1.05), Math.max(0.6, r), 1.3, (_u, v) => {
        const vv = clamp(v, -1, 1);
        const nz = Math.sqrt(1 - vv * vv);
        const nx = lx * vv;
        const ny = ly * vv;
        const diff = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        const spec = Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), 28);
        const scales = 1 + 0.07 * Math.sin(s * 70) * Math.sin(vv * 7 + s * 20);
        const base = f.pattern(s, vv, f.seed);
        const k = (0.32 + 0.85 * diff) * scales * dim;
        return [base[0] * k + 255 * spec * 0.65, base[1] * k + 250 * spec * 0.65, base[2] * k + 240 * spec * 0.65];
      });
      if (i === n - 1) tail = [px, py, ang];
      if (i === Math.round(n * 0.22)) fin = [px, py, ang];
      if (i === 0) head = [px, py, ang];
    }
    const finC = mix(f.pattern(0.9, 0, f.seed), WHITE, 0.35).map((c) => c * dim) as RGB;
    // Dorsal ridge.
    for (let i = Math.round(n * 0.28); i < Math.round(n * 0.62); i++) {
      const [x, y] = f.pts[i];
      F.add(Math.round(x), Math.round(y), 0.25, mix(finC, WHITE, 0.3));
    }
    // Tail: two flowing lobes with fin rays.
    const [tx, ty, ta] = tail;
    const flutter = Math.sin(f.phase * 1.3) * 0.28;
    const L = f.R * 2.2;
    for (const side of [-1, 1]) {
      const ang = ta + Math.PI + side * 0.42 + flutter;
      F.oval(tx + (Math.cos(ang) * L) / 2, ty + (Math.sin(ang) * L) / 2 / a, ang, L / 2, f.R * 0.42, 0.62, finC);
      F.line(tx, ty, tx + Math.cos(ang) * L, ty + (Math.sin(ang) * L) / a, 0.3, mix(finC, WHITE, 0.25));
    }
    // Pectoral fins: translucent paddles.
    const [fx, fy, fa] = fin;
    const paddle = Math.sin(f.phase * 0.8) * 0.3;
    for (const side of [-1, 1]) {
      const ang = fa + Math.PI + side * (1.1 + paddle);
      const ox = fx - Math.sin(fa) * side * f.R * 0.85;
      const oy = fy + (Math.cos(fa) * side * f.R * 0.85) / a;
      const len = f.R * 1.25;
      F.oval(ox + (Math.cos(ang) * len) / 2, oy + (Math.sin(ang) * len) / 2 / a, ang, len / 2, f.R * 0.32, 0.55, finC);
    }
    // Barbels at the mouth.
    const [hx, hy, ha] = head;
    for (const side of [-1, 1]) {
      const bx = hx + Math.cos(ha) * f.R * 0.7;
      const by = hy + (Math.sin(ha) * f.R * 0.7) / a;
      const ang = ha + side * 0.9;
      F.line(bx, by, bx + Math.cos(ang) * f.R * 0.6, by + (Math.sin(ang) * f.R * 0.6) / a, 0.3, finC);
    }
  }

  private eyes(g: Grid, f: Koi): void {
    const a = this.aspect;
    const [x, y] = f.pts[0];
    const [qx, qy] = f.pts[1];
    const ang = Math.atan2((y - qy) * a, x - qx || 1e-6);
    const r = f.R * 0.55;
    for (const side of [-1, 1]) {
      const ex = Math.round(x + Math.cos(ang) * 0.3 - Math.sin(ang) * side * r);
      const ey = Math.round(y + (Math.sin(ang) * 0.3 + Math.cos(ang) * side * r) / a);
      g.put(ex, ey, 'o', packRGB(255, 255, 255), packRGB(16, 16, 22));
    }
  }

  private drawRings(g: Grid, env: Env): void {
    const a = this.aspect;
    for (const rg of this.rings) {
      rg.r += env.dt * 3;
      const k = 1 - rg.r / rg.max;
      if (k <= 0) continue;
      const steps = Math.max(8, Math.round(rg.r * 8));
      const c = packRGB(90 * k + 20, 120 * k + 20, 170 * k + 30);
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const ch = Math.abs(ca) > 0.85 ? (ca > 0 ? ')' : '(') : Math.abs(sa) > 0.85 ? (sa > 0 ? '_' : '-') : ca * sa > 0 ? '\\' : '/';
        g.set(rg.x + ca * rg.r * a, rg.y + sa * rg.r, ch, c);
      }
    }
    this.rings = this.rings.filter((r) => r.r < r.max);
  }
}
