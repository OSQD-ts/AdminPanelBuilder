/**
 * What one viewer chose on one panel — pinned cards, collapsed cards — kept in their own browser.
 *
 * localStorage, wrapped: it throws in a private window, with storage blocked, and in some embedded
 * contexts, and a preference that cannot be saved must never break the page. Nothing here is a
 * setting of the panel; it is one person's view of it.
 */
export interface Prefs {
  pinned: Set<string>;
  collapsed: Set<string>;
  /** This viewer's colours, over the panel's: absent follows the panel. */
  scheme: "auto" | "light" | "dark" | undefined;
  save(): void;
}

export function loadPrefs(key: string): Prefs {
  let stored: { pinned?: string[]; collapsed?: string[]; scheme?: string } = {};
  try {
    stored = JSON.parse(globalThis.localStorage?.getItem(key) ?? "{}") as typeof stored;
  } catch {
    stored = {};
  }
  const prefs: Prefs = {
    pinned: new Set(Array.isArray(stored.pinned) ? stored.pinned.filter((id) => typeof id === "string") : []),
    collapsed: new Set(Array.isArray(stored.collapsed) ? stored.collapsed.filter((id) => typeof id === "string") : []),
    scheme: stored.scheme === "auto" || stored.scheme === "light" || stored.scheme === "dark" ? stored.scheme : undefined,
    save() {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify({ pinned: [...prefs.pinned], collapsed: [...prefs.collapsed], ...(prefs.scheme === undefined ? {} : { scheme: prefs.scheme }) }));
      } catch {
        // Not saved; the page works the same, and forgets on reload.
      }
    },
  };
  return prefs;
}
