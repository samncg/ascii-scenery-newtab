import { css } from './color';
import { CELL_RATIO, cellWidth, INK, inkStops, fontState, type FrameStyle, type IRenderer, type RenderStyle } from './render-common';
import { HAS, type Grid } from './grid';
import { hash2 } from './math';

/**
 * A cols x rows RGBA image that is uploaded once per frame and stretched over
 * the viewport. With `blur` it is softened at low resolution first, which is
 * far cheaper than blurring the full-size canvas.
 */
class Layer {
  readonly small = document.createElement('canvas');
  readonly soft = document.createElement('canvas');
  private sctx = this.small.getContext('2d')!;
  private bctx = this.soft.getContext('2d')!;
  img: ImageData | null = null;

  resize(cols: number, rows: number): void {
    this.small.width = cols;
    this.small.height = rows;
    this.soft.width = cols * 2;
    this.soft.height = rows * 2;
    this.img = this.sctx.createImageData(cols, rows);
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, blurPx: number): void {
    if (!this.img) return;
    this.sctx.putImageData(this.img, 0, 0);
    if (blurPx > 0) {
      const b = this.bctx;
      b.clearRect(0, 0, this.soft.width, this.soft.height);
      b.filter = `blur(${blurPx}px)`;
      b.imageSmoothingEnabled = true;
      b.drawImage(this.small, 0, 0, this.soft.width, this.soft.height);
      b.filter = 'none';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.soft, 0, 0, w, h);
    } else {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.small, 0, 0, w, h);
    }
  }
}

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Draws the grid as bold monospace glyphs centred in near-square cells.
 * The "ink" style sits everything on near-black with a faint cell grid,
 * darkened color blocks and lifted, gently shimmering glyphs.
 */
export class Renderer2D implements IRenderer {
  readonly kind = '2d' as const;
  readonly ctx: CanvasRenderingContext2D;
  cols = 0;
  rows = 0;
  cw = 10;
  chh = 15;
  w = 0;
  h = 0;
  style: RenderStyle = 'ink';
  private dpr = 1;
  private font = '';
  private bgLayer = new Layer();
  private backLayer = new Layer();
  private hazeLayer = new Layer();
  private glowLayer = new Layer();
  private gridCanvas = document.createElement('canvas');
  private buckets = new Map<number, number[]>();
  private tiles = new Map<number, number[]>();
  private colorCss = new Map<number, string>();
  private chars: string[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not available');
    this.ctx = ctx;
  }

  get aspect(): number {
    return this.chh / this.cw;
  }

