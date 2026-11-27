import { mix, packRGB, type RGB, WHITE } from '../core/color';
import type { Grid } from '../core/grid';
import { INK } from '../core/render-common';
import { clamp, hash2, noise2 } from '../core/math';
import { BaseScene, type Env } from './types';

/** An open sea rolling onto a beach, with a lighthouse sweeping the dark. */
export class OceanScene extends BaseScene {
  readonly id = 'ocean' as const;
  skyInk = 0.3;
  private shore = 0;
  private cliff = new Int16Array(0);
  private night = 0;

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    this.sky = true;
    this.birds = true;
    this.horizonRow = Math.round(rows * 0.5);
    this.shore = Math.round(rows * 0.8);
    // A dark headland on the right with the lighthouse on top.
    this.cliff = new Int16Array(cols).fill(rows + 2);
    const x0 = Math.round(cols * 0.82);
    for (let x = x0; x < cols; x++) {
      const u = (x - x0) / (cols - x0);
      this.cliff[x] = Math.round(this.horizonRow - rows * 0.07 * Math.pow(Math.min(1, u * 2.4), 0.7) + noise2(x * 0.2, 3, 4) * 2);
    }
    this.surfaces = [[0, Math.round(cols * 0.75), this.horizonRow + 2]];
  }

  stops(env: Env): Array<[number, RGB]> {
    this.night = clamp((env.pal.lights - 0.45) / 0.45);
    this.skyInk = 0.3 + 0.7 * this.night;
    return super.stops(env).map(([o, c]) => [o, mix(c, INK, this.night * 0.7)]);
  }

  fogBias(y: number): number {
    const d = (y - this.horizonRow) / (this.rows * 0.12);
    return 0.3 + 0.7 * Math.exp(-d * d);
  }

  draw(g: Grid, env: Env): void {
    const { t, pal, w } = env;
    const { cols, rows, horizonRow: H, shore } = this;
    const night = this.night;
    const rough = 0.6 + Math.abs(w.wind) + w.storm;
    const deep = mix(mix(pal.waterBg, pal.skyBottom, 0.25), [4, 8, 16], night * 0.6);
    const crest = mix(mix(pal.water, WHITE, 0.25), [70, 90, 120], night * 0.5);
    // Open water: wave rows that get bigger and slower toward the viewer.
    for (let y = H; y < shore; y++) {
      const depth = (y - H) / (shore - H);
      const bg = mix(mix(pal.skyBottom, deep, 0.45 + 0.55 * depth), deep, 0.2);
      const bgP = packRGB(bg[0], bg[1], bg[2]);
      const fx = 0.22 - depth * 0.15;
      for (let x = 0; x < cols; x++) {
        const n = noise2(x * fx + t * 0.3 * rough, y * (1.2 - depth * 0.6) - t * 0.25, 4);
        const ch = n > 0.72 ? '~' : n > 0.64 ? '-' : n > 0.6 ? '.' : '';
        if (ch) g.put(x, y, ch, packRGB(crest[0] * (0.5 + n * 0.6), crest[1] * (0.5 + n * 0.6), crest[2] * (0.5 + n * 0.6)), bgP);
        else g.blank(x, y, bgP);
      }
    }
    // Glitter path under the sun or moon.
    const body = env.sun.visible && env.sun.alt > -0.05 ? env.sun : env.moon.visible ? env.moon : null;
    if (body) {
      const isSun = body === env.sun;
      const c = isSun ? pal.sun : pal.moon;
      const veil = clamp(1 - w.cloud * 0.8 - w.fog * 0.6 - w.rain * 0.6);
      const k = veil * (isSun ? 0.9 : 0.35 + env.time.moon.illumination * 0.6);
      for (let y = H + 1; y < shore && k > 0.05; y++) {
        const depth = (y - H) / (shore - H);
        const spread = 1 + depth * 9;
        for (let dx = -Math.ceil(spread); dx <= spread; dx++) {
          const x = Math.round(body.x) + dx;
          const n = noise2(x * 0.7, y * 1.4 - t * 2.4, 13);
          if (n < 0.42 + (Math.abs(dx) / spread) * 0.45) continue;
          g.set(x, y, n > 0.75 ? '=' : '~', packRGB(...(mix(pal.water, mix(c, WHITE, 0.3), k) as [number, number, number])));
          g.addGlow(x, y, c, 0.1 * k);
        }
      }
    }
    // Beach with surf washing up and drawing back.
    const sand = mix(mix([214, 190, 150], pal.ground, 0.25), [26, 28, 38], night * 0.85);
    const wet = mix(sand, deep, 0.45);
    const foam = mix([240, 246, 250], [120, 140, 170], night * 0.6);
    for (let x = 0; x < cols; x++) {
      const reach = (Math.sin(t * 0.45 + x * 0.015) * 0.5 + 0.5) * (rows - shore) * 0.55 + noise2(x * 0.08, t * 0.2, 7) * 2;
      const edge = shore + reach;
      for (let y = shore; y < rows; y++) {
        if (y < edge - 0.5) {
          const fade = (edge - y) / Math.max(1, reach);
          const isFoam = y > edge - 2.5 || hash2(x, y, Math.floor(t * 3)) < 0.12 * (1 - fade);
          const c = isFoam ? foam : mix(deep, wet, fade * 0.5);
          g.put(x, y, isFoam ? (hash2(x, y) < 0.5 ? '~' : 'o') : ' ', packRGB(foam[0], foam[1], foam[2]), packRGB(c[0], c[1], c[2]));
        } else {
          const dampness = clamp(1 - (y - edge) / 3);
          const c = mix(sand, wet, dampness);
          g.put(x, y, hash2(x, y, 2) < 0.06 ? '.' : ' ', packRGB(c[0] * 1.2, c[1] * 1.2, c[2] * 1.2), packRGB(c[0], c[1], c[2]));
        }
      }
    }
    // Headland + lighthouse.
    const rock = mix(mix([70, 62, 60], pal.far, 0.3), [0, 0, 0], night);
    const rockP = night > 0.95 ? 0 : packRGB(rock[0], rock[1], rock[2]);
    for (let x = 0; x < cols; x++) for (let y = Math.max(0, this.cliff[x]); y < shore; y++) g.blank(x, y, rockP);
    const lx = Math.round(cols * 0.9);
    const base = this.cliff[lx];
    const th = Math.max(6, Math.round(rows * 0.13));
    for (let k = 0; k < th; k++) {
      const half = Math.max(1, Math.round(2.2 - (k / th) * 1.2));
      const band = Math.floor(k / Math.max(1, th / 5)) % 2 === 0;
      const col = band ? mix([220, 220, 214], rock, night * 0.7) : mix([196, 52, 44], rock, night * 0.7);
      for (let x = lx - half; x <= lx + half; x++) g.blank(x, base - 1 - k, packRGB(col[0], col[1], col[2]));
    }
    const ly = base - th - 1;
    g.put(lx - 1, ly - 1, '/', packRGB(60, 60, 60), 0);
    g.put(lx + 1, ly - 1, '\\', packRGB(60, 60, 60), 0);
    const L = clamp((pal.lights - 0.25) * 2);
    if (L > 0) {
      const lamp: RGB = [255, 236, 170];
      g.put(lx, ly, '@', packRGB(255, 240, 190), packRGB(255 * L, 220 * L, 140 * L));
      g.glowAt(lx, ly, 6, 4, lamp, 0.7 * L);
      // The beam sweeps round: long when it points sideways, short toward us.
      const ang = t * 0.9;
      const reachB = Math.cos(ang) * cols * 0.55;
      const steps = Math.abs(Math.round(reachB));
      for (let s = 1; s < steps; s++) {
        const x = lx + Math.sign(reachB) * s;
        const k = (1 - s / steps) * L * (0.4 + 0.6 * Math.abs(Math.cos(ang)));
        g.paintBack(x, ly, lamp, 0.35 * k);
        g.paintBack(x, ly - 1, lamp, 0.15 * k);
        g.paintBack(x, ly + 1, lamp, 0.15 * k);
        if (s % 3 === 0) g.addGlow(x, ly, lamp, 0.08 * k);
      }
    } else g.put(lx, ly, 'o', packRGB(120, 120, 110), packRGB(40, 40, 40));
  }
}
