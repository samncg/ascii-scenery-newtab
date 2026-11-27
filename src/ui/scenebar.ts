import { SCENES } from '../scenes';
import { $, h } from './dom';
import type { SettingsStore } from './settings';

/** Dot colors hinting at each scene. */
const DOTS: Record<string, [string, string]> = {
  tokyo: ['#ff7ac0', '#7a4bff'],
  sf: ['#ff8a5c', '#c4382c'],
  koi: ['#ffb070', '#e4512f'],
  silhouette: ['#ffc070', '#2c4a34'],
  aurora: ['#6dff9a', '#a064ff'],
  dunes: ['#ffd090', '#c07040'],
  ocean: ['#7ac0ff', '#2a5a9a'],
  butterflies: ['#7ab0ff', '#3050d0'],
  mantas: ['#7af0ff', '#2a6a9a'],
  jellyfish: ['#ff8ad8', '#a050ff'],
  whales: ['#a0c0e8', '#3a4c70'],
  turtles: ['#c0d080', '#607040'],
  starlings: ['#c8d0e8', '#40485c'],
  fireflies: ['#e0ff80', '#70a030'],
};

/** Pill-shaped segmented scene switcher with a sliding thumb (top centre). */
export class SceneBar {
  private el = $('#scenebar');
  private thumb = h('span', { class: 'scenebar-thumb', 'aria-hidden': 'true' });
  private buttons: HTMLButtonElement[] = [];

  constructor(private store: SettingsStore) {
    this.buttons = SCENES.map((sc) => {
      const [a, b] = DOTS[sc.id] ?? ['#7aa2ff', '#4a6ad0'];
      return h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'data-scene': sc.id,
          title: sc.name,
          onclick: () => this.store.update({ scene: sc.id }),
        },
        h('span', { class: 'dot', style: `background: radial-gradient(circle at 35% 35%, ${a}, ${b})` }),
        h('span', { class: 'label', text: sc.short }),
      );
    });
    this.el.replaceChildren(this.thumb, ...this.buttons);
    store.subscribe((_s, changed) => {
      if (changed.has('scene') || changed.has('showSceneBar')) this.sync();
    });
    window.addEventListener('resize', () => this.moveThumb(false));
    this.sync();
    document.fonts?.ready.then(() => this.moveThumb(false)).catch(() => {});
  }

  private sync(): void {
    const s = this.store.get();
    this.el.hidden = !s.showSceneBar;
    for (const b of this.buttons) {
      const on = b.dataset.scene === s.scene;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    requestAnimationFrame(() => this.moveThumb(true));
  }

  private moveThumb(animate: boolean): void {
    const on = this.buttons.find((b) => b.classList.contains('on'));
    if (!on) return;
    this.thumb.classList.toggle('instant', !animate);
    this.thumb.style.setProperty('--x', `${on.offsetLeft}px`);
    this.thumb.style.setProperty('--w', `${on.offsetWidth}px`);
  }
}
