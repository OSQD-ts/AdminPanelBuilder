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

/** The document. A function so each listener gets its own copy with its own base path. */
export function openApiDocument(basePath: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "admin-panel-builder listener",
      version: VERSION,
      description: "Every JSON body is an object with one named key; every failure is { error: <sentence> }. Writes need `content-type: application/json` and come from the panel's own origin, or from a client that sends no Origin.",
    },
    servers: [{ url: basePath === "" ? "/" : basePath }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" }, basic: { type: "http", scheme: "basic" }, cookie: { type: "apiKey", in: "cookie", name: "apb_session" } },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
        Json: {},
        WireValue: {
          type: "object",
          required: ["id", "value", "at", "version"],
          properties: {
            id: { type: "string" },
            value: {},
            text: { type: "string" },
            at: { type: "number" },
            version: { type: "integer" },
            by: { type: "string" },
            masked: { type: "boolean" },
            error: { type: "string" },
            status: { enum: ["ok", "warn", "bad"] },
            revertAt: { type: "number" },
            revertTo: {},
            hidden: { type: "boolean" },
            disabled: { type: "string" },
            scheduled: { type: "array", items: { type: "object", required: ["id", "at", "by"], properties: { id: { type: "string" }, at: { type: "number" }, by: { type: "string" }, to: {} } } },
            recent: { type: "array", items: { type: "object", required: ["at", "value"], properties: { at: { type: "number" }, value: {}, by: { type: "string" } } } },
          },
        },
        PendingChange: { type: "object", required: ["id", "target", "label", "by", "at", "expiresAt"], properties: { id: { type: "string" }, target: { type: "string" }, label: { type: "string" }, by: { type: "string" }, at: { type: "number" }, expiresAt: { type: "number" }, to: {} } },
        ChangeRecord: {
          type: "object",
          required: ["id", "kind", "target", "label", "by", "at", "ok"],
          properties: {
            id: { type: "integer" },
            kind: { enum: ["edit", "action", "profile", "approval", "revert", "scheduled", "import"] },
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
            hash: { type: "string" },
            prevHash: { type: "string" },
          },
        },
        Notice: { type: "object", required: ["id", "level", "message", "at"], properties: { id: { type: "string" }, level: { enum: ["info", "warning"] }, message: { type: "string" }, at: { type: "number" } } },
        Schema: {
          type: "object",
          required: ["title", "version", "structure", "theme", "pollMs", "controls", "restrictions", "groups", "locale"],
          properties: {
            title: { type: "string" },
            instance: { type: "string" },
            version: { type: "string" },
            structure: { type: "integer" },
            theme: { type: "object", properties: { name: { type: "string" }, scheme: { enum: ["auto", "light", "dark"] } } },
            pollMs: { type: "integer" },
            controls: { type: "object", properties: { edit: { type: "boolean" }, actions: { type: "boolean" } } },
            restrictions: { type: "array", items: { type: "string" } },
            groups: { type: "array", items: { type: "object", required: ["id", "title", "items"], properties: { id: { type: "string" }, title: { type: "string" }, layout: { enum: ["grid", "list"] }, items: { type: "array", items: { type: "object", required: ["type", "id"], properties: { type: { enum: ["value", "chart", "action", "table", "feed", "profile"] }, id: { type: "string" } } } } } } },
            locale: { type: "string" },
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
          },
        },
        SettingDiff: { type: "object", required: ["id", "label", "from", "to"], properties: { id: { type: "string" }, label: { type: "string" }, from: {}, to: {}, error: { type: "string" } } },
      },
    },
    security: [{ bearer: [] }, { basic: [] }, { cookie: [] }],
    paths: {
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
      "/api/tables/{id}": read("A page of a table", answer("The page", { type: "object", required: ["table"], properties: { table: { type: "object" } } }), [
        idParameter("id", "The table"),
        count("offset", "Rows to skip"),
        count("limit", "Rows to return"),
        { name: "sort", in: "query", schema: { type: "string" } },
        { name: "dir", in: "query", schema: { enum: ["asc", "desc"] } },
        { name: "q", in: "query", schema: { type: "string" } },
      ]),
      "/api/values/{id}": write(
        "Change a value; with revertAfterMs it reverts, with at it waits for that time",
        { type: "object", required: ["value"], properties: { value: {}, revertAfterMs: { type: "number" }, at: { oneOf: [{ type: "number" }, { type: "string", format: "date-time" }] } } },
        { "200": answer("Applied, or scheduled", { type: "object", required: ["value"], properties: { value: { $ref: "#/components/schemas/WireValue" } } }), "202": answer("Waiting for approval", { type: "object", required: ["pending"], properties: { pending: { $ref: "#/components/schemas/PendingChange" } } }) },
        [idParameter("id", "The value")],
      ),
      "/api/schedules/{id}/cancel": write("Cancel a scheduled change", undefined, { "200": answer("Cancelled", { type: "object", properties: { value: { $ref: "#/components/schemas/WireValue" } } }) }, [idParameter("id", "The scheduled change")]),
      "/api/actions/{id}": write("Run an action", { type: "object", properties: { input: { type: "object" } } }, { "200": answer("It finished", { type: "object", required: ["result"], properties: { result: { type: "object", properties: { message: { type: "string" } } } } }) }, [idParameter("id", "The action")]),
      "/api/profiles/{id}": write("Apply a profile, whole or not at all", undefined, { "200": answer("Applied", { type: "object", properties: { value: { $ref: "#/components/schemas/WireValue" } } }) }, [idParameter("id", "The profile")]),
      "/api/pending/{id}/approve": write("Approve somebody else's proposal", undefined, { "200": answer("Applied", { type: "object", properties: { value: { $ref: "#/components/schemas/WireValue" } } }) }, [idParameter("id", "The proposal")]),
      "/api/pending/{id}/reject": write("Turn a proposal down", undefined, { "200": answer("Turned down", { type: "object", properties: { value: { $ref: "#/components/schemas/WireValue" } } }) }, [idParameter("id", "The proposal")]),
      "/api/changes/{id}/undo": write("Write back what a change replaced", undefined, { "200": answer("Undone", { type: "object", properties: { value: { $ref: "#/components/schemas/WireValue" } } }) }, [idParameter("id", "The change")]),
      "/api/tables/{table}/actions/{action}": write("Run a row action", { type: "object", required: ["row"], properties: { row: { type: "string" } } }, { "200": answer("It finished", { type: "object", properties: { result: { type: "object" } } }) }, [idParameter("table", "The table"), idParameter("action", "The row action")]),
      "/api/settings/diff": write("What importing these settings would change; changes nothing", { type: "object", required: ["settings"], properties: { settings: { type: "object" } } }, { "200": answer("The difference", { type: "object", required: ["diff", "unknown"], properties: { diff: { type: "array", items: { $ref: "#/components/schemas/SettingDiff" } }, unknown: { type: "array", items: { type: "string" } } } }) }),
      "/api/settings/apply": write("Import settings, whole or not at all", { type: "object", required: ["settings"], properties: { settings: { type: "object" } } }, { "200": answer("Imported", { type: "object", required: ["changed"], properties: { changed: { type: "integer" } } }) }),
    },
  };
}
