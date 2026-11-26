import { hex, mix, mixPack, pack, type RGB, WHITE } from '../core/color';
import type { Grid } from '../core/grid';
import { clamp, hash2, irange, mulberry32, pick } from '../core/math';
import { Plume, mirror, windowLit } from './common';
import { BaseScene, type Env } from './types';

interface Bldg { x: number; w: number; top: number; seed: number; depth: number; antenna: boolean; tank: boolean }
interface Sign { x: number; y: number; text: string; vertical: boolean; color: RGB; seed: number; flicker: boolean }

const NEON = ['#ff4fa3', '#4ff0ff', '#b46bff', '#ff5a4f', '#ffd24f', '#6dff9a'].map(hex);
const KANA = ['ラーメン', 'カラオケ', 'ホテル', 'バー', 'すし', 'カフェ', '居酒屋', '本屋', 'ゲーム'];
const LATIN = ['BAR', '24H', 'CAFE', 'HOTEL', 'SUSHI', 'RAMEN', 'OPEN', 'JAZZ', 'KTV'];

const CAR = [' ____________ ', '|ww ww ww ww |', "'-oo------oo-'"];
const HEAD = [' ___________   ', '|ww ww ww ww \\ ', "'-oo------oo--'"];
const TRAIN_R = [0, 1, 2].map((r) => CAR[r] + CAR[r] + CAR[r] + HEAD[r]);
const TRAIN_L = mirror(TRAIN_R);

const MUG = [' .---. ', ' |   |)', " `---' "];
const PLANT = [
  '  \\ | /  ',
  '-._\\|/_.-',
  ' ._\\|/_. ',
  '   \\|/   ',
  '  [___]  ',
  '   \\_/   ',
];

/** Tokyo, from a cozy apartment balcony. */
export class TokyoScene extends BaseScene {
  readonly id = 'tokyo' as const;
  private far: Bldg[] = [];
  private mid: Bldg[] = [];
  private signs: Sign[] = [];
  private piers: number[] = [];
  private tower = { x: 0, top: 0, base: 0 };
  private railY = 0;
  private bridgeY = 0;
  private train = { x: 0, dir: 1, active: false, wait: 3 };
  private mug = { x: 0, y: 0 };
  private steam = new Plume(3.2, 2.4, 2.2, 1.1, 11);

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const r = mulberry32(1337);
    this.railY = rows - Math.max(6, Math.round(rows * 0.19));
    this.bridgeY = Math.round(rows * 0.6);
    this.horizonRow = Math.round(rows * 0.66);
    this.surfaces = [[0, cols - 1, this.railY]];

    this.far = [];
    for (const depth of [0, 1]) {
      let x = -3 + depth * 3;
      while (x < cols + 2) {
        const w = irange(r, 4, depth ? 9 : 12);
        const u = x / cols;
        const cluster = Math.exp(-(((u - 0.32) / 0.15) ** 2)) + 0.55 * Math.exp(-(((u - 0.88) / 0.1) ** 2));
        const hmax = rows * (0.08 + 0.3 * cluster) * (depth ? 0.72 : 1);
        const h = Math.round(rows * 0.05 + r() * hmax);
        this.far.push({
          x,
          w,
          top: this.horizonRow - h - (depth ? 0 : Math.round(rows * 0.05)),
          seed: irange(r, 1, 1e6),
          depth,
          antenna: h > rows * 0.22 && r() < 0.7,
          tank: false,
        });
        x += w + (r() < 0.25 ? 1 : 0);
      }
    }
    this.tower = { x: Math.round(cols * 0.7), top: Math.round(rows * 0.13), base: this.horizonRow + 2 };

    this.piers = [];
    for (let x = 6; x < cols; x += 30) this.piers.push(x);

