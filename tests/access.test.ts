import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAdminPanel, fileChangeLog, jsonLineSink, ManualClock, memoryChangeLog, memoryStore, notifySink, type PanelScope, signSession, webhookSink } from "../src/index.js";
import { base64url } from "../src/server/session.js";
import { bearer, call, jsonWrite, panelAt, routerFor, TOKEN } from "./helpers.js";

const all: PanelScope = { groups: undefined, edit: true, actions: true, restrictions: [] };

describe("per-group controls", () => {
  it("let a listener edit and run only in the groups it names", async () => {
    const { panel } = panelAt();
    panel.modifiable(1, { label: "Gap", group: "Matchmaking" });
    panel.modifiable(1, { label: "Rate", group: "Mail" });
    panel.action("Flush", () => "ok", { group: "Mail" });
    const router = routerFor(panel, { auth: { token: TOKEN }, controls: { edit: ["Matchmaking"], actions: ["Matchmaking"] } });
    expect((await call(router, "POST", "/api/values/gap", { headers: jsonWrite, body: '{"value":2}' })).status).toBe(200);
    const refused = await call(router, "POST", "/api/values/rate", { headers: jsonWrite, body: '{"value":2}' });
    expect(refused.status).toBe(403);
    expect(refused.json.error).toMatch(/not allowed on this listener/);
    expect((await call(router, "POST", "/api/actions/flush", { headers: jsonWrite, body: "{}" })).status).toBe(403);
    const schema = (await call(router, "GET", "/api/schema", { headers: bearer })).json.schema;
    const writable = schema.groups.flatMap((group: { items: Array<{ id: string; writable?: boolean }> }) => group.items.map((item) => [item.id, item.writable]));
    expect(writable).toEqual(expect.arrayContaining([["gap", true], ["rate", false]]));
    expect(schema.restrictions).toContainEqual({ text: 'Editing is allowed here only in "Matchmaking".', key: "restrictionEditGroups", params: { groups: '"Matchmaking"' } });
  });

  it("refuse an empty list rather than grant nothing while looking configured", () => {
    const { panel } = panelAt();
    expect(() => routerFor(panel, { auth: { token: TOKEN }, controls: { edit: [] } })).toThrow(/non-empty list of group names/);
  });
});

describe("two-person approval", () => {
  it("turns an edit into a proposal that someone else must approve", async () => {
    const { panel } = panelAt();
    const limit = panel.modifiable(10, { label: "Limit", approval: true, max: 100 });
    const router = routerFor(panel, { auth: { tokens: { ada: TOKEN, sam: "another-long-token-12" } }, controls: { edit: true } });
    const unexplained = await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: '{"value":50}' });
    expect(unexplained.json).toMatchObject({ key: "refuseReasonRequired" });
    const proposed = await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: '{"value":50,"reason":"tournament traffic"}' });
    expect(proposed.status).toBe(202);
    expect(limit.value).toBe(10);
    const id = proposed.json.pending.id;
    expect(panel.state().pending).toHaveLength(1);
    const self = await call(router, "POST", `/api/pending/${id}/approve`, { headers: jsonWrite, body: "{}" });
    expect(self.status).toBe(403);
    expect(self.json.error).toMatch(/somebody else has to approve it/);
    const other = await call(router, "POST", `/api/pending/${id}/approve`, { headers: { authorization: "Bearer another-long-token-12", "content-type": "application/json" }, body: "{}" });
    expect(other.status).toBe(200);
    expect(limit.value).toBe(50);
    expect(panel.changes().at(-1)).toMatchObject({ kind: "approval", by: "ada, approved by sam", to: 50, reason: "tournament traffic" });
  });

  it("checks a proposal when it is made, and lets it lapse after an hour", () => {
    const { panel, clock } = panelAt();
    panel.modifiable(10, { label: "Limit", approval: true, max: 100 });
    expect(panel.edit("limit", 500, "ada", all, { reason: "why not" })).toMatchObject({ ok: false, reason: "invalid" });
    expect(panel.edit("limit", 50, "ada", all, { reason: "load" })).toMatchObject({ ok: true });
    clock.advance(3_600_000);
    expect(panel.pending()).toEqual([]);
  });

  it("can be turned down", async () => {
    const { panel } = panelAt();
    panel.modifiable(10, { label: "Limit", approval: true });
    const outcome = panel.edit("limit", 20, "ada", all, { reason: "load" });
    const id = "pending" in outcome && outcome.ok ? outcome.pending.id : "";
    expect((await panel.reject(id, "sam", all)).ok).toBe(true);
    expect(panel.pending()).toEqual([]);
    expect(panel.get("limit")?.value).toBe(10);
  });
});

