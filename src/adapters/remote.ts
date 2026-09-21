/**
 * A panel for another process: serve, here, the panel a worker or another replica runs there.
 *
 *   app.use("/workers/mailer", remotePanelHandler({
 *     upstream: "http://10.0.0.7:9780",          // where the worker's panel listens
 *     token: process.env.MAILER_PANEL_TOKEN!,     // a delegate token on the worker
 *     basePath: "/workers/mailer",
 *     auth: { check: (request) => session(request) },
 *     controls: { edit: true },
 *   }));
 *
 * The page is rendered here, from the upstream's schema and state; every API call is forwarded
 * with the upstream token, which stays on this server and never reaches a browser. This listener's
 * own `auth` and `controls` apply first, so it can only narrow what the upstream allows. The
 * operator's name travels in `x-apb-on-behalf-of`, which the upstream believes only from a token it
 * lists in `auth.delegates`, and records as "ada via gateway".
 *
 * One remote panel shows one process. The header says which, and nothing is aggregated.
 *
 * `groups` narrows it further: the upstream's schema, state, stream, changes and settings are
 * filtered here to the named groups before anything reaches the browser, and a write to anything
 * outside them is refused here without being forwarded. The upstream's stream is forwarded frame by
 * frame, filtered the same way, so a remote page is as live as a local one.
 */
import { CLIENT_EXTRAS, CLIENT_SCRIPT } from "../client.generated.js";
import { AdminPanelConfigError } from "../errors.js";
import { withDeadline } from "../internal/async.js";
import { rejectUnknown } from "../internal/options.js";
import { escapeHtml, scriptJson, usesExtras } from "../render/html.js";
import { createAuthenticator, ON_BEHALF_HEADER } from "../server/auth.js";
import type { PanelAuth, PanelControls } from "../server/types.js";
import type { ChangeRecord, PanelSchema, PanelState } from "../types.js";
import type { NodeLikeRequest, NodeLikeResponse } from "./node.js";

export interface RemotePanelOptions {
  /** The upstream panel's URL, base path included. */
  upstream: string;
  /** A token the upstream accepts. Held here; never sent to a browser. */
  token: string;
  basePath?: string | undefined;
  auth: PanelAuth;
  /** At most what the upstream allows; default nothing. */
  controls?: PanelControls | undefined;
  /** Show only these of the upstream's groups, by title. Default: every group the upstream shows. */
  groups?: readonly string[] | undefined;
  /** Forward the upstream's live stream. Default true; the page polls when the upstream offers none. */
  stream?: boolean | undefined;
  /** Default 10 seconds. */
  timeoutMs?: number | undefined;
  fetch?: typeof fetch | undefined;
}

/** What one filtered schema lets through: the ids of everything in the named groups. */
interface Allowed {
  ids: Set<string>;
  histories: Set<string>;
}

