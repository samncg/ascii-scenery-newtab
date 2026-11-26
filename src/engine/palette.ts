import { desat, hex, mix, scale, type RGB, WHITE } from '../core/color';
import { clamp, smoothstep } from '../core/math';
import type { WeatherMix } from './weather';

/**
 * Semantic colors every scene draws with. "*Bg" entries are silhouette fills,
 * the plain entries are glyph colors drawn on top of them.
 */
export interface Palette {
  skyTop: RGB;
  skyMid: RGB;
  skyBottom: RGB;
  far: RGB;
  farBg: RGB;
  mid: RGB;
  midBg: RGB;
  near: RGB;
  nearBg: RGB;
  ground: RGB;
  groundBg: RGB;
  foliage: RGB;
  water: RGB;
  waterBg: RGB;
  light: RGB;
  sun: RGB;
  moon: RGB;
  cloud: RGB;
  cloudShade: RGB;
  fog: RGB;
  // derived
  star: RGB;
  precip: RGB;
  snow: RGB;
  /** 0..1 — how many windows / neon / lamps are switched on. */
  lights: number;
  /** 0..1 star visibility. */
  stars: number;
  /** 0..1 ambient daylight. */
  daylight: number;
}

const KEYS = [
  'skyTop', 'skyMid', 'skyBottom', 'far', 'farBg', 'mid', 'midBg', 'near', 'nearBg', 'ground',
  'groundBg', 'foliage', 'water', 'waterBg', 'light', 'sun', 'moon', 'cloud', 'cloudShade', 'fog',
] as const;
type Key = (typeof KEYS)[number];
type Base = Record<Key, RGB> & { lights: number; stars: number; daylight: number };

function def(colors: string, lights: number, stars: number, daylight: number): Base {
  const parts = colors.trim().split(/\s+/);
  const p = { lights, stars, daylight } as Base;
  KEYS.forEach((k, i) => (p[k] = hex(parts[i])));
  return p;
}

// prettier-ignore
const KF = {
  //                skyTop skyMid skyBot far    farBg  mid    midBg  near   nearBg ground grndBg foliag water  watrBg light  sun    moon   cloud  cldShd fog
  midnight: def('03050c 0c1428 1c2748 2c3858 070b18 3a4668 090e1d 56607e 05070f 2a3a3c 070b10 1f3a3a 3a5a7e 060e1a ffb35c ffcf80 e6ebff 4a5578 1c2440 7d88a8', 1, 1, 0),
  night:    def('070b1e 141f44 2a3a68 34426a 0a1024 404d74 0b1226 5a6488 060912 2e4044 080d14 24423e 46689a 08142a ffb35c ffcf80 eef0ff 56628a 222c4c 8590b0', 1, 0.9, 0.05),
  predawn:  def('1d2150 4a3f78 c9819a 5a5888 2a2850 4e4674 1e1a3c 5e5478 120f22 4a4a5a 161626 3a4a5a 8a80b0 2a2850 ffbe70 ffb070 f0eaf8 e3a7b0 6a5a8a c8b4c8', 0.7, 0.35, 0.25),
  sunrise:  def('5a7ab8 b49ab4 ffbf8a 8a86a8 6a6488 6a6080 3e3654 54486a 1e1828 6a6a58 2a2a2a 4a6a50 c0a0b0 5a5a88 ffcc80 ffd890 f4f0f0 ffd2b0 b08a9a f0d6cc', 0.25, 0, 0.55),
  morning:  def('5b9be0 92c2ec dcecf6 7894b0 9ab4cc 5d7894 6e88a2 34465a 26323f 6a8a5a 3c5a3a 4f8a5a 5c9ccc 2e6a96 fff0c0 fff4d0 ffffff ffffff bcd0e4 e8eff4', 0, 0, 0.9),
  day:      def('2f7ad6 6aa8e6 c4e2f6 7a98b6 98b6d2 4c6884 62809c 2a3a4c 1e2a38 5a8048 34522e 3f7a48 3d8ac4 1e5a8e fff4d0 fffbe8 ffffff ffffff c8d6e6 eef3f6', 0, 0, 1),
  afternoon:def('3a7cc8 7aaedc e4e6dc 8a9cb0 a8b4c4 5a6a80 6c7a90 30384a 222838 6a8048 3a4e2c 4a7a44 4a8ab8 245a88 fff0c8 fff0c0 ffffff fffaf0 d0d0d8 f0f0ec', 0, 0, 0.95),
  golden:   def('4a5c9c c08a8c ffb468 b07a7a c08c80 7a4e66 8a5a66 3e2638 2a1828 7a6040 3e2e22 6a6a3a e0a070 8a5a6a ffcf7a ffc060 fff0e0 ffcf9a c07a7c f6caa8', 0.2, 0, 0.7),
  sunset:   def('2c2a64 8a4a7a ff7650 8a4a6a 6a3858 5a3058 401c40 3a1c38 1e0e20 4a3038 1e1420 3a3040 d07060 4a2a50 ffb860 ff8a50 f6e6e6 ff9a7c 7a3a6a e0a0a0', 0.55, 0.05, 0.4),
  dusk:     def('141a44 3a3468 8a4c70 4a4672 241f48 443e68 18153a 4a4470 0e0c1e 3a3a4a 0e0e1a 2c3a48 7a5a8a 1a1a3a ffb35c ff7040 eeeaff 8a6488 2e2850 9a8aa8', 0.9, 0.55, 0.15),
};

