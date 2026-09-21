import { describe, expect, it } from "vitest";
import type { PanelScope, TableQuery } from "../src/index.js";
import { panelAt } from "./helpers.js";

const all: PanelScope = { groups: undefined, edit: true, actions: true, restrictions: [] };
const query = (over: Partial<TableQuery> = {}) => ({ offset: 0, limit: 10, direction: "asc" as const, search: "", ...over });

describe("statuses", () => {
  it("flag a value past its thresholds, rising or falling, with a word the page shows", () => {
    const { panel } = panelAt();
    const queue = panel.viewable(5, { label: "Queue", status: { warn: 100, bad: 1000 } });
    const disk = panel.viewable(50, { label: "Free disk", status: { warn: 20, bad: 5, below: true } });
    const wire = (id: string) => panel.state().values.find((value) => value.id === id)?.status;
    expect(wire("queue")).toBe("ok");
    queue.value = 150;
    expect(wire("queue")).toBe("warn");
    queue.value = 5000;
    expect(wire("queue")).toBe("bad");
    disk.value = 3;
    expect(wire("free-disk")).toBe("bad");
  });

  it("are refused when they could never read as declared", () => {
    const { panel } = panelAt();
    expect(() => panel.viewable(1, { label: "a", status: { warn: 10, bad: 5 } })).toThrow(/bad before it ever warned/);
    expect(() => panel.viewable(1, { label: "b", status: {} })).toThrow(/would never fire/);
    expect(() => panel.viewable(1, { label: "c", status: { warm: 1 } as never })).toThrow(/"warm" that nothing reads/);
  });

  it("take a function, and a function that throws means no status rather than a failed poll", () => {
    const { panel } = panelAt();
    panel.viewable("down", { label: "Link", status: (value: string) => (value === "down" ? "bad" : "ok") });
    panel.viewable(1, {
      label: "Broken",
      status: () => {
        throw new Error("rule bug");
      },
    });
    const state = panel.state();
    expect(state.values.find((value) => value.id === "link")?.status).toBe("bad");
    expect(state.values.find((value) => value.id === "broken")?.status).toBeUndefined();
  });
});

