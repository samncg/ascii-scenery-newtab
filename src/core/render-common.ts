import type { RGB } from './color';
import type { Grid } from './grid';

export const MONO_STACK = '"Geist Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace';

/** Font used for the ASCII art (set from settings before each resize). */
export const fontState = { stack: MONO_STACK };

/** Near-black "ink" the default style is built on. */
export const INK: RGB = [6, 7, 12];

/** Cell height / width. Close to square for the tiled grid look. */
export const CELL_RATIO = 1.2;

export type RenderStyle = 'ink' | 'vivid';

/** A liquid-glass panel, in CSS pixels (top-left origin). */
export interface GlassPanel {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  opacity: number;
  /** 0..1 how much the glass darkens what is behind it (for legibility). */
  dark: number;
  /** Frost blur radius in CSS px. */
  blur: number;
}

export interface FrameStyle {
  /** Vertical background gradient: [offset 0..1, color]. */
  stops: Array<[number, RGB]>;
  /** How far the ink style presses the sky toward black (0..1, default 1). */
  skyInk?: number;
  /** Lightning flash 0..1. */
  flash: number;
  /** Seconds, drives the glyph shimmer. */
  t: number;
  panels?: GlassPanel[];
}

export interface IRenderer {
  readonly kind: 'gl' | '2d';
  cols: number;
  rows: number;
  cw: number;
  chh: number;
  readonly aspect: number;
  resize(density: number, style: RenderStyle): void;
  render(g: Grid, f: FrameStyle): void;
}

/** Cell width (CSS px) for a target column count. */
export const cellWidth = (density: number): number =>
  Math.min(24, Math.max(4, Math.round(Math.max(1, window.innerWidth) / density)));

/** Press gradient stops toward the ink. */
export function inkStops(stops: Array<[number, RGB]>, ink: boolean, amount = 1): Array<[number, RGB]> {
  if (!ink || amount <= 0) return stops;
  return stops.map(([o, c]) => {
    const oo = Math.min(1, Math.max(0, o));
    const k = (0.84 - 0.22 * oo) * amount;
    return [o, [c[0] + (INK[0] - c[0]) * k, c[1] + (INK[1] - c[1]) * k, c[2] + (INK[2] - c[2]) * k]];
  });
}
