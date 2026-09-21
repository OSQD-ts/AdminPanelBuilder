/**
 * What operators and replicas lean on: changes carried between replicas, Redis behind the store
 * and the log, chart history across a restart, alerts, conditions on values and actions, the
 * timeline of recent changes, and the warnings a panel gives about its own declarations.
 */
import { describe, expect, it } from "vitest";
import { createAdminPanel, ManualClock, memoryStore, memorySync, redisChangeLog, redisStore, redisSync, type PanelScope, verifyChain } from "../src/index.js";
import type { RedisLike } from "../src/stores/redis.js";
import { panelAt } from "./helpers.js";

const all: PanelScope = { groups: undefined, edit: true, actions: true, restrictions: [] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

function fakeRedis(): RedisLike & { hashes: Map<string, Map<string, string>>; lists: Map<string, string[]> } {
  const hashes = new Map<string, Map<string, string>>();
  const lists = new Map<string, string[]>();
  const slice = (list: string[], start: number, stop: number) => {
    const from = start < 0 ? Math.max(0, list.length + start) : start;
    const to = stop < 0 ? list.length + stop : stop;
    return list.slice(from, to + 1);
  };
  return {
    hashes,
    lists,
    hgetall: async (key) => Object.fromEntries(hashes.get(key) ?? []),
    hset: async (key, field, value) => {
      hashes.set(key, (hashes.get(key) ?? new Map()).set(field, value));
    },
    rpush: async (key, value) => {
      lists.set(key, [...(lists.get(key) ?? []), value]);
    },
    ltrim: async (key, start, stop) => {
      lists.set(key, slice(lists.get(key) ?? [], start, stop));
    },
    lrange: async (key, start, stop) => slice(lists.get(key) ?? [], start, stop),
  };
}

describe("replicas kept in step", () => {
  it("apply an operator's change on every other replica, say where it came from, and leave code's writes local", async () => {
    const bus = memorySync();
    const one = createAdminPanel({ instance: "one", sync: bus.connect() });
    const two = createAdminPanel({ instance: "two", sync: bus.connect() });
    const limitOne = one.modifiable(10, { label: "Limit", max: 100 });
    const limitTwo = two.modifiable(10, { label: "Limit", max: 100 });
    one.edit("limit", 20, "ada", all);
    await settle();
    expect(limitTwo.value).toBe(20);
    expect(two.changes().at(-1)).toMatchObject({ by: "ada", to: 20, origin: one.origin });
    expect(one.changes()).toHaveLength(1);
    limitOne.value = 30;
    await settle();
    expect(limitTwo.value).toBe(20);
    one.close();
    two.close();
  });

  it("keeps its own value and says so when a replica's declaration refuses the change", async () => {
    const bus = memorySync();
    const one = createAdminPanel({ sync: bus.connect() });
    const two = createAdminPanel({ sync: bus.connect() });
    one.modifiable(10, { label: "Limit", max: 1000 });
    const strict = two.modifiable(10, { label: "Limit", max: 100 });
    one.edit("limit", 500, "ada", all);
    await settle();
    expect(strict.value).toBe(10);
    expect(two.notices().map((notice) => notice.id)).toContain("sync-refused-limit");
  });

  it("says a change could not be sent, and keeps it here", async () => {
    const panel = createAdminPanel({ sync: { publish: () => Promise.reject(new Error("broker down")), subscribe: () => () => undefined }, onError: () => undefined });
    const limit = panel.modifiable(1, "Limit");
    panel.edit("limit", 2, "ada", all);
    await settle();
    expect(limit.value).toBe(2);
    expect(panel.notices().find((notice) => notice.id === "sync-publish")?.message).toMatch(/applies to this one only/);
  });

  it("travels over Redis publish and subscribe, and drops what it cannot read", async () => {
    let deliver: (channel: string, message: string) => void = () => undefined;
    const dropped: string[] = [];
    const published: string[] = [];
    const sync = redisSync({
      publisher: { publish: async (_channel, message) => published.push(message) },
      subscriber: { subscribe: async () => undefined, on: (_event, listener) => (deliver = listener) },
      onDropped: (reason) => dropped.push(reason),
    });
    const panel = createAdminPanel({ sync });
    const limit = panel.modifiable(1, "Limit");
    panel.edit("limit", 2, "ada", all);
    await settle();
    const message = JSON.parse(published[0] as string);
    deliver("apb:changes", JSON.stringify({ ...message, origin: "elsewhere", value: 7 }));
    expect(limit.value).toBe(7);
    deliver("apb:changes", "{not json");
    deliver("apb:changes", "x".repeat(70_000));
    deliver("other-channel", JSON.stringify({ ...message, origin: "elsewhere", value: 9 }));
    expect(limit.value).toBe(7);
    expect(dropped).toHaveLength(2);
  });
});

describe("Redis behind the store and the change log", () => {
  it("remembers persisted choices and keeps one chained, trimmed log", async () => {
    const redis = fakeRedis();
    const first = createAdminPanel({ store: redisStore(redis), changeLog: redisChangeLog(redis, { keep: 3 }) });
    first.modifiable(1, { label: "Limit", persist: true });
    await first.ready;
    for (const value of [2, 3, 4, 5]) first.edit("limit", value, "ada", all);
    await first.flushed();
    await settle();
    expect(redis.hashes.get("apb:values")?.get("limit")).toBe("5");
    expect(redis.lists.get("apb:changes")).toHaveLength(3);
    const second = createAdminPanel({ store: redisStore(redis), changeLog: redisChangeLog(redis) });
    const limit = second.modifiable(1, { label: "Limit", persist: true });
    await second.ready;
    expect(limit.value).toBe(5);
    expect(second.changes().map((change) => change.id)).toEqual([2, 3, 4]);
    expect(await verifyChain((redis.lists.get("apb:changes") ?? []).map((line) => JSON.parse(line)))).toMatchObject({ ok: true });
  });
});

describe("chart history across a restart", () => {
  it("is saved to the store and drawn again on start", async () => {
    const store = memoryStore();
    const clock = new ManualClock(1_000_000);
    const first = createAdminPanel({ clock, store, keepHistory: { everyMs: 5000 } });
    const players = first.viewable(1, { label: "Players", chart: true });
    for (const value of [2, 3, 4]) {
      clock.advance(1000);
      players.value = value;
    }
    first.close();
    await settle();
    const second = createAdminPanel({ clock, store, keepHistory: true });
    second.viewable(4, { label: "Players", chart: true });
    await second.ready;
    const samples = Object.values(second.state().series)[0] ?? [];
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(() => createAdminPanel({ keepHistory: true })).toThrow(/needs a store/);
    expect(() => createAdminPanel({ store, keepHistory: { everyMs: 10 } })).toThrow(/every five seconds/);
  });
});

describe("alerts", () => {
  it("fire once when a status reaches its level and holds, then wait for recovery and the cooldown", () => {
    const { panel, clock } = panelAt();
    const queue = panel.viewable(0, { label: "Queue", status: { warn: 50, bad: 100 }, alert: { at: "bad", forMs: 2000, cooldownMs: 60_000 } });
    const alerts: string[] = [];
    panel.on("alert", (alert) => alerts.push(alert.message));
    const second = () => {
      clock.advance(1000);
      panel.tick();
    };
    queue.value = 150;
    second();
    second();
    expect(alerts).toEqual([]);
    second();
    second();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/Queue is bad: 150 \(threshold 100\), for \d+ s/);
    expect(panel.notices().some((notice) => notice.id === "alert-queue")).toBe(true);
    queue.value = 10;
    second();
    queue.value = 200;
    for (let i = 0; i < 5; i += 1) second();
    expect(alerts).toHaveLength(1);
    clock.advance(60_000);
    queue.value = 10;
    second();
    queue.value = 200;
    for (let i = 0; i < 4; i += 1) second();
    expect(alerts).toHaveLength(2);
    panel.close();
    expect(() => panel.viewable(1, { label: "No status", alert: {} })).toThrow(/could never fire/);
    expect(() => panel.viewable(1, { label: "Odd", status: { bad: 1 }, alert: { at: "never" as never } })).toThrow(/"warn" or "bad"/);
  });
});

