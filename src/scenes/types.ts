import type { RGB } from '../core/color';
import type { Grid, Rect } from '../core/grid';
import type { Palette } from '../engine/palette';
import type { TimeState } from '../engine/time';
import type { WeatherMix } from '../engine/weather';

export type SceneId =
  | 'tokyo'
  | 'sf'
  | 'silhouette'
  | 'aurora'
  | 'dunes'
  | 'ocean'
  | 'koi'
  | 'butterflies'
  | 'mantas'
  | 'jellyfish'
  | 'whales'
  | 'turtles'
  | 'starlings'
  | 'fireflies';

export interface Body {
  x: number;
  y: number;
  visible: boolean;
  /** 0..1 above the horizon, ≤0 below. */
  alt: number;
}

/** Everything a scene needs to draw one frame. */
export interface Env {
  t: number;
  dt: number;
  cols: number;
  rows: number;
  /** Cell height / width (≈1.45) — use it to keep circles round. */
  aspect: number;
  time: TimeState;
  w: WeatherMix;
  pal: Palette;
  sun: Body;
  moon: Body;
  flash: number;
  month: number;
  /** Temperature in °C if known (drives chimney smoke, steam…). */
  tempC?: number;
}

export interface Scene {
  readonly id: SceneId;
  /** Draw sky (stars, sun, moon, clouds, birds)? */
  sky: boolean;
  /** Row where land meets sky (sun/moon path + gradient). */
  horizonRow: number;
  /** Sky and weather are confined to this rect (null = whole screen). */
  clip: Rect | null;
  /** Horizontal surfaces [x0, x1, y] where rain splashes / snow settles. */
  surfaces: Array<[number, number, number]>;
  /** Multiplier on rain streak density (top-down scenes use less). */
  rainScale: number;
  /** Allow flocks of birds in the sky. */
  birds: boolean;
  /** How far the ink style darkens this scene's sky (0 keeps it, e.g. golden sunsets). */
  skyInk?: number;
  init(cols: number, rows: number): void;
  draw(g: Grid, env: Env): void;
  /** Optional layer drawn after the weather (things in front of the glass). */
  drawFront(g: Grid, env: Env): void;
  /** Fog density shaping per row (0..1). */
  fogBias(y: number, env: Env): number;
  /** Extra fog independent of weather (e.g. San Francisco's marine layer). */
  ambientFog(env: Env): number;
  /** Background gradient stops. */
  stops(env: Env): Array<[number, RGB]>;
}

export abstract class BaseScene implements Scene {
  abstract readonly id: SceneId;
  sky = true;
  horizonRow = 0;
  clip: Rect | null = null;
  surfaces: Array<[number, number, number]> = [];
  rainScale = 1;
  birds = true;
  skyInk = 1;
  cols = 0;
  rows = 0;

  init(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.horizonRow = Math.round(rows * 0.65);
  }

  abstract draw(g: Grid, env: Env): void;

  drawFront(_g: Grid, _env: Env): void {}

  fogBias(y: number, _env: Env): number {
    const h = this.horizonRow;
    const d = (y - h) / (this.rows * 0.35);
    return 0.35 + 0.65 * Math.exp(-d * d);
  }

  ambientFog(_env: Env): number {
    return 0;
  }

  stops(env: Env): Array<[number, RGB]> {
    const p = env.pal;
    const hf = this.horizonRow / Math.max(1, this.rows);
    return [
      [0, p.skyTop],
      [hf * 0.55, p.skyMid],
      [hf, p.skyBottom],
      [1, p.groundBg],
    ];
  }
}
