import type { EngineId } from './settings';

export interface Engine {
  id: EngineId;
  name: string;
  url: string;
  glyph: string;
  ai?: boolean;
}

export const ENGINES: Engine[] = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', glyph: 'G' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', glyph: 'D' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', glyph: 'B' },
  { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', glyph: 'b' },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s', glyph: 'S' },
  { id: 'kagi', name: 'Kagi', url: 'https://kagi.com/search?q=%s', glyph: 'K' },
  { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/search?q=%s', glyph: 'P', ai: true },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/?q=%s', glyph: 'C', ai: true },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new?q=%s', glyph: 'A', ai: true },
];

export const engineById = (id: EngineId): Engine => ENGINES.find((e) => e.id === id) ?? ENGINES[0];

const URLISH = /^(https?:\/\/)?(localhost|(\d{1,3}\.){3}\d{1,3}|([\w-]+\.)+[a-z]{2,})(:\d+)?(\/\S*)?$/i;

/** Turn the search box text into a destination URL. */
export function resolveQuery(text: string, engine: Engine): string {
  const q = text.trim();
  if (!/\s/.test(q) && URLISH.test(q)) return /^https?:\/\//i.test(q) ? q : `https://${q}`;
  return engine.url.replace('%s', encodeURIComponent(q));
}

/** Normalize a user-typed quick-link URL; returns null if it is not http(s). */
export function normalizeUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z][\w+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}
