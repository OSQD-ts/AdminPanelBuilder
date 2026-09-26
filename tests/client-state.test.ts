/** The page's store and its per-viewer preferences: DOM-free, so they are tested here. */
import { afterEach, describe, expect, it } from "vitest";
import { loadPrefs } from "../src/client/prefs.js";
import { createStore, mergeState, serverTime } from "../src/client/store.js";
import { panelAt } from "./helpers.js";

describe("the page's store", () => {
  it("merges deltas: values by id, samples by time, feed entries by sequence, bounded by the schema", () => {
    const { panel, clock } = panelAt(0);
    const players = panel.viewable(1, { label: "Players", chart: { points: 3 } });
    const feed = panel.feed("Log", { capacity: 2 });
    const store = createStore(panel.schema(), panel.state());
    for (let i = 2; i <= 5; i += 1) {
      clock.advance(1000);
      players.value = i;
      feed.push(`entry ${i}`);
    }
    mergeState(store, panel.state(undefined, store.version, store.serverNow, store.feedSeq), false);
    const key = [...store.series.keys()][0] as string;
    expect(store.series.get(key)).toHaveLength(3);
    expect(store.values.get("players")?.value).toBe(5);
    expect(store.feeds.get("log")?.entries.map((entry) => entry.text)).toEqual(["entry 4", "entry 5"]);
    expect(store.revision).toBe(2);
    expect(Math.abs(serverTime(store) - Date.now() + store.skew)).toBeLessThan(50);
  });

  it("carries pending proposals and profiles in force", () => {
    const { panel } = panelAt();
    const limit = panel.modifiable(1, { label: "Limit", approval: true });
    const flag = panel.modifiable(false, "Flag");
    panel.profile("On", [[flag, true]]);
    panel.edit("limit", 2, "ada", { groups: undefined, edit: true, actions: false, restrictions: [] }, { reason: "a test" });
    flag.set(true);
    const store = createStore(panel.schema(), panel.state());
    expect(store.pending.map((change) => change.target)).toEqual(["limit"]);
    expect(store.activeProfiles.has("on")).toBe(true);
    expect(limit.value).toBe(1);
  });
});

describe("per-viewer preferences", () => {
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = original;
  });

  it("round-trip through localStorage", () => {
    const saved = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => void saved.set(key, value) };
    const prefs = loadPrefs("apb:test");
    prefs.pinned.add("value:a");
    prefs.collapsed.add("chart:b");
    prefs.save();
    const again = loadPrefs("apb:test");
    expect([...again.pinned]).toEqual(["value:a"]);
    expect([...again.collapsed]).toEqual(["chart:b"]);
  });

  it("store only what a viewer chose, and put every choice back", () => {
    const saved = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => void saved.set(key, value) };
    const prefs = loadPrefs("apb:test");
    // Defaults are not written, so a default that changes later reaches a viewer who never chose.
    prefs.save();
    expect(JSON.parse(saved.get("apb:test") as string)).toEqual({ pinned: [], collapsed: [] });
    Object.assign(prefs, { scheme: "dark", language: "de", theme: "carbon", density: "compact", flash: false, motion: false, trends: false, layout: { game: { order: ["value:a"] } } });
    prefs.pinned.add("value:a");
    prefs.save();
    const chosen = loadPrefs("apb:test");
    expect([chosen.scheme, chosen.language, chosen.theme, chosen.density, chosen.flash, chosen.motion, chosen.trends]).toEqual(["dark", "de", "carbon", "compact", false, false, false]);
    expect(chosen.layout?.game?.order).toEqual(["value:a"]);
    // Reset puts the panel's own back, and keeps what is not a setting: pins, folds and the layout.
    chosen.reset();
    const after = loadPrefs("apb:test");
    expect([after.scheme, after.language, after.theme, after.density, after.flash, after.motion, after.trends]).toEqual([undefined, undefined, undefined, undefined, true, true, true]);
    expect([[...after.pinned], after.layout?.game?.order]).toEqual([["value:a"], ["value:a"]]);
  });

  it("work without storage, and ignore what storage holds that is not theirs", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("quota");
      },
    };
    const prefs = loadPrefs("apb:test");
    expect(prefs.pinned.size).toBe(0);
    prefs.pinned.add("x");
    expect(() => prefs.save()).not.toThrow();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({ pinned: [1, "ok"], collapsed: "nope" }), setItem: () => undefined };
    expect([...loadPrefs("apb:test").pinned]).toEqual(["ok"]);
  });
});
