import type { RGB } from '../core/color';
import { mixPack } from '../core/color';
import type { Grid } from '../core/grid';
import { fbm, hash2, mulberry32, type Rng } from '../core/math';

const MIRROR: Record<string, string> = {
  '/': '\\', '\\': '/', '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '`': "'", "'": '`',
};

/** Horizontally mirror an ASCII sprite. */
export function mirror(lines: readonly string[]): string[] {
  const w = Math.max(...lines.map((l) => l.length));
  return lines.map((l) =>
    l
      .padEnd(w, ' ')
      .split('')
      .reverse()
      .map((c) => MIRROR[c] ?? c)
      .join(''),
  );
}

/** A ridge line: top row per column. */
export function ridge(cols: number, base: number, amp: number, freq: number, seed: number, octaves = 3): Int16Array {
  const h = new Int16Array(cols);
  for (let x = 0; x < cols; x++) h[x] = Math.round(base - amp * fbm(x * freq, seed * 0.37, octaves, seed));
  return h;
}

/** Edge glyph for a ridge column given neighbours. */
export function ridgeChar(l: number, top: number, r: number): string {
  const a = l - top; // >0: left neighbour is lower
  const b = r - top;
  if (a > 0 && b > 0) return '^';
  if (b > 0) return '\\';
  if (a > 0) return '/';
  return '_';
}

/** Fill under a ridge line with a textured silhouette. */
export function drawRidge(
  g: Grid,
  tops: Int16Array,
  bottom: number,
  edge: number,
  tex: number,
  bg: number,
  seed: number,
  density = 0.06,
  x0 = 0,
  x1 = tops.length,
): void {
  for (let x = x0; x < x1; x++) {
    const top = tops[x];
    const l = x > 0 ? tops[x - 1] : top;
    const r = x < tops.length - 1 ? tops[x + 1] : top;
    for (let y = Math.max(0, top); y <= bottom; y++) {
      if (y === top) g.put(x, y, ridgeChar(l, top, r), edge, bg);
      else if (hash2(x, y, seed) < density) g.put(x, y, hash2(y, x, seed) < 0.5 ? '.' : "'", tex, bg);
      else g.blank(x, y, bg);
    }
  }
}

/** Half-width of a tiered pine at crown row k. */
const pineHalf = (k: number): number => (k === 0 ? 0 : 1 + Math.floor((k - 1) / 3) + ((k - 1) % 3));

/** Tiered ASCII pine. `sway` (cells) bends the crown; trunk at the bottom. */
export function drawPine(
  g: Grid,
  cx: number,
  baseY: number,
  height: number,
  edge: number,
  tex: number,
  bg: number,
  sway: number,
  seed: number,
): void {
  const trunk = height > 12 ? 2 : 1;
  const crown = Math.max(3, height - trunk);
  const top = baseY - height + 1;
  for (let k = 0; k < crown; k++) {
    const y = top + k;
    const bend = Math.round(sway * Math.pow(1 - k / crown, 1.6));
    const c = cx + bend;
    const half = pineHalf(k);
    if (half === 0) {
      g.put(c, y, '^', edge, bg);
      continue;
    }
    g.put(c - half, y, '/', edge, bg);
    g.put(c + half, y, '\\', edge, bg);
    for (let x = c - half + 1; x < c + half; x++) {
      const h = hash2(x - c, k, seed);
      if (h < 0.28) g.put(x, y, '^', tex, bg);
      else g.blank(x, y, bg);
    }
  }
  const tw = height > 18 ? 1 : 0;
  for (let k = 0; k < trunk; k++) {
    for (let x = cx - tw; x <= cx + tw; x++) g.put(x, baseY - trunk + 1 + k, '|', tex, bg);
  }
}

/** Tiny particle system for smoke, steam and breath. */
export class Plume {
  private ps: Array<{ x: number; y: number; age: number; life: number; ph: number }> = [];
  private acc = 0;
  private rng: Rng;