    this.mid = [];
    this.signs = [];
    let x = -2;
    while (x < cols + 2) {
      const w = irange(r, 9, 19);
      const top = irange(r, this.bridgeY + 4, Math.max(this.bridgeY + 5, this.railY - 3));
      const b: Bldg = { x, w, top, seed: irange(r, 1, 1e6), depth: 2, antenna: false, tank: r() < 0.35 };
      this.mid.push(b);
      if (r() < 0.7) {
        const kana = pick(r, KANA);
        const sy = top - 3;
        if (r() < 0.55 && sy + Array.from(kana).length + 1 < this.railY) {
          const text = kana;
          this.signs.push({
            x: x + w - 3,
            y: sy,
            text,
            vertical: true,
            color: pick(r, NEON),
            seed: irange(r, 1, 1e6),
            flicker: r() < 0.35,
          });
        } else {
          const text = pick(r, LATIN);
          if (text.length + 2 <= w) {
            this.signs.push({
              x: x + 1 + irange(r, 0, Math.max(0, w - text.length - 3)),
              y: top - 4,
              text,
              vertical: false,
              color: pick(r, NEON),
              seed: irange(r, 1, 1e6),
              flicker: r() < 0.35,
            });
            b.tank = false;
          }
        }
      }
      x += w + (r() < 0.3 ? 1 : 0);
    }
    this.mug = { x: Math.round(cols * 0.66), y: this.railY - MUG.length };
    this.train.active = false;
    this.train.wait = 3;
  }

  fogBias(y: number): number {
    if (y >= this.railY) return 0.12;
    const d = (y - this.horizonRow) / (this.rows * 0.3);
    return 0.3 + 0.7 * Math.exp(-d * d);
  }

  draw(g: Grid, env: Env): void {
    for (const b of this.far) if (b.depth === 0) this.drawFar(g, env, b);
    this.drawTower(g, env);
    for (const b of this.far) if (b.depth === 1) this.drawFar(g, env, b);
    // City light pollution at night.
    const L = env.pal.lights;
    if (L > 0.2) {
      for (let x = 0; x < this.cols; x += 6) g.backAt(x, this.horizonRow - 2, 9, 6, [255, 150, 110], 0.06 * L);
    }
    this.drawBridge(g, env);
    this.drawTrain(g, env);
    for (const b of this.mid) this.drawMid(g, env, b);
    for (const s of this.signs) this.drawSign(g, env, s);
    this.drawFairyLights(g, env);
    this.drawRail(g, env);
    this.drawMug(g, env);
    this.drawPlant(g, env);
  }

  private drawFar(g: Grid, env: Env, b: Bldg): void {
    const p = env.pal;
    const L = p.lights;
    const bg = mixPack(p.skyBottom, p.farBg, b.depth ? 0.95 : 0.62);
    const tex = mixPack(p.skyBottom, p.far, b.depth ? 0.95 : 0.7);
    const litC = mix(p.light, p.skyBottom, b.depth ? 0.12 : 0.35);
    const litP = pack(litC);
    const bottom = this.railY + 5;
    for (let y = Math.max(0, b.top); y < bottom; y++) {
      const ly = y - b.top;
      for (let x = Math.max(0, b.x); x < Math.min(this.cols, b.x + b.w); x++) {
        const lx = x - b.x;
        if (lx > 0 && lx < b.w - 1 && ly > 0 && lx % 2 === 1 && ly % 2 === 0) {
          if (L > 0.05 && windowLit(x, y, b.seed, env.t, L * 0.62)) {
            g.put(x, y, '.', litP, bg);
            g.addGlow(x, y, litC, 0.07);
          } else if (hash2(x, y, b.seed) < 0.55) g.put(x, y, '.', tex, bg);
          else g.blank(x, y, bg);
        } else g.blank(x, y, bg);
      }
    }
    if (b.antenna) {
      const ax = b.x + (b.w >> 1);
      for (let k = 1; k <= 3; k++) g.set(ax, b.top - k, '|', tex);
      const on = Math.sin(env.t * 2.6 + b.seed) > 0.35;
      g.set(ax, b.top - 4, on ? '*' : '.', on ? pack([255, 60, 50]) : tex);
      if (on) g.addGlow(ax, b.top - 4, [255, 40, 30], 0.5);
    }
  }

  private drawTower(g: Grid, env: Env): void {
    const p = env.pal;
    const L = p.lights;
    const { x: tx, top, base } = this.tower;
    const th = base - top;
    const maxHalf = clamp(Math.round(th * 0.22), 4, 9);
    const night: RGB = [255, 150, 70];
    const c = mix(mix([226, 88, 58], p.skyBottom, 0.4), night, L);
    const cp = pack(c);
    const dim = mixPack(p.skyBottom, c, 0.6);
    const halfAt = (k: number) => Math.round(Math.pow(k / th, 1.75) * maxHalf);
    for (let k = 0; k <= th; k++) {
      const y = top + k;
      const half = halfAt(k);
      if (half <= 0) {
        g.set(tx, y, '|', cp);
        continue;
      }
      g.set(tx - half, y, '/', cp);
      g.set(tx + half, y, '\\', cp);
      for (let x = tx - half + 1; x < tx + half; x++) {
        const a = (((x - tx + k) % 4) + 4) % 4;
        const b = (((x - tx - k) % 4) + 4) % 4;
        if (a === 0 && b === 0) g.set(x, y, 'X', dim);
        else if (a === 0) g.set(x, y, '/', dim);
        else if (b === 0) g.set(x, y, '\\', dim);
      }
      if (L > 0.2) {
        g.addGlow(tx - half, y, night, 0.07 * L);
        g.addGlow(tx + half, y, night, 0.07 * L);
      }
    }
    const deckBg = mixPack(p.farBg, c, 0.35);
    for (const kd of [Math.round(th * 0.3), Math.round(th * 0.56)]) {
      const y = top + kd;
      const half = halfAt(kd) + 1;
      for (let x = tx - half; x <= tx + half; x++) {
        const ch = x === tx - half ? '[' : x === tx + half ? ']' : '=';
        g.put(x, y, ch, x === tx - half || x === tx + half ? cp : pack(mix(c, p.light, L * 0.6)), deckBg);
        if (L > 0.2) g.addGlow(x, y, p.light, 0.14 * L);
      }
    }
    for (let k = 1; k <= 4; k++) g.set(tx, top - k, '|', dim);
    const on = Math.sin(env.t * 2.1) > 0.2;
    g.set(tx, top - 5, '*', on ? pack([255, 70, 60]) : dim);
    if (on) g.addGlow(tx, top - 5, [255, 40, 30], 0.6);
  }

  private drawBridge(g: Grid, env: Env): void {
    const p = env.pal;
    const L = p.lights;
    const B = this.bridgeY;
    const deck = mixPack(p.mid, p.light, 0.12 * L);
    const deckBg = pack(p.midBg);
    const truss = mixPack(p.midBg, p.mid, 0.6);
    for (const px of this.piers) {
      for (let y = B + 2; y < this.railY + 5; y++) {
        g.put(px, y, '[', truss, deckBg);
        g.blank(px + 1, y, deckBg);
        g.put(px + 2, y, ']', truss, deckBg);
      }
    }
    const lamp: RGB = [255, 204, 130];
    for (let x = 0; x < this.cols; x++) {
      g.put(x, B, '=', deck, deckBg);
      g.put(x, B + 1, x % 2 ? '/' : '\\', truss, deckBg);
      if (x % 14 === 6) {
        g.set(x, B - 1, '|', truss);
        g.set(x, B - 2, 'o', mixPack(p.mid, lamp, 0.2 + 0.8 * L));
        if (L > 0.15) g.addGlow(x, B - 2, lamp, 0.35 * L);
      }
    }
  }

  private drawTrain(g: Grid, env: Env): void {
    const tr = this.train;
    const width = TRAIN_R[0].length;
    if (!tr.active) {
      tr.wait -= env.dt;
      if (tr.wait <= 0) {
        tr.active = true;
        tr.dir = Math.random() < 0.5 ? 1 : -1;
        tr.x = tr.dir > 0 ? -width : this.cols;
      }
      return;
    }
    tr.x += tr.dir * 17 * env.dt;
    if ((tr.dir > 0 && tr.x > this.cols + 2) || (tr.dir < 0 && tr.x < -width - 2)) {
      tr.active = false;
      tr.wait = 14 + Math.random() * 26;
      return;
    }
    const p = env.pal;
    const L = p.lights;
    const lines = tr.dir > 0 ? TRAIN_R : TRAIN_L;
    const x0 = Math.round(tr.x);
    const y0 = this.bridgeY - 3;
    const bodyRGB = mix([178, 192, 186], p.mid, 0.45 + 0.4 * (1 - p.daylight));
    const body = pack(bodyRGB);
    const bodyBg = mixPack(p.midBg, bodyRGB, 0.4);
    const stripe = mixPack(p.midBg, [70, 190, 120], 0.55 + 0.3 * p.daylight);
    const win: RGB = [255, 232, 170];
    const winBg = L > 0.15 ? mixPack(bodyRGB, win, 0.55 + 0.45 * L) : mixPack(p.skyBottom, [40, 50, 60], 0.45);
    for (let ly = 0; ly < 3; ly++) {
      const line = lines[ly];
      for (let lx = 0; lx < line.length; lx++) {
        const c = line[lx];
        const x = x0 + lx;
        const y = y0 + ly;
        if (c === 'w') {
          g.put(x, y, ' ', 0, winBg);
          if (L > 0.15) g.addGlow(x, y, win, 0.28 * L);
        } else if (c === ' ') {
          if (ly === 1) g.blank(x, y, bodyBg);
        } else if (ly === 0) g.set(x, y, c, body);
        else g.put(x, y, c, ly === 2 ? stripe : body, bodyBg);
      }
    }
  }

  private drawMid(g: Grid, env: Env, b: Bldg): void {
    const p = env.pal;
    const L = p.lights;
    const bg = pack(p.midBg);
    const tex = mixPack(p.midBg, p.mid, 0.55);
    const litBg = mixPack(p.midBg, p.light, 0.3);
    const litP = pack(p.light);
    for (let x = Math.max(0, b.x); x < Math.min(this.cols, b.x + b.w); x++) g.set(x, b.top - 1, '_', tex);
    for (let y = b.top; y < this.rows; y++) {
      const ly = y - b.top;
      for (let x = Math.max(0, b.x); x < Math.min(this.cols, b.x + b.w); x++) {
        const lx = x - b.x;
        const isWin = lx > 0 && lx < b.w - 1 && (lx - 1) % 3 < 2 && ly % 2 === 1;
        if (isWin) {
          const wx = x - ((lx - 1) % 3);
          const lit = L > 0.05 && windowLit(wx, y, b.seed, env.t, L * 0.55);
          const ch = (lx - 1) % 3 === 0 ? '[' : ']';
          if (lit) {
            g.put(x, y, ch, litP, litBg);
            g.addGlow(x, y, p.light, 0.12);
          } else g.put(x, y, ch, tex, bg);
        } else g.blank(x, y, bg);
      }
    }
    if (b.tank) {
      const tx = b.x + 2;
      g.sprite(tx, b.top - 3, [' _ ', '|_|'], tex, bg, true);
      g.set(tx + 4, b.top - 1, '#', tex);
    }
  }

  private drawSign(g: Grid, env: Env, s: Sign): void {
    const p = env.pal;
    const on = clamp((p.lights - 0.12) / 0.4);
    const flick = s.flicker && hash2(Math.floor(env.t * 13), s.seed) < 0.06;
    const lit = flick ? on * 0.15 : on;
    const col = mixPack(mix(p.midBg, s.color, 0.5), s.color, lit);
    const frame = mixPack(p.midBg, p.mid, 0.9);
    const sbg = mixPack(p.midBg, s.color, 0.08 + 0.14 * lit);
    if (s.vertical) {
      const chars = Array.from(s.text);
      g.text(s.x, s.y - 1, '.--.', frame, sbg);
      chars.forEach((ch, i) => {
        const y = s.y + i;
        g.put(s.x, y, '|', frame, sbg);
        g.put(s.x + 1, y, ch, col, sbg);
        g.blank(s.x + 2, y, sbg);
        g.put(s.x + 3, y, '|', frame, sbg);
        if (lit > 0.05) {
          g.addGlow(s.x + 1, y, s.color, 0.45 * lit);
          g.addGlow(s.x + 2, y, s.color, 0.3 * lit);
        }
      });
      g.text(s.x, s.y + chars.length, "'--'", frame, sbg);
    } else {
      const n = s.text.length;
      const edge = `+${'-'.repeat(n)}+`;
      g.text(s.x, s.y, edge, frame, sbg);
      g.put(s.x, s.y + 1, '|', frame, sbg);
      g.text(s.x + 1, s.y + 1, s.text, col, sbg);
      g.put(s.x + n + 1, s.y + 1, '|', frame, sbg);
      g.text(s.x, s.y + 2, edge, frame, sbg);
      g.set(s.x + 1, s.y + 3, '|', frame);
      g.set(s.x + n, s.y + 3, '|', frame);
      if (lit > 0.05) for (let i = 0; i < n; i++) g.addGlow(s.x + 1 + i, s.y + 1, s.color, 0.42 * lit);
    }
  }

  private drawFairyLights(g: Grid, env: Env): void {
    const p = env.pal;
    const L = p.lights;
    const wire = mixPack(p.skyTop, p.near, 0.7);
    const sag = Math.max(2, Math.round(this.rows * 0.05));
    const bulbs: RGB[] = [[255, 214, 140], [255, 179, 92], [255, 240, 200], [255, 160, 120]];
    const posts = [-1, Math.round(this.cols / 2), this.cols];
    for (let s = 0; s < posts.length - 1; s++) {
      const xa = posts[s];
      const xb = posts[s + 1];
      for (let x = Math.max(0, xa); x <= Math.min(this.cols - 1, xb); x++) {
        const u = (x - xa) / (xb - xa);
        const y = 0.6 + sag * 4 * u * (1 - u);
        const slope = (sag * 4 * (1 - 2 * u)) / (xb - xa);
        const row = Math.floor(y);
        const ch = Math.abs(slope) > 0.45 ? (slope > 0 ? '\\' : '/') : y - row < 0.5 ? '-' : '_';
        g.set(x, row, ch, wire);
        if (x % 5 === 2) {
          const c = bulbs[(x / 5) % bulbs.length | 0];
          const tw = 0.7 + 0.3 * Math.sin(env.t * 1.3 + x * 0.7);
          const k = L * tw;
          g.set(x, row + 1, 'o', mixPack(mix(p.skyTop, p.near, 0.8), c, 0.25 + 0.75 * k));
          if (k > 0.1) g.addGlow(x, row + 1, c, 0.42 * k);
        }
      }
    }
  }

  private drawRail(g: Grid, env: Env): void {
    const p = env.pal;
    const L = p.lights;
    const R = this.railY;
    const rim = pack(mix(p.near, p.light, 0.25 * L));
    const nbg = pack(p.nearBg);
    const floorBg = mixPack(p.nearBg, [0, 0, 0], 0.3);
    const tex = mixPack(p.nearBg, p.near, 0.35);
    for (let x = 0; x < this.cols; x++) {
      g.put(x, R, '=', rim, nbg);
      for (let k = 1; k <= 3; k++) if (x % 5 === 2) g.put(x, R + k, '|', rim, nbg);
      g.put(x, R + 4, '=', rim, nbg);
      for (let y = R + 5; y < this.rows; y++) {
        if ((y - R) % 2 === 0 && x % 9 === 0) g.put(x, y, '|', tex, floorBg);
        else g.put(x, y, hash2(x, y, 3) < 0.05 ? '.' : (y - R) % 2 === 1 ? '_' : ' ', tex, floorBg);
      }
    }
    // Warm spill from the apartment behind us.
    if (L > 0.2) for (let x = 0; x < this.cols; x += 8) g.backAt(x, this.rows, 10, 4, p.light, 0.05 * L);
  }

  private drawMug(g: Grid, env: Env): void {
    const p = env.pal;
    const { x, y } = this.mug;
    const ceramic = mix(mix([236, 226, 210], p.near, 0.6 - 0.4 * p.daylight), p.light, 0.15 * p.lights);
    g.sprite(x, y, MUG, mixPack(ceramic, p.nearBg, 0.45), mixPack(p.nearBg, ceramic, 0.75), true);
    const cold = env.tempC === undefined ? 0.5 : clamp((18 - env.tempC) / 18);
    this.steam.rate = 2.2 + cold * 2.5;
    this.steam.update(env.dt, x + 3, y - 1, env.w.wind);
    this.steam.draw(g, mix(p.skyBottom, WHITE, 0.55), p.skyMid);
  }

  private drawPlant(g: Grid, env: Env): void {
    const p = env.pal;
    const leaf = pack(mix(mix([92, 160, 90], p.near, 0.65 - 0.5 * p.daylight), p.light, 0.12 * p.lights));
    const pot = pack(mix([190, 104, 70], p.near, 0.6 - 0.45 * p.daylight));
    const y0 = this.rows - PLANT.length;
    const sway = Math.sin(env.t * 0.8) * env.w.wind > 0.15 ? 1 : 0;
    g.sprite(2 + sway, y0, PLANT.slice(0, 4), leaf);
    g.sprite(2, y0 + 4, PLANT.slice(4), pot, mixPack(p.nearBg, [190, 104, 70], 0.2), true);
  }
}
