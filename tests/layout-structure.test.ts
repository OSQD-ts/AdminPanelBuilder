/**
 * Sections, list cards, dividers, spacers and breaks: what code declares, what it refuses at startup,
 * and what the schema carries to the page. A panel that uses none of it sends what it always sent.
 */
import { describe, expect, it } from "vitest";
import { AdminPanelConfigError, MAX_LAYOUT_MARKS_PER_GROUP, MAX_LIST_CARD_VALUES, MAX_SECTIONS_PER_GROUP } from "../src/index.js";
import { SPAN_WIDTHS, sizingOf } from "../src/panel/layout.js";
import type { GroupSchema, ItemSchema } from "../src/types.js";
import { call, panelAt, routerFor } from "./helpers.js";

const groupOf = (panel: ReturnType<typeof panelAt>["panel"], title: string): GroupSchema => {
  const group = panel.schema().groups.find((entry) => entry.title === title);
  if (group === undefined) throw new Error(`no group ${title}`);
  return group;
};

describe("a panel that declares no layout", () => {
  it("sends no section, card or mark fields at all", () => {
    const { panel } = panelAt();
    panel.viewable(1, { label: "a", group: "Main" });
    panel.modifiable(2, { label: "b", group: "Main", span: "half" });
    panel.action("Go", () => "ok", { group: "Main" });
    const group = groupOf(panel, "Main");
    for (const key of ["sections", "cards", "marks", "sectionTabs", "outline", "filter", "density"]) expect(group).not.toHaveProperty(key);
    for (const item of group.items) for (const key of ["section", "card", "emphasis"]) expect(item).not.toHaveProperty(key);
  });
});

describe("sections and list cards", () => {
  it("puts values in sections, in the order given, and gathers values into a list card", () => {
    const { panel } = panelAt();
    const server = panel.group("Server", { filter: true, outline: false, density: "compact" });
    server.section("Later", { order: 2 });
    server.section("Right now", { description: "This minute.", order: 1 });
    server.section("Health", { collapsed: true, density: "compact", columns: 6, order: 3 });
    server.card("Limits", { section: "Later", layout: "columns:2", span: "half", emphasis: "secondary" });
    server.viewable(1, { label: "Players", section: "Right now", emphasis: "primary" });
    server.modifiable(10, { label: "Max", card: "Limits" });
    server.modifiable(20, { label: "Min", card: "Limits" });
    server.viewable("ok", { label: "Database", section: "Health" });
    const group = groupOf(panel, "Server");
    expect(group.sections?.map((section) => section.title)).toEqual(["Right now", "Later", "Health"]);
    expect(group.sections?.[0]).toMatchObject({ id: "right-now", description: "This minute.", collapsible: true });
    expect(group.sections?.[2]).toMatchObject({ collapsed: true, density: "compact", columns: 6 });
    expect(group.cards).toEqual([{ id: "card-limits", title: "Limits", layout: "columns:2", span: "half", emphasis: "secondary" }]);
    const byLabel = (label: string) => group.items.find((item) => "label" in item && item.label === label) as ItemSchema;
    expect(byLabel("Players")).toMatchObject({ section: "right-now", emphasis: "primary" });
    // A value in a card is in the card's section.
    expect(byLabel("Max")).toMatchObject({ section: "later", card: "card-limits" });
    expect(group).toMatchObject({ filter: true, outline: false, density: "compact" });
  });

  it("makes a section named only by a value, and a card named only by its values", () => {
    const { panel } = panelAt();
    panel.viewable(1, { label: "a", group: "G", section: "Odd" });
    panel.viewable(2, { label: "b", group: "G", card: "Pair" });
    panel.viewable(3, { label: "c", group: "G", card: "Pair" });
    const group = groupOf(panel, "G");
    expect(group.sections?.map((section) => section.title)).toEqual(["Odd"]);
    expect(group.cards?.[0]).toMatchObject({ title: "Pair", layout: "list" });
  });

  it("shows sections as sub-tabs when the group asks", () => {
    const { panel } = panelAt();
    const stages = panel.group("Stages", { sections: "tabs" });
    stages.section("A");
    stages.viewable(1, { label: "a", section: "A" });
    expect(groupOf(panel, "Stages").sectionTabs).toBe(true);
  });

  it("drops a moved value's section and card", () => {
    const { panel } = panelAt();
    const value = panel.viewable(1, { label: "a", group: "One", section: "S", card: "C" });
    panel.viewable(2, { label: "b", group: "One", section: "S" });
    value.moveTo("Two");
    const item = groupOf(panel, "Two").items[0] as ItemSchema;
    expect(item).not.toHaveProperty("section");
    expect(item).not.toHaveProperty("card");
  });
});