  constructor(
    public rate = 5,
    public life = 4,
    public rise = 2,
    public wobble = 0.8,
    seed = 7,
  ) {
    this.rng = mulberry32(seed);
  }

  update(dt: number, sx: number, sy: number, wind: number, active = true): void {
    if (active) {
      this.acc += dt * this.rate;
      while (this.acc > 1) {
        this.acc -= 1;
        this.ps.push({ x: sx, y: sy, age: 0, life: this.life * (0.7 + this.rng() * 0.6), ph: this.rng() * 6.28 });
      }
    }
    for (const p of this.ps) {
      p.age += dt;
      const k = p.age / p.life;
      p.y -= this.rise * dt * (1 - k * 0.5);
      p.x += (wind * 3.2 * k + Math.cos(p.age * 2.1 + p.ph) * this.wobble) * dt;
    }
    this.ps = this.ps.filter((p) => p.age < p.life);
  }

  /** Draw with a fade from `near` to `far` color. */
  draw(g: Grid, near: RGB, far: RGB, chars = '()~.'): void {
    for (const p of this.ps) {
      const k = p.age / p.life;
      const vx = -Math.sin(p.age * 2.1 + p.ph);
      let c: string;
      if (k < 0.45) c = vx > 0 ? chars[1] : chars[0];
      else if (k < 0.75) c = chars[2];
      else c = chars[3];
      g.set(p.x, p.y, c, mixPack(near, far, Math.min(1, k * 1.1)));
    }
  }
}

/** Fireflies wandering in a region, blinking softly. */
export class Fireflies {
  private ps: Array<{ x: number; y: number; vx: number; vy: number; ph: number; sp: number }> = [];

  constructor(
    private count: number,
    private seed = 99,
  ) {}

  place(x0: number, y0: number, x1: number, y1: number): void {
    const r = mulberry32(this.seed);
    this.ps = Array.from({ length: this.count }, () => ({
      x: x0 + r() * (x1 - x0),
      y: y0 + r() * (y1 - y0),
      vx: (r() - 0.5) * 2,
      vy: (r() - 0.5) * 0.8,
      ph: r() * 6.28,
      sp: 0.6 + r() * 1.2,
    }));
    this.bounds = [x0, y0, x1, y1];
  }

  private bounds = [0, 0, 1, 1];

  draw(g: Grid, t: number, dt: number, vis: number): void {
    if (vis <= 0.02) return;
    const [x0, y0, x1, y1] = this.bounds;
    const col: RGB = [214, 255, 120];
    for (const p of this.ps) {
      p.vx += (Math.sin(t * 0.7 + p.ph) * 0.8 - p.vx * 0.3) * dt;
      p.vy += (Math.cos(t * 0.9 + p.ph * 1.3) * 0.4 - p.vy * 0.3) * dt;
      p.x += p.vx * dt * 1.6;
      p.y += p.vy * dt;
      if (p.x < x0) p.x = x1;
      if (p.x > x1) p.x = x0;
      if (p.y < y0) p.vy = Math.abs(p.vy);
      if (p.y > y1) p.vy = -Math.abs(p.vy);
      const b = Math.max(0, Math.sin(t * p.sp + p.ph)) * vis;
      if (b < 0.15) continue;
      g.set(p.x, p.y, b > 0.6 ? '*' : '.', mixPack([60, 70, 40], col, b));
      g.addGlow(Math.round(p.x), Math.round(p.y), col, 0.55 * b);
    }
  }
}

/** Is a window lit? Slowly re-rolls every few minutes so the city feels alive. */
export function windowLit(x: number, y: number, seed: number, t: number, prob: number): boolean {
  const h = hash2(x, y, seed);
  const slot = Math.floor(t / 37 + h * 11);
  return hash2(x * 3 + slot, y + slot * 7, seed + 1) < prob * (0.55 + 0.9 * h);
}

/** Month -> season accent for leaves / petals. */
export function seasonOf(month: number): 'spring' | 'summer' | 'autumn' | 'winter' {
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}
