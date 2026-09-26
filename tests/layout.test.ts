/**
 * The grid of cells: sizes in code, the arithmetic that scales them to a narrower screen, and the
 * layout saved for everybody — who may save it, where it is kept, and how replicas hear of it.
 */
import { describe, expect, it } from "vitest";
import { AdminPanelConfigError, createAdminPanel, defineTheme, memoryStore, memorySync } from "../src/index.js";
import { parseMessage } from "../src/panel/sync.js";
import { checkGrid, declaredSize, effectiveColumns, gather, pack, type Packable, type Placement, readLayout, scaledWidth, sizingOf } from "../src/panel/layout.js";
import { EVERYTHING } from "../src/testing.js";
import type { ItemSchema } from "../src/types.js";

describe("the arithmetic of cells", () => {
  it("has twelve columns on a desktop, four on a tablet, one on a phone, and one in a list", () => {
    expect(effectiveColumns(1400, 12)).toBe(12);
    expect(effectiveColumns(760, 12)).toBe(4);
    expect(effectiveColumns(400, 12)).toBe(1);
    expect(effectiveColumns(1400, 12, true)).toBe(1);
    expect(effectiveColumns(760, 6)).toBe(3);
  });

  it("scales a width to the columns there are, never below one or past all of them", () => {
    expect(scaledWidth(3, 12, 12)).toBe(3);
    expect(scaledWidth(3, 12, 4)).toBe(1);
    expect(scaledWidth(6, 12, 4)).toBe(2);
    expect(scaledWidth(12, 12, 4)).toBe(4);
    expect(scaledWidth(1, 12, 4)).toBe(1);
    expect(scaledWidth(12, 12, 1)).toBe(1);
  });

  it("chooses a size from what a card shows, where code gives none", () => {
    const value = { type: "value", id: "a", label: "A", kind: "number", writable: false } as unknown as ItemSchema;
    expect(declaredSize(value, 12)).toEqual({ w: 3, h: 2 });
    expect(declaredSize(value, 12, "plot")).toEqual({ w: 6, h: 5 });
    expect(declaredSize(value, 12, "bars")).toEqual({ w: 6, h: 4 });
    // A gauge is a reading over one bar: it is given no more rows than that takes.
    expect(declaredSize(value, 12, "gauge")).toEqual({ w: 4, h: 3 });
    expect(declaredSize({ ...value, writable: true } as ItemSchema, 12)).toEqual({ w: 4, h: 3 });
    expect(declaredSize({ type: "table", id: "t", title: "T" } as unknown as ItemSchema, 12)).toEqual({ w: 12, h: 5 });
    expect(declaredSize({ ...value, span: 2 } as ItemSchema, 12)).toEqual({ w: 6, h: 2 });
    expect(declaredSize({ ...value, size: { w: 5, h: 3 } } as ItemSchema, 12)).toEqual({ w: 5, h: 3 });
    // On a grid of six, a quarter of twelve is still about a quarter.
    expect(declaredSize(value, 6)).toEqual({ w: 2, h: 2 });
  });

  it("gathers cards by kind, and labels that share their first words side by side", () => {
    const cards = [
      { id: "players", family: "reading", label: "Players online" },
      { id: "latency", family: "chart", label: "Move latency" },
      { id: "p50", family: "reading", label: "Server move time p50" },
      { id: "games", family: "reading", label: "Active games" },
      { id: "p95", family: "reading", label: "Server move time p95" },
      { id: "flush", family: "action", label: "Flush" },
    ];
    expect(gather(cards).map((card) => card.id)).toEqual(["players", "p50", "p95", "games", "latency", "flush"]);
  });

  it("keeps what makes sense of a layout from a browser, and drops the rest", () => {
    expect(readLayout(null)).toBeUndefined();
    expect(readLayout({ g: { order: ["a", 3, "b"], sizes: { a: { w: 2, h: 2 }, b: { w: 0, h: 1 }, c: "x" } } })).toEqual({ g: { order: ["a", "b"], sizes: { a: { w: 2, h: 2 } } } });
    expect(readLayout({ g: [1], h: { nothing: true } })).toBeUndefined();
    expect(checkGrid({ columns: 30 })).toMatch(/1 to 24/);
    expect(checkGrid({ rowHeight: 10 })).toMatch(/24 to 400/);
    expect(checkGrid({ columns: 8, rowHeight: 60 })).toEqual({ columns: 8, rowHeight: 60 });
  });
});