  /** Resize to the viewport; `density` is the target number of columns. */
  resize(density: number, style: RenderStyle): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.style = style;
    this.colorCss.clear();
    this.cw = cellWidth(Math.min(density, 150));
    this.chh = Math.round(this.cw * CELL_RATIO);
    this.font = `600 ${Math.round(this.chh * 0.74)}px ${fontState.stack}`;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = this.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    this.cols = Math.ceil(w / this.cw);
    this.rows = Math.ceil(h / this.chh);
    for (const l of [this.bgLayer, this.backLayer, this.hazeLayer, this.glowLayer]) l.resize(this.cols, this.rows);
    this.buildGrid();
  }

  /** Faint cell grid, pre-rendered once per resize. */
  private buildGrid(): void {
    const c = this.gridCanvas;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(255,255,255,0.055)';
    g.lineWidth = 1;
    g.beginPath();
    const d = this.dpr;
    for (let x = 0; x <= this.cols; x++) {
      const px = Math.round(x * this.cw * d) + 0.5;
      g.moveTo(px, 0);
      g.lineTo(px, c.height);
    }
    for (let y = 0; y <= this.rows; y++) {
      const py = Math.round(y * this.chh * d) + 0.5;
      g.moveTo(0, py);
      g.lineTo(c.width, py);
    }
    g.stroke();
  }

  /** Glyph color for a bucket key (color + shimmer level), cached as CSS. */
  private cssFor(key: number): string {
    let s = this.colorCss.get(key);
    if (s) return s;
    if (this.colorCss.size > 6000) this.colorCss.clear();
    let r = (key >> 16) & 255;
    let g = (key >> 8) & 255;
    let b = key & 255;
    if (this.style === 'ink') {
      // Lift dark glyphs so they read on the ink, keeping their hue.
      const L = lum(r, g, b);
      const min = 112;
      if (L < min) {
        const k = Math.min(4, min / Math.max(L, 18));
        r = r * k + 8;
        g = g * k + 10;
        b = b * k + 18;
      }
      const level = (key >>> 24) & 3;
      const f = level === 0 ? 0.8 : level === 2 ? 1.16 : 1;
      r = Math.min(255, r * f);
      g = Math.min(255, g * f);
      b = Math.min(255, b * f);
    }
    s = `rgb(${r | 0},${g | 0},${b | 0})`;
    this.colorCss.set(key, s);
    return s;
  }

  private charFor(code: number): string {
    let s = this.chars[code];
    if (s === undefined) s = this.chars[code] = String.fromCharCode(code);
    return s;
  }

  render(g: Grid, style: FrameStyle): void {
    const ctx = this.ctx;
    const { w, h, cw, chh } = this;
    const ink = this.style === 'ink';
    const gw = g.cols * cw;
    const gh = g.rows * chh;

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 1. Background: the sky gradient (pressed down into the ink).
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    for (const [o, c] of inkStops(style.stops, ink, style.skyInk ?? 1)) grad.addColorStop(Math.min(1, Math.max(0, o)), css(c));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 2. Soft backdrop (cloud bodies, halos).
    if (g.usedBack) {
      this.uploadRGBA(this.backLayer, g.back, ink ? 0.5 : 0, ink ? 0.8 : 1);
      this.backLayer.draw(ctx, gw, gh, 1.4);
    }

    // 3. Cell grid.
    if (ink) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.gridCanvas, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // 4. Per-cell blocks (silhouettes, walls, water). Ink draws them as inset
    //    tiles so the grid shows between them; vivid stretches one image.
    if (g.usedBg) {
      const bg = g.bg;
      if (ink) {
        const tiles = this.tiles;
        for (const arr of tiles.values()) arr.length = 0;
        if (tiles.size > 4000) tiles.clear();
        for (let i = 0; i < g.n; i++) {
          const v = bg[i];
          if (!(v & HAS)) continue;
          const key = v & 0xf8f8f8;
          let arr = tiles.get(key);
          if (!arr) tiles.set(key, (arr = []));
          arr.push(i);
        }
        const cols = g.cols;
        const k = 0.34;
        for (const [key, arr] of tiles) {
          if (!arr.length) continue;
          const r = ((key >> 16) & 255) * (1 - k) + INK[0] * k;
          const gg = ((key >> 8) & 255) * (1 - k) + INK[1] * k;
          const b = (key & 255) * (1 - k) + INK[2] * k;
          const solid = key === 0;
          ctx.fillStyle = solid ? '#000' : `rgb(${r | 0},${gg | 0},${b | 0})`;
          const inset = solid ? 0 : 1;
          for (let n = 0; n < arr.length; n++) {
            const i = arr[n];
            const y = (i / cols) | 0;
            const x = i - y * cols;
            ctx.fillRect(x * cw + inset, y * chh + inset, cw - inset, chh - inset);
          }
        }
      } else {
        const d = this.bgLayer.img!.data;
        for (let i = 0, j = 0; i < g.n; i++, j += 4) {
          const v = bg[i];
          if (v & HAS) {
            d[j] = (v >> 16) & 255;
            d[j + 1] = (v >> 8) & 255;
            d[j + 2] = v & 255;
            d[j + 3] = 255;
          } else d[j + 3] = 0;
        }
        this.bgLayer.draw(ctx, gw, gh, 0);
      }
    }

    // 5. Glyphs, batched by color (+ shimmer level in ink).
    const buckets = this.buckets;
    for (const arr of buckets.values()) arr.length = 0;
    if (buckets.size > 4000) buckets.clear();
    const ch = g.ch;
    const fg = g.fg;
    const slot = Math.floor(style.t * 6);
    for (let i = 0; i < g.n; i++) {
      const c = ch[i];
      if (c === 32 || c === 0) continue;
      let key = fg[i] & 0xfcfcfc;
      if (ink) {
        const s = hash2(i, slot, 41);
        key |= (s < 0.1 ? 0 : s > 0.9 ? 2 : 1) << 24;
      }
      let arr = buckets.get(key);
      if (!arr) buckets.set(key, (arr = []));
      arr.push(i);
    }
    const cols = g.cols;
    const halfW = cw / 2;
    const halfH = chh / 2;
    for (const [key, arr] of buckets) {
      if (!arr.length) continue;
      ctx.fillStyle = this.cssFor(key);
      for (let k = 0; k < arr.length; k++) {
        const i = arr[k];
        const y = (i / cols) | 0;
        const x = i - y * cols;
        ctx.fillText(this.charFor(ch[i]), x * cw + halfW, y * chh + halfH);
      }
    }

    // 6. Haze (fog) in front of the glyphs.
    if (g.usedHaze) {
      this.uploadRGBA(this.hazeLayer, g.haze, ink ? 0.35 : 0, ink ? 0.6 : 1);
      this.hazeLayer.draw(ctx, gw, gh, 1.6);
    }

    // 7. Additive glow (lit windows, neon, moon, lightning).
    if (g.usedGlow) {
      const d = this.glowLayer.img!.data;
      const gl = g.glow;
      for (let i = 0, j = 0, k = 0; i < g.n; i++, j += 4, k += 3) {
        d[j] = gl[k];
        d[j + 1] = gl[k + 1];
        d[j + 2] = gl[k + 2];
        d[j + 3] = 255;
      }
      ctx.globalCompositeOperation = 'lighter';
      this.glowLayer.draw(ctx, gw, gh, 1.2);
      ctx.globalCompositeOperation = 'source-over';
    }

    // 8. Lightning flash.
    if (style.flash > 0.01) {
      ctx.fillStyle = `rgba(214,226,255,${Math.min(0.45, style.flash * 0.38)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private uploadRGBA(layer: Layer, src: Float32Array, toInk: number, alpha: number): void {
    const d = layer.img!.data;
    const k = toInk;
    for (let j = 0; j < src.length; j += 4) {
      d[j] = src[j] * (1 - k) + INK[0] * k;
      d[j + 1] = src[j + 1] * (1 - k) + INK[1] * k;
      d[j + 2] = src[j + 2] * (1 - k) + INK[2] * k;
      d[j + 3] = src[j + 3] * 255 * alpha;
    }
  }
}

