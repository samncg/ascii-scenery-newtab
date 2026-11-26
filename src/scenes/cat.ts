import { mix, mixPack, pack, packRGB, type RGB, scale, WHITE } from '../core/color';
import type { Grid } from '../core/grid';
import { clamp, hash2, mulberry32 } from '../core/math';
import { InkField } from './ink';
import { BaseScene, type Env } from './types';

type Eye = 'closed' | 'opening' | 'open' | 'closing';

interface House { x: number; w: number; h: number; pitched: boolean; chimney: boolean; layer: number; seed: number; tint: RGB }

const GINGER: RGB = [232, 150, 84];
const CREAM: RGB = [246, 232, 214];

/** Close-up: a ginger cat dozing on the sill of a big window onto the rooftops. */
export class CatScene extends BaseScene {
  readonly id = 'cat' as const;
  skyInk = 1;
  private win = { x0: 0, y0: 0, x1: 0, y1: 0, xm: 0, ym: 0 };
  private houses: House[] = [];
  private field = new InkField();
  private cat = { x: 0, R: 10 };
  private eye: Eye = 'closed';
  private eyeT = 0;
  private nextWake = 7;
  private ear = 0;
  private zs: Array<{ x: number; y: number; age: number }> = [];
  private zTimer = 0;
  private drips: Array<{ x: number; y: number; v: number }> = [];

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const x0 = Math.round(cols * 0.07);
    const x1 = Math.round(cols * 0.93);
    const y0 = Math.round(rows * 0.05);
    const y1 = Math.round(rows * 0.76);
    this.win = { x0, y0, x1, y1, xm: Math.round((x0 + x1) / 2), ym: y0 + Math.round((y1 - y0) * 0.4) };
    this.clip = { x0: x0 + 1, y0: y0 + 1, x1: x1 - 1, y1 };
    this.horizonRow = y1 - Math.round(rows * 0.2);
    this.rainScale = 1.2;
    this.field.resize(cols, rows);
    this.cat = { x: cols * 0.56, R: Math.max(10, cols * 0.15) };
    // Rooftops across the street, in two layers.
    const r = mulberry32(31);
    this.houses = [];
    for (const layer of [0, 1]) {
      for (let x = x0 - 4; x < x1 + 4; ) {
        const w = Math.round(cols * (layer ? 0.07 + r() * 0.07 : 0.04 + r() * 0.05));
        const h = Math.round(rows * (layer ? 0.1 + r() * 0.14 : 0.14 + r() * 0.12));
        this.houses.push({
          x,
          w,
          h,
          pitched: r() < 0.55,
          chimney: r() < 0.4,
          layer,
          seed: Math.floor(r() * 1e5),
          tint: [[196, 120, 100], [150, 160, 180], [200, 180, 150], [130, 150, 130]][Math.floor(r() * 4)] as RGB,
        });
        x += w + (r() < 0.3 ? 2 : 0);
      }
    }
    this.surfaces = [];
    this.drips = [];
    this.zs = [];
  }

  stops(env: Env): Array<[number, RGB]> {
    const p = env.pal;
    // Show the real sky by day; fall back to the ink at night.
    this.skyInk = 1 - 0.8 * p.daylight;
    const { y0, y1 } = this.win;
    const R = this.rows;
    return [
      [0, p.skyTop],
      [y0 / R, p.skyTop],
      [(y0 + y1) / 2 / R, p.skyMid],
      [y1 / R, p.skyBottom],
      [1, p.skyBottom],
    ];
  }

  fogBias(y: number): number {
    return 0.45 + 0.55 * clamp((y - this.win.y0) / (this.win.y1 - this.win.y0));
  }

  /** The view: rooftops with lit windows and chimneys. */
  draw(g: Grid, env: Env): void {
    const p = env.pal;
    const { y1 } = this.win;
    for (const hs of this.houses) {
      const haze = hs.layer ? 0.15 : 0.45;
      const wall = mix(mix(hs.tint, p.far, 0.55 - 0.3 * p.daylight), p.skyBottom, haze);
      const wallP = pack(scale(wall, 0.55 + 0.45 * p.daylight));
      const roof = pack(scale(mix([110, 70, 60], p.mid, 0.5), 0.5 + 0.5 * p.daylight));
      const top = y1 - hs.h;
      const roofH = hs.pitched ? Math.round(hs.w * 0.45) : 1;
      for (let x = hs.x; x < hs.x + hs.w; x++) {
        const dx = Math.abs(x - (hs.x + hs.w / 2 - 0.5));
        const rTop = hs.pitched ? top - roofH + Math.round(dx * 0.9) : top;
        for (let y = rTop; y < top; y++) g.put(x, y, y === rTop ? (x < hs.x + hs.w / 2 ? '/' : '\\') : ' ', roof, roof);
        for (let y = top; y < y1; y++) {
          const lx = x - hs.x;
          const ly = y - top;
          const win = lx > 0 && lx < hs.w - 1 && lx % 3 !== 0 && ly % 3 === 1;
          if (win) {
            const lit = p.lights > 0.1 && hash2(Math.floor(x / 3), y, hs.seed + Math.floor(env.t / 50)) < p.lights * 0.55;
            if (lit) {
              g.put(x, y, ' ', 0, pack(p.light));
              g.addGlow(x, y, p.light, 0.12);
            } else g.put(x, y, ' ', 0, mixPack(p.skyBottom, [30, 36, 50], 0.6));
          } else g.blank(x, y, wallP);
        }
      }
      if (hs.chimney) {
        const cx = hs.x + Math.round(hs.w * 0.7);
        for (let y = top - roofH - 3; y < top - roofH + 2; y++) g.put(cx, y, '|', roof, roof);
      }
    }
  }

  drawFront(g: Grid, env: Env): void {
    const p = env.pal;
    const { t, dt } = env;
    const day = p.daylight;
    const lamp: RGB = [255, 186, 110];
    const lampOn = clamp((p.lights - 0.3) * 2);
    const { x0, y0, x1, y1, xm, ym } = this.win;

    // Raindrops sliding down the glass.
    const wet = env.w.rain + env.w.drizzle * 0.7 + env.w.storm * 0.3;
    const want = Math.round(wet * 60);
    while (this.drips.length < want) this.drips.push({ x: x0 + 2 + Math.random() * (x1 - x0 - 4), y: y0 + 1 + Math.random() * (y1 - y0 - 2), v: 0 });
    if (this.drips.length > want) this.drips.length = want;
    const dripC = pack(mix(p.precip, WHITE, 0.4));
    for (const d of this.drips) {
      d.v = Math.random() < dt * 0.5 ? 6 : d.v * Math.exp(-dt * 2);
      d.y += (0.15 + d.v) * dt;
      if (d.y > y1 - 1) {
        d.y = y0 + 1;
        d.x = x0 + 2 + Math.random() * (x1 - x0 - 4);
      }
      g.set(d.x, d.y, 'o', dripC);
      if (d.v > 1) g.set(d.x, d.y - 1, '.', dripC);
    }

    // Wall: bright by day, lamp-warm at night.
    const wallBase = mix(mix([34, 28, 36], [178, 160, 142], day), lamp, 0.22 * lampOn);
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (x > x0 && x < x1 - 1 && y > y0 && y < y1) continue;
        const v = 1 - Math.min(0.45, Math.hypot((x - xm) / this.cols, (y - ym) / this.rows) * 0.8);
        const c = scale(wallBase, v);
        if (y % 5 === 2 && (x + (y % 10 === 2 ? 0 : 5)) % 10 === 0) g.put(x, y, '+', pack(scale(c, 1.25)), pack(c));
        else g.blank(x, y, pack(c));
      }
    }

    // Window frame: thin white wood with a cross mullion.
    const woodRGB = mix(mix([236, 230, 220], [62, 54, 52], 1 - day), lamp, 0.12 * lampOn);
    const wood = pack(woodRGB);
    const woodBg = pack(scale(woodRGB, 0.8));
    for (let x = x0; x < x1; x++) g.put(x, y0, '=', wood, woodBg);
    for (let y = y0; y <= y1; y++) {
      g.put(x0, y, '|', wood, woodBg);
      g.put(x1 - 1, y, '|', wood, woodBg);
      g.put(xm, y, '|', wood, woodBg);
    }
    for (let x = x0 + 1; x < x1 - 1; x++) g.put(x, ym, x === xm ? '+' : '-', wood, woodBg);

    // Curtains, drawn back to the edges.
    const fabric = mix(mix([168, 112, 116], [44, 30, 38], 1 - day), lamp, 0.15 * lampOn);
    const cw = Math.max(4, Math.round(this.cols * 0.05));
    const sway = Math.sin(t * 0.5) * 0.5;
    for (let y = 0; y < y1 + 4; y++) {
      const k = y / (y1 + 4);
      const pinch = Math.round(Math.sin(Math.PI * clamp(k * 1.2)) * cw * 0.35);
      for (const side of [-1, 1]) {
        const xa = side < 0 ? 0 : x1 - 2 + pinch;
        const xb = side < 0 ? x0 + 1 - pinch : this.cols - 1;
        for (let x = xa; x <= xb; x++) {
          const fold = Math.sin((x + sway * k * 3) * 1.2);
          const shade = 0.72 + 0.28 * fold;
          g.put(x, y, fold > 0.6 ? '(' : fold < -0.6 ? ')' : ' ', pack(scale(fabric, shade * 1.3)), pack(scale(fabric, shade * 0.75)));
        }
      }
    }

    // Sill.
    const sillTop = y1;
    for (let x = x0 - 2; x <= x1 + 1; x++) {
      g.put(x, sillTop, '=', wood, woodBg);
      g.put(x, sillTop + 1, '_', pack(scale(woodRGB, 0.9)), pack(scale(woodRGB, 0.6)));
    }

    // Cushion, then the cat on it, then a potted plant.
    const { x: cx, R } = this.cat;
    const a = env.aspect;
    const cushTop = sillTop - Math.max(2, Math.round((R * 0.22) / a));
    const cush = mix(mix([186, 104, 120], [54, 32, 44], 1 - day), lamp, 0.15 * lampOn);
    for (let y = cushTop; y < sillTop; y++) {
      const inset = y === cushTop ? 2 : 0;
      for (let x = Math.round(cx - R * 1.45) + inset; x <= Math.round(cx + R * 1.3) - inset; x++) {
        const stripe = Math.floor((x - cx) / 3) % 2 === 0;
        g.put(x, y, y === cushTop ? '~' : stripe ? ':' : ' ', pack(scale(cush, 1.25)), pack(scale(cush, stripe ? 0.85 : 0.7)));
      }
    }
    this.drawCat(g, env, cushTop, lamp, lampOn);
    this.drawPlant(g, env, sillTop, lampOn, lamp);
  }

  private drawCat(g: Grid, env: Env, floor: number, lamp: RGB, lampOn: number): void {
    const { t, dt, pal } = env;
    const a = env.aspect;
    const F = this.field;
    F.aspect = a;
    const day = pal.daylight;
    const { x: cx, R } = this.cat;

    // Sleep / peek state machine.
    this.eyeT += dt;
    if (this.eye === 'closed') {
      this.nextWake -= dt;
      if (this.nextWake <= 0) [this.eye, this.eyeT] = ['opening', 0];
    } else if (this.eye === 'opening' && this.eyeT > 0.5) [this.eye, this.eyeT] = ['open', 0];
    else if (this.eye === 'open' && this.eyeT > 4) [this.eye, this.eyeT] = ['closing', 0];
    else if (this.eye === 'closing' && this.eyeT > 0.6) {
      [this.eye, this.eyeT] = ['closed', 0];
      this.nextWake = 10 + Math.random() * 18;
    }
    if (Math.random() < dt * 0.12) this.ear = 0.3;
    this.ear -= dt;

    // Light: the window behind gives a rim; the room (or lamp) fills the front.
    const rimC = mix(pal.skyBottom, WHITE, 0.4);
    const fill = 0.35 + 0.5 * day + 0.25 * lampOn;
    const warm = mix(WHITE, lamp, 0.5 * lampOn);
    const shade = (base: RGB, u: number, v: number): RGB => {
      const q = Math.min(1, u * u + v * v);
      const nz = Math.sqrt(1 - q);
      const rim = Math.pow(1 - nz, 2.2) * (0.45 + 0.55 * clamp(-v + 0.3));
      const diff = 0.45 + 0.55 * clamp(nz * 0.8 - v * 0.3 - u * 0.15);
      const k = fill * diff;
      return [
        base[0] * k * (warm[0] / 255) + rimC[0] * rim * 0.8,
        base[1] * k * (warm[1] / 255) + rimC[1] * rim * 0.8,
        base[2] * k * (warm[2] / 255) + rimC[2] * rim * 0.8,
      ];
    };
    const breathe = 1 + 0.035 * Math.sin(t * 1.5);

    // Body: a loaf resting on the cushion.
    const bodyH = R * 0.58 * breathe;
    const by = floor - bodyH / a + 1;
    F.oval(cx, by, 0, R, bodyH, 1.35, (u, v) => {
      const y = by + (v * bodyH) / a;
      if (y > floor + 0.5) return null;
      const stripe = Math.sin(u * 14 + Math.sin(v * 3) * 1.2) > 0.55 && v < 0.55;
      const belly = v > 0.55 && u < -0.2;
      const base = belly ? CREAM : stripe ? scale(GINGER, 0.62) : GINGER;
      return shade(base, u, v);
    });

    // Tail curling over the cushion edge and down past the sill.
    const tx0 = cx + R * 0.92;
    const ty0 = floor - 1;
    const awake = this.eye !== 'closed';
    let prev: [number, number] = [tx0, ty0];
    for (let i = 1; i <= 16; i++) {
      const s = i / 16;
      const swing = Math.sin(t * (awake ? 2.2 : 1) - s * 2.5) * R * 0.18 * s;
      const x = tx0 + R * 0.25 * Math.sin(s * 1.6) + swing;
      const y = ty0 + (s * R * 1.1) / a;
      const r = R * (0.15 - 0.05 * s);
      F.oval((x + prev[0]) / 2, (y + prev[1]) / 2, Math.PI / 2, r * 1.2, r, 1.3, (u, v) =>
        shade(Math.floor(s * 7) % 2 ? scale(GINGER, 0.62) : i === 16 ? CREAM : GINGER, u * 0.5, v),
      );
      prev = [x, y];
    }

    // Resolve the body first so the head reads as a separate form in front of it.
    F.resolve(g, t, dt, { tile: 0.55 });

    // Head, cheeks, ears and paws.
    const Rh = R * 0.56;
    const hx = cx - R * 0.88;
    const hy = by + (bodyH * 0.02) / a;
    for (const side of [-1, 1]) {
      const twitch = side < 0 && this.ear > 0 ? 0.35 : 0;
      const ang = -Math.PI / 2 + side * (0.42 + twitch);
      const ex = hx + side * Rh * 0.52;
      const ey = hy - (Rh * 0.78) / a;
      F.oval(ex, ey, ang, Rh * 0.48, Rh * 0.28, 1.4, (u, v) => (Math.abs(v) < 0.4 && u > -0.4 ? [240, 150, 140] : shade(GINGER, v, -u)));
    }
    F.oval(hx, hy, 0, Rh * 1.08, Rh * 0.9, 1.4, (u, v) => {
      const muzzle = v > 0.15 && Math.abs(u) < 0.42;
      const stripe = v < -0.35 && Math.abs(Math.sin(u * 9)) > 0.75;
      return shade(muzzle ? CREAM : stripe ? scale(GINGER, 0.6) : GINGER, u, v);
    });
    for (const side of [-1, 1]) {
      F.oval(hx + side * Rh * 0.42, floor - (Rh * 0.18) / a, 0, Rh * 0.34, Rh * 0.2, 1.3, (u, v) => shade(CREAM, u, v));
    }

    F.resolve(g, t, dt, { tile: 0.55 });

    // Face, drawn crisply on top.
    const eyeY = Math.round(hy - (Rh * 0.1) / a);
    const ew = Math.max(1, Math.round(Rh * 0.18));
    const dark = packRGB(40, 24, 18);
    for (const side of [-1, 1]) {
      const ex = Math.round(hx + side * Rh * 0.4);
      if (this.eye === 'open') {
        for (let dy = -1; dy <= 0; dy++)
          for (let dx = -ew; dx <= ew; dx++) g.put(ex + dx, eyeY + dy, dx === 0 ? '|' : 'O', dx === 0 ? dark : packRGB(170, 230, 100), dx === 0 ? packRGB(20, 30, 10) : packRGB(70, 110, 40));
        if (day < 0.5) g.glowAt(ex, eyeY, ew + 1, 1, [140, 255, 120], 0.35);
      } else {
        const ch = this.eye === 'closed' ? '-' : '_';
        for (let dx = -ew; dx <= ew; dx++) g.set(ex + dx, eyeY, ch, dark);
      }
    }
    const noseY = Math.round(hy + (Rh * 0.3) / a);
    const nw = Math.max(1, Math.round(Rh * 0.08));
    for (let dx = -nw; dx <= nw; dx++) g.put(Math.round(hx) + dx, noseY, 'v', packRGB(200, 90, 100), packRGB(236, 140, 150));
    g.set(Math.round(hx) - 1, noseY + 1, ')', dark);
    g.set(Math.round(hx) + 1, noseY + 1, '(', dark);
    // Whiskers.
    const wc = pack(mix(WHITE, pal.skyBottom, 0.2));
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const y0 = noseY + k;
        const len = Math.round(Rh * 0.9);
        for (let i = 1; i <= len; i++) {
          const x = Math.round(hx + side * (Rh * 0.45 + i));
          g.set(x, y0 + Math.round(((k === 0 ? -0.15 : 0.15) * i) / a), side * (k === 0 ? -1 : 1) > 0 ? '\\' : '/', wc);
        }
      }
    }

    // Zzz while asleep.
    if (this.eye === 'closed') {
      this.zTimer -= dt;
      if (this.zTimer <= 0 && this.zs.length < 3) {
        this.zs.push({ x: hx + Rh, y: hy - (Rh * 1.4) / a, age: 0 });
        this.zTimer = 2.2;
      }
    }
    for (const z of this.zs) {
      z.age += dt;
      z.x += dt * 2;
      z.y -= dt * 1.6;
      const k = clamp(z.age / 3.2);
      g.set(z.x, z.y, k > 0.4 ? 'Z' : 'z', mixPack(WHITE, pal.skyBottom, k));
    }
    this.zs = this.zs.filter((z) => z.age < 3.2);
  }

  private drawPlant(g: Grid, env: Env, sill: number, lampOn: number, lamp: RGB): void {
    const day = env.pal.daylight;
    const F = this.field;
    const px = this.win.x0 + Math.round(this.cols * 0.07);
    const potH = Math.max(3, Math.round(this.rows * 0.06));
    const potC = mix(mix([196, 112, 76], [60, 36, 28], 1 - day), lamp, 0.12 * lampOn);
    const potW = Math.max(3, Math.round(this.cols * 0.025));
    for (let y = sill - potH; y < sill; y++) {
      const w = potW - Math.round(((y - (sill - potH)) / potH) * 1.5);
      for (let x = px - w; x <= px + w; x++) g.put(x, y, y === sill - potH ? '=' : ' ', pack(scale(potC, 1.2)), pack(potC));
    }
    const leaf = mix(mix([110, 180, 110], [30, 54, 42], 1 - day), lamp, 0.1 * lampOn);
    const sway = Math.sin(env.t * 0.7) * 0.08;
    for (let k = 0; k < 7; k++) {
      const ang = -Math.PI / 2 + (k - 3) * 0.38 + sway;
      const len = potW * (2.2 - Math.abs(k - 3) * 0.25);
      const bx = px + (Math.cos(ang) * len) / 2;
      const by = sill - potH + (Math.sin(ang) * len) / 2 / env.aspect;
      F.oval(bx, by, ang, len / 2, potW * 0.35, 1.3, (u) => scale(leaf, 0.8 + 0.3 * (1 - Math.abs(u))));
    }
    F.resolve(g, env.t, env.dt, { tile: 0.55 });
  }
}
