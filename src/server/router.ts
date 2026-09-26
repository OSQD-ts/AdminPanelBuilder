/**
 * Every route of a listener, independent of the framework it is served through.
 *
 * `route(request)` takes a `PanelRequest` and returns a `PanelResponse`; the Node and Fetch
 * adapters only translate. So a request gets the same answer mounted in Express, on a port of
 * its own, or on a Worker — and the rules below are tested once, here, without a server.
 *
 * The checks before routing run in a fixed order: the auth throttle, the `Host` header (the
 * DNS-rebinding defence), the same-origin check for writes, then authentication. The first
 * three ask whether this request was addressed to this panel by something allowed to address
 * it, which credentials cannot settle. Authentication runs before routing, so an
 * unauthenticated caller gets the same refusal for every path and cannot map the API.
 *
 * Routes, under the base path:
 *
 *   GET  /                   the page
 *   GET  /panel.css          the stylesheet, for an embedded fragment
 *   GET  /client.js          the client, for an embedded fragment
 *   GET  /client-extras.js   its chart and table code, loaded only by panels that draw them
 *   GET  /api/schema         { schema }
 *   GET  /api/state          { state }    ?since=<version>&after=<ms>
 *   GET  /api/stream         the same state as server-sent events, resuming from Last-Event-ID
 *   GET  /api/changes        { changes }
 *   GET  /api/notices        { notices }
 *   GET  /api/settings       { settings }
 *   GET  /api/tables/:id     { table }    ?offset=&limit=&sort=&dir=&q=
 *   GET  /api/openapi.json   the OpenAPI document for all of this
 *   GET  /healthz            "ok" without authentication, only with `health: true`
 *   GET  /metrics            Prometheus exposition, behind the same auth, only with `metrics`
 *   GET  /api/messages/:code { messages }: the page's words in another language, for a viewer who chose it
 *   POST /api/values/:id     { value }    body { "value": …, "at"?, "revertAfterMs"? }   needs controls.edit
 *   POST /api/actions/:id    { result }   body { "input"? }            needs controls.actions
 *   POST /api/schedules/:id/cancel, /api/profiles/:id, /api/pending/:id/(approve|reject),
 *        /api/changes/:id/undo, /api/settings/apply                    need controls.edit
 *   POST /api/settings/diff  { diff, unknown }                         changes nothing
 *   POST /api/layout         { layout }   body { "layout": {…} | null } the layout for everybody; needs controls.edit
 *
 * A sign-in may carry grants that narrow the listener's scope for one operator; every route
 * below authentication uses that narrowed scope. Writes are limited per operator (`writeLimit`).
 *
 * Every JSON body is an object with one named key, and every failure is `{ error: "<sentence>" }`,
 * so a caller that parses one response can parse them all.
 */
import { CLIENT_EXTRAS, CLIENT_SCRIPT } from "../client.generated.js";
import type { ActionOutcome, AdminPanel, EditOutcome, PanelScope } from "../core.js";
import { type Grants, narrowScope } from "../panel/scope.js";
import { openApiDocument } from "./openapi.js";
import { ENGLISH, format, LOCALES } from "../i18n/messages.js";
import { type RefusalKey, refusal, REFUSAL_CODE } from "../i18n/refuse.js";
import { renderMetrics } from "../metrics.js";
import type { PanelSchema, Restriction } from "../types.js";
import { StreamHub } from "./stream.js";
import { AdminPanelConfigError } from "../errors.js";
import { type Clock, systemClock } from "../internal/clock.js";
import { rejectUnknown } from "../internal/options.js";
import { panelStylesheet, renderPage } from "../render/html.js";
import { AuthThrottle, createAuthenticator, SharedThrottle, type Throttle, TOKEN_COOKIE } from "./auth.js";
import { overTls } from "./session.js";
import { BodyTooLargeError, type PanelRequest, type PanelResponse, type ServeOptions } from "./types.js";

/** Largest request body read. An edit is one value; 64 KB is a long text field with room to spare. */
export const MAX_BODY_BYTES = 64 * 1024;

const SERVE_KEYS = ["basePath", "auth", "controls", "groups", "allowedHosts", "authThrottle", "clock", "stream", "metrics", "writeLimit", "health"];