describe("sizes and grids in code", () => {
  it("carries every card's size, each group's grid and the panel's in the schema", () => {
    const panel = createAdminPanel({ grid: { rowHeight: 80 } });
    panel.group("Games", { grid: { columns: 8 } });
    const players = panel.viewable(1, { label: "Players", group: "Games", size: { w: 4, h: 2 } });
    panel.action("Flush", () => "ok", { group: "Games", size: { w: 2, h: 1 } });
    panel.table("Rows", { group: "Games", columns: ["id"], rows: () => [], size: { w: 8, h: 6 } });
    panel.feed("Log", { group: "Other", size: { w: 6, h: 4 } });
    panel.profile("Busy", [[panel.modifiable(1, { label: "Limit", group: "Other" }), 2]], { size: { w: 3, h: 2 } });
    panel.chart({ title: "Load", series: [players], size: { w: 8, h: 3 } });
    const schema = panel.schema(EVERYTHING);
    expect(schema.grid).toEqual({ columns: 12, rowHeight: 80 });
    const games = schema.groups.find((group) => group.id === "games");
    expect(games?.grid).toEqual({ columns: 8, rowHeight: 80 });
    expect(games?.items.map((item) => item.size)).toEqual([{ w: 4, h: 2 }, { w: 8, h: 6 }, { w: 8, h: 3 }, { w: 2, h: 1 }]);
    expect(schema.groups.find((group) => group.id === "other")?.items.map((item) => item.size)).toContainEqual({ w: 6, h: 4 });
    expect(schema.groups.find((group) => group.id === "other")?.grid).toBeUndefined();
    panel.close();
  });

  it("refuses a size or a grid that is not whole cells within bounds, by name", () => {
    const panel = createAdminPanel();
    expect(() => panel.viewable(1, { label: "Wide", size: { w: 30, h: 2 } })).toThrow(/"Wide" has size .*w must be a whole number from 1 to 24/);
    expect(() => panel.viewable(1, { label: "Flat", size: { w: 2, h: 0 } })).toThrow(AdminPanelConfigError);
    expect(() => panel.group("G", { grid: { columns: 0 } })).toThrow(/group "G": grid.columns/);
    expect(() => createAdminPanel({ grid: { rowHeight: 2 } })).toThrow(/rowHeight/);
    panel.close();
  });
});

describe("themes a viewer may choose", () => {
  it("offers the built-in themes and any registered in code, the panel's first, or the panel's alone", () => {
    const brand = defineTheme({ name: "brand", label: "Brand" });
    const panel = createAdminPanel({ theme: "apple", themes: [brand] });
    panel.viewable(1, "One");
    const offered = panel.schema().theme.offered ?? [];
    expect(offered[0]).toEqual({ name: "apple", label: "Apple" });
    expect(offered.map((theme) => theme.name)).toEqual(expect.arrayContaining(["brand", "material", "carbon", "high-contrast"]));
    expect(panel.html({ snapshot: true })).toContain('[data-theme="brand"]');
    const alone = createAdminPanel({ themes: false });
    expect(alone.schema().theme.offered).toBeUndefined();
    expect(alone.html({ snapshot: true })).not.toContain("[data-theme=");
    expect(() => createAdminPanel({ themes: ["nope"] })).toThrow(/no built-in theme called "nope"/);
    panel.close();
    alone.close();
  });
});

