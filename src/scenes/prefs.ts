/** User preferences the creature scenes read (kept in sync by main.ts). */

export type AnimalDirection = 'free' | 'right' | 'left' | 'up' | 'down';

export const DIRECTIONS: Array<{ id: AnimalDirection; label: string }> = [
  { id: 'free', label: 'Free roam' },
  { id: 'right', label: 'Left → right' },
  { id: 'left', label: 'Right → left' },
  { id: 'up', label: 'Upward' },
  { id: 'down', label: 'Downward' },
];

export const KOI_VARIETIES = [
  { id: 'kohaku', label: 'Kohaku' },
  { id: 'sanke', label: 'Sanke' },
  { id: 'showa', label: 'Showa' },
  { id: 'ogon', label: 'Ogon' },
  { id: 'tancho', label: 'Tancho' },
  { id: 'asagi', label: 'Asagi' },
  { id: 'chagoi', label: 'Chagoi' },
  { id: 'yamabuki', label: 'Yamabuki' },
  { id: 'utsuri', label: 'Shiro Utsuri' },
  { id: 'kiutsuri', label: 'Ki Utsuri' },
  { id: 'kumonryu', label: 'Kumonryu' },
  { id: 'goshiki', label: 'Goshiki' },
] as const;

export type KoiVariety = (typeof KOI_VARIETIES)[number]['id'];

export const scenePrefs = {
  /** Multiplier on creature size (0.5 … 2). */
  animalSize: 1,
  animalDirection: 'free' as AnimalDirection,
  koiVarieties: KOI_VARIETIES.map((v) => v.id) as KoiVariety[],
};

/** Heading (radians, screen space) for a direction, or null when free. */
export function directionAngle(d: AnimalDirection): number | null {
  switch (d) {
    case 'right':
      return 0;
    case 'left':
      return Math.PI;
    case 'up':
      return -Math.PI / 2;
    case 'down':
      return Math.PI / 2;
    default:
      return null;
  }
}

/** Wrap a position around the screen with a margin (for directional travel). */
export function wrap(p: { x: number; y: number }, cols: number, rows: number, m: number): boolean {
  let moved = false;
  if (p.x < -m) (p.x += cols + 2 * m), (moved = true);
  else if (p.x > cols + m) (p.x -= cols + 2 * m), (moved = true);
  if (p.y < -m) (p.y += rows + 2 * m), (moved = true);
  else if (p.y > rows + m) (p.y -= rows + 2 * m), (moved = true);
  return moved;
}
