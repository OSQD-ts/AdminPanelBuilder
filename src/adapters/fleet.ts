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
import { type RefusalKey, refusalBody } from "../i18n/refuse.js";
import { escapeHtml } from "../render/html.js";
import { panelClient } from "../sdk.js";
import { createAuthenticator } from "../server/auth.js";
import type { PanelAuth } from "../server/types.js";
import { themeStylesheet } from "../themes/define.js";
import { resolveTheme } from "../themes/index.js";
import type { Theme } from "../themes/types.js";
import type { JsonValue } from "../types.js";
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
  /** Reload the page every so many seconds, without a script. Default: never; at least 5. */
  refreshSeconds?: number | undefined;
  /** Compare every reachable panel's settings and list those that differ. Default true. */
  drift?: boolean | undefined;
  fetch?: typeof fetch | undefined;
  /** For tests. */
  now?: (() => number) | undefined;
}

/** A setting whose value is not the same on every reachable panel. */
export interface FleetDrift {
  id: string;
  /** Each panel's value by panel name; a panel that does not have the setting is absent. */
  values: Record<string, JsonValue>;
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
  /** When it last started answering, or stopped: what this page has seen since it started. */
  since?: number | undefined;
}

export interface Fleet {
  /** Asks every panel now, in parallel. Never rejects: an unreachable panel is an entry that says so. */
  status(): Promise<FleetEntry[]>;
  /** The panels' state and the settings that differ between them. */
  survey(): Promise<{ panels: FleetEntry[]; drift: FleetDrift[] }>;
  /** Node middleware serving the page at its root and the entries as JSON at `/api/fleet`. */
  handler(): (request: NodeLikeRequest, response: NodeLikeResponse) => void;
  /** The same, as `(Request) => Promise<Response>`. */
  fetchHandler(): (request: Request) => Promise<Response>;
}

/** Panels one fleet page may list: each is a request per page view. */
export const MAX_FLEET_PANELS = 100;

