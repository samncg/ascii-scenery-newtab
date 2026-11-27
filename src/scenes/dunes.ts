import { mix, packRGB, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { INK } from '../core/render-common';
import { clamp, fbm, hash2, mulberry32 } from '../core/math';
import { BaseScene, type Env } from './types';

interface Layer { base: number; amp: number; freq: number; ph: number; depth: number }

const SAND: RGB = [244, 188, 120];
const SHADE: RGB = [150, 92, 70];
const NIGHT_SAND: RGB = [58, 64, 96];

/** Rolling desert dunes with sharp crests, lit by the real sun and moon. */
export class DunesScene extends BaseScene {
  readonly id = 'dunes' as const;
  skyInk = 0.3;
  private layers: Layer[] = [];
  private grains: Array<{ x: number; y: number; age: number }> = [];
  private night = 0;

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    this.sky = true;
    this.birds = false;
    this.horizonRow = Math.round(rows * 0.6);
    const r = mulberry32(1234);
    this.layers = [0, 1, 2, 3].map((i) => ({
      base: rows * (0.6 + i * 0.1),
      amp: rows * (0.06 + i * 0.05),
      freq: 0.018 - i * 0.003,
      ph: r() * 10,
      depth: i / 3,
    }));
    this.grains = [];
    this.surfaces = [];
  }

  stops(env: Env): Array<[number, RGB]> {
    this.night = clamp((env.pal.lights - 0.45) / 0.45);
    this.skyInk = 0.3 + 0.7 * this.night;
    return super.stops(env).map(([o, c]) => [o, mix(c, INK, this.night * 0.7)]);
  }

  fogBias(y: number): number {
    const d = (y - this.horizonRow) / (this.rows * 0.15);
    return 0.3 + 0.7 * Math.exp(-d * d);
  }

  /** Dune crest height: gentle windward slope, steep slip face. */
  private crest(L: Layer, x: number): number {
    const u = x * L.freq + L.ph;
    const w = u - Math.floor(u);
    const prof = w < 0.72 ? Math.pow(w / 0.72, 1.25) : Math.pow(1 - (w - 0.72) / 0.28, 0.75);
    return L.base - L.amp * (0.35 + 0.65 * prof) - L.amp * 0.4 * fbm(x * 0.02 + L.ph, L.ph, 2, 3);
  }

  draw(g: Grid, env: Env): void {
    const { dt, pal, w } = env;
    const { cols, rows } = this;
    const night = this.night;
    // The low sun (or moon) decides which faces are lit.
    const light = env.sun.visible && env.sun.alt > -0.05 ? env.sun : env.moon;
    const lightX = light.x;
    // When the light is under the horizon, treat it as just above it.
    const lightY = Math.min(light.y, this.horizonRow - 2);
    const a = env.aspect;
    const golden = clamp((0.85 - pal.daylight) * 2) * (1 - night);
    const lit = mix(mix(SAND, [255, 168, 96], golden * 0.6), NIGHT_SAND, night);
    const dark = mix(mix(SHADE, [120, 60, 70], golden * 0.5), [22, 24, 40], night);
    for (const L of this.layers) {
      const haze = (1 - L.depth) * 0.55;
      const tops = new Float32Array(cols);
      for (let x = 0; x < cols; x++) tops[x] = this.crest(L, x);
      for (let x = 0; x < cols; x++) {
        const slope = (tops[Math.min(cols - 1, x + 1)] - tops[Math.max(0, x - 1)]) / 2;
        // Lambert lighting: surface normal (screen y points down) against the
        // direction to the sun or moon, so a high sun lights almost everything
        // and a low one leaves the far-side slip faces in shadow.
        const sv = slope * a;
        const nl = Math.hypot(sv, 1);
        const lx = lightX - x;
        const ly = (lightY - tops[x]) * a;
        const ll = Math.hypot(lx, ly) || 1;
        const diffuse = (sv * lx - ly) / (nl * ll);
        const facing = clamp(0.12 + 0.88 * diffuse);
        const c0 = mix(mix(dark, lit, facing), pal.skyBottom, haze);
        const y0 = Math.max(0, Math.round(tops[x]));
        for (let y = y0; y < rows; y++) {
          // Light and shade only near the crest; the body below settles to a mid tone.
          const k = (y - y0) / Math.max(1, L.amp * 0.45);
          const body = mix(mix(mix(dark, lit, 0.45), pal.skyBottom, haze), dark, clamp((y - y0) / (L.amp * 3)) * 0.4);
          const c = mix(c0, body, clamp(k));
          const bg = packRGB(c[0], c[1], c[2]);
          const ripple = Math.sin(x * 0.5 + y * 2.2 + L.ph * 7) > 0.92 - L.depth * 0.08;
          if (y === y0) g.put(x, y, slope < -0.25 ? '/' : slope > 0.25 ? '\\' : '_', packRGB(c[0] * 1.2 + 16, c[1] * 1.2 + 14, c[2] * 1.2 + 10), bg);
          else if (ripple && L.depth > 0.3) g.put(x, y, '~', packRGB(c[0] * 1.15 + 10, c[1] * 1.15 + 8, c[2] * 1.15 + 6), bg);
          else g.blank(x, y, bg);
        }
        // Sand blowing off the nearest crests in the wind.
        if (L.depth > 0.6 && Math.random() < dt * Math.abs(w.wind) * 2.5 && slope < -0.1) this.grains.push({ x, y: y0, age: 0 });
      }
    }
    const sandC = mix(lit, [255, 255, 255], 0.3);
    for (const p of this.grains) {
      p.age += dt;
      p.x += w.wind * 9 * dt;
      p.y -= dt * 0.8;
      const k = 1 - p.age / 1.4;
      if (k > 0) g.set(p.x, p.y, hash2(p.x | 0, p.y | 0) < 0.5 ? '.' : "'", packRGB(sandC[0] * k, sandC[1] * k, sandC[2] * k));
    }
    this.grains = this.grains.filter((p) => p.age < 1.4).slice(-400);
  }
}
