/**
 * The HTTP API's newer paths through the router: the OpenAPI document and whether it lists every
 * route, resuming a stream, scheduled changes, asynchronous validation and settings.
 */
import { describe, expect, it } from "vitest";
import { call, jsonWrite, panelAt, routerFor, TOKEN } from "./helpers.js";

function fixture() {
  const { panel, clock } = panelAt(Date.parse("2026-09-21T12:00:00Z"));
  const limit = panel.modifiable(10, { label: "Limit", group: "Game", max: 100 });
  const name = panel.modifiable("ada", {
    label: "Handle",
    group: "Game",
    validateAsync: async (next: string) => (next === "taken" ? "that handle is taken" : next === "slow" ? new Promise<string>(() => undefined) : undefined),
    validateTimeoutMs: 50,
  });
  const flag = panel.modifiable(false, { label: "Flag", group: "Game" });
  panel.profile("Busy", [[limit, 50]]);
  panel.modifiable(1, { label: "Guarded", group: "Game", approval: true });
  panel.action("Flush", () => "flushed", { group: "Game" });
  panel.table("Rows", { group: "Game", columns: [{ key: "id", label: "Id" }], rows: () => [{ id: "a" }], rowId: (row: { id: string }) => row.id, actions: [{ id: "drop", label: "Drop", run: () => "dropped" }] } as never);
  const router = routerFor(panel, { auth: { tokens: { ada: TOKEN, sam: "sams-token-is-long-enough" } }, controls: { edit: true, actions: true }, clock });
  return { panel, clock, router, limit, name, flag };
}

describe("the OpenAPI document", () => {
  it("is served, and every path it lists is one the router answers", async () => {
    const { router, panel } = fixture();
    const doc = (await call(router, "GET", "/api/openapi.json", { headers: jsonWrite })).json as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(doc.openapi).toBe("3.1.0");
    panel.edit("guarded", 2, "sam", { groups: undefined, edit: true, actions: true, restrictions: [] });
    const ids: Record<string, string> = { id: "limit", table: "rows", action: "drop" };
    for (const [template, operations] of Object.entries(doc.paths)) {
      const path = template.replace(/\{(\w+)\}/g, (_, name: string) => ids[name] ?? "x");
      for (const method of Object.keys(operations)) {
        const answer = await call(router, method.toUpperCase(), path, { headers: jsonWrite, body: "{}" });
        expect({ template, method, missing: /there is nothing at/.test(answer.body) }).toEqual({ template, method, missing: false });
      }
    }
  });

  it("lists every route the router answers", async () => {
    const { router } = fixture();
    const doc = (await call(router, "GET", "/api/openapi.json", { headers: jsonWrite })).json as { paths: Record<string, unknown> };
    const routes = ["/api/schema", "/api/state", "/api/stream", "/api/changes", "/api/notices", "/api/settings", "/api/openapi.json", "/api/tables/{id}", "/api/values/{id}", "/api/schedules/{id}/cancel", "/api/actions/{id}", "/api/profiles/{id}", "/api/pending/{id}/approve", "/api/pending/{id}/reject", "/api/changes/{id}/undo", "/api/tables/{table}/actions/{action}", "/api/settings/diff", "/api/settings/apply"];
    expect(Object.keys(doc.paths).sort()).toEqual(routes.sort());
  });
});

describe("a stream that reconnects", () => {
  it("resumes from Last-Event-ID rather than sending everything again", async () => {
    const { panel, router, limit } = fixture();
    const open = async (headers: Record<string, string>) => {
      const response = await router.route({ method: "GET", url: "/api/stream", headers: { host: "127.0.0.1", authorization: `Bearer ${TOKEN}`, ...headers }, address: "127.0.0.1", body: async () => "" });
      const chunks: string[] = [];
      const stop = response.stream?.start({ send: (text) => chunks.push(text), ready: () => true, close: () => undefined });
      stop?.();
      return chunks.join("");
    };
    const first = await open({});
    const id = /^id: (\S+)$/m.exec(first)?.[1] as string;
    expect(first).toContain('"limit"');
    limit.value = 11;
    const resumed = await open({ "last-event-id": id });
    const values = JSON.parse(/data: (.*)/.exec(resumed)?.[1] as string).values as Array<{ id: string }>;
    expect(values.map((value) => value.id)).toEqual(["limit"]);
    expect(await open({ "last-event-id": "garbage" })).toContain('"handle"');
    panel.close();
  });
});

