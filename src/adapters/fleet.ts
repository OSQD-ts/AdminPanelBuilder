/**
 * One page listing every replica's panel: whether each answers, what it calls itself, and how many
 * warnings it has, with a link to each.
 *
 *   app.use("/fleet", fleetHandler({
 *     panels: [{ name: "web-1", url: "http://10.0.0.5:9780", token: process.env.PANEL_TOKEN }],
 *     auth: { check: (request) => session(request) },
 *   }));
 *
 * It aggregates nothing but reachability: each panel stays the truth about its own process, and the
 * page only says where to look. Rendered on the server, with no script at all — an operator reaching
 * for it during an outage should not also depend on a client bundle — and behind its own `auth`,
 * because it holds a token for every panel it lists. Tokens stay here; the links take the operator
 * to each panel, which asks them to sign in on its own terms.
 */
import { AdminPanelConfigError } from "../errors.js";
import { rejectUnknown } from "../internal/options.js";
import { escapeHtml } from "../render/html.js";
import { panelClient } from "../sdk.js";
import { createAuthenticator } from "../server/auth.js";
import type { PanelAuth } from "../server/types.js";
import { themeStylesheet } from "../themes/define.js";
import { resolveTheme } from "../themes/index.js";
import type { Theme } from "../themes/types.js";
import type { NodeLikeRequest, NodeLikeResponse } from "./node.js";

export interface FleetPanel {
  /** How the page names it: a hostname, a replica. */
  name: string;
  /** The panel's URL, base path included. Also the link the page offers. */
  url: string;
  /** A token that panel accepts, for reading its schema and notices. */
  token?: string | undefined;
  /** Where the page links to, when operators reach the panel at another address than this server does. */
  link?: string | undefined;
}

export interface FleetOptions {
  panels: readonly FleetPanel[];
  auth: PanelAuth;
  /** Default "Fleet". */
  title?: string | undefined;
  theme?: Theme | string | undefined;
  /** How long one panel may take to answer before it is shown as unreachable. Default 3 seconds. */
  timeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
}

/** What the page shows of one panel. */
export interface FleetEntry {
  name: string;
  link: string;
  reachable: boolean;
  /** Why it is not, in a sentence. */
  problem?: string | undefined;
  title?: string | undefined;
  instance?: string | undefined;
  version?: string | undefined;
  warnings?: number | undefined;
  /** How long it took to answer, in milliseconds. */
  tookMs?: number | undefined;
}

export interface Fleet {
  /** Asks every panel now, in parallel. Never rejects: an unreachable panel is an entry that says so. */
  status(): Promise<FleetEntry[]>;
  /** Node middleware serving the page at its root and the entries as JSON at `/api/fleet`. */
  handler(): (request: NodeLikeRequest, response: NodeLikeResponse) => void;
  /** The same, as `(Request) => Promise<Response>`. */
  fetchHandler(): (request: Request) => Promise<Response>;
}

/** Panels one fleet page may list: each is a request per page view. */
export const MAX_FLEET_PANELS = 100;

