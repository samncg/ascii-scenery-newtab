import { mix, mixPack, pack, type RGB, scale, WHITE } from '../core/color';
import type { Grid } from '../core/grid';
import { clamp, fbm, hash2, irange, mulberry32 } from '../core/math';
import { Fireflies, Plume, drawPine, drawRidge, ridge } from './common';
import { BaseScene, type Env } from './types';

interface Pine { x: number; base: number; h: number; seed: number; ph: number; layer: number }

/** An A-frame cabin among swaying pines. */
export class CabinScene extends BaseScene {
  readonly id = 'cabin' as const;
  private G = 0;
  private mtn: Int16Array = new Int16Array(0);
  private hills: Int16Array = new Int16Array(0);
  private pines: Pine[] = [];
  private cabin = { cx: 0, top: 0, rh: 10, chimX: 0, chimTop: 0 };
  private smoke = new Plume(5, 5.5, 1.7, 0.9, 3);
  private flies = new Fireflies(24, 5);

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const r = mulberry32(4242);
    this.G = Math.round(rows * 0.8);
    this.horizonRow = Math.round(rows * 0.62);
    // A range of tent-shaped peaks (clean / \ slopes) with a little noise.
    const peaks = [
      [0.12, 0.75, 0.22],
      [0.33, 0.55, 0.16],
      [0.58, 1, 0.24],
      [0.8, 0.7, 0.18],
      [0.97, 0.85, 0.2],
    ];
    this.mtn = new Int16Array(cols);
    for (let x = 0; x < cols; x++) {
      const u = x / cols;
      let m = 0.1;
      for (const [px, ph, pw] of peaks) m = Math.max(m, ph * Math.max(0, 1 - Math.abs(u - px) / pw));
      m += (fbm(x * 0.08, 3.7, 2, 3) - 0.5) * 0.12;
      this.mtn[x] = Math.round(rows * 0.63 - rows * 0.38 * m);
    }
    this.hills = ridge(cols, Math.round(rows * 0.67), rows * 0.08, 0.035, 8, 3);
    const rh = clamp(Math.round(rows * 0.25), 11, 60);
    const cx = Math.round(cols * 0.42);
    const top = this.G - rh;
    const chimX = cx + Math.round(rh * 0.42);
    this.cabin = { cx, top, rh, chimX, chimTop: top + (chimX - cx) - 4 };

    this.pines = [];
    // Treeline on the hills.
    for (let x = 1; x < cols; x += irange(r, 2, 4)) {
      this.pines.push({ x, base: this.hills[x] + 1, h: irange(r, 3, 6), seed: irange(r, 1, 1e5), ph: r() * 6, layer: 0 });
    }
    // Mid forest around the cabin.
    const gap0 = cx - rh - 5;
    const gap1 = cx + rh + 5;
    for (let x = 4; x < cols - 2; x += irange(r, 6, 12)) {
      if (x > gap0 && x < gap1) continue;
      this.pines.push({
        x,
        base: this.G + irange(r, -2, 1),
        h: irange(r, Math.round(rows * 0.16), Math.round(rows * 0.36)),
        seed: irange(r, 1, 1e5),
        ph: r() * 6,
        layer: 1,
      });
    }
    // Two pines just behind the cabin.
    this.pines.push({ x: gap0 + 2, base: this.G - 2, h: Math.round(rows * 0.3), seed: 71, ph: 1, layer: 1 });
    this.pines.push({ x: gap1 - 1, base: this.G - 1, h: Math.round(rows * 0.26), seed: 73, ph: 2, layer: 1 });
    // Foreground giants at the edges.
    this.pines.push({ x: 4, base: rows + 1, h: Math.round(rows * 0.78), seed: 91, ph: 0.3, layer: 2 });
    this.pines.push({ x: cols - 5, base: rows + 2, h: Math.round(rows * 0.7), seed: 93, ph: 1.7, layer: 2 });
    this.pines.sort((a, b) => a.layer - b.layer || a.base - b.base);