/** Writes one operator may make a minute by default: an operator clicking fast, not a script gone wrong. */
export const DEFAULT_WRITES_PER_MINUTE = 60;
/** Operators whose write counts are kept at once; past it the one counted longest ago is forgotten. */
const MAX_WRITERS = 4096;

const STATUS_OF: Record<"not-found" | "not-editable" | "not-allowed" | "invalid" | "conflict" | "failed", number> = {
  "not-found": 404,
  "not-editable": 403,
  "not-allowed": 403,
  invalid: 400,
  conflict: 409,
  failed: 502,
};
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

/**
 * On every response, each for a reason: `no-store` because a cached panel is a cached copy of
 * the application's state; `nosniff`; `DENY` because a page that changes an application has no
 * business inside somebody else's frame; `no-referrer` because a token can be in the query.
 * There are no CORS headers, ever: another site must not read the panel through a logged-in
 * browser.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

export interface Router {
  route(request: PanelRequest): Promise<PanelResponse>;
  /** The base path, normalised: `""` for the root, otherwise `/prefix` without a trailing slash. */
  readonly basePath: string;
  scope(): PanelScope;
}

export interface RouterContext {
  /** The address a listener of its own is bound to; undefined when mounted on somebody else's server. */
  boundHost: string | undefined;
  /** Where the listener is, for error messages: "panel.listen()", "panel.handler()". */
  where: string;
}

