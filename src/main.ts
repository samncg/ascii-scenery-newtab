import './styles/main.css';
import { Grid } from './core/grid';
import { GLRenderer } from './core/gl';
import type { IRenderer } from './core/render-common';
import { Renderer2D } from './core/renderer';
import { Atmosphere } from './engine/atmosphere';
import { applyWeather, paletteAt } from './engine/palette';
import { computeTime, DEFAULT_SUNRISE, DEFAULT_SUNSET, hourOf, overrideHour } from './engine/time';
import { manualWeather, mixTarget, stepMix, WeatherService, type WeatherMix } from './engine/weather';
import { makeScene } from './scenes';
import { scenePrefs } from './scenes/prefs';
import type { Env, Scene } from './scenes/types';
import { $ } from './ui/dom';
import { Customizer } from './ui/customize';
import { Drawer } from './ui/drawer';
import { applyFonts } from './ui/fonts';
import { Hud } from './ui/hud';
import { Links } from './ui/links';
import { SettingsStore } from './ui/settings';
import { GlassTracker } from './ui/glass';
import { SceneBar } from './ui/scenebar';
import { StatusPill } from './ui/status';

const store = new SettingsStore();
const canvas = $<HTMLCanvasElement>('#scene');
// WebGL2 (real liquid glass, high density) with a Canvas 2D fallback.
const renderer: IRenderer = GLRenderer.create(canvas) ?? new Renderer2D(canvas);
document.documentElement.classList.add(renderer.kind === 'gl' ? 'gl' : 'no-gl');
const glass = new GlassTracker();
const grid = new Grid();
const atmosphere = new Atmosphere();
let scene: Scene = makeScene(store.get().scene);

const weather = new WeatherService(() => {
  drawer?.syncWeather();
});
const hud = new Hud(store);
const links = new Links(store);
new SceneBar(store);
const drawer: Drawer = new Drawer(store, weather, {
  addLink: () => links.add(),
  customize: () => customizer.start(),
});
const customizer = new Customizer(store, (id) => drawer.focusElement(id));
const pill = new StatusPill(store, weather, () => drawer.open());
weather.setLocation(store.get().location);

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function syncPrefs(): void {
  const s = store.get();
  scenePrefs.animalSize = s.animalSize;
  scenePrefs.animalDirection = s.animalDirection;
  scenePrefs.koiVarieties = [...s.koiVarieties];
}

function layout(): void {
  syncPrefs();
  applyFonts(store.get());
  const s = store.get();
  document.documentElement.dataset.style = s.style;
  renderer.resize(s.density, s.style);
  grid.resize(renderer.cols, renderer.rows);
  scene.init(renderer.cols, renderer.rows);
  atmosphere.resize(renderer.cols, renderer.rows, scene);
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(layout, 120);
});

store.subscribe((s, changed) => {
  if (changed.has('scene')) {
    canvas.classList.add('fade');
    setTimeout(() => {
      scene = makeScene(s.scene);
      layout();
      canvas.classList.remove('fade');
    }, 220);
  }
  if (changed.has('fonts') && applyFonts(s)) {
    // Load the new ASCII font before re-measuring the glyph atlas.
    void document.fonts?.load(`600 16px ${s.fonts.ascii === 'geist-mono' ? '"Geist Mono"' : 'serif'}`).finally(() => layout());
  }
  if (changed.has('density') || changed.has('style')) layout();
  // Size and varieties are baked in when a scene starts; direction is read live.
  if (changed.has('animalSize') || changed.has('koiVarieties')) {
    syncPrefs();
    scene.init(renderer.cols, renderer.rows);
  }
  if (changed.has('animalDirection')) syncPrefs();
  if (changed.has('location')) weather.setLocation(s.location);
});

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

const target = () => {
  const s = store.get();
  return s.sync ? weather.state : manualWeather(s.manualWeather);
};

let mix0: WeatherMix = mixTarget(target());
let dispHour = -1;
let t = 0;
let last = performance.now();
let lastUi = 0;
/** Smoothed CPU ms per frame (dev diagnostics). */
const stats = { sim: 0, render: 0 };

function frame(now: number): void {
  requestAnimationFrame(frame);
  // Every display refresh: motion is time-based, so 60, 120 or 144 Hz all look right.
  const s = store.get();
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  t += dt;

  const date = new Date();
  const w = target();
  const live = s.sync ? weather.state : null;
  const sr = live?.sunrise ?? DEFAULT_SUNRISE;
  const ss = live?.sunset ?? DEFAULT_SUNSET;
  const wantHour = s.sync ? hourOf(date) : overrideHour(s.manualTime, sr, ss);
  if (dispHour < 0) dispHour = wantHour;
  // Glide along the shortest way round the clock when the time is overridden.
  const diff = ((wantHour - dispHour + 36) % 24) - 12;
  dispHour = Math.abs(diff) < 0.002 ? wantHour : (dispHour + diff * (1 - Math.exp(-dt * 2.2)) + 24) % 24;

  mix0 = stepMix(mix0, mixTarget(w), dt);
  const time = computeTime(dispHour, sr, ss, date);
  const pal = applyWeather(paletteAt(dispHour, sr, ss), mix0);

  const env: Env = {
    t,
    dt,
    cols: grid.cols,
    rows: grid.rows,
    aspect: renderer.aspect,
    time,
    w: mix0,
    pal,
    sun: { x: 0, y: 0, visible: false, alt: 0 },
    moon: { x: 0, y: 0, visible: false, alt: 0 },
    flash: 0,
    month: date.getMonth(),
    tempC: s.sync ? weather.state.tempC : undefined,
  };

  const t0 = performance.now();
  grid.clear();
  atmosphere.place(env, scene);
  atmosphere.update(env, scene);
  if (scene.sky) atmosphere.drawSky(grid, env, scene);
  scene.draw(grid, env);
  atmosphere.drawWeather(grid, env, scene);
  scene.drawFront(grid, env);
  const t1 = performance.now();
  renderer.render(grid, {
    stops: scene.stops(env),
    skyInk: scene.skyInk,
    flash: env.flash,
    t,
    panels: renderer.kind === 'gl' ? glass.collect() : undefined,
  });
  stats.sim += (t1 - t0 - stats.sim) * 0.05;
  stats.render += (performance.now() - t1 - stats.render) * 0.05;

  if (now - lastUi > 1000) {
    lastUi = now;
    hud.tick(date);
    pill.update(time);
  }
}

layout();
requestAnimationFrame(frame);
// Re-measure once the bundled Geist Mono has loaded.
document.fonts?.load('600 16px "Geist Mono"').then(() => layout()).catch(() => {});

// Handy in `npm run dev`: window.__asn.store.update({ scene: 'sf', sync: false, manualTime: 'golden' })
if (import.meta.env.DEV) (window as unknown as { __asn: unknown }).__asn = { store, weather, stats, renderer };