    this.surfaces = [[0, cols - 1, this.G]];
    this.flies.place(4, this.G - rows * 0.25, cols - 4, this.G + 3);
  }

  fogBias(y: number): number {
    const d = (y - (this.G - 4)) / (this.rows * 0.2);
    return 0.25 + 0.75 * Math.exp(-d * d);
  }

  draw(g: Grid, env: Env): void {
    const p = env.pal;
    const { t, w } = env;
    const rows = this.rows;
    // Mountains with snowy caps.
    const capRow = Math.round(rows * 0.38);
    drawRidge(
      g,
      this.mtn,
      this.G,
      mixPack(mix(p.far, p.moon, 0.25 * (1 - p.daylight)), p.skyBottom, 0.1),
      mixPack(p.farBg, p.far, 0.45),
      mixPack(p.skyBottom, p.farBg, 0.88),
      17,
      0.04,
    );
    const cap = pack(mix(p.snow, p.skyBottom, 0.25));
    for (let x = 0; x < this.cols; x++) {
      const top = this.mtn[x];
      if (top < capRow) {
        g.tint(x, top, p.snow, 0.8);
        if (hash2(x, 4, 2) < 0.5) g.set(x, top + 1, '.', cap);
      }
    }
    // Hills.
    drawRidge(g, this.hills, this.G, mixPack(p.farBg, p.mid, 0.7), mixPack(p.midBg, p.mid, 0.4), pack(p.midBg), 29, 0.05);

    // Sway scales with tree height (in cells), so it reads at any density.
    const gust = 0.45 + Math.abs(w.wind) * 1.5 + w.storm * 0.8;
    const sway = (ph: number, h: number) => h * (0.05 * gust * Math.sin(t * (0.6 + Math.abs(w.wind) * 0.6) + ph) + 0.03 * w.wind);

    for (const pine of this.pines) {
      if (pine.layer !== 0) continue;
      drawPine(g, pine.x, pine.base, pine.h, mixPack(p.midBg, p.mid, 0.75), mixPack(p.midBg, p.mid, 0.4), pack(p.midBg), sway(pine.ph, pine.h * 0.6), pine.seed);
    }
    this.drawGround(g, env);
    for (const pine of this.pines) {
      if (pine.layer !== 1) continue;
      const edge = mixPack(p.nearBg, p.foliage, 0.85);
      const tex = mixPack(p.nearBg, p.foliage, 0.5);
      const bg = mixPack(p.nearBg, p.foliage, 0.18);
      drawPine(g, pine.x, pine.base, pine.h, edge, tex, bg, sway(pine.ph, pine.h), pine.seed);
      if (w.snow > 0.25) {
        for (let y = pine.base - pine.h; y < pine.base; y++)
          for (let x = pine.x - 8; x <= pine.x + 8; x++) if (hash2(x, y, 5) < 0.25) g.tint(x, y, p.snow, w.snow * 0.8);
      }
    }
    this.drawCabin(g, env);
    for (const pine of this.pines) {
      if (pine.layer !== 2) continue;
      const bg = mixPack(p.nearBg, [0, 0, 0], 0.4);
      drawPine(g, pine.x, pine.base, pine.h, mixPack(p.nearBg, p.foliage, 0.55), mixPack(p.nearBg, p.foliage, 0.3), bg, sway(pine.ph, pine.h * 0.8), pine.seed);
    }
    const night = clamp((p.lights - 0.55) * 2.5) * (1 - clamp(w.rain + w.snow + w.storm + w.drizzle));
    const warm = env.month >= 3 && env.month <= 9 ? 1 : 0.35;
    this.flies.draw(g, t, env.dt, night * warm);
  }

  private drawGround(g: Grid, env: Env): void {
    const p = env.pal;
    const G = this.G;
    const bg = pack(p.groundBg);
    const grass = mixPack(p.groundBg, p.ground, 0.8);
    const path = mixPack(p.groundBg, mix(p.ground, [200, 170, 120], 0.5), 0.6);
    const { cx } = this.cabin;
    const tufts = [',', '"', "'", '.'];
    for (let y = G; y < this.rows; y++) {
      const spread = 2 + (y - G) * 1.6;
      for (let x = 0; x < this.cols; x++) {
        if (Math.abs(x - cx + 0.5) < spread && y > G) {
          g.put(x, y, hash2(x, y, 8) < 0.35 ? '.' : ':', path, bg);
          continue;
        }
        const h = hash2(x, y, 12);
        if (h < 0.16) g.put(x, y, tufts[(h * 100) & 3], grass, bg);
        else g.blank(x, y, bg);
      }
    }
  }

  private drawCabin(g: Grid, env: Env): void {
    const p = env.pal;
    const L = p.lights;
    const { cx, top, rh, chimX, chimTop } = this.cabin;
    const day = p.daylight;
    const woodBase: RGB = [150, 98, 62];
    const wood = mix(scale(woodBase, 0.35 + 0.65 * day), p.near, 0.25);
    const woodP = pack(wood);
    const woodBg = mixPack(p.nearBg, woodBase, 0.12 + 0.4 * day);
    const plank = mixPack(p.nearBg, wood, 0.45);
    const roofRGB = mix(mix(scale([92, 62, 52], 0.4 + 0.6 * day), p.near, 0.2), p.snow, clamp(env.w.snow * 0.9));
    const roof = pack(roofRGB);
    const roofBg = mixPack(p.nearBg, roofRGB, 0.3);
    const lit = p.light;
    const glass = mixPack(p.skyBottom, [30, 40, 55], 0.5);
    const litBg = mixPack([60, 40, 30], lit, 0.35 + 0.6 * L);
    const kw0 = Math.round(rh * 0.3);
    const kw1 = Math.round(rh * 0.62);
    const kMid = Math.round((kw0 + kw1) / 2);
    for (let k = 0; k < rh; k++) {
      const y = top + k;
      const xl = cx - k - 1;
      const xr = cx + k;
      g.put(xl, y, '/', roof, roofBg);
      g.put(xr, y, '\\', roof, roofBg);
      if (k > 0) {
        g.put(xl - 1, y, '/', roof, roofBg);
        g.put(xr + 1, y, '\\', roof, roofBg);
      }
      for (let x = xl + 1; x < xr; x++) {
        const fromCenter = Math.abs(x - cx + 0.5);
        const inWin = k >= kw0 && k <= kw1 && fromCenter < k - 2.5;
        if (inWin) {
          if (x === cx - 1 || x === cx) g.put(x, y, '|', woodP, woodBg);
          else if (k === kMid) g.put(x, y, '-', woodP, L > 0.15 ? litBg : glass);
          else if (L > 0.15) {
            g.put(x, y, ' ', 0, litBg);
            g.addGlow(x, y, lit, 0.22 * L);
          } else g.put(x, y, hash2(x, y, 1) < 0.12 ? '/' : ' ', mixPack(p.skyBottom, WHITE, 0.5), glass);
          continue;
        }
        if (k === kw1 + 1 && fromCenter < k - 1.5) {
          g.put(x, y, '=', woodP, woodBg);
          continue;
        }
        g.put(x, y, (x - cx) % 3 === 0 ? '|' : ' ', plank, woodBg);
      }
    }
    // Door, side windows, porch lamp.
    const doorTop = top + rh - 4;
    for (let y = doorTop; y < top + rh; y++) {
      for (let x = cx - 2; x <= cx + 1; x++) {
        if (y === doorTop) g.put(x, y, '_', woodP, woodBg);
        else if (x === cx - 2 || x === cx + 1) g.put(x, y, '|', woodP, woodBg);
        else g.put(x, y, x === cx && y === top + rh - 2 ? 'o' : ' ', woodP, mixPack(p.nearBg, woodBase, 0.06 + 0.25 * day));
      }
    }
    for (const wx of [cx - 7, cx + 5]) {
      const y = top + rh - 3;
      g.put(wx, y, '[', woodP, woodBg);
      g.put(wx + 2, y, ']', woodP, woodBg);
      if (L > 0.15) {
        g.put(wx + 1, y, ' ', 0, litBg);
        g.addGlow(wx + 1, y, lit, 0.3 * L);
      } else g.put(wx + 1, y, ' ', 0, glass);
    }
    if (L > 0.3) {
      g.set(cx + 3, doorTop + 1, '*', pack(lit));
      g.glowAt(cx + 3, doorTop + 1, 6, 3, lit, 0.45 * L);
      g.backAt(cx, this.G, 18, 5, lit, 0.08 * L);
    }
    // Porch.
    for (let x = cx - rh - 2; x <= cx + rh + 1; x++) g.put(x, this.G, '=', woodP, woodBg);
    g.text(cx - 3, this.G + 1, '[____]', woodP, woodBg);
    // Chimney on the right slope.
    const brick = mix([150, 80, 64], p.near, 0.45 - 0.3 * day);
    const brickBg = mixPack(p.nearBg, brick, 0.35);
    for (let xi = chimX; xi <= chimX + 2; xi++) {
      const roofRow = top + (xi - cx) - 2;
      for (let y = chimTop; y <= roofRow; y++) {
        const ch = y === chimTop ? '=' : xi === chimX || xi === chimX + 2 ? '|' : hash2(xi, y, 3) < 0.5 ? '_' : ' ';
        g.put(xi, y, ch, pack(brick), brickBg);
      }
    }
    const cold = env.tempC === undefined ? 0.6 : clamp((20 - env.tempC) / 20);
    this.smoke.rate = 1.5 + cold * 4 + L * 2;
    this.smoke.update(env.dt, chimX + 1, chimTop - 1, env.w.wind);
    this.smoke.draw(g, mix(p.cloudShade, p.fog, 0.6), p.skyMid);
  }
}
