import { mix, mixPack, pack, type RGB, WHITE } from '../core/color';
import type { Grid, Rect } from '../core/grid';
import { clamp, fbm, hash2, mulberry32, noise2, smoothstep } from '../core/math';
import type { Env, Scene } from '../scenes/types';

interface Star { x: number; y: number; f: number; ph: number; b: number; big: boolean }
interface Drop { x: number; y: number; v: number; z: number }
interface Flake { x: number; y: number; v: number; z: number; ph: number }
interface Splash { x: number; y: number; age: number }
interface Bird { x: number; y: number; ph: number }

/**
 * Shared sky + weather layer drawn around every scene: stars, sun, moon,
 * clouds, birds before the scene; rain, snow, fog, lightning after it.
 */
export class Atmosphere {
  private rng = mulberry32(20240607);
  private area: Rect = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private stars: Star[] = [];
  private drops: Drop[] = [];
  private flakes: Flake[] = [];
  private splashes: Splash[] = [];
  private flock: { birds: Bird[]; vx: number } | null = null;
  private nextFlock = 6;
  private shooting: { x: number; y: number; vx: number; vy: number; life: number } | null = null;
  private nextShoot = 18;
  private bolt: { pts: Array<[number, number, string]>; life: number } | null = null;
  private nextStrike = 3;
  private flashTimer = 99;
  flash = 0;
  /** Noise-frequency scale so features keep their on-screen size at any density. */
  private fs = 1;
  private nbuf = new Float32Array(0);
  private fbuf = new Float32Array(0);

  resize(cols: number, rows: number, scene: Scene): void {
    this.area = scene.clip ?? { x0: 0, y0: 0, x1: cols, y1: rows };
    this.fs = Math.min(1, 150 / Math.max(1, cols));
    this.nbuf = new Float32Array(cols + 2);
    this.fbuf = new Float32Array(cols + 2);
    const a = this.area;
    const skyH = Math.max(3, scene.horizonRow - a.y0);
    const n = Math.round((a.x1 - a.x0) * skyH * 0.022);
    const r = mulberry32(777);
    this.stars = Array.from({ length: n }, () => {
      const b = r();
      return {
        x: a.x0 + Math.floor(r() * (a.x1 - a.x0)),
        y: a.y0 + Math.floor(Math.pow(r(), 1.35) * skyH),
        f: 0.4 + r() * 2.2,
        ph: r() * 6.28,
        b: 0.35 + b * 0.65,
        big: b > 0.9,
      };
    });
    this.drops = [];
    this.flakes = [];
    this.splashes = [];
    this.flock = null;
  }

  /** Place sun & moon in grid coordinates on env (scenes read them). */
  place(env: Env, scene: Scene): void {
    const a = this.area;
    const w = a.x1 - a.x0;
    const top = a.y0 + 3;
    const hz = scene.horizonRow;
    const path = (progress: number, alt: number) => ({
      x: a.x0 + (0.08 + 0.84 * progress) * w,
      y: hz - Math.max(-0.2, alt) * Math.max(2, hz - top - 2) - 1,
    });
    const s = env.time.sun;
    const sp = path(s.progress, s.altitude);
    env.sun = { x: sp.x, y: sp.y, visible: s.visible, alt: s.altitude };
    const m = env.time.moon;
    const mp = path(m.progress, m.altitude * 0.85);
    env.moon = { x: mp.x, y: mp.y, visible: m.visible, alt: m.altitude };
  }

