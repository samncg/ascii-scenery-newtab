import { $, h, icon, ICONS } from './dom';
import { normalizeUrl } from './engines';
import { type QuickLink, type SettingsStore, uid } from './settings';

const MAX_LINKS = 12;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Minimal line icons by kind of site (not brand logos). Unknown sites get their initial. */
const KINDS: Array<[RegExp, string[]]> = [
  [/mail|outlook|proton|fastmail/, ['M4 6h16v12H4z', 'M4 7l8 6 8-6']],
  [/youtube|vimeo|netflix|twitch|hulu|disney|primevideo/, ['M8.5 5.5v13l10-6.5z']],
  [/github|gitlab|bitbucket|stackoverflow|codepen|replit|vercel/, ['M8 8l-4 4 4 4', 'M16 8l4 4-4 4', 'M13.5 5.5l-3 13']],
  [/chatgpt|openai|claude|anthropic|perplexity|gemini|copilot|poe\./, ['M12 3.5l1.9 6.6 6.6 1.9-6.6 1.9L12 20.5l-1.9-6.6L3.5 12l6.6-1.9z']],
  [/^x\.com|twitter|mastodon|bsky|threads/, ['M6 6l12 12', 'M18 6L6 18']],
  [/reddit|discord|slack|telegram|whatsapp|messenger|teams/, ['M5 5.5h14v10H10l-5 3.5z']],
  [/wikipedia|notion|docs\.|medium|substack|confluence/, ['M5 5h5.5A1.5 1.5 0 0 1 12 6.5V19a1.5 1.5 0 0 0-1.5-1.5H5z', 'M19 5h-5.5A1.5 1.5 0 0 0 12 6.5V19a1.5 1.5 0 0 1 1.5-1.5H19z']],
  [/google\.|bing|duckduckgo|kagi|search/, ['M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M20 20l-4.3-4.3']],
  [/maps/, ['M12 20.5s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z', 'M12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z']],
  [/spotify|music|soundcloud|bandcamp/, ['M9 17.5V6l10-2v11.5', 'M9 17.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z', 'M19 15.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z']],
  [/amazon|ebay|etsy|shop|store/, ['M6 8.5h12l-1 11H7z', 'M9 8.5a3 3 0 0 1 6 0']],
  [/calendar/, ['M5 6h14v13H5z', 'M5 10h14', 'M9 4v4', 'M15 4v4']],
  [/news|nytimes|bbc|theguardian|reuters|hacker/, ['M5 5h12v14H5z', 'M17 9h2v8a2 2 0 0 1-2 2', 'M8 9h6', 'M8 12h6', 'M8 15h4']],
  [/instagram|photos|flickr|unsplash|pinterest/, ['M4.5 8h3.5l2-2h4l2 2h3.5v11h-15z', 'M12 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z']],
  [/drive|dropbox|onedrive|icloud/, ['M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18z']],
];

function iconFor(host: string): string[] | null {
  for (const [re, paths] of KINDS) if (re.test(host)) return paths;
  return null;
}

/** Quick-link shortcuts: add, edit, remove, drag to reorder. */
export class Links {
  private nav = $('#links');
  private dialog = $<HTMLDialogElement>('#link-dialog');
  private titleIn = $<HTMLInputElement>('#link-title');
  private urlIn = $<HTMLInputElement>('#link-url');
  private err = $('#link-error');
  private editing: string | null = null;
  private dragId: string | null = null;

  constructor(private store: SettingsStore) {
    store.subscribe((_s, changed) => {
      if (changed.has('links') || changed.has('showLinks') || changed.has('linkSize') || changed.has('linkLabels')) this.render();
    });
    $('#link-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.save();
    });
    $('#link-cancel').addEventListener('click', () => this.dialog.close());
    $('#link-delete').addEventListener('click', () => {
      if (this.editing) this.store.update({ links: this.store.get().links.filter((l) => l.id !== this.editing) });
      this.dialog.close();
    });
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
    this.render();
  }

  private render(): void {
    const s = this.store.get();
    this.nav.hidden = !s.showLinks;
    this.nav.dataset.labels = s.linkLabels;
    this.nav.style.setProperty('--link-size', `${s.linkSize}px`);
    const tiles = s.links.map((l) => this.tile(l));
    if (s.links.length < MAX_LINKS) {
      tiles.push(
        h(
          'button',
          { class: 'link add', type: 'button', title: 'Add shortcut', 'aria-label': 'Add shortcut', 'data-glass': '0.15', onclick: () => this.open(null) },
          h('span', { class: 'link-icon' }, icon(ICONS.plus, 16)),
        ),
      );
    }
    this.nav.replaceChildren(...tiles);
  }

  private tile(l: QuickLink): HTMLElement {
    const host = hostOf(l.url);
    const label = l.title || host;
    const letter = (label.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
    const paths = iconFor(host);
    const a = h(
      'a',
      { class: 'link', href: l.url, draggable: 'true', title: label, 'aria-label': label, 'data-id': l.id, 'data-glass': '0.2', 'data-blur': '3' },
      h('span', { class: 'link-icon' }, paths ? icon(paths, 18) : h('span', { class: 'letter', text: letter })),
      h('span', { class: 'link-label', text: label }),
      h(
        'button',
        {
          class: 'link-edit',
          type: 'button',
          title: `Edit ${label}`,
          'aria-label': `Edit ${label}`,
          onclick: (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            this.open(l);
          },
        },
        icon(ICONS.edit, 10),
      ),
    );
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.open(l);
    });
    a.addEventListener('dragstart', (e) => {
      this.dragId = l.id;
      a.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', l.url);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    a.addEventListener('dragend', () => {
      this.dragId = null;
      a.classList.remove('dragging');
      this.nav.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    });
    a.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === l.id) return;
      e.preventDefault();
      const r = a.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      a.classList.toggle('drop-after', after);
      a.classList.toggle('drop-before', !after);
    });
    a.addEventListener('dragleave', () => a.classList.remove('drop-before', 'drop-after'));
    a.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!this.dragId || this.dragId === l.id) return;
      const after = a.classList.contains('drop-after');
      const links = this.store.get().links.slice();
      const from = links.findIndex((x) => x.id === this.dragId);
      if (from < 0) return;
      const [moved] = links.splice(from, 1);
      let to = links.findIndex((x) => x.id === l.id);
      if (after) to += 1;
      links.splice(to, 0, moved);
      this.store.update({ links });
    });
    return a;
  }

  /** Open the add-shortcut dialog (used from Tweaks). */
  add(): void {
    this.open(null);
  }

  private open(l: QuickLink | null): void {
    this.editing = l?.id ?? null;
    $('#link-dialog-title').textContent = l ? 'Edit shortcut' : 'Add shortcut';
    $('#link-delete').hidden = !l;
    this.titleIn.value = l?.title ?? '';
    this.urlIn.value = l?.url ?? '';
    this.err.hidden = true;
    this.dialog.showModal();
    (l ? this.titleIn : this.urlIn).focus();
  }

  private save(): void {
    const url = normalizeUrl(this.urlIn.value);
    if (!url) {
      this.err.hidden = false;
      this.urlIn.focus();
      return;
    }
    const title = this.titleIn.value.trim() || hostOf(url);
    const links = this.store.get().links.slice();
    if (this.editing) {
      const i = links.findIndex((x) => x.id === this.editing);
      if (i >= 0) links[i] = { ...links[i], title, url };
    } else links.push({ id: uid(), title, url });
    this.store.update({ links });
    this.dialog.close();
  }
}
