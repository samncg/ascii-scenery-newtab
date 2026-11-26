import { mix, packRGB, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { clamp, hash2, mulberry32, noise2 } from '../core/math';
import { AbyssScene } from './ink';
import { directionAngle, scenePrefs } from './prefs';
import type { Env } from './types';

/** Wing color by species: r = 0 at the body .. 1 at the wing edge, (u, v) within the wing. */
type Wing = (r: number, u: number, v: number, hind: boolean) => RGB;

const DARK: RGB = [22, 20, 28];
const SPECIES: Array<{ wing: Wing; sparkle: number }> = [
  // Blue morpho: electric blue fading to a black rim.
  { wing: (r) => (r > 0.84 ? DARK : mix([90, 175, 255], [30, 70, 210], r)), sparkle: 1 },
  // Monarch: orange cells, black veins and rim with white dots.
  {
    wing: (r, u, v) =>
      r > 0.82
        ? hash2(Math.round(u * 9), Math.round(v * 9), 3) < 0.35
          ? [250, 250, 240]
          : DARK
        : Math.abs(Math.sin(u * 7 + v * 2)) < 0.18
          ? DARK
          : mix([255, 160, 50], [225, 95, 20], r),
    sparkle: 0,
  },
  // Swallowtail: yellow with black bands, blue + red spots on the hindwing.
  {
    wing: (r, u, _v, hind) =>
      r > 0.85 ? DARK : (u * 3 + 10) % 1 < 0.28 ? DARK : hind && r > 0.65 ? (u > 0 ? [80, 140, 255] : [240, 70, 50]) : [250, 222, 90],
    sparkle: 0,
  },
  // Emerald swallowtail.
  { wing: (r) => (r > 0.86 ? DARK : mix([80, 255, 170], [20, 140, 110], r)), sparkle: 0.6 },
  // Cabbage white.
  { wing: (r, u) => (r > 0.8 && u > 0.2 ? [70, 70, 80] : [245, 244, 236]), sparkle: 0 },
  // Pink glasswing-ish.
  { wing: (r) => (r > 0.86 ? [90, 40, 70] : mix([255, 170, 220], [210, 90, 170], r)), sparkle: 0.4 },
];

interface Fly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  head: number;
  flap: number;
  rate: number;
  S: number;
  sp: number;
  seed: number;
  /** Seconds left in a glide (wings held open). */
  glide: number;
}

interface Dust { x: number; y: number; age: number; c: RGB }