const SECURITY_HEADERS: Record<string, string> = { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer" };
const FORWARDED = /^\/(api\/(schema|state|changes|notices|settings|openapi\.json|tables\/[^/]+)|panel\.css)$/;
const WRITES = /^\/api\/(values|actions|profiles|pending|changes|tables|schedules|settings)\//;

export function remotePanelHandler(options: RemotePanelOptions): (request: NodeLikeRequest, response: NodeLikeResponse) => void {
  rejectUnknown(options, ["upstream", "token", "basePath", "auth", "controls", "groups", "stream", "timeoutMs", "fetch"], "remotePanelHandler()");
  if (options.groups !== undefined && (!Array.isArray(options.groups) || options.groups.length === 0)) throw new AdminPanelConfigError("remotePanelHandler(): groups is empty, which would show nothing; leave it out to show every group");
  const groups = options.groups === undefined ? undefined : new Set(options.groups);
  const streaming = options.stream !== false;
  if (typeof options.upstream !== "string" || !/^https?:\/\//.test(options.upstream)) throw new AdminPanelConfigError("remotePanelHandler(): upstream must be the upstream panel's URL");
  if (options.auth === undefined) throw new AdminPanelConfigError("remotePanelHandler(): auth is required: this handler holds a token for another process's panel");
  const authenticator = createAuthenticator(options.auth, "remotePanelHandler()");
  const upstream = options.upstream.replace(/\/+$/, "");
  const base = (options.basePath ?? "/").replace(/\/+$/, "");
  const edit = options.controls?.edit === true || Array.isArray(options.controls?.edit);
  const actions = options.controls?.actions === true || Array.isArray(options.controls?.actions);
  const send = options.fetch ?? fetch;
  const timeout = options.timeoutMs ?? 10_000;

  const call = (path: string, actor: string, init: RequestInit = {}): Promise<Response> =>
    withDeadline(send(`${upstream}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${options.token}`, [ON_BEHALF_HEADER]: actor } }), timeout, "the upstream panel");

  const answer = (response: NodeLikeResponse, status: number, headers: Record<string, string>, body: string): void => {
    response.statusCode = status;
    for (const [name, value] of Object.entries({ ...SECURITY_HEADERS, ...headers })) response.setHeader(name, value);
    response.end(body);
  };
  const error = (response: NodeLikeResponse, status: number, message: string): void => answer(response, status, { "content-type": "application/json; charset=utf-8" }, JSON.stringify({ error: message }));

  /** The upstream's schema as this listener shows it: its groups, its controls, its stream. */
  const localSchema = (schema: PanelSchema): PanelSchema => {
    const { stream, ...rest } = schema;
    const local: PanelSchema = { ...rest, controls: { edit: schema.controls.edit && edit, actions: schema.controls.actions && actions } };
    if (groups !== undefined) local.groups = schema.groups.filter((group) => groups.has(group.title));
    if (stream === true && streaming) local.stream = true;
    return local;
  };
  const allowedBy = (schema: PanelSchema): Allowed => {
    const allowed: Allowed = { ids: new Set(), histories: new Set() };
    for (const group of localSchema(schema).groups) {
      for (const item of group.items) {
        allowed.ids.add(item.id);
        if (item.type === "chart") for (const series of item.series) if (series.history !== undefined) allowed.histories.add(series.history);
      }
    }
    return allowed;
  };
  const allowedFor = async (actor: string): Promise<Allowed | undefined> => {
    if (groups === undefined) return undefined;
    const reply = await call("/api/schema", actor);
    if (!reply.ok) throw new Error(`the upstream panel answered ${reply.status}`);
    return allowedBy(((await reply.json()) as { schema: PanelSchema }).schema);
  };
  const filterState = (state: PanelState, allowed: Allowed | undefined): PanelState => {
    if (allowed === undefined) return state;
    const pick = <T>(record: Record<string, T>, keep: (key: string) => boolean): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([key]) => keep(key)));
    return {
      ...state,
      values: state.values.filter((value) => allowed.ids.has(value.id)),
      series: pick(state.series, (key) => allowed.histories.has(key)),
      feeds: pick(state.feeds, (key) => allowed.ids.has(key)),
      pending: state.pending.filter((change) => allowed.ids.has(change.target)),
      activeProfiles: state.activeProfiles.filter((id) => allowed.ids.has(id)),
      marks: pick(state.marks, (key) => allowed.ids.has(key)),
      actionStates: pick(state.actionStates ?? {}, (key) => allowed.ids.has(key)),
    };
  };
  /** Whether a write's target is inside the named groups; pending changes, undo and cancel are looked up. */
  const writeAllowed = async (path: string, body: string, actor: string, allowed: Allowed): Promise<boolean> => {
    const direct = /^\/api\/(values|actions|profiles|tables)\/([^/]+)/.exec(path);
    if (direct !== null) return allowed.ids.has(decodeURIComponent(direct[2] as string));
    if (path === "/api/settings/diff" || path === "/api/settings/apply") {
      const settings = (JSON.parse(body || "{}") as { settings?: Record<string, unknown> }).settings ?? {};
      return Object.keys(settings).every((id) => allowed.ids.has(id));
    }
    const pending = /^\/api\/pending\/([^/]+)\//.exec(path);
    const schedule = /^\/api\/schedules\/([^/]+)\//.exec(path);
    if (pending !== null || schedule !== null) {
      const state = ((await (await call("/api/state", actor)).json()) as { state: PanelState }).state;
      if (pending !== null) return state.pending.some((change) => change.id === decodeURIComponent(pending[1] as string) && allowed.ids.has(change.target));
      return state.values.some((value) => allowed.ids.has(value.id) && (value.scheduled ?? []).some((entry) => entry.id === decodeURIComponent((schedule as RegExpExecArray)[1] as string)));
    }
    const undo = /^\/api\/changes\/([^/]+)\/undo$/.exec(path);
    if (undo !== null) {
      const changes = ((await (await call("/api/changes", actor)).json()) as { changes: ChangeRecord[] }).changes;
      return changes.some((change) => String(change.id) === undo[1] && allowed.ids.has(change.target));
    }
    return false;
  };

  /** Forwards the upstream's event stream, filtering each state frame. */
  const forwardStream = async (response: NodeLikeResponse, path: string, actor: string, headers: Record<string, string | undefined>): Promise<void> => {
    if (response.write === undefined) return error(response, 404, "this server cannot stream; poll /api/state instead");
    const allowed = await allowedFor(actor);
    const controller = new AbortController();
    const upstreamHeaders: Record<string, string> = { accept: "text/event-stream", authorization: `Bearer ${options.token}`, [ON_BEHALF_HEADER]: actor };
    if (headers["last-event-id"] !== undefined) upstreamHeaders["last-event-id"] = headers["last-event-id"];
    const reply = await withDeadline(send(`${upstream}${path}`, { headers: upstreamHeaders, signal: controller.signal }), timeout, "the upstream panel");
    if (!reply.ok || reply.body === null) return answer(response, reply.status, { "content-type": "application/json; charset=utf-8" }, await reply.text());
    response.statusCode = 200;
    for (const [name, value] of Object.entries({ ...SECURITY_HEADERS, "cache-control": "no-store, no-transform", "content-type": "text/event-stream; charset=utf-8", "x-accel-buffering": "no" })) response.setHeader(name, value);
    response.flushHeaders?.();
    response.on?.("close", () => controller.abort());
    const reader = reply.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let end = buffered.indexOf("\n\n");
        while (end !== -1) {
          const event = buffered.slice(0, end);
          buffered = buffered.slice(end + 2);
          response.write(`${filterEvent(event, (state) => filterState(state, allowed))}\n\n`);
          end = buffered.indexOf("\n\n");
        }
      }
    } catch {
      // The browser went away, or the upstream did; either way this stream is over.
    } finally {
      controller.abort();
      response.end();
    }
  };

  return (request, response) => {
    void (async () => {
      const url = request.originalUrl ?? request.url ?? "/";
      const [rawPath, search = ""] = url.split("?") as [string, string?];
      let path = base !== "" && rawPath.startsWith(base) ? rawPath.slice(base.length) : rawPath;
      if (path === "") path = "/";
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(request.headers)) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
      const result = await authenticator.authenticate({ method: request.method ?? "GET", path, headers, address: request.socket?.remoteAddress ?? "" });
      if (!result.ok) return error(response, 401, "sign in to see this panel");
      const method = (request.method ?? "GET").toUpperCase();
      if (method === "GET" && (path === "/" || path === "")) {
        const [schemaResponse, stateResponse] = await Promise.all([call("/api/schema", result.actor), call("/api/state", result.actor)]);
        if (!schemaResponse.ok || !stateResponse.ok) return error(response, 502, `the upstream panel answered ${schemaResponse.status}`);
        const schema = ((await schemaResponse.json()) as { schema: PanelSchema }).schema;
        const local = localSchema(schema);
        const state = filterState(((await stateResponse.json()) as { state: PanelState }).state, groups === undefined ? undefined : allowedBy(schema));
        const css = await (await call("/panel.css", result.actor)).text();
        const nonce = btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(18))));
        const body = `<!doctype html>\n<html lang="${escapeHtml(local.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(local.title)}</title><style nonce="${nonce}">body { margin: 0; }\n${css.replace(/<\//g, "<\\/")}</style></head><body><div class="apb-root apb-standalone" data-apb-root data-api="${escapeHtml(base)}"><script type="application/json" data-apb-bootstrap>${scriptJson({ schema: local, state })}</script></div>${usesExtras(local) ? `<script nonce="${nonce}">${CLIENT_EXTRAS}</script>` : ""}<script nonce="${nonce}">${CLIENT_SCRIPT}</script></body></html>`;
        return answer(response, 200, { "content-type": "text/html; charset=utf-8", "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` }, body);
      }
      if (method === "GET" && path === "/client.js") return answer(response, 200, { "content-type": "text/javascript; charset=utf-8" }, CLIENT_SCRIPT);
      if (method === "GET" && path === "/client-extras.js") return answer(response, 200, { "content-type": "text/javascript; charset=utf-8" }, CLIENT_EXTRAS);
      if (method === "GET" && path === "/api/stream") {
        if (!streaming) return error(response, 404, "this listener does not stream; poll /api/state instead");
        return forwardStream(response, `${path}${search === "" ? "" : `?${search}`}`, result.actor, headers);
      }
      if (method === "GET" && FORWARDED.test(path)) {
        const allowed = await allowedFor(result.actor);
        const table = /^\/api\/tables\/([^/]+)$/.exec(path);
        if (allowed !== undefined && table !== null && !allowed.ids.has(decodeURIComponent(table[1] as string))) return error(response, 404, `there is nothing at ${path}`);
        const upstreamResponse = await call(`${path}${search === "" ? "" : `?${search}`}`, result.actor);
        let text = await upstreamResponse.text();
        if (upstreamResponse.ok && path.startsWith("/api/")) {
          const body = JSON.parse(text) as Record<string, unknown>;
          if (path === "/api/schema") text = JSON.stringify({ schema: localSchema(body.schema as PanelSchema) });
          else if (allowed !== undefined && path === "/api/state") text = JSON.stringify({ state: filterState(body.state as PanelState, allowed) });
          else if (allowed !== undefined && path === "/api/changes") text = JSON.stringify({ changes: (body.changes as ChangeRecord[]).filter((change) => allowed.ids.has(change.target.split("/")[0] as string)) });
          else if (allowed !== undefined && path === "/api/settings") text = JSON.stringify({ settings: Object.fromEntries(Object.entries(body.settings as Record<string, unknown>).filter(([id]) => allowed.ids.has(id))) });
        }
        return answer(response, upstreamResponse.status, { "content-type": upstreamResponse.headers.get("content-type") ?? "application/json; charset=utf-8" }, text);
      }
      if (method === "POST" && WRITES.test(path)) {
        const needsActions = /^\/api\/(actions|tables)\//.test(path);
        const needsNothing = path === "/api/settings/diff";
        if (!needsNothing && (needsActions ? !actions : !edit)) return error(response, 403, `${needsActions ? "actions are" : "editing is"} switched off on this listener`);
        if (headers.origin !== undefined && new URL(headers.origin).host !== headers.host) return error(response, 403, "a write must come from the panel's own page");
        if (!(headers["content-type"] ?? "").startsWith("application/json")) return error(response, 415, "a write must be sent as application/json");
        const body = await readBody(request);
        const allowed = await allowedFor(result.actor);
        if (allowed !== undefined && !(await writeAllowed(path, body, result.actor, allowed).catch(() => false))) return error(response, 404, "there is no such item on this panel");
        const upstreamResponse = await call(path, result.actor, { method: "POST", headers: { "content-type": "application/json" }, body });
        return answer(response, upstreamResponse.status, { "content-type": "application/json; charset=utf-8" }, await upstreamResponse.text());
      }
      return error(response, 404, `there is nothing at ${path}`);
    })().catch((problem: unknown) => {
      try {
        if (response.headersSent !== true) error(response, 502, `the upstream panel could not be reached: ${problem instanceof Error ? problem.message : String(problem)}`);
      } catch {
        // The connection is gone.
      }
    });
  };
}

/** One server-sent event with its state frame, if it has one, filtered. Other events pass as they came. */
function filterEvent(event: string, filter: (state: PanelState) => PanelState): string {
  const lines = event.split("\n");
  if (!lines.includes("event: state")) return event;
  const data = lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
  try {
    const state = filter(JSON.parse(data) as PanelState);
    return [...lines.filter((line) => !line.startsWith("data: ")), `data: ${JSON.stringify(state)}`].join("\n");
  } catch {
    return ": a frame the upstream sent could not be read";
  }
}

function readBody(request: NodeLikeRequest): Promise<string> {
  if (request.body !== undefined) return Promise.resolve(typeof request.body === "string" ? request.body : JSON.stringify(request.body));
  return new Promise((resolve, reject) => {
    let text = "";
    request.on("data", (chunk) => {
      text += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      if (text.length > 64 * 1024) reject(new Error("the body is too large"));
    });
    request.on("end", () => resolve(text));
    request.on("error", reject);
  });
}