describe("conditions on values and actions", () => {
  it("hide and disable on the wire, refuse edits and runs while they hold, and never lock out on a throw", async () => {
    const { panel } = panelAt();
    let maintenance = false;
    const limit = panel.modifiable(1, { label: "Limit", disabledWhen: () => (maintenance ? "maintenance is on" : false) });
    panel.modifiable(1, { label: "Expert", visibleWhen: () => !maintenance });
    panel.modifiable(1, { label: "Broken", visibleWhen: () => { throw new Error("bug"); } });
    panel.action("Deploy", () => "deployed", { disabledWhen: () => (maintenance ? "maintenance is on" : undefined) });
    maintenance = true;
    const state = panel.state();
    expect(state.values.find((value) => value.id === "limit")?.disabled).toBe("maintenance is on");
    expect(state.values.find((value) => value.id === "expert")?.hidden).toBe(true);
    expect(state.values.find((value) => value.id === "broken")?.hidden).toBeUndefined();
    expect(state.actionStates.deploy).toEqual({ disabled: "maintenance is on" });
    expect(panel.edit("limit", 2, "ada", all)).toMatchObject({ ok: false, message: expect.stringMatching(/cannot be changed right now: maintenance/) });
    expect(panel.edit("expert", 2, "ada", all)).toMatchObject({ ok: false, message: expect.stringMatching(/not offered right now/) });
    expect(await panel.run("deploy", "ada", all)).toMatchObject({ ok: false, reason: "not-allowed" });
    maintenance = false;
    expect(panel.edit("limit", 2, "ada", all).ok).toBe(true);
    expect(limit.value).toBe(2);
    expect(panel.state(all, panel.state().version).values.map((value) => value.id)).toEqual(expect.arrayContaining(["limit", "expert"]));
    expect(() => panel.modifiable(1, { label: "Bad", visibleWhen: true as never })).toThrow(/not a function/);
  });
});