const SECURITY_HEADERS: Record<string, string> = { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer" };

export function createFleet(options: FleetOptions): Fleet {
  rejectUnknown(options, ["panels", "auth", "title", "theme", "timeoutMs", "refreshSeconds", "drift", "fetch", "now"], "createFleet()");
  if (options.refreshSeconds !== undefined && (!Number.isInteger(options.refreshSeconds) || options.refreshSeconds < 5)) throw new AdminPanelConfigError("createFleet(): refreshSeconds is a whole number of seconds, at least 5");
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
  const now = options.now ?? (() => Date.now());
  /** Whether each panel answered last time, and since when: the page's memory. */
  const seen = new Map<string, { reachable: boolean; since: number }>();

  const ask = async (withSettings: boolean): Promise<Array<{ entry: FleetEntry; settings: Record<string, JsonValue> | undefined }>> =>
    Promise.all(
      options.panels.map(async (panel) => {
        const entry: FleetEntry = { name: panel.name, link: panel.link ?? panel.url, reachable: false };
        const client = panelClient({ url: panel.url, token: panel.token, timeoutMs, fetch: options.fetch });
        const started = Date.now();
        let settings: Record<string, JsonValue> | undefined;
        try {
          const [schema, notices, read] = await Promise.all([client.schema(), client.notices(), withSettings ? client.settings().catch(() => undefined) : Promise.resolve(undefined)]);
          settings = read;
          Object.assign(entry, { reachable: true, title: schema.title, instance: schema.instance, version: schema.version, warnings: notices.filter((notice) => notice.level === "warning").length, tookMs: Date.now() - started });
        } catch (error) {
          entry.problem = error instanceof Error ? error.message : String(error);
        }
        const before = seen.get(panel.name);
        const since = before !== undefined && before.reachable === entry.reachable ? before.since : now();
        seen.set(panel.name, { reachable: entry.reachable, since });
        // A first sight is not a change: say "since" only once the page has seen it before.
        if (before !== undefined) entry.since = since;
        return { entry, settings };
      }),
    );
  const status = async (): Promise<FleetEntry[]> => (await ask(false)).map(({ entry }) => entry);
  const survey = async (): Promise<{ panels: FleetEntry[]; drift: FleetDrift[] }> => {
    const answers = await ask(options.drift !== false);
    return { panels: answers.map(({ entry }) => entry), drift: driftOf(answers.filter(({ settings }) => settings !== undefined).map(({ entry, settings }) => [entry.name, settings as Record<string, JsonValue>] as const)) };
  };

  /** Refused the way every panel route refuses: the sentence, the kind, and the key that translates it. */
  const refuse = (status: number, key: RefusalKey, params: Record<string, string | number> = {}): { status: number; headers: Record<string, string>; body: string } => ({
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(refusalBody(status, key, params)),
  });

  /** Answers one request, whatever the front end. */
  const answer = async (method: string, path: string, headers: Record<string, string | undefined>, address: string): Promise<{ status: number; headers: Record<string, string>; body: string }> => {
    const result = await authenticator.authenticate({ method, path, headers, address });
    if (!result.ok) {
      const refused = refuse(401, "refuseSignIn");
      if (result.challenge !== undefined) refused.headers = { ...refused.headers, "www-authenticate": result.challenge };
      return refused;
    }
    if (method !== "GET" && method !== "HEAD") {
      const refused = refuse(405, "refuseMethod", { method });
      refused.headers = { ...refused.headers, allow: "GET" };
      return refused;
    }
    const { panels: entries, drift } = await survey();
    if (path === "/api/fleet") return { status: 200, headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ panels: entries, drift }) };
    // Everything else under the mount is the page: a handler mounted under a prefix it is not told
    // cannot tell that prefix from a path within it, so both front ends ask for the page by name.
    const nonce = btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(18))));
    return {
      status: 200,
      headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` },
      body: renderFleet(title, theme, entries, drift, nonce, options.refreshSeconds, now()),
    };
  };

  return {
    status,
    survey,
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

/** Settings whose value is not the same everywhere they exist, in a stable order. */
function driftOf(panels: ReadonlyArray<readonly [string, Record<string, JsonValue>]>): FleetDrift[] {
  if (panels.length < 2) return [];
  const ids = [...new Set(panels.flatMap(([, settings]) => Object.keys(settings)))].sort();
  const drift: FleetDrift[] = [];
  for (const id of ids) {
    const values: Record<string, JsonValue> = {};
    for (const [name, settings] of panels) if (Object.hasOwn(settings, id)) values[name] = settings[id] as JsonValue;
    const distinct = new Set(Object.values(values).map((value) => JSON.stringify(value)));
    // Missing on some panels counts too: a replica on an old deploy is what this is for.
    if (distinct.size > 1 || Object.keys(values).length < panels.length) drift.push({ id, values });
  }
  return drift;
}

/** Settings that differ, one row each, a column per panel. Absent when they all agree. */
function driftTable(entries: readonly FleetEntry[], drift: readonly FleetDrift[]): string {
  if (drift.length === 0) return "";
  const names = entries.filter((entry) => entry.reachable).map((entry) => entry.name);
  const head = names.map((name) => `<th scope="col">${escapeHtml(name)}</th>`).join("");
  const body = drift
    .map((line) => `<tr><th scope="row">${escapeHtml(line.id)}</th>${names.map((name) => `<td>${Object.hasOwn(line.values, name) ? escapeHtml(JSON.stringify(line.values[name])) : "<small>not set here</small>"}</td>`).join("")}</tr>`)
    .join("\n");
  return `<h2>Settings that differ</h2><p>${drift.length} setting${drift.length === 1 ? " is" : "s are"} not the same on every panel: a replica that refused a synced change, or one running another version.</p><div class="table"><table><thead><tr><th scope="col">Setting</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderFleet(title: string, theme: Theme, entries: readonly FleetEntry[], drift: readonly FleetDrift[], nonce: string, refreshSeconds: number | undefined, now: number): string {
  const down = entries.filter((entry) => !entry.reachable).length;
  const rows = entries
    .map((entry) => {
      const since = entry.since === undefined ? "" : ` <small>since ${escapeHtml(new Date(entry.since).toISOString())}${now - entry.since < 60_000 ? " (just changed)" : ""}</small>`;
      const state = entry.reachable ? `<span class="ok">Answering</span>${since}` : `<span class="bad">Not answering</span>${since}<br><small>${escapeHtml(entry.problem ?? "")}</small>`;
      const warnings = entry.warnings === undefined ? "" : entry.warnings === 0 ? "None" : `<span class="warn">${entry.warnings}</span>`;
      return `<tr><th scope="row"><a href="${escapeHtml(entry.link)}">${escapeHtml(entry.name)}</a></th><td>${state}</td><td>${escapeHtml(entry.title ?? "")}${entry.instance === undefined ? "" : ` · ${escapeHtml(entry.instance)}`}</td><td>${escapeHtml(entry.version ?? "")}</td><td>${warnings}</td><td>${entry.tookMs === undefined ? "" : `${entry.tookMs} ms`}</td></tr>`;
    })
    .join("\n");
  const css = `${themeStylesheet(theme)}
body { margin: 0; background: var(--apb-background); color: var(--apb-ink); font: var(--apb-font-size) var(--apb-font); }
main { max-width: 64rem; margin: 0 auto; padding: calc(var(--apb-spacing) * 3) 16px; }
h1 { font-size: 1.4em; margin: 0 0 var(--apb-spacing); }
h2 { font-size: 1.1em; margin: calc(var(--apb-spacing) * 3) 0 var(--apb-spacing); }
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
    // A scriptless page refreshes itself this way; the CSP allows no script to do it.
    refreshSeconds === undefined ? "" : `<meta http-equiv="refresh" content="${refreshSeconds}">`,
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
    driftTable(entries, drift),
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}
