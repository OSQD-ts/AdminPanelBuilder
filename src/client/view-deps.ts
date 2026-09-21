/** What a mounted panel hands its view. Kept apart so the view's modules can share it without importing each other. */
import type { Api } from "./api.js";
import type { Root } from "./dom.js";
import type { Translate } from "./i18n.js";

export interface ViewDeps {
  root: Root;
  /** The element everything is drawn into; it carries `.apb-root` and `data-scheme`. */
  container: HTMLElement;
  /** Absent for a snapshot, which never changes anything. */
  api: Api | undefined;
  /** Asks for fresh state now, after a change made from this page. */
  refresh: () => void;
  loadActivity?: (() => Promise<void>) | undefined;
  /** The standalone page may use the URL fragment for the open tab; an embedded one may not touch the host's URL. */
  standalone: boolean;
  snapshot: boolean;
  t: Translate;
  /** The scheme the panel asks for, before this viewer's own choice. */
  scheme: "auto" | "light" | "dark";
  /** Only the groups: no header chrome, no activity, no shortcuts. */
  compact: boolean;
}
