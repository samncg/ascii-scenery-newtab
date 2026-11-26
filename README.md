# ASCII Scenery & Animals New Tab

A calm New Tab page made of animated ASCII art: bold Geist Mono glyphs on near-black, a fine cell grid, color tiles and real liquid-glass UI. Every scene follows your local clock and the live weather, and animates at your display's full refresh rate.

**Scenery:** Tokyo Balcony · Forest Cabin · San Francisco (Golden Gate) · Forest Silhouette (golden sunset / Milky Way) · Aurora
**Animals:** Koi · Butterflies · Manta Rays · Jellyfish · Window Cat · Fox & Owl

Built with Vite + TypeScript + plain CSS as a Manifest V3 extension for **Firefox** and **Chrome / Edge**.

---

## Build

```bash
npm install
npm run build
```

`dist/` is then a self-contained extension: `manifest.json`, `index.html`, `assets/` (JS, CSS, bundled Geist fonts) and `icons/`. It makes no network requests except Open-Meteo, and only once you set a location.

| Command | What it does |
| --- | --- |
| `npm run dev` | Live-reloading preview at http://localhost:5173 (extension APIs are simply skipped) |
| `npm run build` | Type-check, then build into `dist/` |
| `npm run icons` | Regenerate `public/icons/*.png` |

## Load it

### Firefox
1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → pick `dist/manifest.json`
3. Open a new tab. Firefox may ask whether to keep the new-tab change; choose **Keep changes**.

Temporary add-ons are removed when Firefox restarts. To install it permanently, sign it through addons.mozilla.org. For an AMO listing you will also need `data_collection_permissions` in `browser_specific_settings.gecko`.

### Chrome / Edge
1. Open `chrome://extensions` (or `edge://extensions`)
2. Turn on **Developer mode**
3. **Load unpacked** → pick the `dist/` folder
4. Open a new tab. Chrome may ask to keep the change.

Chrome will warn about the unknown `browser_specific_settings` key; that key is only there for Firefox and the warning is harmless. Chrome also keeps keyboard focus in the address bar on new tabs, so press `/` to jump to the search box.

---

## Using it

- **Make it yours:** every element can be removed or changed: clock, date, greeting, search box, shortcuts, weather pill, scene bar and the settings button.
  - **Tweaks → Elements** lists them all. Use the switch to show or hide each one, and open it for its options.
  - **Customize on page** outlines every element with ✎ (change) and × (remove), plus a bar to bring removed ones back.
  - If you remove the settings button, open Tweaks by hovering the right edge or pressing **,** (comma).
