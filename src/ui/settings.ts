import { type AnimalDirection, KOI_VARIETIES, type KoiVariety } from '../scenes/prefs';
import type { SceneId } from '../scenes/types';
import type { TimeOverride } from '../engine/time';
import type { GeoLocation, WeatherKind } from '../engine/weather';
import { readExt, readLocal, writeExt, writeLocal } from './storage';

export interface QuickLink {
  id: string;
  title: string;
  url: string;
}

export type EngineId = 'google' | 'duckduckgo' | 'bing' | 'brave' | 'startpage' | 'kagi' | 'perplexity' | 'chatgpt' | 'claude';

export const SCENE_IDS: readonly SceneId[] = ['tokyo', 'cabin', 'sf', 'silhouette', 'aurora', 'cat', 'koi', 'clearing', 'butterflies', 'mantas', 'jellyfish'];

export interface Settings {
  scene: SceneId;
  name: string;
  timeGreeting: boolean;
  engine: EngineId;
  links: QuickLink[];
  sync: boolean;
  manualTime: TimeOverride;
  manualWeather: WeatherKind;
  location: GeoLocation | null;
  units: 'c' | 'f';
  showClock: boolean;
  clock24: boolean;
  showLinks: boolean;
  showStatus: boolean;
  showHud: boolean;
  hudPosition: 'top' | 'center';
  showSceneBar: boolean;
  /** 'ink' = dark grid look, 'vivid' = full-color skies. */
  style: 'ink' | 'vivid';
  /** Target number of ASCII columns across the screen. */
  density: number;
  clockPosition: 'above' | 'below' | 'top-left' | 'top-right';
  /** Clock font size in px. */
  clockSize: number;
  showDate: boolean;
  /** Creature size multiplier (0.5 … 2). */
  animalSize: number;
  animalDirection: AnimalDirection;
  koiVarieties: KoiVariety[];
}

const uid = (): string => Math.random().toString(36).slice(2, 10);

export const DEFAULT_LINKS: QuickLink[] = [
  { id: uid(), title: 'GitHub', url: 'https://github.com' },
  { id: uid(), title: 'YouTube', url: 'https://www.youtube.com' },
  { id: uid(), title: 'Gmail', url: 'https://mail.google.com' },
  { id: uid(), title: 'Wikipedia', url: 'https://en.wikipedia.org' },
  { id: uid(), title: 'Reddit', url: 'https://www.reddit.com' },
];

export const DEFAULTS: Settings = {
  scene: 'tokyo',
  name: '',
  timeGreeting: true,
  engine: 'google',
  links: DEFAULT_LINKS,
  sync: true,
  manualTime: 'night',
  manualWeather: 'clear',
  location: null,
  units: 'c',
  showClock: true,
  clock24: false,
  showLinks: true,
  showStatus: true,
  showHud: true,
  hudPosition: 'center',
  showSceneBar: false,
  style: 'ink',
  density: 248,
  clockPosition: 'above',
  clockSize: 72,
  showDate: true,
  animalSize: 1,
  animalDirection: 'free',
  koiVarieties: KOI_VARIETIES.map((v) => v.id),
};

const KEY = 'asn:settings:v4';
/** Previous version, migrated once (the clock is now on by default). */
const OLD_KEY = 'asn:settings:v3';

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const s: Settings = { ...DEFAULTS, ...r };
  s.scene = oneOf(s.scene, SCENE_IDS, DEFAULTS.scene);
  s.engine = oneOf(s.engine, ['google', 'duckduckgo', 'bing', 'brave', 'startpage', 'kagi', 'perplexity', 'chatgpt', 'claude'], 'google');
  s.manualTime = oneOf(s.manualTime, ['dawn', 'morning', 'day', 'golden', 'dusk', 'night', 'midnight'], 'night');
  s.manualWeather = oneOf(s.manualWeather, ['clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'thunder', 'snow'], 'clear');
  s.units = oneOf(s.units, ['c', 'f'], 'c');
  s.hudPosition = oneOf(s.hudPosition, ['top', 'center'], 'center');
  s.style = oneOf(s.style, ['ink', 'vivid'], 'ink');
  s.name = typeof s.name === 'string' ? s.name.slice(0, 40) : '';
  s.density = Math.min(420, Math.max(100, Math.round(Number(s.density) || 248)));
  s.clockPosition = oneOf(s.clockPosition, ['above', 'below', 'top-left', 'top-right'], 'above');
  s.clockSize = Math.min(180, Math.max(14, Math.round(Number(s.clockSize) || 72)));
  s.animalSize = Math.min(2, Math.max(0.5, Number(s.animalSize) || 1));
  s.animalDirection = oneOf(s.animalDirection, ['free', 'right', 'left', 'up', 'down'], 'free');
  const ids = KOI_VARIETIES.map((v) => v.id) as KoiVariety[];
  const koi = Array.isArray(s.koiVarieties) ? s.koiVarieties.filter((v) => ids.includes(v)) : [];
  s.koiVarieties = koi.length ? koi : ids;
  delete (s as Partial<Settings> & { fontSize?: number }).fontSize;
  delete (s as Partial<Settings> & { fps?: number }).fps;
  s.links = Array.isArray(s.links)
    ? s.links
        .filter((l) => l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url))
        .slice(0, 16)
        .map((l) => ({ id: typeof l.id === 'string' ? l.id : uid(), title: String(l.title ?? '').slice(0, 40), url: l.url }))
    : DEFAULT_LINKS;
  const loc = s.location;
  s.location =
    loc && typeof loc.lat === 'number' && typeof loc.lon === 'number' && typeof loc.name === 'string' ? loc : null;
  return s;
}

type Listener = (s: Readonly<Settings>, changed: ReadonlySet<keyof Settings>) => void;

export class SettingsStore {
  private s: Settings;
  private subs = new Set<Listener>();
  private saveTimer = 0;

  constructor() {
    let local = readLocal<Settings>(KEY);
    if (!local) {
      const old = readLocal<Settings>(OLD_KEY);
      if (old) {
        local = sanitize({ ...old, showClock: true });
        writeLocal(KEY, local);
      }
    }
    this.s = sanitize(local);
    if (!local) {
      // A fresh localStorage (e.g. cleared site data): try the extension mirror.
      void readExt<Settings>(KEY).then((ext) => {
        if (!ext) return;
        this.s = sanitize(ext);
        writeLocal(KEY, this.s);
        this.emit(new Set(Object.keys(this.s) as Array<keyof Settings>));
      });
    }
  }

  get(): Readonly<Settings> {
    return this.s;
  }

  update(patch: Partial<Settings>): void {
    const changed = new Set<keyof Settings>();
    for (const k of Object.keys(patch) as Array<keyof Settings>) {
      if (JSON.stringify(this.s[k]) !== JSON.stringify(patch[k])) changed.add(k);
    }
    if (!changed.size) return;
    this.s = sanitize({ ...this.s, ...patch });
    writeLocal(KEY, this.s);
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void writeExt(KEY, this.s), 400);
    this.emit(changed);
  }

  reset(): void {
    this.update({ ...DEFAULTS, links: DEFAULT_LINKS.map((l) => ({ ...l, id: uid() })) });
  }

  subscribe(fn: Listener): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private emit(changed: ReadonlySet<keyof Settings>): void {
    for (const fn of this.subs) fn(this.s, changed);
  }
}

export { uid };
