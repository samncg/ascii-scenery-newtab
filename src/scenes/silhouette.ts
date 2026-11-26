import { mix, packRGB, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { INK } from '../core/render-common';
import { clamp, fbm, hash2, mulberry32 } from '../core/math';
import { Fireflies } from './common';
import { BaseScene, type Env } from './types';

interface Tree {
  cx: number;
  base: number;
  h: number;
  /** Half-width at the base. */
  w: number;
  tiers: number;
  layer: number;
  ph: number;
  freq: number;
}

const DAY_GREEN: RGB = [30, 62, 44];
const WARM_DARK: RGB = [46, 26, 22];

/**
 * A pine forest against the real sky: blue by day, gold at golden hour, the
 * Milky Way at night (when the forest goes completely black). Trees sway.
 */
export class SilhouetteScene extends BaseScene {
  readonly id = 'silhouette' as const;
  skyInk = 0.3;
  private trees: Tree[] = [];
  private top: Float32Array[] = [];
  private mw = new Float32Array(0);
  private mwTint = new Float32Array(0);
  private nightCells = new Int32Array(0);
  private flies = new Fireflies(26, 21);
  private night = 0;

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    this.sky = true;
    this.birds = true;
    const H = (this.horizonRow = Math.round(rows * 0.74));
    const r = mulberry32(91);
    this.trees = [];
    const add = (layer: number, base: number, minH: number, maxH: number, step: [number, number], slope: number) => {
      for (let cx = -6; cx < cols + 6; cx += step[0] + Math.floor(r() * (step[1] - step[0]))) {
        const h = minH + r() * (maxH - minH);
        this.trees.push({ cx, base, h, w: h / slope, tiers: 3 + Math.floor(h / 8), layer, ph: r() * 6.28, freq: 0.5 + r() * 0.4 });
      }
    };
    add(0, H, rows * 0.05, rows * 0.12, [2, 5], 1.6);
    add(1, H + rows * 0.08, rows * 0.1, rows * 0.2, [5, 11], 1.4);
    add(2, H + rows * 0.22, rows * 0.16, rows * 0.34, [10, 22], 1.3);
    // Tall framing pines at both edges.
    for (const [cx, h] of [[cols * 0.04, rows * 0.72], [cols * 0.95, rows * 0.64]]) {
      this.trees.push({ cx, base: rows + 2, h, w: h / 2.8, tiers: 9, layer: 2, ph: r() * 6, freq: 0.45 });
    }
    this.top = [0, 1, 2].map(() => new Float32Array(cols));

    // Static Milky Way: a diagonal band with dust lanes.
    this.mw = new Float32Array(cols * rows);
    this.mwTint = new Float32Array(cols * rows);
    const bw = rows * 0.2;
    const list: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const cyl = rows * 0.95 - (x / cols) * rows * 1.15;
        const d = (y - cyl) / bw;
        const core = Math.exp(-d * d * 1.6);
        const n = fbm(x * 0.05, y * 0.07, 3, 5);
        const lane = clamp((fbm(x * 0.03 + 7, y * 0.09, 3, 9) - 0.52) * 4) * Math.exp(-d * d * 5);
        this.mw[i] = core * (0.45 + 0.75 * n) * (1 - 0.8 * lane);
        this.mwTint[i] = fbm(x * 0.02, y * 0.02, 2, 3);
        if (this.mw[i] > 0.18) list.push(i);
      }
    }
    this.nightCells = Int32Array.from(list);
    this.flies.place(4, H - rows * 0.1, cols - 4, rows - 2);
    this.surfaces = [];
  }

  stops(env: Env): Array<[number, RGB]> {
    const p = env.pal;
    this.night = clamp((p.lights - 0.45) / 0.45);
    // Keep the real sky colors by day; black for the Milky Way at night.
    this.skyInk = 0.3 + 0.7 * this.night;
    return super.stops(env).map(([o, c]) => [o, mix(c, INK, this.night * 0.85)]);
  }

  fogBias(y: number): number {
    const d = (y - this.horizonRow) / (this.rows * 0.15);
    return 0.25 + 0.75 * Math.exp(-d * d);
  }

  draw(g: Grid, env: Env): void {
    const { t, w, pal } = env;
    const { cols, rows } = this;
    const night = this.night;
    const veil = Math.max(0, 1 - (w.cloud * 0.75 + w.rain + w.snow * 0.5 + w.fog * 0.7));

    if (night > 0.05) this.drawMilkyWay(g, t, night * veil);

    // Sway: a gentle shear of each crown, stronger in wind.
    const gust = 0.35 + Math.abs(w.wind) * 1.6 + w.storm * 0.8;
    for (const top of this.top) top.fill(rows + 5);
    for (const tr of this.trees) {
      const s = tr.h * (0.045 * gust * Math.sin(t * tr.freq + tr.ph) + 0.035 * w.wind) * (0.6 + 0.2 * tr.layer);
      const apex = tr.cx + s;
      const top = this.top[tr.layer];
      const tierH = tr.h / tr.tiers;
      const x0 = Math.floor(tr.cx - tr.w);
      const x1 = Math.ceil(tr.cx + tr.w);
      for (let x = Math.max(0, x0); x <= Math.min(cols - 1, x1); x++) {
        const frac = x <= apex ? (x - (tr.cx - tr.w)) / Math.max(0.5, apex - (tr.cx - tr.w)) : (tr.cx + tr.w - x) / Math.max(0.5, tr.cx + tr.w - apex);
        if (frac <= 0) continue;
        const rise = tr.h * Math.min(1, frac);
        // Tiered outline: notches that step the silhouette like pine boughs.
        const notch = (rise % tierH) * 0.45;
        const y = tr.base - rise + notch;
        if (y < top[x]) top[x] = y;
      }
    }

    // Colors: green and hazy by day, warm-backlit at golden hour, black at night.
    const golden = clamp((0.85 - pal.daylight) * 2) * (1 - night);
    const base = mix(mix(DAY_GREEN, WARM_DARK, golden), pal.foliage, 0.25 * (1 - golden));
    const layerCol = (layer: number): RGB => mix(mix(base, pal.skyBottom, [0.55, 0.3, 0][layer]), [0, 0, 0], night);
    for (let layer = 0; layer < 3; layer++) {
      const c = layerCol(layer);
      const solid = night > 0.97;
      const bg = solid ? 0 : packRGB(c[0], c[1], c[2]);
      const tex = packRGB(c[0] * 1.6 + 14, c[1] * 1.6 + 18, c[2] * 1.6 + 12);
      const top = this.top[layer];
      for (let x = 0; x < cols; x++) {
        const y0 = Math.max(0, Math.round(top[x]));
        for (let y = y0; y < rows; y++) {
          if (!solid && layer > 0 && y - y0 < rows * 0.15 && hash2(x, y, 31 + layer) < 0.07) g.put(x, y, hash2(y, x, 5) < 0.5 ? '^' : "'", tex, bg);
          else g.blank(x, y, bg);
        }
      }
    }
    const warm = env.month >= 4 && env.month <= 8 ? 1 : 0.3;
    this.flies.draw(g, t, env.dt, night * warm * (1 - Math.min(1, w.rain + w.snow)));
  }

  private drawMilkyWay(g: Grid, t: number, k: number): void {
    const cols = this.cols;
    const slot = Math.floor(t * 3);
    for (const i of this.nightCells) {
      const y = (i / cols) | 0;
      const x = i - y * cols;
      const m = this.mw[i];
      const h = hash2(x, y, 3);
      const c = mix(mix([150, 160, 255], [255, 228, 196], clamp(m * 1.3)), [200, 140, 230], clamp((this.mwTint[i] - 0.55) * 3) * 0.6);
      g.paintBack(x, y, c, Math.min(0.55, m * 0.38) * k);
      if (hash2(x, y, slot + Math.floor(h * 7)) < m * 0.55) {
        const b = (0.35 + 0.65 * m) * k;
        g.set(x, y, m > 0.75 ? ':' : '.', packRGB(c[0] * b, c[1] * b, c[2] * b));
      }
      if (m > 0.25 && h > 1 - m * 0.05) {
        const tw = (0.5 + 0.5 * Math.sin(t * (1 + h * 3) + h * 40)) * k;
        if (tw > 0.2) g.set(x, y, tw > 0.75 ? '+' : '.', packRGB(235 * tw, 238 * tw, 255 * tw));
      }
    }
  }
}
