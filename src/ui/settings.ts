import { type AnimalDirection, KOI_VARIETIES, type KoiVariety } from '../scenes/prefs';
import type { SceneId } from '../scenes/types';
import type { TimeOverride } from '../engine/time';
import type { GeoLocation, WeatherKind } from '../engine/weather';
import { FONT_TARGETS, FONTS, type FontId, type FontTarget } from './fonts';
import { readExt, readLocal, writeExt, writeLocal } from './storage';

export interface QuickLink {
  id: string;
  title: string;
  url: string;
}

export type EngineId = 'google' | 'duckduckgo' | 'bing' | 'brave' | 'startpage' | 'kagi' | 'perplexity' | 'chatgpt' | 'claude';

export const SCENE_IDS: readonly SceneId[] = [
  'tokyo', 'sf', 'silhouette', 'aurora', 'dunes', 'ocean',
  'koi', 'butterflies', 'mantas', 'jellyfish', 'whales', 'turtles', 'starlings', 'fireflies',
];

export interface Settings {
  scene: SceneId;
  name: string;
  /** 'time' = Good morning…, 'hello' = Hello, 'custom' = greetingText. */
  greetingMode: 'time' | 'hello' | 'custom';
  greetingText: string;
  greetingSize: number;
  engine: EngineId;
  links: QuickLink[];
  sync: boolean;
  manualTime: TimeOverride;
  manualWeather: WeatherKind;
  location: GeoLocation | null;
  units: 'c' | 'f';
  showClock: boolean;
  clock24: boolean;
  showGreeting: boolean;
  showSearch: boolean;
  showLinks: boolean;
  showStatus: boolean;
  showGear: boolean;
  dateFormat: 'long' | 'short' | 'numeric';
  searchSize: 'compact' | 'regular' | 'tall';
  searchWidth: number;
  showMic: boolean;
  showEngine: boolean;
  linkSize: number;
  linkLabels: 'hover' | 'always' | 'never';
  statusPosition: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
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
  /** Font per element ('default' keeps the element's own font). */
  fonts: Record<FontTarget, FontId>;
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
  greetingMode: 'time',
  greetingText: '',
  greetingSize: 40,
  engine: 'google',
  links: DEFAULT_LINKS,
  sync: true,
  manualTime: 'night',
  manualWeather: 'clear',
  location: null,
  units: 'c',
  showClock: true,
  clock24: false,
  showGreeting: true,
  showSearch: true,
  showLinks: true,
  showStatus: true,
  showGear: true,
  dateFormat: 'long',
  searchSize: 'regular',
  searchWidth: 720,
  showMic: true,
  showEngine: true,
  linkSize: 46,
  linkLabels: 'hover',
  statusPosition: 'bottom-left',
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
  fonts: { clock: 'default', date: 'default', greeting: 'default', search: 'default', links: 'default', status: 'default', ascii: 'geist-mono' },
};

const KEY = 'asn:settings:v4';
/** Previous version, migrated once (the clock is now on by default). */
const OLD_KEY = 'asn:settings:v3';

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

type Legacy = Partial<Settings> & { showHud?: boolean; timeGreeting?: boolean };

function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Legacy;
  // Older versions had one switch for greeting + search, and a time-greeting toggle.
  if (r.showHud === false) r.showGreeting = r.showSearch = r.showGreeting ?? false;
  if (r.greetingMode === undefined && r.timeGreeting === false) r.greetingMode = 'hello';
  delete r.showHud;
  delete r.timeGreeting;
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
  s.greetingMode = oneOf(s.greetingMode, ['time', 'hello', 'custom'], 'time');
  s.greetingText = typeof s.greetingText === 'string' ? s.greetingText.slice(0, 80) : '';
  s.greetingSize = Math.min(96, Math.max(14, Math.round(Number(s.greetingSize) || 40)));
  s.dateFormat = oneOf(s.dateFormat, ['long', 'short', 'numeric'], 'long');
  s.searchSize = oneOf(s.searchSize, ['compact', 'regular', 'tall'], 'regular');
  s.searchWidth = Math.min(1100, Math.max(320, Math.round(Number(s.searchWidth) || 720)));
  s.linkSize = Math.min(72, Math.max(28, Math.round(Number(s.linkSize) || 46)));
  s.linkLabels = oneOf(s.linkLabels, ['hover', 'always', 'never'], 'hover');
  s.statusPosition = oneOf(s.statusPosition, ['bottom-left', 'bottom-right', 'top-left', 'top-right'], 'bottom-left');
  s.clockPosition = oneOf(s.clockPosition, ['above', 'below', 'top-left', 'top-right'], 'above');
  s.clockSize = Math.min(180, Math.max(14, Math.round(Number(s.clockSize) || 72)));
  s.animalSize = Math.min(2, Math.max(0.5, Number(s.animalSize) || 1));
  s.animalDirection = oneOf(s.animalDirection, ['free', 'right', 'left', 'up', 'down'], 'free');
  const ids = KOI_VARIETIES.map((v) => v.id) as KoiVariety[];
  const koi = Array.isArray(s.koiVarieties) ? s.koiVarieties.filter((v) => ids.includes(v)) : [];
  s.koiVarieties = koi.length ? koi : ids;
  const fontIds = FONTS.map((f) => f.id) as FontId[];
  const fonts = (s.fonts && typeof s.fonts === 'object' ? s.fonts : {}) as Partial<Record<FontTarget, FontId>>;
  s.fonts = Object.fromEntries(FONT_TARGETS.map((t) => [t, oneOf(fonts[t], fontIds, DEFAULTS.fonts[t])])) as Record<FontTarget, FontId>;
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
