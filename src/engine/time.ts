import { clamp } from '../core/math';

export type TimePhase = 'dawn' | 'morning' | 'day' | 'golden' | 'dusk' | 'night';
export type TimeOverride = 'dawn' | 'morning' | 'day' | 'golden' | 'dusk' | 'night' | 'midnight';

export const TIME_OPTIONS: Array<{ id: TimeOverride; label: string }> = [
  { id: 'dawn', label: 'Dawn' },
  { id: 'morning', label: 'Morning' },
  { id: 'day', label: 'Afternoon' },
  { id: 'golden', label: 'Golden hour' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'night', label: 'Night' },
  { id: 'midnight', label: 'Midnight' },
];

export const DEFAULT_SUNRISE = 6.5;
export const DEFAULT_SUNSET = 18.5;

export interface Celestial {
  visible: boolean;
  /** 0 at rise, 1 at set. */
  progress: number;
  /** -1..1, sin of arc. */
  altitude: number;
}

export interface TimeState {
  hour: number;
  sunrise: number;
  sunset: number;
  phase: TimePhase;
  sun: Celestial;
  moon: Celestial & { phase: number; illumination: number };
}

export const hourOf = (d: Date): number => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;

/** A representative clock hour for a manual time-of-day override. */
export function overrideHour(o: TimeOverride, sr: number, ss: number): number {
  switch (o) {
    case 'dawn':
      return sr - 0.05;
    case 'morning':
      return sr + 2.2;
    case 'day':
      return (sr + ss) / 2 + 1.5;
    case 'golden':
      return ss - 0.55;
    case 'dusk':
      return ss + 0.45;
    case 'night':
      return ss + 3;
    case 'midnight':
      return 0.5;
  }
}

export function phaseOf(hour: number, sr: number, ss: number): TimePhase {
  if (hour >= sr - 0.9 && hour < sr + 1.2) return 'dawn';
  if (hour >= sr + 1.2 && hour < Math.min(11.5, ss - 2)) return 'morning';
  if (hour >= sr && hour < ss - 1.3) return 'day';
  if (hour >= ss - 1.3 && hour < ss + 0.25) return 'golden';
  if (hour >= ss + 0.25 && hour < ss + 1.3) return 'dusk';
  return 'night';
}

/** 0 = new moon, 0.5 = full moon. */
export function moonPhase(date: Date): number {
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - ref) / 86400000;
  return (((days % synodic) + synodic) % synodic) / synodic;
}

export function computeTime(hour: number, sr: number, ss: number, date: Date): TimeState {
  hour = ((hour % 24) + 24) % 24;
  const dayLen = Math.max(1, ss - sr);
  const sp = (hour - sr) / dayLen;
  const nightLen = 24 - dayLen;
  const mp = (((hour - ss) % 24) + 24) % 24 / nightLen;
  const phase = moonPhase(date);
  return {
    hour,
    sunrise: sr,
    sunset: ss,
    phase: phaseOf(hour, sr, ss),
    sun: { visible: sp > -0.06 && sp < 1.06, progress: sp, altitude: Math.sin(clamp(sp, -0.2, 1.2) * Math.PI) },
    moon: {
      visible: mp > -0.02 && mp < 1.02,
      progress: mp,
      altitude: Math.sin(clamp(mp, -0.2, 1.2) * Math.PI),
      phase,
      illumination: (1 - Math.cos(2 * Math.PI * phase)) / 2,
    },
  };
}

/** "Good morning, Sam" … "Still up, Sam?" */
export function greetingFor(hour: number, name: string, timeAware: boolean): string {
  const n = name.trim();
  if (!timeAware) return n ? `Hello, ${n}` : 'Hello';
  if (hour >= 22 || hour < 5) return n ? `Still up, ${n}?` : 'Still up?';
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return n ? `${hello}, ${n}` : hello;
}
