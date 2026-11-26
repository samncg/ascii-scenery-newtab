import { clamp } from '../core/math';
import { readLocal, writeLocal } from '../ui/storage';

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'thunder' | 'snow';

export const WEATHER_OPTIONS: Array<{ id: WeatherKind; label: string }> = [
  { id: 'clear', label: 'Clear' },
  { id: 'partly', label: 'Partly cloudy' },
  { id: 'cloudy', label: 'Overcast' },
  { id: 'fog', label: 'Fog / mist' },
  { id: 'drizzle', label: 'Drizzle' },
  { id: 'rain', label: 'Rain' },
  { id: 'thunder', label: 'Thunderstorm' },
  { id: 'snow', label: 'Snow' },
];

export interface GeoLocation {
  name: string;
  lat: number;
  lon: number;
  admin?: string;
  country?: string;
  /** True when it came from browser geolocation (name is approximate). */
  approx?: boolean;
}

export interface WeatherState {
  kind: WeatherKind;
  /** 0..1 strength of the precipitation / fog. */
  intensity: number;
  cloudCover: number;
  /** Screen-space wind, -1 (blowing left) .. 1 (blowing right). */
  wind: number;
  label: string;
  tempC?: number;
  code?: number;
  /** Sunrise/sunset as local clock hours (only when the location shares our timezone). */
  sunrise?: number;
  sunset?: number;
  fetchedAt?: number;
  live: boolean;
}

/** Continuous weather parameters the renderer animates between. */
export interface WeatherMix {
  cloud: number;
  rain: number;
  drizzle: number;
  snow: number;
  fog: number;
  storm: number;
  wind: number;
}

export const CLEAR: WeatherState = { kind: 'clear', intensity: 0, cloudCover: 0.05, wind: 0.15, label: 'Clear', live: false };

const MANUAL: Record<WeatherKind, Omit<WeatherState, 'live' | 'label'>> = {
  clear: { kind: 'clear', intensity: 0, cloudCover: 0.04, wind: 0.15 },
  partly: { kind: 'partly', intensity: 0, cloudCover: 0.42, wind: 0.25 },
  cloudy: { kind: 'cloudy', intensity: 0, cloudCover: 0.92, wind: 0.3 },
  fog: { kind: 'fog', intensity: 0.85, cloudCover: 0.6, wind: 0.2 },
  drizzle: { kind: 'drizzle', intensity: 0.55, cloudCover: 0.85, wind: -0.2 },
  rain: { kind: 'rain', intensity: 0.8, cloudCover: 0.95, wind: -0.35 },
  thunder: { kind: 'thunder', intensity: 1, cloudCover: 1, wind: -0.55 },
  snow: { kind: 'snow', intensity: 0.75, cloudCover: 0.85, wind: 0.3 },
};

export function manualWeather(kind: WeatherKind): WeatherState {
  const label = WEATHER_OPTIONS.find((o) => o.id === kind)?.label ?? 'Clear';
  return { ...MANUAL[kind], label, live: false };
}

/** WMO weather interpretation codes, as used by Open-Meteo. */
export function fromWmo(code: number): { kind: WeatherKind; intensity: number; label: string } {
  const t = (kind: WeatherKind, intensity: number, label: string) => ({ kind, intensity, label });
  switch (code) {
    case 0: return t('clear', 0, 'Clear');
    case 1: return t('partly', 0, 'Mainly clear');
    case 2: return t('partly', 0, 'Partly cloudy');
    case 3: return t('cloudy', 0, 'Overcast');
    case 45: return t('fog', 0.8, 'Fog');
    case 48: return t('fog', 0.9, 'Rime fog');
    case 51: return t('drizzle', 0.35, 'Light drizzle');
    case 53: return t('drizzle', 0.55, 'Drizzle');
    case 55: return t('drizzle', 0.75, 'Dense drizzle');
    case 56: return t('drizzle', 0.45, 'Freezing drizzle');
    case 57: return t('drizzle', 0.7, 'Freezing drizzle');
    case 61: return t('rain', 0.45, 'Light rain');
    case 63: return t('rain', 0.7, 'Rain');
    case 65: return t('rain', 1, 'Heavy rain');
    case 66: return t('rain', 0.5, 'Freezing rain');
    case 67: return t('rain', 0.85, 'Freezing rain');
    case 71: return t('snow', 0.4, 'Light snow');
    case 73: return t('snow', 0.7, 'Snow');
    case 75: return t('snow', 1, 'Heavy snow');
    case 77: return t('snow', 0.3, 'Snow grains');
    case 80: return t('rain', 0.5, 'Rain showers');
    case 81: return t('rain', 0.75, 'Rain showers');
    case 82: return t('rain', 1, 'Violent showers');
    case 85: return t('snow', 0.55, 'Snow showers');
    case 86: return t('snow', 0.9, 'Heavy snow showers');
    case 95: return t('thunder', 0.8, 'Thunderstorm');
    case 96: return t('thunder', 0.9, 'Thunderstorm, hail');
    case 99: return t('thunder', 1, 'Severe thunderstorm');
    default: return t('clear', 0, 'Clear');
  }
}

export function mixTarget(w: WeatherState): WeatherMix {
  const m: WeatherMix = { cloud: w.cloudCover, rain: 0, drizzle: 0, snow: 0, fog: 0, storm: 0, wind: w.wind };
  const i = w.intensity;
  switch (w.kind) {
    case 'fog': m.fog = 0.55 + 0.45 * i; break;
    case 'drizzle': m.drizzle = 0.4 + 0.6 * i; break;
    case 'rain': m.rain = 0.35 + 0.65 * i; break;
    case 'thunder': m.rain = Math.max(0.85, i); m.storm = 1; break;
    case 'snow': m.snow = 0.35 + 0.65 * i; break;
    default: break;
  }
  return m;
}