describe("undo", () => {
  it("writes back what an edit replaced, attributed to whoever undid it", () => {
    const { panel } = panelAt();
    const limit = panel.modifiable(10, "Limit");
    panel.edit("limit", 20, "ada", all);
    const change = panel.changes().at(-1);
    expect(change?.revertible).toBe(true);
    expect(panel.undo(change?.id as number, "sam", all).ok).toBe(true);
    expect(limit.value).toBe(10);
    expect(panel.changes().at(-1)).toMatchObject({ by: "sam", from: 20, to: 10 });
  });

  it("refuses when the value has changed since, rather than overwrite the later change", () => {
    const { panel } = panelAt();
    const limit = panel.modifiable(10, "Limit");
    panel.edit("limit", 20, "ada", all);
    const id = panel.changes().at(-1)?.id as number;
    limit.set(30);
    expect(panel.changes().at(-1)?.revertible).toBe(false);
    expect(panel.undo(id, "sam", all)).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("is offered through the API", async () => {
    const { panel } = panelAt();
    panel.modifiable(10, "Limit");
    const router = routerFor(panel, { auth: { token: TOKEN }, controls: { edit: true } });
    await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: '{"value":20}' });
    const id = panel.changes().at(-1)?.id;
    expect((await call(router, "POST", `/api/changes/${id}/undo`, { headers: jsonWrite, body: "{}" })).status).toBe(200);
    expect(panel.get("limit")?.value).toBe(10);
  });
});

describe("timed changes", () => {
  it("revert themselves, and say when and to what until they do", () => {
    const { panel } = panelAt(0);
    const rate = panel.modifiable(50, "Rate");
    panel.edit("rate", 500, "ada", all, { revertAfterMs: 3_600_000 });
    expect(panel.state().values[0]).toMatchObject({ value: 500, revertAt: 3_600_000, revertTo: 50 });
    panel.fireRevert(rate);
    expect(rate.value).toBe(50);
    expect(panel.changes().at(-1)).toMatchObject({ kind: "revert", by: "ada (timed change ended)", to: 50 });
    panel.close();
  });

  it("are cancelled by a later change", () => {
    const { panel } = panelAt(0);
    const rate = panel.modifiable(50, "Rate");
    panel.edit("rate", 500, "ada", all, { revertAfterMs: 60_000 });
    panel.edit("rate", 70, "sam", all);
    panel.fireRevert(rate);
    expect(rate.value).toBe(70);
    expect(panel.state().values[0]?.revertAt).toBeUndefined();
  });

  it("survive a restart when the value is persisted, and revert at once if the time has passed", async () => {
    const store = memoryStore();
    const clock = new ManualClock(0);
    const first = createAdminPanel({ clock, store });
    first.modifiable(50, { label: "Rate", persist: true });
    await first.ready;
    first.edit("rate", 500, "ada", all, { revertAfterMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    first.close();
    clock.advance(120_000);
    const second = createAdminPanel({ clock, store });
    const rate = second.modifiable(50, { label: "Rate", persist: true });
    await second.ready;
    expect(rate.value).toBe(50);
    second.close();
  });

  it("are bounded, and refused for a value declared without them", () => {
    const { panel } = panelAt(0);
    panel.modifiable(1, "a");
    panel.modifiable(1, { label: "b", timed: false });
    expect(panel.edit("a", 2, "ada", all, { revertAfterMs: 8 * 86_400_000 })).toMatchObject({ ok: false, reason: "invalid" });
    expect(panel.edit("b", 2, "ada", all, { revertAfterMs: 60_000 })).toMatchObject({ ok: false, message: "b does not take timed changes" });
  });
});

describe("the change log", () => {
  it("keeps every change in a store and continues its ids after a restart", async () => {
    const log = memoryChangeLog();
    const first = createAdminPanel({ changeLog: log });
    first.modifiable(1, "a");
    await first.ready;
    first.edit("a", 2, "ada", all);
    first.edit("a", 3, "ada", all);
    await first.flushed();
    const second = createAdminPanel({ changeLog: log });
    second.modifiable(3, "a");
    await second.ready;
    second.edit("a", 4, "sam", all);
    expect(second.changes().map((change) => change.id)).toEqual([1, 2, 3]);
  });

  it("writes JSON lines to a file and reads back the tail", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "apb-log-")), "changes.jsonl");
    const log = fileChangeLog(path);
    await log.append({ id: 1, kind: "edit", target: "a", label: "a", by: "ada", at: 1, ok: true });
    await log.append({ id: 2, kind: "edit", target: "a", label: "a", by: "sam", at: 2, ok: true });
    expect((await log.load(1)).map((record) => record.by)).toEqual(["sam"]);
  });
});

