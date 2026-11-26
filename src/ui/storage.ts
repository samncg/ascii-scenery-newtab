/**
 * Storage helpers. localStorage is the synchronous source of truth (so the
 * first frame paints with the right settings); browser.storage.local /
 * chrome.storage.local is mirrored when available. Every call is guarded so
 * nothing throws under `vite dev`, where no extension API exists.
 */

export function readLocal<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export function writeLocal<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / privacy mode */
  }
}

interface StorageArea {
  get(keys: string | string[], cb?: (items: Record<string, unknown>) => void): unknown;
  set(items: Record<string, unknown>, cb?: () => void): unknown;
}

interface ExtGlobal {
  browser?: { storage?: { local?: StorageArea } };
  chrome?: { storage?: { local?: StorageArea }; runtime?: { lastError?: unknown } };
}

function call<T>(method: 'get' | 'set', arg: unknown): Promise<T | undefined> {
  const g = globalThis as unknown as ExtGlobal;
  try {
    // Firefox: promise-based `browser.*` (does not accept callbacks).
    const ff = g.browser?.storage?.local;
    if (ff) return Promise.resolve(ff[method](arg as never) as Promise<T>);
    // Chrome / Edge: callback form works on every MV3 version.
    const cr = g.chrome?.storage?.local;
    if (cr) {
      return new Promise((resolve) => {
        try {
          cr[method](arg as never, ((v?: T) => {
            resolve(g.chrome?.runtime?.lastError ? undefined : v);
          }) as never);
        } catch {
          resolve(undefined);
        }
      });
    }
  } catch {
    /* not an extension context */
  }
  return Promise.resolve(undefined);
}

export async function readExt<T>(key: string): Promise<T | null> {
  try {
    const items = await call<Record<string, unknown>>('get', key);
    return (items?.[key] as T) ?? null;
  } catch {
    return null;
  }
}

export async function writeExt<T>(key: string, value: T): Promise<void> {
  try {
    await call('set', { [key]: value });
  } catch {
    /* ignore */
  }
}
