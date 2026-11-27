import { packRGB, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { hash2, mulberry32, noise2 } from '../core/math';
import { AbyssScene } from './ink';
import { directionAngle, scenePrefs } from './prefs';
import type { Env } from './types';

interface Fly { x: number; y: number; vx: number; vy: number; ph: number; rate: number; z: number }

const GLOW: RGB = [210, 255, 100];

/** A meadow at night: tall black grass and fireflies blinking in slow waves. */
export class FirefliesScene extends AbyssScene {
  readonly id = 'fireflies' as const;
  private flies: Fly[] = [];
  private blades: Array<{ x: number; h: number; ph: number; lean: number }> = [];

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const r = mulberry32(17);
    const size = scenePrefs.animalSize;
    const n = Math.round((cols * rows) / (260 * size));
    this.flies = Array.from({ length: n }, () => ({
      x: r() * cols,
      y: rows * (0.15 + r() * 0.8),
      vx: 0,
      vy: 0,
      ph: r() * 6.28,
      rate: 0.5 + r() * 0.5,
      z: r(),
    }));
    this.blades = [];
    for (let x = 0; x < cols; x += 1 + Math.floor(r() * 2)) {
      this.blades.push({ x, h: rows * (0.08 + r() * 0.22), ph: r() * 6.28, lean: (r() - 0.5) * 0.6 });
    }
  }

  draw(g: Grid, env: Env): void {
    this.prep(env);
    const { t, dt, w } = env;
    const a = env.aspect;
    const { cols, rows } = this;
    const dir = directionAngle(scenePrefs.animalDirection);
    const size = scenePrefs.animalSize;
    // Gusts of synchronised blinking sweep across the meadow.
    const wave = (x: number) => 0.5 + 0.5 * Math.sin(t * 0.8 - x * 0.04);
    for (const f of this.flies) {
      const n = noise2(f.x * 0.04 + f.ph, t * 0.15, 3) * Math.PI * 4;
      const tx = dir === null ? Math.cos(n) * 2 : Math.cos(dir) * 3 + Math.cos(n) * 1.2;
      const ty = dir === null ? Math.sin(n) * 1.2 : Math.sin(dir) * 2 + Math.sin(n) * 0.8;
      f.vx += (tx - f.vx) * dt;
      f.vy += (ty - f.vy) * dt;
      f.x += f.vx * dt * (0.6 + f.z) * Math.sqrt(size);
      f.y += (f.vy * dt * (0.6 + f.z)) / a;
      if (f.x < -2) f.x += cols + 4;
      if (f.x > cols + 2) f.x -= cols + 4;
      if (f.y < rows * 0.08) f.y += rows * 0.85;
      if (f.y > rows) f.y -= rows * 0.85;
      const blink = Math.pow(Math.max(0, Math.sin(t * f.rate * 3 + f.ph)), 0.6) * (0.45 + 0.55 * wave(f.x));
      if (blink < 0.12) continue;
      const k = blink * (0.7 + 0.3 * f.z);
      const r = (0.9 + 0.6 * f.z) * size;
      const core = packRGB(255, 255, 200 + 55 * k);
      const warm = packRGB(220 * k + 35, 255 * k, 90 * k);
      // Bright core cell on a lit tile, a small cross of light when at full
      // brightness, a wide glow and a faint halo behind everything.
      g.put(f.x, f.y, k > 0.55 ? '*' : '+', core, packRGB(150 * k, 210 * k, 60 * k));
      if (k > 0.55) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.set(f.x + dx, f.y + dy, dx ? '-' : ':', warm);
      }
      g.glowAt(f.x, f.y, 3 * r, 2.2 * r, GLOW, 1.25 * k);
      g.backAt(f.x, f.y, 5 * r, 3.5 * r, [120, 200, 60], 0.1 * k);
    }
    // Tall grass silhouettes swaying in the wind, completely black.
    const gust = 0.6 + Math.abs(w.wind) * 2;
    for (const b of this.blades) {
      const sway = Math.sin(t * 0.7 + b.ph + b.x * 0.05) * gust + b.lean * 3 + w.wind * 2;
      const steps = Math.round(b.h);
      for (let k = 0; k <= steps; k++) {
        const s = k / steps;
        const x = Math.round(b.x + sway * s * s);
        const y = rows - 1 - k;
        g.blank(x, y, 0);
        if (s > 0.85 && hash2(b.x, k) < 0.5) g.blank(x + (sway > 0 ? 1 : -1), y, 0);
      }
    }
  }
}
