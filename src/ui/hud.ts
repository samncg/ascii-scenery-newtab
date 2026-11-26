import { greetingFor } from '../engine/time';
import { $, h, icon, ICONS } from './dom';
import { ENGINES, engineById, resolveQuery } from './engines';
import type { SettingsStore } from './settings';

interface SpeechRec {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

/** Greeting, optional clock and the glass search composer. */
export class Hud {
  private root = $('#hud');
  private clock = $('#clock');
  private clockbox = $('#clockbox');
  private date = $('#date');
  private lastDate = '';
  private greeting = $('#greeting');
  private form = $<HTMLFormElement>('#search');
  private input = $<HTMLTextAreaElement>('#search-input');
  private engineBtn = $<HTMLButtonElement>('#engine-btn');
  private sendBtn = $<HTMLButtonElement>('#search-go');
  private micBtn = $<HTMLButtonElement>('#mic-btn');
  private menu = $<HTMLUListElement>('#engine-menu');
  private lastClock = '';
  private lastGreeting = '';
  private editing = false;

  constructor(private store: SettingsStore) {
    $('#search-icon').append(icon(ICONS.search, 18));
    this.sendBtn.append(icon(ICONS.up, 17));
    this.micBtn.append(icon(ICONS.mic, 17));

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.go();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.go();
      }
    });
    this.input.addEventListener('input', () => this.autosize());
    this.engineBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });
    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node)) this.toggleMenu(false);
    });
    this.menu.addEventListener('keydown', (e) => {
      const items = [...this.menu.querySelectorAll<HTMLButtonElement>('button')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
      else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
      else if (e.key === 'Escape') {
        this.toggleMenu(false);
        this.engineBtn.focus();
      } else return;
      e.preventDefault();
    });
    document.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        this.input.focus();
      }
    });
    this.setupMic();
    this.greeting.title = 'Click to change your name';
    this.greeting.addEventListener('click', () => this.editName());
    store.subscribe((_s, changed) => {
      if (changed.has('engine')) this.renderEngine();
      if (['showHud', 'hudPosition', 'showClock', 'name', 'timeGreeting', 'clock24', 'clockPosition', 'clockSize', 'showDate'].some((k) => changed.has(k as never))) this.apply();
    });
    this.renderEngine();
    this.apply();
    this.autosize();
    // Chrome keeps focus in the address bar on new tabs; elsewhere, focus search.
    setTimeout(() => this.input.focus({ preventScroll: true }), 50);
  }

  private go(): void {
    const q = this.input.value.trim();
    if (!q) return;
    window.location.href = resolveQuery(q.replace(/\s+/g, ' '), engineById(this.store.get().engine));
  }

  private autosize(): void {
    this.sendBtn.disabled = !this.input.value.trim();
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(160, this.input.scrollHeight)}px`;
  }

  /** Voice input where the browser offers it (Chromium); hidden elsewhere. */
  private setupMic(): void {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    this.micBtn.hidden = false;
    let rec: SpeechRec | null = null;
    this.micBtn.addEventListener('click', () => {
      if (rec) {
        rec.stop();
        return;
      }
      try {
        rec = new Ctor();
        rec.lang = navigator.language || 'en-US';
        rec.interimResults = true;
        rec.onresult = (e) => {
          let text = '';
          for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
          this.input.value = text;
          this.autosize();
        };
        const done = () => {
          rec = null;
          this.micBtn.classList.remove('listening');
        };
        rec.onend = done;
        rec.onerror = done;
        rec.start();
        this.micBtn.classList.add('listening');
      } catch {
        rec = null;
      }
    });
  }

  private apply(): void {
    const s = this.store.get();
    this.root.hidden = !s.showHud;
    this.root.dataset.position = s.hudPosition;
    // Place the clock: above the greeting, under the shortcuts, or in a corner.
    const box = this.clockbox;
    box.hidden = !s.showClock;
    box.dataset.position = s.clockPosition;
    box.style.setProperty('--clock-size', `${s.clockSize}px`);
    if (s.clockPosition === 'above') $('.masthead').prepend(box);
    else if (s.clockPosition === 'below') $('.stage').append(box);
    else document.body.append(box);
    this.date.hidden = !s.showDate;
    this.lastClock = '';
    this.lastDate = '';
    this.lastGreeting = '';
    this.tick(new Date());
  }

  private renderEngine(): void {
    const s = this.store.get();
    const eng = engineById(s.engine);
    this.engineBtn.replaceChildren(h('span', { class: 'glyph', text: eng.glyph }), h('span', { text: eng.name }), icon(ICONS.chevron, 14));
    this.engineBtn.setAttribute('aria-label', `Search engine: ${eng.name}`);
    this.input.placeholder = eng.ai ? `Ask ${eng.name} anything…` : `Search ${eng.name} or ask anything…`;
    this.menu.replaceChildren(
      ...ENGINES.map((e) =>
        h(
          'li',
          { role: 'option', 'aria-selected': String(e.id === s.engine) },
          h(
            'button',
            {
              type: 'button',
              class: e.id === s.engine ? 'active' : '',
              onclick: () => {
                this.store.update({ engine: e.id });
                this.toggleMenu(false);
                this.input.focus();
              },
            },
            h('span', { class: 'glyph', text: e.glyph }),
            h('span', { text: e.name }),
            e.ai ? h('span', { class: 'tag', text: 'AI' }) : null,
          ),
        ),
      ),
    );
  }

  private toggleMenu(open = this.menu.hidden): void {
    this.menu.hidden = !open;
    this.engineBtn.setAttribute('aria-expanded', String(open));
    if (open) this.menu.querySelector<HTMLButtonElement>('button.active')?.focus();
  }

  /** Inline name editor on the greeting. */
  private editName(): void {
    if (this.editing) return;
    this.editing = true;
    const input = h('input', { class: 'name-input', type: 'text', maxlength: 40, placeholder: 'Your name', 'aria-label': 'Your name' });
    input.value = this.store.get().name;
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      this.editing = false;
      this.lastGreeting = '';
      if (save) this.store.update({ name: input.value.trim() });
      this.tick(new Date());
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
    this.greeting.replaceChildren(input);
    input.focus();
    input.select();
  }

  /** Called once a second by the main loop. */
  tick(now: Date): void {
    const s = this.store.get();
    const clock = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !s.clock24 });
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clock.textContent = clock;
    }
    const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    if (date !== this.lastDate) {
      this.lastDate = date;
      this.date.textContent = date;
    }
    if (this.editing) return;
    const text = greetingFor(now.getHours() + now.getMinutes() / 60, s.name, s.timeGreeting);
    if (text !== this.lastGreeting) {
      this.lastGreeting = text;
      this.greeting.textContent = text;
    }
  }
}