/** Butterflies fluttering across the dark, shedding glittering dust. */
export class ButterfliesScene extends AbyssScene {
  readonly id = 'butterflies' as const;
  private flies: Fly[] = [];
  private dust: Dust[] = [];

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const r = mulberry32(512);
    const size = scenePrefs.animalSize;
    const n = Math.max(3, Math.min(12, Math.round((cols * rows) / (5200 * size * size))));
    this.flies = Array.from({ length: n }, (_, i) => ({
      x: r() * cols,
      y: r() * rows,
      vx: 0,
      vy: 0,
      head: r() * 6.28,
      flap: r() * 6.28,
      rate: 2.4 + r() * 1.2,
      S: (15 + r() * 9) * size,
      sp: i % SPECIES.length,
      seed: Math.floor(r() * 1000),
      glide: 0,
    }));
    this.dust = [];
  }

  draw(g: Grid, env: Env): void {
    this.prep(env);
    const { t, dt, aspect: a } = env;
    const F = this.field;
    const dir = directionAngle(scenePrefs.animalDirection);
    const size = scenePrefs.animalSize;
    for (const f of this.flies) {
      // Lazy, wandering flight; with a direction set they drift that way.
      const wander = noise2(f.x * 0.015 + f.seed, t * 0.1, 4);
      const want = dir === null ? wander * Math.PI * 4 : dir + (wander - 0.5) * 1.8;
      const speed = (4 + 2.5 * noise2(t * 0.25, f.seed, 2)) * Math.sqrt(size);
      f.vx += (Math.cos(want) * speed - f.vx) * dt * 1.2;
      f.vy += ((Math.sin(want) * speed) / a - f.vy) * dt * 1.2;
      // Flap a few times a second, with the occasional glide.
      if (f.glide > 0) f.glide -= dt;
      else if (Math.random() < dt * 0.25) f.glide = 0.6 + Math.random() * 1.2;
      if (f.glide <= 0) f.flap += dt * f.rate * Math.PI * 2;
      else f.flap += (Math.round(f.flap / Math.PI) * Math.PI + 0.6 - f.flap) * clamp(dt * 4);
      const bob = Math.sin(f.flap) * (f.glide > 0 ? 0.2 : 0.8) * Math.sqrt(size);
      f.x += f.vx * dt;
      f.y += (f.vy + bob / a) * dt;
      const m = f.S;
      if (f.x < -m) f.x = this.cols + m;
      if (f.x > this.cols + m) f.x = -m;
      if (f.y < -m) f.y = this.rows + m;
      if (f.y > this.rows + m) f.y = -m;
      let dh = Math.atan2(f.vy * a, f.vx) - f.head;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      f.head += dh * clamp(dt * 3);
      this.splat(f, a);
      if (Math.random() < dt * 8) {
        const sp = SPECIES[f.sp];
        this.dust.push({ x: f.x, y: f.y, age: 0, c: sp.wing(0.4, 0, 0, false) });
      }
    }
    // Dust drifts down and fades.
    for (const d of this.dust) {
      d.age += dt;
      d.y += dt * 1.2;
      const k = 1 - d.age / 2.2;
      if (k <= 0) continue;
      const tw = 0.6 + 0.4 * Math.sin(d.age * 12 + d.x);
      g.set(d.x, d.y, d.age < 0.4 ? '*' : '.', packRGB(d.c[0] * k * tw, d.c[1] * k * tw, d.c[2] * k * tw));
    }
    this.dust = this.dust.filter((d) => d.age < 2.2);
    F.resolve(g, t, dt, { sparkle: 0.5 });
  }

  private splat(f: Fly, a: number): void {
    const F = this.field;
    const sp = SPECIES[f.sp];
    const open = 0.18 + 0.82 * Math.abs(Math.cos(f.flap));
    const fx = Math.cos(f.head);
    const fy = Math.sin(f.head);
    const px = -fy;
    const py = fx;
    const at = (along: number, across: number): [number, number] => [f.x + fx * along + px * across, f.y + (fy * along + py * across) / a];
    for (const side of [-1, 1]) {
      // Forewing (forward, larger) and hindwing (rear, smaller).
      for (const hind of [false, true]) {
        const len = f.S * (hind ? 0.3 : 0.44) * open;
        const wid = f.S * (hind ? 0.21 : 0.27);
        const [cx, cy] = at(hind ? -f.S * 0.16 : f.S * 0.1, side * (len + 0.3));
        const ang = f.head + side * (Math.PI / 2 + (hind ? 0.45 : -0.3));
        F.oval(cx, cy, ang, Math.max(0.7, len), wid, 1.35, (u, v) => {
          const r = clamp(Math.sqrt(u * u + v * v) * 0.6 + (u + 1) * 0.25);
          return sp.wing(r, u * side, v, hind);
        });
      }
    }
    // Body and antennae.
    const [hx, hy] = at(f.S * 0.22, 0);
    const [bx, by] = at(-f.S * 0.28, 0);
    F.line(bx, by, hx, hy, 1.4, [40, 34, 30]);
    for (const side of [-1, 1]) {
      const [ax, ay] = at(f.S * 0.42, side * f.S * 0.14);
      F.line(hx, hy, ax, ay, 0.35, [120, 110, 100]);
    }
    if (sp.sparkle > 0 && Math.cos(f.flap) > 0.97) {
      const [sx, sy] = at(0, f.S * 0.4 * (Math.random() < 0.5 ? -1 : 1));
      F.add(Math.round(sx), Math.round(sy), 0.5, [230, 245, 255]);
    }
  }
}
