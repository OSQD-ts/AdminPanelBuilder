/**
 * The HTTP API described as OpenAPI 3.1, served at `/api/openapi.json`.
 *
 * Written by hand beside the router rather than generated from it, and kept honest by
 * `tests/openapi.test.ts`, which sends a request to every path listed here and checks every route
 * the router answers is listed. The shapes are JSON Schemas of the types in `src/types.ts` as far as
 * a caller needs them: every field the page reads, with `additionalProperties` left open so a field
 * added in a minor version is not a breaking change.
 */
import { VERSION } from "../version.js";

const error = { $ref: "#/components/schemas/Error" };
const json = (schema: object) => ({ "application/json": { schema } });
const answer = (description: string, schema: object) => ({ description, content: json(schema) });
const failures = {
  "400": answer("The request was malformed or the value refused", error),
  "401": answer("Not signed in", error),
  "403": answer("Not allowed on this listener, or for this operator", error),
  "404": answer("No such item", error),
  "409": answer("The change conflicts with the current state", error),
  "429": answer("Too many writes from this operator, or failed sign-ins from this address", error),
};
const idParameter = (name: string, description: string) => ({ name, in: "path", required: true, description, schema: { type: "string" } });
const count = (name: string, description: string) => ({ name, in: "query", required: false, description, schema: { type: "integer", minimum: 0 } });
const write = (summary: string, body: object | undefined, ok: Record<string, object>, parameters: object[] = []) => ({
  post: {
    summary,
    parameters,
    ...(body === undefined ? {} : { requestBody: { required: true, content: json(body) } }),
    responses: { ...ok, ...failures },
  },
});
const read = (summary: string, ok: object, parameters: object[] = []) => ({ get: { summary, parameters, responses: { "200": ok, "401": failures["401"] } } });
/** A route that answers text rather than JSON. `open` is for one that answers before authentication. */
const text = (summary: string, description: string, open = false) => ({
  get: { summary, parameters: [], ...(open ? { security: [] } : {}), responses: { "200": { description, content: { "text/plain": { schema: { type: "string" } } } }, ...(open ? {} : { "401": failures["401"] }) } },
});

/** What a listener offers besides the API: routes it only answers when they are switched on. */
export interface OpenApiOffers {
  /** `health: true` on the listener. */
  health?: boolean | undefined;
  /** `metrics` on the listener. */
  metrics?: boolean | undefined;
}

