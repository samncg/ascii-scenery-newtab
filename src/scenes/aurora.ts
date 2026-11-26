import { mix, packRGB, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { INK } from '../core/render-common';
import { fbm, hash2, mulberry32, noise2, smoothstep } from '../core/math';
import { BaseScene, type Env } from './types';

const GREEN: RGB = [70, 255, 150];
const TEAL: RGB = [60, 220, 220];
const VIOLET: RGB = [170, 100, 255];
const PINK: RGB = [255, 80, 170];

/** Curtains of aurora over a black treeline, mirrored in a still lake. */
export class AuroraScene extends BaseScene {
  readonly id = 'aurora' as const;
  private shore = 0;
  private trees = new Int16Array(0);
  private I = new Float32Array(0);
  private C = new Float32Array(0);
  private stars: Array<{ x: number; y: number; b: number; ph: number }> = [];
  private colBand = new Float32Array(0);

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    this.sky = false;
    this.birds = false;
    this.shore = Math.round(rows * 0.74);
    this.horizonRow = this.shore;
    const r = mulberry32(61);
    this.trees = new Int16Array(cols).fill(this.shore);
    for (let cx = -4; cx < cols + 4; cx += 2 + Math.floor(r() * 4)) {
      const h = Math.round(rows * (0.04 + r() * 0.09));
      for (let x = cx - h; x <= cx + h; x++) {
        if (x < 0 || x >= cols) continue;
        const top = this.shore - h + Math.round(Math.abs(x - cx) * 1.7 + ((Math.abs(x - cx) % 3) === 2 ? -1 : 0));
        if (top < this.trees[x]) this.trees[x] = top;
      }
    }
    this.I = new Float32Array(cols * rows);
    this.C = new Float32Array(cols * rows * 3);
    this.colBand = new Float32Array(cols * 6);
    this.stars = Array.from({ length: Math.round((cols * this.shore) / 70) }, () => ({
      x: Math.floor(r() * cols),
      y: Math.floor(r() * this.shore),
      b: 0.3 + r() * 0.7,
      ph: r() * 6.28,
    }));
    this.surfaces = [[0, cols - 1, this.shore + 1]];
  }

  stops(): Array<[number, RGB]> {
    return [
      [0, INK],
      [1, INK],
    ];
  }

  fogBias(y: number): number {
    const d = (y - this.shore) / (this.rows * 0.12);
    return 0.2 + 0.8 * Math.exp(-d * d);
  }

  draw(g: Grid, env: Env): void {
    const { t, w } = env;
    const { cols, rows, shore } = this;
    const veil = Math.max(0, 1 - (w.cloud * 0.7 + w.rain + w.snow * 0.4 + w.fog * 0.6));
    // Per-column curtain strength and ray texture for three bands.
    for (let x = 0; x < cols; x++) {
      for (let k = 0; k < 3; k++) {
        const s = 1.3 * smoothstep(0.3, 0.66, fbm(x * 0.006 + k * 9.3 - t * 0.035 * (k + 1), k * 4.1 + t * 0.02, 3, 13));
        const ray = 0.6 + 0.4 * noise2(x * 0.42, t * 0.7 + k * 7, 29);
        this.colBand[x * 6 + k * 2] = s * ray * veil;
        this.colBand[x * 6 + k * 2 + 1] =
          shore - rows * (0.1 + 0.12 * k) + rows * 0.07 * Math.sin(x * 0.011 * (k + 1) + t * 0.05 + k * 2) + rows * 0.03 * noise2(x * 0.03, t * 0.1 + k, 31);
      }
    }
    // Aurora intensity + color for every sky cell.
    const I = this.I;
    const C = this.C;
    for (let y = 0; y < shore; y++) {
      for (let x = 0; x < cols; x++) {
        let tot = 0;
        let r = 0;
        let gg = 0;
        let b = 0;
        for (let k = 0; k < 3; k++) {
          const s = this.colBand[x * 6 + k * 2];
          if (s < 0.02) continue;
          const base = this.colBand[x * 6 + k * 2 + 1];
          const H = rows * (0.2 + 0.08 * k);
          const h = (base - y) / H;
          if (h < -0.06 || h > 1) continue;
          const p = h < 0 ? 1 + h / 0.06 : h < 0.07 ? 1 : Math.pow(1 - (h - 0.07) / 0.93, 1.7);
          const v = s * p;
          const c = h < 0.04 ? mix(PINK, GREEN, Math.max(0, h) / 0.04) : h < 0.45 ? mix(GREEN, TEAL, (h - 0.04) / 0.41) : mix(TEAL, VIOLET, (h - 0.45) / 0.55);
          tot += v;
          r += c[0] * v;
          gg += c[1] * v;
          b += c[2] * v;
        }
        const i = y * cols + x;
        I[i] = tot;
        if (tot > 0) {
          C[i * 3] = r / tot;
          C[i * 3 + 1] = gg / tot;
          C[i * 3 + 2] = b / tot;
        }
      }
    }
    // Stars behind the aurora.
    for (const s of this.stars) {
      const i = s.y * cols + s.x;
      if (I[i] > 0.25 || s.y >= this.trees[s.x]) continue;
      const tw = s.b * (0.55 + 0.45 * Math.sin(t * (1 + s.b) + s.ph)) * (0.4 + 0.6 * veil);
      if (tw < 0.15) continue;
      g.set(s.x, s.y, tw > 0.7 ? '+' : '.', packRGB(220 * tw, 228 * tw, 255 * tw));
    }
    // Sky cells.
    for (let y = 0; y < shore; y++) {
      for (let x = 0; x < cols; x++) {
        if (y >= this.trees[x]) continue;
        const i = y * cols + x;
        this.cell(g, x, y, I[i], C[i * 3], C[i * 3 + 1], C[i * 3 + 2], false, t);
      }
    }
    // Treeline: solid black.
    for (let x = 0; x < cols; x++) for (let y = this.trees[x]; y <= shore; y++) g.blank(x, y, 0);
    // Lake: a rippled, dimmer mirror.
    for (let y = shore + 1; y < rows; y++) {
      const depth = (y - shore) / (rows - shore);
      for (let x = 0; x < cols; x++) {
        const xs = Math.min(cols - 1, Math.max(0, x + Math.round(Math.sin(y * 0.9 + t * 1.6 + x * 0.05) * (1 + depth * 2))));
        const ys = 2 * shore - y;
        if (ys < 0) continue;
        if (ys >= this.trees[xs]) {
          continue;
        }
        const i = ys * cols + xs;
        const k = 0.6 * (1 - depth * 0.5);
        this.cell(g, x, y, I[i] * k, C[i * 3], C[i * 3 + 1], C[i * 3 + 2], true, t);
      }
    }
  }

  private cell(g: Grid, x: number, y: number, v: number, r: number, gg: number, b: number, water: boolean, t: number): void {
    if (v < 0.06) {
      if (water && hash2(x, y, Math.floor(t * 2)) < 0.01) g.set(x, y, '-', packRGB(30, 40, 60));
      return;
    }
    const k = Math.min(1, v);
    const br = 0.4 + 0.6 * k;
    g.paintBack(x, y, [r, gg, b], Math.min(0.6, v * 0.45));
    const h = hash2(x, y, Math.floor(t * 5 + hash2(x, y) * 5));
    const fg = packRGB(r * br + 20 * k, gg * br + 20 * k, b * br + 20 * k);
    if (v > 0.62) {
      g.put(x, y, water ? '~' : h < 0.5 ? '|' : '!', fg, packRGB(r * 0.5 * k, gg * 0.5 * k, b * 0.5 * k));
    } else if (v > 0.32) {
      g.set(x, y, water ? '~' : h < 0.6 ? '|' : ':', fg);
    } else if (v > 0.14) {
      g.set(x, y, water ? '-' : ':', fg);
    } else if (h < 0.6) {
      g.set(x, y, '.', fg);
    }
  }
}
