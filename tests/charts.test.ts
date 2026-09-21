import { describe, expect, it } from "vitest";
import type { ChartSchema } from "../src/index.js";
import { History } from "../src/values/history.js";
import { panelAt } from "./helpers.js";

function charts(panel: ReturnType<typeof panelAt>["panel"]): ChartSchema[] {
  return panel.schema().groups.flatMap((group) => group.items.filter((item): item is ChartSchema => item.type === "chart"));
}

describe("a chart of its own", () => {
  it("is drawn with its value and samples it as it changes", () => {
    const { panel, clock } = panelAt(10_000);
    const players = panel.viewable(1, { label: "Players", chart: true });
    clock.advance(1000);
    players.value = 5;
    clock.advance(1000);
    players.value = 7;
    const [chart] = charts(panel);
    expect(chart?.placement).toBe("alone");
    expect(chart?.kind).toBe("line");
    const key = chart?.series[0]?.history as string;
    expect(panel.state().series[key]).toEqual([
      [10_000, 1],
      [11_000, 5],
      [12_000, 7],
    ]);
  });

  it("coalesces writes within a bucket, the newest winning, so a hot counter cannot flood the ring", () => {
    const { panel, clock } = panelAt(10_000);
    const hits = panel.viewable(0, { label: "Hits", chart: true });
    for (let i = 1; i <= 1000; i += 1) hits.value = i;
    clock.advance(1500);
    hits.value = 2000;
    const key = charts(panel)[0]?.series[0]?.history as string;
    expect(panel.state().series[key]).toEqual([
      [10_000, 1000],
      [11_000, 2000],
    ]);
  });

  it("sends only the newest bucket onwards when asked for what came after", () => {
    const { panel, clock } = panelAt(10_000);
    const v = panel.viewable(0, { label: "v", chart: true });
    for (let i = 1; i <= 5; i += 1) {
      clock.advance(1000);
      v.value = i;
    }
    const key = charts(panel)[0]?.series[0]?.history as string;
    expect(panel.state(undefined, undefined, 14_500).series[key]).toEqual([
      [14_000, 4],
      [15_000, 5],
    ]);
  });

  it("samples a value read from a function on a timer, since it cannot announce a change", () => {
    const { panel, clock } = panelAt(0);
    let depth = 3;
    panel.viewable(() => depth, { label: "Depth", chart: true });
    panel.tick();
    clock.advance(1000);
    depth = 8;
    panel.tick();
    clock.advance(400);
    depth = 9;
    panel.tick();
    const key = charts(panel)[0]?.series[0]?.history as string;
    expect(panel.state().series[key]).toEqual([
      [0, 3],
      [1000, 8],
    ]);
    panel.close();
  });

  it("plots one value against another, sampled together", () => {
    const { panel, clock } = panelAt(0);
    const load = panel.viewable(10, "Load");
    const latency = panel.viewable(20, { label: "Latency", chart: { over: load } });
    clock.advance(1000);
    load.value = 50;
    latency.value = 80;
    const [chart] = charts(panel);
    expect(chart?.over).toEqual({ value: "load", label: "Load" });
    expect(panel.state().series[chart?.series[0]?.history as string]).toEqual([
      [0, 20, 10],
      [1000, 80, 50],
    ]);
  });

  it("over keys draws the current record and keeps no history", () => {
    const { panel } = panelAt();
    panel.viewable({ blitz: 3, rapid: 1 }, { label: "Queue", chart: { over: "keys" } });
    const [chart] = charts(panel);
    expect(chart?.kind).toBe("bar");
    expect(chart?.series[0]?.history).toBeUndefined();
    expect(panel.state().series).toEqual({});
  });
});

describe("a chart shared by a group", () => {
  it("collects every value naming its title, in legend order with a colour slot each", () => {
    const { panel } = panelAt();
    panel.viewable(1, { label: "Sent", group: "Mail", chart: { in: "Throughput" } });
    panel.viewable(2, { label: "Bounced", group: "Mail", chart: { in: "Throughput" } });
    const shared = charts(panel).filter((chart) => chart.placement === "group");
    expect(shared).toHaveLength(1);
    expect(shared[0]?.series.map((series) => [series.label, series.slot])).toEqual([
      ["Sent", 1],
      ["Bounced", 2],
    ]);
  });

  it("can be declared explicitly over values that exist", () => {
    const { panel } = panelAt();
    const a = panel.viewable(1, "a");
    const b = panel.viewable(2, "b");
    panel.chart({ title: "Both", series: [a, b], kind: "area", group: "Charts" });
    const group = panel.schema().groups.find((entry) => entry.title === "Charts");
    expect(group?.items[0]).toMatchObject({ type: "chart", title: "Both", kind: "area", placement: "group" });
  });

  it("is drawn after the group's values and before its actions", () => {
    const { panel } = panelAt();
    panel.viewable(1, { label: "a", chart: { in: "Shared" } });
    panel.action("Do it", () => undefined);
    panel.viewable(2, { label: "b", chart: { in: "Shared" } });
    expect(panel.schema().groups[0]?.items.map((item) => item.type)).toEqual(["value", "value", "chart", "action"]);
  });
});

describe("charts that could not draw what they claim", () => {
  it("are refused at declaration", () => {
    const { panel } = panelAt();
    expect(() => panel.viewable("text", { label: "a", chart: true })).toThrow(/only numbers and booleans can be plotted over time/);
    expect(() => panel.viewable(5, { label: "b", chart: { over: "keys" } })).toThrow(/only a record or an array has keys/);
    expect(() => panel.viewable(5, { label: "c", chart: "gauge" })).toThrow(/no maximum to fill towards/);
    expect(() => panel.viewable(5, { label: "d", chart: { points: 1_000_000 } })).toThrow(/from 2 to 10000/);
    expect(() => panel.viewable(5, { label: "e", chart: { sampleEveryMs: 10 } })).toThrow(/shortest interval is 250ms/);
    expect(() => panel.viewable(5, { label: "f", sensitive: true, chart: true })).toThrow(/a chart of a secret is the secret/);
    expect(() => panel.viewable(5, { label: "g", chart: "pie" as never })).toThrow(/the kinds are/);
    expect(() => panel.viewable(5, { label: "h", chart: { colour: "red" } as never })).toThrow(/"colour" that nothing reads/);
  });

  it("refuses a ninth series, because there are eight colour slots", () => {
    const { panel } = panelAt();
    for (let i = 0; i < 8; i += 1) panel.viewable(i, { label: `s${i}`, chart: { in: "Many" } });
    expect(() => panel.viewable(9, { label: "s9", chart: { in: "Many" } })).toThrow(/already draws 8 series/);
  });

  it("takes a gauge's maximum from the value when the chart has none", () => {
    const { panel } = panelAt();
    panel.modifiable(40, { label: "Rate", max: 100, chart: "gauge" });
    expect(charts(panel)[0]).toMatchObject({ kind: "gauge", min: 0, max: 100 });
  });
});

describe("the history ring", () => {
  it("keeps the newest samples, oldest first, and never grows", () => {
    const ring = new History(3, 1000, false);
    for (let t = 0; t < 5; t += 1) ring.record(t * 1000, t);
    expect(ring.samples()).toEqual([
      [2000, 2],
      [3000, 3],
      [4000, 4],
    ]);
    expect(ring.length).toBe(3);
  });

  it("folds a sample from a clock that stepped backwards into the newest bucket rather than scrambling the order", () => {
    const ring = new History(5, 1000, false);
    ring.record(5000, 1);
    ring.record(3000, 2);
    expect(ring.samples()).toEqual([[5000, 2]]);
  });
});
