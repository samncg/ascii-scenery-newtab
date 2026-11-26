import { $, h, icon, ICONS } from './dom';
import { ELEMENTS, type ElementId } from './elements';
import type { Settings, SettingsStore } from './settings';

/**
 * On-page customize mode: every element gets an outline with ✎ (change, opens
 * its options in Tweaks) and × (remove). A bar at the bottom brings removed
 * elements back.
 */
export class Customizer {
  active = false;
  private layer = h('div', { class: 'cz-layer', 'aria-hidden': 'false' });
  private bar = h('div', { class: 'cz-bar glass', 'data-glass': '0.6', role: 'toolbar', 'aria-label': 'Customize page' });
  private hiddenList = h('div', { class: 'cz-hidden' });
  private boxes = new Map<ElementId, HTMLElement>();

  constructor(
    private store: SettingsStore,
    private onEdit: (id: ElementId) => void,
  ) {
    for (const e of ELEMENTS) {
      const box = h(
        'div',
        { class: 'cz-box', 'data-el': e.id },
        h('span', { class: 'cz-tag', text: e.label }),
        h(
          'div',
          { class: 'cz-tools' },
          h('button', { type: 'button', class: 'cz-btn', title: `Change ${e.label}`, 'aria-label': `Change ${e.label}`, onclick: () => this.onEdit(e.id) }, icon(ICONS.edit, 13)),
          h(
            'button',
            {
              type: 'button',
              class: 'cz-btn danger',
              title: `Remove ${e.label}`,
              'aria-label': `Remove ${e.label}`,
              onclick: () => this.store.update({ [e.key]: false } as Partial<Settings>),
            },
            icon(ICONS.close, 13),
          ),
        ),
      );
      this.boxes.set(e.id, box);
      this.layer.append(box);
    }
    this.bar.append(
      h('span', { class: 'cz-title', text: 'Customize' }),
      h('span', { class: 'cz-hint', text: '× removes an element · ✎ changes it' }),
      this.hiddenList,
      h('button', { type: 'button', class: 'btn primary small', text: 'Done', onclick: () => this.stop() }),
    );
    this.layer.hidden = true;
    this.bar.hidden = true;
    document.body.append(this.layer, this.bar);
    store.subscribe(() => this.active && this.renderHidden());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.active && !$('#drawer').classList.contains('open')) this.stop();
    });
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.layer.hidden = false;
    this.bar.hidden = false;
    document.body.classList.add('customizing');
    this.renderHidden();
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.active = false;
    this.layer.hidden = true;
    this.bar.hidden = true;
    document.body.classList.remove('customizing');
  }

  /** Chips to bring back removed elements. */
  private renderHidden(): void {
    const s = this.store.get();
    const off = ELEMENTS.filter((e) => !s[e.key]);
    this.hiddenList.replaceChildren(
      ...off.map((e) =>
        h('button', { type: 'button', class: 'chip', title: `Show ${e.label}`, onclick: () => this.store.update({ [e.key]: true } as Partial<Settings>) }, `+ ${e.label}`),
      ),
    );
  }

  /** Keep each outline glued to its element while the page moves. */
  private frame = (): void => {
    if (!this.active) return;
    const s = this.store.get();
    for (const e of ELEMENTS) {
      const box = this.boxes.get(e.id)!;
      const el = document.querySelector<HTMLElement>(e.selector);
      const r = el?.getBoundingClientRect();
      if (!s[e.key] || !r || r.width < 2 || r.height < 2) {
        box.hidden = true;
        continue;
      }
      box.hidden = false;
      // Keep the tools on screen for elements hugging the right or top edge.
      box.classList.toggle('flip', r.right > window.innerWidth - 40);
      box.classList.toggle('below', r.top < 24);
      const pad = 6;
      box.style.left = `${r.left - pad}px`;
      box.style.top = `${r.top - pad}px`;
      box.style.width = `${r.width + pad * 2}px`;
      box.style.height = `${r.height + pad * 2}px`;
    }
    requestAnimationFrame(this.frame);
  };
}