describe("dividers, spacers and breaks", () => {
  it("places each before the next item of its section, or at the section's end", () => {
    const { panel } = panelAt();
    const g = panel.group("G");
    g.viewable(1, { label: "a" });
    g.divider({ label: "Machines" });
    g.viewable(2, { label: "b" });
    g.spacer({ size: "lg" });
    g.break();
    const group = groupOf(panel, "G");
    expect(group.marks?.map((mark) => [mark.kind, mark.before])).toEqual([
      ["divider", "value:b"],
      ["spacer", undefined],
      ["break", undefined],
    ]);
    expect(group.marks?.[0]?.label).toBe("Machines");
    expect(group.marks?.[1]?.size).toBe("lg");
  });

  it("keeps a group with marks in the order it was declared, not gathered by kind", () => {
    const { panel } = panelAt();
    const g = panel.group("G");
    g.action("Go", () => "ok");
    g.viewable(1, { label: "a" });
    g.divider();
    g.modifiable(true, { label: "b" });
    expect(groupOf(panel, "G").items.map((item) => item.type)).toEqual(["action", "value", "value"]);
  });
});

describe("what is refused at startup", () => {
  const refuses = (declare: (panel: ReturnType<typeof panelAt>["panel"]) => unknown, message: RegExp) => {
    const { panel } = panelAt();
    expect(() => declare(panel)).toThrow(AdminPanelConfigError);
    expect(() => declare(panelAt().panel)).toThrow(message);
  };

  it("refuses unknown options and wrong values", () => {
    refuses((panel) => panel.section("S", { group: "G", colapsed: true } as never), /unknown option "colapsed"/);
    refuses((panel) => panel.section("S", { group: "G", collapsed: true, collapsible: false }), /nobody could open it/);
    refuses((panel) => panel.section("S", { group: "G", density: "tight" as never }), /"compact" or "comfortable"/);
    refuses((panel) => panel.section("S", { group: "G", columns: 30 }), /from 1 to 24/);
    refuses((panel) => panel.card("C", { group: "G", layout: "columns:5" as never }), /"list", "grid"/);
    refuses((panel) => panel.card("C", { group: "G", emphasis: "loud" as never }), /"primary" or "secondary"/);
    refuses((panel) => panel.spacer({ group: "G", size: "xl" as never }), /"sm", "md" or "lg"/);
    refuses((panel) => panel.viewable(1, { label: "a", emphasis: "loud" as never }), /"primary" or "secondary"/);
    refuses((panel) => panel.viewable(1, { label: "a", span: "fifth" as never }), /span/);
    refuses((panel) => panel.group("G", { density: "tight" as never }), /density/);
  });

  it("refuses a card on anything but a value, and a card in two sections", () => {
    refuses((panel) => panel.action("Go", () => "ok", { group: "G", card: "C" } as never), /option "card"/);
    refuses((panel) => {
      panel.viewable(1, { label: "a", group: "G", section: "A", card: "C" });
      panel.viewable(2, { label: "b", group: "G", section: "B", card: "C" });
    }, /a card is in one section/);
    refuses((panel) => {
      panel.viewable(1, { label: "a", group: "G", section: "A", card: "C" });
      panel.card("C", { group: "G", section: "B" });
    }, /a card is in one section/);
  });

  it("exports its limits", () => {
    expect(MAX_SECTIONS_PER_GROUP).toBe(50);
    expect(MAX_LIST_CARD_VALUES).toBe(100);
    expect(MAX_LAYOUT_MARKS_PER_GROUP).toBe(200);
  });
});

describe("spans by name", () => {
  it("knows quarter to three-quarters, and keeps the old names", () => {
    expect(SPAN_WIDTHS).toMatchObject({ "1": 3, "2": 6, "3": 9, quarter: 3, third: 4, half: 6, "two-thirds": 8, "three-quarters": 9, full: 12 });
  });

  it("lets a span take a card past its kind's widest", () => {
    const item = { type: "value", id: "a", label: "a", kind: "number", writable: false, span: "full" } as unknown as ItemSchema;
    const sizing = sizingOf(item, 12);
    expect(sizing.pref.w).toBe(12);
    expect(sizing.max.w).toBe(12);
  });
});

describe("the schema on the wire", () => {
  it("carries sections, cards and marks through the router", async () => {
    const { panel } = panelAt();
    const g = panel.group("G");
    g.section("S", { collapsed: true });
    g.viewable(1, { label: "a", section: "S", card: "C" });
    g.divider({ section: "S" });
    const response = await call(routerFor(panel), "GET", "/api/schema");
    const group = (response.json as { schema: { groups: GroupSchema[] } }).schema.groups[0];
    expect(group?.sections?.[0]).toMatchObject({ id: "s", title: "S", collapsed: true });
    expect(group?.cards?.[0]).toMatchObject({ id: "card-c", layout: "list" });
    expect(group?.marks?.[0]).toMatchObject({ kind: "divider", section: "s" });
    expect(group?.items[0]).toMatchObject({ section: "s", card: "card-c" });
  });
});
