/**
 * What one viewer chose on one panel — pinned cards, collapsed cards, colours, theme, language,
 * density, motion, their own layout — kept in their own browser.
 *
 * localStorage, wrapped: it throws in a private window, with storage blocked, and in some embedded
 * contexts, and a preference that cannot be saved must never break the page. Nothing here is a
 * setting of the panel; it is one person's view of it. Only choices that differ from the default are
 * stored, so a default that changes later reaches everybody who never chose.
 */
import type { PanelLayout } from "../types.js";
import { readLayout } from "../panel/layout.js";

export interface Prefs {
  pinned: Set<string>;
  collapsed: Set<string>;
  /** This viewer's colours, over the panel's: absent follows the panel. */
  scheme: "auto" | "light" | "dark" | undefined;
  /** This viewer's language, over the panel's: absent follows the panel. */
  language: string | undefined;
  /** This viewer's theme, by name, over the panel's: absent follows the panel. */
  theme: string | undefined;
  /** Smaller cards, for a wall screen or a small laptop: absent is the panel's own spacing. */
  density: "compact" | undefined;
  /** A value that changes lights up briefly. */
  flash: boolean;
  /** Anything that moves: off stops every animation and transition, as the system's reduced-motion setting does. */
  motion: boolean;
  /** The change beside a charted value (▲ 12 in 5 min). */
  trends: boolean;
  /** This viewer's own arrangement of cards, over the panel's; absent follows the panel. */
  layout: PanelLayout | undefined;
  save(): void;
  /** Every choice back to the panel's, pins, collapsed cards and layout excepted. */
  reset(): void;
}

interface Stored {
  pinned?: string[];
  collapsed?: string[];
  scheme?: string;
  language?: string;
  theme?: string;
  density?: string;
  flash?: boolean;
  motion?: boolean;
  trends?: boolean;
  layout?: unknown;
}

export function loadPrefs(key: string): Prefs {
  let stored: Stored = {};
  try {
    stored = JSON.parse(globalThis.localStorage?.getItem(key) ?? "{}") as Stored;
  } catch {
    stored = {};
  }
  const prefs: Prefs = {
    pinned: new Set(Array.isArray(stored.pinned) ? stored.pinned.filter((id) => typeof id === "string") : []),
    collapsed: new Set(Array.isArray(stored.collapsed) ? stored.collapsed.filter((id) => typeof id === "string") : []),
    scheme: stored.scheme === "auto" || stored.scheme === "light" || stored.scheme === "dark" ? stored.scheme : undefined,
    language: typeof stored.language === "string" && /^[a-z]{2,3}$/.test(stored.language) ? stored.language : undefined,
    theme: typeof stored.theme === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(stored.theme) ? stored.theme : undefined,
    density: stored.density === "compact" ? "compact" : undefined,
    flash: stored.flash !== false,
    motion: stored.motion !== false,
    trends: stored.trends !== false,
    layout: readLayout(stored.layout),
    save() {
      const out: Stored = { pinned: [...prefs.pinned], collapsed: [...prefs.collapsed] };
      if (prefs.scheme !== undefined) out.scheme = prefs.scheme;
      if (prefs.language !== undefined) out.language = prefs.language;
      if (prefs.theme !== undefined) out.theme = prefs.theme;
      if (prefs.density !== undefined) out.density = prefs.density;
      if (!prefs.flash) out.flash = false;
      if (!prefs.motion) out.motion = false;
      if (!prefs.trends) out.trends = false;
      if (prefs.layout !== undefined) out.layout = prefs.layout;
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(out));
      } catch {
        // Not saved; the page works the same, and forgets on reload.
      }
    },
    reset() {
      prefs.scheme = undefined;
      prefs.language = undefined;
      prefs.theme = undefined;
      prefs.density = undefined;
      prefs.flash = true;
      prefs.motion = true;
      prefs.trends = true;
      prefs.save();
    },
  };
  return prefs;
}