- **Clock:** large and bold by default, with an optional date line. In Tweaks → Clock, place it above the greeting, below the shortcuts, or in the top-left / top-right corner, and set its size (14–180 px) and 12/24-hour format.
- **Greeting:** time-aware ("Good morning…", "Still up, Sam?"), plain "Hello", or your own text (`{name}` inserts your name), at any size. Click it to edit.
- **Search box:** compact (one line), regular or tall, adjustable width, with optional engine picker and voice button.
- **Weather pill:** any corner.
- **Search:** a glass composer. Press Enter to search; Shift+Enter adds a new line. Text that looks like a web address opens that address directly. Use the engine chip to pick Google, DuckDuckGo, Bing, Brave, Startpage, Kagi, Perplexity, ChatGPT or Claude. The mic button appears in browsers that support speech recognition (Chromium).
- **Shortcuts:** minimal round icons (mail, video, code, chat, AI, docs… picked from the site's address; unknown sites show their initial). Hover one to see its name. Use "+" to add a shortcut, and hover → ✎ (or right-click) to edit or remove one. Drag icons to reorder.
- **Scene bar:** a pill switcher for the top of the screen. It is hidden by default; turn it on in Tweaks → Display.
- **Tweaks drawer:** hover the right edge of the screen, or click ⚙ in the corner. It contains:
  - Scene picker
  - **Sync with live time & weather**, plus manual **Time of day** and **Weather** overrides to preview any combination (e.g. Rainy Midnight in Tokyo, Foggy Sunset in San Francisco)
  - Location: city search, or "Use my location" (the browser will ask permission), plus °C/°F
  - Greeting name, search engine
  - Animals: creature size (50–200%), travel direction (free roam, left → right, right → left, upward, downward) and which koi varieties swim (Kohaku, Sanke, Showa, Ogon, Tancho, Asagi, Chagoi, Yamabuki, Shiro Utsuri, Ki Utsuri, Kumonryu, Goshiki)
  - Elements: show/hide and options for every on-page element (see above)
  - Display: Ink / Vivid style, layout (higher / centered), Detail (number of columns)
- **Status pill** (bottom-left): e.g. `Tokyo · 22°C · Light rain`. Click it to open Tweaks.

### Live weather
Weather comes from [Open-Meteo](https://open-meteo.com/), which is free and needs no API key. It is cached in `localStorage` for 20 minutes, so a new tab paints instantly and never waits on the network. If you are offline, have no location set, or deny geolocation, the page falls back to Clear weather and the local time of day.

Each weather condition changes the scene:

| Weather | Effect |
| --- | --- |
| Clear | Stars by night, sun halo by day |
| Partly cloudy / Overcast | Multi-speed drifting ASCII cloud banks |
| Drizzle / Rain | Angled streaks (`/ \|`) that follow the wind, splashes on railings and water, dimmer light, raindrops on the cat's window, rain rings on the pond |
| Thunderstorm | Heavy rain, ASCII lightning bolts and a screen flash |
| Snow | Swaying `* + · .` flakes, snow settling on surfaces |
| Fog / Mist | Rolling translucent haze. San Francisco also gets its own marine-layer fog in the morning and evening |

Time of day blends smoothly through dawn, morning, day, golden hour, sunset, dusk, night and midnight. Neon, windows, porch lights and bridge lamps switch on as it gets dark. The moon shows the real phase. When your location is in your own timezone, sunrise and sunset come from the forecast.

### Rendering
- **WebGL2** draws the whole character grid in a single GPU pass from a glyph atlas. The default density is about 4× the cells of a typical ASCII page (≈250 columns), and there is no frame cap: animation runs every display refresh (60 / 120 / 144 Hz) and all motion is time-based. Detail can be lowered in Tweaks on slow machines.
- **Liquid glass** is rendered by a shader, not CSS: each glass panel (search, shortcuts, drawer, pills) really refracts the live scene behind it. The rim bends light the most, with per-channel chromatic aberration; the centre slightly magnifies; the slab is lightly frosted and lit from the top-left. This works the same in Firefox and Chrome.
- Without WebGL2, the page falls back to a Canvas 2D renderer with CSS frosted glass, at a lower density.

---

## Project layout

```
public/
  manifest.json          MV3 manifest (Firefox gecko id, newtab override, Open-Meteo host permissions, CSP)
  icons/                 16/32/48/128 px PNGs (generated by scripts/make-icons.mjs)
  licenses/OFL-Geist.txt Font license
index.html               Markup only, no inline scripts
vite.config.ts           base './', relative assets, no modulepreload polyfill
src/
  main.ts                Wires everything together and runs the frame loop
  core/
    grid.ts              Character buffer + color/background/glow/haze layers
    gl.ts                WebGL2 renderer: grid pass, light layers, liquid-glass pass
    renderer.ts          Canvas 2D fallback renderer
    render-common.ts     Shared renderer types and constants
    color.ts, math.ts    Color mixing, seeded RNG, value noise
  engine/
    time.ts              Clock → phase, sun/moon arcs, moon phase, greetings
    palette.ts           Time-of-day keyframe palettes + weather grading
    weather.ts           Open-Meteo geocoding/forecast, WMO mapping, cache
    atmosphere.ts        Stars, sun, moon, clouds, birds, rain, snow, fog, lightning
  scenes/
    tokyo.ts cabin.ts sf.ts silhouette.ts aurora.ts      Scenery
    koi.ts butterflies.ts mantas.ts jellyfish.ts         Creatures on black
    cat.ts clearing.ts                                   Window cat, fox & owl
    ink.ts               Ink-field rasterizer for creatures (tiles → glyphs → dots)
    common.ts            Pines, ridges, smoke plumes, fireflies, sprite mirroring
    types.ts, index.ts   Scene interface + registry
  ui/
    settings.ts          Settings store (localStorage + browser/chrome.storage.local mirror)
    storage.ts           Safe storage wrappers (never throw outside an extension)
    hud.ts               Greeting, clock, composer, engine picker, voice input
    links.ts             Shortcut icons (add / edit / remove / drag to reorder)
    glass.ts             Tracks [data-glass] elements for the glass shader
    elements.ts          Registry of removable / changeable page elements
    customize.ts         On-page customize mode (outlines, ✎ / ×, restore bar)
    scenebar.ts          Top scene switcher
    drawer.ts            Tweaks drawer
    status.ts            Weather & time pill
  styles/main.css        Ink + liquid-glass styles
  assets/fonts/          Geist + Geist Mono (variable woff2, OFL)
```

## Notes

- The extension follows the strict MV3 Content Security Policy: no inline scripts and no `eval`. Network access is limited to Open-Meteo via `connect-src`.
- Settings live in `localStorage` (read synchronously, so the first frame is correct) and are mirrored to `storage.local` when the extension API exists.
- Credits: Geist fonts by Vercel (SIL OFL 1.1). Weather data by Open-Meteo.com (CC BY 4.0). The visual style is inspired by [ascii-animals-newtab](https://github.com/Naveen-io/ascii-animals-newtab) (MIT).
