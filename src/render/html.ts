/**
 * The panel as HTML: the full page a listener serves, the fragment `panel.html()` returns for
 * embedding, and the stylesheet both use.
 *
 * Nothing the application wrote is assembled into markup here. Titles go through
 * `escapeHtml`; values, labels and everything else travel in one JSON bootstrap block that the
 * client reads and puts into the document with `textContent`. That block is escaped for the
 * HTML parser as well as for JSON, because HTML ends a script element at the first `</script`
 * in the source — including one inside a string literal a player chose as their name.
 */
import { CLIENT_EXTRAS, CLIENT_SCRIPT } from "../client.generated.js";
import { themeStylesheet } from "../themes/define.js";
import type { Theme } from "../themes/types.js";
import type { PanelSchema, PanelState } from "../types.js";
import { LAYOUT_CSS } from "./layout.js";

export interface Bootstrap {
  schema: PanelSchema;
  state: PanelState;
}

/** Whether a schema draws charts or tables, whose code is a second bundle. See src/client/registry.ts. */
export function usesExtras(schema: PanelSchema): boolean {
  return schema.groups.some((group) => group.items.some((item) => item.type === "chart" || item.type === "table"));
}

/** Theme preamble, layout, then the theme's own additions, so they win ties. */
export function panelStylesheet(theme: Theme): string {
  return `${themeStylesheet(theme)}${LAYOUT_CSS}\n${theme.css}`;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** JSON that is also safe inside a `<script>` element: no `<`, `>` or `&` for the HTML parser, no U+2028/U+2029 for old JavaScript parsers. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * The element the client mounts into. With a bootstrap, the client draws it at once; without
 * one, it asks `api` for the schema and the state first. `api` absent is a snapshot that never
 * polls.
 */
function rootElement(bootstrap: Bootstrap | undefined, theme: Theme, scheme: "auto" | "light" | "dark", api: string | undefined, standalone: boolean, only: { group?: string | undefined; compact?: boolean | undefined } = {}): string {
  const schemeAttribute = scheme === "auto" ? "" : ` data-scheme="${scheme}"`;
  const apiAttribute = api === undefined ? "" : ` data-api="${escapeHtml(api)}"`;
  const groupAttribute = only.group === undefined ? "" : ` data-group="${escapeHtml(only.group)}"`;
  const compactAttribute = only.compact === true ? " data-compact" : "";
  return [
    `<div class="apb-root${standalone ? " apb-standalone" : ""}" data-apb-root data-theme-name="${escapeHtml(theme.name)}"${schemeAttribute}${apiAttribute}${groupAttribute}${compactAttribute}>`,
    bootstrap === undefined ? "" : `<script type="application/json" data-apb-bootstrap>${scriptJson(bootstrap)}</script>`,
    `<noscript><p class="apb-note">This panel needs JavaScript to show its values.</p></noscript>`,
    "</div>",
  ].join("");
}

export interface PageOptions {
  bootstrap: Bootstrap;
  theme: Theme;
  /** The CSP nonce for the one `<style>` and the one `<script>`. */
  nonce: string;
  /** The path the page's API calls go to: the listener's base path. */
  api: string;
}

/** The standalone page a listener serves at its base path. */
export function renderPage(options: PageOptions): string {
  const { bootstrap, theme, nonce, api } = options;
  const title = escapeHtml(bootstrap.schema.title + (bootstrap.schema.instance === undefined ? "" : ` · ${bootstrap.schema.instance}`));
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${title}</title>`,
    `<style nonce="${nonce}">body { margin: 0; }\n${panelStylesheet(theme)}</style>`,
    "</head>",
    "<body>",
    rootElement(bootstrap, theme, bootstrap.schema.theme.scheme, api, true),
    // The extras first, so the client finds them registered and draws at once without a second request.
    usesExtras(bootstrap.schema) ? `<script nonce="${nonce}">${CLIENT_EXTRAS}</script>` : "",
    `<script nonce="${nonce}">${CLIENT_SCRIPT}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

export interface HtmlOptions {
  /**
   * Where the panel's handler is mounted, as the page embedding the fragment reaches it:
   * `"/admin"`. The fragment loads its stylesheet and script from there and polls it, so the
   * host page's CSP needs nothing beyond `'self'`.
   */
  api?: string | undefined;
  /**
   * Render what the values are now, inline, with no handler behind it: nothing updates and
   * nothing can be changed. For a report, an email, a page generated at build time.
   */
  snapshot?: boolean | undefined;
  /** A nonce for the inline `<style>` and `<script>` a snapshot carries, when the host page's CSP needs one. */
  nonce?: string | undefined;
  /** A whole document rather than a fragment. */
  document?: boolean | undefined;
  /**
   * `false` leaves the client script out, for a page embedding several fragments: put
   * `clientScript(api)` on the page once instead, and it mounts every fragment. Default `true`.
   */
  script?: boolean | undefined;
  /** Show one group only, by title or id: a card of one panel in a page about something else. */
  group?: string | undefined;
  /** Without the panel's heading, status line and activity: only the groups. */
  compact?: boolean | undefined;
}

/**
 * The one script tag that mounts every fragment on a page, for fragments rendered with
 * `script: false`. With `api`, loaded from the mounted handler; without, inline, with the nonce.
 */
export function clientScript(options: { api?: string | undefined; nonce?: string | undefined; extras?: boolean | undefined } = {}): string {
  if (options.api !== undefined) return `<script src="${escapeHtml(options.api.replace(/\/+$/, ""))}/client.js" defer></script>`;
  const nonce = options.nonce === undefined ? "" : ` nonce="${escapeHtml(options.nonce)}"`;
  // Inline, nothing can be fetched later, so the chart and table code comes along unless told otherwise.
  return `${options.extras === false ? "" : `<script${nonce}>${CLIENT_EXTRAS}</script>`}<script${nonce}>${CLIENT_SCRIPT}</script>`;
}

/**
 * The fragment `panel.html()` returns.
 *
 * With `api`, the fragment carries no data at all: it loads the stylesheet and the script from
 * the mounted handler and asks that handler for the schema and state. The handler's own scope
 * then decides what is shown and what may be changed, so an embedded fragment can never show a
 * group, or offer a control, that its handler withholds.
 */
export function renderFragment(
  snapshot: Bootstrap | undefined,
  theme: Theme,
  options: { api: string | undefined; scheme: "auto" | "light" | "dark"; title: string; nonce: string | undefined; document: boolean; script?: boolean; group?: string | undefined; compact?: boolean },
): string {
  const nonce = options.nonce === undefined ? "" : ` nonce="${escapeHtml(options.nonce)}"`;
  const only = { group: options.group, compact: options.compact };
  const script = options.script !== false;
  let body: string;
  if (options.api !== undefined) {
    const api = options.api.replace(/\/+$/, "");
    body = [`<link rel="stylesheet" href="${escapeHtml(api)}/panel.css">`, rootElement(undefined, theme, options.scheme, api, options.document, only), script ? clientScript({ api }) : ""].filter((part) => part !== "").join("\n");
  } else {
    const extras = snapshot === undefined || usesExtras(snapshot.schema);
    body = [`<style${nonce}>${panelStylesheet(theme)}</style>`, rootElement(snapshot, theme, options.scheme, undefined, options.document, only), script ? clientScript({ nonce: options.nonce, extras }) : ""].filter((part) => part !== "").join("\n");
  }
  if (!options.document) return body;
  return ["<!doctype html>", '<html lang="en">', "<head>", '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">', `<title>${escapeHtml(options.title)}</title>`, `<style${nonce}>body { margin: 0; }</style>`, "</head>", "<body>", body, "</body>", "</html>"].join("\n");
}