describe("scheduled changes through the API", () => {
  it("waits for its time, can be cancelled, and refuses a time in the past or too far ahead", async () => {
    const { panel, router, clock, limit } = fixture();
    const at = clock.now() + 3_600_000;
    const scheduled = await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: JSON.stringify({ value: 20, at: new Date(at).toISOString() }) });
    expect(scheduled.status).toBe(200);
    expect(scheduled.json.value.scheduled[0]).toMatchObject({ at, to: 20, by: "ada" });
    expect(limit.value).toBe(10);
    const again = await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: JSON.stringify({ value: 30, at }) });
    const second = again.json.value.scheduled[1].id as string;
    expect((await call(router, "POST", `/api/schedules/${second}/cancel`, { headers: jsonWrite, body: "{}" })).status).toBe(200);
    expect((await call(router, "POST", `/api/schedules/${second}/cancel`, { headers: jsonWrite, body: "{}" })).status).toBe(404);
    panel.fireScheduledNow(scheduled.json.value.scheduled[0].id);
    expect(limit.value).toBe(20);
    expect(panel.changes().at(-1)).toMatchObject({ kind: "scheduled", by: "ada (scheduled)", from: 10, to: 20 });
    for (const bad of [clock.now() - 1000, clock.now() + 40 * 86_400_000, "next week"]) {
      expect((await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: JSON.stringify({ value: 20, at: bad }) })).status).toBe(400);
    }
    expect((await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: JSON.stringify({ value: 500, at: clock.now() + 60_000 }) })).status).toBe(400);
    panel.close();
  });
});

describe("asynchronous validation", () => {
  it("refuses with the check's sentence, and a check that takes too long refuses too", async () => {
    const { router, name } = fixture();
    const taken = await call(router, "POST", "/api/values/handle", { headers: jsonWrite, body: '{"value":"taken"}' });
    expect(taken).toMatchObject({ status: 400, json: { error: "that handle is taken" } });
    const slow = await call(router, "POST", "/api/values/handle", { headers: jsonWrite, body: '{"value":"slow"}' });
    expect(slow.status).toBe(400);
    expect(slow.json.error).toMatch(/Handle could not be checked/);
    expect((await call(router, "POST", "/api/values/handle", { headers: jsonWrite, body: '{"value":"grace"}' })).status).toBe(200);
    expect(name.value).toBe("grace");
    const imported = await call(router, "POST", "/api/settings/apply", { headers: jsonWrite, body: '{"settings":{"handle":"taken"}}' });
    expect(imported.json.error).toMatch(/nothing was imported: that handle is taken/);
  });
});

describe("settings through the API", () => {
  it("exports, diffs without changing anything, and imports as one change", async () => {
    const { router, panel } = fixture();
    const exported = await call(router, "GET", "/api/settings", { headers: jsonWrite });
    expect(exported.json.settings).toMatchObject({ limit: 10, handle: "ada", flag: false });
    const diff = await call(router, "POST", "/api/settings/diff", { headers: jsonWrite, body: '{"settings":{"limit":20,"flag":false,"guarded":3,"ghost":1}}' });
    expect(diff.json).toEqual({ diff: [{ id: "limit", label: "Limit", from: 10, to: 20 }, { id: "guarded", label: "Guarded", from: 1, to: 3, error: expect.stringMatching(/approval/) }], unknown: ["ghost"] });
    expect((await call(router, "POST", "/api/settings/apply", { headers: jsonWrite, body: '{"settings":{"limit":20,"ghost":1}}' })).status).toBe(400);
    const applied = await call(router, "POST", "/api/settings/apply", { headers: jsonWrite, body: '{"settings":{"limit":20,"flag":true}}' });
    expect(applied.json).toEqual({ changed: 2 });
    expect(panel.changes().at(-1)).toMatchObject({ kind: "import", from: { limit: 10, flag: false }, to: { limit: 20, flag: true } });
    expect((await call(router, "POST", "/api/settings/apply", { headers: jsonWrite, body: '{"settings":[1]}' })).status).toBe(400);
    expect((await call(router, "POST", "/api/settings/apply", { headers: jsonWrite, body: '{"settings":{"limit":20}}' })).json).toEqual({ changed: 0 });
  });
});
