import { mix, packRGB, type RGB } from '../core/color';
import type { Grid } from '../core/grid';
import { clamp, hash2, mulberry32, noise2 } from '../core/math';
import { AbyssScene, Specks } from './ink';
import { directionAngle, scenePrefs, wrap } from './prefs';
import type { Env } from './types';

interface Turtle {
  x: number;
  y: number;
  a: number;
  v: number;
  S: number;
  phase: number;
  seed: number;
  shell: RGB;
  scute: RGB;
}

const SKIN: RGB = [168, 176, 132];
const KINDS: Array<[RGB, RGB]> = [
  [[96, 118, 64], [196, 150, 72]], // green
  [[120, 84, 52], [222, 168, 92]], // hawksbill
  [[86, 92, 84], [160, 150, 120]], // loggerhead-ish
];

/** Sea turtles rowing slowly across the dark, seen from above. */
export class TurtlesScene extends AbyssScene {
  readonly id = 'turtles' as const;
  private turtles: Turtle[] = [];
  private snow = new Specks();

  init(cols: number, rows: number): void {
    super.init(cols, rows);
    const r = mulberry32(808);
    const size = scenePrefs.animalSize;
    const n = Math.max(2, Math.min(8, Math.round((cols * rows) / (6500 * size * size))));
    this.turtles = Array.from({ length: n }, (_, i) => {
      const [shell, scute] = KINDS[i % KINDS.length];
      return {
        x: r() * cols,
        y: r() * rows,
        a: r() * Math.PI * 2,
        v: (2.2 + r() * 1.4) * Math.sqrt(size),
        S: (7 + r() * 4) * size,
        phase: r() * 6,
        seed: Math.floor(r() * 1000),
        shell,
        scute,
      };
    });
    this.snow.place(cols, rows, Math.round((cols * rows) / 170), 21);
  }

  draw(g: Grid, env: Env): void {
    this.prep(env);
    const { t, dt, aspect: a } = env;
    this.snow.draw(g, env, [80, 120, 130], 0.5, 0.3);
    const dir = directionAngle(scenePrefs.animalDirection);
    for (const tu of this.turtles) {
      const want = dir === null ? noise2(tu.x * 0.01 + tu.seed, t * 0.04, 6) * Math.PI * 4 : dir + (noise2(t * 0.05, tu.seed, 2) - 0.5) * 0.8;
      let da = want - tu.a;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      tu.a += clamp(da, -0.4 * dt, 0.4 * dt);
      tu.phase += dt * 1.6;
      // Each stroke gives a gentle push, then a glide.
      const push = 0.55 + 0.45 * Math.max(0, Math.sin(tu.phase));
      tu.x += Math.cos(tu.a) * tu.v * push * dt;
      tu.y += (Math.sin(tu.a) * tu.v * push * dt) / a;
      wrap(tu, this.cols, this.rows, tu.S * 2.5);
      this.splat(tu, a);
    }
    this.field.resolve(g, t, dt, { sparkle: 0.05 });
    for (const tu of this.turtles) {
      const fx = Math.cos(tu.a);
      const fy = Math.sin(tu.a);
      for (const side of [-1, 1]) {
        const ex = tu.x + fx * tu.S * 1.42 - fy * side * tu.S * 0.17;
        const ey = tu.y + (fy * tu.S * 1.42 + fx * side * tu.S * 0.17) / a;
        g.set(ex, ey, '.', packRGB(20, 20, 16));
      }
    }
  }

  private splat(tu: Turtle, a: number): void {
    const F = this.field;
    const { S } = tu;
    const fx = Math.cos(tu.a);
    const fy = Math.sin(tu.a);
    const at = (along: number, across: number): [number, number] => [tu.x + fx * along - fy * across, tu.y + (fy * along + fx * across) / a];
    const stroke = Math.sin(tu.phase);
    // Front flippers sweep like oars; rear flippers trail.
    for (const side of [-1, 1]) {
      const [bx, by] = at(S * 0.55, side * S * 0.55);
      const ang = tu.a + side * (1.75 - stroke * 0.65);
      const len = S * 1.25;
      F.oval(bx + (Math.cos(ang) * len) / 2, by + (Math.sin(ang) * len) / 2 / a, ang, len / 2, S * 0.2, 1.2, SKIN);
      const [rx, ry] = at(-S * 0.7, side * S * 0.45);
      const rang = tu.a + Math.PI - side * (0.6 + stroke * 0.15);
      F.oval(rx + Math.cos(rang) * S * 0.25, ry + (Math.sin(rang) * S * 0.25) / a, rang, S * 0.32, S * 0.15, 1.2, SKIN);
    }
    // Head.
    const [hx, hy] = at(S * 1.3, Math.sin(tu.phase * 0.5) * S * 0.04);
    F.oval(hx, hy, tu.a, S * 0.34, S * 0.27, 1.3, (u, v) => (hash2(Math.round(u * 6), Math.round(v * 6), 4) < 0.25 ? mix(SKIN, [60, 60, 40], 0.5) : SKIN));
    // Shell: domed (lit at the centre) with plated scutes.
    F.oval(tu.x, tu.y, tu.a, S, S * 0.8, 1.45, (u, v) => {
      const q = u * u + v * v;
      const edge = q > 0.82;
      const gu = Math.abs(((u * 2.2 + 10) % 1) - 0.5) < 0.07;
      const gv = Math.abs(((v * 1.6 + (Math.floor(u * 2.2) % 2) * 0.5 + 10) % 1) - 0.5) < 0.08;
      const seam = !edge && (gu || gv);
      const base = edge ? mix(tu.shell, [40, 40, 30], 0.3) : seam ? mix(tu.shell, [30, 30, 20], 0.5) : mix(tu.shell, tu.scute, 0.45 + 0.4 * noise2(u * 3, v * 3, tu.seed));
      const dome = 0.65 + 0.45 * Math.sqrt(Math.max(0, 1 - q));
      return [base[0] * dome, base[1] * dome, base[2] * dome];
    });
  }
}
