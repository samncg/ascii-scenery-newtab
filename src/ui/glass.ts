import type { GlassPanel } from '../core/render-common';

/**
 * Finds every element marked `data-glass` and reports where it is, so the
 * WebGL renderer can draw real refractive glass underneath it.
 *
 *   data-glass="0.4"   → how much the glass darkens what is behind (legibility)
 *   data-blur="6"      → frost radius in CSS px (optional)
 *   data-fade          → panel animates its opacity (read it every frame)
 */
export class GlassTracker {
  private radius = new WeakMap<Element, { sig: string; rad: number }>();

  constructor() {
    window.addEventListener('resize', () => (this.radius = new WeakMap()));
  }

  collect(): GlassPanel[] {
    const out: GlassPanel[] = [];
    const els = document.querySelectorAll<HTMLElement>('[data-glass]');
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) continue;
      // Only fading panels need a (costly) computed-style read each frame.
      let opacity = el.dataset.fade !== undefined ? Number(getComputedStyle(el).opacity) : 1;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.hidden) {
          opacity = 0;
          break;
        }
      }
      if (el.tagName === 'DIALOG' && !(el as HTMLDialogElement).open) continue;
      if (opacity <= 0.01) continue;
      // Re-read the corner radius whenever the element's attributes change
      // (e.g. the search box switching between compact and regular).
      const sig = `${el.className}|${el.dataset.size ?? ''}|${r.width | 0}x${r.height | 0}`;
      let cached = this.radius.get(el);
      if (!cached || cached.sig !== sig) {
        cached = { sig, rad: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 };
        this.radius.set(el, cached);
      }
      const rad = cached.rad;
      out.push({
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        radius: Math.min(rad, r.height / 2, r.width / 2),
        opacity,
        dark: Number(el.dataset.glass) || 0.3,
        blur: Number(el.dataset.blur) || Math.min(8, 2 + Math.min(r.width, r.height) / 40),
      });
    }
    return out;
  }
}