/** Ease every parameter toward the target so weather changes cross-fade. */
export function stepMix(cur: WeatherMix, target: WeatherMix, dt: number): WeatherMix {
  const k = 1 - Math.exp(-dt * 1.4);
  const out = { ...cur };
  for (const key of Object.keys(target) as Array<keyof WeatherMix>) {
    out[key] = cur[key] + (target[key] - cur[key]) * k;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Open-Meteo (free, no API key). Attribution: Weather data by Open-Meteo.com
// ---------------------------------------------------------------------------

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const CACHE_KEY = 'asn:weather:v1';
const TTL = 20 * 60 * 1000;

async function getJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface GeoResult {
  results?: Array<{ name: string; latitude: number; longitude: number; admin1?: string; country_code?: string; country?: string }>;
}

export async function geocode(query: string): Promise<GeoLocation[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${GEOCODE}?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
  const j = await getJson<GeoResult>(url);
  return (j.results ?? []).map((r) => ({
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    admin: r.admin1,
    country: r.country_code ?? r.country,
  }));
}

interface ForecastResult {
  utc_offset_seconds?: number;
  timezone?: string;
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    cloud_cover?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
  daily?: { sunrise?: string[]; sunset?: string[] };
}

/** Convert an Open-Meteo local ISO time ("2026-11-26T06:41") into our local clock hour. */
function toLocalHour(iso: string | undefined, offsetSec: number): number | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return undefined;
  const epoch = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offsetSec * 1000;
  const d = new Date(epoch);
  return d.getHours() + d.getMinutes() / 60;
}

export async function fetchWeather(loc: GeoLocation): Promise<WeatherState & { timezone?: string }> {
  const url =
    `${FORECAST}?latitude=${loc.lat.toFixed(3)}&longitude=${loc.lon.toFixed(3)}` +
    '&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m' +
    '&daily=sunrise,sunset&forecast_days=1&timezone=auto';
  const j = await getJson<ForecastResult>(url);
  const c = j.current ?? {};
  const code = c.weather_code ?? 0;
  const base = fromWmo(code);
  const speed = c.wind_speed_10m ?? 8;
  const dir = ((c.wind_direction_10m ?? 270) * Math.PI) / 180;
  // Meteorological direction is where the wind comes FROM; on screen, east = right.
  const wind = clamp(-Math.sin(dir) * clamp(speed / 35, 0.08, 1), -1, 1);
  const offset = j.utc_offset_seconds ?? 0;
  const sameZone = Math.abs(offset + new Date().getTimezoneOffset() * 60) <= 3600;
  return {
    ...base,
    cloudCover: clamp((c.cloud_cover ?? (base.kind === 'clear' ? 5 : 60)) / 100),
    wind,
    tempC: c.temperature_2m,
    code,
    sunrise: sameZone ? toLocalHour(j.daily?.sunrise?.[0], offset) : undefined,
    sunset: sameZone ? toLocalHour(j.daily?.sunset?.[0], offset) : undefined,
    fetchedAt: Date.now(),
    live: true,
    timezone: j.timezone,
  };
}

interface CacheEntry {
  lat: number;
  lon: number;
  state: WeatherState;
}

export type WeatherStatus = 'none' | 'loading' | 'ok' | 'stale' | 'error';

/**
 * Keeps live weather for the chosen location, cached in localStorage so a new
 * tab paints instantly and the network is only touched every ~20 minutes.
 */
export class WeatherService {
  state: WeatherState = CLEAR;
  status: WeatherStatus = 'none';
  private loc: GeoLocation | null = null;
  private inflight: Promise<void> | null = null;

  constructor(private onChange: () => void) {
    setInterval(() => void this.refresh(), 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.refresh();
    });
  }

  get location(): GeoLocation | null {
    return this.loc;
  }

  setLocation(loc: GeoLocation | null): void {
    this.loc = loc;
    if (!loc) {
      this.state = CLEAR;
      this.status = 'none';
      this.onChange();
      return;
    }
    const cached = readLocal<CacheEntry>(CACHE_KEY);
    if (cached && same(cached, loc)) {
      this.state = cached.state;
      this.status = Date.now() - (cached.state.fetchedAt ?? 0) < TTL ? 'ok' : 'stale';
    } else {
      this.state = CLEAR;
      this.status = 'loading';
    }
    this.onChange();
    void this.refresh();
  }

  async refresh(force = false): Promise<void> {
    const loc = this.loc;
    if (!loc) return;
    const fresh = this.status === 'ok' && Date.now() - (this.state.fetchedAt ?? 0) < TTL;
    if (fresh && !force) return;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const { timezone: _tz, ...st } = await fetchWeather(loc);
        if (this.loc !== loc) return;
        this.state = st;
        this.status = 'ok';
        writeLocal<CacheEntry>(CACHE_KEY, { lat: loc.lat, lon: loc.lon, state: st });
      } catch {
        // Offline / blocked: keep whatever we had (cached or Clear).
        this.status = this.state.live ? 'stale' : 'error';
      } finally {
        this.inflight = null;
        this.onChange();
      }
    })();
    return this.inflight;
  }
}

function same(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
}

/** City part of an IANA zone ("America/Los_Angeles" -> "Los Angeles"). */
export function zoneCity(tz: string | undefined): string | undefined {
  if (!tz || !tz.includes('/')) return undefined;
  return tz.split('/').pop()!.replace(/_/g, ' ');
}