/** The document. A function so each listener gets its own copy with its own base path and routes. */
export function openApiDocument(basePath: string, offers: OpenApiOffers = {}): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "admin-panel-builder listener",
      version: VERSION,
      description: "Every JSON body is an object with one named key; every failure is { error: <sentence>, code, key?, params? }. Writes need `content-type: application/json` and come from the panel's own origin, or from a client that sends no Origin.",
    },
    servers: [{ url: basePath === "" ? "/" : basePath }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" }, basic: { type: "http", scheme: "basic" }, cookie: { type: "apiKey", in: "cookie", name: "apb_session" } },
      schemas: {
        Error: {
          type: "object",
          required: ["error", "code"],
          properties: {
            error: { type: "string", description: "The refusal in English" },
            code: { enum: ["invalid", "unauthenticated", "not-allowed", "not-found", "not-editable", "method", "conflict", "too-large", "media-type", "wrong-host", "rate-limited", "internal", "failed", "busy"] },
            key: { type: "string", description: "The page's message key for the refusal, to say it in another language" },
            params: { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }] } },
          },
        },
        RepeatRule: { type: "object", required: ["every", "at", "timeZone"], properties: { every: { enum: ["day", "week"] }, at: { type: "string" }, weekday: { type: "integer", minimum: 0 }, timeZone: { type: "string" } } },
        Json: {},
        WireValue: {
          type: "object",
          required: ["id", "value", "at", "version"],
          properties: {
            id: { type: "string" },
            value: {},
            text: { type: "string" },
            textKey: { type: "string" },
            textParams: { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }] } },
            at: { type: "number" },
            version: { type: "integer" },
            by: { type: "string" },
            masked: { type: "boolean" },
            error: { type: "string" },
            errorKey: { type: "string", description: "The page's message key for `error`, for saying it in another language" },
            errorParams: { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }] } },
            status: { enum: ["ok", "warn", "bad"] },
            revertAt: { type: "number" },
            revertTo: {},
            hidden: { type: "boolean" },
            disabled: { type: "string" },
            scheduled: { type: "array", items: { $ref: "#/components/schemas/ScheduledChange" } },
            recent: { type: "array", items: { type: "object", required: ["at", "value"], properties: { at: { type: "number" }, value: {}, by: { type: "string" } } } },
          },
        },
        ScheduledChange: { type: "object", required: ["id", "at", "by"], properties: { id: { type: "string" }, at: { type: "number" }, by: { type: "string" }, to: {}, reason: { type: "string" }, repeat: { $ref: "#/components/schemas/RepeatRule" }, revertAfterMs: { type: "number" } } },
        PendingChange: { type: "object", required: ["id", "target", "label", "by", "at", "expiresAt"], properties: { id: { type: "string" }, kind: { enum: ["value", "action", "profile"] }, target: { type: "string" }, label: { type: "string" }, by: { type: "string" }, at: { type: "number" }, expiresAt: { type: "number" }, to: {}, reason: { type: "string" }, applyAt: { type: "number" } } },
        ChangeRecord: {
          type: "object",
          required: ["id", "kind", "target", "label", "by", "at", "ok"],
          properties: {
            id: { type: "integer" },
            kind: { enum: ["edit", "action", "profile", "approval", "revert", "scheduled", "import", "layout"] },
            target: { type: "string" },
            label: { type: "string" },
            by: { type: "string" },
            at: { type: "number" },
            ok: { type: "boolean" },
            from: {},
            to: {},
            outcome: { type: "string" },
            revertible: { type: "boolean" },
            origin: { type: "string" },
            reason: { type: "string" },
            hash: { type: "string" },
            prevHash: { type: "string" },
          },
        },
        Notice: {
          type: "object",
          required: ["id", "level", "message", "at"],
          properties: {
            id: { type: "string" },
            level: { enum: ["info", "warning"] },
            message: { type: "string" },
            key: { type: "string", description: "The page's message key for `message`, present when the panel wrote the notice about its own machinery" },
            params: { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "number" }] } },
            at: { type: "number" },
          },
        },
        CardSize: { type: "object", required: ["w", "h"], properties: { w: { type: "integer", minimum: 1 }, h: { type: "integer", minimum: 1 } } },
        Grid: { type: "object", required: ["columns", "rowHeight"], properties: { columns: { type: "integer", minimum: 1 }, rowHeight: { type: "number" } } },
        Layout: { type: "object", additionalProperties: { type: "object", properties: { order: { type: "array", items: { type: "string" } }, sizes: { type: "object", additionalProperties: { $ref: "#/components/schemas/CardSize" } } } } },
        Schema: {
          type: "object",
          required: ["title", "version", "structure", "theme", "grid", "pollMs", "controls", "restrictions", "groups", "locale"],
          properties: {
            title: { type: "string" },
            instance: { type: "string" },
            version: { type: "string" },
            structure: { type: "integer" },
            theme: { type: "object", properties: { name: { type: "string" }, scheme: { enum: ["auto", "light", "dark"] }, offered: { type: "array", items: { type: "object", required: ["name", "label"], properties: { name: { type: "string" }, label: { type: "string" } } } } } },
            grid: { $ref: "#/components/schemas/Grid" },
            layout: { $ref: "#/components/schemas/Layout" },
            layoutWritable: { type: "boolean" },
            pollMs: { type: "integer" },
            controls: { type: "object", properties: { edit: { type: "boolean" }, actions: { type: "boolean" } } },
            restrictions: { type: "array", items: { type: "object", required: ["text", "key"], properties: { text: { type: "string" }, key: { type: "string" }, params: { type: "object" } } } },
            groups: { type: "array", items: { type: "object", required: ["id", "title", "items"], properties: { id: { type: "string" }, title: { type: "string" }, layout: { enum: ["grid", "list"] }, grid: { $ref: "#/components/schemas/Grid" }, items: { type: "array", items: { type: "object", required: ["type", "id"], properties: { type: { enum: ["value", "chart", "action", "table", "feed", "profile"] }, id: { type: "string" }, size: { $ref: "#/components/schemas/CardSize" } } } } } } },
            locale: { type: "string" },
            locales: { type: "array", items: { type: "string" } },
            translations: { type: "object", additionalProperties: { type: "string" } },
            stream: { type: "boolean" },
          },
        },
        State: {
          type: "object",
          required: ["version", "structure", "now", "values", "series", "feeds", "feedSeq", "pending", "activeProfiles", "marks", "actionStates"],
          properties: {
            version: { type: "integer" },
            structure: { type: "integer" },
            now: { type: "number" },
            values: { type: "array", items: { $ref: "#/components/schemas/WireValue" } },
            series: { type: "object", additionalProperties: { type: "array" } },
            feeds: { type: "object" },
            feedSeq: { type: "integer" },
            pending: { type: "array", items: { $ref: "#/components/schemas/PendingChange" } },
            activeProfiles: { type: "array", items: { type: "string" } },
            marks: { type: "object" },
            actionStates: { type: "object", additionalProperties: { type: "object", properties: { hidden: { type: "boolean" }, disabled: { type: "string" } } } },
            profileSchedules: { type: "object", additionalProperties: { type: "array", items: { $ref: "#/components/schemas/ScheduledChange" } } },
          },
        },
        SettingDiff: { type: "object", required: ["id", "label", "from", "to"], properties: { id: { type: "string" }, label: { type: "string" }, from: {}, to: {}, error: { type: "string" }, errorKey: { type: "string" }, errorParams: { type: "object" } } },
      },
    },
    security: [{ bearer: [] }, { basic: [] }, { cookie: [] }],
    paths: {
      ...(offers.health === true ? { "/healthz": text("Whether the process answers, and how many warning notices it holds", 'Either "ok" or "ok, 2 warnings"', true) } : {}),
      ...(offers.metrics === true ? { "/metrics": text("The panel's numbers in Prometheus exposition format", "The exposition, behind the same authentication as the API") } : {}),
      "/api/schema": read("What the panel shows this caller", answer("The schema", { type: "object", required: ["schema"], properties: { schema: { $ref: "#/components/schemas/Schema" } } })),
      "/api/state": read("The values now, or what changed since a version", answer("The state", { type: "object", required: ["state"], properties: { state: { $ref: "#/components/schemas/State" } } }), [
        count("since", "Only values changed after this version"),
        count("after", "Only samples in or after the bucket holding this time"),
        count("feed", "Only feed entries after this sequence"),
      ]),
      "/api/stream": read("Server-sent `state` frames; resumes from `Last-Event-ID`", { description: "An event stream", content: { "text/event-stream": { schema: { type: "string" } } } }, [count("since", "As /api/state"), count("after", "As /api/state"), count("feed", "As /api/state")]),
      "/api/changes": read("Recent changes, oldest first", answer("The changes", { type: "object", required: ["changes"], properties: { changes: { type: "array", items: { $ref: "#/components/schemas/ChangeRecord" } } } })),
      "/api/notices": read("Current notices", answer("The notices", { type: "object", required: ["notices"], properties: { notices: { type: "array", items: { $ref: "#/components/schemas/Notice" } } } })),
      "/api/settings": read("Every modifiable value this caller sees, by id; sensitive values left out", answer("The settings", { type: "object", required: ["settings"], properties: { settings: { type: "object", additionalProperties: {} } } })),
      "/api/openapi.json": read("This document", answer("OpenAPI 3.1", { type: "object" })),
      "/api/messages/{locale}": read("The page's words in a shipped language", answer("The messages", { type: "object", required: ["messages"], properties: { messages: { type: "object", additionalProperties: { type: "string" } } } }), [idParameter("locale", "A language code: en, pl, de")]),
      "/api/tables/{id}": read("A page of a table", answer("The page", { type: "object", required: ["table"], properties: { table: { type: "object" } } }), [
        idParameter("id", "The table"),
        count("offset", "Rows to skip"),
        count("limit", "Rows to return"),
        { name: "sort", in: "query", schema: { type: "string" } },
        { name: "dir", in: "query", schema: { enum: ["asc", "desc"] } },
        { name: "q", in: "query", schema: { type: "string" } },
      ]),
      "/api/values/{id}": write(
        "Change a value; with revertAfterMs it reverts, with at it waits for that time, with repeat it runs by that rule",
        { type: "object", required: ["value"], properties: { value: {}, revertAfterMs: { type: "number" }, at: { oneOf: [{ type: "number" }, { type: "string", format: "date-time" }] }, repeat: { $ref: "#/components/schemas/RepeatRule" }, reason: { type: "string" } } },
        { "200": answer("Applied, or scheduled", { type: "object", required: ["value"], properties: { value: { $ref: "#/components/schemas/WireValue" } } }), "202": answer("Waiting for approval", { type: "object", required: ["pending"], properties: { pending: { $ref: "#/components/schemas/PendingChange" } } }) },
        [idParameter("id", "The value")],
      ),
      "/api/schedules/{id}/cancel": write("Cancel a scheduled change", undefined, { "200": answer("Cancelled", { type: "object", properties: { value: { $ref: "#/components/schemas/WireValue" } } }) }, [idParameter("id", "The scheduled change")]),
      "/api/actions/{id}": write("Run an action, or propose it when it needs approval", { type: "object", properties: { input: { type: "object" }, reason: { type: "string" } } }, { "200": answer("It finished", { type: "object", required: ["result"], properties: { result: { type: "object", properties: { message: { type: "string" } } } } }), "202": answer("Waiting for approval", { type: "object", required: ["pending"], properties: { pending: { $ref: "#/components/schemas/PendingChange" } } }) }, [idParameter("id", "The action")]),
      "/api/profiles/{id}": write(
        "Apply a profile, whole or not at all: now, for a while, at a time or by a rule",
        { type: "object", properties: { revertAfterMs: { type: "number" }, at: { oneOf: [{ type: "number" }, { type: "string", format: "date-time" }] }, repeat: { $ref: "#/components/schemas/RepeatRule" }, reason: { type: "string" } } },
        { "200": answer("Applied, or scheduled", { type: "object", properties: { value: { $ref: "#/components/schemas/WireValue" } } }), "202": answer("Waiting for approval", { type: "object", required: ["pending"], properties: { pending: { $ref: "#/components/schemas/PendingChange" } } }) },
        [idParameter("id", "The profile")],
      ),
      "/api/pending/{id}/approve": write("Approve somebody else's proposal: a change is applied, an action run", undefined, { "200": answer("Applied, or run", { type: "object", properties: { value: { $ref: "#/components/schemas/WireValue" }, result: { type: "object", properties: { message: { type: "string" } } } } }) }, [idParameter("id", "The proposal")]),
      "/api/pending/{id}/reject": write("Turn a proposal down", { type: "object", properties: { reason: { type: "string" } } }, { "200": answer("Turned down", { type: "object", properties: { value: { $ref: "#/components/schemas/WireValue" } } }) }, [idParameter("id", "The proposal")]),
      "/api/changes/{id}/undo": write("Write back what a change replaced", undefined, { "200": answer("Undone", { type: "object", properties: { value: { $ref: "#/components/schemas/WireValue" } } }) }, [idParameter("id", "The change")]),
      "/api/tables/{table}/actions/{action}": write("Run a row action", { type: "object", required: ["row"], properties: { row: { type: "string" } } }, { "200": answer("It finished", { type: "object", properties: { result: { type: "object" } } }) }, [idParameter("table", "The table"), idParameter("action", "The row action")]),
      "/api/settings/diff": write("What importing these settings would change; changes nothing", { type: "object", required: ["settings"], properties: { settings: { type: "object" } } }, { "200": answer("The difference", { type: "object", required: ["diff", "unknown"], properties: { diff: { type: "array", items: { $ref: "#/components/schemas/SettingDiff" } }, unknown: { type: "array", items: { type: "string" } } } }) }),
      "/api/settings/apply": write("Import settings, whole or not at all", { type: "object", required: ["settings"], properties: { settings: { type: "object" } } }, { "200": answer("Imported", { type: "object", required: ["changed"], properties: { changed: { type: "integer" } } }) }),
      "/api/layout": write(
        "Save the layout every viewer gets, or null to go back to the one in code; groups the caller may not edit keep theirs",
        { type: "object", required: ["layout"], properties: { layout: { oneOf: [{ $ref: "#/components/schemas/Layout" }, { type: "null" }] }, reason: { type: "string" } } },
        { "200": answer("Saved; the layout as this caller now sees it", { type: "object", required: ["layout"], properties: { layout: { oneOf: [{ $ref: "#/components/schemas/Layout" }, { type: "null" }] } } }) },
      ),
    },
  };
}
