import { hex, mix, mixPack, pack, type RGB, scale, WHITE } from '../core/color';
import type { Grid } from '../core/grid';
import { clamp, fbm, hash2, irange, mulberry32, noise2 } from '../core/math';
import { mirror, ridgeChar, windowLit } from './common';
import { BaseScene, type Env } from './types';

const HOUSE = [
  '    /\\   ',
  '   /  \\  ',
  '  /____\\ ',
  ' |[w][w]|',
  ' |[w][w]|',
  ' |_[dd]_|',
];
const PASTELS = ['#e8b4c0', '#a8d8c8', '#f2e2a0', '#b8c4ec', '#f0c8a0', '#d4b8e8'].map(hex);
const BOAT_BIG = ['    |\\    ', '    | \\   ', '    |  \\  ', '    |___\\ ', ' \\_______/'];
const BOAT_SMALL = ['  |\\  ', '  |_\\ ', ' \\__/ '];

interface Boat { x: number; y: number; big: boolean; v: number }
interface Car { x: number; dir: number; v: number }
interface House { x: number; base: number; color: RGB; seed: number }

/** The Golden Gate over the bay, with rolling marine fog. */
export class SFScene extends BaseScene {
  readonly id = 'sf' as const;
  private D = 0;
  private tTop = 0;
  private towers: number[] = [];
  private legW = 2;
  private marin = new Int16Array(0);
  private hill = new Int16Array(0);
  private city: Array<{ x: number; w: number; top: number; seed: number }> = [];
  private pyramid = { x: 0, top: 0 };
  private houses: House[] = [];
  private boats: Boat[] = [];
  private cars: Car[] = [];

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const r = mulberry32(415);
    const D = (this.D = Math.round(rows * 0.58));
    this.horizonRow = D - 1;
    this.tTop = Math.round(rows * 0.15);
    this.towers = [Math.round(cols * 0.25), Math.round(cols * 0.71)];
    this.legW = cols > 150 ? 2 : 1;

    this.marin = new Int16Array(cols).fill(this.rows);
    const mEnd = cols * 0.46;
    for (let x = 0; x < cols; x++) {
      if (x > mEnd) continue;
      const u = 1 - x / mEnd;
      this.marin[x] = Math.round(D - 1 - rows * 0.22 * Math.pow(u, 1.25) - rows * 0.035 * fbm(x * 0.06, 1, 3, 4) * u);
    }

    this.city = [];
    for (let x = Math.round(cols * 0.8); x < cols; ) {
      const w = irange(r, 3, 7);
      this.city.push({ x, w, top: D - irange(r, 2, Math.max(3, Math.round(rows * 0.09))), seed: irange(r, 1, 1e5) });
      x += w;
    }
    this.pyramid = { x: Math.round(cols * 0.9), top: D - Math.round(rows * 0.16) };

    const hx0 = Math.round(cols * 0.6);
    this.hill = new Int16Array(cols).fill(rows + 5);
    for (let x = hx0; x < cols; x++) {
      const u = (x - hx0) / (cols - hx0);
      this.hill[x] = Math.round(rows - 1 - Math.pow(u, 0.8) * rows * 0.2 - fbm(x * 0.1, 3, 2, 9) * 1.5);
    }
    this.houses = [];
    let i = 0;
    for (let x = hx0 + 6; x + 9 <= cols + 4; x += 9) {
      let base = rows;
      for (let k = 1; k < 9; k++) base = Math.min(base, this.hill[Math.min(cols - 1, x + k)] ?? rows);
      this.houses.push({ x, base: base + 1, color: PASTELS[i++ % PASTELS.length], seed: irange(r, 1, 1e5) });
    }

