import { packRGB, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { INK } from '../core/render-common';
import { hash2, mulberry32 } from '../core/math';
import { BaseScene, type Env } from './types';

const CORE = '.:;+=*%#';
const MID = ':;+=';
const EDGE = ".,'`";

export interface ResolveOpts {
  /** Additive glow per unit density (bioluminescence). */
  glow?: number;
  /** Chance per core cell per second of a white glint. */
  sparkle?: number;
  /** Density at which cells become solid tiles. */
  tile?: number;
}

/**
 * Creatures splat soft density + color into this field; `resolve` turns it
 * into the tiled-ink look: solid color tiles with bright glyphs in the body,
 * glyph-only cells toward the edges, sparse dots at the fringe.
 */
export class InkField {
  cols = 0;
  rows = 0;
  aspect = 1.2;
  d = new Float32Array(0);
  r = new Float32Array(0);
  g = new Float32Array(0);
  b = new Float32Array(0);
  private x0 = 0;
  private y0 = 0;
  private x1 = -1;
  private y1 = -1;

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.d = new Float32Array(n);
    this.r = new Float32Array(n);
    this.g = new Float32Array(n);
    this.b = new Float32Array(n);
    this.x1 = this.y1 = -1;
  }

  add(x: number, y: number, dens: number, c: RGB): void {
    if (dens <= 0 || x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x;
    this.d[i] += dens;
    this.r[i] += c[0] * dens;
    this.g[i] += c[1] * dens;
    this.b[i] += c[2] * dens;
    if (this.x1 < this.x0) {
      this.x0 = this.x1 = x;
      this.y0 = this.y1 = y;
    } else {
      if (x < this.x0) this.x0 = x;
      if (x > this.x1) this.x1 = x;
      if (y < this.y0) this.y0 = y;
      if (y > this.y1) this.y1 = y;
    }
  }

  /**
   * Rotated soft ellipse. Sizes are in cell widths; `angle` is the direction of
   * the long axis in visual space (y down). `color` may vary per cell via (u, v)
   * in -1..1 along / across the shape; returning null leaves that cell out.
   */
  oval(
    cx: number,
    cy: number,
    angle: number,
    ru: number,
    rv: number,
    k: number,
    color: RGB | ((u: number, v: number) => RGB | null),
  ): void {
    const a = this.aspect;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const rm = Math.max(ru, rv);
    const xa = Math.floor(cx - rm);
    const xb = Math.ceil(cx + rm);
    const ya = Math.floor(cy - rm / a);
    const yb = Math.ceil(cy + rm / a);
    for (let y = ya; y <= yb; y++) {
      const dy = (y - cy) * a;
      for (let x = xa; x <= xb; x++) {
        const dx = x - cx;
        const u = (dx * ca + dy * sa) / ru;
        const v = (-dx * sa + dy * ca) / rv;
        const q = u * u + v * v;
        if (q >= 1) continue;
        const c = typeof color === 'function' ? color(u, v) : color;
        if (c) this.add(x, y, k * (1 - q * q), c);
      }
    }
  }

  /** Thin line of density (fins, tentacles, tails). */
  line(x0: number, y0: number, x1: number, y1: number, k: number, c: RGB): void {
    const a = this.aspect;
    const len = Math.hypot(x1 - x0, (y1 - y0) * a);
    const steps = Math.max(1, Math.ceil(len * 1.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.add(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), k, c);
    }
  }

  resolve(g: Grid, t: number, dt: number, o: ResolveOpts = {}): void {
    if (this.x1 < this.x0) return;
    const tile = o.tile ?? 0.62;
    const glow = o.glow ?? 0;
    const spark = (o.sparkle ?? 0) * dt;
    const { cols } = this;
    for (let y = this.y0; y <= this.y1; y++) {
      for (let x = this.x0; x <= this.x1; x++) {
        const i = y * cols + x;
        const d = this.d[i];
        if (d <= 0.06) {
          if (d > 0) this.d[i] = this.r[i] = this.g[i] = this.b[i] = 0;
          continue;
        }
        const r = this.r[i] / d;
        const gg = this.g[i] / d;
        const b = this.b[i] / d;
        const h = hash2(x, y, 7);
        const slot = Math.floor(t * 4 + h * 4);
        const hh = hash2(x + slot * 31, y, 11);
        if (d >= tile) {
          const k = Math.min(1, (d - tile) / (1 - tile + 0.4));
          const ch = CORE[Math.min(CORE.length - 1, Math.floor((0.35 + 0.65 * hh) * k * CORE.length + hh * 2))];
          const bright = hh < spark * 40 ? 1 : 0;
          g.put(
            x,
            y,
            bright ? '*' : ch,
            bright ? packRGB(255, 255, 255) : packRGB(r * 1.35 + 30, gg * 1.35 + 30, b * 1.35 + 30),
            packRGB(r * 0.72 + INK[0], gg * 0.72 + INK[1], b * 0.72 + INK[2]),
          );
        } else if (d >= 0.28) {
          g.set(x, y, MID[Math.floor(hh * MID.length)], packRGB(r, gg, b));
        } else {
          if (hh < 0.55) g.set(x, y, EDGE[Math.floor(hh * 7) % EDGE.length], packRGB(r * 0.75, gg * 0.75, b * 0.75));
        }
        if (glow > 0) g.addGlow(x, y, [r, gg, b], glow * Math.min(1, d));
        this.d[i] = this.r[i] = this.g[i] = this.b[i] = 0;
      }
    }
    this.x1 = this.y1 = -1;
  }
}

/** Drifting specks (marine snow, pollen, dust). */
export class Specks {
  private ps: Array<{ x: number; y: number; z: number; ph: number }> = [];

  place(cols: number, rows: number, n: number, seed = 3): void {
    const r = mulberry32(seed);
    this.ps = Array.from({ length: n }, () => ({ x: r() * cols, y: r() * rows, z: r(), ph: r() * 6.28 }));
  }

  draw(g: Grid, env: Env, color: RGB, vx: number, vy: number): void {
    const { cols, rows } = g;
    for (const p of this.ps) {
      p.x += (vx * (0.4 + p.z) + Math.sin(env.t * 0.4 + p.ph) * 0.3) * env.dt;
      p.y += vy * (0.4 + p.z) * env.dt;
      if (p.x < 0) p.x += cols;
      if (p.x >= cols) p.x -= cols;
      if (p.y < 0) p.y += rows;
      if (p.y >= rows) p.y -= rows;
      const b = 0.25 + 0.5 * p.z * (0.6 + 0.4 * Math.sin(env.t * 1.3 + p.ph));
      g.set(p.x, p.y, p.z > 0.85 ? '+' : '.', packRGB(color[0] * b, color[1] * b, color[2] * b));
    }
  }
}

/** Base for creature scenes floating on pure black. */
export abstract class AbyssScene extends BaseScene {
  protected field = new InkField();

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    this.sky = false;
    this.birds = false;
    this.rainScale = 0.45;
    this.horizonRow = 0;
    this.surfaces = [];
    this.field.resize(cols, rows);
  }

  stops(): Array<[number, RGB]> {
    return [
      [0, INK],
      [1, INK],
    ];
  }

  fogBias(): number {
    return 0.55;
  }

  protected prep(env: Env): void {
    this.field.aspect = env.aspect;
  }
}