export function createRouter(panel: AdminPanel, options: ServeOptions = {}, context: RouterContext): Router {
  rejectUnknown(options, SERVE_KEYS, context.where);
  rejectUnknown(options.controls, ["edit", "actions"], `${context.where}: controls`);
  const where = context.where;
  const basePath = normalizeBase(options.basePath ?? "/", where);
  const authenticator = createAuthenticator(options.auth, where);
  const edit = resolveControl(options.controls?.edit, "edit", where);
  const actions = resolveControl(options.controls?.actions, "actions", where);
  const anyEdit = edit !== false;
  const anyActions = actions !== false;
  if ((anyEdit || anyActions) && authenticator.kind === "none") {
    throw new AdminPanelConfigError(
      `${where}: controls.${anyEdit ? "edit" : "actions"} needs auth, even on loopback. A panel that can change the application without knowing who is asking lets anyone who reaches it do so, and cannot say afterwards who did`,
    );
  }
  if (context.boundHost !== undefined && !LOOPBACK.has(context.boundHost) && authenticator.kind === "none") {
    throw new AdminPanelConfigError(`${where}: listening on ${context.boundHost} without auth would show this application's state to anyone who can reach that address; pass auth, or listen on 127.0.0.1`);
  }
  const groups = options.groups === undefined ? undefined : checkGroups(options.groups, where);
  const allowedHosts = resolveHosts(options.allowedHosts, context.boundHost, where);
  const clock: Clock = options.clock ?? systemClock;
  const throttle = createThrottle(options.authThrottle, clock, where, (error) => panel.reportError(error, "the shared sign-in throttle"));
  const writes = createWriteLimit(options.writeLimit, clock, where);
  const streams = options.stream === false ? undefined : new StreamHub(panel, options.stream === true || options.stream === undefined ? {} : options.stream, where);
  const metrics = options.metrics === undefined || options.metrics === false ? undefined : { prefix: checkPrefix(options.metrics === true ? "admin_panel" : (options.metrics.prefix ?? "admin_panel"), where) };
  let warnedGroups = false;

  function scope(): PanelScope {
    const restrictions: Restriction[] = [];
    const counts = panel.counts();
    const named = (groups: ReadonlySet<string>): string => [...groups].map((name) => `"${name}"`).join(", ");
    if (!anyEdit && counts.editable > 0) restrictions.push(restriction("restrictionEditOff"));
    else if (edit instanceof Set) restrictions.push(restriction("restrictionEditGroups", { groups: named(edit) }));
    if (!anyActions && counts.actions > 0) restrictions.push(restriction("restrictionActionsOff"));
    else if (actions instanceof Set) restrictions.push(restriction("restrictionActionsGroups", { groups: named(actions) }));
    if (groups !== undefined && !warnedGroups) {
      const known = new Set(panel.groupNames());
      const unknown = [...groups].filter((name) => !known.has(name));
      if (unknown.length > 0) {
        warnedGroups = true;
        panel.notice("warning", `listener-groups-${unknown.join(",")}`, unknown.length === 1 ? "noticeListenerGroupOne" : "noticeListenerGroupMany", { where, names: unknown.map((name) => `"${name}"`).join(", ") });
      }
    }
    return { groups, edit, actions, restrictions };
  }

  async function route(request: PanelRequest): Promise<PanelResponse> {
    try {
      return await handle(request);
    } catch (error) {
      panel.reportError(error, `${where} answering ${request.method} ${request.url.split("?")[0]}`);
      return json(500, fail("refuseInternal"));
    }
  }

  async function handle(request: PanelRequest): Promise<PanelResponse> {
    const method = request.method.toUpperCase();
    const { path, query } = splitUrl(request.url, basePath);

    if (throttle !== undefined) {
      const wait = await throttle.retryAfter(request.address);
      if (wait > 0) return withHeaders(json(429, fail("refuseThrottled")), { "retry-after": String(wait) });
    }
    if (allowedHosts !== undefined) {
      const host = (request.headers.host ?? "").toLowerCase();
      if (!allowedHosts.has(host) && !allowedHosts.has(host.replace(/:\d+$/, ""))) return json(421, fail("refuseHost"));
    }
    // Health answers before authentication, and only the Host check above guards it: a load
    // balancer has no credentials, and what it is told is only whether the process answers.
    if (options.health === true && path === "/healthz" && (method === "GET" || method === "HEAD")) {
      const warnings = panel.notices().filter((notice) => notice.level === "warning").length;
      return { status: 200, headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" }, body: warnings === 0 ? "ok" : `ok, ${warnings} warning${warnings === 1 ? "" : "s"}` };
    }
    const unsafe = method !== "GET" && method !== "HEAD";
    if (unsafe && !sameOrigin(request)) return json(403, fail("refuseCrossSite"));

    // Exchanging `?token=` for a cookie happens before authentication, because it is how a
    // browser that cannot send a header authenticates at all.
    if (method === "GET" && path === "/" && query.has("token") && authenticator.kind === "token") {
      const name = await authenticator.isToken(query.get("token") ?? "");
      if (name === undefined) {
        await throttle?.fail(request.address);
        return json(401, fail("refuseBadToken"));
      }
      await throttle?.succeed(request.address);
      return {
        status: 303,
        headers: {
          ...SECURITY_HEADERS,
          location: `${basePath}/`,
          // `Secure` where the browser is on TLS: the cookie is a credential, and one sent back over
          // plain HTTP to the same host is a credential given away.
          "set-cookie": `${TOKEN_COOKIE}=${encodeURIComponent(query.get("token") ?? "")}; Path=${basePath || "/"}; HttpOnly; SameSite=Strict${overTls(request) ? "; Secure" : ""}`,
        },
        body: "",
      };
    }

    const result = await authenticator.authenticate({ method, path, headers: request.headers, address: request.address });
    if (authenticator.handle !== undefined && path.startsWith("/auth/")) {
      try {
        const answered = await authenticator.handle({ method, path, query, headers: request.headers, address: request.address, basePath, secure: overTls(request) }, result.ok ? result.actor : undefined);
        if (answered !== undefined) return { ...answered, headers: { ...SECURITY_HEADERS, ...answered.headers } };
      } catch (error) {
        panel.reportError(error, "signing in");
        return json(502, fail("refuseProviderDown"));
      }
    }
    if (!result.ok) {
      await throttle?.fail(request.address);
      if (result.redirect !== undefined && method === "GET" && path === "/") return { status: 302, headers: { ...SECURITY_HEADERS, location: `${basePath}/${result.redirect}`, ...(result.setCookie === undefined ? {} : { "set-cookie": result.setCookie }) }, body: "" };
      const response = json(401, fail("refuseSignIn"));
      return result.challenge === undefined ? response : withHeaders(response, { "www-authenticate": result.challenge });
    }
    await throttle?.succeed(request.address);
    const actor = result.actor;
    const grants = result.grants;
    /** This operator's scope: the listener's, narrowed by what their sign-in grants. */
    const mine = (): PanelScope => narrowed(scope(), grants);

    if (method === "GET" || method === "HEAD") {
      switch (path) {
        case "/":
          return page(mine());
        case "/panel.css":
          return { status: 200, headers: { ...SECURITY_HEADERS, "content-type": "text/css; charset=utf-8" }, body: panelStylesheet(panel.currentTheme(), panel.offeredThemes()) };
        case "/client.js":
          return { status: 200, headers: { ...SECURITY_HEADERS, "content-type": "text/javascript; charset=utf-8" }, body: CLIENT_SCRIPT };
        case "/client-extras.js":
          return { status: 200, headers: { ...SECURITY_HEADERS, "content-type": "text/javascript; charset=utf-8" }, body: CLIENT_EXTRAS };
        case "/api/schema":
          return json(200, { schema: schemaFor(mine()) });
        case "/api/settings":
          return json(200, { settings: panel.exportSettings(mine()) });
        case "/api/openapi.json":
          return json(200, openApiDocument(basePath, { health: options.health === true, metrics: metrics !== undefined }));
        case "/api/state":
        case "/api/stream": {
          // A reconnecting EventSource says where it got to in Last-Event-ID, which beats the query it first opened with.
          const resumed = path === "/api/stream" ? parseEventId(request.headers["last-event-id"]) : undefined;
          const since = resumed?.since ?? readCount(query.get("since"));
          const after = resumed?.after ?? readCount(query.get("after"));
          const feed = resumed?.feed ?? readCount(query.get("feed"));
          if (since === null || after === null || feed === null) return json(400, fail("refusePosition"));
          if (path === "/api/state") return json(200, { state: panel.state(mine(), since, after, feed) });
          if (streams === undefined) return json(404, fail("refuseNoStream"));
          if (streams.full) return withHeaders(json(503, fail("refuseTooManyViewers", { max: streams.limit })), { "retry-after": "30" });
          return withHeaders(streams.openStream(mine, since, after, feed, panel.schema(mine()).pollMs), { ...SECURITY_HEADERS, "cache-control": "no-store, no-transform" });
        }
        case "/api/changes":
          return json(200, { changes: panel.changes().filter((change) => visibleChange(change.target, mine())) });
        case "/api/notices":
          return json(200, { notices: panel.notices() });
        case "/metrics":
          if (metrics === undefined) return json(404, fail("refuseNothingAt", { path }));
          return { status: 200, headers: { ...SECURITY_HEADERS, "content-type": "text/plain; version=0.0.4; charset=utf-8" }, body: renderMetrics(panel, mine(), metrics.prefix) };
        default: {
          const table = /^\/api\/tables\/([^/]+)$/.exec(path);
          if (table !== null) return tablePage(decodeSegment(table[1] as string), query, mine());
          const language = /^\/api\/messages\/([a-z]{2,3})$/.exec(path);
          if (language !== null) {
            const messages = LOCALES[language[1] as string];
            return messages === undefined ? json(404, fail("refuseNothingAt", { path })) : json(200, { messages });
          }
          if (/^\/api\/(values|actions|profiles|pending|changes|tables|schedules|settings)\//.test(path)) return withHeaders(json(405, fail("refusePostOnly")), { allow: "POST" });
          return json(404, fail("refuseNothingAt", { path }));
        }
      }
    }

    if (method !== "POST") return withHeaders(json(405, fail("refuseMethod", { method })), { allow: "GET, POST" });
    const write = matchWrite(path);
    if (write === undefined) {
      if (path === "/" || path.startsWith("/api/")) return withHeaders(json(405, fail("refuseReadOnly")), { allow: "GET" });
      return json(404, fail("refuseNothingAt", { path }));
    }
    if (write.ids.some((id) => id === undefined)) return json(400, fail("refuseBadId"));
    const needs = write.kind === "action" || write.kind === "row-action" ? "actions" : write.kind === "diff" ? "nothing" : "edit";
    if (needs === "edit" && !anyEdit) return json(403, fail("refuseEditSwitchedOff", { edit: "{ edit: true }" }));
    if (needs === "actions" && !anyActions) return json(403, fail("refuseActionsSwitchedOff", { actions: "{ actions: true }" }));
    // An HTML form cannot send this content type, so a forged form fails here whatever
    // credentials the browser attaches to it.
    if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return json(415, fail("refuseJsonOnly"));
    let body: Record<string, unknown>;
    try {
      const text = await request.body(MAX_BODY_BYTES);
      const parsed: unknown = text === "" ? {} : JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return json(400, fail("refuseBodyObject"));
      body = parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof BodyTooLargeError) return json(413, fail("refuseBodyTooLarge", { kb: MAX_BODY_BYTES / 1024 }));
      return json(400, fail("refuseBodyJson"));
    }
    const [first, second] = write.ids as string[];
    const current = mine();
    if (needs !== "nothing") {
      const wait = writes?.take(actor);
      if (wait !== undefined && wait > 0) return withHeaders(json(429, fail("refuseTooManyChanges", { actor })), { "retry-after": String(wait) });
    }
    const reason = body.reason;
    if (reason !== undefined && typeof reason !== "string") return json(400, fail("refuseReasonText"));
    const repeat = body.repeat;
    if (repeat !== undefined && (repeat === null || typeof repeat !== "object" || Array.isArray(repeat))) return json(400, fail("refuseRepeatShape"));
    switch (write.kind) {
      case "value": {
        if (!Object.hasOwn(body, "value")) return json(400, fail("refuseNeedsValue", { shape: '{ "value": … }' }));
        const revert = body.revertAfterMs;
        if (revert !== undefined && typeof revert !== "number") return json(400, fail("refuseRevertNumber"));
        const at = readTime(body.at);
        if (at === null) return json(400, fail("refuseAtTime"));
        const refused = await panel.checkAsync([[first as string, body.value]]);
        if (refused !== undefined && visibleValue(first as string, current)) return json(400, fail("refuseApp", { message: refused }));
        return editAnswer(panel.edit(first as string, body.value, actor, current, { revertAfterMs: revert as number | undefined, at, reason, repeat: repeat as never }));
      }
      case "cancel":
        return editAnswer(panel.cancelScheduled(first as string, actor, current));
      case "profile": {
        const refused = await panel.checkAsync(panel.candidatesFor("profile", first as string));
        if (refused !== undefined) return json(400, fail("refuseApp", { message: refused }));
        const revert = body.revertAfterMs;
        if (revert !== undefined && typeof revert !== "number") return json(400, fail("refuseRevertNumber"));
        const at = readTime(body.at);
        if (at === null) return json(400, fail("refuseAtTime"));
        return editAnswer(panel.applyProfile(first as string, actor, current, { revertAfterMs: revert as number | undefined, at, reason, repeat: repeat as never }));
      }
      case "approve": {
        const refused = await panel.checkAsync(panel.candidatesFor("pending", first as string));
        if (refused !== undefined) return json(400, fail("refuseApp", { message: refused }));
        return decisionAnswer(await panel.approve(first as string, actor, current));
      }
      case "reject":
        return editAnswer(await panel.reject(first as string, actor, current, { reason }));
      case "undo": {
        const changeId = Number(first);
        if (!Number.isInteger(changeId)) return json(400, fail("refuseChangeId"));
        const refused = await panel.checkAsync(panel.candidatesFor("undo", String(changeId)));
        if (refused !== undefined) return json(400, fail("refuseApp", { message: refused }));
        return editAnswer(panel.undo(changeId, actor, current, { reason }));
      }
      case "diff":
        return json(200, panel.diffSettings(body.settings, current));
      case "import": {
        const settings = body.settings;
        if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return json(400, fail("refuseNeedsSettings", { shape: '{ "settings": { id: value, … } }' }));
        const refused = await panel.checkAsync(Object.entries(settings as Record<string, unknown>));
        if (refused !== undefined) return json(400, fail("refuseNotImported", { reason: refused }));
        const outcome = panel.importSettings(settings, actor, current, { reason });
        return outcome.ok ? json(200, { changed: outcome.changed ?? 0 }) : editAnswer(outcome);
      }
      case "layout": {
        if (!("layout" in body)) return json(400, fail("refuseNeedsLayout", { shape: '{ "layout": { "<group id>": { "order": ["value:<id>", …], "sizes": { "value:<id>": { "w": 3, "h": 2 } } } } }' }));
        const outcome = panel.saveLayout(body.layout, actor, current, { reason });
        if (!outcome.ok) return json(STATUS_OF[outcome.reason], { error: outcome.message, code: outcome.reason, ...(outcome.refusal === undefined ? {} : { key: outcome.refusal.key, params: outcome.refusal.params }) });
        return json(200, { layout: panel.schema(current).layout ?? null });
      }
      case "action":
        return actionAnswer(await panel.run(first as string, actor, current, body.input, { reason }));
      case "row-action": {
        if (typeof body.row !== "string") return json(400, fail("refuseNeedsRow", { shape: '{ "row": "<id>" }' }));
        return actionAnswer(await panel.runRowAction(first as string, second as string, body.row, actor, current));
      }
    }
  }

  function editAnswer(outcome: EditOutcome): PanelResponse {
    if (outcome.ok) return "pending" in outcome ? json(202, { pending: outcome.pending }) : json(200, { value: outcome.value });
    return json(STATUS_OF[outcome.reason], { error: outcome.message, code: outcome.reason, ...(outcome.refusal === undefined ? {} : { key: outcome.refusal.key, params: outcome.refusal.params }) });
  }

  function actionAnswer(outcome: ActionOutcome): PanelResponse {
    if (outcome.ok) return "pending" in outcome ? json(202, { pending: outcome.pending }) : json(200, { result: { message: outcome.message } });
    return json(STATUS_OF[outcome.reason], { error: outcome.message, code: outcome.reason, ...(outcome.refusal === undefined ? {} : { key: outcome.refusal.key, params: outcome.refusal.params }) });
  }

  /** An approval's answer: a value's or a profile's change, or an action's run. */
  function decisionAnswer(outcome: EditOutcome | ActionOutcome): PanelResponse {
    return outcome.ok && "message" in outcome ? actionAnswer(outcome) : editAnswer(outcome as EditOutcome);
  }

  async function tablePage(id: string | undefined, query: URLSearchParams, current: PanelScope): Promise<PanelResponse> {
    if (id === undefined) return json(400, fail("refuseBadId"));
    const offset = readCount(query.get("offset"));
    const limit = readCount(query.get("limit"));
    const direction = query.get("dir");
    if (offset === null || limit === null || (direction !== null && direction !== "asc" && direction !== "desc")) return json(400, fail("refuseTableQuery"));
    try {
      const answer = await panel.tableRows(id, { offset, limit, sort: query.get("sort") ?? undefined, direction: direction ?? "asc", search: query.get("q") ?? "" }, current);
      if (answer === undefined) return json(404, fail("refuseNoTable", { id }));
      return json(200, { table: answer });
    } catch (error) {
      panel.reportError(error, `the table "${id}"`);
      return json(502, fail("refuseTableFailed", { detail: error instanceof Error ? error.message : String(error) }));
    }
  }

  function schemaFor(current: PanelScope): PanelSchema {
    const schema = panel.schema(current);
    if (streams !== undefined) schema.stream = true;
    return schema;
  }

  function visibleChange(target: string, current: PanelScope): boolean {
    if (current.groups === undefined) return true;
    const value = panel.get(target);
    if (value !== undefined) return current.groups.has(value.group);
    const id = target.split("/")[0];
    return panel.schema(current).groups.some((group) => group.items.some((item) => item.type !== "value" && item.type !== "chart" && item.id === id));
  }

  /** Whether a value exists in this scope: a refusal from its async check must not reveal a value the caller cannot see. */
  function visibleValue(id: string, current: PanelScope): boolean {
    const value = panel.get(id);
    return value !== undefined && (current.groups === undefined || current.groups.has(value.group));
  }

  function page(current: PanelScope): PanelResponse {
    const nonce = createNonce();
    const body = renderPage({ bootstrap: { schema: schemaFor(current), state: panel.state(current) }, theme: panel.currentTheme(), themes: panel.offeredThemes(), nonce, api: basePath });
    // Built from `default-src 'none'`: everything the page may do is listed, and nothing else.
    // `connect-src 'self'` for the polling; no fonts, images or frames from anywhere.
    const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
    return { status: 200, headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": csp }, body };
  }

  return { route, basePath, scope };
}

/** The keys `restriction()` may be given: the page's words about a listener's limits. */
type RefusalOrNote = "restrictionEditOff" | "restrictionEditGroups" | "restrictionActionsOff" | "restrictionActionsGroups" | "restrictionGrants";

type WriteKind = "value" | "cancel" | "profile" | "approve" | "reject" | "undo" | "action" | "row-action" | "diff" | "import" | "layout";

/** The write paths, and the ids in them, decoded. */
function matchWrite(path: string): { kind: WriteKind; ids: Array<string | undefined> } | undefined {
  const patterns: Array<[RegExp, WriteKind]> = [
    [/^\/api\/values\/([^/]+)$/, "value"],
    [/^\/api\/actions\/([^/]+)$/, "action"],
    [/^\/api\/profiles\/([^/]+)$/, "profile"],
    [/^\/api\/pending\/([^/]+)\/approve$/, "approve"],
    [/^\/api\/pending\/([^/]+)\/reject$/, "reject"],
    [/^\/api\/changes\/([^/]+)\/undo$/, "undo"],
    [/^\/api\/tables\/([^/]+)\/actions\/([^/]+)$/, "row-action"],
    [/^\/api\/schedules\/([^/]+)\/cancel$/, "cancel"],
    [/^\/api\/settings\/diff$/, "diff"],
    [/^\/api\/settings\/apply$/, "import"],
    [/^\/api\/layout$/, "layout"],
  ];
  for (const [pattern, kind] of patterns) {
    const match = pattern.exec(path);
    if (match !== null) return { kind, ids: match.slice(1).map((segment) => decodeSegment(segment as string)) };
  }
  return undefined;
}

function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function resolveControl(value: boolean | readonly string[] | undefined, name: string, where: string): boolean | ReadonlySet<string> {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  if (!Array.isArray(value) || value.length === 0 || value.some((group) => typeof group !== "string" || group === "")) {
    throw new AdminPanelConfigError(`${where}: controls.${name} is true, false, or a non-empty list of group names`);
  }
  return new Set(value);
}

function checkPrefix(prefix: string, where: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(prefix)) throw new AdminPanelConfigError(`${where}: the metrics prefix ${JSON.stringify(prefix)} is not a Prometheus name`);
  return prefix;
}

/** A sentence about what this listener does not allow: the English, and the key a page says it with. */
function restriction(key: RefusalOrNote, params: Record<string, string | number> = {}): Restriction {
  const made: Restriction = { text: format(ENGLISH[key], params), key };
  if (Object.keys(params).length > 0) made.params = params;
  return made;
}

/** A refusal body: the English sentence, and the key and parameters a page translates it with. */
function fail(key: RefusalKey, params: Record<string, string | number> = {}): { error: string; key: string; params: Record<string, string | number> } {
  const made = refusal(key, params);
  return { error: made.message, key, params };
}

function json(status: number, body: object): PanelResponse {
  if ("error" in body && !("code" in body)) body = { ...body, code: REFUSAL_CODE[status] ?? "failed" };
  return { status, headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" }, body: JSON.stringify(body) };
}

function withHeaders(response: PanelResponse, headers: Record<string, string>): PanelResponse {
  return { ...response, headers: { ...response.headers, ...headers } };
}

/**
 * The path relative to the base, accepting it with or without the base: a surrounding router
 * (Express's `app.use("/admin", …)`) may already have stripped the prefix.
 */
function splitUrl(url: string, basePath: string): { path: string; query: URLSearchParams } {
  const index = url.indexOf("?");
  let path = index === -1 ? url : url.slice(0, index);
  const query = new URLSearchParams(index === -1 ? "" : url.slice(index + 1));
  if (basePath !== "" && (path === basePath || path.startsWith(`${basePath}/`))) path = path.slice(basePath.length);
  if (path === "") path = "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { path, query };
}

function normalizeBase(base: string, where: string): string {
  if (typeof base !== "string" || !base.startsWith("/") || /[?#\s]/.test(base) || base.split("/").includes("..")) {
    throw new AdminPanelConfigError(`${where}: basePath must be a path starting with "/", without a query, a fragment or ".." (got ${JSON.stringify(base)})`);
  }
  return base.replace(/\/+$/, "");
}

function checkGroups(names: readonly string[], where: string): ReadonlySet<string> {
  if (!Array.isArray(names) || names.length === 0) throw new AdminPanelConfigError(`${where}: groups is empty, which would show nothing; leave it out to show every group`);
  for (const name of names) if (typeof name !== "string" || name === "") throw new AdminPanelConfigError(`${where}: every entry in groups must be a group name`);
  return new Set(names);
}

function resolveHosts(configured: readonly string[] | undefined, bound: string | undefined, where: string): ReadonlySet<string> | undefined {
  if (configured !== undefined) {
    for (const host of configured) if (typeof host !== "string" || host.trim() === "" || /[\s/]/.test(host)) throw new AdminPanelConfigError(`${where}: ${JSON.stringify(host)} in allowedHosts is not a host name`);
  }
  const hosts = new Set((configured ?? []).map((host) => host.toLowerCase()));
  // A loopback listener answers to its loopback names and nothing else unless told: a page on
  // an attacker's domain that rebinds to 127.0.0.1 arrives with the attacker's Host header.
  if (bound !== undefined && LOOPBACK.has(bound)) for (const host of LOOPBACK) hosts.add(host);
  return hosts.size === 0 ? undefined : hosts;
}

function createThrottle(options: ServeOptions["authThrottle"], clock: Clock, where: string, onError: (error: unknown) => void): Throttle | undefined {
  if (options === false) return undefined;
  rejectUnknown(options, ["failures", "windowMs", "store"], `${where}: authThrottle`);
  const failures = options?.failures ?? 10;
  const windowMs = options?.windowMs ?? 60_000;
  if (!Number.isInteger(failures) || failures < 1) throw new AdminPanelConfigError(`${where}: authThrottle.failures must be a whole number above zero`);
  if (!Number.isFinite(windowMs) || windowMs < 1000) throw new AdminPanelConfigError(`${where}: authThrottle.windowMs must be at least 1000`);
  if (options?.store !== undefined) return new SharedThrottle(failures, windowMs, options.store, onError);
  return new AuthThrottle(failures, windowMs, clock);
}

/** Writes per operator per minute, counted in fixed one-minute windows. */
function createWriteLimit(options: ServeOptions["writeLimit"], clock: Clock, where: string): { take(actor: string): number } | undefined {
  if (options === false) return undefined;
  rejectUnknown(options, ["perMinute"], `${where}: writeLimit`);
  const perMinute = options?.perMinute ?? DEFAULT_WRITES_PER_MINUTE;
  if (!Number.isInteger(perMinute) || perMinute < 1) throw new AdminPanelConfigError(`${where}: writeLimit.perMinute must be a whole number above zero`);
  const counts = new Map<string, { since: number; count: number }>();
  return {
    take(actor) {
      const now = clock.now();
      let entry = counts.get(actor);
      if (entry === undefined || now - entry.since >= 60_000) {
        counts.delete(actor);
        entry = { since: now, count: 0 };
        counts.set(actor, entry);
        if (counts.size > MAX_WRITERS) {
          const oldest = counts.keys().next().value;
          if (oldest !== undefined) counts.delete(oldest);
        }
      }
      entry.count += 1;
      return entry.count > perMinute ? Math.ceil((60_000 - (now - entry.since)) / 1000) : 0;
    },
  };
}

/** The listener's scope narrowed for one operator, saying so on the page. */
function narrowed(scope: PanelScope, grants: Grants | undefined): PanelScope {
  if (grants === undefined) return scope;
  const out = narrowScope(scope, grants);
  return { ...out, restrictions: [...out.restrictions, restriction("restrictionGrants")] };
}

/** `v.a.f`: the version, sample time and feed sequence a stream frame brought the page to. */
function parseEventId(raw: string | undefined): { since: number; after: number; feed: number } | undefined {
  const match = raw === undefined ? null : /^(\d{1,16})\.(\d{1,16})\.(\d{1,16})$/.exec(raw.trim());
  if (match === null) return undefined;
  return { since: Number(match[1]), after: Number(match[2]), feed: Number(match[3]) };
}

/** A time from a body: milliseconds since 1970, or an ISO 8601 string. Undefined when absent, null when unreadable. */
function readTime(raw: unknown): number | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const at = Date.parse(raw);
    return Number.isNaN(at) ? null : at;
  }
  return null;
}

/**
 * A browser names the page a write came from in `Origin` (and `Sec-Fetch-Site`). A client that
 * is not a browser sends neither, and is judged by its credentials alone.
 */
function sameOrigin(request: PanelRequest): boolean {
  const site = request.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  if (origin === "null") return false;
  try {
    return new URL(origin).host.toLowerCase() === (request.headers.host ?? "").toLowerCase();
  } catch {
    return false;
  }
}

function readCount(raw: string | null): number | undefined | null {
  if (raw === null || raw === "") return undefined;
  if (!/^\d{1,16}$/.test(raw)) return null;
  return Number(raw);
}

function createNonce(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
