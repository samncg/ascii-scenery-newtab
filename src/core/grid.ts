import type { RGB } from './color';

/** Flag bit marking a background cell as "set" (so pure black is still drawable). */
export const HAS = 0x1000000;

/** Half-open rectangle in cell coordinates: [x0, x1) x [y0, y1). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The character buffer every scene draws into. Besides the glyph + color per
 * cell it carries four low-resolution "light" layers that the renderer
 * upscales: a crisp background fill, a soft backdrop (behind text), a soft
 * haze (in front of text) and an additive glow.
 */
export class Grid {
  cols = 0;
  rows = 0;
  n = 0;
  ch = new Uint16Array(0);
  fg = new Uint32Array(0);
  bg = new Uint32Array(0);
  back = new Float32Array(0); // rgba, straight alpha
  haze = new Float32Array(0); // rgba, straight alpha
  glow = new Float32Array(0); // rgb, additive
  /** Optional clip applied to every write (used for sky/weather inside windows). */
  clip: Rect | null = null;
  usedBg = false;
  usedBack = false;
  usedHaze = false;
  usedGlow = false;

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.n = cols * rows;
    this.ch = new Uint16Array(this.n);
    this.fg = new Uint32Array(this.n);
    this.bg = new Uint32Array(this.n);
    this.back = new Float32Array(this.n * 4);
    this.haze = new Float32Array(this.n * 4);
    this.glow = new Float32Array(this.n * 3);
    this.usedBg = this.usedBack = this.usedHaze = this.usedGlow = true;
    this.clear();
  }

  clear(): void {
    this.ch.fill(32);
    if (this.usedBg) this.bg.fill(0);
    if (this.usedBack) this.back.fill(0);
    if (this.usedHaze) this.haze.fill(0);
    if (this.usedGlow) this.glow.fill(0);
    this.usedBg = this.usedBack = this.usedHaze = this.usedGlow = false;
    this.clip = null;
  }

  /** Cell index, or -1 when outside the grid / clip. */
  idx(x: number, y: number): number {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return -1;
    const c = this.clip;
    if (c && (x < c.x0 || x >= c.x1 || y < c.y0 || y >= c.y1)) return -1;
    return y * this.cols + x;
  }

  set(x: number, y: number, c: string | number, fg: number): void {
    const i = this.idx(x, y);
    if (i < 0) return;
    this.ch[i] = typeof c === 'number' ? c : c.charCodeAt(0);
    this.fg[i] = fg;
  }

  /** Glyph + color + background fill. */
  put(x: number, y: number, c: string | number, fg: number, bg: number): void {
    const i = this.idx(x, y);
    if (i < 0) return;
    this.ch[i] = typeof c === 'number' ? c : c.charCodeAt(0);
    this.fg[i] = fg;
    this.bg[i] = bg | HAS;
    this.usedBg = true;
  }

  /** Clear the glyph and fill the background (an opaque silhouette cell). */
  blank(x: number, y: number, bg: number): void {
    const i = this.idx(x, y);
    if (i < 0) return;
    this.ch[i] = 32;
    this.bg[i] = bg | HAS;
    this.usedBg = true;
  }

  setBg(x: number, y: number, bg: number): void {
    const i = this.idx(x, y);
    if (i < 0) return;
    this.bg[i] = bg | HAS;
    this.usedBg = true;
  }

  /** Erase glyph only (transparent cell). */
  erase(x: number, y: number): void {
    const i = this.idx(x, y);
    if (i >= 0) this.ch[i] = 32;
  }

  get(x: number, y: number): number {
    const i = this.idx(x, y);
    return i < 0 ? 0 : this.ch[i];
  }

  /** Write a string. Spaces are transparent unless a bg is given. */
  text(x: number, y: number, s: string, fg: number, bg = -1): void {
    for (let k = 0; k < s.length; k++) {
      const code = s.charCodeAt(k);
      if (code === 32) {
        if (bg >= 0) this.blank(x + k, y, bg);
        continue;
      }
      if (bg >= 0) this.put(x + k, y, code, fg, bg);
      else this.set(x + k, y, code, fg);
    }
  }

  /**
   * Draw a multi-line sprite. Spaces are transparent, except with `opaque`
   * where spaces between a line's first and last glyph are filled with `bg`.
   */
  sprite(
    x: number,
    y: number,
    lines: readonly string[],
    color: number | ((c: string, lx: number, ly: number) => number),
    bg = -1,
    opaque = false,
  ): void {
    for (let ly = 0; ly < lines.length; ly++) {
      const line = lines[ly];
      let first = 0;
      let last = line.length - 1;
      if (opaque) {
        while (first < line.length && line[first] === ' ') first++;
        while (last >= 0 && line[last] === ' ') last--;
      }
      for (let lx = 0; lx < line.length; lx++) {
        const c = line[lx];
        if (c === ' ') {
          if (opaque && bg >= 0 && lx > first && lx < last) this.blank(x + lx, y + ly, bg);
          continue;
        }
        const col = typeof color === 'number' ? color : color(c, lx, ly);
        if (col < 0) continue;
        if (bg >= 0) this.put(x + lx, y + ly, c, col, bg);
        else this.set(x + lx, y + ly, c, col);
      }
    }
  }

  /** Mix the existing glyph color toward `c`. */
  tint(x: number, y: number, c: RGB, t: number): void {
    const i = this.idx(x, y);
    if (i < 0) return;
    const p = this.fg[i];
    const r = (p >> 16) & 255;
    const g = (p >> 8) & 255;
    const b = p & 255;
    this.fg[i] =
      (((r + (c[0] - r) * t) & 255) << 16) | (((g + (c[1] - g) * t) & 255) << 8) | ((b + (c[2] - b) * t) & 255);
  }

  addGlow(x: number, y: number, c: RGB, k: number): void {
    const i = this.idx(x, y);
    if (i < 0 || k <= 0) return;
    const j = i * 3;
    this.glow[j] += c[0] * k;
    this.glow[j + 1] += c[1] * k;
    this.glow[j + 2] += c[2] * k;
    this.usedGlow = true;
  }

  /** Elliptical glow with a smooth falloff. */
  glowAt(cx: number, cy: number, rx: number, ry: number, c: RGB, k: number): void {
    if (k <= 0.002) return;
    const x0 = Math.floor(cx - rx);
    const x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry);
    const y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) / ry;
      for (let x = x0; x <= x1; x++) {
        const dx = (x - cx) / rx;
        const d = dx * dx + dy * dy;
        if (d >= 1) continue;
        const f = (1 - d) * (1 - d);
        this.addGlow(x, y, c, k * f);
      }
    }
  }

  private paint(layer: Float32Array, x: number, y: number, c: RGB, a: number): boolean {
    const i = this.idx(x, y);
    if (i < 0 || a <= 0) return false;
    if (a > 1) a = 1;
    const j = i * 4;
    const la = layer[j + 3];
    const oa = a + la * (1 - a);
    const k = a / oa;
    layer[j] += (c[0] - layer[j]) * k;
    layer[j + 1] += (c[1] - layer[j + 1]) * k;
    layer[j + 2] += (c[2] - layer[j + 2]) * k;
    layer[j + 3] = oa;
    return true;
  }

  paintBack(x: number, y: number, c: RGB, a: number): void {
    if (this.paint(this.back, x, y, c, a)) this.usedBack = true;
  }

  paintHaze(x: number, y: number, c: RGB, a: number): void {
    if (this.paint(this.haze, x, y, c, a)) this.usedHaze = true;
  }

  /** Soft elliptical backdrop (sun halos, light pollution…). */
  backAt(cx: number, cy: number, rx: number, ry: number, c: RGB, a: number): void {
    if (a <= 0.002) return;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const dy = (y - cy) / ry;
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const d = dx * dx + dy * dy;
        if (d >= 1) continue;
        this.paintBack(x, y, c, a * (1 - d) * (1 - d));
      }
    }
  }
}
