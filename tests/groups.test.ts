import { describe, expect, it } from "vitest";
import { createAdminPanel } from "../src/index.js";
import { EVERYTHING } from "../src/testing.js";
import { panelAt } from "./helpers.js";

const titles = (panel: ReturnType<typeof panelAt>["panel"]) => panel.schema().groups.map((group) => group.title);
const itemsOf = (panel: ReturnType<typeof panelAt>["panel"], title: string) => panel.schema().groups.find((group) => group.title === title)?.items.map((item) => item.id);

describe("grouping values", () => {
  it("puts anything declared without a group in the default one", () => {
    const { panel } = panelAt();
    panel.viewable(1, "a");
    expect(titles(panel)).toEqual(["General"]);
  });

  it("groups at declaration", () => {
    const { panel } = panelAt();
    panel.modifiable(10, { label: "a", group: "red" });
    panel.viewable(1, { label: "b", group: "blue" });
    expect(titles(panel)).toEqual(["red", "blue"]);
    expect(itemsOf(panel, "red")).toEqual(["a"]);
  });

  it("moves a value into a group after the fact, from the panel or from the value", () => {
    const { panel } = panelAt();
    const a = panel.viewable(1, "a");
    const b = panel.viewable(2, "b");
    panel.group("red").add(a);
    b.moveTo("red");
    expect(titles(panel)).toEqual(["red"]);
    expect(itemsOf(panel, "red")).toEqual(["a", "b"]);
  });

  it("leaves an emptied group off the page rather than showing an empty tab", () => {
    const { panel } = panelAt();
    const a = panel.viewable(1, { label: "a", group: "old" });
    a.moveTo("new");
    expect(titles(panel)).toEqual(["new"]);
  });

  it("orders tabs by their order, then by first mention; and items the same way within a group", () => {
    const { panel } = panelAt();
    panel.viewable(1, { label: "a", group: "second" });
    panel.viewable(1, { label: "b", group: "first" });
    panel.group("first", { order: -1, title: "First of all", description: "Shown first." });
    panel.viewable(1, { label: "late", group: "second", order: -5 });
    expect(titles(panel)).toEqual(["First of all", "second"]);
    expect(itemsOf(panel, "second")).toEqual(["late", "a"]);
    expect(panel.schema().groups[0]?.description).toBe("Shown first.");
  });

  it("tells every page to reload its layout when anything moves", () => {
    const { panel } = panelAt();
    const a = panel.viewable(1, "a");
    const before = panel.schema().structure;
    a.moveTo("elsewhere");
    expect(panel.schema().structure).toBeGreaterThan(before);
  });

  it("declares straight into a group from its handle", () => {
    const { panel } = panelAt();
    const matchmaking = panel.group("Matchmaking");
    matchmaking.viewable(3, "Queue");
    matchmaking.modifiable(200, { label: "Gap", min: 0, max: 1000 });
    matchmaking.action("Clear", () => undefined);
    expect(itemsOf(panel, "Matchmaking")).toEqual(["queue", "gap", "clear"]);
  });

  it("declares every kind of card from the handle, counters, charts and profiles included", () => {
    const panel = createAdminPanel();
    const games = panel.group("Games");
    const config = { limit: 5 };
    const started = games.counter("Games started");
    const latency = games.percentiles("Move time", { unit: "ms" });
    const rate = games.rate("Moves per second", () => 3);
    const limit = games.bind(config, "limit", { label: "Limit", editable: true });
    games.chart({ title: "Load", series: [rate] });
    const elsewhere = panel.modifiable(false, { label: "Guests", group: "Settings" });
    games.profile("Tournament", [[elsewhere, true]]);
    started.inc();
    latency.record(10);
    const ids = panel.schema(EVERYTHING).groups.find((group) => group.id === "games")?.items.map((item) => `${item.type}:${item.id}`) ?? [];
    expect(ids).toEqual(expect.arrayContaining(["value:games-started", "value:moves-per-second", "value:limit", "chart:games-load-chart", "value:move-time-p95", "profile:tournament"]));
    expect([limit.group, rate.group]).toEqual(["Games", "Games"]);
    expect(panel.schema(EVERYTHING).groups.find((group) => group.id === "settings")?.items.map((item) => item.id)).toEqual(["guests"]);
    panel.close();
  });

  it("refuses a value from another panel instead of adopting it", () => {
    const one = panelAt().panel;
    const two = panelAt().panel;
    const foreign = one.viewable(1, "foreign");
    expect(() => two.group("x").add(foreign)).toThrow(/declared on another panel/);
  });

  it("applies a new title or theme on the next request, and refuses a bad one whole", () => {
    const { panel } = panelAt();
    panel.viewable(1, "a");
    panel.configure({ title: "Renamed", theme: "apple", colorScheme: "dark" });
    const schema = panel.schema();
    expect(schema.title).toBe("Renamed");
    expect(schema.theme).toMatchObject({ name: "apple", scheme: "dark" });
    expect(schema.theme.offered?.[0]).toEqual({ name: "apple", label: "Apple" });
    expect(() => panel.configure({ title: "Half", pollIntervalMs: 10 })).toThrow(/pollIntervalMs is 10/);
    expect(panel.schema().title).toBe("Renamed");
    expect(() => panel.configure({ theme: "materiel" })).toThrow(/no built-in theme called "materiel"/);
  });
});
