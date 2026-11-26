import { SCENES } from '../scenes';
import { $, h } from './dom';
import type { SettingsStore } from './settings';

/** Dot colors hinting at each scene. */
const DOTS: Record<string, [string, string]> = {
  tokyo: ['#ff7ac0', '#7a4bff'],
  cabin: ['#ffc070', '#c0642a'],
  sf: ['#ff8a5c', '#c4382c'],
  cat: ['#ffd08a', '#e0965a'],
  koi: ['#ffb070', '#e4512f'],
  clearing: ['#ffd24f', '#e07032'],
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