describe("the timeline of recent changes", () => {
  it("is kept for text, choices and switches by default, bounded, and never for sensitive values", () => {
    const { panel, clock } = panelAt();
    const mode = panel.modifiable("normal", { label: "Mode", options: ["normal", "busy", "closed"] });
    const count = panel.modifiable(1, "Count");
    const secret = panel.modifiable("a", { label: "Key", sensitive: true });
    const short = panel.modifiable(false, { label: "Short", timeline: 2 });
    clock.advance(1000);
    panel.edit("mode", "busy", "ada", all);
    mode.value = "closed";
    count.value = 2;
    secret.value = "b";
    for (const value of [true, false, true]) short.value = value;
    const wire = new Map(panel.state().values.map((value) => [value.id, value]));
    expect(wire.get("mode")?.recent).toEqual([
      { at: 1_001_000, value: "busy", by: "ada" },
      { at: 1_001_000, value: "closed" },
    ]);
    expect(wire.get("count")?.recent).toBeUndefined();
    expect(wire.get("key")?.recent).toBeUndefined();
    expect(wire.get("short")?.recent?.map((entry) => entry.value)).toEqual([false, true]);
    expect(() => panel.modifiable(1, { label: "Long", timeline: 500 })).toThrow(/0 to 200/);
  });
});

describe("what a panel says about its own declarations", () => {
  it("warns about a value that looks like a secret but is not declared sensitive", () => {
    const { panel } = panelAt();
    panel.modifiable("x", "API key");
    panel.modifiable("y", { label: "Database password", sensitive: true });
    panel.viewable(3, "Tokens issued today");
    const ids = panel.notices().map((notice) => notice.id);
    expect(ids).toContain("looks-secret-api-key");
    expect(ids).not.toContain("looks-secret-database-password");
  });

  it("reads a live value once per quarter second however many ask", () => {
    const { panel, clock } = panelAt();
    let reads = 0;
    panel.viewable(() => ++reads, "Reads");
    const before = reads;
    for (let i = 0; i < 20; i += 1) panel.state();
    expect(reads - before).toBe(1);
    clock.advance(250);
    panel.state();
    expect(reads - before).toBe(2);
  });

  it("fires a scheduled change whose time passed while the process was down, and says it was late", async () => {
    const store = memoryStore();
    const clock = new ManualClock(1_000_000);
    const first = createAdminPanel({ clock, store });
    first.modifiable("open", { label: "Door", persist: true });
    await first.ready;
    first.edit("door", "closed", "ada", all, { at: clock.now() + 60_000 });
    first.close();
    await settle();
    clock.advance(120_000);
    const second = createAdminPanel({ clock, store });
    const door = second.modifiable("open", { label: "Door", persist: true });
    await second.ready;
    expect(door.value).toBe("closed");
    expect(second.notices().some((notice) => /late, on start/.test(notice.message))).toBe(true);
    second.close();
  });
});

describe("alerts reach the audit sinks", () => {
  it("as a JSON line, a webhook post and a notification", async () => {
    const { jsonLineSink, notifySink, webhookSink } = await import("../src/index.js");
    const { panel, clock } = panelAt();
    const queue = panel.viewable(200, { label: "Queue", status: { bad: 100 }, alert: {} });
    const lines: string[] = [];
    const notes: string[] = [];
    const posted: string[] = [];
    const hook = webhookSink({ url: "https://audit.example", fetch: (async (_url: string, init: RequestInit) => {
      posted.push(String(init.body));
      return new Response("", { status: 200 });
    }) as typeof fetch });
    panel.on("alert", jsonLineSink((line) => lines.push(line)).alert);
    panel.on("alert", notifySink({ notify: (event) => notes.push(event.title) }).alert);
    panel.on("alert", hook.alert);
    clock.advance(1000);
    panel.tick();
    await settle();
    expect(JSON.parse(lines[0] as string)).toMatchObject({ kind: "panel-alert", target: "queue", status: "bad", reading: 200, threshold: 100 });
    expect(notes).toEqual(["Queue: bad"]);
    expect(JSON.parse(posted[0] as string)).toMatchObject({ kind: "alert", label: "Queue" });
    void queue;
    panel.close();
  });
});
