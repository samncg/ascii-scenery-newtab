import { mix, mixPack, pack, type RGB, scale, WHITE } from '../core/color';
import type { Grid } from '../core/grid';
import { clamp, fbm, hash2, irange, mulberry32 } from '../core/math';
import { Fireflies, drawPine, seasonOf } from './common';
import { BaseScene, type Env } from './types';

// Eyes at row 1, cols 3 & 7; beak row 2 col 5.
const OWL = [
  ' /\\_____/\\ ',
  '( (o) (o) )',
  '(    v    )',
  ' ( v v v ) ',
  '  \\ v v /  ',
  '  `"---"\'  ',
];

// Eyes at row 2, cols 3 & 7. Rows 6-8 hold the tail (two frames).
const FOX_HEAD = [
  ' /\\     /\\ ',
  '/  \\___/  \\',
  '|  o   o  |',
  ' \\   v   / ',
  "  `.___.'  ",
  '   /   \\   ',
];
const FOX_BODY_A = [
  "  /  :  \\   .-.  ",
  ' /  | |  \\_(   ) ',
  " (__|_|__)__`-'  ",
];
const FOX_BODY_B = [
  "  /  :  \\    .-. ",
  ' /  | |  \\__(   )',
  " (__|_|__)___`-' ",
];
const MUSHROOM = [' .-. ', '(___)', '  |  '];

interface Leaf { x: number; y: number; vx: number; ph: number }

