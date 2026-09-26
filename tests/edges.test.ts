/**
 * The paths a happy test never takes: every client call and its failures, the fleet page through
 * Node, a narrowed remote panel's write checks, the router's refusals of the newer routes, sessions
 * that are forged or expired, and how the page explains a refusal.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createFleet, listenPanel, remotePanelHandler } from "../src/adapters/index.js";
import { explain } from "../src/client/explain.js";
import { createAdminPanel, signSession } from "../src/index.js";
import { PanelApiError, panelClient } from "../src/sdk.js";
import { sessionInfo } from "../src/server/session.js";
import { call, jsonWrite, panelAt, routerFor, TOKEN } from "./helpers.js";

describe("every call of the typed client", () => {
  it("reaches its route and returns the answer's payload", async () => {
    const panel = createAdminPanel();
    const flag = panel.modifiable(false, "Flag");
    panel.modifiable(1, { label: "Guarded", approval: true });
    panel.profile("On", [[flag, true]]);
    panel.table("Rows", { columns: ["id"], rows: () => [{ id: "a" }], actions: [{ label: "Drop", run: (id) => `dropped ${id}` }] });
    panel.action("Go", () => "went");
    const server = await listenPanel(panel, { port: 0, auth: { tokens: { ada: TOKEN, sam: "sams-token-is-long-enough" } }, controls: { edit: true, actions: true } });
    const ada = panelClient({ url: server.url, token: TOKEN });
    const sam = panelClient({ url: server.url, token: "sams-token-is-long-enough" });
    try {
      expect(await ada.run("go")).toBe("went");
      expect((await ada.table("rows", { limit: 5 })).rows).toHaveLength(1);
      expect(await ada.runRowAction("rows", "drop", "a")).toBe("dropped a");
      await ada.applyProfile("on");
      expect(flag.value).toBe(true);
      const proposed = await ada.set("guarded", 2, { reason: "a test" });
      const pendingId = "pending" in proposed ? proposed.pending.id : "";
      await sam.approve(pendingId);
      expect(panel.get("guarded")?.value).toBe(2);
      const again = await ada.set("guarded", 3, { reason: "a test" });
      await sam.reject("pending" in again ? again.pending.id : "");
      await ada.set("flag", false);
      const last = (await ada.changes()).at(-1);
      await ada.undo(last?.id as number);
      expect(flag.value).toBe(true);
      expect(await ada.notices()).toEqual([]);
      expect(await ada.settings()).toMatchObject({ flag: true });
      expect((await ada.diffSettings({ flag: false })).diff).toHaveLength(1);
      expect(await ada.importSettings({ flag: false })).toBe(1);
      await expect(ada.approve("nope")).rejects.toBeInstanceOf(PanelApiError);
    } finally {
      panel.close();
      await server.close();
    }
  });

  it("says when a panel does not answer in time, and when it answers without JSON", async () => {
    const slow = panelClient({ url: "http://panel.example", timeoutMs: 20, fetch: ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch });
    await expect(slow.schema()).rejects.toThrow(/did not answer within/);
    const html = panelClient({ url: "http://panel.example", fetch: (async () => new Response("<html>", { status: 200 })) as typeof fetch });
    await expect(html.schema()).rejects.toThrow(/without JSON/);
    const broken = panelClient({ url: "http://panel.example", fetch: (async () => new Response("", { status: 500 })) as typeof fetch });
    await expect(broken.schema()).rejects.toMatchObject({ status: 500, message: "the panel answered 500" });
  });

  it("keeps watching through a panel that is down, waiting longer each time", async () => {
    let calls = 0;
    const controller = new AbortController();
    const flaky = panelClient({
      url: "http://panel.example",
      fetch: (async () => {
        calls += 1;
        if (calls < 3) throw new Error("connection refused");
        controller.abort();
        return Response.json({ state: { version: 1, now: 1, feedSeq: 0, values: [] } });
      }) as typeof fetch,
    });
    const seen: number[] = [];
    await flaky.watch((state) => seen.push(state.version), { intervalMs: 1, signal: controller.signal });
    expect([calls, seen]).toEqual([3, [1]]);
  });
});

describe("the fleet page through Node", () => {
  it("answers the page, the JSON, and refuses other methods and paths", async () => {
    const fleet = createFleet({ panels: [{ name: "gone", url: "http://127.0.0.1:1" }], auth: { basic: { username: "ada", password: "pw" } }, timeoutMs: 200, title: "Replicas", theme: "apple" });
    const server = createServer(fleet.handler());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = { authorization: `Basic ${btoa("ada:pw")}` };
    try {
      const refused = await fetch(url);
      expect([refused.status, refused.headers.get("www-authenticate")]).toEqual([401, 'Basic realm="admin panel", charset="UTF-8"']);
      expect(await (await fetch(url, { headers: auth })).text()).toContain("<title>Replicas</title>");
      expect(((await (await fetch(`${url}/api/fleet`, { headers: auth })).json()) as { panels: unknown[] }).panels).toHaveLength(1);
      expect((await fetch(url, { method: "POST", headers: auth })).status).toBe(405);
      const fetchHandler = fleet.fetchHandler();
      expect((await fetchHandler(new Request("http://x/elsewhere", { headers: auth }))).status).toBe(200);
      expect(() => createFleet({ panels: Array.from({ length: 101 }, (_, i) => ({ name: `p${i}`, url: "http://a" })), auth: { check: () => "a" } })).toThrow(/more than 100/);
      expect(() => createFleet({ panels: [{ name: "", url: "http://a" }], auth: { check: () => "a" } })).toThrow(/needs a name/);
    } finally {
      server.close();
    }
  });
});

describe("a narrowed remote panel's writes", () => {
  it("looks up pending changes, schedules and undo before forwarding, and lets a diff through", async () => {
    const panel = createAdminPanel();
    panel.modifiable(1, { label: "Rate", group: "Mail", approval: true });
    panel.modifiable(1, { label: "Level", group: "Mail" });
    panel.modifiable(1, { label: "Pay", group: "Finance", approval: true });
    const upstream = await listenPanel(panel, { port: 0, auth: { tokens: { gateway: TOKEN }, delegates: ["gateway"] }, controls: { edit: true } });
    const all = { groups: undefined, edit: true, actions: true, restrictions: [] };
    const handler = remotePanelHandler({ upstream: upstream.url, token: TOKEN, auth: { check: (request) => (request.headers["x-user"] as string | undefined) ?? "ada" }, controls: { edit: true }, groups: ["Mail"] });
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body: object = {}, user = "sam") => fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-user": user }, body: JSON.stringify(body) });
    try {
      const mail = panel.edit("rate", 2, "ops", all, { reason: "a test" });
      const pay = panel.edit("pay", 2, "ops", all, { reason: "a test" });
      const mailId = "pending" in mail ? mail.pending.id : "";
      const payId = "pending" in pay ? pay.pending.id : "";
      expect((await post(`/api/pending/${payId}/approve`)).status).toBe(404);
      expect((await post(`/api/pending/${mailId}/approve`)).status).toBe(200);
      const scheduled = panel.edit("level", 5, "ops", all, { at: Date.now() + 600_000 });
      const entry = "value" in scheduled ? scheduled.value.scheduled?.[0]?.id : "";
      expect((await post(`/api/schedules/nope/cancel`)).status).toBe(404);
      expect((await post(`/api/schedules/${entry}/cancel`)).status).toBe(200);
      panel.edit("level", 7, "ops", all);
      const change = panel.changes().at(-1)?.id;
      expect((await post(`/api/changes/${change}/undo`)).status).toBe(200);
      expect((await post(`/api/changes/99999/undo`)).status).toBe(404);
      expect((await post("/api/settings/diff", { settings: { level: 3 } })).status).toBe(200);
      expect((await fetch(`${url}/api/tables/secret`)).status).toBe(404);
      expect((await fetch(`${url}/client-extras.js`)).status).toBe(200);
    } finally {
      server.close();
      await upstream.close();
      panel.close();
    }
  });
});

describe("the router's newer refusals", () => {
  it("reads a time as ms or ISO only, answers GET on a write path with 405, and can switch the write limit off", async () => {
    const { panel } = panelAt();
    panel.modifiable(1, "Level");
    const router = routerFor(panel, { auth: { token: TOKEN }, controls: { edit: true }, writeLimit: false });
    expect((await call(router, "POST", "/api/values/level", { headers: jsonWrite, body: '{"value":2,"at":true}' })).status).toBe(400);
    expect((await call(router, "POST", "/api/values/level", { headers: jsonWrite, body: '{"value":2,"at":"2026-99-99T00:00:00Z"}' })).status).toBe(400);
    expect((await call(router, "GET", "/api/schedules/x/cancel", { headers: jsonWrite })).status).toBe(405);
    expect((await call(router, "POST", "/api/settings/apply", { headers: jsonWrite, body: '{"settings":"no"}' })).status).toBe(400);
    for (let i = 0; i < 70; i += 1) expect((await call(router, "POST", "/api/values/level", { headers: jsonWrite, body: `{"value":${i}}` })).status).toBe(200);
    expect(() => routerFor(panel, { auth: { token: TOKEN }, writeLimit: { perHour: 1 } as never })).toThrow(/perHour/);
  });
});

describe("sessions that should not be believed", () => {
  it("are forged, expired, oversized or signed with another secret", async () => {
    const secret = "a-session-secret-of-thirty-two-chars!";
    const sealed = await signSession(secret, "ada", { ttlMs: 1000, now: 0 });
    expect(await sessionInfo(secret, sealed, 500)).toMatchObject({ name: "ada" });
    expect(await sessionInfo(secret, sealed, 2000)).toBeUndefined();
    expect(await sessionInfo(secret, `${sealed}x`, 500)).toBeUndefined();
    expect(await sessionInfo(secret, "x".repeat(9000))).toBeUndefined();
    expect(await sessionInfo(secret, "nodot")).toBeUndefined();
    expect(await sessionInfo("another-secret-that-is-long-enough!!", sealed, 500)).toBeUndefined();
    expect(await sessionInfo(secret, await signSession(secret, "sam", 1000, 0), 10)).toMatchObject({ name: "sam" });
    await expect(signSession(secret, "")).rejects.toThrow(/non-empty/);
  });
});

describe("how the page explains a refusal", () => {
  const english = Object.assign((key: string, values?: Record<string, string | number>) => (key === "refuseAtMost" ? `${values?.label} must be at most ${values?.max}` : key), { locale: "en", has: (key: string) => key === "refuseAtMost" || key.startsWith("code_") || key === "refused" });
  const german = Object.assign((key: string) => ({ "code_not-allowed": "Das ist hier nicht erlaubt.", refused: "Abgelehnt" })[key] ?? key, { locale: "de", has: (key: string) => key === "code_not-allowed" || key === "refused" });

  it("translates a keyed refusal whole, names others by kind, and passes anything else through", () => {
    expect(explain(Object.assign(new Error("x"), { key: "refuseAtMost", params: { label: "Limit", max: 5 } }), english as never)).toBe("Limit must be at most 5.");
    expect(explain(Object.assign(new Error("Editing is off."), { code: "not-allowed" }), german as never)).toBe("Das ist hier nicht erlaubt. (Editing is off.)");
    expect(explain(Object.assign(new Error("Odd."), { code: "teapot" }), german as never)).toBe("Abgelehnt: Odd.");
    expect(explain(Object.assign(new Error("Odd."), { code: "teapot" }), english as never)).toBe("Odd.");
    expect(explain("plain", english as never)).toBe("plain");
  });
});