  update(env: Env, scene: Scene): void {
    const { dt, w } = env;
    const r = this.rng;
    // Lightning
    if (w.storm > 0.3) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.strike(scene);
        this.nextStrike = (4 + r() * 9) / w.storm;
      }
    }
    if (this.bolt) {
      this.bolt.life -= dt;
      if (this.bolt.life <= 0) this.bolt = null;
    }
    this.flashTimer += dt;
    this.flash *= Math.exp(-dt * 7);
    if (this.flashTimer > 0.12 && this.flashTimer < 0.16) this.flash = Math.max(this.flash, 0.75);
    env.flash = this.flash;
  }

  private strike(scene: Scene): void {
    const a = this.area;
    const r = this.rng;
    let x = a.x0 + 4 + r() * (a.x1 - a.x0 - 8);
    const yEnd = a.y0 + (scene.horizonRow - a.y0) * (0.55 + r() * 0.45);
    const pts: Array<[number, number, string]> = [];
    for (let y = a.y0; y < yEnd; y++) {
      const s = r();
      const dx = s < 0.36 ? -1 : s < 0.72 ? 1 : 0;
      pts.push([Math.round(x), y, dx < 0 ? '/' : dx > 0 ? '\\' : '|']);
      x += dx;
      if (r() < 0.06) {
        // short fork
        let fx = x;
        const dir = r() < 0.5 ? -1 : 1;
        for (let k = 1; k < 5 + r() * 5; k++) {
          fx += dir;
          pts.push([Math.round(fx), y + k, dir < 0 ? '/' : '\\']);
        }
      }
    }
    this.bolt = { pts, life: 0.32 };
    this.flash = 1;
    this.flashTimer = 0;
  }

  // ---------------------------------------------------------------------------
  // Sky
  // ---------------------------------------------------------------------------

  drawSky(g: Grid, env: Env, scene: Scene): void {
    g.clip = scene.clip;
    this.drawStars(g, env, scene);
    this.drawSun(g, env);
    this.drawMoon(g, env);
    this.drawClouds(g, env, scene);
    if (scene.birds) this.drawBirds(g, env, scene);
    g.clip = null;
  }

  private drawStars(g: Grid, env: Env, scene: Scene): void {
    const vis = env.pal.stars;
    if (vis < 0.02) return;
    const { t } = env;
    const sky = env.pal.skyMid;
    const star = env.pal.star;
    const hz = scene.horizonRow;
    for (const s of this.stars) {
      const fade = smoothstep(hz, hz - 8, s.y);
      const tw = 0.55 + 0.45 * Math.sin(t * s.f + s.ph);
      const b = s.b * tw * vis * fade;
      if (b < 0.12) continue;
      const c = s.big ? (b > 0.7 ? '*' : '+') : b > 0.55 ? '+' : b > 0.3 ? '.' : '·';
      g.set(s.x, s.y, c, mixPack(sky, star, Math.min(1, b * 1.2)));
      if (s.big && b > 0.6) g.addGlow(s.x, s.y, star, 0.18 * b);
    }
    // Shooting star
    const r = this.rng;
    if (!this.shooting) {
      this.nextShoot -= env.dt;
      if (this.nextShoot <= 0 && vis > 0.5) {
        const a = this.area;
        this.shooting = {
          x: a.x0 + r() * (a.x1 - a.x0) * 0.7,
          y: a.y0 + 1 + r() * Math.max(1, (hz - a.y0) * 0.35),
          vx: 38 + r() * 24,
          vy: 9 + r() * 6,
          life: 0.9,
        };
        this.nextShoot = 25 + r() * 40;
      }
    } else {
      const s = this.shooting;
      s.life -= env.dt;
      s.x += s.vx * env.dt;
      s.y += s.vy * env.dt;
      const k = clamp(s.life / 0.9);
      for (let i = 0; i < 7; i++) {
        const tx = s.x - (s.vx / s.vy) * i * 0.5;
        const ty = s.y - i * 0.5;
        g.set(tx, ty, i === 0 ? '*' : i < 3 ? '-' : '.', mixPack(sky, star, k * (1 - i / 8)));
      }
      g.addGlow(Math.round(s.x), Math.round(s.y), star, 0.4 * k);
      if (s.life <= 0) this.shooting = null;
    }
  }

  private cloudVeil(env: Env): number {
    const w = env.w;
    return clamp(1 - (w.cloud * 0.75 + w.rain * 0.6 + w.storm * 0.6 + w.fog * 0.6 + w.snow * 0.5 + w.drizzle * 0.4));
  }

  private drawSun(g: Grid, env: Env): void {
    const s = env.sun;
    if (!s.visible) return;
    const v = this.cloudVeil(env);
    const low = 1 - clamp(s.alt * 1.6);
    const c = env.pal.sun;
    const ry = 1.8 + low * 0.9;
    const rx = ry * env.aspect;
    // Halo behind everything, glow on top.
    g.backAt(s.x, s.y, rx * 7, ry * 6, c, (0.22 + low * 0.25) * (0.4 + 0.6 * v));
    g.glowAt(s.x, s.y, rx * 3, ry * 3, c, (0.35 + low * 0.2) * (0.25 + 0.75 * v));
    if (v < 0.15) return;
    const sky = env.pal.skyMid;
    for (let y = Math.floor(s.y - ry); y <= Math.ceil(s.y + ry); y++) {
      for (let x = Math.floor(s.x - rx); x <= Math.ceil(s.x + rx); x++) {
        const dx = (x - s.x) / rx;
        const dy = (y - s.y) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) continue;
        const ch = d < 0.45 ? '@' : d < 0.8 ? 'O' : 'o';
        g.set(x, y, ch, mixPack(sky, mix(c, WHITE, 0.35 * (1 - d)), v));
      }
    }
  }

  private drawMoon(g: Grid, env: Env): void {
    const m = env.moon;
    if (!m.visible) return;
    const { phase, illumination } = env.time.moon;
    const v = this.cloudVeil(env) * clamp(1.4 - env.pal.daylight * 2);
    if (v < 0.05) return;
    const c = env.pal.moon;
    const sky = env.pal.skyMid;
    const ry = 2.6;
    const rx = ry * env.aspect;
    const k = Math.cos(2 * Math.PI * phase);
    g.backAt(m.x, m.y, rx * 5, ry * 4.5, c, 0.1 * v * (0.3 + illumination));
    g.glowAt(m.x, m.y, rx * 2.2, ry * 2.2, c, 0.28 * v * (0.25 + illumination));
    for (let y = Math.floor(m.y - ry); y <= Math.ceil(m.y + ry); y++) {
      for (let x = Math.floor(m.x - rx); x <= Math.ceil(m.x + rx); x++) {
        const nx = (x - m.x) / (rx + 0.3);
        const ny = (y - m.y) / (ry + 0.3);
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const wdt = Math.sqrt(1 - ny * ny);
        const lit = phase < 0.5 ? nx > k * wdt : nx < -k * wdt;
        if (lit) {
          const crater = hash2(x - Math.round(m.x), y - Math.round(m.y), 5) < 0.2;
          const ch = d2 > 0.72 ? 'o' : d2 > 0.4 ? 'O' : '@';
          g.set(x, y, ch, mixPack(sky, crater ? mix(c, sky, 0.28) : c, v));
        } else {
          g.set(x, y, '.', mixPack(sky, c, 0.12 * v)); // earthshine
        }
      }
    }
  }

  private drawClouds(g: Grid, env: Env, scene: Scene): void {
    const { w, pal, t } = env;
    const cover = clamp(w.cloud + w.rain * 0.2 + w.storm * 0.2);
    if (cover < 0.03) return;
    const a = this.area;
    const top = a.y0;
    const bottom = Math.min(scene.horizonRow + 1, a.y1);
    const span = Math.max(1, bottom - top);
    const dir = w.wind >= 0 ? 1 : -1;
    const drift = t * (0.5 + Math.abs(w.wind) * 2.2) * dir;
    const thr = 0.68 - cover * 0.52;
    const fs = this.fs;
    const ramp = ['.', ':', '-', '~', '=', '%'];
    const lit = pal.cloud;
    const shade = pal.cloudShade;
    for (let y = top; y < bottom; y++) {
      const yy = (y - top) / span;
      const band = smoothstep(1.05, 0.55, yy) * (0.75 + 0.25 * smoothstep(0, 0.25, yy));
      // Noise on a half-resolution lattice (rows and columns), reused by neighbours.
      const fresh = (y - top) % 2 === 0;
      for (let x = a.x0; x < a.x1; x++) {
        if (fresh && ((x - a.x0) & 1) === 0) {
          const X = x * fs;
          const Y = y * fs;
          this.nbuf[x] =
            fbm((X - drift) * 0.035, Y * 0.13, 3, 11) * 0.62 + fbm((X - drift * 1.9) * 0.07, Y * 0.24 + 7, 2, 23) * 0.38;
        }
        const n = this.nbuf[x & ~1] ?? this.nbuf[x];
        const d = ((n * band - thr) / (1 - thr)) * (0.7 + cover * 0.6);
        if (d <= 0) continue;
        const k = Math.min(1, d);
        const ci = Math.min(ramp.length - 1, Math.floor(k * ramp.length * 1.15));
        const upper = clamp(0.35 + (1 - yy) * 0.3 + (fbm((x - drift) * 0.05, (y - 1) * 0.13, 2, 11) - n) * 2);
        const col = mix(shade, lit, upper);
        g.set(x, y, ramp[ci], pack(mix(pal.skyMid, col, 0.35 + 0.65 * k)));
        g.paintBack(x, y, mix(shade, lit, upper * 0.8), Math.min(0.92, k * 1.2));
      }
    }
  }

  private drawBirds(g: Grid, env: Env, scene: Scene): void {
    const { pal, w, dt, t } = env;
    const ok = pal.daylight > 0.45 && w.rain + w.storm + w.snow < 0.2;
    const a = this.area;
    const r = this.rng;
    if (!this.flock) {
      this.nextFlock -= dt * (env.time.phase === 'dawn' || env.time.phase === 'morning' ? 2 : 1);
      if (this.nextFlock <= 0 && ok) {
        const dir = r() < 0.5 ? -1 : 1;
        const n = 3 + Math.floor(r() * 5);
        const y0 = a.y0 + 2 + r() * Math.max(2, (scene.horizonRow - a.y0) * 0.45);
        const x0 = dir > 0 ? a.x0 - 4 : a.x1 + 4;
        const birds: Bird[] = [];
        for (let i = 0; i < n; i++) {
          const row = Math.ceil(i / 2);
          const side = i % 2 ? 1 : -1;
          birds.push({ x: x0 - dir * row * 3, y: y0 + side * row * 0.9 + r() * 0.4, ph: r() * 6 });
        }
        this.flock = { birds, vx: dir * (6 + r() * 4) };
        this.nextFlock = 14 + r() * 30;
      }
      return;
    }
    const col = mixPack(pal.near, pal.skyMid, 0.25);
    let alive = false;
    for (const b of this.flock.birds) {
      b.x += this.flock.vx * dt;
      b.y += Math.sin(t * 0.8 + b.ph) * 0.15 * dt;
      if (b.x > a.x0 - 6 && b.x < a.x1 + 6) alive = true;
      const flap = Math.sin(t * 9 + b.ph) > 0;
      g.set(b.x, b.y, flap ? 'v' : '-', col);
    }
    if (!alive) this.flock = null;
  }

  // ---------------------------------------------------------------------------
  // Weather in front of the scene
  // ---------------------------------------------------------------------------

  drawWeather(g: Grid, env: Env, scene: Scene): void {
    g.clip = scene.clip;
    this.drawRain(g, env, scene);
    this.drawSnow(g, env, scene);
    this.drawFog(g, env, scene);
    this.drawBolt(g);
    g.clip = null;
  }

  private drawRain(g: Grid, env: Env, scene: Scene): void {
    const { w, dt, pal } = env;
    const a = this.area;
    const W = a.x1 - a.x0;
    const H = a.y1 - a.y0;
    const strength = w.rain + w.drizzle * 0.6;
    const target = Math.round(W * H * (w.rain * 0.03 + w.drizzle * 0.014) * scene.rainScale);
    const r = this.rng;
    const wind = w.wind * (0.6 + w.storm * 0.6);
    const spawn = (top: boolean): Drop => ({
      x: a.x0 - wind * 12 + r() * (W + Math.abs(wind) * 24),
      y: top ? a.y0 - r() * 6 : a.y0 + r() * H,
      v: 0,
      z: r(),
    });
    while (this.drops.length < target) this.drops.push(spawn(false));
    if (this.drops.length > target) this.drops.length = Math.max(target, this.drops.length - 40);
    const drizzle = w.drizzle > w.rain;
    const ch = Math.abs(wind) < 0.12 ? '|' : wind > 0 ? '\\' : '/';
    const sky = pal.skyMid;
    const col = mix(pal.precip, WHITE, 0.25);
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      const speed = (drizzle ? 16 : 34) + d.z * (drizzle ? 10 : 30);
      d.y += speed * dt;
      d.x += wind * speed * 0.5 * dt;
      if (d.y > a.y1 + 2) {
        this.drops[i] = spawn(true);
        continue;
      }
      const len = drizzle ? 1 : d.z > 0.6 ? 3 : 2;
      const c0 = mix(sky, col, 0.42 + d.z * 0.58);
      for (let k = 0; k < len; k++) {
        const glyph = drizzle ? (d.z > 0.5 ? "'" : ',') : ch;
        g.set(d.x - wind * 0.5 * k, d.y - k, glyph, mixPack(sky, c0, 1 - k * 0.3));
      }
    }
    // Splashes on scene surfaces
    if (strength > 0.05 && scene.surfaces.length) {
      const total = scene.surfaces.reduce((s, [x0, x1]) => s + (x1 - x0 + 1), 0);
      let n = total * strength * dt * 0.9;
      while (n > 0) {
        if (r() < n) {
          let pick = r() * total;
          for (const [x0, x1, y] of scene.surfaces) {
            const len = x1 - x0 + 1;
            if (pick < len) {
              this.splashes.push({ x: x0 + Math.floor(pick), y, age: 0 });
              break;
            }
            pick -= len;
          }
        }
        n -= 1;
      }
    }
    const sc = pack(mix(col, WHITE, 0.25));
    for (const s of this.splashes) {
      s.age += dt;
      const y = s.y - 1;
      if (s.age < 0.07) g.set(s.x, y, '.', sc);
      else if (s.age < 0.15) {
        g.set(s.x - 1, y, '`', sc);
        g.set(s.x + 1, y, "'", sc);
      } else {
        g.set(s.x - 2, y, '.', sc);
        g.set(s.x + 2, y, '.', sc);
      }
    }
    this.splashes = this.splashes.filter((s) => s.age < 0.24);
    // Settled snow / wet sheen on surfaces
    if (w.snow > 0.2) {
      for (const [x0, x1, y] of scene.surfaces) for (let x = x0; x <= x1; x++) g.tint(x, y, pal.snow, w.snow * 0.7);
    }
  }

  private drawSnow(g: Grid, env: Env, scene: Scene): void {
    const { w, dt, pal, t } = env;
    const a = this.area;
    const W = a.x1 - a.x0;
    const H = a.y1 - a.y0;
    const target = Math.round(W * H * w.snow * 0.016 * Math.max(0.6, scene.rainScale));
    const r = this.rng;
    const spawn = (top: boolean): Flake => ({
      x: a.x0 - 10 + r() * (W + 20),
      y: top ? a.y0 - r() * 3 : a.y0 + r() * H,
      v: 2 + r() * 4,
      z: r(),
      ph: r() * 6.28,
    });
    while (this.flakes.length < target) this.flakes.push(spawn(false));
    if (this.flakes.length > target) this.flakes.length = Math.max(target, this.flakes.length - 30);
    const sky = pal.skyMid;
    for (let i = 0; i < this.flakes.length; i++) {
      const f = this.flakes[i];
      f.y += f.v * (0.5 + f.z) * dt;
      f.x += (w.wind * 5 * (0.4 + f.z) + Math.sin(t * 0.9 + f.ph) * 1.4) * dt;
      if (f.y > a.y1 + 1) {
        this.flakes[i] = spawn(true);
        continue;
      }
      const c = f.z > 0.82 ? '*' : f.z > 0.55 ? '+' : f.z > 0.28 ? '·' : '.';
      g.set(f.x, f.y, c, mixPack(sky, pal.snow, 0.45 + 0.55 * f.z));
    }
  }

  private drawFog(g: Grid, env: Env, scene: Scene): void {
    const { w, pal, t } = env;
    const amount = clamp(w.fog + scene.ambientFog(env) * (1 - w.rain));
    if (amount < 0.02) return;
    const a = this.area;
    const dir = w.wind >= 0 ? 1 : -1;
    const drift = t * (0.9 + Math.abs(w.wind) * 2) * dir;
    const fogc = pal.fog;
    const sky = pal.skyBottom;
    const glyphs = ['~', '-', '.', '~'];
    const fs = this.fs;
    for (let y = a.y0; y < a.y1; y++) {
      const bias = scene.fogBias(y, env);
      const by = bias * amount;
      if (by < 0.01) continue;
      const fresh = (y - a.y0) % 2 === 0;
      for (let x = a.x0; x < a.x1; x++) {
        if (fresh && ((x - a.x0) & 1) === 0) this.fbuf[x] = fbm((x * fs - drift) * 0.022, y * fs * 0.085 + t * 0.015, 3, 77);
        const n = this.fbuf[x & ~1] ?? this.fbuf[x];
        const k = clamp(by * (0.25 + 1.15 * n) - 0.05);
        if (k <= 0.01) continue;
        g.paintHaze(x, y, fogc, k * 0.72);
        g.tint(x, y, fogc, k * 0.5);
        if (k > 0.3) {
          const m = noise2((x * fs - drift * 1.4) * 0.35, y * fs * 0.8, 91);
          if (m > 0.74) {
            const i = Math.floor(m * 40) % glyphs.length;
            if (g.get(x, y) === 32) g.set(x, y, glyphs[i], mixPack(sky, fogc, k));
          }
        }
      }
    }
  }

  private drawBolt(g: Grid): void {
    const b = this.bolt;
    if (!b) return;
    const on = Math.floor(b.life * 40) % 3 !== 0;
    if (!on) return;
    const glow: RGB = [150, 170, 255];
    const p = pack([232, 240, 255]);
    for (const [x, y, ch] of b.pts) {
      g.set(x, y, ch, p);
      g.addGlow(x, y, glow, 0.9);
    }
  }
}
