import { TIME_OPTIONS } from '../engine/time';
import { geocode, type GeoLocation, fetchWeather, WEATHER_OPTIONS, type WeatherService, zoneCity } from '../engine/weather';
import { SCENES } from '../scenes';
import { DIRECTIONS, KOI_VARIETIES, type KoiVariety } from '../scenes/prefs';
import { $, h, icon, ICONS } from './dom';
import { ENGINES } from './engines';
import type { Settings, SettingsStore } from './settings';

type Mode = 'closed' | 'hover' | 'pinned';

/** The slide-out tweaks panel (right-edge hover or gear click). */
export class Drawer {
  private el = $('#drawer');
  private gear = $<HTMLButtonElement>('#gear');
  private mode: Mode = 'closed';
  private hovering = false;
  private closeTimer = 0;
  private refs: Record<string, HTMLElement> = {};

  constructor(
    private store: SettingsStore,
    private weather: WeatherService,
  ) {
    this.gear.append(icon(ICONS.gear, 18));
    this.build();
    this.sync(store.get());
    store.subscribe((s) => this.sync(s));

    this.gear.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMode(this.mode === 'pinned' ? 'closed' : 'pinned');
    });
    $('#edge-zone').addEventListener('mouseenter', () => {
      if (this.mode === 'closed') this.setMode('hover');
    });
    this.el.addEventListener('mouseenter', () => {
      this.hovering = true;
      clearTimeout(this.closeTimer);
    });
    this.el.addEventListener('mouseleave', () => {
      this.hovering = false;
      this.maybeClose();
    });
    this.el.addEventListener('focusout', () => setTimeout(() => this.maybeClose(), 0));
    document.addEventListener('mousedown', (e) => {
      if (this.mode !== 'closed' && !this.el.contains(e.target as Node) && e.target !== this.gear && !this.gear.contains(e.target as Node))
        this.setMode('closed');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.mode !== 'closed') this.setMode('closed');
    });
  }

  open(): void {
    this.setMode('pinned');
  }

  private maybeClose(): void {
    if (this.mode !== 'hover' || this.hovering) return;
    if (this.el.contains(document.activeElement)) return;
    clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      if (!this.hovering && this.mode === 'hover') this.setMode('closed');
    }, 450);
  }

  private setMode(m: Mode): void {
    this.mode = m;
    const open = m !== 'closed';
    this.el.classList.toggle('open', open);
    this.el.setAttribute('aria-hidden', String(!open));
    this.el.inert = !open;
    this.gear.classList.toggle('active', open);
    document.body.classList.toggle('drawer-open', open);
  }

  // ---------------------------------------------------------------------------

  private build(): void {
    const set = (patch: Partial<Settings>) => this.store.update(patch);

    const toggle = (key: keyof Settings, label: string, hint?: string) => {
      const input = h('input', { type: 'checkbox', class: 'switch', onchange: (e: Event) => set({ [key]: (e.target as HTMLInputElement).checked } as Partial<Settings>) });
      this.refs[`t-${key}`] = input;
      return h('label', { class: 'row' }, h('span', { class: 'row-label' }, label, hint ? h('small', { text: hint }) : null), input);
    };
    const select = (key: string, label: string, options: Array<{ id: string; label: string }>, onchange: (v: string) => void) => {
      const sel = h('select', { onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) }, ...options.map((o) => h('option', { value: o.id, text: o.label })));
      this.refs[key] = sel;
      return h('label', { class: 'row' }, h('span', { class: 'row-label', text: label }), sel);
    };
    const segmented = (key: string, label: string, options: Array<{ id: string; label: string }>, onpick: (v: string) => void) => {
      const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, ...options.map((o) => h('button', { type: 'button', 'data-v': o.id, text: o.label, onclick: () => onpick(o.id) })));
      this.refs[key] = wrap;
      return h('div', { class: 'row' }, h('span', { class: 'row-label', text: label }), wrap);
    };

    // Scenes
    const sceneGrid = h('div', { class: 'scene-grid' });
    for (const group of ['Scenery', 'Animals'] as const) {
      sceneGrid.append(h('div', { class: 'scene-group', text: group }));
      for (const sc of SCENES.filter((x) => x.group === group)) {
        sceneGrid.append(
          h(
            'button',
            { type: 'button', class: 'scene-btn', 'data-scene': sc.id, onclick: () => set({ scene: sc.id }) },
            h('span', { class: 'scene-glyph', text: sc.glyph }),
            h('span', { text: sc.name }),
          ),
        );
      }
    }

    // Location
    const locName = h('div', { class: 'loc-name' });
    const locStatus = h('small', { class: 'loc-status' });
    this.refs.locName = locName;
    this.refs.locStatus = locStatus;
    const locInput = h('input', { type: 'search', placeholder: 'Search a city…', 'aria-label': 'City' });
    const results = h('ul', { class: 'loc-results' });
    const choose = (loc: GeoLocation) => {
      set({ location: loc });
      results.replaceChildren();
      locInput.value = '';
    };
    const search = async () => {
      const q = locInput.value.trim();
      if (!q) return;
      results.replaceChildren(h('li', { class: 'muted', text: 'Searching…' }));
      try {
        const found = await geocode(q);
        results.replaceChildren(
          ...(found.length
            ? found.map((loc) =>
                h(
                  'li',
                  {},
                  h(
                    'button',
                    { type: 'button', onclick: () => choose(loc) },
                    h('span', { text: loc.name }),
                    h('small', { text: [loc.admin, loc.country].filter(Boolean).join(', ') }),
                  ),
                ),
              )
            : [h('li', { class: 'muted', text: 'No matches.' })]),
        );
      } catch {
        results.replaceChildren(h('li', { class: 'muted', text: 'Could not reach the geocoding service.' }));
      }
    };
    const locForm = h(
      'form',
      {
        class: 'loc-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          void search();
        },
      },
      locInput,
      h('button', { type: 'submit', class: 'btn', 'aria-label': 'Search city' }, icon(ICONS.search, 15)),
    );
    const geoBtn = h('button', {
      type: 'button',
      class: 'btn ghost',
      text: 'Use my location',
      onclick: () => {
        if (!('geolocation' in navigator)) return;
        geoBtn.textContent = 'Locating…';
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const loc: GeoLocation = { name: 'My location', lat: pos.coords.latitude, lon: pos.coords.longitude, approx: true };
            try {
              const w = await fetchWeather(loc);
              loc.name = zoneCity(w.timezone) ?? loc.name;
            } catch {
              /* keep generic name */
            }
            geoBtn.textContent = 'Use my location';
            choose(loc);
          },
          () => {
            geoBtn.textContent = 'Location unavailable';
            setTimeout(() => (geoBtn.textContent = 'Use my location'), 2500);
          },
          { timeout: 10000, maximumAge: 30 * 60 * 1000 },
        );
      },
    });
    const refresh = h('button', { type: 'button', class: 'icon-btn', title: 'Refresh weather', 'aria-label': 'Refresh weather', onclick: () => void this.weather.refresh(true) }, icon(ICONS.refresh, 14));
    const clearLoc = h('button', { type: 'button', class: 'icon-btn', title: 'Forget location', 'aria-label': 'Forget location', onclick: () => set({ location: null }) }, icon(ICONS.close, 14));

    const nameInput = h('input', { type: 'text', maxlength: 40, placeholder: 'Your name', 'aria-label': 'Your name' });
    nameInput.addEventListener('input', () => set({ name: nameInput.value }));
    this.refs.name = nameInput;

    const size = h('input', { type: 'range', min: 100, max: 420, step: 4, 'aria-label': 'Detail' });
    size.addEventListener('change', () => set({ density: Number(size.value) }));
    this.refs.size = size;

    const range = (key: string, min: number, max: number, step: number, onchange: (v: number) => void) => {
      const input = h('input', { type: 'range', min, max, step });
      input.addEventListener('input', () => onchange(Number(input.value)));
      this.refs[key] = input;
      return input;
    };
    const clockSize = range('clockSize', 14, 180, 2, (v) => set({ clockSize: v }));
    const animalSize = range('animalSize', 50, 200, 5, (v) => set({ animalSize: v / 100 }));
    const koiChips = h(
      'div',
      { class: 'chips' },
      ...KOI_VARIETIES.map((v) =>
        h('button', {
          type: 'button',
          class: 'chip',
          'data-koi': v.id,
          text: v.label,
          onclick: () => {
            const cur = this.store.get().koiVarieties;
            const on = cur.includes(v.id);
            // Keep at least one variety selected.
            const next = on ? cur.filter((x) => x !== v.id) : [...cur, v.id];
            if (next.length) set({ koiVarieties: next as KoiVariety[] });
          },
        }),
      ),
    );
    this.refs.koiChips = koiChips;

    this.el.replaceChildren(
      h(
        'header',
        { class: 'drawer-head' },
        h('h2', { text: 'Tweaks' }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.setMode('closed') }, icon(ICONS.close, 16)),
      ),
      h(
        'div',
        { class: 'drawer-body' },
        h('section', {}, h('h3', { text: 'Scene' }), sceneGrid),
        h(
          'section',
          {},
          h('h3', { text: 'Time & weather' }),
          toggle('sync', 'Sync with live time & weather'),
          select('time', 'Time of day', TIME_OPTIONS, (v) => set({ manualTime: v as Settings['manualTime'], sync: false })),
          select('weather', 'Weather', WEATHER_OPTIONS, (v) => set({ manualWeather: v as Settings['manualWeather'], sync: false })),
          h('p', { class: 'hint', text: 'Picking a time or weather switches to preview mode. Turn sync back on to follow the clock and live forecast.' }),
        ),
        h(
          'section',
          {},
          h('h3', { text: 'Location' }),
          h('div', { class: 'loc-current' }, h('div', {}, locName, locStatus), h('div', { class: 'loc-actions' }, refresh, clearLoc)),
          locForm,
          results,
          h('div', { class: 'row' }, geoBtn),
          segmented('units', 'Units', [{ id: 'c', label: '°C' }, { id: 'f', label: '°F' }], (v) => set({ units: v as 'c' | 'f' })),
        ),
        h(
          'section',
          {},
          h('h3', { text: 'Animals' }),
          h('label', { class: 'row' }, h('span', { class: 'row-label' }, 'Size', h('small', { text: 'Koi, butterflies, mantas, jellyfish' })), animalSize),
          select('animalDirection', 'Direction', DIRECTIONS, (v) => set({ animalDirection: v as Settings['animalDirection'] })),
          h('div', { class: 'row-label', style: 'margin: 10px 0 6px' }, 'Koi varieties'),
          koiChips,
        ),
        h(
          'section',
          {},
          h('h3', { text: 'Clock' }),
          toggle('showClock', 'Show clock'),
          select('clockPosition', 'Position', [
            { id: 'above', label: 'Above greeting' },
            { id: 'below', label: 'Below shortcuts' },
            { id: 'top-left', label: 'Top left' },
            { id: 'top-right', label: 'Top right' },
          ], (v) => set({ clockPosition: v as Settings['clockPosition'] })),
          h('label', { class: 'row' }, h('span', { class: 'row-label', text: 'Size' }), clockSize),
          toggle('clock24', '24-hour clock'),
          toggle('showDate', 'Show date'),
        ),
        h(
          'section',
          {},
          h('h3', { text: 'Greeting' }),
          h('label', { class: 'row' }, h('span', { class: 'row-label', text: 'Name' }), nameInput),
          toggle('timeGreeting', 'Greet by time of day', 'Good morning… Still up?'),
        ),
        h(
          'section',
          {},
          h('h3', { text: 'Search' }),
          select('engine', 'Engine', ENGINES.map((e) => ({ id: e.id, label: e.name })), (v) => set({ engine: v as Settings['engine'] })),
        ),
        h(
          'section',
          {},
          h('h3', { text: 'Display' }),
          segmented('style', 'Style', [{ id: 'ink', label: 'Ink' }, { id: 'vivid', label: 'Vivid' }], (v) => set({ style: v as 'ink' | 'vivid' })),
          toggle('showSceneBar', 'Scene bar'),
          toggle('showHud', 'Greeting & search'),
          toggle('showLinks', 'Shortcuts'),
          toggle('showStatus', 'Weather & time pill'),
          segmented('hudPosition', 'Layout', [{ id: 'top', label: 'Top' }, { id: 'center', label: 'Center' }], (v) => set({ hudPosition: v as 'top' | 'center' })),
          h('label', { class: 'row' }, h('span', { class: 'row-label' }, 'Detail', h('small', { text: 'Columns across the screen' })), size),
        ),
        h(
          'footer',
          { class: 'drawer-foot' },
          h('button', {
            type: 'button',
            class: 'btn ghost',
            text: 'Reset all settings',
            onclick: () => {
              if (confirm('Reset all settings and shortcuts to their defaults?')) this.store.reset();
            },
          }),
          h('small', {}, 'Weather data by ', h('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener', text: 'Open-Meteo.com' })),
        ),
      ),
    );
  }

  /** Reflect settings into the controls. */
  sync(s: Readonly<Settings>): void {
    for (const key of ['sync', 'timeGreeting', 'showSceneBar', 'showHud', 'showClock', 'clock24', 'showDate', 'showLinks', 'showStatus'] as const) {
      (this.refs[`t-${key}`] as HTMLInputElement).checked = s[key];
    }
    (this.refs.time as HTMLSelectElement).value = s.manualTime;
    (this.refs.weather as HTMLSelectElement).value = s.manualWeather;
    (this.refs.engine as HTMLSelectElement).value = s.engine;
    this.refs.time.parentElement!.classList.toggle('dim', s.sync);
    this.refs.weather.parentElement!.classList.toggle('dim', s.sync);
    const name = this.refs.name as HTMLInputElement;
    if (document.activeElement !== name) name.value = s.name;
    (this.refs.size as HTMLInputElement).value = String(s.density);
    (this.refs.clockSize as HTMLInputElement).value = String(s.clockSize);
    (this.refs.animalSize as HTMLInputElement).value = String(Math.round(s.animalSize * 100));
    (this.refs.clockPosition as HTMLSelectElement).value = s.clockPosition;
    (this.refs.animalDirection as HTMLSelectElement).value = s.animalDirection;
    this.refs.koiChips.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => {
      const on = s.koiVarieties.includes(b.dataset.koi as KoiVariety);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const seg = (key: string, v: string) =>
      this.refs[key].querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        const on = b.dataset.v === v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    seg('units', s.units);
    seg('style', s.style);
    seg('hudPosition', s.hudPosition);
    this.el.querySelectorAll<HTMLButtonElement>('.scene-btn').forEach((b) => b.classList.toggle('on', b.dataset.scene === s.scene));
    this.syncWeather();
  }

  syncWeather(): void {
    const loc = this.store.get().location;
    const ws = this.weather;
    this.refs.locName.textContent = loc ? [loc.name, loc.country].filter(Boolean).join(', ') : 'No location set';
    const msg =
      !loc
        ? 'Weather stays Clear until you pick a city.'
        : ws.status === 'loading'
          ? 'Fetching weather…'
          : ws.status === 'error'
            ? 'Offline — using Clear.'
            : ws.status === 'stale'
              ? 'Showing cached weather.'
              : ws.state.fetchedAt
                ? `Updated ${new Date(ws.state.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : '';
    this.refs.locStatus.textContent = msg;
  }
}