    this.boats = [
      { x: cols * 0.12, y: D + 4, big: false, v: 0.7 },
      { x: cols * 0.42, y: D + Math.round((rows - D) * 0.45), big: true, v: 1.2 },
      { x: cols * 0.08, y: rows - 6, big: true, v: -0.9 },
    ];
    this.cars = Array.from({ length: Math.max(6, Math.round(cols / 18)) }, () => {
      const dir = r() < 0.5 ? -1 : 1;
      return { x: r() * cols, dir, v: 6 + r() * 5 };
    });
    this.surfaces = [
      [0, cols - 1, D + 3],
      [0, Math.round(cols * 0.58), D + Math.round((rows - D) * 0.5)],
      [0, Math.round(cols * 0.58), rows - 2],
    ];
  }

  ambientFog(env: Env): number {
    const h = env.time.hour;
    return 0.1 + 0.5 * Math.exp(-(((h - 8) / 2.4) ** 2)) + 0.35 * Math.exp(-(((h - 19.5) / 2) ** 2));
  }

  fogBias(y: number): number {
    const c = (this.tTop + this.D) / 2;
    const d = (y - c) / (this.rows * 0.17);
    const w = (y - this.D - 2) / (this.rows * 0.12);
    return Math.min(1, 0.22 + 0.78 * Math.exp(-d * d) + 0.4 * Math.exp(-w * w));
  }

  private cableY(x: number): number {
    const [T1, T2] = this.towers;
    const yTop = this.tTop + 1;
    const yLow = this.D - 2;
    if (x >= T1 && x <= T2) {
      const u = (x - (T1 + T2) / 2) / ((T2 - T1) / 2);
      return yLow - (yLow - yTop) * u * u;
    }
    const yA = this.D - 1;
    if (x < T1) {
      const xa = -this.cols * 0.08;
      const u = (T1 - x) / (T1 - xa);
      return yTop + (yA - yTop) * u + 2.5 * 4 * u * (1 - u);
    }
    const xa = this.cols * 1.08;
    const u = (x - T2) / (xa - T2);
    return yTop + (yA - yTop) * u + 2.5 * 4 * u * (1 - u);
  }

  draw(g: Grid, env: Env): void {
    const p = env.pal;
    const L = p.lights;
    const D = this.D;
    // Marin headlands.
    const mEdge = mixPack(p.skyBottom, p.far, 0.85);
    const mBg = mixPack(p.skyBottom, p.farBg, 0.75);
    for (let x = 0; x < this.cols; x++) {
      const top = this.marin[x];
      if (top >= D) continue;
      const l = x > 0 ? this.marin[x - 1] : top;
      const rr = x < this.cols - 1 ? this.marin[x + 1] : top;
      for (let y = top; y < D; y++) {
        if (y === top) g.put(x, y, ridgeChar(l, top, Math.min(rr, D)), mEdge, mBg);
        else if (hash2(x, y, 6) < 0.05) g.put(x, y, '.', mEdge, mBg);
        else g.blank(x, y, mBg);
      }
    }
    // Distant city with a pyramid spire.
    const cBg = mixPack(p.skyBottom, p.farBg, 0.8);
    const cTex = mixPack(p.skyBottom, p.far, 0.7);
    for (const b of this.city) {
      for (let y = b.top; y < D; y++)
        for (let x = b.x; x < b.x + b.w; x++) {
          const lit = (x + y) % 2 === 0 && L > 0.1 && windowLit(x, y, b.seed, env.t, L * 0.6);
          g.put(x, y, lit ? '.' : (x - b.x) % 2 && hash2(x, y) < 0.4 ? '.' : ' ', lit ? pack(p.light) : cTex, cBg);
          if (lit) g.addGlow(x, y, p.light, 0.06);
        }
    }
    const { x: px, top: pt } = this.pyramid;
    for (let y = pt; y < D; y++) {
      const half = Math.floor((y - pt) / 4);
      for (let x = px - half; x <= px + half; x++) g.put(x, y, x === px - half ? '/' : x === px + half ? '\\' : ' ', cTex, cBg);
    }
    g.set(px, pt - 1, '|', cTex);
    const blink = Math.sin(env.t * 2.4) > 0.3;
    if (blink) {
      g.set(px, pt - 2, '.', pack([255, 70, 60]));
      g.addGlow(px, pt - 2, [255, 40, 30], 0.4);
    }

    this.drawWater(g, env);
    this.drawBoats(g, env);
    this.drawBridge(g, env);
    this.drawHill(g, env);
  }

  private drawWater(g: Grid, env: Env): void {
    const p = env.pal;
    const { t } = env;
    const D = this.D;
    const span = this.rows - D;
    const ripple = 0.25 + Math.abs(env.w.wind) * 0.6 + env.w.storm * 0.5;
    for (let y = D + 1; y < this.rows; y++) {
      const depth = (y - D) / span;
      const bg = mixPack(mix(p.skyBottom, p.waterBg, 0.55), p.waterBg, Math.min(1, 0.35 + depth));
      const fx = 0.16 - depth * 0.08;
      let slow = 0;
      for (let x = 0; x < this.cols; x++) {
        // Coarse second octave, evaluated every other column.
        if ((x & 1) === 0) slow = noise2(x * 0.05 - t * 0.1, y * 0.35, 9) * 0.3;
        const n = noise2(x * fx + t * ripple, y * 0.9 - t * 0.18, 5) * 0.7 + slow;
        const ch = n > 0.7 ? '~' : n > 0.62 ? '-' : n > 0.57 ? '.' : ' ';
        if (ch === ' ') g.blank(x, y, bg);
        else g.put(x, y, ch, mixPack(p.waterBg, p.water, 0.45 + 0.6 * n), bg);
      }
    }
    // Sun / moon glitter path.
    const body = env.sun.visible && env.sun.alt > -0.05 ? env.sun : env.moon.visible ? env.moon : null;
    if (body) {
      const isSun = body === env.sun;
      const c = isSun ? p.sun : p.moon;
      const veil = clamp(1 - env.w.cloud * 0.8 - env.w.fog * 0.6 - env.w.rain * 0.6);
      const k = veil * (isSun ? 0.9 : 0.4 + env.time.moon.illumination * 0.6);
      if (k > 0.05) {
        for (let y = D + 1; y < this.rows; y++) {
          const depth = (y - D) / span;
          const spread = 1 + depth * 7;
          for (let dx = -Math.ceil(spread); dx <= Math.ceil(spread); dx++) {
            const x = Math.round(body.x) + dx;
            const n = noise2(x * 0.7, y * 1.3 - t * 2.2, 13);
            if (n < 0.42 + (Math.abs(dx) / spread) * 0.45) continue;
            g.set(x, y, n > 0.75 ? '=' : '~', mixPack(p.water, mix(c, WHITE, 0.3), k));
            g.addGlow(x, y, c, 0.12 * k);
          }
        }
      }
    }
    // Bridge light reflections at night.
    const L = p.lights;
    if (L > 0.2) {
      const amber: RGB = [255, 196, 120];
      for (let x = 2; x < this.cols; x += 8) {
        for (let y = D + 3; y < Math.min(this.rows, D + 3 + span * 0.45); y++) {
          const n = noise2(x * 0.5, y * 0.8 - t * 1.6, 3);
          if (n < 0.55 + ((y - D) / span) * 0.6) continue;
          g.set(x, y, n > 0.8 ? '|' : ':', mixPack(p.water, amber, 0.7 * L));
          g.addGlow(x, y, amber, 0.12 * L);
        }
      }
    }
  }

  private drawBoats(g: Grid, env: Env): void {
    const p = env.pal;
    const L = p.lights;
    const sail = pack(mix(mix(p.fog, WHITE, 0.4), p.near, 0.5 * (1 - p.daylight)));
    const hull = pack(mix(p.near, [40, 40, 50], 0.4));
    for (const b of this.boats) {
      b.x += b.v * env.dt;
      const sprite = b.big ? BOAT_BIG : BOAT_SMALL;
      const w = sprite[0].length;
      if (b.v > 0 && b.x > this.cols + 2) b.x = -w - 2;
      if (b.v < 0 && b.x < -w - 2) b.x = this.cols + 2;
      const lines = b.v < 0 ? mirror(sprite) : sprite;
      const x0 = Math.round(b.x);
      const y0 = b.y - lines.length + 1;
      g.sprite(x0, y0, lines, (_c, _lx, ly) => (ly === lines.length - 1 ? hull : sail));
      if (L > 0.3) {
        const mx = x0 + lines[0].search(/\|/);
        g.set(mx, y0 - 1, '.', pack([255, 240, 220]));
        g.addGlow(mx, y0 - 1, [255, 240, 220], 0.35 * L);
      }
    }
  }

  private drawBridge(g: Grid, env: Env): void {
    const p = env.pal;
    const L = p.lights;
    const D = this.D;
    const intl: RGB = [196, 58, 44];
    const flood: RGB = [236, 120, 72];
    const bc = mix(mix(scale(intl, 0.45 + 0.55 * p.daylight), p.mid, 0.3), flood, 0.35 * L);
    const bcP = pack(bc);
    const bgP = mixPack(p.midBg, bc, 0.3);
    const susp = mixPack(p.skyBottom, bc, 0.4);
    const [T1, T2] = this.towers;
    const lw = this.legW;
    const half = 2 + lw;
    // Suspenders.
    for (let x = 1; x < this.cols - 1; x += 2) {
      if (Math.abs(x - T1) <= half || Math.abs(x - T2) <= half) continue;
      const yc = this.cableY(x + 0.5);
      for (let y = Math.floor(yc) + 1; y < D; y++) g.set(x, y, '|', susp);
    }
    // Main cable.
    for (let x = 0; x < this.cols; x++) {
      const y = this.cableY(x + 0.5);
      const yn = this.cableY(x + 1.5);
      const s = yn - y;
      if (Math.abs(s) <= 0.5) {
        const row = Math.floor(y);
        g.set(x, row, y - row < 0.5 ? '-' : '_', bcP);
      } else {
        const ch = s > 0 ? '\\' : '/';
        const ya = Math.round(y);
        const yb = Math.round(yn);
        for (let yy = Math.min(ya, yb); yy <= Math.max(ya, yb) - (Math.abs(yb - ya) > 0 ? 1 : 0); yy++) g.set(x, yy, ch, bcP);
        g.set(x, ya, ch, bcP);
      }
    }
    // Towers.
    const h = D - this.tTop;
    const beams = [0, 0.3, 0.55, 0.78].map((f) => this.tTop + Math.round(h * f));
    for (const T of [T1, T2]) {
      const legs = lw === 2 ? [T - 3, T - 2, T + 2, T + 3] : [T - 2, T + 2];
      for (let y = this.tTop; y <= D + 2; y++) {
        for (const lx of legs) g.put(lx, y, '|', bcP, bgP);
        if (beams.includes(y)) for (let x = legs[lw - 1] + 1; x < legs[lw]; x++) g.put(x, y, '=', bcP, bgP);
      }
      for (const lx of legs) g.set(lx, this.tTop - 1, '_', bcP);
      const on = Math.sin(env.t * 2 + T) > 0.25;
      for (const bx of [legs[0], legs[legs.length - 1]]) {
        g.set(bx, this.tTop - 2, '.', on ? pack([255, 70, 60]) : bcP);
        if (on) g.addGlow(bx, this.tTop - 2, [255, 40, 30], 0.45);
      }
      if (L > 0.2) for (let y = this.tTop; y < D; y += 2) g.glowAt(T, y, 3, 1.5, flood, 0.06 * L);
      const stone = mixPack(p.midBg, [120, 116, 110], 0.4);
      g.text(T - half - 1, D + 3, `[${'_'.repeat(half * 2 + 1)}]`, stone, mixPack(p.midBg, [80, 78, 74], 0.3));
    }
    // Deck, truss and lamps.
    const lamp: RGB = [255, 196, 120];
    for (let x = 0; x < this.cols; x++) {
      g.put(x, D, '=', bcP, bgP);
      g.put(x, D + 1, x % 2 ? '/' : '\\', mixPack(p.midBg, bc, 0.6), bgP);
      if (x % 4 === 0) {
        g.set(x, D - 1, '.', mixPack(p.mid, lamp, 0.2 + 0.8 * L));
        if (L > 0.2) g.addGlow(x, D - 1, lamp, 0.22 * L);
      }
    }
    // Traffic.
    for (const c of this.cars) {
      c.x += c.dir * c.v * env.dt;
      if (c.x > this.cols + 2) c.x = -2;
      if (c.x < -2) c.x = this.cols + 2;
      const col: RGB = c.dir > 0 ? [255, 246, 214] : [255, 70, 60];
      if (L > 0.2) {
        g.set(c.x, D, '-', pack(col));
        g.addGlow(Math.round(c.x), D, col, 0.25 * L);
      } else g.set(c.x, D, '-', pack(mix(p.near, [30, 30, 36], 0.5)));
    }
  }

  private drawHill(g: Grid, env: Env): void {
    const p = env.pal;
    const L = p.lights;
    const day = p.daylight;
    const bg = pack(p.groundBg);
    const grass = mixPack(p.groundBg, p.ground, 0.7);
    for (let x = 0; x < this.cols; x++) {
      const top = this.hill[x];
      if (top >= this.rows) continue;
      const l = x > 0 ? this.hill[x - 1] : top;
      const r = x < this.cols - 1 ? this.hill[x + 1] : top;
      for (let y = top; y < this.rows; y++) {
        if (y === top) g.put(x, y, ridgeChar(Math.min(l, this.rows), top, Math.min(r, this.rows)), grass, bg);
        else if (hash2(x, y, 21) < 0.08) g.put(x, y, ',', grass, bg);
        else g.blank(x, y, bg);
      }
    }
    for (const h of this.houses) {
      const wall = mix(scale(h.color, 0.3 + 0.7 * Math.pow(day, 0.7)), p.near, 0.25);
      const wallP = pack(wall);
      const wallBg = mixPack(p.nearBg, h.color, 0.1 + 0.45 * day);
      const trim = pack(mix(wall, WHITE, 0.3 * day));
      const y0 = h.base - HOUSE.length;
      for (let ly = 0; ly < HOUSE.length; ly++) {
        const line = HOUSE[ly];
        const first = line.search(/\S/);
        const last = line.length - 1 - (line.length - line.trimEnd().length);
        for (let lx = 0; lx < line.length; lx++) {
          const c = line[lx];
          const x = h.x + lx;
          const y = y0 + ly;
          if (c === 'w') {
            const lit = L > 0.1 && windowLit(x, y, h.seed, env.t, 0.25 + L * 0.65);
            if (lit) {
              g.put(x, y, ' ', 0, mixPack([60, 40, 30], p.light, 0.5 + 0.5 * L));
              g.addGlow(x, y, p.light, 0.25 * L);
            } else g.put(x, y, ' ', 0, mixPack(p.skyBottom, [30, 36, 50], 0.6));
          } else if (c === 'd') g.put(x, y, ' ', 0, mixPack(p.nearBg, h.color, 0.05 + 0.2 * day));
          else if (c === ' ') {
            if (lx > first && lx < last) g.blank(x, y, wallBg);
          } else g.put(x, y, c, ly < 3 ? trim : wallP, wallBg);
        }
      }
    }
  }
}