describe("audit sinks", () => {
  it("write one JSON line per change, with a kind, and cannot be split by a value", () => {
    const lines: string[] = [];
    const { panel } = panelAt();
    panel.modifiable("x", "Note");
    panel.on("change", jsonLineSink((line) => lines.push(line)));
    panel.edit("note", "line\nforged", "ada", all);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(JSON.parse(lines[0] as string)).toMatchObject({ kind: "panel-change", change: "edit", by: "ada", to: "line\nforged" });
  });

  it("post to a webhook with a signature, dropping and counting past the in-flight limit", async () => {
    const { panel } = panelAt();
    panel.modifiable(1, "a");
    let release: () => void = () => undefined;
    const calls: RequestInit[] = [];
    const sink = webhookSink({
      url: "https://audit.example/hook",
      secret: "s3cret",
      maxInFlight: 1,
      fetch: (async (_url: string, init: RequestInit) => {
        calls.push(init);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new Response("", { status: 200 });
      }) as typeof fetch,
    });
    panel.on("change", sink);
    panel.edit("a", 2, "ada", all);
    panel.edit("a", 3, "ada", all);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(sink.dropped).toBe(1);
    expect((calls[0]?.headers as Record<string, string>)["x-apb-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    release();
  });

  it("hand changes to a notifier", () => {
    const notified: Array<{ title: string }> = [];
    const { panel } = panelAt();
    panel.modifiable(1, "a");
    panel.on("change", notifySink({ notify: (event) => notified.push(event) }));
    panel.edit("a", 2, "ada", all);
    expect(notified[0]?.title).toBe("ada changed a");
  });
});

describe("sessions", () => {
  const secret = "a-session-secret-of-thirty-two-chars!";

  it("admit a cookie the application signed, and refuse a forged or expired one", async () => {
    const { panel } = panelAt();
    panel.viewable(1, "a");
    const router = routerFor(panel, { auth: { session: { secret } } });
    const cookie = await signSession(secret, "ada");
    expect((await call(router, "GET", "/api/schema", { headers: { cookie: `apb_session=${cookie}` } })).status).toBe(200);
    const [body] = cookie.split(".");
    const forged = `${base64url(new TextEncoder().encode(JSON.stringify({ n: "admin", e: Date.now() + 1e6 })))}.${cookie.split(".")[1]}`;
    expect((await call(router, "GET", "/api/schema", { headers: { cookie: `apb_session=${forged}` } })).status).toBe(401);
    const expired = await signSession(secret, "ada", 1000, Date.now() - 10_000);
    expect((await call(router, "GET", "/api/schema", { headers: { cookie: `apb_session=${expired}` } })).status).toBe(401);
    expect(body).toBeDefined();
  });

  it("refuse a short secret", () => {
    const { panel } = panelAt();
    expect(() => routerFor(panel, { auth: { session: { secret: "short" } } })).toThrow(/at least 32 characters/);
  });
});

describe("delegated tokens", () => {
  it("record the operator a trusted gateway acts for, and ignore the header from anyone else", async () => {
    const { panel } = panelAt();
    panel.modifiable(1, "a");
    const router = routerFor(panel, { auth: { tokens: { gateway: TOKEN, ada: "ada-token-0123456789" }, delegates: ["gateway"] }, controls: { edit: true } });
    await call(router, "POST", "/api/values/a", { headers: { ...jsonWrite, "x-apb-on-behalf-of": "sam" }, body: '{"value":2}' });
    expect(panel.changes().at(-1)?.by).toBe("sam via gateway");
    await call(router, "POST", "/api/values/a", { headers: { authorization: "Bearer ada-token-0123456789", "content-type": "application/json", "x-apb-on-behalf-of": "sam" }, body: '{"value":3}' });
    expect(panel.changes().at(-1)?.by).toBe("ada");
  });

  it("refuse a delegate that is not one of the tokens", () => {
    const { panel } = panelAt();
    expect(() => routerFor(panel, { auth: { tokens: { ada: TOKEN }, delegates: ["ghost"] } })).toThrow(/delegate nothing/);
  });
});

describe("the change log and sinks when things fail", () => {
  it("renumbers changes made before the log finished loading, after the loaded ones", async () => {
    const log = memoryChangeLog();
    await log.append({ id: 7, kind: "edit", target: "a", label: "a", by: "old", at: 1, ok: true });
    const panel = createAdminPanel({ changeLog: log });
    panel.modifiable(1, "a");
    panel.edit("a", 2, "early", all);
    await panel.ready;
    panel.edit("a", 3, "later", all);
    expect(panel.changes().map((change) => [change.id, change.by])).toEqual([
      [7, "old"],
      [8, "early"],
      [9, "later"],
    ]);
  });

  it("reports a change log that cannot be written or read, and carries on", async () => {
    const panel = createAdminPanel({ changeLog: { load: () => Promise.reject(new Error("unreadable")), append: () => Promise.reject(new Error("full")) }, onError: () => undefined });
    panel.modifiable(1, "a");
    await panel.ready;
    expect(panel.edit("a", 2, "ada", all).ok).toBe(true);
    await panel.flushed();
    expect(panel.notices().map((notice) => notice.id)).toEqual(expect.arrayContaining(["change-log-load", "change-log-append"]));
  });

  it("counts a webhook that answers badly, and a notifier that rejects", async () => {
    const { panel } = panelAt();
    panel.modifiable(1, "a");
    const hook = webhookSink({ url: "https://audit.example", sleep: async () => undefined, fetch: (async () => new Response("", { status: 500 })) as typeof fetch });
    const notifier = notifySink({ notify: () => Promise.reject(new Error("down")) });
    panel.on("change", hook);
    panel.on("change", notifier);
    panel.edit("a", 2, "ada", all);
    await vi.waitFor(() => expect([hook.failed, notifier.failed]).toEqual([1, 1]));
    expect(hook.retried).toBe(3);
  });

  it("gives up on a webhook that never answers, and cancels the request it left open", async () => {
    const { panel } = panelAt();
    panel.modifiable(1, "a");
    const signals: AbortSignal[] = [];
    const sink = webhookSink({
      url: "https://audit.example",
      timeoutMs: 20,
      retries: 0,
      sleep: async () => undefined,
      // An endpoint that takes the connection and then says nothing.
      fetch: (async (_url: string, init: RequestInit) => {
        signals.push(init.signal as AbortSignal);
        return await new Promise<Response>(() => undefined);
      }) as typeof fetch,
    });
    panel.on("change", sink);
    panel.edit("a", 2, "ada", all);
    await vi.waitFor(() => expect(sink.failed).toBe(1));
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("retries a webhook that is down until it answers, and never one that refuses the record", async () => {
    const { panel } = panelAt();
    panel.modifiable(1, "a");
    const answers = [503, 0, 200];
    let calls = 0;
    const flaky = webhookSink({
      url: "https://audit.example",
      sleep: async () => undefined,
      fetch: (async () => {
        const status = answers[calls++] ?? 200;
        if (status === 0) throw new Error("connection reset");
        return new Response("", { status });
      }) as typeof fetch,
    });
    let refusedCalls = 0;
    const refusing = webhookSink({
      url: "https://audit.example",
      sleep: async () => undefined,
      fetch: (async () => {
        refusedCalls += 1;
        return new Response("", { status: 400 });
      }) as typeof fetch,
    });
    panel.on("change", flaky);
    panel.on("change", refusing);
    panel.edit("a", 2, "ada", all);
    await vi.waitFor(() => expect(calls).toBe(3));
    await vi.waitFor(() => expect(refusing.failed).toBe(1));
    expect([flaky.failed, flaky.retried, refusedCalls, refusing.retried]).toEqual([0, 2, 1, 0]);
    expect(() => webhookSink({ url: "https://audit.example", retries: 99 })).toThrow(/retries is 0 to 8/);
  });
});
