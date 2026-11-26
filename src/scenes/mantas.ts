import { mix, packRGB, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { clamp, hash2, mulberry32 } from '../core/math';
import { AbyssScene, Specks } from './ink';
import { directionAngle, scenePrefs, wrap } from './prefs';
import type { Env } from './types';

interface Manta {
  x: number;
  y: number;
  a: number;
  v: number;
  W: number;
  phase: number;
  seed: number;
  rim: RGB;
  spot: RGB;
}

interface Spark { x: number; y: number; age: number; c: RGB }

const PALETTES: Array<[RGB, RGB]> = [
  [[90, 240, 255], [190, 255, 255]],
  [[120, 160, 255], [210, 225, 255]],
  [[230, 110, 255], [255, 200, 255]],
  [[80, 255, 190], [200, 255, 235]],
];

/** Bioluminescent manta rays gliding through the deep. */
export class MantasScene extends AbyssScene {
  readonly id = 'mantas' as const;
  private rays: Manta[] = [];
  private sparks: Spark[] = [];
  private snow = new Specks();

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const r = mulberry32(77);
    const size = scenePrefs.animalSize;
    const n = Math.max(2, Math.min(7, Math.round((cols * rows) / (9000 * size * size))));
    this.rays = Array.from({ length: n }, (_, i) => {
      const [rim, spot] = PALETTES[i % PALETTES.length];
      return {
        x: r() * cols,
        y: r() * rows,
        a: r() * Math.PI * 2,
        v: 3 + r() * 2.5,
        W: Math.min(cols * 0.5, (24 + r() * 22) * size),
        phase: r() * 6,
        seed: Math.floor(r() * 1000),
        rim,
        spot,
      };
    });
    this.sparks = [];
    this.snow.place(cols, rows, Math.round((cols * rows) / 160), 9);
  }

  draw(g: Grid, env: Env): void {
    this.prep(env);
    const { t, dt, aspect: a } = env;
    this.snow.draw(g, env, [70, 110, 150], 0.4, 0.8);
    for (const m of this.rays) {
      const dir = directionAngle(scenePrefs.animalDirection);
      let turn: number;
      if (dir === null) {
        // Wide, lazy turns; steer back when drifting off screen.
        const cx = this.cols / 2 - m.x;
        const cy = (this.rows / 2 - m.y) * a;
        const far = Math.hypot(cx, cy) > Math.min(this.cols, this.rows * a) * 0.55;
        turn = Math.sin(t * 0.06 + m.seed) * 0.22;
        if (far) {
          let d = Math.atan2(cy, cx) - m.a;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          turn += clamp(d, -0.35, 0.35);
        }
      } else {
        let d = dir + Math.sin(t * 0.08 + m.seed) * 0.4 - m.a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        turn = clamp(d, -0.4, 0.4);
        wrap(m, this.cols, this.rows, m.W * 0.8);
      }
      m.a += turn * dt;
      m.phase += dt * 1.25;
      m.x += Math.cos(m.a) * m.v * dt;
      m.y += (Math.sin(m.a) * m.v * dt) / a;
      this.splat(m, a);
      // Wingtip plankton sparks.
      if (Math.random() < dt * 10) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const span = 0.5 * (0.86 + 0.14 * Math.cos(m.phase));
        const fx = Math.cos(m.a);
        const fy = Math.sin(m.a);
        this.sparks.push({
          x: m.x - fx * m.W * 0.05 - fy * side * m.W * span,
          y: m.y + (-fy * m.W * 0.05 + fx * side * m.W * span) / a,
          age: 0,
          c: m.rim,
        });
      }
    }
    for (const s of this.sparks) {
      s.age += dt;
      const k = 1 - s.age / 2.5;
      if (k <= 0) continue;
      g.set(s.x, s.y, s.age < 0.5 ? '*' : '.', packRGB(s.c[0] * k, s.c[1] * k, s.c[2] * k));
      g.addGlow(Math.round(s.x), Math.round(s.y), s.c, 0.3 * k);
    }
    this.sparks = this.sparks.filter((s) => s.age < 2.5);
    this.field.resolve(g, t, dt, { glow: 0.16, sparkle: 0.15 });
  }

  /** Diamond wings with a glowing rim and a travelling wave of light. */
  private splat(m: Manta, a: number): void {
    const F = this.field;
    const W = m.W;
    const fx = Math.cos(m.a);
    const fy = Math.sin(m.a);
    const sf = 0.86 + 0.14 * Math.cos(m.phase);
    const R = W * 0.55;
    const deep: RGB = [12, 26, 60];
    const xa = Math.floor(m.x - R);
    const xb = Math.ceil(m.x + R);
    const ya = Math.floor(m.y - R / a);
    const yb = Math.ceil(m.y + R / a);
    for (let y = ya; y <= yb; y++) {
      const dy = (y - m.y) * a;
      for (let x = xa; x <= xb; x++) {
        const dx = x - m.x;
        const u = (dx * fx + dy * fy) / W;
        const v = (-dx * fy + dy * fx) / W;
        // Swept-back crescent wings: at span s (0 centre .. 1 tip) the body
        // runs from back(s) to front(s); the tips trail behind the head.
        const sv = Math.abs(v) / (0.5 * sf);
        if (sv >= 1) continue;
        const front = 0.3 * (1 - Math.pow(sv, 1.4)) - 0.14 * sv;
        const back = -0.24 * (1 - Math.pow(sv, 0.7)) - 0.16 * sv;
        if (u > front || u < back) continue;
        const e = Math.min((front - u) / 0.035, (u - back) / 0.035, (1 - sv) / 0.06, 1);
        const av = Math.abs(v);
        const wave = 0.5 + 0.5 * Math.sin(m.phase * 2.2 - u * 16 - av * 6);
        if (e < 0.75) {
          F.add(x, y, 1.1, mix(m.rim, [255, 255, 255], 0.15 * wave));
        } else {
          const spot = hash2(Math.round(u * 40), Math.round(v * 40), m.seed) < 0.06 && av > 0.05;
          const vein = Math.abs(Math.sin(av * 30 + u * 4)) < 0.12;
          const c = spot ? m.spot : vein ? mix(deep, m.rim, 0.35 + 0.35 * wave) : mix(deep, m.rim, 0.12 * wave);
          F.add(x, y, spot ? 1 : 0.9, c);
        }
      }
    }
    // Cephalic lobes.
    for (const side of [-1, 1]) {
      F.oval(m.x + fx * W * 0.32 - fy * side * W * 0.07, m.y + (fy * W * 0.32 + fx * side * W * 0.07) / a, m.a, W * 0.06, W * 0.03, 1, m.rim);
    }
    // Whip tail.
    let px = m.x - fx * W * 0.28;
    let py = m.y - (fy * W * 0.28) / a;
    for (let k = 1; k <= 10; k++) {
      const s = k / 10;
      const sway = Math.sin(m.phase * 1.5 - s * 5) * W * 0.04 * s;
      const nx = m.x - fx * W * (0.28 + 0.6 * s) - fy * sway;
      const ny = m.y + (-fy * W * (0.28 + 0.6 * s) + fx * sway) / a;
      F.line(px, py, nx, ny, 0.45 * (1 - s * 0.6), m.rim);
      px = nx;
      py = ny;
    }
  }
}