/** A fox and an owl in a quiet forest clearing. */
export class ClearingScene extends BaseScene {
  readonly id = 'clearing' as const;
  private G = 0;
  private treeline: Array<{ x: number; h: number; seed: number }> = [];
  private trunkL = { x0: 0, x1: 0 };
  private trunkR = { x0: 0, x1: 0 };
  private branch = { y: 0, x0: 0, x1: 0 };
  private owl = { x: 0, y: 0, blink: 0, next: 4, look: 0 };
  private fox = { x: 0, y: 0, blink: 0, next: 3, wag: 0, ear: 0 };
  private mushrooms: Array<{ x: number; y: number }> = [];
  private flies = new Fireflies(30, 17);
  private leaves: Leaf[] = [];

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const r = mulberry32(606);
    this.horizonRow = Math.round(rows * 0.64);
    this.G = this.horizonRow + 1;
    this.treeline = [];
    for (let x = 0; x < cols; x += irange(r, 2, 4)) this.treeline.push({ x, h: irange(r, 4, 9), seed: irange(r, 1, 1e5) });
    const lw = Math.max(7, Math.round(cols * 0.07));
    const rw = Math.max(8, Math.round(cols * 0.08));
    this.trunkL = { x0: Math.round(cols * 0.04), x1: Math.round(cols * 0.04) + lw };
    this.trunkR = { x0: cols - Math.round(cols * 0.05) - rw, x1: cols - Math.round(cols * 0.05) };
    const by = Math.round(rows * 0.38);
    this.branch = { y: by, x0: this.trunkR.x0 - Math.round(cols * 0.22), x1: this.trunkR.x0 };
    this.owl.x = this.branch.x0 + Math.round((this.branch.x1 - this.branch.x0) * 0.4);
    this.owl.y = by - OWL.length;
    const foxH = FOX_HEAD.length + 3;
    this.fox.x = Math.round(cols * 0.36);
    this.fox.y = Math.min(rows - foxH - 1, this.G + Math.round((rows - this.G) * 0.35));
    this.mushrooms = [
      { x: this.trunkL.x1 + 2, y: rows - 5 },
      { x: this.trunkR.x0 - 7, y: rows - 4 },
      { x: Math.round(cols * 0.6), y: this.G + 3 },
    ];
    this.flies.place(this.trunkL.x1, Math.round(rows * 0.45), this.trunkR.x0, rows - 2);
    this.leaves = Array.from({ length: 12 }, () => ({ x: r() * cols, y: r() * rows, vx: 0, ph: r() * 6 }));
    this.surfaces = [
      [this.branch.x0, this.branch.x1, this.branch.y],
      [this.trunkL.x1, this.trunkR.x0, this.G + 1],
    ];
  }

  stops(env: Env): Array<[number, RGB]> {
    // Real daylight sky; the ink only takes over toward night.
    this.skyInk = 1 - 0.8 * env.pal.daylight;
    return super.stops(env);
  }

  fogBias(y: number): number {
    const d = (y - this.G) / (this.rows * 0.2);
    return 0.3 + 0.7 * Math.exp(-d * d);
  }

  draw(g: Grid, env: Env): void {
    const p = env.pal;
    const { t, w } = env;
    // Far treeline.
    for (const tr of this.treeline) {
      drawPine(g, tr.x, this.G, tr.h, mixPack(p.skyBottom, p.mid, 0.7), mixPack(p.skyBottom, p.mid, 0.45), mixPack(p.skyBottom, p.midBg, 0.85), 0, tr.seed);
    }
    this.drawMeadow(g, env);
    this.drawTrunks(g, env);
    this.drawCanopy(g, env);
    this.drawOwl(g, env);
    this.drawFox(g, env);
    for (const m of this.mushrooms) {
      const cap = pack(mix(mix([200, 70, 60], p.near, 0.5 - 0.4 * p.daylight), p.moon, 0.1));
      g.sprite(m.x, m.y, MUSHROOM.slice(0, 2), cap, pack(scale(mix([200, 70, 60], p.near, 0.6), 0.6)), true);
      g.sprite(m.x, m.y + 2, MUSHROOM.slice(2), pack(mix([230, 220, 200], p.near, 0.6 - 0.4 * p.daylight)));
    }
    const night = clamp((p.lights - 0.55) * 2.5) * (1 - clamp(w.rain + w.snow + w.storm + w.drizzle));
    const warm = env.month >= 3 && env.month <= 9 ? 1 : 0.4;
    this.flies.draw(g, t, env.dt, night * warm);
    this.drawLeaves(g, env);
  }

  private drawMeadow(g: Grid, env: Env): void {
    const p = env.pal;
    const { t, w } = env;
    const G = this.G;
    const bg = pack(p.groundBg);
    const grassRGB = mix(p.ground, p.foliage, 0.4);
    const span = this.rows - G;
    const flowers: RGB[] = [[240, 220, 120], [230, 150, 200], [200, 200, 255]];
    const season = seasonOf(env.month);
    for (let y = G; y < this.rows; y++) {
      const near = (y - G) / span;
      const density = 0.06 + near * 0.42;
      const c = mixPack(p.groundBg, grassRGB, 0.5 + near * 0.45);
      for (let x = 0; x < this.cols; x++) {
        const h = hash2(x, y, 31);
        if (h > density) {
          g.blank(x, y, bg);
          continue;
        }
        if (h < 0.004 && (season === 'spring' || season === 'summer')) {
          const fc = flowers[(x + y) % 3];
          g.put(x, y, '*', mixPack(p.groundBg, fc, 0.4 + 0.5 * p.daylight), bg);
          continue;
        }
        const s = Math.sin(t * 1.4 + x * 0.21 + y * 0.6) * (0.3 + Math.abs(w.wind)) + w.wind * 0.6;
        const ch = near < 0.25 ? (h < density * 0.5 ? ',' : '.') : s > 0.35 ? '/' : s < -0.35 ? '\\' : '|';
        g.put(x, y, ch, c, bg);
      }
    }
  }

  private drawTrunks(g: Grid, env: Env): void {
    const p = env.pal;
    const bark = mix(mix([72, 58, 54], [156, 118, 86], p.daylight), p.moon, 0.06 * (1 - p.daylight));
    const barkP = pack(bark);
    const barkBg = pack(scale(bark, 0.45));
    const glyphs = ['|', '(', ')', '|', ':', '|'];
    for (const tr of [this.trunkL, this.trunkR]) {
      for (let y = 0; y < this.rows; y++) {
        const flare = y > this.rows - 5 ? this.rows - 5 - y : 0;
        for (let x = tr.x0 + flare; x <= tr.x1 - flare; x++) {
          const edge = x === tr.x0 + flare || x === tr.x1 - flare;
          const ch = edge ? (flare < 0 ? (x < (tr.x0 + tr.x1) / 2 ? '/' : '\\') : '|') : glyphs[Math.floor(hash2(x, y >> 1, 5) * glyphs.length)];
          g.put(x, y, hash2(x, y, 7) < 0.3 && !edge ? ' ' : ch, barkP, barkBg);
        }
      }
    }
    // Branch with twigs.
    const { y, x0, x1 } = this.branch;
    for (let x = x0; x < x1; x++) {
      const k = (x - x0) / (x1 - x0);
      g.put(x, y, '=', barkP, barkBg);
      if (k > 0.35) g.put(x, y + 1, '_', barkP, barkBg);
      if (x % 7 === 3 && k < 0.85) {
        g.set(x, y - 1, '/', barkP);
        g.set(x + 1, y - 2, '/', barkP);
        g.set(x + 2, y - 2, '*', pack(p.foliage));
      }
    }
  }

  private drawCanopy(g: Grid, env: Env): void {
    const p = env.pal;
    const { t, w } = env;
    const season = seasonOf(env.month);
    const leafRGB = season === 'autumn' ? mix(p.foliage, [190, 110, 50], 0.55) : p.foliage;
    const top = Math.round(this.rows * 0.3);
    const ramp = ['.', '*', '%', '&', '#'];
    const sway = t * 0.25 + w.wind * t * 0.3;
    const L = this.trunkL;
    const R = this.trunkR;
    let n = 0;
    for (let y = 0; y < top; y++) {
      for (let x = 0; x < this.cols; x++) {
        const dl = Math.abs(x - (L.x0 + L.x1) / 2) / this.cols;
        const dr = Math.abs(x - (R.x0 + R.x1) / 2) / this.cols;
        const near = Math.max(Math.exp(-((dl / 0.18) ** 2)), Math.exp(-((dr / 0.22) ** 2)));
        if ((x & 1) === 0) n = fbm(x * 0.08 + Math.sin(sway + y * 0.2) * 0.3, y * 0.22, 3, 41);
        const d = n * near * (1.2 - y / top) - 0.3;
        if (d <= 0) continue;
        const k = Math.min(1, d * 2.6);
        const ch = ramp[Math.min(ramp.length - 1, Math.floor(k * ramp.length))];
        const c = mix(scale(leafRGB, 0.35), leafRGB, 0.4 + 0.6 * hash2(x, y, 3));
        const col = pack(mix(c, p.snow, env.w.snow * 0.5 * hash2(y, x)));
        if (k > 0.45) g.put(x, y, ch, col, pack(scale(leafRGB, 0.2 + 0.35 * env.pal.daylight)));
        else g.set(x, y, ch, col);
        g.paintBack(x, y, scale(leafRGB, 0.18), Math.min(0.9, k * 1.5));
      }
    }
  }

  private drawOwl(g: Grid, env: Env): void {
    const p = env.pal;
    const o = this.owl;
    o.next -= env.dt;
    if (o.next <= 0) {
      o.blink = 0.18;
      o.next = 3 + Math.random() * 6;
      if (Math.random() < 0.3) o.look = 1.5;
    }
    o.blink -= env.dt;
    o.look -= env.dt;
    const lines = OWL.slice();
    const eye = o.blink > 0 ? '-' : o.look > 0 ? 'O' : 'o';
    lines[1] = `( (${eye}) (${eye}) )`;
    const feather = mix(mix([150, 122, 92], p.near, 0.5 - 0.4 * p.daylight), p.moon, 0.12 * (1 - p.daylight));
    const face = mix(feather, WHITE, 0.25);
    const eyeC: RGB = [255, 200, 70];
    g.sprite(o.x, o.y, lines, (_c, lx, ly) => (ly === 1 && (lx === 3 || lx === 7) ? pack(eyeC) : ly < 3 ? pack(face) : pack(feather)), pack(scale(feather, 0.5)), true);
    if (o.blink <= 0 && p.daylight < 0.5) {
      g.addGlow(o.x + 3, o.y + 1, eyeC, 0.35);
      g.addGlow(o.x + 7, o.y + 1, eyeC, 0.35);
    }
  }

  private drawFox(g: Grid, env: Env): void {
    const p = env.pal;
    const f = this.fox;
    f.next -= env.dt;
    if (f.next <= 0) {
      f.blink = 0.16;
      f.next = 2.5 + Math.random() * 5;
      if (Math.random() < 0.35) f.ear = 0.3;
    }
    f.blink -= env.dt;
    f.ear -= env.dt;
    const head = FOX_HEAD.slice();
    const eye = f.blink > 0 ? '-' : 'o';
    head[2] = `|  ${eye}   ${eye}  |`;
    if (f.ear > 0) head[0] = ' /|     /\\ ';
    const body = Math.sin(env.t * 1.3) > 0.6 ? FOX_BODY_B : FOX_BODY_A;
    const day = p.daylight;
    const furRGB = mix(mix(scale([226, 112, 50], 0.35 + 0.65 * day), p.moon, 0.15 * (1 - day)), p.light, 0.05);
    const fur = pack(furRGB);
    const white = pack(mix(mix([240, 236, 226], p.near, 0.5 - 0.45 * day), p.moon, 0.1));
    const dark = pack(scale(furRGB, 0.4));
    const bg = pack(scale(furRGB, 0.45));
    const x = f.x;
    const y = f.y;
    g.sprite(x, y, head, (_c, lx, ly) => {
      if (ly === 2 && (lx === 3 || lx === 7)) return pack([30, 24, 20]);
      if (ly >= 3 && lx >= 3 && lx <= 7) return white;
      return fur;
    }, bg, true);
    g.sprite(x, y + head.length, body, (c, lx, ly) => {
      if (lx >= 11) return ly === 0 || (ly === 2 && c !== '_') ? white : fur;
      if (c === '|' && lx >= 4 && lx <= 6) return dark;
      if (c === ':') return white;
      return fur;
    }, bg, true);
  }

  private drawLeaves(g: Grid, env: Env): void {
    const season = seasonOf(env.month);
    if (season !== 'autumn' && season !== 'spring') return;
    const p = env.pal;
    const cols: RGB[] = season === 'autumn' ? [[226, 120, 50], [200, 80, 40], [236, 180, 70]] : [[255, 190, 210], [255, 220, 230]];
    for (const [i, l] of this.leaves.entries()) {
      l.vx = env.w.wind * 3 + Math.sin(env.t * 1.1 + l.ph) * 1.5;
      l.x += l.vx * env.dt;
      l.y += (1.2 + Math.sin(env.t * 0.7 + l.ph) * 0.6) * env.dt;
      if (l.y > this.rows || l.x < -2 || l.x > this.cols + 2) {
        l.y = Math.random() * this.rows * 0.25;
        l.x = Math.random() * this.cols;
      }
      const ch = Math.sin(env.t * 3 + l.ph) > 0 ? ',' : '`';
      g.set(l.x, l.y, i % 3 === 0 ? '*' : ch, mixPack(p.skyMid, cols[i % cols.length], 0.4 + 0.6 * p.daylight));
    }
  }
}
