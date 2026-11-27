import { fontState } from '../core/render-common';
import type { Settings } from './settings';

/** Font choices. Geist and Geist Mono are bundled; the rest use what the system has. */
export const FONTS = [
  { id: 'default', label: 'Default', stack: '' },
  { id: 'geist', label: 'Geist', stack: 'Geist, ui-sans-serif, system-ui, sans-serif' },
  { id: 'geist-mono', label: 'Geist Mono', stack: '"Geist Mono", ui-monospace, monospace' },
  { id: 'system', label: 'System', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' },
  { id: 'rounded', label: 'Rounded', stack: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", Nunito, system-ui, sans-serif' },
  { id: 'mono', label: 'System mono', stack: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace' },
  { id: 'typewriter', label: 'Typewriter', stack: '"Courier New", Courier, monospace' },
  { id: 'condensed', label: 'Condensed', stack: '"Bahnschrift Condensed", "Arial Narrow", "Roboto Condensed", sans-serif' },
  { id: 'handwriting', label: 'Handwriting', stack: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive' },
] as const;

export type FontId = (typeof FONTS)[number]['id'];

/** Elements whose font can be changed. */
export const FONT_TARGETS = ['clock', 'date', 'greeting', 'search', 'links', 'status', 'ascii'] as const;
export type FontTarget = (typeof FONT_TARGETS)[number];

/** Fonts for the ASCII art itself (any font works: glyphs are centred per cell). */
export const ASCII_FONTS: FontId[] = ['geist-mono', 'mono', 'typewriter', 'geist', 'serif', 'rounded'];

export const stackOf = (id: FontId): string => FONTS.find((f) => f.id === id)?.stack ?? '';

/** Push the chosen fonts into CSS variables (and the ASCII renderer). Returns true if the ASCII font changed. */
export function applyFonts(s: Readonly<Settings>): boolean {
  const root = document.documentElement.style;
  for (const t of FONT_TARGETS) {
    if (t === 'ascii') continue;
    const stack = stackOf(s.fonts[t]);
    if (stack) root.setProperty(`--font-${t}`, stack);
    else root.removeProperty(`--font-${t}`);
  }
  const ascii = stackOf(s.fonts.ascii) || stackOf('geist-mono');
  const changed = ascii !== fontState.stack;
  fontState.stack = ascii;
  return changed;
}
