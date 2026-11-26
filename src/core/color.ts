/** Colors are plain [r, g, b] tuples (0-255) or packed 0xRRGGBB integers. */
export type RGB = [number, number, number];

export function hex(s: string): RGB {
  const n = parseInt(s.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const c8 = (v: number): number => (v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0);

export const packRGB = (r: number, g: number, b: number): number => (c8(r) << 16) | (c8(g) << 8) | c8(b);
export const pack = (c: RGB): number => packRGB(c[0], c[1], c[2]);
export const unpack = (p: number): RGB => [(p >> 16) & 255, (p >> 8) & 255, p & 255];

/** Mix two colors and pack the result, without allocating. */
export const mixPack = (a: RGB, b: RGB, t: number): number =>
  packRGB(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

export const scalePack = (c: RGB, k: number): number => packRGB(c[0] * k, c[1] * k, c[2] * k);

export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const lum = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const desat = (c: RGB, t: number): RGB => {
  const l = lum(c);
  return mix(c, [l, l, l], t);
};

/** Mix a packed color toward an RGB tuple. */
export const mixPacked = (p: number, c: RGB, t: number): number =>
  packRGB(
    ((p >> 16) & 255) + (c[0] - ((p >> 16) & 255)) * t,
    ((p >> 8) & 255) + (c[1] - ((p >> 8) & 255)) * t,
    (p & 255) + (c[2] - (p & 255)) * t,
  );

export const css = (c: RGB, a = 1): string =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

export const WHITE: RGB = [255, 255, 255];
export const BLACK: RGB = [0, 0, 0];