function schedule(sr: number, ss: number): Array<[number, Base]> {
  const raw: Array<[number, Base]> = [
    [0, KF.midnight],
    [sr - 1.4, KF.night],
    [sr - 0.5, KF.predawn],
    [sr + 0.35, KF.sunrise],
    [sr + 1.8, KF.morning],
    [(sr + ss) / 2, KF.day],
    [ss - 2, KF.afternoon],
    [ss - 0.75, KF.golden],
    [ss + 0.05, KF.sunset],
    [ss + 0.75, KF.dusk],
    [ss + 1.8, KF.night],
    [24, KF.midnight],
  ];
  // Keep keyframes strictly increasing even for extreme sunrise/sunset values.
  for (let i = 1; i < raw.length; i++) raw[i][0] = Math.max(raw[i][0], raw[i - 1][0] + 0.05);
  return raw;
}

function lerpBase(a: Base, b: Base, t: number): Base {
  const out = {
    lights: a.lights + (b.lights - a.lights) * t,
    stars: a.stars + (b.stars - a.stars) * t,
    daylight: a.daylight + (b.daylight - a.daylight) * t,
  } as Base;
  for (const k of KEYS) out[k] = mix(a[k], b[k], t);
  return out;
}

/** Palette for a clock hour, blended smoothly between time-of-day keyframes. */
export function paletteAt(hour: number, sr: number, ss: number): Palette {
  const ks = schedule(sr, ss);
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < ks.length - 2 && h >= ks[i + 1][0]) i++;
  const [h0, a] = ks[i];
  const [h1, b] = ks[i + 1];
  const t = smoothstep(0, 1, (h - h0) / Math.max(0.001, h1 - h0));
  const p = lerpBase(a, b, t);
  return {
    ...p,
    star: mix(p.moon, WHITE, 0.4),
    precip: mix(p.fog, p.skyMid, 0.25),
    snow: mix(p.fog, WHITE, 0.65),
  };
}

/** Desaturate / darken / fog the palette according to the current weather. */
export function applyWeather(p: Palette, w: WeatherMix): Palette {
  const gloom = clamp(w.cloud * 0.55 + w.rain * 0.4 + w.storm * 0.35 + w.drizzle * 0.25 + w.snow * 0.2 + w.fog * 0.2);
  const dark = clamp(w.rain * 0.22 + w.storm * 0.32 + w.drizzle * 0.1 + w.cloud * 0.08);
  const fog = clamp(w.fog);
  const sky = (c: RGB, fogK: number): RGB => mix(scale(desat(c, gloom * 0.75), 1 - dark), p.fog, fog * fogK);
  const land = (c: RGB, fogK: number): RGB => mix(scale(desat(c, gloom * 0.45), 1 - dark * 0.6), p.fog, fog * fogK);
  const stormy = clamp(w.rain + w.storm + w.drizzle * 0.5);
  return {
    ...p,
    skyTop: sky(p.skyTop, 0.35),
    skyMid: sky(p.skyMid, 0.55),
    skyBottom: sky(p.skyBottom, 0.7),
    far: land(p.far, 0.5),
    farBg: land(p.farBg, 0.55),
    mid: land(p.mid, 0.3),
    midBg: land(p.midBg, 0.3),
    near: land(p.near, 0.12),
    nearBg: land(p.nearBg, 0.1),
    ground: mix(land(p.ground, 0.15), p.snow, w.snow * 0.55),
    groundBg: mix(land(p.groundBg, 0.15), scale(p.snow, 0.55), w.snow * 0.4),
    foliage: land(p.foliage, 0.2),
    water: land(p.water, 0.3),
    waterBg: land(p.waterBg, 0.3),
    cloud: mix(p.cloud, scale(desat(p.cloud, 1), 0.62), stormy * 0.85),
    cloudShade: mix(p.cloudShade, scale(desat(p.cloudShade, 1), 0.55), stormy * 0.85),
    stars: p.stars * (1 - clamp(w.cloud * 0.85 + w.fog * 0.8 + w.rain + w.snow * 0.6 + w.drizzle * 0.6)),
    lights: clamp(Math.max(p.lights, p.lights + gloom * 0.35 + w.storm * 0.25)),
    daylight: p.daylight * (1 - dark * 0.5),
  };
}