describe("a layout saved for everybody", () => {
  const layout = { games: { order: ["value:b", "value:a"], sizes: { "value:a": { w: 6, h: 3 } } } };

  function panelWithTwoGroups(options: Parameters<typeof createAdminPanel>[0] = {}) {
    const panel = createAdminPanel(options);
    panel.viewable(1, { label: "A", id: "a", group: "Games" });
    panel.viewable(2, { label: "B", id: "b", group: "Games" });
    panel.viewable(3, { label: "C", id: "c", group: "Secret" });
    return panel;
  }

  it("is carried in the schema of the groups a viewer sees, and recorded", () => {
    const panel = panelWithTwoGroups();
    const structure = panel.schema().structure;
    expect(panel.saveLayout(layout, "ada", EVERYTHING, { reason: "tidier" })).toEqual({ ok: true });
    expect(panel.schema(EVERYTHING).layout).toEqual(layout);
    expect(panel.schema().structure).toBeGreaterThan(structure);
    expect(panel.schema({ ...EVERYTHING, groups: new Set(["Secret"]) }).layout).toBeUndefined();
    const record = panel.changes().at(-1);
    expect(record).toMatchObject({ kind: "layout", by: "ada", reason: "tidier", ok: true });
    expect(record?.revertible).toBe(false);
    expect(panel.saveLayout(null, "ada")).toEqual({ ok: true });
    expect(panel.layout()).toBeUndefined();
    panel.close();
  });

  it("changes only the groups the operator may edit, and keeps those they cannot see", () => {
    const panel = panelWithTwoGroups();
    panel.saveLayout({ ...layout, secret: { order: ["value:c"] } }, "root");
    // An operator who sees Games only saves Games; Secret keeps what it had.
    const gamesOnly = { ...EVERYTHING, groups: new Set(["Games"]) };
    expect(panel.saveLayout({ games: { order: ["value:a"] } }, "ada", gamesOnly)).toEqual({ ok: true });
    expect(panel.layout()).toEqual({ games: { order: ["value:a"] }, secret: { order: ["value:c"] } });
    const readOnly = { ...EVERYTHING, edit: false };
    expect(panel.saveLayout({ games: { order: ["value:b"] } }, "sam", readOnly)).toMatchObject({ ok: false, reason: "not-allowed" });
    expect(panel.saveLayout({ nowhere: { order: [] } }, "ada")).toMatchObject({ ok: false, reason: "invalid" });
    expect(panel.saveLayout("a string", "ada")).toMatchObject({ ok: false, reason: "invalid" });
    expect(panel.saveLayout({ games: { order: ["x".repeat(290)].concat(Array.from({ length: 400 }, (_, i) => `value:${"y".repeat(150)}${i}`)) } }, "ada")).toMatchObject({ ok: false, reason: "invalid" });
    panel.close();
  });

  it("outlives a restart where the panel has a store", async () => {
    const store = memoryStore();
    const first = panelWithTwoGroups({ store });
    await first.ready;
    first.saveLayout(layout, "ada");
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = panelWithTwoGroups({ store });
    await second.ready;
    expect(second.layout()).toEqual(layout);
    second.close();
  });

  it("reaches the other replicas, and a message about it survives the wire", async () => {
    const bus = memorySync();
    const one = panelWithTwoGroups({ sync: bus.connect(), instance: "one" });
    const two = panelWithTwoGroups({ sync: bus.connect(), instance: "two" });
    one.saveLayout(layout, "ada");
    await expect.poll(() => two.layout()).toEqual(layout);
    expect(two.changes().at(-1)).toMatchObject({ kind: "layout", by: "ada" });
    one.saveLayout(null, "ada");
    await expect.poll(() => two.layout()).toBeUndefined();
    expect(parseMessage(JSON.stringify({ type: "layout", origin: "x", layout: null, record: { by: "ada", kind: "layout", at: 1 } }))).toBeDefined();
    expect(parseMessage(JSON.stringify({ type: "layout", origin: "x", layout: null }))).toBeUndefined();
    one.close();
    two.close();
  });
});

/** Empty cells with a card somewhere below them in the same column: what the packer promises never to leave. */
function holes(placements: readonly Placement[], columns: number): number {
  const bottom = Math.max(0, ...placements.map((place) => place.y + place.h));
  const taken = new Set<string>();
  for (const place of placements) for (let x = place.x; x < place.x + place.w; x += 1) for (let y = place.y; y < place.y + place.h; y += 1) taken.add(`${x},${y}`);
  let count = 0;
  for (let x = 0; x < columns; x += 1) {
    const top = Math.max(0, ...placements.filter((place) => place.x <= x && x < place.x + place.w).map((place) => place.y + place.h));
    for (let y = 0; y < Math.min(top, bottom); y += 1) if (!taken.has(`${x},${y}`)) count += 1;
  }
  return count;
}

function overlaps(placements: readonly Placement[]): boolean {
  const taken = new Set<string>();
  for (const place of placements) for (let x = place.x; x < place.x + place.w; x += 1) for (let y = place.y; y < place.y + place.h; y += 1) {
    if (taken.has(`${x},${y}`)) return true;
    taken.add(`${x},${y}`);
  }
  return false;
}