const SECURITY_HEADERS: Record<string, string> = { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer" };

export function createFleet(options: FleetOptions): Fleet {
  rejectUnknown(options, ["panels", "auth", "title", "theme", "timeoutMs", "fetch"], "createFleet()");
  if (options.auth === undefined) throw new AdminPanelConfigError("createFleet(): auth is required: the page holds a token for every panel it lists");
  if (!Array.isArray(options.panels) || options.panels.length === 0) throw new AdminPanelConfigError("createFleet(): panels is empty, which would list nothing");
  if (options.panels.length > MAX_FLEET_PANELS) throw new AdminPanelConfigError(`createFleet(): ${options.panels.length} panels is more than ${MAX_FLEET_PANELS}; each is asked on every page view`);
  const names = new Set<string>();
  for (const panel of options.panels) {
    rejectUnknown(panel, ["name", "url", "token", "link"], "createFleet(): a panel");
    if (typeof panel.name !== "string" || panel.name === "") throw new AdminPanelConfigError("createFleet(): every panel needs a name");
    if (names.has(panel.name)) throw new AdminPanelConfigError(`createFleet(): two panels are named "${panel.name}"`);
    names.add(panel.name);
    if (typeof panel.url !== "string" || !/^https?:\/\//.test(panel.url)) throw new AdminPanelConfigError(`createFleet(): the URL of "${panel.name}" must start with http:// or https://`);
  }
  const authenticator = createAuthenticator(options.auth, "createFleet()");
  const theme = resolveTheme(options.theme);
  const title = options.title ?? "Fleet";
  const timeoutMs = options.timeoutMs ?? 3000;

  const status = (): Promise<FleetEntry[]> =>
    Promise.all(
      options.panels.map(async (panel): Promise<FleetEntry> => {
        const entry: FleetEntry = { name: panel.name, link: panel.link ?? panel.url, reachable: false };
        const client = panelClient({ url: panel.url, token: panel.token, timeoutMs, fetch: options.fetch });
        const started = Date.now();
        try {
          const [schema, notices] = await Promise.all([client.schema(), client.notices()]);
          Object.assign(entry, { reachable: true, title: schema.title, instance: schema.instance, version: schema.version, warnings: notices.filter((notice) => notice.level === "warning").length, tookMs: Date.now() - started });
        } catch (error) {
          entry.problem = error instanceof Error ? error.message : String(error);
        }
        return entry;
      }),
    );

  /** Answers one request, whatever the front end. */
  const answer = async (method: string, path: string, headers: Record<string, string | undefined>, address: string): Promise<{ status: number; headers: Record<string, string>; body: string }> => {
    const result = await authenticator.authenticate({ method, path, headers, address });
    if (!result.ok) {
      const refused: { status: number; headers: Record<string, string>; body: string } = { status: 401, headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ error: "sign in to see this page" }) };
      if (result.challenge !== undefined) refused.headers = { ...refused.headers, "www-authenticate": result.challenge };
      return refused;
    }
    if (method !== "GET" && method !== "HEAD") return { status: 405, headers: { ...SECURITY_HEADERS, allow: "GET" }, body: "" };
    const entries = await status();
    if (path === "/api/fleet") return { status: 200, headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ panels: entries }) };
    if (path !== "/" && path !== "") return { status: 404, headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ error: `there is nothing at ${path}` }) };
    const nonce = btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(18))));
    return {
      status: 200,
      headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` },
      body: renderFleet(title, theme, entries, nonce),
    };
  };

  return {
    status,
    handler: () => (request, response) => {
      const path = ((request.originalUrl ?? request.url ?? "/").split("?")[0] as string).replace(/\/+$/, "");
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(request.headers)) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
      void answer((request.method ?? "GET").toUpperCase(), path.endsWith("/api/fleet") ? "/api/fleet" : "/", headers, request.socket?.remoteAddress ?? "").then((reply) => {
        response.statusCode = reply.status;
        for (const [name, value] of Object.entries(reply.headers)) response.setHeader(name, value);
        response.end(reply.body);
      });
    },
    fetchHandler: () => async (request) => {
      const headers: Record<string, string | undefined> = {};
      request.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      const path = new URL(request.url).pathname;
      const reply = await answer(request.method.toUpperCase(), path.endsWith("/api/fleet") ? "/api/fleet" : "/", headers, "");
      return new Response(reply.body, { status: reply.status, headers: reply.headers });
    },
  };
}

/** Shorthand for `createFleet(options).handler()`. */
export function fleetHandler(options: FleetOptions): (request: NodeLikeRequest, response: NodeLikeResponse) => void {
  return createFleet(options).handler();
}

function renderFleet(title: string, theme: Theme, entries: readonly FleetEntry[], nonce: string): string {
  const down = entries.filter((entry) => !entry.reachable).length;
  const rows = entries
    .map((entry) => {
      const state = entry.reachable ? `<span class="ok">Answering</span>` : `<span class="bad">Not answering</span><br><small>${escapeHtml(entry.problem ?? "")}</small>`;
      const warnings = entry.warnings === undefined ? "" : entry.warnings === 0 ? "None" : `<span class="warn">${entry.warnings}</span>`;
      return `<tr><th scope="row"><a href="${escapeHtml(entry.link)}">${escapeHtml(entry.name)}</a></th><td>${state}</td><td>${escapeHtml(entry.title ?? "")}${entry.instance === undefined ? "" : ` · ${escapeHtml(entry.instance)}`}</td><td>${escapeHtml(entry.version ?? "")}</td><td>${warnings}</td><td>${entry.tookMs === undefined ? "" : `${entry.tookMs} ms`}</td></tr>`;
    })
    .join("\n");
  const css = `${themeStylesheet(theme)}
body { margin: 0; background: var(--apb-background); color: var(--apb-ink); font: var(--apb-font-size) var(--apb-font); }
main { max-width: 64rem; margin: 0 auto; padding: calc(var(--apb-spacing) * 3) 16px; }
h1 { font-size: 1.4em; margin: 0 0 var(--apb-spacing); }
p { color: var(--apb-ink-secondary); margin: 0 0 calc(var(--apb-spacing) * 2); }
.table { overflow-x: auto; background: var(--apb-surface); border: 1px solid var(--apb-border); border-radius: var(--apb-radius); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: var(--apb-spacing) calc(var(--apb-spacing) * 2); border-bottom: 1px solid var(--apb-border); vertical-align: top; }
thead th { color: var(--apb-ink-secondary); font-weight: var(--apb-strong-weight); }
a { color: var(--apb-link); }
a:focus-visible { outline: 2px solid var(--apb-focus); outline-offset: 2px; }
small { color: var(--apb-ink-secondary); }
.ok { color: var(--apb-ok); } .bad { color: var(--apb-bad); font-weight: var(--apb-strong-weight); } .warn { color: var(--apb-warn); font-weight: var(--apb-strong-weight); }`;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(title)}</title>`,
    `<style nonce="${nonce}">${css}</style>`,
    "</head>",
    // The theme's tokens are scoped to `.apb-root`, so the body is one.
    '<body class="apb-root">',
    "<main>",
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${entries.length} panel${entries.length === 1 ? "" : "s"}${down === 0 ? ", all answering" : `, ${down} not answering`}. Checked ${new Date().toISOString()}; reload to check again.</p>`,
    `<div class="table"><table><thead><tr><th scope="col">Panel</th><th scope="col">State</th><th scope="col">Title</th><th scope="col">Version</th><th scope="col">Warnings</th><th scope="col">Answered in</th></tr></thead><tbody>`,
    rows,
    "</tbody></table></div>",
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}