describe("tables", () => {
  const games = Array.from({ length: 30 }, (_, index) => ({ id: `g${index}`, white: index % 2 === 0 ? "ada" : "sam", rating: 1000 + index * 10 }));

  it("page, sort and search rows the panel holds", async () => {
    const { panel } = panelAt();
    panel.table("Games", { columns: ["id", "white", { key: "rating", format: "integer" }], rows: games, pageSize: 10 });
    const first = await panel.tableRows("games", query(), all);
    expect(first?.total).toBe(30);
    expect(first?.rows).toHaveLength(10);
    const sorted = await panel.tableRows("games", query({ sort: "rating", direction: "desc", limit: 2 }), all);
    expect(sorted?.rows.map((row) => row.cells.rating)).toEqual([1290, 1280]);
    const searched = await panel.tableRows("games", query({ search: "SAM" }), all);
    expect(searched?.total).toBe(15);
  });

  it("hand a query to fetch, and cap the page whatever is asked", async () => {
    const { panel } = panelAt();
    const seen: TableQuery[] = [];
    panel.table("Mail", {
      columns: ["id"],
      fetch: (q) => {
        seen.push(q);
        return { rows: [{ id: "m1" }], total: 5000 };
      },
    });
    const page = await panel.tableRows("mail", query({ limit: 10_000, search: "x".repeat(500) }), all);
    expect(seen[0]?.limit).toBe(200);
    expect(seen[0]?.search).toHaveLength(200);
    expect(page?.total).toBe(5000);
  });

  it("do not sort by a column that is not sortable", async () => {
    const { panel } = panelAt();
    panel.table("T", { columns: [{ key: "id", sortable: false }], rows: [{ id: "b" }, { id: "a" }] });
    const page = await panel.tableRows("t", query({ sort: "id" }), all);
    expect(page?.rows.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("run a row action with the row's id, and record it", async () => {
    const { panel } = panelAt();
    panel.table("Players", { columns: ["id"], rows: [{ id: "p1" }], actions: [{ label: "Ban", run: (row, { by }) => `banned ${row} for ${by}`, destructive: true }] });
    expect(await panel.runRowAction("players", "ban", "p1", "ada", all)).toEqual({ ok: true, message: "banned p1 for ada" });
    expect(panel.changes()[0]).toMatchObject({ kind: "action", by: "ada", label: "Ban (Players: p1)" });
    expect(await panel.runRowAction("players", "ban", "p1", "ada", { ...all, actions: false })).toMatchObject({ ok: false, reason: "not-allowed" });
  });

  it("flag cells past a column's thresholds", async () => {
    const { panel } = panelAt();
    panel.table("Q", { columns: [{ key: "depth", status: { warn: 10 } }], rows: [{ id: "a", depth: 50 }] });
    expect((await panel.tableRows("q", query(), all))?.rows[0]?.status).toEqual({ depth: "warn" });
  });

  it("are refused when they could not show anything", () => {
    const { panel } = panelAt();
    expect(() => panel.table("A", { columns: [] })).toThrow(/no columns/);
    expect(() => panel.table("B", { columns: ["id"] })).toThrow(/exactly one of rows/);
    expect(() => panel.table("C", { columns: ["id"], rows: [], pageSize: 1000 })).toThrow(/page size/);
    expect(() => panel.table("D", { columns: ["id", "id"], rows: [] })).toThrow(/twice/);
  });

  it("fail a slow source rather than holding the page", async () => {
    const { panel } = panelAt();
    panel.table("Slow", { columns: ["id"], fetch: () => new Promise<never>(() => undefined), timeoutMs: 20 });
    await expect(panel.tableRows("slow", query(), all)).rejects.toThrow(/did not finish within 20ms/);
  });
});

describe("feeds", () => {
  it("keep the newest entries, and send only what a page has not seen", () => {
    const { panel } = panelAt();
    const feed = panel.feed("Bounces", { capacity: 3 });
    for (let i = 1; i <= 5; i += 1) feed.push(`bounce ${i}`);
    const first = panel.state().feeds.bounces;
    expect(first?.entries.map((entry) => entry.text)).toEqual(["bounce 3", "bounce 4", "bounce 5"]);
    const seq = panel.state().feedSeq;
    feed.push({ to: "a@b.c", code: 550 }, "warn");
    const next = panel.state(undefined, undefined, undefined, seq).feeds.bounces?.entries;
    expect(next).toHaveLength(1);
    expect(next?.[0]).toMatchObject({ level: "warn", text: "to=a@b.c code=550", fields: { to: "a@b.c", code: 550 } });
  });

  it("drop and count past their rate, rather than queue", () => {
    const { panel, clock } = panelAt();
    const feed = panel.feed("Hits", { perSecond: 2 });
    expect([feed.push("a"), feed.push("b"), feed.push("c")]).toEqual([true, true, false]);
    expect(panel.state().feeds.hits).toMatchObject({ dropped: 1, total: 2 });
    clock.advance(1000);
    expect(feed.push("d")).toBe(true);
  });
});

describe("profiles", () => {
  it("apply every setting at once with one change record, and say when they are in force", () => {
    const { panel } = panelAt();
    const maintenance = panel.modifiable(false, "Maintenance");
    const motd = panel.modifiable("", { label: "Message", maxLength: 50 });
    panel.profile("Maintenance window", [
      [maintenance, true],
      [motd, "Back soon"],
    ]);
    expect(panel.state().activeProfiles).toEqual([]);
    expect(panel.applyProfile("maintenance-window", "ada", all).ok).toBe(true);
    expect([maintenance.value, motd.value]).toEqual([true, "Back soon"]);
    expect(panel.state().activeProfiles).toEqual(["maintenance-window"]);
    expect(panel.changes().filter((change) => change.kind === "profile")).toHaveLength(1);
  });

  it("apply nothing when the listener may not edit every value", () => {
    const { panel } = panelAt();
    const a = panel.modifiable(1, { label: "a", group: "One" });
    const b = panel.modifiable(1, { label: "b", group: "Two" });
    panel.profile("Both", [
      [a, 2],
      [b, 2],
    ]);
    const outcome = panel.applyProfile("both", "ada", { ...all, edit: new Set(["One"]) });
    expect(outcome).toMatchObject({ ok: false, reason: "not-allowed" });
    expect([a.value, b.value]).toEqual([1, 1]);
  });

  it("are refused when a setting could never be applied, or would skip an approval", () => {
    const { panel } = panelAt();
    const limit = panel.modifiable(1, { label: "Limit", max: 10 });
    const guarded = panel.modifiable(1, { label: "Guarded", approval: true });
    const shown = panel.viewable(1, "Shown");
    expect(() => panel.profile("Too far", [[limit, 99]])).toThrow(/which it refuses/);
    expect(() => panel.profile("Sneaky", [[guarded, 2]])).toThrow(/without one/);
    expect(() => panel.profile("Readonly", [[shown, 2]])).toThrow(/not modifiable/);
  });
});

describe("action input", () => {
  it("is checked like a value before the action sees it", async () => {
    const { panel } = panelAt();
    panel.action("Ban", ({ input }) => `banned ${String(input.player)} for ${String(input.hours)}h`, {
      input: { player: { maxLength: 20, pattern: /^[a-z0-9]+$/ }, hours: { kind: "number", min: 1, max: 72, default: 24 }, reason: { optional: true } },
    });
    expect(await panel.run("ban", "ada", all, { player: "sam", hours: 2 })).toEqual({ ok: true, message: "banned sam for 2h" });
    expect(await panel.run("ban", "ada", all, { player: "sam", hours: 500 })).toMatchObject({ ok: false, reason: "invalid", message: "hours must be at most 72" });
    expect(await panel.run("ban", "ada", all, { hours: 2 })).toMatchObject({ ok: false, message: "player is required" });
    expect(await panel.run("ban", "ada", all, { player: "sam", hours: 2, extra: 1 })).toMatchObject({ ok: false, message: 'there is no input field "extra"' });
    expect(panel.schema(all).groups[0]?.items[0]).toMatchObject({ type: "action", input: [{ name: "player" }, { name: "hours", default: 24 }, { name: "reason", optional: true }] });
  });

  it("refuses a default the field itself refuses", () => {
    const { panel } = panelAt();
    expect(() => panel.action("X", () => undefined, { input: { n: { kind: "number", max: 5, default: 9 } } })).toThrow(/defaults to 9/);
  });
});

describe("counters, rates and percentiles", () => {
  it("count up, and read a reset as a reset rather than a negative rate", () => {
    const { panel, clock } = panelAt(0);
    const requests = panel.counter("Requests", { windowMs: 4000 });
    for (let second = 0; second < 5; second += 1) {
      requests.inc(10);
      panel.tick();
      clock.advance(1000);
    }
    expect(requests.total.value).toBe(50);
    expect(requests.rate.value).toBe(10);
    requests.reset();
    requests.inc(10);
    panel.tick();
    expect(requests.rate.value).toBeGreaterThan(0);
    expect(() => requests.inc(-1)).toThrow(/only goes up/);
    panel.close();
  });

  it("export a counter as a counter", () => {
    const { panel } = panelAt();
    panel.counter("Hits");
    expect(panel.metricValues({ groups: undefined, edit: false, actions: false, restrictions: [] }).find((entry) => entry.id === "hits")?.counter).toBe(true);
    panel.close();
  });

  it("compute percentiles over the recent window, charted together", () => {
    const { panel } = panelAt(0);
    const latency = panel.percentiles("Latency", { unit: "ms" });
    for (let i = 1; i <= 100; i += 1) latency.record(i);
    panel.tick();
    expect([...latency.values].map(([p, value]) => [p, value.value])).toEqual([
      [50, 50],
      [95, 95],
      [99, 99],
    ]);
    expect(panel.schema().groups[0]?.items.filter((item) => item.type === "chart")).toHaveLength(1);
    panel.close();
  });
});
