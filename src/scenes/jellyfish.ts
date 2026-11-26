import { mix, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { mulberry32 } from '../core/math';
import { AbyssScene, Specks } from './ink';
import { scenePrefs, wrap } from './prefs';
import type { Env } from './types';

interface Jelly {
  x: number;
  y: number;
  R: number;
  phase: number;
  rate: number;
  rim: RGB;
  body: RGB;
  seed: number;
  drift: number;
}

const KINDS: Array<[RGB, RGB]> = [
  [[255, 90, 210], [200, 130, 255]],
  [[150, 110, 255], [210, 190, 255]],
  [[80, 230, 255], [170, 240, 255]],
  [[255, 160, 70], [255, 210, 150]],
  [[230, 220, 255], [190, 200, 240]],
];

/** Pulsing bioluminescent jellyfish rising through black water. */
export class JellyfishScene extends AbyssScene {
  readonly id = 'jellyfish' as const;
  private jellies: Jelly[] = [];
  private snow = new Specks();

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const r = mulberry32(303);
    const size = scenePrefs.animalSize;
    const n = Math.max(2, Math.min(9, Math.round((cols * rows) / (5500 * size * size))));
    this.jellies = Array.from({ length: n }, (_, i) => {
      const [rim, body] = KINDS[i % KINDS.length];
      return {
        x: (cols / n) * (i + 0.5) + (r() - 0.5) * 10,
        y: r() * rows,
        R: (5 + r() * 6) * size,
        phase: r() * 6,
        rate: 1.4 + r() * 0.8,
        rim,
        body,
        seed: r() * 100,
        drift: (r() - 0.5) * 1.2,
      };
    });
    this.snow.place(cols, rows, Math.round((cols * rows) / 180), 4);
  }

  draw(g: Grid, env: Env): void {
    this.prep(env);
    const { t, dt, aspect: a } = env;
    this.snow.draw(g, env, [90, 90, 140], 0.2, -0.5);
    const F = this.field;
    for (const j of this.jellies) {
      j.phase += dt * j.rate;
      const pulse = Math.sin(j.phase);
      const squeeze = Math.max(0, pulse);
      // Contraction pushes it along; then it coasts. Jellies rise unless told otherwise.
      const push = 0.8 + squeeze * 4;
      const d = scenePrefs.animalDirection;
      if (d === 'down') j.y += (dt * push * 0.6) / a;
      else if (d === 'left' || d === 'right') {
        j.x += dt * push * (d === 'left' ? -1 : 1);
        j.y += (dt * Math.sin(t * 0.3 + j.seed) * 0.6) / a;
      } else j.y -= (dt * push) / a;
      j.x += dt * (j.drift + Math.sin(t * 0.2 + j.seed) * 0.6) * (d === 'left' || d === 'right' ? 0.3 : 1);
      if (wrap(j, this.cols, this.rows, j.R * 5)) j.phase += 1;
      const rx = j.R * (1 - 0.16 * squeeze);
      const ry = j.R * 0.72 * (1 + 0.14 * squeeze);
      // Bell: a dome, bright at the rim, translucent inside.
      F.oval(j.x, j.y, 0, rx, ry, 1.15, (u, v) => {
        if (v > 0.35) return null;
        const e = Math.sqrt(u * u + v * v);
        return e > 0.8 ? j.rim : mix(j.body, j.rim, e * 0.45);
      });
      // Cut the bottom of the dome flat-ish by adding bright frill instead.
      const rimY = j.y + (ry * 0.35) / a;
      for (let x = Math.round(j.x - rx); x <= Math.round(j.x + rx); x++) {
        const fr = 0.5 + 0.5 * Math.sin(x * 1.7 + j.phase * 3);
        F.add(x, Math.round(rimY + fr * 0.6), 0.5, j.rim);
      }
      // Gonad rings (moon-jelly style).
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + 0.4;
        F.oval(j.x + Math.cos(ang) * rx * 0.32, j.y - j.R * 0.15 / a + (Math.sin(ang) * ry * 0.25) / a, ang, j.R * 0.18, j.R * 0.09, 0.55, mix(j.rim, [255, 255, 255], 0.3));
      }
      // Oral arms: frilly ribbons.
      for (const off of [-0.28, -0.1, 0.1, 0.28]) {
        for (let s = 0; s <= 1; s += 0.08) {
          const sway = Math.sin(j.phase * 0.7 - s * 4 + off * 9) * j.R * 0.25 * s;
          const ax = j.x + off * j.R + sway;
          const ay = rimY + (s * j.R * 1.5) / a;
          F.oval(ax, ay, Math.PI / 2, j.R * 0.16, j.R * 0.12 * (1 - s * 0.6), 0.7, mix(j.body, j.rim, 0.4));
        }
      }
      // Long trailing tentacles.
      const n = 8;
      for (let k = 0; k < n; k++) {
        const x0 = j.x - rx * 0.9 + (k / (n - 1)) * rx * 1.8;
        let px = x0;
        let py = rimY;
        for (let s = 1; s <= 14; s++) {
          const ss = s / 14;
          const sway = Math.sin(j.phase * 0.6 - ss * 5 + k) * j.R * 0.35 * ss;
          const nx = x0 + sway;
          const ny = rimY + (ss * j.R * 4.8) / a;
          F.line(px, py, nx, ny, 0.32 * (1 - ss * 0.7), j.rim);
          px = nx;
          py = ny;
        }
      }
    }
    F.resolve(g, t, dt, { glow: 0.22, sparkle: 0.1, tile: 0.68 });
  }
}