describe("the packer", () => {
  const value = (id: string, extra: Record<string, unknown> = {}) => ({ type: "value", id, label: id, kind: "number", writable: false, ...extra }) as unknown as ItemSchema;
  const card = (item: ItemSchema, columns: number, chart?: "plot" | "bars"): Packable => ({ id: item.id, ...sizingOf(item, columns, chart) });
  // A panel like the chess server's Games tab: numbers, charts, bars, a heatmap, a table and actions.
  const chess = (columns: number): Packable[] => [
    card(value("players"), columns),
    card(value("active"), columns),
    card(value("started"), columns),
    card(value("rate"), columns, "plot"),
    card(value("p50"), columns),
    card(value("p95"), columns),
    card(value("p99"), columns),
    card(value("latency"), columns, "plot"),
    card(value("openings"), columns, "bars"),
    card(value("lengths"), columns, "bars"),
    card({ type: "chart", id: "heat", title: "Heat", kind: "heatmap", over: "time", placement: "group", series: [] } as unknown as ItemSchema, columns),
    card({ type: "table", id: "games", title: "Games" } as unknown as ItemSchema, columns),
    card({ type: "action", id: "end", label: "End" } as unknown as ItemSchema, columns),
    card({ type: "action", id: "draw", label: "Draw", input: [{ name: "game" }] } as unknown as ItemSchema, columns),
  ];

  it("leaves no empty cell under any card, at twelve, four and one columns", () => {
    for (const [columns, cards] of [[12, chess(12)], [4, chess(12).map((c) => ({ ...c, pref: { ...c.pref, w: scaledWidth(c.pref.w, 12, 4) }, min: { ...c.min, w: scaledWidth(c.min.w, 12, 4) }, max: { ...c.max, w: scaledWidth(c.max.w, 12, 4) } }))], [1, chess(1)]] as const) {
      const placements = pack(cards, columns);
      expect(placements).toHaveLength(cards.length);
      expect(overlaps(placements)).toBe(false);
      expect(holes(placements, columns)).toBe(0);
      expect(placements.every((place) => place.x + place.w <= columns)).toBe(true);
    }
  });

  it("keeps every card between its smallest and largest size, and a locked one exactly", () => {
    const cards = chess(12);
    cards[3] = { ...(cards[3] as Packable), pref: { w: 5, h: 3 }, min: { w: 5, h: 3 }, max: { w: 5, h: 3 }, locked: true };
    const placements = pack(cards, 12);
    for (const place of placements) {
      const given = cards.find((entry) => entry.id === place.id) as Packable;
      expect(place.w).toBeGreaterThanOrEqual(given.min.w);
      expect(place.w).toBeLessThanOrEqual(given.max.w);
      expect(place.h).toBeGreaterThanOrEqual(given.min.h);
      expect(place.h).toBeLessThanOrEqual(given.max.h);
    }
    expect(placements.find((place) => place.id === "rate")).toMatchObject({ w: 5, h: 3 });
  });

  it("fills the space beside a card set in code, sooner than leave a hole in the page", () => {
    // A card sized in code cannot be widened, and the card next in line needs more columns than are
    // left beside it: the one after, which fits, is brought forward rather than the space left empty.
    const cards: Packable[] = [
      { id: "fixed", pref: { w: 6, h: 5 }, min: { w: 6, h: 5 }, max: { w: 6, h: 5 }, locked: true },
      { id: "wide", pref: { w: 12, h: 4 }, min: { w: 8, h: 3 }, max: { w: 12, h: 8 }, locked: false },
      { id: "half", pref: { w: 6, h: 5 }, min: { w: 4, h: 4 }, max: { w: 12, h: 8 }, locked: false },
    ];
    const placements = pack(cards, 12, { reorder: false });
    expect(overlaps(placements)).toBe(false);
    expect(holes(placements, 12)).toBe(0);
    expect(placements.find((place) => place.id === "half")).toMatchObject({ x: 6, y: 0 });
    expect(placements.find((place) => place.id === "fixed")).toMatchObject({ x: 0, y: 0, w: 6, h: 5 });
  });

  it("ends square where the cards can grow, and fills a row nobody else could", () => {
    const numbers = ["a", "b", "c", "d", "e"].map((id) => card(value(id), 12));
    const placements = pack(numbers, 12);
    const bottoms = new Set(placements.map((place) => place.y + place.h));
    expect(holes(placements, 12)).toBe(0);
    // Five quarter-width numbers: four in a row, and the fifth widened to what it may take, not left a quarter.
    expect(placements.find((place) => place.id === "e")?.w).toBe(6);
    expect(bottoms.size).toBeLessThanOrEqual(2);
  });

  it("keeps the order it is given when it may not reorder", () => {
    const placements = pack(chess(12), 12, { reorder: false });
    const order = [...placements].sort((a, b) => a.y - b.y || a.x - b.x).map((place) => place.id);
    expect(placements.map((place) => place.id)).toEqual(chess(12).map((c) => c.id));
    expect(order[0]).toBe("players");
  });
});

