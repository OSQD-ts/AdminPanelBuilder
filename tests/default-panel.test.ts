import { afterEach, describe, expect, it } from "vitest";
import { action, bind, configure, defaultPanel, group, memoryStore, modifiable, viewable } from "../src/index.js";
import { resetDefaultPanel } from "../src/default-panel.js";

afterEach(() => resetDefaultPanel());

describe("the default panel", () => {
  it("is what the bare functions declare on, created on first use", () => {
    const x = viewable(10);
    const y = modifiable(5, { label: "Limit", group: "red" });
    const config = { mode: "fast" };
    bind(config, "mode");
    action("Go", () => "went");
    group("red", { order: -1 });
    expect(x.value).toBe(10);
    expect(y.value).toBe(5);
    expect(defaultPanel().schema().groups.map((entry) => entry.title)).toEqual(["red", "General"]);
  });

  it("takes every setting before the first declaration, and only swappable ones after", () => {
    configure({ title: "Configured early", store: memoryStore() });
    viewable(1, "a");
    expect(defaultPanel().schema().title).toBe("Configured early");
    configure({ title: "Renamed later", theme: "apple" });
    expect(defaultPanel().schema().title).toBe("Renamed later");
    expect(() => configure({ store: memoryStore() })).toThrow(/store can only be configured before the first declaration/);
  });
});

describe("the default panel's building blocks", () => {
  it("declares tables, feeds, profiles, counters, rates and percentiles on the default panel", async () => {
    const { table, feed, profile, counter, rate, percentiles, modifiable: declare } = await import("../src/index.js");
    table("Rows", { columns: ["id"], rows: [{ id: "a" }] });
    feed("Log").push("hello");
    const flag = declare(false, "Flag");
    profile("On", [[flag, true]]);
    counter("Hits").inc();
    rate("Per second", () => 1);
    percentiles("Latency").record(5);
    const types = defaultPanel()
      .schema()
      .groups.flatMap((group) => group.items.map((item) => item.type));
    expect(new Set(types)).toEqual(new Set(["table", "feed", "value", "profile", "chart"]));
    expect(() => configure({ changeLog: undefined, locale: "pl" })).toThrow(/locale can only be configured/);
  });
});
