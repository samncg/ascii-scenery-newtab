import { TIME_OPTIONS, type TimeState } from '../engine/time';
import type { WeatherKind, WeatherService } from '../engine/weather';
import { $ } from './dom';
import type { SettingsStore } from './settings';

function glyph(kind: WeatherKind, night: boolean): string {
  switch (kind) {
    case 'clear':
      return night ? '☾' : '☼';
    case 'partly':
    case 'cloudy':
      return '☁';
    case 'fog':
      return '≡';
    case 'drizzle':
    case 'rain':
      return '☂';
    case 'thunder':
      return 'ϟ';
    case 'snow':
      return '❄';
  }
}

/** Corner pill: "Tokyo · 22°C · Light Rain". */
export class StatusPill {
  private el = $<HTMLButtonElement>('#status-pill');
  private last = '';

  constructor(
    private store: SettingsStore,
    private weather: WeatherService,
    onClick: () => void,
  ) {
    this.el.addEventListener('click', onClick);
  }

  update(time: TimeState): void {
    const s = this.store.get();
    this.el.hidden = !s.showStatus;
    if (!s.showStatus) return;
    const night = time.phase === 'night' || time.phase === 'dusk';
    let parts: string[];
    let kind: WeatherKind;
    if (!s.sync) {
      kind = s.manualWeather;
      const t = TIME_OPTIONS.find((o) => o.id === s.manualTime)?.label ?? '';
      const w = { clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Overcast', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', thunder: 'Thunderstorm', snow: 'Snow' }[kind];
      parts = ['Preview', t, w];
    } else {
      const ws = this.weather.state;
      kind = ws.kind;
      const loc = s.location;
      parts = [];
      if (loc) parts.push(loc.name);
      if (ws.live && ws.tempC !== undefined) {
        const v = s.units === 'f' ? ws.tempC * 1.8 + 32 : ws.tempC;
        parts.push(`${Math.round(v)}°${s.units.toUpperCase()}`);
      }
      parts.push(loc ? ws.label : 'Set a location for live weather');
      if (this.weather.status === 'error') parts.push('offline');
    }
    const text = `${glyph(kind, night)}  ${parts.filter(Boolean).join(' · ')}`;
    if (text !== this.last) {
      this.last = text;
      this.el.textContent = text;
    }
  }
}
